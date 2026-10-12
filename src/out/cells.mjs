// Backend A: ANSI text rows using half blocks. Each output row covers two
// canvas rows; a cell is U+2580 with the top pixel as foreground and the
// bottom pixel as background. Width is counted in cells, never bytes, every
// row is built to exactly `cols` cells before colour is applied, and every
// row ends with a full SGR reset.
import { sgrTables } from '../render/palette.mjs';
import { TRANSPARENT } from '../render/scene.mjs';

const ESC = '\x1b[';
const RESET = '\x1b[0m';
const UPPER = '▀', LOWER = '▄';

// Keep every text cell exactly one column wide. Anything outside printable
// ASCII (plus the middle dot and the ellipsis, both narrow everywhere) is
// replaced so width accounting cannot drift.
function sanitize(s) {
  let out = '';
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x20 && cp <= 0x7e) || cp === 0xb7 || cp === 0x2026) out += ch;
    else out += '?';
  }
  return out;
}

export function renderCells(frame, palette, mode = 'truecolor') {
  const { fg: FG, bg: BG } = sgrTables(palette, mode);
  const cols = frame.cols;
  const rows = [];

  if (frame.canvas) {
    const c = frame.canvas;
    const overlayCells = new Map(); // key row*cols+col -> {ch, fg, bg}
    for (const o of c.overlays) {
      const text = sanitize(o.text);
      for (let i = 0; i < text.length; i++) {
        const col = o.col + i;
        if (col < 0 || col >= cols || o.row < 0 || o.row * 2 >= c.h) continue;
        overlayCells.set(o.row * cols + col, { ch: text[i], fg: o.fg, bg: o.bg });
      }
    }
    for (let r = 0; r * 2 < c.h; r++) {
      let out = '';
      let curFg = null, curBg = null;
      const emit = (fg, bg, ch) => {
        if (fg !== curFg || bg !== curBg) {
          const p = [];
          if (fg !== curFg) { p.push(fg === null ? '39' : FG[fg]); curFg = fg; }
          if (bg !== curBg) { p.push(bg === null ? '49' : BG[bg]); curBg = bg; }
          out += ESC + p.join(';') + 'm';
        }
        out += ch;
      };
      for (let x = 0; x < cols; x++) {
        const ov = overlayCells.get(r * cols + x);
        const top = x < c.w ? c.px[(2 * r) * c.w + x] : TRANSPARENT;
        const bot = x < c.w && 2 * r + 1 < c.h ? c.px[(2 * r + 1) * c.w + x] : TRANSPARENT;
        if (ov) {
          const bg = ov.bg !== undefined && ov.bg >= 0 ? ov.bg : (bot !== TRANSPARENT ? bot : null);
          emit(ov.fg, bg, ov.ch);
        } else if (top === TRANSPARENT && bot === TRANSPARENT) emit(curFg, null, ' ');
        else if (top === bot) emit(curFg, top, ' ');
        else if (bot === TRANSPARENT) emit(top, null, UPPER);
        else if (top === TRANSPARENT) emit(bot, null, LOWER);
        else emit(top, bot, UPPER);
      }
      rows.push(out + RESET);
    }
  }

  for (const segs of frame.textRows) {
    // Fit on cell boundaries first, colour second.
    let used = 0;
    const fitted = [];
    for (const s of segs) {
      if (used >= cols) break;
      let t = sanitize(s.t);
      if (used + t.length > cols) t = t.slice(0, cols - used);
      used += t.length;
      fitted.push({ t, fg: s.fg, bg: s.bg });
    }
    let out = '';
    let curFg = null, curBg = null;
    for (const s of fitted) {
      const fg = s.fg === undefined || s.fg < 0 ? null : s.fg;
      const bg = s.bg === undefined || s.bg < 0 ? null : s.bg;
      if (fg !== curFg || bg !== curBg) {
        const p = [];
        if (fg !== curFg) { p.push(fg === null ? '39' : FG[fg]); curFg = fg; }
        if (bg !== curBg) { p.push(bg === null ? '49' : BG[bg]); curBg = bg; }
        out += ESC + p.join(';') + 'm';
      }
      out += s.t;
    }
    rows.push(out + RESET);
  }
  return rows.join('\n');
}

// Visible width of a rendered row in cells (for the harness and tests).
export function cellWidth(row) {
  let n = 0;
  const stripped = row.replace(/\x1b\[[0-9;]*m/g, '');
  for (const ch of stripped) n += 1;
  return n;
}
