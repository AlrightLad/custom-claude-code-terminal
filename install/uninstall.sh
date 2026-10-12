#!/usr/bin/env bash
# Removes everything install.sh added: status line, the two hooks, the
# spinner verbs and any CCGOLF_* env entries. Game state in ~/.claude/golf is
# left alone; delete that directory yourself if you want it gone.
S="$HOME/.claude/settings.json"
[ -f "$S" ] || { echo "no $S"; exit 0; }
cp "$S" "$S.bak.$(date +%s)"
node -e '
const fs=require("fs"),f=process.argv[1];
const s=JSON.parse(fs.readFileSync(f,"utf8"));
delete s.statusLine;
delete s.spinnerVerbs;
if(s.hooks){for(const k of ["UserPromptSubmit","Stop","SubagentStart","SubagentStop"])delete s.hooks[k];if(!Object.keys(s.hooks).length)delete s.hooks;}
if(s.env){for(const k of Object.keys(s.env))if(k.startsWith("CCGOLF_"))delete s.env[k];if(!Object.keys(s.env).length)delete s.env;}
fs.writeFileSync(f,JSON.stringify(s,null,2));
' "$S"
echo "uninstalled (backup: $S.bak.*)"
