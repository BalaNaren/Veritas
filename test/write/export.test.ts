import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { exportReport, inlineRuns, parseReport } from '../../src/write/export.js';

const REPORT = `# How far is the Moon?

## Assumptions

- English sources only

## Answer

The Moon is **about 384,400 km** away [1]. It orbits in 27.3 days [2].

## Sources

1. Moon facts — https://www.nasa.gov/moon (primary source, fetched 2026-03-04)
   > average distance of 384,400 km
   ⚠ Flagged: Only partly supported by its source

## Verification summary

- ✓ Confirmed: 2
- ✗ Removed: 1 (not supported)
`;

/** Read one file out of a zip archive (enough for the files docx writes). */
function unzip(buf: Buffer, name: string): string {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entry = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (entry === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return (method === 0 ? data : inflateRawSync(data)).toString('utf8');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} not found in archive`);
}

describe('parseReport', () => {
  it('reads headings, lists, sources, quotes, notes and bold text', () => {
    const blocks = parseReport(REPORT);
    expect(blocks.filter((b) => b.type === 'heading').map((b) => (b as { text: string }).text)).toEqual(['How far is the Moon?', 'Assumptions', 'Answer', 'Sources', 'Verification summary']);
    expect(blocks.some((b) => b.type === 'numbered' && b.n === 1)).toBe(true);
    expect(blocks.find((b) => b.type === 'quote')).toMatchObject({ runs: [{ text: 'average distance of 384,400 km' }] });
    expect(blocks.find((b) => b.type === 'note')).toMatchObject({ runs: [{ text: '⚠ Flagged: Only partly supported by its source' }] });
    expect(blocks.filter((b) => b.type === 'bullet')).toHaveLength(3);
    const answer = blocks.find((b) => b.type === 'paragraph') as { runs: { text: string; bold?: boolean }[] };
    expect(answer.runs.find((r) => r.bold)?.text).toBe('about 384,400 km');
  });
  it('merges wrapped lines into one paragraph', () => {
    expect(parseReport('one\ntwo\n\nthree')).toHaveLength(2);
    expect(inlineRuns('a **b** c')).toEqual([{ text: 'a ' }, { text: 'b', bold: true }, { text: ' c' }]);
  });
});

describe('tables', () => {
  const md = '## Comparison\n\n| Contract | Notice |\n|---|---|\n| Alpha | 90 days [1] |\n| Beta | — |\n\nAfter the table.';
  it('parses rows without the rule line', () => {
    const t = parseReport(md).find((b) => b.type === 'table');
    expect(t).toEqual({ type: 'table', rows: [['Contract', 'Notice'], ['Alpha', '90 days [1]'], ['Beta', '—']] });
    expect(parseReport(md).at(-1)).toMatchObject({ type: 'paragraph' });
  });
  it('exports to Word and PDF', async () => {
    const xml = unzip(await exportReport(md, 'docx'), 'word/document.xml');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('90 days [1]');
    expect((await exportReport(md, 'pdf')).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('code and images', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const md = '## Chart\n\n![Revenue by region](charts/a.png)\n\n![Escape attempt](../secret.png)\n\n## Code\n\n```python\nimport csv\nfor r in rows:\n    print(r)\n```\n\nAfter.';
  const dir = mkdtempSync(join(tmpdir(), 'veritas-exp-'));
  mkdirSync(join(dir, 'report', 'charts'), { recursive: true });
  writeFileSync(join(dir, 'report', 'charts', 'a.png'), PNG);
  writeFileSync(join(dir, 'secret.png'), PNG);
  const base = join(dir, 'report');

  it('parses fenced code (keeping indentation) and images', () => {
    const blocks = parseReport(md);
    expect(blocks.find((b) => b.type === 'code')).toEqual({ type: 'code', lines: ['import csv', 'for r in rows:', '    print(r)'] });
    expect(blocks.filter((b) => b.type === 'image')).toHaveLength(2);
    expect(blocks.at(-1)).toMatchObject({ type: 'paragraph' });
  });
  it('puts the chart and the code in a Word document, and skips an image outside the report folder', async () => {
    const buf = await exportReport(md, 'docx', base);
    const names: string[] = [];
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    let p = buf.readUInt32LE(eocd + 16);
    for (let i = 0; i < buf.readUInt16LE(eocd + 10); i++) { const n = buf.readUInt16LE(p + 28); names.push(buf.toString('utf8', p + 46, p + 46 + n)); p += 46 + n + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32); }
    expect(names.filter((n) => n.startsWith('word/media/'))).toHaveLength(1);
    const xml = unzip(buf, 'word/document.xml');
    expect(xml).toContain('Courier New');
    expect(xml).toContain('for r in rows:');
    expect(xml).toContain('Escape attempt');
  });
  it('writes a PDF with the chart and the code', async () => {
    const withImage = await exportReport(md, 'pdf', base);
    const without = await exportReport(md, 'pdf');
    expect(withImage.subarray(0, 5).toString()).toBe('%PDF-');
    expect(withImage.length).toBeGreaterThan(without.length);
  });
  it('cleans up', () => { rmSync(dir, { recursive: true, force: true }); });
});

describe('exportReport', () => {
  it('returns Markdown unchanged', async () => {
    expect((await exportReport(REPORT, 'md')).toString()).toBe(REPORT);
  });
  it('writes a Word document containing the report text', async () => {
    const buf = await exportReport(REPORT, 'docx');
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    const xml = unzip(buf, 'word/document.xml');
    for (const text of ['How far is the Moon?', 'about 384,400 km', 'average distance of 384,400 km', 'Only partly supported', 'Confirmed: 2']) expect(xml).toContain(text);
    expect(xml).not.toContain('**');
  });
  it('writes a PDF', async () => {
    const buf = await exportReport(REPORT, 'pdf');
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1500);
    expect(buf.toString('latin1')).toContain('%%EOF');
    // A second export in the same process works too (fonts are set up once).
    expect((await exportReport('# Title\n\nText.', 'pdf')).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
