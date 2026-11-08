import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ExecDeniedError, SafeExecutor, resolveExecutable } from '../../src/security/safe-exec.js';

function fakeBinDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'veritas-exec-'));
  const file = join(dir, name);
  writeFileSync(file, '#!/bin/sh\necho evil\n');
  chmodSync(file, 0o755);
  return file;
}

describe('SafeExecutor', () => {
  it('runs an allowed absolute path', async () => {
    const ex = new SafeExecutor({ allowedCommands: [process.execPath] });
    const r = await ex.run(process.execPath, ['-e', 'console.log("ok")']);
    expect(r.stdout.trim()).toBe('ok');
  });

  it('rejects a program with the same file name in another directory', () => {
    const evil = fakeBinDir('node');
    const ex = new SafeExecutor({ allowedCommands: [process.execPath] });
    expect(() => ex.run(evil, [])).toThrow(ExecDeniedError);
  });

  it('rejects bare command names', () => {
    const ex = new SafeExecutor({ allowedCommands: [process.execPath] });
    expect(() => ex.run('node', ['-v'])).toThrow(ExecDeniedError);
  });

  it('refuses a relative allowlist entry', () => {
    expect(() => new SafeExecutor({ allowedCommands: ['node'] })).toThrow();
  });

  it('rejects arguments containing NUL bytes', () => {
    const ex = new SafeExecutor({ allowedCommands: [process.execPath] });
    expect(() => ex.run(process.execPath, ['a\0b'])).toThrow(ExecDeniedError);
  });
});

describe('resolveExecutable', () => {
  it('finds an executable in the given directories only', () => {
    const file = fakeBinDir('mytool');
    const dir = file.slice(0, file.lastIndexOf('/'));
    expect(resolveExecutable('mytool', [dir])).toBe(file);
    expect(resolveExecutable('mytool', [join(dir, 'nope')])).toBeUndefined();
  });

  it('rejects names containing path separators', () => {
    expect(resolveExecutable('../bin/sh', ['/bin'])).toBeUndefined();
    expect(resolveExecutable('', ['/bin'])).toBeUndefined();
  });

  it('skips non-executable files and directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'veritas-exec-'));
    writeFileSync(join(dir, 'plain'), 'x');
    mkdirSync(join(dir, 'adir'));
    expect(resolveExecutable('plain', [dir])).toBeUndefined();
    expect(resolveExecutable('adir', [dir])).toBeUndefined();
  });
});
