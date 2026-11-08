# Veritas — Build Plan (M1–M5)

> **Status:** planning complete, no code yet · **Owner:** Bala Naren Chanumolu · **Last updated:** 2026-11-08
> Product definition: [`docs/PRODUCT.md`](../PRODUCT.md) · Diagrams: [`docs/DIAGRAMS.md`](../DIAGRAMS.md)

This plan turns the product document into concrete build steps. Each milestone ends with **working, tested code** — never stubs, simulated output or placeholder metrics. Milestones are build steps, not releases: nothing is publicly launched until v1.0 (M1–M5) is complete.

Some building blocks are adapted from existing MIT-licensed code (permission obtained). The mapping of which files to adapt lives in the private build notes **outside this repo** (`../veritas-build-notes/SOURCE-MAP.md`, section numbers `§N` below). Adapted code must be fully renamed and cleaned — see "Rules for adapted code".

---

## 0. Decisions (changes since PRODUCT.md)

| # | Decision | Reason | Doc impact |
|---|---|---|---|
| D1 | **Model access mode A is the default:** Veritas launches headless Claude Code (`claude -p`) per agent, using the user's existing Claude Code login. **Mode B** (Anthropic API key, `@anthropic-ai/sdk`) is added in M5 for the hosted service and users without Claude Code. | No API key needed for local users; test with real runs immediately. Hosted service must not route personal subscriptions. | Update PRODUCT.md §9 (model layer) and §12 (deployment) after M1. |
| D2 | **Storage uses Node's built-in `node:sqlite`** (Node ≥ 22.13; verified on Node 24 with FTS5). No native modules, no WASM. | Zero dependencies; full-text search built in. | §9.5 unchanged in spirit. |
| D3 | **Node ≥ 22.13, TypeScript, ESM** (`module/moduleResolution: NodeNext`), `tsc` build, **vitest** tests. | Matches adapted code; `node:sqlite` requirement. | — |
| D4 | **Data-analysis sandbox (M3):** Docker if installed; otherwise macOS `sandbox-exec` profile (no network, writes only inside a temp dir); otherwise data analysis is disabled with a clear message. | Docker is not installed on the dev machine. | §11.3 — add the macOS fallback. |
| D5 | **License:** Apache-2.0, open source, public repo `github.com/BalaNaren/Veritas`. | Per PRODUCT.md. | — |
| D6 | **Every dependency pinned to an exact version** (`"x": "1.2.3"`, no `^`/`~`); `package-lock.json` committed; no runtime installs, no `npx …@latest`. | Principle 5.5. | — |

---

## 1. Rules for adapted code (apply in every milestone)

1. **No upstream references anywhere** — code, comments, docs, commit messages, package names, env vars, file paths, user-agent strings. Use `veritas` / `VERITAS_*` / `.veritas/` / branch prefix `veritas/`.
2. **Copy only what genuinely works.** Remove or replace: random/simulated metrics, fake workers, simulated consensus, auto-update, background daemons, global config edits, telemetry/promo/ads, `npx …@latest` fallbacks, shell-string execution.
3. **After every adaptation run the clean-check** (from the private notes) and `npm test`. A CI step (M1) fails the build if any banned term appears.
4. **Replace `Math.random` IDs with `crypto.randomUUID()`**; atomic file writes (temp + rename, mode `0o600`).
5. Header comment on adapted files: none needed beyond the normal Veritas file header (Apache-2.0 SPDX line).

---

## 2. Repository layout (target after M5)

