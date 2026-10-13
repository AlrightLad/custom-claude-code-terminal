#!/usr/bin/env node
// Relative-scale sanity check. Renders frames at several widths with the
// debug row on and asserts, from the numbers the renderer itself reports,
// that the golfer (always 5 rows = 10 units tall) is never taller than the
// green's drawn diameter and never smaller than a third of it. A golfer
// taller than the green is always a bug.
// usage: node harness/scale-check.mjs [ticks=40]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const ENTRY = path.join(ROOT, 'src', 'statusline.mjs');
const ticks = Number(process.argv[2]) || 40;
const configs = [[80, 24, 'halfblock'], [120, 36, 'halfblock'], [200, 58, 'halfblock'], [120, 36, 'sextant'], [200, 58, 'sextant']];
let failed = 0, checked = 0;
const worst = {};
for (const [cols, lines, tier] of configs) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-scale-'));
  let now = 1700000000000;
  const sid = 'scene-1';
  for (let i = 0; i < ticks; i++) {
    now += 700;
    const out = execFileSync('node', [ENTRY], {
      input: JSON.stringify({ session_id: sid }), encoding: 'utf8',
      env: { ...process.env, CCGOLF_HOME: home, CCGOLF_MODE: 'WORKING', CCGOLF_NOW: String(now), COLUMNS: String(cols), LINES: String(lines), CCGOLF_GLYPHS: tier, CCGOLF_DEBUG: '1' },
    });
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '');
    const m = /u=([\d.]+)y\/col view=(\w+)(?: rake=[\d.]+)? golfer=(\d+)u\/(\d+)y green=([\d.]+)u\/(\d+)y/.exec(plain);
    if (!m) continue;
    checked++;
    const u = Number(m[1]), view = m[2], golferU = Number(m[3]), greenU = Number(m[5]);
    const ratio = golferU / greenU;
    const key = `${cols}x${lines} ${tier} ${view}`;
    if (!worst[key] || ratio > worst[key].ratio) worst[key] = { ratio, u, golferU, greenU };
    if (ratio > 1.0 || ratio < 0.3) { failed++; console.log(`FAIL ${key}: golfer ${golferU}u vs green ${greenU.toFixed(1)}u (u=${u})`); }
    if (/sprite-clamped/.test(plain)) { failed++; console.log(`FAIL ${key}: sprite clamped at tick ${i}`); }
  }
  fs.rmSync(home, { recursive: true, force: true });
}
for (const [k, v] of Object.entries(worst)) console.log(`${k.padEnd(28)} worst golfer/green ${v.ratio.toFixed(2)}  (golfer ${v.golferU}u, green ${v.greenU.toFixed(1)}u at ${v.u} y/col)`);
console.log(`${checked} frames checked, ${failed} failures`);
process.exitCode = failed ? 1 : 0;
