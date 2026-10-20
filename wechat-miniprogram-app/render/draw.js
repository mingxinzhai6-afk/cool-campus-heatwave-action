/**
 * Canvas 地图渲染器 —— 由主项目 IsoMap.tsx + MapArt.tsx 移植。
 *
 * 同一套等轴几何、同一套配色与明暗规则（viewBox 坐标系、深度排序、立面按外法线剔除），
 * 只是把 SVG 元素换成 Canvas 绘制：字形用「先描边后填充」模拟 paint-order，
 * 渐变用 createLinearGradient/createRadialGradient，其余几何一律走 render/geometry.js。
 *
 * 入口：drawMap(ctx, opts)，opts 见下方注释；坐标系换算在 render/hit.js 的 buildFrame。
 */
const iso = require('../core/lib/iso.js');
const campus = require('../core/data/campus.js');
const groups = require('../core/data/groups.js');
const toolsMod = require('../core/data/tools.js');
const engine = require('../core/lib/engine.js');
const G = require('./geometry.js');

const { HOUR_SKY, WEATHER_TINT, TYPE_STYLE, heatColor, heatRamp, mixHex, shade, rnd, WALL_SHADE, WALL_SHEEN, Z_H } = iso;
const { GRID, getMap, tileGroups, tilePopulation, tileOutdoor } = campus;
const { GROUPS, GROUP_ORDER, VULNERABLE_GROUPS, HIGH_HEAT } = groups;
const { TOOLS } = toolsMod;

/* ================================================================== *
 * 建筑配色（与主项目 MapArt.tsx 一致）
 * ================================================================== */
const PALETTES = [
  { wall: '#f3f5f5', roof: '#cfdcd8', trim: '#8ba49d', glass: '#d9ecf1' },
  { wall: '#f1f7f4', roof: '#c2dcd1', trim: '#7fa79a', glass: '#d3ebee' },
  { wall: '#f2f6f8', roof: '#c6d7e2', trim: '#87a2b0', glass: '#d7ebf4' },
  { wall: '#f6f4ee', roof: '#d9d1bd', trim: '#a79e8b', glass: '#dbebf1' },
  { wall: '#f1f6f2', roof: '#c8dfca', trim: '#84a78d', glass: '#d5ebee' },
  { wall: '#eff2f2', roof: '#bccdca', trim: '#7c9893', glass: '#d1e8ee' },
];

function paletteFor(tile) {
  const n = tile.name;
  if (/图书馆|阅览馆/.test(n)) return PALETTES[2];
  if (/医院/.test(n)) return PALETTES[1];
  if (/幼儿园/.test(n)) return PALETTES[4];
  if (/餐厅|服务中心/.test(n)) return PALETTES[3];
  if (/体育馆|活动中心/.test(n)) return PALETTES[5];
  if (/公寓|生活区|科研/.test(n)) return PALETTES[0];
  if (/训练|工程/.test(n)) return PALETTES[5];
  if (/艺术|创新|教学/.test(n)) return PALETTES[2];
  if (tile.type === 'dorm') return PALETTES[0];
  if (tile.type === 'canteen') return PALETTES[3];
  return PALETTES[Math.floor(rnd(tile.x, tile.y, 9) * PALETTES.length) % PALETTES.length];
}

/* ================================================================== *
 * 绘制小工具
 * ================================================================== */
function polyline(ctx, pts, color, width, alpha, dash) {
  const prev = ctx.globalAlpha;
  if (alpha !== undefined && alpha !== null) ctx.globalAlpha = prev * alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(pts[0].sx, pts[0].sy);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].sx, pts[i].sy);
  ctx.stroke();
  if (dash) ctx.setLineDash([]);
  ctx.globalAlpha = prev;
}