```
Veritas/
├── package.json            # "veritas" CLI, bin: veritas, exact-pinned deps
├── tsconfig.json           # NodeNext, strict, outDir dist
├── vitest.config.ts
├── LICENSE                 # Apache-2.0
├── README.md
├── CLAUDE.md               # context for coding sessions
├── bin/veritas.js          # 10-line entry → dist/cli/main.js
├── src/
│   ├── cli/                # parser, output, commands/*            (M1)
│   ├── shared/             # event bus, resilience, ids, json       (M1)
│   ├── security/           # path validator, safe exec, safe git    (M1)
│   ├── storage/            # node:sqlite db, migrations, repos      (M1)
│   ├── engine/             # task manager, planner, scheduler,
│   │                       # message bus, agent pool, event log     (M1)
│   ├── agents/             # claude-code launcher (mode A),
│   │                       # provider interface, prompts             (M1; API mode B in M5)
│   ├── cost/               # run cost, transcript ledger, prices    (M1)
│   ├── policy/             # approvals, policy engine, budget gates (M1)
│   ├── clarify/            # clarifying questions + assumptions     (M2)
│   ├── evidence/           # evidence store, source snapshots       (M2)
│   ├── verify/             # five-step verifier                     (M2)
│   ├── tools/              # web fetch (SSRF-safe), text extract    (M2)
│   ├── research/           # research task type                     (M2)
│   ├── write/              # writer/assembler, report renderers     (M2)
│   ├── documents/          # pdf/docx/xlsx/csv/json readers         (M3)
│   ├── data/               # sandboxed analysis, charts             (M3)
│   ├── sandbox/            # docker / sandbox-exec backends         (M3)
│   ├── memory/             # cross-task memory (FTS)                (M3)
│   ├── coding/             # worktrees, coding agents, test runs    (M4)
│   ├── hosted/             # client for the hosted service          (M5)
│   └── version.ts
├── server/                 # hosted service (separate package)      (M5)
├── test/                   # unit + integration + golden sets
│   └── golden/             # verification test set (labeled claims) (M2)
└── docs/
    ├── PRODUCT.md, DIAGRAMS.md
    └── plan/BUILD-PLAN.md
```

Local data (user machine): `~/.veritas/` → `veritas.db` (SQLite), `tasks/<id>/` (sources, artifacts, logs), `config.json`. Task outputs also written to `./veritas-output/<slug>/` in the folder where the task was started.

---

## 3. Core data model (SQLite, created in M1, extended later)

```sql
tasks(id TEXT PK, slug, goal, type, status, created_at, updated_at, budget_usd, spent_usd,
      mode TEXT, cwd, assumptions JSON, plan JSON, result_path, error)
subtasks(id PK, task_id FK, idx, title, kind, model, depends_on JSON, status, started_at,
         finished_at, cost_usd, input_tokens, output_tokens, output JSON, error)
events(id INTEGER PK AUTOINCREMENT, task_id, subtask_id, ts, type, data JSON)   -- append-only
approvals(id PK, task_id, action, detail JSON, status, requested_at, decided_at, decided_by)
-- M2
sources(id PK, task_id, url_or_path, title, kind, fetched_at, sha256, text_path, quality)
claims(id PK, task_id, subtask_id, text, type, source_id, quote, location JSON, status,
       verdict JSON, important INTEGER)
-- M3
memory(id PK, key, content, tags JSON, created_at) + memory_fts (FTS5)
-- M4
worktrees(id PK, task_id, path, branch, base, status), test_runs(id PK, task_id, command,
       exit_code, stdout_path, started_at, finished_at)
```

Task status machine: `draft → clarifying → planned → awaiting_approval → running → verifying → writing → done | failed | cancelled | paused`.
Event types (append-only, drive live progress and `veritas show`): `task.created`, `clarify.asked`, `clarify.answered`, `plan.created`, `approval.requested/decided`, `subtask.started/progress/finished/failed`, `cost.updated`, `budget.exceeded`, `source.fetched`, `claim.extracted`, `claim.verified`, `artifact.written`, `task.finished`.

---

## M1 — Engine

**Goal:** a real multi-agent run from the terminal: goal → plan → user approval → parallel `claude -p` agents → collected results, with live progress, cost tracking that actually stops at the budget, approvals and a complete task record. No verification yet (M2).

### M1 tasks

**1. Repo bootstrap**
- [x] `package.json` (name `veritas`, `type: module`, `bin: {veritas: bin/veritas.js}`, `engines: {node: ">=22.13"}`), exact-pinned dev deps: `typescript`, `vitest`, `@types/node`.
- [x] `tsconfig.json` (ES2022, NodeNext, strict incl. `noImplicitAny`), `vitest.config.ts`, `.gitignore`, `LICENSE` (Apache-2.0), `README.md` stub.
- [x] `scripts/clean-check.mjs`: fails if banned upstream terms appear in `src/ test/ docs/ README.md package.json`; wired into `npm test`.
- [x] GitHub Actions: `npm ci && npm run build && npm test` on push/PR (actions pinned to commit SHAs).

