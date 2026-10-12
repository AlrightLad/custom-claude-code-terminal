#!/usr/bin/env bash
# Diagnostic hook: appends the full stdin JSON of any hook event to
# ~/.claude/golf/hooks-events.log with a timestamp. Used to learn what the
# SubagentStart / SubagentStop payloads actually carry (docs/PROBE.md).
IN="$(cat)"
mkdir -p "$HOME/.claude/golf"
printf '%s\t%s\n' "$(date +%s)" "$IN" >> "$HOME/.claude/golf/hooks-events.log"
