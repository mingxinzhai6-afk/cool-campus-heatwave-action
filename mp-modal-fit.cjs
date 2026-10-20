/* 弹窗单屏适配测量（简介 + 结算复盘）：把 game.wxml 的弹窗 + game.wxss 真实渲染进浏览器，
   在多个横屏尺寸下测量：内容是否需要滚动、底部按钮是否始终可见。
   用法：node mp-modal-fit.cjs  →  生成 mp-modal-fit.html，浏览器打开看 window.__summary */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MP = path.join(ROOT, 'wechat-miniprogram-app');

const campus = require(path.join(MP, 'core/data/campus.js'));
const levelsMod = require(path.join(MP, 'core/data/levels.js'));
const toolsMod = require(path.join(MP, 'core/data/tools.js'));
const engine = require(path.join(MP, 'core/lib/engine.js'));
const WEATHER = levelsMod.WEATHER || campus.WEATHER;
const TOOLS = toolsMod.TOOLS;
const LEVELS = levelsMod.LEVELS;
const getLevel = levelsMod.getLevel;

const fmtHour = (h) => (h < 10 ? '0' : '') + h + ':00';
const wxmlLines = fs.readFileSync(path.join(MP, 'pages/game/game.wxml'), 'utf8').split(/\r?\n/);

/* ---------- 片段提取（按 <view> 配平截取） ---------- */
function extractBlock(markerLine) {
  const start = wxmlLines.findIndex((l) => l.includes(markerLine));
  if (start < 0) throw new Error('找不到: ' + markerLine);
  let depth = 0;
  for (let i = start; i < wxmlLines.length; i++) {
    const opens = (wxmlLines[i].match(/<view[\s>]/g) || []).length;
    const closes = (wxmlLines[i].match(/<\/view>/g) || []).length;
    depth += opens - closes;
    if (depth === 0 && i > start) return { start, end: i, lines: wxmlLines.slice(start, i + 1) };
  }
  throw new Error('配平失败: ' + markerLine);
}

function linesToBalanced(lines, markerLine) {
  const start = lines.findIndex((l) => l.includes(markerLine));
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    depth += (lines[i].match(/<view[\s>]/g) || []).length - (lines[i].match(/<\/view>/g) || []).length;
    if (depth === 0 && i > start) return { start, end: i };
  }
  return null;
}

/* ---------- 简介数据（同 game.js 的 intro 构建） ---------- */
function introData(level) {
  const w = WEATHER[level.startWeather] || { icon: '☀️', name: '晴热', note: '' };
  return {
    index: level.index, name: level.name, tagline: level.tagline, story: level.story,
    weatherIcon: w.icon, weatherName: w.name, weatherNote: w.note,
    budget: level.budget, water: level.waterSupply,
    hours: level.hours.map(fmtHour).join(' / '),
    unlock: level.unlock.map((id) => ({ id, name: TOOLS[id].name })),
    goals: level.goals.map((g) => ({ label: g.label, core: !!g.core })),
  };
}

/* ---------- 结算数据（同 game.js 的 showResult） ---------- */
function resultData(level) {
  const state = engine.createState(level.id);
  const ev = engine.evaluate(state);
  const next = LEVELS[level.index] || null;
  return {
    stars: ev.stars, headline: ev.headline, detail: ev.detail,
    scoreText: '得分 ' + ev.earned + ' / ' + ev.max + (ev.max > 0 ? '（' + Math.round(ev.ratio * 100) + '%）' : '') + ' · 公众支持度 ' + engine.support(state),
    lesson: level.lesson, sandbox: !!level.sandbox,
    canAdvance: ev.stars >= 3 && !!next, nextName: next ? next.name : '',
    rows: level.sandbox ? [] : ev.results.map((r) => ({
      label: r.goal.label, ok: r.ok,
      right: r.value.toFixed(1) + ' / ' + r.goal.op + r.goal.value + (r.goal.core ? ' · 核心' : ''),
    })),
  };
}

