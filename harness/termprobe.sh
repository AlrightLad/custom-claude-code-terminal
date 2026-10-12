#!/usr/bin/env bash
# Terminal capability probe. Run this IN your terminal (not as a status line):
#   bash harness/termprobe.sh
# It queries the terminal with standard escape sequences and reports what the
# renderer can use here. Unlike the status line, a command you run yourself
# owns the TTY and can read the terminal's replies, so this is the honest
# place to detect Sixel and the Kitty graphics protocol.
#
# Exit is clean even if the terminal answers nothing (some do not).

say() { printf '%s\n' "$*"; }
hr() { printf '%.0s-' $(seq 1 56); printf '\n'; }

# Read a terminal reply to a query, with a short timeout, in raw mode.
query() { # $1 = bytes to send, $2 = terminator char, $3 = timeout tenths
  local send="$1" term="$2" to="${3:-3}" reply=""
  local old; old=$(stty -g 2>/dev/null) || { echo ""; return; }
  stty -echo -icanon min 0 time "$to" 2>/dev/null
  printf '%b' "$send" > /dev/tty
  IFS= read -r -d "$term" reply < /dev/tty 2>/dev/null
  stty "$old" 2>/dev/null
  printf '%s' "$reply"
}

say "Terminal capability probe"
hr
say "TERM=${TERM:-?}  TERM_PROGRAM=${TERM_PROGRAM:-?}  COLORTERM=${COLORTERM:-?}"
[ -n "$WT_SESSION" ] && say "WT_SESSION set (Windows Terminal)"
[ -n "$KITTY_WINDOW_ID" ] && say "KITTY_WINDOW_ID set (kitty)"
[ -n "$GHOSTTY_RESOURCES_DIR" ] && say "GHOSTTY_RESOURCES_DIR set (Ghostty)"
[ -n "$TMUX" ] && say "TMUX set — inside tmux; graphics protocols are unreliable through it"
hr

# Truecolor: COLORTERM, or just trust modern terminals. Print a gradient.
if [ "$COLORTERM" = "truecolor" ] || [ "$COLORTERM" = "24bit" ]; then
  say "truecolor: ADVERTISED (COLORTERM=$COLORTERM)"
else
  say "truecolor: not advertised; the gradient below should still be smooth on a capable terminal"
fi
printf '  '
for i in $(seq 0 30); do printf '\033[48;2;%d;%d;%dm ' $((i*8)) $((120)) $((255-i*8)); done
printf '\033[0m\n'

# Glyph tiers.
printf '  half  \033[32m\xe2\x96\x80\xe2\x96\x84\xe2\x96\x88\033[0m   quad \033[32m\xe2\x96\x96\xe2\x96\x97\xe2\x96\x98\xe2\x96\x9f\033[0m   sext \033[32m\xf0\x9f\xac\x80\xf0\x9f\xac\x85\xf0\x9f\xac\x8a\xf0\x9f\xac\xbb\033[0m   (boxes = missing glyphs)\n'
hr

# DA1: primary device attributes. A ";4" in the reply means Sixel.
da1=$(query '\033[c' 'c' 3)
if [ -n "$da1" ]; then
  say "DA1 reply: ${da1#*[}c"
  case ";$(printf '%s' "$da1" | tr ';' ';');" in
    *';4;'*|*';4c'*|*';4;'*) say "  sixel: SUPPORTED (DA1 lists attribute 4)";;
    *) say "  sixel: not advertised in DA1";;
  esac
else
  say "DA1: no reply (terminal did not answer)"
fi

# Kitty graphics protocol: send a 1-pixel query; a reply beginning ESC _ G
# with ';OK' means it is supported.
kitty=$(query '\033_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\033\\\033[c' 'c' 4)
case "$kitty" in
  *'_G'*';OK'*) say "  kitty graphics: SUPPORTED";;
  *'_G'*) say "  kitty graphics: replied, not OK (partial)";;
  *) say "  kitty graphics: not supported (no Kitty reply)";;
esac

# Cell pixel size via CSI 16 t -> ESC [ 6 ; height ; width t.
cell=$(query '\033[16t' 't' 3)
case "$cell" in
  *'6;'*) hw=${cell#*6;}; say "  cell size: ${hw%t} px (height;width) -> aspect $(printf '%s' "$hw" | awk -F';' '{if($2>0)printf "%.2f", $1/$2}')";;
  *) say "  cell size: not reported";;
esac
hr
say "Recommended: CCGOLF_GLYPHS=$([ -n "$WT_SESSION" ] && echo sextant || echo "$([ -n "$KITTY_WINDOW_ID$GHOSTTY_RESOURCES_DIR" ] && echo sextant || echo halfblock)") (set in settings.json env, or export it)"
say "Note: the status line itself CANNOT use Sixel or Kitty graphics even where"
say "this probe reports them — Claude Code re-renders captured stdout as cells."
say "See docs/PROBE.md (Phase G')."
