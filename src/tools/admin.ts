import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { simpleGit } from 'simple-git';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { validateBranch, parseBranchName } from '../git/branch-resolver.js';
import { CACHE_ROOT, REPO_DIR, WORKTREES_DIR } from '../config.js';
import { indexBranch } from '../index/indexer.js';
import {
  countObjectsByBranch,
  deleteBranchData,
  listIndexedBranches,
} from '../index/queries.js';
import { logger } from '../utils/logger.js';

function dirSizeBytes(path: string): number {
  if (!existsSync(path)) return 0;
  let total = 0;
  const stack: string[] = [path];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile()) {
          total += statSync(full).size;
        }
      } catch {
        // ignore unreadable entries
      }
    }
  }
  return total;
}

function fmtMb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

export function registerAdminTools(server: McpServer): void {
  server.registerTool(
    'bc_refresh',
    {
      title: 'Refresh branch index',
      description:
        'Re-fetches a branch from upstream and re-indexes it. If branch is omitted, refreshes every ' +
        'already-indexed branch sequentially.',
      inputSchema: {
        branch: z.string().optional().describe('Specific branch to refresh, e.g. "w1-26". Omit to refresh all indexed branches.'),
      },
      outputSchema: {
        refreshed: z.array(z.object({
          branch: z.string(),
          files_scanned: z.number(),
          objects_indexed: z.number(),
          events_indexed: z.number(),
          duration_ms: z.number(),
        })),
        errors: z.array(z.object({ branch: z.string(), error: z.string() })),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ branch }) => {
      let targets: string[];
      if (branch) {
        const v = validateBranch(branch);
        if (!v.ok) {
          return { content: [{ type: 'text', text: `Error: ${v.reason}` }], isError: true };
        }
        targets = [branch];
      } else {
        targets = listIndexedBranches().map(b => b.name);
        if (targets.length === 0) {
          return {
            content: [{ type: 'text', text: 'No branch has been indexed yet — nothing to refresh.' }],
            structuredContent: { refreshed: [], errors: [] },
          };
        }
      }
      logger.info({ targets }, 'bc_refresh called');

      const refreshed: Array<{ branch: string; files_scanned: number; objects_indexed: number; events_indexed: number; duration_ms: number }> = [];
      const errors: Array<{ branch: string; error: string }> = [];

      for (const b of targets) {
        try {
          const r = await indexBranch(b, { force: true });
          refreshed.push({
            branch: b,
            files_scanned: r.filesScanned,
            objects_indexed: r.objectsIndexed,
            events_indexed: r.eventsIndexed,
            duration_ms: r.durationMs,
          });
        } catch (err) {
          errors.push({ branch: b, error: (err as Error).message });
        }
      }

      const summary = `Refreshed ${refreshed.length}/${targets.length} branch(es)` +
        (errors.length ? `, ${errors.length} error(s)` : '') + '.';
      const lines = refreshed.map(r =>
        `  - ${r.branch}: ${r.objects_indexed} objects, ${r.events_indexed} events in ${(r.duration_ms / 1000).toFixed(1)}s`
      );
      return {
        content: [{ type: 'text', text: `${summary}\n${lines.join('\n')}` }],
        structuredContent: { refreshed, errors },
      };
    },
  );

  server.registerTool(
    'bc_cache_status',
    {
      title: 'Cache disk usage and indexed branches',
      description:
        'Reports the total disk usage of the bc-source-mcp cache, the number of indexed branches, ' +
        'their object counts, and last fetch/index dates.',
      inputSchema: {},
      outputSchema: {
        cache_root: z.string(),
        repo_size_mb: z.number(),
        worktrees_size_mb: z.number(),
        total_size_mb: z.number(),
        indexed_branches: z.array(z.object({
          branch: z.string(),
          objects: z.number(),
          last_indexed_at: z.number().nullable(),
          last_fetched_at: z.number().nullable(),
          worktree_path: z.string().nullable(),
        })),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const repoBytes = dirSizeBytes(REPO_DIR);
      const wtBytes = dirSizeBytes(WORKTREES_DIR);
      const totalBytes = dirSizeBytes(CACHE_ROOT);

      const branches = listIndexedBranches();
      const counts = new Map(countObjectsByBranch().map(b => [b.branch, b.count]));

      const indexed = branches.map(b => ({
        branch: b.name,
        objects: counts.get(b.name) ?? 0,
        last_indexed_at: b.last_indexed_at,
        last_fetched_at: b.last_fetched_at,
        worktree_path: b.worktree_path,
      }));

      const fmtDate = (ms: number | null): string =>
        ms ? new Date(ms).toISOString().slice(0, 19).replace('T', ' ') : '—';

      const text = [
        `Cache root: ${CACHE_ROOT}`,
        `  repo:      ${fmtMb(repoBytes)} MB`,
        `  worktrees: ${fmtMb(wtBytes)} MB`,
        `  total:     ${fmtMb(totalBytes)} MB`,
        ``,
        `Indexed branches (${indexed.length}):`,
        ...indexed.map(b =>
          `  - ${b.branch}: ${b.objects} objects, last indexed ${fmtDate(b.last_indexed_at)}`
        ),
      ].join('\n');

      return {
        content: [{ type: 'text', text }],
        structuredContent: {
          cache_root: CACHE_ROOT,
          repo_size_mb: fmtMb(repoBytes),
          worktrees_size_mb: fmtMb(wtBytes),
          total_size_mb: fmtMb(totalBytes),
          indexed_branches: indexed,
        },
      };
    },
  );

  server.registerTool(
    'bc_prune_cache',
    {
      title: 'Prune cached worktrees and index entries',
      description:
        'Removes worktrees and index entries for branches not matching the keep filters. ' +
        'Pass keep_branches (explicit allowlist) or keep_versions/keep_localizations to retain only ' +
        'certain version/loc combinations. The partial-clone Git repo itself is never deleted.',
      inputSchema: {
        keep_branches: z.array(z.string()).optional().describe('Explicit branches to retain (exact names).'),
        keep_versions: z.array(z.string()).optional().describe('Versions to retain, e.g. ["26", "27"].'),
        keep_localizations: z.array(z.string()).optional().describe('Localizations to retain, e.g. ["w1", "fr"].'),
        dry_run: z.boolean().optional().describe('If true, only report what would be deleted. Default false.'),
      },
      outputSchema: {
        removed: z.array(z.string()),
        kept: z.array(z.string()),
        freed_mb: z.number(),
        dry_run: z.boolean(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ keep_branches, keep_versions, keep_localizations, dry_run }) => {
      const isDry = dry_run ?? false;
      const branches = listIndexedBranches();
      const keepSet = new Set(keep_branches ?? []);

      const shouldKeep = (name: string): boolean => {
        if (keepSet.has(name)) return true;
        const parsed = parseBranchName(name);
        if (!parsed) return false;
        const baseVersion = parsed.version.replace(/-vNext$/, '');
        if (keep_versions && !keep_versions.includes(baseVersion) && !keep_versions.includes(parsed.version)) return false;
        if (keep_localizations && !keep_localizations.includes(parsed.localization)) return false;
        return !!(keep_versions || keep_localizations);
      };

      const removed: string[] = [];
      const kept: string[] = [];
      let freedBytes = 0;

      const git = simpleGit(REPO_DIR);

      for (const b of branches) {
        if (shouldKeep(b.name)) {
          kept.push(b.name);
          continue;
        }
        const wtPath = b.worktree_path ?? join(WORKTREES_DIR, b.name);
        if (existsSync(wtPath)) {
          freedBytes += dirSizeBytes(wtPath);
          if (!isDry) {
            try {
              await git.raw(['worktree', 'remove', '--force', wtPath]);
            } catch (err) {
              logger.warn({ branch: b.name, err }, 'Failed to remove worktree via git, deletion left to filesystem');
            }
          }
        }
        if (!isDry) deleteBranchData(b.name);
        removed.push(b.name);
      }

      if (!isDry && removed.length > 0) {
        try {
          await git.raw(['worktree', 'prune']);
        } catch {
          // not fatal
        }
      }

      const text = `${isDry ? '[DRY RUN] Would prune' : 'Pruned'} ${removed.length} branch(es), kept ${kept.length}, freed ${fmtMb(freedBytes)} MB.` +
        (removed.length > 0 ? '\n  removed: ' + removed.join(', ') : '');

      return {
        content: [{ type: 'text', text }],
        structuredContent: {
          removed, kept,
          freed_mb: fmtMb(freedBytes),
          dry_run: isDry,
        },
      };
    },
  );
}
