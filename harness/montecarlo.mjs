#!/usr/bin/env node
// Plays many rounds with the shot model and reports the handicap profile.
// usage: node harness/montecarlo.mjs [rounds=400] [seedPrefix=mc]
import { genHole } from '../src/gen/course.mjs';
import { newHole, takeShot, scoreName } from '../src/sim/golf.mjs';

const rounds = Number(process.argv[2]) || 400;
const prefix = process.argv[3] || 'mc';
const agg = { rounds: 0, strokes: 0, par: 0, holes: 0, gir: 0, fir: 0, firHoles: 0, putts: 0, threePutt: 0,
  scramble: 0, scrambleTry: 0, teeTrouble: 0, teeShots: 0, ob: 0, water: 0, names: {}, dist: [], maxHole: 0, labels: {} };
for (let r = 0; r < rounds; r++) {
  const sid = `${prefix}-${r}`;
  let total = 0, parTotal = 0;
  for (let n = 1; n <= 18; n++) {
    const hole = genHole(sid, n);
    const h = newHole(n, hole.par);
    let guard = 0;
    while (!h.holed && h.strokes < 12 && guard++ < 20) {
      const s = takeShot(h, hole, sid, 1);
      if (s.n === 1 && hole.par > 3) {
        agg.teeShots++;
        if (['trees', 'water', 'ob', 'bunker'].includes(s.lie) || s.pen) agg.teeTrouble++;
      }
      if (s.label === 'OB +1') agg.ob++;
      if (s.label === 'WATER +1') agg.water++;
      agg.labels[s.label || 'ok'] = (agg.labels[s.label || 'ok'] || 0) + 1;
    }
    if (!h.holed) h.strokes = 12;
    total += h.strokes; parTotal += hole.par;
    agg.holes++; agg.putts += h.putts;
    if (h.gir) agg.gir++;
    if (hole.par > 3) { agg.firHoles++; if (h.fir) agg.fir++; }
    if (h.putts >= 3) agg.threePutt++;
    if (!h.gir) { agg.scrambleTry++; if (h.strokes <= hole.par) agg.scramble++; }
    const nm = scoreName(hole.par, h.strokes); agg.names[nm] = (agg.names[nm] || 0) + 1;
    agg.maxHole = Math.max(agg.maxHole, h.strokes);
  }
  agg.rounds++; agg.strokes += total; agg.par += parTotal; agg.dist.push(total - parTotal);
}
agg.dist.sort((a, b) => a - b);
const pct = (a, b) => (100 * a / b).toFixed(1) + '%';
console.log(`rounds ${agg.rounds}  avg score ${(agg.strokes / agg.rounds).toFixed(1)}  avg to par +${(agg.strokes - agg.par) / agg.rounds}  (target +12..+15)`);
console.log(`to-par distribution: min ${agg.dist[0]}  p10 ${agg.dist[Math.floor(agg.dist.length * .1)]}  median ${agg.dist[Math.floor(agg.dist.length / 2)]}  p90 ${agg.dist[Math.floor(agg.dist.length * .9)]}  max ${agg.dist[agg.dist.length - 1]}`);
console.log(`GIR ${pct(agg.gir, agg.holes)} (target 30%)   FIR ${pct(agg.fir, agg.firHoles)}   3-putt ${pct(agg.threePutt, agg.holes)} (target 15%)   scrambling ${pct(agg.scramble, agg.scrambleTry)} (target 30%)   putts/hole ${(agg.putts / agg.holes).toFixed(2)}`);
console.log(`tee shots in trouble ${pct(agg.teeTrouble, agg.teeShots)} (target 12.5%)   OB per tee shot ${pct(agg.ob, agg.teeShots)} (target 2%)   water per round ${(agg.water / agg.rounds).toFixed(2)}   worst hole ${agg.maxHole}`);
const per18 = Object.entries(agg.names).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / agg.rounds).toFixed(1)}`).join('  ');
console.log(`per 18: ${per18}   (target birdie 1 / par 6 / bogey 8 / double 3)`);
console.log('shot labels: ' + Object.entries(agg.labels).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${(v / agg.rounds).toFixed(1)}`).join('  '));
