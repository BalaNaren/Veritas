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
import { answersToStatements, clarifyGoal, type ClarifyQuestion } from '../clarify/clarifier.js';
import { planGoal } from './planner.js';
import { basename } from 'node:path';
import { DocumentError } from '../documents/types.js';
import { readDocument } from '../documents/readers.js';
import { EvidenceStore, fileUrl } from '../evidence/evidence-store.js';
import { chooseSandbox } from '../sandbox/index.js';
import type { Sandbox } from '../sandbox/types.js';
import { CodingSupport, type ApplyOptions, type ApplyResult } from '../coding/support.js';
import { RepoError } from '../coding/repo.js';
import { MemoryStore } from '../memory/memory-store.js';
import { estimatePlanCost } from '../cost/estimate.js';
import { runSubtasks } from './scheduler.js';
import { finishResearch } from './research-pipeline.js';
import { fetchUrl } from '../tools/web-fetch.js';
import type { Fetcher } from '../research/ingest.js';
import type { Checker } from '../verify/checker.js';

/** What the person at the keyboard decided. `defer` means "ask me later" (`veritas approve`). */
export type Decision = 'approved' | 'denied' | 'defer';
export type Approver = (request: { approval: ApprovalRow; task: TaskRow }) => Promise<Decision>;

export interface EngineOptions {
  store: Store;
  provider: ModelProvider;
  config: VeritasConfig;
  policy?: Policy;
  events?: EventLog;
  /** Fetches pages cited by research agents. Defaults to the strict public-internet fetcher. */
  fetcher?: Fetcher;
  /** Replaces the AI checker (tests). */
  checker?: Checker;
  /** Where analysis code runs. Defaults to the best sandbox this machine has; if none, data analysis is not offered. */
  sandbox?: Sandbox | (() => Promise<Sandbox | undefined>);
  /** Delay before retrying a failed agent (tests set 0). */
  retryDelayMs?: number;
}

/** Whether to ask the person questions about the goal before planning. */
export interface ClarifyOptions {
  /** `off`: no questions; `defaults`: ask the model but use its default answers; `ask`: put the questions to the person. */
  mode: 'off' | 'defaults' | 'ask';
  /** Returns the person's answers by question id, or null to use the defaults. */
  ask?: (questions: ClarifyQuestion[]) => Promise<Record<string, string> | null>;
}

export interface ExecuteOptions {
  clarify?: ClarifyOptions;
  signal?: AbortSignal;
  /** Asked whenever the policy says a person must decide. Without one, every question is deferred. */
  approver?: Approver;
}

export interface NewTaskOptions {
  budgetUsd?: number;
  cwd?: string;
  /** Absolute paths of files the task should work on. */
  files?: string[];
}

export type ExecuteResult = { task: TaskRow; resultPath?: string };

const HUMAN = 'user';

/** Task types whose results go through evidence collection, verification and writing. */
const EVIDENCE_TASK_TYPES = ['research', 'documents', 'data', 'mixed'];

function taskTypeFor(kinds: readonly string[]): string {
  const evidence = [...new Set(kinds.filter((k) => k === 'research' || k === 'document' || k === 'data'))];
  if (evidence.length > 1) return 'mixed';
  return evidence[0] === 'document' ? 'documents' : evidence[0] ?? 'general';
}

export class Engine {
  readonly store: Store;
  readonly events: EventLog;
  private readonly provider: ModelProvider;
  private readonly config: VeritasConfig;
  private readonly policy: Policy;
  private readonly retryDelayMs?: number;
  private readonly fetcher: Fetcher;
  private readonly checker?: Checker;
  private readonly sandboxOption?: Sandbox | (() => Promise<Sandbox | undefined>);
  private sandboxCache?: Promise<Sandbox | undefined>;
  private readonly coding: CodingSupport;

  constructor(opts: EngineOptions) {
    this.store = opts.store;
    this.provider = opts.provider;
    this.config = opts.config;
    this.policy = opts.policy ?? new Policy();
    this.events = opts.events ?? new EventLog(opts.store);
    this.retryDelayMs = opts.retryDelayMs;
    this.fetcher = opts.fetcher ?? fetchUrl;
    this.checker = opts.checker;
    this.sandboxOption = opts.sandbox;
    this.coding = new CodingSupport({ store: this.store, events: this.events, homeDir: this.config.homeDir });
  }

