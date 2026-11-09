import { realpathSync } from 'node:fs';

/** The file tools that take a path rule. */
const PATH_TOOLS = new Set(['Read', 'Grep', 'Glob', 'Edit', 'Write']);

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
  }
}

/**
 * Turn plain tool names into permission rules limited to one folder, for example `Write(//abs/folder/**)`.
 * A bare tool name lets the agent use that tool anywhere on the computer (verified: a bare Write created a file
 * outside the working folder), so file tools must always be scoped. Other tools (such as `Bash(npm test)`) pass through.
 */
export function scopeToFolder(tools: readonly string[], folder: string): string[] {
  const real = realpathSync(folder);
  if (/[*?\[\]{}()!#]/.test(real) || /[^\x20-\x7e]/.test(real)) {
    throw new ScopeError(`The working folder path contains characters that cannot be used in a permission rule: ${real}`);
  }
  // A leading "//" means an absolute path in a permission rule.
  const rule = `//${real.replace(/^\/+/, '')}/**`;
  return tools.map((t) => (PATH_TOOLS.has(t) ? `${t}(${rule})` : t));
}
