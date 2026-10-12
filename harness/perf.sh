#!/usr/bin/env bash
# Spawn-to-exit time of one frame, 100 runs, interleaved with a bare `node -e 0`
# baseline so the script's own cost is visible separately from Node startup
# and from whatever else the machine is doing.
FIX="${1:-harness/fixtures/working.json}"
export GOLF_HOME="${GOLF_HOME:-${TMPDIR:-/tmp}/golf-perf}"
export GOLF_MODE="${GOLF_MODE:-WORKING}"
export COLUMNS="${COLUMNS:-100}" LINES="${LINES:-30}"
node -e '
const {execFileSync}=require("child_process"),fs=require("fs");
const j=fs.readFileSync(process.argv[1]);const t=[],b=[];
for(let i=0;i<100;i++){
  let s=process.hrtime.bigint();
  execFileSync("node",["src/statusline.mjs"],{input:j});
  t.push(Number(process.hrtime.bigint()-s)/1e6);
  s=process.hrtime.bigint();
  execFileSync("node",["-e","0"]);
  b.push(Number(process.hrtime.bigint()-s)/1e6);
}
t.sort((a,b)=>a-b);b.sort((a,b)=>a-b);
const mean=a=>a.reduce((x,y)=>x+y)/a.length;
console.log(`statusline  mean ${mean(t).toFixed(1)}ms  p50 ${t[49].toFixed(1)}ms  p99 ${t[98].toFixed(1)}ms  (gate: p99 < 100ms)`);
console.log(`bare node   mean ${mean(b).toFixed(1)}ms  p50 ${b[49].toFixed(1)}ms  p99 ${b[98].toFixed(1)}ms`);
console.log(`overhead    mean ${(mean(t)-mean(b)).toFixed(1)}ms  p50 ${(t[49]-b[49]).toFixed(1)}ms`);
process.exitCode = t[98] < 100 ? 0 : 1;
' "$FIX"
