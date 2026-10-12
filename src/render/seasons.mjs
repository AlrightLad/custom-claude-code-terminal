// Seasons and weather. A season is a data file in assets/seasons/ that
// overrides palette roles, chooses wardrobe and props, sets weather
// probabilities and scales the shot physics. The season comes from the
// system date and hemisphere unless CCGOLF_SEASON forces one; golden hour
// comes from the local clock. Everything here is resolved once per process
// (one JSON read per file), never per frame.
import fs from 'node:fs';
import { rngFor } from '../util/rng.mjs';

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
    lowSun: !!w.lowSun, longShadows: !!w.longShadows,
  };
}

// Particles: rain streaks, drifting snow, blowing leaves. Deterministic from
// the clock; drawn over the picture last. Cheap: a few dozen points.
export function drawWeather(c, weather, now, R, tier, windDir) {
  const n = Math.max(8, Math.floor(c.w / 6));
  const dx = Math.cos(windDir) * 0.4;
  if (weather.rain) {
    for (let i = 0; i < n; i++) {
      const h = hash(i, 11);
      const x = Math.floor((h * c.w + now / 18 * dx) % c.w + c.w) % c.w;
      const y = Math.floor((hash(i, 23) * c.h + now / 40) % c.h);
      c.px[y * c.w + x] = R.waterLight;
      if (y + 1 < c.h) c.px[(y + 1) * c.w + x] = R.waterLight;
    }
  }
  if (weather.snow) {
    for (let i = 0; i < n; i++) {
      const h = hash(i, 31);
      const x = Math.floor((h * c.w + now / 60 * (dx + 0.3) + Math.sin(now / 900 + i) * 2) % c.w + c.w) % c.w;
      const y = Math.floor((hash(i, 47) * c.h + now / 110) % c.h);
      c.px[y * c.w + x] = R.white;
    }
  }
  if (weather.leaves) {
    for (let i = 0; i < Math.floor(n / 2); i++) {
      const h = hash(i, 59);
      const x = Math.floor((h * c.w + now / 25 * (dx + 0.6)) % c.w + c.w) % c.w;
      const y = Math.floor((hash(i, 67) * c.h + Math.sin(now / 500 + i * 1.7) * 1.5) % c.h + c.h) % c.h;
      c.px[y * c.w + x] = (i & 1) ? R.treeLight : R.tree;
    }
  }
}

function hash(i, salt) {
  let n = (Math.imul(i + 1, 374761393) + Math.imul(salt, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
