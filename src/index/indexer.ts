import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { getDb } from './db.js';
import { parseObjectHeader, appFromPath } from '../parser/al-object.js';
import { extractEventPublishers } from '../parser/al-events.js';
import { validateBranch } from '../git/branch-resolver.js';
import { ensureWorktree, fetchBranch } from '../git/repo-manager.js';
import { logger } from '../utils/logger.js';

export async function ensureBranchIndexed(branch: string): Promise<void> {
  const db = getDb();
  const row = db.prepare<[string], { last_indexed_at: number | null }>(
    'SELECT last_indexed_at FROM branches WHERE name = ?',
  ).get(branch);
  if (row?.last_indexed_at) return;
  await indexBranch(branch);
}

export interface IndexBranchResult {
  branch: string;
  worktree: string;
  filesScanned: number;
  objectsIndexed: number;
  eventsIndexed: number;
  apps: string[];
  durationMs: number;
}

function* walkAlFiles(root: string): Generator<string> {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.al')) {
        yield full;
      }
    }
  }
}

export async function indexBranch(branch: string, opts: { force?: boolean } = {}): Promise<IndexBranchResult> {
  const validation = validateBranch(branch);
  if (!validation.ok) throw new Error(validation.reason);

  const db = getDb();
  const now = Date.now();

  if (!opts.force) {
    const row = db.prepare<[string], { last_indexed_at: number | null }>(
      'SELECT last_indexed_at FROM branches WHERE name = ?',
    ).get(branch);
    if (row && row.last_indexed_at) {
      logger.info({ branch, last_indexed_at: row.last_indexed_at }, 'Branch already indexed (use force=true to reindex)');
    }
  }

  logger.info({ branch }, 'Fetching branch');
  await fetchBranch(branch);

  logger.info({ branch }, 'Ensuring worktree');
  const wt = await ensureWorktree(branch);

  logger.info({ branch, wt }, 'Walking AL files and parsing');
  const start = Date.now();
  let filesScanned = 0;
  let objectsIndexed = 0;
  const apps = new Set<string>();
  const appRoots = new Map<string, string>();

  const upsertObject = db.prepare(`
    INSERT OR REPLACE INTO objects (branch, app, type, id, name, ext_target, path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertApp = db.prepare(`
    INSERT OR REPLACE INTO apps (branch, name, root_path) VALUES (?, ?, ?)
  `);
  const upsertEvent = db.prepare(`
    INSERT OR REPLACE INTO event_publishers
    (branch, source_type, source_name, event_name, event_kind, signature, attribute, line, path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertBranch = db.prepare(`
    INSERT INTO branches (name, localization, version, last_indexed_at, last_fetched_at, worktree_path)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      last_indexed_at = excluded.last_indexed_at,
      last_fetched_at = excluded.last_fetched_at,
      worktree_path = excluded.worktree_path
  `);
  const deleteOldObjects = db.prepare(`DELETE FROM objects WHERE branch = ?`);
  const deleteOldApps = db.prepare(`DELETE FROM apps WHERE branch = ?`);
  const deleteOldEvents = db.prepare(`DELETE FROM event_publishers WHERE branch = ?`);

  let eventsIndexed = 0;
  const tx = db.transaction(() => {
    deleteOldObjects.run(branch);
    deleteOldApps.run(branch);
    deleteOldEvents.run(branch);

    for (const file of walkAlFiles(wt)) {
      filesScanned++;
      let source: string;
      try {
        const st = statSync(file);
        if (st.size > 5_000_000) continue;
        source = readFileSync(file, 'utf8');
      } catch (err) {
        logger.warn({ file, err }, 'Failed to read AL file');
        continue;
      }

      const header = parseObjectHeader(source);
      if (!header) continue;

      const rel = relative(wt, file).replace(/\\/g, '/');
      const app = appFromPath(rel);
      apps.add(app);
      if (!appRoots.has(app)) appRoots.set(app, app);

      upsertObject.run(
        branch, app, header.type, header.id, header.name, header.extends, rel,
      );
      objectsIndexed++;

      // Event publishers live in codeunits, tables, pages mostly — but scan everything.
      const events = extractEventPublishers(source);
      for (const ev of events) {
        upsertEvent.run(
          branch, header.type, header.name, ev.name, ev.kind,
          ev.signature, ev.attribute, ev.line, rel,
        );
        eventsIndexed++;
      }
    }

    for (const [app, root] of appRoots) {
      upsertApp.run(branch, app, root);
    }

    upsertBranch.run(
      branch, validation.parsed.localization, validation.parsed.version,
      now, now, wt,
    );
  });

  tx();

  const durationMs = Date.now() - start;
  logger.info({ branch, filesScanned, objectsIndexed, eventsIndexed, apps: apps.size, durationMs }, 'Index complete');

  return {
    branch, worktree: wt,
    filesScanned, objectsIndexed, eventsIndexed,
    apps: Array.from(apps).sort(),
    durationMs,
  };
}