**2. Spike: confirm `claude -p` behaviour (do first, record results in `docs/plan/notes-claude-cli.md`)**
- [x] Run a tiny prompt with `claude -p --output-format json --no-session-persistence --model haiku` (prompt on stdin); record exact envelope fields (`result`, `is_error`, `total_cost_usd`, `usage`, `duration_ms`, `session_id`).
- [x] Confirm `--json-schema` makes `result` (or a structured field) schema-valid JSON.
- [x] Confirm `--allowed-tools`, `--permission-mode dontAsk`, `--max-budget-usd` behaviour (what happens when budget is hit).
- [x] Confirm running several in parallel works and does not touch the user's session history.

**3. CLI framework** (§1)
- [x] Adapt `types.ts`, `output.ts`, `parser.ts`, `blocking-stdio.ts` → `src/cli/`. Optional `prompt.ts`, `suggest.ts` (added when needed).
- [ ] Write new `src/cli/main.ts` (~250 lines): parse → dispatch → error handling. **No startup side effects.**
- [ ] Commands registry (~40 lines) + commands: `run`, `plan`, `status`, `show`, `list`, `approve`, `cancel`, `config`, `doctor`, `cost`, `version`.
- [ ] `bin/veritas.js` 10-line entry.

**4. Shared + security** (§4, §5)
- [x] `src/shared/`: `runProcess` (argv-only spawn, timeout + group kill, output cap), env allowlist, ids, atomic fs writes, `safeJsonParse`. *(Event bus: small typed emitter in the engine instead of the generic one. Retry/circuit-breaker/rate-limiter/bulkhead deferred until a consumer needs them.)*
- [x] `src/security/`: path validator, safe git (hardened, subcommand allowlist), safe executor (exact absolute-path allowlist, no presets). *(Token generator and keychain adapter deferred to M5 where authentication needs them.)*
- [x] Tests for path escape (`/root` vs `/root-evil`, symlinks), executor rejects `/tmp/evil/git`, git hardening flags present, real repo with malicious fsmonitor config.

**5. Storage** (D2)
- [x] `src/storage/db.ts` on `node:sqlite` (`DatabaseSync`), WAL, foreign keys, numbered migrations, repositories for tasks/subtasks/events/approvals.
- [x] Data dir resolution (`VERITAS_HOME` override → `~/.veritas`), created `0o700`; files `0o600`.

**6. Agent launcher — mode A** (§2)
- [x] `src/agents/claude-code.ts`: resolve `claude` binary (adapt `resolveClaudeLaunchCommand`), `runClaude({prompt, cwd, model, allowedTools, permissionMode, jsonSchema, maxBudgetUsd, appendSystemPrompt, timeoutMs, signal})`.
  - argv: `-p --output-format json --no-session-persistence --model <m> --permission-mode dontAsk [--allowed-tools …] [--json-schema …] [--max-budget-usd …] [--append-system-prompt …]`; prompt on **stdin** only.
  - env allowlist: `PATH, HOME, USER, LANG, TERM, TMPDIR, SHELL, CLAUDE_CONFIG_DIR, ANTHROPIC_*` (no full `process.env`).
  - `detached` process group; timeout → SIGTERM group → SIGKILL after 5 s; stdout capped (e.g. 10 MB).
  - Parse envelope (adapt `parseClaudePrintJsonEnvelope`) → `{ok, text, json, costUsd, inputTokens, outputTokens, durationMs, raw}`.
- [x] `src/agents/provider.ts`: `interface ModelProvider { run(req): Promise<RunResult> }` — mode A implements it; mode B added in M5.
- [x] `src/agents/models.ts`: role → model alias map (planner/writer: `opus`, worker: `sonnet`, checker: `haiku`), overridable in config.
- [x] Tests with a **fake `claude` binary** (a node script on PATH in the test env) covering success, error envelope, timeout kill, oversized output, invalid JSON.

