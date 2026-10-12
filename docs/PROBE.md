# Phase 0 — capability probe

Measured, not assumed. Everything below was observed on this build before any
renderer code was written. Re-run it yourself with `harness/probe.mjs` (see the
end of this file) if your Claude Code version differs.

| Item | Value |
|---|---|
| Claude Code | 2.1.288 (Windows, native `claude.exe` build) |
| OS / Node | Windows 11, Node 24 |
| Primary terminal | Git Bash (mintty 3.8.3), `tui: fullscreen` |
| Secondary terminal | Windows Terminal 1.24, both `tui: fullscreen` and `tui: default` |
| Status line command routing | Git Bash (documented; confirmed by the subprocess environment) |

## P0.1 — COLUMNS / LINES: CONFIRMED

Both variables are present in the status line subprocess and they track the
live terminal size, including after a resize.

Evidence:

- `harness/envprobe.sh` dumped `COLUMNS=100 LINES=27` for a 100x27 mintty
  window, `COLUMNS=98 LINES=27` for a second live session, `COLUMNS=160
  LINES=40` for a Windows Terminal window started with `--size 160,40`. After
  the mintty window was resized the next invocation reported `COLUMNS=102
  LINES=28`.
- The binary sets them from its own stdout size right before spawning the
  command: `{columns,rows}=process.stdout; if(columns) env.COLUMNS=String(columns); if(rows) env.LINES=String(rows)`.
- stdin is the JSON payload, stdout is captured (`tty` reports "not a tty"),
  so `tput cols` and `process.stdout.columns` are useless inside the script.
  The claim that there is "no COLUMNS env var" is wrong for this build.

Design consequence: width and height come from `COLUMNS`/`LINES` only, with a
fallback of 80x24 when either is missing.

## P0.2 — repaint interval: measured, DISCONFIRMS the 300–1000 ms expectation

`refreshInterval: 1`, timestamps logged on every invocation, 15 minutes.

| Session | n | min | p25 | median | p75 | p95 | max | rate |
|---|---|---|---|---|---|---|---|---|
| busy (this agent working, many tool calls), mintty | 926 | 305 | 981 | 999 | 1015 | 1116 | 2121 | 1.02/s |
| idle, mintty | 902 | 363 | 985 | 1000 | 1015 | 1088 | 1724 | 1.00/s |
| idle, Windows Terminal 100x30 | 462 | 695 | 986 | 1001 | 1013 | 1055 | 1414 | 1.00/s |
| idle, Windows Terminal 160x40 | 372 | 224 | 983 | 999 | 1015 | 1095 | 2031 | 1.00/s |

All intervals in milliseconds. The busy session had 5% of intervals in the
300–599 ms band (event-driven repaints landing between timer ticks); the idle
sessions had under 1%.

The event triggers, from the binary: `tokenUsage, permissionMode, vimMode,
mainLoopModel, fastMode, effortValue, thinkingEnabled, prStatus`. Tool calls
by themselves do not repaint the status line; token-usage changes do.

Design consequence: the frame rate is 1 fps, occasionally 2–3 fps for a
single frame. Animation is keyframe-based with 2–4 frames per action, and the
simulation advances by wall-clock delta, never by frame count. A 1-second tick
is slow enough that every frame has to read on its own.

## P0.3 — fractional refreshInterval: DISCONFIRMED, and worse than ignored

`refreshInterval: 0.25` does not refresh four times a second. It disables the
timer entirely: an idle session produced exactly one repaint in two minutes
and a busy session went stale for 110 seconds between repaints.

Evidence: the settings schema is `refreshInterval: number().min(1).optional().catch(undefined)`,
so any value below 1 is replaced by `undefined`, which means "events only".
The runtime also floors it: `Math.max(1, n) * 1000`.

Design consequence: `refreshInterval: 1`, never lower.

## P0.4 — Sixel: DISCONFIRMED, cleanly

A 36x12 Sixel image (DCS `q` ... ST) was emitted from the status line in:

- mintty 3.8.3 (which supports Sixel natively), fullscreen renderer
- Windows Terminal 1.24 (Sixel since 1.22), fullscreen renderer
- Windows Terminal 1.24, default renderer

