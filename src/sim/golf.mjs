// Shot physics, 12-handicap dispersion and the hole state machine.
// Pure: every function takes the state it mutates plus the hole geometry.
// Shot outcomes are seeded by (session, round, hole, stroke) so a replay from
// the same session id produces the same shots regardless of frame timing.
import { rngFor, gauss, clamp, dist } from '../util/rng.mjs';
import { lieAt, pointAt, project } from '../gen/course.mjs';

// carry in yards (full swing), roll as a fraction of carry on fairway,
// sl/sd = lateral and distance sigma as fractions of carry. Tuned with
// harness/montecarlo.mjs against the 12-handicap targets in the README.
export const CLUBS = [
  { k: 'D',  carry: 250, roll: 0.10, sl: 0.072, sd: 0.070 },
  { k: '3W', carry: 228, roll: 0.08, sl: 0.070, sd: 0.072 },
  { k: '5W', carry: 212, roll: 0.07, sl: 0.068, sd: 0.075 },
  { k: '4H', carry: 198, roll: 0.06, sl: 0.066, sd: 0.080 },
  { k: '5i', carry: 185, roll: 0.05, sl: 0.064, sd: 0.085 },
  { k: '6i', carry: 174, roll: 0.04, sl: 0.062, sd: 0.085 },
  { k: '7i', carry: 163, roll: 0.035, sl: 0.060, sd: 0.085 },
  { k: '8i', carry: 152, roll: 0.03, sl: 0.058, sd: 0.085 },
  { k: '9i', carry: 141, roll: 0.025, sl: 0.056, sd: 0.090 },
  { k: 'PW', carry: 128, roll: 0.02, sl: 0.054, sd: 0.090 },
  { k: 'GW', carry: 112, roll: 0.015, sl: 0.052, sd: 0.095 },
  { k: 'SW', carry: 95, roll: 0.01, sl: 0.050, sd: 0.100 },
  { k: 'LW', carry: 75, roll: 0.01, sl: 0.050, sd: 0.105 },
];

export const DUR = { tee: 1500, address: 1200, swing: 1000, result: 2200, walk: 1500, holed: 3500, round: 4500 };

export function scoreName(par, strokes) {
  const d = strokes - par;
  if (strokes === 1) return 'ACE';
  if (d <= -3) return 'ALBATROSS';
  if (d === -2) return 'EAGLE';
  if (d === -1) return 'BIRDIE';
  if (d === 0) return 'PAR';
  if (d === 1) return 'BOGEY';
  if (d === 2) return 'DOUBLE';
  if (d === 3) return 'TRIPLE';
  return '+' + d;
}

export function toParText(n) { return n === 0 ? 'E' : n > 0 ? '+' + n : String(n); }

export function newHole(no, par) {
  return { no, par, strokes: 0, putts: 0, pen: 0, ball: { x: 0, y: 0 }, lie: 'tee', holed: false,
    phase: 'tee', pt: 0, shots: [], fir: null, gir: null };
}

const r1 = v => Math.round(v * 10) / 10;

function putterMake(ft, rnd) {
  const p = ft <= 1.5 ? 0.995 : ft <= 3 ? 0.90 : ft <= 4 ? 0.78 : ft <= 5 ? 0.66 : ft <= 6 ? 0.55 : ft <= 8 ? 0.40
    : ft <= 10 ? 0.30 : ft <= 15 ? 0.17 : ft <= 20 ? 0.10 : ft <= 30 ? 0.06 : ft <= 40 ? 0.035 : 0.02;
  return rnd() < p;
}

function unit(a, b) { const dx = b.x - a.x, dy = b.y - a.y; const l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; }

// Place the ball `ft` feet from the pin, mostly along the line of play.
function nearPin(hole, from, ft, rnd, towardBias = 0.5) {
  const u = unit(from, hole.pin);
  const ang = Math.atan2(u.y, u.x) + gauss(rnd) * 0.7 + (rnd() < towardBias ? 0 : Math.PI);
  const yd = ft / 3;
  return { x: hole.pin.x + Math.cos(ang) * yd, y: hole.pin.y + Math.sin(ang) * yd };
}

function windComponents(hole, heading) {
  const w = hole.wind;
  const rel = w.dir - heading;
  return { along: w.speed * Math.cos(rel), cross: w.speed * Math.sin(rel) };
}

