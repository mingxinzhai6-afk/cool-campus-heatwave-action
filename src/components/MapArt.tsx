/**
 * 地图上的“美术件”：建筑体块、地表装饰、改造道具。
 *
 * 全部用 SVG 手绘，遵守同一套等轴规则（见 lib/iso.ts 的 ViewFrame）：
 *   - 每个地块是 1×1 的方格，在任意视角角度下投影成平行四边形，建筑向上挤出 z 层；
 *   - 立面按**外法线连续剔除**：朝向观察者的面才画，侧对观察者（投影宽度为零）时自然消失，
 *     所以任意角度旋转都不会有立面突变；
 *   - 光照固定在世界坐标（+j 面最亮、−j 面最暗），转动地图时明暗随模型一起转。
 *
 * 目标是“清新科创沙盘”：建筑是简约圆角几何体块——退台错落（底座 + 内收塔楼）、
 * 遮阳檐口、露台花池与屋顶小花园；架空连廊连接相邻楼栋（兼作通风廊道）。
 * 配色低饱和冷调（浅灰 / 米白 / 淡青薄荷），线条干净、阴影轻薄，与树木和广场水景自然衔接。
 * 只改建筑外观造型：建筑位置、楼栋数量、地块布局完全不变。
 * 绿地有树丛、广场有铺装、水体有浪花；热力层只按温度浓淡叠色，不把材质涂死。
 */
import { GROUPS, GROUP_ORDER, VULNERABLE_GROUPS, type GroupId } from '../data/groups';
import type { Hour, Tile } from '../data/campus';
import { WALL_SHADE, WALL_SHEEN, mixHex, rnd, shade, toPath, type FaceDir, type Pt, type ViewFrame } from '../lib/iso';
import type { ToolId } from '../data/tools';

export type { FaceDir } from '../lib/iso';

/* ================================================================== *
 * 通用几何（全部以 ViewFrame 为准：任意角度的等轴投影）
 * ================================================================== */

/** 地块 (i0, j0) 在高度 z 上的地面四边形（角度非正交时是平行四边形）。 */
export function diamond(fr: ViewFrame, i0: number, j0: number, z: number): Pt[] {
  return [fr.pt(i0, j0, z), fr.pt(i0 + 1, j0, z), fr.pt(i0 + 1, j0 + 1, z), fr.pt(i0, j0 + 1, z)];
}

/** 该方向立面在指定高度（0=地面，1=檐口）上的两点。 */
function faceEdgeAt(fr: ViewFrame, i0: number, j0: number, dir: FaceDir, z: number, v: number): [Pt, Pt] {
  switch (dir) {
    case 'e': return [fr.pt(i0 + 1, j0 + 1, v * z), fr.pt(i0 + 1, j0, v * z)];
    case 'n': return [fr.pt(i0, j0, v * z), fr.pt(i0 + 1, j0, v * z)];
    case 'w': return [fr.pt(i0, j0, v * z), fr.pt(i0, j0 + 1, v * z)];
    default: return [fr.pt(i0, j0 + 1, v * z), fr.pt(i0 + 1, j0 + 1, v * z)];
  }
}

/** 立面上的点：u 沿墙面横向（0→1），v 竖直方向（0 = 地面，1 = 檐口）。 */
function wallPt(fr: ViewFrame, i0: number, j0: number, z: number, dir: FaceDir, u: number, v: number): Pt {
  const [a, b] = faceEdgeAt(fr, i0, j0, dir, z, v);
  return { sx: a.sx + (b.sx - a.sx) * u, sy: a.sy + (b.sy - a.sy) * u };
}

function wallQuad(fr: ViewFrame, i0: number, j0: number, z: number, dir: FaceDir, u0: number, u1: number, v0: number, v1: number): Pt[] {
  return [
    wallPt(fr, i0, j0, z, dir, u0, v0),
    wallPt(fr, i0, j0, z, dir, u1, v0),
    wallPt(fr, i0, j0, z, dir, u1, v1),
    wallPt(fr, i0, j0, z, dir, u0, v1),
  ];
}

/** 整个立面（u 从 0 到 1，v 从地面到檐口）。 */
export function faceQuad(fr: ViewFrame, i0: number, j0: number, z: number, dir: FaceDir): Pt[] {
  return wallQuad(fr, i0, j0, z, dir, 0, 1, 0, 1);
}

/** 屋顶坐标：在顶面四边形内用 (u,v) ∈ [0,1]² 定位（u 沿 i，v 沿 j），再抬升 dz。 */
function roofPt(fr: ViewFrame, i0: number, j0: number, z: number, u: number, v: number, dz = 0): Pt {
  return fr.pt(i0 + u, j0 + v, z + dz);
}

function roofQuad(fr: ViewFrame, i0: number, j0: number, z: number, u0: number, v0: number, u1: number, v1: number, dz = 0): Pt[] {
  return [
    roofPt(fr, i0, j0, z, u0, v0, dz),
    roofPt(fr, i0, j0, z, u1, v0, dz),
    roofPt(fr, i0, j0, z, u1, v1, dz),
    roofPt(fr, i0, j0, z, u0, v1, dz),
  ];
}

/** 把多个四边形合成一条 path，减少 DOM 节点。 */
function quads(list: Pt[][]): string {
  return list.map((q) => toPath(q)).join(' ');
}

/* —— 任意矩形轮廓的几何：退台错落 / 檐口 / 连廊共用 —— */
type Rect = { iA: number; jA: number; iB: number; jB: number };

/** 矩形轮廓某条边在高度 z 上的两个端点（u 沿这条边 0→1）。 */
function edge2(fr: ViewFrame, r: Rect, z: number, dir: FaceDir): [Pt, Pt] {
  switch (dir) {
    case 's': return [fr.pt(r.iA, r.jB, z), fr.pt(r.iB, r.jB, z)];
    case 'n': return [fr.pt(r.iA, r.jA, z), fr.pt(r.iB, r.jA, z)];
    case 'e': return [fr.pt(r.iB, r.jA, z), fr.pt(r.iB, r.jB, z)];
    default: return [fr.pt(r.iA, r.jA, z), fr.pt(r.iA, r.jB, z)];
  }
}

/** 矩形轮廓的立面片段：u 沿面横向（0→1），高度从 zB 到 zT。 */
function faceU(fr: ViewFrame, r: Rect, zB: number, zT: number, dir: FaceDir, u0 = 0, u1 = 1): Pt[] {
  const [b0, b1] = edge2(fr, r, zB, dir);
  const [t0, t1] = edge2(fr, r, zT, dir);
  const lerp = (a: Pt, b: Pt, u: number): Pt => ({ sx: a.sx + (b.sx - a.sx) * u, sy: a.sy + (b.sy - a.sy) * u });
  return [lerp(b0, b1, u0), lerp(b0, b1, u1), lerp(t0, t1, u1), lerp(t0, t1, u0)];
}

/** 矩形轮廓的顶面。 */
function rectTop(fr: ViewFrame, r: Rect, z: number): Pt[] {
  return [fr.pt(r.iA, r.jA, z), fr.pt(r.iB, r.jA, z), fr.pt(r.iB, r.jB, z), fr.pt(r.iA, r.jB, z)];
}

/** 顶面内的点：u/v ∈ [0,1]²，再抬升 dz（屋顶设备 / 绿植定位用）。 */
function rectP(fr: ViewFrame, r: Rect, z: number, u: number, v: number, dz = 0): Pt {
  return fr.pt(r.iA + u * (r.iB - r.iA), r.jA + v * (r.jB - r.jA), z + dz);
}

function rectQ(fr: ViewFrame, r: Rect, z: number, u0: number, v0: number, u1: number, v1: number, dz = 0): Pt[] {
  return [rectP(fr, r, z, u0, v0, dz), rectP(fr, r, z, u1, v0, dz), rectP(fr, r, z, u1, v1, dz), rectP(fr, r, z, u0, v1, dz)];
}

function inflate(r: Rect, o: number): Rect {
  return { iA: r.iA - o, jA: r.jA - o, iB: r.iB + o, jB: r.jB + o };
}

