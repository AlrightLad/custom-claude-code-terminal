// User-facing glyph & font diagnostic: `node src/statusline.mjs --doctor`.
//
// Unlike the status line itself — a one-shot process whose output Claude Code
// recaptures, so it can never see your terminal — this runs in your OWN terminal
// as a normal program. What you see here IS the ground truth for this terminal +
// font. It prints EVERY glyph the renderer can emit at each tier (straight from
// the renderer's own glyph tables, so the probe and the game can never disagree),
// detects the terminal and colour support, reports the tier the renderer will
// use, and says plainly what to set. No dependencies, no stdin, no network.
import { TIERS, selectTier } from './render/tiers.mjs';

const E = '\x1b[';
const R = E + '0m', BOLD = E + '1m', DIM = E + '2m';
// Two colours per cell, exactly like the renderer: light green on dark green and
// a sand/sky pair. A glyph the terminal cannot draw then shows as a hollow box
// over colour, unmistakable next to the solid cells it should be.
const A = E + '38;2;143;208;90;48;2;47;107;42m';
const B = E + '38;2;232;213;154;48;2;40;95;150m';
const WHITE = E + '38;2;235;235;235m', YELLOW = E + '38;2;255;216;74m';
const hex = cp => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

// Distinct non-space codepoints a tier can emit, in codepoint order — pulled
// from the tier's real glyph table, split into the supplementary-plane set
// (sextants) and the BMP block-element set (the half/quadrant pieces).
function tierCodepoints(tier) {
  const set = new Set();
  for (const g of tier.glyphs) { const cp = g.codePointAt(0); if (cp !== 0x20) set.add(cp); }
  const all = [...set].sort((a, b) => a - b);
  return { smp: all.filter(cp => cp > 0xffff), bmp: all.filter(cp => cp <= 0xffff) };
}

// Print codepoints as coloured rows of 16, each row labelled by its first
// codepoint so a viewer can name exactly which run (if any) is tofu.
function glyphRows(cps, indent = '    ') {
  const lines = [];
  for (let i = 0; i < cps.length; i += 16) {
    const chunk = cps.slice(i, i + 16);
    const blocks = chunk.map((cp, j) => ((i + j) % 2 ? B : A) + String.fromCodePoint(cp)).join('') + R;
    lines.push(`${indent}${DIM}${hex(chunk[0])}${R}  ${blocks}`);
  }
  return lines;
}

// Terminal name, and whether the TERMINAL draws block/legacy glyphs itself (so
// sextant is safe regardless of font). Conservative: `draws:true` only for
// terminals with documented built-in legacy-computing rendering; `null` = unsure
// (trust the rows above instead).
function termInfo(env) {
  if (env.WT_SESSION) return { name: 'Windows Terminal', draws: true };
  if (env.KITTY_WINDOW_ID) return { name: 'kitty', draws: true };
  if (env.GHOSTTY_RESOURCES_DIR || env.GHOSTTY_BIN_DIR) return { name: 'Ghostty', draws: true };
  if (env.TERM_PROGRAM === 'mintty' || env.MSYSTEM) return { name: 'mintty / Git Bash', draws: false };
  if (env.TERM_PROGRAM === 'vscode') return { name: 'VS Code terminal', draws: false };
  if (env.TERM_PROGRAM === 'iTerm.app') return { name: 'iTerm2', draws: false };
  if (env.TERM_PROGRAM === 'Apple_Terminal') return { name: 'Apple Terminal', draws: false };
  if (env.WEZTERM_PANE || env.WEZTERM_EXECUTABLE) return { name: 'WezTerm', draws: null };
  if ((env.TERM || '').includes('foot')) return { name: 'foot', draws: null };
  if ((env.TERM || '').includes('alacritty') || env.ALACRITTY_WINDOW_ID) return { name: 'Alacritty', draws: null };
  return { name: env.TERM_PROGRAM || env.TERM || 'unknown', draws: null };
}

