# Draft feature request (NOT filed) — opt-in status line graphics passthrough

Status: draft for review. Do not file without the maintainer's go-ahead.
Target: github.com/anthropics/claude-code

## Title

Opt-in status line passthrough: reserve N rows and emit the script's output untouched

## Problem

The `statusLine` command's stdout is captured, tokenized, and re-rendered
inside Claude Code's own TUI cell grid. A VT tokenizer recognizes CSI, OSC,
DCS, APC, PM and SOS and forwards only SGR colour and OSC 8 hyperlinks;
everything else is dropped. Verified on 2.1.288 and 2.1.296 (details below).

That is the right default — it keeps a misbehaving script from corrupting the
UI. But it also makes richer status lines impossible, even on terminals that
could do more. DCS (Sixel) and APC (the Kitty graphics protocol) are the only
ways to put pixels in a terminal, and both are stripped, so a status line can
never be more than two colours per character cell. This affects anything rich,
not just one project: pixel-art status lines, sparkline/graph widgets, small
charts, progress visualizers.

## Request

An opt-in setting, e.g.:

    "statusLine": { "type": "command", "command": "...", "rows": 8, "passthrough": true }

When `passthrough` is set, Claude Code reserves `rows` rows at the bottom,
does no tokenizing or width accounting on that region, and writes the script's
bytes to the terminal verbatim, restoring cursor state around them. The script
owns those rows and is responsible for staying within them. Default stays the
current safe, captured behaviour.

## Why opt-in with reserved rows

The script, not Claude Code, guarantees it writes exactly `rows` rows and no
runaway escape sequences. Claude Code only has to fence the region (save/
restore cursor, clip scroll) and trust the bytes inside it, the same contract
a full-screen app has with the alternate screen.

## Evidence attached

- The tokenizer and its introducer table from the shipped binary.
- A per-class passthrough matrix (SGR and OSC 8 survive; DCS, APC, OSC 0/2,
  CSI motion, DEC private modes, C1 do not), tested with observable side
  effects (window-title readback for OSC, screenshots for DCS/APC).
- A working half-block renderer that would switch to Sixel the moment a
  passthrough region existed, as the reference consumer.

## Workaround today

Half-block / sextant cell art in 24-bit colour, which works everywhere and
needs no host change. This request would raise the ceiling for terminals that
support Sixel or the Kitty protocol, behind an explicit opt-in.
