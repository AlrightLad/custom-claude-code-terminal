// User-facing glyph & font diagnostic: `node src/statusline.mjs --doctor`.
//
// Unlike the status line itself — a one-shot process whose output Claude Code
// recaptures, so it can never see your terminal — this runs in your OWN terminal
// as a normal program and OWNS the TTY. So it does two things the status line
// cannot: it prints every glyph the renderer can emit (from the renderer's own
// tables, so the probe and the game can never disagree), AND it measures how wide
// the terminal actually draws a sextant by querying the cursor position (CSI 6n).
//
// That width measurement matters because the common sextant failure is NOT a
// missing glyph (tofu). Often the glyphs render solid yet still fail, because the
// terminal draws them DOUBLE-WIDTH (two cells each — mintty does this): solid in a
// probe row, but the scene grid shreds. Whether a terminal can source these glyphs
// and at what width is not predictable from here (even inspecting the font files is
// unreliable), so the probe measures width live and defers to your eyes on a frame.
// No dependencies, no network.
import { TIERS, selectTier } from './render/tiers.mjs';

const E = '\x1b[';
const R = E + '0m', BOLD = E + '1m', DIM = E + '2m';
const A = E + '38;2;143;208;90;48;2;47;107;42m';
const B = E + '38;2;232;213;154;48;2;40;95;150m';
const WHITE = E + '38;2;235;235;235m', YELLOW = E + '38;2;255;216;74m', REDW = E + '38;2;232;90;80m';
const hex = cp => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

function tierCodepoints(tier) {
  const set = new Set();
  for (const g of tier.glyphs) { const cp = g.codePointAt(0); if (cp !== 0x20) set.add(cp); }
  const all = [...set].sort((a, b) => a - b);
  return { smp: all.filter(cp => cp > 0xffff), bmp: all.filter(cp => cp <= 0xffff) };
}

function glyphRows(cps, indent = '    ') {
  const lines = [];
  for (let i = 0; i < cps.length; i += 16) {
    const chunk = cps.slice(i, i + 16);
    const blocks = chunk.map((cp, j) => ((i + j) % 2 ? B : A) + String.fromCodePoint(cp)).join('') + R;
    lines.push(`${indent}${DIM}${hex(chunk[0])}${R}  ${blocks}`);
  }
  return lines;
}

function termInfo(env) {
  if (env.WT_SESSION) return { name: 'Windows Terminal', draws: true };
  if (env.KITTY_WINDOW_ID) return { name: 'kitty', draws: true };
  if (env.GHOSTTY_RESOURCES_DIR || env.GHOSTTY_BIN_DIR) return { name: 'Ghostty', draws: true };
  if (env.TERM_PROGRAM === 'mintty' || env.MSYSTEM) return { name: 'mintty / Git Bash', draws: false, knownDouble: true };
  if (env.TERM_PROGRAM === 'vscode') return { name: 'VS Code terminal', draws: false };
  if (env.TERM_PROGRAM === 'iTerm.app') return { name: 'iTerm2', draws: null };
  if (env.TERM_PROGRAM === 'Apple_Terminal') return { name: 'Apple Terminal', draws: null };
  if (env.WEZTERM_PANE || env.WEZTERM_EXECUTABLE) return { name: 'WezTerm', draws: null };
  if ((env.TERM || '').includes('foot')) return { name: 'foot', draws: null };
  if ((env.TERM || '').includes('alacritty') || env.ALACRITTY_WINDOW_ID) return { name: 'Alacritty', draws: null };
  return { name: env.TERM_PROGRAM || env.TERM || 'unknown', draws: null };
}

