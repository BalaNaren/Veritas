import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';

export interface ClaudeLaunchCommand {
  command: string;
  /** Arguments that must precede the real ones (for example a JavaScript entry point). */
  argsPrefix: string[];
}

export interface ClaudeCommandResolverOptions {
  platform?: NodeJS.Platform;
  nodeExecutable?: string;
  /** PATH-style search string. Defaults to the current PATH. */
  pathValue?: string;
  fileExists?: (path: string) => boolean;
}

/**
 * Locate the Claude Code program in a form Node can start without a shell.
 *
 * On Windows the npm shims (`claude.cmd`, `claude.ps1`) are shell scripts that
 * cannot be started directly with `shell: false`, so the native executable or
 * the JavaScript entry point behind the shim is used instead.
 */
export function resolveClaudeLaunchCommand(options: ClaudeCommandResolverOptions = {}): ClaudeLaunchCommand | null {
  const platform = options.platform ?? process.platform;
  const path = platform === 'win32' ? win32 : posix;
  const fileExists = options.fileExists ?? existsSync;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const dirs = (options.pathValue ?? process.env.PATH ?? '')
    .split(platform === 'win32' ? ';' : ':')
    .filter((d) => d && path.isAbsolute(d));
  const names = platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude.ps1', 'claude'] : ['claude'];

  const matches: string[] = [];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fileExists(candidate)) matches.push(candidate);
    }
  }

  if (platform !== 'win32') {
    return matches[0] ? { command: matches[0], argsPrefix: [] } : null;
  }

  const executable = matches.find((m) => path.extname(m).toLowerCase() === '.exe');
  if (executable) return { command: executable, argsPrefix: [] };

  for (const shim of matches) {
    const packageRoot = path.join(path.dirname(shim), 'node_modules', '@anthropic-ai', 'claude-code');
    const native = path.join(packageRoot, 'bin', 'claude.exe');
    if (fileExists(native)) return { command: native, argsPrefix: [] };
    const entry = path.join(packageRoot, 'cli.js');
    if (fileExists(entry)) return { command: nodeExecutable, argsPrefix: [entry] };
  }
  return null;
}