/** 先描边再填充的文字（模拟 SVG 的 paint-order: stroke）。 */
function halotext(ctx, str, x, y, font, fill, haloColor, haloWidth, alpha) {
  const prev = ctx.globalAlpha;
  if (alpha !== undefined && alpha !== null) ctx.globalAlpha = prev * alpha;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (haloColor) {
    ctx.lineWidth = haloWidth;
    ctx.strokeStyle = haloColor;
    ctx.lineJoin = 'round';
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(str, x, y);
  ctx.globalAlpha = prev;
}

function line(ctx, a, b, color, width, alpha, cap) {
  polyline(ctx, [a, b], color, width, alpha);
}

/* ================================================================== *
 * 建筑：体块 / 檐口 / 屋顶细节
 * ================================================================== */
function drawVolume(C, r, zB, zT, p, tint) {
  const fr = C.fr;
  const ctx = C.ctx;
  const h = zT - zB;
  const rows = h >= 3 ? 2 : 1;
  const cols = 2;
  const v0 = 0.18;
  const v1 = 0.88;
  const rowH = (v1 - v0) / rows;
  const glass = tint(p.glass);
  const trim = tint(p.trim);

  for (let d = 0; d < fr.visible.length; d++) {
    const dir = fr.visible[d];
    const face = G.faceU(fr, r, zB, zT, dir);
    const base = tint(shade(p.wall, WALL_SHADE[dir]));
    G.fillPoly(ctx, face, base);
    G.strokePoly(ctx, face, shade(base, -0.15), 0.7);
    if (WALL_SHEEN[dir] > 0) {
      G.fillPoly(ctx, G.faceU(fr, r, zB + h * 0.36, zT, dir), '#ffffff', WALL_SHEEN[dir] * 0.75);
    }
  }

  for (let d = 0; d < fr.visible.length; d++) {
    const dir = fr.visible[d];
    for (let k = 1; k < rows; k++) {
      const e = G.edge2(fr, r, zB + h * (v0 + rowH * k), dir);
      line(ctx, e[0], e[1], trim, 0.9, 0.26);
    }
  }

  for (let d = 0; d < fr.visible.length; d++) {
    const dir = fr.visible[d];
    for (let rr = 0; rr < rows; rr++) {
      const zz0 = zB + h * (v0 + rowH * rr + rowH * 0.16);
      const zz1 = zB + h * (v0 + rowH * rr + rowH * 0.76);
      for (let c = 0; c < cols; c++) {
        const cell = 0.9 / cols;
        const u0 = 0.05 + cell * c + cell * 0.16;
        const u1 = 0.05 + cell * c + cell * 0.84;
        G.fillPoly(ctx, G.faceU(fr, r, zz0 - 0.09, zz0 - 0.02, dir, u0 - 0.03, u1 + 0.03), shade(tint(p.wall), -0.11), 0.7);
        G.fillPoly(ctx, G.faceU(fr, r, zz0 - 0.07, zz1 + 0.07, dir, u0 - 0.012, u1 + 0.012), trim, 0.85);
        G.fillPoly(ctx, G.faceU(fr, r, zz0, zz1, dir, u0, u1), glass, 0.96);
        G.strokePoly(ctx, G.faceU(fr, r, zz0, zz1, dir, u0, u1), '#ffffff', 0.4);
      }
    }
  }
}

/** 遮阳檐口：比体块略大的薄板（可见方向薄边 + 顶面 + 女儿墙描线）。 */
function drawEave(C, r, z, over, thick, color) {
  const fr = C.fr;
  const ctx = C.ctx;
  const R = G.inflate(r, over);
  for (let d = 0; d < fr.visible.length; d++) {
    const dir = fr.visible[d];
    G.fillPoly(ctx, G.faceU(fr, R, z - thick, z, dir), shade(color, WALL_SHADE[dir] * 0.75));
  }
  G.fillPoly(ctx, G.rectTop(fr, R, z), color);
  G.strokePoly(ctx, G.rectTop(fr, R, z), shade(color, -0.12), 0.8);
  G.strokePoly(ctx, G.rectTop(fr, G.inflate(r, over - 0.025), z + 0.028), '#ffffff', 0.8, null, 0.7);
}

/** 一丛绿植（屋顶花园 / 花池用的小圆簇）。 */
function drawTuft(C, i0, j0, z, u, v, s, tone) {
  const ctx = C.ctx;
  const c = G.roofPt(C.fr, i0, j0, z, u, v, 0);
  const g1 = tone ? '#7fb99a' : '#6fae8b';
  const g2 = tone ? '#a8d4b8' : '#9fcdae';
  G.fillEllipse(ctx, c.sx - 2.1 * s, c.sy - 2.2 * s, 3.2 * s, 3.2 * s, g1);
  G.fillEllipse(ctx, c.sx + 2.2 * s, c.sy - 1.8 * s, 3.6 * s, 3.6 * s, g2);
  G.fillEllipse(ctx, c.sx, c.sy - 4.2 * s, 2.9 * s, 2.9 * s, '#b6dcc3');
  G.strokeEllipse(ctx, c.sx, c.sy - 4.2 * s, 2.9 * s, 2.9 * s, '#ffffff', 0.35);
}

function drawBuilding(C, tile, heatTint, heat) {
  const fr = C.fr;
  const ctx = C.ctx;
  const i0 = tile.x;
  const j0 = tile.y;
  const z = tile.elev * C.zScale(tile);
  const p = paletteFor(tile);
  const seed = rnd(tile.x, tile.y, 3);
  const visible = fr.visible;
  const greenroof = C.toolAt(tile) === 'greenroof';

  const mixAmt = heatTint ? 0.2 + 0.46 * Math.min(1, Math.max(0, (heat - 30) / 62)) : 0;
  const tint = function (c) { return heatTint ? mixHex(c, heatTint, mixAmt) : c; };
  const roof = greenroof ? tint('#6fbf8f') : tint(p.roof);
  const trim = tint(p.trim);

  const kind = G.roofKind(tile, seed, z);
  const split = z >= 2 && kind !== 'sports';
  const podiumH = split ? Math.max(1, Math.floor(z / 2)) : z;
  const towerH = z - podiumH;
  const base = { iA: i0, jA: j0, iB: i0 + 1, jB: j0 + 1 };
  const tower = G.massingRect(tile);
  const tw = tower.iB - tower.iA;
  const th = tower.jB - tower.jA;

  // 落地阴影
  G.fillPoly(ctx, G.roofQuad(fr, i0, j0, 0, -0.03, -0.03, 1.03, 1.03, 0.004), '#41616f', 0.1);

  // 底座体块
  drawVolume(C, base, 0, podiumH, p, tint);

  // 入口（+j 面朝向观察者时）
  if (visible.indexOf('s') >= 0) {
    const doorTop = podiumH >= 2 ? 0.42 : 0.52;
    G.fillPoly(ctx, G.faceU(fr, base, 0, doorTop, 's', 0.4, 0.6), trim, 0.9);
    G.fillPoly(ctx, G.faceU(fr, base, doorTop, doorTop + 0.06, 's', 0.34, 0.66), shade(trim, 0.24));
    G.strokePoly(ctx, G.faceU(fr, base, doorTop, doorTop + 0.06, 's', 0.34, 0.66), shade(trim, -0.08), 0.5);
  }

  drawEave(C, base, podiumH, 0.045, 0.055, shade(tint(p.wall), -0.04));

  if (split && towerH > 0) drawVolume(C, tower, podiumH, z, p, tint);

  // 屋面檐口
  drawEave(C, split && towerH > 0 ? tower : base, z, 0.06, 0.06, roof);

  // 屋顶小花园（图书馆 / 高层的平屋面）
  if (kind === 'flat' || kind === 'atrium') {
    const gu = tower.iA - i0 + tw * (seed > 0.7 ? 0.24 : 0.76);
    const gv = tower.jB - j0 - th * 0.22;
    G.fillPoly(ctx, G.roofQuad(fr, i0, j0, z, gu - 0.12, gv - 0.1, gu + 0.12, gv + 0.1, 0.035), '#e2e9e4');
    G.strokePoly(ctx, G.roofQuad(fr, i0, j0, z, gu - 0.12, gv - 0.1, gu + 0.12, gv + 0.1, 0.035), '#cfdad4', 0.5);
    drawTuft(C, i0, j0, z + 0.035, gu - 0.04, gv - 0.015, 0.82, 0);
    drawTuft(C, i0, j0, z + 0.035, gu + 0.045, gv + 0.02, 0.6, 1);
  }

  // 屋顶设备：楼梯间（所有楼）+ 高楼天线
  const roofRect = split && towerH > 0 ? tower : base;
  (function () {
    const sx = 0.16 + seed * 0.22;
    const sy = 0.16 + rnd(roofRect.iA, roofRect.jA, 11) * 0.2;
    const s = 0.24;
    const sh = 0.55;
    const P = function (u, v, dz) { return G.rectP(fr, roofRect, z, u, v, dz); };
    const Q = function (u0, v0, u1, v1, dz) { return G.rectQ(fr, roofRect, z, u0, v0, u1, v1, dz); };
    G.fillPoly(ctx, [P(sx + s, sy, sh), P(sx + s, sy + s, sh), P(sx + s, sy + s, 0.02), P(sx + s, sy, 0.02)], shade(trim, -0.08));
    G.fillPoly(ctx, [P(sx, sy + s, sh), P(sx + s, sy + s, sh), P(sx + s, sy + s, 0.02), P(sx, sy + s, 0.02)], trim);
    G.fillPoly(ctx, Q(sx, sy, sx + s, sy + s, sh), shade(trim, 0.14));
    G.strokePoly(ctx, Q(sx, sy, sx + s, sy + s, sh), shade(trim, -0.12), 0.5);
    if (z >= 4) {
      const t = P(0.7, 0.3, 0.05);
      line(ctx, t, { sx: t.sx, sy: t.sy - 26 }, p.accent || trim, 1.6);
      G.fillEllipse(ctx, t.sx, t.sy - 27, 2.2, 2.2, '#ff6b6b');
    }
  })();

  // 医院红十字
  if (kind === 'clinic' && visible.indexOf('s') >= 0) {
    const sp = G.faceU(fr, base, podiumH * 0.34, podiumH * 0.78, 's');
    const c = {
      sx: (sp[0].sx + sp[1].sx + sp[2].sx + sp[3].sx) / 4,
      sy: (sp[0].sy + sp[1].sy + sp[2].sy + sp[3].sy) / 4,
    };
    const s = 5.4;
    G.roundRect(ctx, c.sx - s * 0.9, c.sy - s * 1.5, s * 1.8, s * 3, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.fillStyle = '#d9534f';
    ctx.fillRect(c.sx - s * 0.34, c.sy - s * 1.05, s * 0.68, s * 2.1);
    ctx.fillRect(c.sx - s * 1.05, c.sy - s * 0.34, s * 2.1, s * 0.68);
  }

  // 绿色屋顶改造
  if (greenroof) drawGreenRoofDeck(C, roofRect, z);
}

/** 建筑高度的「中心增强」比例：越靠地图中心越高、越靠边缘越矮（仅小程序版，电脑版不生效）。
 *  只影响观感，不参与任何玩法计算。 */
function zScaleOf(map, tile) {
  if (tile.elev <= 0) return 1;
  const cx = (map.width - 1) / 2;
  const cy = (map.height - 1) / 2;
  const d = Math.sqrt((tile.x - cx) * (tile.x - cx) + (tile.y - cy) * (tile.y - cy));
  const t = Math.max(0, Math.min(1, (d - 2.6) / 2.4));
  return 1.35 - 0.65 * t;
}

/** 架空连廊（相邻两栋高楼之间）。 */
function drawCorridor(C, tile, nb, dir) {
  const fr = C.fr;
  const ctx = C.ctx;
  const A = G.massingRect(tile);
  const B = G.massingRect(nb);
  const zc = Math.min(tile.elev * C.zScale(tile), nb.elev * C.zScale(nb)) - 0.58;
  const th = 0.13;
  const alongI = dir === 'e' || dir === 'w';
  const mid = alongI
    ? (Math.max(A.jA, B.jA) + Math.min(A.jB, B.jB)) / 2
    : (Math.max(A.iA, B.iA) + Math.min(A.iB, B.iB)) / 2;
  const half = 0.14;
  const r = alongI
    ? { iA: Math.min(A.iB, B.iB) - 0.015, jA: mid - half, iB: Math.max(A.iA, B.iA) + 0.015, jB: mid + half }
    : { iA: mid - half, jA: Math.min(A.jB, B.jB) - 0.015, iB: mid + half, jB: Math.max(A.jA, B.jA) + 0.015 };
  for (let d = 0; d < fr.visible.length; d++) {
    const side = fr.visible[d];
    G.fillPoly(ctx, G.faceU(fr, r, zc, zc + th, side), shade('#dce8e4', WALL_SHADE[side] * 0.85));
  }
  G.fillPoly(ctx, G.rectTop(fr, r, zc + th), '#dbe7e2');
  G.strokePoly(ctx, G.rectTop(fr, r, zc + th), '#b9cbc4', 0.7);
  G.strokePoly(ctx, G.rectTop(fr, G.inflate(r, -0.025), zc + th + 0.04), '#ffffff', 0.9, null, 0.9);
}

/* ================================================================== *
 * 地表与小件
 * ================================================================== */
function drawTree(ctx, x, y, s, seed) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  G.fillEllipse(ctx, 1.5, 0.5, 9, 3.6, '#3f5f52', 0.16);
  ctx.fillStyle = '#8a6a52';
  G.trace(ctx, [{ sx: -1.5, sy: 0 }, { sx: -1.2, sy: -9 }, { sx: 1.2, sy: -9 }, { sx: 1.5, sy: 0 }]);
  ctx.fill();
  polyline(ctx, [{ sx: 0, sy: -8 }, { sx: -5.5, sy: -13 }], '#8a6a52', 1.6);
  G.fillEllipse(ctx, 0, -15, 9.6, 9.6, '#3f8f5c');
  G.fillEllipse(ctx, -6.4, -11.6, 6.6, 6.6, '#54a56e');
  G.fillEllipse(ctx, 6.6, -12, 7, 7, '#54a56e');
  G.fillEllipse(ctx, -1.6, -19.5, 5.6, 5.6, '#6fbf85');
  G.fillEllipse(ctx, 3.4, -17.6, 3.4, 3.4, '#8ed39c', 0.85 + (seed || 0) * 0.15);
  ctx.restore();
}

function drawBush(ctx, x, y, s, tone) {
  const colors = ['#5aa877', '#6dbb8a', '#4f9c6d'];
  const c = colors[tone % colors.length];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  G.fillEllipse(ctx, 0.6, 0.6, 6, 2.4, '#3f5f52', 0.14);
  G.fillEllipse(ctx, -2.4, -2.4, 3.4, 3.4, c);
  G.fillEllipse(ctx, 2.6, -2.8, 3.9, 3.9, shade(c, 0.12));
  G.fillEllipse(ctx, 0, -4.4, 3, 3, shade(c, 0.22));
  ctx.restore();
}

function drawBench(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  G.fillEllipse(ctx, 0.6, 0.8, 7, 2.6, '#3f5f52', 0.14);
  ctx.fillStyle = '#c08a5a';
  ctx.fillRect(-6, -5, 12, 2.4);
  ctx.fillStyle = '#a97747';
  ctx.fillRect(-6, -2, 12, 2);
  ctx.fillStyle = '#8a6138';
  ctx.fillRect(-5.4, -1, 1.4, 3);
  ctx.fillRect(4, -1, 1.4, 3);
  ctx.restore();
}

function drawLamp(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  G.fillEllipse(ctx, 1, 0.4, 4, 1.6, '#3f5f52', 0.16);
  polyline(ctx, [{ sx: 0, sy: 0 }, { sx: 0, sy: -17 }], '#5b7d90', 1.6);
  ctx.beginPath();
  ctx.moveTo(0, -17);
  ctx.quadraticCurveTo(0, -21, 4, -21);
  ctx.strokeStyle = '#5b7d90';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  G.fillEllipse(ctx, 4.6, -21, 2.6, 2.6, '#ffe6a3');
  G.strokeEllipse(ctx, 4.6, -21, 2.6, 2.6, '#c9a24d', 0.6);
  ctx.restore();
}

function drawRoadDecor(C, i0, j0, opacity) {
  const fr = C.fr;
  const ctx = C.ctx;
  G.fillPoly(ctx, [fr.pt(i0 + 0.06, j0, 0.012), fr.pt(i0 + 1, j0 + 0.94, 0.012), fr.pt(i0 + 1, j0 + 0.8, 0.012), fr.pt(i0 + 0.2, j0, 0.012)], '#eef4f8', opacity);
  G.fillPoly(ctx, [fr.pt(i0, j0 + 0.06, 0.012), fr.pt(i0 + 0.94, j0 + 1, 0.012), fr.pt(i0 + 0.8, j0 + 1, 0.012), fr.pt(i0, j0 + 0.2, 0.012)], '#eef4f8', opacity);
  polyline(ctx, [fr.pt(i0 + 0.5, j0 + 0.22, 0.016), fr.pt(i0 + 0.5, j0 + 0.48, 0.016)], '#fdfdfd', 2, opacity, [5, 6]);
}

function drawPlazaDecor(C, i0, j0) {
  const fr = C.fr;
  const ctx = C.ctx;
  const c = fr.pt(i0 + 0.5, j0 + 0.5, 0.02);
  G.strokePoly(ctx, G.diamond(fr, i0, j0, 0.012), '#b9cbdb', 0.8);
  G.strokePoly(ctx, [fr.pt(i0 + 0.5, j0, 0.012), fr.pt(i0 + 1, j0 + 0.5, 0.012), fr.pt(i0 + 0.5, j0 + 1, 0.012), fr.pt(i0, j0 + 0.5, 0.012)], '#e3edf5', 1);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    G.fillPoly(ctx, [
      { sx: c.sx, sy: c.sy },
      { sx: c.sx + Math.cos(a) * 15, sy: c.sy + Math.sin(a) * 7.5 },
      { sx: c.sx + Math.cos(a + 0.4) * 9, sy: c.sy + Math.sin(a + 0.4) * 4.5 },
    ], '#e8f2f8', 0.75);
  }
  G.fillEllipse(ctx, c.sx, c.sy, 3.4, 3.4, '#f3d9a4');
  G.strokeEllipse(ctx, c.sx, c.sy, 3.4, 3.4, '#d8b26a', 0.6);
  drawBush(ctx, c.sx - 20, c.sy + 2, 0.6, 1);
  drawBush(ctx, c.sx + 20, c.sy + 2, 0.6, 2);
  drawLamp(ctx, c.sx - 24, c.sy - 8);
  drawLamp(ctx, c.sx + 24, c.sy - 8);
}

