// Persistence: per-session state, the working/idle mode written by the
// hooks, and the cumulative career file. Writes go to a temp file in the same
// directory and are renamed into place so concurrent sessions never read a
// half-written file.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function golfHome() {
  return process.env.CCGOLF_HOME || process.env.GOLF_HOME || path.join(os.homedir(), '.claude', 'golf');
}

export function ensureDirs(home) {
  for (const d of ['state', 'career']) {
    try { fs.mkdirSync(path.join(home, d), { recursive: true }); } catch {}
  }
}

function safeName(sid) {
  return String(sid).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'session';
}

export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.${Date.now() % 100000}.tmp`;
  const data = JSON.stringify(obj);
  try {
    fs.writeFileSync(tmp, data);
    try { fs.renameSync(tmp, file); }
    catch {
      // Windows can refuse the rename while another reader holds the file:
      // retry once, then copy over and drop the temp file.
      try { fs.renameSync(tmp, file); }
      catch { fs.copyFileSync(tmp, file); fs.unlinkSync(tmp); }
    }
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
    try { fs.writeFileSync(file, data); } catch {}
  }
}

export function statePath(home, sid) { return path.join(home, 'state', safeName(sid) + '.json'); }

export function loadState(home, sid) {
  const st = readJson(statePath(home, sid));
  return st && typeof st === 'object' ? st : null;
}

export function saveState(home, sid, st) {
  writeJsonAtomic(statePath(home, sid), st);
}

// Mode file format: "WORKING <epoch seconds>" or "IDLE <epoch seconds>".
// A per-session file wins over the shared one when a hook writes it.
export function readMode(home, sid) {
  const forced = process.env.CCGOLF_MODE || process.env.GOLF_MODE;
  if (forced) return { mode: /^w/i.test(forced) ? 'WORKING' : 'IDLE', t: 0, source: 'env' };
  for (const f of [path.join(home, 'state', 'mode-' + safeName(sid)), path.join(home, 'state', 'mode')]) {
    let txt = null;
    try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const m = /^(WORKING|IDLE)\s*(\d+)?/i.exec(txt.trim());
    if (m) return { mode: m[1].toUpperCase(), t: Number(m[2] || 0), source: f };
  }
  return { mode: 'IDLE', t: 0, source: 'default' };
}

// Career is sharded per session (career/<sid>.json) so that N concurrent
// sessions never read-modify-write one shared file — that was a corruption and
// lost-update risk under the common 4-8-sessions-at-once case. The lifetime
// total is the merge of all shards, computed on read; nothing contends.
export function careerPath(home, sid) { return path.join(home, 'career', safeName(sid) + '.json'); }

export function newCareer() {
  return { v: 2, rounds: 0, holes: 0, strokes: 0, par: 0, putts: 0, gir: 0, fir: 0, firHoles: 0, penalties: 0,
    counts: {}, best: null, worst: null, lastRounds: [], holeInOnes: 0 };
}

export function updateCareer(home, sid, fn) {
  const file = careerPath(home, sid);
  const c = readJson(file) || newCareer();
  fn(c);
  writeJsonAtomic(file, c);
  return c;
}

// Merge every per-session shard into one lifetime total (for a future career
// view and the stress harness). Read-only; never writes.
export function careerTotals(home) {
  const dir = path.join(home, 'career');
  const total = newCareer();
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { return total; }
  for (const f of files) {
    const c = readJson(path.join(dir, f));
    if (!c) continue;
    for (const k of ['rounds', 'holes', 'strokes', 'par', 'putts', 'gir', 'fir', 'firHoles', 'penalties', 'holeInOnes']) total[k] += c[k] || 0;
    for (const [name, n] of Object.entries(c.counts || {})) total.counts[name] = (total.counts[name] || 0) + n;
    if (c.best && (!total.best || c.best.total < total.best.total)) total.best = c.best;
    if (c.worst && (!total.worst || c.worst.total > total.worst.total)) total.worst = c.worst;
  }
  return total;
}
