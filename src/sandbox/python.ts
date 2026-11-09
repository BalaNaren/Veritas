import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runProcess } from '../shared/process.js';
import { SandboxError } from './types.js';

/** Exact versions of the analysis libraries. The Dockerfile must list the same ones. */
export const PINNED_PACKAGES: readonly string[] = ['numpy==2.0.2', 'pandas==2.2.3', 'matplotlib==3.9.4', 'openpyxl==3.1.5'];

export const venvDir = (home: string): string => join(home, 'runtime', 'python');
export const venvPython = (home: string): string => join(venvDir(home), process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

/** True when the managed environment exists and can import the analysis libraries. */
export async function runtimeReady(home: string): Promise<boolean> {
  const py = venvPython(home);
  if (!existsSync(py)) return false;
  const res = await runProcess(py, ['-I', '-c', 'import numpy, pandas, matplotlib'], { env: { PATH: '/usr/bin:/bin' }, timeoutMs: 60_000 });
  return res.exitCode === 0;
}

export interface SetupOptions {
  /** Python used to create the environment (must be 3.9 or newer). */
  basePython?: string;
  onStep?: (message: string) => void;
  signal?: AbortSignal;
}

/**
 * Create the Veritas-managed Python environment and install the pinned libraries into it. This is the only place
 * Veritas installs software, it needs network access, and it only runs when the user asks for it (`veritas setup`).
 */
export async function setupPython(home: string, o: SetupOptions = {}): Promise<void> {
  const base = o.basePython ?? 'python3';
  const dir = venvDir(home);
  const env = { PATH: '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin', HOME: home, PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_NO_INPUT: '1' };
  const version = await runProcess(base, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { env, timeoutMs: 30_000 });
  if (version.exitCode !== 0) throw new SandboxError(`Python was not found (tried "${base}"). Install Python 3.9 or newer.`);
  const [major = 0, minor = 0] = version.stdout.trim().split('.').map(Number);
  if (major < 3 || (major === 3 && minor < 9)) throw new SandboxError(`Python ${version.stdout.trim()} is too old; 3.9 or newer is needed.`);

  o.onStep?.(`Creating the analysis environment in ${dir}`);
  const venv = await runProcess(base, ['-m', 'venv', dir], { env, timeoutMs: 120_000, signal: o.signal });
  if (venv.exitCode !== 0) throw new SandboxError(`Could not create the environment: ${venv.stderr.trim() || venv.stdout.trim()}`);

  o.onStep?.(`Installing ${PINNED_PACKAGES.join(', ')} (needs the internet)`);
  const pip = await runProcess(venvPython(home), ['-m', 'pip', 'install', '--only-binary=:all:', ...PINNED_PACKAGES], { env, timeoutMs: 600_000, signal: o.signal });
  if (pip.exitCode !== 0) throw new SandboxError(`Installing the libraries failed: ${pip.stderr.trim().split('\n').slice(-3).join(' ')}`);
  if (!(await runtimeReady(home))) throw new SandboxError('The environment was created but the libraries cannot be loaded.');
}