function drawGardenPatch(C, i0, j0) {
  const fr = C.fr;
  const ctx = C.ctx;
  G.fillPoly(ctx, G.diamond(fr, i0 + 0.04, j0 + 0.04, 0.045), '#a8dcbc', 0.9);
  const path = [
    fr.pt(i0 + 0.08, j0 + 0.5, 0.05), fr.pt(i0 + 0.3, j0 + 0.34, 0.05),
    fr.pt(i0 + 0.52, j0 + 0.52, 0.05), fr.pt(i0 + 0.74, j0 + 0.36, 0.05), fr.pt(i0 + 0.94, j0 + 0.5, 0.05),
  ];
  polyline(ctx, path, '#f2f0e4', 4.4, 0.9);
  const flowers = [
    [0.24, 0.66, '#f4a3a3'], [0.42, 0.24, '#f6d27a'], [0.64, 0.7, '#c9a3e6'],
    [0.78, 0.26, '#f4a3a3'], [0.36, 0.78, '#9fd6a8'], [0.56, 0.4, '#f6d27a'],
  ];
  for (let k = 0; k < flowers.length; k++) {
    const p = fr.pt(i0 + flowers[k][0], j0 + flowers[k][1], 0.06);
    G.fillEllipse(ctx, p.sx, p.sy, 1.2, 1.2, '#4f8f63', 0.5);
    G.fillEllipse(ctx, p.sx, p.sy - 1.6, 2.1, 2.1, flowers[k][2]);
    G.strokeEllipse(ctx, p.sx, p.sy - 1.6, 2.1, 2.1, '#ffffff', 0.4);
  }
}

