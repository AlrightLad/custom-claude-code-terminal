// Sprite tables, one set per glyph tier so every pose was drawn at the
// resolution it is shown at. '.' is transparent; every other character is
// looked up in the colour map the caller passes to blit().
//
// Legend: h hat/head, f face, s shirt, p pants, k shoes, c club shaft,
//         C club head, b bag, B bag strap, r cart roof, W cart body,
//         w wheel hub, t crown, T crown highlight, o trunk, m tee marker.
//
// Sizes (w x h subpixels): golfer 8x15 sextant / 8x10 quadrant / 7x10 half
// block, which is 4 cells wide and 5 rows tall on every tier. Facing right.

const SX = {
  golfer: {
    address: [
      '...hhh..',
      '..hhhhh.',
      '..ffff..',
      '..ffff..',
      '...ff...',
      '.ssssss.',
      '.sssssss',
      '.ssss.ss',
      '.ssss..s',
      '.pppp..c',
      '.pppp..c',
      '.pp.pp.c',
      '.pp.pp.c',
      '.pp.pp.c',
      'kkk.kkkC'],
    back: [
      'C...hhh.',
      '.c..hhhh',
      '.c..ffff',
      '..c.ffff',
      '..c..ff.',
      '..ssssss',
      '.sssssss',
      '.ss.ssss',
      '.pppp...',
      '.pppp...',
      '.pppp...',
      '.pp.pp..',
      '.pp.pp..',
      '.pp.pp..',
      'kkk.kkk.'],
    impact: [
      '...hhh..',
      '..hhhhh.',
      '..ffff..',
      '..ffff..',
      '...ff...',
      '.ssssss.',
      'ssssssss',
      '..ssss.s',
      '..ssss.s',
      '..pppp.c',
      '..pppp.c',
      '.pp.ppc.',
      '.pp.ppc.',
      '.pp.pp.c',
      'kkk.kkkC'],
    through: [
      '...hhh.C',
      '..hhhhhc',
      '..ffff.c',
      '..ffffc.',
      '...ffc..',
      '.sssss..',
      'ssssss..',
      '.ssss...',
      '.ssss...',
      '.pppp...',
      '.pppp...',
      '.pp.pp..',
      '.pp.pp..',
      '.pp.pp..',
      'kkk.kkk.'],
    walk1: [
      '...hhh..',
      '..hhhhh.',
      '..ffff..',
      '..ffff..',
      '...ff...',
      '.ssssss.',
      's.ssss.s',
      's.ssss.s',
      '..ssss..',
      '..pppp..',
      '.pp.pp..',
      '.pp..pp.',
      'pp....pp',
      'pp....pp',
      'kk....kk'],
    walk2: [
      '...hhh..',
      '..hhhhh.',
      '..ffff..',
      '..ffff..',
      '...ff...',
      '.ssssss.',
      '.sssssss',
      'ssssss..',
      '..ssss..',
      '..pppp..',
      '..pppp..',
      '..pp.p..',
      '..pp.p..',
      '..pp.p..',
      '.kkk.kk.'],
    cheer: [
      's..hhh.s',
      's.hhhhhs',
      's.ffff.s',
      '.sffffs.',
      '.s.ff.s.',
      '.ssssss.',
      '.ssssss.',
      '..ssss..',
      '..ssss..',
      '..pppp..',
      '..pppp..',
      '.pp.pp..',
      '.pp.pp..',
      '.pp.pp..',
      'kkk.kkk.'],
    // Idle mid-hole: leaning on the club planted beside him, weight on one leg.
    lean: [
      '..hhh...',
      '.hhhhh..',
      '.ffff...',
      '.ffff...',
      '..ff....',
      '.ssssss.',
      'sssssss.',
      'ss.ssss.',
      '.s.sss.c',
      '.ppppp.c',
      '.pppp..c',
      '.pp.pp.c',
      '.pp.pp.c',
      '.pp..ppc',
      'kkk.kkkC'],
    // Idle: looking down the fairway, hand shading the eyes.
    look: [
      '..hhhss.',
      '.hhhhh..',
      '.ffff...',
      '.ffff...',
      '..ff....',
      '.ssssss.',
      'sssssss.',
      '.ssssss.',
      '..ssss.c',
      '..pppp.c',
      '..pppp.c',
      '.pp.pp.c',
      '.pp.pp.c',
      '.pp.pp.c',
      'kkk.kkkC'],
  },
  // Ball position relative to the sprite origin at address/impact.
  ball: { x: 8, y: 14 },
  caddie: {
    stand: [
      'cc.c......',
      '.ccc......',
      '.bb..hhh..',
      '.bb.hhhhh.',
      '.bb.ffff..',
      '.bb.ffff..',
      '.bb..ff...',
      '.bbssssss.',
      '.bbsssssss',
      '.bbssss..s',
      '.bb.pppp..',
      '..B.pppp..',
      '....pp.pp.',
      '....pp.pp.',
      '...kkk.kkk'],
    walk1: [
      'cc.c......',
      '.ccc......',
      '.bb..hhh..',
      '.bb.hhhhh.',
      '.bb.ffff..',
      '.bb.ffff..',
      '.bb..ff...',
      '.bbssssss.',
      '.bbsssssss',
      '.bbssss..s',
      '.bb.pppp..',
      '..B.pp.pp.',
      '...pp...pp',
      '...pp...pp',
      '...kk...kk'],
    walk2: [
      '.cc.c.....',
      '..ccc.....',
      '..bb.hhh..',
      '..bbhhhhh.',
      '..bbffff..',
      '..bbffff..',
      '..bb.ff...',
      '..bbsssss.',
      '..bbssssss',
      '..bbsss..s',
      '..bb.pppp.',
      '...B.pppp.',
      '.....pp.p.',
      '.....pp.p.',
      '....kkk.kk'],
  },
  cart: {
    roll1: [
      '..rrrrrrrrrrrr..',
      '..r..........r..',
      '..r.hhh..hhh.r..',
      '..r.fff..fff.r..',
      '..rsss..sss..r..',
      'WWWWWWWWWWWWWWW.',
      'WWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWW',
      '.WWWWWWWWWWWWWW.',
      '..kkk......kkk..',
      '..kwk......kwk..',
      '..kkk......kkk..'],
    roll2: [
      '..rrrrrrrrrrrr..',
      '..r..........r..',
      '..r.hhh..hhh.r..',
      '..r.fff..fff.r..',
      '..rsss..sss..r..',
      'WWWWWWWWWWWWWWW.',
      'WWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWW',
      '.WWWWWWWWWWWWWW.',
      '..kwk......kwk..',
      '..kkk......kkk..',
      '..kwk......kwk..'],
  },
  tree: [
    '...tttttt...',
    '.tttttttttt.',
    'ttttTttttttt',
    'tttTTTtttttt',
    '.tttttttttt.',
    '..tttttttt..',
    '.....oo.....',
    '.....oo.....',
    '.....oo.....',
    '....oooo....'],
  marker: ['mm', 'mm', '.o'],
};

