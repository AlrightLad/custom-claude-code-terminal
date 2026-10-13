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
import { resolveSeason, applySeason, applyHoliday, weatherFor, darkenForWeather } from './render/seasons.mjs';
import { readRoster, stepAgents, activeAgentCount } from './sim/agents.mjs';
import { golfHome, ensureDirs, loadState, saveState, readMode, updateCareer } from './state.mjs';
import { clamp, hash32 } from './util/rng.mjs';

// Diagnostics: `node src/statusline.mjs --doctor` (or --fonts) prints a glyph &
// font report for the user's OWN terminal and exits. Kept out of the render hot
// path by a lazy import — a normal frame never evaluates this branch or loads
// the module. Must come before the stdin/watchdog bootstrap below.
if (process.argv.includes('--doctor') || process.argv.includes('--fonts')) {
  const { runDoctor } = await import('./doctor.mjs');
  runDoctor(process.env);
  process.exit(0);
}

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

const off = v => v === undefined || /^(0|false|no|off)$/i.test(v);

function main(raw) {
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
  // Segment mode: emit only the one-line golfer status row, for embedding in
  // another status line (CCGOLF_SEGMENT=1 or a --segment argument).
  const segment = /^(1|true|yes|on)$/i.test(envVar('SEGMENT') || '') || process.argv.includes('--segment');

  const home = golfHome();
  ensureDirs(home);
  const modeInfo = readMode(home, sid);
  // CCGOLF_NOW lets the harness drive the clock deterministically.
  const now = Number(envVar('NOW')) || Date.now();
  let st = loadState(home, sid);
  if (!st || st.v !== STATE_VERSION || st.sid !== sid || !st.hole) st = newState(sid, now);
  // Signature of the meaningful state (everything but the clock) so a frozen
  // idle frame does not rewrite the file every second across N sessions.
  const volatile = (k, v) => (k === 't' || k === 'act' || k === '_w') ? undefined : v;
  const loadedSig = JSON.stringify(st, volatile);
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
  // Subagent golfers: reconcile with the roster the hooks maintain, advance them.
  const roster = readRoster(home, sid);
  if (roster.length || (st.agents && Object.keys(st.agents).length)) stepAgents(st, hole, roster, mode, dt, now);
  mark('sim');
  const sandbox = /^(test-|bench|scene-|demo|perf|canon-|vd)/.test(sid) || envVar('NO_CAREER');
  if (events.length && !sandbox) {
    try { updateCareer(home, sid, c => { for (const ev of events) applyCareer(c, ev, sid, now); }); } catch {}
  }

  const cad = genCaddie(sid);
  const t = totals(st);
  // The hole geometry may have changed if a hole was finished during step().
  const curHole = st.hole.no === hole.no ? hole : genHole(sid, st.hole.no);
  const pal = loadPalette(theme);
  // Season: palette overrides, wardrobe, props and weather, resolved once.
  const season = resolveSeason(process.env, now);
  applySeason(pal, season);
  applyHoliday(pal, season, process.env, now); // merges a date-window holiday on top
  const weather = weatherFor(season, sid, curHole.no, now);
  darkenForWeather(pal, weather); // overcast/rain mood, before the quantizer tables build
  const ctx = { st, hole: curHole, cad, cols: usable, rows: rowsWorking, mode: st.mode, now, sid, tier,
    pal, R: pal.roles, seedInt: hash32(sid + ':' + curHole.no), toPar: t.toPar, thru: t.thru, strokesTotal: t.strokes,
    season, weather, agents: activeAgentCount(st), debug: !!envVar('DEBUG'), segment };
  const frame = renderScene(ctx);
  mark('scene');
  if (ctx.violation) {
    // Loud, never silent: a sprite that had to be clamped is a layout bug.
    try { fs.appendFileSync(path.join(home, 'sprite-violations.log'), `${new Date(now).toISOString()}\t${sid.slice(0, 8)}\t${ctx.violation}\n`); } catch {}
  }
  const out = renderCells(frame, pal, colorMode, tier);
  mark('cells');
  // Persist only when the meaningful state changed, or once every 8s to keep
  // the clock fresh. A frozen idle golfer across 8 sessions then costs almost
  // no disk churn instead of a write every second.
  const changed = JSON.stringify(st, volatile) !== loadedSig;
  const didWrite = changed || now - (st._w || 0) > 8000;
  if (didWrite) { st._w = now; saveState(home, sid, st); }
  mark('save');
  process.stdout.write(out + '\n');
  globalThis.__golfWrote = didWrite ? 1 : 0;

  if (envVar('TRACE')) {
    const detail = marks.map(([n, ms]) => `${n}=${ms}`).join(' ');
    try { fs.appendFileSync(path.join(home, 'trace.log'), `${now}\t${sid.slice(0, 8)}\t${st.mode}\t${st.hole.phase}\tbody=${Date.now() - T0}ms\tprocess=${Math.round(process.uptime() * 1000)}ms\t${detail}\t${ctx.trace || ''}\n`); } catch {}
    // Per-process resource line for docs/PERF.md measurement (stderr, not the status line).
    const cpu = process.cpuUsage();
    process.stderr.write(`PERF rss=${process.memoryUsage().rss} cpuUserUs=${cpu.user} cpuSysUs=${cpu.system} body=${Date.now() - T0} wrote=${globalThis.__golfWrote ?? 1}\n`);
  }
}

