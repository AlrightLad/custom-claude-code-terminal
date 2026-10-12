#!/usr/bin/env bash
# Installs the status line, the two hooks and the golf spinner verbs into
# ~/.claude/settings.json. Safe to re-run; the previous file is backed up.
#
#   bash install/install.sh                 # spinner verbs replace the stock list
#   bash install/install.sh --append        # keep the stock verbs too
#   bash install/install.sh --no-spinner    # status line and hooks only
#   CCGOLF_GLYPHS=sextant CCGOLF_THEME=links bash install/install.sh
#                                           # also pins renderer env in settings.json
#
# Paths are written with forward slashes on purpose: Claude Code runs the
# command through Git Bash on Windows, which eats backslashes.
set -e
S="$HOME/.claude/settings.json"
P="$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd))"
MODE="${CCGOLF_SPINNER_MODE:-replace}"
SPINNER=1
for a in "$@"; do
  case "$a" in
    --append) MODE=append ;;
    --replace) MODE=replace ;;
    --no-spinner) SPINNER=0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done
[ -f "$S" ] || echo '{}' > "$S"
cp "$S" "$S.bak.$(date +%s)"
node -e '
const fs=require("fs"),f=process.argv[1],p=process.argv[2],mode=process.argv[3],spinner=process.argv[4]==="1";
const s=JSON.parse(fs.readFileSync(f,"utf8"));
s.statusLine={type:"command",command:`node ${p}/src/statusline.mjs`,padding:1,refreshInterval:1};
s.hooks=s.hooks||{};
const mk=c=>[{hooks:[{type:"command",command:c}]}];
s.hooks.UserPromptSubmit=mk(`bash ${p}/hooks/on-work-start.sh`);
s.hooks.Stop=mk(`bash ${p}/hooks/on-work-stop.sh`);
if(spinner){
  const verbs=JSON.parse(fs.readFileSync(`${p}/assets/spinner-verbs.json`,"utf8")).verbs;
  s.spinnerVerbs={mode,verbs};
}
for(const k of ["CCGOLF_GLYPHS","CCGOLF_THEME","CCGOLF_COLOR","CCGOLF_ROWS"]){
  if(process.env[k]){ s.env=s.env||{}; s.env[k]=process.env[k]; }
}
fs.writeFileSync(f,JSON.stringify(s,null,2));
console.log(`statusLine -> ${s.statusLine.command}`);
console.log(`spinnerVerbs -> ${spinner?mode+" ("+s.spinnerVerbs.verbs.length+" verbs)":"untouched"}`);
if(s.env) console.log("env -> "+JSON.stringify(s.env));
' "$S" "$P" "$MODE" "$SPINNER"
echo "installed from $P   (backup: $S.bak.*)   settings hot-reload; no restart needed"
