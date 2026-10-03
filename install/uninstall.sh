#!/usr/bin/env bash
S="$HOME/.claude/settings.json"
node -e '
const fs=require("fs"),f=process.argv[1];
const s=JSON.parse(fs.readFileSync(f,"utf8"));
delete s.statusLine;
if(s.hooks){delete s.hooks.UserPromptSubmit;delete s.hooks.Stop;}
fs.writeFileSync(f,JSON.stringify(s,null,2));
' "$S"
echo "uninstalled. restart Claude Code"