/**
 * 遮阳檐口：一块比体块略大的薄板（可见方向的薄边 + 顶面），圆角描边。
 * 顶面即该段体块的屋面（屋顶设备画在 z 上，正好落在板上）。
 */
function Eave({ fr, r, z, over, thick, color }: { fr: ViewFrame; r: Rect; z: number; over: number; thick: number; color: string }) {
  const R = inflate(r, over);
  return (
    <g>
      {fr.visible.map((dir) => (
        <path
          key={dir}
          d={toPath(faceU(fr, R, z - thick, z, dir))}
          fill={shade(color, WALL_SHADE[dir] * 0.75)}
          strokeLinejoin="round"
        />
      ))}
      <path d={toPath(rectTop(fr, R, z))} fill={color} stroke={shade(color, -0.12)} strokeWidth="0.8" strokeLinejoin="round" />
      {/* 女儿墙描线：让屋面轮廓更柔和整洁 */}
      <path d={toPath(rectTop(fr, inflate(r, over - 0.025), z + 0.028))} fill="none" stroke="#ffffff" strokeWidth="0.8" opacity="0.7" strokeLinejoin="round" />
    </g>
  );
}

/** 一丛绿植（屋顶花园 / 露台花池用的小圆簇，低饱和冷绿）。 */
function Tuft({ fr, i0, j0, z, u, v, s = 1, tone = 0 }: { fr: ViewFrame; i0: number; j0: number; z: number; u: number; v: number; s?: number; tone?: number }) {
  const c = roofPt(fr, i0, j0, z, u, v);
  const g1 = tone ? '#7fb99a' : '#6fae8b';
  const g2 = tone ? '#a8d4b8' : '#9fcdae';
  return (
    <g>
      <circle cx={c.sx - 2.1 * s} cy={c.sy - 2.2 * s} r={3.2 * s} fill={g1} />
      <circle cx={c.sx + 2.2 * s} cy={c.sy - 1.8 * s} r={3.6 * s} fill={g2} />
      <circle cx={c.sx} cy={c.sy - 4.2 * s} r={2.9 * s} fill="#b6dcc3" stroke="#ffffff" strokeWidth="0.35" />
    </g>
  );
}

/** 露台花池：圆角浅池 + 两丛绿植，坐在退台环廊上。 */
function Planter({ fr, i0, j0, z, u, v }: { fr: ViewFrame; i0: number; j0: number; z: number; u: number; v: number }) {
  return (
    <g>
      <path d={toPath(roofQuad(fr, i0, j0, z, u - 0.11, v - 0.08, u + 0.11, v + 0.08, 0.07))} fill="#e9edeb" stroke="#cfdad5" strokeWidth="0.5" strokeLinejoin="round" />
      <Tuft fr={fr} i0={i0} j0={j0} z={z + 0.07} u={u - 0.03} v={v - 0.01} s={0.72} />
      <Tuft fr={fr} i0={i0} j0={j0} z={z + 0.07} u={u + 0.04} v={v + 0.02} s={0.54} tone={1} />
    </g>
  );
}

/* ================================================================== *
 * 建筑配色：低饱和冷色调（浅灰 / 米白 / 淡青薄荷），清新科创沙盘质感
 * ================================================================== */
type Palette = { wall: string; roof: string; trim: string; glass: string; accent?: string };

const CLOUD: Palette = { wall: '#f3f5f5', roof: '#cfdcd8', trim: '#8ba49d', glass: '#d9ecf1' };
const MINT: Palette = { wall: '#f1f7f4', roof: '#c2dcd1', trim: '#7fa79a', glass: '#d3ebee' };
const SKY: Palette = { wall: '#f2f6f8', roof: '#c6d7e2', trim: '#87a2b0', glass: '#d7ebf4' };
const SAND: Palette = { wall: '#f6f4ee', roof: '#d9d1bd', trim: '#a79e8b', glass: '#dbebf1' };
const LEAF: Palette = { wall: '#f1f6f2', roof: '#c8dfca', trim: '#84a78d', glass: '#d5ebee' };
const STONE: Palette = { wall: '#eff2f2', roof: '#bccdca', trim: '#7c9893', glass: '#d1e8ee' };

const PALETTES: Palette[] = [CLOUD, MINT, SKY, SAND, LEAF, STONE];

/** 按建筑名 / 类型决定一套配色，让每种建筑有自己的“身份色”。 */
function paletteFor(tile: Tile): Palette {
  const n = tile.name;
  if (/图书馆|阅览馆/.test(n)) return SKY;
  if (/医院/.test(n)) return MINT;
  if (/幼儿园/.test(n)) return LEAF;
  if (/餐厅|服务中心/.test(n)) return SAND;
  if (/体育馆|活动中心/.test(n)) return STONE;
  if (/公寓|生活区|科研/.test(n)) return CLOUD;
  if (/训练|工程/.test(n)) return STONE;
  if (/艺术|创新|教学/.test(n)) return SKY;
  if (tile.type === 'dorm') return CLOUD;
  if (tile.type === 'canteen') return SAND;
  return PALETTES[Math.floor(rnd(tile.x, tile.y, 9) * PALETTES.length) % PALETTES.length];
}

/* ================================================================== *
 * 建筑：简约圆角几何体块（不改位置 / 数量 / 地块布局，只改外观）
 *
 * 造型语言：
 *   - 退台错落：两层以上做「底座 + 内收塔楼」两段体块，底座屋面成为露台环廊；
 *   - 遮阳檐口：每段体块顶部一块出挑薄板（圆角描边），兼作遮阳构造；
 *   - 露台花池 + 屋顶小花园：低饱和冷绿点出「微气候降温」主题；
 *   - 架空连廊：Corridor 连接相邻楼栋，兼作通风廊道；
 *   - 配色低饱和（浅灰 / 米白 / 淡青薄荷），线条干净、阴影轻薄，与树木水景自然衔接。
 * ================================================================== */

/** 一段体块：可见立面 + 窗带 + 楼层线（矩形轮廓，高度从 zB 到 zT）。 */
function Volume({ fr, r, zB, zT, p, tint }: { fr: ViewFrame; r: Rect; zB: number; zT: number; p: Palette; tint: (c: string) => string }) {
  const h = zT - zB;
  const rows = h >= 3 ? 2 : 1;
  const cols = 2;
  const v0 = 0.18;
  const v1 = 0.88;
  const rowH = (v1 - v0) / rows;
  const glass = tint(p.glass);
  const trim = tint(p.trim);
  const frames: Pt[][] = [];
  const panes: Pt[][] = [];
  const sills: Pt[][] = [];
  const floorLines: { a: Pt; b: Pt }[] = [];
  for (const dir of fr.visible) {
    for (let k = 1; k < rows; k++) {
      const [a, b] = edge2(fr, r, zB + h * (v0 + rowH * k), dir);
      floorLines.push({ a, b });
    }
    for (let rr = 0; rr < rows; rr++) {
      const zz0 = zB + h * (v0 + rowH * rr + rowH * 0.16);
      const zz1 = zB + h * (v0 + rowH * rr + rowH * 0.76);
      for (let c = 0; c < cols; c++) {
        const cell = 0.9 / cols;
        const u0 = 0.05 + cell * c + cell * 0.16;
        const u1 = 0.05 + cell * c + cell * 0.84;
        frames.push(faceU(fr, r, zz0 - 0.07, zz1 + 0.07, dir, u0 - 0.012, u1 + 0.012));
        panes.push(faceU(fr, r, zz0, zz1, dir, u0, u1));
        sills.push(faceU(fr, r, zz0 - 0.09, zz0 - 0.02, dir, u0 - 0.03, u1 + 0.03));
      }
    }
  }
  return (
    <g>
      {fr.visible.map((dir) => {
        const base = tint(shade(p.wall, WALL_SHADE[dir]));
        return (
          <g key={dir}>
            <path d={toPath(faceU(fr, r, zB, zT, dir))} fill={base} stroke={shade(base, -0.15)} strokeWidth="0.7" strokeLinejoin="round" />
            {WALL_SHEEN[dir] > 0 && (
              <path d={toPath(faceU(fr, r, zB + h * 0.36, zT, dir))} fill="#ffffff" opacity={WALL_SHEEN[dir] * 0.75} />
            )}
          </g>
        );
      })}
      <path
        d={floorLines.map((l) => `M${l.a.sx.toFixed(1)},${l.a.sy.toFixed(1)} L${l.b.sx.toFixed(1)},${l.b.sy.toFixed(1)}`).join(' ')}
        stroke={trim}
        strokeWidth="0.9"
        opacity="0.26"
        fill="none"
      />
      <path d={quads(sills)} fill={shade(tint(p.wall), -0.11)} opacity="0.7" />
      <path d={quads(frames)} fill={trim} opacity="0.85" />
      <path d={quads(panes)} fill={glass} stroke="#ffffff" strokeWidth="0.4" opacity="0.96" />
    </g>
  );
}

