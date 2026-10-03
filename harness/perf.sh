#!/usr/bin/env bash
FIX="${1:-harness/fixtures/working.json}"
node -e '
const {execFileSync}=require("child_process"),fs=require("fs");
const j=fs.readFileSync(process.argv[1]);const t=[];
for(let i=0;i<100;i++){const s=process.hrtime.bigint();
execFileSync("node",["src/statusline.mjs"],{input:j});
t.push(Number(process.hrtime.bigint()-s)/1e6);}
t.sort((a,b)=>a-b);
console.log(`mean ${(t.reduce((a,b)=>a+b)/t.length).toFixed(1)}ms  p99 ${t[98].toFixed(1)}ms  (gate: p99 < 100ms)`);
' "$FIX"
