import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import pdfmake from 'pdfmake';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentRunRequest, AgentRunResult, ModelProvider } from '../../src/agents/provider.js';
import { defaultConfig } from '../../src/config.js';
import { Engine, type Approver } from '../../src/engine/engine.js';
import { Store } from '../../src/storage/store.js';

let dir = '';
let pdfPath = '';
let txtPath = '';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'veritas-doc-e2e-'));
  const fonts = join(dirname(createRequire(import.meta.url).resolve('pdfmake/package.json')), 'fonts', 'Roboto');
  pdfmake.setFonts({ Roboto: { normal: join(fonts, 'Roboto-Regular.ttf'), bold: join(fonts, 'Roboto-Medium.ttf'), italics: join(fonts, 'Roboto-Italic.ttf'), bolditalics: join(fonts, 'Roboto-MediumItalic.ttf') } });
  const pdf = await pdfmake.createPdf({ defaultStyle: { font: 'Roboto' }, content: [
    { text: 'Master Services Agreement. The term is twelve months from the effective date.' },
    { text: 'Either party may terminate on 30 days written notice.', pageBreak: 'before' },
    { text: 'Fees are 4,500 dollars per month, payable within 15 days.', pageBreak: 'before' },
  ] }).getBuffer();
  pdfPath = join(dir, 'contract.pdf');
  writeFileSync(pdfPath, pdf);
  txtPath = join(dir, 'notes.txt');
  writeFileSync(txtPath, 'The supplier is Acme Ltd.\nPayment terms are net 15.');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ok = (over: Partial<AgentRunResult>): AgentRunResult => ({
  ok: true, text: '', costUsd: 0.01, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 1, numTurns: 1, ...over,
});

function provider(seen: AgentRunRequest[]): ModelProvider {
  return {
    id: 'claude-code',
    async run(r) {
      seen.push(r);
      const schema = r.jsonSchema ? JSON.stringify(r.jsonSchema) : '';
      if (schema.includes('"subtasks"')) {
        return ok({ json: { assumptions: [], subtasks: [{ key: 'd1', title: 'Read the contract', kind: 'document', instructions: 'Find the key terms of contract.pdf', dependsOn: [] }] } });
      }
      if (schema.includes('"findings"')) {
        const f = (claim: string, file: string, page: number, quote: string, type = 'fact') => ({ claim, type, file, page, quote, important: false });
        return ok({ json: { notes: '', findings: [
          f('Either party may end the agreement with 30 days written notice.', 'contract.pdf', 2, 'terminate on 30 days written notice'),
          f('Fees are 4,500 dollars per month.', 'contract.pdf', 1, 'Fees are 4,500 dollars per month', 'number'),
          f('The contract renews automatically every year.', 'contract.pdf', 1, 'The contract renews automatically each year'),
          f('There is a penalty clause.', 'contract.pdf', 9, 'There is a penalty clause for late delivery'),
          f('The supplier is Acme Ltd.', 'other.pdf', 1, 'The supplier is Acme Ltd.'),
          f('Payment terms are net 15.', 'notes.txt', 1, 'Payment terms are net 15.'),
        ] } });
      }
      if (schema.includes('"verdict"')) return ok({ json: { verdict: 'supported', reason: 'The passage says so.', timeSensitive: false, against: [] } });
      if (schema.includes('"questions"')) return ok({ json: { questions: [], assumptions: [] } });
      return ok({ text: 'Either party may end the agreement on 30 days written notice [c1]. Fees are 4,500 dollars per month [c2].\nPayment terms are net 15 [c6].' });
    },
  };
}

function setup(seen: AgentRunRequest[]) {
  const home = mkdtempSync(join(tmpdir(), 'veritas-doc-home-'));
  const config = { ...defaultConfig(home), maxConcurrent: 2 };
  const store = Store.open(':memory:');
  return { engine: new Engine({ store, provider: provider(seen), config, retryDelayMs: 0 }), store, home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}
const yes: Approver = async () => 'approved';

describe('document tasks', () => {
  it('reads the files, confines the agent to their extracted text, verifies page and quote, and cites pages', async () => {
    const seen: AgentRunRequest[] = [];
    const t = setup(seen);
    try {
      const task = t.engine.createTask('What are the key terms?', { files: [pdfPath, txtPath] });
      const r = await t.engine.execute(task.id, { approver: yes });
      expect(r.task.status).toBe('done');
      expect(r.task.type).toBe('documents');

      // The planner was told about the files and could choose the document kind.
      const planCall = seen.find((c) => JSON.stringify(c.jsonSchema ?? {}).includes('"subtasks"'))!;
      expect(planCall.prompt).toContain('contract.pdf (pdf, 3 parts)');
      expect(JSON.stringify(planCall.jsonSchema)).toContain('"document"');

      // The document agent reads only the folder of extracted text.
      const agent = seen.find((c) => JSON.stringify(c.jsonSchema ?? {}).includes('"page"'))!;
      expect(agent.tools).toEqual(['Read', 'Grep', 'Glob']);
      expect(agent.cwd).toBe(join(t.home, 'tasks', task.id, 'files'));
      expect(agent.addDirs).toEqual([agent.cwd]);

      const claims = t.store.db.prepare('SELECT seq, status, reason, location FROM claims ORDER BY seq').all() as { seq: number; status: string; reason: string | null; location: number | null }[];
      expect(claims[0]).toMatchObject({ status: 'confirmed', location: 2 });
      expect(claims[1]).toMatchObject({ status: 'flagged', location: 3 });          // quote is on page 3, not page 1
      expect(claims[1]!.reason).toContain('Cited page 1, but the quote is on page 3');
      expect(claims[2]).toMatchObject({ status: 'removed' });                       // invented quote
      expect(claims[2]!.reason).toBe('The quote is not in the source');
      expect(claims[3]).toMatchObject({ status: 'removed' });                       // page that does not exist
      expect(claims[4]).toMatchObject({ status: 'removed', reason: 'The source was not fetched during this task' }); // file nobody supplied
      expect(claims[5]).toMatchObject({ status: 'confirmed', location: 1 });

      const md = readFileSync(r.resultPath!, 'utf8');
      expect(md).toContain('contract.pdf — page 2 (your file');
      expect(md).toContain('notes.txt — lines 1-2 (your file');
      expect(md).toContain('> terminate on 30 days written notice');
      expect(md).toContain('Cited page 1, but the quote is on page 3');
      expect(md).toContain('### Could not be verified');
    } finally { t.cleanup(); }
  });

  it('fails clearly, before spending anything, when a file cannot be read', async () => {
    const seen: AgentRunRequest[] = [];
    const t = setup(seen);
    try {
      const task = t.engine.createTask('Anything', { files: [join(dir, 'missing.pdf')] });
      const r = await t.engine.execute(task.id, { approver: yes });
      expect(r.task.status).toBe('failed');
      expect(r.task.error).toMatch(/does not exist/);
      expect(seen).toHaveLength(0);
    } finally { t.cleanup(); }
  });
});
