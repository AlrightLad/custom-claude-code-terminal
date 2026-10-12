// Scene composition: hole view, green view, idle strip and HUD text rows.
// Produces a backend-agnostic frame: a palette-index canvas (two pixel rows
// per text row), text overlays positioned in cells, and plain text rows.
import { makeCanvas, set, get, fillRect, fillEllipse, thickLine, label } from './raster.mjs';
import { GOLFER, GOLFER_BALL, CADDIE, CART, FLAG, TREE_SIDE, CLOUD, blit } from './sprites.mjs';
import { bounds, pointAt, quip } from '../gen/course.mjs';
import { ballDisplay, pointOnShot, scoreName, toParText, DUR } from '../sim/golf.mjs';
import { hash32, clamp, dist } from '../util/rng.mjs';

export const TRANSPARENT = 255;

const R = { sky: 0, outline: 0, cup: 0, tree: 1, rough: 2, fairway: 3, green: 4, fringe: 5, tee: 5, sand: 6,
  water: 7, waterLight: 8, white: 9, red: 10, skin: 11, yellow: 12, gray: 13, navy: 14, brown: 15 };

function windArrow(hole) {
  const a = hole.wind.dir; // 0 = toward +x (screen right)
  const oct = Math.round(a / (Math.PI / 4)) & 7;
  return ['->', 'v>', 'v', '<v', '<-', '<^', '^', '^>'][oct];
}

function clubName(k) { return k === 'PT' ? 'putter' : k; }

// ----------------------------------------------------------- hole layers --

// gutter: pixels kept free on the left/right so a sprite at the tee or the
// green is never clipped by the picture edge.
function makeMap(W, H, box, gutter = 0) {
  const inner = Math.max(8, W - 2 * gutter);
  const scale = Math.max((box.maxX - box.minX) / inner, (box.maxY - box.minY) / H, 0.5);
  const cw = (box.maxX - box.minX) / scale, ch = (box.maxY - box.minY) / scale;
  const offX = gutter + (inner - cw) / 2, offY = (H - ch) / 2;
  return {
    scale,
    px: x => (x - box.minX) / scale + offX,
    py: y => (y - box.minY) / scale + offY,
    r: v => v / scale,
  };
}

function drawCourse(c, hole, m, seed) {
  const W = c.w, H = c.h;
  fillRect(c, 0, 0, W, H, R.rough);
  // Border forest noise on the far edges so wide terminals do not show a flat slab.
  const seedInt = hash32(seed);
  const x0 = m.px(0), y0 = m.py(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wx = (x - x0) * m.scale, wy = (y - y0) * m.scale;
    if (Math.abs(wy) > hole.roughHalf + 30 || wx < -30 || wx > hole.chord + hole.green.rx + 40) {
      let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + seedInt) | 0;
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      if (((n ^ (n >>> 16)) >>> 0) % 100 < 55) c.px[y * W + x] = R.tree;
    }
  }
  for (const t of hole.trees) fillEllipse(c, m.px(t.x), m.py(t.y), Math.max(0.6, m.r(t.r)), Math.max(0.6, m.r(t.r)), R.tree);
  // Fairway band from just past the tee to the green.
  const pts = hole.center;
  const start = pointAt(hole, 10, 0);
  const segs = [start, ...pts.slice(1)];
  for (let i = 0; i < segs.length - 1; i++) {
    thickLine(c, m.px(segs[i].x), m.py(segs[i].y), m.px(segs[i + 1].x), m.py(segs[i + 1].y), Math.max(0.8, m.r(hole.fairwayHalf)), R.fairway);
  }
  const g = hole.green;
  fillEllipse(c, m.px(g.x), m.py(g.y), m.r(g.rx + 2.5), m.r(g.ry + 2.5), R.fringe);
  fillEllipse(c, m.px(g.x), m.py(g.y), m.r(g.rx), m.r(g.ry), R.green);
  // Tee box with two markers.
  const tw = Math.max(2, Math.round(m.r(9))), th = Math.max(1, Math.round(m.r(10)));
  fillRect(c, Math.round(m.px(0) - tw / 2), Math.round(m.py(0) - th / 2), tw, th, R.tee);
  set(c, Math.round(m.px(0)), Math.round(m.py(-4)), R.white);
  set(c, Math.round(m.px(0)), Math.round(m.py(4)), R.white);
  for (const b of hole.bunkers) fillEllipse(c, m.px(b.x), m.py(b.y), Math.max(0.7, m.r(b.rx)), Math.max(0.7, m.r(b.ry)), R.sand);
  for (const w of hole.water) {
    fillEllipse(c, m.px(w.x), m.py(w.y), Math.max(0.7, m.r(w.rx)), Math.max(0.7, m.r(w.ry)), R.water);
    // light edge along the top of the water
    const x0 = Math.max(0, Math.floor(m.px(w.x) - m.r(w.rx))), x1 = Math.min(W - 1, Math.ceil(m.px(w.x) + m.r(w.rx)));
    for (let x = x0; x <= x1; x++) {
      for (let y = Math.max(0, Math.floor(m.py(w.y) - m.r(w.ry)) - 1); y < H; y++) {
        if (get(c, x, y) === R.water) { if (get(c, x, y - 1) !== R.water) set(c, x, y, R.waterLight); break; }
      }
    }
  }
  for (const s of hole.stakes) set(c, Math.round(m.px(s.x)), Math.round(m.py(s.y)), R.white);
  // Tree outlines read as depth at this scale.
  if (m.r(5) >= 1.5) {
    for (const t of hole.trees) {
      const x = Math.round(m.px(t.x) + m.r(t.r) * 0.5), y = Math.round(m.py(t.y) + m.r(t.r) * 0.6);
      if (get(c, x, y) === R.tree) set(c, x, y, R.outline);
    }
  }
}

