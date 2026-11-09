/**
 * Models and prices for the Anthropic API mode.
 *
 * Prices are US dollars per million tokens, copied from Anthropic's pricing page (checked 2026-11-09). Cost accounting
 * drives the budget limits, so a model without a known price is refused rather than guessed.
 */
export interface Price {
  input: number;
  /** Writing a prompt prefix to the 5-minute cache. */
  cacheWrite: number;
  /** Reading from the cache. */
  cacheRead: number;
  output: number;
}

export interface ModelInfo {
  id: string;
  /** Prices up to `tierAt` prompt tokens (or for any length when there is no tier). */
  price: Price;
  /** Prompt length (all input tokens, cached or not) above which `highPrice` applies to the whole request. */
  tierAt?: number;
  highPrice?: Price;
}

export const MODELS: Readonly<Record<string, ModelInfo>> = {
  'claude-opus-5-5': { id: 'claude-opus-5-5', price: { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 } },
  'claude-sonnet-5-5': { id: 'claude-sonnet-5-5', price: { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 } },
  'claude-haiku-5-5': {
    id: 'claude-haiku-5-5',
    price: { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
    tierAt: 100_000,
    highPrice: { input: 0.5, cacheWrite: 0.625, cacheRead: 0.05, output: 2.5 },
  },
  'claude-opus-5': { id: 'claude-opus-5', price: { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 } },
  'claude-fable-5-1': { id: 'claude-fable-5-1', price: { input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50 } },
};

/** The short names used in settings. Only these three roles' defaults are needed by the engine. */
export const MODEL_ALIASES: Readonly<Record<string, string>> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
};

/** One web search costs this much, on top of tokens ($10 per 1,000 searches). Web fetch has no extra charge. */
export const WEB_SEARCH_USD = 0.01;

export class UnknownModelError extends Error {
  constructor(model: string) {
    super(`"${model}" has no known price, so its cost cannot be tracked. Use opus, sonnet, haiku or one of: ${Object.keys(MODELS).join(', ')}.`);
    this.name = 'UnknownModelError';
  }
}

export function resolveModel(nameOrId: string): ModelInfo {
  const id = MODEL_ALIASES[nameOrId.trim().toLowerCase()] ?? nameOrId.trim();
  const info = MODELS[id];
  if (!info) throw new UnknownModelError(nameOrId);
  return info;
}

export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

/** Cost of one response in US dollars. */
export function costOf(model: ModelInfo, usage: TokenUsage): number {
  const input = usage.input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const p = model.tierAt !== undefined && model.highPrice && input + write + read > model.tierAt ? model.highPrice : model.price;
  const tokens = (input * p.input + write * p.cacheWrite + read * p.cacheRead + output * p.output) / 1_000_000;
  return tokens + (usage.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD;
}
