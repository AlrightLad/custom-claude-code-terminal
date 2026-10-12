#!/usr/bin/env bash
# SubagentStart / SubagentStop hook. Maintains the per-session roster the
# renderer reads (state/agents-<session_id>.json) so each running subagent
# becomes a golfer. On SubagentStop it also plays a distinct completion sound
# (subagent-putt.wav), different from the main Stop cue. Dedupes by agent_id.
IN="$(cat)"
node -e '
const fs=require("fs"),path=require("path"),os=require("os");
let j={}; try{ j=JSON.parse(process.argv[1]||"{}"); }catch{}
const sid=j.session_id||"nosession";
const ev=j.hook_event_name||"";
const id=j.agent_id||j.subagent_id||"";
const type=j.agent_type||"agent";
const dir=path.join(process.env.CCGOLF_HOME||process.env.GOLF_HOME||path.join(os.homedir(),".claude","golf"),"state");
try{fs.mkdirSync(dir,{recursive:true});}catch{}
const f=path.join(dir,"agents-"+String(sid).replace(/[^A-Za-z0-9._-]/g,"_")+".json");
let r={active:[]}; try{ r=JSON.parse(fs.readFileSync(f,"utf8")); if(!Array.isArray(r.active))r.active=[]; }catch{}
r.active=r.active.filter(a=>a&&a.id&&a.id!==id);
if(/Start/i.test(ev)&&id) r.active.push({id,type,started:Date.now()});
const tmp=f+"."+process.pid+".tmp";
try{ fs.writeFileSync(tmp,JSON.stringify(r)); fs.renameSync(tmp,f); }catch{ try{fs.writeFileSync(f,JSON.stringify(r));}catch{} }
' "$IN"
case "$(printf '%s' "$IN" | sed -n 's/.*"hook_event_name":"\([^"]*\)".*/\1/p' | head -1)" in
  *Stop*)
    HERE="$(cd "$(dirname "$0")/.." && pwd)"
    bash "$HERE/hooks/play-sound.sh" subagent-putt.wav
    ;;
esac
