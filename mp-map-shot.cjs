/* 小程序渲染器直出截图：esbuild 打包 render/draw.js（含 core 数据），
   用无头 Edge 截图，用于地图视觉调整的「改前/改后」对照。
   用法：node mp-map-shot.cjs <levelId> <rotation> <w> <h> <out.png> [zoom] [debug]
   例：  node mp-map-shot.cjs l1 0 900 560 shot-l1-before.png
         node mp-map-shot.cjs l1 0 900 560 shot-zoom.png 1.9 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const DIR = path.join(ROOT, 'mp-map-shot');

const [level, rot, w, h, out, zoom] = process.argv.slice(2);
const outName = out || ('shot-' + (level || 'l1') + '.png');

/* 1) 打包 */
const esbuild = require('esbuild');
esbuild.buildSync({
  entryPoints: [path.join(DIR, 'entry.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: path.join(DIR, 'bundle.js'),
  logLevel: 'warning',
});
console.log('已打包 bundle.js');

/* 2) 无头 Edge 截图 */
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const debug = process.argv.includes('debug') ? '&debug=1' : '';
const zoomArg = (zoom && !isNaN(Number(zoom))) ? '&zoom=' + zoom : '';
const url = 'file:///' + path.join(DIR, 'index.html').replace(/\\/g, '/') +
  '?level=' + (level || 'l1') + '&rot=' + (rot || 0) + '&w=' + (w || 900) + '&h=' + (h || 560) + zoomArg + debug;
const outPath = path.join(ROOT, outName);
execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--screenshot=' + outPath,
  '--window-size=' + (Number(w || 900)) + ',' + (Number(h || 560)),
  url,
], { stdio: 'ignore', timeout: 60000 });
console.log('已生成', outPath);