In all three cases the DCS sequence was removed before reaching the terminal.
The text following it rendered normally in the same row, no image appeared,
nothing was garbled, and the UI was intact after the probe reverted. No
recovery steps are needed because nothing breaks; it simply cannot work
through the status line. Claude Code re-renders captured text into its own
cell grid, and that path does not forward DCS.

Design consequence: backend B (`src/out/sixel.mjs`) is an interface stub for
a future sidecar process that owns a real TTY. The art direction stays with
half-block cells.

## P0.5 — row ceiling

Rows were emitted as full-width numbered rulers, so wrapping, truncation and
clipping were all visible.

| Terminal, renderer | Rows requested | Result |
|---|---|---|
| 100x30 fullscreen | 4, 8 | all rows visible, footer badges visible |
| 100x30 fullscreen | 14, 20 | only 10 rows visible, footer badges pushed off screen |
| 102x28 fullscreen (mintty) | 12 | only 10 rows visible, footer badges pushed off screen |
| 160x40 fullscreen | 8, 12 | all rows visible, footer visible |
| 160x40 fullscreen | 16, 20, 24 | only 16 rows visible, footer pushed off screen |
| 160x40 default renderer | 8, 12, 16, 24 | all rows visible, footer visible; the block grows downward under the prompt |

Fullscreen keeps a minimum height for the transcript, so the status area is
capped at about 10 rows on a 28–30 line terminal and 16 rows on a 40 line
terminal; one of those rows is Claude Code's own footer line and in
fullscreen the notification row sits above the status line as well. The
default renderer does not clip in these sizes.

Safe ceiling adopted (both renderers, footer and notification row preserved):

| LINES | rows used by WORKING mode |
|---|---|
| under 20 | 4 |
| 24 | 6 |
| 28 | 7 |
| 30 | 8 |
| 40 | 11 |
| 50 and above | 12 (hard cap) |

Formula: `clamp(floor((LINES - 6) / 3), 4, 12)`. Column count does not change
the ceiling; it only changes how wide the hole is drawn. 100 and 160 columns
were both measured at the row counts above.

Width: Claude Code truncates each row with a trailing `…` once it exceeds the
available width. Measured with rows of exact cell length:

| COLUMNS | padding | longest row shown intact |
|---|---|---|
| 100 | 1 | 94 |
| 160 | 1 | 154 |
| 160 | 0 | 155 |

So the usable width is `COLUMNS - 5 - padding`. The renderer uses
`COLUMNS - 7` cells, leaving one cell of margin, and never emits a row longer
than that, so Claude Code's own truncation never runs and never has the
chance to cut an escape sequence in half.

## P0.6 — truecolor: CONFIRMED

A 48-step 24-bit background gradient, a 256-colour gradient, a 16-colour
strip, and a row of U+2580 half blocks with independent 24-bit foreground and
background rendered correctly in:

- mintty 3.8.3, fullscreen renderer (the primary terminal; theme `dark-ansi`)
- Windows Terminal 1.24, fullscreen renderer
- Windows Terminal 1.24, default renderer (SGR passthrough confirmed with
  coloured full-width rows; the 24-bit rows were emitted there too)

Also confirmed per attribute: fg 30–37/90–97, bg 40–47, 38;5 / 48;5, 38;2 /
48;2, bold, dim, inverse, underline, italic.

Caveat that cost an hour: a session whose environment contains `NO_COLOR=1`
has every SGR sequence stripped from the status line, and Claude Code's own
UI goes monochrome too. That is Claude Code honouring `NO_COLOR`, not a
terminal limitation. The theme setting (`dark` vs `dark-ansi`) had no effect
on status line colours.

Design consequence: 24-bit SGR by default. `GOLF_COLOR=256` forces the
256-colour fallback for terminals that need it.

## P0.7 — Node startup, measured while building

The brief's budget (40 ms mean, 100 ms p99 per frame) turned out to be set
by Node itself, not by the renderer. Interleaved spawn timings on the
development laptop (13th-gen mobile i7, other applications running):

| Variant | min | median | p90 | p99 |
|---|---|---|---|---|
| `node -e 0` | 77 | 91 | 95 | 101 |
| one `.mjs` file, no imports | 93 | 103 | 118 | 132 |
| entry + 3 ESM modules | 94 | 105 | 124 | 135 |
| entry + 12 ESM modules | 99 | 114 | 138 | 144 |
| entry + 12 CommonJS modules | 97 | 110 | 117 | 157 |

