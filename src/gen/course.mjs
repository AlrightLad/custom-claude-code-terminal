// Procedural course: hole geometry, lie classification, caddie variants and
// caddie remarks. Everything is a pure function of the seed, so
// genHole(sessionId, 7) is the same hole on every invocation.
//
// Coordinates are yards. The tee is at (0,0), the green centre is on the +x
// axis, +y is the golfer's right (drawn toward the bottom of the picture).
// Holes dogleg (single or double), fairways breathe in width with a pinch at
// the driver landing zone, water sits where it is in play, and greens can be
// elevated or two-tiered. Names are derived from the features a hole has.
import fs from 'node:fs';
import { rngFor, clamp, pick, range } from '../util/rng.mjs';

const PAR_TEMPLATE = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4]; // par 72

export function coursePars(sid) {
  const rnd = rngFor(sid, 'pars');
  const pars = PAR_TEMPLATE.slice();
  for (let nine = 0; nine < 2; nine++) {
    const base = nine * 9;
    for (let k = 0; k < 12; k++) {
      const i = base + Math.floor(rnd() * 9), j = base + Math.floor(rnd() * 9);
      const t = pars[i]; pars[i] = pars[j]; pars[j] = t;
    }
  }
  return pars;
}

// Fairway half-width at along-track distance s: a slow breathing profile
// with a pinch around the driver landing zone on par 4s and 5s.
export function fairwayHalfAt(hole, s) {
  const w = hole.width;
  let v = hole.fairwayHalf * (1 + w.amp * Math.sin(s / w.period * Math.PI * 2 + w.phase));
  if (w.pinchDepth > 0) {
    const z = (s - w.pinchAt) / 28;
    v *= 1 - w.pinchDepth * Math.exp(-z * z);
  }
  return Math.max(9, v);
}

