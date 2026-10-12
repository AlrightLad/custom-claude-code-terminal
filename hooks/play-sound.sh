#!/usr/bin/env bash
# Plays assets/sound/<name> if it exists and sound is not disabled.
# usage: bash hooks/play-sound.sh putt-drop.wav
# CCGOLF_SOUND=off silences everything. No WAV present = silent, exit 0.
case "${CCGOLF_SOUND:-on}" in off|0|false|no) exit 0 ;; esac
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SND="$HERE/assets/sound/$1"
[ -f "$SND" ] || exit 0
if command -v powershell >/dev/null 2>&1; then
  WIN="$(cygpath -w "$SND" 2>/dev/null || echo "$SND")"
  powershell -NoProfile -Command "(New-Object Media.SoundPlayer '$WIN').PlaySync()" >/dev/null 2>&1 &
elif command -v afplay >/dev/null 2>&1; then
  afplay "$SND" >/dev/null 2>&1 &
elif command -v paplay >/dev/null 2>&1; then
  paplay "$SND" >/dev/null 2>&1 &
elif command -v aplay >/dev/null 2>&1; then
  aplay -q "$SND" >/dev/null 2>&1 &
fi
exit 0