/**
 * 一栋楼的“体量矩形”：两层以上是内收的塔楼（错落体块），体育馆等保持整体体量。
 * BuildingBlock 与 Corridor 共用这一套，连廊才能精确接在两栋塔楼的立面上。
 */
export function massingRect(tile: Tile): Rect {
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

export function BuildingBlock({ fr, tile, heatTint, heat, greenroof }: {
  fr: ViewFrame;
  tile: Tile;
  heatTint: string | null;
  heat: number;
  greenroof: boolean;
}) {
  const i0 = tile.x;
  const j0 = tile.y;
  const z = tile.elev;
  const p = paletteFor(tile);
  const seed = rnd(tile.x, tile.y, 3);
  /** 当前角度下朝向观察者的立面（1~2 个），窗、女儿墙等都只画这些面。 */
  const visible = fr.visible;
  // 正门固定开在 +j 面（默认视角正对玩家的立面）；该面转到背面时门随墙一起被遮挡
  const doorDir: FaceDir = 's';
  const showDoor = visible.includes(doorDir);

  // 热力浓淡：越热越被热力色吞没；偏凉时保留材质色。
  const mixAmt = heatTint ? 0.2 + 0.46 * Math.min(1, Math.max(0, (heat - 30) / 62)) : 0;
  const tint = (c: string) => (heatTint ? mixHex(c, heatTint, mixAmt) : c);

  const roof = greenroof ? tint('#6fbf8f') : tint(p.roof);
  const trim = tint(p.trim);
  const glass = tint(p.glass);

  const kind = roofKind(tile, seed, z);
  // 退台错落：两层以上做「底座 + 内收塔楼」；体育馆保持整体体量（屋面画跑道）
  const split = z >= 2 && kind !== 'sports';
  const podiumH = split ? Math.max(1, Math.floor(z / 2)) : z;
  const towerH = z - podiumH;
  const base: Rect = { iA: i0, jA: j0, iB: i0 + 1, jB: j0 + 1 };
  const tower = massingRect(tile);   // 与架空连廊共用同一套塔楼轮廓
  const tw = tower.iB - tower.iA;
  const th = tower.jB - tower.jA;

  // 入口：门 + 雨篷贴在底座正立面上
  const doorTop = podiumH >= 2 ? 0.42 : 0.52;
  const door = showDoor ? faceU(fr, base, 0, doorTop, doorDir, 0.4, 0.6) : null;
  const awning = showDoor ? faceU(fr, base, doorTop, doorTop + 0.06, doorDir, 0.34, 0.66) : null;

  // 诊所红十字的中心点（贴在底座正立面的偏上位置）
  const signPts = faceU(fr, base, podiumH * 0.34, podiumH * 0.78, doorDir);
  const signC: Pt = {
    sx: (signPts[0].sx + signPts[1].sx + signPts[2].sx + signPts[3].sx) / 4,
    sy: (signPts[0].sy + signPts[1].sy + signPts[2].sy + signPts[3].sy) / 4,
  };

  // 露台花池：只挂在朝向观察者的那几条退台边沿上，任何角度都不会"穿"到楼后
  const ledge: Record<FaceDir, { u: number; v: number }> = {
    s: { u: tower.iA - i0 + tw * (0.3 + seed * 0.3), v: (tower.jB - j0 + 1) / 2 },
    n: { u: tower.iA - i0 + tw * (0.3 + seed * 0.3), v: (tower.jA - j0) / 2 },
    e: { u: (tower.iB - i0 + 1) / 2, v: tower.jA - j0 + th * (0.3 + seed * 0.3) },
    w: { u: (tower.iA - i0) / 2, v: tower.jA - j0 + th * (0.3 + seed * 0.3) },
  };

  // 屋顶小花园：平坦屋面 / 中庭式的楼，在塔楼顶的一角种一丛（避开楼梯间）
  const garden = kind === 'flat' || kind === 'atrium';
  const gu = tower.iA - i0 + tw * (seed > 0.7 ? 0.24 : 0.76);
  const gv = tower.jB - j0 - th * 0.22;

  return (
    <g className="block">
      {/* 落地阴影：轻薄 */}
      <path d={toPath(roofQuad(fr, i0, j0, 0, -0.03, -0.03, 1.03, 1.03, 0.004))} fill="#41616f" opacity="0.10" />

      {/* 底座体块 */}
      <Volume fr={fr} r={base} zB={0} zT={podiumH} p={p} tint={tint} />
      {/* 入口 */}
      {door && <path d={toPath(door)} fill={trim} opacity="0.9" />}
      {awning && <path d={toPath(awning)} fill={shade(trim, 0.24)} stroke={shade(trim, -0.08)} strokeWidth="0.5" strokeLinejoin="round" />}
      {/* 底座檐口 = 露台地面（出挑薄板 + 女儿墙描线） */}
      <Eave fr={fr} r={base} z={podiumH} over={0.045} thick={0.055} color={shade(tint(p.wall), -0.04)} />

      {/* 塔楼（内收错落体块） */}
      {split && towerH > 0 && <Volume fr={fr} r={tower} zB={podiumH} zT={z} p={p} tint={tint} />}

      {/* 露台花池：坐在檐口环廊上 */}
      {split && visible.map((dir) => (
        <Planter key={dir} fr={fr} i0={i0} j0={j0} z={podiumH} u={ledge[dir].u} v={ledge[dir].v} />
      ))}

      {/* 屋面檐口（出挑薄板，兼作遮阳） */}
      <Eave fr={fr} r={split && towerH > 0 ? tower : base} z={z} over={0.06} thick={0.06} color={roof} />

      {/* 屋顶小花园 */}
      {garden && (
        <g>
          <path d={toPath(roofQuad(fr, i0, j0, z, gu - 0.12, gv - 0.1, gu + 0.12, gv + 0.1, 0.035))} fill="#e2e9e4" stroke="#cfdad4" strokeWidth="0.5" strokeLinejoin="round" />
          <Tuft fr={fr} i0={i0} j0={j0} z={z + 0.035} u={gu - 0.04} v={gv - 0.015} s={0.82} />
          <Tuft fr={fr} i0={i0} j0={j0} z={z + 0.035} u={gu + 0.045} v={gv + 0.02} s={0.6} tone={1} />
        </g>
      )}

      {/* 屋顶设备 */}
      <RoofKit fr={fr} r={split && towerH > 0 ? tower : base} z={z} seed={seed} kind={kind} trim={trim} glass={glass} accent={p.accent ?? trim} />

      {/* 特殊建筑的“招牌”细节 */}
      {kind === 'clinic' && showDoor && <CrossSign c={signC} />}
      {kind === 'dorm' && <Balconies fr={fr} r={split && towerH > 0 ? tower : base} zB={podiumH} zT={z} cols={2} rows={Math.max(1, towerH || z)} color={shade(roof, 0.04)} dirs={visible} />}
      {greenroof && <GreenRoofDeck fr={fr} r={split && towerH > 0 ? tower : base} z={z} />}
    </g>
  );
}

/**
 * 架空连廊：架在相邻两栋楼的塔楼立面之间（塔楼内收，连廊正好跨过底座上方的空档），
 * 兼作通风廊道。从“较远”的那栋画起，近栋的墙面会自然压住连廊的近端，遮挡关系在任何角度都成立。
 */
export function Corridor({ fr, tile, nb, dir }: { fr: ViewFrame; tile: Tile; nb: Tile; dir: FaceDir }) {
  const A = massingRect(tile);
  const B = massingRect(nb);
  const zc = Math.min(tile.elev, nb.elev) - 0.58;
  const th = 0.13;
  const alongI = dir === 'e' || dir === 'w';
  // 沿两栋塔楼的公共中线取一条细廊，两端各探进塔楼面 0.015 消接缝
  const mid = alongI
    ? (Math.max(A.jA, B.jA) + Math.min(A.jB, B.jB)) / 2
    : (Math.max(A.iA, B.iA) + Math.min(A.iB, B.iB)) / 2;
  const half = 0.14;
  const r: Rect = alongI
    ? { iA: Math.min(A.iB, B.iB) - 0.015, jA: mid - half, iB: Math.max(A.iA, B.iA) + 0.015, jB: mid + half }
    : { iA: mid - half, jA: Math.min(A.jB, B.jB) - 0.015, iB: mid + half, jB: Math.max(A.jA, B.jA) + 0.015 };
  return (
    <g className="corridor">
      {fr.visible.map((side) => (
        <path
          key={side}
          d={toPath(faceU(fr, r, zc, zc + th, side))}
          fill={shade('#dce8e4', WALL_SHADE[side] * 0.85)}
          strokeLinejoin="round"
        />
      ))}
      <path d={toPath(rectTop(fr, r, zc + th))} fill="#dbe7e2" stroke="#b9cbc4" strokeWidth="0.7" strokeLinejoin="round" />
      {/* 顶面沿口的浅色栏板线 */}
      <path d={toPath(rectTop(fr, inflate(r, -0.025), zc + th + 0.04))} fill="none" stroke="#ffffff" strokeWidth="0.9" opacity="0.9" strokeLinejoin="round" />
    </g>
  );
}

type RoofKind = 'flat' | 'atrium' | 'saw' | 'sports' | 'kinder' | 'clinic' | 'dorm';

function roofKind(tile: Tile, seed: number, z: number): RoofKind {
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

/** 屋顶小物件：楼梯间 / 水箱 / 空调外机 / 天窗 / 太阳能板（定位在给定矩形屋面内）。 */
function RoofKit({ fr, r, z, seed, kind, trim, glass, accent }: {
  fr: ViewFrame; r: Rect; z: number; seed: number; kind: RoofKind;
  trim: string; glass: string; accent: string;
}) {
  /** 屋面内定位：u/v ∈ [0,1]²（相对该段体块的顶面），dz 为抬升高度。 */
  const P = (u: number, v: number, dz = 0) => rectP(fr, r, z, u, v, dz);
  const Q = (u0: number, v0: number, u1: number, v1: number, dz = 0) => rectQ(fr, r, z, u0, v0, u1, v1, dz);
  const items: JSX.Element[] = [];

  // 楼梯间 / 电梯机房：一个退进的小体块
  const sx = 0.16 + seed * 0.22;
  const sy = 0.16 + rnd(r.iA, r.jA, 11) * 0.2;
  const s = 0.24;
  const sh = 0.55;
  items.push(
    <g key="stair">
      <path d={toPath([P(sx + s, sy, sh), P(sx + s, sy + s, sh), P(sx + s, sy + s, 0.02), P(sx + s, sy, 0.02)])} fill={shade(trim, -0.08)} />
      <path d={toPath([P(sx, sy + s, sh), P(sx + s, sy + s, sh), P(sx + s, sy + s, 0.02), P(sx, sy + s, 0.02)])} fill={trim} />
      <path d={toPath(Q(sx, sy, sx + s, sy + s, sh))} fill={shade(trim, 0.14)} stroke={shade(trim, -0.12)} strokeWidth="0.5" strokeLinejoin="round" />
    </g>,
  );

  if (kind === 'atrium') {
    // 玻璃中庭：图书馆 / 高层教学楼的标志物
    const a = 0.3;
    const au = 0.35;
    const ah = 0.95;
    items.push(
      <g key="atrium">
        <path d={toPath([P(au + a, au, ah), P(au + a, au + a, ah), P(au + a, au + a, 0.06), P(au + a, au, 0.06)])} fill={shade(glass, -0.14)} stroke="#ffffff" strokeWidth="0.5" />
        <path d={toPath([P(au, au + a, ah), P(au + a, au + a, ah), P(au + a, au + a, 0.06), P(au, au + a, 0.06)])} fill={glass} stroke="#ffffff" strokeWidth="0.5" />
        <path d={toPath(Q(au, au, au + a, au + a, ah))} fill={shade(glass, 0.2)} stroke="#ffffff" strokeWidth="0.7" strokeLinejoin="round" />
        <path d={`M${P(au, au + a, ah).sx},${P(au, au + a, ah).sy} L${P(au + a, au + a, ah).sx},${P(au + a, au + a, ah).sy}`} stroke="#ffffff" strokeWidth="1" opacity="0.8" />
      </g>,
    );
  }

  if (kind === 'saw') {
    // 餐厅：三排锯齿天窗
    for (let k = 0; k < 3; k++) {
      const u0 = 0.2;
      const u1 = 0.8;
      const vv = 0.24 + k * 0.22;
      items.push(
        <path
          key={`saw${k}`}
          d={toPath(Q(u0, vv, u1, vv + 0.13, 0.34))}
          fill={shade(glass, 0.08)}
          stroke="#ffffff"
          strokeWidth="0.6"
          opacity="0.95"
        />,
      );
    }
  }

  if (kind === 'sports') {
    // 体育馆：屋顶跑道
    const c = P(0.5, 0.5, 0.03);
    items.push(
      <g key="track">
        <ellipse cx={c.sx} cy={c.sy} rx="30" ry="15" fill="none" stroke="#ffffff" strokeWidth="2.4" opacity="0.85" />
        <ellipse cx={c.sx} cy={c.sy} rx="20" ry="10" fill="#a9d3b8" stroke="#ffffff" strokeWidth="1.2" opacity="0.9" />
        <ellipse cx={c.sx} cy={c.sy} rx="7" ry="3.4" fill={glass} stroke="#ffffff" strokeWidth="1" />
      </g>,
    );
  }

  if (kind === 'kinder') {
    // 幼儿园：低饱和积木块 + 小滑梯
    const blocks: [number, number, string][] = [
      [0.2, 0.24, '#cfe3da'],
      [0.56, 0.22, '#e7e1d3'],
      [0.24, 0.6, '#d6e4ec'],
    ];
    blocks.forEach(([u, v, color], k) => {
      const h = 0.3 + k * 0.08;
      items.push(
        <g key={`kb${k}`}>
          <path d={toPath([P(u + 0.2, v, h), P(u + 0.2, v + 0.2, h), P(u + 0.2, v + 0.2, 0.03), P(u + 0.2, v, 0.03)])} fill={shade(color, -0.14)} />
          <path d={toPath([P(u, v + 0.2, h), P(u + 0.2, v + 0.2, h), P(u + 0.2, v + 0.2, 0.03), P(u, v + 0.2, 0.03)])} fill={color} />
          <path d={toPath(Q(u, v, u + 0.2, v + 0.2, h))} fill={shade(color, 0.16)} stroke="#ffffff" strokeWidth="0.5" strokeLinejoin="round" />
        </g>,
      );
    });
  }

  if (kind === 'dorm') {
    // 公寓：屋顶晾晒架 + 水箱
    items.push(
      <g key="rack">
        <path d={`M${P(0.62, 0.3, 0.5).sx},${P(0.62, 0.3, 0.5).sy} L${P(0.62, 0.78, 0.5).sx},${P(0.62, 0.78, 0.5).sy}`} stroke={trim} strokeWidth="1.4" />
        <path d={`M${P(0.62, 0.3, 0.32).sx},${P(0.62, 0.3, 0.32).sy} L${P(0.62, 0.78, 0.32).sx},${P(0.62, 0.78, 0.32).sy}`} stroke={trim} strokeWidth="1" opacity="0.7" />
      </g>,
    );
  }

  // 空调外机 / 太阳能板
  if (kind === 'flat' || kind === 'atrium') {
    const u = 0.52 + rnd(r.iA, r.jA, 21) * 0.14;
    const v = 0.56 + rnd(r.iA, r.jA, 22) * 0.16;
    items.push(
      <g key="ac">
        <path d={toPath([P(u + 0.16, v, 0.22), P(u + 0.16, v + 0.16, 0.22), P(u + 0.16, v + 0.16, 0.02), P(u + 0.16, v, 0.02)])} fill={shade(trim, -0.1)} />
        <path d={toPath([P(u, v + 0.16, 0.22), P(u + 0.16, v + 0.16, 0.22), P(u + 0.16, v + 0.16, 0.02), P(u, v + 0.16, 0.02)])} fill={trim} />
        <path d={toPath(Q(u, v, u + 0.16, v + 0.16, 0.22))} fill={shade(trim, 0.16)} stroke="#ffffff" strokeWidth="0.4" strokeLinejoin="round" />
      </g>,
    );
  }

  if (z >= 4) {
    // 高楼：天线 + 航空障碍灯
    const t = P(0.7, 0.3, 0.05);
    items.push(
      <g key="antenna">
        <path d={`M${t.sx},${t.sy} L${t.sx},${t.sy - 26}`} stroke={accent} strokeWidth="1.6" strokeLinecap="round" />
        <circle cx={t.sx} cy={t.sy - 27} r="2.2" fill="#ff6b6b" className="beacon" />
      </g>,
    );
  }

  return <g>{items}</g>;
}

/** 医院：墙上的红十字（贴在底座正立面上，该面转到背面时随墙被遮挡）。 */
function CrossSign({ c }: { c: Pt }) {
  const s = 5.4;
  return (
    <g className="cross-sign" transform={`translate(${c.sx} ${c.sy})`}>
      <rect x={-s * 0.9} y={-s * 1.5} width={s * 1.8} height={s * 3} rx="2" fill="#ffffff" stroke="#e0b9b6" strokeWidth="0.6" />
      <rect x={-s * 0.34} y={-s * 1.05} width={s * 0.68} height={s * 2.1} fill="#d9534f" />
      <rect x={-s * 1.05} y={-s * 0.34} width={s * 2.1} height={s * 0.68} fill="#d9534f" />
    </g>
  );
}

/** 公寓：沿墙的阳台板与栏杆（画在给定体块的可见立面上）。 */
function Balconies({ fr, r, zB, zT, cols, rows, color, dirs }: { fr: ViewFrame; r: Rect; zB: number; zT: number; cols: number; rows: number; color: string; dirs: FaceDir[] }) {
  const h = zT - zB;
  const out: Pt[][] = [];
  const out2: Pt[][] = [];
  const cell = 0.9 / cols;
  for (let row = 1; row < rows; row++) {
    const v = 0.2 + (0.66 / rows) * row;
    for (const side of dirs) {
      for (let c = 0; c < cols; c++) {
        const u0 = 0.05 + cell * c + cell * 0.08;
        const u1 = 0.05 + cell * c + cell * 0.92;
        out.push(faceU(fr, r, zB + h * v - 0.035, zB + h * v + 0.005, side, u0, u1));
        out2.push(faceU(fr, r, zB + h * v + 0.005, zB + h * v + 0.075, side, u0, u1));
      }
    }
  }
  return (
    <g>
      <path d={quads(out)} fill={shade(color, -0.12)} />
      <path d={quads(out2)} fill="#ffffff" opacity="0.28" />
    </g>
  );
}

/** 绿色屋顶改造：在给定屋面上铺种植槽 + 灌木 + 小凉架。 */
function GreenRoofDeck({ fr, r, z }: { fr: ViewFrame; r: Rect; z: number }) {
  return (
    <g className="greenroof-deck">
      <path d={toPath(rectQ(fr, r, z, 0.04, 0.04, 0.96, 0.96, 0.08))} fill="#57ab77" stroke="#3d8c5c" strokeWidth="0.9" strokeLinejoin="round" />
      <path d={toPath(rectQ(fr, r, z, 0.09, 0.09, 0.91, 0.91, 0.09))} fill="#7ccb98" opacity="0.55" />
      {[[0.22, 0.26], [0.42, 0.2], [0.66, 0.32], [0.3, 0.64], [0.6, 0.7], [0.78, 0.5]].map(([u, v], k) => {
        const pt = rectP(fr, r, z, u, v, 0.12);
        return <circle key={k} cx={pt.sx} cy={pt.sy - 1.6} r={2.4 + (k % 2) * 0.6} fill={k % 2 ? '#3f9a63' : '#8ddca8'} stroke="#ffffff" strokeWidth="0.4" />;
      })}
    </g>
  );
}

/* ================================================================== *
 * 地表装饰
 * ================================================================== */

export function TreeShape({ x, y, s, seed = 0.5, dry = false }: { x: number; y: number; s: number; seed?: number; dry?: boolean }) {
  const dark = dry ? '#6f9a6a' : '#3f8f5c';
  const mid = dry ? '#87ad78' : '#54a56e';
  const light = dry ? '#a7c08c' : '#6fbf85';
  const top = dry ? '#c2d3a4' : '#8ed39c';
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="1.5" cy="0.5" rx="9" ry="3.6" fill="#3f5f52" opacity="0.16" />
      <path d="M-1.5,0 L-1.2,-9 L1.2,-9 L1.5,0 Z" fill="#8a6a52" />
      <path d="M0,-8 L-5.5,-13" stroke="#8a6a52" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="0" cy="-15" r="9.6" fill={dark} />
      <circle cx="-6.4" cy="-11.6" r="6.6" fill={mid} />
      <circle cx="6.6" cy="-12" r="7" fill={mid} />
      <circle cx="-1.6" cy="-19.5" r="5.6" fill={light} />
      <circle cx="3.4" cy="-17.6" r="3.4" fill={top} opacity={0.85 + seed * 0.15} />
    </g>
  );
}

export function Bush({ x, y, s, tone = 0 }: { x: number; y: number; s: number; tone?: number }) {
  const colors = ['#5aa877', '#6dbb8a', '#4f9c6d'];
  const c = colors[tone % colors.length];
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0.6" cy="0.6" rx="6" ry="2.4" fill="#3f5f52" opacity="0.14" />
      <circle cx="-2.4" cy="-2.4" r="3.4" fill={c} />
      <circle cx="2.6" cy="-2.8" r="3.9" fill={shade(c, 0.12)} />
      <circle cx="0" cy="-4.4" r="3" fill={shade(c, 0.22)} />
    </g>
  );
}

