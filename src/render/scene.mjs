// Scene composition: framed hole view with a scrolling camera and minimap,
// green close-up, idle strip, HUD rows. Produces a backend-agnostic frame:
// text rows above the picture (frame top), a palette-index canvas at the
// tier's subpixel resolution with text overlays in cell units, and text rows
// below (frame bottom, scorecard, status chips).
//
// Layers never cross: the canvas holds world geometry and sprites only; all
// text lives in the text rows (the frame's side bars are the one overlay,
// and they are frame, not HUD).
//
// Screen units: one cell is 1 unit wide and 2 units tall, so a unit is
// square on screen; a tier maps units to subpixels with (sx, sy/2).
import { makeCanvas, set, get, fillRect, fillEllipse, thickLine, label, bayer, TRANSPARENT } from './raster.mjs';
import { spriteSet, blit, shadow } from './sprites.mjs';
import { bounds, pointAt, inEllipse, quip, fairwayHalfAt, coursePars } from '../gen/course.mjs';
import { ballDisplay, pointOnShot, DUR, CLUBS } from '../sim/golf.mjs';
import { clamp, dist, easeInOut } from '../util/rng.mjs';
import { statusRow, scorecard, leaderboardRows } from './hud.mjs';
import { renderIdle } from './idle.mjs';
import { drawWeather } from './seasons.mjs';
import { drawHoleProps, drawBirds, drawTufts } from './props.mjs';
import { leaderboard, groupRemark } from '../sim/agents.mjs';

export { TRANSPARENT };

// Zoom rule (yards per column, i.e. per screen unit; the ONE world-to-screen
// conversion, everything in the scene goes through windowMap built from it):
//   needX = (distance ball->target + 2*30y margin) / picture width in units
//   needY = (corridor: 2*fairway half-width + 2*14y rough) / picture height
//           in units, or the green's height + 2*12y in the green view
//   u = clamp(max(needX, needY), U_MIN, U_MAX)
// The target is the pin when it is within reach of a full shot, otherwise
// the landing zone one full shot down the fairway. The camera centres
// between ball and target, nudged up so the sprite standing above the ball
// is inside the picture, and is clamped to the hole's bounding box.
//
// U_MAX is the proportion guard. Sprites are a fixed 4 cells x 5 rows (ten
// units tall) no matter the zoom, so the golfer's apparent size in yards is
// 10*u. The smallest green is 20 yards across; at 2 yards per column it
// draws 10 units tall, the golfer's height, and anything coarser makes him
// taller than the green. So the camera never zooms out past 2 y/col: on a
// short picture that means the corridor edges scroll in and out of view,
// which is the right trade (the same rule a top-down NES golf game uses).
const U_MIN = 1.0, U_MAX = 2.0, MARGIN_X = 30, ROUGH_MARGIN = 14, GREEN_MARGIN = 12;
const SPRITE_UNITS = 10; // golfer height in screen units (5 rows)

// ------------------------------------------------------------- helpers ----

function hashInt(x, y, seed) {
  let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1013904223)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}
