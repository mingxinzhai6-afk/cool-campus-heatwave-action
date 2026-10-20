/**
 * 等轴几何工具 —— 由主项目 src/components/MapArt.tsx 移植（去掉 JSX，只保留纯几何）。
 * 全部返回点数组（Pt[] = { sx, sy }[]），由调用方决定画法：
 *   poly()/fill()/stroke() 负责 Canvas 路径，命中测试直接用同一批点。
 */
const { rnd } = require('../core/lib/iso.js');

/** 地块 (i0, j0) 在高度 z 上的地面四边形（任意角度下是平行四边形）。 */
function diamond(fr, i0, j0, z) {
  return [fr.pt(i0, j0, z), fr.pt(i0 + 1, j0, z), fr.pt(i0 + 1, j0 + 1, z), fr.pt(i0, j0 + 1, z)];
}

/** 该方向立面在指定高度（v: 0=地面，1=檐口）上的两点。 */
function faceEdgeAt(fr, i0, j0, dir, z, v) {
  switch (dir) {
    case 'e': return [fr.pt(i0 + 1, j0 + 1, v * z), fr.pt(i0 + 1, j0, v * z)];
    case 'n': return [fr.pt(i0, j0, v * z), fr.pt(i0 + 1, j0, v * z)];
    case 'w': return [fr.pt(i0, j0, v * z), fr.pt(i0, j0 + 1, v * z)];
    default: return [fr.pt(i0, j0 + 1, v * z), fr.pt(i0 + 1, j0 + 1, v * z)];
  }
}

/** 立面上的点：u 沿墙面横向（0→1），v 竖直方向（0 = 地面，1 = 檐口）。 */
function wallPt(fr, i0, j0, z, dir, u, v) {
  const e = faceEdgeAt(fr, i0, j0, dir, z, v);
  const a = e[0];
  const b = e[1];
  return { sx: a.sx + (b.sx - a.sx) * u, sy: a.sy + (b.sy - a.sy) * u };
}

function wallQuad(fr, i0, j0, z, dir, u0, u1, v0, v1) {
  return [
    wallPt(fr, i0, j0, z, dir, u0, v0),
    wallPt(fr, i0, j0, z, dir, u1, v0),
    wallPt(fr, i0, j0, z, dir, u1, v1),
    wallPt(fr, i0, j0, z, dir, u0, v1),
  ];
}

/** 整个立面（u 0→1，v 0→檐口）。 */
function faceQuad(fr, i0, j0, z, dir) {
  return wallQuad(fr, i0, j0, z, dir, 0, 1, 0, 1);
}

/** 屋顶坐标：顶面内 (u,v) ∈ [0,1]² 定位（u 沿 i，v 沿 j），再抬升 dz。 */
function roofPt(fr, i0, j0, z, u, v, dz) {
  return fr.pt(i0 + u, j0 + v, z + (dz || 0));
}

function roofQuad(fr, i0, j0, z, u0, v0, u1, v1, dz) {
  return [
    roofPt(fr, i0, j0, z, u0, v0, dz),
    roofPt(fr, i0, j0, z, u1, v0, dz),
    roofPt(fr, i0, j0, z, u1, v1, dz),
    roofPt(fr, i0, j0, z, u0, v1, dz),
  ];
}

/* —— 任意矩形轮廓（退台 / 檐口 / 连廊共用） —— */

/** 矩形轮廓某条边在高度 z 上的两个端点（u 沿这条边 0→1）。 */
function edge2(fr, r, z, dir) {
  switch (dir) {
    case 's': return [fr.pt(r.iA, r.jB, z), fr.pt(r.iB, r.jB, z)];
    case 'n': return [fr.pt(r.iA, r.jA, z), fr.pt(r.iB, r.jA, z)];
    case 'e': return [fr.pt(r.iB, r.jA, z), fr.pt(r.iB, r.jB, z)];
    default: return [fr.pt(r.iA, r.jA, z), fr.pt(r.iA, r.jB, z)];
  }
}

/** 矩形轮廓的立面片段：u 沿面横向（0→1），高度从 zB 到 zT。 */
function faceU(fr, r, zB, zT, dir, u0, u1) {
  if (u0 === undefined) u0 = 0;
  if (u1 === undefined) u1 = 1;
  const b = edge2(fr, r, zB, dir);
  const t = edge2(fr, r, zT, dir);
  const lerp = function (a, c, u) {
    return { sx: a.sx + (c.sx - a.sx) * u, sy: a.sy + (c.sy - a.sy) * u };
  };
  return [lerp(b[0], b[1], u0), lerp(b[0], b[1], u1), lerp(t[0], t[1], u1), lerp(t[0], t[1], u0)];
}

