"use strict";
/**
 * 等轴（isometric）投影与配色工具。
 *
 * 采用无透视的 2:1 等轴投影，得到"摆在桌上的微缩模型"观感：
 *   sx = (x − y) · TILE_W/2
 *   sy = (x + y) · TILE_H/2 − z · Z_H
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TYPE_STYLE = exports.WEATHER_TINT = exports.HOUR_SKY = exports.HEAT_LEGEND = exports.WALL_SHEEN = exports.WALL_SHADE = exports.FACE_NORMAL = exports.Z_H = exports.TILE_H = exports.TILE_W = void 0;
exports.rnd = rnd;
exports.clamp01 = clamp01;
exports.heatRamp = heatRamp;
exports.isoPoint = isoPoint;
exports.toPath = toPath;
exports.makeView = makeView;
exports.mixHex = mixHex;
exports.shade = shade;
exports.heatColor = heatColor;
exports.heatLabel = heatLabel;
exports.TILE_W = 60;
exports.TILE_H = 30;
exports.Z_H = 26;
/** 稳定的伪随机：让树木、窗户、屋顶设备有自然变化，但每次渲染都一致。 */
function rnd(x, y, salt = 0) {
    const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
    return n - Math.floor(n);
}
function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}
/**
 * 热力浓淡曲线：偏凉的地块保留一点自身材质色，越热越被热力色吞没。
 * 这样“绿校园”的观感还在，而真正发烫的地方会红得扎眼。
 */
