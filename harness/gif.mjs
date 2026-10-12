#!/usr/bin/env node
// Animated GIF from a directory of captured frames (0001.txt, 0002.txt ...),
// for the README demo. Zero dependencies: a GIF89a encoder with LZW on top of
// the shared frame rasterizer. Frames keep the palette's handful of colours,
// so a global colour table is exact.
// usage: node harness/gif.mjs <framesDir> <out.gif> [--fps 2] [--scale 6] [--cols N]
import fs from 'node:fs';
import path from 'node:path';
import { rasterize } from './raster-frame.mjs';

const args = process.argv.slice(2);
const dir = args[0], outFile = args[1];
if (!dir || !outFile) { console.error('usage: node harness/gif.mjs <framesDir> <out.gif> [--fps 2] [--scale 6] [--cols N]'); process.exit(1); }
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : dflt; };
const fps = opt('--fps', 2), cellW = opt('--scale', 6), forceCols = opt('--cols', 0);
const delay = Math.max(2, Math.round(100 / fps)); // hundredths of a second

const files = fs.readdirSync(dir).filter(f => /^\d+\.txt$/.test(f)).sort();
if (!files.length) { console.error('no NNNN.txt frames in ' + dir); process.exit(1); }
const frames = files.map(f => rasterize(fs.readFileSync(path.join(dir, f), 'utf8'), { cellW, cols: forceCols }));
const W = Math.max(...frames.map(f => f.w)), H = Math.max(...frames.map(f => f.h));

// Global colour table: every distinct colour across all frames (<= 256).
const table = new Map();
const key = (r, g, b) => (r << 16) | (g << 8) | b;
for (const f of frames) for (let i = 0; i < f.rgb.length; i += 3) {
  const k = key(f.rgb[i], f.rgb[i + 1], f.rgb[i + 2]);
  if (!table.has(k)) table.set(k, table.size);
}
if (table.size > 256) { console.error(`too many colours for one table: ${table.size}`); process.exit(1); }
let bits = 1; while ((1 << bits) < table.size) bits++;
if (bits < 2) bits = 2;
const palette = Buffer.alloc(3 * (1 << bits));
for (const [k, idx] of table) { palette[idx * 3] = k >> 16; palette[idx * 3 + 1] = (k >> 8) & 255; palette[idx * 3 + 2] = k & 255; }

function lzw(indices, minCode) {
  const clearCode = 1 << minCode, eoi = clearCode + 1;
  let codeSize = minCode + 1, next = eoi + 1;
  let dict = new Map();
  const out = []; let cur = 0, curBits = 0;
  const emit = code => { cur |= code << curBits; curBits += codeSize; while (curBits >= 8) { out.push(cur & 255); cur >>>= 8; curBits -= 8; } };
  const reset = () => { dict = new Map(); for (let i = 0; i < clearCode; i++) dict.set(String(i), i); next = eoi + 1; codeSize = minCode + 1; };
  reset(); emit(clearCode);
  let w = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i];
    const wc = w + ',' + c;
    if (dict.has(wc)) { w = wc; continue; }
    emit(dict.get(w));
    if (next < 4096) { dict.set(wc, next++); if (next - 1 === (1 << codeSize) && codeSize < 12) codeSize++; }
    else { emit(clearCode); reset(); }
    w = String(c);
  }
  emit(dict.get(w)); emit(eoi);
  if (curBits > 0) out.push(cur & 255);
  return Buffer.from(out);
}

const parts = [];
parts.push(Buffer.from('GIF89a', 'ascii'));
const lsd = Buffer.alloc(7); lsd.writeUInt16LE(W, 0); lsd.writeUInt16LE(H, 2); lsd[4] = 0x80 | (bits - 1); lsd[5] = 0; lsd[6] = 0;
parts.push(lsd, palette);
parts.push(Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'ascii'), 0x03, 0x01, 0x00, 0x00, 0x00])); // loop forever
for (const f of frames) {
  const gce = Buffer.from([0x21, 0xf9, 0x04, 0x00, delay & 255, delay >> 8, 0x00, 0x00]);
  const desc = Buffer.alloc(10); desc[0] = 0x2c; desc.writeUInt16LE(0, 1); desc.writeUInt16LE(0, 3); desc.writeUInt16LE(W, 5); desc.writeUInt16LE(H, 7); desc[9] = 0;
  const idx = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x < f.w && y < f.h) { const o = (y * f.w + x) * 3; idx[y * W + x] = table.get(key(f.rgb[o], f.rgb[o + 1], f.rgb[o + 2])); }
    else idx[y * W + x] = table.get(key(24, 24, 24)) ?? 0;
  }
  const minCode = Math.max(2, bits);
  const data = lzw(idx, minCode);
  const blocks = [Buffer.from([minCode])];
  for (let i = 0; i < data.length; i += 255) { const sub = data.subarray(i, Math.min(i + 255, data.length)); blocks.push(Buffer.from([sub.length]), sub); }
  blocks.push(Buffer.from([0]));
  parts.push(gce, desc, ...blocks);
}
parts.push(Buffer.from([0x3b]));
fs.writeFileSync(outFile, Buffer.concat(parts));
console.log(`${outFile}: ${frames.length} frames ${W}x${H}, ${table.size} colours, ${fps} fps`);
