import { createInterface } from 'node:readline/promises';
import { AGENT_ENV_NAMES, ClaudeCodeProvider } from '../agents/claude-code.js';
import { resolveClaudeLaunchCommand } from '../agents/claude-command.js';
import { pickEnv } from '../shared/env.js';
import { runProcess } from '../shared/process.js';
import { tryJsonParse } from '../shared/json.js';
import type { ClaudeProbe, Runtime } from './app.js';
import { OutputFormatter } from './output.js';
import type { VeritasConfig } from './types.js';

async function probeClaude(config: VeritasConfig): Promise<ClaudeProbe> {
  const launch = config.claudeBinary ? { command: config.claudeBinary, argsPrefix: [] as string[] } : resolveClaudeLaunchCommand();
  if (!launch) return { found: false, detail: 'Claude Code was not found on your PATH. Install it from https://claude.com/claude-code.' };
  const env = pickEnv(AGENT_ENV_NAMES);
  const run = (args: string[]) => runProcess(launch.command, [...launch.argsPrefix, ...args], { env, timeoutMs: 20_000 });
  const v = await run(['--version']);
  if (v.spawnError || v.exitCode !== 0) return { found: false, path: launch.command, detail: `Could not start ${launch.command}.` };
  const version = v.stdout.trim().split('\n')[0];
  const a = await run(['auth', 'status']);
  const status = tryJsonParse<{ loggedIn?: boolean; authMethod?: string }>(a.stdout);
  if (status?.loggedIn === true) return { found: true, path: launch.command, version, loggedIn: true, detail: `logged in (${status.authMethod ?? 'account'})` };
  return { found: true, path: launch.command, version, loggedIn: false, detail: 'Not logged in.' };
}

/** The real runtime: terminal, keyboard, Claude Code. Creating it has no side effects. */
export function createRuntime(): Runtime {
  const tty = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const env = process.env;
  return {
    out: new OutputFormatter({ color: process.stdout.isTTY === true && !('NO_COLOR' in env) }),
    env,
    cwd: process.cwd(),
    interactive: tty,
    async ask(question) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return await rl.question(question); } finally { rl.close(); }
    },
    makeProvider: (config) => new ClaudeCodeProvider({ binary: config.claudeBinary, defaultTimeoutMs: config.agentTimeoutMs }),
    probeClaude,
    onInterrupt(handler) {
      process.on('SIGINT', handler);
      return () => { process.off('SIGINT', handler); };
    },
  };
}