// Bootstrap. Two failures must never happen: a stack trace in the status line,
// and a process that lingers. `fs.readFileSync(0)` blocks forever if Claude
// Code cancels a frame without closing stdin, and across many sessions those
// hung reads accumulate into a lockup — the confirmed root cause. So stdin is
// read ASYNC with a short deadline (render from state if it never arrives), and
// a hard unref'd watchdog guarantees the process exits even if anything hangs.
let ran = false;
let timers = [];
function finish(raw) {
  if (ran) return;
  ran = true;
  for (const t of timers) { try { clearTimeout(t); } catch {} }
  try { main(raw); }
  catch (e) {
    // Never-fail, but never invisible: no stack trace in the status line, yet a
    // real bug must not vanish into a blank line that looks like the disabled
    // state. So always append to errors.log, show one quiet dim marker, and
    // surface the full stack on stderr under trace.
    const msg = String((e && e.stack) || e).replace(/\s+/g, ' ').slice(0, 300);
    try { fs.appendFileSync(path.join(golfHome(), 'errors.log'), `${new Date().toISOString()}\t${msg}\n`); } catch {}
    try { process.stdout.write('\x1b[2m· golf error (CCGOLF_TRACE for detail)\x1b[0m\n'); } catch { try { process.stdout.write('\n'); } catch {} }
    if (process.env.CCGOLF_TRACE || process.env.GOLF_TRACE) { try { process.stderr.write(msg + '\n'); } catch {} }
  }
  // Let the process exit naturally so buffered stdout flushes; removing the
  // stdin listener drops the only thing keeping the event loop alive. Calling
  // process.exit() here would truncate piped output.
  try { process.stdin.destroy(); } catch {}
}

if (!off(process.env.CCGOLF_DISABLE)) {
  // Kill switch: empty status line, no work, no stdin wait. Natural exit flushes.
  try { process.stdout.write('\n'); } catch {}
} else {
  const hardMs = clamp(parseInt(process.env.CCGOLF_TIMEOUT_MS, 10) || 4000, 500, 30000);
  const stdinMs = clamp(parseInt(process.env.CCGOLF_STDIN_MS, 10) || 400, 50, 5000);
  let rawIn = '';
  // Hard backstop only: if everything hangs, force-exit (output already attempted).
  const hard = setTimeout(() => { try { process.stdout.write('\n'); } catch {} process.exit(0); }, hardMs);
  if (hard.unref) hard.unref();
  // Ref'd: guarantees we render within stdinMs even if stdin yields nothing and
  // does not itself keep the loop alive. Normal frames clear it on stdin 'end'
  // within ~1ms, so there is no added latency except on a stalled/cancelled frame.
  const soon = setTimeout(() => finish(rawIn), stdinMs);
  timers = [hard, soon];
  try {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => { rawIn += d; });
    process.stdin.on('end', () => finish(rawIn));
    process.stdin.on('error', () => finish(rawIn));
    // If stdin never ends (cancelled frame), the soon-timer renders from state.
  } catch { finish(rawIn); }
}
