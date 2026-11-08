import { describe, expect, it } from 'vitest';
import { validateFindings } from '../../src/research/findings.js';

const f = (over = {}) => ({ claim: 'The Moon is 384,400 km away.', type: 'number', url: 'https://nasa.gov/m', title: 'Moon', quote: 'average distance of 384,400 km', important: true, ...over });

describe('validateFindings', () => {
  it('accepts well-formed findings and trims them', () => {
    const r = validateFindings({ findings: [f({ claim: '  x  ', publishedAt: ' 2024-01-01 ' })], notes: 'n' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.findings[0]).toMatchObject({ claim: 'x', publishedAt: '2024-01-01', important: true });
  });
  it('accepts an empty list', () => {
    expect(validateFindings({ findings: [], notes: '' }).ok).toBe(true);
  });
  it.each([
    ['not an object', 'x'], ['no list', { findings: 'nope' }], ['empty claim', { findings: [f({ claim: ' ' })] }],
    ['bad type', { findings: [f({ type: 'opinion' })] }], ['file url', { findings: [f({ url: 'file:///etc/passwd' })] }],
    ['no quote', { findings: [f({ quote: '' })] }], ['too many', { findings: Array.from({ length: 31 }, () => f()) }],
  ])('rejects %s', (_n, v) => expect(validateFindings(v).ok).toBe(false));
});
