#!/usr/bin/env node
// Replay fixture: WORKING -> IDLE -> WORKING. Asserts that during the IDLE
// span the stroke count never rises after the in-flight shot has settled,
// that no hole advances, and that play resumes from the same ball position.
// usage: node harness/idle-check.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const ENTRY = path.join(ROOT, 'src', 'statusline.mjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-idle-'));
const sid = 'scene-1';
let now = 1700000000000;
const log = [];
function tick(mode) {
  now += 700;
  execFileSync('node', [ENTRY], { input: JSON.stringify({ session_id: sid }), encoding: 'utf8',
    env: { ...process.env, CCGOLF_HOME: home, CCGOLF_MODE: mode, CCGOLF_NOW: String(now), COLUMNS: '100', LINES: '30' } });
  const st = JSON.parse(fs.readFileSync(path.join(home, 'state', sid + '.json'), 'utf8'));
  const row = { mode, stMode: st.mode, phase: st.hole.phase, strokes: st.hole.strokes, hole: st.hole.no, idle: st.idle ? st.idle.phase : '-', ball: `${st.hole.ball.x},${st.hole.ball.y}` };
  log.push(row);
  return row;
}
let fails = 0;
for (let i = 0; i < 18; i++) tick('WORKING');
const atStop = log[log.length - 1];
let settled = null;
for (let i = 0; i < 25; i++) {
  const r = tick('IDLE');
  if (settled === null && (r.phase === 'stand' || r.phase === 'holed' || r.idle === 'walk' || r.idle === 'wait')) settled = { ...r };
  if (settled && (r.strokes !== settled.strokes || r.hole !== settled.hole) && !(settled.phase === 'holed' && r.idle === 'walk')) {
    fails++; console.log(`FAIL idle tick ${i}: strokes ${settled.strokes}->${r.strokes} hole ${settled.hole}->${r.hole} phase=${r.phase} idle=${r.idle}`);
  }
}
const frozen = log[log.length - 1];
if (frozen.strokes > atStop.strokes + 1) { fails++; console.log(`FAIL more than one stroke completed while idle: ${atStop.strokes} -> ${frozen.strokes}`); }
const resumed = tick('WORKING');
if (resumed.ball !== frozen.ball && frozen.phase === 'stand') { fails++; console.log(`FAIL ball moved on resume: ${frozen.ball} -> ${resumed.ball}`); }
for (let i = 0; i < 6; i++) tick('WORKING');
console.log(log.map((r, i) => `${String(i).padStart(2)} ${r.mode.padEnd(7)} ${r.stMode.padEnd(7)} h${r.hole} s${r.strokes} ${r.phase.padEnd(7)} idle=${r.idle}`).join('\n'));
console.log(`stop at strokes ${atStop.strokes} (${atStop.phase}), frozen at strokes ${frozen.strokes} (${frozen.phase}/${frozen.idle}), resumed ${resumed.phase}; ${fails} failures`);
fs.rmSync(home, { recursive: true, force: true });
process.exitCode = fails ? 1 : 0;
