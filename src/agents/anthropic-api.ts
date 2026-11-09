import Anthropic from '@anthropic-ai/sdk';
import { ApiToolbox, CLIENT_TOOLS, SERVER_TOOLS, clientToolDefs } from './api-tools.js';
import { toApiSchema } from './api-schema.js';
import { UnknownModelError, costOf, resolveModel, type TokenUsage } from './anthropic-models.js';
import type { AgentError, AgentRunRequest, AgentRunResult, ModelProvider } from './provider.js';

export const API_BASE_URL = 'https://api.anthropic.com';
const MAX_TURNS = 30;
const MAX_TOKENS = 16_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const MAX_TEXT_CHARS = 5_000_000;

export interface AnthropicProviderOptions {
  /** The API key. Held in memory only: never written to config, logs or error messages. */
  apiKey: string;
  /** Defaults to the official endpoint. Set explicitly so an ANTHROPIC_BASE_URL in the environment cannot redirect the key. */
  baseURL?: string;
  defaultTimeoutMs?: number;
  /** Replaces the SDK client (tests). */
  client?: Pick<Anthropic, 'messages'>;
}

type Block = { type: string; [k: string]: unknown };

/** Settings value `provider`: where agents run. */
export type ProviderKind = 'claude-code' | 'anthropic-api';

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export class AnthropicApiProvider implements ModelProvider {
  readonly id = 'anthropic-api';
  private readonly client: Pick<Anthropic, 'messages'>;
  private readonly timeoutMs: number;

  constructor(private readonly o: AnthropicProviderOptions) {
    if (!o.apiKey && !o.client) throw new Error('An API key is required for API mode.');
    // Retries cover rate limits and server errors; the key is only ever sent to baseURL.
    this.client = o.client ?? new Anthropic({ apiKey: o.apiKey, baseURL: o.baseURL ?? API_BASE_URL, maxRetries: 2 });
    this.timeoutMs = o.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async run(req: AgentRunRequest): Promise<AgentRunResult> {
    const started = Date.now();
    const total: Required<Pick<AgentRunResult, 'costUsd' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheCreationTokens'>> = {
      costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
    };
    let turns = 0;
    const done = (extra: Partial<AgentRunResult> & { ok: boolean }): AgentRunResult => ({
      text: '', ...total, durationMs: Date.now() - started, numTurns: turns, ...extra,
    });
    const failed = (kind: AgentError['kind'], message: string): AgentRunResult => done({ ok: false, error: { kind, message } });

    let model;
    try { model = resolveModel(req.model); } catch (e) {
      return failed('unavailable', e instanceof UnknownModelError ? e.message : String(e));
    }

    const clientNames = req.tools.filter((t) => (CLIENT_TOOLS as readonly string[]).includes(t));
    const serverNames = req.tools.filter((t) => (SERVER_TOOLS as readonly string[]).includes(t));
    const unsupported = req.tools.filter((t) => !clientNames.includes(t) && !serverNames.includes(t));
    if (unsupported.length) return failed('unavailable', `API mode cannot give an agent the tool ${unsupported.join(', ')}. Use the Claude Code provider for this task.`);

    const tools: unknown[] = [...clientToolDefs(clientNames)];
    if (serverNames.includes('WebSearch')) tools.push({ type: 'web_search_20260209', name: 'web_search' });
    if (serverNames.includes('WebFetch')) tools.push({ type: 'web_fetch_20260209', name: 'web_fetch' });
    const toolbox = clientNames.length ? new ApiToolbox(req.cwd, req.addDirs ?? [], new Set(clientNames)) : undefined;

    const timeoutSignal = AbortSignal.timeout(req.timeoutMs ?? this.timeoutMs);
    const signal = req.signal ? AbortSignal.any([req.signal, timeoutSignal]) : timeoutSignal;
    const cause = (): AgentRunResult => (req.signal?.aborted ? failed('aborted', 'The run was stopped.') : failed('timeout', 'The agent took too long and was stopped.'));

    let useFormat = req.jsonSchema !== undefined;
    const schema = req.jsonSchema ? toApiSchema(req.jsonSchema) : undefined;
    const messages: { role: 'user' | 'assistant'; content: unknown }[] = [{ role: 'user', content: req.prompt }];
    const systemFor = (): string | undefined => {
      const parts = [req.appendSystemPrompt];
      if (req.jsonSchema && !useFormat) parts.push(`Reply with only a JSON object that matches this JSON Schema, with no other text:\n${JSON.stringify(req.jsonSchema)}`);
      const s = parts.filter(Boolean).join('\n\n');
      return s || undefined;
    };

    let last: Block[] = [];
    for (; turns < MAX_TURNS;) {
      if (req.maxBudgetUsd !== undefined && total.costUsd >= req.maxBudgetUsd) return failed('budget', `The run reached its spending limit of $${req.maxBudgetUsd.toFixed(2)}.`);
      if (signal.aborted) return cause();
      turns++;
      let res;
      try {
        res = await this.client.messages.create({
          model: model.id, max_tokens: MAX_TOKENS, messages: messages as never,
          ...(systemFor() ? { system: systemFor()! } : {}),
          ...(tools.length ? { tools: tools as never } : {}),
          ...(useFormat && schema ? { output_config: { format: { type: 'json_schema', schema } } as never } : {}),
        }, { signal });
      } catch (e) {
        if (signal.aborted) return cause();
        const status = (e as { status?: number }).status;
        if (useFormat && status === 400) { useFormat = false; turns--; continue; } // schema not accepted: ask in words instead
        if (status === 401 || status === 403) return failed('unavailable', 'The API rejected the key (check ANTHROPIC_API_KEY and that the account can use these models).');
        const message = e instanceof Error ? e.message : String(e);
        return failed(status ? 'agent_error' : 'process', message.replaceAll(this.o.apiKey || '\u0000', '[key]'));
      }

      const usage = res.usage as unknown as TokenUsage;
      total.inputTokens += num(usage.input_tokens);
      total.outputTokens += num(usage.output_tokens);
      total.cacheReadTokens += num(usage.cache_read_input_tokens);
      total.cacheCreationTokens += num(usage.cache_creation_input_tokens);
      total.costUsd += costOf(model, usage);
      last = res.content as unknown as Block[];

      if (res.stop_reason === 'refusal') return failed('agent_error', 'The model declined to answer this request.');
      if (res.stop_reason === 'max_tokens') return failed('output_too_large', 'The answer was longer than the model could write in one reply.');
      if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: last }); continue; }
      if (res.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: last });
        const results: unknown[] = [];
        for (const b of last) {
          if (b.type !== 'tool_use') continue;
          const r = toolbox ? await toolbox.run(String(b.name), b.input) : { content: `Tool ${String(b.name)} is not available.`, isError: true };
          results.push({ type: 'tool_result', tool_use_id: b.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }
      break;
    }
    if (turns >= MAX_TURNS && last.some((b) => b.type === 'tool_use')) return failed('agent_error', `The agent did not finish within ${MAX_TURNS} steps.`);

    const text = last.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('');
    if (text.length > MAX_TEXT_CHARS) return failed('output_too_large', 'The answer is too large.');
    if (req.jsonSchema) {
      try {
        const json: unknown = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
        return done({ ok: true, text, json });
      } catch {
        return { ...failed('envelope', 'The answer was not valid JSON.'), text };
      }
    }
    return done({ ok: true, text });
  }
}
