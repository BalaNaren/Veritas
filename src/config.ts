import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MODELS } from './agents/models.js';
import { ConfigError, type VeritasConfig } from './cli/types.js';
import { writeFileAtomic } from './shared/fs.js';
import { safeJsonParse } from './shared/json.js';
import { VERSION } from './version.js';

export const configPath = (home: string): string => join(home, 'config.json');

export function defaultConfig(home: string): VeritasConfig {
  return {
    version: VERSION,
    homeDir: home,
    models: { ...DEFAULT_MODELS },
    maxConcurrent: 4,
    defaultBudgetUsd: 2,
    maxSubtasks: 8,
    agentTimeoutMs: 10 * 60_000,
    memoryEnabled: true,
    cli: { colorOutput: true, interactive: true, verbosity: 'normal', outputFormat: 'text', progressStyle: 'bar' },
  };
}

const MODEL_RE = /^[A-Za-z0-9._\-\[\]]+$/;
const ROLES = ['planner', 'clarifier', 'worker', 'checker', 'writer'] as const;

/** Check a configuration object; returns a list of problems (empty when valid). */
export function validateConfig(c: VeritasConfig): string[] {
  const problems: string[] = [];
  for (const role of ROLES) {
    const m = c.models[role];
    if (typeof m !== 'string' || !MODEL_RE.test(m) || m.startsWith('-')) problems.push(`models.${role} is not a valid model name`);
  }
  const int = (v: unknown, lo: number, hi: number): boolean => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  if (!int(c.maxConcurrent, 1, 16)) problems.push('maxConcurrent must be a whole number from 1 to 16');
  if (!int(c.maxSubtasks, 1, 20)) problems.push('maxSubtasks must be a whole number from 1 to 20');
  if (!(typeof c.defaultBudgetUsd === 'number' && c.defaultBudgetUsd > 0 && c.defaultBudgetUsd <= 1000)) {
    problems.push('defaultBudgetUsd must be a number above 0 and at most 1000');
  }
  if (!int(c.agentTimeoutMs, 10_000, 2 * 60 * 60_000)) problems.push('agentTimeoutMs must be between 10000 and 7200000');
  if (c.claudeBinary !== undefined && (typeof c.claudeBinary !== 'string' || !c.claudeBinary.startsWith('/') && !/^[A-Za-z]:\\/.test(c.claudeBinary))) {
    problems.push('claudeBinary must be an absolute path');
  }
  return problems;
}

function merge<T extends object>(base: T, override: unknown): T {
  if (!override || typeof override !== 'object') return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    const cur = out[k];
    out[k] = cur && typeof cur === 'object' && !Array.isArray(cur) && v && typeof v === 'object' ? merge(cur as object, v) : v;
  }
  return out as T;
}

/** Load the configuration from `<home>/config.json`, filling in defaults. */
export function loadConfig(home: string): VeritasConfig {
  const defaults = defaultConfig(home);
  const file = configPath(home);
  let config = defaults;
  if (existsSync(file)) {
    let raw: unknown;
    try {
      raw = safeJsonParse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new ConfigError(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    config = merge(defaults, raw);
  }
  config.homeDir = home;
  config.version = VERSION;
  const problems = validateConfig(config);
  if (problems.length) throw new ConfigError(`Invalid configuration in ${file}:\n  - ${problems.join('\n  - ')}`);
  return config;
}

export function saveConfig(home: string, config: VeritasConfig): void {
  const { homeDir: _h, version: _v, ...persisted } = config;
  void _h; void _v;
  writeFileAtomic(configPath(home), JSON.stringify(persisted, null, 2) + '\n');
}

/** Flatten a config to dotted keys for display. */
export function flattenConfig(config: VeritasConfig): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const walk = (prefix: string, value: unknown): void => {
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(prefix ? `${prefix}.${k}` : k, v);
    } else if (value !== undefined) {
      out[prefix] = value as string | number | boolean;
    }
  };
  walk('', config);
  return out;
}

/** Keys users may change with `veritas config set`. */
export const SETTABLE_KEYS = [
  'models.planner', 'models.clarifier', 'models.worker', 'models.checker', 'models.writer',
  'maxConcurrent', 'defaultBudgetUsd', 'maxSubtasks', 'agentTimeoutMs', 'claudeBinary',
  'memoryEnabled', 'cli.colorOutput', 'cli.verbosity',
] as const;

/** Return a copy of `config` with one dotted key changed (value given as text). Validates the result. */
export function setConfigValue(config: VeritasConfig, key: string, raw: string): VeritasConfig {
  if (!(SETTABLE_KEYS as readonly string[]).includes(key)) {
    throw new ConfigError(`Unknown or read-only setting "${key}". Settable: ${SETTABLE_KEYS.join(', ')}`);
  }
  const next = structuredClone(config) as unknown as Record<string, unknown>;
  const parts = key.split('.');
  let target = next;
  for (const p of parts.slice(0, -1)) target = target[p] as Record<string, unknown>;
  const last = parts[parts.length - 1]!;
  const current = target[last];
  let value: unknown = raw;
  if (typeof current === 'number' || ['maxConcurrent', 'defaultBudgetUsd', 'maxSubtasks', 'agentTimeoutMs'].includes(key)) {
    value = Number(raw);
    if (!Number.isFinite(value as number)) throw new ConfigError(`${key} must be a number`);
  } else if (typeof current === 'boolean') {
    if (!['true', 'false'].includes(raw)) throw new ConfigError(`${key} must be true or false`);
    value = raw === 'true';
  }
  target[last] = value;
  const result = next as unknown as VeritasConfig;
  const problems = validateConfig(result);
  if (problems.length) throw new ConfigError(problems.join('; '));
  return result;
}
