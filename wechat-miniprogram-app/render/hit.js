/**
 * 取景与命中：把「画布像素坐标 ↔ 地图 viewBox 坐标 ↔ 地块」三者的换算集中在这里，
 * 保证渲染（draw.js）与点击命中（本文件 hitTile）永远用同一套取景参数，不会错位。
 *
 * viewBox 的取法完全按主项目 IsoMap.tsx：按旋转后的实际包围盒取景，
 * 画布内等比缩放到居中（等效 SVG 的 preserveAspectRatio="xMidYMid meet"）。
 */
const { makeView } = require('../core/lib/iso.js');
const { getMap } = require('../core/data/campus.js');
const G = require('./geometry.js');

/**
 * 建立一帧的取景：旋转投影 + 深度排序 + 画布适配。
 * zoom = 缩放倍数（1 = 适配全图；双指捏合可放大看中间的建筑群），默认 1。
 * pan  = 平移像素偏移 {x, y}（放大后单指拖动建筑；超出边界会被夹住），默认 0。
 * @returns {{
 *   fr: object, list: Array<{tile: object, depth: number}>,
 *   baseView: { x: number, y: number, w: number, h: number },
 *   scale: number, tx: number, ty: number,
 *   toViewBox: (x: number, y: number) => { vx: number, vy: number },
 *   toScreen: (vx: number, vy: number) => { x: number, y: number }
 * }}
 */
function buildFrame(levelId, rotation, cw, ch, zoom, pan) {
  const map = getMap(levelId);
  const fr = makeView(rotation, map.width, map.height);

  const tiles = map.tiles.filter(function (t) { return !t.void; });
  const list = tiles.map(function (tile) {
    return { tile: tile, depth: fr.depth(tile.x + 0.5, tile.y + 0.5) };
  });
  list.sort(function (a, b) { return a.depth - b.depth; });

  const corners = [fr.pt(0, 0, 0), fr.pt(map.width, 0, 0), fr.pt(map.width, map.height, 0), fr.pt(0, map.height, 0)];
  const xs = corners.map(function (c) { return c.sx; });
  const ys = corners.map(function (c) { return c.sy; });
  const minX = Math.min.apply(null, xs);
  const maxX = Math.max.apply(null, xs);
  const minY = Math.min.apply(null, ys);
  const maxY = Math.max.apply(null, ys);
  const padX = 80;
  const padTop = 190;
  const padBottom = 110;
  const baseView = {
    x: minX - padX,
    y: minY - padTop,
    w: (maxX - minX) + padX * 2,
    h: (maxY - minY) + padTop + padBottom,
  };

  const z = (typeof zoom === 'number' && zoom > 0) ? zoom : 1;
  const scale = Math.min(cw / baseView.w, ch / baseView.h) * z;
  const contentW = baseView.w * scale;
  const contentH = baseView.h * scale;
  const px = pan && typeof pan.x === 'number' ? pan.x : 0;
  const py = pan && typeof pan.y === 'number' ? pan.y : 0;
  // 平移（放大后单指拖动）：内容比画布大时允许拖动但不许露白边，比画布小时锁定居中
  const tx = contentW > cw ? Math.min(0, Math.max(cw - contentW, (cw - contentW) / 2 + px)) : (cw - contentW) / 2;
  const ty = contentH > ch ? Math.min(0, Math.max(ch - contentH, (ch - contentH) / 2 + py)) : (ch - contentH) / 2;

  return {
    fr: fr,
    list: list,
    baseView: baseView,
    scale: scale,
    tx: tx,
    ty: ty,
    toViewBox: function (x, y) {
      return { vx: (x - tx) / scale + baseView.x, vy: (y - ty) / scale + baseView.y };
    },
    toScreen: function (vx, vy) {
      return { x: (vx - baseView.x) * scale + tx, y: (vy - baseView.y) * scale + ty };
    },
  };
}

/** 射线法点在多边形内判断。 */
function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].sx;
    const yi = pts[i].sy;
    const xj = pts[j].sx;
    const yj = pts[j].sy;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 点击命中地块：与主项目 SVG「交互层」同语义——
 * 从离观察者最近的地块往回找（front-most first），建筑先测可见立面、再测地面四边形。
 */
function hitTile(frame, vx, vy) {
  const fr = frame.fr;
  const list = frame.list;
  for (let k = list.length - 1; k >= 0; k--) {
    const tile = list[k].tile;
    if (tile.elev > 0) {
      const vis = fr.visible;
      for (let f = vis.length - 1; f >= 0; f--) {
        if (pointInPoly(vx, vy, G.faceQuad(fr, tile.x, tile.y, tile.elev, vis[f]))) return tile;
      }
    }
    if (pointInPoly(vx, vy, G.diamond(fr, tile.x, tile.y, tile.elev))) return tile;
  }
  return null;
}

module.exports = { buildFrame: buildFrame, hitTile: hitTile, pointInPoly: pointInPoly };
