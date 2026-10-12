// Rasterizes a captured status line frame (ANSI rows at any glyph tier) into
// an RGB buffer. Shared by png.mjs and gif.mjs. Each cell becomes a
// cellW x (2*cellW) block split into the tier's subpixels; text cells use the
// 3x5 font from font.mjs.
import zlib from 'node:zlib';
import { TIERS, maskOf } from '../src/render/tiers.mjs';
import { FONT3x5 } from './font.mjs';

const ESC = String.fromCharCode(27);
const DEF_BG = [24, 24, 24], DEF_FG = [220, 220, 220];

function ansi256(n) {
  if (n < 16) return [[0,0,0],[205,0,0],[0,205,0],[205,205,0],[0,0,238],[205,0,205],[0,205,205],[229,229,229],[127,127,127],[255,0,0],[0,255,0],[255,255,0],[92,92,255],[255,0,255],[0,255,255],[255,255,255]][n];
  if (n >= 232) { const v = 8 + (n - 232) * 10; return [v, v, v]; }
  const i = n - 16; const r = Math.floor(i / 36), g = Math.floor((i % 36) / 6), b = i % 6;
  const f = v => v === 0 ? 0 : 55 + v * 40;
  return [f(r), f(g), f(b)];
}

export function parseRow(row) {
  const cells = [];
  let fg = null, bg = null;
  for (let i = 0; i < row.length;) {
    const ch = row[i];
    if (ch === ESC && row[i + 1] === '[') {
      let j = i + 2; let params = '';
      while (j < row.length && row[j] !== 'm') params += row[j++];
      i = j + 1;
      const p = params.split(';').map(Number);
      for (let k = 0; k < p.length; k++) {
        const v = p[k];
        if (v === 0) { fg = null; bg = null; }
        else if (v === 39) fg = null;
        else if (v === 49) bg = null;
        else if ((v === 38 || v === 48) && p[k + 1] === 2) { const c = [p[k + 2], p[k + 3], p[k + 4]]; if (v === 38) fg = c; else bg = c; k += 4; }
        else if ((v === 38 || v === 48) && p[k + 1] === 5) { const c = ansi256(p[k + 2]); if (v === 38) fg = c; else bg = c; k += 2; }
      }
      continue;
    }
    const cp = row.codePointAt(i);
    const chr = String.fromCodePoint(cp);
    cells.push({ ch: chr, fg, bg });
    i += chr.length;
  }
  return cells;
}

function pattern(ch) {
  if (ch === ' ') return { sx: 1, sy: 1, mask: 0 };
  for (const name of ['sextant', 'quadrant', 'halfblock']) {
    const t = TIERS[name];
    const m = maskOf(t, ch);
    if (m >= 0) return { sx: t.sx, sy: t.sy, mask: m };
  }
  return null;
}

// text: the frame's rows (with escapes). Returns {w, h, rgb, cols, rows}.
export function rasterize(text, { cellW = 12, grey = false, cols: forceCols = 0 } = {}) {
  const rows = text.replace(/\r/g, '').split('\n').filter((r, i, a) => !(i === a.length - 1 && r === ''));
  const parsed = rows.map(parseRow);
  const W = forceCols || Math.max(...parsed.map(r => r.length), 1);
  const H = parsed.length;
  const CELL_W = cellW, CELL_H = cellW * 2;
  const pw = W * CELL_W, ph = H * CELL_H;
  const rgb = Buffer.alloc(pw * ph * 3);
  const put = (x, y, c) => {
    const o = (y * pw + x) * 3;
    if (grey) { const l = Math.round(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]); rgb[o] = l; rgb[o + 1] = l; rgb[o + 2] = l; }
    else { rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2]; }
  };
  for (let r = 0; r < H; r++) {
    const cells = parsed[r];
    for (let x = 0; x < W; x++) {
      const cell = cells[x] || { ch: ' ', fg: null, bg: null };
      const fg = cell.fg || DEF_FG, bg = cell.bg || DEF_BG;
      const pat = pattern(cell.ch);
      const ox = x * CELL_W, oy = r * CELL_H;
      if (pat) {
        const bw = CELL_W / pat.sx, bh = CELL_H / pat.sy;
        for (let dy = 0; dy < CELL_H; dy++) for (let dx = 0; dx < CELL_W; dx++) {
          const bit = Math.floor(dy / bh) * pat.sx + Math.floor(dx / bw);
          put(ox + dx, oy + dy, (pat.mask >> bit) & 1 ? fg : bg);
        }
      } else {
        const glyph = FONT3x5[cell.ch] || FONT3x5[cell.ch.toUpperCase()] || FONT3x5['?'];
        const gw = CELL_W / 5, gh = CELL_H / 7;
        for (let dy = 0; dy < CELL_H; dy++) for (let dx = 0; dx < CELL_W; dx++) {
          const gx = Math.floor(dx / gw) - 1, gy = Math.floor(dy / gh) - 1;
          const on = gx >= 0 && gx < 3 && gy >= 0 && gy < 5 && ((glyph[gy] >> (2 - gx)) & 1);
          put(ox + dx, oy + dy, on ? fg : bg);
        }
      }
    }
  }
  return { w: pw, h: ph, rgb, cols: W, rows: H };
}

// Minimal PNG encoder for an RGB buffer.
export function encodePng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
