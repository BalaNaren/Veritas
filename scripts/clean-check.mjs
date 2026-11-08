// Fails if any banned term appears in tracked project files.
// Terms are assembled from fragments so this file never contains them literally.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const banned = [
  ['ru', 'flo'],
  ['claude', '-flo', 'w'],
  ['claude', 'flo', 'w'],
  ['ru', 'vnet'],
  ['ru', 'v\\.io'],
  ['cogni', 'tum'],
  ['agent', 'db'],
  ['ru', 'vector'],
].map((parts) => parts.join(''));
const pattern = new RegExp(banned.join('|'), 'i');

const skipDirs = new Set(['node_modules', 'dist', '.git', 'coverage', 'veritas-output']);
const textExt = /\.(ts|js|mjs|cjs|json|md|yml|yaml|txt|html|css|sh|toml)$/i;
const binaryOk = /\.(png|jpg|jpeg|gif|pdf|mp4|ico)$/i;

const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) { walk(full); continue; }
    if (binaryOk.test(name) || (!textExt.test(name) && name !== 'LICENSE' && !name.startsWith('.'))) continue;
    if (name === 'package-lock.json') continue;
    const lines = readFileSync(full, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${relative(root, full)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
}
walk(root);

if (hits.length) {
  console.error('clean-check FAILED: banned terms found:\n' + hits.join('\n'));
  process.exit(1);
}
console.log('clean-check passed');
