#!/usr/bin/env node
// Renders a captured frame (ANSI half-block rows) to a PNG so the art can be
// reviewed outside a terminal. Zero dependencies: a minimal PNG encoder on
// top of node:zlib. Text cells are drawn as their background with a dark
// underline so label placement is visible; read the text itself from the
// frame file.
// usage: node harness/png.mjs <frame.txt> <out.png> [scale=6]
import fs from 'node:fs';
import zlib from 'node:zlib';

const [, , inFile, outFile, scaleArg] = process.argv;
if (!inFile || !outFile) { console.error('usage: node harness/png.mjs <frame.txt> <out.png> [scale]'); process.exit(1); }
const SCALE = Number(scaleArg) || 6;
const ESC = String.fromCharCode(27);
const UPPER = String.fromCharCode(0x2580), LOWER = String.fromCharCode(0x2584);

// Parse rows into cells: {ch, fg:[r,g,b]|null, bg:[r,g,b]|null}
function parseRow(row) {
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

function ansi256(n) {
  if (n < 16) return [[0,0,0],[205,0,0],[0,205,0],[205,205,0],[0,0,238],[205,0,205],[0,205,205],[229,229,229],[127,127,127],[255,0,0],[0,255,0],[255,255,0],[92,92,255],[255,0,255],[0,255,255],[255,255,255]][n];
  if (n >= 232) { const v = 8 + (n - 232) * 10; return [v, v, v]; }
  const i = n - 16; const r = Math.floor(i / 36), g = Math.floor((i % 36) / 6), b = i % 6;
  const f = v => v === 0 ? 0 : 55 + v * 40;
  return [f(r), f(g), f(b)];
}

const text = fs.readFileSync(inFile, 'utf8').replace(/\r/g, '');
const rows = text.split('\n').filter((r, i, a) => !(i === a.length - 1 && r === ''));
const parsed = rows.map(parseRow);
const W = Math.max(...parsed.map(r => r.length), 1);
const H = parsed.length;
const DEF_BG = [24, 24, 24], DEF_FG = [220, 220, 220];
const pw = W * SCALE, ph = H * SCALE * 2;
const img = Buffer.alloc(pw * ph * 3);
function put(x, y, c) { const o = (y * pw + x) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; }
for (let r = 0; r < H; r++) {
  const cells = parsed[r];
  for (let x = 0; x < W; x++) {
    const cell = cells[x] || { ch: ' ', fg: null, bg: null };
    const fg = cell.fg || DEF_FG, bg = cell.bg || DEF_BG;
    let top = bg, bot = bg, textCell = false;
    if (cell.ch === UPPER) { top = fg; bot = bg; }
    else if (cell.ch === LOWER) { top = bg; bot = fg; }
    else if (cell.ch !== ' ') { textCell = true; }
    for (let dy = 0; dy < SCALE * 2; dy++) for (let dx = 0; dx < SCALE; dx++) {
      let c = dy < SCALE ? top : bot;
      if (textCell) {
        // crude glyph: fg block with the background showing in a 1px frame
        const inner = dx > 0 && dx < SCALE - 1 && dy > 1 && dy < SCALE * 2 - 2;
        c = inner ? fg : bg;
      }
      put(x * SCALE + dx, r * SCALE * 2 + dy, c);
    }
  }
}

// PNG encode
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc((pw * 3 + 1) * ph);
for (let y = 0; y < ph; y++) { raw[y * (pw * 3 + 1)] = 0; img.copy(raw, y * (pw * 3 + 1) + 1, y * pw * 3, (y + 1) * pw * 3); }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(pw, 0); ihdr.writeUInt32BE(ph, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(outFile, png);
console.log(`${outFile}: ${W}x${H} cells -> ${pw}x${ph} px`);
