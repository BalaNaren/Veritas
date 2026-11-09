# Veritas — context for coding sessions

Veritas is an open-source (Apache-2.0) AI task agent: give it a goal, a planner splits it into tasks, parallel agents do the work, an independent verifier checks every claim against its source, and a writer delivers a finished, cited result. Launch task types: research reports, document & data analysis, coding.

- Product definition: `docs/PRODUCT.md` (read the Principles section before writing code)
- Build plan with milestones M1–M5, data model, task checklists and exit criteria: `docs/plan/BUILD-PLAN.md`
- Private build notes (which existing MIT files to adapt, with file:line fixes): `../veritas-build-notes/SOURCE-MAP.md` — **outside this repo; never copy that file or its contents' project names into the repo.**

## Current status
**M1 (engine) and M2 (research reports) are complete** and committed. M2 adds: clarifying questions; SSRF-safe web fetch; evidence store with hashed snapshots and source aliases; the five-step verifier (code checks for source, quote and numbers; an independent tool-less checker for support and cross-checks); research agents; a writer whose output is post-checked in code; Markdown/DOCX/PDF export (`veritas export`); claim inspection (`veritas show --claims`). Measured: `docs/eval/verify-2026-11-08.md` (checker accuracy on 238 labelled claims) and `docs/eval/research-cost-2026-11-08.md` (about $0.20 for a narrow question, about $0.80–1.00 for a broad one). Known gaps: the ~50 end-to-end research-question set is not built; PDF sources are refused until M3; numbers written as words are checked only by the AI checker. **Next step: M3 (documents & data analysis)** per `docs/plan/BUILD-PLAN.md`.

## Non-negotiable rules
1. **No references to the upstream project** anywhere in this repo: code, comments, docs, commit messages, package names, env vars (`VERITAS_*` only), paths (`.veritas/`), branch prefixes (`veritas/`). Run `npm run clean-check` (added in M1) before every commit.
2. **Never fake it:** no simulated work, random/hard-coded metrics, placeholder results or stubs presented as working. If something isn't implemented, it errors clearly.
3. **Safety by default:** argv-only process execution (no shell strings), exact absolute-path allowlists, explicit env allowlists, atomic writes with `0o600`, no auto-update, no background daemons, no global config edits, no telemetry unless opted in, no ads.
4. **Pinned dependencies** (exact versions, lockfile committed); never `npx …@latest` or runtime installs.
5. **Every milestone ends with working, tested code**; `npm test` must stay green.

## Technical decisions
- TypeScript, ESM, `module: NodeNext`, Node ≥ 22.13, `tsc` build, vitest.
- Storage: built-in `node:sqlite` (FTS5 available) at `~/.veritas/veritas.db` (`VERITAS_HOME` overrides).
- Model access **mode A (default):** each agent is a headless Claude Code run — `claude -p --output-format json --no-session-persistence --model <alias> --permission-mode dontAsk [--allowed-tools …] [--json-schema …] [--max-budget-usd …]`, prompt on stdin, env allowlist, process-group kill on timeout. Do **not** use `--bare` (it requires an API key). Mode B (Anthropic API key) comes in M5.
- Model roles: planner/writer `opus`, workers `sonnet`, checker `haiku` (configurable).

## Working with the owner
- Bala Naren Chanumolu is the sole developer; never refer to "the team".
- Discuss before large changes; show results with real runs where possible (mode A uses his Claude subscription — keep live test runs small and budget-capped).
- Honest claims only: no invented numbers or sources in docs or UI.
