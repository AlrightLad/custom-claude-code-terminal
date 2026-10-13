// Seasons and weather. A season is a data file in assets/seasons/ that
// overrides palette roles, chooses wardrobe and props, sets weather
// probabilities and scales the shot physics. The season comes from the
// system date and hemisphere unless CCGOLF_SEASON forces one; golden hour
// comes from the local clock. Everything here is resolved once per process
// (one JSON read per file), never per frame.
import fs from 'node:fs';
import { rngFor } from '../util/rng.mjs';
import { toAnsi256 } from './palette.mjs';

const DIR = new URL('../../assets/seasons/', import.meta.url);

function readJson(name) {
  try { return JSON.parse(fs.readFileSync(new URL(name + '.json', DIR), 'utf8')); } catch { return null; }
}

export const SEASONS = ['winter', 'spring', 'summer', 'fall'];

// Returns the season name for a date and hemisphere from calendar.json.
export function seasonFor(date, hemisphere, calendar) {
  const month = date.getMonth() + 1;
  const table = (calendar && calendar[hemisphere]) || (calendar && calendar.north) || {};
  for (const s of SEASONS) if ((table[s] || []).includes(month)) return s;
  return 'summer';
}

// Resolves {name, data, golden, weather} for the frame. `now` is epoch ms.
export function resolveSeason(env, now) {
  const forced = String(env.CCGOLF_SEASON || env.GOLF_SEASON || 'auto').toLowerCase();
  const hemisphere = /^s/i.test(String(env.CCGOLF_HEMISPHERE || 'north')) ? 'south' : 'north';
  const calendar = readJson('calendar') || {};
  const date = new Date(now);
  const name = SEASONS.includes(forced) ? forced : (forced === 'none' || forced === 'off') ? null : seasonFor(date, hemisphere, calendar);
  const data = name ? readJson(name) : null;
  const hour = date.getHours();
  const golden = !!(data && data.golden && (calendar.goldenHours || [6, 7, 18, 19]).includes(hour));
  return { name: name || 'none', data: data || { palette: {}, weather: {}, sim: {}, wardrobe: {}, props: {} }, golden, hemisphere };
}

// Applies the season's palette overrides to a loaded palette in place
// (hex strings by role name). Returns the palette.
export function applySeason(pal, season) {
  const over = { ...(season.data.palette || {}), ...(season.golden ? season.data.golden || {} : {}) };
  for (const [role, hex] of Object.entries(over)) {
    const idx = pal.roles[role];
    if (idx === undefined || Array.isArray(idx) || typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) continue;
    const n = parseInt(hex.slice(1), 16);
    pal.rgb[idx] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // ansi256 and Lab tables must follow the new colours
  pal.ansi256 = pal.rgb.map(c => {
    const [r, g, b] = c;
    if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12) { if (r < 8) return 16; if (r > 248) return 231; return 232 + Math.round((r - 8) / 247 * 23); }
    const q = v => Math.round(v / 255 * 5);
    return 16 + 36 * q(r) + 6 * q(g) + q(b);
  });
  pal._D = null; pal._lab = null;
  return pal;
}

// Weather for a hole: deterministic per (session, hole, day) so it does not
// flicker between frames. Returns {rain, snow, leaves, overcast, blossom, sea}.
export function weatherFor(season, sid, holeNo, now) {
  const day = Math.floor(now / 86400000);
  const rnd = rngFor(sid, 'weather', holeNo, day);
  const w = season.data.weather || {};
  const roll = rnd();
  return {
    rain: w.rain ? roll < w.rain : false,
    snow: w.snow ? rnd() < w.snow : false,
    leaves: w.leaves ? rnd() < w.leaves : false,
    overcast: w.overcast ? rnd() < w.overcast : false,
    blossom: w.blossom ? rnd() < w.blossom : false,
    sea: w.sea ? rnd() < w.sea : false,
    flowers: w.flowers ? rnd() < w.flowers : false,
    lowSun: !!w.lowSun, longShadows: !!w.longShadows,
  };
}

