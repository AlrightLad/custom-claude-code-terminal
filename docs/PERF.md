# Performance

Measured, not estimated. Re-run with `node harness/perf-profile.mjs` (single
session) and `node harness/stress.mjs 8 12` (eight concurrent sessions).

## Is there a process leak? No.

The reported lockup is not this renderer leaking processes. A census across all
live sessions during normal use showed three `node` processes total: one
unrelated, and two live status-line renders at age ~1s (they exit cleanly every
frame). The status line is one short-lived `node` per frame; it reads stdin,
renders, writes, exits. The hooks spawn one short bash/node each and exit. The
sound hook backgrounds one `powershell` that ends with the ~1s WAV. Nothing
accumulates. If a machine locks up with many sessions open, it is aggregate CPU
during spawn bursts, not a leak — mitigations below.

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