**7. Engine**
- [x] `src/engine/engine.ts`: create/load/transition tasks (state machine above), pause/resume/cancel.
- [x] `src/engine/planner.ts`: planner agent (opus, no tools) returns schema-validated plan `{subtasks:[{title, kind, instructions, dependsOn[], model}], estimateUsd:{low,high}, assumptions[]}`; reject cycles; cap subtasks (default 8).
- [x] `src/engine/scheduler.ts` (~300 lines, new): runs subtasks respecting `dependsOn`, concurrency limit (default 4), retries with backoff, posts `subtask.*` events; adapt message bus + agent pool (§3) for bookkeeping.
- [x] `src/engine/event-log.ts`: append events, subscribe for live progress, replay for `veritas show`.
- [x] Generic worker kind for M1: `general` (agent with no tools) so the engine is exercised end-to-end before task types exist.

**8. Cost & budget** (§12)
- [x] Per-run cost from the envelope; accumulate per subtask and task; `cost.updated` events.
- [x] Budget enforcement: pass remaining budget as `--max-budget-usd` to each agent; scheduler stops dispatching and pauses the task at 100%; asks approval to continue (policy gate).
- [ ] `veritas cost` report (by task / day / model) from the DB. Optional: transcript ledger (adapted `claudeRows` with dedupe) for cross-checking.
- [ ] Price book only used for **estimates** (re-verify rates; mark `priced:false` for unknown models).

**9. Policy & approvals** (§13)
- [x] Adapt policy core (types, evaluator, engine) → `src/policy/`, **default mode `enforce`, default-deny** for risky actions.
- [x] Approval actions: `plan.start`, `budget.exceed`, (M2+) `network.new_destination`, (M4) `git.commit/push/merge`, `fs.write_outside_output`, `cmd.first_run`.
- [ ] CLI prompt for approvals when interactive; `veritas approve <id>` when not. AI can never approve.

**10. CLI experience**
- [ ] `veritas run "<goal>" [--budget 2] [--yes-plan] [--model-*]`: shows plan + estimate → approve → live progress table (subtasks, status, cost so far) → summary.
- [ ] `veritas show <task>`: full record (plan, events, costs, outputs). `veritas list`, `veritas status`.
- [ ] `veritas doctor`: checks Node version, `claude` found + logged in (cheap probe), data dir permissions.

### M1 tests
- Unit: parser, output, security, storage repos, planner validation (cycles, caps), scheduler (deps order, concurrency, retry, cancel), budget stop, policy decisions.
- Integration with fake `claude`: full `veritas run` → plan → approve → 3 parallel subtasks → done; budget exceeded → paused; cancel mid-run.
- Live smoke (manual, uses subscription): `veritas run "List three facts about the Moon, one per subtask" --budget 0.50`.

### M1 exit criteria
- A multi-step task runs end to end with live progress, real parallel `claude -p` agents, and a budget limit that **actually stops work**.
- Every step is in the event log; `veritas show` reconstructs the full record.
- Clean-check passes; `npm test` green; no stubs or simulated values in `src/`.

---

## M2 — Research reports

**Goal:** `veritas run "Research X"` produces a cited report where every claim is checked by the five-step pipeline (PRODUCT.md §10).

### M2 tasks

**1. Clarifier** (`src/clarify/`)
- [ ] Clarifier agent (sonnet, no tools) returns `{questions:[{id, text, options[], default}], assumptions[]}` or `{ready:true}`; CLI asks with defaults; answers + assumptions stored on the task and shown in the result.

**2. Web fetch tool** (§7, `src/tools/web-fetch.ts`)
- [ ] Adapt fetch with SSRF fixes: DNS resolve all A/AAAA + block private/link-local/reserved ranges (full list in notes), pin the resolved IP, `redirect:'manual'` with per-hop re-validation (max 5), byte cap, timeout, content-type allowlist (html, text, pdf, json).
- [ ] `src/tools/extract.ts`: HTML → readable text (pinned `@mozilla/readability` + `linkedom`, or a small in-house extractor), PDF text via `pdfjs-dist` (pinned). Store snapshot text + sha256 in `~/.veritas/tasks/<id>/sources/`.
- [ ] Tests: SSRF table (`127.0.0.1`, `[::ffff:127.0.0.1]`, `[fd00::1]`, `169.254.169.254`, `localhost.`, decimal/octal IPv4, redirect to private), extraction fixtures.

**3. Research agents** (`src/research/`)
- [ ] Research subtask = `claude -p` with `--allowed-tools WebSearch WebFetch`, `--json-schema` for findings: `{findings:[{claim, type:"fact|number|quote", url, title, quote, publishedAt?}], notes}`. Instructions: only claims backed by an exact quote from a page actually read.
- [ ] Planner prompt for research: split topic into 3–6 sub-questions.

