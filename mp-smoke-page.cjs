/**
 * 小程序页面级自测（Node 环境模拟 wx）：
 *   1. 校验 WXML 中 bind / catch 引用的处理函数在页面里都存在；
 *   2. 完整驱动一局游戏：进关 → 选工具 → 点地块放置 → 一路推进（含事件选择）→ 结算弹窗；
 *   3. 走一遍 关卡切换 / 自动布置 / 撤销 / 旋转 / 图层开关。
 * 运行：npm run mp:smoke 之后可单独执行本文件；这里由 mp-smoke.cjs 之外人工运行亦可。
 */
const path = require('node:path');
const fs = require('node:fs');
const root = path.join(__dirname, 'wechat-miniprogram-app');

/* ---------- 假 wx 环境 ---------- */
function makeGradient() { return { addColorStop: function () { } }; }
function makeCtx() {
  const base = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic', lineJoin: 'miter', lineCap: 'butt', shadowColor: '', shadowBlur: 0, shadowOffsetY: 0 };
  ['setTransform', 'clearRect', 'save', 'restore', 'translate', 'scale', 'rotate', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'arc', 'quadraticCurveTo', 'bezierCurveTo', 'fillRect', 'strokeRect', 'strokeText', 'fillText', 'setLineDash', 'clip'].forEach(function (m) { base[m] = function () { }; });
  base.createLinearGradient = makeGradient;
  base.createRadialGradient = makeGradient;
  base.measureText = function (t) { return { width: String(t || '').length * 6 }; };
  return base;
}
const ctx = makeCtx();
const fakeCanvas = { width: 0, height: 0, getContext: function () { return ctx; }, requestAnimationFrame: function (cb) { cb(); return 1; } };

let pageDef = null;
global.Page = function (d) { pageDef = d; };
global.wx = {
  createSelectorQuery: function () {
    return {
      exec: function (cb) { if (cb) cb([]); },
      select: function () {
        return {
          fields: function () { return { exec: function (cb) { cb([{ node: fakeCanvas, width: 900, height: 420 }]); } }; },
          boundingClientRect: function (cb) { if (cb) cb(null); return {}; },
        };
      },
    };
  },
  getWindowInfo: function () { return { pixelRatio: 2, windowWidth: 900, windowHeight: 420 }; },
  getSystemInfoSync: function () { return { pixelRatio: 2 }; },
  getStorageSync: function () { return ''; },
  setStorageSync: function () { /* 忽略 */ },
  setInnerAudioOption: function () { /* 忽略 */ },
  env: { USER_DATA_PATH: '/tmp/user' },
  createInnerAudioContext: function () {
    const rec = { playing: false, src: '', playCalls: 0, cbs: {} };
    bgmCtxs.push(rec);
    const obj = {
      loop: false, volume: 1,
      play: function () { rec.playCalls++; rec.playing = true; if (rec.cbs.play) rec.cbs.play(); },
      pause: function () { rec.playing = false; if (rec.cbs.pause) rec.cbs.pause(); },
      stop: function () { rec.playing = false; if (rec.cbs.stop) rec.cbs.stop(); },
      destroy: function () { },
      onPlay: function (cb) { rec.cbs.play = cb; },
      onPause: function (cb) { rec.cbs.pause = cb; },
      onStop: function (cb) { rec.cbs.stop = cb; },
      onError: function (cb) { rec.cbs.error = cb; },
    };
    Object.defineProperty(obj, 'src', {
      get: function () { return rec.src; },
      set: function (v) { rec.src = v; },
    });
    Object.defineProperty(obj, 'paused', {
      get: function () { return !rec.playing; },
    });
    return obj;
  },
  createWebAudioContext: function () {
    return {
      currentTime: 0,
      destination: {},
      resume: function () { /* 已激活 */ },
      createGain: function () {
        return { gain: { value: 1, setValueAtTime: function () { }, exponentialRampToValueAtTime: function () { } }, connect: function () { } };
      },
      createOscillator: function () {
        blipCount++;
        return {
          type: '',
          frequency: { setValueAtTime: function () { }, exponentialRampToValueAtTime: function () { } },
          connect: function () { }, start: function () { }, stop: function () { },
        };
      },
    };
  },
};
let blipCount = 0;
const bgmCtxs = [];