Milliseconds. The same `node -e 0` measured 35/46/66 ms (min/median/p90)
earlier in the day on an idle machine, so absolute numbers move with load by
a factor of two; the differences between rows are the stable part: the ESM
loader costs about 10 ms to start plus about 1 ms per module.

The renderer's own work, measured inside the process with `GOLF_TRACE=1`,
is 9–13 ms for a full working frame (state 2, generator 1, sim 1, scene 4,
cells 2, save 2). `harness/perf.sh` now prints a bare-node baseline next to
the status line timing so the script's overhead is visible separately from
machine load. The 100 ms p99 gate holds when `node -e 0` itself is under
about 80 ms p99, which is the quiet-machine case, and cannot hold otherwise.

Things tried that did not help: `NODE_COMPILE_CACHE` (reading the cache
files cost more than compiling 2,500 lines; median got slower), fewer
modules below about six (within noise). An "imports only" script that loads
every module and exits costs the same as a full frame, so the remaining
overhead is module loading, not rendering; a single-file bundle would save
an estimated 10–15 ms and is the next step if the budget ever matters more
than the module layout.

## Other facts worth keeping

- Edits to `settings.json` hot-reload. Changing the `command` re-runs it
  immediately; no restart needed during development.
- One invocation runs per repaint; Claude Code cancels an in-flight script if
  a new repaint triggers (documented). This is why the perf gate is on p99.
- The stdin JSON (2.1.288) carries `session_id, transcript_path, cwd,
  scratchpad_dir, effort, model, workspace, version, output_style, cost,
  context_window, exceeds_200k_tokens, fast_mode, thinking`, plus
  `prompt_id, session_name, prompt_cache, rate_limits` once the session is
  active. There is no field that says whether the agent is working or
  waiting. Working/idle therefore comes from the hooks writing
  `~/.claude/golf/state/mode`.
- The status line starts about four cells from the left edge (built-in
  spacing plus `padding`). The renderer does not try to compensate.
- Windows Terminal clamps `--size` to what fits on the monitor; ask for 45
  rows and you may get 40. Trust `LINES`, not what you asked for.

## A.1 — glyph tiers per terminal (quality pass)

`harness/glyphs.sh` prints one row per tier. Observed, both as a standalone
window and routed through the status line (which passes the astral-plane
sextant code points through untouched):

| Tier | Code points | mintty 3.8.3 (Git Bash default font) | Windows Terminal 1.24 |
|---|---|---|---|
| halfblock | U+2580 U+2584 U+2588 | solid | solid |
| quadrant | U+2596..U+259F | solid | solid |
| sextant | U+1FB00..U+1FB3B | hollow boxes (font lacks them) | solid (built-in rasterizer) |
| octant | U+1CD00..U+1CDE5 | hollow boxes | solid |

Box drawing, the arrow set U+2190..U+2199 and the lower-block bar glyphs
U+2581..U+2588 render in both. Consequence: the renderer auto-selects
`sextant` when `WT_SESSION` is present and `halfblock` otherwise, and
`CCGOLF_GLYPHS=quadrant` is the right setting for mintty users who want the
extra horizontal resolution. The brief's premise that the status line could
not carry these glyphs was not the problem; fonts are.

## F.5 — spinner verbs cannot follow the sim

Checked against the settings reference and the Claude Code changelog for
2.1.23 onward: `spinnerVerbs` is `{ "mode": "append" | "replace", "verbs":
[...] }`, hot-reloads with the rest of settings.json, and the verb shown is
picked at random from the resulting list. There is no command, hook,
environment variable, per-turn override or SDK call that supplies a verb
dynamically, and the related `spinnerTipsOverride` setting is a static list
too. So the spinner cannot say "Lining up the putt..." while the golfer is
actually putting. The verbs ship as flavour, not as a status channel. If a
dynamic source ever appears, `src/sim/golf.mjs` already knows the current
phase and club; wiring it would be a few lines in the hooks.

## Scale — why the golfer kept rendering out of proportion