/* ---------- WXML → HTML ---------- */
function toHtml(fragText) {
  return fragText
    .replace(/<scroll-view([^>]*)>/, '<div$1>')
    .replace(/<\/scroll-view>/g, '</div>')
    .replace(/<image([^>]*)\/?><\/image>/g, '<img$1>')
    .replace(/<image([^>]*)\/>/g, '<img$1>')
    .replace(/<button([^>]*)>/g, '<div$1>')
    .replace(/<\/button>/g, '</div>')
    .replace(/<text([^>]*)>/g, '<span$1>')
    .replace(/<\/text>/g, '</span>')
    .replace(/<view([^>]*)>/g, '<div$1>')
    .replace(/<\/view>/g, '</div>')
    .replace(/\swx:(if|for|key|elif|else)="[^"]*"/g, '')
    .replace(/\s(bindtap|catchtap|scroll-y|disabled|mode|src)="([^"]*)"/g, (m, attr, val) => {
      if (attr === 'src') {
        const fixed = val.startsWith('/assets/') ? 'wechat-miniprogram-app/assets/' + val.slice('/assets/'.length) : val;
        return ` src="${fixed}"`;
      }
      return '';
    });
}

/* ---------- 简介片段展开 ---------- */
const introBlock = extractBlock('modal-mask" wx:if="{{introOpen}}"');
function expandIntro(level) {
  const d = introData(level);
  let frag = introBlock.lines.join('\n');
  frag = frag.replace(/<view class="unlock-chip"[\s\S]*?<\/view>/, d.unlock.map((u) =>
    `        <view class="unlock-chip"><image class="unlock-ico" src="wechat-miniprogram-app/assets/tool-${u.id}.png"></image><text>${u.name}</text></view>`
  ).join('\n'));
  frag = frag.replace(/<view class="intro-goal"[\s\S]*?<\/view>/, d.goals.map((g) =>
    `        <view class="intro-goal"><text class="goal-dot ${g.core ? 'core' : ''}">●</text><text>${g.label}</text></view>`
  ).join('\n'));
  return frag
    .replace(/\{\{intro\.index\}\}/g, String(d.index))
    .replace(/\{\{intro\.name\}\}/g, d.name)
    .replace(/\{\{intro\.tagline\}\}/g, d.tagline)
    .replace(/\{\{intro\.story\}\}/g, d.story)
    .replace(/\{\{intro\.weatherIcon\}\}/g, d.weatherIcon)
    .replace(/\{\{intro\.weatherName\}\}/g, d.weatherName)
    .replace(/\{\{intro\.weatherNote\}\}/g, d.weatherNote)
    .replace(/\{\{intro\.budget\}\}/g, String(d.budget))
    .replace(/\{\{intro\.water\}\}/g, String(d.water))
    .replace(/\{\{intro\.hours\}\}/g, d.hours);
}

/* ---------- 结算片段展开 ---------- */
const resultBlock = extractBlock('modal-mask" wx:if="{{resultOpen}}"');
function expandResult(level) {
  const d = resultData(level);
  let lines = resultBlock.lines.slice();
  // 提示行/下一关按钮/目标行：按真实条件增删
  const enc = lines.findIndex((l) => l.includes('result-encourage'));
  if (enc >= 0 && d.canAdvance) lines.splice(enc, 1);
  const nextBtn = lines.findIndex((l) => l.includes('onResultNext'));
  if (nextBtn >= 0 && !d.nextName) lines.splice(nextBtn, 1);
  const rows = linesToBalanced(lines, 'class="result-rows"');
  if (rows) {
    const head = lines[rows.start];
    if (d.rows.length === 0) lines.splice(rows.start, rows.end - rows.start + 1);
    else {
      lines.splice(rows.start + 1, rows.end - rows.start - 1, ...d.rows.map((r) =>
        `          <view class="result-row ${r.ok ? 'ok' : 'fail'}"><text class="result-mark">${r.ok ? '✓' : '✗'}</text><text class="result-label">${r.label}</text><text class="result-val">${r.right}</text></view>`
      ));
      void head;
    }
  }
  let frag = lines.join('\n');
  return frag
    .replace(/\{\{result\.stars >= 1 \? 'filled' : ''\}\}/g, d.stars >= 1 ? 'filled' : '')
    .replace(/\{\{result\.stars >= 2 \? 'filled' : ''\}\}/g, d.stars >= 2 ? 'filled' : '')
    .replace(/\{\{result\.stars >= 3 \? 'filled' : ''\}\}/g, d.stars >= 3 ? 'filled' : '')
    .replace(/\{\{result\.headline\}\}/g, d.headline)
    .replace(/\{\{result\.detail\}\}/g, d.detail)
    .replace(/\{\{result\.scoreText\}\}/g, d.scoreText)
    .replace(/\{\{result\.lesson\}\}/g, d.lesson);
}

