import { join } from 'node:path';
import type { ModelProvider } from '../agents/provider.js';
import type { VeritasConfig } from '../cli/types.js';
import { Budget } from '../cost/budget.js';
import { Policy } from '../policy/policy.js';
import { ensureDir, writeFileAtomic } from '../shared/fs.js';
import { slugify } from '../shared/ids.js';
import type { ApprovalRow, SubtaskRow, TaskRow } from '../storage/models.js';
import { TERMINAL_TASK_STATUSES } from '../storage/models.js';
import { taskDir } from '../storage/paths.js';
import type { Store } from '../storage/store.js';
import { EventLog } from './event-log.js';
import { planGoal } from './planner.js';
import { runSubtasks } from './scheduler.js';

/** What the person at the keyboard decided. `defer` means "ask me later" (`veritas approve`). */
export type Decision = 'approved' | 'denied' | 'defer';
export type Approver = (request: { approval: ApprovalRow; task: TaskRow }) => Promise<Decision>;

export interface EngineOptions {
  store: Store;
  provider: ModelProvider;
  config: VeritasConfig;
  policy?: Policy;
  events?: EventLog;
  /** Delay before retrying a failed agent (tests set 0). */
  retryDelayMs?: number;
}

export interface ExecuteOptions {
  signal?: AbortSignal;
  /** Asked whenever the policy says a person must decide. Without one, every question is deferred. */
  approver?: Approver;
}

export interface NewTaskOptions {
  budgetUsd?: number;
  cwd?: string;
}

export type ExecuteResult = { task: TaskRow; resultPath?: string };

const HUMAN = 'user';

export class Engine {
  readonly store: Store;
  readonly events: EventLog;
  private readonly provider: ModelProvider;
  private readonly config: VeritasConfig;
  private readonly policy: Policy;
  private readonly retryDelayMs?: number;

  constructor(opts: EngineOptions) {
    this.store = opts.store;
    this.provider = opts.provider;
    this.config = opts.config;
    this.policy = opts.policy ?? new Policy();
    this.events = opts.events ?? new EventLog(opts.store);
    this.retryDelayMs = opts.retryDelayMs;
  }

  createTask(goal: string, opts: NewTaskOptions = {}): TaskRow {
    const text = goal.trim();
    if (!text) throw new Error('The goal is empty.');
    const task = this.store.createTask({
      slug: slugify(text), goal: text, type: 'general', mode: this.provider.id,
      budgetUsd: opts.budgetUsd ?? this.config.defaultBudgetUsd, cwd: opts.cwd ?? process.cwd(),
    });
    this.events.emit(task.id, 'task.created', { goal: text, budgetUsd: task.budgetUsd });
    return task;
  }

  /** Record a decision made by the person. This is the only way an approval is decided; agents have no path to it. */
  decide(approvalId: string, decision: 'approved' | 'denied'): ApprovalRow {
    const row = this.store.decideApproval(approvalId, decision, HUMAN);
    if (!row) throw new Error('That approval was already decided or does not exist.');
    this.events.emit(row.taskId, `approval.${decision}`, { action: row.action, id: row.id });
    return row;
  }

  /** Stop a task for good. */
  cancel(taskId: string): TaskRow {
    const task = this.require(taskId);
    if (TERMINAL_TASK_STATUSES.includes(task.status)) return task;
    const updated = this.store.updateTask(task.id, { status: 'cancelled' });
    this.events.emit(task.id, 'task.cancelled');
    return updated;
  }

  /** Plan, get approval, run, and write the result. Safe to call again on a paused or waiting task. */
  async execute(taskId: string, opts: ExecuteOptions = {}): Promise<ExecuteResult> {
    let task = this.require(taskId);
    if (TERMINAL_TASK_STATUSES.includes(task.status)) return { task };
    const { signal } = opts;

    const needsPlan = task.status === 'draft' || task.status === 'clarifying'
      || (task.status === 'paused' && this.store.listSubtasks(task.id).length === 0);
    if (needsPlan) {
      task = await this.plan(task, signal);
      if (task.status === 'failed' || task.status === 'paused') return { task };
    }

    if (task.status === 'planned' || task.status === 'awaiting_approval') {
      const gate = await this.gate(task, 'plan.start', {
        estimateUsd: task.plan?.estimateUsd, estimateBasis: task.plan?.estimateBasis, budgetUsd: task.budgetUsd,
        tasks: task.plan?.subtasks.length,
      }, opts);
      task = this.require(task.id);
      if (gate === 'denied') {
        this.events.emit(task.id, 'task.cancelled', { reason: 'plan not approved' });
        return { task: this.store.updateTask(task.id, { status: 'cancelled' }) };
      }
      if (gate === 'defer') return { task: this.store.updateTask(task.id, { status: 'awaiting_approval' }) };
    }

    return this.run(this.require(task.id), opts);
  }

  // ------------------------------------------------------------------

  private async plan(task: TaskRow, signal?: AbortSignal): Promise<TaskRow> {
    this.events.emit(task.id, 'plan.started');
    const outcome = await planGoal(task.goal, {
      provider: this.provider, config: this.config, cwd: task.cwd, signal,
      history: this.store.averageSubtaskCostByModel(),
    });
    if (outcome.costUsd > 0) this.store.addSpent(task.id, outcome.costUsd);
    if (!outcome.ok) {
      if (signal?.aborted) {
        this.events.emit(task.id, 'task.interrupted');
        return this.store.updateTask(task.id, { status: 'paused' });
      }
      this.events.emit(task.id, 'plan.failed', { error: outcome.error });
      return this.store.updateTask(task.id, { status: 'failed', error: outcome.error });
    }
    const { plan } = outcome;
    this.store.transaction(() => {
      this.store.deleteSubtasks(task.id);
      this.store.createSubtasks(task.id, plan.subtasks);
      this.store.updateTask(task.id, { status: 'planned', plan, assumptions: plan.assumptions });
    });
    this.events.emit(task.id, 'plan.created', {
      tasks: plan.subtasks.length, estimateUsd: plan.estimateUsd, estimateBasis: plan.estimateBasis, costUsd: outcome.costUsd,
    });
    return this.require(task.id);
  }

