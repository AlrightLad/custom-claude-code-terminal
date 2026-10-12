// Procedural course: hole geometry, lie classification, caddie/bag/cart
// variants and caddie quips. Everything is a pure function of the seed, so
// genHole(sessionId, 7) is the same hole on every invocation.
//
// Coordinates are yards. The tee is at (0,0), the green centre is on the +x
// axis, +y is the golfer's right (drawn toward the bottom of the picture).
import { rngFor, clamp, pick, range } from '../util/rng.mjs';

const PAR_TEMPLATE = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4]; // par 72

const ADJ = ['Long', 'Short', 'Blind', 'Crooked', 'Old', 'Dry', 'Wet', 'High', 'Low', 'Broken',
  'Lucky', 'Quiet', 'Windy', 'Narrow', 'Lazy', 'Stony', 'Deep', 'Little', 'Big', 'Lost'];
const NOUN = ['Pond', 'Oak', 'Pines', 'Ridge', 'Hollow', 'Elbow', 'Corner', 'Creek', 'Meadow',
  'Gulch', 'Spit', 'Bend', 'Barn', 'Orchard', 'Quarry', 'Mill', 'Gap', 'Shelf', 'Burn', 'Knoll'];

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

export function genHole(sid, holeNo) {
  const rnd = rngFor(sid, 'hole', holeNo);
  const par = coursePars(sid)[(holeNo - 1) % 18];
  const length = Math.round(par === 3 ? range(rnd, 125, 205) : par === 4 ? range(rnd, 330, 455) : range(rnd, 485, 575));

  // Centreline: optional dogleg, then rotate so the green centre sits on +x.
  let dogleg = null;
  if (par > 3 && rnd() < 0.55) {
    dogleg = { at: range(rnd, 0.5, 0.68), angle: (rnd() < 0.5 ? -1 : 1) * range(rnd, 10, 22) * Math.PI / 180 };
  }
  const raw = [{ x: 0, y: 0 }];
  let G;
  if (dogleg) {
    const d1 = length * dogleg.at;
    raw.push({ x: d1, y: 0 });
    const d2 = length - d1;
    G = { x: d1 + d2 * Math.cos(dogleg.angle), y: d2 * Math.sin(dogleg.angle) };
  } else {
    G = { x: length, y: 0 };
  }
  raw.push(G);
  const phi = Math.atan2(G.y, G.x);
  const c = Math.cos(-phi), s = Math.sin(-phi);
  const rot = p => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
  const center = raw.map(rot);
  const chord = Math.hypot(G.x, G.y);

  const fairwayHalf = par === 3 ? 11 : range(rnd, 13, 19);
  const roughHalf = fairwayHalf + range(rnd, 9, 14);
  const sideKind = () => { const r = rnd(); return r < 0.5 ? 'trees' : r < 0.82 ? 'rough' : 'ob'; };
  const sides = { L: sideKind(), R: sideKind() };

  const gc = { x: chord, y: 0 };
  const green = { x: gc.x, y: gc.y, rx: range(rnd, 11, 16), ry: range(rnd, 9, 13) };
  const pin = { x: gc.x + range(rnd, -0.55, 0.55) * green.rx, y: gc.y + range(rnd, -0.55, 0.55) * green.ry };

  const hole = { no: holeNo, par, length, chord, dogleg, center, fairwayHalf, roughHalf, sides, green, pin,
    bunkers: [], water: [], trees: [], stakes: [], name: '', wind: null,
    tee: { x: 0, y: 0 } };

  // Fairway bunkers in the driver landing zone; par 5s get a second zone.
  if (par > 3) {
    const n = Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const at = par === 5 && rnd() < 0.4 ? range(rnd, 400, 470) : range(rnd, 195, 275);
      const p = pointAt(hole, at, side * (fairwayHalf + range(rnd, -3, 5)));
      hole.bunkers.push({ x: p.x, y: p.y, rx: range(rnd, 6, 10), ry: range(rnd, 4, 7) });
    }
  }
  // Greenside bunkers.
  const gsN = 1 + Math.floor(rnd() * 3);
  const slots = [Math.PI, Math.PI * 0.7, -Math.PI * 0.7, Math.PI / 2, -Math.PI / 2, 0]; // front, front-sides, sides, back
  for (let i = 0; i < gsN; i++) {
    const th = slots.splice(Math.floor(rnd() * slots.length), 1)[0];
    const r = range(rnd, 4, 7);
    hole.bunkers.push({ x: gc.x + Math.cos(th) * (green.rx + r + 2), y: gc.y + Math.sin(th) * (green.ry + r + 2), rx: r * 1.2, ry: r * 0.9 });
  }
  // Water: a pond beside the fairway, a pond guarding the green, or a creek across it.
  if (rnd() < (par === 3 ? 0.45 : 0.32)) {
    const kind = rnd();
    if (kind < 0.4 && par > 3) {
      const side = rnd() < 0.5 ? -1 : 1;
      const p = pointAt(hole, range(rnd, 0.55, 0.85) * length, side * (fairwayHalf + range(rnd, 8, 20)));
      hole.water.push({ x: p.x, y: p.y, rx: range(rnd, 16, 30), ry: range(rnd, 10, 18), kind: 'pond' });
    } else if (kind < 0.75) {
      const rx = range(rnd, 12, 22), ry = range(rnd, 8, 14);
      hole.water.push({ x: gc.x - green.rx - rx - range(rnd, 6, 18), y: gc.y + range(rnd, -8, 8), rx, ry, kind: 'front' });
    } else if (par > 3) {
      const p = pointAt(hole, range(rnd, 0.55, 0.75) * length, 0);
      hole.water.push({ x: p.x, y: p.y, rx: range(rnd, 3, 4.5), ry: 70, kind: 'creek' });
    }
  }
  // Trees: dense on wooded sides, sparse elsewhere, a few behind the green.
  const treeStep = 13;
  for (const sideName of ['L', 'R']) {
    const side = sideName === 'L' ? -1 : 1;
    const wooded = sides[sideName] === 'trees';
    for (let at = -20; at < length + 10; at += treeStep) {
      const jitter = range(rnd, -4, 4);
      if (wooded) {
        const p1 = pointAt(hole, at + jitter, side * (roughHalf + range(rnd, 2, 9)));
        hole.trees.push({ x: p1.x, y: p1.y, r: range(rnd, 4, 7) });
        if (rnd() < 0.7) {
          const p2 = pointAt(hole, at + range(rnd, -6, 6), side * (roughHalf + range(rnd, 12, 24)));
          hole.trees.push({ x: p2.x, y: p2.y, r: range(rnd, 4, 8) });
        }
      } else if (rnd() < 0.3) {
        const p = pointAt(hole, at + jitter, side * (roughHalf + range(rnd, 14, 32)));
        hole.trees.push({ x: p.x, y: p.y, r: range(rnd, 3, 6) });
      }
    }
    if (sides[sideName] === 'ob') {
      const d = side * (roughHalf + 12);
      for (let at = 0; at <= length; at += 22) {
        const p = pointAt(hole, at, d);
        hole.stakes.push({ x: p.x, y: p.y });
      }
    }
  }
  for (let i = 0; i < 4; i++) {
    hole.trees.push({ x: gc.x + green.rx + range(rnd, 10, 24), y: gc.y + range(rnd, -28, 28), r: range(rnd, 4, 7) });
  }

  const speed = Math.round(18 * Math.pow(rnd(), 1.6));
  hole.wind = { speed, dir: range(rnd, 0, Math.PI * 2) };
  hole.name = pick(rnd, ADJ) + ' ' + pick(rnd, NOUN);
  return hole;
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
    const d = (P.x - A.x) * -uy + (P.y - A.y) * ux; // signed; +right of travel
    const dist = Math.hypot(P.x - cx, P.y - cy);
    if (!best || dist < best.dist) best = { s: sBase + t, d, dist, seg: i, ux, uy };
    sBase += len;
  }
  // Beyond the ends, s keeps counting so "past the green" is detectable.
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
  if (inEllipse(P, hole.green, 2.5)) return 'fringe';
  const pr = project(hole, P);
  const ad = Math.abs(pr.d);
  if (pr.s >= -8 && pr.s <= 10 && ad <= 8) return 'tee';
  if (pr.s >= 8 && pr.s <= hole.length - 4 && ad <= hole.fairwayHalf) return 'fairway';
  if (ad <= hole.roughHalf || pr.s < 0 || pr.s > hole.length - 4) return 'rough';
  const side = hole.sides[pr.d < 0 ? 'L' : 'R'];
  if (side === 'trees') return 'trees';
  if (side === 'ob' && ad > hole.roughHalf + 12) return 'ob';
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