function Lamp({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="1" cy="0.4" rx="4" ry="1.6" fill="#3f5f52" opacity="0.16" />
      <path d="M0,0 L0,-17" stroke="#5b7d90" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M0,-17 q0,-4 4,-4" fill="none" stroke="#5b7d90" strokeWidth="1.4" />
      <circle cx="4.6" cy="-21" r="2.6" fill="#ffe6a3" stroke="#c9a24d" strokeWidth="0.6" />
    </g>
  );
}

function Bench({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="0.6" cy="0.8" rx="7" ry="2.6" fill="#3f5f52" opacity="0.14" />
      <rect x="-6" y="-5" width="12" height="2.4" rx="1" fill="#c08a5a" />
      <rect x="-6" y="-2" width="12" height="2" rx="1" fill="#a97747" />
      <rect x="-5.4" y="-1" width="1.4" height="3" fill="#8a6138" />
      <rect x="4" y="-1" width="1.4" height="3" fill="#8a6138" />
    </g>
  );
}

/**
 * 绿地 / 林荫 / 庭院上的零散点缀：灌木、树、路灯、长椅。
 * 位置由稳定伪随机决定，避免每块地都长得一样。
 */
export function GroundScatter({ fr, tile, i0, j0 }: { fr: ViewFrame; tile: Tile; i0: number; j0: number }) {
  const items: JSX.Element[] = [];
  const count = tile.type === 'tree' ? 4 : tile.type === 'garden' ? 3 : tile.type === 'grass' ? 2 : 0;
  for (let k = 0; k < count; k++) {
    const u = 0.18 + rnd(tile.x, tile.y, 31 + k) * 0.64;
    const v = 0.18 + rnd(tile.x, tile.y, 41 + k) * 0.64;
    const p = fr.pt(i0 + u, j0 + v, 0);
    const kind = rnd(tile.x, tile.y, 51 + k);
    if (tile.type === 'tree' || (tile.type === 'garden' && kind > 0.45)) {
      items.push(<TreeShape key={k} x={p.sx} y={p.sy} s={0.62 + rnd(tile.x, tile.y, 61 + k) * 0.3} seed={kind} />);
    } else if (kind > 0.72) {
      items.push(<Bush key={k} x={p.sx} y={p.sy} s={0.85} tone={k} />);
    } else {
      items.push(<Bush key={k} x={p.sx} y={p.sy} s={0.7} tone={k + 1} />);
    }
  }
  if (tile.type === 'tree' || tile.type === 'garden') {
    const p = fr.pt(i0 + 0.5, j0 + 0.5, 0);
    items.push(<Bench key="bench" x={p.sx} y={p.sy} />);
  }
  return <g className="scatter">{items}</g>;
}

