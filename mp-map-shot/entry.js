/* 小程序渲染器直出截图入口（浏览器里跑，供 mp-map-shot.cjs 打包用） */
const { drawMap } = require('../wechat-miniprogram-app/render/draw.js');
const { buildFrame } = require('../wechat-miniprogram-app/render/hit.js');
const engine = require('../wechat-miniprogram-app/core/lib/engine.js');
const levelsMod = require('../wechat-miniprogram-app/core/data/levels.js');

window.renderShot = function (canvas, levelId, rotation, cw, ch, zoom) {
  const dpr = 2;
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  const ctx = canvas.getContext('2d');
  const state = engine.createState(levelId);
  const level = levelsMod.getLevel(levelId);
  const frame = buildFrame(levelId, rotation, cw, ch, zoom || 1);
  drawMap(ctx, {
    levelId: levelId,
    state: state,
    hour: engine.currentHour(state),
    layers: { heat: true, shade: false, people: false, sensitive: false },
    toolId: null,
    hover: null,
    adviceMark: null,
    pickMark: null,
    focus: level.focus,
    rotation: rotation,
    frame: frame,
    cw: cw,
    ch: ch,
    dpr: dpr,
  });

  /* 调试标注：给每栋楼画 (x,y) 与名称，便于定位 */
  if (new URLSearchParams(location.search).get('debug') === '1') {
    const fr = frame.fr;
    const map = require('../wechat-miniprogram-app/core/data/campus.js').getMap(levelId);
    for (const tile of map.tiles) {
      if (!tile || tile.void || tile.elev <= 0) continue;
      const p = fr.pt(tile.x + 0.5, tile.y + 0.5, tile.elev + 0.3);
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(frame.tx, frame.ty);
      ctx.scale(frame.scale, frame.scale);
      ctx.translate(-frame.baseView.x, -frame.baseView.y);
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeText(tile.x + ',' + tile.y + ' ' + tile.name, p.sx, p.sy);
      ctx.fillStyle = '#c2410c';
      ctx.fillText(tile.x + ',' + tile.y + ' ' + tile.name, p.sx, p.sy);
      ctx.restore();
    }
  }
  return 'ok';
};