/** 矩形轮廓的顶面。 */
function rectTop(fr, r, z) {
  return [fr.pt(r.iA, r.jA, z), fr.pt(r.iB, r.jA, z), fr.pt(r.iB, r.jB, z), fr.pt(r.iA, r.jB, z)];
}

/** 顶面内的点：u/v ∈ [0,1]²，再抬升 dz。 */
function rectP(fr, r, z, u, v, dz) {
  return fr.pt(r.iA + u * (r.iB - r.iA), r.jA + v * (r.jB - r.jA), z + (dz || 0));
}

function rectQ(fr, r, z, u0, v0, u1, v1, dz) {
  return [
    rectP(fr, r, z, u0, v0, dz),
    rectP(fr, r, z, u1, v0, dz),
    rectP(fr, r, z, u1, v1, dz),
    rectP(fr, r, z, u0, v1, dz),
  ];
}

function inflate(r, o) {
  return { iA: r.iA - o, jA: r.jA - o, iB: r.iB + o, jB: r.jB + o };
}

/* —— 建筑体量（BuildingBlock 与 Corridor 共用） —— */

function roofKind(tile, seed, z) {
  const n = tile.name;
  if (/图书馆|阅览馆/.test(n)) return 'atrium';
  if (/医院/.test(n)) return 'clinic';
  if (/幼儿园/.test(n)) return 'kinder';
  if (/餐厅|服务中心/.test(n)) return 'saw';
  if (/体育馆|活动中心/.test(n)) return 'sports';
  if (/公寓|生活区/.test(n)) return 'dorm';
  if (z >= 4 && seed > 0.55) return 'atrium';
  return 'flat';
}

/** 一栋楼的“体量矩形”：两层以上内收成塔楼（与架空连廊共用同一轮廓）。 */
function massingRect(tile) {
  const seed = rnd(tile.x, tile.y, 3);
  const kind = roofKind(tile, seed, tile.elev);
  if (!(tile.elev >= 2 && kind !== 'sports')) {
    return { iA: tile.x, jA: tile.y, iB: tile.x + 1, jB: tile.y + 1 };
  }
  const ins = 0.13 + seed * 0.05;
  return {
    iA: tile.x + ins + rnd(tile.x, tile.y, 31) * 0.06,
    jA: tile.y + ins + rnd(tile.x, tile.y, 32) * 0.06,
    iB: tile.x + 1 - ins - rnd(tile.x, tile.y, 33) * 0.06,
    jB: tile.y + 1 - ins - rnd(tile.x, tile.y, 34) * 0.06,
  };
}

/* —— Canvas 画法小工具 —— */

/** 把点数组描成路径（不自动填充/描边）。 */
function trace(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].sx, pts[0].sy);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].sx, pts[i].sy);
  ctx.closePath();
}

function fillPoly(ctx, pts, color, alpha) {
  trace(ctx, pts);
  const prev = ctx.globalAlpha;
  if (alpha !== undefined && alpha !== null) ctx.globalAlpha = prev * alpha;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = prev;
}

function strokePoly(ctx, pts, color, width, dash, alpha) {
  trace(ctx, pts);
  const prev = ctx.globalAlpha;
  if (alpha !== undefined && alpha !== null) ctx.globalAlpha = prev * alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.stroke();
  if (dash) ctx.setLineDash([]);
  ctx.globalAlpha = prev;
}

/** 椭圆路径：用缩放圆弧实现，兼容所有 canvas 实现。 */
function ellipsePath(ctx, cx, cy, rx, ry) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.restore();
}

function fillEllipse(ctx, cx, cy, rx, ry, color, alpha) {
  ellipsePath(ctx, cx, cy, rx, ry);
  const prev = ctx.globalAlpha;
  if (alpha !== undefined && alpha !== null) ctx.globalAlpha = prev * alpha;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = prev;
}

function strokeEllipse(ctx, cx, cy, rx, ry, color, width, alpha) {
  ellipsePath(ctx, cx, cy, rx, ry);
  const prev = ctx.globalAlpha;
  if (alpha !== undefined && alpha !== null) ctx.globalAlpha = prev * alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.globalAlpha = prev;
}

/** 圆角矩形路径（医院红十字牌等）。 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

module.exports = {
  diamond, faceEdgeAt, wallPt, wallQuad, faceQuad, roofPt, roofQuad,
  edge2, faceU, rectTop, rectP, rectQ, inflate,
  roofKind, massingRect,
  trace, fillPoly, strokePoly, ellipsePath, fillEllipse, strokeEllipse, roundRect,
};