/* ---------- 参谋建议片段展开（5 条建议，验证清单能滚动） ---------- */
const adviceBlock = extractBlock('modal-mask" wx:if="{{adviceOpen}}"');
function expandAdvice() {
  const items = [
    { rank: 1, toolName: '行道树', cost: 3, tileName: '雾港广场', reason: '雾港广场·学生约占 80%（150 人）；道路、广场边缘的持续暴晒' },
    { rank: 2, toolName: '遮阳棚', cost: 6, tileName: '西侧硬质广场', reason: '西侧硬质广场·学生约占 80%（350 人）；排队、等单、休息等"必须停留"的暴晒点' },
    { rank: 3, toolName: '透水铺装', cost: 8, tileName: '雾港广场', reason: '雾港广场·学生约占 80%（150 人）；午后地表蓄热明显' },
    { rank: 4, toolName: '雾森降温', cost: 7, tileName: '西侧硬质广场', reason: '西侧硬质广场·学生约占 80%（350 人）' },
    { rank: 5, toolName: '浅水景观', cost: 12, tileName: '雾港广场', reason: '雾港广场·学生约占 80%（150 人）' },
  ];
  let lines = adviceBlock.lines.slice();
  // 去掉「空列表」提示行
  const emptyTip = lines.findIndex((l) => l.includes('已没有明显更优的地块'));
  if (emptyTip >= 0) lines.splice(emptyTip, 1);
  const list = linesToBalanced(lines, 'class="advice-item"');
  if (list) {
    lines.splice(list.start + 1, list.end - list.start - 1, ...items.map((it) =>
      `        <view class="advice-head"><text class="advice-rank">${it.rank}</text><text class="advice-tool">${it.toolName}</text><text class="advice-cost">${it.cost} 万</text></view>\n` +
      `        <view class="advice-loc">📍 ${it.tileName}</view>\n` +
      `        <view class="advice-reason">${it.reason}</view>\n` +
      `        <button class="btn primary small advice-pick">在地图上标出并采用</button>`
    ));
  }
  // 行内高度绑定在浏览器里换算成模拟视口高度
  return lines.join('\n')
    .replace(/height:\{\{adviceScrollH\}\}px/g, 'height:calc(var(--vh,390px)*0.92 - 70px)');
}

