#!/usr/bin/env node
// A stand-in for the docker program, used only by tests. It never runs containers.
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args[0] === 'kill') { appendFileSync(process.env.FAKE_KILL_LOG, `${args[1]}\n`); process.exit(0); }
const work = args[args.indexOf('-v') + 1].split(':')[0];
const code = readFileSync(join(work, 'analysis.py'), 'utf8');
mkdirSync(join(work, 'output'), { recursive: true });
writeFileSync(join(work, 'output', 'argv.json'), JSON.stringify(args));
if (code.includes('SLEEP')) setInterval(() => {}, 1000);
else { process.stdout.write('ran in fake container\n'); process.exit(0); }
