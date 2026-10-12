#!/usr/bin/env node
// Entry: load state -> advance by wall-clock delta -> render -> persist -> print.
// One invocation is one frame. No subprocesses, no TTY, no network.
import fs from 'node:fs';
import path from 'node:path';
import { genHole, genCaddie } from './gen/course.mjs';
import { newState, step, totals, applyCareer, STATE_VERSION } from './sim/session.mjs';
import { renderScene } from './render/scene.mjs';
import { loadPalette } from './render/palette.mjs';
import { renderCells } from './out/cells.mjs';
import { golfHome, ensureDirs, loadState, saveState, readMode, updateCareer } from './state.mjs';
import { clamp } from './util/rng.mjs';

const T0 = Date.now();

function intEnv(name, dflt) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : dflt;
}

const marks = [];
const mark = name => { if (process.env.GOLF_TRACE) marks.push([name, Date.now() - T0]); };

function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch {}
  mark('stdin');
  let input = {};
  try { input = JSON.parse(raw); } catch {}
  const sid = String(input.session_id || process.env.CLAUDE_CODE_SESSION_ID || 'no-session');

  const cols = clamp(intEnv('COLUMNS', 80), 20, 400);
  const lines = clamp(intEnv('LINES', 24), 8, 200);
  // Claude Code truncates rows past COLUMNS - 5 - padding (docs/PROBE.md).
  const usable = clamp(cols - 7, 13, 393);
  const rowsWorking = process.env.GOLF_ROWS ? clamp(intEnv('GOLF_ROWS', 8), 3, 16) : clamp(Math.floor((lines - 6) / 3), 4, 12);
  const colorMode = process.env.GOLF_COLOR === '256' ? '256' : 'truecolor';
  const timeScale = clamp(Number(process.env.GOLF_TIME_SCALE) || 1, 0.1, 50);

  const home = golfHome();
  ensureDirs(home);
  const modeInfo = readMode(home, sid);
  // GOLF_NOW lets the harness drive the clock deterministically.
  const now = Number(process.env.GOLF_NOW) || Date.now();
  let st = loadState(home, sid);
  if (!st || st.v !== STATE_VERSION || st.sid !== sid || !st.hole) st = newState(sid, now);
  const dt = clamp(now - (st.t || now), 0, 2500) * timeScale;
  st.t = now;
  mark('state');

  const hole = genHole(sid, st.hole.no);
  mark('gen');
  const events = step(st, hole, modeInfo.mode, dt, now);
  mark('sim');
  const sandbox = /^(test-|bench|scene-)/.test(sid) || process.env.GOLF_NO_CAREER;
  if (events.length && !sandbox) {
    try { updateCareer(home, c => { for (const ev of events) applyCareer(c, ev, sid, now); }); } catch {}
  }

  const cad = genCaddie(sid);
  const t = totals(st);
  // The hole geometry may have changed if a hole was finished during step().
  const curHole = st.hole.no === hole.no ? hole : genHole(sid, st.hole.no);
  const frame = renderScene({ st, hole: curHole, cad, cols: usable, rows: rowsWorking, mode: st.mode, now, sid,
    toPar: t.toPar, thru: t.thru, strokesTotal: t.strokes });
  mark('scene');
  const out = renderCells(frame, loadPalette(), colorMode);
  mark('cells');
  saveState(home, sid, st);
  mark('save');
  process.stdout.write(out + '\n');

  if (process.env.GOLF_TRACE) {
    const detail = marks.map(([n, ms]) => `${n}=${ms}`).join(' ');
    try { fs.appendFileSync(path.join(home, 'trace.log'), `${now}\t${sid.slice(0, 8)}\t${st.mode}\t${st.hole.phase}\tbody=${Date.now() - T0}ms\tprocess=${Math.round(process.uptime() * 1000)}ms\t${detail}\n`); } catch {}
  }
}

try {
  main();
} catch (e) {
  const msg = String((e && e.stack) || e).split('\n').slice(0, 2).join(' ').slice(0, 90);
  process.stdout.write(`golf: ${msg}\n`);
}
