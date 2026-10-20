/* 定点修复：开发者工具项目记录被写成小游戏模式（compileType=game / isGame=true），
   导致小程序项目按小游戏编译、报「未找到 game.json」。
   仅修改上下文出现本项目路径的记录；先备份原文件。
   用法：先完全退出微信开发者工具，再 node fix-devtools-mode.cjs */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const userDataRoot = path.join(os.homedir(), 'AppData', 'Local', '微信开发者工具', 'User Data');
if (!fs.existsSync(userDataRoot)) { console.error('找不到开发者工具数据目录:', userDataRoot); process.exit(1); }
const hashDir = fs.readdirSync(userDataRoot).find((d) => fs.statSync(path.join(userDataRoot, d)).isDirectory());
const localDataDir = path.join(userDataRoot, hashDir, 'WeappLocalData');
console.log('数据目录:', localDataDir);

const PROJECT_MARK = 'wechat-miniprogram-app';
const FIXES = [
  { from: '"compileType":"game"', to: '"compileType":"miniprogram"' },
  { from: '"isGame":true', to: '"isGame":false' },
];
let totalChanged = 0;

function patchFile(fp) {
  let text;
  try { text = fs.readFileSync(fp, 'utf8'); } catch (e) { return 0; }
  let localChanges = 0;
  for (const fix of FIXES) {
    let idx = text.indexOf(fix.from);
    while (idx >= 0) {
      const around = text.slice(Math.max(0, idx - 3000), idx + 3000);
      if (around.includes(PROJECT_MARK)) {
        text = text.slice(0, idx) + fix.to + text.slice(idx + fix.from.length);
        localChanges++;
      }
      idx = text.indexOf(fix.from, idx + fix.from.length);
    }
  }
  if (localChanges > 0) {
    const bak = fp + '.bak-' + Date.now();
    fs.copyFileSync(fp, bak);
    fs.writeFileSync(fp, text, 'utf8');
    console.log('已修复', path.basename(fp), '改动', localChanges, '处；备份 →', path.basename(bak));
    totalChanged += localChanges;
  }
  return localChanges;
}

for (const f of fs.readdirSync(localDataDir).filter((x) => x.endsWith('.json') && !x.includes('.bak-'))) {
  patchFile(path.join(localDataDir, f));
}

if (totalChanged === 0) console.log('没有需要修复的记录（可能已修好）');
else {
  for (const f of fs.readdirSync(localDataDir).filter((x) => x.endsWith('.json') && !x.includes('.bak-'))) {
    const fp = path.join(localDataDir, f);
    const t = fs.readFileSync(fp, 'utf8');
    if (!t.includes(PROJECT_MARK)) continue;
    const g = (t.match(/"compileType":"game"/g) || []).length;
    const m = (t.match(/"compileType":"miniprogram"/g) || []).length;
    const ig = (t.match(/"isGame":true/g) || []).length;
    console.log('复核', f, '→ game:' + g, 'miniprogram:' + m, 'isGame-true:' + ig);
  }
  console.log('完成：现在重新打开微信开发者工具即可。');
}
