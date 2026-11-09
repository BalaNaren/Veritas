# Cost of research reports: measured runs

Real runs on a Claude Code login (mode A), default models (planner and writer `opus`, research agents `sonnet`, checker `haiku`), Veritas 0.1.0, 2026-11-08. These are single runs, not averages; costs vary with how much the agents search and read.

| Question | Research tasks | Claims | Confirmed / flagged / removed | Cost |
|---|---|---|---|---|
| Earth–Moon distance and orbital period (narrow, 2 tasks) | 2 | 8 | 0 / 2 / 6 *(first version)* | $0.19 |
| Same question after the checker fix | 2 | 8 | 3 / 0 / 5 | $0.19 |
| Lithium-ion pack prices since 2013, drivers (broad) *(before the source-address fix)* | 4 | 54 | 1 / 11 / 42 | $0.98 |
| Same, after the source-address and year-context fixes | 4 | 41 | 0 / 28 / 13 | $0.77 |
| Same, after the low-confidence rule | 4 | 45 | 6 / 16 / 23 | $1.01 |

Reading the numbers:

- A narrow question costs about $0.20; a broad report with four research tasks and 40 to 55 claims costs about $0.80 to $1.00. Most of the money goes to the research agents (web search and reading); checking 45 claims with the small model costs a few cents, and writing costs a few tens of cents.
- The three broad-question rows are not a trend: the fixes between them changed how claims are judged, which is why the status counts move.
- Many claims are removed because the agent's quote does not contain a number the claim states, which is the check working as designed: removal is of the claim, and the report says so.
- Cost per task type will be re-measured as more types are added (M3, M4).
