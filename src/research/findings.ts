/** What a research agent hands back: claims, each with the page and the exact words that back it. */

export type FindingType = 'fact' | 'number' | 'quote';

export interface Finding {
  claim: string;
  type: FindingType;
  /** Web address, or `file:<name>` for a file the user supplied. */
  url: string;
  title: string;
  quote: string;
  publishedAt?: string;
  /** Page or section number, for findings from files. */
  location?: number;
  /** The agent's own view that the report depends on this claim. */
  important: boolean;
}

export interface Findings {
  findings: Finding[];
  notes: string;
}

export const MAX_FINDINGS = 30;

export const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'notes'],
  properties: {
    findings: {
      type: 'array', maxItems: MAX_FINDINGS,
      items: {
        type: 'object', additionalProperties: false,
        required: ['claim', 'type', 'url', 'title', 'quote', 'important'],
        properties: {
          claim: { type: 'string', description: 'One self-contained statement, in your own words.' },
          type: { type: 'string', enum: ['fact', 'number', 'quote'] },
          url: { type: 'string', description: 'The exact address of the page you read.' },
          title: { type: 'string' },
          quote: { type: 'string', description: 'Words copied exactly from that page that support the claim.' },
          publishedAt: { type: 'string', description: 'Publication date shown on the page, if any.' },
          important: { type: 'boolean', description: 'True if the answer depends on this claim.' },
        },
      },
    },
    notes: { type: 'string', description: 'Anything the reader should know: gaps, conflicts, things you could not find.' },
  },
} as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Check an agent's findings. Returns what is usable or a message for the retry. */
export function validateFindings(value: unknown): { ok: true; value: Findings } | { ok: false; error: string } {
  if (!isObj(value) || !Array.isArray(value.findings)) return { ok: false, error: 'The answer must be a JSON object with a "findings" list.' };
  if (value.findings.length > MAX_FINDINGS) return { ok: false, error: `At most ${MAX_FINDINGS} findings are allowed.` };
  const findings: Finding[] = [];
  for (const [i, f] of value.findings.entries()) {
    if (!isObj(f)) return { ok: false, error: `Finding ${i + 1} must be an object.` };
    const claim = typeof f.claim === 'string' ? f.claim.trim() : '';
    const url = typeof f.url === 'string' ? f.url.trim() : '';
    const quote = typeof f.quote === 'string' ? f.quote.trim() : '';
    const type = f.type;
    if (!claim || claim.length > 1000) return { ok: false, error: `Finding ${i + 1}: "claim" must be 1-1000 characters.` };
    if (type !== 'fact' && type !== 'number' && type !== 'quote') return { ok: false, error: `Finding ${i + 1}: "type" must be fact, number or quote.` };
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: `Finding ${i + 1}: "url" must be a full http or https address.` };
    if (!quote || quote.length > 2000) return { ok: false, error: `Finding ${i + 1}: "quote" must be 1-2000 characters.` };
    findings.push({
      claim, type, url, quote, title: typeof f.title === 'string' ? f.title.trim().slice(0, 300) : '',
      publishedAt: typeof f.publishedAt === 'string' && f.publishedAt.trim() ? f.publishedAt.trim().slice(0, 40) : undefined,
      important: f.important === true,
    });
  }
  return { ok: true, value: { findings, notes: typeof value.notes === 'string' ? value.notes.slice(0, 2000) : '' } };
}