const CONS = ['b', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'w', 'z', 'ch', 'sh', 'th'];
const VOW = ['a', 'e', 'i', 'o', 'u', 'ay', 'ee', 'oo'];

export function genCaddie(sid) {
  const rnd = rngFor(sid, 'caddie');
  let name = pick(rnd, CONS) + pick(rnd, VOW);
  if (rnd() < 0.6) name += pick(rnd, CONS) + pick(rnd, VOW);
  if (rnd() < 0.4) name += pick(rnd, ['n', 's', 'l', 't', 'r']);
  if (name.length < 3) name += pick(rnd, CONS) + pick(rnd, VOW); // "Se" reads like a typo
  name = name[0].toUpperCase() + name.slice(1);
  // Shirts, pants and bag are kept distinct from each other so the figures
  // never collapse into a single-colour blob at sprite scale.
  const shirts = [10, 14, 12, 9, 8, 6];
  const golferShirt = pick(rnd, shirts);
  let caddieShirt = pick(rnd, shirts);
  if (caddieShirt === golferShirt) caddieShirt = shirts[(shirts.indexOf(caddieShirt) + 1) % shirts.length];
  const pantsChoices = [14, 9, 6].filter(p => p !== golferShirt);
  const pants = pick(rnd, pantsChoices);
  const bagChoices = [10, 14, 0, 6, 13, 15].filter(b => b !== caddieShirt);
  return {
    name,
    transport: rnd() < 0.35 ? 'cart' : 'walk',
    skin: pick(rnd, [11, 15]),
    shirt: caddieShirt,
    hat: rnd() < 0.5,
    bag: pick(rnd, bagChoices),
    cart: pick(rnd, [9, 12, 8]),
    golfer: { shirt: golferShirt, skin: pick(rnd, [11, 15]), hat: rnd() < 0.5, pants },
  };
}

