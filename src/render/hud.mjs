// HUD typography: the status row as fixed-width colour chips, the wind glyph
// and the three-row scorecard. Every field has a fixed column width so values
// never jitter between frames.
import { scoreName, toParText } from '../sim/golf.mjs';
import { dist } from '../util/rng.mjs';

const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗']; // 0 = screen right, then clockwise

// Arrow points where the wind blows TO; three-cell bar for strength.
export function windGlyph(hole, R) {
  const oct = Math.round(hole.wind.dir / (Math.PI / 4)) & 7;
  const speed = hole.wind.speed;
  const level = speed <= 0 ? 0 : speed < 5 ? 1 : speed < 11 ? 2 : 3;
  const bars = ['▂', '▄', '▆'];
  const segs = [{ t: speed > 0 ? ARROWS[oct] : '·', fg: R.info }];
  for (let i = 0; i < 3; i++) segs.push({ t: bars[i], fg: i < level ? R.info : R.chipD });
  return segs;
}

function chip(text, width, fg, bg) {
  const t = text.length > width ? text.slice(0, width) : text.padEnd(width);
  return { t: ' ' + t + ' ', fg, bg };
}
const GAP = { t: ' ', fg: -1, bg: -1 };

// cols: available cells. Returns an array of segments.
export function statusRow({ hole, h, cols, R, toPar, thru, cad, quip, framed }) {
  const cur = h.shots[h.shots.length - 1];
  const dPin = dist(h.ball, hole.pin);
  const putting = h.lie === 'green' || (h.lie === 'fringe' && dPin < 12);
  const distText = putting ? `${Math.round(dPin * 3)}ft` : `${Math.round(dPin)}y`;
  const inPlayPhase = h.phase === 'flight' || h.phase === 'result';
  const strokeNo = h.strokes + (inPlayPhase || h.phase === 'holed' ? 0 : 1);
  let club = '', value = '';
  if (h.phase === 'stand') { club = ''; value = distText.padStart(5) + ' · waiting'; }
  else if (h.phase === 'tee') { club = h.par === 3 ? '' : 'D'; value = 'on the tee'; }
  else if (h.phase === 'holed') { club = ''; value = scoreName(hole.par, h.strokes); }
  else if (inPlayPhase && cur) { club = cur.club === 'PT' ? 'PT' : cur.club; value = cur.label ? cur.label : 'in play'; }
  else { club = ''; value = distText.padStart(5) + ' to pin'; }
  const scoreFg = toPar < 0 ? R.bad : toPar > 0 ? R.info : R.text;
  const segs = [];
  if (!framed) { segs.push(chip(`H${String(hole.no).padStart(2, '0')}`, 3, R.accent, R.chipA), GAP); }
  if (cols >= 70) segs.push(chip(`par ${hole.par} ${String(hole.length).padStart(3)}y`, 10, R.text, R.chipD), GAP);
  segs.push(chip(`${club.padEnd(2)} ${value}`, 14, R.text, R.chipB), GAP);
  segs.push({ t: ' ', fg: R.info, bg: R.chipC }, ...windGlyph(hole, R).map(s => ({ ...s, bg: R.chipC })), { t: ' ', fg: R.info, bg: R.chipC }, GAP);
  segs.push(chip(`stroke ${strokeNo}`, 8, R.textDim, R.chipD), GAP);
  segs.push(chip(`${toParText(toPar).padStart(3)} thru ${String(thru).padStart(2)}`, 11, scoreFg, R.chipA));
  // Caddie remark when there is room.
  let used = segs.reduce((n, s) => n + s.t.length, 0);
  if (quip && cad && cols - used >= 18) {
    const room = cols - used - 1;
    const line = `${cad.name}: ${quip}`;
    segs.push(GAP, { t: line.length > room ? line.slice(0, Math.max(0, room - 1)) + '…' : line, fg: R.textDim });
  }
  return segs;
}

function scoreFg(par, s, R) {
  const d = s - par;
  return d < 0 ? R.bad : d === 0 ? R.text : d === 1 ? R.info : R.textDim;
}