function lattice(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  let fx = x - x0, fy = y - y0;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hashInt(x0, y0, seed), b = hashInt(x0 + 1, y0, seed), c = hashInt(x0, y0 + 1, seed), d = hashInt(x0 + 1, y0 + 1, seed);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
function vnoise(x, y, seed) {
  return 0.65 * lattice(x / 7, y / 7, seed) + 0.35 * lattice(x / 3.2 + 11, y / 3.2 + 7, seed + 7);
}
// Rough texture baked once per process into a 64x64 yard tile.
const NOISE_N = 64;
const NOISE = new Float32Array(NOISE_N * NOISE_N);
for (let y = 0; y < NOISE_N; y++) for (let x = 0; x < NOISE_N; x++) {
  NOISE[y * NOISE_N + x] = vnoise(x, y, 4242) * 0.5 + vnoise((x + 32) % 64, (y + 32) % 64, 4242) * 0.5;
}
function roughNoise(wx, wy, seedInt) {
  const ix = ((wx + (seedInt & 63)) | 0) & 63, iy = ((wy + ((seedInt >> 6) & 63)) | 0) & 63;
  return NOISE[iy * NOISE_N + ix];
}

// World yards -> canvas subpixels for a window whose top-left is (minX, minY)
// at u yards per unit, inset by gutter cells on the left.
function windowMap(tier, minX, minY, u, gutterCells) {
  const kx = tier.sx, ky = tier.sy / 2;
  const gx = gutterCells * kx;
  return {
    u, kx, ky, minX, minY,
    px: x => gx + (x - minX) / u * kx,
    py: y => (y - minY) / u * ky,
    rx: v => v / u * kx,
    ry: v => v / u * ky,
    wx: X => (X - gx) / kx * u + minX,
    wy: Y => Y / ky * u + minY,
  };
}

// -------------------------------------------------------------- ground ----

function drawGround(c, hole, m, R, seedInt) {
  const W = c.w, H = c.h;
  const u = m.u;
  const edge = u * 0.9;
  const stripeF = Math.max(4 * u, 6), stripeG = Math.max(1.5 * u, 2);
  const lipW = u * 1.0;
  const dyWorld = u / m.ky;
  const g = hole.green;
  const collar = 3;
  const gPadX = g.rx + collar, gPadY = g.ry + collar;
  const apronLen = 16;
  const tierX = g.tier === null ? null : g.x + g.tier * g.rx;
  const water = hole.water, bunkers = hole.bunkers;
  const segs = [];
  let sBase = 0;
  for (let i = 0; i < hole.center.length - 1; i++) {
    const A = hole.center[i], B = hole.center[i + 1];
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    segs.push({ ax: A.x, ay: A.y, ux: dx / len, uy: dy / len, len, sBase });
    sBase += len;
  }
  const nseg = segs.length;
  const lengthEnd = hole.length - 3;
  const px = c.px;
  const RD = R.roughDark, RM = R.rough, RL = R.roughLight, FD = R.fairwayDark, FL = R.fairwayLight;
  for (let y = 0; y < H; y++) {
    const wy = m.wy(y);
    const rowOff = y * W;
    for (let x = 0; x < W; x++) {
      const wx = m.wx(x);
      let v = -1;
      for (let i = 0; i < water.length; i++) {
        const w = water[i];
        const ex = (wx - w.x) / w.rx, ey = (wy - w.y) / w.ry;
        if (ex * ex + ey * ey <= 1) {
          const ey2 = (wy - dyWorld - w.y) / w.ry;
          if (ex * ex + ey2 * ey2 > 1) v = R.waterLight;
          else {
            const ey3 = (wy + dyWorld * 2 - w.y) / w.ry;
            v = (w.kind !== 'creek' && ex * ex + ey3 * ey3 > 1) ? R.waterDeep : R.water;
          }
          break;
        }
      }
      if (v < 0) for (let i = 0; i < bunkers.length; i++) {
        const b = bunkers[i];
        const ex = (wx - b.x) / b.rx, ey = (wy - b.y) / b.ry;
        if (ex * ex + ey * ey <= 1) {
          const ex2 = (wx - lipW - b.x) / b.rx;
          v = ex2 * ex2 + ey * ey <= 1 ? R.sand : R.sandLip;
          break;
        }
      }
      if (v < 0) {
        const gx = (wx - g.x) / g.rx, gy = (wy - g.y) / g.ry;
        if (gx * gx + gy * gy <= 1) {
          v = (Math.floor((wx + wy) / stripeG) & 1) ? R.greenLight : R.greenDark;
          if (tierX !== null) {
            if (Math.abs(wx - tierX) < u * 0.6) v = R.fringe;
            else if (wx > tierX && v === R.greenDark) v = R.green;
          }
        } else {
          const fx = (wx - g.x) / gPadX, fy = (wy - g.y) / gPadY;
          if (fx * fx + fy * fy <= 1) {
            v = (g.elevated && wx < g.x - g.rx * 0.2) ? R.fairwayDark : R.fringe;
          } else {
            let bestDist = Infinity, s = 0, d = 0;
            for (let i = 0; i < nseg; i++) {
              const sg = segs[i];
              const rx = wx - sg.ax, ry = wy - sg.ay;
              const t = rx * sg.ux + ry * sg.uy;
              const tc = t < 0 ? 0 : t > sg.len ? sg.len : t;
              const cx = sg.ax + sg.ux * tc, cy = sg.ay + sg.uy * tc;
              const dd = (wx - cx) * (wx - cx) + (wy - cy) * (wy - cy);
              if (dd < bestDist) {
                bestDist = dd;
                d = rx * -sg.uy + ry * sg.ux;
                s = sg.sBase + (i === 0 && t < 0 ? t : i === nseg - 1 && t > sg.len ? t : tc);
              }
            }
            const ad = d < 0 ? -d : d;
            const inPlay = s >= 8 && s <= lengthEnd;
            const hb = fairwayHalfAt(hole, s);
            const apron = s > hole.length - g.rx - apronLen && s <= hole.length && ad < hb * 0.7;
            if (s >= -5 && s <= 6 && ad <= 5.5) v = R.tee;
            else if (apron) v = R.fairwayLight;
            else if (inPlay && ad < hb - edge) v = (Math.floor(s / stripeF) & 1) ? FL : FD;
            else if (inPlay && ad < hb + edge && bayer(x, y) >= (ad - (hb - edge)) / (2 * edge)) v = (Math.floor(s / stripeF) & 1) ? FL : FD;
            else {
              const n = roughNoise(wx, wy, seedInt);
              v = n < 0.33 ? RD : n < 0.7 ? RM : RL;
            }
          }
        }
      }
      px[rowOff + x] = v;
    }
  }
  for (const t of hole.trees) {
    const cx = m.px(t.x), cy = m.py(t.y);
    const rx = Math.max(0.6, m.rx(t.r)), ry = Math.max(0.6, m.ry(t.r));
    if (cx + rx < 0 || cx - rx > W || cy + ry < 0 || cy - ry > H) continue;
    fillEllipse(c, cx, cy, rx, ry, R.treeDark);
    if (rx >= 1.5) fillEllipse(c, cx - rx * 0.3, cy - ry * 0.3, rx * 0.5, ry * 0.5, R.treeLight);
    else if (rx >= 0.9) set(c, Math.round(cx - 0.5), Math.round(cy - 0.5), R.treeLight);
    if (rx >= 1.5) { const ox = Math.round(cx + rx * 0.55), oy = Math.round(cy + ry * 0.6); if (get(c, ox, oy) === R.treeDark) set(c, ox, oy, R.outline); }
  }
  for (const s of hole.stakes) {
    const x = Math.round(m.px(s.x)), y = Math.round(m.py(s.y));
    set(c, x, y, R.stake); if (m.ky >= 1.5) set(c, x, y - 1, R.stake);
  }
  set(c, Math.round(m.px(0)), Math.round(m.py(-4)), R.stake);
  set(c, Math.round(m.px(0)), Math.round(m.py(4)), R.stake);
}

// ---------------------------------------------------------------- play ----

function drawTrace(c, shot, m, f, colFlight, colRoll, headCol) {
  const target = shot.splash || shot.land || shot.end;
  const lenPx = Math.hypot(m.rx(target.x - shot.from.x), m.ry(target.y - shot.from.y));
  const steps = Math.max(2, Math.ceil(lenPx * 1.2));
  const upto = Math.floor(steps * f);
  const dotted = lenPx >= 12;
  for (let i = 0; i <= upto; i++) {
    const p = pointOnShot(shot, i / steps);
    // Comet: the leading few dots are bright (the ball), the rest the trace.
    const lead = upto - i;
    const col = (f < 1 && headCol && lead <= 3) ? headCol : colFlight;
    if (!dotted || i % 2 === 0 || lead <= 3) set(c, Math.round(m.px(p.x)), Math.round(m.py(p.y)), col);
  }
  if (f >= 1 && shot.land && !shot.splash) {
    const rl = Math.hypot(m.rx(shot.end.x - shot.land.x), m.ry(shot.end.y - shot.land.y));
    const rs = Math.max(1, Math.ceil(rl));
    for (let i = 1; i <= rs; i++) {
      const t = i / rs;
      set(c, Math.round(m.px(shot.land.x + (shot.end.x - shot.land.x) * t)), Math.round(m.py(shot.land.y + (shot.end.y - shot.land.y) * t)), colRoll);
    }
  }
}

// Cup, flagstick, wind-reactive flag and a drop shadow. Cloth only.
function drawPin(c, hole, m, R, tier) {
  const px = Math.round(m.px(hole.pin.x)), py = Math.round(m.py(hole.pin.y));
  const kx = tier.sx, ky = tier.sy / 2;
  const cupW = Math.max(1, Math.round(kx * 0.6)), cupH = Math.max(1, Math.round(ky * 0.6));
  set(c, px + 1, py + 1, R.shadow);
  if (kx > 1) set(c, px + 2, py + 1, R.shadow);
  for (let yy = 0; yy < cupH; yy++) for (let xx = 0; xx < cupW; xx++) set(c, px + xx, py + yy, R.cup);
  // A flagstick is a little taller than a golfer: 3.6 rows against 5.
  const poleH = Math.max(3, Math.round(ky * 2 * 3.6));
  for (let i = 1; i <= poleH; i++) set(c, px, py - i, R.pole);
  const speed = hole.wind.speed;
  const dirX = Math.cos(hole.wind.dir);
  const toRight = dirX >= 0;
  const strength = clamp(speed / 14, 0, 1);
  const flagW = Math.max(1, Math.round((1 + 2.5 * strength * Math.abs(dirX)) * kx));
  const flagH = Math.max(1, Math.round(ky * 1.1));
  const top = py - poleH;
  if (speed < 2) {
    for (let i = 0; i < Math.max(2, flagH * 2); i++) set(c, px + 1, top + i, R.flag);
  } else {
    for (let i = 0; i < flagW; i++) for (let j = 0; j < flagH; j++) {
      const taper = flagW > 2 && i === flagW - 1 && j === flagH - 1 && flagH > 1;
      if (!taper) set(c, px + (toRight ? 1 + i : -1 - i), top + j, R.flag);
    }
  }
}

function golferPose(h, now, sprites) {
  const g = sprites.golfer;
  switch (h.phase) {
    case 'swing': return g.back;
    case 'flight': return h.pt < (h.shots[h.shots.length - 1]?.dur || 1500) * 0.35 ? g.impact : g.through;
    case 'result': return h.pt < 900 ? g.through : g.address;
    case 'walk': return Math.floor(now / 500) % 2 ? g.walk1 : g.walk2;
    case 'holed': return g.cheer;
    case 'stand': {
      // Idle breathing only: lean on the club, glance down the fairway now
      // and then, shift the weight. Nothing here changes state.
      const beat = Math.floor(now / 1000) % 9;
      return beat === 6 || beat === 7 ? (g.look || g.address) : (g.lean || g.address);
    }
    default: return g.address;
  }
}

export function golferMap(cad, R, wardrobe) {
  const g = cad.golfer;
  // Winter knit cap reads red; otherwise a white cap/visor or bare head.
  const hat = wardrobe && wardrobe.hat === 'knit' ? R.bad : R.white;
  return { h: g.hat || (wardrobe && wardrobe.hat) ? hat : (g.skin ? R.skinDark : R.skin), f: g.skin ? R.skinDark : R.skin,
    s: R.shirts[g.shirt % R.shirts.length], p: R.pants[g.pants % R.pants.length], k: R.outline, c: R.club, C: R.gray };
}
export function caddieMap(cad, R) {
  return { h: cad.hat ? R.white : (cad.skin ? R.skinDark : R.skin), f: cad.skin ? R.skinDark : R.skin,
    s: R.shirts[cad.shirt % R.shirts.length], p: R.navy, k: R.outline, b: R.bags[cad.bag % R.bags.length], B: R.gray, c: R.gray };
}

// Where the golfer stands in world yards for the current phase.
function golferWorld(h) {
  const cur = h.shots[h.shots.length - 1];
  if (h.phase === 'walk' && cur) {
    const t = easeInOut(clamp(h.pt / DUR.walk, 0, 1));
    return { x: cur.from.x + (cur.end.x - cur.from.x) * t, y: cur.from.y + (cur.end.y - cur.from.y) * t };
  }
  if ((h.phase === 'flight' || h.phase === 'result') && cur && !cur.holed) return { x: cur.from.x, y: cur.from.y };
  return { x: h.ball.x, y: h.ball.y };
}

// Each active subagent golfer: its ball (in its shirt colour) plus its initial
// above it, when the ball falls inside the current camera window.
function drawAgents(c, st, m, R, tier) {
  for (const g of Object.values(st.agents || {})) {
    if (g.retired) continue;
    const b = ballDisplay(g.hole);
    const px = Math.round(m.px(b.x)), py = Math.round(m.py(b.y));
    if (px < 1 || px >= c.w - 1 || py < 2 || py >= c.h) continue;
    const col = R.shirts[g.shirt % R.shirts.length];
    set(c, px, py, col); if (tier.sx > 1) set(c, px + 1, py, col);
    set(c, px, py + 1, R.shadow);
    label(c, Math.floor(px / tier.sx), Math.floor(py / tier.sy) - 1, g.name[0], col, R.frameBg);
  }
}

// Returns the sprite's bounding box so the caller can assert it fits.
function drawPlay(c, h, hole, m, cad, now, tier, R, sprites, dbg, season) {
  const shots = h.shots;
  for (let i = 0; i < shots.length - 1; i++) drawTrace(c, shots[i], m, 1, R.traceOld, R.traceOld);
  const cur = shots[shots.length - 1];
  const ball = ballDisplay(h);
  if (cur && h.phase !== 'tee') {
    const f = h.phase === 'flight' ? clamp(h.pt / (cur.dur || 1), 0, 1) : 1;
    drawTrace(c, cur, m, f, R.trace, R.white, R.ball);
  }
  drawPin(c, hole, m, R, tier);
  const g = golferWorld(h);
  const pose = golferPose(h, now, sprites);
  const faceLeft = hole.pin.x < g.x - 2 && h.phase !== 'walk';
  const bx = Math.round(m.px(g.x)), by = Math.round(m.py(g.y));
  let sx = faceLeft ? bx + 1 - (pose[0].length - sprites.ball.x) : bx - sprites.ball.x;
  let sy = by - sprites.ball.y;
  const bw = pose[0].length, bh = pose.length;
  // Visibility rule. While the golfer stands at the ball (tee, address,
  // swing, standing, celebrating) the camera is anchored on him and the
  // sprite MUST fit: a violation is logged loudly and clamped. While the
  // camera follows the ball (flight, result, walk) he may be off camera;
  // then he is skipped entirely rather than drawn clipped at an edge.
  const gutterPx = m.px(m.minX);
  const minX = Math.round(gutterPx), maxX = c.w - Math.round(gutterPx);
  const mustFit = h.phase === 'tee' || h.phase === 'address' || h.phase === 'swing' || h.phase === 'stand' || h.phase === 'holed';
  const inside = sx >= minX && sx + bw <= maxX && sy >= 0 && sy + bh <= c.h;
  if (!inside) {
    if (!mustFit) {
      if (!(h.holed && h.phase === 'holed')) {
        const bpx = Math.round(m.px(ball.x)), bpy = Math.round(m.py(ball.y));
        if (h.phase !== 'flight') set(c, bpx, bpy + 1, R.shadow);
        set(c, bpx, bpy, R.ball);
        if (tier.sx > 1) set(c, bpx + 1, bpy, R.ball);
      }
      return { x: sx, y: sy, w: bw, h: bh, visible: false };
    }
    const cx0 = clamp(sx, minX, Math.max(minX, maxX - bw)), cy0 = clamp(sy, 0, Math.max(0, c.h - bh));
    if (dbg) dbg.spriteClamped = `(${sx},${sy})->(${cx0},${cy0})`;
    sx = cx0; sy = cy0;
  }
  const map = golferMap(cad, R, season && season.data.wardrobe);
  // The caddie stands a few cells behind the golfer (away from the target)
  // whenever nobody is swinging, and keeps the bag out of the shot.
  if (h.phase !== 'swing' && h.phase !== 'flight' && cad.transport !== 'cart') {
    const cs = sprites.caddie.stand;
    const cx0 = faceLeft ? sx + bw + 2 * tier.sx : sx - cs[0].length - 2 * tier.sx;
    const cy0 = sy + bh - cs.length;
    if (cx0 >= minX && cx0 + cs[0].length <= maxX) { shadow(c, cs, cx0, cy0, R.shadow, faceLeft); blit(c, cs, cx0, cy0, caddieMap(cad, R), faceLeft); }
  }
  shadow(c, pose, sx, sy, R.shadow, faceLeft);
  blit(c, pose, sx, sy, map, faceLeft);
  // Winter breath puff while standing.
  if (season && season.data.wardrobe && season.data.wardrobe.breath && (h.phase === 'stand' || h.phase === 'address' || h.phase === 'tee') && Math.floor(now / 1500) % 3 === 0) {
    const hx = faceLeft ? sx - 1 : sx + bw, hy = sy + 1;
    set(c, hx, hy, R.white);
  }
  if (!(h.holed && h.phase === 'holed')) {
    const bpx = Math.round(m.px(ball.x)), bpy = Math.round(m.py(ball.y));
    if (h.phase !== 'flight') set(c, bpx, bpy + 1, R.shadow);
    set(c, bpx, bpy, R.ball);
    if (tier.sx > 1) set(c, bpx + 1, bpy, R.ball);
  }
  return { x: sx, y: sy, w: bw, h: bh };
}

// Full-hole minimap in a top corner away from the golfer, drawn under the
// play layer so a sprite is never covered by it.
function drawMinimap(c, hole, h, m, R, tier, view, golferPx) {
  const kx = tier.sx;
  const cols = Math.floor(c.w / kx), picRows = Math.floor(c.h / tier.sy);
  const mmCols = clamp(Math.floor(cols / 6), 10, 22), mmRows = picRows >= 8 ? 3 : 2;
  const mw = mmCols * kx, mh = mmRows * tier.sy;
  const golferLeft = golferPx < c.w / 2;
  const x0 = golferLeft ? c.w - 2 * kx - mw : 2 * kx, y0 = 1;
  fillRect(c, x0, y0, mw, mh, R.frameBg);
  const box = bounds(hole);
  const padX = 2 * kx, padY = 2;
  const sX = Math.min((mw - 2 * padX) / (box.maxX - box.minX), (mh - 2 * padY) / (box.maxY - box.minY) * (kx / (tier.sy / 2)));
  const sY = sX * ((tier.sy / 2) / kx);
  const cx = x0 + mw / 2, cy = y0 + mh / 2;
  const mx = x => cx + (x - (box.minX + box.maxX) / 2) * sX;
  const my = y => cy + (y - (box.minY + box.maxY) / 2) * sY;
  const pts = hole.center;
  for (let i = 0; i < pts.length - 1; i++) {
    thickLine(c, mx(pts[i].x), my(pts[i].y), mx(pts[i + 1].x), my(pts[i + 1].y), Math.max(0.6, hole.fairwayHalf * sX), Math.max(0.6, hole.fairwayHalf * sY), R.fairway);
  }
  for (const w of hole.water) fillEllipse(c, mx(w.x), my(w.y), Math.max(0.5, w.rx * sX), Math.max(0.5, Math.min(w.ry, 20) * sY), R.water);
  for (const b of hole.bunkers) set(c, Math.round(mx(b.x)), Math.round(my(b.y)), R.sand);
  fillEllipse(c, mx(hole.green.x), my(hole.green.y), Math.max(0.8, hole.green.rx * sX), Math.max(0.8, hole.green.ry * sY), R.green);
  set(c, Math.round(mx(0)), Math.round(my(0)), R.tee);
  if (view) {
    const vx0 = Math.round(mx(view.minX)), vx1 = Math.round(mx(view.maxX)), vy0 = Math.round(my(view.minY)), vy1 = Math.round(my(view.maxY));
    for (let x = Math.max(x0, vx0); x <= Math.min(x0 + mw - 1, vx1); x++) { set(c, x, Math.max(y0, vy0), R.gray); set(c, x, Math.min(y0 + mh - 1, vy1), R.gray); }
    for (let y = Math.max(y0, vy0); y <= Math.min(y0 + mh - 1, vy1); y++) { set(c, Math.max(x0, vx0), y, R.gray); set(c, Math.min(x0 + mw - 1, vx1), y, R.gray); }
  }
  const ball = ballDisplay(h);
  set(c, Math.round(mx(ball.x)), Math.round(my(ball.y)), R.ball);
  set(c, Math.round(mx(hole.pin.x)), Math.round(my(hole.pin.y)), R.flag);
  for (let x = x0; x < x0 + mw; x++) { set(c, x, y0, R.frame); set(c, x, y0 + mh - 1, R.frame); }
  for (let y = y0; y < y0 + mh; y++) { set(c, x0, y, R.frame); set(c, x0 + mw - 1, y, R.frame); }
}

// --------------------------------------------------------------- views ----

export function chooseView(h, hole) {
  if (h.lie === 'tee' && h.strokes === 0) return 'hole';
  const d = dist(h.ball, hole.pin);
  if (h.phase === 'flight' && h.shots.length) {
    const s = h.shots[h.shots.length - 1];
    return (s.kind === 'putt' || s.kind === 'chip' || s.kind === 'pitch' || s.kind === 'sand') ? 'green' : 'hole';
  }
  if (h.phase === 'holed') return 'green';
  return d <= 42 && h.lie !== 'water' ? 'green' : 'hole';
}

// The next target: the pin when reachable, otherwise one full shot along the
// fairway from the ball.
function nextTarget(h, hole) {
  const dPin = dist(h.ball, hole.pin);
  const reach = (h.lie === 'tee' ? CLUBS[0].carry : h.lie === 'fairway' ? CLUBS[1].carry : CLUBS[3].carry) + 15;
  if (dPin <= reach) return hole.pin;
  const pr = projectS(hole, h.ball);
  return pointAt(hole, pr + Math.min(reach - 15, dPin), 0);
}
function projectS(hole, P) {
  // along-track position of P (yards), nearest segment
  let best = Infinity, s = 0, sBase = 0;
  const pts = hole.center;
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1];
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const t = clamp((P.x - A.x) * ux + (P.y - A.y) * uy, 0, len);
    const dd = Math.hypot(P.x - (A.x + ux * t), P.y - (A.y + uy * t));
    if (dd < best) { best = dd; s = sBase + t; }
    sBase += len;
  }
  return s;
}