export function genHole(sid, holeNo) {
  const rnd = rngFor(sid, 'hole', holeNo);
  const par = coursePars(sid)[(holeNo - 1) % 18];
  const length = Math.round(par === 3 ? range(rnd, 125, 205) : par === 4 ? range(rnd, 330, 455) : range(rnd, 485, 575));

  // Centreline: 0, 1 or 2 bends, then rotate so the green centre sits on +x.
  const bends = [];
  if (par > 3) {
    const r = rnd();
    const nBends = par === 5 && r < 0.3 ? 2 : r < 0.72 ? 1 : 0;
    if (nBends === 1) bends.push({ at: range(rnd, 0.48, 0.66), angle: (rnd() < 0.5 ? -1 : 1) * range(rnd, 14, 32) * Math.PI / 180 });
    if (nBends === 2) {
      const sgn = rnd() < 0.5 ? -1 : 1;
      bends.push({ at: range(rnd, 0.3, 0.4), angle: sgn * range(rnd, 14, 26) * Math.PI / 180 });
      bends.push({ at: range(rnd, 0.62, 0.74), angle: -sgn * range(rnd, 14, 30) * Math.PI / 180 });
    }
  }
  const raw = [{ x: 0, y: 0 }];
  let heading = 0, sAt = 0, cur = { x: 0, y: 0 };
  for (const b of bends) {
    const d = length * b.at - sAt;
    cur = { x: cur.x + Math.cos(heading) * d, y: cur.y + Math.sin(heading) * d };
    raw.push(cur); sAt += d; heading += b.angle;
  }
  const dEnd = length - sAt;
  const G = { x: cur.x + Math.cos(heading) * dEnd, y: cur.y + Math.sin(heading) * dEnd };
  raw.push(G);
  const phi = Math.atan2(G.y, G.x);
  const c = Math.cos(-phi), s = Math.sin(-phi);
  const rot = p => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
  const center = raw.map(rot);
  const chord = Math.hypot(G.x, G.y);
  const dogleg = bends.length ? { at: bends[0].at, angle: bends[0].angle, count: bends.length } : null;

  const fairwayHalf = par === 3 ? range(rnd, 13, 16) : range(rnd, 18, 24);
  const width = {
    amp: par === 3 ? 0.08 : range(rnd, 0.1, 0.22), period: range(rnd, 70, 130), phase: range(rnd, 0, Math.PI * 2),
    pinchAt: range(rnd, 215, 265), pinchDepth: par === 3 ? 0 : (rnd() < 0.6 ? range(rnd, 0.15, 0.3) : 0),
  };
  const roughHalf = fairwayHalf * 1.1 + range(rnd, 10, 16);
  const sideKind = () => { const r = rnd(); return r < 0.5 ? 'trees' : r < 0.82 ? 'rough' : 'ob'; };
  const sides = { L: sideKind(), R: sideKind() };

  const gc = { x: chord, y: 0 };
  const green = { x: gc.x, y: gc.y, rx: range(rnd, 12, 17), ry: range(rnd, 10, 14), elevated: rnd() < 0.35, tier: rnd() < 0.4 ? range(rnd, -0.3, 0.3) : null };
  const pin = { x: gc.x + range(rnd, -0.55, 0.55) * green.rx, y: gc.y + range(rnd, -0.55, 0.55) * green.ry };

  const hole = { no: holeNo, par, length, chord, dogleg, bends, center, fairwayHalf, width, roughHalf, sides, green, pin,
    bunkers: [], water: [], trees: [], stakes: [], name: '', wind: null, tee: { x: 0, y: 0 } };

  // Landing-zone bunkers (par 4/5), a second zone on par 5s.
  if (par > 3) {
    const n = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const at = par === 5 && rnd() < 0.4 ? range(rnd, 400, 470) : range(rnd, 205, 275);
      const hb = fairwayHalfAt(hole, at);
      const p = pointAt(hole, at, side * (hb + range(rnd, -4, 4)));
      hole.bunkers.push({ x: p.x, y: p.y, rx: range(rnd, 7, 11), ry: range(rnd, 4, 7) });
    }
  }
  // Greenside bunkers.
  const gsN = 1 + Math.floor(rnd() * 3);
  const slots = [Math.PI, Math.PI * 0.7, -Math.PI * 0.7, Math.PI / 2, -Math.PI / 2, 0];
  for (let i = 0; i < gsN; i++) {
    const th = slots.splice(Math.floor(rnd() * slots.length), 1)[0];
    const r = range(rnd, 4, 7);
    hole.bunkers.push({ x: gc.x + Math.cos(th) * (green.rx + r + 2), y: gc.y + Math.sin(th) * (green.ry + r + 2), rx: r * 1.2, ry: r * 0.9 });
  }
  // Water in play: inside a dogleg corner, beside the landing zone, fronting the green, or a creek across.
  if (rnd() < (par === 3 ? 0.45 : 0.42)) {
    const kind = rnd();
    if (dogleg && kind < 0.4) {
      const bend = bends[0];
      const inside = Math.sign(bend.angle); // the corner is on the side the hole turns to
      const sAtBend = length * bend.at;
      const p = pointAt(hole, sAtBend + range(rnd, -10, 25), inside * (fairwayHalfAt(hole, sAtBend) + range(rnd, 10, 22)));
      hole.water.push({ x: p.x, y: p.y, rx: range(rnd, 18, 30), ry: range(rnd, 12, 20), kind: 'pond' });
    } else if (par > 3 && kind < 0.55) {
      const side = rnd() < 0.5 ? -1 : 1;
      const at = range(rnd, 0.5, 0.8) * length;
      const p = pointAt(hole, at, side * (fairwayHalfAt(hole, at) + range(rnd, 8, 20)));
      hole.water.push({ x: p.x, y: p.y, rx: range(rnd, 16, 30), ry: range(rnd, 10, 18), kind: 'pond' });
    } else if (kind < 0.82) {
      const rx = range(rnd, 12, 22), ry = range(rnd, 8, 14);
      hole.water.push({ x: gc.x - green.rx - rx - range(rnd, 6, 18), y: gc.y + range(rnd, -8, 8), rx, ry, kind: 'front' });
    } else if (par > 3) {
      const p = pointAt(hole, range(rnd, 0.55, 0.75) * length, 0);
      hole.water.push({ x: p.x, y: p.y, rx: range(rnd, 5, 7.5), ry: 90, kind: 'creek' });
    }
  }
  // Trees: dense on wooded sides, sparse elsewhere, a few behind the green.
  const treeStep = 13;
  for (const sideName of ['L', 'R']) {
    const side = sideName === 'L' ? -1 : 1;
    const wooded = sides[sideName] === 'trees';
    for (let at = -20; at < length + 10; at += treeStep) {
      const jitter = range(rnd, -4, 4);
      const rh = fairwayHalfAt(hole, at) * 1.1 + (roughHalf - fairwayHalf * 1.1);
      if (wooded) {
        const p1 = pointAt(hole, at + jitter, side * (rh + range(rnd, 2, 9)));
        hole.trees.push({ x: p1.x, y: p1.y, r: range(rnd, 4, 7) });
        if (rnd() < 0.7) {
          const p2 = pointAt(hole, at + range(rnd, -6, 6), side * (rh + range(rnd, 12, 24)));
          hole.trees.push({ x: p2.x, y: p2.y, r: range(rnd, 4, 8) });
        }
      } else if (rnd() < 0.3) {
        const p = pointAt(hole, at + jitter, side * (rh + range(rnd, 14, 32)));
        hole.trees.push({ x: p.x, y: p.y, r: range(rnd, 3, 6) });
      }
    }
    if (sides[sideName] === 'ob') {
      for (let at = 0; at <= length; at += 22) {
        const rh = fairwayHalfAt(hole, at) * 1.1 + (roughHalf - fairwayHalf * 1.1);
        const p = pointAt(hole, at, side * (rh + 12));
        hole.stakes.push({ x: p.x, y: p.y });
      }
    }
  }
  for (let i = 0; i < 4; i++) {
    hole.trees.push({ x: gc.x + green.rx + range(rnd, 10, 24), y: gc.y + range(rnd, -28, 28), r: range(rnd, 4, 7) });
  }

  const speed = Math.round(18 * Math.pow(rnd(), 1.6));
  hole.wind = { speed, dir: range(rnd, 0, Math.PI * 2) };
  hole.name = nameFor(hole, rnd);
  return hole;
}

