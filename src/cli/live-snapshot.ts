import { TestRunStore } from '../coding/test-runs.js';
import { EvidenceStore } from '../evidence/evidence-store.js';
import type { EventRow } from '../storage/models.js';
import type { Store } from '../storage/store.js';
import type { LiveSnapshot } from './live.js';
import { describeEvent } from './progress.js';
import { OutputFormatter } from './output.js';

const plain = new OutputFormatter({ color: false });

/** Reads the live view's numbers from the database, and keeps small counters from the event stream. */
export class SnapshotSource {
  private fetched = 0;
  private failed = 0;
  private last?: string;
  private note?: string;
  private readonly evidence: EvidenceStore;
  private readonly tests: TestRunStore;

  constructor(private readonly store: Store, homeDir: string, private readonly taskId: string) {
    this.evidence = new EvidenceStore(store, homeDir);
    this.tests = new TestRunStore(store);
    for (const e of store.listEvents(taskId)) this.count(e);
  }

  private count(e: EventRow): void {
    if (e.type === 'source.fetched' || e.type === 'file.read') this.fetched++;
    if (e.type === 'source.failed') this.failed++;
  }

  /** Feed one event. Returns nothing; call `snapshot()` to read the result. */
  onEvent(e: EventRow): void {
    this.count(e);
    const line = describeEvent(plain, e, false);
    if (line !== null && e.type !== 'cost.updated') this.last = line.trim();
  }

  /** A message shown in place of the last event (for example "Stopping..."). */
  setNote(text: string | undefined): void { this.note = text; }

  snapshot = (): LiveSnapshot => {
    const task = this.store.getTask(this.taskId)!;
    const claims = this.evidence.listClaims(this.taskId);
    const count = (s: string): number => claims.filter((c) => c.status === s).length;
    return {
      taskId: task.id, goal: task.goal, status: task.status, budgetUsd: task.budgetUsd, spentUsd: task.spentUsd,
      subtasks: this.store.listSubtasks(this.taskId).map((s) => ({ key: s.key, title: s.title, status: s.status, costUsd: s.costUsd, model: s.model, attempts: s.attempts })),
      claims: claims.length ? { confirmed: count('confirmed'), flagged: count('flagged'), removed: count('removed'), pending: count('pending') } : null,
      sources: { fetched: this.fetched, failed: this.failed },
      tests: this.tests.list(this.taskId).filter((t) => t.phase !== 'setup').map((t) => ({ phase: t.phase === 'baseline' ? 'before' : t.phase.replace('round', 'round '), passed: t.passed })),
      last: this.note ?? this.last,
    };
  };
}
