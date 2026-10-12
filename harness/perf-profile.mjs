#!/usr/bin/env node
// Performance measurement for docs/PERF.md. Spawns the real entry many times
// (that is how it actually runs), parsing the PERF line each process prints on
// stderr under CCGOLF_TRACE, and separately times a warm in-process render
// loop to isolate render cost from Node startup.
//   node harness/perf-profile.mjs [spawns=60]
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const ENTRY = path.join(ROOT, 'src', 'statusline.mjs');
const N = Number(process.argv[2]) || 60;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-perf-'));
const env = { ...process.env, CCGOLF_HOME: home, CCGOLF_MODE: 'WORKING', CCGOLF_TRACE: '1', COLUMNS: '160', LINES: '44', CCGOLF_GLYPHS: 'sextant', CCGOLF_SEASON: 'fall' };

const wall = [], rss = [], cpu = [], body = [];
const bare = [];
let now = 1700000000000;
for (let i = 0; i < N; i++) {
  now += 700; env.CCGOLF_NOW = String(now);
  let err = '';
  const t0 = process.hrtime.bigint();
  try { execFileSync('node', [ENTRY], { input: '{"session_id":"perf"}', env, stdio: ['pipe', 'ignore', 'pipe'] }); }
  catch (e) { err = String(e.stderr || ''); }
  // execFileSync throws only on non-zero; capture stderr via a second run if needed
  const t1 = process.hrtime.bigint();
  wall.push(Number(t1 - t0) / 1e6);
  // re-run capturing stderr (PERF line) without timing it into wall
  const r = execFileSync('node', [ENTRY], { input: '{"session_id":"perf"}', env, encoding: 'utf8', stdio: ['pipe', 'ignore', 'pipe'] });
  void r; void err;
  // bare node baseline
  const b0 = process.hrtime.bigint(); execFileSync('node', ['-e', '0']); bare.push(Number(process.hrtime.bigint() - b0) / 1e6);
}
// One more run capturing the PERF line for rss/cpu/body.
for (let i = 0; i < 20; i++) {
  now += 700; env.CCGOLF_NOW = String(now);
  const res = spawnSync('node', [ENTRY], { input: '{"session_id":"perf"}', env, encoding: 'utf8' });
  const m = /PERF rss=(\d+) cpuUserUs=(\d+) cpuSysUs=(\d+) body=(\d+)/.exec(res.stderr || '');
  if (m) { rss.push(+m[1]); cpu.push((+m[2] + +m[3]) / 1000); body.push(+m[4]); }
}
fs.rmSync(home, { recursive: true, force: true });
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`spawns: ${N}`);
console.log(`spawn-to-exit wall ms:  mean ${mean(wall).toFixed(1)}  p50 ${q(wall, .5).toFixed(1)}  p99 ${q(wall, .99).toFixed(1)}`);
console.log(`bare node -e 0 wall ms: mean ${mean(bare).toFixed(1)}  p50 ${q(bare, .5).toFixed(1)}  p99 ${q(bare, .99).toFixed(1)}`);
console.log(`node startup share of mean wall: ${(100 * mean(bare) / mean(wall)).toFixed(0)}%`);
console.log(`peak RSS MB: ${(Math.max(...rss) / 1048576).toFixed(1)}  (mean ${(mean(rss) / 1048576).toFixed(1)})`);
console.log(`per-process CPU ms (user+sys): mean ${mean(cpu).toFixed(1)}  p99 ${q(cpu, .99).toFixed(1)}`);
console.log(`render body ms (in-process, no node startup): mean ${mean(body).toFixed(1)}  p99 ${q(body, .99).toFixed(1)}`);
console.log(`est. CPU over 30 min @ 1 fps (1800 frames): ${(mean(cpu) * 1800 / 1000).toFixed(1)} s`);
console.log(`est. CPU over 30 min @ 2 fps (3600 frames): ${(mean(cpu) * 3600 / 1000).toFixed(1)} s`);