function drawTrace(c, shot, m, f, colFlight, colRoll) {
  const target = shot.splash || shot.land || shot.end;
  const len = Math.hypot(target.x - shot.from.x, target.y - shot.from.y);
  const steps = Math.max(2, Math.ceil(m.r(len) * 1.5));
  const upto = Math.floor(steps * f);
  for (let i = 0; i <= upto; i++) {
    const p = pointOnShot(shot, i / steps);
    if (i % 2 === 0 || m.r(len) < 12) set(c, Math.round(m.px(p.x)), Math.round(m.py(p.y)), colFlight);
  }
  if (f >= 1 && shot.land && !shot.splash) {
    const rl = Math.hypot(shot.end.x - shot.land.x, shot.end.y - shot.land.y);
    const rs = Math.max(1, Math.ceil(m.r(rl)));
    for (let i = 1; i <= rs; i++) {
      const t = i / rs;
      set(c, Math.round(m.px(shot.land.x + (shot.end.x - shot.land.x) * t)), Math.round(m.py(shot.land.y + (shot.end.y - shot.land.y) * t)), colRoll);
    }
  }
}

function golferFrame(h, now) {
  switch (h.phase) {
    case 'swing': return GOLFER.back;
    case 'flight': return GOLFER.through;
    case 'result': return h.pt < 900 ? GOLFER.through : GOLFER.address;
    case 'walk': return Math.floor(now / 500) % 2 ? GOLFER.walk1 : GOLFER.walk2;
    case 'holed': return GOLFER.cheer;
    default: return GOLFER.address;
  }
}

function golferMap(cad) {
  const g = cad.golfer;
  return { h: g.hat ? R.white : g.skin, s: g.shirt, p: g.pants, c: R.gray };
}

