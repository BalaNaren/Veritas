import { describe, expect, it } from 'vitest';
import { MemoryStore, toFtsQuery } from '../../src/memory/memory-store.js';
import { Store } from '../../src/storage/store.js';

const make = () => new MemoryStore(Store.open(':memory:'));

describe('MemoryStore', () => {
  it('remembers an item once per kind and key', () => {
    const m = make();
    expect(m.add('source', 'NASA Moon facts — https://science.nasa.gov/moon/facts/', 'https://science.nasa.gov/moon/facts/')).toBe(true);
    expect(m.add('source', 'same page again', 'https://science.nasa.gov/moon/facts/')).toBe(false);
    expect(m.add('preference', 'same key, other kind', 'https://science.nasa.gov/moon/facts/')).toBe(true);
    expect(m.count()).toBe(2);
    expect(m.add('source', '   ', 'blank')).toBe(false);
  });

  it('finds relevant items by meaning-bearing words, most relevant first, including word forms', () => {
    const m = make();
    m.add('source', 'BloombergNEF battery pack prices survey 2025', 'a');
    m.add('source', 'NASA Moon orbit facts', 'b');
    m.add('source', 'Battery recycling rates in Europe', 'c');
    m.add('preference', 'Which region? Europe', 'd');
    const hits = m.search('How have lithium battery prices changed?');
    expect(hits.map((h) => h.key)).toEqual(expect.arrayContaining(['a', 'c']));
    expect(hits[0]!.key).toBe('a');
    expect(hits.map((h) => h.key)).not.toContain('b');
    expect(m.search('battery', { kind: 'preference' })).toEqual([]);
    expect(m.search('regions in europe', { kind: 'preference' })[0]!.key).toBe('d');
  });

  it('cannot be hurt by search text that looks like query syntax', () => {
    const m = make();
    m.add('source', 'Prices and costs', 'k');
    for (const evil of ['" OR 1=1 --', 'prices NEAR(costs)', '*', 'a" AND "b', '(((', 'col:prices']) expect(() => m.search(evil)).not.toThrow();
    expect(toFtsQuery('Prices "quoted" (x) NOT')).toBe('"prices" OR "quoted" OR "not"');
    expect(toFtsQuery('a b')).toBeNull();
    expect(m.search('')).toEqual([]);
  });

  it('tracks use, forgets one item, and clears everything or one kind', () => {
    const m = make();
    m.add('source', 'one', 'k1'); m.add('preference', 'two', 'k2'); m.add('preference', 'three', 'k3');
    const [first] = m.list('source');
    m.markUsed([first!.id]);
    expect(m.list('source')[0]).toMatchObject({ uses: 1 });
    expect(m.list('source')[0]!.lastUsedAt).not.toBeNull();
    expect(m.forget(first!.id)).toBe(true);
    expect(m.forget(first!.id)).toBe(false);
    expect(m.search('one')).toEqual([]); // the search index forgot it too
    expect(m.clear('preference')).toBe(2);
    expect(m.count()).toBe(0);
    m.add('source', 'x', 'y');
    expect(m.clear()).toBe(1);
  });
});