// Camera for the hole view and the green view. Returns {m, win, info}.
function camera(view, h, hole, cols, picRows, gutter, tier) {
  const unitsW = Math.max(8, cols - 2 * gutter), unitsH = picRows * 2;
  const focus = ballDisplay(h);
  const box = bounds(hole);
  let target, needX, needY;
  if (view === 'green') {
    target = hole.pin;
    needX = (Math.abs(target.x - focus.x) + 2 * MARGIN_X) / unitsW;
    needY = (2 * hole.green.ry + 2 * GREEN_MARGIN) / unitsH;
  } else {
    target = nextTarget(h, hole);
    const hbMax = hole.fairwayHalf * (1 + hole.width.amp);
    needX = (Math.abs(target.x - focus.x) + 2 * MARGIN_X) / unitsW;
    needY = (2 * hbMax + 2 * ROUGH_MARGIN) / unitsH;
  }
  const u = clamp(Math.max(needX, needY), U_MIN, U_MAX);
  const viewW = unitsW * u, viewH = unitsH * u;
  // room for the golfer sprite at either end of the hole
  const bx0 = box.minX - 5 * u, bx1 = box.maxX + 5 * u;
  let camX = (focus.x + target.x) / 2;
  camX = bx1 - bx0 <= viewW ? (bx0 + bx1) / 2 : clamp(camX, bx0 + viewW / 2, bx1 - viewW / 2);
  // Vertical: the golfer (10 units / 5 rows, standing ~9 units above the ball)
  // always fits. Put the ball near the bottom so the sprite has its headroom,
  // but never demand more headroom than the view has. The pin is kept in view
  // only when there is slack; it never pushes the golfer off the top.
  const head = Math.min(9, unitsH - 2);           // units above the ball
  const ballUnit = clamp(unitsH - 2, head + 0.5, unitsH - 1);
  let camY = focus.y + (unitsH / 2 - ballUnit) * u;
  if (view === 'green') {
    const slackTop = (focus.y - head * u) - (camY - viewH / 2); // yards of room above the sprite
    if (slackTop > 0 && hole.pin.y < camY - viewH / 2 + GREEN_MARGIN) camY = Math.max(camY - slackTop, hole.pin.y - GREEN_MARGIN + viewH / 2);
  } else if (box.maxY - box.minY > viewH) camY = clamp(camY, box.minY + viewH / 2, box.maxY - viewH / 2);
  const m = windowMap(tier, camX - viewW / 2, camY - viewH / 2, u, gutter);
  const win = { minX: camX - viewW / 2, maxX: camX + viewW / 2, minY: camY - viewH / 2, maxY: camY + viewH / 2 };
  const greenUnits = (2 * hole.green.ry) / u;
  const info = `u=${u.toFixed(2)}y/col view=${view} golfer=${SPRITE_UNITS}u/${(SPRITE_UNITS * u).toFixed(0)}y green=${greenUnits.toFixed(1)}u/${(2 * hole.green.ry).toFixed(0)}y cam=(${camX.toFixed(0)},${camY.toFixed(0)}) target=(${target.x.toFixed(0)},${target.y.toFixed(0)}) win=${viewW.toFixed(0)}x${viewH.toFixed(0)}y`;
  return { m, win, info, u, greenUnits };
}

