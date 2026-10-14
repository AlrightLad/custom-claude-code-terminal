# Draft feature request (NOT filed) — status line escape-sequence passthrough

Status: FILED to github.com/anthropics/claude-code (issue link appended at bottom).
Target: github.com/anthropics/claude-code

---

## What actually crosses the status line boundary (as of 2.1.296)

This does not seem to be documented anywhere, and it is useful on its own: it
defines the design space for any rich status line, not just one project.

A `statusLine` command's stdout is not written to the terminal. Claude Code
runs a VT tokenizer over it (states for CSI, OSC, DCS, APC, PM, SOS, plus a
truncation-repair pass over the same introducers) and re-renders the result
inside its own TUI cell grid. Tested class by class (SGR/OSC-8 by inspection,
OSC set-title by reading the window title, DCS/APC by screenshot):

| Class | Example | Crosses to the terminal? |
|---|---|---|
| SGR colour (CSI m) | `\e[38;2;r;g;bm` | Yes, re-rendered |
| OSC 8 hyperlink | `\e]8;;url\e\\` | Yes (special-cased) |
| OSC set title (0/2) | `\e]0;title\a` | No |
| DCS / Sixel | `\ePq…\e\\` | No |
| APC / Kitty graphics | `\e_G…\e\\` | No |
| CSI cursor / erase | `\e[2J`, `\e[5A` | No (consumed) |
| DEC private modes | `\e[?25l` | No |
| C1 8-bit controls | `0x9b`, `0x90` | No (stripped) |

Root cause: the host re-renders captured output as cells by design, so only
text, SGR colour and OSC 8 survive **through stdout**. **Consequence:** a status
line cannot show a bitmap *through its stdout*. DCS (Sixel) and APC (the Kitty
protocol) are the only ways to put pixels in a terminal and both are dropped
there, so the stdout ceiling is two colours per character cell. This is a sound
default — it stops a misbehaving script from corrupting the UI — but it also
rules out pixel-art status lines, sparkline/graph widgets, small inline charts,
and progress visualizers, even on terminals that could render them.

## Pixels are already reachable out-of-band — which is the real argument

A status-line process can bypass stdout entirely and write a pixel protocol
straight to the terminal device. This is not hypothetical:
- **POSIX:** `andywxy1/claude-pet` finds the terminal device by walking the
  process tree (`ps -o tty=`) and opening `/dev/<tty>`, then writes Kitty
  graphics there. Works today.
- **Windows:** the same idea works through `CONOUT$` (the `/dev/tty` analogue).
  Demonstrated in WezTerm: a status-line-style process (stdout redirected) writes
  a **Sixel** and a **Kitty** image via `CONOUT$` and the terminal renders it —
  real pixel art, zero dependencies. Frames and the full method are in the demo
  repo below.

So the ceiling is already broken; people just have to go *around* Claude Code to
do it. That bypass races the TUI's repaints, has no way to reserve space or
coordinate with the host, and can corrupt the display. **That is exactly why a
sanctioned, opt-in region is worth adding:** it turns a fragile hack that projects
are already shipping into a safe, first-class contract.

## Proposal: an opt-in passthrough region

What the finding above enables:

    "statusLine": { "type": "command", "command": "...", "rows": 8, "passthrough": true }

With `passthrough` set, Claude Code reserves `rows` rows at the bottom, does no
tokenizing or width accounting on that region, and writes the script's bytes to
the terminal verbatim, restoring cursor state around them. Default behaviour is
unchanged. The script owns those rows and guarantees it stays within them —
the same contract a full-screen app has with the alternate screen — so the host
only has to fence the region (save/restore cursor, clip scroll).

## Evidence that can be attached

- The tokenizer and its introducer table from the shipped binary.
- The per-class passthrough matrix above, reproducible with a ~90-line probe
  script (`harness/escprobe.mjs`) that any maintainer can run against a build.
- A working half-block renderer that would switch to Sixel the moment a
  passthrough region existed, as the reference consumer.

## Workaround without any host change

Half-block / sextant cell art in 24-bit colour. It works in every terminal and
needs nothing new; this request only raises the ceiling for terminals that
speak Sixel or the Kitty protocol, behind an explicit opt-in.

---

**Filed:** https://github.com/anthropics/claude-code/issues/101955