  /**
   * Apply the policy to an action. Returns whether it may go ahead.
   * "ask" rules need a person: an earlier decision is reused, otherwise the approver is asked.
   */
  private async gate(task: TaskRow, action: string, detail: unknown, opts: ExecuteOptions): Promise<Decision> {
    const verdict = this.policy.evaluate(action);
    if (verdict.decision === 'allow') return 'approved';
    if (verdict.decision === 'deny') {
      this.events.emit(task.id, 'policy.denied', { action, reason: verdict.reason });
      return 'denied';
    }
    const existing = this.store.listApprovals(task.id).filter((a) => a.action === action);
    const latest = existing[existing.length - 1];
    if (latest?.status === 'approved' && !isConsumed(action)) return 'approved';
    if (latest?.status === 'denied' && !isConsumed(action)) return 'denied';
    let approval = latest?.status === 'pending' ? latest : undefined;
    if (!approval) {
      approval = this.store.createApproval(task.id, action, detail);
      this.events.emit(task.id, 'approval.requested', { action, id: approval.id, detail });
    }
    if (!opts.approver) return 'defer';
    const answer = await opts.approver({ approval, task });
    if (answer === 'defer') return 'defer';
    this.decide(approval.id, answer);
    return answer;
  }

  private async run(task: TaskRow, opts: ExecuteOptions): Promise<ExecuteResult> {
    const { signal } = opts;
    // A raise of the limit the person approved earlier takes effect now.
    let limit = task.budgetUsd;
    for (const a of this.store.listApprovals(task.id)) {
      const raised = (a.detail as { newLimitUsd?: number } | null)?.newLimitUsd;
      if (a.action === 'budget.exceed' && a.status === 'approved' && typeof raised === 'number' && raised > limit) limit = raised;
    }
    if (limit !== task.budgetUsd) task = this.store.updateTask(task.id, { budgetUsd: limit });

    while (true) {
      const fresh = this.require(task.id);
      this.store.updateTask(task.id, { status: 'running' });
      this.events.emit(task.id, 'task.running');
      const budget = new Budget(fresh.budgetUsd, fresh.spentUsd);
      const outcome = await runSubtasks({
        store: this.store, events: this.events, provider: this.provider, budget, config: this.config,
        task: fresh, signal, retryDelayMs: this.retryDelayMs,
      });

      if (outcome.status === 'cancelled') {
        this.events.emit(task.id, 'task.interrupted');
        return { task: this.store.updateTask(task.id, { status: 'paused' }) };
      }
      if (outcome.status === 'failed') {
        this.events.emit(task.id, 'task.failed', { error: outcome.reason });
        return { task: this.store.updateTask(task.id, { status: 'failed', error: outcome.reason }) };
      }
      if (outcome.status === 'paused') {
        const current = this.require(task.id);
        const newLimitUsd = round(current.budgetUsd * 2);
        const gate = await this.gate(current, 'budget.exceed', {
          spentUsd: current.spentUsd, limitUsd: current.budgetUsd, newLimitUsd,
        }, { ...opts, approver: opts.approver });
        if (gate === 'approved') {
          this.store.updateTask(task.id, { budgetUsd: newLimitUsd });
          this.events.emit(task.id, 'budget.raised', { limitUsd: newLimitUsd });
          continue;
        }
        this.events.emit(task.id, 'task.paused', { reason: 'budget' });
        return { task: this.store.updateTask(task.id, { status: 'paused' }) };
      }
      return this.finish(this.require(task.id));
    }
  }

  private finish(task: TaskRow): ExecuteResult {
    const verdict = this.policy.evaluate('task.write_output');
    if (verdict.decision !== 'allow') {
      const error = `Writing the result is not allowed: ${verdict.reason}`;
      return { task: this.store.updateTask(task.id, { status: 'failed', error }) };
    }
    this.store.updateTask(task.id, { status: 'writing' });
    const dir = taskDir(this.config.homeDir, task.id);
    ensureDir(dir);
    const path = join(dir, 'result.md');
    writeFileAtomic(path, composeResult(task, this.store.listSubtasks(task.id)));
    const done = this.store.updateTask(task.id, { status: 'done', resultPath: path });
    this.events.emit(task.id, 'task.done', { resultPath: path, spentUsd: done.spentUsd });
    return { task: done, resultPath: path };
  }

  private require(id: string): TaskRow {
    const task = this.store.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    return task;
  }
}

/** Budget raises are one-time permissions; the plan approval is reusable. */
const isConsumed = (action: string): boolean => action === 'budget.exceed';

const round = (n: number): number => Math.round(n * 100) / 100;

/** The result is what the final tasks produced (tasks nothing else depends on). */
export function composeResult(task: TaskRow, subtasks: readonly SubtaskRow[]): string {
  const used = new Set(subtasks.flatMap((s) => s.dependsOn));
  const sinks = subtasks.filter((s) => !used.has(s.key) && s.status === 'done');
  const text = (s: SubtaskRow): string => (typeof s.output === 'string' ? s.output : JSON.stringify(s.output ?? ''));
  const body = sinks.length === 1
    ? text(sinks[0]!)
    : sinks.map((s) => `## ${s.title}\n\n${text(s)}`).join('\n\n');
  return `# ${task.goal}\n\n${body.trim()}\n`;
}
