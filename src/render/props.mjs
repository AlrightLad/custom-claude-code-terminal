// Environment props and vehicles: golf cart, bench, ball washer, distance
// post, bunker rake, tee markers, birds. Drawn with one light direction
// (upper-left): 'H' pixels are the lit edge, 'd' pixels the shaded edge, and
// every object gets a one-cell contact shadow. '.' is transparent.
//
// Legend: C body, c body shade, r roof, g post, w windshield, s seat,
//         k wheel, h hub, b bag, B strap, x club head, o wood, O wood lit,
//         m marker, p post white, d dark edge, H highlight, t crown, T lit crown.
import { blit, shadow } from './sprites.mjs';
import { set } from './raster.mjs';

export const CART_SX = {
  roll1: [
    '.x.x.rrrrrrrrrrrr.',
    'xxx.HrrrrrrrrrrrrH',
    '.bb.g...........g.',
    '.bb.g....ss.....gw',
    '.bb.g...ssss....gw',
    '.bb.g...ssss....gw',
    '.bbHCCCCCCCCCCCCCC',
    '.bbCCCCCCCCCCCCCCC',
    '..CCCCCCCCCCCCCCcc',
    '..dcccccccccccccdd',
    '...kkk.......kkk..',
    '..kkhkk.....kkhkk.',
    '...kkk.......kkk..'],
  roll2: [
    '.x.x.rrrrrrrrrrrr.',
    'xxx.HrrrrrrrrrrrrH',
    '.bb.g...........g.',
    '.bb.g....ss.....gw',
    '.bb.g...ssss....gw',
    '.bb.g...ssss....gw',
    '.bbHCCCCCCCCCCCCCC',
    '.bbCCCCCCCCCCCCCCC',
    '..CCCCCCCCCCCCCCcc',
    '..dcccccccccccccdd',
    '...khk.......khk..',
    '..kkkkk.....kkkkk.',
    '...khk.......khk..'],
};

export const CART_HB = {
  roll1: [
    '.x.Hrrrrr.',
    '.bbg....gw',
    '.bbg.ss.gw',
    '.bbCCCCCCC',
    '..CCCCCCcc',
    '..dccccccd',
    '..kk...kk.',
    '..kh...kh.'],
  roll2: [
    '.x.Hrrrrr.',
    '.bbg....gw',
    '.bbg.ss.gw',
    '.bbCCCCCCC',
    '..CCCCCCcc',
    '..dccccccd',
    '..kh...kh.',
    '..kk...kk.'],
};

// Small props. Each is drawn standing on a ground row; the caller passes the
// bottom-left origin.
export const PROPS_SX = {
  bench: ['HOOOOOOd', '.o....o.', '.o....o.'],
  washer: ['Hpd', '.g.', '.g.', '.g.', 'dgd'],
  post: ['Hp', '.p', '.p', 'dg'],
  rake: ['xx.....', '.oooooo'],
  marker: ['Hm', 'mm', '.d'],
  bird1: ['k.k', '.k.'],
  bird2: ['.k.', 'k.k'],
  tuft: ['T.T', '.t.'],
};
export const PROPS_HB = {
  bench: ['HOOOd', '.o.o.'],
  washer: ['Hp', 'g.', 'dg'],
  post: ['p', 'p', 'd'],
  rake: ['x...', '.ooo'],
  marker: ['m', 'd'],
  bird1: ['k.k'],
  bird2: ['.k.'],
  tuft: ['T.T'],
};

export function propSet(tier) {
  return tier.name === 'halfblock' ? { cart: CART_HB, props: PROPS_HB } : { cart: CART_SX, props: PROPS_SX };
}

export function propMap(R, cad) {
  return {
    C: R.cart, c: R.cartShade ?? R.gray, r: R.cart, g: R.gray, w: R.waterLight, s: R.navy, k: R.outline, h: R.gray,
    b: cad ? R.bags[cad.bag % R.bags.length] : R.trunk, B: R.gray, x: R.gray, o: R.trunk, O: R.trunk, m: R.white,
    p: R.white, d: R.shadow, H: R.white, t: R.tree, T: R.treeLight,
  };
}

// Draws a prop standing on groundY (its bottom row lands on groundY - 1,
// shadow on groundY) at subpixel x. Returns nothing.
export function stand(c, sprite, x, groundY, map, R, flip = false) {
  const y = groundY - sprite.length;
  shadow(c, sprite, x, y, R.shadow, flip);
  blit(c, sprite, x, y, map, flip);
}