function drawSportMarks(C, i0, j0) {
  const fr = C.fr;
  const ctx = C.ctx;
  const c = fr.pt(i0 + 0.5, j0 + 0.5, 0);
  G.fillPoly(ctx, G.diamond(fr, i0, j0, 0.01), '#c9705a');
  G.fillPoly(ctx, G.diamond(fr, i0 + 0.06, j0 + 0.06, 0.015), '#d98a72', 0.65);
  const inner = [fr.pt(i0 + 0.2, j0 + 0.5, 0.02), fr.pt(i0 + 0.5, j0 + 0.2, 0.02), fr.pt(i0 + 0.8, j0 + 0.5, 0.02), fr.pt(i0 + 0.5, j0 + 0.8, 0.02)];
  G.fillPoly(ctx, inner, '#7fc08a');
  G.strokePoly(ctx, inner, '#ffffff', 0.9, null, 0.8);
  G.strokeEllipse(ctx, c.sx, c.sy, 12, 6, '#ffffff', 1.1, 0.85);
  G.fillEllipse(ctx, c.sx, c.sy, 3, 1.4, '#ffffff', 0.7);
  polyline(ctx, [{ sx: c.sx - 24, sy: c.sy + 1 }, { sx: c.sx - 24, sy: c.sy - 5 }, { sx: c.sx - 20, sy: c.sy - 5 }], '#f2f4f6', 1.4);
  polyline(ctx, [{ sx: c.sx + 24, sy: c.sy + 1 }, { sx: c.sx + 24, sy: c.sy - 5 }, { sx: c.sx + 20, sy: c.sy - 5 }], '#f2f4f6', 1.4);
}

function drawWaterSurface(C, i0, j0) {
  const fr = C.fr;
  const ctx = C.ctx;
  const c = fr.pt(i0 + 0.5, j0 + 0.5, 0.01);
  G.fillPoly(ctx, G.diamond(fr, i0, j0, 0.008), '#5fb3dd');
  G.fillPoly(ctx, G.diamond(fr, i0 + 0.08, j0 + 0.08, 0.012), '#84cbea', 0.7);
  G.strokeEllipse(ctx, c.sx, c.sy, 17, 8, '#ffffff', 1.2, 0.55);
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.4;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(c.sx - 13, c.sy - 1);
  ctx.quadraticCurveTo(c.sx - 7, c.sy - 4.6, c.sx - 1, c.sy - 1);
  ctx.stroke();
  ctx.lineWidth = 1.1;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.moveTo(c.sx - 6, c.sy + 4);
  ctx.quadraticCurveTo(c.sx, c.sy + 1, c.sx + 6, c.sy + 3.6);
  ctx.stroke();
  ctx.restore();
}

function drawParkingDecor(C, i0, j0) {
  const fr = C.fr;
  const ctx = C.ctx;
  for (let k = 0; k < 3; k++) {
    const v = 0.2 + k * 0.26;
    const a = fr.pt(i0 + 0.18, j0 + v, 0.02);
    const b = fr.pt(i0 + 0.82, j0 + v, 0.02);
    polyline(ctx, [a, b], '#eef4f8', 1.6, 0.85);
  }
}

function drawGroundScatter(C, tile, i0, j0) {
  const count = tile.type === 'tree' ? 4 : tile.type === 'garden' ? 3 : tile.type === 'grass' ? 2 : 0;
  for (let k = 0; k < count; k++) {
    const u = 0.18 + rnd(tile.x, tile.y, 31 + k) * 0.64;
    const v = 0.18 + rnd(tile.x, tile.y, 41 + k) * 0.64;
    const p = C.fr.pt(i0 + u, j0 + v, 0);
    const kind = rnd(tile.x, tile.y, 51 + k);
    if (tile.type === 'tree' || (tile.type === 'garden' && kind > 0.45)) {
      drawTree(C.ctx, p.sx, p.sy, 0.62 + rnd(tile.x, tile.y, 61 + k) * 0.3, kind);
    } else {
      drawBush(C.ctx, p.sx, p.sy, kind > 0.72 ? 0.85 : 0.7, k + 1);
    }
  }
  if (tile.type === 'tree' || tile.type === 'garden') {
    const p = C.fr.pt(i0 + 0.5, j0 + 0.5, 0);
    drawBench(C.ctx, p.sx, p.sy);
  }
}

/** 人群点（城外暴露 ≥6 人时出现）。 */
function drawPeopleDots(C, i0, j0, z, gs, outdoor) {
  if (outdoor < 6) return;
  const ctx = C.ctx;
  const center = C.fr.pt(i0 + 0.5, j0 + 0.5, z + 0.05);
  let total = 0;
  for (let i = 0; i < GROUP_ORDER.length; i++) total += gs[GROUP_ORDER[i]];
  total = total || 1;
  const wanted = Math.max(1, Math.min(6, Math.round(outdoor / 45)));
  const dots = [];
  for (let i = 0; i < GROUP_ORDER.length; i++) {
    const g = GROUP_ORDER[i];
    const share = gs[g] / total;
    const need = Math.max(VULNERABLE_GROUPS.indexOf(g) >= 0 && share > 0.05 ? 1 : 0, Math.round(share * wanted));
    for (let k = 0; k < need && dots.length < 7; k++) dots.push(g);
  }
  for (let idx = 0; idx < dots.length; idx++) {
    const g = dots[idx];
    const angle = (idx / Math.max(1, dots.length)) * Math.PI * 2 + 0.4;
    const r = 7 + (idx % 2) * 6;
    const x = center.sx + Math.cos(angle) * r;
    const y = center.sy + Math.sin(angle) * r * 0.5 - 3;
    const rad = g === 'students' ? 2.5 : 3.2;
    G.fillEllipse(ctx, x, y, rad, rad, GROUPS[g].color);
    G.strokeEllipse(ctx, x, y, rad, rad, '#ffffff', 0.8);
  }
}