  createTask(goal: string, opts: NewTaskOptions = {}): TaskRow {
    const text = goal.trim();
    if (!text) throw new Error('The goal is empty.');
    const task = this.store.createTask({
      slug: slugify(text), goal: text, type: 'general', mode: this.provider.id,
      budgetUsd: opts.budgetUsd ?? this.config.defaultBudgetUsd, cwd: opts.cwd ?? process.cwd(), inputs: opts.files ?? [],
    });
    this.events.emit(task.id, 'task.created', { goal: text, budgetUsd: task.budgetUsd });
    return task;
  }

  /**
   * Start a coding task on a git repository. Nothing in the repository is changed: the work happens in a separate
   * working copy made when the task runs. Throws `RepoError` or `CommandError` with a plain explanation.
   */
  async createCodingTask(goal: string, opts: NewTaskOptions & { repo: string; testCommand?: string; setupCommand?: string }): Promise<TaskRow> {
    const text = goal.trim();
    if (!text) throw new Error('The goal is empty.');
    const { info, dirty } = await this.coding.inspect(opts.repo, { testCommand: opts.testCommand, setupCommand: opts.setupCommand });
    const task = this.store.createTask({
      slug: slugify(text), goal: text, type: 'coding', mode: this.provider.id, budgetUsd: opts.budgetUsd ?? this.config.defaultBudgetUsd,
      cwd: opts.cwd ?? process.cwd(), coding: info,
    });
    if (dirty.length) this.store.updateTask(task.id, { assumptions: [`The work starts from the last commit on "${info.baseBranch}". Your ${dirty.length} uncommitted change(s) are not included.`] });
    this.events.emit(task.id, 'task.created', { goal: text, budgetUsd: task.budgetUsd, repo: info.repo, testCommand: info.testCommand });
    return this.require(task.id);
  }

  /** Save a finished coding task's work as a commit and, if asked, merge it or open a pull request. Each step asks first. */
  async apply(taskId: string, o: ApplyOptions, approver?: Approver): Promise<ApplyResult> {
    const task = this.require(taskId);
    if (!task.coding) return { state: 'blocked', reason: 'This is not a coding task.' };
    if (task.status !== 'done') return { state: 'blocked', reason: `This task is not finished yet (status: ${task.status}).` };
    return this.coding.apply(task, o, (action, detail) => this.gateOnce(task, action, detail, { approver }));
  }

