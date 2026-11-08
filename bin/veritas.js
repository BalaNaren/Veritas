#!/usr/bin/env node
import { ensureBlockingStdio } from '../dist/cli/blocking-stdio.js';
import { main } from '../dist/cli/main.js';
import { createRuntime } from '../dist/cli/runtime.js';

ensureBlockingStdio();
process.exitCode = await main(process.argv.slice(2), createRuntime());
