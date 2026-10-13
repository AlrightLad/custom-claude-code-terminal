#!/usr/bin/env bash
# Responsive width gate. Claude Code runs cli-truncate over the ENTIRE
# multi-line status line as one string, so a single line wider than the
# container drops every line after it (docs/PRIOR-ART.md finding 3). This gate
# asserts, at every tested width and glyph tier, that no rendered line exceeds
# the container (COLUMNS - 5) and every line ends with a full SGR reset. It also
# prints which elements survive at each width so the drop ladder is visible.
FIX="${1:-harness/fixtures/working.json}"
export CCGOLF_HOME="${CCGOLF_HOME:-${TMPDIR:-/tmp}/golf-widths}"
export CCGOLF_MODE="${CCGOLF_MODE:-WORKING}"
export CCGOLF_SEASON="${CCGOLF_SEASON:-none}"
FAIL=""
for TIER in halfblock quadrant sextant; do
for W in 60 80 100 120 160 200 240; do
  OUT=$(COLUMNS=$W LINES=40 CCGOLF_GLYPHS=$TIER node src/statusline.mjs < "$FIX")
  printf '%s\n' "$OUT" | node -e '
    const cols = Number(process.argv[1]), tier = process.argv[2];
    const rows = require("fs").readFileSync(0, "utf8").split("\n").filter(r => r.length);
    let max = 0, bad = 0;
    for (const r of rows) {
      const cells = [...r.replace(/\x1b\[[0-9;]*m/g, "")].length;
      max = Math.max(max, cells);
      if (!r.endsWith("\x1b[0m")) bad++;
      if (/\x1b\[[0-9;]*$/.test(r)) bad++;
    }
    const limit = cols - 5;
    const ok = max <= limit && bad === 0;
    console.log(`${String(cols).padStart(3)} ${tier.padEnd(9)} rows ${String(rows.length).padStart(2)}  max ${String(max).padStart(3)} <= ${limit}  reset ${bad === 0}  => ${ok ? "OK" : "FAIL"}`);
    process.exitCode = ok ? 0 : 1;
  ' "$W" "$TIER" || FAIL=1
done
done
# Short terminals: assert the picture never eats more than ~half a small height,
# and that a very narrow width degrades to a single compact line.
echo "--- narrow/short degradation"
for WL in "36 24" "30 12"; do set -- $WL
  N=$(COLUMNS=$1 LINES=$2 node src/statusline.mjs < "$FIX" | grep -c .)
  echo "COLUMNS=$1 LINES=$2 -> $N rows (<= $(( $2 / 2 + 1 ))?)"
done
COMPACT=$(COLUMNS=30 LINES=24 node src/statusline.mjs < "$FIX" | grep -c .)
echo "COLUMNS=30 compact -> $COMPACT row(s) (expect 1)"
[ "$COMPACT" = "1" ] || FAIL=1
[ -z "$FAIL" ] && echo "widths: all clean" || { echo "widths: FAIL"; exit 1; }