function heatRamp(heat, from = 30, to = 92) {
    return clamp01((heat - from) / (to - from));
}
function isoPoint(i, j, z = 0) {
    return { sx: (i - j) * (exports.TILE_W / 2), sy: (i + j) * (exports.TILE_H / 2) - z * exports.Z_H };
}
function toPath(points) {
    if (points.length === 0)
        return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.sx.toFixed(2)},${p.sy.toFixed(2)}`).join(' ') + ' Z';
}
/** 立面外法线（世界坐标）。 */
exports.FACE_NORMAL = {
    e: [1, 0], n: [0, -1], w: [-1, 0], s: [0, 1],
};
/** 立面中心相对地块中心的偏移（世界坐标，用于按屏幕左右排序）。 */
const FACE_CENTER = {
    e: [0.5, 0], n: [0, -0.5], w: [-0.5, 0], s: [0, 0.5],
};
const FACE_ORDER = ['e', 'n', 'w', 's'];
/**
 * 场景固定光照：亮度只由立面的世界朝向决定（+j 面最亮、−j 面最暗）。
 * 与视角无关——转动地图时各面明暗随模型一起转，不会因视角切换而跳变。
 */
exports.WALL_SHADE = { s: 0, e: -0.13, w: -0.13, n: -0.28 };
/** 立面上部受光的柔光带透明度（配合 WALL_SHADE 的明暗关系）。 */
exports.WALL_SHEEN = { s: 0.16, e: 0.08, w: 0.08, n: 0 };
/**
 * 建立当前角度的视角：把整个校园**绕竖直轴旋转 angle 度**（像转一个摆在桌上的微缩模型），
 * 再做等轴投影。与"吸附到 4 个正交朝向"不同，这里对任意角度都精确成立：
 * 地面网格投影成平行四边形，建筑立面按外法线连续剔除——
 * 转过 45° 的整数倍时，某个立面恰好侧对观察者（投影宽度为零），自然消失或出现，不会突变。
 */
function makeView(angleDeg, width, height) {
    const angle = ((angleDeg % 360) + 360) % 360;
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = width / 2;
    const cy = height / 2;
    const hw = exports.TILE_W / 2;
    const hh = exports.TILE_H / 2;
    const rot = (x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    };
    const pt = (i, j, z = 0) => {
        const [X, Y] = rot(i, j);
        return { sx: (X - Y) * hw, sy: (X + Y) * hh - z * exports.Z_H };
    };
    const depth = (i, j) => {
        const [X, Y] = rot(i, j);
        return X + Y;
    };
    const visible = FACE_ORDER
        .map((dir) => {
        const [nx, ny] = exports.FACE_NORMAL[dir];
        // 外法线旋转后指向 +i+j（深度递增方向）才朝向观察者
        const toward = nx * (cos + sin) + ny * (cos - sin);
        const [ox, oy] = FACE_CENTER[dir];
        const sx = (ox * cos - oy * sin - (ox * sin + oy * cos)) * hw;
        return { dir, toward, sx };
    })
        .filter((f) => f.toward > 1e-6)
        .sort((a, b) => a.sx - b.sx)
        .map((f) => f.dir);
    return { angle, width, height, pt, depth, visible };
}
/* ------------------------------------------------------------------ *
 * 颜色工具
 * ------------------------------------------------------------------ */
function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [
        parseInt(full.slice(0, 2), 16),
        parseInt(full.slice(2, 4), 16),
        parseInt(full.slice(4, 6), 16),
    ];
}
function rgbToHex(r, g, b) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
}
function mixHex(a, b, t) {
    const [r1, g1, b1] = hexToRgb(a);
    const [r2, g2, b2] = hexToRgb(b);
    return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
/** amount > 0 提亮，< 0 压暗。 */
function shade(hex, amount) {
    return amount >= 0 ? mixHex(hex, '#ffffff', amount) : mixHex(hex, '#2a2740', -amount);
}
/* ------------------------------------------------------------------ *
 * 热力色标（固定图例，颜色之外一定同时给出数值与文字）
 * ------------------------------------------------------------------ */
const HEAT_STOPS = [
    { t: 20, color: '#5fb8de', label: '凉爽' },
    { t: 38, color: '#79cf9c', label: '舒适' },
    { t: 55, color: '#f0dc6b', label: '偏热' },
    { t: 70, color: '#f0a24b', label: '炎热' },
    { t: 85, color: '#e4603f', label: '酷热' },
    { t: 100, color: '#b02a6b', label: '极热' },
];
function heatColor(heat) {
    if (heat <= HEAT_STOPS[0].t)
        return HEAT_STOPS[0].color;
    for (let i = 1; i < HEAT_STOPS.length; i++) {
        const prev = HEAT_STOPS[i - 1];
        const cur = HEAT_STOPS[i];
        if (heat <= cur.t) {
            const t = (heat - prev.t) / (cur.t - prev.t);
            return mixHex(prev.color, cur.color, t);
        }
    }
    return HEAT_STOPS[HEAT_STOPS.length - 1].color;
}
function heatLabel(heat) {
    let label = HEAT_STOPS[0].label;
    for (const stop of HEAT_STOPS)
        if (heat >= stop.t)
            label = stop.label;
    return label;
}
exports.HEAT_LEGEND = HEAT_STOPS;
exports.HOUR_SKY = {
    8: { top: '#b8cce1', bottom: '#edf4fa', sun: '#fffdf4', glow: '#cbe5f6', sunPos: [-330, -150], label: '晨光' },
    12: { top: '#c7d9ea', bottom: '#f5f9fc', sun: '#fffef6', glow: '#d9edf8', sunPos: [10, -196], label: '正午' },
    14: { top: '#c6d6e5', bottom: '#f4f8fb', sun: '#fffdf1', glow: '#d6e8f3', sunPos: [228, -168], label: '午后' },
    18: { top: '#aebfd3', bottom: '#eef4f8', sun: '#fff6de', glow: '#d1e1ef', sunPos: [356, -62], label: '斜阳' },
};
/** 天气色量：叠在地图上的氛围颜色与强度。 */
exports.WEATHER_TINT = {
    normal: { color: '#ffffff', opacity: 0.02, haze: 0 },
    yellow: { color: '#f5d58b', opacity: 0.12, haze: 0.15 },
    orange: { color: '#ff5f2e', opacity: 0.16, haze: 0.3 },
    rain: { color: '#4f74a8', opacity: 0.2, haze: 0 },
};
/* ------------------------------------------------------------------ *
 * 地表 / 建筑材质
 * ------------------------------------------------------------------ */
exports.TYPE_STYLE = {
    grass: { top: '#c3e2b8' },
    garden: { top: '#b4ddc1' },
    tree: { top: '#bce0b3' },
    water: { top: '#7cc7e6' },
    road: { top: '#c4ced8', accent: '#f5fbff' },
    plaza: { top: '#e0e8ef', accent: '#f7fbff' },
    building: { top: '#eef4f8', accent: '#78a9c6' },
    dorm: { top: '#e6eef4', accent: '#8eb7cf' },
    canteen: { top: '#e9edf2', accent: '#a8a1c4' },
    sport: { top: '#a9cfc0', accent: '#eff8f5' },
    parking: { top: '#c9d3dc', accent: '#8ba4b6' },
};