/** 广场：铺装分格 + 中心拼花 + 花池 + 路灯。 */
export function PlazaDecor({ fr, i0, j0 }: { fr: ViewFrame; i0: number; j0: number }) {
  const c = fr.pt(i0 + 0.5, j0 + 0.5, 0.02);
  const petals: Pt[][] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    petals.push([
      { sx: c.sx, sy: c.sy },
      { sx: c.sx + Math.cos(a) * 15, sy: c.sy + Math.sin(a) * 7.5 },
      { sx: c.sx + Math.cos(a + 0.4) * 9, sy: c.sy + Math.sin(a + 0.4) * 4.5 },
    ]);
  }
  return (
    <g className="plaza-decor">
      <path d={toPath(diamond(fr, i0, j0, 0.012))} fill="none" stroke="#b9cbdb" strokeWidth="0.8" />
      <path d={toPath([fr.pt(i0 + 0.5, j0, 0.012), fr.pt(i0 + 1, j0 + 0.5, 0.012), fr.pt(i0 + 0.5, j0 + 1, 0.012), fr.pt(i0, j0 + 0.5, 0.012)])} fill="none" stroke="#e3edf5" strokeWidth="1" />
      <path d={quads(petals)} fill="#e8f2f8" opacity="0.75" />
      <circle cx={c.sx} cy={c.sy} r="3.4" fill="#f3d9a4" stroke="#d8b26a" strokeWidth="0.6" />
      <Bush x={c.sx - 20} y={c.sy + 2} s={0.6} tone={1} />
      <Bush x={c.sx + 20} y={c.sy + 2} s={0.6} tone={2} />
      <Lamp x={c.sx - 24} y={c.sy - 8} />
      <Lamp x={c.sx + 24} y={c.sy - 8} />
    </g>
  );
}