require(path.join(root, 'pages/game/game.js'));
const audioMod = require(path.join(root, 'lib/audio.js'));
const hitMod = require(path.join(root, 'render/hit.js'));

const page = Object.create(pageDef);
page.data = JSON.parse(JSON.stringify(pageDef.data));
page.setData = function (patch) { const d = this.data; Object.keys(patch).forEach(function (k) { d[k] = patch[k]; }); };

/* ---------- 1. WXML 处理函数覆盖检查 ---------- */
const wxml = fs.readFileSync(path.join(root, 'pages/game/game.wxml'), 'utf8');
const handlers = new Set();
const re = /(?:bind|catch)[a-z]*="([A-Za-z0-9_]+)"/g;
let m;
while ((m = re.exec(wxml))) handlers.add(m[1]);
const missing = Array.from(handlers).filter(function (h) { return typeof pageDef[h] !== 'function'; });
if (missing.length) {
  console.log('WXML 引用了不存在的处理函数: ' + missing.join(', '));
  process.exit(1);
}
console.log('处理函数检查: ' + handlers.size + ' 个全部存在');

// 结构断言：参谋建议弹窗的清单必须放在 scroll-view 里（否则建议一多就滑不动）
const adviceScrollable = wxml.indexOf('<scroll-view class="advice-scroll"') >= 0;
console.log('参谋建议弹窗可滚动: ' + (adviceScrollable ? '✓' : '✗'));
if (!adviceScrollable) process.exit(1);

/* ---------- 2. 完整驱动一局 ---------- */
page.onLoad();
page.onReady();
console.log('进关:', page.data.levelName, '| 简报打开:', page.data.introOpen);
// BGM 从进入游戏（页面加载）就开始，不用等点按钮
const bgmOnLoad = bgmCtxs.length >= 1 && bgmCtxs[0].playing === true;
console.log('BGM: 进入游戏即播放 ' + (bgmOnLoad ? '✓' : '✗') + (bgmCtxs[0] ? '（' + bgmCtxs[0].src + '）' : ''));
if (!bgmOnLoad) process.exit(1);
page.onEnterLevel();
console.log('新手引导自动开始:', page.data.tut ? page.data.tut.title : '(未启动)');
// 回归断言：点「进入处置」时音乐已在播放，不能再调 play()（否则微信会从头重播）
const noRestart = !!(bgmCtxs[0] && bgmCtxs[0].playCalls === 1 && bgmCtxs[0].playing === true);
console.log('BGM: 点进入处置不从头重播 ' + (noRestart ? '✓' : '✗') + '（play 调用 ' + (bgmCtxs[0] ? bgmCtxs[0].playCalls : '-') + ' 次）');
if (!noRestart) process.exit(1);
page.onTutNext();
console.log('引导翻页后:', page.data.tut ? page.data.tut.title : '(已结束)');
page.onTutSkip();
console.log('跳过引导后:', page.data.tut === null ? '已关闭' : '仍开启');
page.onTutReplay();
console.log('重播引导:', page.data.tut ? page.data.tut.title : '(未启动)');

/* ---------- 引导 × 弹窗：弹窗盖住黄色高亮 + 气泡提醒返回查看 ---------- */
page.onTutNext();                                     // 欢迎 → 第 1 步（带高亮目标）
page.refreshTutLayout();
const tipBeforeOpen = page.data.tut.tip;
page.onAdviceOpen();                                  // 打开「参谋建议」弹窗（会盖住高亮）
page.refreshTutLayout();
const tipOpen = page.data.tut.tip;
const ringHidden = page.data.tutHiStyle === '';
page.onAdviceClose();
page.refreshTutLayout();
const tipRestored = page.data.tut.tip === tipBeforeOpen;
const okOverlay = ringHidden && typeof tipOpen === 'string' && tipOpen.indexOf('关闭弹窗') >= 0 && tipRestored;
console.log('弹窗盖高亮: 打开弹窗后高亮收起 ' + (ringHidden ? '✓' : '✗') + '，气泡提醒「' + tipOpen + '」，关闭后恢复 ' + (tipRestored ? '✓' : '✗'));
if (!okOverlay) process.exit(1);
page.onTutSkip();

