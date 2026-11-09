import { newId } from '../shared/ids.js';
import type { Store } from '../storage/store.js';

type Row = Record<string, unknown>;

export type MemoryKind = 'source' | 'preference';

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  text: string;
  /** What makes it a repeat (a source's address, or the wording of a preference). */
  key: string;
  taskId: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  uses: number;
}

const MAX_TEXT = 600;
const mapItem = (r: Row): MemoryItem => ({
  id: r.id as string, kind: r.kind as MemoryKind, text: r.text as string, key: r.key as string, taskId: (r.task_id as string | null) ?? null,
  createdAt: r.created_at as string, lastUsedAt: (r.last_used_at as string | null) ?? null, uses: r.uses as number,
});

/** Turn free text into a safe full-text query: each word quoted, any of them may match. */
export function toFtsQuery(text: string): string | null {
  const words = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 12);
  return words.length ? words.map((w) => `"${w}"`).join(' OR ') : null;
}

/** What Veritas remembers between tasks. It lives only in the local database and can be listed, searched and erased. */
export class MemoryStore {
  constructor(private readonly store: Store) {}

  /** Remember something. The same kind and key is kept once. Returns false when it was already known. */
  add(kind: MemoryKind, text: string, key: string, taskId?: string): boolean {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    if (!clean) return false;
    const r = this.store.db.prepare('INSERT OR IGNORE INTO memory (id, kind, text, key, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId('mem'), kind, clean, key.slice(0, 500), taskId ?? null, new Date().toISOString());
    return r.changes > 0;
  }

  list(kind?: MemoryKind, limit = 200): MemoryItem[] {
    const rows = kind
      ? this.store.db.prepare('SELECT * FROM memory WHERE kind = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(kind, limit)
      : this.store.db.prepare('SELECT * FROM memory ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit);
    return (rows as Row[]).map(mapItem);
  }

  /** The best matches for some text, most relevant first. */
  search(text: string, opts: { kind?: MemoryKind; limit?: number } = {}): MemoryItem[] {
    const q = toFtsQuery(text);
    if (!q) return [];
    const limit = opts.limit ?? 10;
    const sql = `SELECT m.* FROM memory_fts f JOIN memory m ON m.rowid = f.rowid WHERE memory_fts MATCH ? ${opts.kind ? 'AND m.kind = ?' : ''} ORDER BY bm25(memory_fts) LIMIT ?`;
    const params = opts.kind ? [q, opts.kind, limit] : [q, limit];
    return (this.store.db.prepare(sql).all(...params) as Row[]).map(mapItem);
  }

  /** Note that items were used, so `list` can show what is actually helping. */
  markUsed(ids: readonly string[]): void {
    const stmt = this.store.db.prepare('UPDATE memory SET uses = uses + 1, last_used_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    for (const id of ids) stmt.run(now, id);
  }

  forget(id: string): boolean {
    return this.store.db.prepare('DELETE FROM memory WHERE id = ?').run(id).changes > 0;
  }

  /** Erase everything remembered. Returns how many items were removed. */
  clear(kind?: MemoryKind): number {
    const r = kind ? this.store.db.prepare('DELETE FROM memory WHERE kind = ?').run(kind) : this.store.db.prepare('DELETE FROM memory').run();
    return Number(r.changes);
  }

  count(): number {
    return Number((this.store.db.prepare('SELECT COUNT(*) AS n FROM memory').get() as Row).n);
  }
}
