# Prior art

Six comparable Claude Code status-line pet/mascot projects, read from their
READMEs and source (URLs below). What each does better than this cell-based
golf renderer, and two findings that change our plan.

## What each does better

**andywxy1/claude-pet** — real pixel images, not cell art. Renders PNG sprites
with the Kitty graphics protocol written to the real terminal device, decoupled
from the status line's stdout, so the sprite floats above the text immune to the
cell grid. POSIX-only (see the TTY finding). Our equivalent on Windows does not
exist. https://github.com/andywxy1/claude-pet

**byQuexo/claude-pet (idlemon)** — runs as a resident mod *inside* Claude Code
(`modules:["./register.js"]`), repainting only the pet's cells once a second via
`$.ui.blit` / `on('ui.render')`, so there is no process per frame. A full idle
RPG. This is the architecture that actually beats the per-frame cost.
https://github.com/byQuexo/claude-pet

**TeXmeijin/claude-code-mascot-statusline** — the most relevant to us. It
reverse-engineered the exact truncation that breaks multi-line cell sprites and
works around it (details in the width finding), has swappable character packs,
and detects terminal width from the parent TTY (cached 5s).
https://github.com/TeXmeijin/claude-code-mascot-statusline

**astrosteveo/claude-statusline** — draws one animation per situation and lets
kitty loop it, so it moves smoothly between refreshes instead of stepping at the
repaint rate. Deep TOML segment config with priority-based width degradation
("never clips"). Python stdlib; ~10ms a refresh, 4 of them interpreter startup.
https://github.com/astrosteveo/claude-statusline

**Nomlings/statusline** — frictionless: effectively one file, zero deps, the
installer writes and removes the settings entry for you. A good install-UX bar.
https://github.com/Nomlings/statusline

**DanielAckroyd/claude-pet** — compiled Go (~10ms/render), real cross-platform
incl. Windows (text-only pet). Two patterns worth stealing: `--segment` prints
only the pet so users embed it in their own status line instead of replacing it,
and a hard never-fail guarantee ("the statusline command never fails; if
anything goes wrong the pet just doesn't show"). https://github.com/DanielAckroyd/claude-pet

## Finding 1 — a 40ms per-frame gate is not reachable in Node

The "~40ms" target traces to no published figure in byQuexo's repo (searched;
NOT FOUND). What the repos actually show: ~10ms is reached by a **compiled Go
binary** or a **Python-stdlib** script (which reports 4ms of its 10ms is
interpreter startup), and byQuexo's own fast path avoids per-frame cost by being
a **resident mod**, not a spawned process. A cold-started per-frame **Node**
process pays tens of ms of V8/Node startup before any of our code runs, so
40ms is marginal-to-impossible for our architecture regardless of how tight our
render is. Consequences for us are in `docs/PERF.md` (revised gate): measure and
bound *our* cost, treat Node startup as a floor we do not control, and if we
ever want to beat it, the lever is architecture (resident mod / compiled
sidecar), not micro-optimization.

## Finding 2 — the TTY graphics side-channel (H.1 reopened, correctly)

H.1 proved Claude Code tokenizes and re-renders the status line's **stdout**.
andywxy1 bypasses that entirely: it opens the real terminal device as a file
descriptor (`fs.openSync`/`writeSync`) and writes Kitty-graphics **APC**
sequences there, never to stdout. It deliberately does **not** use `/dev/tty`
(that can resolve to Ink's internal PTY, which would overwrite the image);
instead it walks the process tree (`ps -o pid=,ppid=,tty=`) to the first real
terminal and opens `/dev/<tty>`. Escapes are `\x1b_G…\x1b\\` carrying a base64
PNG, z-indexed above text, double-buffered for flicker-free frames.

This is a genuine lever H.1 never tested, and `docs/PROBE.md` is corrected to say
so. But it is **POSIX + Kitty-protocol only** (kitty, Ghostty, WezTerm). It does
not help on this project's Windows target: Windows Terminal has no Kitty
protocol, and **no repo in this set implements a Windows CONOUT$ graphics
channel** — DanielAckroyd has real Windows support but a text-only pet whose
`tty_windows.go` is just `GetConsoleMode` for terminal detection. So the cell-art
ceiling stands on Windows; the TTY+Kitty path is a future enhancement for
POSIX users, with the cell renderer as the universal fallback.

## Finding 3 — the real width mechanism

TeXmeijin, verbatim: Claude Code's status-line renderer uses Ink's
`<Text wrap="truncate">`, which "invokes `cli-truncate` on the entire multi-line
output as a single string. When **any line** exceeds the statusLine container's
available width, all subsequent lines are silently dropped." So the failure is
not per-line clipping — one overflowing line drops every line after it (the
mascot shows "just the ears"). Their mitigations: keep visible pixels as
half-blocks but emit transparent cells as background-coloured non-breaking
spaces so the host does not trim trailing space, and split summary text at `|`
into width-constrained lines. Our width gate (`harness/widths.sh`) must assert
the whole-string behaviour and drop whole elements by priority rather than
letting any row overflow; this is the basis for the responsive layout work.

## Two patterns to adopt

- **Segment mode** (DanielAckroyd): a `--segment` output that prints only the
  golfer so users can embed it in an existing status line. Replacing someone's
  status line is a real adoption barrier.
- **Never-fail** (DanielAckroyd): already implemented here — a caught error
  prints a dim marker, logs, and exits 0, never a stack trace.
