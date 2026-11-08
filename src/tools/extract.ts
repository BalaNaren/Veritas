/**
 * Turn a fetched page into plain text. The result is the "snapshot" every
 * quote is later checked against, so it must be deterministic: the same page
 * always gives the same text.
 */

export interface Extracted {
  title?: string;
  text: string;
  /** Publication date the page itself declares, if any (as written; not validated). */
  publishedAt?: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„', laquo: '«', raquo: '»',
  copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', cent: '¢', deg: '°', plusmn: '±',
  times: '×', divide: '÷', middot: '·', bull: '•', para: '¶', sect: '§', frac12: '½', frac14: '¼', frac34: '¾',
  shy: '', zwnj: '', zwj: '', thinsp: ' ', ensp: ' ', emsp: ' ',
  eacute: 'é', egrave: 'è', ecirc: 'ê', aacute: 'á', agrave: 'à', acirc: 'â', auml: 'ä', ouml: 'ö', uuml: 'ü',
  ntilde: 'ñ', ccedil: 'ç', szlig: 'ß', oacute: 'ó', iacute: 'í', uacute: 'ú',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1]!.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

const DROP_BLOCKS = ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object', 'embed', 'canvas', 'select', 'button'];
const CHROME_BLOCKS = ['nav', 'footer', 'aside', 'header', 'form'];
const BREAK_TAGS = 'p|div|br|li|tr|h[1-6]|section|article|blockquote|pre|table|ul|ol|hr|dd|dt|dl|figcaption|figure|main|details|summary|caption';

const removeBlocks = (html: string, tags: readonly string[]): string =>
  tags.reduce((acc, t) => acc.replace(new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?</${t}\\s*>`, 'gi'), ' '), html);

function metaContent(html: string, key: string): string | undefined {
  const re = new RegExp(`<meta\\b[^>]*(?:property|name|itemprop)\\s*=\\s*["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag?.match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i)?.slice(1).find((v) => v !== undefined);
}

function publishedAt(html: string): string | undefined {
  for (const key of ['article:published_time', 'og:article:published_time', 'datePublished', 'date', 'pubdate', 'publishdate', 'dc.date', 'dcterms.created']) {
    const v = metaContent(html, key);
    if (v?.trim()) return decodeEntities(v).trim();
  }
  const ld = html.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1];
  if (ld) return ld.trim();
  return html.match(/<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
}

/** Collapse whitespace the same way everywhere. */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[   ​﻿]/g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractHtml(html: string): Extracted {
  const clean = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ');
  const titleRaw = clean.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1];
  const title = titleRaw ? normalizeWhitespace(decodeEntities(titleRaw.replace(/<[^>]*>/g, ' '))) : undefined;
  const published = publishedAt(clean);

  let body = removeBlocks(clean, DROP_BLOCKS);
  const bodyMatch = body.match(/<body\b[^>]*>([\s\S]*?)(?:<\/body\s*>|$)/i);
  body = bodyMatch ? bodyMatch[1]! : body.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, ' ');

  // Prefer the page's main content when it names one.
  const main = body.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1];
  const articles = [...body.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/gi)].map((m) => m[1]!);
  const focus = main ?? (articles.length ? articles.join('\n') : body);
  const content = removeBlocks(focus, CHROME_BLOCKS);

  const text = content
    .replace(new RegExp(`</?(?:${BREAK_TAGS})\\b[^>]*>`, 'gi'), '\n')
    .replace(/<\/?(?:td|th)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  return { title: title || undefined, text: normalizeWhitespace(decodeEntities(text)).replace(/\n{2,}/g, '\n'), publishedAt: published };
}

/** Decode bytes using the declared charset, falling back to UTF-8. */
export function decodeBytes(body: Buffer, contentTypeHeader?: string): string {
  const declared = contentTypeHeader?.match(/charset\s*=\s*["']?([\w:.-]+)/i)?.[1]
    ?? body.subarray(0, 2048).toString('latin1').match(/<meta[^>]+charset\s*=\s*["']?([\w:.-]+)/i)?.[1];
  if (declared) {
    try { return new TextDecoder(declared, { fatal: false }).decode(body); } catch { /* unknown label: use UTF-8 */ }
  }
  return new TextDecoder('utf-8').decode(body);
}

/** Extract readable text from a fetched body according to its content type. */
export function extractText(body: Buffer, contentType: string, contentTypeHeader?: string): Extracted {
  const raw = decodeBytes(body, contentTypeHeader ?? contentType);
  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') return extractHtml(raw);
  return { text: normalizeWhitespace(raw) };
}
