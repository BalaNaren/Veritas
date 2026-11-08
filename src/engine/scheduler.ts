import type { AgentRunResult, ModelProvider } from '../agents/provider.js';
import { modelFor } from '../agents/models.js';
import type { VeritasConfig } from '../cli/types.js';
import type { Budget } from '../cost/budget.js';
import type { Store } from '../storage/store.js';
import type { SubtaskRow, TaskRow } from '../storage/models.js';
import type { EventLog } from './event-log.js';
import { getKind } from './kinds.js';
import { tryJsonParse } from '../shared/json.js';
import { goalWithContext, workerPrompt, type DependencyResult } from './prompts.js';

export type RunOutcome =
  | { status: 'done' }
  | { status: 'failed'; reason: string }
  | { status: 'paused'; reason: 'budget' }
  | { status: 'cancelled' };

export interface SchedulerOptions {
  store: Store;
  events: EventLog;
  provider: ModelProvider;
  budget: Budget;
  config: Pick<VeritasConfig, 'models' | 'maxConcurrent' | 'agentTimeoutMs'>;
  task: TaskRow;
  signal?: AbortSignal;
  /** Attempts per task, including the first (default 2). */
  maxAttempts?: number;
  /** Wait before a retry, multiplied by the attempt number (default 1000 ms). */
  retryDelayMs?: number;
}

const NON_RETRYABLE = new Set(['aborted', 'unavailable', 'output_too_large']);
const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done(): void { clearTimeout(t); signal?.removeEventListener('abort', done); resolve(); }
    signal?.addEventListener('abort', done, { once: true });
  });

/**
 * Run every pending task of a task record, respecting dependencies, the
 * concurrency limit and the budget. Safe to call again after a pause or a
 * crash: tasks left "running" go back to "pending" and finished ones are kept.
 */