/* ---------- 2.34 第 2 步气泡黄字：自定义提示语 ---------- */
page.onTutReplay();
page.onTutNext();   // 第 1 步
page.onTutNext();   // 第 2 步 · 把它放到广场上
page.refreshTutLayout();
const step2Tip = (page.data.tut && page.data.tut.tip) || '';
const tipOK = step2Tip === '地图太小记得根据右上角提醒，双指放大哟';
console.log('教程第2步黄字: ' + (tipOK ? '✓「' + step2Tip + '」' : '✗「' + step2Tip + '」'));
if (!tipOK) process.exit(1);
page.onTutSkip();

/* ---------- 2.35 第 10 步气泡右上让位（避让场馆弹窗里的时段文字） ---------- */
page.onTutReplay();
for (let i = 0; i < 10; i++) page.onTutNext();   // 第 10 步：设置开放时段
page.refreshTutLayout();
const bubbleStyle = page.data.tutBubbleStyle || '';
// 兜底位左下 (12, H-BH-88=182) + 微调 (+20, -16) → left:32px; top:166px
const nudged = bubbleStyle.indexOf('left:32px') >= 0 && bubbleStyle.indexOf('top:166px') >= 0;
console.log('教程第10步: 气泡右上让位 ' + (nudged ? '✓' : '✗') + '（' + bubbleStyle + '）');
if (!nudged) process.exit(1);
page.onTutSkip();
page.onToolTap({ currentTarget: { dataset: { id: 'tree' } } });
console.log('选中工具:', page.data.toolId);

function tap(x, y) {
  page.onCanvasTouchStart({ touches: [{ x: x, y: y }] });
  page.onCanvasTap({ detail: { x: x, y: y } });
}
let placed = 0;
for (let gx = 0.25; gx <= 0.75 && placed < 2; gx += 0.1) {
  for (let gy = 0.4; gy <= 0.72 && placed < 2; gy += 0.05) {
    const before = page.state.placements.length;
    tap(900 * gx, 420 * gy); // 第一下：弹预览卡
    tap(900 * gx, 420 * gy); // 第二下：放置
    if (page.state.placements.length > before) placed++;
  }
}
console.log('手动放置:', placed, '处 | 反馈卡:', page.data.feedback ? page.data.feedback.title : '(无)');

/* ---------- 2.4 音效：放置会发声；开关能关能开 ---------- */
const placeBlips = blipCount;
const soundOK1 = placeBlips >= placed && placed >= 2;
console.log('音效·放置: 放置 ' + placed + ' 处 → 发声 ' + placeBlips + ' 次 ' + (soundOK1 ? '✓' : '✗'));
if (!soundOK1) process.exit(1);
page.onSoundToggle();
const offOK = page.data.soundOn === false && audioMod.isMuted() === true;
page.onSoundToggle();
const onOK = page.data.soundOn === true && audioMod.isMuted() === false && blipCount === placeBlips + 1; // 开启时有一声提示音
console.log('音效开关: 关 ' + (offOK ? '✓' : '✗') + '、开并在开启时提示音 ' + (onOK ? '✓' : '✗'));
if (!offOK || !onOK) process.exit(1);

/* ---------- 2.45 背景音乐：进入处置后播放、随开关暂停/恢复 ---------- */
const bgm = bgmCtxs[0];
const bgmStarted = !!bgm && bgm.playing === true && bgm.src.indexOf('bgm.m4a') >= 0;
page.onSoundToggle();
const bgmPaused = !!bgm && bgm.playing === false;
page.onSoundToggle();
const bgmResumed = !!bgm && bgm.playing === true;
console.log('背景音乐: 持续播放 ' + (bgmStarted ? '✓' : '✗') + '、随开关暂停 ' + (bgmPaused ? '✓' : '✗') + '、恢复 ' + (bgmResumed ? '✓' : '✗') + '（' + ((bgm && bgm.src) || '未创建') + '）');
if (!bgmStarted || !bgmPaused || !bgmResumed) process.exit(1);

