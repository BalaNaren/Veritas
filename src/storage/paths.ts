import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureDir } from '../shared/fs.js';

/** Where Veritas keeps its data: `$VERITAS_HOME` if set, otherwise `~/.veritas`. */
export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.VERITAS_HOME;
  return override && override.trim() ? override : join(homedir(), '.veritas');
}

export const dbPath = (home: string): string => join(home, 'veritas.db');
export const taskDir = (home: string, taskId: string): string => join(home, 'tasks', taskId);

export function ensureHome(home: string): void {
  ensureDir(home);
  ensureDir(join(home, 'tasks'));
}
