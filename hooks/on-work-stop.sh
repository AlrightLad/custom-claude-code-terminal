#!/usr/bin/env bash
# Stop hook: the agent finished its turn. Marks IDLE for this session and
# for the shared file, logs the write, and plays assets/sound/putt-drop.wav
# if it exists (not redistributed; see assets/sound/fetch.md). Missing file
# or CCGOLF_SOUND=off means silence, never an error.
IN="$(cat)"
SID="$(printf '%s' "$IN" | sed -n 's/.*"session_id":"\([^"]*\)".*/\1/p' | head -1)"
DIR="$HOME/.claude/golf/state"
mkdir -p "$DIR"
NOW="$(date +%s)"
echo "IDLE $NOW" > "$DIR/mode"
[ -n "$SID" ] && echo "IDLE $NOW" > "$DIR/mode-$SID"
echo "$NOW	Stop	IDLE	sid=$SID	HOME=$HOME	file=$DIR/mode-$SID" >> "$HOME/.claude/golf/hooks.log"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
bash "$HERE/hooks/play-sound.sh" putt-drop.wav