// Particles, reworked so they read as weather, not confetti (ART-DIRECTION
// rule 4 + the weather brief): streaks not dots, ONE shared angle from the
// wind, one low-contrast in-palette colour per type, sparse. Rain is barely
// there and the mood (darkenForWeather) carries it; snow is the one that works
// at this scale, so it stays prominent; leaves are streaked and confined near
// trees. Drawn over the picture last.
const TURF = (R, v) => v === R.rough || v === R.roughDark || v === R.roughLight;
function streak(c, x, y, ax, ay, len, col) {
  for (let k = 0; k < len; k++) {
    const px = Math.round(x + ax * k), py = Math.round(y + ay * k);
    if (px >= 0 && px < c.w && py >= 0 && py < c.h) c.px[py * c.w + px] = col;
  }
}
export function drawWeather(c, weather, now, R, tier, windDir) {
  // shared angle from wind; steeper when windier, always the same for every drop
  const ang = Math.atan2(0.9, Math.cos(windDir) * 0.8);
  const ax = Math.cos(ang), ay = Math.sin(ang);
  if (weather.rain) {
    const n = Math.max(4, Math.floor(c.w / 22)); // sparse
    for (let i = 0; i < n; i++) {
      const x = Math.floor((hash(i, 11) * c.w + now * 0.06 * ax) % c.w + c.w) % c.w;
      const y = Math.floor((hash(i, 23) * c.h + now * 0.10) % c.h);
      streak(c, x, y, ax, ay, 3, R.gray); // pale grey, low contrast, 3px
    }
  }
  if (weather.snow) {
    const n = Math.max(10, Math.floor(c.w / 7)); // prominent
    for (let i = 0; i < n; i++) {
      const x = Math.floor((hash(i, 31) * c.w + Math.sin(now / 900 + i) * 2 + now * 0.012) % c.w + c.w) % c.w;
      const y = Math.floor((hash(i, 47) * c.h + now * 0.03) % c.h); // slow
      c.px[y * c.w + x] = R.white;
      if (tier.sx > 1 && x + 1 < c.w) c.px[y * c.w + x + 1] = R.white; // larger flake
    }
  }
  if (weather.leaves) {
    const n = Math.max(4, Math.floor(c.w / 16));
    for (let i = 0; i < n; i++) {
      const x = Math.floor((hash(i, 59) * c.w + now * 0.05 * (ax + 0.4)) % c.w + c.w) % c.w;
      const y = Math.floor((hash(i, 67) * c.h + Math.sin(now / 500 + i) * 1.5) % c.h + c.h) % c.h;
      // only near trees/rough, so leaves do not sit as litter on fairway
      if (TURF(R, c.px[y * c.w + x]) || c.px[y * c.w + x] === R.tree) streak(c, x, y, ax, ay, 2, (i & 1) ? R.treeLight : R.trunk);
    }
  }
}

// Dense, regular warm speckle confined to the rough — the reference's real
// particle model (ART-DIRECTION rule 4). Deterministic per hole.
export function drawFlowers(c, R, seedInt) {
  const ramp = [R.flowerA, R.flowerB, R.flowerC];
  const step = 4;
  for (let y = 0; y < c.h; y += 1) for (let x = (y % 2) * 2; x < c.w; x += step) {
    if (!TURF(R, c.px[y * c.w + x])) continue;
    const r = hash(x * 131 + y * 71, seedInt | 0);
    if (r < 0.45) c.px[y * c.w + x] = ramp[(x + y) % 3];
  }
}

// Environmental mood: overcast desaturates/darkens the whole palette; rain
// deepens the turf (wetter look). Applied once to the loaded palette.
export function darkenForWeather(pal, weather) {
  const k = weather.overcast ? 0.82 : 1;
  const wet = weather.rain ? 0.9 : 1;
  if (k === 1 && wet === 1) return pal;
  const wetRoles = new Set(['fairway', 'fairwayDark', 'fairwayLight', 'green', 'greenDark', 'greenLight', 'rough', 'roughDark', 'roughLight', 'fringe']);
  const nameFor = i => Object.keys(pal.roles).find(role => pal.roles[role] === i);
  pal.rgb = pal.rgb.map((c, i) => {
    const role = nameFor(i);
    const f = k * (role && wetRoles.has(role) ? wet : 1);
    return c.map(v => Math.round(v * f));
  });
  pal.ansi256 = pal.rgb.map(toAnsi256);
  pal._D = null; pal._lab = null;
  return pal;
}

function hash(i, salt) {
  let n = (Math.imul(i + 1, 374761393) + Math.imul(salt, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
