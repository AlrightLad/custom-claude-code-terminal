// Deterministic randomness. Everything in the game derives from a string seed
// so a hole, a caddie or a shot can be replayed from a session id alone.

export function hash32(str) {
  // FNV-1a over UTF-16 code units, then a murmur-style finalizer.
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// rngFor('session', 7, 'shot', 3) -> a generator unique to that tuple.
export function rngFor(...parts) {
  return mulberry32(hash32(parts.join('|')));
}

export function gauss(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
export const range = (rnd, lo, hi) => lo + (hi - lo) * rnd();
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
