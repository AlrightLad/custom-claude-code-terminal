# Art direction

The standard every art change is checked against. Derived from the Pixel Pro
Golf reference screenshot and the 8/16-bit top-down golf lineage (HAL's Hole in
One Golf, Mario Golf GBC, NES-era top-down sports), adapted to the hard limits
of a Claude Code status line: ~2 colours per cell, half/quadrant/sextant glyphs,
1–3 fps, a wide short letterbox.

Honest scope: we do not match a 1280×2300 60fps RGB render and do not try. We
match its **style decisions** — outlines, value ladder, coordinated ramps,
shadow discipline, stripe treatment — which are what make it read as drawn.

References are not committed (third-party App Store/Play screenshots are
copyrighted and this repo is public MIT); they are kept locally and described
here instead.

## Rules

1. **Black 1px outlines** on every tree, bush, prop and sprite, once the object
   is big enough to carry one (≥3 cells). Small objects get a bottom/side dark
   edge instead of a full ring. Outlines are what make art read as drawn rather
   than generated.
2. **Camera.** The reference looks down the line of play. A status line is a
   wide short letterbox, so a true down-the-hole recede does not fit; the chosen
   compromise is a *raked top-down*: hole runs along the width, with a gentle
   lateral perspective (near side lower/expanded, far side higher/compressed)
   and depth cues (taller near trees), plus a corner minimap for the whole hole.
   Pure side-on flat top-down is the fallback (`CCGOLF_VIEW=flat`).
3. **Trees** are overlapping rounded clumps forming a continuous mass at the
   frame edge: two-tone (lighter crown upper-left, darker lower-right), black
   outline, small trunk nubs. Not scattered single sprites.
4. **Particles = coordinated speckle confined to a band.** The reference's rough
   flowers work because they are dense, regular, confined to the rough, and use
   one warm ramp against dark green. Every particle type obeys: confined to its
   band, dense not sparse, one season-palette ramp, never a saturated dot on top.
5. **Aggressive value ladder.** Bunkers near-white, rough dark, fairway and
   green clearly separated. Greyscale minimum step widened to 0.04. The hole
   must read instantly in greyscale (`node harness/greyscale.mjs`).
6. **Mowing stripes** run ALONG the line of play (lateral bands), a tiny value
   step (fairway vs fairwayDark only), low contrast. Never across the play line
   at high contrast — that reads as a picket fence.
7. **Green complex:** irregular organic edge (not a clean oval), a collar ring
   in an intermediate value, a slope-arrow hint on the surface, a drop shadow.
8. **Drop shadow** under every object, one consistent direction (down-right,
   light from upper-left), soft/1-cell.
9. **HUD:** chunky panels, one accent colour aligned to the active theme, white
   text, dark-backed chips. Already close; keep.

## Luminance ladder (approximate, augusta, 0–1)

water 0.02 < trees 0.05 < rough 0.12 < fairway 0.33 < green 0.64 < sand 0.82 <
ball 0.96. Each material has a 3-tone ramp (dark/base/light) bracketing its base;
`harness/greyscale.mjs` asserts the order and the ≥0.04 steps.

## How a task reports done

State which rule number it satisfies and attach a before/after via
`node harness/visual-diff.mjs --png` (the per-cell change % must be non-trivial
for a change that claims a surface). Run `greyscale.mjs` and `sprites.mjs`
(silhouette) FIRST after the change, not at the end of a batch.

## What the frames prove (and don't)

Every image under `docs/frames/` — the baselines, the review montage, every
`sextant` frame — is produced by this project's own rasterizer
(`harness/raster-frame.mjs` maps each glyph to its subpixel mask and paints the
pixels). **No terminal is involved**, and crucially the rasterizer paints every
glyph in a fixed-size cell — it cannot model what a real terminal does with glyph
*width*. So these images prove what the renderer *intends*, not what any given
terminal will *display*. A `sextant` frame looks perfect here even though, in
mintty, the same scene is broken: the Legacy Computing glyphs are present and
render solid, but mintty draws them **double-width** (two cells each, from a CJK
fallback font), so the grid shreds. Our rasterizer gives every glyph one cell and
can never show that. Treat the montage as the art spec, and
`node src/statusline.mjs --doctor` (which measures real glyph width via CSI 6n)
plus an actual terminal frame as the check of what ships. This is why the default
tier is `halfblock` and the art is tuned there — see the README "Glyph tiers and
fonts" section.
