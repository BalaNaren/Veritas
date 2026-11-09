import { fileUrl } from '../evidence/evidence-store.js';
import { MAX_FINDINGS, type Finding, type Findings } from './findings.js';

/** What a document agent hands back: claims, each with the file, the page or section, and the exact words. */
export const DOC_FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'notes'],
  properties: {
    findings: {
      type: 'array', maxItems: MAX_FINDINGS,
      items: {
        type: 'object', additionalProperties: false,
        required: ['claim', 'type', 'file', 'page', 'quote', 'important'],
        properties: {
          claim: { type: 'string', description: 'One self-contained statement of what the document says.' },
          type: { type: 'string', enum: ['fact', 'number', 'quote'] },
          file: { type: 'string', description: 'The file name exactly as given in the file header.' },
          page: { type: 'integer', minimum: 1, description: 'The number of the page or section the words are on (the number in its "=== ... ===" marker order, starting at 1).' },
          quote: { type: 'string', description: 'Words copied exactly from that page or section.' },
          important: { type: 'boolean' },
        },
      },
    },
    notes: { type: 'string', description: 'Gaps, conflicts, or things you could not find in the files.' },
  },
} as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Check a document agent's findings and convert them to the common shape (the "address" of a file is `file:<name>`). */
export function validateDocFindings(value: unknown): { ok: true; value: Findings } | { ok: false; error: string } {
  if (!isObj(value) || !Array.isArray(value.findings)) return { ok: false, error: 'The answer must be a JSON object with a "findings" list.' };
  if (value.findings.length > MAX_FINDINGS) return { ok: false, error: `At most ${MAX_FINDINGS} findings are allowed.` };
  const findings: Finding[] = [];
  for (const [i, f] of value.findings.entries()) {
    if (!isObj(f)) return { ok: false, error: `Finding ${i + 1} must be an object.` };
    const claim = typeof f.claim === 'string' ? f.claim.trim() : '';
    const file = typeof f.file === 'string' ? f.file.trim() : '';
    const quote = typeof f.quote === 'string' ? f.quote.trim() : '';
    if (!claim || claim.length > 1000) return { ok: false, error: `Finding ${i + 1}: "claim" must be 1-1000 characters.` };
    if (f.type !== 'fact' && f.type !== 'number' && f.type !== 'quote') return { ok: false, error: `Finding ${i + 1}: "type" must be fact, number or quote.` };
    if (!file || file.length > 300) return { ok: false, error: `Finding ${i + 1}: "file" must name a file.` };
    if (typeof f.page !== 'number' || !Number.isInteger(f.page) || f.page < 1) return { ok: false, error: `Finding ${i + 1}: "page" must be a whole number from 1.` };
    if (!quote || quote.length > 2000) return { ok: false, error: `Finding ${i + 1}: "quote" must be 1-2000 characters.` };
    findings.push({ claim, type: f.type, url: fileUrl(file), title: file, quote, location: f.page, important: f.important === true });
  }
  return { ok: true, value: { findings, notes: typeof value.notes === 'string' ? value.notes.slice(0, 2000) : '' } };
}
