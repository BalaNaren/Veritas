# Sandbox and data analysis: what is guaranteed, what was measured, what is not covered

Veritas 0.1.0, tested on macOS (2026-11-08).

## How analysis code is run

The AI writes the analysis program but never runs anything. Veritas runs the program in a sandbox, keeps the code, the printed output and the files it wrote, and treats the stored results as the only source for computed numbers. A claim about a computed number must quote the stored result lines it relies on, every number in the claim must match those values (rounding to the precision shown, a stored fraction given as a percentage, and a unit word naming the stored unit are accepted), and an independent checker judges direction and meaning.

If no sandbox is available, analysis code is not run at all. There is no fallback that runs it unconfined.

## What the macOS sandbox (`sandbox-exec`) enforces, and the test that proves each

Each row is an attack run by the program inside the sandbox in `test/sandbox/sandbox-exec.test.ts`. The same code was also run outside the sandbox as a positive control: it connected to a local server and read `/etc/passwd` and `~/.zshrc`.

| Attack | Result inside the sandbox |
|---|---|
| Connect to this machine, to the internet (TCP and UDP), look up a name | All blocked |
| Write to the home folder, `/tmp`, `/private/var/tmp`, or next to the input files | All blocked; nothing was created |
| Read a file elsewhere on disk, the home folder, `~/.ssh`, `/etc/passwd` | All blocked |
| Change an input file | Blocked; inputs are read-only copies and the original is never touched |
| Start another program (`echo`, `curl`, `sh`) | Blocked |
| See the caller's environment variables or API keys | None are passed |
| Run forever | Stopped at the time limit, promptly, with its process group |
| Print without end | Cut at 1 MiB and flagged as truncated |
| Leave a symbolic link in `output/` pointing at a system file | Not followed |

Other limits: files up to 20 MB each, at most 50 output files, 200 MB of input, no core dumps.

## What is not covered

- `sandbox-exec` is a macOS feature Apple marks as deprecated. It works today; a future macOS could remove it.
- Memory use is not capped under `sandbox-exec` (macOS offers no reliable limit); only time, output size and file size are. The Docker backend sets memory, CPU and process limits.
- The Docker backend (used where `sandbox-exec` does not exist) is written, and its command line is tested (no network, read-only root, all capabilities dropped, no new privileges, memory/CPU/process limits, only the private work folder mounted, base image pinned by digest, pinned libraries identical to the local ones). It has not been run against a real Docker here because Docker is not installed on the test machine.
- The sandbox protects the machine from the program. It cannot make a wrong analysis right: the program can compute the wrong thing correctly. That is why the code is shown in the report and the checker reads the stored results.
- Chart captions are the agent's description of the picture and are not checked.

## Measured runs (real model, real sandbox, pandas and matplotlib)

A 72-row sales file (3 regions, 24 months), question: which region grew fastest between 2023 and 2024, what was total revenue in each year, with a chart.

| Run | Claims confirmed / flagged / removed | Cost | Notes |
|---|---|---|---|
| First | 2 / 1 / 5 | $0.22 | Five correct claims removed because "3,324.78 thousand" was scaled to millions; matcher fixed |
| After fix | 1 / 7 / 0 | $0.20 | Years flagged as "not in the quote" although in the run's output; rule fixed |
| After both fixes | 8 / 0 / 0 | $0.15 | Answer matches an independent recomputation of every figure from the CSV |

The first run's answer was only partly useful because correct claims were removed; the fixes changed how claims are judged, not the data or the question.
