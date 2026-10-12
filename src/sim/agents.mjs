// Subagent golfers. When the main session spawns subagents, the
// SubagentStart / SubagentStop hooks maintain a roster file per session
// (state/agents-<session_id>.json: { active: [{ id, type, started }] }).
// Each roster entry becomes a golfer playing the same hole as the main
// golfer, with its own seeded shots, colour and name. They advance by the
// same wall-clock delta while WORKING and freeze when the agent is idle.
// Everything is deterministic from (session_id, agent_id), so a screenshot
// replays from the seeds.
import fs from 'node:fs';
import path from 'node:path';
import { newHole, advanceHole, scoreName, toParText } from './golf.mjs';
import { rngFor, pick } from '../util/rng.mjs';

const NAMES = ['Alex', 'Blair', 'Casey', 'Dana', 'Ellis', 'Frankie', 'Glen', 'Harper', 'Indy', 'Jules', 'Kai', 'Lane',
  'Morgan', 'Nico', 'Owen', 'Parker', 'Quinn', 'Reese', 'Sasha', 'Toni', 'Val', 'Wren'];

function rosterPath(home, sid) {
  return path.join(home, 'state', 'agents-' + String(sid).replace(/[^A-Za-z0-9._-]/g, '_') + '.json');
}

// Reads the roster written by the hooks. Missing or corrupt = nobody.
export function readRoster(home, sid) {
  try {
    const r = JSON.parse(fs.readFileSync(rosterPath(home, sid), 'utf8'));
    return Array.isArray(r.active) ? r.active.filter(a => a && a.id) : [];
  } catch { return []; }
}

// Reconciles the session's agent golfers with the roster, then advances each
// one. New agents get a golfer on the main golfer's current hole; agents no
// longer in the roster are retired (kept ~8s so the leaderboard can say
// goodbye). Agent holes play out independently with the same shot model.
export function stepAgents(st, hole, roster, mode, dt, now) {
  if (!st.agents) st.agents = {};
  const live = new Set(roster.map(a => a.id));
  for (const a of roster) {
    if (st.agents[a.id]) { st.agents[a.id].retired = 0; continue; }
    const rnd = rngFor(st.sid, 'agent', a.id);
    st.agents[a.id] = {
      id: a.id, type: a.type || 'agent', name: pick(rnd, NAMES),
      shirt: Math.floor(rnd() * 5), skin: rnd() < 0.5 ? 0 : 1, hat: rnd() < 0.5,
      started: now, holeIdx: st.holeIdx, hole: newHole(st.hole.no, st.hole.par),
      scores: new Array(18).fill(null), retired: 0,
    };
  }
  for (const [id, g] of Object.entries(st.agents)) {
    if (!live.has(id)) { g.retired = (g.retired || 0) + dt; if (g.retired > 8000) delete st.agents[id]; continue; }
    if (mode !== 'WORKING') { continue; } // freeze with the main golfer
    const gh = g.hole;
    advanceHole(gh, hole, dt, st.sid + ':agent:' + id, 1, false);
    if (gh.phase === 'holed' && gh.pt >= 3500) {
      g.scores[g.holeIdx % 18] = { par: gh.par, s: gh.strokes };
      g.holeIdx++;
      g.hole = newHole((g.holeIdx % 18) + 1, hole.par); // same course par set is close enough for a race
    }
  }
}

function agentTotals(g) {
  let strokes = 0, par = 0, thru = 0;
  for (const s of g.scores) if (s) { strokes += s.s; par += s.par; thru++; }
  // count the in-progress hole as played-so-far for a live "thru"
  return { strokes, par, thru, toPar: strokes - par };
}

// Leaderboard rows for the HUD: main golfer plus every active/retiring agent,
// sorted by score to par then holes played. Main is flagged.
export function leaderboard(st, mainTotals) {
  const rows = [{ name: 'You', toPar: mainTotals.toPar, thru: mainTotals.thru, main: true, playing: st.mode === 'WORKING' }];
  for (const g of Object.values(st.agents || {})) {
    const t = agentTotals(g);
    rows.push({ name: g.name, type: g.type, toPar: t.toPar, thru: g.holeIdx, main: false, retiring: g.retired > 0 });
  }
  rows.sort((a, b) => (a.toPar - b.toPar) || (b.thru - a.thru));
  return rows;
}

export function activeAgentCount(st) {
  return Object.values(st.agents || {}).filter(g => !g.retired).length;
}

// A short group remark for the caddie line: leader, or someone in trouble.
export function groupRemark(st, sid, mainTotals) {
  const board = leaderboard(st, mainTotals);
  if (board.length < 2) return null;
  const leader = board[0];
  const rnd = rngFor(sid, 'group', board.length, Math.floor((st.t || 0) / 15000));
  if (rnd() < 0.5) return leader.main ? `You lead at ${toParText(leader.toPar)}.` : `${leader.name} leads at ${toParText(leader.toPar)}.`;
  const worst = board[board.length - 1];
  if (!worst.main && worst.toPar - leader.toPar >= 3) return `${worst.name} is having a rough one.`;
  return `${board.length} in the group.`;
}

export { scoreName };
