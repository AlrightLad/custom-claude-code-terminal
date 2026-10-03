#!/usr/bin/env node
// Summarise ~/.claude/golf/probe/ticks.log written by probe.mjs.
// usage: node harness/probe-stats.mjs [sid8] [fromEpochMs] [toEpochMs]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const [, , want, from, to] = process.argv;
const f = path.join(os.homedir(), '.claude', 'golf', 'probe', 'ticks.log');
const rows = fs.readFileSync(f, 'utf8').trim().split('\n').map(l => l.split('\t'))
  .map(([t, sid, c, l, m, h]) => ({ t: Number(t), sid, c, l, m, h }))
  .filter(r => (!want || r.sid === want) && (!from || r.t >= Number(from)) && (!to || r.t <= Number(to)));
const bySid = new Map();
for (const r of rows) { if (!bySid.has(r.sid)) bySid.set(r.sid, []); bySid.get(r.sid).push(r); }
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
for (const [sid, rs] of bySid) {
  rs.sort((a, b) => a.t - b.t);
  const d = [];
  for (let i = 1; i < rs.length; i++) d.push(rs[i].t - rs[i - 1].t);
  d.sort((a, b) => a - b);
  const span = (rs[rs.length - 1].t - rs[0].t) / 1000;
  const hosts = [...new Set(rs.map(r => r.h))].join(',');
  const cols = [...new Set(rs.map(r => r.c + 'x' + r.l))].join(',');
  if (!d.length) { console.log(`${sid}  n=${rs.length} (single tick) host=${hosts} size=${cols}`); continue; }
  const hist = {};
  for (const x of d) { const b = x < 100 ? '<100' : x < 300 ? '100-299' : x < 600 ? '300-599' : x < 1000 ? '600-999' : x < 1500 ? '1000-1499' : x < 3000 ? '1500-2999' : '>=3000'; hist[b] = (hist[b] || 0) + 1; }
  console.log(`${sid}  n=${rs.length} span=${span.toFixed(0)}s host=${hosts} size=${cols}`);
  console.log(`  interval ms: min=${d[0]} p25=${q(d, .25)} median=${q(d, .5)} p75=${q(d, .75)} p95=${q(d, .95)} max=${d[d.length - 1]}  rate=${(rs.length / span).toFixed(2)}/s`);
  console.log('  histogram: ' + Object.entries(hist).map(([k, v]) => `${k}:${v}`).join('  '));
}
