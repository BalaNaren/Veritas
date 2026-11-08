import { chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureDir } from '../shared/fs.js';
import { MIGRATIONS } from './migrations.js';

export type Db = DatabaseSync;

/** Open (and migrate) the database. Use `:memory:` for tests. */
export function openDatabase(path: string): Db {
  const inMemory = path === ':memory:';
  if (!inMemory) ensureDir(dirname(path));
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  migrate(db);
  if (!inMemory) {
    try { chmodSync(path, 0o600); } catch { /* best effort */ }
  }
  return db;
}

export function schemaVersion(db: Db): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

export function migrate(db: Db): void {
  const current = schemaVersion(db);
  if (current > MIGRATIONS.length) {
    throw new Error(`Database schema (${current}) is newer than this version of Veritas supports (${MIGRATIONS.length})`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
