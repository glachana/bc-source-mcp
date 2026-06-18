import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database, { type Database as DB } from 'better-sqlite3';
import { CACHE_ROOT, INDEX_DB } from '../config.js';
import { logger } from '../utils/logger.js';

let cached: DB | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS branches (
  name             TEXT PRIMARY KEY,
  localization     TEXT NOT NULL,
  version          TEXT NOT NULL,
  last_indexed_at  INTEGER,
  last_fetched_at  INTEGER,
  worktree_path    TEXT
);

CREATE TABLE IF NOT EXISTS apps (
  branch     TEXT NOT NULL,
  name       TEXT NOT NULL,
  root_path  TEXT NOT NULL,
  PRIMARY KEY (branch, name)
);

CREATE TABLE IF NOT EXISTS objects (
  branch    TEXT NOT NULL,
  app       TEXT NOT NULL,
  type      TEXT NOT NULL,
  id        INTEGER,
  name      TEXT NOT NULL,
  ext_target TEXT,
  path      TEXT NOT NULL,
  PRIMARY KEY (branch, app, type, name)
);

CREATE INDEX IF NOT EXISTS idx_objects_branch_name ON objects(branch, name);
CREATE INDEX IF NOT EXISTS idx_objects_type ON objects(type);
CREATE INDEX IF NOT EXISTS idx_objects_type_id ON objects(type, id);
CREATE INDEX IF NOT EXISTS idx_objects_branch_app ON objects(branch, app);

CREATE TABLE IF NOT EXISTS event_publishers (
  branch          TEXT NOT NULL,
  source_type     TEXT NOT NULL,
  source_name     TEXT NOT NULL,
  event_name      TEXT NOT NULL,
  event_kind      TEXT NOT NULL,
  signature       TEXT NOT NULL,
  attribute       TEXT NOT NULL,
  line            INTEGER NOT NULL,
  path            TEXT NOT NULL,
  PRIMARY KEY (branch, source_type, source_name, event_name)
);

CREATE INDEX IF NOT EXISTS idx_events_branch_source ON event_publishers(branch, source_type, source_name);
CREATE INDEX IF NOT EXISTS idx_events_branch_name ON event_publishers(branch, event_name);
`;

export function getDb(): DB {
  if (cached) return cached;

  if (!existsSync(CACHE_ROOT)) mkdirSync(CACHE_ROOT, { recursive: true });
  const dbDir = dirname(INDEX_DB);
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

  logger.info({ path: INDEX_DB }, 'Opening SQLite index');
  const db = new Database(INDEX_DB);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  cached = db;
  return db;
}

export function closeDb(): void {
  if (cached) {
    cached.close();
    cached = null;
  }
}
