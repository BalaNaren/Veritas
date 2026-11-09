import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { ensureDir } from '../shared/fs.js';
import { SANDBOX_LIMITS, SandboxError, type SandboxOutputFile, type SandboxRequest } from './types.js';

/**
 * The code is run by this wrapper so the stored analysis code stays exactly as the agent wrote it.
 * It lowers what the code may do (file size, core dumps) and then runs it in a clean namespace.
 */
export const RUNNER_SOURCE = `import os, resource, sys
resource.setrlimit(resource.RLIMIT_FSIZE, (${SANDBOX_LIMITS.maxOutputFileBytes}, ${SANDBOX_LIMITS.maxOutputFileBytes}))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
os.makedirs("output", exist_ok=True)
with open("analysis.py", "r", encoding="utf-8") as f:
    source = f.read()
exec(compile(source, "analysis.py", "exec"), {"__name__": "__main__", "__file__": "analysis.py"})
`;

export interface WorkDir {
  /** Real path of the private folder the code runs in. */
  path: string;
  cleanup(): void;
}

/** Make a private working folder holding the code, the runner and a copy of the input files. */
export function prepareWorkDir(request: SandboxRequest): WorkDir {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'veritas-sbx-')));
  const cleanup = (): void => { rmSync(path, { recursive: true, force: true }); };
  try {
    writeFileSync(join(path, 'analysis.py'), request.code, { mode: 0o600 });
    writeFileSync(join(path, 'run.py'), RUNNER_SOURCE, { mode: 0o600 });
    mkdirSync(join(path, 'output'), { mode: 0o700 });
    mkdirSync(join(path, 'input'), { mode: 0o700 });
    mkdirSync(join(path, '.mpl'), { mode: 0o700 });
    let total = 0;
    const seen = new Set<string>();
    for (const f of request.inputFiles ?? []) {
      const name = basename(f.name);
      if (!name || name !== f.name || name.startsWith('.') || seen.has(name)) throw new SandboxError(`Invalid or repeated input file name: ${f.name}`);
      seen.add(name);
      total += statSync(f.path).size;
      if (total > SANDBOX_LIMITS.maxInputBytes) throw new SandboxError('The input files are too large for the sandbox.');
      copyFileSync(f.path, join(path, 'input', name));
    }
    return { path, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** Copy what the code left in `output/` to a permanent place, with hashes. Symlinks and oversized files are skipped. */
export function collectOutputs(workDir: string, outputDir: string): SandboxOutputFile[] {
  const root = join(workDir, 'output');
  ensureDir(outputDir);
  const found: SandboxOutputFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile() || found.length >= SANDBOX_LIMITS.maxOutputFiles) continue; // links and devices are never followed
      const bytes = statSync(full).size;
      if (bytes > SANDBOX_LIMITS.maxOutputFileBytes) continue;
      const name = relative(root, full);
      const data = readFileSync(full);
      const dest = join(outputDir, name.replace(/[\\/]/g, '__'));
      writeFileSync(dest, data, { mode: 0o600 });
      found.push({ name, path: dest, bytes, sha256: createHash('sha256').update(data).digest('hex') });
    }
  };
  walk(root);
  return found.sort((a, b) => a.name.localeCompare(b.name));
}
