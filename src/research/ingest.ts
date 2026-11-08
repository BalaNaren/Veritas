import type { EventLog } from '../engine/event-log.js';
import type { EvidenceStore } from '../evidence/evidence-store.js';
import type { SubtaskRow } from '../storage/models.js';
import { extractText } from '../tools/extract.js';
import type { FetchOptions, FetchResult } from '../tools/web-fetch.js';
import { validateFindings, type Finding } from './findings.js';

export type Fetcher = (url: string, options?: FetchOptions) => Promise<FetchResult>;

export interface IngestOptions {
  evidence: EvidenceStore;
  /** Veritas's own fetcher. The agent's browsing is never trusted as evidence. */
  fetcher: Fetcher;
  events: EventLog;
  taskId: string;
  subtask: SubtaskRow;
  signal?: AbortSignal;
  concurrency?: number;
}

export interface IngestResult {
  claims: number;
  duplicates: number;
  sourcesFetched: number;
  sourcesFailed: number;
}

const claimKey = (text: string, url: string): string => `${text.toLowerCase().replace(/\s+/g, ' ').trim()}|${url}`;

/**
 * Turn one research task's findings into stored evidence: fetch each cited page
 * ourselves, keep a text snapshot, and record each finding as a claim waiting
 * to be verified. A page that cannot be fetched still leaves its claims in the
 * record, where verification will remove them as unsourced.
 */
export async function ingestFindings(o: IngestOptions): Promise<IngestResult> {
  const parsed = validateFindings(o.subtask.output);
  if (!parsed.ok) throw new Error(`Research output for "${o.subtask.key}" is unusable: ${parsed.error}`);
  const findings = parsed.value.findings;
  const result: IngestResult = { claims: 0, duplicates: 0, sourcesFetched: 0, sourcesFailed: 0 };

  const urls = [...new Set(findings.map((f) => f.url))];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < urls.length && !o.signal?.aborted) {
      const url = urls[next++]!;
      if (o.evidence.findSource(o.taskId, url)) continue; // already fetched for another task
      const res = await o.fetcher(url, { signal: o.signal });
      if (!res.ok) {
        result.sourcesFailed++;
        o.events.emit(o.taskId, 'source.failed', { url, kind: res.kind, message: res.message }, o.subtask.id);
        continue;
      }
      const extracted = extractText(res.body, res.contentType);
      const source = o.evidence.addSource({
        taskId: o.taskId, url, finalUrl: res.url,
        title: extracted.title ?? findings.find((f) => f.url === url)?.title ?? null,
        contentType: res.contentType, bytes: res.body.length, sha256: res.sha256, fetchedAt: res.fetchedAt,
        // Only a date the page itself declares is kept; a date the agent supplies has not been verified.
        publishedAt: extracted.publishedAt ?? null, text: extracted.text,
      });
      result.sourcesFetched++;
      o.events.emit(o.taskId, 'source.fetched', { url, finalUrl: source.finalUrl, quality: source.quality }, o.subtask.id);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 4, urls.length || 1)) }, worker));
  if (o.signal?.aborted) throw new Error('Cancelled while collecting sources');

  const seen = new Set(o.evidence.listClaims(o.taskId).map((c) => claimKey(c.text, c.url ?? '')));
  for (const f of findings as Finding[]) {
    const key = claimKey(f.claim, f.url);
    if (seen.has(key)) { result.duplicates++; continue; }
    seen.add(key);
    o.evidence.addClaim({ taskId: o.taskId, subtaskId: o.subtask.id, text: f.claim, type: f.type, url: f.url, quote: f.quote, important: f.important });
    result.claims++;
  }
  o.events.emit(o.taskId, 'evidence.ingested', { key: o.subtask.key, ...result }, o.subtask.id);
  return result;
}
