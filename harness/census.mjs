#!/usr/bin/env node
// Test A: continuous process census under the failure load. Runs N concurrent
// sessions at max cadence for T minutes; 1 in 5 frames is "abandoned" (stdin
// left open, no end, handle dropped) to exercise the cancellation path that
// used to leak. Samples the live renderer process count every 10s and prints
// the curve, so a flat line retires the leak hypothesis and a climbing line
// localizes it.
//   node harness/census.mjs [sessions=8] [minutes=10] [cadenceMs=300]
import { spawn, execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const ENTRY = path.join(ROOT, 'src', 'statusline.mjs');
const N = Number(process.argv[2]) || 8;
const MIN = Number(process.argv[3]) || 10;
const CAD = Number(process.argv[4]) || 300;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-census-'));
fs.mkdirSync(path.join(home, 'state'), { recursive: true });
const TAG = 'CENSUS_' + Date.now();
const until = Date.now() + MIN * 60 * 1000;
let spawned = 0, abandoned = 0;

function tagged() {
  try {
    const out = execSync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*${TAG}*' }).Count"`, { encoding: 'utf8' });
    return parseInt(out.trim(), 10) || 0;
  } catch { return -1; }
}

async function session(i) {
  const sid = `${TAG}-s${i}`;
  const mode = i < Math.ceil(N / 2) ? 'WORKING' : 'IDLE';
  let now = 1700000000000;
  while (Date.now() < until) {
    now += CAD;
    const abandon = spawned % 5 === 4; // 1 in 5 frames is a cancelled/abandoned frame
    const p = spawn('node', [ENTRY, TAG], { stdio: ['pipe', 'ignore', 'ignore'],
      env: { ...process.env, CCGOLF_HOME: home, CCGOLF_MODE: mode, CCGOLF_NOW: String(now), COLUMNS: '120', LINES: '36', CCGOLF_GLYPHS: 'halfblock' } });
    spawned++;
    if (abandon) { abandoned++; /* leave stdin open, do not end, drop handle */ }
    else { p.stdin.end(JSON.stringify({ session_id: sid })); await new Promise(r => p.on('close', r)); }
    await new Promise(r => setTimeout(r, abandon ? CAD : 10));
  }
}

const curve = [];
const sampler = setInterval(() => {
  const t = Math.round((Date.now() - (until - MIN * 60000)) / 1000);
  const c = tagged();
  curve.push([t, c]);
  console.log(`t=${String(t).padStart(4)}s  live renderer procs=${c}  spawned=${spawned} abandoned=${abandoned}`);
}, 10000);

await Promise.all(Array.from({ length: N }, (_, i) => session(i)));
clearInterval(sampler);
await new Promise(r => setTimeout(r, 6000)); // let the last abandoned frames self-exit
const finalCount = tagged();
// cleanup any stragglers
try { execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*${TAG}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' }); } catch {}
fs.rmSync(home, { recursive: true, force: true });
const counts = curve.map(c => c[1]).filter(c => c >= 0);
console.log(`\nsessions ${N}  ${MIN} min  cadence ${CAD}ms`);
console.log(`spawned ${spawned}, of which abandoned (cancelled) ${abandoned}`);
console.log(`live renderer count over time: min ${Math.min(...counts)}  max ${Math.max(...counts)}  final (after 6s drain) ${finalCount}`);
console.log(`verdict: ${Math.max(...counts) <= N + 4 && finalCount <= 1 ? 'FLAT — no accumulation, leak hypothesis retired' : 'CLIMBS — accumulation present'}`);
