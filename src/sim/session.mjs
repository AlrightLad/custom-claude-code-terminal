// Session-level state: the round, the scorecard, mode transitions and the
// idle phases. Wraps the hole state machine in src/sim/golf.mjs.
import { coursePars } from '../gen/course.mjs';
import { newHole, advanceHole, fastForward, scoreName, DUR } from './golf.mjs';

export const STATE_VERSION = 2;

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

// Advance everything by dt ms given the hook-reported mode. Returns events
// for the entry point (career updates).
export function step(st, hole, mode, dt, now) {
  const events = [];
  const sid = st.sid;
  const h = st.hole;
  if (mode === 'WORKING') {
    if (st.mode !== 'WORKING') {
      st.mode = 'WORKING';
      st.idle = null;
      h.pt = 0;
      if (h.phase === 'holed') { events.push(...finishHole(st, now)); }
    }
    const cur = st.hole;
    const ev = advanceHole(cur, hole, dt, sid, st.round);
    void ev;
    if (cur.phase === 'holed' && cur.pt >= DUR.holed) {
      events.push(...finishHole(st, now));
      // The next hole starts on the tee; keep leftover time small so the
      // golfer does not instantly swing.
      st.hole.pt = 0;
    }
  } else {
    if (st.mode !== 'IDLE') {
      st.mode = 'IDLE';
      if (h.phase === 'holed' || h.strokes > 0) {
        // The agent stopped: hole out now (the Stop hook plays the putt
        // sound at this moment), record the score, then show the walk.
        if (!h.holed) fastForward(h, hole, sid, st.round);
        const ev = finishHole(st, now);
        events.push(...ev);
        st.idle = { phase: 'holeout', pt: 0, round: ev.some(e => e.type === 'round') };
      } else {
        st.idle = { phase: 'wait', pt: 0 };
      }
    }
    if (!st.idle) st.idle = { phase: 'wait', pt: 0 };
    st.idle.pt += dt;
    if (st.idle.phase === 'holeout' && st.idle.pt >= DUR.holed) {
      st.idle = { phase: st.idle.round ? 'round' : 'walk', pt: 0 };
    } else if (st.idle.phase === 'round' && st.idle.pt >= DUR.round) {
      st.idle = { phase: 'walk', pt: 0 };
    }
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