// Rough half-width at s (outside this is trees / OB / deep rough).
export function roughHalfAt(hole, s) {
  return fairwayHalfAt(hole, s) * 1.1 + (hole.roughHalf - hole.fairwayHalf * 1.1);
}

// Names come from the features that exist on the hole.
function nameFor(hole, rnd) {
  const water = hole.water[0];
  // The noun names the hole's most distinctive feature, in priority order.
  let nouns;
  if (water) nouns = water.kind === 'creek' ? ['Burn', 'Creek', 'Ford'] : water.kind === 'front' ? ['Pond', 'Moat', 'Carry'] : ['Lake', 'Pond', 'Mere'];
  else if (hole.dogleg && hole.dogleg.count > 1) nouns = ['Snake', 'Wiggle', 'Esses'];
  else if (hole.dogleg) nouns = hole.dogleg.angle < 0 ? ['Elbow', 'Hook', 'Corner'] : ['Bend', 'Crook', 'Turn'];
  else if (hole.bunkers.length >= 4) nouns = ['Sands', 'Pits', 'Traps'];
  else if (hole.sides.L === 'trees' && hole.sides.R === 'trees') nouns = ['Alley', 'Pines', 'Chute'];
  else if (hole.green.elevated) nouns = ['Knoll', 'Shelf', 'Rise'];
  else if (hole.green.tier !== null) nouns = ['Steps', 'Tiers', 'Terrace'];
  else if (hole.sides.L === 'trees' || hole.sides.R === 'trees') nouns = ['Oaks', 'Copse', 'Wood'];
  else if (hole.sides.L === 'ob' || hole.sides.R === 'ob') nouns = ['Boundary', 'Wall', 'Road'];
  else nouns = ['Meadow', 'Field', 'Lea', 'Flats', 'Common'];
  const adjs = [];
  if (hole.par === 5 && hole.length >= 540) adjs.push('Long', 'Far');
  if (hole.par === 3 && hole.length <= 150) adjs.push('Short', 'Little', 'Wee');
  if (hole.par === 4 && hole.length <= 350) adjs.push('Short');
  if (hole.wind.speed >= 12) adjs.push('Windy', 'Gusty');
  if (hole.fairwayHalf < 21 && hole.par > 3) adjs.push('Narrow', 'Tight');
  if (hole.width.pinchDepth > 0.22) adjs.push('Pinched');
  if (hole.dogleg && Math.abs(hole.dogleg.angle) > 24 * Math.PI / 180) adjs.push('Crooked', 'Sharp');
  if (hole.green.elevated) adjs.push('High');
  if (water && water.kind === 'front') adjs.push('Wet');
  if (!adjs.length) adjs.push('Old', 'Quiet', 'Lazy', 'Sunny', 'Plain', 'Lucky', 'Lower', 'Upper', 'Home', 'Lone');
  return pick(rnd, adjs) + ' ' + pick(rnd, nouns);
}

