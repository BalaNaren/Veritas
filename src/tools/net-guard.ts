import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Reasons a request is refused before any connection is made. */
export class BlockedError extends Error {
  constructor(message: string, readonly code: 'invalid_url' | 'blocked' | 'dns') {
    super(message);
    this.name = 'BlockedError';
  }
}

type Cidr4 = readonly [string, number];

/** IPv4 ranges that are not the public internet. */
const BLOCKED_V4: readonly Cidr4[] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function v4ToInt(ip: string): number {
  const p = ip.split('.').map(Number);
  return ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
}

const isBlockedV4 = (ip: string): boolean => {
  const n = v4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
  });
};

/** Expand an IPv6 address to 8 groups of 16 bits. Returns null if it is malformed. */
function parseV6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  // Embedded IPv4 in the last 32 bits (::ffff:1.2.3.4).
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (isIP(tail) !== 4) return null;
    const n = v4ToInt(tail);
    text = `${text.slice(0, lastColon + 1)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...(halves.length === 2 ? Array(missing).fill('0') : []), ...rest];
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return out.length === 8 && out.every((g) => !Number.isNaN(g)) ? out : null;
}

const embeddedV4 = (g: number[]): string => `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;

function isBlockedV6(ip: string): boolean {
  const g = parseV6(ip);
  if (!g) return true; // anything we cannot parse is refused
  const allZeroUntil = (n: number): boolean => g.slice(0, n).every((x) => x === 0);
  if (allZeroUntil(7) && (g[7] === 0 || g[7] === 1)) return true;             // :: and ::1
  if (allZeroUntil(5) && g[5] === 0xffff) return isBlockedV4(embeddedV4(g));    // IPv4-mapped
  if (allZeroUntil(6)) return true;                                              // IPv4-compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedV4(embeddedV4(g)); // NAT64
  if (g[0] === 0x2002) return isBlockedV4(`${g[1]! >> 8}.${g[1]! & 255}.${g[2]! >> 8}.${g[2]! & 255}`);          // 6to4
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;     // discard-only 100::/64
  if (g[0] === 0x2001 && (g[1]! < 0x200 || g[1] === 0xdb8)) return true;         // 2001::/23 (incl. Teredo) and documentation
  if ((g[0]! & 0xfe00) === 0xfc00) return true;                                  // unique local fc00::/7
  if ((g[0]! & 0xffc0) === 0xfe80) return true;                                  // link-local fe80::/10
  if ((g[0]! & 0xffc0) === 0xfec0) return true;                                  // site-local fec0::/10
  if ((g[0]! & 0xff00) === 0xff00) return true;                                  // multicast
  return false;
}

/** True when the address must never be contacted. Unparseable addresses count as blocked. */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedV4(ip);
  if (kind === 6) return isBlockedV6(ip);
  return true;
}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.localdomain', '.internal', '.intranet', '.lan', '.home.arpa'];

/** Names that point inside a network; refused without asking DNS. */
export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.+$/, '');
  if (!h || h === 'localhost') return true;
  return BLOCKED_SUFFIXES.some((s) => h.endsWith(s)) || !h.includes('.') && isIP(h) === 0;
}

const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

export interface GuardRules {
  /** Replaces the address check. Only tests pass this, to reach a server on this machine. */
  isBlockedIp?: (ip: string) => boolean;
  /** Replaces the allowed ports. Only tests pass this. */
  allowedPorts?: ReadonlySet<number>;
}

/** Check a URL for scheme, credentials, port and obviously internal names. IP literals are checked too. */
export function checkUrl(raw: string, rules: GuardRules = {}): URL {
  const blocked = rules.isBlockedIp ?? isBlockedIp;
  let url: URL;
  try { url = new URL(raw); } catch { throw new BlockedError(`Not a valid URL: ${raw}`, 'invalid_url'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedError(`Only http and https links are allowed (got ${url.protocol})`, 'invalid_url');
  if (url.username || url.password) throw new BlockedError('Links with a username or password are not allowed', 'invalid_url');
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!(rules.allowedPorts ?? ALLOWED_PORTS).has(port)) throw new BlockedError(`Port ${port} is not allowed`, 'blocked');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (blocked(host)) throw new BlockedError(`${host} is not a public address`, 'blocked');
  } else if (isBlockedHostname(host)) {
    throw new BlockedError(`${host} is an internal name`, 'blocked');
  }
  return url;
}

export type Resolver = (host: string) => Promise<string[]>;

export const systemResolver: Resolver = async (host) => {
  const found = await dnsLookup(host, { all: true, verbatim: true });
  return found.map((f) => f.address);
};

/**
 * Resolve a host and make sure every address it maps to is public. If any one is
 * not, the whole host is refused, so a name cannot hide an internal address among
 * public ones. Returns the addresses to connect to.
 */
export async function resolvePublic(host: string, resolver: Resolver = systemResolver, blocked: (ip: string) => boolean = isBlockedIp): Promise<string[]> {
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare)) {
    if (blocked(bare)) throw new BlockedError(`${bare} is not a public address`, 'blocked');
    return [bare];
  }
  let addresses: string[];
  try { addresses = await resolver(bare); } catch (e) {
    throw new BlockedError(`Could not look up ${bare}: ${e instanceof Error ? e.message : String(e)}`, 'dns');
  }
  if (!addresses.length) throw new BlockedError(`${bare} has no address`, 'dns');
  const bad = addresses.find(blocked);
  if (bad) throw new BlockedError(`${bare} points to a non-public address (${bad})`, 'blocked');
  return addresses;
}