/** 道路：路面 + 缘石 + 中心虚线 + 斑马线。 */
export function RoadDecor({ fr, i0, j0, opacity }: { fr: ViewFrame; i0: number; j0: number; opacity: number }) {
  const a = fr.pt(i0, j0, 0.014);
  const b = fr.pt(i0 + 1, j0 + 1, 0.014);
  return (
    <g className="road-decor">
      <path d={toPath([fr.pt(i0 + 0.06, j0, 0.012), fr.pt(i0 + 1, j0 + 0.94, 0.012), fr.pt(i0 + 1, j0 + 0.8, 0.012), fr.pt(i0 + 0.2, j0, 0.012)])} fill="#eef4f8" opacity={opacity} />
      <path d={toPath([fr.pt(i0, j0 + 0.06, 0.012), fr.pt(i0 + 0.94, j0 + 1, 0.012), fr.pt(i0 + 0.8, j0 + 1, 0.012), fr.pt(i0, j0 + 0.2, 0.012)])} fill="#eef4f8" opacity={opacity} />
      <path
        d={toPath([fr.pt(i0 + 0.5, j0 + 0.22, 0.016), fr.pt(i0 + 0.5, j0 + 0.48, 0.016)])}
        stroke="#fdfdfd"
        strokeWidth="2"
        strokeDasharray="5 6"
        opacity={opacity}
      />
      <path d={`M${a.sx},${a.sy}`} stroke="none" />
      <path d={`M${b.sx},${b.sy}`} stroke="none" />
    </g>
  );
}

/** 庭院 / 花园：草坪 + 蜿蜒小径 + 花坛。 */
export function GardenPatch({ fr, i0, j0 }: { fr: ViewFrame; i0: number; j0: number }) {
  const c = fr.pt(i0 + 0.5, j0 + 0.5, 0.04);
  const path = [
    fr.pt(i0 + 0.08, j0 + 0.5, 0.05), fr.pt(i0 + 0.3, j0 + 0.34, 0.05),
    fr.pt(i0 + 0.52, j0 + 0.52, 0.05), fr.pt(i0 + 0.74, j0 + 0.36, 0.05), fr.pt(i0 + 0.94, j0 + 0.5, 0.05),
  ];
  const flowers: [number, number, string][] = [
    [0.24, 0.66, '#f4a3a3'], [0.42, 0.24, '#f6d27a'], [0.64, 0.7, '#c9a3e6'],
    [0.78, 0.26, '#f4a3a3'], [0.36, 0.78, '#9fd6a8'], [0.56, 0.4, '#f6d27a'],
  ];
  return (
    <g className="garden">
      <path d={toPath(diamond(fr, i0 + 0.04, j0 + 0.04, 0.045))} fill="#a8dcbc" opacity="0.9" />
      <path
        d={`M${path.map((p) => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(' L')}`}
        fill="none"
        stroke="#f2f0e4"
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />
      {flowers.map(([u, v, color], k) => {
        const p = fr.pt(i0 + u, j0 + v, 0.06);
        return (
          <g key={k}>
            <circle cx={p.sx} cy={p.sy} r="1.2" fill="#4f8f63" opacity="0.5" />
            <circle cx={p.sx} cy={p.sy - 1.6} r="2.1" fill={color} stroke="#ffffff" strokeWidth="0.4" />
          </g>
        );
      })}
      <circle cx={c.sx} cy={c.sy} r="0" fill="none" />
    </g>
  );
}

/** 运动场：红色跑道 + 绿茵 + 白线 + 球门。 */
export function SportMarks({ fr, i0, j0 }: { fr: ViewFrame; i0: number; j0: number }) {
  const c = fr.pt(i0 + 0.5, j0 + 0.5, 0);
  const inner = [
    fr.pt(i0 + 0.2, j0 + 0.5, 0.02), fr.pt(i0 + 0.5, j0 + 0.2, 0.02),
    fr.pt(i0 + 0.8, j0 + 0.5, 0.02), fr.pt(i0 + 0.5, j0 + 0.8, 0.02),
  ];
  return (
    <g>
      <path d={toPath(diamond(fr, i0, j0, 0.01))} fill="#c9705a" />
      <path d={toPath(diamond(fr, i0 + 0.06, j0 + 0.06, 0.015))} fill="#d98a72" opacity="0.65" />
      <path d={toPath(inner)} fill="#7fc08a" />
      <path d={toPath(inner)} fill="none" stroke="#ffffff" strokeWidth="0.9" opacity="0.8" />
      <ellipse cx={c.sx} cy={c.sy} rx="12" ry="6" fill="none" stroke="#ffffff" strokeWidth="1.1" opacity="0.85" />
      <ellipse cx={c.sx} cy={c.sy} rx="3" ry="1.4" fill="#ffffff" opacity="0.7" />
      <g stroke="#f2f4f6" strokeWidth="1.4" strokeLinecap="round">
        <path d={`M${c.sx - 24},${c.sy + 1} l0,-6 l4,0`} fill="none" />
        <path d={`M${c.sx + 24},${c.sy + 1} l0,-6 l-4,0`} fill="none" />
      </g>
    </g>
  );
}

