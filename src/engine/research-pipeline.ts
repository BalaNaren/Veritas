import { join } from 'node:path';
import type { ModelProvider } from '../agents/provider.js';
import type { VeritasConfig } from '../cli/types.js';
import { Budget } from '../cost/budget.js';
import { EvidenceStore } from '../evidence/evidence-store.js';
import { ingestFindings, type Fetcher } from '../research/ingest.js';
import { ensureDir, writeFileAtomic } from '../shared/fs.js';
import type { TaskRow } from '../storage/models.js';
import { taskDir } from '../storage/paths.js';
import type { Store } from '../storage/store.js';
import { AgentChecker, type Checker } from '../verify/checker.js';
import { summarize, verifyClaims } from '../verify/verifier.js';
import { renderMarkdown } from '../write/render.js';
import { writeReport } from '../write/writer.js';
import type { EventLog } from './event-log.js';

export interface PipelineDeps {
  store: Store;
  events: EventLog;
  provider: ModelProvider;
  config: VeritasConfig;
  fetcher: Fetcher;
  /** Replaces the AI checker (tests). */
  checker?: Checker;
}

export type PipelineOutcome =
  | { status: 'done'; resultPath: string }
  | { status: 'failed'; error: string }
  | { status: 'interrupted' };

/** Wraps the checker so each judgment is charged to the task as it happens. */
function charged(inner: Checker, store: Store, taskId: string, budget: Budget): Checker {
  const pay = (usd: number): void => { if (usd > 0) { store.addSpent(taskId, usd); budget.record(usd); } };
  return {
    async support(i) { const r = await inner.support(i); pay(r.costUsd); return r; },
    async crossCheck(i) { const r = await inner.crossCheck(i); pay(r.costUsd); return r; },
  };
}

/**
 * After the research agents finish: fetch and store every cited page, verify
 * every claim, write the report from what survived, and save it.
 */
export async function finishResearch(d: PipelineDeps, task: TaskRow, signal?: AbortSignal): Promise<PipelineOutcome> {
  const { store, events } = d;
  const evidence = new EvidenceStore(store, d.config.homeDir);
  const interrupted = (): PipelineOutcome => ({ status: 'interrupted' });

  store.updateTask(task.id, { status: 'verifying' });
  events.emit(task.id, 'verify.started');

  // 1. Collect the evidence ourselves.
  const already = new Set(events.history(task.id).filter((e) => e.type === 'evidence.ingested').map((e) => e.subtaskId));
  for (const sub of store.listSubtasks(task.id)) {
    if (sub.status !== 'done' || sub.kind !== 'research' || already.has(sub.id)) continue;
    try {
      await ingestFindings({ evidence, fetcher: d.fetcher, events, taskId: task.id, subtask: sub, signal, concurrency: d.config.maxConcurrent });
    } catch (e) {
      if (signal?.aborted) return interrupted();
      return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  // 2. Check every claim.
  const fresh = store.getTask(task.id)!;
  const budget = new Budget(fresh.budgetUsd, fresh.spentUsd);
  const checker = charged(d.checker ?? new AgentChecker({ provider: d.provider, config: d.config, cwd: task.cwd, signal }), store, task.id, budget);
  await verifyClaims({
    evidence, checker, taskId: task.id, concurrency: d.config.maxConcurrent, signal,
    shouldStop: () => budget.exhausted,
    onClaim: (c) => events.emit(task.id, 'claim.verified', { seq: c.seq, status: c.status, reason: c.reason }),
  });
  if (signal?.aborted) return interrupted();
  const summary = summarize(evidence, task.id);
  events.emit(task.id, 'verify.done', { confirmed: summary.confirmed, flagged: summary.flagged, removed: summary.removed, notChecked: summary.notChecked });

  // 3. Write from what survived.
  store.updateTask(task.id, { status: 'writing' });
  const claims = evidence.listClaims(task.id);
  const usable = claims.filter((c) => c.status === 'confirmed' || c.status === 'flagged');
  const notes: string[] = [];
  if (summary.notChecked) notes.push(`${summary.notChecked} claim(s) were not checked because the budget was reached. They are left out of the report.`);

  let body = '';
  let analysisSentences = 0;
  let removedSentences: string[] = [];
  if (usable.length) {
    const written = await writeReport({ provider: d.provider, config: d.config, cwd: task.cwd, goal: task.goal, assumptions: task.assumptions, claims: usable, signal });
    if (written.costUsd > 0) store.addSpent(task.id, written.costUsd);
    if (!written.ok) return signal?.aborted ? interrupted() : { status: 'failed', error: written.error };
    ({ body, analysisSentences, removedSentences } = written);
  } else {
    body = 'No claim survived checking, so there is nothing sourced to report. See the verification summary below for what was found and why it was not accepted.';
  }

  // 4. Save.
  const markdown = renderMarkdown({
    goal: task.goal, assumptions: task.assumptions, body, claims, sources: evidence.listSources(task.id),
    summary, analysisSentences, removedSentences, notes,
  });
  const dir = taskDir(d.config.homeDir, task.id);
  ensureDir(dir);
  const resultPath = join(dir, 'result.md');
  writeFileAtomic(resultPath, markdown);
  return { status: 'done', resultPath };
}
