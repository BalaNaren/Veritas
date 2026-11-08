import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, writeFileAtomic } from '../shared/fs.js';
import { newId } from '../shared/ids.js';
import { safeJsonParse } from '../shared/json.js';
import { taskDir } from '../storage/paths.js';
import type { Store } from '../storage/store.js';
import { rateSource, type SourceQuality } from './quality.js';

type Row = Record<string, unknown>;

export interface SourceRow {
  id: string;
  taskId: string;
  /** The address the agent gave. */
  url: string;
  /** The address finally fetched, after redirects. */
  finalUrl: string;
  title: string | null;
  kind: string;
  fetchedAt: string;
  contentType: string | null;
  bytes: number;
  /** Hash of the exact bytes received. */
  sha256: string;
  /** Hash of the stored text snapshot. */
  textSha256: string;
  snapshotPath: string;
  publishedAt: string | null;
  quality: SourceQuality;
  qualityReason: string | null;
}

export type ClaimType = 'fact' | 'number' | 'quote';
export type ClaimStatus = 'pending' | 'confirmed' | 'flagged' | 'removed' | 'analysis';

export interface CheckResult {
  /** `source_exists`, `quote_matches`, `support`, `numbers`, `cross_check`. */
  step: string;
  passed: boolean;
  /** Plain-language explanation shown in the verification summary. */
  detail: string;
}

export interface ClaimRow {
  id: string;
  taskId: string;
  subtaskId: string | null;
  /** Number used in citations: [c<seq>]. */
  seq: number;
  text: string;
  type: ClaimType;
  url: string | null;
  quote: string | null;
  important: boolean;
  sourceId: string | null;
  quoteStart: number | null;
  quoteEnd: number | null;
  status: ClaimStatus;
  checks: CheckResult[];
  reason: string | null;
}

export interface NewSource {
  taskId: string;
  url: string;
  finalUrl: string;
  title?: string | null;
  contentType: string;
  /** Raw bytes length and hash from the fetch. */
  bytes: number;
  sha256: string;
  fetchedAt: string;
  publishedAt?: string | null;
  /** Extracted readable text that quotes will be checked against. */
  text: string;
}

export interface NewClaim {
  taskId: string;
  subtaskId?: string | null;
  text: string;
  type: ClaimType;
  url?: string | null;
  quote?: string | null;
  important?: boolean;
}

export interface ClaimPatch {
  status?: ClaimStatus;
  sourceId?: string | null;
  quoteStart?: number | null;
  quoteEnd?: number | null;
  checks?: CheckResult[];
  reason?: string | null;
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const mapSource = (r: Row): SourceRow => ({
  id: r.id as string, taskId: r.task_id as string, url: r.url as string, finalUrl: r.final_url as string,
  title: (r.title as string | null) ?? null, kind: r.kind as string, fetchedAt: r.fetched_at as string,
  contentType: (r.content_type as string | null) ?? null, bytes: r.bytes as number, sha256: r.sha256 as string,
  textSha256: r.text_sha256 as string, snapshotPath: r.snapshot_path as string, publishedAt: (r.published_at as string | null) ?? null,
  quality: r.quality as SourceQuality, qualityReason: (r.quality_reason as string | null) ?? null,
});

const mapClaim = (r: Row): ClaimRow => ({
  id: r.id as string, taskId: r.task_id as string, subtaskId: (r.subtask_id as string | null) ?? null, seq: r.seq as number,
  text: r.text as string, type: r.type as ClaimType, url: (r.url as string | null) ?? null, quote: (r.quote as string | null) ?? null,
  important: r.important === 1, sourceId: (r.source_id as string | null) ?? null,
  quoteStart: (r.quote_start as number | null) ?? null, quoteEnd: (r.quote_end as number | null) ?? null,
  status: r.status as ClaimStatus, checks: safeJsonParse<CheckResult[]>((r.checks as string) ?? '[]'), reason: (r.reason as string | null) ?? null,
});

/** Sources (with stored text snapshots) and claims for a task. */
export class EvidenceStore {
  constructor(private readonly store: Store, private readonly home: string) {}

