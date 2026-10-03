#!/usr/bin/env bash
set -e
S="$HOME/.claude/settings.json"
P="C:/Projects/Custom-Claude-Code-Terminal"
[ -f "$S" ] || echo '{}' > "$S"
cp "$S" "$S.bak.$(date +%s)"
node -e '
const fs=require("fs"),f=process.argv[1],p=process.argv[2];
const s=JSON.parse(fs.readFileSync(f,"utf8"));
s.statusLine={type:"command",command:`node ${p}/src/statusline.mjs`,padding:1,refreshInterval:1};
s.hooks=s.hooks||{};
const mk=c=>[{hooks:[{type:"command",command:c}]}];
s.hooks.UserPromptSubmit=mk(`bash ${p}/hooks/on-work-start.sh`);
s.hooks.Stop=mk(`bash ${p}/hooks/on-work-stop.sh`);
fs.writeFileSync(f,JSON.stringify(s,null,2));
' "$S" "$P"
echo "installed -> $P   (backup: $S.bak.*)   restart Claude Code"
