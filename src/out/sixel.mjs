// Backend B: Sixel. STUB.
//
// Phase 0 (docs/PROBE.md, P0.4) showed that Claude Code strips DCS sequences
// from status line output in both mintty and Windows Terminal, in both the
// fullscreen and the default renderer. A Sixel frame therefore cannot be
// printed from the status line command itself.
//
// The intended shape, when a sidecar exists: a long-lived process that owns
// a real TTY (a split pane or a second window) receives the same frame the
// cells backend receives, scales the palette canvas up by an integer factor,
// and emits one DCS q ... ST image per repaint. The status line would then
// print only the HUD text rows. Until that process exists this module keeps
// the interface so the entry point can select a backend by name.

export const name = 'sixel';

// The status line cannot carry DCS; a sidecar would report true here.
export function supported() {
  return false;
}

// frame: { cols, canvas: { w, h, px, overlays }, textRows }
// palette: { rgb: [[r,g,b], ...] }
// opts: { scale: integer pixel scale, fontRenderer: (overlay) => pixels }
export function renderSixel(frame, palette, opts = {}) {
  void frame; void palette; void opts;
  throw new Error('sixel backend is a stub: the status line strips DCS (docs/PROBE.md P0.4)');
}
