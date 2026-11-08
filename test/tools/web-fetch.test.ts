import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isBlockedIp } from '../../src/tools/net-guard.js';
import { createFetcher } from '../../src/tools/web-fetch.js';

let server: Server;
let port = 0;
const hosts: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    hosts.push(String(req.headers.host));
    const path = req.url ?? '/';
    const send = (status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}): void => {
      res.writeHead(status, { 'Content-Type': type, ...extra });
      res.end(body);
    };
    if (path === '/page') return send(200, 'text/html; charset=utf-8', '<html><body>Hello</body></html>');
    if (path === '/missing') return send(404, 'text/html', 'nope');
    if (path === '/r1') return send(302, 'text/html', '', { Location: '/r2' });
    if (path === '/r2') return send(301, 'text/html', '', { Location: '/page' });
    if (path === '/loop') return send(302, 'text/html', '', { Location: '/loop' });
    if (path === '/to-private-ip') return send(302, 'text/html', '', { Location: `http://10.0.0.5:${port}/page` });
    if (path === '/to-private-name') return send(302, 'text/html', '', { Location: `http://evil.test:${port}/page` });
    if (path === '/to-metadata') return send(302, 'text/html', '', { Location: 'http://169.254.169.254/latest/meta-data/' });
    if (path === '/to-file') return send(302, 'text/html', '', { Location: 'file:///etc/passwd' });
    if (path === '/pdf') return send(200, 'application/pdf', '%PDF-1.4');
    if (path === '/image') return send(200, 'image/png', 'x');
    if (path === '/gzip') return send(200, 'text/plain', gzipSync('zipped text'), { 'Content-Encoding': 'gzip' });
    if (path === '/bomb') return send(200, 'text/plain', gzipSync(Buffer.alloc(8 * 1024 * 1024)), { 'Content-Encoding': 'gzip' });
    if (path === '/big') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      const chunk = 'x'.repeat(65536);
      let n = 0;
      const pump = (): void => { while (n++ < 100) { if (!res.write(chunk)) { res.once('drain', pump); return; } } res.end(); };
      pump();
      return;
    }
    if (path === '/hang') return; // never answers
    send(200, 'text/plain', 'default');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => { server.closeAllConnections(); server.close(); });

/** Names resolve to loopback (the test server) except evil.test, which resolves to a private address. */
const make = (resolver?: (h: string) => Promise<string[]>) => createFetcher({
  resolver: resolver ?? (async (h) => (h === 'evil.test' ? ['10.0.0.5'] : ['127.0.0.1'])),
  isBlockedIp: (ip) => ip !== '127.0.0.1' && isBlockedIp(ip),
  allowedPorts: new Set([port]),
});
const url = (p: string): string => `http://public.test:${port}${p}`;

describe('fetchUrl', () => {
  it('fetches a page and reports the hash of exactly what it received', async () => {
    const r = await make()(url('/page'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.toString()).toContain('Hello');
      expect(r.contentType).toBe('text/html');
      expect(r.sha256).toBe(createHash('sha256').update(r.body).digest('hex'));
      expect(r.chain).toEqual([url('/page')]);
    }
  });

  it('follows redirects and records the chain', async () => {
    const r = await make()(url('/r1'));
    expect(r.ok).toBe(true);
    expect(r.chain).toEqual([url('/r1'), url('/r2'), url('/page')]);
  });

  it('stops redirect loops', async () => {
    expect(await make()(url('/loop'), { maxRedirects: 3 })).toMatchObject({ ok: false, kind: 'too_many_redirects' });
  });

  it.each([
    ['a private address', '/to-private-ip'],
    ['a name that resolves to a private address', '/to-private-name'],
    ['the cloud metadata address', '/to-metadata'],
    ['a file link', '/to-file'],
  ])('refuses a redirect to %s', async (_n, path) => {
    const r = await make()(url(path));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['blocked', 'invalid_url']).toContain(r.kind);
  });

  it('connects to the address it checked, not one DNS returns later', async () => {
    let calls = 0;
    const r = await make(async () => (calls++ === 0 ? ['127.0.0.1'] : ['10.0.0.1']))(url('/page'));
    expect(r.ok).toBe(true);
    expect(calls).toBe(1);
    expect(hosts.at(-1)).toBe(`public.test:${port}`);
  });

  it('reports HTTP errors and unsupported types', async () => {
    expect(await make()(url('/missing'))).toMatchObject({ ok: false, kind: 'bad_status', status: 404 });
    expect(await make()(url('/pdf'))).toMatchObject({ ok: false, kind: 'bad_content_type' });
    expect(await make()(url('/image'))).toMatchObject({ ok: false, kind: 'bad_content_type' });
  });

  it('decodes compressed pages but refuses a compression bomb', async () => {
    const ok = await make()(url('/gzip'));
    expect(ok.ok && ok.body.toString()).toBe('zipped text');
    expect(await make()(url('/bomb'), { maxBytes: 1024 * 1024 })).toMatchObject({ ok: false, kind: 'too_large' });
  });

  it('stops reading at the size limit', async () => {
    const t = Date.now();
    expect(await make()(url('/big'), { maxBytes: 1024 * 1024 })).toMatchObject({ ok: false, kind: 'too_large' });
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it('times out and can be cancelled', async () => {
    expect(await make()(url('/hang'), { timeoutMs: 200 })).toMatchObject({ ok: false, kind: 'timeout' });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    expect(await make()(url('/hang'), { signal: ac.signal })).toMatchObject({ ok: false, kind: 'aborted' });
  });

  it('reports lookup failures', async () => {
    const r = await make(async () => { throw new Error('ENOTFOUND'); })(url('/page'));
    expect(r).toMatchObject({ ok: false, kind: 'dns' });
  });

  it('with the default rules refuses everything local without connecting', async () => {
    const strict = createFetcher();
    for (const u of [`http://127.0.0.1:${port}/page`, 'http://localhost/', 'http://[::1]/', 'http://169.254.169.254/', 'file:///etc/passwd']) {
      const r = await strict(u);
      expect(r.ok).toBe(false);
    }
    expect(hosts.filter((h) => h.startsWith('127.0.0.1'))).toHaveLength(0);
  });
});
