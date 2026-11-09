import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { git } from '../security/safe-git.js';
import { tryJsonParse } from '../shared/json.js';

export class RepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepoError';
  }
}

export interface RepoState {
  /** Real path of the repository's top level. */
  root: string;
  branch: string;
  sha: string;
  /** Lines of `git status --porcelain`: changes in the user's own working tree. */
  dirty: string[];
}

/** Look at a repository without changing anything. */
export async function inspectRepo(path: string): Promise<RepoState> {
  let real: string;
  try { real = realpathSync(path); if (!statSync(real).isDirectory()) throw new Error('not a folder'); } catch { throw new RepoError(`${path} is not a folder.`); }
  const top = await git(real, ['rev-parse', '--show-toplevel'], { readOnly: true });
  if (top.exitCode !== 0) throw new RepoError(`${path} is not inside a git repository.`);
  const root = realpathSync(top.stdout.trim());
  const sha = await git(root, ['rev-parse', 'HEAD'], { readOnly: true });
  if (sha.exitCode !== 0) throw new RepoError('The repository has no commits yet; Veritas needs a starting commit to work from.');
  const branch = await git(root, ['symbolic-ref', '--short', '-q', 'HEAD'], { readOnly: true });
  if (branch.exitCode !== 0) throw new RepoError('The repository is on a detached commit. Check out a branch first.');
  const status = await git(root, ['status', '--porcelain'], { readOnly: true });
  if (status.exitCode !== 0) throw new RepoError(`Could not read the repository status: ${status.stderr.trim().slice(0, 200)}`);
  return { root, branch: branch.stdout.trim(), sha: sha.stdout.trim(), dirty: status.stdout.split('\n').filter(Boolean) };
}

/** The command a project most likely uses to run its tests, or undefined if none is recognisable. */
export function detectTestCommand(root: string): string | undefined {
  const has = (f: string): boolean => existsSync(join(root, f));
  if (has('package.json')) {
    const pkg = tryJsonParse<{ scripts?: Record<string, string> }>(readFileSync(join(root, 'package.json'), 'utf8'));
    const test = pkg?.scripts?.test;
    if (test && !/no test specified/i.test(test)) return 'npm test';
  }
  if (has('Cargo.toml')) return 'cargo test';
  if (has('go.mod')) return 'go test ./...';
  if (has('pytest.ini') || has('tox.ini') || has('conftest.py') || (has('pyproject.toml') && /\[tool\.pytest|pytest/.test(readFileSync(join(root, 'pyproject.toml'), 'utf8')))) return 'python3 -m pytest';
  if (has('Makefile') && /^test:/m.test(readFileSync(join(root, 'Makefile'), 'utf8'))) return 'make test';
  return undefined;
}
