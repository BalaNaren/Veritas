import type { Plan } from '../engine/plan.js';
import { newId } from '../shared/ids.js';
import { safeJsonParse } from '../shared/json.js';
import { openDatabase, type Db } from './db.js';
import type {
  ApprovalRow, ApprovalStatus, EventRow, SubtaskRow, SubtaskStatus, TaskRow, TaskStatus,
} from './models.js';

type Row = Record<string, unknown>;
type SqlValue = string | number | bigint | null;

const now = (): string => new Date().toISOString();
const j = (value: unknown): string => JSON.stringify(value ?? null);
const parse = <T>(text: unknown, fallback: T): T => {
  if (typeof text !== 'string') return fallback;
  try { return safeJsonParse<T>(text); } catch { return fallback; }
};

function mapTask(r: Row): TaskRow {
  return {
    id: r.id as string, slug: r.slug as string, goal: r.goal as string, type: r.type as string,
    status: r.status as TaskStatus, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    budgetUsd: r.budget_usd as number, spentUsd: r.spent_usd as number, mode: r.mode as string,
    cwd: r.cwd as string, assumptions: parse<string[]>(r.assumptions, []),
    plan: r.plan == null ? null : parse<Plan | null>(r.plan, null),
    resultPath: (r.result_path as string | null) ?? null, error: (r.error as string | null) ?? null,
  };
}

function mapSubtask(r: Row): SubtaskRow {
  return {
    id: r.id as string, taskId: r.task_id as string, key: r.key as string, idx: r.idx as number,
    title: r.title as string, kind: r.kind as string, instructions: r.instructions as string,
    model: (r.model as string | null) ?? null, dependsOn: parse<string[]>(r.depends_on, []),
    status: r.status as SubtaskStatus, startedAt: (r.started_at as string | null) ?? null,
    finishedAt: (r.finished_at as string | null) ?? null, costUsd: r.cost_usd as number,
    inputTokens: r.input_tokens as number, outputTokens: r.output_tokens as number,
    output: r.output == null ? null : parse<unknown>(r.output, null),
    error: (r.error as string | null) ?? null, attempts: r.attempts as number,
  };
}

function mapEvent(r: Row): EventRow {
  return {
    id: r.id as number, taskId: r.task_id as string, subtaskId: (r.subtask_id as string | null) ?? null,
    ts: r.ts as string, type: r.type as string, data: parse<unknown>(r.data, null),
  };
}

function mapApproval(r: Row): ApprovalRow {
  return {
    id: r.id as string, taskId: r.task_id as string, action: r.action as string,
    detail: parse<unknown>(r.detail, null), status: r.status as ApprovalStatus,
    requestedAt: r.requested_at as string, decidedAt: (r.decided_at as string | null) ?? null,
    decidedBy: (r.decided_by as string | null) ?? null,
  };
}

export interface NewTask {
  slug: string;
  goal: string;
  type: string;
  budgetUsd: number;
  mode: string;
  cwd: string;
}

export interface NewSubtask {
  key: string;
  title: string;
  kind: string;
  instructions: string;
  model?: string | null;
  dependsOn: string[];
}

export interface TaskPatch {
  status?: TaskStatus;
  plan?: Plan | null;
  assumptions?: string[];
  resultPath?: string | null;
  error?: string | null;
  budgetUsd?: number;
}

export interface SubtaskPatch {
  status?: SubtaskStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  output?: unknown;
  error?: string | null;
  attempts?: number;
}

/** Builds `SET a = ?, b = ?` from a patch, mapping camelCase keys to columns. */
function setClause(patch: Record<string, unknown>, columns: Record<string, { col: string; json?: boolean }>): { sql: string; params: SqlValue[] } {
  const parts: string[] = [];
  const params: SqlValue[] = [];
  for (const [key, spec] of Object.entries(columns)) {
    if (!(key in patch) || patch[key] === undefined) continue;
    parts.push(`${spec.col} = ?`);
    const v = patch[key];
    params.push(spec.json ? (v === null ? null : j(v)) : (v as SqlValue));
  }
  return { sql: parts.join(', '), params };
}

export class Store {
  private depth = 0;

  constructor(readonly db: Db) {}

  static open(path: string): Store {
    return new Store(openDatabase(path));
  }

  close(): void {
    this.db.close();
  }