// Live leaderboard when subagents are in play: rank, name, thru, to-par, one
// row each, main golfer highlighted, sorted best first. Fills `rows` rows.
export function leaderboardRows({ board, cols, R, rows }) {
  const out = [];
  out.push([{ t: ' LEADERBOARD', fg: R.accent }, { t: '  name       thru   to par', fg: R.textDim }]);
  const shown = board.slice(0, Math.max(1, rows - 1));
  for (let i = 0; i < shown.length; i++) {
    const r = shown[i];
    const nm = (r.name.length > 9 ? r.name.slice(0, 9) : r.name).padEnd(9);
    const tp = r.toPar === 0 ? 'E' : toParText(r.toPar);
    const fg = r.toPar < 0 ? R.bad : r.toPar > 0 ? R.info : R.text;
    const seg = [
      { t: ` ${String(i + 1)}. `, fg: R.textDim, bg: r.main ? R.chipB : -1 },
      { t: nm + ' ', fg: r.main ? R.accent : R.text, bg: r.main ? R.chipB : -1 },
      { t: `${String(r.thru).padStart(2)}    `, fg: R.textDim, bg: r.main ? R.chipB : -1 },
      { t: `${tp.padStart(4)}`, fg, bg: r.main ? R.chipB : -1 },
      { t: r.playing ? '  playing' : r.retiring ? '  done' : '', fg: R.textDim, bg: r.main ? R.chipB : -1 },
    ];
    out.push(seg);
  }
  while (out.length < rows) out.push([{ t: '', fg: -1 }]);
  return out.slice(0, rows);
}

// Three rows: hole numbers, pars, strokes. Nines are separated by a gap,
// OUT/IN/TOT columns appear when there is room, the current hole is
// highlighted in all three rows.
export function scorecard({ st, pars, cols, R }) {
  const wide = cols >= 84;
  const cell = 3;
  const label = wide ? 5 : 4;
  const rows = [[], [], []];
  const L = (t, fg) => ({ t: t.padEnd(label), fg });
  rows[0].push(L('hole', R.textDim)); rows[1].push(L('par', R.textDim)); rows[2].push(L(wide ? 'score' : 'sc', R.textDim));
  let out = 0, inn = 0, parOut = 0, parIn = 0, thruOut = 0, thruIn = 0;
  for (let i = 0; i < 18; i++) {
    const sc = st.scores[i];
    const isCur = i === st.holeIdx;
    const bg = isCur ? R.chipB : -1;
    rows[0].push({ t: String(i + 1).padStart(cell), fg: isCur ? R.text : R.textDim, bg });
    rows[1].push({ t: String(pars[i]).padStart(cell), fg: R.textDim, bg });
    if (sc) {
      rows[2].push({ t: String(sc.s).padStart(cell), fg: scoreFg(sc.par, sc.s, R), bg });
      if (i < 9) { out += sc.s; parOut += sc.par; thruOut++; } else { inn += sc.s; parIn += sc.par; thruIn++; }
    } else if (isCur) {
      rows[2].push({ t: (st.hole.strokes ? String(st.hole.strokes) : '·').padStart(cell), fg: R.text, bg });
    } else rows[2].push({ t: '-'.padStart(cell), fg: R.chipD, bg });
    if (i === 8) {
      if (wide) {
        rows[0].push({ t: '  OUT', fg: R.textDim }); rows[1].push({ t: String(pars.slice(0, 9).reduce((a, b) => a + b, 0)).padStart(5), fg: R.textDim });
        rows[2].push({ t: (thruOut ? String(out) : '-').padStart(5), fg: R.text });
      } else { for (const r of rows) r.push({ t: ' ', fg: -1 }); }
    }
  }
  const total = out + inn, parTotal = parOut + parIn, played = thruOut + thruIn;
  const vs = played ? toParText(total - parTotal) : '';
  if (wide) {
    rows[0].push({ t: '   IN', fg: R.textDim }, { t: '  TOT', fg: R.textDim });
    rows[1].push({ t: String(pars.slice(9).reduce((a, b) => a + b, 0)).padStart(5), fg: R.textDim }, { t: String(pars.reduce((a, b) => a + b, 0)).padStart(5), fg: R.textDim });
    rows[2].push({ t: (thruIn ? String(inn) : '-').padStart(5), fg: R.text }, { t: (played ? String(total) : '-').padStart(5), fg: R.text });
    rows[2].push({ t: vs.padStart(4), fg: played ? (total - parTotal < 0 ? R.bad : total - parTotal > 0 ? R.info : R.text) : R.textDim });
  } else {
    rows[0].push({ t: '  TOT', fg: R.textDim });
    rows[1].push({ t: String(pars.reduce((a, b) => a + b, 0)).padStart(5), fg: R.textDim });
    rows[2].push({ t: (played ? String(total) : '-').padStart(5), fg: R.text }, { t: vs.padStart(4), fg: R.text });
  }
  return rows;
}