// Takes one shot from the current ball position. Returns the shot record and
// mutates h (strokes, ball, lie, putts, pen, holed, fir, gir).
export function takeShot(h, hole, sid, round) {
  const n = h.strokes + 1;
  const rnd = rngFor(sid, 'r', round, 'h', h.no, 's', n);
  const from = { x: h.ball.x, y: h.ball.y };
  const dPin = dist(from, hole.pin);
  const lie = h.lie;
  const shot = { n, from: { x: r1(from.x), y: r1(from.y) }, club: '', kind: 'full', pen: 0, holed: false, label: null, curve: 0, dur: 1500 };
  h.strokes = n;
  let end;

  if (lie === 'green' || (lie === 'fringe' && dPin < 12)) {
    const ft = dPin * 3;
    shot.kind = 'putt'; shot.club = 'PT'; shot.ft = Math.round(ft);
    h.putts++;
    if (putterMake(ft, rnd)) {
      end = { x: hole.pin.x, y: hole.pin.y }; shot.holed = true; shot.label = 'IN!';
    } else {
      let rem = ft > 25 ? Math.abs(gauss(rnd)) * 0.13 * ft + 1.5 : Math.abs(gauss(rnd)) * (1.3 + 0.10 * ft) + 0.3;
      rem = clamp(rem, 0.3, Math.max(2, ft * 0.5));
      end = nearPin(hole, from, rem, rnd, 0.55);
      shot.label = ft > 5 && rem < 1.2 ? 'LIP OUT' : null;
      shot.left = Math.round(rem);
    }
    shot.dur = 700 + 40 * ft;
  } else if (lie === 'bunker' && dPin <= 45) {
    shot.kind = 'sand'; shot.club = 'SW';
    if (rnd() < 0.12) {
      end = { x: from.x + (rnd() - 0.5) * 2, y: from.y + (rnd() - 0.5) * 2 }; shot.label = 'STILL IN';
    } else {
      end = nearPin(hole, from, Math.abs(gauss(rnd)) * (9 + 0.5 * dPin) + 2, rnd, 0.6);
      shot.label = 'SPLASH';
    }
    shot.dur = 1400;
  } else if (dPin <= 35 && (lie === 'fairway' || lie === 'rough' || lie === 'fringe' || lie === 'tee')) {
    shot.kind = dPin > 18 ? 'pitch' : 'chip'; shot.club = dPin > 18 ? 'SW' : 'PW';
    const sigma = (lie === 'rough' ? 1.35 : 1) * (5 + 0.35 * dPin);
    const r = rnd();
    if (dPin < 25 && r < 0.03) { end = { x: hole.pin.x, y: hole.pin.y }; shot.holed = true; shot.label = 'CHIP IN!'; }
    else if (r < (lie === 'rough' ? 0.2 : 0.12)) {
      const u = unit(from, hole.pin); const f = 0.3 + 0.3 * rnd();
      end = { x: from.x + u.x * dPin * f, y: from.y + u.y * dPin * f }; shot.label = 'DUFFED';
    } else end = nearPin(hole, from, Math.abs(gauss(rnd)) * sigma + 1, rnd, 0.55);
    shot.dur = 1200;
  } else if (lie === 'trees') {
    shot.kind = 'punch'; shot.club = '7i';
    const pr = project(hole, from);
    const target = pointAt(hole, pr.s + 55, 0);
    const u = unit(from, target);
    const carry = Math.min(75, dist(from, target));
    if (rnd() < 0.3) {
      const a = rnd() * Math.PI * 2, d = 6 + rnd() * 16;
      end = { x: from.x + Math.cos(a) * d, y: from.y + Math.sin(a) * d }; shot.label = 'HIT A TREE';
    } else {
      const d = carry * (1 + 0.15 * gauss(rnd)), lat = carry * 0.12 * gauss(rnd);
      end = { x: from.x + u.x * d - u.y * lat, y: from.y + u.y * d + u.x * lat }; shot.label = 'PUNCH';
      shot.curve = lat * 0.3;
    }
    shot.dur = 900 + 6 * carry;
  } else {
    // Full swing: pick a target and a club, then disperse.
    const isTee = lie === 'tee';
    let target, club, carry, partial = false;
    const lieMul = lie === 'rough' ? 0.9 : lie === 'bunker' ? 0.85 : 1;
    const maxCarry = (isTee ? 250 : lie === 'fairway' ? 228 : 200) * lieMul;
    const heading0 = Math.atan2(hole.pin.y - from.y, hole.pin.x - from.x);
    const w0 = windComponents(hole, heading0);
    const needed = dPin - w0.along * 1.0;
    if (needed > maxCarry + 15) {
      // Advance along the fairway with the biggest sensible club.
      club = isTee ? CLUBS[0] : lie === 'fairway' ? CLUBS[1] : CLUBS[3];
      const pr = project(hole, from);
      const reach = Math.min(club.carry * lieMul * 0.97, hole.length - 20 - pr.s);
      target = pointAt(hole, pr.s + Math.max(60, reach), 0);
      carry = club.carry * lieMul;
      // A 12-handicap does not lay up for creeks: 40% go for it anyway. The other 60% lay up short.
      for (const wtr of hole.water) {
        if (wtr.kind !== 'creek') continue;
        const wp = project(hole, wtr);
        if (wp.s > pr.s + carry - 30 && wp.s < pr.s + carry + 20 && rnd() < 0.6) {
          const lay = Math.max(50, wp.s - pr.s - 25);
          club = CLUBS.reduce((b, c) => (c.carry * lieMul <= lay && (!b || c.carry > b.carry)) ? c : b, null) || CLUBS[12];
          carry = Math.min(club.carry * lieMul, lay);
          target = pointAt(hole, pr.s + lay, 0);
          shot.label = 'LAY UP';
        }
      }
    } else {
      const greenCentre = { x: hole.green.x, y: hole.green.y };
      target = (needed <= 165 && lie !== 'rough') ? hole.pin : greenCentre;
      const eff = dist(from, target) - w0.along * 1.0;
      if (eff < 75) { club = CLUBS[12]; carry = eff; partial = true; }
      else {
        let idx = CLUBS.length - 1;
        for (let i = CLUBS.length - 1; i >= 0; i--) { if (CLUBS[i].carry * lieMul >= eff) { idx = i; break; } }
        if (rnd() < 0.35 && idx < CLUBS.length - 1) idx++; // the classic under-club
        club = CLUBS[idx]; carry = club.carry * lieMul;
      }
    }
    shot.club = club.k;
    const u = unit(from, target);
    const heading = Math.atan2(u.y, u.x);
    const w = windComponents(hole, heading);
    const sd = partial ? 0.12 : club.sd * (lie === 'rough' ? 1.3 : lie === 'bunker' ? 1.4 : 1);
    const sl = partial ? 0.09 : club.sl * (lie === 'rough' ? 1.3 : lie === 'bunker' ? 1.4 : 1);
    let d = carry * (1 + sd * gauss(rnd)) + (partial ? 2 * gauss(rnd) : 0);
    let lat = carry * sl * gauss(rnd) + (partial ? 1.5 * gauss(rnd) : 0);
    const r = rnd();
    const badP = isTee ? 0.12 : 0.10;
    if (r < badP) {
      const right = rnd() < 0.72;
      lat += (right ? 1 : -1) * (0.10 + 0.13 * rnd()) * carry;
      d *= 0.88;
      shot.label = right ? 'SLICE' : 'HOOK';
    } else if (r < badP + 0.04) { d *= 0.55 + 0.25 * rnd(); shot.label = 'FAT'; }
    else if (r < badP + 0.06) { d *= 1.1; shot.label = 'THIN'; }
    else if (lie === 'bunker' && rnd() < 0.15) { d *= 0.45; shot.label = 'FAT'; }
    const scale = carry / 250;
    d += w.along * 1.2 * scale;
    lat += w.cross * 0.9 * scale;
    const land = { x: from.x + u.x * d - u.y * lat, y: from.y + u.y * d + u.x * lat };
    const landLie = lieAt(hole, land);
    let roll = carry * club.roll * (1 + 0.3 * gauss(rnd));
    if (landLie === 'rough' || landLie === 'tee') roll *= 0.4;
    else if (landLie === 'green' || landLie === 'fringe') roll *= 0.5;
    else if (landLie === 'bunker' || landLie === 'water' || landLie === 'trees') roll = 0;
    end = { x: land.x + u.x * roll, y: land.y + u.y * roll };
    shot.land = { x: r1(land.x), y: r1(land.y) };
    shot.curve = lat * 0.5;
    shot.dur = 900 + 6 * d;
    shot.carry = Math.round(d);
  }

  // Resolve the lie, penalties and drops.
  let newLie = lieAt(hole, end);
  if (newLie === 'water') {
    h.pen++; shot.pen = 1; shot.label = 'WATER +1';
    const u = unit(from, end);
    let p = { x: end.x, y: end.y };
    for (let k = 0; k < 120 && lieAt(hole, p) === 'water'; k++) { p = { x: p.x - u.x * 2, y: p.y - u.y * 2 }; }
    p = { x: p.x - u.x * 3, y: p.y - u.y * 3 };
    shot.splash = { x: r1(end.x), y: r1(end.y) };
    end = p; newLie = lieAt(hole, end);
    if (newLie === 'water') { end = from; newLie = lie === 'tee' ? 'tee' : lie; }
  } else if (newLie === 'ob') {
    h.pen++; shot.pen = 1; shot.label = 'OB +1';
    shot.splash = { x: r1(end.x), y: r1(end.y) };
    end = from; newLie = lie;
  }
  if (shot.holed) { newLie = 'green'; h.holed = true; }
  if (!shot.label) {
    shot.label = newLie === 'trees' ? 'TREES' : newLie === 'bunker' ? 'SAND' : newLie === 'rough' ? 'ROUGH'
      : newLie === 'green' ? 'GREEN' : newLie === 'fringe' ? 'FRINGE' : null;
  }
  if (shot.kind !== 'putt' && !shot.holed && (newLie === 'green' || newLie === 'fringe')) shot.ft = Math.round(dist(end, hole.pin) * 3);
  if (h.fir === null && hole.par > 3 && n === 1) h.fir = newLie === 'fairway';
  if (h.gir === null && (newLie === 'green' || shot.holed)) h.gir = n <= hole.par - 2;
  if (h.gir === null && n > hole.par - 2) h.gir = false;
  shot.end = { x: r1(end.x), y: r1(end.y) };
  shot.lie = newLie;
  h.ball = { x: r1(end.x), y: r1(end.y) };
  h.lie = newLie;
  h.shots.push(shot);
  return shot;
}

