// Backend A: ANSI text rows. The scene's subpixel framebuffer is quantized
// here: every tier.sx x tier.sy block becomes one cell with two colours and
// the block glyph whose pattern best matches. Width is counted in cells,
// never bytes; every row is built to exactly `cols` cells before colour is
// applied; every row ends with a full SGR reset.
import { sgrTables, labDistances } from '../render/palette.mjs';
import { TRANSPARENT } from '../render/raster.mjs';

const ESC = '\x1b[';
const RESET = '\x1b[0m';

// Keep every text cell exactly one column wide. Printable ASCII, the middle
// dot, the ellipsis, box drawing, arrows and the lower-block bar glyphs are
// all single-width in the terminals this targets; anything else becomes '?'.
function sanitize(s) {
  let out = '';
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x20 && cp <= 0x7e) || cp === 0xb7 || cp === 0x2026 || (cp >= 0x2500 && cp <= 0x257f)
      || (cp >= 0x2190 && cp <= 0x2199) || (cp >= 0x2581 && cp <= 0x2588) || cp === 0x25cf || cp === 0x25cb) out += ch;
    else out += '?';
  }
  return out;
}

// Quantize one cell. `sub` holds tier.n palette indices (TRANSPARENT allowed).
// Returns {mask, fg, bg} with null for the terminal default colour.
function quantizeCell(sub, n, D, scratchCounts) {
  // Count distinct colours.
  let distinct = 0, transparent = 0;
  const colors = scratchCounts.colors, counts = scratchCounts.counts;
  for (let i = 0; i < n; i++) {
    const v = sub[i];
    if (v === TRANSPARENT) { transparent++; continue; }
    let k = 0;
    for (; k < distinct; k++) if (colors[k] === v) { counts[k]++; break; }
    if (k === distinct) { colors[distinct] = v; counts[distinct] = 1; distinct++; }
  }
  if (distinct === 0) return { mask: 0, fg: null, bg: null };
  if (transparent > 0) {
    // Background stays the terminal's; pick the single foreground that best
    // represents all opaque subpixels.
    let best = colors[0], bestErr = Infinity;
    for (let a = 0; a < distinct; a++) {
      let err = 0;
      for (let b = 0; b < distinct; b++) err += counts[b] * D[colors[a] * 256 + colors[b]];
      if (err < bestErr) { bestErr = err; best = colors[a]; }
    }
    let mask = 0;
    for (let i = 0; i < n; i++) if (sub[i] !== TRANSPARENT) mask |= 1 << i;
    return { mask, fg: best, bg: null };
  }
  if (distinct === 1) return { mask: (1 << n) - 1, fg: colors[0], bg: colors[0] };
  let a = colors[0], b = colors[1];
  if (distinct > 2) {
    // Pair that minimizes total colour error when every subpixel snaps to
    // the nearer of the two.
    let bestErr = Infinity;
    for (let i = 0; i < distinct; i++) for (let j = i + 1; j < distinct; j++) {
      let err = 0;
      for (let k = 0; k < distinct; k++) {
        const da = D[colors[k] * 256 + colors[i]], db = D[colors[k] * 256 + colors[j]];
        err += counts[k] * (da < db ? da : db);
      }
      if (err < bestErr) { bestErr = err; a = colors[i]; b = colors[j]; }
    }
  }
  let mask = 0;
  for (let i = 0; i < n; i++) {
    const v = sub[i];
    const nearA = v === a ? true : v === b ? false : D[v * 256 + a] <= D[v * 256 + b];
    if (nearA) mask |= 1 << i;
  }
  return { mask, fg: a, bg: b };
}

export function renderCells(frame, palette, mode = 'truecolor', tier) {
  const { fg: FG, bg: BG } = sgrTables(palette, mode);
  const D = labDistances(palette);
  const cols = frame.cols;
  const rows = [];

  if (frame.canvas) {
    const c = frame.canvas;
    const { sx, sy, n, glyphs } = tier;
    const full = (1 << n) - 1;
    const textRows = Math.floor(c.h / sy);
    const overlayCells = new Map();
    for (const o of c.overlays) {
      const text = sanitize(o.text);
      for (let i = 0; i < text.length; i++) {
        const col = o.col + i;
        if (col < 0 || col >= cols || o.row < 0 || o.row >= textRows) continue;
        overlayCells.set(o.row * cols + col, { ch: text[i], fg: o.fg, bg: o.bg });
      }
    }
    const sub = new Uint8Array(n);
    const scratch = { colors: new Uint8Array(8), counts: new Uint16Array(8) };
    for (let r = 0; r < textRows; r++) {
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
        // gather the block
        let i = 0;
        for (let yy = 0; yy < sy; yy++) {
          const py = r * sy + yy;
          for (let xx = 0; xx < sx; xx++) {
            const px = x * sx + xx;
            sub[i++] = (px < c.w && py < c.h) ? c.px[py * c.w + px] : TRANSPARENT;
          }
        }
        const q = quantizeCell(sub, n, D, scratch);
        const ov = overlayCells.get(r * cols + x);
        if (ov) {
          const bg = ov.bg !== undefined && ov.bg >= 0 ? ov.bg : (q.bg !== null ? q.bg : (q.fg !== null && q.mask === full ? q.fg : null));
          emit(ov.fg, bg, ov.ch);
          continue;
        }
        if (q.fg === null) { emit(curFg, null, ' '); continue; }
        if (q.mask === full) { emit(curFg, q.fg, ' '); continue; }
        if (q.mask === 0) { emit(curFg, q.bg, ' '); continue; }
        emit(q.fg, q.bg, glyphs[q.mask]);
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
  for (const ch of stripped) { void ch; n += 1; }
  return n;
}
