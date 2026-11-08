import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configPath, defaultConfig, flattenConfig, loadConfig, saveConfig, setConfigValue } from '../src/config.js';

const dirs: string[] = [];
const home = (): string => { const d = mkdtempSync(join(tmpdir(), 'veritas-cfg-')); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe('config', () => {
  it('returns defaults when no file exists', () => {
    const h = home();
    const c = loadConfig(h);
    expect(c.homeDir).toBe(h);
    expect(c.maxConcurrent).toBe(4);
    expect(c.models.planner).toBe('opus');
  });

  it('round-trips saved values', () => {
    const h = home();
    saveConfig(h, setConfigValue(defaultConfig(h), 'maxConcurrent', '2'));
    expect(loadConfig(h).maxConcurrent).toBe(2);
  });

  it('coerces and validates settings', () => {
    const c = defaultConfig(home());
    expect(setConfigValue(c, 'cli.colorOutput', 'false').cli.colorOutput).toBe(false);
    expect(() => setConfigValue(c, 'maxConcurrent', 'abc')).toThrow(/number/);
    expect(() => setConfigValue(c, 'maxConcurrent', '-1')).toThrow();
    expect(() => setConfigValue(c, 'homeDir', '/x')).toThrow(/Unknown or read-only/);
  });

  it('rejects an invalid file with a clear error', () => {
    const h = home();
    writeFileSync(configPath(h), JSON.stringify({ maxConcurrent: 0 }));
    expect(() => loadConfig(h)).toThrow(/Invalid configuration/);
    writeFileSync(configPath(h), '{not json');
    expect(() => loadConfig(h)).toThrow(/Could not read/);
  });

  it('flattens to dotted keys', () => {
    expect(flattenConfig(defaultConfig(home()))['models.worker']).toBe('sonnet');
  });
});