**4. Evidence store** (`src/evidence/`)
- [ ] Tables `sources`, `claims`; every finding's URL is **re-fetched by Veritas itself** (web-fetch tool) — the agent's fetch is not trusted.
- [ ] Source quality labeling: rules (gov/edu/official domains, filings → primary; known reputable outlets → secondary; else low) + checker-agent fallback; recency check for fast-changing figures.

**5. Verifier** (`src/verify/`) — PRODUCT.md §10.3
- [ ] Step 1 *source exists* (code): source fetched in this task and stored.
- [ ] Step 2 *quote matches* (code): normalized (whitespace, quotes, dashes, case-insensitive) substring match in the snapshot; record location.
- [ ] Step 3 *support check* (checker agent, haiku, no tools, sees only claim + passage ± context): verdict `supported | partial | not_supported | contradicted` + reason, schema-enforced.
- [ ] Step 4 *numbers* (code + checker): every number in the claim must appear in the quote (normalize units/commas/%).
- [ ] Step 5 *cross-check* (checker): for `important` claims, compare with other sources' claims; disagreements → flagged with both sides.
- [ ] Outcome mapping → `confirmed | flagged | removed | analysis`; verification summary object.
- [ ] Prompt-injection hardening: source text wrapped as data with explicit delimiters; checker has no tools.

**6. Writer / assembler** (`src/write/`)
- [ ] Writer agent (opus, no tools) receives only verified/flagged claims with IDs; must cite `[c<ID>]` for every factual statement; analysis sentences marked.
- [ ] Post-check (code): every sentence with a number/named fact references a claim ID; unreferenced factual sentences are sent back once, then removed or labeled analysis.
- [ ] Renderers: Markdown (citations → numbered footnotes with URL + quote), DOCX (pinned `docx`), PDF (pinned `pdfmake`); verification summary appended; "Assumptions" at top.

**7. Golden verification set** (`test/golden/`)
- [ ] ~50 research questions + ~200 hand-labeled claims (supported / unsupported / contradicted, incl. deliberately wrong numbers and fake quotes) with stored source snapshots (offline).
- [ ] `npm run eval:verify` reports checker accuracy (uses real checker model; manual run, costs money); code-only steps tested in CI.

### M2 exit criteria
- Research reports pass the golden set with **zero invented sources** and **zero fabricated quotes** (code checks).
- Checker accuracy measured and recorded with the method (PRODUCT.md §16.7 baseline).
- Cost per typical report measured and documented.

---

## M3 — Documents & data analysis

**Goal:** analyze user files with exact-passage/page citations and numbers from code that actually ran.

### M3 tasks
- [ ] **Readers** (`src/documents/`): PDF (`pdfjs-dist`, per-page text), DOCX (`mammoth`), TXT/MD, CSV (in-house parser), XLSX (pinned `exceljs`), JSON. Each yields `{pages|sections:[{n, text}]}` stored as sources (`kind: file`, location = page/section).
- [ ] **Document agents**: `claude -p` with `--add-dir <input dir>` and `--allowed-tools Read Grep Glob` only; findings schema includes `{file, page, quote}`. Verifier steps 1–2 check against Veritas's own extracted page text.
- [ ] **Large jobs**: split files across parallel agents; merge findings; comparison mode (document × attribute table, every cell a claim).
- [ ] **Sandbox** (`src/sandbox/`, D4): backends `docker` (pinned image digest, `--network none`, read-only input mount, tmpfs output, cpu/mem/time limits) and `sandbox-exec` (generated profile: deny network, deny file-write outside temp dir, read-only input copy); a Python runtime with pinned `pandas`, `matplotlib` in a Veritas-managed venv (created only with user approval in `veritas setup`).
- [ ] **Data agents**: agent writes analysis code (returned via schema, no execution tools); **Veritas runs it in the sandbox**, captures stdout/files; computed-number claims reference `{runId, outputKey}`; numbers checked against stored output (verifier step 4).
- [ ] **Charts** saved as PNG next to the report; code included in the task record.
- [ ] **Memory** (`src/memory/`, §6 adapted to `node:sqlite` + FTS5): remember sources/preferences across tasks; `veritas memory list|search|clear`; can be disabled in config.

