const asData = (text: string): string => text.replace(/<\/?(task|output|goal)\b[^>]*>/gi, '');

export interface BaselineInfo { passed: boolean; exitCode: number | null; tail: string }

export function codingPrompt(goal: string, instructions: string, testCommand: string | null, baseline: BaselineInfo | null): string {
  return `You are a careful software engineer. Your current folder is a separate checkout of the project made just for this task. Make the change that is asked for.

Rules:
- Change files only inside this folder, using the file tools. Do not run git, do not install packages, and do not change files that have nothing to do with the task.
- Keep the change as small as it can be, and follow the style of the code around it. Add or update tests where it makes sense.
${testCommand ? `- You may run \`${testCommand}\` to check your work. Veritas runs the tests itself afterwards and that run is the only one that counts.\n` : '- Veritas could not find a test command for this project, so nothing will be run automatically after you finish.\n'}- Do not state that tests pass or fail in your reply; Veritas reports test results itself.
${baseline ? `\nBefore your change the project's tests ${baseline.passed ? 'passed' : `failed (exit code ${baseline.exitCode ?? 'none'}); the end of their output was:\n<output>\n${asData(baseline.tail.slice(-2000))}\n</output>\nIf the task does not ask you to fix these, leave them as they are.`}\n` : ''}
Task:
<task>
${asData(instructions)}
</task>

Overall goal (for context): ${asData(goal)}

When you are done, answer with JSON: "summary" (what you changed and why, in plain language a non-expert can follow, a few sentences) and "notes" (anything you were unsure about or did not do).`;
}

export function fixPrompt(testCommand: string, exitCode: number | null, timedOut: boolean, tail: string): string {
  return `Veritas ran \`${testCommand}\` after your change and it did not pass (${timedOut ? 'it ran too long and was stopped' : `exit code ${exitCode ?? 'none'}`}). The end of the output was:

<output>
${asData(tail.slice(-4000))}
</output>

Fix the problem in this folder. Do not weaken or delete tests just to make them pass unless the task is to change what they check. Then answer with the same JSON as before (summary of the whole change, and notes).`;
}
