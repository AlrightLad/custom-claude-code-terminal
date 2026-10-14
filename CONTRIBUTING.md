# Contributing

The renderer is deliberately **data-driven**: the course palettes, the four
seasons, the holidays, the caddies, the golfer and the spinner verbs are all JSON
files under `assets/`. The most useful contributions — a new theme, a tuned
season, a new holiday — are **pure data files and need no source changes**. This
guide covers those three, plus how to run the checks before you open a PR.

Prerequisites: Node 18+ and `bash` (Git Bash on Windows). No `npm install` — the
project has zero runtime dependencies.

Preview any change without Claude Code:

    node src/demo.mjs --theme <name> --season <name>

---

## Add a theme (course palette)

A theme is one file: `assets/palettes/<name>.json`. It is selected at runtime with
`CCGOLF_THEME=<name>` (the filename, lowercased) — `loadPalette()` reads it by
name, so **adding the file is all it takes**; there is no list to edit.

Shape:

```json
{
  "name": "mytheme",
  "notes": "One line on the look and the luminance ladder.",
  "colors": [ { "name": "water", "hex": "#050d23" }, { "name": "fairway", "hex": "#66ad40" }, ... ],
  "roles":  { "fairway": "fairway", "rough": "rough", "shirts": ["shirtBlue", "shirtRed"], ... },
  "frame":  { }
}
```

- `colors` is a palette of named swatches. The names are arbitrary labels.
- `roles` maps every semantic role the renderer draws (`fairway`, `rough`,
  `green`, `sand`, `tree`, `water`, `flag`, `outline`, `text`, `accent`, …) to a
  colour name (or index). List roles — `shirts`, `pants`, `bags` — are arrays the
  golfers pick from. The renderer only ever asks for roles, so a theme can remap
  freely.

**Easiest path:** copy `assets/palettes/augusta.json`, keep every key in `roles`,
and recolour the `colors`. Don't drop roles — a missing role renders wrong.

**Hard requirement — the luminance ladder.** The hole must read in greyscale:

```
water < trees < rough < fairway < green < sand < ball
```

with each step ≥ 0.04 in luminance. `harness/greyscale.mjs` discovers every
palette in `assets/palettes/` automatically and asserts this. Your theme must
pass it:

    node harness/greyscale.mjs

See `docs/ART-DIRECTION.md` for the full value ladder and the reasoning.

---

## Customize a season

There are exactly four seasons — `winter`, `spring`, `summer`, `fall` — fixed
because they map to calendar months in `assets/seasons/calendar.json` (per
hemisphere). You don't add a fifth; you **tune a season's data file**,
`assets/seasons/<name>.json`. Preview with `CCGOLF_SEASON=<name>` (or `none`).

Shape (every block optional except `name`):

```json
{
  "name": "spring",
  "palette":  { "fairway": "#63b840", "treeLight": "#e9a7c9" },
  "golden":   { "fairway": "#7fb84a" },
  "weather":  { "rain": 0.35, "blossom": 0.5, "flowers": 0.8 },
  "sim":      { "carry": 0.98, "roll": 0.7 },
  "wardrobe": { "hat": "cap", "umbrellaInRain": true },
  "props":    { "birds": 0.5, "benches": true }
}
```

- `palette` overrides the active theme's colours **by role name** (merged on top).
- `golden` overrides apply additionally during golden hour (`calendar.json`
  `goldenHours`).
- `weather` values are per-hole probabilities (`rain`, `overcast`, `snow`,
  `leaves`, `blossom`, `flowers`). Force one for a screenshot with
  `CCGOLF_WEATHER=snow` (or `clear`).
- `sim` scales shot physics; `wardrobe` and `props` pick sprite details.

A season recolour must still pass `node harness/greyscale.mjs` against each theme
it layers on, and keep particles confined to the rough (art-direction rule 4).

---

## Add a holiday

A holiday is one file: `assets/holidays/<name>.json`. Holidays are
**auto-discovered** (every `*.json` in that directory), so adding the file is all
it takes. A holiday activates when today falls inside its date window and merges
on top of the current season. Preview with `CCGOLF_HOLIDAY=<name>` (or `none`).

Shape:

```json
{
  "name": "christmas",
  "notes": "One line on the look.",
  "window":   { "from": "12-18", "to": "12-31" },
  "palette":  { "frame": "#c0392b", "treeLight": "#e8f0f4" },
  "weather":  { "snow": 0.9 },
  "wardrobe": { "hat": "knit", "breath": true },
  "props":    { "birds": 0.2 }
}
```

- `window` is `MM-DD`..`MM-DD`, inclusive, and may wrap the year end
  (e.g. `12-28`..`01-02`). When two windows overlap today, the one with the
  **nearest start** wins.
- `palette` / `weather` / `wardrobe` / `props` work exactly as in a season and
  merge on top of it.

---

## Before you open a PR

Run the checks that apply to your change (all are plain Node/bash, no deps):

    node harness/greyscale.mjs        # value ladder for every theme (themes/seasons)
    node harness/visual-diff.mjs      # canonical scenes vs committed baselines
    node harness/sprites.mjs          # sprite silhouettes
    node src/statusline.mjs --doctor  # glyph tiers + width in your terminal
    bash harness/verify-install.sh    # install/uninstall land and revert (sandboxed)

If a change intentionally alters a canonical scene, refresh the baseline with
`node harness/visual-diff.mjs --update --png` and commit the new baseline with an
explanation.

## What not to commit

This is a public MIT repo. **Do not commit third-party content**: no app-store or
gameplay screenshots, no fonts, no audio. Reference material stays local and
git-ignored (see `.gitignore`). The completion sound is fetched locally per
`assets/sound/fetch.md`, never bundled. Keep everything you add your own work or
compatibly licensed, and keep it Windows/Node-18-friendly with zero dependencies.

## Release checklist (before tagging)

Run all of this from a clean working tree; everything is plain Node/bash, no deps.

1. **Gates:**

        node harness/greyscale.mjs        # value ladder, every theme
        node harness/visual-diff.mjs      # canonical scenes vs baselines (expect 0%)
        node harness/sprites.mjs          # sprite silhouettes
        node harness/scale-check.mjs      # golfer/green proportion (200 frames, 0 failures)
        node harness/idle-check.mjs       # idle state machine (0 failures)

2. **Install round-trip** (sandboxed; never touches your real `~/.claude`):

        bash harness/verify-install.sh --self-test   # 0 failures, incl. the self-test

3. **Glyph/width doctor** — run in your terminal and read it:

        node src/statusline.mjs --doctor

4. **Clean-checkout walkthrough** — do exactly what the README says, from scratch:

        tmp=$(mktemp -d); git clone . "$tmp/cc"; cd "$tmp/cc"
        node src/demo.mjs --seconds 6        # renders a hole
        node src/statusline.mjs --doctor      # runs
        HOME=$(mktemp -d) bash install/install.sh && HOME=... bash install/uninstall.sh
        # then: cd back, rm -rf "$tmp"

5. **Third-party content check** — a public MIT repo must ship nothing third-party:

        git ls-files | grep -iE '\.(ttf|otf|woff2?|mp3|wav|ogg|m4a|jpe?g)$'   # expect: nothing
        git log --all --diff-filter=A --name-only --pretty=format: | sort -u \
          | grep -iE '\.(ttf|otf|woff2?|mp3|wav|ogg|jpe?g)$'                  # history too: nothing
        test -f LICENSE && head -1 LICENSE                                    # MIT present

   Every tracked image must be our own rasterizer output under `docs/frames/`.
   Reference material and sounds stay local and git-ignored.

6. **Tag** once all of the above is green:

        git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z
