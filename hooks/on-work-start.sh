#!/usr/bin/env bash
# UserPromptSubmit hook: the agent is about to work. Marks WORKING for this
# session (mode-<session_id>) and for the shared file (older installs), and
# appends one line to hooks.log so a missing write can be diagnosed.
IN="$(cat)"
SID="$(printf '%s' "$IN" | sed -n 's/.*"session_id":"\([^"]*\)".*/\1/p' | head -1)"
DIR="$HOME/.claude/golf/state"
mkdir -p "$DIR"
NOW="$(date +%s)"
echo "WORKING $NOW" > "$DIR/mode"
[ -n "$SID" ] && echo "WORKING $NOW" > "$DIR/mode-$SID"
echo "$NOW	UserPromptSubmit	WORKING	sid=$SID	HOME=$HOME	file=$DIR/mode-$SID" >> "$HOME/.claude/golf/hooks.log"
