// User-facing glyph & font diagnostic: `node src/statusline.mjs --doctor`.
//
// Unlike the status line itself — a one-shot process whose output Claude Code
// recaptures, so it can never see your terminal — this runs in your OWN terminal
// as a normal program. What you see here IS the ground truth for this terminal +
// font. It prints one probe row per rendering tier, detects the terminal and
// colour support, reports the tier the renderer will use, and says plainly what
// to set. No dependencies, no stdin, no network.
import { TIERS, selectTier } from './render/tiers.mjs';

const E = '\x1b[';
const R = E + '0m', BOLD = E + '1m', DIM = E + '2m';
// Two colours per cell, exactly like the renderer: light green on dark green and
// a sand/sky pair. A glyph the font lacks then shows as a hollow box over colour,
// which is unmistakable next to the solid cells it should be.
const A = E + '38;2;143;208;90;48;2;47;107;42m';
const B = E + '38;2;232;213;154;48;2;40;95;150m';
const WHITE = E + '38;2;235;235;235m', YELLOW = E + '38;2;255;216;74m';

// Alternate the two colour pairs across a sample so each cell is clearly two-tone.
function strip(glyphs) {
  return glyphs.map((g, i) => (i % 2 ? B : A) + g).join('') + R;
}

// Terminal name, and whether the TERMINAL draws block/legacy glyphs itself (so
// sextant is safe regardless of font). Conservative: `draws:true` only for
// terminals with documented built-in legacy-computing rendering; `null` = unsure
// (trust the probe rows above instead).
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
  p(`${DIM}Run in the terminal where Claude Code's status line appears. Every row below`);
  p(`should be SOLID two-colour blocks. Hollow boxes (tofu) or "?" mean that tier's`);
  p(`glyphs are missing here — do not use it.${R}`);
  p('');

  // Probe rows — the real Unicode blocks each tier draws from.
  const rows = [
    ['halfblock', ['▀', '▄', '█', '▀', '▄', '█'], 'U+2580 U+2584 U+2588 — Block Elements, every font'],
    ['quadrant', ['▖', '▗', '▘', '▝', '▙', '▚', '▛', '▜', '▞', '▟'], 'U+2596..U+259F — common, not universal'],
    ['sextant', ['🬀', '🬁', '🬂', '🬃', '🬄', '🬅', '🬆', '🬇', '🬞', '🬟', '🬠', '🬰', '🬻'], 'U+1FB00..U+1FB3B — Unicode 13, recent fonts only'],
  ];
  for (const [name, sample, note] of rows) {
    p(`  ${WHITE}${name.padEnd(10)}${R} ${strip(sample)}   ${DIM}${note}${R}`);
  }
  p(`  ${DIM}${'ruler'.padEnd(10)}  ....:....1....:....2....:....3    (blocks above should line up & be solid)${R}`);
  p(`  ${DIM}${'tofu'.padEnd(10)}  a missing glyph looks like  ▯ □ ?  — if the sextant row looks like`);
  p(`             that, this terminal + font cannot show sextants.${R}`);
  p('');

  // Detection.
  const t = termInfo(env);
  const truecolor = env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit';
  const want = String(env.CCGOLF_GLYPHS || env.GOLF_GLYPHS || '').toLowerCase();
  const forced = !!TIERS[want];
  const cur = selectTier(env);
  p(`${BOLD}This terminal${R}`);
  p(`  terminal : ${t.name}`);
  p(`  env      : TERM=${env.TERM || '?'}  COLORTERM=${env.COLORTERM || '(unset)'}  TERM_PROGRAM=${env.TERM_PROGRAM || '(unset)'}${env.MSYSTEM ? '  MSYSTEM=' + env.MSYSTEM : ''}`);
  p(`  colour   : ${truecolor ? '24-bit advertised (COLORTERM)' : '24-bit not advertised — most modern terminals still do it; the rows above are truecolor'}`);
  p(`  renderer : will use ${BOLD}${cur.name}${R} ${DIM}(${forced ? 'from CCGOLF_GLYPHS=' + want : 'default; CCGOLF_GLYPHS not set'})${R}`);
  p('');

  // Verdict.
  p(`${BOLD}What to do${R}`);
  p(`  ${WHITE}halfblock${R} works in every terminal and font. It is the default and needs no`);
  p(`  setup. (If even the halfblock row is tofu, your locale is not UTF-8 — fix`);
  p(`  that first, e.g. a UTF-8 LANG/LC_ALL.)`);
  p('');
  if (t.draws === true) {
    p(`  ${YELLOW}${t.name} draws block & legacy glyphs itself${R}, so the sextant row should be`);
    p(`  solid even if your font has no sextants. Go ahead and use it:`);
  } else if (t.draws === false) {
    p(`  ${t.name} renders from the font, so sextant needs a font that has the`);
    p(`  Legacy Computing block. Check the sextant row above — if it is solid, set:`);
  } else {
    p(`  Look at the rows above and use the ${WHITE}highest tier that is solid, not boxes${R}:`);
  }
  p(`     ${WHITE}CCGOLF_GLYPHS=sextant${R}   ${DIM}(or quadrant for 2x2)${R}`);
  p('');
  p(`  Set it wherever Claude Code reads env. In settings.json:`);
  p(`     ${DIM}"env": { "CCGOLF_GLYPHS": "sextant" }${R}`);
  p(`  or in your shell:`);
  p(`     ${DIM}bash / zsh : export CCGOLF_GLYPHS=sextant${R}`);
  p(`     ${DIM}PowerShell : $env:CCGOLF_GLYPHS = "sextant"${R}`);
  p('');
  p(`  ${DIM}No sextants and want them? Use a terminal that draws them (Windows Terminal,`);
  p(`  kitty, Ghostty) or install a font with Unicode "Symbols for Legacy Computing"`);
  p(`  coverage (recent Cascadia Code, GNU Unifont). Or just keep halfblock.${R}`);
  p('');

  process.stdout.write(out.join('\n') + '\n');
}
