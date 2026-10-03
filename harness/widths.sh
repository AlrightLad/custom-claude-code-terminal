#!/usr/bin/env bash
for W in 80 100 120 160 200; do
  echo "=== COLUMNS=$W ==="
  COLUMNS=$W LINES=40 cat "${1:-harness/fixtures/working.json}" | node src/statusline.mjs | cat -A | head -24
done