### M3 exit criteria
- Every number in tested analyses traces to code that ran (100%); every document statement traces to an exact passage and page.
- Sandbox tests: network blocked, writes outside temp dir blocked, timeout enforced.

---

## M4 — Coding

**Goal:** real code changes in a separate git worktree, real test results, nothing committed/pushed/merged without approval.

### M4 tasks
- [ ] **Worktrees** (§8): adapt coordinator → `src/coding/worktrees.ts` with lock file, base-branch assertion, conflict detection, cleanup; branch prefix `veritas/`; all git via hardened safe-git.
- [ ] **Coding agents**: `claude -p` with `cwd` = worktree, `--permission-mode acceptEdits`, `--allowed-tools Read Edit Write Grep Glob` + `Bash(<approved test command>)` only; parallel agents get separate worktrees or file-scoped leases (fenced lease reference, persisted in SQLite).
- [ ] **Test runs**: Veritas itself runs the project's test command (approved on first use per project, `cmd.first_run`) via safe executor; stores exit code + output; any "tests pass" claim must reference a `test_runs` row (verifier rule).
- [ ] **Delivery**: diff summary, test results, `veritas apply <task>` (approval) to merge into a branch; optional PR creation via `gh` (approval, `git.push`).
- [ ] **Guards**: never touch the user's working tree; refuse dirty base when integrating; approvals for commit/push/merge always asked.

### M4 exit criteria
- Coding tasks never modify the user's working files directly; every "tests pass" claim is backed by a captured test run; commit/push/merge always require approval.

---

## M5 — Hosted service & plans

**Goal:** the same engine running as a hosted service with accounts, Veritas keys, usage limits and billing; local CLI can use either mode.

### M5 tasks
- [ ] **Mode B provider** (`src/agents/anthropic-api.ts`): official `@anthropic-ai/sdk` (pinned), tool use with server-side web search/fetch + citations, code execution tool for hosted sandbox; same `ModelProvider` interface and JSON schemas as mode A. (Consult current Claude API docs for model IDs and tool versions at build time.)
- [ ] **Server** (`server/`, separate package): HTTP API (task create/stream events/download artifacts), auth (CLI device-code login → token stored in OS keychain), job queue (Postgres-backed, e.g. pg-boss), worker pool running the engine in mode B, Postgres for data, S3-compatible object storage for sources/artifacts, per-user isolation.
- [ ] **MCP server** (§9) for Claude Code integration — stdio first; HTTP only with **fail-closed** auth (no auth config → refuse to start), Origin checks, no query-string tokens.
- [ ] **Usage & billing**: usage units per plan (PRODUCT.md §13.4 — unit still to choose), allowance shown before each task, hard stop at allowance (no overage), Stripe subscriptions (Free/Pro/Team).
- [ ] **CLI**: `veritas login`, `--local/--cloud` per task, Veritas-key privacy notice (requests pass through Veritas servers).
- [ ] **Security review** before launch: data isolation, deletion/export, secrets, rate limiting, prompt-injection tests.

### M5 exit criteria
- Data isolation and deletion tested; pricing covers measured AI cost per task type; hosted and local modes both pass all v1.0 launch criteria (PRODUCT.md §14.1).

---

## After v1.0 (from PRODUCT.md §14.3)
Visual app (web/desktop, uses hosted API) · other AI providers (provider interface) · plugin/skills system (§10 adapted SDK, gated loading) · Claude Code hooks & status line (§11, minimal, no ads) · scheduled tasks · team workspaces · integrations · semantic memory.

---

## Effort estimate (solo, full-time equivalent — rough)
| Milestone | Estimate |
|---|---|
| M1 Engine | 1.5–2 weeks |
| M2 Research + verification + golden set | 2–3 weeks |
| M3 Documents & data + sandbox | 2 weeks |
| M4 Coding | 1–1.5 weeks |
| M5 Hosted + billing + security review | 3–4 weeks |

## Open questions
1. Usage unit for plans (tasks vs credits) — before M5.
2. Hosted infrastructure provider — before M5.
3. Whether to ship the Python venv automatically or require the user to approve its creation — M3 (plan assumes approval).
