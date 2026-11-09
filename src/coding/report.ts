import type { CodingInfo } from '../storage/models.js';
import type { TestRunRow } from './test-runs.js';

export interface CodingReportInput {
  goal: string;
  assumptions: readonly string[];
  /** The agent's own description of its change, with test claims already removed. */
  summary: string;
  notes: string;
  removedTestClaims: number;
  files: readonly string[];
  stat: string;
  diff: string;
  diffTruncated: boolean;
  runs: readonly TestRunRow[];
  info: CodingInfo;
  taskId: string;
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
const outcome = (r: TestRunRow): string => (r.timedOut ? 'stopped (ran too long)' : r.exitCode === null ? 'could not run' : r.passed ? 'passed' : `failed (exit code ${r.exitCode})`);
const fence = (text: string, lang = ''): string => `\`\`\`${lang}\n${text.replace(/```/g, "'''").trimEnd()}\n\`\`\``;

/** The one sentence about tests. It is built from the recorded runs only; nothing an agent says can change it. */
export function testVerdict(runs: readonly TestRunRow[], testCommand: string | null): string {
  if (!testCommand) return 'No tests were run: Veritas could not find a test command for this project, so nothing here has been checked by tests.';
  const baseline = runs.find((r) => r.phase === 'baseline');
  const rounds = runs.filter((r) => r.phase.startsWith('round'));
  const last = rounds.at(-1);
  if (!last) return `The tests were not run after the change (\`${testCommand}\`).`;
  const before = baseline ? ` Before the change they ${baseline.passed ? 'passed' : 'were failing'}.` : '';
  return last.passed
    ? `The tests passed after the change: Veritas ran \`${last.command}\` and it exited with code 0.${before}`
    : `The tests did NOT pass after the change: Veritas ran \`${last.command}\` and it ${outcome(last)}.${before} Do not merge this without looking into why.`;
}

export function renderCodingReport(r: CodingReportInput): string {
  const out: string[] = [`# ${r.goal.replace(/\s+/g, ' ').trim()}`, ''];
  if (r.assumptions.length) out.push('## Assumptions', '', ...r.assumptions.map((a) => `- ${a}`), '');
  out.push('## Result', '', testVerdict(r.runs, r.info.testCommand), '');
  out.push('## What the agent says it changed', '', r.summary || '(no description)', '');
  if (r.notes) out.push('Notes from the agent:', '', r.notes, '');
  out.push('*This description is the agent\'s own and has not been checked. Read the changes below.*', '');
  if (r.removedTestClaims) out.push(`*${r.removedTestClaims} sentence(s) in the agent's description that made claims about test results were removed. Test results come only from the runs Veritas made itself, below.*`, '');

  out.push('## Changes', '');
  if (!r.files.length) out.push('No files were changed.', '');
  else {
    out.push(`${r.files.length} file${r.files.length === 1 ? '' : 's'} changed:`, '', fence(r.stat), '', fence(r.diff, 'diff'));
    if (r.diffTruncated) out.push('', '*The diff was cut because it is very long; see the branch for the full change.*');
    out.push('');
  }

  out.push('## Test runs', '');
  if (!r.runs.length) out.push('No test runs were recorded.', '');
  else {
    out.push('| When | Command | Result | Time |', '|---|---|---|---|');
    for (const t of r.runs) out.push(`| ${t.phase === 'baseline' ? 'Before the change' : t.phase === 'setup' ? 'Setup' : `After the change, round ${t.phase.replace('round', '')}`} | \`${t.command}\` | ${outcome(t)} | ${seconds(t.durationMs)} |`);
    out.push('');
    const failing = [...r.runs].reverse().find((t) => !t.passed && t.phase !== 'baseline') ?? (r.runs.every((t) => !t.passed) ? r.runs.at(-1) : undefined);
    if (failing) out.push(`End of the output of the last failing run (${failing.phase}):`, '', fence(failing.output.slice(-3000)), '');
  }

  out.push('## Where the work is', '');
  out.push(`- Your own working folder was not touched. The change was made in a separate copy${r.info.worktree ? ` at \`${r.info.worktree}\`` : ''}${r.info.branch ? `, on the branch \`${r.info.branch}\`` : ''}.`);
  out.push('- Nothing has been committed, merged or pushed. To keep the change, run:');
  out.push('', fence(`veritas apply ${r.taskId}            # save it as a commit on its own branch\nveritas apply ${r.taskId} --merge    # also merge it into ${r.info.baseBranch}\nveritas apply ${r.taskId} --pr       # also push the branch and open a pull request\nveritas discard ${r.taskId}          # throw it away`), '');
  out.push('Each of those asks you first.');
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}
