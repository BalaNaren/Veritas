import type { EventLog } from '../engine/event-log.js';
import { runUrl, type EvidenceStore } from '../evidence/evidence-store.js';
import { flattenResults, type RunStore } from '../evidence/runs.js';
import type { SubtaskRow } from '../storage/models.js';
import type { IngestResult } from '../research/ingest.js';
import { validateDataOutput, type DataOutput } from './schemas.js';

const MAX_LINES_PER_KEY = 8;
const MAX_LINES = 14;

/**
 * The words a computed claim quotes are built here from the stored results, in the order they appear, so they
 * cannot be invented or reworded by an agent.
 */
export function quoteForKeys(results: unknown, keys: readonly string[]): string {
  const lines = flattenResults(results);
  const chosen = new Set<string>();
  for (const key of keys) {
    const matching = lines.filter((l) => { const path = l.slice(0, l.indexOf(': ')); return path === key || path.startsWith(`${key}.`); });
    for (const l of matching.slice(0, MAX_LINES_PER_KEY)) chosen.add(l);
  }
  return lines.filter((l) => chosen.has(l)).slice(0, MAX_LINES).join(' ... ');
}

/** Record a data task's findings as computed claims tied to the run that produced the numbers. */
export function ingestDataFindings(o: { evidence: EvidenceStore; runs: RunStore; events: EventLog; taskId: string; subtask: SubtaskRow }): IngestResult {
  const problem = validateDataOutput(o.subtask.output);
  if (problem) throw new Error(`Data output for "${o.subtask.key}" is unusable: ${problem}`);
  const output = o.subtask.output as DataOutput;
  const run = o.runs.getRun(output.runId);
  if (!run || !run.ok) throw new Error(`The analysis run ${output.runId} is missing or did not finish.`);
  const result: IngestResult = { claims: 0, duplicates: 0, sourcesFetched: 0, sourcesFailed: 0 };
  const seen = new Set(o.evidence.listClaims(o.taskId).map((c) => `${c.text.toLowerCase()}|${c.url}`));
  for (const f of output.findings) {
    const key = `${f.claim.toLowerCase()}|${runUrl(run.id)}`;
    if (seen.has(key)) { result.duplicates++; continue; }
    seen.add(key);
    o.evidence.addClaim({
      taskId: o.taskId, subtaskId: o.subtask.id, text: f.claim, type: 'computed', url: runUrl(run.id),
      quote: quoteForKeys(run.results, f.keys), important: f.important,
    });
    result.claims++;
  }
  o.events.emit(o.taskId, 'evidence.ingested', { key: o.subtask.key, ...result, runId: run.id }, o.subtask.id);
  return result;
}