// World-placed props for the hole view: tee markers, bench and ball washer by
// the tee, a 150-yard post, a rake by every bunker, OB stakes. Everything is
// placed in yards and mapped through m (the one yards->subpixel conversion).
export function drawHoleProps(c, hole, m, R, tier, cad, pointAt, season) {
  const P = propSet(tier).props;
  const map = propMap(R, cad);
  const ky = tier.sy / 2;
  const inView = (x, y) => x > -8 && x < c.w + 8 && y > -8 && y < c.h + 8;
  // tee markers either side of the tee box
  for (const dy of [-4.5, 4.5]) {
    const px = Math.round(m.px(0)), py = Math.round(m.py(dy));
    if (inView(px, py)) stand(c, P.marker, px, py + 1, map, R);
  }
  // bench and ball washer behind the tee, on the right
  const bench = pointAt(hole, -9, 7), washer = pointAt(hole, -6, -7);
  if (season.props.benches !== false) { const bx = Math.round(m.px(bench.x)), by = Math.round(m.py(bench.y)); if (inView(bx, by)) stand(c, P.bench, bx, by + 1, map, R); }
  if (season.props.ballWasher !== false) { const wx = Math.round(m.px(washer.x)), wy = Math.round(m.py(washer.y)); if (inView(wx, wy)) stand(c, P.washer, wx, wy + 1, map, R); }
  // 150-yard post on the right edge of the fairway
  if (hole.length > 200) {
    const s = hole.length - 150;
    const hb = hole.fairwayHalf;
    const pp = pointAt(hole, s, hb + 4);
    const px = Math.round(m.px(pp.x)), py = Math.round(m.py(pp.y));
    if (inView(px, py)) stand(c, P.post, px, py + 1, map, R);
  }
  // a rake beside each bunker (lower right, in the light's shadow side)
  if (season.props.rakes !== false) for (const b of hole.bunkers) {
    const rx = Math.round(m.px(b.x + b.rx * 0.6)), ry = Math.round(m.py(b.y + b.ry + 1.5));
    if (inView(rx, ry)) stand(c, P.rake, rx, ry + 1, map, R);
  }
  void ky;
}

// Birds: an occasional pair of wing-beat frames crossing the top of the
// picture, deterministic from the clock so every frame agrees on where the
// bird is. Returns nothing.
export function drawBirds(c, now, seedInt, R, tier, rate = 0.4) {
  const period = 45000; // one possible crossing every 45 s
  const slot = Math.floor(now / period);
  const roll = ((Math.imul(slot, 2654435761) ^ seedInt) >>> 0) / 4294967296;
  if (roll > rate) return;
  const t = (now % period) / 12000; // crosses in 12 s
  if (t > 1) return;
  const P = propSet(tier).props;
  const sprite = Math.floor(now / 400) % 2 ? P.bird1 : P.bird2;
  const dir = (slot & 1) ? 1 : -1;
  const x = Math.round(dir > 0 ? t * (c.w + 6) - 3 : c.w + 3 - t * (c.w + 6));
  const y = 1 + Math.round((tier.sy / 2) * (1 + Math.sin(t * 9) * 0.5));
  blit(c, sprite, x, y, { k: R.outline });
}

// Grass tufts along the top and bottom picture edges, shifting every few
// seconds so the edges feel alive.
export function drawTufts(c, now, seedInt, R, tier) {
  const P = propSet(tier).props;
  const phase = Math.floor(now / 3000);
  const n = Math.max(2, Math.floor(c.w / (18 * tier.sx)));
  for (let i = 0; i < n; i++) {
    const h = ((Math.imul(i * 7919 + phase * 104729, 2654435761) ^ seedInt) >>> 0) / 4294967296;
    const x = Math.floor(((i + h) / n) * c.w);
    const top = i % 2 === 0;
    const y = top ? 0 : c.h - P.tuft.length;
    // only draw on rough so tufts never sit on the fairway or the green
    const under = c.px[(top ? P.tuft.length : c.h - 1) * c.w + Math.min(c.w - 1, x + 1)];
    if (under !== R.rough && under !== R.roughDark && under !== R.roughLight) continue;
    blit(c, P.tuft, x, y, { t: R.roughDark, T: R.roughLight });
  }
  void set;
}
