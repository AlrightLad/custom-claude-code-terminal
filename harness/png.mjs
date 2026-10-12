#!/usr/bin/env node
// Renders a captured frame (ANSI rows from any glyph tier) to a PNG so the
// art can be reviewed outside a terminal. Zero dependencies.
// usage: node harness/png.mjs <frame.txt> <out.png> [--grey] [--scale N]
import fs from 'node:fs';
import { rasterize, encodePng } from './raster-frame.mjs';

const args = process.argv.slice(2);
const inFile = args[0], outFile = args[1];
if (!inFile || !outFile) { console.error('usage: node harness/png.mjs <frame.txt> <out.png> [--grey] [--scale N]'); process.exit(1); }
const grey = args.includes('--grey');
const si = args.indexOf('--scale');
const cellW = si >= 0 ? Number(args[si + 1]) || 12 : (Number(args[2]) > 0 ? Number(args[2]) : 12);
const img = rasterize(fs.readFileSync(inFile, 'utf8'), { cellW, grey });
fs.writeFileSync(outFile, encodePng(img.w, img.h, img.rgb));
console.log(`${outFile}: ${img.cols}x${img.rows} cells -> ${img.w}x${img.h} px${grey ? ' (greyscale)' : ''}`);
