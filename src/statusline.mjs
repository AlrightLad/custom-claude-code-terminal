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
import { selectTier } from './render/tiers.mjs';
import { golfHome, ensureDirs, loadState, saveState, readMode, updateCareer } from './state.mjs';
import { clamp, hash32 } from './util/rng.mjs';

const T0 = Date.now();

// CCGOLF_* is the documented prefix; GOLF_* still works for older installs.
function envVar(name) {
  const v = process.env['CCGOLF_' + name];
  return v !== undefined ? v : process.env['GOLF_' + name];
}

function intEnv(name, dflt) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : dflt;
}

const marks = [];
const mark = name => { if (process.env.CCGOLF_TRACE || process.env.GOLF_TRACE) marks.push([name, Date.now() - T0]); };

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
  const rowsEnv = parseInt(envVar('ROWS'), 10);
  const rowsWorking = Number.isFinite(rowsEnv) ? clamp(rowsEnv, 3, 20) : clamp(Math.floor((lines - 6) / 3), 4, 16);
  const colorMode = envVar('COLOR') === '256' ? '256' : 'truecolor';
  const timeScale = clamp(Number(envVar('TIME_SCALE')) || 1, 0.1, 50);
  const tier = selectTier(process.env);
  const theme = envVar('THEME') || 'augusta';

  const home = golfHome();
  ensureDirs(home);
  const modeInfo = readMode(home, sid);
  // CCGOLF_NOW lets the harness drive the clock deterministically.
  const now = Number(envVar('NOW')) || Date.now();
  let st = loadState(home, sid);
  if (!st || st.v !== STATE_VERSION || st.sid !== sid || !st.hole) st = newState(sid, now);
  const dt = clamp(now - (st.t || now), 0, 2500) * timeScale;
  st.t = now;
  mark('state');

  const hole = genHole(sid, st.hole.no);
  mark('gen');
  // Stale-mode guard. A long turn keeps changing the token and API-time
  // counters in the status line payload; a dropped Stop hook leaves WORKING
  // written with nothing changing. If WORKING is older than five minutes and
  // the activity signature has not moved in five minutes, treat it as IDLE.
  let mode = modeInfo.mode;
  const cw = input.context_window || {}, cost = input.cost || {};
  const sig = `${cw.total_input_tokens || 0}:${cw.total_output_tokens || 0}:${cost.total_api_duration_ms || 0}:${cost.total_duration_ms || 0}`;
  if (!st.act || st.act.sig !== sig) st.act = { sig, t: now };
  if (mode === 'WORKING' && modeInfo.source !== 'env' && modeInfo.t > 0 && now / 1000 - modeInfo.t > 300 && now - st.act.t > 300000) mode = 'IDLE';
  const events = step(st, hole, mode, dt, now);
  mark('sim');
  const sandbox = /^(test-|bench|scene-|demo)/.test(sid) || envVar('NO_CAREER');
  if (events.length && !sandbox) {
    try { updateCareer(home, c => { for (const ev of events) applyCareer(c, ev, sid, now); }); } catch {}
  }

  const cad = genCaddie(sid);
  const t = totals(st);
  // The hole geometry may have changed if a hole was finished during step().
  const curHole = st.hole.no === hole.no ? hole : genHole(sid, st.hole.no);
  const pal = loadPalette(theme);
  const ctx = { st, hole: curHole, cad, cols: usable, rows: rowsWorking, mode: st.mode, now, sid, tier,
    pal, R: pal.roles, seedInt: hash32(sid + ':' + curHole.no), toPar: t.toPar, thru: t.thru, strokesTotal: t.strokes,
    debug: !!envVar('DEBUG') };
  const frame = renderScene(ctx);
  mark('scene');
  if (ctx.violation) {
    // Loud, never silent: a sprite that had to be clamped is a layout bug.
    try { fs.appendFileSync(path.join(home, 'sprite-violations.log'), `${new Date(now).toISOString()}\t${sid.slice(0, 8)}\t${ctx.violation}\n`); } catch {}
  }
  const out = renderCells(frame, pal, colorMode, tier);
  mark('cells');
  saveState(home, sid, st);
  mark('save');
  process.stdout.write(out + '\n');

  if (envVar('TRACE')) {
    const detail = marks.map(([n, ms]) => `${n}=${ms}`).join(' ');
    try { fs.appendFileSync(path.join(home, 'trace.log'), `${now}\t${sid.slice(0, 8)}\t${st.mode}\t${st.hole.phase}\tbody=${Date.now() - T0}ms\tprocess=${Math.round(process.uptime() * 1000)}ms\t${detail}\t${ctx.trace || ''}\n`); } catch {}
  }
}

try {
  main();
} catch (e) {
  // Never a stack trace in the status line: one short row that fits.
  const width = clamp((parseInt(process.env.COLUMNS, 10) || 80) - 7, 20, 200);
  const msg = String((e && e.message) || e).replace(/\s+/g, ' ');
  process.stdout.write(`golf: ${msg}`.slice(0, width) + '\n');
  if (process.env.CCGOLF_TRACE || process.env.GOLF_TRACE) process.stderr.write(String(e && e.stack || e) + '\n');
}
