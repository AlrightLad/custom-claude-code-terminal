#!/usr/bin/env node
// Halfblock review montage: the tier most users actually run (1x2 pixels per
// cell). Renders the key states, row budgets (14/18/20) and themes at
// CCGOLF_GLYPHS=halfblock from the real entry point, labels each, stacks them
// into review sheets under docs/frames/review/ for an art critique at 1x2.
// usage: node harness/montage-halfblock.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { rasterize, encodePng } from './raster-frame.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const ENTRY = path.join(ROOT, 'src', 'statusline.mjs');
const OUT = path.join(ROOT, 'docs', 'frames', 'review');
fs.mkdirSync(OUT, { recursive: true });

const COLS = 150, CELLW = 5, GAP = 10, BG = [14, 18, 22];

function render(sid, ticks, env) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-hb-'));
  let now = 1700000000000, out = '';
  for (let i = 0; i < ticks; i++) {
    now += 700;
    out = execFileSync('node', [ENTRY], {
      input: JSON.stringify({ session_id: sid }), encoding: 'utf8',
      env: { ...process.env, CCGOLF_HOME: home, CCGOLF_MODE: 'WORKING', CCGOLF_NOW: String(now),
        COLUMNS: String(COLS), LINES: '60', CCGOLF_GLYPHS: 'halfblock', CCGOLF_THEME: 'augusta', CCGOLF_SEASON: 'none', ...env },
    });
  }
  fs.rmSync(home, { recursive: true, force: true });
  return out;
}
function frame(label, sid, ticks, env) {
  return rasterize(`\x1b[97m   ${label}\x1b[0m\n` + render(sid, ticks, env), { cellW: CELLW });
}
function stack(frames) {
  const w = Math.max(...frames.map(f => f.w));
  const h = frames.reduce((n, f) => n + f.h, 0) + GAP * (frames.length + 1);
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < rgb.length; i += 3) { rgb[i] = BG[0]; rgb[i + 1] = BG[1]; rgb[i + 2] = BG[2]; }
  let y0 = GAP;
  for (const f of frames) {
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const s = (y * f.w + x) * 3, d = ((y0 + y) * w + x) * 3;
      rgb[d] = f.rgb[s]; rgb[d + 1] = f.rgb[s + 1]; rgb[d + 2] = f.rgb[s + 2];
    }
    y0 += f.h + GAP;
  }
  return { w, h, rgb };
}
function sheet(name, entries) {
  const img = stack(entries.map(e => frame(e.label, e.sid, e.ticks, e.env || {})));
  fs.writeFileSync(path.join(OUT, name + '.png'), encodePng(img.w, img.h, img.rgb));
  console.log(`${name}.png  (${entries.length} frames, ${img.w}x${img.h})`);
}

const ROWS = r => ({ CCGOLF_ROWS: String(r) });
// States at 18 rows (augusta): tee, drive, approach, putt, plus a spring/flowers approach.
sheet('review-halfblock-states', [
  { label: 'tee (rows 18)',               sid: 'canon-A', ticks: 1,  env: ROWS(18) },
  { label: 'drive — fairway/trees/stripes', sid: 'canon-A', ticks: 5,  env: ROWS(18) },
  { label: 'approach — green complex',     sid: 'canon-A', ticks: 14, env: ROWS(18) },
  { label: 'putt — green close',           sid: 'canon-A', ticks: 22, env: ROWS(18) },
  { label: 'spring flowers (rule 4)',      sid: 'canon-A', ticks: 14, env: { ...ROWS(18), CCGOLF_SEASON: 'spring', CCGOLF_WEATHER: 'flowers' } },
]);
// Row budgets (augusta approach): 14 / 18 / 20.
sheet('review-halfblock-rows', [
  { label: 'approach — rows 14', sid: 'canon-A', ticks: 14, env: ROWS(14) },
  { label: 'approach — rows 18', sid: 'canon-A', ticks: 14, env: ROWS(18) },
  { label: 'approach — rows 20', sid: 'canon-A', ticks: 14, env: ROWS(20) },
]);
// Themes (approach, 18 rows).
sheet('review-halfblock-themes', [
  { label: 'augusta', sid: 'canon-A', ticks: 14, env: { ...ROWS(18), CCGOLF_THEME: 'augusta' } },
  { label: 'links',   sid: 'canon-A', ticks: 14, env: { ...ROWS(18), CCGOLF_THEME: 'links' } },
  { label: 'desert',  sid: 'canon-A', ticks: 14, env: { ...ROWS(18), CCGOLF_THEME: 'desert' } },
]);
console.log('done');
