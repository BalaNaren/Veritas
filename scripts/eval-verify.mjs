#!/usr/bin/env node
// Manual evaluation of the claim checker against the golden set. Uses the real checker model,
// so it costs money (a few tens of cents). Run with: npm run eval:verify
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeCodeProvider } from '../dist/agents/claude-code.js';
import { defaultConfig } from '../dist/config.js';
import { loadGolden, runGoldenEval } from '../dist/eval/golden.js';
import { AgentChecker } from '../dist/verify/checker.js';
import { runProcess } from '../dist/shared/process.js';
import { VERSION } from '../dist/version.js';

const root = new URL('..', import.meta.url).pathname;
const data = loadGolden(join(root, 'test/golden/facts.json'));
const config = defaultConfig(root);
const provider = new ClaudeCodeProvider({ defaultTimeoutMs: 120_000 });
if (!provider.available) { console.error('Claude Code was not found; cannot run the evaluation.'); process.exit(1); }

let spent = 0;
const metered = { id: provider.id, run: async (r) => { const res = await provider.run(r); spent += res.costUsd; return res; } };
const checker = new AgentChecker({ provider: metered, config, cwd: root });

const started = Date.now();
const report = await runGoldenEval(data, checker, { concurrency: 4 });
const minutes = ((Date.now() - started) / 60000).toFixed(1);

/** 95% Wilson score interval for a proportion. */
function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const row = (label, k, n) => { const [lo, hi] = wilson(k, n); return `| ${label} | ${k} / ${n} | ${pct(n ? k / n : 0)} | ${pct(lo)} – ${pct(hi)} |`; };
const of = (kind) => report.results.filter((r) => r.case.kind === kind);
const count = (kind, pred) => of(kind).filter(pred).length;

const supported = of('supported');
const stretched = of('stretched');
const contradicted = of('contradicted');
const aiWrong = [...stretched, ...contradicted];
const codeWrong = report.results.filter((r) => r.case.caughtByCode);
const leaked = report.results.filter((r) => !r.case.shouldBeConfirmed && r.status === 'confirmed');
const version = (await runProcess(provider.command, ['--version'], { timeoutMs: 20000 })).stdout.trim();

const lines = [
  `# Claim checker evaluation`,
  ``,
  `- Date: ${new Date().toISOString().slice(0, 10)}`,
  `- Veritas ${VERSION}; checker model alias: \`${config.models.checker}\`; runtime: ${version}`,
  `- Golden set: ${report.total} labelled claims from ${data.facts.length} facts over ${Object.keys(data.snapshots).length} synthetic source passages (\`test/golden/facts.json\`).`,
  `- Method: every claim goes through the full pipeline. Claims rejected by code never reach the checker. Each remaining claim is judged once by the checker, which sees only the claim, the quote with surrounding text and the page title and address.`,
  `- Run: ${report.checkerCalls} checker calls, about $${spent.toFixed(2)}, ${minutes} minutes.`,
  ``,
  `## Results`,
  ``,
  `| Measure | Count | Rate | 95% interval |`,
  `|---|---|---|---|`,
  row('Code checks reject fabricated quotes, altered numbers and invented sources', codeWrong.filter((r) => r.status === 'removed').length, codeWrong.length),
  row('Faithful claims confirmed', supported.filter((r) => r.status === 'confirmed').length, supported.length),
  row('Faithful claims wrongly removed', supported.filter((r) => r.status === 'removed').length, supported.length),
  row('Stretched claims not confirmed (flagged or removed)', stretched.filter((r) => r.status !== 'confirmed').length, stretched.length),
  row('Contradicted claims not confirmed (flagged or removed)', contradicted.filter((r) => r.status !== 'confirmed').length, contradicted.length),
  row('Contradicted claims removed', contradicted.filter((r) => r.status === 'removed').length, contradicted.length),
  row('Any wrong claim reaching "confirmed"', leaked.length, report.results.filter((r) => !r.case.shouldBeConfirmed).length),
  ``,
  `Status counts by kind of claim:`,
  ``,
  `| Kind | confirmed | flagged | removed |`,
  `|---|---|---|---|`,
  ...Object.entries(report.byKind).map(([k, v]) => `| ${k} | ${v.confirmed ?? 0} | ${v.flagged ?? 0} | ${v.removed ?? 0} |`),
  ``,
  leaked.length ? `## Wrong claims that were confirmed\n\n${leaked.map((r) => `- ${r.case.id} (${r.case.kind}): ${r.case.claim}`).join('\n')}\n` : `No wrong claim was confirmed.\n`,
  supported.some((r) => r.status !== 'confirmed') ? `## Faithful claims that were not confirmed\n\n${supported.filter((r) => r.status !== 'confirmed').map((r) => `- ${r.case.id} (${r.status}): ${r.case.claim} — ${r.reason}`).join('\n')}\n` : '',
  `## Limits of this measurement`,
  ``,
  `- The passages and claims are synthetic and short; real pages are messier, so real-world accuracy can be lower.`,
  `- One run, one checker model; the checker is not deterministic, so repeat runs vary a little.`,
  `- Stretched and contradicted claims were written by one author and are fairly blatant (for example adding a cause the passage never mentions). Subtle overreach is not tested here, so the 100% catch rates should not be read as a general guarantee.`,
  `- Faithful claims flagged instead of confirmed are the checker being cautious (for example, a year in the claim that is not inside the quote); they are shown to the reader as flagged, never dropped silently.`,
  `- Numbers written as words (for example "fivefold") are not compared by code, only by the checker.`,
  `- ${aiWrong.length} claims depend on the checker alone; the rest are decided by exact code checks.`,
  ``,
];
mkdirSync(join(root, 'docs/eval'), { recursive: true });
const file = join(root, `docs/eval/verify-${new Date().toISOString().slice(0, 10)}.md`);
writeFileSync(file, lines.join('\n'));
console.log(lines.join('\n'));
console.log(`\nWritten to ${file}`);