/** 水体：分层波纹 + 岸边浪花。 */
export function WaterSurface({ fr, i0, j0 }: { fr: ViewFrame; i0: number; j0: number }) {
  const c = fr.pt(i0 + 0.5, j0 + 0.5, 0.01);
  return (
    <g>
      <path d={toPath(diamond(fr, i0, j0, 0.008))} fill="#5fb3dd" />
      <path d={toPath(diamond(fr, i0 + 0.08, j0 + 0.08, 0.012))} fill="#84cbea" opacity="0.7" />
      <ellipse cx={c.sx} cy={c.sy} rx="17" ry="8" fill="none" stroke="#ffffff" strokeWidth="1.2" opacity="0.55" />
      <path d={`M${c.sx - 13},${c.sy - 1} q6,-3.6 12,0`} fill="none" stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
      <path d={`M${c.sx - 6},${c.sy + 4} q6,-3 12,-0.4`} fill="none" stroke="#ffffff" strokeWidth="1.1" strokeLinecap="round" opacity="0.45" />
    </g>
  );
}

export function WaterSourceMarker({ fr, i0, j0, kind }: { fr: ViewFrame; i0: number; j0: number; kind: 'pond' | 'hydrant' }) {
  const c = fr.pt(i0 + 0.5, j0 + 0.5, 0.06);
  if (kind === 'pond') {
    return (
      <g className="water-source pond-marker">
        <path d={toPath(diamond(fr, i0 + 0.08, j0 + 0.08, 0.05))} fill="#b9dced" opacity="0.7" />
        <ellipse cx={c.sx} cy={c.sy} rx="15" ry="7" fill="#6fc0dd" stroke="#f7fdff" strokeWidth="1.4" />
        <ellipse cx={c.sx} cy={c.sy} rx="9" ry="4" fill="#8fd8ef" opacity="0.85" />
        <path d={`M${c.sx - 7},${c.sy - 1} q7,-4 14,0`} fill="none" stroke="#f2fdff" strokeWidth="1.1" />
        <ellipse className="ripple" cx={c.sx} cy={c.sy} rx="17" ry="7.8" fill="none" stroke="#e8faff" strokeWidth="1.1" opacity="0.7" />
      </g>
    );
  }
  return (
    <g className="water-source hydrant-marker" transform={`translate(${c.sx} ${c.sy})`}>
      <path d={toPath(diamond(fr, i0 + 0.16, j0 + 0.16, 0.03))} fill="#d9e8ef" opacity="0.75" />
      <g className="hydrant-body">
        <rect x="-2.6" y="-11" width="5.2" height="12" rx="2.2" fill="#d9735c" stroke="#fff4ef" strokeWidth="1" />
        <rect x="-6" y="-3.8" width="12" height="3.6" rx="1.7" fill="#c25f4c" />
        <circle cx="0" cy="-12.6" r="3.3" fill="#eda882" stroke="#fff7f2" strokeWidth="1" />
        <circle cx="0" cy="-12.6" r="1.2" fill="#fdf3ec" />
        <path d="M5.4,-8.6 h4.6" stroke="#8d5960" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M-5.4,-8.6 h-4.6" stroke="#8d5960" strokeWidth="1.8" strokeLinecap="round" />
      </g>
    </g>
  );
}

/** 停车点：车位线 + 几辆单车。 */
export function ParkingDecor({ fr, i0, j0 }: { fr: ViewFrame; i0: number; j0: number }) {
  const slots: JSX.Element[] = [];
  for (let k = 0; k < 3; k++) {
    const v = 0.2 + k * 0.26;
    slots.push(
      <path
        key={`s${k}`}
        d={`M${fr.pt(i0 + 0.18, j0 + v, 0.02).sx},${fr.pt(i0 + 0.18, j0 + v, 0.02).sy} L${fr.pt(i0 + 0.82, j0 + v, 0.02).sx},${fr.pt(i0 + 0.82, j0 + v, 0.02).sy}`}
        stroke="#eef4f8"
        strokeWidth="1.6"
        opacity="0.85"
      />,
    );
  }
  const bike = (u: number, v: number, key: string) => {
    const p = fr.pt(i0 + u, j0 + v, 0);
    return (
      <g key={key} transform={`translate(${p.sx} ${p.sy})`}>
        <ellipse cx="0.6" cy="0.7" rx="4.4" ry="1.6" fill="#3f5f52" opacity="0.14" />
        <circle cx="-2.6" cy="-1.8" r="2" fill="none" stroke="#4f6d80" strokeWidth="0.9" />
        <circle cx="2.6" cy="-1.8" r="2" fill="none" stroke="#4f6d80" strokeWidth="0.9" />
        <path d="M-2.6,-1.8 L0,-5 L2.6,-1.8 M0,-5 L-0.8,-6.4 L0.8,-6.4" fill="none" stroke="#6b8ea3" strokeWidth="0.9" strokeLinecap="round" />
      </g>
    );
  };
  return (
    <g className="parking-decor">
      {slots}
      {bike(0.34, 0.28, 'b1')}
      {bike(0.52, 0.54, 'b2')}
      {bike(0.42, 0.78, 'b3')}
    </g>
  );
}

/* ================================================================== *
 * 人群
 * ================================================================== */
export function peopleDots(fr: ViewFrame, i0: number, j0: number, z: number, groups: Record<GroupId, number>, outdoor: number) {
  if (outdoor < 6) return null;
  const center = fr.pt(i0 + 0.5, j0 + 0.5, z + 0.05);
  const total = GROUP_ORDER.reduce((s, g) => s + groups[g], 0) || 1;
  const wanted = Math.max(1, Math.min(6, Math.round(outdoor / 45)));
  const dots: GroupId[] = [];
  for (const g of GROUP_ORDER) {
    const share = groups[g] / total;
    const n = Math.max(VULNERABLE_GROUPS.includes(g) && share > 0.05 ? 1 : 0, Math.round(share * wanted));
    for (let k = 0; k < n && dots.length < 7; k++) dots.push(g);
  }
  return (
    <g transform={`translate(${center.sx} ${center.sy})`}>
      {dots.map((g, idx) => {
        const angle = (idx / Math.max(1, dots.length)) * Math.PI * 2 + 0.4;
        const r = 7 + (idx % 2) * 6;
        return (
          <circle
            key={idx}
            cx={Math.cos(angle) * r}
            cy={Math.sin(angle) * r * 0.5 - 3}
            r={g === 'students' ? 2.5 : 3.2}
            fill={GROUPS[g].color}
            stroke="#ffffff"
            strokeWidth="0.8"
          />
        );
      })}
    </g>
  );
}

/* ================================================================== *
 * 改造道具
 * ================================================================== */
