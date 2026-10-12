#!/usr/bin/env node
// Mechanical visual regression gate. Renders a fixed set of canonical scenes
// from fixed seeds and a fixed clock (season pinned to 'none', theme augusta,
// so nothing random drifts), then compares every cell (glyph + fg + bg)
// against the committed baseline in docs/frames/baseline/.
//
//   node harness/visual-diff.mjs --update     # write/refresh the baseline
//   node harness/visual-diff.mjs              # compare, print % cells changed
//   node harness/visual-diff.mjs --png        # also write side-by-side PNGs
//
// Use it to tell whether an art change actually changed anything: if a task
// claims to alter a surface and the matching scene shows ~0% cells changed,
// the task did nothing. Exit code is non-zero if any scene errored.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseRow, rasterize, encodePng } from './raster-frame.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const ENTRY = path.join(ROOT, 'src', 'statusline.mjs');
const BASE = path.join(ROOT, 'docs', 'frames', 'baseline');
const update = process.argv.includes('--update');
const wantPng = process.argv.includes('--png');

// Each canonical scene: a fixed session, a mode sequence (one step = 700ms on
// a fixed clock), the tick to capture, size and tier. Deterministic.
const CANON = [
  { name: 'tee',      sid: 'canon-A', seq: 'W',                 grab: 1,  cols: 120, lines: 36, tier: 'halfblock', agents: 0 },
  { name: 'drive',    sid: 'canon-A', seq: 'WWWWW',             grab: 5,  cols: 120, lines: 36, tier: 'halfblock', agents: 0 },
  { name: 'approach', sid: 'canon-A', seq: 'W'.repeat(14),      grab: 14, cols: 160, lines: 40, tier: 'halfblock', agents: 0 },
  { name: 'putt',     sid: 'canon-A', seq: 'W'.repeat(22),      grab: 22, cols: 120, lines: 36, tier: 'halfblock', agents: 0 },
  { name: 'sextant',  sid: 'canon-B', seq: 'W'.repeat(10),      grab: 10, cols: 160, lines: 40, tier: 'sextant',   agents: 0 },
  { name: 'idle-stand', sid: 'canon-A', seq: 'WWWWWWWWI',       grab: 9,  cols: 120, lines: 36, tier: 'halfblock', agents: 0 },
  { name: 'idle-walk', sid: 'canon-C', seq: 'IIIIIIIIIIIIII',   grab: 14, cols: 120, lines: 10, tier: 'halfblock', agents: 0 },
  { name: 'leaderboard', sid: 'canon-A', seq: 'W'.repeat(8),    grab: 8,  cols: 150, lines: 44, tier: 'halfblock', agents: 3 },
];

function render(sc) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-vdiff-'));
  fs.mkdirSync(path.join(home, 'state'), { recursive: true });
  if (sc.agents) {
    const a = { active: Array.from({ length: sc.agents }, (_, i) => ({ id: 'vd' + i, type: ['Explore', 'Plan', 'general-purpose'][i % 3], started: 1700000000000 })) };
    fs.writeFileSync(path.join(home, 'state', 'agents-' + sc.sid + '.json'), JSON.stringify(a));
  }
  let now = 1700000000000, out = '';
  for (let i = 0; i < sc.seq.length; i++) {
    now += 700;
    const mode = sc.seq[i] === 'I' ? 'IDLE' : 'WORKING';
    out = execFileSync('node', [ENTRY], {
      input: JSON.stringify({ session_id: sc.sid }), encoding: 'utf8',
      env: { ...process.env, CCGOLF_HOME: home, CCGOLF_MODE: mode, CCGOLF_NOW: String(now),
        COLUMNS: String(sc.cols), LINES: String(sc.lines), CCGOLF_GLYPHS: sc.tier,
        CCGOLF_SEASON: 'none', CCGOLF_THEME: 'augusta' },
    });
    if (i + 1 === sc.grab) break;
  }
  fs.rmSync(home, { recursive: true, force: true });
  return out;
}

function cells(text) {
  return text.replace(/\r/g, '').split('\n').filter(Boolean).map(parseRow);
}
function cellKey(c) { return c ? `${c.ch}|${(c.fg || []).join(',')}|${(c.bg || []).join(',')}` : ' '; }
function diff(a, b) {
  const ra = cells(a), rb = cells(b);
  const rows = Math.max(ra.length, rb.length);
  let changed = 0, total = 0;
  for (let r = 0; r < rows; r++) {
    const la = ra[r] || [], lb = rb[r] || [];
    const w = Math.max(la.length, lb.length);
    for (let x = 0; x < w; x++) { total++; if (cellKey(la[x]) !== cellKey(lb[x])) changed++; }
  }
  return { changed, total, pct: total ? (100 * changed / total) : 0 };
}

fs.mkdirSync(BASE, { recursive: true });
let failed = 0, any = false;
for (const sc of CANON) {
  let cur;
  try { cur = render(sc); } catch (e) { console.log(`ERROR ${sc.name}: ${String(e.message || e).slice(0, 80)}`); failed++; continue; }
  const baseFile = path.join(BASE, sc.name + '.txt');
  if (update) {
    fs.writeFileSync(baseFile, cur);
    if (wantPng) { const im = rasterize(cur, { cellW: 6 }); fs.writeFileSync(path.join(BASE, sc.name + '.png'), encodePng(im.w, im.h, im.rgb)); }
    console.log(`baseline ${sc.name} written (${cur.split('\n').filter(Boolean).length} rows)`);
    continue;
  }
  any = true;
  if (!fs.existsSync(baseFile)) { console.log(`NO BASELINE for ${sc.name} (run --update)`); failed++; continue; }
  const d = diff(fs.readFileSync(baseFile, 'utf8'), cur);
  console.log(`${sc.name.padEnd(12)} ${d.pct.toFixed(1).padStart(5)}% cells changed  (${d.changed}/${d.total})`);
  if (wantPng) {
    const im = rasterize(cur, { cellW: 6 });
    fs.writeFileSync(path.join(BASE, sc.name + '-current.png'), encodePng(im.w, im.h, im.rgb));
  }
}
if (any) console.log('\nTip: an art change that claims a surface but shows ~0% on its scene did nothing.');
process.exitCode = failed ? 1 : 0;