const HB = {
  golfer: {
    address: [
      '..hh...',
      '..ff...',
      '.ssss..',
      'ssssss.',
      '.sssss.',
      '.pppp.c',
      '.pppp.c',
      '.p..p.c',
      '.p..p.c',
      'kk..kkC'],
    back: [
      'C.hh...',
      'c.ff...',
      '.cssss.',
      '.sssss.',
      '.ssss..',
      '.pppp..',
      '.pppp..',
      '.p..p..',
      '.p..p..',
      'kk..kk.'],
    impact: [
      '..hh...',
      '..ff...',
      '.ssss..',
      'ssssss.',
      '..sss.s',
      '.pppp.c',
      '.pppp.c',
      '.p..pc.',
      '.p..p.c',
      'kk..kkC'],
    through: [
      '..hh..C',
      '..ff.c.',
      '.ssssc.',
      '.sssss.',
      '.ssss..',
      '.pppp..',
      '.pppp..',
      '.p..p..',
      '.p..p..',
      'kk..kk.'],
    walk1: [
      '..hh...',
      '..ff...',
      '.ssss..',
      's.ss.s.',
      '.ssss..',
      '.pppp..',
      '.p..p..',
      'p....p.',
      'p....p.',
      'k....k.'],
    walk2: [
      '..hh...',
      '..ff...',
      '.ssss..',
      '.sssss.',
      '.ssss..',
      '.pppp..',
      '..pp...',
      '..pp...',
      '..p.p..',
      '.kk.kk.'],
    cheer: [
      's.hh.s.',
      's.ff.s.',
      '.ssss..',
      '.ssss..',
      '.ssss..',
      '.pppp..',
      '.pppp..',
      '.p..p..',
      '.p..p..',
      'kk..kk.'],
    lean: [
      '.hh....',
      '.ff....',
      '.ssss..',
      'sssss..',
      '.sss..c',
      '.pppp.c',
      '.pppp.c',
      '.p..p.c',
      '.p...pc',
      'kk..kkC'],
    look: [
      '.hhs...',
      '.ff....',
      '.ssss..',
      '.sssss.',
      '.ssss.c',
      '.pppp.c',
      '.pppp.c',
      '.p..p.c',
      '.p..p.c',
      'kk..kkC'],
  },
  ball: { x: 7, y: 9 },
  caddie: {
    stand: [
      'cc.c....',
      '.bb.hh..',
      '.bb.ff..',
      '.bbssss.',
      '.bbsssss',
      '.bb.ssss',
      '.bb.pppp',
      '..B.pppp',
      '....p..p',
      '...kk.kk'],
    walk1: [
      'cc.c....',
      '.bb.hh..',
      '.bb.ff..',
      '.bbssss.',
      '.bbsssss',
      '.bb.ssss',
      '.bb.pppp',
      '..B.p.p.',
      '...p...p',
      '..kk...k'],
    walk2: [
      '.cc.c...',
      '..bbhh..',
      '..bbff..',
      '..bbsss.',
      '..bbssss',
      '..bb.sss',
      '..bb.ppp',
      '...B.ppp',
      '.....pp.',
      '....kkk.'],
  },
  cart: {
    roll1: [
      '.rrrrrrrr.',
      '.r.hh.hh.r',
      '.rfff.fff.',
      'WWWWWWWWWW',
      'WWWWWWWWWW',
      '.kk.....kk',
      '.kw.....kw'],
    roll2: [
      '.rrrrrrrr.',
      '.r.hh.hh.r',
      '.rfff.fff.',
      'WWWWWWWWWW',
      'WWWWWWWWWW',
      '.kw.....kw',
      '.kk.....kk'],
  },
  tree: [
    '..ttt..',
    '.ttTtt.',
    'ttTTttt',
    '.ttttt.',
    '...oo..',
    '...oo..'],
  marker: ['m', 'o'],
};

