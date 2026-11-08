import { describe, expect, it } from 'vitest';
import { BlockedError, checkUrl, isBlockedHostname, isBlockedIp, resolvePublic } from '../../src/tools/net-guard.js';

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '198.18.0.1', '198.19.255.255', '192.0.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255', '203.0.113.5',
    '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', 'fd00::1', 'fc00::1',
    'fe80::1', 'fe80::1%en0', 'fec0::1', 'ff02::1', '64:ff9b::7f00:1', '2002:7f00:1::1', '2001:db8::1', '2001::1', '::7f00:1',
    'not-an-ip', '1.2.3', '::g',
  ])('blocks %s', (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each([
    '8.8.8.8', '93.184.216.34', '172.15.0.1', '172.32.0.1', '100.63.255.255', '198.17.0.1', '1.1.1.1',
    '2606:4700:4700::1111', '2a00:1450:4001:81b::200e', '::ffff:8.8.8.8', '64:ff9b::808:808',
  ])('allows %s', (ip) => expect(isBlockedIp(ip)).toBe(false));
});

describe('isBlockedHostname', () => {
  it.each(['localhost', 'localhost.', 'LOCALHOST', 'app.localhost', 'printer.local', 'db.internal', 'router.lan', 'intranet', 'x.home.arpa'])('blocks %s', (h) => {
    expect(isBlockedHostname(h)).toBe(true);
  });
  it.each(['example.com', 'sub.example.co.uk', 'localhost.example.com'])('allows %s', (h) => expect(isBlockedHostname(h)).toBe(false));
});

describe('checkUrl', () => {
  it.each([
    'http://127.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/', 'http://169.254.169.254/latest/meta-data',
    'http://localhost./', 'http://localhost:80/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://0177.0.0.1/', 'http://127.1/',
    'http://example.com:22/', 'http://user:pw@example.com/', 'file:///etc/passwd', 'ftp://example.com/', 'javascript:alert(1)', 'not a url',
    'http://10.1.1.1:8080/',
  ])('refuses %s', (u) => expect(() => checkUrl(u)).toThrow(BlockedError));

  it.each(['https://example.com/a?b=1', 'http://93.184.216.34/', 'https://[2606:4700:4700::1111]/', 'https://example.com:8443/'])('accepts %s', (u) => {
    expect(checkUrl(u).hostname).toBeTruthy();
  });
});

describe('resolvePublic', () => {
  it('returns addresses when all are public', async () => {
    expect(await resolvePublic('example.com', async () => ['93.184.216.34', '2606:4700:4700::1111'])).toHaveLength(2);
  });
  it('refuses a name that maps to an internal address, even among public ones', async () => {
    await expect(resolvePublic('evil.example', async () => ['93.184.216.34', '10.0.0.5'])).rejects.toMatchObject({ code: 'blocked' });
  });
  it('refuses names that map to loopback via IPv6-mapped form', async () => {
    await expect(resolvePublic('evil.example', async () => ['::ffff:127.0.0.1'])).rejects.toBeInstanceOf(BlockedError);
  });
  it('reports lookup failures and empty answers', async () => {
    await expect(resolvePublic('x.example', async () => { throw new Error('ENOTFOUND'); })).rejects.toMatchObject({ code: 'dns' });
    await expect(resolvePublic('x.example', async () => [])).rejects.toMatchObject({ code: 'dns' });
  });
  it('checks IP literals directly', async () => {
    await expect(resolvePublic('[::1]', async () => ['8.8.8.8'])).rejects.toBeInstanceOf(BlockedError);
    expect(await resolvePublic('8.8.8.8')).toEqual(['8.8.8.8']);
  });
});
