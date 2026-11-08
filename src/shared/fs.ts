import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Create a directory (and parents) readable only by the current user. */
export function ensureDir(path: string, mode = 0o700): void {
  mkdirSync(path, { recursive: true, mode });
}

/**
 * Write a file atomically: the content goes to a temporary file in the same
 * directory, which is then renamed over the target, so readers never see a
 * half-written file. The file is private to the current user by default.
 */
export function writeFileAtomic(path: string, data: string | Uint8Array, mode = 0o600): void {
  ensureDir(dirname(path));
  const tmp = join(dirname(path), `.${randomUUID()}.tmp`);
  writeFileSync(tmp, data, { mode });
  try { chmodSync(tmp, mode); } catch { /* best effort on platforms without chmod */ }
  renameSync(tmp, path);
}
