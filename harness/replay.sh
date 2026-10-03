#!/usr/bin/env bash
# usage: ./harness/replay.sh [fixture] [fps] [seconds]
FIX="${1:-harness/fixtures/working.json}"
FPS="${2:-2}"; SECS="${3:-60}"
DELAY=$(awk "BEGIN{print 1/$FPS}")
TICKS=$(awk "BEGIN{print int($SECS*$FPS)}")
export COLUMNS="${COLUMNS:-120}" LINES="${LINES:-40}"
mkdir -p harness/frames
for i in $(seq 1 "$TICKS"); do
  OUT=$(cat "$FIX" | node src/statusline.mjs)
  printf '%s\n' "$OUT" > "harness/frames/$(printf '%04d' "$i").txt"
  clear; printf '%s\n' "$OUT"
  sleep "$DELAY"
done
