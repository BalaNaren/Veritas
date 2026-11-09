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