// Along-track position s and signed lateral offset d of point P relative to
// the centreline polyline (d > 0 is the golfer's right).
export function project(hole, P) {
  let best = null;
  const pts = hole.center;
  let sBase = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1];
    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const t = clamp(((P.x - A.x) * ux + (P.y - A.y) * uy), 0, len);
    const cx = A.x + ux * t, cy = A.y + uy * t;
    const d = (P.x - A.x) * -uy + (P.y - A.y) * ux;
    const dist = Math.hypot(P.x - cx, P.y - cy);
    if (!best || dist < best.dist) best = { s: sBase + t, d, dist, seg: i, ux, uy };
    sBase += len;
  }
  const A = pts[0], B = pts[pts.length - 1];
  if (best.seg === 0 && ((P.x - A.x) * best.ux + (P.y - A.y) * best.uy) < 0) best.s = (P.x - A.x) * best.ux + (P.y - A.y) * best.uy;
  if (best.seg === pts.length - 2) {
    const last = pts[pts.length - 2];
    const along = (P.x - last.x) * best.ux + (P.y - last.y) * best.uy;
    const segLen = Math.hypot(B.x - last.x, B.y - last.y);
    if (along > segLen) best.s = sBase - segLen + along;
  }
  return best;
}

// World point at along-track s and lateral d.
export function pointAt(hole, s, d) {
  const pts = hole.center;
  let sBase = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1];
    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    if (s <= sBase + len || i === pts.length - 2) {
      const t = s - sBase;
      return { x: A.x + ux * t + -uy * d, y: A.y + uy * t + ux * d };
    }
    sBase += len;
  }
  return { x: 0, y: d };
}

export function inEllipse(P, e, pad = 0) {
  const dx = (P.x - e.x) / (e.rx + pad), dy = (P.y - e.y) / (e.ry + pad);
  return dx * dx + dy * dy <= 1;
}

export function lieAt(hole, P) {
  for (const w of hole.water) if (inEllipse(P, w)) return 'water';
  for (const b of hole.bunkers) if (inEllipse(P, b)) return 'bunker';
  if (inEllipse(P, hole.green)) return 'green';
  if (inEllipse(P, hole.green, 3)) return 'fringe';
  const pr = project(hole, P);
  const ad = Math.abs(pr.d);
  if (pr.s >= -8 && pr.s <= 10 && ad <= 8) return 'tee';
  const hb = fairwayHalfAt(hole, pr.s), rh = roughHalfAt(hole, pr.s);
  if (pr.s >= 8 && pr.s <= hole.length - 2 && ad <= hb) return 'fairway';
  if (ad <= rh || pr.s < 0 || pr.s > hole.length - 2) return 'rough';
  const side = hole.sides[pr.d < 0 ? 'L' : 'R'];
  if (side === 'trees') return 'trees';
  if (side === 'ob' && ad > rh + 12) return 'ob';
  return 'rough';
}

// Bounding box of everything worth drawing, in yards.
export function bounds(hole) {
  let minX = -14, maxX = hole.chord + hole.green.rx + 14, minY = -hole.roughHalf - 8, maxY = hole.roughHalf + 8;
  const grow = (x, y, r = 0) => { minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r); minY = Math.min(minY, y - r); maxY = Math.max(maxY, y + r); };
  for (const p of hole.center) grow(p.x, p.y, hole.roughHalf + 8);
  for (const b of hole.bunkers) grow(b.x, b.y, Math.max(b.rx, b.ry) + 2);
  for (const w of hole.water) grow(w.x, w.y, w.kind === 'creek' ? 0 : Math.max(w.rx, w.ry) + 2);
  grow(hole.green.x, hole.green.y, Math.max(hole.green.rx, hole.green.ry) + 6);
  return { minX, maxX, minY, maxY };
}

// ---------------------------------------------------------------- caddie ---

// Caddie names and remarks are editable data (assets/text/caddies.json); the
// built-ins below are the fallback if that file is missing or malformed.
const CADDIES_URL = new URL('../../assets/text/caddies.json', import.meta.url);
let CADDIE_DATA = null;
try { CADDIE_DATA = JSON.parse(fs.readFileSync(CADDIES_URL, 'utf8')); } catch {}
const FIRST = (CADDIE_DATA && CADDIE_DATA.first && CADDIE_DATA.first.length) ? CADDIE_DATA.first : ['Ada', 'Alfie', 'Amos', 'Archie', 'Bea', 'Benji', 'Billy', 'Bram', 'Cal', 'Cass', 'Cliff', 'Dex', 'Dot',
  'Eddie', 'Elsie', 'Ernie', 'Fern', 'Finn', 'Flo', 'Frankie', 'Gus', 'Hal', 'Hattie', 'Ike', 'Ivy', 'Jack', 'Jo',
  'Kit', 'Lou', 'Mack', 'Mae', 'Max', 'Milo', 'Moe', 'Nell', 'Ned', 'Ollie', 'Otis', 'Pat', 'Pip', 'Ray', 'Reg',
  'Rosie', 'Sam', 'Sid', 'Tam', 'Ted', 'Tess', 'Toby', 'Vic', 'Wally', 'Wes', 'Win'];