  /** Run `fn` atomically. Nested calls become savepoints. */
  transaction<T>(fn: () => T): T {
    const outer = this.depth === 0;
    const sp = `sp_${this.depth}`;
    this.db.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      this.db.exec(outer ? 'COMMIT' : `RELEASE ${sp}`);
      return result;
    } catch (error) {
      this.depth--;
      this.db.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw error;
    }
  }

  // ---------------- tasks ----------------

  createTask(input: NewTask): TaskRow {
    const id = newId('task');
    const ts = now();
    this.db.prepare(
      `INSERT INTO tasks (id, slug, goal, type, status, created_at, updated_at, budget_usd, spent_usd, mode, cwd, assumptions)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, 0, ?, ?, '[]')`,
    ).run(id, input.slug, input.goal, input.type, ts, ts, input.budgetUsd, input.mode, input.cwd);
    return this.getTask(id)!;
  }

  getTask(id: string): TaskRow | undefined {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
    return r ? mapTask(r) : undefined;
  }

  /** Find a task by full id, id prefix, or exact slug. Throws when a prefix is ambiguous. */
  findTask(ref: string): TaskRow | undefined {
    const exact = this.getTask(ref);
    if (exact) return exact;
    const escaped = ref.replace(/[\\%_]/g, (c) => `\\${c}`);
    const rows = this.db.prepare(
      `SELECT * FROM tasks WHERE id LIKE ? ESCAPE '\\' OR slug = ? ORDER BY created_at DESC, rowid DESC LIMIT 5`,
    ).all(`${escaped}%`, ref) as Row[];
    if (rows.length > 1) throw new Error(`"${ref}" matches more than one task; use a longer id`);
    return rows[0] ? mapTask(rows[0]) : undefined;
  }

  listTasks(limit = 50): TaskRow[] {
    const rows = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as Row[];
    return rows.map(mapTask);
  }

  updateTask(id: string, patch: TaskPatch): TaskRow {
    const { sql, params } = setClause(patch as Record<string, unknown>, {
      status: { col: 'status' }, plan: { col: 'plan', json: true }, assumptions: { col: 'assumptions', json: true },
      resultPath: { col: 'result_path' }, error: { col: 'error' }, budgetUsd: { col: 'budget_usd' },
    });
    this.db.prepare(`UPDATE tasks SET ${sql ? sql + ', ' : ''}updated_at = ? WHERE id = ?`).run(...params, now(), id);
    const task = this.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    return task;
  }

  /** Add to the task's spend and return the new total. */
  addSpent(id: string, usd: number): number {
    this.db.prepare('UPDATE tasks SET spent_usd = spent_usd + ?, updated_at = ? WHERE id = ?').run(usd, now(), id);
    return (this.db.prepare('SELECT spent_usd FROM tasks WHERE id = ?').get(id) as { spent_usd: number }).spent_usd;
  }

  // ---------------- subtasks ----------------

  createSubtasks(taskId: string, items: NewSubtask[]): SubtaskRow[] {
    return this.transaction(() => {
      const ins = this.db.prepare(
        `INSERT INTO subtasks (id, task_id, key, idx, title, kind, instructions, model, depends_on, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      );
      items.forEach((s, idx) => {
        ins.run(newId('st'), taskId, s.key, idx, s.title, s.kind, s.instructions, s.model ?? null, j(s.dependsOn));
      });
      return this.listSubtasks(taskId);
    });
  }

  getSubtask(id: string): SubtaskRow | undefined {
    const r = this.db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id) as Row | undefined;
    return r ? mapSubtask(r) : undefined;
  }

  listSubtasks(taskId: string): SubtaskRow[] {
    const rows = this.db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY idx').all(taskId) as Row[];
    return rows.map(mapSubtask);
  }

  updateSubtask(id: string, patch: SubtaskPatch): SubtaskRow {
    const { sql, params } = setClause(patch as Record<string, unknown>, {
      status: { col: 'status' }, startedAt: { col: 'started_at' }, finishedAt: { col: 'finished_at' },
      costUsd: { col: 'cost_usd' }, inputTokens: { col: 'input_tokens' }, outputTokens: { col: 'output_tokens' },
      output: { col: 'output', json: true }, error: { col: 'error' }, attempts: { col: 'attempts' },
    });
    if (sql) this.db.prepare(`UPDATE subtasks SET ${sql} WHERE id = ?`).run(...params, id);
    const row = this.getSubtask(id);
    if (!row) throw new Error(`Subtask not found: ${id}`);
    return row;
  }

  deleteSubtasks(taskId: string): void {
    this.db.prepare('DELETE FROM subtasks WHERE task_id = ?').run(taskId);
  }

  // ---------------- events (append-only) ----------------

  appendEvent(taskId: string, type: string, data: unknown = null, subtaskId: string | null = null): EventRow {
    const ts = now();
    const r = this.db.prepare('INSERT INTO events (task_id, subtask_id, ts, type, data) VALUES (?, ?, ?, ?, ?)')
      .run(taskId, subtaskId, ts, type, j(data));
    return { id: Number(r.lastInsertRowid), taskId, subtaskId, ts, type, data: data ?? null };
  }

  listEvents(taskId: string, afterId = 0, limit = 5000): EventRow[] {
    const rows = this.db.prepare('SELECT * FROM events WHERE task_id = ? AND id > ? ORDER BY id LIMIT ?')
      .all(taskId, afterId, limit) as Row[];
    return rows.map(mapEvent);
  }

  // ---------------- approvals ----------------

  createApproval(taskId: string, action: string, detail: unknown = null): ApprovalRow {
    const id = newId('appr');
    this.db.prepare(`INSERT INTO approvals (id, task_id, action, detail, status, requested_at) VALUES (?, ?, ?, ?, 'pending', ?)`)
      .run(id, taskId, action, j(detail), now());
    return this.getApproval(id)!;
  }

  getApproval(id: string): ApprovalRow | undefined {
    const r = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Row | undefined;
    return r ? mapApproval(r) : undefined;
  }

  listApprovals(taskId?: string, status?: ApprovalStatus): ApprovalRow[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (taskId) { where.push('task_id = ?'); params.push(taskId); }
    if (status) { where.push('status = ?'); params.push(status); }
    const rows = this.db.prepare(`SELECT * FROM approvals ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY requested_at`)
      .all(...params) as Row[];
    return rows.map(mapApproval);
  }

  /** Decide a pending approval. Returns undefined if it was already decided (decisions are final). */
  decideApproval(id: string, status: 'approved' | 'denied', decidedBy: string): ApprovalRow | undefined {
    const r = this.db.prepare(`UPDATE approvals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'`)
      .run(status, now(), decidedBy, id);
    return r.changes > 0 ? this.getApproval(id) : undefined;
  }
}
