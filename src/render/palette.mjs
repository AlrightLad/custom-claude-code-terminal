// Palette loading and SGR colour emission. Backend-agnostic: the rasterizer
// only ever stores palette indices; this module turns an index into the
// escape fragment a text backend needs (24-bit by default, 256-colour on
// request) and keeps the role names the scene code draws with.
import fs from 'node:fs';

const PALETTE_URL = new URL('../../assets/palettes/nes16.json', import.meta.url);

export function loadPalette() {
  const p = JSON.parse(fs.readFileSync(PALETTE_URL, 'utf8'));
  const rgb = p.colors.map(c => {
    const n = parseInt(c.hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  return { name: p.name, rgb, roles: p.roles, ansi256: rgb.map(toAnsi256) };
}

export function toAnsi256([r, g, b]) {
  // Greys use the 24-step ramp when the channels are close; otherwise the 6x6x6 cube.
  if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round((r - 8) / 247 * 23);
  }
  const q = v => Math.round(v / 255 * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

// Returns {fg(i), bg(i)} producing SGR parameter strings (without ESC[ and m)
// for the requested colour depth. Precomputed per index so the hot loop is a
// table lookup.
export function sgrTables(palette, mode) {
  const n = palette.rgb.length;
  const fg = new Array(n), bg = new Array(n);
  for (let i = 0; i < n; i++) {
    if (mode === '256') {
      fg[i] = '38;5;' + palette.ansi256[i];
      bg[i] = '48;5;' + palette.ansi256[i];
    } else {
      const [r, g, b] = palette.rgb[i];
      fg[i] = `38;2;${r};${g};${b}`;
      bg[i] = `48;2;${r};${g};${b}`;
    }
  }
  return { fg, bg };
}
