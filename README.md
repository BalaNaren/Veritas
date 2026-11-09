<p align="center"><img src="docs/assets/wordmark.svg" alt="Veritas" width="100%"></p>

<p align="center"><img src="docs/assets/banner.svg" alt="Veritas: every claim checked. Give it a goal. Parallel agents do the work. An independent checker tests every claim against its source." width="100%"></p>

**Veritas is an AI task agent that shows its work.** You give it a goal. A planner splits it into tasks, parallel agents do them, and an independent checker tests every claim against its source before a cited result is written. What fails the check is removed, and the result says so.

It does research reports, analysis of your own files and data, and code changes. Today it is a command-line tool that runs on your own Claude Code login. A visual app and a hosted service come later.

## See it work

<p align="center"><img src="docs/assets/console.svg" alt="A Veritas run in the terminal: planning, one analysis task, eight claims checked and confirmed, a cited report" width="100%"></p>

The recording above is the real terminal view, drawn from the events of a real run on a small sample file. Waiting time is shortened; every number in it was recorded.

## What it does

<p align="center"><img src="docs/assets/capabilities.svg" alt="Verified claims, parallel agents, your files and data, safe by default" width="100%"></p>

<p align="center"><img src="docs/assets/flow.svg" alt="How a task flows: goal, plan, agents, check, result. Removed claims are listed with the reason; flagged claims are shown with a warning." width="100%"></p>

## Quick start

You need Node.js 22.13 or newer and [Claude Code](https://claude.com/claude-code), logged in. Veritas is not on npm yet, so run it from this folder:

```
npm ci
npm run build
node bin/veritas.js doctor        # checks Node, your Claude login and the data folder
```

Then try one of these (add `--budget 1` to cap the spending at one dollar):

```
# research, with a cited report
node bin/veritas.js run "How has the price of solar panels changed since 2015?" --budget 1

# questions about your own files: every statement cites the exact page
node bin/veritas.js run "What are the termination terms?" --file contract.pdf

# data analysis: the AI writes the code, Veritas runs it in a sandbox, numbers come only from that run
node bin/veritas.js setup         # once; asks before installing anything
node bin/veritas.js run "Which region grew fastest?" --file sales.csv

# code: the change is made in a separate copy; your files are not touched
node bin/veritas.js code "Fix the failing test" --repo ~/projects/app
```

Before anything runs you see the plan and a cost estimate and you approve it. Afterwards:

| Command | What it does |
|---|---|
| `list`, `status`, `show <task>` | See your tasks. `show <task> --claims` lists every claim and whether it was confirmed, flagged or removed; `--claim 3` shows its source, exact quote and checks. |
| `export <task> --as pdf` | Save a finished report as Markdown, Word (`docx`) or PDF. |
| `cost` | What you have spent, by day, task and model. |
| `apply <task>` | Keep a coding task's change: save it as a commit, or with `--merge` / `--pr` merge it or open a pull request. Each step asks first. |
| `discard <task>` | Throw away a coding task's separate copy. |
| `memory` | See, search or erase what Veritas remembers between tasks. |
| `approve`, `resume`, `cancel` | Decide a waiting question, continue a paused task, or stop one. |
| `config`, `doctor`, `setup` | Settings, health check, and the analysis sandbox. |

## How much to trust it

Verification confirms that a claim **matches its source**. It does not prove the source is right. What is measured so far (details and methods in [`docs/eval`](docs/eval)):

- **Exact checks are code, not AI.** A cited page must have been fetched by Veritas itself, the quote must be on it, and the numbers must match. On a test set of 238 labelled claims, every fabricated quote, altered number and invented source was rejected by these checks, and no wrong claim was confirmed.
- **An independent AI checker** reads each surviving claim and its quote and judges whether they support it. That step is good but not perfect, and the test claims were fairly blatant. Real pages are messier.
- **Numbers from data come only from code that ran** in a sandbox with no network, and the code is included in the report.
- **Code changes** are made in a separate git worktree. "Tests passed" appears only if Veritas ran the tests itself and they exited cleanly. Commit, merge and push always ask you first.
- **Cost:** about $0.20 for a narrow question and about $0.80 to $1.00 for a broad research report, on a Claude Code login.

Known limits: scanned PDFs with no text layer are refused; numbers written as words ("fivefold") are checked only by the AI checker; project test commands run unsandboxed with your privileges after you approve them once; the Docker sandbox backend has never been run against real Docker; opening a pull request needs the `gh` tool and has not been tested live. The full list is in [`docs/eval`](docs/eval) and [`CLAUDE.md`](CLAUDE.md).

## Status

Version 0.1.0, built and tested by one person on macOS. The command-line tool covers research, documents, data analysis and coding. Not built yet: the visual app, the hosted service and plans. See [`docs/PRODUCT.md`](docs/PRODUCT.md) for the product definition and [`docs/plan/BUILD-PLAN.md`](docs/plan/BUILD-PLAN.md) for the plan.

## Development

```
npm ci
npm run build
npm test                 # unit and end-to-end tests with a fake agent runtime
npm run eval:verify      # measures the claim checker on the labelled set (uses the real model, about $0.10)
npm run probe:permissions  # checks what an agent can reach with Veritas's permission rules
npm run art              # regenerates the graphics in docs/assets
```

## License

Apache-2.0
