import { isAbsolute } from 'node:path';
import { BASE_ENV_NAMES, pickEnv } from '../shared/env.js';
import { tryJsonParse } from '../shared/json.js';
import { runProcess } from '../shared/process.js';
import { resolveClaudeLaunchCommand, type ClaudeLaunchCommand } from './claude-command.js';
import type { AgentError, AgentRunRequest, AgentRunResult, ModelProvider } from './provider.js';

/**
 * Variables an agent process may inherit. Credentials are deliberately absent:
 * Veritas uses the Claude Code login on this machine, not an API key from the
 * environment. Add names through `extraEnvNames` when you need more.
 */
const AGENT_ENV_NAMES = [
  ...BASE_ENV_NAMES,
  'CLAUDE_CONFIG_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
];

const SAFE_VALUE = /^[A-Za-z0-9._:()*,/@ \-\[\]]+$/;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

export interface ClaudeCodeProviderOptions {
  /** Absolute path of the Claude Code program; discovered on PATH when omitted. */
  binary?: string;
  extraEnvNames?: readonly string[];
  defaultTimeoutMs?: number;
  /** Source of environment values (defaults to the current process). */
  sourceEnv?: NodeJS.ProcessEnv;
}

interface Envelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  structured_output?: unknown;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  session_id?: string;
  terminal_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Understand the single JSON object `claude -p --output-format json` prints. */
export function parseEnvelope(stdout: string): Envelope | undefined {
  const text = stdout.trim();
  if (!text) return undefined;
  const whole = tryJsonParse<Envelope>(text);
  if (whole && typeof whole === 'object' && !Array.isArray(whole)) return whole;
  // Tolerate stray warning lines before the JSON.
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.startsWith('{')) continue;
    const parsed = tryJsonParse<Envelope>(lines.slice(i).join('\n'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  }
  return undefined;
}

/** Validate a request and build the argument vector (the prompt is NOT part of it). */
export function buildArgs(request: AgentRunRequest): string[] {
  const model = request.model.trim();
  if (!model || model.startsWith('-') || !SAFE_VALUE.test(model)) throw new Error(`Invalid model: ${request.model}`);
  if (!isAbsolute(request.cwd)) throw new Error('cwd must be an absolute path');

  const args = [
    '-p', '--output-format', 'json', '--no-session-persistence',
    '--model', model, '--permission-mode', 'dontAsk',
    '--tools', checkList(request.tools, 'tool').join(','),
  ];
  if (request.allowedTools?.length) args.push('--allowed-tools', checkList(request.allowedTools, 'allowed tool').join(','));
  for (const dir of request.addDirs ?? []) {
    if (!isAbsolute(dir) || dir.includes('\0') || dir.startsWith('-')) throw new Error(`Invalid directory: ${dir}`);
    args.push('--add-dir', dir);
  }
  if (request.jsonSchema) args.push('--json-schema', JSON.stringify(request.jsonSchema));
  if (request.appendSystemPrompt) args.push('--append-system-prompt', request.appendSystemPrompt);
  if (request.maxBudgetUsd !== undefined) {
    if (!Number.isFinite(request.maxBudgetUsd) || request.maxBudgetUsd <= 0) throw new Error('maxBudgetUsd must be positive');
    args.push('--max-budget-usd', request.maxBudgetUsd.toFixed(6));
  }
  return args;
}

function checkList(items: readonly string[], what: string): string[] {
  for (const item of items) {
    if (item.startsWith('-') || item.includes('\0') || !SAFE_VALUE.test(item)) throw new Error(`Invalid ${what}: ${item}`);
  }
  return [...items];
}

function failure(kind: AgentError['kind'], message: string, base: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    ok: false, text: '', costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
    durationMs: 0, numTurns: 0, ...base, error: { kind, message },
  };
}

/** Runs each agent as a headless Claude Code session using the logged-in account. */
export class ClaudeCodeProvider implements ModelProvider {
  readonly id = 'claude-code';
  private readonly launch: ClaudeLaunchCommand | null;
  private readonly env: Record<string, string>;
  private readonly defaultTimeoutMs: number;

  constructor(options: ClaudeCodeProviderOptions = {}) {
    this.launch = options.binary
      ? { command: options.binary, argsPrefix: [] }
      : resolveClaudeLaunchCommand();
    this.env = pickEnv([...AGENT_ENV_NAMES, ...(options.extraEnvNames ?? [])], {}, options.sourceEnv ?? process.env);
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get available(): boolean {
    return this.launch !== null;
  }

  get command(): string | undefined {
    return this.launch?.command;
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    if (!this.launch) {
      return failure('unavailable', 'Claude Code was not found. Install it and log in, then try again.');
    }
    let args: string[];
    try {
      args = buildArgs(request);
    } catch (error) {
      return failure('process', error instanceof Error ? error.message : String(error));
    }

    const r = await runProcess(this.launch.command, [...this.launch.argsPrefix, ...args], {
      cwd: request.cwd,
      env: this.env,
      input: request.prompt,
      timeoutMs: request.timeoutMs ?? this.defaultTimeoutMs,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      signal: request.signal,
    });

    const base = { durationMs: r.durationMs };
    if (r.spawnError) return failure('unavailable', `Could not start Claude Code: ${r.spawnError}`, base);
    if (r.aborted) return failure('aborted', 'The run was cancelled.', base);
    if (r.timedOut) return failure('timeout', `The run exceeded ${Math.round((request.timeoutMs ?? this.defaultTimeoutMs) / 1000)} s.`, base);
    if (r.truncated) return failure('output_too_large', 'The agent produced more output than allowed.', base);

    const env = parseEnvelope(r.stdout);
    if (!env) {
      const detail = (r.stderr || r.stdout).trim().slice(0, 400);
      return failure(r.exitCode === 0 ? 'envelope' : 'process',
        `Claude Code ${r.exitCode === 0 ? 'returned output that could not be understood' : `exited with code ${r.exitCode}`}${detail ? `: ${detail}` : ''}`, base);
    }

    const usage = env.usage ?? {};
    const common: Partial<AgentRunResult> = {
      costUsd: num(env.total_cost_usd),
      inputTokens: num(usage.input_tokens),
      outputTokens: num(usage.output_tokens),
      cacheReadTokens: num(usage.cache_read_input_tokens),
      cacheCreationTokens: num(usage.cache_creation_input_tokens),
      durationMs: num(env.duration_ms) || r.durationMs,
      numTurns: num(env.num_turns),
      sessionId: typeof env.session_id === 'string' ? env.session_id : undefined,
    };

    if (env.subtype === 'error_max_budget_usd' || env.terminal_reason === 'budget_exhausted') {
      return failure('budget', 'The agent reached its spending limit.', common);
    }
    const text = typeof env.result === 'string' ? env.result : '';
    if (env.is_error) {
      return failure('agent_error', text.trim().slice(0, 400) || `The agent reported an error (${env.subtype ?? 'unknown'}).`, common);
    }
    if (r.exitCode !== 0) {
      return failure('process', `Claude Code exited with code ${r.exitCode}.`, common);
    }
    return {
      ok: true, text, ...(env.structured_output !== undefined ? { json: env.structured_output } : {}),
      costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
      durationMs: r.durationMs, numTurns: 0, ...common,
    };
  }
}