/* ================================================================== *
 * 改造道具（ToolObject 移植）
 * ================================================================== */
function drawTool(ctx, fr, i0, j0, elev, toolId, hour) {
  const seed = rnd(i0, j0, hour);
  const center = fr.pt(i0 + 0.5, j0 + 0.5, elev);
  switch (toolId) {
    case 'tree': {
      const p = fr.pt(i0 + 0.5, j0 + 0.5, 0);
      drawTree(ctx, p.sx, p.sy, 1.28 + seed * 0.22, seed);
      return;
    }
    case 'canopy': {
      const z = 1.5;
      for (let idx = 0; idx < 4; idx++) {
        const dx = idx % 2 === 0 ? 0.16 : 0.84;
        const dy = idx < 2 ? 0.16 : 0.84;
        const p0 = fr.pt(i0 + dx, j0 + dy, 0);
        const p1 = fr.pt(i0 + dx, j0 + dy, z);
        line(ctx, p0, p1, '#4b7591', 2.2);
        G.fillEllipse(ctx, p1.sx, p1.sy, 1.4, 1.4, '#7fa8c2');
      }
      G.fillPoly(ctx, G.diamond(fr, i0 + 0.02, j0 + 0.02, z), '#7fb0cc');
      G.strokePoly(ctx, G.diamond(fr, i0 + 0.02, j0 + 0.02, z), '#4b7591', 1.4);
      for (let k = 0; k < 3; k++) {
        const v0 = 0.12 + k * 0.27;
        G.fillPoly(ctx, G.roofQuad(fr, i0 + 0.02, j0 + 0.02, z, 0.02, v0, 0.98, v0 + 0.13, 0.02), '#ffffff', 0.4);
      }
      drawBench(ctx, center.sx, center.sy + 2);
      return;
    }
    case 'water': {
      const pool = [fr.pt(i0 + 0.12, j0 + 0.5, 0.16), fr.pt(i0 + 0.5, j0 + 0.12, 0.16), fr.pt(i0 + 0.88, j0 + 0.5, 0.16), fr.pt(i0 + 0.5, j0 + 0.88, 0.16)];
      const basin = [fr.pt(i0 + 0.05, j0 + 0.5, 0.02), fr.pt(i0 + 0.5, j0 + 0.05, 0.02), fr.pt(i0 + 0.95, j0 + 0.5, 0.02), fr.pt(i0 + 0.5, j0 + 0.95, 0.02)];
      G.fillPoly(ctx, basin, '#d3e0e8');
      G.strokePoly(ctx, basin, '#8ba7b8', 1.2);
      G.fillPoly(ctx, pool, '#6cc0dd');
      G.strokePoly(ctx, pool, '#f4fdff', 1.2);
      G.fillPoly(ctx, pool, '#ffffff', 0.14);
      G.fillEllipse(ctx, center.sx, center.sy - 3, 8, 3.6, '#4e9dbd');
      G.strokeEllipse(ctx, center.sx, center.sy - 3, 8, 3.6, '#e9fbff', 1);
      const jx = center.sx;
      const jy = center.sy;
      ctx.save();
      ctx.strokeStyle = '#f4ffff';
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(jx, jy - 6);
      ctx.bezierCurveTo(jx - 8, jy - 15, jx + 8, jy - 18, jx, jy - 27);
      ctx.stroke();
      ctx.strokeStyle = '#dbf8ff';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(jx, jy - 6);
      ctx.bezierCurveTo(jx + 10, jy - 14, jx + 11, jy - 18, jx + 13, jy - 23);
      ctx.stroke();
      ctx.restore();
      G.fillEllipse(ctx, center.sx - 13, center.sy + 2, 2.4, 2.4, '#79c69b');
      G.fillEllipse(ctx, center.sx + 13, center.sy + 2, 2.4, 2.4, '#8fd6a6');
      return;
    }
    case 'mist': {
      G.fillPoly(ctx, G.diamond(fr, i0 + 0.28, j0 + 0.28, 0.02), '#c3d3dd');
      G.strokePoly(ctx, G.diamond(fr, i0 + 0.28, j0 + 0.28, 0.02), '#7e9aab', 1);
      G.fillPoly(ctx, [fr.pt(i0 + 0.44, j0 + 0.56, 0.08), fr.pt(i0 + 0.56, j0 + 0.56, 0.08), fr.pt(i0 + 0.56, j0 + 0.56, 1.05), fr.pt(i0 + 0.44, j0 + 0.56, 1.05)], '#7fa2b4');
      G.fillPoly(ctx, G.diamond(fr, i0 + 0.3, j0 + 0.3, 1.08), '#dceaf0');
      G.strokePoly(ctx, G.diamond(fr, i0 + 0.3, j0 + 0.3, 1.08), '#6b91a4', 1);
      G.fillEllipse(ctx, center.sx, center.sy - 31, 3, 3, '#5e9eb9');
      ctx.save();
      ctx.strokeStyle = '#d7f5fb';
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(center.sx - 17, center.sy - 28);
      ctx.quadraticCurveTo(center.sx, center.sy - 39, center.sx + 17, center.sy - 27);
      ctx.stroke();
      ctx.strokeStyle = '#eafaff';
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      ctx.moveTo(center.sx - 20, center.sy - 22);
      ctx.quadraticCurveTo(center.sx, center.sy - 32, center.sx + 20, center.sy - 21);
      ctx.stroke();
      ctx.restore();
      G.fillEllipse(ctx, center.sx - 21, center.sy - 16, 2.6, 2.6, '#eafaff', 0.75);
      G.fillEllipse(ctx, center.sx + 21, center.sy - 15, 2.2, 2.2, '#eafaff', 0.7);
      return;
    }
    case 'station': {
      G.fillEllipse(ctx, center.sx + 2, center.sy + 6, 13, 5.4, '#3f5f52', 0.16);
      G.fillPoly(ctx, [fr.pt(i0 + 0.24, j0 + 0.72, 0.62), fr.pt(i0 + 0.72, j0 + 0.72, 0.62), fr.pt(i0 + 0.72, j0 + 0.72, 0), fr.pt(i0 + 0.24, j0 + 0.72, 0)], '#2f7f9e');
      G.fillPoly(ctx, [fr.pt(i0 + 0.72, j0 + 0.24, 0.62), fr.pt(i0 + 0.72, j0 + 0.72, 0.62), fr.pt(i0 + 0.72, j0 + 0.72, 0), fr.pt(i0 + 0.72, j0 + 0.24, 0)], '#3d94b5');
      G.fillPoly(ctx, G.diamond(fr, i0 + 0.24, j0 + 0.24, 0.62), '#6cc3e0');
      G.strokePoly(ctx, G.diamond(fr, i0 + 0.24, j0 + 0.24, 0.62), '#ffffff', 1);
      G.fillPoly(ctx, [fr.pt(i0 + 0.24, j0 + 0.24, 0.86), fr.pt(i0 + 0.72, j0 + 0.24, 0.86), fr.pt(i0 + 0.72, j0 + 0.3, 0.86), fr.pt(i0 + 0.24, j0 + 0.3, 0.86)], '#a9e0f0', 0.9);
      return;
    }
    case 'pavement': {
      G.fillPoly(ctx, G.diamond(fr, i0, j0, 0.035), '#9dc0d4', 0.75);
      for (let a = 0; a < 4; a++) {
        for (let b = 0; b < 4; b++) {
          G.fillPoly(ctx, G.roofQuad(fr, i0, j0, 0, a * 0.25 + 0.02, b * 0.25 + 0.02, a * 0.25 + 0.23, b * 0.25 + 0.23, 0.04), '#bcd8e6', 0.95);
        }
      }
      return;
    }
    case 'coolpave': {
      G.fillPoly(ctx, G.diamond(fr, i0, j0, 0.035), '#f3f5fd', 0.92);
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          G.fillPoly(ctx, G.roofQuad(fr, i0, j0, 0, a / 3 + 0.015, b / 3 + 0.015, a / 3 + 0.318, b / 3 + 0.318, 0.04), '#ffffff');
          G.strokePoly(ctx, G.roofQuad(fr, i0, j0, 0, a / 3 + 0.015, b / 3 + 0.015, a / 3 + 0.318, b / 3 + 0.318, 0.04), '#c9cfec', 0.5);
        }
      }
      G.fillPoly(ctx, G.diamond(fr, i0 + 0.3, j0 + 0.3, 0.045), '#ffffff', 0.85);
      return;
    }
    default:
      return;
  }
}

