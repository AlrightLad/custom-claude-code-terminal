// Cell-grid rasterizer. A canvas is a w x h grid of palette indices; every
// output row of the text backend covers two canvas rows (half blocks). Text
// overlays live beside the pixels so a backend can decide how to compose
// them (cells backend: replace the cell; sixel backend: draw a font).

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
  const xa = Math.max(0, x0), ya = Math.max(0, y0), xb = Math.min(c.w, x0 + w), yb = Math.min(c.h, y0 + h);
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) c.px[y * c.w + x] = v;
}

// Ellipse centred on fractional pixel coordinates with radii in pixels.
export function fillEllipse(c, cx, cy, rx, ry, v) {
  if (rx < 0.5) rx = 0.5;
  if (ry < 0.5) ry = 0.5;
  const ya = Math.max(0, Math.floor(cy - ry)), yb = Math.min(c.h - 1, Math.ceil(cy + ry));
  const xa = Math.max(0, Math.floor(cx - rx)), xb = Math.min(c.w - 1, Math.ceil(cx + rx));
  for (let y = ya; y <= yb; y++) {
    const dy = (y + 0.5 - cy) / ry;
    for (let x = xa; x <= xb; x++) {
      const dx = (x + 0.5 - cx) / rx;
      if (dx * dx + dy * dy <= 1) c.px[y * c.w + x] = v;
    }
  }
}

// Thick line as a stamped disc along the segment.
export function thickLine(c, x0, y0, x1, y1, radius, v) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillEllipse(c, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, radius, v);
  }
}

export function line(c, x0, y0, x1, y1, v) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 4096; guard++) {
    set(c, x0, y0, v);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// Text overlay in cell units. row is a text row (two pixel rows), col a cell.
export function label(c, col, row, text, fg, bg = -1) {
  c.overlays.push({ col: Math.round(col), row: Math.round(row), text, fg, bg });
}
