import { describe, expect, it } from 'vitest';
import { checkNumbers, extractNumbers } from '../../src/verify/numbers.js';
import { findQuote, normalizeForMatch, passageAround } from '../../src/verify/text-match.js';

const SNAP = 'The Moon’s average distance from Earth is 384,400 km — about 30 Earth diameters.\n\nIt orbits   every 27.3 days.';

describe('findQuote', () => {
  it('finds exact text and reports positions in the original', () => {
    const r = findQuote(SNAP, 'orbits every 27.3 days');
    expect(r.found).toBe(true);
    expect(SNAP.slice(r.start, r.end)).toBe('orbits   every 27.3 days');
  });
  it('ignores case, whitespace, curly quotes and dash types', () => {
    expect(findQuote(SNAP, "THE MOON'S average distance").found).toBe(true);
    expect(findQuote(SNAP, '384,400 km - about 30 earth diameters').found).toBe(true);
    expect(findQuote(SNAP, '384,400 km – about 30 Earth diameters').found).toBe(true);
  });
  it('matches pieces separated by an ellipsis, in order', () => {
    expect(findQuote(SNAP, 'average distance from Earth ... about 30 Earth diameters').found).toBe(true);
    expect(findQuote(SNAP, 'about 30 Earth diameters … average distance from Earth').found).toBe(false);
  });
  it('rejects changed words, changed numbers and invented text', () => {
    expect(findQuote(SNAP, 'average distance from Earth is 384,000 km').found).toBe(false);
    expect(findQuote(SNAP, 'The Moon orbits Earth every 28 days exactly').found).toBe(false);
    expect(findQuote(SNAP, 'average distance from the Earth').found).toBe(false);
  });
  it('rejects quotes too short to mean anything', () => {
    const r = findQuote(SNAP, 'the moon');
    expect(r.found).toBe(false);
    expect(r.reason).toMatch(/too short/);
    expect(findQuote(SNAP, '...').found).toBe(false);
    expect(findQuote(SNAP, '').found).toBe(false);
  });
  it('does not treat reordered or partial words as a match', () => {
    expect(findQuote('abcdefghij klmnop', 'cdefghij klmn').found).toBe(true);
    expect(findQuote('abcdefghij klmnop', 'klmnop abcdefghij').found).toBe(false);
  });
  it('maps positions correctly when invisible characters and folding change lengths', () => {
    const s = 'x​ y ﬁnal result of the study was published';
    const r = findQuote(s, 'final result of the study');
    expect(r.found).toBe(true);
    expect(s.slice(r.start, r.end)).toBe('ﬁnal result of the study');
  });
});

describe('normalizeForMatch and passageAround', () => {
  it('normalises consistently', () => {
    expect(normalizeForMatch('  A “b”\n c…  ')).toBe('a "b" c...');
  });
  it('adds context and marks truncation', () => {
    const text = 'a'.repeat(1000) + 'QUOTE' + 'b'.repeat(1000);
    const p = passageAround(text, 1000, 1005, 10);
    expect(p).toBe('...' + 'a'.repeat(10) + 'QUOTE' + 'b'.repeat(10) + '...');
    expect(passageAround('short', 0, 5)).toBe('short');
  });
});

describe('extractNumbers', () => {
  it.each([
    ['$5.2 billion', 5.2e9], ['5,200,000,000', 5.2e9], ['5.2bn', 5.2e9], ['384,400 km', 384400], ['27.3 days', 27.3],
    ['12 million people', 12e6], ['3k', 3000], ['1 234 567', 1234567], ['.5', 0.5], ['2023', 2023],
  ])('reads %s', (text, value) => expect(extractNumbers(text)[0]?.value).toBe(value));
  it('flags percentages and ignores digits inside words', () => {
    expect(extractNumbers('grew 12% and 3 percent')).toMatchObject([{ value: 12, percent: true }, { value: 3, percent: true }]);
    expect(extractNumbers('COVID19 abc123def')).toEqual([]);
  });
});

describe('checkNumbers', () => {
  it('passes when every claim number is in the passage, in any formatting', () => {
    expect(checkNumbers('The market was $5.2 billion in 2023', 'valued at 5,200,000,000 dollars in 2023').ok).toBe(true);
  });
  it('fails on changed, rounded or invented numbers', () => {
    expect(checkNumbers('Sales were 5 billion', 'Sales were 4.97 billion').ok).toBe(false);
    const r = checkNumbers('Up 12% to 400', 'Up 12% to 40');
    expect(r.ok).toBe(false);
    expect(r.missing.map((m) => m.value)).toEqual([400]);
  });
  it('does not let a plain number stand in for a percentage', () => {
    expect(checkNumbers('Rose 12%', 'There were 12 cases').ok).toBe(false);
    expect(checkNumbers('There were 12 cases', 'Rose 12%').ok).toBe(true);
  });
  it('passes claims with no numbers', () => {
    expect(checkNumbers('The law took effect', 'anything').ok).toBe(true);
  });
});

describe('locators are not figures', () => {
  it('ignores page, clause and table references in the claim', () => {
    expect(checkNumbers('Clause 2 (Fees), page 2: the Client pays 8,200 dollars a month.', 'the Client shall pay a monthly fee of 8,200 dollars').ok).toBe(true);
    expect(checkNumbers('Under section 4.1(a) and 4.2 the cap is 12 months.', 'capped at the fees paid in the preceding 12 months').ok).toBe(true);
    expect(checkNumbers('See Table 3 and pages 5-7 and § 9.', 'nothing numeric here').ok).toBe(true);
  });
  it('still checks the figures next to a locator', () => {
    expect(checkNumbers('On page 2 the fee is 9,000 dollars.', 'the fee is 8,200 dollars').ok).toBe(false);
  });
});

describe('year and date context', () => {
  it('treats a year the quote does not mention as context, not as a wrong figure', () => {
    const r = checkNumbers('In 2024, packs averaged $97/kWh.', 'packs averaged $97/kWh');
    expect(r).toMatchObject({ ok: true, missing: [] });
    expect(r.contextMissing.map((x) => x.value)).toEqual([2024]);
    expect(checkNumbers('BNEF found in its 27 Nov 2023 survey that prices fell 14%.', 'prices fell 14%').contextMissing.map((x) => x.value)).toEqual([27, 2023]);
  });
  it('still rejects a different year when the quote names one, and any wrong figure', () => {
    expect(checkNumbers('Sent in 1979.', 'The first message was sent in 1969').ok).toBe(false);
    expect(checkNumbers('In 2024, packs averaged $98/kWh.', 'packs averaged $97/kWh').ok).toBe(false);
  });
  it('does not treat ordinary numbers that look like days as context', () => {
    expect(checkNumbers('There were 27 cases.', 'There were 28 cases.').ok).toBe(false);
  });
});

describe('known limit: numbers written as words', () => {
  it('are not compared by the code check (the independent checker has to catch them)', () => {
    expect(checkNumbers('Demand will grow fivefold', 'Demand is projected to triple').ok).toBe(true);
    expect(extractNumbers('one hundred and twelve')).toEqual([]);
  });
});
