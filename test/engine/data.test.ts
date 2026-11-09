import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentRunRequest, AgentRunResult, ModelProvider } from '../../src/agents/provider.js';
import { defaultConfig } from '../../src/config.js';
import { Engine, type Approver } from '../../src/engine/engine.js';
import { SandboxExecSandbox } from '../../src/sandbox/sandbox-exec.js';
import { Store } from '../../src/storage/store.js';

const available = SandboxExecSandbox.available();
const python = available ? execFileSync('python3', ['-c', 'import sys; print(sys.executable)']).toString().trim() : '';

let dir = '';
let csv = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'veritas-data-'));
  csv = join(dir, 'sales.csv');
  writeFileSync(csv, 'region,revenue\nnorth,100\nnorth,200\nsouth,60\nsouth,100\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ok = (over: Partial<AgentRunResult>): AgentRunResult => ({
  ok: true, text: '', costUsd: 0.01, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 1, numTurns: 1, ...over,
});

// A tiny valid 1x1 PNG, written by the analysis code itself.
const GOOD_CODE = `import csv, json, base64
rows = list(csv.DictReader(open("input/sales.csv")))
by = {}
for r in rows:
    by[r["region"]] = by.get(r["region"], 0) + float(r["revenue"])
total = sum(by.values())
json.dump({"total_revenue": total, "by_region": by, "north_share_pct": round(by["north"] / total * 100, 4)}, open("output/results.json", "w"))
open("output/chart.png", "wb").write(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="))
print("done", total)
`;
const BAD_CODE = 'import csv\nrows = list(csv.DictReader(open("input/sales.csv")))\nprint(totl)\n';

function provider(seen: AgentRunRequest[]): ModelProvider {
  let codeCalls = 0;
  let interpretCalls = 0;
  return {
    id: 'claude-code',
    async run(r) {
      seen.push(r);
      const schema = r.jsonSchema ? JSON.stringify(r.jsonSchema) : '';
      if (schema.includes('"subtasks"')) {
        return ok({ json: { assumptions: [], subtasks: [{ key: 'd1', title: 'Revenue by region', kind: 'data', instructions: 'Total revenue and revenue by region', dependsOn: [] }] } });
      }
      if (schema.includes('"approach"')) {
        codeCalls++;
        return ok({ json: { code: codeCalls === 1 ? BAD_CODE : GOOD_CODE, approach: 'Sum revenue by region.' }, costUsd: 0.02 });
      }
      if (schema.includes('"keys"')) {
        interpretCalls++;
        const f = (claim: string, keys: string[], important = false) => ({ claim, keys, important });
        const findings = interpretCalls === 1
          ? [f('Revenue by month was strong.', ['nonexistent_key'])]
          : [f('Total revenue was 460.', ['total_revenue'], true), f('The north region brought in 300, about 65% of the total.', ['by_region.north', 'north_share_pct']), f('Revenue totalled 500.', ['total_revenue'])];
        return ok({ json: { findings, charts: [{ file: 'chart.png', caption: 'Revenue by region' }], notes: '' } });
      }
      if (schema.includes('"verdict"')) return ok({ json: { verdict: 'supported', reason: 'The results say so.', timeSensitive: false, against: [] } });
      if (schema.includes('"questions"')) return ok({ json: { questions: [], assumptions: [] } });
      return ok({ text: 'Total revenue was 460 [c1]. The north region brought in 300, about 65% of the total [c2].' });
    },
  };
}

const yes: Approver = async () => 'approved';