const LAST = (CADDIE_DATA && CADDIE_DATA.last && CADDIE_DATA.last.length) ? CADDIE_DATA.last : ['Abbott', 'Baird', 'Barlow', 'Blake', 'Boyd', 'Burke', 'Calder', 'Clyde', 'Crane', 'Dunn', 'Ferris',
  'Finch', 'Forbes', 'Grant', 'Hale', 'Hardy', 'Hayes', 'Holt', 'Irwin', 'Kerr', 'Lamb', 'Logan', 'Lowe', 'Marsh',
  'Moss', 'Munro', 'Nash', 'Oakes', 'Pike', 'Quinn', 'Rees', 'Ross', 'Shaw', 'Slade', 'Stone', 'Tate', 'Todd',
  'Vance', 'Wade', 'Ward', 'Webb', 'Wren', 'York'];

export function genCaddie(sid) {
  const rnd = rngFor(sid, 'caddie');
  const first = pick(rnd, FIRST), last = pick(rnd, LAST);
  // Colours are indices into the palette's role lists (shirts, pants, bags)
  // so a theme can restyle them; golfer and caddie never share a shirt.
  const golferShirt = Math.floor(rnd() * 5);
  let caddieShirt = Math.floor(rnd() * 5);
  if (caddieShirt === golferShirt) caddieShirt = (caddieShirt + 1) % 5;
  return {
    name: first, fullName: `${first} ${last}`,
    transport: rnd() < 0.35 ? 'cart' : 'walk',
    skin: rnd() < 0.5 ? 0 : 1,
    shirt: caddieShirt,
    hat: rnd() < 0.5,
    bag: Math.floor(rnd() * 5),
    golfer: { shirt: golferShirt, skin: rnd() < 0.5 ? 0 : 1, hat: rnd() < 0.5, pants: Math.floor(rnd() * 3) },
  };
}

// Things a caddie would actually say, by situation.
const QUIPS = {
  tee: ['Smooth tempo.', 'Favour the left side.', 'Nice and easy.', 'Trust it.', 'Big breath, then let it go.', 'Pick a spot and commit.'],
  fairway: ['Textbook.', 'Short grass. Lovely.', 'That will play.', 'Right down the middle.', 'Nothing wrong with that.'],
  rough: ['Bit of a lie.', 'Playable. Probably.', 'Thick in here.', 'Hack it out and move on.', 'Take your medicine.'],
  trees: ['That is in the trees.', 'I can hear the squirrels laughing.', 'We have a shot. A small one.', 'Punch out. No heroics.', 'Chip it sideways.'],
  bunker: ['Beach.', 'Splash it out, nice and easy.', 'At least it is not wet.', 'Open the face and commit.', 'Plenty of sand in that one.'],
  water: ['That is wet.', 'Drop zone it is.', 'The pond wins again.', 'I will dig out a new ball.', 'Did not need that one anyway.'],
  ob: ['That one is gone.', 'Reload, same spot.', 'White stakes. Sorry.', 'Three off the tee.', 'Forget that ever happened.'],
  green: ['Dancing.', 'On the surface, nice.', 'Putter time.', 'Two putts does it.', 'Good number from there.'],
  short: ['Came up short.', 'One more club next time.', 'Chip and a putt.', 'Just off the front.'],
  holed: ['In the hole.', 'Centre cup.', 'Never in doubt.', 'That is the sound we like.', 'Good putt.'],
  lip: ['Lipped out.', 'Robbed.', 'How did that stay out?', 'Burned the edge.'],
  bogey: ['Bogey. It happens.', 'Tap-in bogey, moving on.', 'One over. Fine.', 'The card can take it.'],
  bad: ['We move on.', 'That one hurt.', 'Forget it. Next tee.', 'Still a nice walk.', 'I have seen worse. Once.'],
  walk: ['Nice day for it.', 'Next tee is just up here.', 'Water? Snack?', 'Keep that tempo.', 'Weather is holding.', 'Watch the step here.'],
  cart: ['Hold on.', 'Cart path only today.', 'Easy on the corners.', 'Next tee, two minutes.', 'Mind the mud.'],
  wait: ['Whenever you are ready.', 'Take your time.', 'Group ahead is slow.', 'Stretch it out.', 'No rush.'],
};

const REMARKS = (CADDIE_DATA && CADDIE_DATA.remarks) ? CADDIE_DATA.remarks : QUIPS;

export function quip(sid, holeNo, n, event) {
  const list = (REMARKS[event] && REMARKS[event].length) ? REMARKS[event] : (REMARKS.walk || QUIPS.walk);
  return pick(rngFor(sid, 'quip', holeNo, n, event), list);
}