export async function runSubtasks(opts: SchedulerOptions): Promise<RunOutcome> {
  const { store, events, provider, budget, task, signal } = opts;
  const maxAttempts = opts.maxAttempts ?? 2;
  const retryDelay = opts.retryDelayMs ?? 1000;
  const concurrency = Math.max(1, opts.config.maxConcurrent);

  for (const s of store.listSubtasks(task.id)) {
    if (s.status === 'running') store.updateSubtask(s.id, { status: 'pending', startedAt: null });
  }

  const inFlight = new Map<string, Promise<void>>();
  let budgetBlocked = false;

  const emitCost = (): void => {
    events.emit(task.id, 'cost.updated', { spentUsd: budget.spent, limitUsd: budget.limit });
  };

  async function execute(s: SubtaskRow, cap: number): Promise<void> {
    const kind = getKind(s.kind);
    const model = s.model || modelFor('worker', opts.config.models);
    const byKey = new Map(store.listSubtasks(task.id).map((x) => [x.key, x]));
    const deps: DependencyResult[] = s.dependsOn.map((k) => {
      const d = byKey.get(k)!;
      return { key: d.key, title: d.title, text: typeof d.output === 'string' ? d.output : JSON.stringify(d.output ?? '') };
    });
    const prompt = workerPrompt(goalWithContext(task.goal, task.assumptions), s, deps, kind.guidance);

    store.updateSubtask(s.id, { status: 'running', startedAt: new Date().toISOString(), model });
    events.emit(task.id, 'subtask.started', { key: s.key, title: s.title, model }, s.id);

    let attempt = s.attempts;
    let totalCost = s.costUsd;
    let lastError = 'unknown error';
    let currentCap = cap;
    let lastKind = '';

    while (attempt < maxAttempts) {
      attempt++;
      store.updateSubtask(s.id, { attempts: attempt });
      let res: AgentRunResult = await provider.run({
        prompt, model, cwd: task.cwd, tools: kind.tools, allowedTools: kind.allowedTools, jsonSchema: kind.outputSchema,
        maxBudgetUsd: currentCap, timeoutMs: opts.config.agentTimeoutMs, signal,
      });
      totalCost += res.costUsd;
      store.addSpent(task.id, res.costUsd);
      store.updateSubtask(s.id, { costUsd: totalCost, inputTokens: res.inputTokens, outputTokens: res.outputTokens });
      budget.settle(s.id, res.costUsd);
      emitCost();

      // Structured kinds must return valid JSON; a bad answer counts as a failed attempt so it is retried.
      let output: unknown = res.text;
      if (res.ok && kind.outputSchema) {
        output = res.json ?? tryJsonParse(res.text);
        const problem = kind.validateOutput?.(output) ?? (output === undefined ? 'The agent did not return JSON.' : null);
        if (problem) res = { ...res, ok: false, error: { kind: 'agent_error', message: `Invalid result: ${problem}` } };
      }

      if (res.ok) {
        store.updateSubtask(s.id, { status: 'done', finishedAt: new Date().toISOString(), output, error: null });
        events.emit(task.id, 'subtask.finished', { key: s.key, costUsd: totalCost, attempts: attempt }, s.id);
        return;
      }
      lastError = res.error?.message ?? 'unknown error';
      lastKind = res.error?.kind ?? '';
      if (signal?.aborted || NON_RETRYABLE.has(lastKind) || attempt >= maxAttempts) break;

      // A run that hit its cap may retry once with whatever share is still free.
      const nextCap = budget.allocate(s.id, concurrency);
      if (nextCap === null) { budgetBlocked = true; lastError = `${lastError} (no budget left to retry)`; break; }
      currentCap = nextCap;
      events.emit(task.id, 'subtask.retry', { key: s.key, attempt, error: lastError }, s.id);
      await sleep(retryDelay * attempt, signal);
      if (signal?.aborted) { budget.settle(s.id, 0); break; }
    }

    if (signal?.aborted || lastKind === 'aborted') {
      // Leave it resumable rather than failed.
      store.updateSubtask(s.id, { status: 'pending', startedAt: null, attempts: Math.max(0, attempt - 1) });
      return;
    }
    store.updateSubtask(s.id, { status: 'failed', finishedAt: new Date().toISOString(), error: lastError });
    events.emit(task.id, 'subtask.failed', { key: s.key, error: lastError, attempts: attempt }, s.id);
  }

  while (true) {
    if (signal?.aborted) break;
    const all = store.listSubtasks(task.id);
    const status = new Map(all.map((s) => [s.key, s.status]));

    // Anything downstream of a failure can never run.
    for (const s of all) {
      if (s.status !== 'pending') continue;
      const bad = s.dependsOn.find((d) => ['failed', 'skipped', 'cancelled'].includes(status.get(d) ?? ''));
      if (bad) {
        store.updateSubtask(s.id, { status: 'skipped', error: `Skipped because "${bad}" did not finish.` });
        status.set(s.key, 'skipped');
        events.emit(task.id, 'subtask.skipped', { key: s.key, because: bad }, s.id);
      }
    }

    const ready = store.listSubtasks(task.id).filter(
      (s) => s.status === 'pending' && !inFlight.has(s.id) && s.dependsOn.every((d) => status.get(d) === 'done'),
    );

    let started = false;
    for (const s of ready) {
      if (inFlight.size >= concurrency) break;
      const cap = budget.allocate(s.id, concurrency);
      if (cap === null) {
        if (inFlight.size === 0) {
          events.emit(task.id, 'budget.exceeded', { spentUsd: budget.spent, limitUsd: budget.limit });
          return { status: 'paused', reason: 'budget' };
        }
        break; // wait for a running agent to free its share
      }
      const p = execute(s, cap)
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          budget.settle(s.id, 0);
          store.updateSubtask(s.id, { status: 'failed', finishedAt: new Date().toISOString(), error: message });
          events.emit(task.id, 'subtask.failed', { key: s.key, error: message }, s.id);
        })
        .finally(() => { inFlight.delete(s.id); });
      inFlight.set(s.id, p);
      started = true;
    }

    if (inFlight.size === 0 && !started) break;
    await Promise.race(inFlight.values());
  }

  await Promise.allSettled(inFlight.values());

  if (signal?.aborted) return { status: 'cancelled' };
  const final = store.listSubtasks(task.id);
  const failed = final.filter((s) => s.status === 'failed');
  if (budgetBlocked && failed.length) return { status: 'paused', reason: 'budget' };
  if (failed.length) return { status: 'failed', reason: failed.map((s) => `${s.key}: ${s.error}`).join('; ') };
  if (final.some((s) => s.status !== 'done')) return { status: 'failed', reason: 'Some tasks did not run.' };
  return { status: 'done' };
}
