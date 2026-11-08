import { describe, expect, it } from 'vitest';
import { decodeEntities, extractHtml, extractText, normalizeWhitespace } from '../../src/tools/extract.js';

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('Tom &amp; Jerry &mdash; &#8220;hi&#8221; &#x41; &eacute;')).toBe('Tom & Jerry — “hi” A é');
  });
  it('leaves unknown names alone and replaces invalid code points', () => {
    expect(decodeEntities('&bogus; &#0; &#xD800; &#1114112;')).toBe('&bogus; � � �');
  });
});

describe('normalizeWhitespace', () => {
  it('collapses spaces and blank lines and treats non-breaking spaces as spaces', () => {
    expect(normalizeWhitespace('a    b\r\n\r\n\r\n\r\nc\t d  ')).toBe('a b\n\nc d');
  });
});

describe('extractHtml', () => {
  const page = `<!doctype html><html><head><title>Sea &amp; Tides | Site</title>
    <meta property="article:published_time" content="2024-03-05T10:00:00Z">
    <script>var secret = "never shown";</script><style>p { color: red }</style></head>
    <body><nav><a href="/">Home</a> <a href="/about">About</a></nav>
    <header>Site banner</header>
    <main><h1>Tides explained</h1>
      <p>The Moon&#39;s pull   causes tides.</p><p>Spring tides occur at new <b>and</b> full moon.</p>
      <ul><li>One</li><li>Two</li></ul><table><tr><td>Rise</td><td>06:12</td></tr></table>
      <!-- hidden comment --><noscript>Enable JavaScript</noscript>
    </main><aside>Related links</aside><footer>Copyright</footer>
    <script>document.write("also never shown")</script></body></html>`;
  const r = extractHtml(page);

  it('keeps the readable content, in order, with line breaks', () => {
    expect(r.text).toBe("Tides explained\nThe Moon's pull causes tides.\nSpring tides occur at new and full moon.\nOne\nTwo\nRise 06:12");
  });
  it('drops scripts, styles, comments, navigation and page furniture', () => {
    for (const bad of ['secret', 'never shown', 'color', 'hidden comment', 'Enable JavaScript', 'Home', 'banner', 'Related', 'Copyright']) {
      expect(r.text).not.toContain(bad);
    }
  });
  it('reads the title and the declared publication date', () => {
    expect(r.title).toBe('Sea & Tides | Site');
    expect(r.publishedAt).toBe('2024-03-05T10:00:00Z');
  });
  it('is deterministic', () => {
    expect(extractHtml(page)).toEqual(r);
  });
  it('falls back to the whole body when there is no main or article', () => {
    expect(extractHtml('<body><div>Plain</div><div>page</div></body>').text).toBe('Plain\npage');
  });
  it('uses article elements when there is no main', () => {
    expect(extractHtml('<body><div>menu</div><article>Story one</article><article>Story two</article></body>').text).toBe('Story one\nStory two');
  });
  it('finds dates in JSON-LD and <time>', () => {
    expect(extractHtml('<script type="application/ld+json">{"datePublished":"2023-01-02"}</script><body>x</body>').publishedAt).toBe('2023-01-02');
    expect(extractHtml('<body><time datetime="2022-05-06">May</time></body>').publishedAt).toBe('2022-05-06');
  });
  it('survives broken markup', () => {
    expect(extractHtml('<p>one<p>two <b>bold').text).toBe('one\ntwo bold');
    expect(extractHtml('').text).toBe('');
  });
});

describe('extractText', () => {
  it('handles plain text and honours the declared charset', () => {
    expect(extractText(Buffer.from('a  b\n\n\n\nc'), 'text/plain').text).toBe('a b\n\nc');
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
    expect(extractText(latin1, 'text/plain', 'text/plain; charset=iso-8859-1').text).toBe('café');
  });
  it('reads a charset declared inside the page and ignores unknown labels', () => {
    const html = Buffer.concat([Buffer.from('<meta charset="windows-1252"><body>caf'), Buffer.from([0xe9]), Buffer.from('</body>')]);
    expect(extractText(html, 'text/html').text).toBe('café');
    expect(extractText(Buffer.from('ok'), 'text/plain', 'text/plain; charset=nonsense').text).toBe('ok');
  });
});