function drawGreenRoofDeck(C, r, z) {
  const fr = C.fr;
  const ctx = C.ctx;
  G.fillPoly(ctx, G.rectQ(fr, r, z, 0.04, 0.04, 0.96, 0.96, 0.08), '#57ab77');
  G.strokePoly(ctx, G.rectQ(fr, r, z, 0.04, 0.04, 0.96, 0.96, 0.08), '#3d8c5c', 0.9);
  G.fillPoly(ctx, G.rectQ(fr, r, z, 0.09, 0.09, 0.91, 0.91, 0.09), '#7ccb98', 0.55);
  const spots = [[0.22, 0.26], [0.42, 0.2], [0.66, 0.32], [0.3, 0.64], [0.6, 0.7], [0.78, 0.5]];
  for (let k = 0; k < spots.length; k++) {
    const pt = G.rectP(fr, r, z, spots[k][0], spots[k][1], 0.12);
    const rad = 2.4 + (k % 2) * 0.6;
    G.fillEllipse(ctx, pt.sx, pt.sy - 1.6, rad, rad, k % 2 ? '#3f9a63' : '#8ddca8');
    G.strokeEllipse(ctx, pt.sx, pt.sy - 1.6, rad, rad, '#ffffff', 0.4);
  }
}

/* ================================================================== *
 * 主入口
 * ================================================================== */
/**
 * @param ctx  Canvas 2D 上下文（已按 dpr 处理好像素比）
 * @param o    {
 *   levelId, state, hour, layers:{heat,shade,people,sensitive}, toolId, hover,
 *   adviceMark, pickMark, focus, rotation, frame, cw, ch, dpr
 * }
 */