describe.skipIf(!available)('data tasks (real sandbox)', () => {
  it('has the code written, run in the sandbox and repaired, and only numbers the code produced are reported', async () => {
    const seen: AgentRunRequest[] = [];
    const home = mkdtempSync(join(tmpdir(), 'veritas-data-home-'));
    try {
      const store = Store.open(':memory:');
      const config = { ...defaultConfig(home), maxConcurrent: 2 };
      const engine = new Engine({ store, provider: provider(seen), config, retryDelayMs: 0, sandbox: new SandboxExecSandbox({ python }) });
      const task = engine.createTask('How much revenue did each region make?', { files: [csv] });
      const r = await engine.execute(task.id, { approver: yes });
      expect(r.task.status).toBe('done');
      expect(r.task.type).toBe('data');

      // The planner was offered the data kind; code-writing agents had no tools at all.
      const plan = seen.find((c) => JSON.stringify(c.jsonSchema ?? {}).includes('"subtasks"'))!;
      expect(JSON.stringify(plan.jsonSchema)).toContain('"data"');
      for (const c of seen.filter((x) => JSON.stringify(x.jsonSchema ?? {}).includes('"approach"') || JSON.stringify(x.jsonSchema ?? {}).includes('"keys"'))) expect(c.tools).toEqual([]);
      // The repair prompt carried the real error back to the agent.
      const repair = seen.filter((c) => JSON.stringify(c.jsonSchema ?? {}).includes('"approach"'))[1]!;
      expect(repair.prompt).toContain("NameError: name 'totl' is not defined");
      // The agent saw the head of the data file.
      expect(seen.find((c) => JSON.stringify(c.jsonSchema ?? {}).includes('"approach"'))!.prompt).toContain('north,100');

      const runs = store.db.prepare('SELECT attempt, exit_code, code FROM runs ORDER BY attempt').all() as { attempt: number; exit_code: number; code: string }[];
      expect(runs.map((x) => x.exit_code)).toEqual([1, 0]);
      expect(runs[1]!.code).toBe(GOOD_CODE);

      const claims = store.db.prepare('SELECT seq, status, reason, type, url, quote FROM claims ORDER BY seq').all() as { seq: number; status: string; reason: string | null; type: string; url: string; quote: string }[];
      expect(claims).toHaveLength(3);
      expect(claims.every((c) => c.type === 'computed' && c.url.startsWith('run:'))).toBe(true);
      expect(claims[0]).toMatchObject({ status: 'confirmed', quote: 'total_revenue: 460' });
      expect(claims[1]).toMatchObject({ status: 'confirmed', quote: 'by_region.north: 300 ... north_share_pct: 65.2174' });
      expect(claims[2]).toMatchObject({ status: 'removed' });
      expect(claims[2]!.reason).toBe('Number not in the quote: 500');

      const md = readFileSync(r.resultPath!, 'utf8');
      expect(md).toContain('Total revenue was 460 [1].');
      expect(md).toContain('Analysis run');
      expect(md).toContain('computed by code that ran in the sandbox');
      expect(md).toContain('## Code');
      expect(md).toContain('```python\nimport csv, json, base64');
      expect(md).toMatch(/!\[Revenue by region\]\(charts\/[^)]+\.png\)/);
      expect(md).toContain('Chart captions are the analysis agent');
      const chart = md.match(/\(charts\/([^)]+\.png)\)/)![1]!;
      expect(existsSync(join(home, 'tasks', task.id, 'charts', chart))).toBe(true);
      expect(md).toContain('Revenue totalled 500');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it('fails clearly when the code never works', async () => {
    const home = mkdtempSync(join(tmpdir(), 'veritas-data-home-'));
    try {
      const store = Store.open(':memory:');
      const base = provider([]);
      const stubborn: ModelProvider = { id: 'claude-code', run: (r) => (JSON.stringify(r.jsonSchema ?? {}).includes('"approach"') ? Promise.resolve(ok({ json: { code: BAD_CODE, approach: 'x' } })) : base.run(r)) };
      const engine = new Engine({ store, provider: stubborn, config: { ...defaultConfig(home), maxConcurrent: 1 }, retryDelayMs: 0, sandbox: new SandboxExecSandbox({ python }) });
      const task = engine.createTask('anything', { files: [csv] });
      const r = await engine.execute(task.id, { approver: yes });
      expect(r.task.status).toBe('failed');
      expect(r.task.error).toMatch(/did not run successfully after 3 attempts/);
      expect((store.db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n).toBeGreaterThanOrEqual(3);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});

describe('data tasks without a sandbox', () => {
  it('does not offer data analysis, says so, and never runs code', async () => {
    const seen: AgentRunRequest[] = [];
    const home = mkdtempSync(join(tmpdir(), 'veritas-data-home-'));
    try {
      const store = Store.open(':memory:');
      const base = provider(seen);
      // Without a data kind to choose, this scripted planner picks a document task.
      const docProvider: ModelProvider = {
        id: 'claude-code',
        run: (r) => (JSON.stringify(r.jsonSchema ?? {}).includes('"subtasks"')
          ? Promise.resolve(ok({ json: { assumptions: [], subtasks: [{ key: 'd1', title: 'Read', kind: JSON.stringify(r.jsonSchema).includes('"data"') ? 'data' : 'document', instructions: 'x', dependsOn: [] }] } }))
          : base.run(r)),
      };
      const engine = new Engine({ store, provider: docProvider, config: { ...defaultConfig(home), maxConcurrent: 1 }, retryDelayMs: 0, sandbox: async () => undefined });
      const task = engine.createTask('Total revenue?', { files: [csv] });
      await engine.execute(task.id);
      const planned = store.getTask(task.id)!;
      expect(planned.plan!.subtasks[0]!.kind).toBe('document');
      expect(planned.assumptions.join(' ')).toContain('Calculations were not run');
      expect(store.listEvents(task.id).map((e) => e.type)).toContain('sandbox.unavailable');
      expect(store.db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toMatchObject({ n: 0 });
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
