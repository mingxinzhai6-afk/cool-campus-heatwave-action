/**
 * 小程序渲染层自测（Node 环境，无需微信开发者工具）：
 *   1. 用「记录调用的假 Canvas 2D 上下文」跑通 drawMap —— 任何异常/NaN 坐标都会被抓出来；
 *   2. 覆盖 5 个关卡 × 6 个角度 × 4 种图层组合 × 有/无放置物；
 *   3. 验证 buildFrame/hitTile：取景换算往返一致、地图中心点能命中地块。
 * 运行：npm run mp:smoke
 */
const path = require('node:path');
const root = path.join(__dirname, 'wechat-miniprogram-app');
const { drawMap } = require(path.join(root, 'render', 'draw.js'));
const { buildFrame, hitTile } = require(path.join(root, 'render', 'hit.js'));
const engine = require(path.join(root, 'core', 'lib', 'engine.js'));
const levelsMod = require(path.join(root, 'core', 'data', 'levels.js'));

let calls = 0;
const problems = [];

function num(name, args) {
  for (let i = 0; i < args.length; i++) {
    const v = args[i];
    if (typeof v === 'number' && !Number.isFinite(v)) {
      problems.push(name + ' 收到非法数值: ' + JSON.stringify(args));
      return;
    }
    if (typeof v === 'string' && /NaN|undefined/.test(v)) {
      problems.push(name + ' 收到含 NaN/undefined 的字符串: ' + v);
    }
  }
}

function record(name) {
  return function () {
    calls++;
    num(name, Array.prototype.slice.call(arguments));
  };
}

function makeGradient() {
  return { addColorStop: function (o, c) { num('addColorStop', [o, c]); } };
}

function makeCtx() {
  const base = {
    canvas: null,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    font: '', textAlign: 'left', textBaseline: 'alphabetic',
    lineJoin: 'miter', lineCap: 'butt',
    shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
  };
  const methods = [
    'setTransform', 'clearRect', 'save', 'restore', 'translate', 'scale', 'rotate',
    'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'arc',
    'quadraticCurveTo', 'bezierCurveTo', 'fillRect', 'strokeRect', 'strokeText', 'fillText',
    'setLineDash', 'clip',
  ];
  for (let i = 0; i < methods.length; i++) base[methods[i]] = record(methods[i]);
  base.createLinearGradient = function () { calls++; num('createLinearGradient', Array.prototype.slice.call(arguments)); return makeGradient(); };
  base.createRadialGradient = function () { calls++; num('createRadialGradient', Array.prototype.slice.call(arguments)); return makeGradient(); };
  base.measureText = function (t) { return { width: String(t || '').length * 6 }; };
  return base;
}

/** 造一个“玩了半天”的状态：放置几个工具 + 推进一轮 + 开图层 + 灾事件。 */
function busyState(levelId) {
  let s = engine.createState(levelId);
  const unlock = levelsMod.getLevel(levelId).unlock;
  let placed = 0;
  for (let y = 0; y < 18 && placed < 4; y++) {
    for (let x = 0; x < 18 && placed < 4; x++) {
      for (let u = 0; u < unlock.length; u++) {
        if (engine.canPlace(s, unlock[u], x, y).ok) {
          const next = engine.place(s, unlock[u], x, y);
          if (next !== s) { s = next; placed++; break; }
        }
      }
    }
  }
  const advanced = engine.advance(s);
  return advanced !== s ? advanced : s;
}

let scenarios = 0;
const rotations = [0, 37, 90, 165, 225, 305];
const layerSets = [
  { heat: true, shade: false, people: false, sensitive: false },
  { heat: true, shade: true, people: true, sensitive: true },
  { heat: false, shade: true, people: false, sensitive: false },
  { heat: true, shade: false, people: true, sensitive: false },
];

