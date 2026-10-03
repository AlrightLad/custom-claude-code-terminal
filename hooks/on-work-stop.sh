#!/usr/bin/env bash
cat > /dev/null
echo "IDLE $(date +%s)" > "$HOME/.claude/golf/state/mode"
SND="/c/Projects/Custom-Claude-Code-Terminal/assets/sound/putt-drop.wav"
[ -f "$SND" ] && powershell -NoProfile -Command "(New-Object Media.SoundPlayer '$(cygpath -w "$SND")').PlaySync()" &
