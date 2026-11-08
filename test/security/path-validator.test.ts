import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PathValidator, createDirectoryValidator } from '../../src/security/path-validator.js';

function sandbox() {
  const base = mkdtempSync(join(tmpdir(), 'veritas-path-'));
  const root = join(base, 'root');
  const evil = join(base, 'root-evil');
  mkdirSync(root);
  mkdirSync(evil);
  writeFileSync(join(root, 'ok.txt'), 'ok');
  writeFileSync(join(evil, 'secret.txt'), 'secret');
  return { base, root, evil };
}

describe('PathValidator', () => {
  it('accepts a file inside the allowed prefix', async () => {
    const { root } = sandbox();
    const r = await new PathValidator({ allowedPrefixes: [root] }).validate(join(root, 'ok.txt'));
    expect(r.isValid).toBe(true);
  });

  it('rejects a sibling directory that merely shares the prefix text', async () => {
    const { root, evil } = sandbox();
    const r = await new PathValidator({ allowedPrefixes: [root] }).validate(join(evil, 'secret.txt'));
    expect(r.isValid).toBe(false);
  });

  it('rejects traversal sequences', async () => {
    const { root } = sandbox();
    const v = new PathValidator({ allowedPrefixes: [root] });
    expect((await v.validate(join(root, '..', 'root-evil', 'secret.txt'))).isValid).toBe(false);
    expect((await v.validate(root + '/%2e%2e/x')).isValid).toBe(false);
  });

  it('rejects a symlink inside the prefix that points outside it', async () => {
    const { root, evil } = sandbox();
    symlinkSync(evil, join(root, 'link'));
    const r = await new PathValidator({ allowedPrefixes: [root] }).validate(join(root, 'link', 'secret.txt'));
    expect(r.isValid).toBe(false);
  });

  it('accepts files under a prefix that is itself reached through a symlink', async () => {
    const { base, root } = sandbox();
    const viaLink = join(base, 'via-link');
    symlinkSync(root, viaLink);
    const r = await new PathValidator({ allowedPrefixes: [viaLink] }).validate(join(viaLink, 'ok.txt'));
    expect(r.isValid).toBe(true);
  });

  it('blocks sensitive file names and extensions', async () => {
    const { root } = sandbox();
    writeFileSync(join(root, 'server.pem'), 'k');
    const v = new PathValidator({ allowedPrefixes: [root] });
    expect((await v.validate(join(root, 'server.pem'))).isValid).toBe(false);
    expect((await v.validate(join(root, 'id_rsa'))).isValid).toBe(false);
  });

  it('rejects NUL bytes and over-long paths', async () => {
    const { root } = sandbox();
    const v = new PathValidator({ allowedPrefixes: [root], maxPathLength: 100 });
    expect((await v.validate(join(root, 'a\0b'))).isValid).toBe(false);
    expect((await v.validate(join(root, 'x'.repeat(200)))).isValid).toBe(false);
  });

  it('allows not-yet-existing files by default', async () => {
    const { root } = sandbox();
    expect((await new PathValidator({ allowedPrefixes: [root] }).validate(join(root, 'new', 'file.txt'))).isValid).toBe(true);
  });
});

describe('createDirectoryValidator', () => {
  it('allows dot-directories inside the task folder', async () => {
    const { root } = sandbox();
    mkdirSync(join(root, '.cache'));
    writeFileSync(join(root, '.cache', 'x.json'), '{}');
    const r = await createDirectoryValidator(root).validate(join(root, '.cache', 'x.json'));
    expect(r.isValid).toBe(true);
  });
});