function drawPlay(c, h, hole, m, cad, now, sid) {
  const shots = h.shots;
  for (let i = 0; i < shots.length - 1; i++) drawTrace(c, shots[i], m, 1, R.gray, R.gray);
  const cur = shots[shots.length - 1];
  const ball = ballDisplay(h);
  if (cur && (h.phase === 'flight' || h.phase === 'result' || h.phase === 'walk' || h.phase === 'holed' || h.phase === 'address' || h.phase === 'swing')) {
    const f = h.phase === 'flight' ? clamp(h.pt / (cur.dur || 1), 0, 1) : 1;
    drawTrace(c, cur, m, f, R.yellow, R.white);
  }
  // Flag with the cup at the pin.
  const fx = Math.round(m.px(hole.pin.x)), fy = Math.round(m.py(hole.pin.y));
  blit(c, FLAG, fx, fy - 2, { w: R.white, r: R.red, k: R.cup });
  // Golfer position: at the ball, walking toward it, or cheering by the hole.
  let gx, gy;
  if (h.phase === 'walk' && cur) {
    const t = clamp(h.pt / DUR.walk, 0, 1);
    gx = cur.from.x + (cur.end.x - cur.from.x) * t; gy = cur.from.y + (cur.end.y - cur.from.y) * t;
  } else if (h.phase === 'flight' && cur) { gx = cur.from.x; gy = cur.from.y; }
  else { gx = h.ball.x; gy = h.ball.y; }
  const frame = golferFrame(h, now);
  // Face the pin; the club head stays on the ball either way.
  const faceLeft = hole.pin.x < gx - 2 && h.phase !== 'walk';
  const sx = faceLeft ? Math.round(m.px(gx)) + 1 : Math.round(m.px(gx)) - GOLFER_BALL.x;
  const sy = Math.round(m.py(gy)) - GOLFER_BALL.y;
  blit(c, frame, sx, sy, golferMap(cad), faceLeft);
  if (!(h.holed && h.phase === 'holed')) set(c, Math.round(m.px(ball.x)), Math.round(m.py(ball.y)), R.white);
  // Floating result label.
  if ((h.phase === 'result' || h.phase === 'holed') && cur) {
    const text = h.phase === 'holed' ? scoreName(hole.par, h.strokes) + (h.strokes === 1 ? '' : ' ' + h.strokes) : (cur.label || '');
    if (text) {
      const col = Math.round(m.px(ball.x)) + 2, row = Math.floor(m.py(ball.y) / 2);
      const fg = /IN!|BIRDIE|EAGLE|ACE|ALBATROSS|CHIP/.test(text) ? R.yellow : /WATER|OB|TREE|SLICE|HOOK|DOUBLE|TRIPLE|^\+/.test(text) ? R.red : R.white;
      const placeCol = col + text.length + 1 > c.w ? Math.max(0, Math.round(m.px(ball.x)) - text.length - 2) : col;
      label(c, placeCol, clamp(row, 0, c.h / 2 - 1), text, fg);
    }
  }
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

function renderWorking(ctx) {
  const { st, hole, cad, cols, rows, now, sid } = ctx;
  const h = st.hole;
  // The scorecard strip only earns its row once the picture has 8 rows of its own.
  const hudRows = rows >= 10 ? 2 : 1;
  const picRows = rows - hudRows;
  const W = cols, H = picRows * 2;
  const c = makeCanvas(W, H, R.rough);
  const view = chooseView(h, hole);
  let m;
  if (view === 'green') {
    // One yard per pixel, centred between ball and pin, zoomed out only when
    // they would not both fit with room for the golfer sprite around the ball.
    const ball = ballDisplay(h);
    const cx = (ball.x + hole.pin.x) / 2, cy = (ball.y + hole.pin.y) / 2 - 1.5;
    const need = Math.max(1, Math.abs(ball.x - hole.pin.x) / Math.max(8, W - 14), Math.abs(ball.y - hole.pin.y) / Math.max(4, H - 7));
    const scale = need;
    const halfW = W * scale / 2, halfH = H * scale / 2;
    m = makeMap(W, H, { minX: cx - halfW, maxX: cx + halfW, minY: cy - halfH, maxY: cy + halfH });
  } else {
    m = makeMap(W, H, bounds(hole), 7);
  }
  drawCourse(c, hole, m, sid + ':' + hole.no);
  drawPlay(c, h, hole, m, cad, now, sid);

  const textRows = [];
  const toPar = ctx.toPar, thru = ctx.thru;
  const cur = h.shots[h.shots.length - 1];
  const ball = h.ball;
  const dPin = Math.round(dist(ball, hole.pin));
  const distText = (h.lie === 'green' || (h.lie === 'fringe' && dPin < 12)) ? `${Math.round(dPin * 3)}ft` : `${dPin}y`;
  const clubText = h.phase === 'address' || h.phase === 'swing' ? (cur && h.phase !== 'address' ? '' : '') : '';
  const shotLabel = h.phase === 'tee' ? 'on the tee' : h.phase === 'holed' ? scoreName(hole.par, h.strokes).toLowerCase() + ` ${h.strokes}` : (h.phase === 'flight' || h.phase === 'result') && cur ? `${clubName(cur.club)} · ${cur.label ? cur.label.toLowerCase() : 'in play'}` : `${distText} to pin`;
  void clubText;
  const wind = hole.wind.speed ? `wind ${hole.wind.speed} ${windArrow(hole)}` : 'calm';
  const strokeNo = h.strokes + (h.phase === 'flight' || h.phase === 'result' || h.phase === 'holed' ? 0 : 1);
  const hudA = cols >= 90 ? [
    { t: `H${hole.no} `, fg: R.yellow },
    { t: `${hole.name} · par ${hole.par} · ${hole.length}y `, fg: R.white },
    { t: `| ${shotLabel} `, fg: R.white },
    { t: `| stroke ${strokeNo} `, fg: R.gray },
    { t: `| ${wind} `, fg: R.waterLight },
    { t: `| ${toParText(toPar)} thru ${thru}`, fg: toPar < 0 ? R.yellow : toPar > 0 ? R.red : R.white },
  ] : [
    { t: `H${hole.no} `, fg: R.yellow },
    { t: `par ${hole.par} ${hole.length}y `, fg: R.white },
    { t: `| ${shotLabel} `, fg: R.white },
    { t: `| s${strokeNo} `, fg: R.gray },
    { t: `| ${wind.replace('wind ', 'w')} `, fg: R.waterLight },
    { t: `| ${toParText(toPar)} thru ${thru}`, fg: toPar < 0 ? R.yellow : toPar > 0 ? R.red : R.white },
  ];
  textRows.push(hudA);
  if (hudRows === 2) {
    const strip = [];
    for (let i = 0; i < 18; i++) {
      const sc = st.scores[i];
      const isCur = i === st.holeIdx;
      let t = sc ? String(sc.s) : '-';
      let fg = R.gray;
      if (sc) { const d = sc.s - sc.par; fg = d < 0 ? R.yellow : d === 0 ? R.white : d === 1 ? R.gray : R.red; }
      if (isCur) { t = String(h.strokes || '·'); fg = R.white; }
      strip.push({ t, fg, bg: isCur ? R.navy : -1 });
      strip.push({ t: i === 8 ? '  ' : ' ', fg: R.gray });
    }
    strip.push({ t: `| ${ctx.strokesTotal} (${toParText(toPar)}) `, fg: R.white });
    if (cols >= 110) {
      const ev = h.phase === 'tee' ? 'tee' : cur ? (cur.holed ? 'holed' : cur.lie === 'green' ? 'green' : cur.lie) : 'tee';
      strip.push({ t: `| ${cad.name}: ${quip(sid, hole.no, h.strokes, ev)}`, fg: R.gray });
    }
    textRows.push(strip);
  }
  return { cols, canvas: c, textRows };
}

function renderIdle(ctx) {
  const { st, hole, cad, cols, now, sid } = ctx;
  const rows = 3;
  const W = cols, H = rows * 2;
  const c = makeCanvas(W, H, TRANSPARENT);
  const sceneW = Math.min(44, Math.floor(W * 0.5));
  const idle = st.idle || { phase: 'wait', pt: 0 };
  const walkFrame = Math.floor(now / 500) % 2;
  if (idle.phase === 'holeout') {
    // Mini green: the ball rolls into the cup.
    fillRect(c, 0, 0, sceneW, H, R.green);
    fillRect(c, 0, 0, sceneW, 1, R.fringe);
    const cupX = Math.floor(sceneW * 0.75), cupY = 4;
    blit(c, FLAG, cupX, cupY - 2, { w: R.white, r: R.red, k: R.cup });
    const t = clamp(idle.pt / 2200, 0, 1);
    const bx = Math.round(6 + (cupX - 6) * t);
    if (t < 1) set(c, bx, cupY, R.white);
    for (let x = 6; x < bx; x += 2) set(c, x, cupY, R.white);
    blit(c, t < 1 ? GOLFER.address : GOLFER.cheer, 1, cupY - 4, golferMap(cad));
  } else {
    // Side-view strip: ground, scrolling trees and clouds, then the party.
    fillRect(c, 0, 4, sceneW, 1, R.fairway);
    fillRect(c, 0, 5, sceneW, 1, R.rough);
    const moving = idle.phase === 'walk';
    const scroll = moving ? Math.floor(now / 400) : 0;
    const cloudScroll = moving ? Math.floor(now / 900) : 0;
    const period = 23;
    for (let k = -1; k < sceneW / period + 2; k++) {
      const tx = k * period + 9 - (scroll % period);
      if (tx > -6 && tx < sceneW) blit(c, TREE_SIDE, tx, 0, { t: R.tree, o: R.brown });
      const cx2 = k * 31 + 4 - (cloudScroll % 31);
      if (cx2 > -7 && cx2 < sceneW) blit(c, CLOUD, cx2, 0, { w: R.gray });
    }
    if (cad.transport === 'cart' && moving) {
      blit(c, walkFrame ? CART.roll1 : CART.roll2, 4, 0, { C: cad.cart, g: R.gray, h: cad.golfer.hat ? R.white : cad.golfer.skin, k: R.outline });
    } else if (moving) {
      blit(c, walkFrame ? CADDIE.walk1 : CADDIE.walk2, 2, 0, { b: cad.bag, h: cad.hat ? R.white : cad.skin, s: cad.shirt, p: R.navy });
      blit(c, walkFrame ? GOLFER.walk2 : GOLFER.walk1, 11, 0, golferMap(cad));
    } else {
      // waiting on the tee: practice swings beside the markers
      set(c, 18, 4, R.white); set(c, 22, 4, R.white);
      blit(c, CADDIE.stand, 2, 0, { b: cad.bag, h: cad.hat ? R.white : cad.skin, s: cad.shirt, p: R.navy });
      const f = [GOLFER.address, GOLFER.back, GOLFER.through][Math.floor(now / 700) % 3];
      blit(c, f, 11, 0, golferMap(cad));
    }
    if (idle.phase === 'wait' || idle.phase === 'walk') { c.px[4 * W + sceneW - 1] = R.fairway; }
  }
  // Mask anything the scene drew past its width.
  for (let y = 0; y < H; y++) for (let x = sceneW; x < W; x++) c.px[y * W + x] = TRANSPARENT;

  const col = sceneW + 2;
  const room = Math.max(0, W - col);
  const fit = s => (s.length > room ? s.slice(0, Math.max(0, room - 1)) + '…' : s);
  const h = st.hole;
  const toPar = ctx.toPar;
  const line1 = `Hole ${st.holeIdx + 1} of 18 · ${toParText(toPar)} thru ${ctx.thru} · round ${st.round}`;
  let line2, line3;
  if (idle.phase === 'holeout' && st.last) {
    line2 = `${scoreName(st.last.par, st.last.strokes)} ${st.last.strokes} on the par ${st.last.par} ${ordinal(st.last.no)}`;
    line3 = `${cad.name}: ${quip(sid, st.last.no, st.last.strokes, st.last.strokes <= st.last.par ? 'holed' : 'lip')}`;
  } else if (idle.phase === 'round' && st.lastRound) {
    line2 = `Round ${st.lastRound.round} complete: ${st.lastRound.total} (${toParText(st.lastRound.toPar)})`;
    line3 = `${cad.name}: ${quip(sid, 0, st.lastRound.total, 'walk')}`;
  } else if (idle.phase === 'walk') {
    line2 = cad.transport === 'cart' ? `riding to the ${ordinal(st.holeIdx + 1)} tee with ${cad.name}` : `walking to the ${ordinal(st.holeIdx + 1)} tee, ${cad.name} on the bag`;
    line3 = st.last ? `last: ${scoreName(st.last.par, st.last.strokes).toLowerCase()} on ${st.last.no} · ${cad.name}: ${quip(sid, st.holeIdx, 0, cad.transport === 'cart' ? 'cart' : 'walk')}` : `${cad.name}: ${quip(sid, st.holeIdx, 0, 'walk')}`;
  } else {
    line2 = `waiting on the ${ordinal(st.holeIdx + 1)} tee · ${hole.name} · par ${hole.par} · ${hole.length}y`;
    line3 = `${cad.name}: ${quip(sid, st.holeIdx + 1, 0, 'wait')}`;
  }
  void h;
  if (room > 8) {
    label(c, col, 0, fit(line1), R.white);
    label(c, col, 1, fit(line2), R.gray);
    label(c, col, 2, fit(line3), R.gray);
  }
  return { cols, canvas: c, textRows: [] };
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function renderScene(ctx) {
  if (ctx.cols < 40) {
    const h = ctx.st.hole;
    return { cols: ctx.cols, canvas: null, textRows: [[{ t: `golf H${h.no} par ${h.par} ${toParText(ctx.toPar)} thru ${ctx.thru}`, fg: R.white }]] };
  }
  return ctx.mode === 'WORKING' ? renderWorking(ctx) : renderIdle(ctx);
}
