#!/usr/bin/env node
// Silhouette sheet: renders every sprite of a tier as a pure black shape on
// white, scaled up, so poses can be judged by outline alone. Also writes a
// coloured sheet using the augusta palette.
// usage: node harness/sprites.mjs [halfblock|quadrant|sextant] [out.png]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { TIERS } from '../src/render/tiers.mjs';
import { spriteSet } from '../src/render/sprites.mjs';
import { miniSet } from '../src/render/idle.mjs';
import { loadPalette } from '../src/render/palette.mjs';

const tierName = process.argv[2] || 'sextant';
const out = process.argv[3] || `harness/frames/sprites-${tierName}.png`;
const tier = TIERS[tierName];
const set = spriteSet(tier);
const mini = miniSet(tier);
const pal = loadPalette('augusta');
const R = pal.roles;
const MAP = { h: R.white, f: R.skin, s: R.shirts[0], p: R.navy, k: R.outline, c: R.gray, C: R.gray, b: R.bags[0], B: R.gray,
  r: R.cart, W: R.cart, w: R.gray, t: R.tree, T: R.treeLight, o: R.trunk, m: R.white };

const items = [];
for (const [k, v] of Object.entries(set.golfer)) items.push(['golfer.' + k, v]);
for (const [k, v] of Object.entries(set.caddie)) items.push(['caddie.' + k, v]);
for (const [k, v] of Object.entries(set.cart)) items.push(['cart.' + k, v]);
items.push(['tree', set.tree]);
items.push(['marker', set.marker]);
// idle-strip mini sprites follow, separated by a gap
for (const [k, v] of Object.entries(mini.golfer)) items.push(['mini.golfer.' + k, v]);
for (const [k, v] of Object.entries(mini.caddie)) items.push(['mini.caddie.' + k, v]);
for (const [k, v] of Object.entries(mini.cart)) items.push(['mini.cart.' + k, v]);
items.push(['mini.tree', mini.tree]);
items.push(['mini.marker', mini.marker]);

// subpixel aspect: width : height = (1/sx) : (2/sy)
const PX = 8;
const pw = Math.round(PX / tier.sx * 2), ph = Math.round(PX * 2 / tier.sy * 2); // pixel size on sheet
const gap = 12;
let totalW = gap, maxH = 0;
for (const [, s] of items) { totalW += s[0].length * pw + gap; maxH = Math.max(maxH, s.length * ph); }
const sheetH = maxH * 2 + gap * 3;
const img = Buffer.alloc(totalW * sheetH * 3, 255);
function put(x, y, c) { if (x < 0 || y < 0 || x >= totalW || y >= sheetH) return; const o = (y * totalW + x) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; }
let x0 = gap;
for (const [, s] of items) {
  for (let r = 0; r < s.length; r++) for (let cI = 0; cI < s[r].length; cI++) {
    const ch = s[r][cI];
    if (ch === '.') continue;
    for (let dy = 0; dy < ph; dy++) for (let dx = 0; dx < pw; dx++) {
      put(x0 + cI * pw + dx, gap + r * ph + dy, [0, 0, 0]);
      const col = pal.rgb[MAP[ch] ?? R.gray];
      put(x0 + cI * pw + dx, gap * 2 + maxH + r * ph + dy, col);
    }
  }
  x0 += s[0].length * pw + gap;
}
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
const raw = Buffer.alloc((totalW * 3 + 1) * sheetH);
for (let y = 0; y < sheetH; y++) { raw[y * (totalW * 3 + 1)] = 0; img.copy(raw, y * (totalW * 3 + 1) + 1, y * totalW * 3, (y + 1) * totalW * 3); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(totalW, 0); ihdr.writeUInt32BE(sheetH, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.mkdirSync('harness/frames', { recursive: true });
fs.writeFileSync(out, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${out}: ${items.length} sprites (${items.map(i => i[0]).join(', ')})`);
