# TTY side-channel bypass on Windows — tested, with a working path

**Result: real pixels in a Claude Code status-line bypass work on Windows.** In
WezTerm, a golf frame renders as an actual Sixel (and Kitty) image, written to the
terminal from a process whose stdout is redirected (the status-line situation),
with zero dependencies. Evidence frames: `docs/frames/tty-bypass-sixel-wezterm.png`
and `docs/frames/tty-bypass-kitty-wezterm.png`.

Setup: Windows 11, WezTerm nightly (portable, no install needed). Every test tool
was validated against a known-good case first (screenshot harness vs a text
marker; the Sixel encoder vs a 4-quadrant red/green/blue/white pattern; channel
opens report bytes written).

## The three unknowns, resolved

### 2.1 — Can a status-line child open CONOUT$ and reach the terminal? YES, but the *write method* matters

`CONOUT$` is the Windows analogue of `/dev/tty`. A native-Node process with stdout
redirected opens it fine (`fs.openSync('CONOUT$','r+')` → OK, bytes written). The
catch is **how** you write:

| Writer | Path | Sixel renders? |
|---|---|---|
| PowerShell `FileStream` on the CONOUT$ handle | raw `WriteFile` | **yes** |
| `cmd /c type file > CONOUT$` | raw `WriteFile` | **yes** |
| Node `fs.writeSync(fd, …)` | libuv detects a console → `WriteConsoleW` (UTF‑8→UTF‑16, character path) | **no** (blank/garbled) |

Why: WezTerm on Windows hosts console programs through **ConPTY**. ConPTY passes a
VT/DCS byte stream through to the terminal, but only when the bytes arrive as a raw
`WriteFile`. libuv routes any write to a console handle through `WriteConsoleW`,
which re-encodes and goes through the console's character model — the Sixel never
survives. So Node can't write pixels to CONOUT$ directly; it must **delegate the
raw write**. The cheapest zero-dep delegate is `cmd /c type <tmpfile> > CONOUT$`
(cmd's `>` redirection is a raw `WriteFile`).

### 2.2 — Does a pixel protocol survive that channel? YES — both

- **Sixel** renders via the bypass (`type > CONOUT$`), 120×60 test block and a full
  452×112 golf frame. ~7 KB per frame with RLE. In-grid (no z-index).
- **Kitty** renders too, via the same bypass, with `z=1000` drawing the image **on
  top** of the text — the behaviour you want for an overlay. Heavier payload as raw
  RGBA (`f=32`, ~270 KB); use `f=100` PNG + compression to shrink. Kitty also has
  placement, Unicode-placeholder anchoring, and server-side animation looping
  (`a=a,s=3`), which are the repaint-survival and smooth-motion tools Sixel lacks.

WezTerm supports both; Windows Terminal supports only Sixel (no Kitty).

### 2.3 — Positioning & survival: partially answered

The image lands at the cursor position; Kitty `z=1000` draws above text. **Not yet
tested:** survival across Claude Code's *own* TUI repaints in a live session (the
TUI redraws the bottom region ~1/s). This is the one remaining integration unknown
and determines the final strategy:
- **Kitty** is the strong answer: `z=1000` + a stable image id + re-emit per
  status-line tick, or the Unicode-placeholder method (anchors the image to text
  cells that flow with the TUI). See docs/TTY-BYPASS.md §4.
- **Sixel** has no z-index/placement, so it would need careful positioning in the
  status-line rows + re-emit, and is more likely to be clobbered.

## The working chain (zero dependency)

```
Node status line
  → render golf → RGB → Sixel (or Kitty) bytes → temp file
  → child_process: cmd /c type <tmpfile> > CONOUT$      (raw WriteFile)
  → ConPTY passes it through
  → WezTerm renders the image
stdout still carries only the text line Claude Code tokenizes (unchanged).
```

## What this does NOT work on

- **mintty / Git Bash (the current default):** mintty is not a Windows console; a
  native program under it gets a bridged hidden conhost, and graphics written to
  CONOUT$ there are mangled (the bridge is text-only). So the bypass needs a
  ConPTY host that speaks a pixel protocol — **WezTerm** (Sixel+Kitty) or Windows
  Terminal (Sixel). The honest recommendation for pixels on Windows is therefore
  "run Claude Code in WezTerm", exactly the kind of terminal switch the user
  accepted.

## Remaining to ship (Phase 3)

1. Survive Claude Code's live TUI repaints — test in a real session; pick Kitty
   `z=1000`/placeholder + per-tick re-emit.
2. Position relative to the reserved status-line rows.
3. Detection: enable the image backend only on a ConPTY host with a confirmed
   pixel protocol; **keep the cell renderer as the universal default and fallback.**
4. Real pixel-art sprites (source PNG + manifest) for Pixel Pro Golf fidelity;
   cells downsample from the same source.
