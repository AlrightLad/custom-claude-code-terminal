// Rendering tiers. A tier is how many subpixels one terminal cell carries
// and which Unicode block glyph draws each on/off pattern. The scene renders
// into a subpixel framebuffer; the cells backend quantizes every cell to two
// colours and the glyph whose pattern best matches.
//
//   halfblock  1x2  U+2580/U+2584          every terminal font
//   quadrant   2x2  U+2596..U+259F         nearly every font
//   sextant    2x3  U+1FB00..U+1FB3B       Unicode 13 "Symbols for Legacy
//                                          Computing"; Windows Terminal draws
//                                          them itself, many fonts do not have them
//
// Bit order in a pattern mask: subpixel (x, y) is bit (y * sx + x), so the
// top-left is bit 0 and bits increase left-to-right then top-to-bottom. That
// matches the Unicode sextant numbering (sextant-1 is upper-left, -2 upper-
// right, -3 middle-left ...), which is what makes the code point arithmetic
// below a straight offset.

const FULL = '█';

function quadrantGlyph(m) {
  // bit0 TL, bit1 TR, bit2 BL, bit3 BR
  return [' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛',
    '▗', '▚', '▐', '▜', '▄', '▙', '▟', FULL][m];
}

function sextantGlyph(m) {
  if (m === 0) return ' ';
  if (m === 63) return FULL;
  if (m === 21) return '▌'; // left column: not in the sextant block
  if (m === 42) return '▐'; // right column
  return String.fromCodePoint(0x1fb00 + m - 1 - (m > 21 ? 1 : 0) - (m > 42 ? 1 : 0));
}

function halfblockGlyph(m) {
  return [' ', '▀', '▄', FULL][m];
}

function build(name, sx, sy, glyphOf) {
  const n = sx * sy;
  const glyphs = new Array(1 << n);
  for (let m = 0; m < glyphs.length; m++) glyphs[m] = glyphOf(m);
  // Pixel aspect in a 1:2 cell: width of one subpixel relative to its height.
  const aspect = (1 / sx) / (2 / sy);
  return { name, sx, sy, n, glyphs, full: (1 << n) - 1, aspect };
}

export const TIERS = {
  halfblock: build('halfblock', 1, 2, halfblockGlyph),
  quadrant: build('quadrant', 2, 2, quadrantGlyph),
  sextant: build('sextant', 2, 3, sextantGlyph),
};

export const TIER_ORDER = ['halfblock', 'quadrant', 'sextant'];

// Pick the tier. CCGOLF_GLYPHS wins; otherwise a conservative guess from the
// environment: Windows Terminal rasterizes the legacy-computing block itself
// (1.22+), so sextants are safe there; everywhere else half blocks are the
// only glyphs every font is known to carry. Users with a capable font set
// CCGOLF_GLYPHS=sextant after running harness/glyphs.sh.
export function selectTier(env = process.env) {
  const want = String(env.CCGOLF_GLYPHS || env.GOLF_GLYPHS || '').toLowerCase();
  if (TIERS[want]) return TIERS[want];
  if (want === 'auto' || want === '') {
    if (env.WT_SESSION) return TIERS.sextant;
    return TIERS.halfblock;
  }
  return TIERS.halfblock;
}

// Decode a glyph back to its mask (used by the harness to rasterize frames).
export function maskOf(tier, ch) {
  if (!tier._rev) {
    tier._rev = new Map();
    for (let m = 0; m < tier.glyphs.length; m++) tier._rev.set(tier.glyphs[m], m);
  }
  const m = tier._rev.get(ch);
  return m === undefined ? -1 : m;
}
