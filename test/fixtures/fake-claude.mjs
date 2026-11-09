#!/usr/bin/env node
// A stand-in for the real agent runtime, used only by tests.
// Behaviour is chosen by a directive inside the prompt, e.g. [[fake:sleep]].
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const prompt = readFileSync(0, 'utf8');
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const envelope = (extra = {}) => ({
  type: 'result', subtype: 'success', is_error: false, result: '', total_cost_usd: 0.01,
  usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 100 },
  duration_ms: 7, num_turns: 1, session_id: 'sess-fake', stop_reason: 'end_turn', terminal_reason: 'completed',
  ...extra,
});
const print = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); };

const m = prompt.match(/\[\[fake:([a-z-]+)(?::([^\]]*))?\]\]/);
const mode = m?.[1] ?? 'echo';
const arg = m?.[2];

switch (mode) {
  case 'argv':
    print(envelope({ result: JSON.stringify({ args, cwd: process.cwd(), envNames: Object.keys(process.env).sort(), promptLength: prompt.length }) }));
    break;
  case 'sleep':
    setInterval(() => {}, 1000);
    break;
  case 'flood': {
    // Write continuously but respect back-pressure, like a real chatty program.
    const chunk = 'x'.repeat(65536);
    const pump = () => { while (process.stdout.write(chunk)) { /* keep writing */ } process.stdout.once('drain', pump); };
    pump();
    break;
  }
  case 'badjson':
    process.stdout.write('this is not json\n');
    process.exit(0);
    break;
  case 'crash':
    process.stderr.write('segfault-ish failure\n');
    process.exit(2);
    break;
  case 'error':
    print(envelope({ is_error: true, subtype: 'error_during_execution', result: 'something went wrong' }), 1);
    break;
  case 'budget':
    print(envelope({ is_error: true, subtype: 'error_max_budget_usd', terminal_reason: 'budget_exhausted', result: undefined, total_cost_usd: 0.0009 }), 1);
    break;
  case 'schema':
    print(envelope({ result: '{"answer":"Paris"}', structured_output: { answer: 'Paris' } }));
    break;
  case 'noisy':
    process.stdout.write('some warning from the runtime\n');
    print(envelope({ result: 'after-noise' }));
    break;
  case 'cost':
    print(envelope({ result: 'costly', total_cost_usd: Number(arg) }));
    break;
  case 'plan': {
    // Returns a plan for the planner: a tiny valid structure.
    const plan = { subtasks: [
      { key: 't1', title: 'Part one', kind: 'general', instructions: 'Do part one', dependsOn: [] },
      { key: 't2', title: 'Part two', kind: 'general', instructions: 'Do part two', dependsOn: [] },
      { key: 't3', title: 'Combine', kind: 'general', instructions: 'Combine', dependsOn: ['t1', 't2'] },
    ], estimateUsd: { low: 0.1, high: 0.3 }, assumptions: ['Assumed English'] };
    print(envelope({ result: JSON.stringify(plan), structured_output: plan }));
    break;
  }
  case 'edit': {
    // Coding agent: writes one file in the folder it runs in. Directive: [[fake:edit:name=content]]
    const eq = (arg ?? '').indexOf('=');
    writeFileSync(arg.slice(0, eq), arg.slice(eq + 1) + '\n');
    const out = { summary: 'Edited ' + arg.slice(0, eq) + '. All tests pass now.', notes: '' };
    print(envelope({ result: JSON.stringify(out), structured_output: out, total_cost_usd: 0.03 }));
    break;
  }
  case 'findings': {
    // Research agent: one finding about the page named in the directive.
    const url = arg || 'https://example.com/page';
    const out = { findings: [{ claim: 'The Moon is about 384,400 km from Earth.', type: 'number', url, title: 'Moon facts', quote: 'average distance of 384,400 km', important: true }], notes: '' };
    print(envelope({ result: JSON.stringify(out), structured_output: out, total_cost_usd: 0.02 }));
    break;
  }
  case 'badfindings':
    print(envelope({ result: '{"findings":"nope"}', structured_output: { findings: 'nope' } }));
    break;
  case 'ask': {
    // Schema-aware: answers the clarifier with two questions and the planner with a plan.
    const schema = flag('--json-schema') ?? '';
    if (schema.includes('"questions"')) {
      const out = {
        questions: [
          { id: 'q1', text: 'Which region?', options: ['Global', 'Europe'], default: 'Global' },
          { id: 'q2', text: 'How deep?', options: [], default: 'Overview' },
        ],
        assumptions: ['English sources only'],
      };
      print(envelope({ result: JSON.stringify(out), structured_output: out, total_cost_usd: 0.004 }));
    }
    const plan = { subtasks: [{ key: 't1', title: 'Only task', kind: 'general', instructions: 'Do it', dependsOn: [] }], assumptions: [] };
    print(envelope({ result: JSON.stringify(plan), structured_output: plan }));
    break;
  }
  default:
    print(envelope({ result: 'echo:' + prompt.trim().replace(/\[\[fake:[^\]]*\]\]/g, '').trim(), model: flag('--model') }));
}