export function phaseDuration(h) {
  if (h.phase === 'flight') return h.shots.length ? h.shots[h.shots.length - 1].dur : 1500;
  if (h.phase === 'result') {
    const s = h.shots[h.shots.length - 1];
    return s && s.label && /SLICE|HOOK|WATER|OB|TREE|IN!|LIP|FAT|DUFF/.test(s.label) ? 3000 : DUR.result;
  }
  return DUR[h.phase] || 1500;
}

// Advance the hole state machine by dt milliseconds. Returns a list of
// events ('shot', 'holed'). The ball position in `h` only changes when the
// flight phase completes, so a frame during flight interpolates along the
// trace instead (see ballDisplay).
export function advanceHole(h, hole, dt, sid, round) {
  const events = [];
  h.pt += dt;
  for (let guard = 0; guard < 8; guard++) {
    if (h.holed && h.phase === 'holed') { h.pt = Math.min(h.pt, DUR.holed); break; }
    const dur = phaseDuration(h);
    if (h.pt < dur) break;
    h.pt -= dur;
    switch (h.phase) {
      case 'tee': h.phase = 'address'; break;
      case 'walk': h.phase = 'address'; break;
      case 'address': h.phase = 'swing'; break;
      case 'swing': {
        const before = { x: h.ball.x, y: h.ball.y };
        const shot = takeShot(h, hole, sid, round);
        h.ball = before; // hold until the flight finishes
        h.pendingEnd = { x: shot.end.x, y: shot.end.y, lie: shot.lie };
        h.phase = 'flight'; events.push('shot');
        break;
      }
      case 'flight':
        if (h.pendingEnd) { h.ball = { x: h.pendingEnd.x, y: h.pendingEnd.y }; delete h.pendingEnd; }
        h.phase = 'result';
        break;
      case 'result': {
        const s = h.shots[h.shots.length - 1];
        if (s && s.holed) { h.phase = 'holed'; events.push('holed'); }
        else {
          const moved = s ? Math.hypot(s.end.x - s.from.x, s.end.y - s.from.y) : 0;
          h.phase = moved > 4 ? 'walk' : 'address';
        }
        break;
      }
      default: h.phase = 'address';
    }
  }
  return events;
}

// Plays the rest of the hole instantly (used when the agent stops mid-hole).
export function fastForward(h, hole, sid, round) {
  let guard = 0;
  while (!h.holed && h.strokes < 12 && guard++ < 20) takeShot(h, hole, sid, round);
  if (!h.holed) { h.holed = true; h.lie = 'green'; h.ball = { x: hole.pin.x, y: hole.pin.y }; }
  delete h.pendingEnd;
  h.phase = 'holed'; h.pt = 0;
}

// Where to draw the ball right now.
export function ballDisplay(h) {
  if (h.phase !== 'flight' || !h.shots.length) return h.ball;
  const s = h.shots[h.shots.length - 1];
  const f = clamp(h.pt / (s.dur || 1), 0, 1);
  return pointOnShot(s, f);
}

// Quadratic path from -> end, bowing toward the miss direction so a slice
// reads as a slice. Water/OB shots travel to the splash point instead.
export function pointOnShot(s, f) {
  const a = s.from, b = s.splash || s.end;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const cx = mx - nx * s.curve, cy = my - ny * s.curve;
  const t = f, it = 1 - f;
  return { x: it * it * a.x + 2 * it * t * cx + t * t * b.x, y: it * it * a.y + 2 * it * t * cy + t * t * b.y };
}