// Pure interpretation of the measurement, split out so it can be unit-tested
// against known inputs without a terminal (a self-written measurement tool is
// not trusted until shown correct on known-good/known-bad cases).
// asciiAdv/sextAdv are the cursor-column advances for `n` single-width ASCII
// chars and `n` sextants respectively.
export function interpretWidth(asciiAdv, sextAdv, n) {
  if (!(asciiAdv > 0) || !(sextAdv > 0)) return { verdict: 'inconclusive', asciiAdv, sextAdv, n, ratio: null };
  const ratio = sextAdv / asciiAdv;
  let verdict = 'inconclusive';
  if (Math.abs(ratio - 1) <= 0.25) verdict = 'single';
  else if (Math.abs(ratio - 2) <= 0.25) verdict = 'double';
  return { verdict, asciiAdv, sextAdv, n, ratio };
}

// Write `run` at column 1 and ask the terminal where the cursor ended up (CSI 6n).
// Resolves the reported 1-based column, or null on timeout. `io` is injectable
// ({stdin, stdout}) so the probe can be validated against a mock terminal.
function queryCol(run, io) {
  return new Promise(resolve => {
    let buf = '';
    const onData = d => {
      buf += d;
      const m = /\x1b\[\d+;(\d+)R/.exec(buf);
      if (m) { clearTimeout(t); io.stdin.removeListener('data', onData); resolve(parseInt(m[1], 10)); }
    };
    const t = setTimeout(() => { io.stdin.removeListener('data', onData); resolve(null); }, 400);
    io.stdin.on('data', onData);
    io.stdout.write('\r' + run + E + '6n');
  });
}

export async function probeSextantWidth(io = process) {
  if (!io.stdout.isTTY || !io.stdin.isTTY) return { tty: false };
  const n = 12;
  const ascii = 'x'.repeat(n);
  const sext = Array.from({ length: n }, (_, i) => String.fromCodePoint(0x1fb00 + i)).join('');
  let raw = false;
  try { io.stdin.setRawMode(true); raw = true; } catch {}
  try { io.stdin.setEncoding('utf8'); } catch {}
  io.stdin.resume();
  const aCol = await queryCol(ascii, io);
  const sCol = await queryCol(sext, io);
  io.stdout.write('\r' + ' '.repeat(n * 2 + 4) + '\r'); // wipe the probe line
  try { if (raw) io.stdin.setRawMode(false); } catch {}
  io.stdin.pause();
  if (aCol == null || sCol == null) return { tty: true, timeout: true };
  return { tty: true, aCol, sCol, ...interpretWidth(aCol - 1, sCol - 1, n) };
}

export async function runDoctor(env = process.env) {
  const out = [];
  const p = s => out.push(s);

  p('');
  p(`${BOLD}Pixel Pro Golf — glyph & font doctor${R}`);
  p(`${DIM}Below is EVERY glyph the renderer can draw at each tier. Each should be a SOLID`);
  p(`two-colour block. But solid is NOT enough for sextant: a glyph can render solid`);
  p(`yet two cells wide and break the scene — the width check at the bottom tests that.${R}`);

  const hb = tierCodepoints(TIERS.halfblock);
  p('');
  p(`${WHITE}halfblock${R}  1x2 — ${DIM}Block Elements; the universal fallback${R}`);
  for (const line of glyphRows([...hb.bmp, ...hb.smp])) p(line);

  const qd = tierCodepoints(TIERS.quadrant);
  p('');
  p(`${WHITE}quadrant${R}  2x2 — ${DIM}Block Elements U+2596..U+259F (+ halves)${R}`);
  for (const line of glyphRows([...qd.bmp, ...qd.smp])) p(line);

  const sx = tierCodepoints(TIERS.sextant);
  p('');
  p(`${WHITE}sextant${R}  2x3 — ${DIM}${sx.smp.length} glyphs U+1FB00..U+1FB3B (Unicode 13) + ${sx.bmp.length} block-element halves${R}`);
  for (const line of glyphRows(sx.smp)) p(line);
  p(`    ${DIM}${hex(sx.bmp[0] || 0x258c)}${R}  ` + sx.bmp.map((cp, j) => (j % 2 ? B : A) + String.fromCodePoint(cp)).join('') + R + `   ${DIM}(${sx.bmp.map(hex).join(' ')})${R}`);
  p('');
  p(`  ${DIM}ruler   ....:....1....:....2    a missing glyph is tofu (▯ □ ?); a double-width${R}`);
  p(`  ${DIM}        glyph is solid but spills past where it should end.${R}`);

  const t = termInfo(env);
  const truecolor = env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit';
  const want = String(env.CCGOLF_GLYPHS || env.GOLF_GLYPHS || '').toLowerCase();
  const forced = !!TIERS[want];
  const cur = selectTier(env);
  p('');
  p(`${BOLD}This terminal${R}`);
  p(`  terminal : ${t.name}`);
  p(`  env      : TERM=${env.TERM || '?'}  COLORTERM=${env.COLORTERM || '(unset)'}  TERM_PROGRAM=${env.TERM_PROGRAM || '(unset)'}${env.MSYSTEM ? '  MSYSTEM=' + env.MSYSTEM : ''}`);
  p(`  colour   : ${truecolor ? '24-bit advertised' : '24-bit not advertised — most modern terminals still do it'}`);
  p(`  renderer : will use ${BOLD}${cur.name}${R} ${DIM}(${forced ? 'from CCGOLF_GLYPHS=' + want : 'default; CCGOLF_GLYPHS not set'})${R}`);

  process.stdout.write(out.join('\n') + '\n');

  // ---- live width measurement (needs the TTY) ----
  const w = await probeSextantWidth();
  const v = [];
  const q = s => v.push(s);
  q('');
  q(`${BOLD}Width check (sextant)${R}`);
  if (!w.tty) {
    q(`  ${DIM}Not a TTY here (output is piped). Run this directly in your terminal to`);
    q(`  measure sextant width.${R}`);
  } else if (w.timeout || w.verdict === 'inconclusive') {
    q(`  ${YELLOW}Could not measure${R} (no CSI 6n reply${w.ratio != null ? `, ratio ${w.ratio.toFixed(2)}` : ''}). The solid`);
    q(`  rows above are NECESSARY but NOT SUFFICIENT — a glyph can be solid yet the`);
    q(`  wrong width. Judge from a real frame:  ${WHITE}node src/demo.mjs --glyphs sextant${R}`);
  } else if (w.verdict === 'double') {
    q(`  ${REDW}DOUBLE-WIDTH${R}: measured ${w.sextAdv} cells for ${w.n} sextants vs ${w.asciiAdv} for ${w.n} ASCII.`);
    q(`  These glyphs render solid here, but each takes two cells, so the scene`);
    q(`  grid breaks. ${BOLD}Sextant cannot work in this terminal.${R} Keep ${WHITE}halfblock${R}, or run`);
    q(`  Git Bash inside ${WHITE}Windows Terminal${R}, which draws these at the correct width.`);
  } else {
    q(`  ${WHITE}OK${R}: sextants measured single-width (${w.sextAdv} cells for ${w.n}, same as ASCII).`);
    q(`  Width is fine here. Set ${WHITE}CCGOLF_GLYPHS=sextant${R} — then glance at a real frame`);
    q(`  once to be sure:  ${WHITE}node src/demo.mjs --glyphs sextant${R}`);
  }

  q('');
  q(`${BOLD}What to do${R}`);
  q(`  ${WHITE}halfblock${R} (the default) works in every terminal — no setup. ${WHITE}sextant${R} is a`);
  q(`  bonus for terminals that draw it at the right width.`);
  if (t.draws === true) q(`  ${DIM}${t.name} draws these glyphs itself, so sextant should be safe here.${R}`);
  else if (t.knownDouble && w.verdict !== 'single') q(`  ${DIM}${t.name} is known to draw SMP glyphs double-width; the check above is decisive.${R}`);
  q(`  Set it wherever Claude Code reads env — settings.json ${DIM}"env": { "CCGOLF_GLYPHS": "sextant" }${R}`);
  q(`  or your shell ${DIM}(export CCGOLF_GLYPHS=sextant / $env:CCGOLF_GLYPHS="sextant")${R}.`);
  q('');
  process.stdout.write(v.join('\n') + '\n');
}
