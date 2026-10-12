#!/usr/bin/env bash
# Width matrix: every row must fit in COLUMNS - 5 cells (Claude Code's own
# truncation point, docs/PROBE.md) and end with a full SGR reset.
FIX="${1:-harness/fixtures/working.json}"
export CCGOLF_HOME="${CCGOLF_HOME:-${TMPDIR:-/tmp}/golf-widths}"
export CCGOLF_MODE="${CCGOLF_MODE:-WORKING}"
for TIER in halfblock quadrant sextant; do
for W in 80 100 120 160 200; do
  echo "=== COLUMNS=$W tier=$TIER ==="
  OUT=$(COLUMNS=$W LINES=40 CCGOLF_GLYPHS=$TIER node src/statusline.mjs < "$FIX")
  printf '%s\n' "$OUT" | cat -A | head -24
  printf '%s\n' "$OUT" | node -e '
    const cols = Number(process.argv[1]);
    const rows = require("fs").readFileSync(0, "utf8").split("\n").filter(r => r.length);
    let max = 0, bad = 0;
    for (const r of rows) {
      const cells = [...r.replace(/\x1b\[[0-9;]*m/g, "")].length;
      max = Math.max(max, cells);
      if (!r.endsWith("\x1b[0m")) bad++;
      if (/\x1b\[[0-9;]*$/.test(r)) bad++;
    }
    const ok = max <= cols - 5 && bad === 0;
    console.log(`--- rows ${rows.length}  max cells ${max}  limit ${cols - 5}  reset-terminated ${bad === 0}  => ${ok ? "OK" : "FAIL"}`);
    process.exitCode = ok ? 0 : 1;
  ' "$W" || FAIL=1
done
done
[ -z "$FAIL" ] && echo "widths: all clean" || { echo "widths: FAIL"; exit 1; }