export function ToolObject({ fr, i0, j0, elev, toolId, hour }: {
  fr: ViewFrame; i0: number; j0: number; elev: number; toolId: ToolId; hour: Hour;
}) {
  const seed = rnd(i0, j0, hour);
  const center = fr.pt(i0 + 0.5, j0 + 0.5, elev);
  switch (toolId) {
    case 'tree': {
      const p = fr.pt(i0 + 0.5, j0 + 0.5, 0);
      return <TreeShape x={p.sx} y={p.sy} s={1.28 + seed * 0.22} seed={seed} />;
    }
    case 'canopy': {
      const z = 1.5;
      const stripe: Pt[][] = [];
      for (let k = 0; k < 3; k++) {
        const v0 = 0.12 + k * 0.27;
        stripe.push(roofQuad(fr, i0 + 0.02, j0 + 0.02, z, 0.02, v0, 0.98, v0 + 0.13, 0.02));
      }
      return (
        <g>
          {[[0.16, 0.16], [0.84, 0.16], [0.16, 0.84], [0.84, 0.84]].map(([dx, dy], idx) => {
            const p0 = fr.pt(i0 + dx, j0 + dy, 0);
            const p1 = fr.pt(i0 + dx, j0 + dy, z);
            return (
              <g key={idx}>
                <line x1={p0.sx} y1={p0.sy} x2={p1.sx} y2={p1.sy} stroke="#4b7591" strokeWidth="2.2" strokeLinecap="round" />
                <circle cx={p1.sx} cy={p1.sy} r="1.4" fill="#7fa8c2" />
              </g>
            );
          })}
          <path d={toPath(diamond(fr, i0 + 0.02, j0 + 0.02, z))} fill="#7fb0cc" stroke="#4b7591" strokeWidth="1.4" strokeLinejoin="round" />
          <path d={quads(stripe)} fill="#ffffff" opacity="0.4" />
          <path d={toPath(diamond(fr, i0 + 0.02, j0 + 0.02, z))} fill="none" stroke="#ffffff" strokeWidth="1" opacity="0.25" />
          <Bench x={center.sx} y={center.sy + 2} />
        </g>
      );
    }
    case 'water': {
      const pool = [fr.pt(i0 + 0.12, j0 + 0.5, 0.16), fr.pt(i0 + 0.5, j0 + 0.12, 0.16), fr.pt(i0 + 0.88, j0 + 0.5, 0.16), fr.pt(i0 + 0.5, j0 + 0.88, 0.16)];
      const basin = [fr.pt(i0 + 0.05, j0 + 0.5, 0.02), fr.pt(i0 + 0.5, j0 + 0.05, 0.02), fr.pt(i0 + 0.95, j0 + 0.5, 0.02), fr.pt(i0 + 0.5, j0 + 0.95, 0.02)];
      return (
        <g className="fountain-object">
          <path d={toPath(basin)} fill="#d3e0e8" stroke="#8ba7b8" strokeWidth="1.2" strokeLinejoin="round" />
          <path d={toPath(pool)} fill="#6cc0dd" stroke="#f4fdff" strokeWidth="1.2" strokeLinejoin="round" />
          <path d={toPath(pool)} fill="#ffffff" opacity="0.14" />
          <ellipse cx={center.sx} cy={center.sy - 3} rx="8" ry="3.6" fill="#4e9dbd" stroke="#e9fbff" strokeWidth="1" />
          <path d={`M${center.sx - 1},${center.sy - 6} C${center.sx - 9},${center.sy - 15} ${center.sx + 9},${center.sy - 18} ${center.sx},${center.sy - 27}`} fill="none" stroke="#f4ffff" strokeWidth="2.4" strokeLinecap="round" />
          <path d={`M${center.sx},${center.sy - 6} C${center.sx + 10},${center.sy - 14} ${center.sx + 11},${center.sy - 18} ${center.sx + 9},${center.sy - 23}`} fill="none" stroke="#dbf8ff" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx={center.sx - 6} cy={center.sy - 18} r="1.9" fill="#fff" className="fountain-drop" />
          <circle cx={center.sx + 9} cy={center.sy - 14} r="1.5" fill="#fff" className="fountain-drop delay" />
          <ellipse className="ripple" cx={center.sx} cy={center.sy - 2} rx="13" ry="5" fill="none" stroke="#f2fdff" strokeWidth="1.1" />
          <circle cx={center.sx - 13} cy={center.sy + 2} r="2.4" fill="#79c69b" />
          <circle cx={center.sx + 13} cy={center.sy + 2} r="2.4" fill="#8fd6a6" />
        </g>
      );
    }
    case 'mist': {
      return (
        <g className="mist-device">
          <path d={toPath(diamond(fr, i0 + 0.28, j0 + 0.28, 0.02))} fill="#c3d3dd" stroke="#7e9aab" strokeWidth="1" />
          <path d={toPath([fr.pt(i0 + 0.44, j0 + 0.56, 0.08), fr.pt(i0 + 0.56, j0 + 0.56, 0.08), fr.pt(i0 + 0.56, j0 + 0.56, 1.05), fr.pt(i0 + 0.44, j0 + 0.56, 1.05)])} fill="#7fa2b4" stroke="#5b8195" strokeWidth="0.8" />
          <path d={toPath(diamond(fr, i0 + 0.3, j0 + 0.3, 1.08))} fill="#dceaf0" stroke="#6b91a4" strokeWidth="1" />
          <circle cx={center.sx} cy={center.sy - 31} r="3" fill="#5e9eb9" stroke="#f8feff" strokeWidth="1" />
          <path d={`M${center.sx - 17},${center.sy - 28} Q${center.sx},${center.sy - 39} ${center.sx + 17},${center.sy - 27}`} fill="none" stroke="#d7f5fb" strokeWidth="2.6" strokeLinecap="round" className="mist" />
          <path d={`M${center.sx - 20},${center.sy - 22} Q${center.sx},${center.sy - 32} ${center.sx + 20},${center.sy - 21}`} fill="none" stroke="#eafaff" strokeWidth="1.9" strokeLinecap="round" className="mist delay" />
          <circle cx={center.sx - 21} cy={center.sy - 16} r="2.6" fill="#eafaff" opacity="0.75" className="mist delay" />
          <circle cx={center.sx + 21} cy={center.sy - 15} r="2.2" fill="#eafaff" opacity="0.7" className="mist" />
        </g>
      );
    }
    case 'station': {
      return (
        <g>
          <ellipse cx={center.sx + 2} cy={center.sy + 6} rx="13" ry="5.4" fill="#3f5f52" opacity="0.16" />
          <path d={toPath([fr.pt(i0 + 0.24, j0 + 0.72, 0.62), fr.pt(i0 + 0.72, j0 + 0.72, 0.62), fr.pt(i0 + 0.72, j0 + 0.72, 0), fr.pt(i0 + 0.24, j0 + 0.72, 0)])} fill="#2f7f9e" />
          <path d={toPath([fr.pt(i0 + 0.72, j0 + 0.24, 0.62), fr.pt(i0 + 0.72, j0 + 0.72, 0.62), fr.pt(i0 + 0.72, j0 + 0.72, 0), fr.pt(i0 + 0.72, j0 + 0.24, 0)])} fill="#3d94b5" />
          <path d={toPath(diamond(fr, i0 + 0.24, j0 + 0.24, 0.62))} fill="#6cc3e0" stroke="#ffffff" strokeWidth="1" strokeLinejoin="round" />
          <path d={toPath([fr.pt(i0 + 0.24, j0 + 0.24, 0.86), fr.pt(i0 + 0.72, j0 + 0.24, 0.86), fr.pt(i0 + 0.72, j0 + 0.3, 0.86), fr.pt(i0 + 0.24, j0 + 0.3, 0.86)])} fill="#a9e0f0" opacity="0.9" />
          <path d="M0,-9 C4,-3 6,-1 6,2 A6,5 0 0 1 -6,2 C-6,-1 -4,-3 0,-9 Z" transform={`translate(${center.sx} ${center.sy - 4}) scale(0.72)`} fill="#ffffff" opacity="0.98" />
          <rect x={center.sx - 8} y={center.sy + 1} width="16" height="3" rx="1.2" fill="#bfe6f4" opacity="0.9" />
        </g>
      );
    }
    case 'pavement': {
      const bricks: Pt[][] = [];
      for (let a = 0; a < 4; a++) {
        for (let b = 0; b < 4; b++) {
          const u0 = a * 0.25;
          const v0 = b * 0.25;
          bricks.push(roofQuad(fr, i0, j0, 0, u0 + 0.02, v0 + 0.02, u0 + 0.23, v0 + 0.23, 0.04));
        }
      }
      return (
        <g>
          <path d={toPath(diamond(fr, i0, j0, 0.035))} fill="#9dc0d4" opacity="0.75" />
          <path d={quads(bricks)} fill="#bcd8e6" stroke="#ffffff" strokeWidth="0.5" opacity="0.95" />
        </g>
      );
    }
    case 'coolpave': {
      const tiles: Pt[][] = [];
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          const u0 = a / 3;
          const v0 = b / 3;
          tiles.push(roofQuad(fr, i0, j0, 0, u0 + 0.015, v0 + 0.015, u0 + 0.318, v0 + 0.318, 0.04));
        }
      }
      return (
        <g>
          <path d={toPath(diamond(fr, i0, j0, 0.035))} fill="#f3f5fd" opacity="0.92" />
          <path d={quads(tiles)} fill="#ffffff" stroke="#c9cfec" strokeWidth="0.5" />
          <path d={toPath(diamond(fr, i0 + 0.3, j0 + 0.3, 0.045))} fill="#ffffff" opacity="0.85" />
        </g>
      );
    }
    case 'greenroof': {
      // 放在楼顶上的绿色屋顶：铺在塔楼（或整体体量）的屋面上
      const ins = 0.13;
      return <GreenRoofDeck fr={fr} r={{ iA: i0 + ins, jA: j0 + ins, iB: i0 + 1 - ins, jB: j0 + 1 - ins }} z={elev} />;
    }
    default:
      return null;
  }
}
