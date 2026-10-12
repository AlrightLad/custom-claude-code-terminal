// Subpixel framebuffer. A canvas is a w x h grid of palette indices where
// w = cells * tier.sx and h = rows * tier.sy; the cells backend quantizes
// each tier.sx x tier.sy block to two colours and a glyph. Text overlays
// live beside the pixels in cell units so a backend can decide how to
// compose them.

export const TRANSPARENT = 255;

export function makeCanvas(w, h, fill = 0) {
  return { w, h, px: new Uint8Array(w * h).fill(fill), overlays: [] };
}

export function set(c, x, y, v) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  c.px[y * c.w + x] = v;
}

export function get(c, x, y) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return -1;
  return c.px[y * c.w + x];
}

export function fillRect(c, x0, y0, w, h, v) {
  const xa = Math.max(0, Math.round(x0)), ya = Math.max(0, Math.round(y0));
  const xb = Math.min(c.w, Math.round(x0 + w)), yb = Math.min(c.h, Math.round(y0 + h));
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) c.px[y * c.w + x] = v;
}

// Ellipse centred on fractional pixel coordinates with radii in pixels.
// `shade(x, y)` may return a different index per pixel for textures.
export function fillEllipse(c, cx, cy, rx, ry, v, shade = null) {
  if (rx < 0.5) rx = 0.5;
  if (ry < 0.5) ry = 0.5;
  const ya = Math.max(0, Math.floor(cy - ry)), yb = Math.min(c.h - 1, Math.ceil(cy + ry));
  const xa = Math.max(0, Math.floor(cx - rx)), xb = Math.min(c.w - 1, Math.ceil(cx + rx));
  for (let y = ya; y <= yb; y++) {
    const dy = (y + 0.5 - cy) / ry;
    for (let x = xa; x <= xb; x++) {
      const dx = (x + 0.5 - cx) / rx;
      if (dx * dx + dy * dy <= 1) c.px[y * c.w + x] = shade ? shade(x, y) : v;
    }
  }
}

// Thick line as a stamped ellipse along the segment; rx/ry in pixels so
// anisotropic tiers keep a round brush.
export function thickLine(c, x0, y0, x1, y1, rx, ry, v, shade = null) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillEllipse(c, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, rx, ry, v, shade);
  }
}

export function line(c, x0, y0, x1, y1, v) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 8192; guard++) {
    set(c, x0, y0, v);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// Nearest-neighbour upscale by integer-or-half factors (fx, fy), used to lift
// a half-block-resolution drawing onto a finer tier.
export function upscale(src, fx, fy) {
  const w = Math.round(src.w * fx), h = Math.round(src.h * fy);
  const out = makeCanvas(w, h, TRANSPARENT);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.h - 1, Math.floor(y / fy));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.w - 1, Math.floor(x / fx));
      out.px[y * w + x] = src.px[sy * src.w + sx];
    }
  }
  out.overlays = src.overlays;
  return out;
}

// Text overlay in cell units. row is a text row, col a cell.
export function label(c, col, row, text, fg, bg = -1) {
  c.overlays.push({ col: Math.round(col), row: Math.round(row), text, fg, bg });
}

// 4x4 Bayer threshold in [0, 1), for ordered dithering at texture edges.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function bayer(x, y) {
  return (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
}
