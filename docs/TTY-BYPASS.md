# TTY side-channel bypass — study of the working implementations

Claude Code tokenizes status-line **stdout** and strips DCS (Sixel) and APC
(Kitty) escapes (proven from the binary, docs/PROBE.md H.1). So a status line can
never emit pixels through stdout. The **TTY side-channel** goes around that: a
status-line process opens the terminal *device* directly and writes the graphics
protocol there, bypassing Claude Code entirely. Two shipping projects do this on
POSIX. This document records exactly how, as the basis for a Windows attempt.

Sources read end-to-end (cloned to scratch, not vendored):
- `andywxy1/claude-pet` (TypeScript) — Kitty sprite overlay.
- `astrosteveo/claude-statusline` (Python) — Kitty *animation* game scene.

Both are **POSIX-only**. Neither touches Windows, CONOUT$, or Sixel. Nobody has
built this on Windows — that is the open question (see docs/TTY-BYPASS-WINDOWS.md).

---

## 1. Finding the terminal device from inside a status line

`claude-pet/src/tty.ts`. The hard part is that Claude Code spawns the status line
**without a controlling terminal**, and even when `/dev/tty` resolves it may point
at Ink's internal PTY, not the user's real terminal — writing graphics there gets
them instantly overwritten by Ink. So the mechanism is:

1. **Do NOT use `/dev/tty`.** (Explicit comment: it "may resolve to Ink's internal
   PTY, not the user's actual terminal (Ghostty). Ink would immediately overwrite
   any Kitty graphics.")
2. **Walk the process tree** from `process.ppid` upward, up to 15 levels. For each
   ancestor PID run:

       ps -o pid=,ppid=,tty= -p <pid>

   parse the three fields, and if the `tty` field is non-empty and not `??`/`?`,
   try `fs.openSync('/dev/' + tty, 'w')`.
3. The first device that opens for writing **is** the real terminal. Return
   `{ path, fd }`. If an open fails (permission), keep climbing via the parsed
   `ppid`. Return `null` if the root is reached with nothing openable.

Device paths by platform: macOS `/dev/ttysNNN`, Linux `/dev/pts/N`. Writes go
through `fs.writeSync(fd, data)`; the channel swallows write errors so a closed
terminal never crashes the status line.

> The whole trick is: an fd to the real terminal device, obtained out-of-band,
> whose writes Claude Code never sees and therefore never tokenizes.

## 2. stdout vs the TTY fd (the split)

`claude-pet/src/index.ts`. Strict separation:
- **stdout** carries only the metrics **text** — Claude Code reads it and renders
  it as the status line. Plain SGR text, nothing else.
- **the TTY fd** carries the Kitty graphics escapes (`\x1b_G...`). Claude Code
  never sees these.

Claude Code may invoke the status line as a short-lived process, so claude-pet
renders immediately on each stdin JSON line (not only on its timers): read JSON →
update state → `outputMetricsBar()` (stdout) + `renderAnimationFrame()` (TTY).

## 3. Positioning the image relative to the status-line text

`claude-pet/src/renderer/position.ts` + `kitty.ts`. Absolute cursor placement:
- Terminal size: `process.stdout.columns/rows` if stdout is a TTY, else the
  `COLUMNS`/`LINES` env vars (set when stdout is a pipe), else `stderr`, else
  80×24.
- Ground row = `termRows - groundOffset` (default offset 4, to clear the input
  block + metrics bar). Home column ≈ `0.65 * termCols`.
- Emit: `\x1b[s` (save cursor) → `\x1b[<row>;<col>H` (move) → the image → `\x1b[u`
  (restore), as one atomic write so the real cursor never visibly jumps.

## 4. Surviving repaints, scrolling, and resize

Two different strategies, and this is the crux for Claude Code (whose TUI repaints
constantly):

**claude-pet — draw-on-top + re-emit:**
- `z=1000` in the Kitty command renders the image **above** the text layer.
- `K=1` makes the placement **persist across `CSI 2J`** (a Ghostty fork
  extension) — i.e. survive the clear that a repaint issues.
- A 200ms animation timer re-emits the frame regardless, so even a clobbered
  image reappears within one tick.
- Double-buffered image IDs (display the new ID, *then* delete the old) =
  flicker-free replacement.
- Resize is caught via **`SIGWINCH`**, not stdout's `resize` event (stdout is a
  pipe when spawned by Claude Code, so `resize` never fires); the handler
  recomputes ground/home and re-emits.

**claude-statusline — Unicode placeholder anchoring (more robust):**
`quest/art/scene.py`, `avatar.py`, `gamemode.py`. Instead of absolute position, it
uses Kitty's **Unicode placeholder** method (`U=1`): the image is given a virtual
placement, and the status-line **text** prints placeholder cells (U+10EEEE plus
diacritics that encode row/column/image-id). The terminal fills those cells with
the image. Because the anchor is *text cells in the normal stream*, the image
flows with the text and survives repaints/scroll naturally.
- Relevance to Claude Code: the placeholder characters are ordinary Unicode
  codepoints, not DCS/APC escapes, so they pass through the stdout tokenizer
  **untouched** — while the pixel payload goes over the TTY fd. This is the one
  approach whose *anchoring* is compatible with Claude Code's stdout path.

## 5. Lifecycle: upload-once vs re-emit

**claude-pet: re-emit per frame.** Every 200ms it transmits a fresh PNG
(`a=T,f=100`) under an alternating ID and deletes the previous. Simple; costs one
PNG transmit per frame; fine for a small sprite.

**claude-statusline: upload once, let Kitty loop.** The smooth-motion answer where
the protocol exists:
- Transmit frame 0: `a=T,U=1,i=<id>,f=100,c=<cols>,r=<rows>,q=2` (sized in cells,
  virtual placement).
- Add each subsequent frame as an **animation frame**: `a=a,i=<id>,r=<n>,z=<gap>`
  (`z` = inter-frame gap in ms).
- Start the loop: `a=a,i=<id>,s=3,v=1` — `s=3` sets the animation **running in a
  loop**; the terminal animates on its own, no further writes.
- Stable **slot IDs** (`SCENE_BASE + 6*slot + situation`) so an already-uploaded
  scene is reused, not re-sent.
- `t=f` transmits **by file path** (base64 of the path, not the bytes) — zero-copy,
  the terminal reads the PNG itself.
- A background layer is sent at `z=-1` (behind text); the avatar/scene on top.
- Formats: `f=100` PNG, `f=32` raw RGBA, `o=z` zlib-compressed payload, `C=1`
  "do not move the cursor".
- Cleanup: `\x1b_Ga=d,d=A,q=2\x1b\\` (delete all) + `\x1b[?25h` (restore cursor).

## 6. What this means for a Windows attempt

The device-discovery (`ps`, `/dev/<tty>`), the resize signal (`SIGWINCH`), and the
carrier (Kitty APC) are all POSIX/Kitty assumptions. On Windows:
- The `/dev/<tty>` analogue is **`CONOUT$`** (and, under MSYS/Git Bash, possibly an
  MSYS `/dev/tty` / `/dev/cons*`). Untested from a status-line child.
- Windows Terminal has **no Kitty protocol**; its only pixel carrier is **Sixel**
  (1.22+). **WezTerm on Windows has both Sixel and Kitty** — the cheapest shot.
- Sixel has no Unicode-placeholder equivalent, so repaint survival there must lean
  on re-emit + positioning, not anchoring.

Those three unknowns (channel, carrier survival, placement/persistence) are tested
in docs/TTY-BYPASS-WINDOWS.md.