function drawMap(ctx, o) {
  const fr = o.frame.fr;
  const baseView = o.frame.baseView;
  const layerIds = o.layers;
  const hour = o.hour;

  ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
  ctx.clearRect(0, 0, o.cw, o.ch);
  ctx.save();
  ctx.translate(o.frame.tx, o.frame.ty);
  ctx.scale(o.frame.scale, o.frame.scale);
  ctx.translate(-baseView.x, -baseView.y);
  ctx.lineJoin = 'round';

  const map = getMap(o.levelId);
  const heat = engine.heatField(o.state, hour);
  const fields = engine.computeFields(o.state, hour);
  const pop = engine.populationField(hour, o.levelId);
  const sky = HOUR_SKY[hour] || HOUR_SKY[12];
  const weather = WEATHER_TINT[o.state.weather] || WEATHER_TINT.normal;

  const placementAt = {};
  for (let i = 0; i < o.state.placements.length; i++) {
    const p = o.state.placements[i];
    placementAt[p.x + ',' + p.y] = p.toolId;
  }
  const tool = o.toolId ? TOOLS[o.toolId] : null;
  const toolAt = function (tile) { return placementAt[tile.x + ',' + tile.y] || null; };

  const showFocus = o.focus && o.focus.length > 0 && o.state.placements.every(function (p) { return p.fixed; }) && !o.state.finished;

  const C = {
    ctx: ctx, fr: fr, hour: hour, layers: layerIds, toolAt: toolAt,
    zScale: function (tile) { return zScaleOf(map, tile); },
  };

  /* —— 天空与太阳 —— */
  const skyGrad = ctx.createLinearGradient(0, baseView.y, 0, baseView.y + baseView.h);
  skyGrad.addColorStop(0, sky.top);
  skyGrad.addColorStop(1, sky.bottom);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = skyGrad;
  ctx.fillRect(baseView.x, baseView.y, baseView.w, baseView.h);
  ctx.globalAlpha = 1;
  const sunX = baseView.x + baseView.w * 0.5 + sky.sunPos[0] * 0.6;
  const sunY = baseView.y + baseView.h * 0.16 + sky.sunPos[1] * 0.35;
  const sunGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 150);
  sunGrad.addColorStop(0, sky.glow);
  sunGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.save();
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = sunGrad;
  G.ellipsePath(ctx, sunX, sunY, 150, 150);
  ctx.fill();
  ctx.restore();
  G.fillEllipse(ctx, sunX, sunY, 23, 23, sky.sun);

  /* —— 云朵 —— */
  drawCloud(ctx, baseView.x + baseView.w * 0.2, baseView.y + baseView.h * 0.1, 1);
  drawCloud(ctx, baseView.x + baseView.w * 0.78, baseView.y + baseView.h * 0.14, 0.75);
  drawCloud(ctx, baseView.x + baseView.w * 0.5, baseView.y + baseView.h * 0.06, 0.58);

  /* —— 微缩模型托板 —— */
  (function () {
    const inset = 0.3;
    const lift = -0.7;
    const plan = [[lift, lift], [map.width + inset, lift], [map.width + inset, map.height + inset], [lift, map.height + inset]];
    const ground = plan.map(function (p) { return fr.pt(p[0], p[1], 0); });
    const sunk = plan.map(function (p) { return fr.pt(p[0], p[1], -2.2); });
    let byY = 0;
    for (let k = 1; k < ground.length; k++) if (ground[k].sy > ground[byY].sy) byY = k;
    const left = (byY + 3) % 4;
    const right = (byY + 1) % 4;
    ctx.save();
    ctx.shadowColor = 'rgba(66,91,112,0.28)';
    ctx.shadowBlur = 9;
    ctx.shadowOffsetY = 8;
    const gradL = ctx.createLinearGradient(0, ground[byY].sy - 120, 0, ground[byY].sy + 40);
    gradL.addColorStop(0, '#b3ccdf');
    gradL.addColorStop(1, '#6d93b1');
    const gradR = ctx.createLinearGradient(0, ground[byY].sy - 120, 0, ground[byY].sy + 40);
    gradR.addColorStop(0, '#9bb9d2');
    gradR.addColorStop(1, '#577e9f');
    G.fillPoly(ctx, [ground[byY], ground[left], sunk[left], sunk[byY]], '#6d93b1');
    ctx.fillStyle = gradL;
    G.trace(ctx, [ground[byY], ground[left], sunk[left], sunk[byY]]);
    ctx.fill();
    G.fillPoly(ctx, [ground[byY], ground[right], sunk[right], sunk[byY]], '#577e9f');
    ctx.fillStyle = gradR;
    G.trace(ctx, [ground[byY], ground[right], sunk[right], sunk[byY]]);
    ctx.fill();
    ctx.restore();
    G.fillPoly(ctx, ground, '#dbeaf3');
    const gGrad = ctx.createLinearGradient(0, baseView.y + 260, 0, baseView.y + 260 + baseView.h);
    gGrad.addColorStop(0, '#eef7fb');
    gGrad.addColorStop(1, '#dbeaf3');
    ctx.fillStyle = gGrad;
    G.trace(ctx, ground);
    ctx.fill();
  })();

  /* —— 架空连廊预计算（与主项目同规则） —— */
  const corr = {};
  (function () {
    const tiles = o.frame.list.map(function (x) { return x.tile; });
    const byPos = {};
    for (let i = 0; i < tiles.length; i++) byPos[tiles[i].x + ',' + tiles[i].y] = tiles[i];
    const depthOf = {};
    for (let i = 0; i < o.frame.list.length; i++) depthOf[o.frame.list[i].tile.x + ',' + o.frame.list[i].tile.y] = o.frame.list[i].depth;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      if (tile.elev < 2) continue;
      const nb = byPos[(tile.x + 1) + ',' + tile.y];
      if (!nb || nb.elev < 2) continue;
      if ((tile.x + tile.y) % 2 !== 0) continue;
      const far = (depthOf[tile.x + ',' + tile.y] || 0) <= (depthOf[nb.x + ',' + nb.y] || 0) ? tile : nb;
      const other = far === tile ? nb : tile;
      const key = far.x + ',' + far.y;
      if (!corr[key]) corr[key] = [];
      corr[key].push({ dir: far === tile ? 'e' : 'w', nb: other });
    }
  })();

  /* —— 地块（深度升序：越近越后画） —— */
  for (let n = 0; n < o.frame.list.length; n++) {
    const tile = o.frame.list[n].tile;
    const i = tile.y * GRID + tile.x;
    const style = TYPE_STYLE[tile.type] || TYPE_STYLE.grass;
    const zS = C.zScale(tile);
    const center = fr.pt(tile.x + 0.5, tile.y + 0.5, tile.elev * zS);
    const groundCenter = fr.pt(tile.x + 0.5, tile.y + 0.5, 0);
    const isBuilding = tile.elev > 0;
    const isVenue = /图书馆|阅览馆/.test(tile.name);

    const ramp = heatRamp(heat[i]);
    const heatTint = layerIds.heat ? heatColor(heat[i]) : null;
    const groundFill = heatTint ? mixHex(style.top, heatTint, 0.18 + 0.62 * ramp) : style.top;

    if (isBuilding) {
      drawBuilding(C, tile, heatTint, heat[i]);
      const cl = corr[tile.x + ',' + tile.y];
      if (cl) for (let q = 0; q < cl.length; q++) drawCorridor(C, tile, cl[q].nb, cl[q].dir);
    } else {
      G.fillPoly(ctx, G.diamond(fr, tile.x, tile.y, 0), groundFill);
      G.strokePoly(ctx, G.diamond(fr, tile.x, tile.y, 0), shade(style.top, -0.13), 0.9);
      if (tile.type === 'road') drawRoadDecor(C, tile.x, tile.y, layerIds.heat ? 0.4 : 0.9);
      if (tile.type === 'plaza') drawPlazaDecor(C, tile.x, tile.y);
      if (tile.type === 'garden') drawGardenPatch(C, tile.x, tile.y);
      if (tile.type === 'sport') drawSportMarks(C, tile.x, tile.y);
      if (tile.type === 'water') drawWaterSurface(C, tile.x, tile.y);
      if (tile.type === 'parking') drawParkingDecor(C, tile.x, tile.y);
      if (tile.type === 'grass' || tile.type === 'tree' || tile.type === 'garden') drawGroundScatter(C, tile, tile.x, tile.y);
    }

    if (layerIds.heat && heat[i] >= 80 && !isBuilding) {
      halotext(ctx, String(Math.round(heat[i])), groundCenter.sx, groundCenter.sy + 4, 'bold 9.5px sans-serif', '#ffffff', 'rgba(40,20,60,0.55)', 2);
    }

    if (layerIds.heat && heat[i] >= 85) {
      G.fillPoly(ctx, G.diamond(fr, tile.x, tile.y, tile.elev * zS + 0.03), '#ff2d10', 0.2);
      G.strokePoly(ctx, G.diamond(fr, tile.x, tile.y, tile.elev * zS + 0.03), '#fff3c4', 2);
    }

    if (layerIds.shade && fields.shade[i] >= 3) {
      const dp = G.diamond(fr, tile.x, tile.y, tile.elev * zS + 0.02);
      G.fillPoly(ctx, dp, 'rgba(111,157,185,0.28)');
      G.strokePoly(ctx, dp, 'rgba(122,111,224,0.45)', 1);
    }

    if (layerIds.people) drawPeopleDots(C, tile.x, tile.y, tile.elev * zS, tileGroups(tile, hour), pop.outdoor[i]);

    if (layerIds.sensitive) {
      let total = 0;
      let vuln = 0;
      const gs = tileGroups(tile, hour);
      for (let g = 0; g < GROUP_ORDER.length; g++) {
        total += gs[GROUP_ORDER[g]];
        if (VULNERABLE_GROUPS.indexOf(GROUP_ORDER[g]) >= 0) vuln += gs[GROUP_ORDER[g]];
      }
      if ((total > 0 ? vuln / total : 0) >= 0.35 && heat[i] >= HIGH_HEAT) {
        G.strokePoly(ctx, G.diamond(fr, tile.x, tile.y, tile.elev * zS + 0.04), GROUPS.workers.color, 3, [4, 4]);
      }
    }

    if (isVenue) {
      const pinY = center.sy - (isBuilding ? 4 : 0) - 18;
      G.fillEllipse(ctx, center.sx, pinY, 9, 9, '#e9f7ff');
      G.strokeEllipse(ctx, center.sx, pinY, 9, 9, '#3f8fb8', 1.6);
      ctx.save();
      ctx.strokeStyle = '#2c6b8c';
      ctx.lineWidth = 1.3;
      ctx.strokeRect(center.sx - 4.5, pinY - 1.5, 9, 6);
      ctx.strokeRect(center.sx - 3, pinY - 4.5, 6, 3);
      ctx.restore();
    }

    if (tile.waterSource) {
      const c = fr.pt(tile.x + 0.5, tile.y + 0.5, 0.06);
      if (tile.waterSource === 'pond') {
        G.fillPoly(ctx, G.diamond(fr, tile.x + 0.08, tile.y + 0.08, 0.05), '#b9dced', 0.7);
        G.fillEllipse(ctx, c.sx, c.sy, 15, 7, '#6fc0dd');
        G.strokeEllipse(ctx, c.sx, c.sy, 15, 7, '#f7fdff', 1.4);
        G.fillEllipse(ctx, c.sx, c.sy, 9, 4, '#8fd8ef', 0.85);
      } else {
        G.fillPoly(ctx, G.diamond(fr, tile.x + 0.16, tile.y + 0.16, 0.03), '#d9e8ef', 0.75);
        ctx.save();
        ctx.fillStyle = '#d9735c';
        ctx.strokeStyle = '#fff4ef';
        ctx.lineWidth = 1;
        G.roundRect(ctx, c.sx - 2.6, c.sy - 11, 5.2, 12, 2.2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#c25f4c';
        G.roundRect(ctx, c.sx - 6, c.sy - 3.8, 12, 3.6, 1.7);
        ctx.fill();
        ctx.fillStyle = '#eda882';
        G.fillEllipse(ctx, c.sx, c.sy - 12.6, 3.3, 3.3, '#eda882');
        G.strokeEllipse(ctx, c.sx, c.sy - 12.6, 3.3, 3.3, '#fff7f2', 1);
        G.fillEllipse(ctx, c.sx, c.sy - 12.6, 1.2, 1.2, '#fdf3ec');
        ctx.restore();
      }
    }

    const placed = toolAt(tile);
    if (placed && placed !== 'greenroof') drawTool(ctx, fr, tile.x, tile.y, tile.elev * zS, placed, hour);

    // 放置预览（虚影）
    if (tool && o.hover && o.hover.x === tile.x && o.hover.y === tile.y) {
      const check = engine.canPlace(o.state, o.toolId, tile.x, tile.y);
      if (check.ok) {
        ctx.save();
        ctx.globalAlpha = 0.62;
        G.fillPoly(ctx, G.diamond(fr, tile.x, tile.y, tile.elev * zS + 0.05), '#ffffff', 0.4);
        G.strokePoly(ctx, G.diamond(fr, tile.x, tile.y, tile.elev * zS + 0.05), '#ffffff', 2, [5, 4]);
        drawTool(ctx, fr, tile.x, tile.y, tile.elev * zS, o.toolId, hour);
        ctx.restore();
      } else {
        G.strokePoly(ctx, G.diamond(fr, tile.x, tile.y, tile.elev * zS + 0.05), '#ff7a6b', 2.4, [5, 4]);
      }
    }

    // 参谋建议标点
    if (o.adviceMark && o.adviceMark.x === tile.x && o.adviceMark.y === tile.y && !tool) {
      const ay = groundCenter.sy - tile.elev * zS * Z_H - 26;
      G.fillEllipse(ctx, groundCenter.sx, ay, 11, 11, '#ffd166');
      G.strokeEllipse(ctx, groundCenter.sx, ay, 11, 11, '#ffffff', 2);
      halotext(ctx, '荐', groundCenter.sx, ay + 1, 'bold 13px sans-serif', '#4a3a12', null, 0);
    }

    // 红钉
    if (o.pickMark && o.pickMark.x === tile.x && o.pickMark.y === tile.y) {
      const py = groundCenter.sy - tile.elev * zS * Z_H - 34;
      G.fillEllipse(ctx, groundCenter.sx, py, 9, 9, '#e4574d');
      G.strokeEllipse(ctx, groundCenter.sx, py, 9, 9, '#ffffff', 1.4);
      G.fillEllipse(ctx, groundCenter.sx, py, 3.2, 3.2, '#ffffff');
      G.fillPoly(ctx, [
        { sx: groundCenter.sx - 3.4, sy: py + 5 },
        { sx: groundCenter.sx + 3.4, sy: py + 5 },
        { sx: groundCenter.sx, sy: py + 12 },
      ], '#e4574d');
    }

    if (layerIds.people && pop.total[i] >= 140) {
      halotext(ctx, String(Math.round(pop.total[i])), center.sx, center.sy - (isBuilding ? 6 : 0) - 14, '7.5px sans-serif', '#355b70', 'rgba(255,255,255,0.88)', 2, 0.75);
    }
  }

  /* —— 悬停轮廓 —— */
  if (o.hover) {
    const tile = map.tiles[o.hover.y * GRID + o.hover.x];
    if (tile && !tile.void) {
      G.strokePoly(ctx, G.diamond(fr, tile.x, tile.y, tile.elev * C.zScale(tile)), '#ffffff', 2.4, null, 0.95);
    }
  }

  /* —— 本关重点区域（开局提示） —— */
  if (showFocus) {
    for (let f = 0; f < o.focus.length; f++) {
      const fo = o.focus[f];
      const c = fr.pt(fo.x + 0.5, fo.y + 0.5, 0);
      G.strokeEllipse(ctx, c.sx, c.sy, 30, 15, '#ffd166', 2.4, 0.9);
      ctx.save();
      ctx.setLineDash([7, 6]);
      G.ellipsePath(ctx, c.sx, c.sy, 30, 15);
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      const tagW = Math.max(60, fo.label.length * 13.2);
      const tagH = 21;
      const ty = c.sy - 26;
      G.roundRect(ctx, c.sx - tagW / 2, ty - 11, tagW, tagH, 10.5);
      ctx.fillStyle = 'rgba(20,15,46,0.86)';
      ctx.fill();
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      halotext(ctx, fo.label, c.sx, ty + 0.5, '600 11px sans-serif', '#ffe6a8', '#1b1240', 2.4);
    }
  }

  /* —— 地标文字 —— */
  for (let n = 0; n < o.frame.list.length; n++) {
    const tile = o.frame.list[n].tile;
    if (!tile.landmark) continue;
    if (showFocus && o.focus.some(function (f) { return f.x === tile.x && f.y === tile.y; })) continue;
    const p = fr.pt(tile.x + 0.5, tile.y + 0.5, tile.elev * C.zScale(tile) + 0.25);
    halotext(ctx, tile.name, p.sx, p.sy - 2, '8px sans-serif', '#31566b', 'rgba(255,255,255,0.92)', 2.2, 0.92);
  }

  /* —— 天气氛围与雨丝 —— */
  const wGrad = ctx.createRadialGradient(baseView.x + baseView.w / 2, baseView.y + baseView.h * 0.46, baseView.w * 0.1, baseView.x + baseView.w / 2, baseView.y + baseView.h * 0.46, baseView.w * 0.78);
  wGrad.addColorStop(0, 'rgba(255,255,255,0)');
  const tintColor = WEATHER_TINT[o.state.weather] ? WEATHER_TINT[o.state.weather].color : '#ffffff';
  wGrad.addColorStop(0.46, 'rgba(255,255,255,0)');
  wGrad.addColorStop(1, tintColor);
  ctx.save();
  ctx.globalAlpha = weather.opacity;
  ctx.fillStyle = wGrad;
  ctx.fillRect(baseView.x, baseView.y, baseView.w, baseView.h);
  ctx.restore();
  if (o.state.weather === 'rain') {
    ctx.save();
    ctx.strokeStyle = 'rgba(210,228,248,0.75)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 46; i++) {
      const x = baseView.x + rnd(i, 3, 2) * baseView.w;
      const y = baseView.y + rnd(i, 7, 5) * baseView.h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 6, y + 22);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();
}

function drawCloud(ctx, x, y, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  G.fillEllipse(ctx, 0, 0, 34, 15, '#ffffff', 0.92);
  G.fillEllipse(ctx, -22, 6, 20, 10, '#ffffff', 0.75);
  G.fillEllipse(ctx, 24, 6, 22, 11, '#ffffff', 0.82);
  ctx.restore();
}

module.exports = { drawMap: drawMap };
