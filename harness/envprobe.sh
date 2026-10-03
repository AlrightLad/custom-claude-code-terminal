#!/usr/bin/env bash
# P0.1 — dump the statusline subprocess environment from a LIVE session
cat > /dev/null
{ echo "--- $(date -Iseconds) ---"; env | sort; } >> "$HOME/.claude/golf/envprobe.log"
echo "envprobe active"