/* ---------- 2.5 预算不足保护：买不起的工具点不动 ---------- */
const engineMod = require(path.join(root, 'core/lib/engine.js'));
if (page.data.toolId !== 'tree') page.onToolTap({ currentTarget: { dataset: { id: 'tree' } } });
let extraSpent = 0;
for (let gx = 0.2; gx <= 0.8 && engineMod.budgetLeft(page.state) >= 3; gx += 0.06) {
  for (let gy = 0.35; gy <= 0.8 && engineMod.budgetLeft(page.state) >= 3; gy += 0.05) {
    const before = page.state.placements.length;
    tap(900 * gx, 420 * gy);
    tap(900 * gx, 420 * gy);
    if (page.state.placements.length > before) extraSpent++;
  }
}
const leftNow = engineMod.budgetLeft(page.state);
page.toolId = null;
page.setData({ toolId: null, toast: null });
page.onToolTap({ currentTarget: { dataset: { id: 'tree' } } });
const blocked = page.toolId === null && typeof page.data.toast === 'string' && page.data.toast.indexOf('预算不足') >= 0;
console.log('预算不足保护: 剩 ' + leftNow + ' 万，点行道树(3万) → ' + (blocked ? '点不动 ✓「' + page.data.toast + '」' : '失败 ✗ toast=' + page.data.toast));
if (!blocked) process.exit(1);

let guard = 0;
while (!page.state.finished && guard++ < 12) {
  if (page.data.eventOpen) {
    page.onChoose({ currentTarget: { dataset: { id: page.data.event.choices[0].id } } });
  } else {
    page.onAdvance();
  }
}
console.log('推演结束:', page.state.finished, '| 复盘弹出:', page.data.resultOpen, '| 星级:', page.data.result && page.data.result.stars, '| 可进下一关:', page.data.result && page.data.result.canAdvance);

/* ---------- 2.9 通关门槛：未通关不能从菜单跳关 ---------- */
page.onMenuOpen();
const l2rowBefore = (page.data.menuLevels || []).find(function (m) { return m.id === 'l2'; });
const lockedBefore = !!l2rowBefore && l2rowBefore.locked === true;
const levelBefore = page.levelId;
page.setData({ toast: null });
page.onMenuPick({ currentTarget: { dataset: { id: 'l2' } } });
const pickBlocked = page.levelId === levelBefore && typeof page.data.toast === 'string' && page.data.toast.indexOf('通关') >= 0;
console.log('通关门槛·未通关: 第2关锁定 ' + (lockedBefore ? '✓' : '✗') + '、点击被拦 ' + (pickBlocked ? '✓「' + page.data.toast + '」' : '✗'));
if (!lockedBefore || !pickBlocked) process.exit(1);

// 构造一个 3 星通关的第 1 关：验证 showResult 会记入通关并解锁第 2 关
let solved = engineMod.createState('l1');
solved = engineMod.autoPlan(solved);
let guard2 = 0;
while (!solved.finished && guard2++ < 12) {
  solved = solved.pendingEvent ? engineMod.resolveChoice(solved, solved.pendingEvent.choices[0].id) : engineMod.advance(solved);
}
const solvedStars = engineMod.evaluate(solved).stars;
page.state = solved;
page.showResult();
const recorded = !!(page.passed && page.passed['l1'] === true);
page.onMenuClose();
page.onMenuOpen();
const l2rowAfter = (page.data.menuLevels || []).find(function (m) { return m.id === 'l2'; });
const unlockedNow = !!l2rowAfter && l2rowAfter.locked === false;
console.log('通关门槛·3星通关后: 记入通关 ' + (recorded ? '✓' : '✗') + '（' + solvedStars + ' 星）、第2关解锁 ' + (unlockedNow ? '✓' : '✗'));
if (!recorded || !unlockedNow) process.exit(1);

/* ---------- 3. 切关 / 自动布置 / 撤销 / 旋转 / 图层 ---------- */
page.onMenuOpen();
page.onMenuPick({ currentTarget: { dataset: { id: 'l2' } } });
page.onEnterLevel();
page.onAutoPlan();
console.log('第2关自动布置: 剩余预算', page.data.budgetLeft, '万 | 场上有', page.state.placements.length, '处改造');
page.onUndo();
console.log('撤销后: 剩余预算', page.data.budgetLeft, '万 | 场上', page.state.placements.length, '处');
page.onRotation({ detail: { value: 123 } });
page.onLayerToggle({ currentTarget: { dataset: { id: 'people' } } });
console.log('旋转:', page.data.rotation, '° | 人群图层:', page.data.layers.people);
page.onRotateReset();

