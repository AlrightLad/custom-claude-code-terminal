#!/usr/bin/env node
// Greyscale check for every palette in assets/palettes/. The hole must read
// in greyscale, so the surfaces have to sit on a luminance ladder:
//   water < trees < rough < fairway < green < sand < ball
// Prints the ladder for each theme and fails if any step is out of order or
// closer than a minimum contrast. With --frame <frame.txt> it also writes a
// greyscale PNG next to the frame via harness/png.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadPalette, luminance } from '../src/render/palette.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const dir = path.join(ROOT, 'assets', 'palettes');
const LADDER = ['water', 'tree', 'rough', 'fairway', 'green', 'sand', 'ball'];
const MIN_STEP = 0.04;  // widened per ART-DIRECTION rule 5
let failed = false;

for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const pal = loadPalette(path.basename(file, '.json'));
  const L = LADDER.map(role => ({ role, l: luminance(pal.rgb[pal.roles[role]]) }));
  let ok = true;
  for (let i = 1; i < L.length; i++) if (L[i].l - L[i - 1].l < MIN_STEP) ok = false;
  console.log(`${pal.name.padEnd(8)} ${ok ? 'OK  ' : 'FAIL'} ` + L.map(e => `${e.role}=${e.l.toFixed(3)}`).join(' < '));
  // The three tones of each surface must bracket the base tone.
  for (const s of ['rough', 'fairway', 'green', 'tree']) {
    const d = luminance(pal.rgb[pal.roles[s + 'Dark']]), m = luminance(pal.rgb[pal.roles[s]]), l = luminance(pal.rgb[pal.roles[s + 'Light']]);
    if (!(d < m && m < l)) { ok = false; console.log(`         ${s}: dark/base/light not ordered (${d.toFixed(3)}, ${m.toFixed(3)}, ${l.toFixed(3)})`); }
  }
  if (!ok) failed = true;
}

const fi = process.argv.indexOf('--frame');
if (fi >= 0 && process.argv[fi + 1]) {
  const frame = process.argv[fi + 1];
  const out = frame.replace(/\.txt$/, '') + '-grey.png';
  execFileSync('node', [path.join(ROOT, 'harness', 'png.mjs'), frame, out, '--grey'], { stdio: 'inherit' });
}
process.exitCode = failed ? 1 : 0;