for (let li = 0; li < levelsMod.LEVELS.length; li++) {
  const levelId = levelsMod.LEVELS[li].id;
  for (let ri = 0; ri < rotations.length; ri++) {
    const rotation = rotations[ri];
    for (let si = 0; si < layerSets.length; si++) {
      const state = si % 2 === 0 ? engine.createState(levelId) : busyState(levelId);
      const cw = 900;
      const ch = 420;
      const frame = buildFrame(levelId, rotation, cw, ch);
      const toolId = levelsMod.getLevel(levelId).unlock[0];
      drawMap(makeCtx(), {
        levelId: levelId,
        state: state,
        hour: engine.currentHour(state),
        layers: layerSets[si],
        toolId: toolId,
        hover: { x: 9, y: 9 },
        adviceMark: { x: 8, y: 8 },
        pickMark: { x: 10, y: 10 },
        focus: levelsMod.getLevel(levelId).focus,
        rotation: rotation,
        frame: frame,
        cw: cw,
        ch: ch,
        dpr: 2,
      });
      scenarios++;

      // 命中测试：视口中心 ↔ viewBox 往返 + 必须能命中地图上的某个地块
      const mid = { x: cw / 2, y: ch / 2 };
      const vb = frame.toViewBox(mid.x, mid.y);
      const back = frame.toScreen(vb.vx, vb.vy);
      if (Math.abs(back.x - mid.x) > 0.01 || Math.abs(back.y - mid.y) > 0.01) {
        problems.push('取景换算往返不一致: ' + JSON.stringify({ mid: mid, back: back }));
      }
      let hits = 0;
      for (let gx = 0.2; gx <= 0.8; gx += 0.1) {
        for (let gy = 0.3; gy <= 0.7; gy += 0.1) {
          const p = frame.toViewBox(cw * gx, ch * gy);
          if (hitTile(frame, p.vx, p.vy)) hits++;
        }
      }
      if (hits === 0) problems.push('命中测试异常：' + levelId + ' 旋转 ' + rotation + '° 下地图中心区域一个地块都没命中');
    }
  }
}

/* ---------- PDF 模块：排版绘制不崩 + 生成合法单页 PDF ---------- */
(function () {
  const pdfMod = require(path.join(root, 'render', 'pdf.js'));
  const ctx = makeCtx();
  pdfMod.drawPlanSheet(ctx, {
    title: '清凉改造行动清单',
    sub: '第 1 关 · 正午的中心广场｜结算于 14:00｜可直接打印或截图提交给后勤',
    stats: [
      { label: '改造点位', value: 3 }, { label: '预计花费', value: '12 万' }, { label: '剩余预算', value: '8 万' },
      { label: '公众支持度', value: 62 }, { label: '加权热指数', value: '74.2' }, { label: '脆弱群体高暴露', value: '105 人' },
    ],
    headline: '良好：整体达标，仍有短板',
    groups: [{
      toolName: '行道树', meta: '×2 · 单个 3 万 · 半径 2 格', locs: ['潮汐广场', '食堂前坪'],
      issue: '道路、广场边缘的持续暴晒', caveat: '树冠成荫需要时间，配合其他手段更稳',
    }],
    hot: [{ name: '潮汐广场', heat: 78, pop: 120 }],
    footer: '本清单由本地推演引擎生成（模拟参数，非实测数据）。',
  }, 1240, 1754);
  const jpeg = new Uint8Array(2048).fill(7);
  const pdf = pdfMod.buildPdf(jpeg, 1240, 1754);
  const head = Buffer.from(pdf.slice(0, 8)).toString('latin1');
  const tail = Buffer.from(pdf.slice(pdf.length - 8)).toString('latin1');
  const body = Buffer.from(pdf).toString('latin1');
  if (head !== '%PDF-1.4') problems.push('PDF 头部不对: ' + head);
  if (tail.indexOf('%%EOF') < 0) problems.push('PDF 尾部缺少 %%EOF');
  if (body.indexOf('/DCTDecode') < 0) problems.push('PDF 缺少图像流声明');
  if (body.indexOf('/Count 1') < 0) problems.push('PDF 页数声明不对');
  if (body.indexOf('startxref') < 0) problems.push('PDF 缺少 startxref');
  console.log('PDF 模块: 页眉 ' + head + '，共 ' + pdf.length + ' 字节，含图像流 ✓');
})();

console.log('渲染场景: ' + scenarios + ' 个，绘制调用: ' + calls + ' 次');
if (problems.length) {
  console.log('发现 ' + problems.length + ' 个问题：');
  const uniq = Array.from(new Set(problems)).slice(0, 20);
  uniq.forEach(function (p) { console.log('  - ' + p); });
  process.exit(1);
} else {
  console.log('MP RENDER SMOKE OK：无异常、无 NaN 坐标、命中测试正常');
}
