import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import ExcelJS from 'exceljs';
import pdfmake from 'pdfmake';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/documents/csv.js';
import { readDocument } from '../../src/documents/readers.js';
import { DocumentError } from '../../src/documents/types.js';

let dir = '';
const p = (name: string): string => join(dir, name);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'veritas-docs-'));
  // A three-page PDF.
  const fonts = join(dirname(createRequire(import.meta.url).resolve('pdfmake/package.json')), 'fonts', 'Roboto');
  pdfmake.setFonts({ Roboto: { normal: join(fonts, 'Roboto-Regular.ttf'), bold: join(fonts, 'Roboto-Medium.ttf'), italics: join(fonts, 'Roboto-Italic.ttf'), bolditalics: join(fonts, 'Roboto-MediumItalic.ttf') } });
  const pdf = await pdfmake.createPdf({
    defaultStyle: { font: 'Roboto' },
    content: [
      { text: 'Master Services Agreement. The term is twelve months from the effective date.' },
      { text: 'Either party may terminate on 30 days written notice.', pageBreak: 'before' },
      { text: 'Fees are 4,500 dollars per month, payable within 15 days.', pageBreak: 'before' },
    ],
  }).getBuffer();
  writeFileSync(p('contract.pdf'), pdf);

  const docx = await Packer.toBuffer(new Document({ sections: [{ children: [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Scope')] }),
    new Paragraph('The supplier will deliver weekly reports.'),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Termination')] }),
    new Paragraph('Notice of 60 days is required.'),
  ] }] }));
  writeFileSync(p('terms.docx'), docx);
  const plainDocx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('No headings here, just text.')] }] }));
  writeFileSync(p('plain.docx'), plainDocx);

  const wb = new ExcelJS.Workbook();
  const sales = wb.addWorksheet('Sales');
  sales.addRow(['Region', 'Revenue']);
  sales.addRow(['North', 1200]);
  sales.addRow(['South', { formula: 'B2*2', result: 2400 }]);
  wb.addWorksheet('Empty');
  writeFileSync(p('book.xlsx'), Buffer.from(await wb.xlsx.writeBuffer()));

  writeFileSync(p('data.csv'), 'id,name,note\n1,Ann,"says ""hi"", twice"\n2,Bo,"two\nlines"\n');
  writeFileSync(p('notes.txt'), Array.from({ length: 130 }, (_, i) => `line ${i + 1}`).join('\n'));
  writeFileSync(p('config.json'), '{"a":1,"b":{"c":[1,2]}}');
  writeFileSync(p('empty.txt'), '   \n');
  writeFileSync(p('image.png'), 'x');
  writeFileSync(p('broken.pdf'), 'not a pdf');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('readDocument', () => {
  it('reads a PDF page by page', async () => {
    const d = await readDocument(p('contract.pdf'));
    expect(d.kind).toBe('pdf');
    expect(d.units.map((u) => u.label)).toEqual(['page 1', 'page 2', 'page 3']);
    expect(d.units[1]!.text).toContain('terminate on 30 days written notice');
    expect(d.units[2]!.text).toContain('4,500 dollars per month');
    expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('splits a Word document at its headings, and into parts when there are none', async () => {
    const d = await readDocument(p('terms.docx'));
    expect(d.units.map((u) => u.label)).toEqual(['section "Scope"', 'section "Termination"']);
    expect(d.units[1]!.text).toContain('Notice of 60 days is required.');
    expect((await readDocument(p('plain.docx'))).units[0]).toMatchObject({ label: 'part 1' });
  });

  it('reads spreadsheets by sheet, showing what cells display', async () => {
    const d = await readDocument(p('book.xlsx'));
    expect(d.units).toHaveLength(1); // the empty sheet has no text
    expect(d.units[0]!.label).toBe('sheet "Sales"');
    expect(d.units[0]!.text).toBe('Region\tRevenue\nNorth\t1200\nSouth\t2400');
  });

  it('keeps CSV, text and JSON as the file has them, in numbered blocks', async () => {
    const csv = await readDocument(p('data.csv'));
    expect(csv.units[0]!.text).toContain('2,Bo,"two\nlines"');
    expect(csv.units[0]!.label).toMatch(/^lines /);
    const txt = await readDocument(p('notes.txt'));
    expect(txt.units.map((u) => u.label)).toEqual(['lines 1-60', 'lines 61-120', 'lines 121-130']);
    expect(txt.units[2]!.n).toBe(3);
    expect((await readDocument(p('config.json'))).units[0]!.text).toContain('"c": [');
  });

  it('refuses unsupported, missing, empty and unreadable files with a clear reason', async () => {
    await expect(readDocument(p('image.png'))).rejects.toMatchObject({ code: 'unsupported' });
    await expect(readDocument(p('nope.pdf'))).rejects.toMatchObject({ code: 'unreadable' });
    await expect(readDocument(p('empty.txt'))).rejects.toMatchObject({ code: 'empty' });
    await expect(readDocument(p('broken.pdf'))).rejects.toBeInstanceOf(DocumentError);
    await expect(readDocument(dir + '/')).rejects.toBeInstanceOf(DocumentError);
  });

  it('follows a link to its real file for the size check but keeps the name given', async () => {
    symlinkSync(p('notes.txt'), p('link.txt'));
    expect((await readDocument(p('link.txt'), 'shown.txt')).name).toBe('shown.txt');
  });
});

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, embedded newlines, other delimiters and a BOM', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n"l1\nl2",z')).toEqual([['a', 'b'], ['x, y', 'he said "hi"'], ['l1\nl2', 'z']]);
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('﻿a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\r\n1,2\r\n\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('')).toEqual([]);
  });
});