/* ---------- 4. 双指缩放 + 放大后拖动平移 ---------- */
const fitScale = hitMod.buildFrame(page.levelId, page.data.rotation || 0, 900, 420).scale;
page.onCanvasTouchStart({ touches: [{ x: 300, y: 200 }, { x: 400, y: 200 }] });  // 指距 100
page.onCanvasTouchMove({ touches: [{ x: 250, y: 200 }, { x: 450, y: 200 }] });   // 指距 200 → ×2
const zoomed = Math.abs((page.zoom || 1) - 2) < 0.05;
page.onCanvasTouchEnd({ touches: [] });
page.redraw();
const scaleApplied = Math.abs(page.frame.scale - fitScale * 2) < 0.01;

// 放大后单指向左拖动 80px：地图跟着手指平移（pan 与取景同步），松手后的 tap 被忽略
const txBefore = page.frame.tx;
page.onCanvasTouchStart({ touches: [{ x: 400, y: 200 }] });
page.onCanvasTouchMove({ touches: [{ x: 320, y: 200 }] });
const panApplied = Math.abs((page.pan.x || 0) + 80) < 0.5;
page.onCanvasTouchEnd({ touches: [] });
page.redraw();
const txMoved = page.frame.tx < txBefore - 1;
const beforeTool = page.data.toolId;
page.onCanvasTap({ detail: { x: 100, y: 100 } });                                 // 拖动后的 tap 应被忽略
const dragTapIgnored = page.data.toolId === beforeTool && page._dragMoved === false;

// 缩小到下限会被夹住；缩放手势后的 tap 同样被忽略
page.onCanvasTouchStart({ touches: [{ x: 300, y: 200 }, { x: 500, y: 200 }] });  // 指距 200
page.onCanvasTouchMove({ touches: [{ x: 390, y: 200 }, { x: 410, y: 200 }] });   // ×0.1 → 夹到 0.6
const clamped = Math.abs((page.zoom || 1) - 0.6) < 0.05;
page.onCanvasTouchEnd({ touches: [] });
page.onCanvasTap({ detail: { x: 100, y: 100 } });
const pinchTapIgnored = page.data.toolId === beforeTool && page._pinchMoved === false;

console.log('双指缩放: 放大 ×2 ' + (zoomed ? '✓' : '✗') + '、取景同步 ' + (scaleApplied ? '✓' : '✗')
  + '、下限夹取 ' + (clamped ? '✓' : '✗') + '、缩放后 tap 忽略 ' + (pinchTapIgnored ? '✓' : '✗'));
if (!zoomed || !scaleApplied || !clamped || !pinchTapIgnored) process.exit(1);
console.log('放大拖动: 平移量 ' + Math.round(page.pan.x) + 'px ' + (panApplied ? '✓' : '✗')
  + '、取景跟随 ' + (txMoved ? '✓' : '✗') + '、拖动后 tap 忽略 ' + (dragTapIgnored ? '✓' : '✗'));
if (!panApplied || !txMoved || !dragTapIgnored) process.exit(1);

page.onRotateReset();
const resetOK = Math.abs((page.zoom || 1) - 1) < 0.001 && Math.abs(page.pan.x) < 0.001;
console.log('重置视角: zoom/pan 复位 ' + (resetOK ? '✓' : '✗'));
if (!resetOK) process.exit(1);
page.redraw();   // 让取景与新状态同步（真实环境由 redrawSoon 的定时器完成）

/* ---------- 5. 地块详情：带轻微手指漂移的点按也能查看详情 ---------- */
let spot = null;
for (let gx = 300; gx <= 600 && !spot; gx += 40) {
  for (let gy = 150; gy <= 300 && !spot; gy += 30) {
    if (page.hitAt(gx, gy)) spot = { x: gx, y: gy };
  }
}
if (!spot) { console.log('地块详情: 找不到可命中的地块 ✗'); process.exit(1); }
page.onCanvasTouchStart({ touches: [spot] });
page.onCanvasTouchMove({ touches: [{ x: spot.x + 8, y: spot.y + 3 }] });   // 8px 手指漂移，仍应算点按
page.onCanvasTouchEnd({ touches: [] });
page.onCanvasTap({ detail: { x: spot.x, y: spot.y } });
const detailShown = !!(page.data.pinned && page.data.pinned.name);
console.log('地块详情: 轻点查看 ' + (detailShown ? '✓' : '✗') + (detailShown ? '（' + page.data.pinned.name + '）' : ''));
if (!detailShown) process.exit(1);
page.onRemoveToggle();
page.onRemoveToggle();
console.log('MP PAGE SMOKE OK');
process.exit(0);
