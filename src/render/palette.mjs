// Palette loading and SGR colour emission. Backend-agnostic: the rasterizer
// only ever stores palette indices; this module turns an index into the
// escape fragment a text backend needs (24-bit by default, 256-colour on
// request), keeps the role names the scene code draws with, and precomputes
// the perceptual distance table the cell quantizer uses.
import fs from 'node:fs';

const PALETTE_DIR = new URL('../../assets/palettes/', import.meta.url);

export function loadPalette(name = 'augusta') {
  const safe = String(name).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'augusta';
  let p;
  try { p = JSON.parse(fs.readFileSync(new URL(safe + '.json', PALETTE_DIR), 'utf8')); }
  catch { p = JSON.parse(fs.readFileSync(new URL('augusta.json', PALETTE_DIR), 'utf8')); }
  const rgb = p.colors.map(c => {
    const n = parseInt(c.hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  const names = {};
  p.colors.forEach((c, i) => { names[c.name] = i; });
  // roles may name colours by index or by colour name; list roles (shirts,
  // pants, bags) resolve each entry.
  const roles = {};
  const resolve = v => (typeof v === 'number' ? v : names[v]);
  for (const [k, v] of Object.entries(p.roles)) roles[k] = Array.isArray(v) ? v.map(resolve) : resolve(v);
  return { name: p.name, rgb, roles, names, ansi256: rgb.map(toAnsi256), frame: p.frame || {}, _lab: null, _D: null };
}

export function toAnsi256([r, g, b]) {
  if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round((r - 8) / 247 * 23);
  }
  const q = v => Math.round(v / 255 * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

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

function srgbToLab([r8, g8, b8]) {
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const r = lin(r8), g = lin(g8), b = lin(b8);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// Relative luminance 0..1 (for the greyscale check).
export function luminance([r, g, b]) {
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Flat 256x256 table of CIE76 distances between palette entries, computed
// once per process. Indices beyond the palette are never looked up.
export function labDistances(palette) {
  if (palette._D) return palette._D;
  const lab = palette.rgb.map(srgbToLab);
  const n = lab.length;
  const D = new Float32Array(256 * 256);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const a = lab[i], b = lab[j];
    D[i * 256 + j] = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  palette._lab = lab;
  palette._D = D;
  return D;
}
