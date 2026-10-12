#!/usr/bin/env node
// Escape-sequence passthrough probe for the Claude Code status line (Phase H.1).
// Point a session's statusLine at this file, then steer it by writing a class
// name into ~/.claude/golf/escprobe.json: {"class":"osc-title","n":1}.
//
// The question is what Claude Code does to the bytes a status line prints:
// it captures stdout, does its own width accounting, and re-renders inside
// its TUI. Each class here has an OBSERVABLE side effect so the answer does
// not depend on reading an image:
//   osc-title   sets the window title (OSC 0). If the title changes, raw OSC
//               reaches the terminal untouched -> a passthrough channel.
//   osc-hyper   OSC 8 hyperlink (documented as supported).
//   dcs-sixel   a Sixel image (DCS). Visible only if DCS passes through.
//   apc-kitty   a Kitty graphics image (APC). Visible only if APC passes.
//   csi-sgr     colour (CSI m). Known to work; the control.
//   csi-cursor  cursor-up then text (CSI A) — does cursor motion leak?
//   decset      hide the cursor (CSI ? 25 l), reversible — does DEC private
//               mode leak into the host TUI?
//   c1          a raw C1 CSI (0x9b) instead of ESC[ — does the 8-bit form pass?
//   highbyte    raw bytes 0x80..0x9f — are they dropped, shown, or mangled?
// Every run ends with a plain marker row so the rendered line is identifiable.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = path.join(os.homedir(), '.claude', 'golf');
let ctl = {};
try { ctl = JSON.parse(fs.readFileSync(path.join(dir, 'escprobe.json'), 'utf8')); } catch {}
const cls = process.env.ESC_CLASS || ctl.class || 'csi-sgr';
const n = ctl.n ?? 0;
const ESC = '\x1b', BEL = '\x07', ST = ESC + '\\';
const out = [];

switch (cls) {
  case 'osc-title':
    out.push(`${ESC}]0;CCGOLF-OSC-${n}${BEL}osc-title sent n=${n} (check window title)`);
    break;
  case 'osc-hyper':
    out.push(`${ESC}]8;;https://example.com/${n}${ST}osc-hyperlink${ESC}]8;;${ST} after-link n=${n}`);
    break;
  case 'dcs-sixel': {
    const W = 24;
    out.push(`${ESC}Pq"1;1;${W};12#0;2;80;10;10#1;2;20;80;30` +
      '#1' + '~'.repeat(W) + '$#0' + '?'.repeat(W) + '-' +
      '#1' + '~'.repeat(W) + ST + ' <-sixel should be left of this');
    break;
  }
  case 'apc-kitty':
    out.push(`${ESC}_Gf=24,s=2,v=2,a=T;AAD/AAD/AAD/AAD/${ST} <-kitty should be left of this`);
    break;
  case 'csi-cursor':
    out.push(`before${ESC}[2Dafter cursor-up/back n=${n}`);
    break;
  case 'decset':
    out.push(`${ESC}[?25l decset-hide-cursor n=${n} (did the host cursor vanish?)`);
    break;
  case 'c1': {
    // 0x9b is the 8-bit CSI; 0x9b 33 6d would be SGR red if interpreted.
    out.push('c1-test ' + String.fromCharCode(0x9b) + '31mRED-if-c1-works' + ESC + '[0m end n=' + n);
    break;
  }
  case 'highbyte':
    out.push('highbyte ' + Array.from({ length: 16 }, (_, i) => String.fromCharCode(0x80 + i)).join('') + ' end');
    break;
  case 'csi-sgr':
  default:
    out.push(`${ESC}[31mRED${ESC}[0m ${ESC}[42mGREENBG${ESC}[0m csi-sgr control n=${n}`);
}
out.push(`escprobe class=${cls} n=${n} marker-row`);
process.stdout.write(out.join('\n') + '\n');