Three builds in a row showed the golfer too large for the course. The cause
was not two coordinate systems: sprites have always been a fixed 4 cells by
5 rows, and the world has one unit (yards) with one conversion, yards per
column, computed by the camera. The failure was that conversion. The camera
chose yards-per-column to fit either the whole hole or the fairway corridor
into the picture, and on a wide or short picture that lands at 4 to 8 yards
per column. A green is 20 to 34 yards across, so at 4 y/col it draws 5 to 8
columns wide while the golfer stays 10 units tall. A fixed-size sprite next
to a zoomed-out world is a giant.

Fix: `U_MAX = 2.0` in `src/render/scene.mjs`. The smallest green (20 yards)
is then 10 units tall, the golfer's height, and every green is at least as
tall as he is. The camera scrolls instead of fitting. `harness/scale-check.mjs`
renders frames at 80, 120 and 200 columns on two tiers and fails if the
golfer is ever taller than the green's drawn diameter or less than a third
of it; every captured replay frame carries a `dbg` row with yards-per-column,
the golfer's cell size and the green's drawn size. A sprite that would cross
the drawable area is clamped and the event is appended to
`~/.claude/golf/sprite-violations.log`.

## Idle — why the golfer kept playing with nobody home

Instrumented hooks (`hooks.log` in the golf state directory, one line per
event with the resolved path) show both hooks firing on every turn boundary
on this machine, including auto mode. The problem was what they wrote and
what the renderer did with it:

- (b) The two hooks wrote one shared `state/mode` file. With two sessions
  open, a prompt in either one marked every golfer WORKING. The hooks now
  write `state/mode-<session_id>` from the `session_id` in their stdin JSON
  and the renderer reads that file first.
- (c) IDLE only selected a scene. The state machine kept advancing, and the
  Stop transition fast-forwarded the rest of the hole. Now `advanceHole`
  takes a `freeze` flag: the shot in flight lands, rolls out and settles,
  then the phase becomes `stand` with an infinite duration. Resuming sets
  `address` from the same ball. `harness/idle-check.mjs` flips WORKING ->
  IDLE -> WORKING and asserts stroke counts and ball position.
- Stale guard: a WORKING mark older than five minutes with no change in the
  token and API-time counters of the status line payload for five minutes is
  treated as IDLE. (A long turn keeps those counters moving; a dropped Stop
  hook does not.)

## Subagent lifecycle — what the hooks expose

The hooks reference lists `SubagentStart` ("when a subagent is spawned")
and `SubagentStop` ("when a subagent finishes"), with a matcher on the
agent type (`general-purpose`, `Explore`, `Plan`, custom names). Documented
stdin fields for every event are `session_id`, `cwd` and `hook_event_name`;
the per-event schema for the subagent events is not published, and nothing
documented reports a running-subagent count or identifies one subagent
instance from another. The status line's `agent.name` is the main session's
agent, set only with `--agent`.

Captured on this machine (2.1.296) by logging the raw stdin of both events
while a one-line subagent ran:

    SubagentStart: session_id, transcript_path, cwd, scratchpad_dir, prompt_id,
                   agent_id, agent_type, hook_event_name
    SubagentStop:  the same, plus permission_mode, stop_hook_active,
                   agent_transcript_path, last_assistant_message,
                   background_tasks: [{ id, type: "subagent", status, ... }]

So each subagent has a stable `agent_id` from start to stop, its `agent_type`
is the name you would show, and the stop payload even lists the other
background tasks still running. `SubagentStop` fired twice for one agent
(`stop_hook_active` false, then true); dedupe on `agent_id`. That is enough
for a per-session roster file written by the hooks and read by the renderer.

## Reproducing

    # point the status line at the probe (hot-reloads)
    "statusLine": {"type":"command","command":"node C:/path/to/harness/probe.mjs","padding":1,"refreshInterval":1}

    # steer it: ~/.claude/golf/probe/control.json
    {"mode":"rows","rows":12,"target":"<first 8 chars of session_id>"}
    {"mode":"fit"}  {"mode":"color"}  {"mode":"sgr"}  {"mode":"wide"}
    {"mode":"sixel","target":"...","until":<epoch ms>}   # self-reverting

    # interval statistics
    node harness/probe-stats.mjs [sid8] [fromEpochMs] [toEpochMs]

`target` restricts an experiment to one session, so a Sixel or 24-row test
cannot disturb an unrelated session that happens to share the settings file.
