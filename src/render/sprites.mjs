// Sprite tables. Each sprite is an array of equal-length strings; '.' is
// transparent and every other character is looked up in the colour map the
// caller passes to blit(), so one table serves any shirt/skin/bag colour.
//
// Legend: h head, s shirt, p pants, c club, b bag, C cart body, k black,
//         w white, r red, g gray, o brown, y yellow.

export const GOLFER = {
  address: [
    '..h..',
    '.sss.',
    '.sss.',
    '.p.p.',
    '.p.pc',
    '.....'],
  back: [
    '..h.c',
    '.sssc',
    '.sss.',
    '.p.p.',
    '.p.p.',
    '.....'],
  through: [
    'c.h..',
    'csss.',
    '.sss.',
    '.p.p.',
    '.p.p.',
    '.....'],
  walk1: [
    '..h..',
    '.sss.',
    '.sss.',
    '.p.p.',
    'p...p',
    '.....'],
  walk2: [
    '..h..',
    '.sss.',
    '.sss.',
    '..p..',
    '..p..',
    '.p.p.'],
  cheer: [
    'c.h.c',
    '.sss.',
    '.sss.',
    '.p.p.',
    '.p.p.',
    '.....'],
};
// Where the ball sits relative to the golfer sprite origin at address.
export const GOLFER_BALL = { x: 5, y: 4 };

export const CADDIE = {
  stand: [
    '.bh..',
    'bbss.',
    'bbss.',
    '.p.p.',
    '.p.p.',
    '.....'],
  walk1: [
    '.bh..',
    'bbss.',
    'bbss.',
    '.p.p.',
    'p...p',
    '.....'],
  walk2: [
    '.bh..',
    'bbss.',
    'bbss.',
    '..p..',
    '..p..',
    '.p.p.'],
};

export const CART = {
  roll1: [
    '.CCCCCCCC.',
    '.g.h..h..g',
    'CCCCCCCCCC',
    'CCCCCCCCCC',
    '.kk....kk.',
    '.gk....gk.'],
  roll2: [
    '.CCCCCCCC.',
    '.g.h..h..g',
    'CCCCCCCCCC',
    'CCCCCCCCCC',
    '.kk....kk.',
    '.kg....kg.'],
};

// Origin is the cup (bottom-left).
export const FLAG = [
  'wrr',
  'wr.',
  'k..'];

export const TREE_SIDE = [
  '.ttt.',
  'ttttt',
  'ttttt',
  '..o..',
  '..o..'];

export const CLOUD = ['www.ww', '.wwww.'];

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
