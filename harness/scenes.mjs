#!/usr/bin/env node
// Captures one frame per named scene from the REAL entry point, driven with
// a synthetic clock, and writes harness/frames/scene-<name>.txt (raw ANSI)
// plus scene-<name>.png (via harness/png.mjs).
//
// Seeds are chosen by pre-playing holes in-process with the same shot model,
// so a seed whose first hole produces a bunker shot or a slice is known
// before any frame is rendered. Everything is deterministic per seed.
// usage: node harness/scenes.mjs [cols=100] [lines=30]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { genHole, genCaddie } from '../src/gen/course.mjs';
import { newHole, takeShot } from '../src/sim/golf.mjs';

const cols = Number(process.argv[2]) || 100;
const lines = Number(process.argv[3]) || 30;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const ENTRY = path.join(ROOT, 'src', 'statusline.mjs');
const OUT = path.join(ROOT, 'harness', 'frames');
fs.mkdirSync(OUT, { recursive: true });

// Pre-play hole 1 of a seed and describe its shots.
function preview(sid) {
  const hole = genHole(sid, 1);
  const h = newHole(1, hole.par);
  const shots = [];
  let guard = 0;
  while (!h.holed && h.strokes < 12 && guard++ < 20) shots.push(takeShot(h, hole, sid, 1));
  return { hole, shots, strokes: h.strokes };
}

function findSeed(pred, label) {
  for (let i = 1; i < 4000; i++) {
    const sid = `scene-${i}`;
    if (pred(preview(sid), genCaddie(sid))) { console.log(`${label}: ${sid}`); return sid; }
  }
  throw new Error('no seed found for ' + label);
}

const SEEDS = {
  plain: findSeed(p => p.hole.par > 3 && p.shots.length <= 6 && p.shots.some(s => s.kind === 'putt' && !s.holed) && !p.shots.some(s => s.pen), 'tee/approach/putt seed'),
  bunker: findSeed(p => p.shots.some(s => s.kind === 'sand') && p.shots.length <= 7, 'bunker seed'),
  trouble: findSeed(p => p.shots[0] && /SLICE|HOOK/.test(p.shots[0].label || '') && p.shots[0].lie === 'trees', 'slice-into-trees seed'),
  walk: findSeed((p, c) => c.transport === 'walk' && p.shots.length <= 6, 'walking caddie seed'),
  cart: findSeed((p, c) => c.transport === 'cart' && p.shots.length <= 6, 'cart seed'),
};

function tick(home, sid, mode, now) {
  const input = JSON.stringify({ session_id: sid, model: { display_name: 'Scene' } });
  const out = execFileSync('node', [ENTRY], {
    input, encoding: 'utf8',
    env: { ...process.env, GOLF_HOME: home, GOLF_MODE: mode, GOLF_NOW: String(now), COLUMNS: String(cols), LINES: String(lines) },
  });
  const st = JSON.parse(fs.readFileSync(path.join(home, 'state', sid + '.json'), 'utf8'));
  return { out, st };
}

const found = {};
function save(name, out) {
  if (found[name]) return;
  found[name] = true;
  const txt = path.join(OUT, `scene-${name}.txt`);
  fs.writeFileSync(txt, out);
  try { execFileSync('node', [path.join(ROOT, 'harness', 'png.mjs'), txt, path.join(OUT, `scene-${name}.png`), '6']); } catch {}
  console.log('captured', name);
}

function classify(st, out, names) {
  const h = st.hole;
  const s = h.shots[h.shots.length - 1];
  if (st.mode !== 'WORKING' || !s) return;
  const mid = h.phase === 'flight' && h.pt > s.dur * 0.45;
  if (names.includes('tee-shot') && mid && s.n === 1 && s.kind === 'full') save('tee-shot', out);
  if (names.includes('approach') && mid && s.n >= 2 && s.kind === 'full' && (s.lie === 'green' || s.lie === 'fringe')) save('approach', out);
  if (names.includes('bunker-recovery') && (mid || h.phase === 'result') && s.kind === 'sand') save('bunker-recovery', out);
  if (names.includes('putt') && (mid || h.phase === 'result') && s.kind === 'putt' && !s.holed) save('putt', out);
  if (names.includes('hole-out') && h.phase === 'holed' && h.pt > 500) save('hole-out', out);
  if (names.includes('trouble') && h.phase === 'result' && /SLICE|HOOK/.test(s.label || '')) save('trouble', out);
}

// Run one seed: idle wait, a working stretch (classifying frames), then the stop.
function run(sid, names, idleName) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-scenes-'));
  let now = 1700000000000;
  let r = tick(home, sid, 'IDLE', now);
  if (names.includes('idle-wait')) save('idle-wait', r.out);
  const working = names.filter(n => n !== idleName && n !== 'idle-wait');
  for (let i = 0; i < 160; i++) {
    const needScenes = working.some(n => !found[n]);
    const needStrokes = idleName && r.st.hole.strokes < 2; // the stop then holes out from mid-hole
    if (!needScenes && !needStrokes) break;
    now += 650;
    r = tick(home, sid, 'WORKING', now);
    classify(r.st, r.out, names);
    if (r.st.holeIdx > 0) break; // hole 1 finished
  }
  if (idleName) {
    for (let i = 0; i < 10 && !found[idleName]; i++) {
      now += 700;
      r = tick(home, sid, 'IDLE', now);
      if (r.st.idle && r.st.idle.phase === 'holeout' && i === 1 && !found['hole-out-stop']) save('hole-out-stop', r.out);
      if (r.st.idle && r.st.idle.phase === 'walk') save(idleName, r.out);
    }
  }
  fs.rmSync(home, { recursive: true, force: true });
}

run(SEEDS.plain, ['idle-wait', 'tee-shot', 'approach', 'putt', 'hole-out'], null);
run(SEEDS.bunker, ['bunker-recovery'], null);
run(SEEDS.trouble, ['trouble'], null);
run(SEEDS.walk, ['idle-walk'], 'idle-walk');
run(SEEDS.cart, ['idle-cart'], 'idle-cart');
const want = ['idle-wait', 'tee-shot', 'approach', 'bunker-recovery', 'putt', 'hole-out', 'trouble', 'idle-walk', 'idle-cart', 'hole-out-stop'];
console.log('done:', want.map(w => `${w}=${found[w] ? 'ok' : 'MISSING'}`).join(' '));
