# Performance

Measured, not estimated. Re-run with `node harness/perf-profile.mjs` (single
session) and `node harness/stress.mjs 8 12` (eight concurrent sessions).

## GATE STATUS

- **Per-frame wall p99: FAIL.** 241 ms mean / 387 ms p99 on a loaded machine
  against the 40 ms mean / 100 ms p99 gate — ~2.4x over. The dominant term is
  Node startup (bare `node -e 0` is 108 ms here, which alone exceeds the p99
  gate), plus ES-module loading of ~16 files. Bundling + a quiet machine is the
  path back under; see "Getting under the gate".
- **8-session aggregate CPU: FAIL.** ~214% of one core in bursts; must come down
  per the lightweight-outranks-features rule.
- **Process leak: ROOT-CAUSED and FIXED** (below). The earlier "no leak" line
  was drawn from a healthy single-session census, which is the wrong state to
  clear a lockup from; corrected here.

## Lockup root cause: blocking stdin read (FIXED)

The status line read its JSON with `fs.readFileSync(0)`, which blocks until
stdin EOF. Tested directly: a renderer spawned with stdin left open **hung
indefinitely** (confirmed). Claude Code cancels an in-flight status line when a
new repaint triggers; if the cancelled process's stdin is not closed, that
blocking read never returns and the process survives. One stalled process per
cancellation, times 4-8 sessions each spawning 1-3x/sec, accumulates into a
sudden hard lockup — which matches the reported symptom far better than a
gradual CPU creep.

Fix (committed): stdin is read asynchronously with a short deadline
(`CCGOLF_STDIN_MS`, default 400 ms) — if the JSON never arrives the frame
renders from persisted state. When done the process destroys stdin and exits
**naturally** so buffered stdout flushes (calling `process.exit()` mid-write
truncates piped output — that regression was caught by the width gate and
fixed). A ref'd deadline guarantees a render even if stdin yields nothing, and
an unref'd hard watchdog (`CCGOLF_TIMEOUT_MS`, default 4 s) force-exits if
anything pathological hangs. Normal frames still finish on stdin `end` with no
added latency (measured: identical wall at a 400 ms vs 5000 ms deadline).
Verified: a renderer with stdin left open now self-exits in ~0.6–1 s, code 0,
instead of hanging. Any error prints a blank line and exits 0 — never a stack
trace (the "never fail" rule).

## Evidence (tests A and B)

**B — survivor count, old vs new code** (`harness/kill-test.mjs`, 60 spawns
each, stdin left open):

| code | abandon (open stdin, no signal) | SIGTERM mid-render |
|---|---|---|
| old (`fs.readFileSync(0)`) | **60 survivors** (all hung) | 0 |
| new (async + watchdog) | **0 survivors** | 0 |

This is the direct proof: the old code leaked one process for every frame that
was cancelled by being abandoned with stdin open; the new code leaks none. The
SIGTERM column being 0 for both shows signal-based cancellation never leaked, so
the mechanism is specifically the open-stdin abandon path — exactly what the fix
addresses.

**A — continuous census under load** (`harness/census.mjs`, 8 sessions, max
cadence, 1-in-5 frames abandoned to exercise cancellation): the live renderer
count stays flat at ~0 throughout (sampled every 10s), e.g. 456 spawns / 91
abandoned by t=144s with 0 live and 0 residual. Flat line, no accumulation —
the leak hypothesis is retired for the new code under the real failure load.
(Full 10-minute curve printed by the harness.)

A single-session census during normal use likewise showed only transient
renders at age ~1s; that was never sufficient on its own to clear a lockup,
which is why A and B above were run.

## Single session (measured 2026-10-12, busy dev laptop, i7-1365U)

These numbers were taken while the machine was under heavy unrelated load
(browser + Teams at ~70% CPU), so absolute values are a pessimistic ceiling;
on a quiet machine the render body was 9–28 ms earlier in the project.

| Metric | Value |
|---|---|
| spawn-to-exit wall, mean / p99 | 241 ms / 387 ms |
| bare `node -e 0` wall, mean | 108 ms (**45% of the total is Node startup**) |
| render body (in-process, no Node startup), mean / p99 | 76 ms / 106 ms |
| peak RSS per process | 54 MB |
| per-process CPU (user+sys), mean | 272 ms |

Where the body time goes: it is dominated by **ES-module loading of the ~16
source files**, not by the render compute. A warm in-process render
(`harness/*` bench, no per-call module load) is 0.4–8 ms for scene + quantize
across tiers and sizes. So the per-frame floor is Node startup (~108 ms here,
not ours to change) plus one-time module graph evaluation; the actual drawing
is a small fraction.

Honest conclusion for a single session: the CPU cost of one golfer is
negligible. The only consequence of a slow frame is that Claude Code cancels it
in flight and the frame is skipped — a dropped frame, not load. Under this
much background load the p99 (387 ms) does exceed the 100 ms in-flight budget,
so some frames drop; that degrades smoothness, nothing else.

## Eight concurrent sessions (the real case)

`node harness/stress.mjs 8 12 350` — 8 sessions, 4 WORKING + 4 IDLE, each
spawning every 350 ms for 12 s, on the same loaded machine:

| Metric | Value |
|---|---|
| aggregate spawns | 7.7/s (1.0/s per session; back-pressured by the ~240 ms spawn) |
| peak concurrent in-flight renders | 8 |
| aggregate CPU | ~214% of one core during the burst (~18% of this 12-thread CPU) |
| peak RSS per process | 47 MB (processes are transient, not all resident at once) |
| state writes (after skip-unchanged) | 4.1/s |

214% of one core across 8 sessions is two cores busy in bursts: noticeable on a
loaded laptop, trivial on a quiet workstation. It is not a lockup on its own.

## What changed (2b fixes) and the before/after that matters

- **Disk churn.** State was written every frame. Now the entry writes only when
  the meaningful state changed, or once per 8 s to keep the clock fresh. The two
  truly frozen idle phases (waiting on the tee, standing over the ball) no
  longer advance their timer, so they write once and then skip. Across the
  8-session mix that cut aggregate writes from one-per-spawn (~7.7/s) to
  **4.1/s**, and a session that sits idle for minutes now writes ~once per 8 s
  instead of once per second.
- **Career file contention (corruption risk).** The cumulative career was a
  single `career/career.json` that every session did read-modify-write on —
  with 4–8 sessions that loses updates and can corrupt the file. It is now
  sharded per session (`career/<session_id>.json`, atomic temp-then-rename);
  no two processes ever write the same file. `careerTotals()` merges the shards
  on read for a future career view. **No shared mutable file remains.**
- **Kill switch.** `CCGOLF_DISABLE=1` (set it in `~/.claude/settings.json`
  under `env`, or export it) makes every golfer in every session print an empty
  status line and exit immediately, before any work — one place to stop them all
  under load.
- **Per-session everything.** State, mode (`mode-<session_id>`) and career are
  all keyed on `session_id`; the single-instance concern is inherently
  per-session because each frame is its own process keyed on its own files.

## Headroom and where it would go next

The render compute is already cheap; the per-frame cost is Node startup plus
module-graph evaluation. The one optimization that would move the number is
bundling `src/` into a single file to cut ESM load (an estimated 10–30 ms off
the body under load), which is a build step, not a hot-path change. Given the
costs above, that is optional: the honest position is that a single golfer is
free, and the mitigations for the many-session case are the write-skip, the
sharded career file, and the kill switch, all in place and measured.