function renderWorking(ctx) {
  const { st, hole, cad, cols, rows, now, sid, tier } = ctx;
  const R = ctx.R;
  const sprites = spriteSet(tier);
  const h = st.hole;
  // Row budget, top to bottom: frame top (title) + picture + frame bottom +
  // scorecard (3 rows) + status chips. Each block has its own rows; nothing
  // overlaps. Below nine rows the frame is dropped; below twelve, the card.
  const framed = rows >= 9;
  // The scorecard/leaderboard costs three rows; only take them once the
  // picture can still give the 5-row golfer headroom (>= 7 rows left) and the
  // terminal is wide enough for the card to be legible.
  const cardRows = rows >= 13 && cols >= 64 ? 3 : 0;
  const picRows = rows - 1 - cardRows - (framed ? 2 : 0);
  const gutter = framed ? 1 : 0;
  const W = cols * tier.sx, H = picRows * tier.sy;
  const c = makeCanvas(W, H, R.rough);
  const view = chooseView(h, hole);
  const cam = camera(view, h, hole, cols, picRows, gutter, tier);
  const dbg = {};
  // Responsive drop ladder (widest to narrowest): the hole view always draws;
  // then, as width shrinks, elements drop in reverse priority order —
  // commentary (cols<120, handled in statusRow) -> minimap (cols<90) ->
  // scorecard (cols<64 or rows<13) -> status chips stay -> compact single line
  // (cols<40, in renderScene). This keeps every line under Claude Code's
  // cli-truncate container (one overflowing line drops all lines after it;
  // docs/PRIOR-ART.md finding 3), so nothing ever clips or wraps.
  drawGround(c, hole, cam.m, R, ctx.seedInt);
  if (ctx.season) drawHoleProps(c, hole, cam.m, R, tier, cad, pointAt, ctx.season.data);
  if (cols >= 90 && picRows >= 5) {
    const g = golferWorld(h);
    drawMinimap(c, hole, h, cam.m, R, tier, cam.win, cam.m.px(g.x));
  }
  const box = drawPlay(c, h, hole, cam.m, cad, now, tier, R, sprites, dbg, ctx.season);
  // Other golfers (subagents) sharing the hole: a coloured ball + initial.
  if (ctx.agents) drawAgents(c, st, cam.m, R, tier);
  if (ctx.season && ctx.season.data.props && ctx.season.data.props.birds) drawBirds(c, now, ctx.seedInt, R, tier, ctx.season.data.props.birds);
  if (ctx.season) drawTufts(c, now, ctx.seedInt, R, tier);
  if (ctx.weather) drawWeather(c, ctx.weather, now, R, tier, hole.wind.dir);
  if (framed) for (let r = 0; r < picRows; r++) { label(c, 0, r, '│', R.frame, R.frameBg); label(c, cols - 1, r, '│', R.frame, R.frameBg); }

  const pre = [], textRows = [];
  const toPar = ctx.toPar, thru = ctx.thru;
  const cur = h.shots[h.shots.length - 1];
  const ev = h.phase === 'tee' ? 'tee' : cur ? (cur.holed ? 'holed' : cur.lie === 'green' ? 'green' : cur.lie) : 'tee';
  if (framed) {
    const title = ` H${String(hole.no).padStart(2, '0')} ${hole.name} · par ${hole.par} · ${hole.length}y `;
    const fill = Math.max(0, cols - 2 - 2 - title.length);
    pre.push([{ t: '┌─', fg: R.frame }, { t: title, fg: R.text }, { t: '─'.repeat(fill) + '─┐', fg: R.frame }]);
    textRows.push([{ t: '└' + '─'.repeat(cols - 2) + '┘', fg: R.frame }]);
  }
  // With subagents in play the scorecard rows become a live leaderboard; the
  // status chips carry a group remark instead of the solo caddie line.
  if (ctx.agents) {
    const board = leaderboard(st, { toPar, thru });
    if (cardRows) for (const row of leaderboardRows({ board, cols, R, rows: cardRows })) textRows.push(row);
    textRows.push(statusRow({ hole, h, cols, R, toPar, thru, cad, framed,
      quip: cols >= 110 ? groupRemark(st, sid, { toPar, thru }) : null }));
  } else {
    if (cardRows) for (const row of scorecard({ st, pars: coursePars(sid), cols, R })) textRows.push(row);
    textRows.push(statusRow({ hole, h, cols, R, toPar, thru, cad, framed, quip: cols >= 120 ? quip(sid, hole.no, h.strokes, ev) : null }));
  }
  const spriteCells = `${Math.ceil(box.w / tier.sx)}x${Math.ceil(box.h / tier.sy)}cells`;
  if (ctx.debug) {
    const extra = dbg.spriteClamped ? ` sprite-clamped=${dbg.spriteClamped}` : '';
    textRows.push([{ t: `dbg ${cam.info} sprite=(${box.x},${box.y},${box.w}x${box.h}px,${spriteCells}) pic=${cols}x${picRows} tier=${tier.name}${extra}`, fg: R.textDim }]);
  }
  ctx.trace = cam.info + ' sprite=' + spriteCells;
  if (dbg.spriteClamped) ctx.violation = `sprite clamped ${dbg.spriteClamped} pic=${cols}x${picRows} ${cam.info}`;
  return { cols, pre, canvas: c, textRows };
}

export function renderScene(ctx) {
  if (ctx.cols < 40) {
    const h = ctx.st.hole;
    return { cols: ctx.cols, pre: [], canvas: null, textRows: [[{ t: `golf H${h.no} par ${h.par} ${ctx.toPar === 0 ? 'E' : ctx.toPar > 0 ? '+' + ctx.toPar : ctx.toPar} thru ${ctx.thru}`, fg: ctx.R.text }]] };
  }
  // Mid-hole idle (the shot settling, or the golfer standing at the ball)
  // keeps the full hole view; only between-holes idle collapses to the strip.
  const idlePhase = ctx.st.idle ? ctx.st.idle.phase : null;
  if (ctx.mode === 'WORKING' || idlePhase === 'settle' || idlePhase === 'stand') return renderWorking(ctx);
  return renderIdle(ctx, { gmap: golferMap(ctx.cad, ctx.R), cmap: caddieMap(ctx.cad, ctx.R) });
}
