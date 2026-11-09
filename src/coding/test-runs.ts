import { realpathSync } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import { BASE_ENV_NAMES, pickEnv } from '../shared/env.js';
import { newId } from '../shared/ids.js';
import { pathDirs, resolveExecutable, SafeExecutor } from '../security/safe-exec.js';
import type { Store } from '../storage/store.js';
import { commandText, parseCommand } from './command.js';

type Row = Record<string, unknown>;

export interface TestRunRow {
  id: string;
  taskId: string;
  /** `setup`, `baseline`, or `round1`, `round2`... */
  phase: string;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** The end of the combined output. */
  output: string;
  startedAt: string;
  /** True only when the command ran to the end and exited with 0. */
  passed: boolean;
}

const mapRun = (r: Row): TestRunRow => ({
  id: r.id as string, taskId: r.task_id as string, phase: r.phase as string, command: r.command as string,
  exitCode: (r.exit_code as number | null) ?? null, timedOut: r.timed_out === 1, durationMs: r.duration_ms as number,
  output: r.output as string, startedAt: r.started_at as string, passed: r.exit_code === 0 && r.timed_out !== 1,
});

export const MAX_OUTPUT_KEPT = 60_000;
export const DEFAULT_TEST_TIMEOUT_MS = 10 * 60_000;

/**
 * Variables a test command may see. No tokens or keys are passed (API keys, cloud and GitHub credentials stay out),
 * which also means tests that need them will fail rather than use them.
 */
const TEST_ENV_NAMES = [...BASE_ENV_NAMES, 'NODE_PATH', 'GOPATH', 'GOCACHE', 'CARGO_HOME', 'RUSTUP_HOME', 'PYTHONPATH', 'VIRTUAL_ENV', 'NVM_DIR', 'JAVA_HOME', 'LC_MESSAGES'];

export class TestRunStore {
  constructor(private readonly store: Store) {}

  add(r: Omit<TestRunRow, 'id' | 'passed' | 'startedAt'>): TestRunRow {
    const id = newId('test');
    this.store.db.prepare(
      `INSERT INTO test_runs (id, task_id, phase, command, exit_code, timed_out, duration_ms, output, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, r.taskId, r.phase, r.command, r.exitCode, r.timedOut ? 1 : 0, r.durationMs, r.output.slice(-MAX_OUTPUT_KEPT), new Date().toISOString());
    return this.get(id)!;
  }
  get(id: string): TestRunRow | undefined {
    const r = this.store.db.prepare('SELECT * FROM test_runs WHERE id = ?').get(id) as Row | undefined;
    return r ? mapRun(r) : undefined;
  }
  list(taskId: string): TestRunRow[] {
    return (this.store.db.prepare('SELECT * FROM test_runs WHERE task_id = ? ORDER BY started_at, rowid').all(taskId) as Row[]).map(mapRun);
  }
}

/** Commands the user has approved for a project (one repository), remembered so they are asked only once. */
export class ApprovedCommands {
  constructor(private readonly store: Store) {}
  isApproved(repo: string, command: string): boolean {
    return !!this.store.db.prepare('SELECT 1 FROM approved_commands WHERE repo = ? AND command = ?').get(repo, command);
  }
  approve(repo: string, command: string): void {
    this.store.db.prepare('INSERT OR IGNORE INTO approved_commands (repo, command, approved_at) VALUES (?, ?, ?)').run(repo, command, new Date().toISOString());
  }
  list(): { repo: string; command: string; approvedAt: string }[] {
    return (this.store.db.prepare('SELECT * FROM approved_commands ORDER BY approved_at').all() as Row[]).map((r) => ({ repo: r.repo as string, command: r.command as string, approvedAt: r.approved_at as string }));
  }
}

export interface RunCommandOptions {
  cwd: string;
  command: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CommandOutcome { argv: string[]; command: string; exitCode: number | null; timedOut: boolean; truncated: boolean; durationMs: number; output: string; spawnError?: string }

/**
 * Run an approved project command in a working copy: no shell, an exact program path, a minimal environment, a time
 * limit and a cap on the output. What it prints is kept as the record of what happened.
 */
export async function runProjectCommand(o: RunCommandOptions): Promise<CommandOutcome> {
  const argv = parseCommand(o.command);
  const root = realpathSync(o.cwd);
  let exe: string | undefined;
  if (argv[0]!.startsWith('./')) {
    // A script that is part of the project; it must really be inside the working copy.
    const candidate = join(root, argv[0]!);
    try { const real = realpathSync(candidate); exe = real.startsWith(root + sep) ? real : undefined; } catch { exe = undefined; }
  } else if (!argv[0]!.includes('/')) {
    exe = resolveExecutable(argv[0]!, pathDirs());
  }
  const command = commandText(argv);
  if (!exe || !isAbsolute(exe)) return { argv, command, exitCode: null, timedOut: false, truncated: false, durationMs: 0, output: `The program "${argv[0]}" was not found.`, spawnError: 'not found' };
  const started = Date.now();
  const res = await new SafeExecutor({ allowedCommands: [exe] }).run(exe, argv.slice(1), {
    cwd: root, env: pickEnv(TEST_ENV_NAMES, { CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' }),
    timeoutMs: o.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS, killGraceMs: 2000, maxOutputBytes: 4 * 1024 * 1024, signal: o.signal,
  });
  const output = `${res.stdout}${res.stderr ? `${res.stdout && !res.stdout.endsWith('\n') ? '\n' : ''}${res.stderr}` : ''}`;
  return { argv, command, exitCode: res.exitCode, timedOut: res.timedOut, truncated: res.truncated, durationMs: Date.now() - started, output: output.slice(-MAX_OUTPUT_KEPT), spawnError: res.spawnError };
}

