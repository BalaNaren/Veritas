/**
 * Locating a quote inside a stored source text, ignoring only formatting:
 * letter case, runs of whitespace, curly versus straight quotes, and the
 * different dash characters. Anything else that differs means the quote is not
 * in the source.
 */

interface Normalized {
  text: string;
  /** For each character of `text`, the index in the original string it came from. */
  map: number[];
}

const QUOTES: Record<string, string> = { '‘': "'", '’': "'", '‚': "'", '‛': "'", '“': '"', '”': '"', '„': '"', '‟': '"', '′': "'", '″': '"', '`': "'", '´': "'" };
const DASHES = new Set(['‐', '‑', '‒', '–', '—', '―', '−', '﹘', '﹣', '－']);
const INVISIBLE = new Set(['­', '​', '‌', '‍', '⁠', '﻿']);

export function normalizeWithMap(input: string): Normalized {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;
  let i = 0;
  for (const ch of input) {
    const at = i;
    i += ch.length;
    if (INVISIBLE.has(ch)) continue;
    if (/\s/u.test(ch)) { pendingSpace = out.length > 0; continue; }
    let piece = QUOTES[ch] ?? (DASHES.has(ch) ? '-' : ch === '…' ? '...' : ch.toLowerCase());
    // Compatibility forms (full-width letters, ligatures) fold to their plain equivalents.
    piece = piece.normalize('NFKC');
    if (pendingSpace) { out.push(' '); map.push(at); pendingSpace = false; }
    for (const c of piece) { out.push(c); map.push(at); }
  }
  return { text: out.join(''), map };
}

export const normalizeForMatch = (s: string): string => normalizeWithMap(s).text;

export interface QuoteMatch {
  found: boolean;
  /** Start and end (exclusive) in the original snapshot text. */
  start?: number;
  end?: number;
  reason?: string;
}

/** Shortest quote worth matching; shorter ones would match almost anything. */
export const MIN_QUOTE_CHARS = 12;

/**
 * Find `quote` in `snapshot`. A quote may use "..." (or an ellipsis character)
 * to skip words; each piece between the markers must appear, in order.
 */
export function findQuote(snapshot: string, quote: string): QuoteMatch {
  const q = normalizeForMatch(quote).replace(/\[\.\.\.\]/g, '...');
  const pieces = q.split('...').map((p) => p.trim().replace(/^[\s.,;:'"()\[\]-]+|[\s.,;:'"()\[\]-]+$/g, '')).filter(Boolean);
  if (!pieces.length || pieces.join('').length < MIN_QUOTE_CHARS) {
    return { found: false, reason: `The quote is too short to check (needs at least ${MIN_QUOTE_CHARS} characters)` };
  }
  const src = normalizeWithMap(snapshot);
  let from = 0;
  let first = -1;
  let last = -1;
  for (const piece of pieces) {
    const at = src.text.indexOf(piece, from);
    if (at < 0) return { found: false, reason: `The quoted words "${piece.slice(0, 60)}${piece.length > 60 ? '...' : ''}" do not appear in the source` };
    if (first < 0) first = at;
    last = at + piece.length - 1;
    from = at + piece.length;
  }
  return { found: true, start: src.map[first]!, end: src.map[last]! + 1 };
}

/** The text around a located quote, for the independent checker to read. */
export function passageAround(snapshot: string, start: number, end: number, context = 400): string {
  const a = Math.max(0, start - context);
  const b = Math.min(snapshot.length, end + context);
  return `${a > 0 ? '...' : ''}${snapshot.slice(a, b)}${b < snapshot.length ? '...' : ''}`;
}
