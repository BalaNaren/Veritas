import type { Store } from '../storage/store.js';
import type { EventRow } from '../storage/models.js';

export type EventListener = (event: EventRow) => void;

/**
 * The append-only record of everything that happens in a task. Every event is
 * stored first and then delivered to live listeners (used for progress display),
 * so what the user sees is always what was recorded.
 */
export class EventLog {
  private listeners = new Set<{ taskId?: string; fn: EventListener }>();

  constructor(private readonly store: Store) {}

  emit(taskId: string, type: string, data: unknown = null, subtaskId: string | null = null): EventRow {
    const event = this.store.appendEvent(taskId, type, data, subtaskId);
    for (const l of [...this.listeners]) {
      if (l.taskId && l.taskId !== taskId) continue;
      try { l.fn(event); } catch { /* a faulty listener must not break the engine */ }
    }
    return event;
  }

  /** Receive events as they are recorded. Returns a function that stops listening. */
  subscribe(fn: EventListener, taskId?: string): () => void {
    const entry = { taskId, fn };
    this.listeners.add(entry);
    return () => { this.listeners.delete(entry); };
  }

  /** Read back recorded events (for `show` and for resuming). */
  history(taskId: string, afterId = 0): EventRow[] {
    return this.store.listEvents(taskId, afterId);
  }
}
