#!/usr/bin/env node
// Multi-session stress test. Simulates N concurrent Claude Code sessions, each
// spawning the status line at a fixed cadence for a fixed duration, and reports
// the aggregate load that a user with several terminals open actually sees:
// total spawns, spawns/sec, CPU ms/sec, peak RSS, and state writes/sec (which
// the skip-unchanged logic keeps low for idle sessions).
//   node harness/stress.mjs [sessions=8] [seconds=12] [cadenceMs=350]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const ENTRY = path.join(ROOT, 'src', 'statusline.mjs');
const N = Number(process.argv[2]) || 8;
const SECS = Number(process.argv[3]) || 12;
const CAD = Number(process.argv[4]) || 350;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-stress-'));
fs.mkdirSync(path.join(home, 'state'), { recursive: true });

let spawns = 0, writes = 0, cpuMs = 0, peakRss = 0, done = 0, inflight = 0, peakInflight = 0;
const until = Date.now() + SECS * 1000;

function oneFrame(sid, mode, now) {
  return new Promise(res => {
    inflight++; peakInflight = Math.max(peakInflight, inflight);
    const p = spawn('node', [ENTRY], { stdio: ['pipe', 'ignore', 'pipe'],
      env: { ...process.env, CCGOLF_HOME: home, CCGOLF_MODE: mode, CCGOLF_TRACE: '1', CCGOLF_NOW: String(now), COLUMNS: '120', LINES: '36', CCGOLF_GLYPHS: 'halfblock', CCGOLF_SEASON: 'fall' } });
    let err = '';
    p.stderr.on('data', d => err += d);
    p.stdin.end(JSON.stringify({ session_id: sid }));
    p.on('close', () => {
      spawns++; inflight--;
      const m = /PERF rss=(\d+) cpuUserUs=(\d+) cpuSysUs=(\d+) body=(\d+) wrote=(\d)/.exec(err);
      if (m) { peakRss = Math.max(peakRss, +m[1]); cpuMs += (+m[2] + +m[3]) / 1000; writes += +m[5]; }
      res();
    });
  });
}

async function session(i) {
  const sid = `stress-${i}`;
  // Sessions 0..N/2 are "working" (worst case, writes every frame); the rest
  // are idle (should skip writes) — a realistic mix.
  const mode = i < Math.ceil(N / 2) ? 'WORKING' : 'IDLE';
  let now = 1700000000000;
  while (Date.now() < until) {
    now += CAD;
    await oneFrame(sid, mode, now);
    const slack = CAD - (CAD * 0); // fire back-to-back up to cadence; keep it simple
    void slack;
  }
  done++;
}

const t0 = Date.now();
await Promise.all(Array.from({ length: N }, (_, i) => session(i)));
const wall = (Date.now() - t0) / 1000;
fs.rmSync(home, { recursive: true, force: true });
console.log(`sessions ${N}  duration ${wall.toFixed(1)}s  cadence ${CAD}ms`);
console.log(`total spawns ${spawns}  (${(spawns / wall).toFixed(1)}/s aggregate, ${(spawns / wall / N).toFixed(1)}/s per session)`);
console.log(`peak concurrent in-flight renders: ${peakInflight}`);
console.log(`aggregate CPU: ${cpuMs.toFixed(0)} ms over ${wall.toFixed(1)}s = ${(cpuMs / wall / 1000 * 100).toFixed(1)}% of one core`);
console.log(`peak RSS per process: ${(peakRss / 1048576).toFixed(1)} MB  (x${N} sessions if all resident at once, but they are not)`);
console.log(`state writes: ${writes} of ${spawns} spawns = ${(writes / wall).toFixed(1)} writes/s aggregate (skip-unchanged keeps idle low)`);
