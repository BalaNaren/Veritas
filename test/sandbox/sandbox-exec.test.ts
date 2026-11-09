import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProfile, SandboxExecSandbox } from '../../src/sandbox/sandbox-exec.js';

const available = SandboxExecSandbox.available();
const python = available ? execFileSync('python3', ['-c', 'import sys; print(sys.executable)']).toString().trim() : '';

let scratch = '';
let canary = '';
let server: Server;
let port = 0;
const home = homedir();
const homeProbe = join(home, `.veritas-sandbox-probe-${process.pid}`);

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'veritas-sbx-test-'));
  canary = join(scratch, 'secret.txt');
  writeFileSync(canary, 'TOP-SECRET-CANARY');
  writeFileSync(join(scratch, 'data.csv'), 'a,b\n1,2\n3,4\n');
  server = createServer((s) => s.end('hello'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
  process.env.VERITAS_TEST_SECRET = 'should-not-leak';
});
afterAll(() => {
  server.close();
  rmSync(scratch, { recursive: true, force: true });
  rmSync(homeProbe, { force: true });
  delete process.env.VERITAS_TEST_SECRET;
});

const box = (): SandboxExecSandbox => new SandboxExecSandbox({ python });
const run = (code: string, extra: { timeoutMs?: number; inputFiles?: { name: string; path: string }[] } = {}) =>
  box().run({ code, outputDir: join(scratch, `out-${Math.random().toString(36).slice(2)}`), ...extra });

