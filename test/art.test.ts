import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(import.meta.dirname, '..', 'docs', 'assets');
const svgs = readdirSync(dir).filter((f) => f.endsWith('.svg')).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

describe('README graphics', () => {
  it('has the graphics the README uses', () => {
    const readme = readFileSync(join(import.meta.dirname, '..', 'README.md'), 'utf8');
    for (const [, ref] of readme.matchAll(/src="(docs\/assets\/[^"]+)"/g)) expect(readdirSync(dir)).toContain(ref!.replace('docs/assets/', ''));
  });

  it.each(svgs)('%s is safe to show anywhere: no scripts, no outside links, no embedded web content', (_name, svg) => {
    expect(svg).not.toMatch(/<script|foreignObject|href="https?:|xlink:href="https?:|@import|url\(https?:/i);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect((svg.match(/<svg/g) ?? []).length).toBe(1);
  });

  it.each(svgs)('%s gives every line of text an explicit width, so a wider fallback font cannot make it overflow', (name, svg) => {
    const missing: string[] = [];
    for (const m of svg.matchAll(/<text([^>]*)>([^<]+)<\/text>/g)) {
      const attrs = m[1]!;
      const text = m[2]!;
      if (/font-family="[^"]*monospace/.test(attrs) && !attrs.includes('font-size')) continue;
      if ([...text].length >= 3 && /font-size="/.test(attrs) && !/textLength=/.test(attrs) && !/font-family="[^"]*Menlo/.test(attrs)) missing.push(text);
    }
    expect(missing, name).toEqual([]);
  });

  it('shows the capability cards as small separate images, near their real size, with nothing moving', () => {
    for (const name of ['card-trust', 'card-speed', 'card-files', 'card-control']) {
      const svg = readFileSync(join(dir, `${name}.svg`), 'utf8');
      expect(svg, name).toContain('viewBox="0 0 448 232"');
      expect(svg, name).not.toMatch(/<animate/);
      // Text is never blurred: the glow filter is used only on the border and the icon.
      for (const m of svg.matchAll(/<text[^>]*>/g)) expect(m[0], name).not.toContain('filter=');
    }
  });
});
