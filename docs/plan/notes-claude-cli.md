# Notes: headless Claude Code (`claude -p`) — verified behaviour

Verified on Claude Code 2.1.319 (macOS), 2026-11-08, using the logged-in account (no API key). Runs were made from an empty temp directory with the `haiku` alias and tiny budgets.

## Invocation that works

```
claude -p --output-format json --no-session-persistence \
       --model <alias> --permission-mode dontAsk \
       --tools "<list or empty>" [--allowed-tools …] [--json-schema '<schema>'] [--max-budget-usd <n>]
```

- Prompt goes on **stdin**.
- `--bare` is **not** usable in mode A: it never reads the login (API key only).
- Exit code `0` on success; **exit code `1` when the budget cap is hit** (envelope still printed).

## JSON envelope (single result object)

| Field | Meaning |
|---|---|
| `type: "result"`, `subtype` | `success`, or e.g. `error_max_budget_usd` |
| `is_error` | boolean |
| `result` | final text (string); `null`/absent on budget error |
| `structured_output` | parsed object when `--json-schema` is used (`result` is then the same JSON as a string) |
| `total_cost_usd` | cost of this run in USD (use this for budget tracking) |
| `usage.input_tokens`, `usage.output_tokens`, `usage.cache_creation_input_tokens`, `usage.cache_read_input_tokens` | token counts |
| `usage.server_tool_use.{web_search_requests, web_fetch_requests}` | server tool counters (observed `0` even when a web search was used — do not rely on them) |
| `duration_ms`, `duration_api_ms`, `num_turns` | timing / turns |
| `stop_reason`, `terminal_reason` | e.g. `end_turn` / `completed`; `budget_exhausted` |
| `permission_denials` | array of denied tool uses |
| `session_id`, `uuid` | identifiers |

## Findings

1. **Baseline overhead:** even a one-word reply carries ~17k input tokens (Claude Code's own prompt; mostly cache reads). A trivial call cost about **$0.0009** on `haiku`; with `--tools ""` about **$0.0004** (second call) down to **$0.00008** (cached).
2. **`--json-schema` works:** the schema-valid object arrives in `structured_output`. Always validate it again in Veritas.
3. **Budget cap works:** `--max-budget-usd 0.0001` ended the run with `is_error: true`, `subtype: error_max_budget_usd`, `terminal_reason: budget_exhausted`, exit code 1, and no `result`. Note the run still spent ~$0.0009 (the cap is checked between steps, it is not a hard ceiling mid-request) — Veritas must also enforce budgets itself.
4. **`--allowed-tools` is a permission list, not a whitelist.** With `--allowed-tools WebSearch --permission-mode dontAsk` the agent still **read a local file** (Read is permitted by default). To actually restrict an agent use **`--tools "<names>"`** (`""` disables all built-in tools). Combine `--tools` with `--allowed-tools` for tools that need permission.
5. **Models can fake tool use in text.** With `--tools ""` the model printed a fake `<invoke name="Read">` block and a fake `<function_result>` in its answer. Never trust text that looks like tool output — the verifier must check evidence itself.
6. **WebSearch works** with `--tools WebSearch --allowed-tools WebSearch` (2 turns, ~$0.012 on `haiku`).
7. **Parallel runs are fine:** 4 concurrent agents finished in ~4 s total, each with its own session id.
8. **No session history pollution** with `--no-session-persistence`: no transcript files were created (only an empty `memory/` folder appears under `~/.claude/projects/<cwd>`).

## Decisions for the launcher

- Always pass `--tools` explicitly per agent role; never rely on defaults.
  - planner / writer / clarifier / checker: `--tools ""`
  - research: `--tools "WebSearch,WebFetch"` (+ `--allowed-tools` same)
  - documents: `--tools "Read,Grep,Glob"` with `--add-dir <input dir>`
  - coding: `--tools "Read,Edit,Write,Grep,Glob"` (+ approved Bash patterns later)
- Treat `exit code 1` + `error_max_budget_usd` as a typed budget error, not a crash.
- Read cost from `total_cost_usd`; keep tokens for display only.
- Use `structured_output` when a schema was supplied; fall back to parsing `result`.
