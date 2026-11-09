import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ENV = { PATH: process.env.PATH!, HOME: tmpdir(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };

/** Run git directly (not through Veritas) so tests can set up and inspect repositories independently. */
export const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' }).trim();

export function makeRepo(files: Record<string, string>, opts: { identity?: boolean } = {}): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'veritas-repo-')));
  sh(dir, 'init', '-q', '-b', 'main');
  if (opts.identity !== false) { sh(dir, 'config', 'user.name', 'Test User'); sh(dir, 'config', 'user.email', 'test@example.com'); }
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'initial');
  return dir;
}

/** A small Node project whose tests run with `node --test` and no dependencies. add() has a bug the tests catch. */
export const BUGGY_PROJECT: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', type: 'module', scripts: { test: 'node --test' } }),
  'add.js': 'export function add(a, b) {\n  return a - b;\n}\n',
  'add.test.js': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './add.js';\ntest('adds', () => { assert.equal(add(2, 3), 5); });\n",
  '.gitignore': 'node_modules\n',
};
