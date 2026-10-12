// Session-level state: the round, the scorecard, mode transitions and the
// idle phases. Wraps the hole state machine in src/sim/golf.mjs.
//
// The simulation advances only while the agent is WORKING. When the agent
// stops, the shot in the air is allowed to land, roll out and settle, and
// then the state machine is frozen: no new swings, no hole advancement, no
// score changes. On WORKING the golfer addresses the ball and plays on from
// exactly where he stopped.
import { coursePars } from '../gen/course.mjs';
import { newHole, advanceHole, scoreName, DUR } from './golf.mjs';

export const STATE_VERSION = 3;

export function newState(sid, now) {
  const pars = coursePars(sid);
  return { v: STATE_VERSION, sid, t: now, mode: 'IDLE', round: 1, holeIdx: 0, scores: new Array(18).fill(null),
    hole: newHole(1, pars[0]), idle: { phase: 'wait', pt: 0 }, last: null, lastRound: null, created: now };
}

export function totals(st) {
  let strokes = 0, par = 0, thru = 0;
  for (const s of st.scores) if (s) { strokes += s.s; par += s.par; thru++; }
  return { strokes, par, thru, toPar: strokes - par };
}

function finishHole(st, now) {
  const h = st.hole;
  const rec = { par: h.par, s: h.strokes, p: h.putts, gir: !!h.gir, fir: h.fir, pen: h.pen, no: h.no };
  st.scores[st.holeIdx] = rec;
  st.last = { no: h.no, par: h.par, strokes: h.strokes, putts: h.putts, name: scoreName(h.par, h.strokes) };
  const events = [{ type: 'holeout', rec }];
  st.holeIdx++;
  if (st.holeIdx >= 18) {
    const t = totals(st);
    st.lastRound = { round: st.round, total: t.strokes, toPar: t.toPar, par: t.par, at: now, scores: st.scores.slice() };
    events.push({ type: 'round', round: st.lastRound });
    st.round++;
    st.holeIdx = 0;
    st.scores = new Array(18).fill(null);
  }
  const pars = coursePars(st.sid);
  st.hole = newHole(st.holeIdx + 1, pars[st.holeIdx]);
  return events;
}

// Idle phases:
//   settle   the shot in the air finishes (flight -> result), then stand
//   stand    mid-hole: golfer at the ball, caddie beside him, frozen
//   holeout  the final shot dropped: celebration, score recorded, then walk
//   round    18 holes done
//   walk     between holes, walking to the next tee
//   wait     on the tee before the first shot of the hole
function enterIdle(st, now) {
  const h = st.hole;
  st.mode = 'IDLE';
  if (h.phase === 'swing' || h.phase === 'flight' || h.phase === 'result') st.idle = { phase: 'settle', pt: 0 };
  else if (h.phase === 'holed' || h.holed) st.idle = { phase: 'holeout', pt: 0, pending: true };
  else if (h.strokes === 0) st.idle = { phase: 'wait', pt: 0 };
  else st.idle = { phase: 'stand', pt: 0 };
  void now;
}

// Advance everything by dt ms given the hook-reported mode. Returns events
// for the entry point (career updates).
export function step(st, hole, mode, dt, now) {
  const events = [];
  const sid = st.sid;
  if (mode === 'WORKING') {
    if (st.mode !== 'WORKING') {
      st.mode = 'WORKING';
      const was = st.idle;
      st.idle = null;
      const h = st.hole;
      // Resume: a finished hole moves on, a frozen golfer addresses the ball.
      if (h.phase === 'holed' && was && was.pending) events.push(...finishHole(st, now));
      else if (h.phase === 'stand') { h.phase = 'address'; h.pt = 0; }
      else if (h.phase === 'holed') { /* celebration continues */ }
    }
    const cur = st.hole;
    advanceHole(cur, hole, dt, sid, st.round, false);
    if (cur.phase === 'holed' && cur.pt >= DUR.holed) {
      events.push(...finishHole(st, now));
      st.hole.pt = 0;
    }
    return events;
  }

  if (st.mode !== 'IDLE') enterIdle(st, now);
  if (!st.idle) st.idle = { phase: 'wait', pt: 0 };
  const h = st.hole;
  const idle = st.idle;
  // 'stand' (waiting mid-hole) and 'wait' (on the tee) are truly frozen — their
  // breathing animation is driven by wall-clock `now`, not pt — so pt does not
  // advance and the state stays byte-identical. That lets the entry skip the
  // per-second state write for a session that is just sitting idle, which is
  // the common case across many open terminals.
  if (idle.phase !== 'stand' && idle.phase !== 'wait') idle.pt += dt;
  if (idle.phase === 'settle') {
    // Let the current shot land and roll out; freeze before the next swing.
    advanceHole(h, hole, dt, sid, st.round, true);
    if (h.phase === 'holed') st.idle = { phase: 'holeout', pt: 0, pending: true };
    else if (h.phase === 'stand') st.idle = { phase: 'stand', pt: 0 };
  } else if (idle.phase === 'holeout') {
    if (idle.pt >= DUR.holed) {
      const ev = finishHole(st, now);
      events.push(...ev);
      st.idle = { phase: ev.some(e => e.type === 'round') ? 'round' : 'walk', pt: 0 };
    }
  } else if (idle.phase === 'round' && idle.pt >= DUR.round) {
    st.idle = { phase: 'walk', pt: 0 };
  }
  return events;
}

export function applyCareer(c, ev, sid, now) {
  if (ev.type === 'holeout') {
    const r = ev.rec;
    c.holes++; c.strokes += r.s; c.par += r.par; c.putts += r.p; c.penalties += r.pen;
    if (r.gir) c.gir++;
    if (r.fir !== null && r.fir !== undefined) { c.firHoles++; if (r.fir) c.fir++; }
    const name = scoreName(r.par, r.s);
    c.counts[name] = (c.counts[name] || 0) + 1;
    if (r.s === 1) c.holeInOnes++;
  } else if (ev.type === 'round') {
    const r = ev.round;
    c.rounds++;
    const entry = { at: now, total: r.total, toPar: r.toPar, sid: String(sid).slice(0, 8) };
    if (!c.best || r.total < c.best.total) c.best = entry;
    if (!c.worst || r.total > c.worst.total) c.worst = entry;
    c.lastRounds.push(entry);
    if (c.lastRounds.length > 20) c.lastRounds.shift();
  }
}