export function runDoctor(env = process.env) {
  const out = [];
  const p = s => out.push(s);

  p('');
  p(`${BOLD}Pixel Pro Golf — glyph & font doctor${R}`);
  p(`${DIM}Run in the terminal where Claude Code's status line appears. Below is EVERY`);
  p(`glyph the renderer can draw at each tier. Each should be a SOLID two-colour`);
  p(`block. Any hollow box (tofu) or "?" is a glyph this terminal cannot draw — and`);
  p(`the same cell will be tofu in the game. Note which U+.... run breaks.${R}`);

  // halfblock
  const hb = tierCodepoints(TIERS.halfblock);
  p('');
  p(`${WHITE}halfblock${R}  1x2 — ${DIM}Block Elements; the universal fallback${R}`);
  for (const line of glyphRows([...hb.bmp, ...hb.smp])) p(line);

  // quadrant
  const qd = tierCodepoints(TIERS.quadrant);
  p('');
  p(`${WHITE}quadrant${R}  2x2 — ${DIM}Block Elements U+2596..U+259F (+ halves)${R}`);
  for (const line of glyphRows([...qd.bmp, ...qd.smp])) p(line);

  // sextant
  const sx = tierCodepoints(TIERS.sextant);
  p('');
  p(`${WHITE}sextant${R}  2x3 — ${DIM}${sx.smp.length} glyphs U+1FB00..U+1FB3B (Unicode 13) + ${sx.bmp.length} block-element halves${R}`);
  for (const line of glyphRows(sx.smp)) p(line);
  p(`    ${DIM}${hex(sx.bmp[0] || 0x258c)}${R}  ` + sx.bmp.map((cp, j) => (j % 2 ? B : A) + String.fromCodePoint(cp)).join('') + R + `   ${DIM}(${sx.bmp.map(hex).join(' ')})${R}`);

  p('');
  p(`  ${DIM}ruler   ....:....1....:....2    tofu looks like  ▯ □ ?  — compare against these${R}`);

  // Detection.
  const t = termInfo(env);
  const truecolor = env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit';
  const want = String(env.CCGOLF_GLYPHS || env.GOLF_GLYPHS || '').toLowerCase();
  const forced = !!TIERS[want];
  const cur = selectTier(env);
  p('');
  p(`${BOLD}This terminal${R}`);
  p(`  terminal : ${t.name}`);
  p(`  env      : TERM=${env.TERM || '?'}  COLORTERM=${env.COLORTERM || '(unset)'}  TERM_PROGRAM=${env.TERM_PROGRAM || '(unset)'}${env.MSYSTEM ? '  MSYSTEM=' + env.MSYSTEM : ''}`);
  p(`  colour   : ${truecolor ? '24-bit advertised (COLORTERM)' : '24-bit not advertised — most modern terminals still do it; the blocks above are truecolor'}`);
  p(`  renderer : will use ${BOLD}${cur.name}${R} ${DIM}(${forced ? 'from CCGOLF_GLYPHS=' + want : 'default; CCGOLF_GLYPHS not set'})${R}`);

  // Verdict.
  p('');
  p(`${BOLD}What to do${R}`);
  p(`  ${WHITE}halfblock${R} works in every terminal and font. It is the default and needs no`);
  p(`  setup. (If even the halfblock row is tofu, your locale is not UTF-8.)`);
  p('');
  p(`  ${WHITE}sextant${R} is the sharpest tier but opt-in, because whether it renders is a`);
  p(`  property of your TERMINAL, not just your font: the glyphs may well exist on`);
  p(`  the system (on Windows the CJK fonts MingLiU-ExtB and Microsoft YaHei carry`);
  p(`  the whole block) yet still show as tofu if the terminal will not fall back to`);
  p(`  a font that has them. A status line cannot probe that — only your eyes on the`);
  p(`  rows above can. So:`);
  if (t.draws === true) {
    p(`    ${YELLOW}${t.name} draws these glyphs itself${R} — the sextant rows should be solid.`);
  } else if (t.draws === false) {
    p(`    ${t.name} renders from fonts (limited fallback), so sextant often tofus here.`);
  }
  p(`    ${WHITE}sextant rows solid?${R}  use it:  ${WHITE}CCGOLF_GLYPHS=sextant${R}  ${DIM}(or quadrant for 2x2)${R}`);
  p(`    ${WHITE}any tofu?${R}           keep the default halfblock.`);
  p('');
  p(`  Set it wherever Claude Code reads env. In settings.json:`);
  p(`     ${DIM}"env": { "CCGOLF_GLYPHS": "sextant" }${R}`);
  p(`  or in your shell:`);
  p(`     ${DIM}bash / zsh : export CCGOLF_GLYPHS=sextant${R}`);
  p(`     ${DIM}PowerShell : $env:CCGOLF_GLYPHS = "sextant"${R}`);
  p('');
  p(`  ${DIM}Want sextants where they tofu? Use a terminal that draws them (Windows`);
  p(`  Terminal, kitty, Ghostty), or set your terminal's primary font to one that`);
  p(`  has the block (recent Cascadia Code, GNU Unifont). Or just keep halfblock.${R}`);
  p('');

  process.stdout.write(out.join('\n') + '\n');
}