describe.skipIf(!available)('sandbox-exec sandbox', () => {
  it('runs code, captures output and keeps files written under output/ with hashes', async () => {
    const r = await run('import json\nprint("hello")\njson.dump({"total": 42}, open("output/results.json", "w"))');
    expect(r).toMatchObject({ ok: true, exitCode: 0, stdout: 'hello\n', timedOut: false, backend: 'sandbox-exec' });
    expect(r.outputs).toHaveLength(1);
    expect(r.outputs[0]).toMatchObject({ name: 'results.json', bytes: 13 });
    expect(JSON.parse(readFileSync(r.outputs[0]!.path, 'utf8'))).toEqual({ total: 42 });
    expect(r.outputs[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports errors with the traceback and a non-zero exit code', async () => {
    const r = await run('raise ValueError("bad data")');
    expect(r.ok).toBe(false);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('ValueError: bad data');
  });

  it('blocks all network access, including to this machine', async () => {
    const r = await run(`import socket
def attempt(host, port, kind):
    s = socket.socket(socket.AF_INET, kind)
    s.settimeout(3)
    try:
        s.connect((host, port))
        return "CONNECTED"
    except Exception as e:
        return "blocked"
    finally:
        s.close()
print(attempt("127.0.0.1", ${port}, socket.SOCK_STREAM))
print(attempt("1.1.1.1", 53, socket.SOCK_STREAM))
print(attempt("1.1.1.1", 53, socket.SOCK_DGRAM))
try:
    socket.getaddrinfo("example.com", 80); print("RESOLVED")
except Exception:
    print("blocked")
`);
    expect(r.stdout.trim().split('\n')).toEqual(['blocked', 'blocked', 'blocked', 'blocked']);
  });

  it('blocks writing anywhere outside its own folder', async () => {
    const r = await run(`import os
targets = [${JSON.stringify(homeProbe)}, "/tmp/veritas-sandbox-probe", ${JSON.stringify(join(scratch, 'planted.txt'))}, "/private/var/tmp/veritas-sandbox-probe"]
for t in targets:
    try:
        open(t, "w").write("pwned"); print("WROTE", t)
    except Exception:
        print("blocked")
`);
    expect(r.stdout.trim().split('\n')).toEqual(['blocked', 'blocked', 'blocked', 'blocked']);
    expect(existsSync(homeProbe)).toBe(false);
    expect(existsSync(join(scratch, 'planted.txt'))).toBe(false);
    expect(existsSync('/tmp/veritas-sandbox-probe')).toBe(false);
  });

  it('cannot read the user\'s files or home folder', async () => {
    const r = await run(`import os
for t in [${JSON.stringify(canary)}, ${JSON.stringify(home)}, os.path.expanduser("~/.ssh/id_rsa"), "/etc/passwd"]:
    try:
        if os.path.isdir(t): os.listdir(t); print("LISTED", t)
        else: open(t).read(1); print("READ", t)
    except Exception:
        print("blocked")
`);
    expect(r.stdout).not.toContain('READ');
    expect(r.stdout).not.toContain('LISTED');
    expect(r.stdout.trim().split('\n').filter((l) => l === 'blocked')).toHaveLength(4);
  });

  it('sees input files as read-only copies and cannot change the original', async () => {
    const original = join(scratch, 'data.csv');
    const r = await run(`print(open("input/data.csv").read().strip().split("\\n")[1])
try:
    open("input/data.csv", "w").write("changed"); print("WROTE")
except Exception:
    print("blocked")
`, { inputFiles: [{ name: 'data.csv', path: original }] });
    expect(r.stdout.trim().split('\n')).toEqual(['1,2', 'blocked']);
    expect(readFileSync(original, 'utf8')).toBe('a,b\n1,2\n3,4\n');
  });

  it('cannot start other programs', async () => {
    const r = await run(`import subprocess
for cmd in (["/bin/echo", "hi"], ["/usr/bin/curl", "-s", "http://127.0.0.1:${port}/"], ["/bin/sh", "-c", "id"]):
    try:
        subprocess.run(cmd, capture_output=True, timeout=5, check=True); print("RAN", cmd[0])
    except Exception:
        print("blocked")
`);
    expect(r.stdout).not.toContain('RAN');
    expect(r.stdout.trim().split('\n')).toEqual(['blocked', 'blocked', 'blocked']);
  });

  it('gives the code none of the caller\'s environment', async () => {
    const r = await run('import os\nprint(sorted(os.environ))\nprint(os.environ.get("VERITAS_TEST_SECRET"))');
    expect(r.stdout).not.toContain('should-not-leak');
    expect(r.stdout).toContain('None');
    expect(r.stdout).not.toContain('ANTHROPIC');
  });

  it('stops code that runs too long, and does so promptly', async () => {
    const t = Date.now();
    const r = await run('while True:\n    pass', { timeoutMs: 1500 });
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
    expect(Date.now() - t).toBeLessThan(8000);
  });

  it('caps what the code can print', async () => {
    const r = await run('import sys\nfor _ in range(200):\n    sys.stdout.write("x" * 100000)\nsys.stdout.flush()');
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBeLessThanOrEqual(1024 * 1024 + 10);
  });

  it('does not follow links the code leaves in output/, and leaves nothing behind', async () => {
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith('veritas-sbx-')).length;
    const r = await run(`import os
os.symlink("/etc/passwd", "output/link.txt")
open("output/real.txt", "w").write("ok")
`);
    expect(r.outputs.map((o) => o.name)).toEqual(['real.txt']);
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith('veritas-sbx-')).length).toBe(before);
  });
});

describe('sandbox profile', () => {
  it('denies by default, denies the network, and only allows writing in the work folder', () => {
    const p = buildProfile({ workDir: '/tmp/work', readRoots: ['/opt/py'], executables: ['/opt/py/bin/python3'] });
    expect(p).toContain('(deny default)');
    expect(p).toContain('(deny network*)');
    expect(p).toContain('(allow file-write* (subpath "/tmp/work"))');
    expect(p).toContain('(deny file-write* (subpath "/tmp/work/input"))');
    expect(p.match(/file-write\*/g)!.length).toBe(3);
    expect(p).not.toContain('(allow file-read* (subpath "/Users');
    expect(p).not.toContain('(allow network');
  });
  it('escapes paths so a crafted name cannot add rules', () => {
    const p = buildProfile({ workDir: '/tmp/a") (allow network*) ("b', readRoots: [], executables: [] });
    expect(p).not.toMatch(/^\(allow network/m);
    expect(p).toContain('\\"');
  });
});
