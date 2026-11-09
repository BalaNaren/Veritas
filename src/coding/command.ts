/**
 * Project commands (for example `npm test`) are run without a shell, so what is approved is exactly what runs.
 * A command line is split into words here; anything that would need a shell (pipes, redirects, substitutions,
 * chaining, environment assignments) is refused rather than guessed at.
 */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

const SHELL_ONLY = /[|&;<>`$(){}\n\r\\*?~!#]/;

export function parseCommand(text: string): string[] {
  const src = text.trim();
  if (!src) throw new CommandError('The command is empty.');
  if (src.length > 500) throw new CommandError('The command is too long.');
  if (/[\n\r]/.test(src)) throw new CommandError('The command must be on a single line.');
  const argv: string[] = [];
  let word = '';
  let inWord = false;
  let quote: '"' | "'" | null = null;
  for (const c of src) {
    if (quote) {
      if (c === quote) { quote = null; continue; }
      if (SHELL_ONLY.test(c) && c !== '\\') throw new CommandError(`"${c}" needs a shell, which Veritas does not use. Use a plain command such as: npm test`);
      word += c; continue;
    }
    if (c === '"' || c === "'") { quote = c; inWord = true; continue; }
    if (/\s/.test(c)) { if (inWord) { argv.push(word); word = ''; inWord = false; } continue; }
    if (SHELL_ONLY.test(c)) throw new CommandError(`"${c}" needs a shell, which Veritas does not use. Use a plain command such as: npm test`);
    word += c; inWord = true;
  }
  if (quote) throw new CommandError('The command has an unclosed quote.');
  if (inWord) argv.push(word);
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0]!)) throw new CommandError('Setting environment variables in the command is not supported.');
  return argv;
}

/** The canonical text of a parsed command, used to remember an approval. */
export const commandText = (argv: readonly string[]): string => argv.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ');
