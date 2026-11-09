import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import pdfmake from 'pdfmake';

export type ExportFormat = 'md' | 'docx' | 'pdf';
export const EXPORT_FORMATS: readonly ExportFormat[] = ['md', 'docx', 'pdf'];

interface Run { text: string; bold?: boolean }
export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'bullet'; runs: Run[] }
  | { type: 'numbered'; n: number; runs: Run[] }
  | { type: 'quote'; runs: Run[] }
  | { type: 'note'; runs: Run[] };

/** Split `**bold**` markers into runs. */
export function inlineRuns(text: string): Run[] {
  const runs: Run[] = [];
  text.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
    if (!part) return;
    if (part.startsWith('**') && part.endsWith('**')) runs.push({ text: part.slice(2, -2), bold: true });
    else runs.push({ text: part });
  });
  return runs;
}

/** Read the Markdown that `renderMarkdown` produces. It is a small, known shape, so this is not a general Markdown parser. */
export function parseReport(markdown: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = (): void => { if (para.length) { blocks.push({ type: 'paragraph', runs: inlineRuns(para.join(' ')) }); para = []; } };
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^(\d+)\.\s+(.*)$/);
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (!line.trim()) { flush(); continue; }
    if (h) { flush(); blocks.push({ type: 'heading', level: Math.min(3, h[1]!.length) as 1 | 2 | 3, text: h[2]!.replace(/\*\*/g, '') }); continue; }
    if (bullet) { flush(); blocks.push({ type: 'bullet', runs: inlineRuns(bullet[1]!) }); continue; }
    if (numbered) { flush(); blocks.push({ type: 'numbered', n: Number(numbered[1]), runs: inlineRuns(numbered[2]!) }); continue; }
    if (quote) { flush(); blocks.push({ type: 'quote', runs: inlineRuns(quote[1]!) }); continue; }
    if (/^\s{2,}\S/.test(raw)) { flush(); blocks.push({ type: 'note', runs: inlineRuns(line.trim()) }); continue; }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

// ---------- DOCX ----------

const HEADINGS = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 } as const;
const docxRuns = (runs: Run[], italics = false): TextRun[] => runs.map((r) => new TextRun({ text: r.text, bold: r.bold, italics }));

export async function toDocx(markdown: string): Promise<Buffer> {
  const children = parseReport(markdown).map((b) => {
    switch (b.type) {
      case 'heading': return new Paragraph({ heading: HEADINGS[b.level], children: [new TextRun(b.text)] });
      case 'bullet': return new Paragraph({ bullet: { level: 0 }, children: docxRuns(b.runs) });
      case 'numbered': return new Paragraph({ indent: { left: 360, hanging: 360 }, children: [new TextRun(`${b.n}. `), ...docxRuns(b.runs)] });
      case 'quote': return new Paragraph({ indent: { left: 720 }, children: docxRuns(b.runs, true) });
      case 'note': return new Paragraph({ indent: { left: 720 }, children: docxRuns(b.runs) });
      default: return new Paragraph({ spacing: { after: 120 }, children: docxRuns(b.runs) });
    }
  });
  return Packer.toBuffer(new Document({ creator: 'Veritas', title: 'Veritas report', sections: [{ children }] }));
}

// ---------- PDF ----------

/** Roboto (bundled with the library) cannot draw these symbols, so they are spelled out. */
const PDF_SYMBOLS: [RegExp, string][] = [[/✓\s*/g, ''], [/⚠\s*/g, '(!) '], [/✗\s*/g, ''], [/◇\s*/g, '']];
const pdfText = (s: string): string => PDF_SYMBOLS.reduce((acc, [re, to]) => acc.replace(re, to), s);
const pdfRuns = (runs: Run[], extra: Record<string, unknown> = {}): unknown[] => runs.map((r) => ({ text: pdfText(r.text), bold: r.bold, ...extra }));

let fontsReady = false;
function prepareFonts(): string {
  const dir = join(dirname(createRequire(import.meta.url).resolve('pdfmake/package.json')), 'fonts', 'Roboto');
  if (!fontsReady) {
    const f = (n: string): string => join(dir, `Roboto-${n}.ttf`);
    pdfmake.setFonts({ Roboto: { normal: f('Regular'), bold: f('Medium'), italics: f('Italic'), bolditalics: f('MediumItalic') } });
    // The report contains no images; refuse every other file or address the library might be asked to read.
    pdfmake.setLocalAccessPolicy((path) => resolve(path).startsWith(dir));
    pdfmake.setUrlAccessPolicy(() => false);
    fontsReady = true;
  }
  return dir;
}

export async function toPdf(markdown: string): Promise<Buffer> {
  prepareFonts();
  const content = parseReport(markdown).map((b) => {
    switch (b.type) {
      case 'heading': return { text: pdfText(b.text), fontSize: b.level === 1 ? 20 : b.level === 2 ? 15 : 12, bold: true, margin: [0, b.level === 1 ? 0 : 12, 0, 6] };
      case 'bullet': return { ul: [{ text: pdfRuns(b.runs) }], margin: [0, 0, 0, 3] };
      case 'numbered': return { columns: [{ width: 22, text: `${b.n}.` }, { width: '*', text: pdfRuns(b.runs) }], margin: [0, 4, 0, 0] };
      case 'quote': return { text: pdfRuns(b.runs, { italics: true, color: '#444444' }), margin: [22, 0, 0, 2] };
      case 'note': return { text: pdfRuns(b.runs, { color: '#8a4b00' }), margin: [22, 0, 0, 2] };
      default: return { text: pdfRuns(b.runs), margin: [0, 0, 0, 6] };
    }
  });
  return pdfmake.createPdf({ info: { title: 'Veritas report', creator: 'Veritas', producer: 'Veritas' }, defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.25 }, pageMargins: [56, 56, 56, 56], content }).getBuffer();
}

/** Render the finished Markdown report in another format. Markdown is returned as written. */
export async function exportReport(markdown: string, format: ExportFormat): Promise<Buffer> {
  if (format === 'md') return Buffer.from(markdown, 'utf8');
  return format === 'docx' ? toDocx(markdown) : toPdf(markdown);
}
