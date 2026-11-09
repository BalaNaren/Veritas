import { newId } from '../shared/ids.js';
import { safeJsonParse } from '../shared/json.js';
import { writeFileAtomic, ensureDir } from '../shared/fs.js';
import type { SandboxOutputFile } from '../sandbox/types.js';
import { taskDir } from '../storage/paths.js';
import type { Store } from '../storage/store.js';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runUrl, type SourceRow, type EvidenceStore } from './evidence-store.js';

type Row = Record<string, unknown>;

export interface RunRow {
  id: string;
  taskId: string;
  subtaskId: string | null;
  sourceId: string | null;
  attempt: number;
  code: string;
  backend: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  /** The parsed `output/results.json`, or null if the code did not write a valid one. */
  results: unknown;
  outputs: SandboxOutputFile[];
  startedAt: string;
  durationMs: number;
  ok: boolean;
}

export interface NewRun {
  taskId: string;
  subtaskId?: string | null;
  attempt: number;
  code: string;
  backend: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  results: unknown;
  outputs: SandboxOutputFile[];
  durationMs: number;
}

const mapRun = (r: Row): RunRow => ({
  id: r.id as string, taskId: r.task_id as string, subtaskId: (r.subtask_id as string | null) ?? null, sourceId: (r.source_id as string | null) ?? null,
  attempt: r.attempt as number, code: r.code as string, backend: r.backend as string, exitCode: (r.exit_code as number | null) ?? null,
  timedOut: r.timed_out === 1, stdout: r.stdout as string, stderr: r.stderr as string,
  results: r.results == null ? null : safeJsonParse(r.results as string), outputs: safeJsonParse<SandboxOutputFile[]>((r.outputs as string) ?? '[]'),
  startedAt: r.started_at as string, durationMs: r.duration_ms as number,
  ok: r.exit_code === 0 && r.timed_out !== 1 && r.results != null,
});

export const MAX_RESULT_LINES = 3000;

/** Flatten a results object to `path: value` lines (`by_region.North: 120`). These lines are what claims quote. */
export function flattenResults(value: unknown, prefix = '', out: string[] = []): string[] {
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
    for (const [k, v] of entries) flattenResults(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.push(`${prefix}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }
  return out;
}

/** The lines of results the claims may quote, in a form that does not depend on JSON formatting. */
export function resultsText(results: unknown): string {
  const lines = flattenResults(results);
  return (lines.length > MAX_RESULT_LINES ? lines.slice(0, MAX_RESULT_LINES) : lines).join('\n');
}

export class RunStore {
  constructor(private readonly store: Store, private readonly evidence: EvidenceStore, private readonly home: string) {}

  /**
   * Record a run. A run that finished and wrote valid results also becomes a source, so its numbers can be cited
   * and checked like any other evidence.
   */
  addRun(input: NewRun): RunRow {
    const id = newId('run');
    const ok = input.exitCode === 0 && !input.timedOut && input.results != null;
    this.store.db.prepare(
      `INSERT INTO runs (id, task_id, subtask_id, attempt, code, backend, exit_code, timed_out, stdout, stderr, results, outputs, started_at, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.taskId, input.subtaskId ?? null, input.attempt, input.code, input.backend, input.exitCode, input.timedOut ? 1 : 0,
      input.stdout, input.stderr, input.results == null ? null : JSON.stringify(input.results), JSON.stringify(input.outputs), new Date().toISOString(), input.durationMs);
    if (ok) {
      const source = this.addRunSource(id, input);
      this.store.db.prepare('UPDATE runs SET source_id = ? WHERE id = ?').run(source.id, id);
    }
    return this.getRun(id)!;
  }

  private addRunSource(runId: string, input: NewRun): SourceRow {
    const text = `# Analysis run ${runId}\n\n## Results\n${resultsText(input.results)}\n\n## Printed output\n${input.stdout.slice(0, 20_000)}\n`;
    const url = runUrl(runId);
    const dir = join(taskDir(this.home, input.taskId), 'sources');
    ensureDir(dir);
    const path = join(dir, `${runId}.txt`);
    writeFileAtomic(path, text);
    return this.evidence.insertSource({
      taskId: input.taskId, url, finalUrl: url, title: 'Analysis run (code in the appendix)', kind: 'run', contentType: 'text/plain',
      bytes: text.length, sha256: createHash('sha256').update(text).digest('hex'), text, snapshotPath: path,
      quality: 'primary', qualityReason: 'Computed by code that ran in the sandbox',
    });
  }

  getRun(id: string): RunRow | undefined {
    const r = this.store.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined;
    return r ? mapRun(r) : undefined;
  }

  listRuns(taskId: string): RunRow[] {
    return (this.store.db.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY started_at, rowid').all(taskId) as Row[]).map(mapRun);
  }
}
