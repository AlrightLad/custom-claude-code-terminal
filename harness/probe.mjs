#!/usr/bin/env node
// Phase 0 capability probe. Point statusLine at this file, then steer it by
// writing ~/.claude/golf/probe/control.json:
//   {"mode":"plain|rows|wide|color|sixel","rows":8,"width":100,
//    "target":"<session_id prefix>","until":<epoch ms>}
// Every invocation appends one line to ~/.claude/golf/probe/ticks.log:
//   <epoch ms> TAB <sid8> TAB <COLUMNS> TAB <LINES> TAB <mode> TAB <host>
// and writes the full environment once per session to env-<sid8>.txt.
// Sessions whose id does not start with "target" always get the plain line,
// so a Sixel or row-count experiment cannot disturb an unrelated session.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const T0 = Date.now();
const dir = path.join(os.homedir(), '.claude', 'golf', 'probe');
try { fs.mkdirSync(dir, { recursive: true }); } catch {}

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch {}
let j = {};
try { j = JSON.parse(raw); } catch {}
const sid = String(j.session_id || process.env.CLAUDE_CODE_SESSION_ID || 'nosid');
const sid8 = sid.slice(0, 8);
const COLS = process.env.COLUMNS, LNS = process.env.LINES;
const host = process.env.WT_SESSION ? 'wt' : (process.env.TERM_PROGRAM || 'unknown');

let ctl = {};
try { ctl = JSON.parse(fs.readFileSync(path.join(dir, 'control.json'), 'utf8')); } catch {}
const expired = ctl.until && T0 > ctl.until;
const mine = !ctl.target || sid.startsWith(ctl.target);
const mode = (mine && !expired && ctl.mode) ? ctl.mode : 'plain';

try { fs.appendFileSync(path.join(dir, 'ticks.log'), `${T0}\t${sid8}\t${COLS ?? '-'}\t${LNS ?? '-'}\t${mode}\t${host}\n`); } catch {}
const envFile = path.join(dir, `env-${sid8}.txt`);
if (!fs.existsSync(envFile)) {
  try {
    fs.writeFileSync(envFile, Object.keys(process.env).sort().map(k => `${k}=${process.env[k]}`).join('\n') + '\n\nSTDIN:\n' + raw + '\n');
  } catch {}
}

const R = '\x1b[0m';
const clock = new Date(T0).toISOString().slice(11, 23);
const W = Number(ctl.width) || Number(COLS) || 100;
const ruler = (w) => {
  let s = '';
  for (let i = 1; i <= w; i++) s += (i % 10 === 0) ? String((i / 10) % 10) : (i === w ? '#' : '.');
  return s;
};
const out = [];

if (mode === 'rows') {
  const n = Number(ctl.rows) || 8;
  for (let i = 1; i <= n; i++) {
    const tag = `R${String(i).padStart(2, '0')}/${n} `;
    const bg = i % 2 ? '\x1b[44m' : '\x1b[45m';
    out.push(bg + tag + ruler(W - tag.length) + R);
  }
} else if (mode === 'wide') {
  // exactly COLUMNS cells, then COLUMNS+1, then COLUMNS-1: which one wraps?
  out.push('\x1b[42m' + 'W=' + ruler(W - 2) + R);
  out.push('\x1b[43m' + 'W+1' + ruler(W - 2) + R);
  out.push('\x1b[46m' + 'W-1' + ruler(W - 4) + R);
} else if (mode === 'color') {
  let a = 'rgb  ';
  for (let i = 0; i < 48; i++) { const h = i / 48; const r = Math.round(255 * Math.max(0, 1 - Math.abs(h * 3 - 0) % 3)); a += `\x1b[48;2;${Math.round(255 * (1 - h))};${Math.round(255 * h)};${(i * 37) % 256}m `; }
  out.push(a + R + ' <- 24-bit gradient (smooth = truecolor OK)');
  let b = '256  ';
  for (let i = 0; i < 48; i++) b += `\x1b[48;5;${16 + Math.floor(i * 215 / 48)}m `;
  out.push(b + R + ' <- 256-colour cube');
  let c = 'half ';
  for (let i = 0; i < 48; i++) c += `\x1b[38;2;${255 - i * 5};${40 + i * 4};30m\x1b[48;2;20;${100 + i * 3};${200 - i * 4}m▀`;
  out.push(c + R + ' <- U+2580 half blocks, fg/bg truecolor');
  let d = '16   ';
  for (let i = 0; i < 16; i++) d += `\x1b[${i < 8 ? 40 + i : 100 + i - 8}m   `;
  out.push(d + R + ' <- basic 16');
  out.push(`${sid8} ${clock} COLUMNS=${COLS} LINES=${LNS}`);
} else if (mode === 'sixel') {
  // 36x12 px, 2 sixel bands, three colours. If the TUI survives, this draws a
  // small striped block; if not, the garbage will be obvious.
  const Wpx = 36;
  const band = (col) => `#${col}` + '~'.repeat(Wpx);
  const six = '\x1bPq"1;1;' + Wpx + ';12#0;2;0;60;0#1;2;100;100;100#2;2;80;10;10' +
    band(0) + '$' + '#1' + '?'.repeat(12) + '~'.repeat(12) + '-' +
    band(2) + '$' + '#1' + '?'.repeat(24) + '~'.repeat(12) + '-' + '\x1b' + String.fromCharCode(92);
  out.push(six + ' <- sixel 36x12 should appear left of this text');
  out.push(`sixel probe ${sid8} ${clock} host=${host}`);
} else if (mode === 'sgr') {
  out.push(`fg31:\x1b[31mRED${R} fg32:\x1b[32mGRN${R} fg94:\x1b[94mBLU${R} bold:\x1b[1mBOLD${R} dim:\x1b[2mDIM${R} inv:\x1b[7mINV${R} ul:\x1b[4mUL${R} it:\x1b[3mIT${R}`);
  out.push(`bg41:\x1b[41m   ${R} bg44:\x1b[44m   ${R} bg256:\x1b[48;5;208m   ${R} bg24:\x1b[48;2;255;0;255m   ${R} fg24:\x1b[38;2;255;128;0mORANGE${R} fg256:\x1b[38;5;51mCYAN${R}`);
  out.push(`blk:\x1b[31m█████${R} \x1b[38;2;0;200;0m█████${R} \x1b[38;5;208m█████${R} hb:\x1b[38;2;255;0;0;48;2;0;0;255m▀▀▀▀▀${R} inv-hb:\x1b[7;32m▀▀▀▀▀${R}`);
  out.push(`sgr ${sid8} ${clock} COLUMNS=${COLS} LINES=${LNS} host=${host}`);
} else if (mode === 'fit') {
  // rows of exact cell length L, labelled; a row that keeps its final '#' and
  // gains no ellipsis fits inside Claude Code's status area.
  const base = Number(COLS) || 100;
  for (let L = base - 10; L <= base; L += 1) {
    const tag = `L=${L} `;
    out.push(tag + ruler(L - tag.length));
  }
} else {
  out.push(`probe ${sid8} ${clock} COLUMNS=${COLS} LINES=${LNS} host=${host}`);
}
process.stdout.write(out.join('\n') + '\n');
