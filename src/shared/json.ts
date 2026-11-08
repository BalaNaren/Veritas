const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Parse JSON, dropping keys that could pollute object prototypes. */
export function safeJsonParse<T = unknown>(text: string): T {
  return JSON.parse(text, (key, value) => (FORBIDDEN_KEYS.has(key) ? undefined : value)) as T;
}

/** Parse JSON, returning `undefined` instead of throwing. */
export function tryJsonParse<T = unknown>(text: string): T | undefined {
  try { return safeJsonParse<T>(text); } catch { return undefined; }
}