const QUIPS = {
  tee: ['Smooth tempo, boss.', 'Favour the left side.', 'Just a nice easy one.', 'Trust the swing.', 'Big breath. Let it go.'],
  fairway: ['Perfect. Textbook.', 'Found the short grass.', 'That will play.', 'Right down the middle.'],
  rough: ['Bit of a lie, that.', 'Playable. Probably.', 'The rough is thick here.', 'Hack it out and move on.'],
  trees: ['That is in the trees, boss.', 'I hear the squirrels laughing.', 'We have a shot. A small one.', 'Punch out. No heroics.'],
  bunker: ['Beach time.', 'Splash it out, nice and easy.', 'At least it is not water.', 'Open the face and commit.'],
  water: ['...that is wet.', 'Drop zone it is.', 'The pond collects another one.', 'I will get a new ball.'],
  ob: ['That one is gone.', 'Reload. Same spot.', 'White stakes. Sorry, boss.', 'Three off the tee.'],
  green: ['Dancing!', 'On the surface. Nice.', 'Putter time.', 'Two putts for the win.'],
  short: ['Came up short.', 'One more club next time.', 'Chip and a putt.', 'Just off the front.'],
  holed: ['In the hole!', 'Centre cup.', 'Never in doubt.', 'That is the sound we like.'],
  lip: ['Lipped out!', 'Robbed.', 'How did that stay out?', 'Burned the edge.'],
  bogey: ['Bogey. It happens.', 'Tap-in bogey, moving on.', 'One over. Fine.', 'The card can take it.'],
  bad: ['We move on.', 'That one hurt.', 'Forget it. Next tee.', 'Still a nice walk.', 'I have seen worse. Once.'],
  walk: ['Nice day for it.', 'Next tee is just up here.', 'Water? Snack?', 'Keep the tempo, boss.', 'Weather is holding.'],
  cart: ['Hold on.', 'Cart path only today.', 'Easy on the corners.', 'Next tee, two minutes.'],
  wait: ['Whenever you are ready.', 'Take your time.', 'Group ahead is slow.', 'Stretch it out.'],
};

export function quip(sid, holeNo, n, event) {
  const list = QUIPS[event] || QUIPS.walk;
  return pick(rngFor(sid, 'quip', holeNo, n, event), list);
}
