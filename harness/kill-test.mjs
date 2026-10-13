#!/usr/bin/env node
// Test B: does a cancelled render leak a process? Spawns many renderers with
// stdin LEFT OPEN (the state Claude Code leaves a cancelled frame in), under
// two cancellation models, and counts survivors a few seconds later.
//   abandon : spawn, never send stdin, drop our handle (no signal)  <- the real leak path
//   sigterm : spawn, SIGTERM mid-render                              <- signal-based cancel
// usage: node harness/kill-test.mjs <entryRelPath> [n=200]
import { spawn, execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const entry = path.join(ROOT, process.argv[2] || 'src/statusline.mjs');
const N = Number(process.argv[3]) || 200;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-kill-'));
const TAG = 'KILLTEST_' + Date.now();
const env = { ...process.env, CCGOLF_HOME: home, CCGOLF_MODE: 'WORKING', COLUMNS: '120', LINES: '36', CCGOLF_TAG: TAG };

function countSurvivors() {
  // Count node processes whose command line carries our unique tag (env shows
  // up in the command line on Windows via the child's argv? No — use a marker
  // arg instead). We pass the tag as an extra argv so wmic/ps can see it.
  try {
    const out = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Where-Object { $_.CommandLine -like \'*' + TAG + '*\' }).Count"', { encoding: 'utf8' });
    return parseInt(out.trim(), 10) || 0;
  } catch { return -1; }
}

async function run(model) {
  const kids = [];
  for (let i = 0; i < N; i++) {
    // Pass TAG as an argv so it is visible in the process command line.
    const p = spawn('node', [entry, TAG], { stdio: ['pipe', 'ignore', 'ignore'], env });
    kids.push(p);
    if (model === 'sigterm') setTimeout(() => { try { p.kill('SIGTERM'); } catch {} }, 30 + Math.random() * 60);
    // abandon: do nothing — never write stdin, never kill. Drop reference.
    await new Promise(r => setTimeout(r, 5)); // overlap: ~200/s spawn rate
  }
  // settle, then count survivors still alive
  await new Promise(r => setTimeout(r, 4000));
  const alive = countSurvivors();
  // cleanup any survivors so the next run / machine is clean
  try { execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Where-Object { $_.CommandLine -like \'*' + TAG + '*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"', { stdio: 'ignore' }); } catch {}
  for (const p of kids) { try { p.kill('SIGKILL'); } catch {} }
  return alive;
}

const which = process.argv[2] || 'src/statusline.mjs';
console.log(`entry: ${which}  n=${N}`);
console.log(`  abandon (open stdin, no signal): ${await run('abandon')} survivors after 4s`);
console.log(`  sigterm (killed mid-render):     ${await run('sigterm')} survivors after 4s`);
fs.rmSync(home, { recursive: true, force: true });