// Quadrant: the sextant drawing with five rows removed (keeps head, hips
// and feet), so 8x10 subpixels.
const QUAD_ROWS = [0, 1, 3, 4, 6, 8, 10, 12, 13, 14];
function pickRows(sprite, rows) {
  return rows.filter(r => r < sprite.length).map(r => sprite[r]);
}
function mapSet(obj, fn) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = Array.isArray(v) ? fn(v) : v;
  return out;
}
const QD = {
  golfer: mapSet(SX.golfer, s => pickRows(s, QUAD_ROWS)),
  ball: { x: 8, y: 9 },
  caddie: mapSet(SX.caddie, s => pickRows(s, QUAD_ROWS)),
  cart: mapSet(SX.cart, s => pickRows(s, [0, 2, 3, 5, 6, 8, 9, 10])),
  tree: pickRows(SX.tree, [0, 1, 2, 4, 5, 6, 8]),
  marker: SX.marker,
};

export function spriteSet(tier) {
  return tier.name === 'sextant' ? SX : tier.name === 'quadrant' ? QD : HB;
}

// Nearest-neighbour rescale of a sprite by (fx, fy) for procedural uses.
const scaleCache = new Map();
export function scaleSprite(sprite, fx, fy) {
  if (fx === 1 && fy === 1) return sprite;
  const key = sprite.join('|') + '@' + fx + 'x' + fy;
  const hit = scaleCache.get(key);
  if (hit) return hit;
  const h = Math.round(sprite.length * fy), w = Math.round(sprite[0].length * fx);
  const out = [];
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sprite.length - 1, Math.floor(y / fy));
    let row = '';
    for (let x = 0; x < w; x++) row += sprite[sy][Math.min(sprite[0].length - 1, Math.floor(x / fx))];
    out.push(row);
  }
  scaleCache.set(key, out);
  return out;
}

// flip=true mirrors the sprite horizontally (a golfer facing left).
export function blit(canvas, sprite, x0, y0, map, flip = false) {
  for (let r = 0; r < sprite.length; r++) {
    const row = sprite[r];
    const y = y0 + r;
    if (y < 0 || y >= canvas.h) continue;
    for (let c = 0; c < row.length; c++) {
      const ch = row[flip ? row.length - 1 - c : c];
      if (ch === '.') continue;
      const v = map[ch];
      if (v === undefined) continue;
      const x = x0 + c;
      if (x < 0 || x >= canvas.w) continue;
      canvas.px[y * canvas.w + x] = v;
    }
  }
}

// One-cell drop shadow under a sprite: darkens the ground pixels along the
// sprite's bottom edge, offset one subpixel right and down.
export function shadow(canvas, sprite, x0, y0, color, flip = false) {
  const h = sprite.length;
  const bottom = sprite[h - 1];
  for (let c = 0; c < bottom.length; c++) {
    const ch = bottom[flip ? bottom.length - 1 - c : c];
    if (ch === '.') continue;
    const x = x0 + c + 1, y = y0 + h;
    if (x < 0 || x >= canvas.w || y < 0 || y >= canvas.h) continue;
    canvas.px[y * canvas.w + x] = color;
  }
}