  /** Save a fetched page. Fetching the same final address twice in one task returns the first record. */
  addSource(input: NewSource): SourceRow {
    const existing = this.findSource(input.taskId, input.finalUrl);
    if (existing) return existing;
    const id = newId('src');
    const dir = join(taskDir(this.home, input.taskId), 'sources');
    ensureDir(dir);
    const path = join(dir, `${id}.txt`);
    writeFileAtomic(path, input.text);
    const rating = rateSource(input.finalUrl);
    this.store.db.prepare(
      `INSERT INTO sources (id, task_id, url, final_url, title, kind, fetched_at, content_type, bytes, sha256, text_sha256, snapshot_path, published_at, quality, quality_reason)
       VALUES (?, ?, ?, ?, ?, 'web', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.taskId, input.url, input.finalUrl, input.title ?? null, input.fetchedAt, input.contentType, input.bytes, input.sha256,
      sha256(input.text), path, input.publishedAt ?? null, rating.quality, rating.reason);
    return this.getSource(id)!;
  }

  getSource(id: string): SourceRow | undefined {
    const r = this.store.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as Row | undefined;
    return r ? mapSource(r) : undefined;
  }

  /** Find a source of this task by the address given or the address finally reached. */
  findSource(taskId: string, url: string): SourceRow | undefined {
    const r = this.store.db.prepare('SELECT * FROM sources WHERE task_id = ? AND (final_url = ? OR url = ?) ORDER BY fetched_at LIMIT 1').get(taskId, url, url) as Row | undefined;
    return r ? mapSource(r) : undefined;
  }

  listSources(taskId: string): SourceRow[] {
    return (this.store.db.prepare('SELECT * FROM sources WHERE task_id = ? ORDER BY fetched_at, rowid').all(taskId) as Row[]).map(mapSource);
  }

  /** Read a snapshot back, refusing it if the file no longer matches the recorded hash. */
  readSnapshot(source: SourceRow): string {
    const text = readFileSync(source.snapshotPath, 'utf8');
    if (sha256(text) !== source.textSha256) throw new Error(`The stored snapshot for ${source.finalUrl} has been changed since it was saved.`);
    return text;
  }

  addClaim(input: NewClaim): ClaimRow {
    const id = newId('claim');
    const next = (this.store.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM claims WHERE task_id = ?').get(input.taskId) as Row).n as number;
    this.store.db.prepare(
      `INSERT INTO claims (id, task_id, subtask_id, seq, text, type, url, quote, important) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.taskId, input.subtaskId ?? null, next, input.text, input.type, input.url ?? null, input.quote ?? null, input.important ? 1 : 0);
    return this.getClaim(id)!;
  }

  getClaim(id: string): ClaimRow | undefined {
    const r = this.store.db.prepare('SELECT * FROM claims WHERE id = ?').get(id) as Row | undefined;
    return r ? mapClaim(r) : undefined;
  }

  listClaims(taskId: string, status?: ClaimStatus): ClaimRow[] {
    const rows = status
      ? this.store.db.prepare('SELECT * FROM claims WHERE task_id = ? AND status = ? ORDER BY seq').all(taskId, status)
      : this.store.db.prepare('SELECT * FROM claims WHERE task_id = ? ORDER BY seq').all(taskId);
    return (rows as Row[]).map(mapClaim);
  }

  updateClaim(id: string, patch: ClaimPatch): ClaimRow {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const add = (col: string, v: string | number | null): void => { sets.push(`${col} = ?`); params.push(v); };
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.sourceId !== undefined) add('source_id', patch.sourceId);
    if (patch.quoteStart !== undefined) add('quote_start', patch.quoteStart);
    if (patch.quoteEnd !== undefined) add('quote_end', patch.quoteEnd);
    if (patch.checks !== undefined) add('checks', JSON.stringify(patch.checks));
    if (patch.reason !== undefined) add('reason', patch.reason);
    if (sets.length) this.store.db.prepare(`UPDATE claims SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    const row = this.getClaim(id);
    if (!row) throw new Error(`Claim not found: ${id}`);
    return row;
  }
}
