import { flattenResults } from '../evidence/runs.js';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Step 1: the agent writes code. It never runs it. */
export const CODE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['code', 'approach'],
  properties: {
    code: { type: 'string', description: 'Complete Python program.' },
    approach: { type: 'string', description: 'One or two sentences on what the program computes and why.' },
  },
} as const;

export function validateCode(value: unknown): { ok: true; code: string; approach: string } | { ok: false; error: string } {
  if (!isObj(value)) return { ok: false, error: 'The answer must be a JSON object.' };
  const code = typeof value.code === 'string' ? value.code : '';
  if (!code.trim() || code.length > 60_000) return { ok: false, error: '"code" must be a non-empty program of at most 60,000 characters.' };
  return { ok: true, code, approach: typeof value.approach === 'string' ? value.approach.slice(0, 600) : '' };
}

/** Step 2: the agent describes what the stored results show. */
export const INTERPRET_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['findings', 'charts', 'notes'],
  properties: {
    findings: {
      type: 'array', maxItems: 30,
      items: {
        type: 'object', additionalProperties: false, required: ['claim', 'keys', 'important'],
        properties: {
          claim: { type: 'string', description: 'One statement about what the results show.' },
          keys: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' }, description: 'Result keys (exactly as listed) that every number in the claim comes from.' },
          important: { type: 'boolean' },
        },
      },
    },
    charts: {
      type: 'array', maxItems: 6,
      items: { type: 'object', additionalProperties: false, required: ['file', 'caption'], properties: { file: { type: 'string' }, caption: { type: 'string' } } },
    },
    notes: { type: 'string' },
  },
} as const;

export interface DataFinding { claim: string; keys: string[]; important: boolean }
export interface DataChart { file: string; caption: string }
export interface Interpretation { findings: DataFinding[]; charts: DataChart[]; notes: string }

/** What a data task stores as its output: which run it relies on, and what it says about it. */
export interface DataOutput extends Interpretation { runId: string }

/** Keys that exist in a results object, as the flattened paths the claims may cite. */
export function resultKeys(results: unknown): string[] {
  return flattenResults(results).map((l) => l.slice(0, l.indexOf(': ')));
}

/** A cited key is valid if it names a stored value, or a group (a prefix of stored values). */
export function keyExists(keys: readonly string[], key: string): boolean {
  return keys.some((k) => k === key || k.startsWith(`${key}.`));
}

export function validateInterpretation(value: unknown, results: unknown, outputNames: readonly string[]): { ok: true; value: Interpretation } | { ok: false; error: string } {
  if (!isObj(value) || !Array.isArray(value.findings)) return { ok: false, error: 'The answer must be a JSON object with a "findings" list.' };
  const keys = resultKeys(results);
  const findings: DataFinding[] = [];
  for (const [i, f] of value.findings.entries()) {
    if (!isObj(f)) return { ok: false, error: `Finding ${i + 1} must be an object.` };
    const claim = typeof f.claim === 'string' ? f.claim.trim() : '';
    if (!claim || claim.length > 1000) return { ok: false, error: `Finding ${i + 1}: "claim" must be 1-1000 characters.` };
    if (!Array.isArray(f.keys) || !f.keys.length || f.keys.some((k) => typeof k !== 'string')) return { ok: false, error: `Finding ${i + 1}: "keys" must list the result keys the claim relies on.` };
    const missing = (f.keys as string[]).filter((k) => !keyExists(keys, k));
    if (missing.length) return { ok: false, error: `Finding ${i + 1}: these keys are not in the results: ${missing.join(', ')}. Keys available: ${keys.slice(0, 60).join(', ')}` };
    findings.push({ claim, keys: [...new Set(f.keys as string[])], important: f.important === true });
  }
  const charts: DataChart[] = [];
  for (const c of Array.isArray(value.charts) ? value.charts : []) {
    if (!isObj(c) || typeof c.file !== 'string' || typeof c.caption !== 'string') return { ok: false, error: 'Each chart needs a "file" and a "caption".' };
    if (!outputNames.includes(c.file) || !/\.png$/i.test(c.file)) return { ok: false, error: `Chart "${c.file}" is not a PNG file the program produced. Files available: ${outputNames.join(', ') || 'none'}.` };
    charts.push({ file: c.file, caption: c.caption.trim().slice(0, 300) });
  }
  return { ok: true, value: { findings, charts, notes: typeof value.notes === 'string' ? value.notes.slice(0, 2000) : '' } };
}

/** Shape of what a data task stores (used to mark the kind as structured; the worker builds it itself). */
export const DATA_OUTPUT_SCHEMA = {
  type: 'object', required: ['runId', 'findings', 'charts', 'notes'],
  properties: { runId: { type: 'string' }, findings: { type: 'array' }, charts: { type: 'array' }, notes: { type: 'string' } },
} as const;

/** Structure check for a stored data-task output (the cited keys were already checked against the run). */
export function validateDataOutput(value: unknown): string | null {
  if (!isObj(value) || typeof value.runId !== 'string' || !Array.isArray(value.findings)) return 'The data task did not produce a run and findings.';
  return null;
}
