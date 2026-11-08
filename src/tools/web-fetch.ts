import { createHash } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { BlockedError, checkUrl, resolvePublic, systemResolver, type GuardRules, type Resolver } from './net-guard.js';

export type FetchErrorKind =
  | 'invalid_url' | 'blocked' | 'dns' | 'timeout' | 'aborted' | 'too_large'
  | 'bad_status' | 'bad_content_type' | 'too_many_redirects' | 'network';

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
}

export type FetchResult =
  | {
      ok: true;
      /** The address finally fetched, after redirects. */
      url: string;
      status: number;
      contentType: string;
      body: Buffer;
      sha256: string;
      /** Every address visited, in order, starting with the one requested. */
      chain: string[];
      fetchedAt: string;
    }
  | { ok: false; kind: FetchErrorKind; message: string; status?: number; chain: string[] };

export interface FetcherDeps extends GuardRules {
  resolver?: Resolver;
}

const DEFAULTS = { timeoutMs: 20_000, maxBytes: 5 * 1024 * 1024, maxRedirects: 5 };
export const USER_AGENT = 'veritas-fetch/1.0';

/** What a source may be. PDFs and other binary formats are not supported yet. */
const ALLOWED_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown', 'application/json'];

const baseType = (header: string | undefined): string => (header ?? '').split(';')[0]!.trim().toLowerCase();

class Failure extends Error {
  constructor(readonly kind: FetchErrorKind, message: string, readonly status?: number) { super(message); }
}

interface Hop {
  status: number;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

function requestOnce(url: URL, ip: string, opts: Required<Omit<FetchOptions, 'signal'>> & { signal?: AbortSignal }): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === 'https:';
    const family = isIP(ip);
    let settled = false;
    const finish = (fn: () => void): void => { if (!settled) { settled = true; clearTimeout(timer); opts.signal?.removeEventListener('abort', onAbort); fn(); } };
    const req = (secure ? httpsRequest : httpRequest)(url, {
      method: 'GET',
      agent: false,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.1', 'Accept-Encoding': 'gzip, deflate, br' },
      // Connect to the address we already checked, not to whatever DNS says a moment later.
      lookup: (_host, options, cb) => {
        const done = cb as unknown as (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void;
        if ((options as { all?: boolean })?.all) done(null, [{ address: ip, family }]);
        else done(null, ip, family);
      },
      ...(secure ? { servername: isIP(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname } : {}),
    }, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (c: Buffer) => {
        total += c.length;
        if (total > opts.maxBytes) { finish(() => reject(new Failure('too_large', `The page is larger than ${opts.maxBytes} bytes`))); req.destroy(); return; }
        chunks.push(c);
      });
      res.on('end', () => finish(() => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) })));
      res.on('error', (e) => finish(() => reject(new Failure('network', e.message))));
      res.on('aborted', () => finish(() => reject(new Failure('network', 'The connection was closed early'))));
    });
    const timer = setTimeout(() => { finish(() => reject(new Failure('timeout', `No complete answer within ${opts.timeoutMs} ms`))); req.destroy(); }, opts.timeoutMs);
    const onAbort = (): void => { finish(() => reject(new Failure('aborted', 'Cancelled'))); req.destroy(); };
    if (opts.signal?.aborted) return onAbort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', (e) => finish(() => reject(new Failure('network', e.message))));
    req.end();
  });
}

function decode(hop: Hop, maxBytes: number): Buffer {
  const enc = String(hop.headers['content-encoding'] ?? 'identity').toLowerCase().trim();
  if (enc === 'identity' || enc === '') return hop.body;
  const limit = { maxOutputLength: maxBytes };
  try {
    if (enc === 'gzip' || enc === 'x-gzip') return gunzipSync(hop.body, limit);
    if (enc === 'deflate') return inflateSync(hop.body, limit);
    if (enc === 'br') return brotliDecompressSync(hop.body, limit);
  } catch (e) {
    const tooBig = e instanceof RangeError || (e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE';
    throw new Failure(tooBig ? 'too_large' : 'network', tooBig ? `The page is larger than ${maxBytes} bytes once unpacked` : 'The page could not be unpacked');
  }
  throw new Failure('bad_content_type', `Unsupported content encoding: ${enc}`);
}

/**
 * Build a fetcher. Every hop, including each redirect, is checked from scratch:
 * scheme, port, name, every resolved address, and the connection is pinned to
 * the address that was checked.
 */
export function createFetcher(deps: FetcherDeps = {}) {
  const resolver = deps.resolver ?? systemResolver;

  return async function fetchUrl(rawUrl: string, options: FetchOptions = {}): Promise<FetchResult> {
    const opts = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) } as Required<Omit<FetchOptions, 'signal'>> & { signal?: AbortSignal };
    const chain: string[] = [];
    let current = rawUrl;
    try {
      for (let hop = 0; hop <= opts.maxRedirects; hop++) {
        const url = checkUrl(current, deps);
        chain.push(url.href);
        const [ip] = await resolvePublic(url.hostname, resolver, deps.isBlockedIp);
        if (!ip) throw new BlockedError(`${url.hostname} has no address`, 'dns');

        const res = await requestOnce(url, ip, opts);

        if (res.status >= 300 && res.status < 400 && res.headers.location) {
          try { current = new URL(String(res.headers.location), url).href; } catch { throw new Failure('invalid_url', 'The page redirected to an invalid address'); }
          continue;
        }
        if (res.status < 200 || res.status >= 300) throw new Failure('bad_status', `The server answered ${res.status}`, res.status);

        const type = baseType(res.headers['content-type'] as string | undefined);
        if (!ALLOWED_TYPES.includes(type)) throw new Failure('bad_content_type', `Unsupported content type: ${type || 'none given'}`, res.status);
        const body = decode(res, opts.maxBytes);
        return {
          ok: true, url: url.href, status: res.status, contentType: type, body,
          sha256: createHash('sha256').update(body).digest('hex'), chain, fetchedAt: new Date().toISOString(),
        };
      }
      throw new Failure('too_many_redirects', `More than ${opts.maxRedirects} redirects`);
    } catch (e) {
      if (e instanceof BlockedError) return { ok: false, kind: e.code, message: e.message, chain };
      if (e instanceof Failure) return { ok: false, kind: e.kind, message: e.message, status: e.status, chain };
      return { ok: false, kind: 'network', message: e instanceof Error ? e.message : String(e), chain };
    }
  };
}

/** The strict fetcher used everywhere in Veritas. */
export const fetchUrl = createFetcher();
