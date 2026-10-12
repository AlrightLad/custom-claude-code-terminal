#!/usr/bin/env bash
# Glyph capability probe. Prints one row per rendering tier so you can see
# which block characters your terminal font actually has. Tofu boxes or
# question marks on a row mean that tier is unavailable in this font; the
# renderer must then be pinned lower with CCGOLF_GLYPHS=halfblock (or
# quadrant). Needs a UTF-8 locale; no Node required.
#
#   bash harness/glyphs.sh            # plain
#   bash harness/glyphs.sh --status   # one-shot form for a statusLine command
#
# Tiers, lowest to highest vertical resolution per cell:
#   halfblock  U+2580 U+2584 U+2588            2 pixels per cell (1x2)
#   quadrant   U+2596..U+259F                  4 pixels per cell (2x2)
#   sextant    U+1FB00..U+1FB3B (Unicode 13)   6 pixels per cell (2x3)
#   octant     U+1CD00..U+1CDE5 (Unicode 16)   8 pixels per cell (2x4), not used yet

if [ "$1" = "--status" ]; then cat > /dev/null; fi

R=$'\e[0m'
# two colours per cell, like the renderer: green on dark green
C=$'\e[38;2;143;208;90;48;2;47;107;42m'
D=$'\e[38;2;232;213;154;48;2;45;95;208m'

printf '%s\n' "glyph probe: each row should show solid two-colour blocks, never hollow boxes"
printf 'halfblock  %s\xe2\x96\x80\xe2\x96\x84\xe2\x96\x88\xe2\x96\x8c\xe2\x96\x90%s  %s\xe2\x96\x80 \xe2\x96\x84 \xe2\x96\x88%s   U+2580 U+2584 U+2588 U+258C U+2590\n' "$C" "$R" "$D" "$R"
printf 'quadrant   %s\xe2\x96\x96\xe2\x96\x97\xe2\x96\x98\xe2\x96\x99\xe2\x96\x9a\xe2\x96\x9b\xe2\x96\x9c\xe2\x96\x9d\xe2\x96\x9e\xe2\x96\x9f%s  %s\xe2\x96\x98\xe2\x96\x9d\xe2\x96\x96\xe2\x96\x97%s   U+2596..U+259F\n' "$C" "$R" "$D" "$R"
printf 'sextant    %s\xf0\x9f\xac\x80\xf0\x9f\xac\x81\xf0\x9f\xac\x82\xf0\x9f\xac\x83\xf0\x9f\xac\x84\xf0\x9f\xac\x85\xf0\x9f\xac\x86\xf0\x9f\xac\x87\xf0\x9f\xac\x88\xf0\x9f\xac\x89%s  %s\xf0\x9f\xac\x9d\xf0\x9f\xac\x9e\xf0\x9f\xac\x9f\xf0\x9f\xac\xa0\xf0\x9f\xac\xb0\xf0\x9f\xac\xbb%s   U+1FB00..U+1FB3B\n' "$C" "$R" "$D" "$R"
printf 'octant     %s\xf0\x9c\xb4\x80\xf0\x9c\xb4\x81\xf0\x9c\xb4\x82\xf0\x9c\xb4\x83\xf0\x9c\xb4\x84\xf0\x9c\xb4\x85\xf0\x9c\xb4\x86\xf0\x9c\xb4\x87%s  %s\xf0\x9c\xb5\x80\xf0\x9c\xb5\x81\xf0\x9c\xb5\x82\xf0\x9c\xb5\x83%s   U+1CD00..U+1CDE5\n' "$C" "$R" "$D" "$R"
printf 'box/arrows %s\xe2\x94\x8c\xe2\x94\x80\xe2\x94\x90\xe2\x94\x82\xe2\x94\x94\xe2\x94\x98%s  %s\xe2\x86\x90\xe2\x86\x91\xe2\x86\x92\xe2\x86\x93\xe2\x86\x96\xe2\x86\x97\xe2\x86\x98\xe2\x86\x99%s  %s\xe2\x96\x82\xe2\x96\x84\xe2\x96\x86%s   frame, wind arrows, strength bar\n' "$C" "$R" "$D" "$R" "$C" "$R"
printf 'ruler      ....:....1....:....2....:....3....:....4   (every row above should align with this)\n'
