// Idle strip: three rows while the agent waits on the user. A side-view
// scene spans the full width (sky, treeline, turf), the golfer and caddie
// walk to the next tee with the treeline sliding behind them, and a fixed-
// width HUD block sits right-aligned over the scene.
//
// Figures are small enough to stand inside three rows: 5 subpixels tall on
// the half-block tier, 8 on the sextant tier. All motion is wall-clock
// driven through idle.pt (ms since the idle phase began).
import { makeCanvas, set, fillRect, label } from './raster.mjs';
import { blit, scaleSprite } from './sprites.mjs';
import { quip } from '../gen/course.mjs';
import { scoreName, toParText } from '../sim/golf.mjs';
import { clamp } from '../util/rng.mjs';

// Legend as in sprites.mjs: h head, s shirt, p pants, k shoes, b bag, c clubs,
// r roof, W cart body, w hub, t crown, T crown light, o trunk, m marker.
const MINI_HB = {
  golfer: {
    stand: ['.h..', '.ss.', 'sss.', '.pp.', '.pp.'],
    walk1: ['.h..', '.ss.', 'sss.', 'p.p.', 'p..p'],
    walk2: ['.h..', '.ss.', '.ss.', '.pp.', '.p..'],
    swing1: ['.h..', '.ss.', 'sss.', '.pp.', '.pp.'],
    swing2: ['.h.c', '.ss.', '.ss.', '.pp.', '.pp.'],
    cheer: ['sh.s', '.ss.', '.ss.', '.pp.', '.pp.'],
  },
  caddie: {
    stand: ['bc..', 'bh..', 'bss.', '.pp.', '.pp.'],
    walk1: ['bc..', 'bh..', 'bss.', 'p.p.', 'p..p'],
    walk2: ['bc..', 'bh..', 'bss.', '.pp.', '.p..'],
  },
  cart: {
    roll1: ['.rrrrrr.', '.rhh.hh.', 'WWWWWWWW', 'WWWWWWWW', '.k....k.'],
    roll2: ['.rrrrrr.', '.rhh.hh.', 'WWWWWWWW', 'WWWWWWWW', '.w....w.'],
  },
  tree: ['.ttttt.', 'tTtttTt', '.ttttt.', '...o...', '...o...'],
  marker: ['m', 'o'],
  height: 5, feet: 4,
};

const MINI_SX = {
  golfer: {
    stand: ['..hh..', '..hh..', '.ssss.', 'ssssss', '.ssss.', '.pppp.', '.pppp.', '.kk.kk'],
    walk1: ['..hh..', '..hh..', '.ssss.', 's.ss.s', '.ssss.', '.pppp.', 'pp..pp', 'kk..kk'],
    walk2: ['..hh..', '..hh..', '.ssss.', '.sssss', 'sssss.', '.pppp.', '..pp..', '.kkkk.'],
    swing1: ['..hh..', '..hh..', '.ssss.', 'ssssss', '.ssss.', '.pppp.', '.pppp.', '.kk.kk'],
    swing2: ['..hh.c', '..hh.c', '.sssss', '.ssss.', '.ssss.', '.pppp.', '.pppp.', '.kk.kk'],
    cheer: ['s.hh.s', 's.hh.s', '.ssss.', '.ssss.', '.ssss.', '.pppp.', '.pppp.', '.kk.kk'],
  },
  caddie: {
    stand: ['cc.c...', 'bb.hh..', 'bb.hh..', 'bbssss.', 'bbssss.', '.bpppp.', '..pppp.', '..kk.kk'],
    walk1: ['cc.c...', 'bb.hh..', 'bb.hh..', 'bbssss.', 'bbssss.', '.bpppp.', '.pp..pp', '.kk..kk'],
    walk2: ['.cc.c..', '.bb.hh.', '.bb.hh.', '.bbssss', '.bbssss', '..bpppp', '...pp..', '...kkk.'],
  },
  cart: {
    roll1: ['.rrrrrrrrrr.', '.r.hh..hh.r.', '.rsss..sss..', 'WWWWWWWWWWWW', 'WWWWWWWWWWWW', 'WWWWWWWWWWWW', '.kk......kk.', '.kw......kw.'],
    roll2: ['.rrrrrrrrrr.', '.r.hh..hh.r.', '.rsss..sss..', 'WWWWWWWWWWWW', 'WWWWWWWWWWWW', 'WWWWWWWWWWWW', '.kw......kw.', '.kk......kk.'],
  },
  tree: ['..tttttt..', '.tttTttttt.', 'ttTTTttttt', '.ttttttttt', '..tttttt..', '....oo....', '....oo....', '...oooo...'],
  marker: ['mm', 'mm', '.o'],
  height: 8, feet: 7,
};

