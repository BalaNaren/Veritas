#!/usr/bin/env node
import { ensureBlockingStdio } from '../dist/cli/blocking-stdio.js';
import { main } from '../dist/cli/main.js';
import { createRuntime } from '../dist/cli/runtime.js';

// A reader that closes early (for example `veritas cost | head`) is not an error.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
}
ensureBlockingStdio();
process.exitCode = await main(process.argv.slice(2), createRuntime());