  /** Throw away a coding task's working copy. The branch is kept if it holds a saved commit, unless `force`. */
  async discard(taskId: string, force = false): Promise<{ keptBranch: string | null }> {
    const task = this.require(taskId);
    if (!task.coding?.worktree) return { keptBranch: null };
    const saved = await this.coding.hasSavedWork(task);
    await this.coding.discard(task, force || !saved);
    return { keptBranch: !force && saved ? task.coding.branch : null };
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

    // A coding task's plan is always one step, so no planner is needed.
    const needsPlan = task.status === 'draft' || task.status === 'clarifying'
      || (task.status === 'paused' && this.store.listSubtasks(task.id).length === 0);
    if (needsPlan) {
      const prepared = await this.prepareFiles(task);
      if (prepared) return { task: prepared };
      if (opts.clarify && opts.clarify.mode !== 'off') {
        task = await this.clarify(task, opts.clarify, signal);
        if (task.status === 'paused') return { task };
      }
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

    const ready = this.require(task.id);
    if (ready.coding) {
      const prep = await this.coding.prepare(ready, (action, detail) => this.gateOnce(ready, action, detail, opts), signal);
      if (prep.state === 'denied') { this.events.emit(ready.id, 'task.cancelled', { reason: 'command not approved' }); return { task: this.store.updateTask(ready.id, { status: 'cancelled' }) }; }
      if (prep.state === 'defer') return { task: this.store.updateTask(ready.id, { status: 'awaiting_approval' }) };
      if (prep.state === 'failed') return { task: prep.task };
    }
    return this.run(this.require(task.id), opts);
  }

  // ------------------------------------------------------------------

  private getSandbox(): Promise<Sandbox | undefined> {
    return (this.sandboxCache ??= (async () => {
      const o = this.sandboxOption;
      if (o) return typeof o === 'function' ? o() : o;
      return (await chooseSandbox(this.config.homeDir)).sandbox;
    })());
  }

  private rememberedPreferences(goal: string): string[] {
    if (!this.config.memoryEnabled) return [];
    const mem = new MemoryStore(this.store);
    const found = mem.search(goal, { kind: 'preference', limit: 5 });
    mem.markUsed(found.map((m) => m.id));
    return found.map((m) => m.text);
  }

  /** Remembered preferences and sources that look relevant to this goal. */
  private memoryHints(goal: string): string[] {
    if (!this.config.memoryEnabled) return [];
    const mem = new MemoryStore(this.store);
    const found = [...mem.search(goal, { kind: 'preference', limit: 4 }), ...mem.search(goal, { kind: 'source', limit: 5 })];
    mem.markUsed(found.map((m) => m.id));
    return found.map((m) => (m.kind === 'preference' ? `Preference: ${m.text}` : `Source used before: ${m.text}`));
  }

  /** After a report is finished, remember the sources that backed its confirmed claims. */
  private rememberSources(task: TaskRow): void {
    if (!this.config.memoryEnabled) return;
    const evidence = new EvidenceStore(this.store, this.config.homeDir);
    const mem = new MemoryStore(this.store);
    const topic = task.goal.replace(/\s+/g, ' ').slice(0, 100);
    const ids = new Set(evidence.listClaims(task.id, 'confirmed').map((c) => c.sourceId).filter((x): x is string => !!x));
    let added = 0;
    for (const id of ids) {
      const s = evidence.getSource(id);
      if (!s || s.kind !== 'web' || added >= 10) continue;
      if (mem.add('source', `${s.title ?? s.finalUrl} — ${s.finalUrl} (${s.quality}; used for: ${topic})`, s.finalUrl, task.id)) added++;
    }
  }

  /** Read the user's files once, store their text, and make them citable. Returns the failed task if one cannot be read. */
  private async prepareFiles(task: TaskRow): Promise<TaskRow | undefined> {
    if (!task.inputs.length) return undefined;
    const evidence = new EvidenceStore(this.store, this.config.homeDir);
    for (const path of task.inputs) {
      const name = basename(path);
      if (evidence.findSource(task.id, fileUrl(name))) continue;
      try {
        const doc = await readDocument(path, name);
        const source = evidence.addFileSource(task.id, doc);
        this.events.emit(task.id, 'file.read', { name, kind: doc.kind, parts: doc.units.length, sourceId: source.id });
      } catch (e) {
        const error = e instanceof DocumentError ? e.message : `${name}: ${e instanceof Error ? e.message : String(e)}`;
        this.events.emit(task.id, 'task.failed', { error });
        return this.store.updateTask(task.id, { status: 'failed', error });
      }
    }
    return undefined;
  }

  private async clarify(task: TaskRow, options: ClarifyOptions, signal?: AbortSignal): Promise<TaskRow> {
    const done = this.store.listEvents(task.id).some((e) => e.type === 'clarify.answered' || e.type === 'clarify.skipped');
    if (done) return task;
    this.store.updateTask(task.id, { status: 'clarifying' });
    this.events.emit(task.id, 'clarify.started');
    const known = this.rememberedPreferences(task.goal);
    const outcome = await clarifyGoal(task.goal, { provider: this.provider, config: this.config, cwd: task.cwd, signal, known });
    if (outcome.costUsd > 0) this.store.addSpent(task.id, outcome.costUsd);
    if (!outcome.ok) {
      if (signal?.aborted) {
        this.events.emit(task.id, 'task.interrupted');
        return this.store.updateTask(task.id, { status: 'paused' });
      }
      // Questions are a convenience; not being able to ask must not block the work.
      this.events.emit(task.id, 'clarify.skipped', { error: outcome.error });
      return this.store.updateTask(task.id, { status: 'draft' });
    }
    const { questions, assumptions } = outcome.result;
    let answers: Record<string, string> = {};
    let usedDefaults = true;
    if (questions.length) {
      this.events.emit(task.id, 'clarify.asked', { questions });
      if (options.mode === 'ask' && options.ask) {
        const given = await options.ask(questions);
        if (given) { answers = given; usedDefaults = false; }
      }
    }
    const statements = answersToStatements(questions, answers);
    if (!usedDefaults && this.config.memoryEnabled) {
      // Only what the person actually answered is remembered, never a default the model suggested.
      const mem = new MemoryStore(this.store);
      for (const q of questions) if (answers[q.id]?.trim()) mem.add('preference', `${q.text} ${answers[q.id]!.trim()} (earlier task: ${task.goal.replace(/\s+/g, ' ').slice(0, 100)})`, `${q.text}|${answers[q.id]!.trim()}`.toLowerCase(), task.id);
    }
    const merged = [...new Set([...task.assumptions, ...statements, ...assumptions])];
    this.events.emit(task.id, 'clarify.answered', { answers, usedDefaults, questions: questions.length });
    return this.store.updateTask(task.id, { status: 'draft', assumptions: merged });
  }

  /** The plan for a coding task: one step. */
  private planCoding(task: TaskRow): TaskRow {
    const subtasks = [{ key: 't1', title: 'Make the change', kind: 'code', instructions: task.goal, dependsOn: [] as string[] }];
    const est = estimatePlanCost(subtasks, this.config.models, this.store.averageSubtaskCostByModel());
    const plan = { subtasks, assumptions: task.assumptions, estimateUsd: { low: est.low, high: est.high * 2 }, estimateBasis: est.basis };
    this.store.transaction(() => {
      this.store.deleteSubtasks(task.id);
      this.store.createSubtasks(task.id, subtasks);
      this.store.updateTask(task.id, { status: 'planned', plan });
    });
    this.events.emit(task.id, 'plan.created', { tasks: 1, estimateUsd: plan.estimateUsd, estimateBasis: plan.estimateBasis, costUsd: 0 });
    return this.require(task.id);
  }

  private async plan(task: TaskRow, signal?: AbortSignal): Promise<TaskRow> {
    if (task.coding) return this.planCoding(task);
    this.events.emit(task.id, 'plan.started');
    const fileSummaries = new EvidenceStore(this.store, this.config.homeDir).listSources(task.id).filter((s) => s.kind === 'file')
      .map((s) => ({ name: s.title ?? s.url, kind: s.contentType ?? 'file', units: s.units?.length ?? 0 }));
    const hasDataFiles = fileSummaries.some((f) => ['csv', 'xlsx', 'json'].includes(f.kind));
    const dataAvailable = hasDataFiles && (await this.getSandbox()) !== undefined;
    if (hasDataFiles && !dataAvailable) {
      this.events.emit(task.id, 'sandbox.unavailable', { message: 'No sandbox is set up, so analysis code will not be run. Run `veritas setup`.' });
      if (!task.assumptions.some((a) => a.startsWith('Calculations were not run'))) {
        task = this.store.updateTask(task.id, { assumptions: [...task.assumptions, 'Calculations were not run: no sandbox is set up (run `veritas setup`), so the data files can be read and quoted but not analysed with code.'] });
      }
    }
    const outcome = await planGoal(task.goal, {
      provider: this.provider, config: this.config, cwd: task.cwd, signal,
      history: this.store.averageSubtaskCostByModel(), decided: task.assumptions,
      files: fileSummaries, dataAvailable, hints: this.memoryHints(task.goal),
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
    const plan = { ...outcome.plan, assumptions: [...new Set([...task.assumptions, ...outcome.plan.assumptions])] };
    this.store.transaction(() => {
      this.store.deleteSubtasks(task.id);
      this.store.createSubtasks(task.id, plan.subtasks);
      this.store.updateTask(task.id, {
        status: 'planned', plan, assumptions: plan.assumptions,
        type: taskTypeFor(plan.subtasks.map((s) => s.kind)),
      });
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

  /**
   * Like `gate`, but each approval is good for one use only. A person's earlier "yes" given through `veritas approve`
   * is used once; a new action needs a new approval. Used for commands, commits, merges and pushes.
   */
  private async gateOnce(task: TaskRow, action: string, detail: unknown, opts: { approver?: Approver }): Promise<Decision> {
    const verdict = this.policy.evaluate(action);
    if (verdict.decision === 'allow') return 'approved';
    if (verdict.decision === 'deny') { this.events.emit(task.id, 'policy.denied', { action, reason: verdict.reason }); return 'denied'; }
    const all = this.store.listApprovals(task.id).filter((a) => a.action === action);
    const used = new Set(this.store.listEvents(task.id).filter((e) => e.type === 'approval.used').map((e) => (e.data as { id: string }).id));
    const spare = all.find((a) => a.status === 'approved' && !used.has(a.id));
    if (spare) { this.events.emit(task.id, 'approval.used', { id: spare.id, action }); return 'approved'; }
    let approval = all.find((a) => a.status === 'pending');
    if (!approval) {
      approval = this.store.createApproval(task.id, action, detail);
      this.events.emit(task.id, 'approval.requested', { action, id: approval.id, detail });
    }
    if (!opts.approver) return 'defer';
    const answer = await opts.approver({ approval, task });
    if (answer === 'defer') return 'defer';
    this.decide(approval.id, answer);
    if (answer === 'approved') this.events.emit(task.id, 'approval.used', { id: approval.id, action });
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
        sandbox: this.store.listSubtasks(task.id).some((s) => s.kind === 'data') ? await this.getSandbox() : undefined,
        coding: fresh.coding?.worktree ? this.coding.services(fresh) : undefined,
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
      const finished = this.require(task.id);
      if (finished.type === 'coding') return this.finishCodingTask(finished);
      if (EVIDENCE_TASK_TYPES.includes(finished.type)) return this.finishResearchTask(finished, signal);
      return this.finish(finished);
    }
  }

  private async finishCodingTask(task: TaskRow): Promise<ExecuteResult> {
    try {
      const sub = this.store.listSubtasks(task.id).find((s) => s.kind === 'code' && s.status === 'done');
      const out = (sub?.output ?? { summary: '', notes: '' }) as { summary: string; notes: string };
      const resultPath = await this.coding.finish(task, out);
      const done = this.store.updateTask(task.id, { status: 'done', resultPath });
      this.events.emit(task.id, 'task.done', { resultPath, spentUsd: done.spentUsd });
      return { task: done, resultPath };
    } catch (e) {
      const error = e instanceof RepoError || e instanceof Error ? e.message : String(e);
      this.events.emit(task.id, 'task.failed', { error });
      return { task: this.store.updateTask(task.id, { status: 'failed', error }) };
    }
  }

  private async finishResearchTask(task: TaskRow, signal?: AbortSignal): Promise<ExecuteResult> {
    const outcome = await finishResearch({
      store: this.store, events: this.events, provider: this.provider, config: this.config, fetcher: this.fetcher, checker: this.checker,
    }, task, signal);
    if (outcome.status === 'interrupted') {
      this.events.emit(task.id, 'task.interrupted');
      return { task: this.store.updateTask(task.id, { status: 'paused' }) };
    }
    if (outcome.status === 'failed') {
      this.events.emit(task.id, 'task.failed', { error: outcome.error });
      return { task: this.store.updateTask(task.id, { status: 'failed', error: outcome.error }) };
    }
    const done = this.store.updateTask(task.id, { status: 'done', resultPath: outcome.resultPath });
    this.rememberSources(done);
    this.events.emit(task.id, 'task.done', { resultPath: outcome.resultPath, spentUsd: done.spentUsd });
    return { task: done, resultPath: outcome.resultPath };
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
  const assumed = task.assumptions.length
    ? `## Assumptions\n\n${task.assumptions.map((a) => `- ${a}`).join('\n')}\n\n`
    : '';
  return `# ${task.goal}\n\n${assumed}${body.trim()}\n`;
}
