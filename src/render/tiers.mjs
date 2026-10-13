// Rendering tiers. A tier is how many subpixels one terminal cell carries
// and which Unicode block glyph draws each on/off pattern. The scene renders
// into a subpixel framebuffer; the cells backend quantizes every cell to two
// colours and the glyph whose pattern best matches.
//
//   halfblock  1x2  U+2580/U+2584/U+2588   Block Elements; in every terminal font
//   quadrant   2x2  U+2596..U+259F         Block Elements; common but NOT universal
//                                          (tested: Consolas has no quadrant pieces)
//   sextant    2x3  U+1FB00..U+1FB3B       Unicode 13 "Symbols for Legacy Computing";
//                                          only recent fonts (e.g. Cascadia Code
//                                          2404.23+, GNU Unifont) or terminals that
//                                          draw block glyphs themselves (Windows
//                                          Terminal, kitty, Ghostty). A font without
//                                          it renders every cell as a hollow "tofu"
//                                          box, so sextant is opt-in only — see
//                                          selectTier below and `--doctor`.
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

// Pick the tier. An explicit CCGOLF_GLYPHS (halfblock | quadrant | sextant)
// wins; anything else — "auto", empty or unrecognised — is halfblock.
//
// Why there is no auto-upgrade: a status line is a one-shot process whose stdout
// Claude Code recaptures and re-renders through Ink, so there is no TTY round
// trip and glyph coverage genuinely cannot be probed from in here (docs/PROBE.md).
// Quadrant, and especially sextant (U+1FB00..U+1FB3B, Unicode 13), are absent
// from most installed fonts — a font that cannot draw a cell renders it as a
// hollow "tofu" box, i.e. a whole status line of boxes. A safe default beats a
// pretty one, so we never auto-select a tier whose support we cannot verify.
// sextant/quadrant are opt-in: the user runs `node src/statusline.mjs --doctor`
// in their own terminal, sees which tiers actually render, and sets
// CCGOLF_GLYPHS accordingly. (Windows Terminal, kitty and Ghostty draw these
// glyphs themselves regardless of font, so sextant is safe there — but that is
// the user's call to make via --doctor, not a heuristic we guess from env.)
export function selectTier(env = process.env) {
  const want = String(env.CCGOLF_GLYPHS || env.GOLF_GLYPHS || '').toLowerCase();
  if (TIERS[want]) return TIERS[want];
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