/* ---------- 组装 HTML ---------- */
function buildHtml() {
  const wxss = fs.readFileSync(path.join(MP, 'pages/game/game.wxss'), 'utf8');
  const sizes = [[844, 390], [667, 375], [960, 440], [800, 360], [740, 360]];
  const sims = [];
  for (const level of LEVELS) {
    sims.push(`<div class="sim" data-id="${level.id}">\n${toHtml(expandIntro(level))}\n</div>`);
    sims.push(`<div class="sim" data-id="${level.id}-res">\n${toHtml(expandResult(level))}\n</div>`);
  }
  sims.push(`<div class="sim" data-id="advice">\n${toHtml(expandAdvice())}\n</div>`);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>modal fit</title>
<style>
html,body{margin:0;padding:0;background:#cfe6f2}
body{font-family:-apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;font-size:12px;color:#173247}
.sim{position:relative;width:var(--vw,844px);height:var(--vh,390px);overflow:hidden;margin:0 auto 6px}
${wxss}
.sim .modal-mask{position:absolute;left:0;top:0;right:0;bottom:0}
.sim .modal{max-width:calc(var(--vw,844px)*0.88);max-height:calc(var(--vh,390px)*0.86)}
.sim .modal.intro{max-width:calc(var(--vw,844px)*0.94);max-height:calc(var(--vh,390px)*0.92)}
.sim .modal.result{max-width:calc(var(--vw,844px)*0.94);max-height:calc(var(--vh,390px)*0.92)}
.sim .modal.advice-modal{max-height:calc(var(--vh,390px)*0.92)}
/* 模拟小程序 scroll-view：内容超出时由浏览器按 CSS 滚动；并换算成模拟视口的固定高度 */
.sim .intro-scroll,.sim .result-scroll,.sim .advice-scroll{overflow-y:auto}
</style></head>
<body>
${sims.join('\n')}
<script>
var sizes=${JSON.stringify(sizes)};
var out=[];
document.querySelectorAll('.sim').forEach(function(sim){
  var level=sim.getAttribute('data-id');
  sizes.forEach(function(sz){
    sim.style.setProperty('--vw', sz[0]+'px');
    sim.style.setProperty('--vh', sz[1]+'px');
    void sim.offsetHeight;
    var m=sim.querySelector('.modal');
    var s=m.querySelector('.intro-scroll, .result-scroll, .advice-scroll');
    var act=m.querySelector('.result-actions') || m.querySelector('.btn.wide');
    var sr=sim.getBoundingClientRect(), mr=m.getBoundingClientRect(), ar=act.getBoundingClientRect();
    var isAdvice = level === 'advice';
    out.push({
      level: level, size: sz[0]+'x'+sz[1], kind: isAdvice ? 'advice' : 'fit',
      modalH: +mr.height.toFixed(1), maxH: +(sz[1]*0.92).toFixed(1),
      modalOver: mr.height > sz[1]*0.92 + 0.5,
      contentNeed: s.scrollHeight, contentBox: s.clientHeight,
      needScroll: s.scrollHeight > s.clientHeight + 1,
      scrollable: s.scrollHeight > s.clientHeight + 1,
      btnBottomGap: +(mr.bottom - ar.bottom).toFixed(1),
      btnInModal: ar.bottom <= mr.bottom + 0.5,
      btnOnScreen: ar.bottom <= sr.bottom + 0.5 && ar.top >= sr.top - 0.5,
      modalInSim: mr.height <= sr.height + 0.5 && mr.top >= sr.top - 0.5 && mr.bottom <= sr.bottom + 0.5
    });
  });
});
window.__results = out;
var bad = out.filter(function(r){
  if (r.kind === 'advice') {
    // 建议弹窗：不超屏、按钮在弹窗内可见、滚动区真的被限高（内容超出时可滚动）
    return r.modalOver || !r.btnInModal || !r.btnOnScreen || !r.modalInSim || !r.scrollable;
  }
  return r.needScroll || !r.btnOnScreen || !r.modalInSim;
});
window.__summary = { total: out.length, failed: bad.length, failedRows: bad };
document.title = 'FIT-' + (bad.length ? 'FAIL' : 'OK');
try {
  var pre = document.createElement('pre');
  pre.id = 'rpt';
  pre.style.display = 'none';
  pre.textContent = JSON.stringify(window.__summary);
  document.body.appendChild(pre);
} catch (e) { /* 忽略 */ }
/* 截图模式：?only=l1-res&w=844&h=390 → 只显示该弹窗并锁定尺寸 */
var qs = new URLSearchParams(location.search);
var only = qs.get('only');
if (only) {
  document.querySelectorAll('.sim').forEach(function(s){ s.style.display = s.getAttribute('data-id')===only ? 'block' : 'none'; s.style.margin='0'; });
  var sim2 = document.querySelector('.sim[data-id="'+only+'"]');
  sim2.style.setProperty('--vw', (+(qs.get('w')||844))+'px');
  sim2.style.setProperty('--vh', (+(qs.get('h')||390))+'px');
}
</script>
</body></html>`;
}

const inline = path.join(ROOT, 'mp-modal-fit.html');
fs.writeFileSync(inline, buildHtml(), 'utf8');
console.log('已生成', inline, '（5 关 × 简介/结算 × 5 尺寸）');
console.log('浏览器打开后读取 window.__summary / window.__results');
