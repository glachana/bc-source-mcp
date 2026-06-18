import { getDb } from './db.js';

export interface AppRow {
  branch: string;
  name: string;
  object_count: number;
}

export interface ObjectRow {
  branch: string;
  app: string;
  type: string;
  id: number | null;
  name: string;
  ext_target: string | null;
  path: string;
}

export interface BranchIndexInfo {
  name: string;
  last_indexed_at: number | null;
  last_fetched_at: number | null;
  worktree_path: string | null;
}

export function getBranchIndexInfo(branch: string): BranchIndexInfo | null {
  return getDb().prepare<[string], BranchIndexInfo>(
    'SELECT name, last_indexed_at, last_fetched_at, worktree_path FROM branches WHERE name = ?',
  ).get(branch) ?? null;
}

export function listIndexedBranches(): BranchIndexInfo[] {
  return getDb().prepare<[], BranchIndexInfo>(
    'SELECT name, last_indexed_at, last_fetched_at, worktree_path FROM branches ORDER BY name',
  ).all();
}

export function countObjectsByBranch(): Array<{ branch: string; count: number }> {
  return getDb().prepare<[], { branch: string; count: number }>(
    'SELECT branch, COUNT(*) AS count FROM objects GROUP BY branch ORDER BY branch',
  ).all();
}

export function deleteBranchData(branch: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM event_publishers WHERE branch = ?').run(branch);
    db.prepare('DELETE FROM objects WHERE branch = ?').run(branch);
    db.prepare('DELETE FROM apps WHERE branch = ?').run(branch);
    db.prepare('DELETE FROM objects_fts WHERE branch = ?').run(branch);
    db.prepare('DELETE FROM branches WHERE name = ?').run(branch);
  });
  tx();
}

export interface FtsSearchFilters {
  query: string;
  branches?: string[];
  app?: string;
  type?: string;
  limit: number;
  offset: number;
}

export interface FtsMatchRow {
  branch: string;
  app: string;
  type: string;
  name: string;
  path: string;
  snippet: string;
  score: number;
}

export interface FtsSearchResult {
  total: number;
  items: FtsMatchRow[];
}

export function searchFts(filters: FtsSearchFilters): FtsSearchResult {
  const db = getDb();
  const where: string[] = ['objects_fts MATCH @query'];
  const params: Record<string, unknown> = { query: filters.query };

  if (filters.branches && filters.branches.length > 0) {
    const placeholders = filters.branches.map((_, i) => `@b${i}`).join(',');
    where.push(`branch IN (${placeholders})`);
    filters.branches.forEach((b, i) => { params[`b${i}`] = b; });
  }
  if (filters.app) {
    where.push('app = @app');
    params.app = filters.app;
  }
  if (filters.type) {
    where.push('LOWER(type) = LOWER(@type)');
    params.type = filters.type;
  }

  const whereSql = where.join(' AND ');
  const totalRow = db.prepare<typeof params, { c: number }>(
    `SELECT COUNT(*) AS c FROM objects_fts WHERE ${whereSql}`,
  ).get(params);
  const total = totalRow?.c ?? 0;

  const items = db.prepare<typeof params, FtsMatchRow>(
    `SELECT branch, app, type, name, path,
            snippet(objects_fts, 5, '<<', '>>', '…', 16) AS snippet,
            bm25(objects_fts) AS score
     FROM objects_fts
     WHERE ${whereSql}
     ORDER BY score
     LIMIT @limit OFFSET @offset`,
  ).all({ ...params, limit: filters.limit, offset: filters.offset });

  return { total, items };
}

export function isBranchIndexed(branch: string): boolean {
  const info = getBranchIndexInfo(branch);
  return !!info?.last_indexed_at;
}

export function listApps(branch: string): AppRow[] {
  return getDb().prepare<[string], AppRow>(`
    SELECT a.branch AS branch, a.name AS name,
           (SELECT COUNT(*) FROM objects o WHERE o.branch = a.branch AND o.app = a.name) AS object_count
    FROM apps a
    WHERE a.branch = ?
    ORDER BY a.name
  `).all(branch);
}

export interface ListObjectsFilters {
  branch: string;
  type?: string;
  app?: string;
  namePattern?: string;
  limit: number;
  offset: number;
}

export interface ListObjectsResult {
  total: number;
  items: ObjectRow[];
}

export function listObjects(filters: ListObjectsFilters): ListObjectsResult {
  const db = getDb();
  const where: string[] = ['branch = @branch'];
  const params: Record<string, unknown> = { branch: filters.branch };

  if (filters.type) {
    where.push('LOWER(type) = LOWER(@type)');
    params.type = filters.type;
  }
  if (filters.app) {
    where.push('app = @app');
    params.app = filters.app;
  }
  if (filters.namePattern) {
    where.push('name LIKE @name_pattern');
    params.name_pattern = filters.namePattern.replace(/\*/g, '%');
  }

  const whereSql = where.join(' AND ');
  const total = (db.prepare<typeof params, { c: number }>(
    `SELECT COUNT(*) AS c FROM objects WHERE ${whereSql}`,
  ).get(params))?.c ?? 0;

  const items = db.prepare<typeof params, ObjectRow>(
    `SELECT branch, app, type, id, name, ext_target, path FROM objects
     WHERE ${whereSql}
     ORDER BY type, COALESCE(id, 0), name
     LIMIT @limit OFFSET @offset`,
  ).all({ ...params, limit: filters.limit, offset: filters.offset });

  return { total, items };
}

export function findObject(branch: string, type: string, name: string): ObjectRow | null {
  return getDb().prepare<[string, string, string], ObjectRow>(
    `SELECT branch, app, type, id, name, ext_target, path FROM objects
     WHERE branch = ? AND LOWER(type) = LOWER(?) AND name = ?`,
  ).get(branch, type, name) ?? null;
}

export interface EventRow {
  branch: string;
  source_type: string;
  source_name: string;
  event_name: string;
  event_kind: string;
  signature: string;
  attribute: string;
  line: number;
  path: string;
}

export function listEventPublishers(
  branch: string, sourceType: string, sourceName: string,
): EventRow[] {
  return getDb().prepare<[string, string, string], EventRow>(`
    SELECT branch, source_type, source_name, event_name, event_kind, signature, attribute, line, path
    FROM event_publishers
    WHERE branch = ? AND LOWER(source_type) = LOWER(?) AND source_name = ?
    ORDER BY line
  `).all(branch, sourceType, sourceName);
}

export interface FindObjectAcrossBranchesRow {
  branch: string;
  type: string;
  id: number | null;
  name: string;
  app: string;
  path: string;
}

export function findObjectAcrossIndexedBranches(
  type: string, name: string, branchFilter?: string[],
): FindObjectAcrossBranchesRow[] {
  const db = getDb();
  if (branchFilter && branchFilter.length > 0) {
    const placeholders = branchFilter.map(() => '?').join(',');
    return db.prepare<unknown[], FindObjectAcrossBranchesRow>(
      `SELECT branch, type, id, name, app, path FROM objects
       WHERE LOWER(type) = LOWER(?) AND name = ? AND branch IN (${placeholders})
       ORDER BY branch`,
    ).all(type, name, ...branchFilter);
  }
  return db.prepare<[string, string], FindObjectAcrossBranchesRow>(
    `SELECT branch, type, id, name, app, path FROM objects
     WHERE LOWER(type) = LOWER(?) AND name = ?
     ORDER BY branch`,
  ).all(type, name);
}
