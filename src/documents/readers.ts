import { createHash } from 'node:crypto';
import { readFile, stat, realpath } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { extractHtml, decodeBytes, normalizeWhitespace } from '../tools/extract.js';
import { DocumentError, EXTENSIONS, LIMITS, type DocKind, type DocUnit, type ReadDocument } from './types.js';

/** Split raw text into blocks of whole lines, keeping the file's own text exactly (so quotes from it match). */
function lineUnits(text: string, perUnit: number): DocUnit[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const units: DocUnit[] = [];
  for (let i = 0; i < lines.length; i += perUnit) {
    const chunk = lines.slice(i, i + perUnit);
    units.push({ n: units.length + 1, label: `lines ${i + 1}-${i + chunk.length}`, text: chunk.join('\n') });
  }
  return units;
}

async function readPdf(buf: Buffer): Promise<DocUnit[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    if (doc.numPages > LIMITS.maxPdfPages) throw new DocumentError(`The PDF has ${doc.numPages} pages; the limit is ${LIMITS.maxPdfPages}.`, 'too_large');
    const units: DocUnit[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        text += item.hasEOL ? '\n' : ' ';
      }
      units.push({ n: p, label: `page ${p}`, text: normalizeWhitespace(text) });
      page.cleanup();
    }
    return units;
  } finally {
    await task.destroy();
  }
}

async function readDocx(buf: Buffer): Promise<DocUnit[]> {
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });
  // Start a new section at every heading.
  const parts = html.split(/(?=<h[1-6]\b)/i).filter((p) => p.trim());
  const sections = parts.map((p) => {
    const heading = p.match(/^<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1]?.replace(/<[^>]*>/g, '').trim();
    return { heading, text: extractHtml(p).text };
  }).filter((s) => s.text);
  const hasHeadings = sections.some((s) => s.heading);
  if (hasHeadings) return sections.map((s, i) => ({ n: i + 1, label: s.heading ? `section "${s.heading.slice(0, 60)}"` : `section ${i + 1}`, text: s.text }));
  // No headings: cut the text into parts of about the same size at paragraph breaks.
  const paragraphs = extractHtml(html).text.split('\n');
  const units: DocUnit[] = [];
  let current: string[] = [];
  let size = 0;
  const flush = (): void => { if (current.length) { units.push({ n: units.length + 1, label: `part ${units.length + 1}`, text: current.join('\n') }); current = []; size = 0; } };
  for (const para of paragraphs) { current.push(para); size += para.length; if (size >= LIMITS.docxCharsPerPart) flush(); }
  flush();
  return units;
}

async function readXlsx(buf: Buffer): Promise<DocUnit[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const units: DocUnit[] = [];
  wb.eachSheet((ws) => {
    const lines: string[] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => cells.push(String(cell.text ?? '').replace(/\s+/g, ' ').trim()));
      lines.push(cells.join('\t'));
    });
    for (let i = 0; i < Math.max(1, lines.length); i += LIMITS.xlsxRowsPerUnit) {
      const chunk = lines.slice(i, i + LIMITS.xlsxRowsPerUnit);
      const part = lines.length > LIMITS.xlsxRowsPerUnit ? `, rows ${i + 1}-${i + chunk.length}` : '';
      units.push({ n: units.length + 1, label: `sheet "${ws.name}"${part}`, text: chunk.join('\n') });
    }
  });
  return units;
}

const checkSize = (n: number, name: string): void => {
  if (n > LIMITS.maxFileBytes) throw new DocumentError(`${name} is larger than ${LIMITS.maxFileBytes / 1024 / 1024} MB.`, 'too_large');
};

/** Read one file into citable units. Throws `DocumentError` for unsupported, oversized, unreadable or empty files. */
export async function readDocument(path: string, displayName?: string): Promise<ReadDocument> {
  const name = displayName ?? basename(path);
  const kind: DocKind | undefined = EXTENSIONS[extname(path).toLowerCase()];
  if (!kind) throw new DocumentError(`${name}: this file type is not supported (supported: ${Object.keys(EXTENSIONS).join(' ')}).`, 'unsupported');
  const real = await realpath(path).catch(() => { throw new DocumentError(`${name}: the file does not exist.`, 'unreadable'); });
  const info = await stat(real);
  if (!info.isFile()) throw new DocumentError(`${name}: not a regular file.`, 'unreadable');
  checkSize(info.size, name);
  const buf = await readFile(real);
  let units: DocUnit[];
  try {
    switch (kind) {
      case 'pdf': units = await readPdf(buf); break;
      case 'docx': units = await readDocx(buf); break;
      case 'xlsx': units = await readXlsx(buf); break;
      case 'csv': units = lineUnits(decodeBytes(buf).replace(/^\uFEFF/, ''), LIMITS.csvRowsPerUnit); break;
      case 'json': {
        const text = decodeBytes(buf);
        let pretty = text;
        try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep as written */ }
        units = lineUnits(pretty, LIMITS.linesPerUnit);
        break;
      }
      default: units = lineUnits(decodeBytes(buf), LIMITS.linesPerUnit);
    }
  } catch (e) {
    if (e instanceof DocumentError) throw e;
    throw new DocumentError(`${name}: could not be read (${e instanceof Error ? e.message : String(e)}).`, 'unreadable');
  }
  units = units.filter((u) => u.text.trim());
  units.forEach((u, i) => { u.n = i + 1; });
  const total = units.reduce((n, u) => n + u.text.length, 0);
  if (!units.length) throw new DocumentError(`${name}: no text could be found in it${kind === 'pdf' ? ' (a scanned PDF needs text recognition, which is not supported yet)' : ''}.`, 'empty');
  if (total > LIMITS.maxTextChars) throw new DocumentError(`${name}: contains more than ${LIMITS.maxTextChars} characters of text.`, 'too_large');
  return { name, kind, bytes: info.size, sha256: createHash('sha256').update(buf).digest('hex'), units };
}
