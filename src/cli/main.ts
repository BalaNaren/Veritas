import { PRODUCT_NAME, VERSION } from '../version.js';
import { App, type Runtime } from './app.js';
import { adminCommands } from './commands/admin.js';
import { inspectCommands } from './commands/inspect.js';
import { runCommands } from './commands/run.js';
import { CommandParser } from './parser.js';
import { CLIError, type Command, type CommandContext } from './types.js';

const GROUPS: { title: string; names: string[] }[] = [
  { title: 'Do work', names: ['run', 'plan', 'approve', 'resume', 'cancel'] },
  { title: 'Look at work', names: ['list', 'status', 'show', 'cost'] },
  { title: 'Setup', names: ['config', 'doctor', 'version'] },
];

export function helpText(commands: readonly Command[], only?: Command): string {
  const lines: string[] = [];
  if (only) {
    lines.push(`veritas ${only.name}  -  ${only.description}`, '');
    for (const o of only.options ?? []) lines.push(`  --${o.name.padEnd(12)} ${o.description}`);
    for (const e of only.examples ?? []) lines.push('', `  ${e.command}`, `    ${e.description}`);
    return lines.join('\n');
  }
  lines.push(`${PRODUCT_NAME} ${VERSION}: give it a goal; it is planned, approved by you, and done by parallel agents.`, '', 'Usage: veritas <command> [options]', '');
  const byName = new Map(commands.map((c) => [c.name, c]));
  for (const g of GROUPS) {
    lines.push(`${g.title}:`);
    for (const n of g.names) lines.push(`  ${n.padEnd(10)} ${byName.get(n)?.description ?? ''}`);
    lines.push('');
  }
  lines.push('Options for every command:', '  --json        machine-readable output (where supported)', '  --quiet       less output', '  --verbose     more output', '  --no-color    plain text', '  --help        help for a command', '  --version     show the version', '',
    'Exit codes: 0 finished, 1 failed or error, 3 not finished yet (waiting for approval or paused).', 'Example: veritas run "Compare two laptops for video editing" --budget 1');
  return lines.join('\n');
}

/** Run one command line and return the exit code. Does not touch process state beyond what the runtime provides. */
export async function main(argv: string[], rt: Runtime): Promise<number> {
  const out = rt.out;
  const app = new App(rt);
  try {
    const commands = [...runCommands(app), ...inspectCommands(app), ...adminCommands(app)];
    const parser = new CommandParser({ allowUnknownFlags: false });
    for (const c of commands) parser.registerCommand(c);
    const parsed = parser.parse(argv);
    const flags = parsed.flags;

    if (flags.noColor === true) out.setColorEnabled(false);
    if (flags.quiet === true) out.setVerbosity('quiet');
    else if (flags.verbose === true) out.setVerbosity('verbose');

    if (flags.version === true && !parsed.command.length) { out.writeln(`${PRODUCT_NAME} ${VERSION}`); return 0; }

    const name = parsed.command[0];
    if (name === 'help' || (!name && !parsed.positional.length) || (!name && flags.help === true)) {
      out.writeln(helpText(commands));
      return 0;
    }
    if (!name) throw new CLIError(`Unknown command: ${parsed.positional[0]}. Run \`veritas --help\` to see the commands.`, 'COMMAND_NOT_FOUND', 2);
    const command = parser.getCommand(name)!;
    if (flags.help === true) { out.writeln(helpText(commands, command)); return 0; }

    const problems = parser.validateFlags(flags, command);
    if (problems.length) throw new CLIError(problems.join('\n'), 'VALIDATION_ERROR', 2);

    const ctx: CommandContext = { args: parsed.positional, flags, cwd: rt.cwd, interactive: rt.interactive };
    const result = await command.action!(ctx);
    return result?.exitCode ?? (result && !result.success ? 1 : 0);
  } catch (error) {
    if (error instanceof CLIError) {
      out.writeErrorln(out.error(error.message));
      return error.exitCode;
    }
    const message = error instanceof Error ? error.message : String(error);
    out.writeErrorln(out.error(`Something went wrong: ${message}`));
    if (out.isVerbose() && error instanceof Error && error.stack) out.writeErrorln(error.stack);
    return 1;
  } finally {
    app.close();
  }
}
