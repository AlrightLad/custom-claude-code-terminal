#!/usr/bin/env node
// Human-review montage. Renders a curated matrix of frames from the REAL entry
// point (deterministic clock), labels each, and stacks them into a handful of
// labelled contact sheets under docs/frames/review/ plus an index. This is the
// "final review that needs human eyes" artifact: themes, seasons, holidays and
// the special states (camera, weather, wardrobe) side by side.
// usage: node harness/montage.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { rasterize, encodePng } from './raster-frame.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const ENTRY = path.join(ROOT, 'src', 'statusline.mjs');
const OUT = path.join(ROOT, 'docs', 'frames', 'review');
fs.mkdirSync(OUT, { recursive: true });

const COLS = 150, LINES = 40, CELLW = 5;
const GAP = 10, BG = [14, 18, 22];

// One captured frame: drive `ticks` steps of `sid` under `env`, keep the last.
function render(sid, env, ticks) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-montage-'));
  let now = 1700000000000, out = '';
  for (let i = 0; i < ticks; i++) {
    now += 800;
    out = execFileSync('node', [ENTRY], {
      input: JSON.stringify({ session_id: sid }), encoding: 'utf8',
      env: { ...process.env, CCGOLF_HOME: home, CCGOLF_MODE: 'WORKING', CCGOLF_NOW: String(now), COLUMNS: String(COLS), LINES: String(LINES), ...env },
    });
  }
  fs.rmSync(home, { recursive: true, force: true });
  return out;
}

function frame(label, sid, env, ticks = 3) {
  const text = render(sid, env, ticks);
  const labelled = `\x1b[97m   ${label}\x1b[0m\n` + text;
  return rasterize(labelled, { cellW: CELLW });
}

// Stack frames vertically into one sheet (left-aligned, padded to max width).
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
  const frames = entries.map(e => frame(e.label, e.sid, e.env || {}, e.ticks || 3));
  const img = stack(frames);
  fs.writeFileSync(path.join(OUT, name + '.png'), encodePng(img.w, img.h, img.rgb));
  console.log(`${name}.png  (${entries.length} frames, ${img.w}x${img.h})`);
  return entries.map(e => e.label);
}

const index = {};
// Day stamps so auto season/holiday resolve for the holiday sheet.
const DAY = d => String(new Date(d + 'T10:00:00').getTime());

index.themes = sheet('review-themes', [
  { label: 'theme augusta', sid: 'canon-A', env: { CCGOLF_THEME: 'augusta', CCGOLF_SEASON: 'none', CCGOLF_WEATHER: 'clear' }, ticks: 5 },
  { label: 'theme links', sid: 'canon-A', env: { CCGOLF_THEME: 'links', CCGOLF_SEASON: 'none', CCGOLF_WEATHER: 'clear' }, ticks: 5 },
  { label: 'theme desert', sid: 'canon-A', env: { CCGOLF_THEME: 'desert', CCGOLF_SEASON: 'none', CCGOLF_WEATHER: 'clear' }, ticks: 5 },
]);

index.seasons = sheet('review-seasons', [
  { label: 'spring', sid: 'canon-A', env: { CCGOLF_SEASON: 'spring', CCGOLF_WEATHER: 'flowers' }, ticks: 5 },
  { label: 'summer', sid: 'canon-A', env: { CCGOLF_SEASON: 'summer', CCGOLF_WEATHER: 'clear' }, ticks: 5 },
  { label: 'fall', sid: 'canon-A', env: { CCGOLF_SEASON: 'fall', CCGOLF_WEATHER: 'leaves' }, ticks: 5 },
  { label: 'winter', sid: 'canon-A', env: { CCGOLF_SEASON: 'winter', CCGOLF_WEATHER: 'snow' }, ticks: 5 },
]);

index.holidays = sheet('review-holidays', [
  { label: 'christmas', sid: 'hol-x', env: { CCGOLF_NOW: DAY('2026-12-25') }, ticks: 3 },
  { label: 'halloween', sid: 'hol-h', env: { CCGOLF_NOW: DAY('2026-10-28') }, ticks: 3 },
  { label: 'valentines', sid: 'hol-v', env: { CCGOLF_NOW: DAY('2026-02-14') }, ticks: 3 },
  { label: 'st patricks', sid: 'hol-s', env: { CCGOLF_NOW: DAY('2026-03-17') }, ticks: 3 },
  { label: 'independence', sid: 'hol-i', env: { CCGOLF_NOW: DAY('2026-07-04') }, ticks: 3 },
]);

index.special = sheet('review-special', [
  { label: 'camera: raked (default)', sid: 'canon-A', env: { CCGOLF_SEASON: 'none' }, ticks: 1 },
  { label: 'camera: flat', sid: 'canon-A', env: { CCGOLF_SEASON: 'none', CCGOLF_VIEW: 'flat' }, ticks: 1 },
  { label: 'rain + overcast mood', sid: 'canon-A', env: { CCGOLF_SEASON: 'spring', CCGOLF_WEATHER: 'rain,overcast' }, ticks: 5 },
  { label: 'caddie umbrella (walking caddie)', sid: 'walk-0', env: { CCGOLF_SEASON: 'spring', CCGOLF_WEATHER: 'rain,overcast' }, ticks: 27 },
  { label: 'summer shorts (walking caddie)', sid: 'walk-0', env: { CCGOLF_SEASON: 'summer', CCGOLF_WEATHER: 'clear' }, ticks: 27 },
  { label: 'dogleg (sharp elbow)', sid: 'canon-D12', env: { CCGOLF_SEASON: 'none' }, ticks: 1 },
]);

const md = ['# Review gallery', '',
  'Generated by `node harness/montage.mjs`. Each sheet stacks frames top to bottom in the order listed.', '',
  '> These frames are painted by the project rasterizer, not by a terminal, so they show renderer *intent*. What a terminal actually displays depends on its glyph support — run `node src/statusline.mjs --doctor` to check yours. See `docs/ART-DIRECTION.md`.', ''];
for (const [name, labels] of Object.entries(index)) {
  md.push(`## ${name} — \`review-${name}.png\``, '');
  labels.forEach((l, i) => md.push(`${i + 1}. ${l}`));
  md.push('');
}
fs.writeFileSync(path.join(OUT, 'README.md'), md.join('\n'));
console.log('README.md written');