export function miniSet(tier) {
  if (tier.name === 'sextant') return MINI_SX;
  if (tier.name === 'quadrant') {
    const wide = s => scaleSprite(s, 2, 1);
    const m = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, wide(v)]));
    return { golfer: m(MINI_HB.golfer), caddie: m(MINI_HB.caddie), cart: m(MINI_HB.cart), tree: wide(MINI_HB.tree), marker: wide(MINI_HB.marker), height: 5, feet: 4 };
  }
  return MINI_HB;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function renderIdle(ctx, maps) {
  const { st, hole, cad, cols, now, sid, tier } = ctx;
  const R = ctx.R;
  const { gmap, cmap } = maps;
  const rows = 3;
  const kx = tier.sx, ky = tier.sy / 2;
  const W = cols * kx, H = rows * tier.sy;
  const c = makeCanvas(W, H, R.sky);
  const S = miniSet(tier);
  const idle = st.idle || { phase: 'wait', pt: 0 };
  const t = idle.pt || 0;

  // HUD block on the right, fixed width, with a gutter.
  const hudW = Math.min(44, Math.max(24, Math.floor(cols * 0.42)));
  const sceneCols = cols - hudW - 2;
  const sceneW = sceneCols * kx;

  // Scene bands (subpixel rows): sky, treeline, turf, ground line.
  const bands = tier.name === 'sextant'
    ? { treeTop: 2, treeBot: 4, turfTop: 5, ground: 8 }
    : { treeTop: 1, treeBot: 2, turfTop: 3, ground: 5 };
  const groundY = bands.ground;      // the figures' shadow row
  const feetY = groundY - 1;         // the figures' feet row
  fillRect(c, 0, bands.turfTop, W, groundY - bands.turfTop, R.fairway);
  fillRect(c, 0, groundY, W, H - groundY, R.roughDark);

  // Walking traverse: the pair starts at the left and reaches the tee marker
  // on the right; the treeline slides at a third of their speed.
  const moving = idle.phase === 'walk';
  const cartMode = cad.transport === 'cart';
  const speed = (cartMode ? 14 : 6) * kx;            // subpixels per second
  const markerX = sceneW - 6 * kx;
  const startX = 2 * kx;
  const walkPx = moving ? Math.min(markerX - 10 * kx, startX + speed * t / 1000) : startX + 4 * kx;
  const arrived = moving && walkPx >= markerX - 10 * kx - 0.5;
  const parallax = moving ? Math.floor((walkPx - startX) / 3) : 0;

  // Treeline: a dark band with crowns poking above it.
  fillRect(c, 0, bands.treeTop, W, bands.turfTop - bands.treeTop, R.treeDark);
  const period = S.tree[0].length + 4 * kx;
  for (let k = -1; k < W / period + 2; k++) {
    const tx = k * period + ((k * 7) % 3) * kx - (parallax % period);
    const crown = S.tree;
    // crowns sit so the trunk lands on the turf line
    blit(c, crown, tx, bands.turfTop - crown.length + (tier.name === 'sextant' ? 3 : 2), { t: R.tree, T: R.treeLight, o: R.trunk });
  }
  // a lighter top edge on the treeline reads as the horizon
  for (let x = 0; x < W; x++) if (c.px[bands.treeTop * W + x] === R.treeDark) c.px[bands.treeTop * W + x] = R.tree;

  const frameNo = Math.floor(now / 450) % 2;
  const shadowUnder = (sprite, x) => { for (let i = 0; i < sprite[0].length; i++) { const col = sprite[sprite.length - 1][i]; if (col !== '.') set(c, x + i + 1, groundY, R.shadow); } };
  const stand = (sprite, x, map) => { const y = feetY - (sprite.length - 1); shadowUnder(sprite, x); blit(c, sprite, x, y, map); };

  if (idle.phase === 'holeout') {
    // Mini green: the ball rolls into the cup, then the golfer cheers.
    fillRect(c, 0, bands.turfTop, sceneW, groundY - bands.turfTop, R.green);
    const cupX = Math.floor(sceneW * 0.7), cupY = feetY;
    set(c, cupX, cupY, R.cup);
    for (let i = 1; i <= 3; i++) set(c, cupX, cupY - i, R.pole);
    set(c, cupX + 1, cupY - 3, R.flag); if (kx > 1) set(c, cupX + 2, cupY - 3, R.flag);
    const f = clamp(t / 2200, 0, 1);
    const bx = Math.round(8 * kx + (cupX - 8 * kx) * f);
    if (f < 1) set(c, bx, cupY, R.ball);
    for (let x = 8 * kx; x < bx; x += 2) set(c, x, cupY, R.ball);
    stand(f < 1 ? S.golfer.stand : S.golfer.cheer, 2 * kx, gmap);
  } else if (moving && cartMode && !arrived) {
    stand(frameNo ? S.cart.roll1 : S.cart.roll2, Math.round(walkPx), { r: R.cart, W: R.cart, h: gmap.h, s: gmap.s, k: R.outline, w: R.gray });
    stand(S.marker, markerX, { m: R.white, o: R.trunk });
  } else if (moving && !arrived) {
    stand(frameNo ? S.caddie.walk1 : S.caddie.walk2, Math.round(walkPx) - 6 * kx, cmap);
    stand(frameNo ? S.golfer.walk2 : S.golfer.walk1, Math.round(walkPx), gmap);
    stand(S.marker, markerX, { m: R.white, o: R.trunk });
  } else {
    // Waiting on the tee: caddie with the bag, golfer taking practice swings.
    const gx = markerX - 9 * kx;
    stand(S.caddie.stand, gx - 7 * kx, cmap);
    stand(Math.floor(now / 800) % 2 ? S.golfer.swing2 : S.golfer.swing1, gx, gmap);
    stand(S.marker, markerX, { m: R.white, o: R.trunk });
  }

  // HUD: three right-aligned lines with a fixed label column, over a dark block.
  const col0 = cols - hudW;
  const toPar = ctx.toPar;
  const L = (lab, text) => ({ lab: lab.padEnd(5), text });
  const lines = [];
  lines.push(L('hole', `${st.holeIdx + 1} of 18 · ${toParText(toPar)} thru ${ctx.thru} · round ${st.round}`));
  if (idle.phase === 'holeout' && st.last) {
    const over = st.last.strokes - st.last.par;
    lines.push(L('card', `${scoreName(st.last.par, st.last.strokes).toLowerCase()} ${st.last.strokes} on the par ${st.last.par} ${ordinal(st.last.no)}`));
    lines.push(L('says', `${cad.name}: ${quip(sid, st.last.no, st.last.strokes, over <= 0 ? 'holed' : over === 1 ? 'bogey' : 'bad')}`));
  } else if (idle.phase === 'round' && st.lastRound) {
    lines.push(L('round', `${st.lastRound.total} (${toParText(st.lastRound.toPar)}) for round ${st.lastRound.round}`));
    lines.push(L('says', `${cad.name}: ${quip(sid, 0, st.lastRound.total, 'walk')}`));
  } else if (moving && !arrived) {
    lines.push(L('next', `${ordinal(st.holeIdx + 1)} tee, ${cartMode ? 'riding with ' + cad.name : cad.name + ' on the bag'}`));
    lines.push(L('says', `${cad.name}: ${quip(sid, st.holeIdx, 0, cartMode ? 'cart' : 'walk')}`));
  } else {
    lines.push(L('tee', `${ordinal(st.holeIdx + 1)} · ${hole.name} · par ${hole.par} · ${hole.length}y`));
    lines.push(L('says', `${cad.name}: ${quip(sid, st.holeIdx + 1, 0, 'wait')}`));
  }
  const textW = hudW - 1;
  for (let i = 0; i < 3 && i < lines.length; i++) {
    const { lab, text } = lines[i];
    const room = textW - lab.length;
    const body = text.length > room ? text.slice(0, Math.max(0, room - 1)) + '…' : text.padEnd(room);
    label(c, col0, i, ' ' + lab, R.textDim, R.frameBg);
    label(c, col0 + 1 + lab.length, i, body, i === 0 ? R.text : R.textDim, R.frameBg);
  }
  return { cols, pre: [], canvas: c, textRows: [] };
}
