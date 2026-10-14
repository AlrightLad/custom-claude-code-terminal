#!/usr/bin/env bash
# Proves install.sh and uninstall.sh actually land and remove everything in
# ~/.claude/settings.json — the statusLine, all four hooks, the spinner verbs,
# any pinned CCGOLF_* env — and that they leave unrelated keys untouched.
#
# SAFETY: it runs entirely in a throwaway $HOME sandbox (mktemp), so it never
# reads or writes your real ~/.claude/settings.json. Claude Code can be running.
#
# --self-test additionally corrupts the freshly-installed file and re-runs the
# "installed" assertions to prove they actually FAIL on a missing piece — a
# verifier that only ever passes proves nothing (spinnerVerbs was once reported
# landed when it had not been; this is the guard against exactly that).
#
#   bash harness/verify-install.sh
#   bash harness/verify-install.sh --self-test
set -u

REPO="$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd))"
SELFTEST=0; [ "${1:-}" = "--self-test" ] && SELFTEST=1

# Sandbox HOME as a native-Windows path (pwd -W) so the paths handed to node
# resolve the same way the real installer's do.
SANDBOX_U="$(mktemp -d)" || { echo "mktemp failed"; exit 2; }
SANDBOX="$(cd "$SANDBOX_U" && (pwd -W 2>/dev/null || pwd))"
trap 'rm -rf "$SANDBOX_U"' EXIT
mkdir -p "$SANDBOX/.claude"
S="$SANDBOX/.claude/settings.json"
# Seed with unrelated keys the installer must preserve across install+uninstall.
printf '%s\n' '{"model":"opus","env":{"KEEP":"yes"}}' > "$S"

EXPECT_VERBS="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).verbs.length))' "$REPO/assets/spinner-verbs.json")"

pass=0; fail=0
chk(){ if [ "$2" = "1" ]; then echo "  ok    $1"; pass=$((pass+1)); else echo "  FAIL  $1"; fail=$((fail+1)); fi; }
# node boolean against $S; argv: 1=settings 2=repo 3=verbcount 4.. = extra
nb(){ local code="$1"; shift; node -e "$code" "$S" "$REPO" "$EXPECT_VERBS" "$@" 2>/dev/null || echo 0; }

RD='const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));'

assert_installed(){
  chk "statusLine -> src/statusline.mjs" "$(nb "$RD"'process.stdout.write(s.statusLine&&/src\/statusline\.mjs/.test(s.statusLine.command||"")?"1":"0")')"
  chk "statusLine refreshInterval=1"     "$(nb "$RD"'process.stdout.write(s.statusLine&&s.statusLine.refreshInterval===1?"1":"0")')"
  local H='const ev=process.argv[4],sh=process.argv[5];const a=s.hooks&&s.hooks[ev];const c=(a&&a[0]&&a[0].hooks&&a[0].hooks[0]&&a[0].hooks[0].command)||"";process.stdout.write(c.indexOf(sh)>=0?"1":"0")'
  chk "hook UserPromptSubmit -> on-work-start.sh" "$(nb "$RD$H" UserPromptSubmit on-work-start.sh)"
  chk "hook Stop -> on-work-stop.sh"              "$(nb "$RD$H" Stop on-work-stop.sh)"
  chk "hook SubagentStart -> on-subagent.sh"      "$(nb "$RD$H" SubagentStart on-subagent.sh)"
  chk "hook SubagentStop -> on-subagent.sh"       "$(nb "$RD$H" SubagentStop on-subagent.sh)"
  chk "spinnerVerbs present ($EXPECT_VERBS verbs, mode set)" "$(nb "$RD"'const v=s.spinnerVerbs;process.stdout.write(v&&v.mode&&Array.isArray(v.verbs)&&String(v.verbs.length)===process.argv[3]?"1":"0")')"
  chk "env pin CCGOLF_THEME=links"       "$(nb "$RD"'process.stdout.write(s.env&&s.env.CCGOLF_THEME==="links"?"1":"0")')"
  chk "unrelated keys preserved (model, env.KEEP)" "$(nb "$RD"'process.stdout.write(s.model==="opus"&&s.env&&s.env.KEEP==="yes"?"1":"0")')"
}

assert_removed(){
  chk "statusLine removed"   "$(nb "$RD"'process.stdout.write(s.statusLine?"0":"1")')"
  chk "spinnerVerbs removed" "$(nb "$RD"'process.stdout.write(s.spinnerVerbs?"0":"1")')"
  chk "all four hooks removed" "$(nb "$RD"'const h=s.hooks||{};process.stdout.write(["UserPromptSubmit","Stop","SubagentStart","SubagentStop"].some(k=>h[k])?"0":"1")')"
  chk "CCGOLF_* env removed"  "$(nb "$RD"'const e=s.env||{};process.stdout.write(Object.keys(e).some(k=>k.indexOf("CCGOLF_")===0)?"0":"1")')"
  chk "unrelated keys kept (model, env.KEEP)" "$(nb "$RD"'process.stdout.write(s.model==="opus"&&s.env&&s.env.KEEP==="yes"?"1":"0")')"
}

echo "sandbox HOME : $SANDBOX   (your real ~/.claude is untouched)"
echo "repo         : $REPO"
echo
echo "[pre] referenced hook scripts exist on disk"
for h in on-work-start on-work-stop on-subagent; do
  [ -f "$REPO/hooks/$h.sh" ] && chk "hooks/$h.sh" 1 || chk "hooks/$h.sh" 0
done

echo
echo "[1] install   (CCGOLF_THEME=links bash install/install.sh)"
HOME="$SANDBOX" CCGOLF_THEME=links bash "$REPO/install/install.sh" >/dev/null || { echo "  install.sh exited nonzero"; fail=$((fail+1)); }
assert_installed

if [ "$SELFTEST" = "1" ]; then
  echo
  echo "[self-test] corrupt the installed file; the installed-assertions MUST fail on it"
  node -e 'const fs=require("fs"),f=process.argv[1];const s=JSON.parse(fs.readFileSync(f,"utf8"));delete s.spinnerVerbs;delete s.statusLine;if(s.hooks)delete s.hooks.Stop;fs.writeFileSync(f,JSON.stringify(s,null,2))' "$S"
  sp=$pass; sf=$fail
  assert_installed >/dev/null
  detected=$((fail-sf))
  pass=$sp; fail=$sf   # the tamper failures are expected; do not score them
  chk "verifier detected the tampering (>=3 checks failed)" "$([ "$detected" -ge 3 ] && echo 1 || echo 0)"
  # restore a clean install for the uninstall stage
  HOME="$SANDBOX" CCGOLF_THEME=links bash "$REPO/install/install.sh" >/dev/null
fi

echo
echo "[2] uninstall (bash install/uninstall.sh)"
HOME="$SANDBOX" bash "$REPO/install/uninstall.sh" >/dev/null || { echo "  uninstall.sh exited nonzero"; fail=$((fail+1)); }
assert_removed

echo
echo "pass=$pass fail=$fail"
if [ "$fail" -eq 0 ]; then echo "VERIFY-INSTALL OK"; exit 0; else echo "VERIFY-INSTALL FAILED"; exit 1; fi
