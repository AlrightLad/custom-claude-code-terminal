#!/usr/bin/env node
// Demo mode: plays a scripted hole in your terminal at a fixed frame rate
// with no Claude Code involved. Drives the real entry point one frame at a
// time with a synthetic clock, exactly as the status line would, so what you
// see is what you would get.
//
//   node src/demo.mjs                    # augusta, auto glyph tier, 2 fps, ~70 s
//   node src/demo.mjs --theme links --glyphs quadrant --fps 3 --seconds 40
//   node src/demo.mjs --record docs/demo-frames   # also writes NNNN.txt frames for harness/gif.mjs
//   node src/demo.mjs --season winter --seed 7   # a different hole, in winter
//
// Press Ctrl-C to stop; the screen is restored.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt; };
const fps = Math.max(1, Math.min(10, Number(opt('--fps', 2))));
const seconds = Number(opt('--seconds', 70));
const theme = opt('--theme', process.env.CCGOLF_THEME || 'augusta');
const glyphs = opt('--glyphs', process.env.CCGOLF_GLYPHS || '');
const season = opt('--season', process.env.CCGOLF_SEASON || '');
const seed = opt('--seed', '1');
const record = opt('--record', '');
const colsArg = Number(opt('--cols', 0));
const linesArg = Number(opt('--lines', 0));

const ENTRY = new URL('./statusline.mjs', import.meta.url);
const entryPath = decodeURIComponent(ENTRY.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-demo-'));
const sid = `demo-${seed}`;
const cols = colsArg || process.stdout.columns || 100;
const lines = linesArg || process.stdout.rows || 30;
if (record) fs.mkdirSync(record, { recursive: true });

// Script: wait on the tee, play the hole, stop (hole-out + walk), then the
// next hole's tee shot, so every mode shows up once.
const script = [];
const pushPhase = (mode, n) => { for (let i = 0; i < n; i++) script.push(mode); };
const total = Math.round(seconds * fps);
pushPhase('IDLE', Math.round(fps * 3));
pushPhase('WORKING', Math.round(fps * 46));
pushPhase('IDLE', Math.round(fps * 12));
pushPhase('WORKING', Math.max(0, total - script.length));

let now = 1700000000000;
const stepMs = Math.round(1000 / fps);
let frameNo = 0;
const out = process.stdout;
const tty = out.isTTY;
if (tty) out.write('\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J'); // alternate screen, hide cursor
const restore = () => { if (tty) out.write('\x1b[?25h\x1b[?1049l'); try { fs.rmSync(home, { recursive: true, force: true }); } catch {} };
process.on('SIGINT', () => { restore(); process.exit(0); });

function frame(mode) {
  const input = JSON.stringify({ session_id: sid, model: { display_name: 'Demo' } });
  const env = { ...process.env, CCGOLF_HOME: home, CCGOLF_MODE: mode, CCGOLF_NOW: String(now), COLUMNS: String(cols), LINES: String(lines), CCGOLF_THEME: theme };
  if (glyphs) env.CCGOLF_GLYPHS = glyphs;
  if (season) env.CCGOLF_SEASON = season;
  return execFileSync('node', [entryPath], { input, encoding: 'utf8', env });
}

(async () => {
  for (const mode of script) {
    const t0 = Date.now();
    let text;
    try { text = frame(mode); } catch (e) { text = 'demo: ' + String(e.message || e).slice(0, 80) + '\n'; }
    frameNo++;
    if (record) fs.writeFileSync(path.join(record, String(frameNo).padStart(4, '0') + '.txt'), text);
    if (tty) {
      const rows = text.replace(/\n$/, '').split('\n');
      out.write('\x1b[H' + rows.map(r => r + '\x1b[K').join('\n') + '\n\x1b[J');
      out.write(`\x1b[2m demo ${theme}${glyphs ? ' ' + glyphs : ''} · ${mode.toLowerCase()} · frame ${frameNo}/${script.length} · ctrl-c to quit\x1b[0m`);
    } else out.write(text);
    now += stepMs;
    const wait = stepMs - (Date.now() - t0);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }
  restore();
})();
