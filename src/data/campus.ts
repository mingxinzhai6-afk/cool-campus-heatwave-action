/**
 * 校园底图数据（原型模拟）。
 *
 * 这是一个 14×14 的等轴 2.5D 校园：教学楼、图书馆、中心广场、公寓、餐厅、
 * 田径场、校医院、附属幼儿园、后勤休息点，以及校园边缘的唐岛湾水岸。
 *
 * ⚠️ 说明：地名与建筑位置参考山东科技大学青岛校区的公开印象做了**风格化重构**，
 * 地表热指数、人数、人群构成全部是**为本作品设定的原型模拟参数**，
 * 不是实测温度、不是真实人口数据，也不代表校方任何结论。
 */
import type { GroupId } from './groups';
import type { ToolId } from './tools';

export type TileType =
  | 'tree' | 'grass' | 'garden' | 'water' | 'road' | 'plaza'
  | 'building' | 'dorm' | 'canteen' | 'sport' | 'parking';

export type ProfileId =
  | 'academic' | 'plaza' | 'dorm' | 'canteen' | 'sport'
  | 'clinic' | 'kindergarten' | 'gate' | 'green' | 'road' | 'service';

export const GRID = 18;

/** 时刻（小时）。 */
export type Hour = 8 | 12 | 14 | 18;
export const HOURS: Hour[] = [8, 12, 14, 18];
export const HOUR_LABEL: Record<Hour, string> = {
  8: '08:00 上午',
  12: '12:00 正午',
  14: '14:00 午后',
  18: '18:00 傍晚',
};
export const HOUR_SHORT: Record<Hour, string> = { 8: '上午', 12: '正午', 14: '午后', 18: '傍晚' };
/** 时刻热力系数：午后最热，上午最凉。 */
export const HOUR_MULT: Record<Hour, number> = { 8: 0.82, 12: 1.06, 14: 1.12, 18: 0.88 };

export type PopMix = Record<GroupId, number>;

export type Tile = {
  id: string;
  x: number;
  y: number;
  type: TileType;
  name: string;
  /** 建筑高度（等轴 z 单位，0 表示平地）。 */
  elev: number;
  /** 基础地表热指数（0–100，原型估算，不是摄氏度）。 */
  baseHeat: number;
  /** 峰值人数（按时刻系数缩放）。 */
  pop: number;
  profile: ProfileId;
  landmark: boolean;
  /** 是否是地图外的空缺地块；不参与热力、人群和交互。 */
  void?: boolean;
  /** 可就近取水的水源设施。 */
  waterSource?: 'pond' | 'hydrant';
  /** 关卡开局已经存在的设施。 */
  presetTool?: ToolId;
};

export type MapData = {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: Tile[];
};

/* ------------------------------------------------------------------ *
 * 1. 底图：字符网格
 *    t 林荫  g 绿地  w 水体  r 道路  p 广场  b 建筑
 *    d 公寓  c 餐厅  s 运动场
 * ------------------------------------------------------------------ */
const RAW_MAP: string[] = [
  'tttttttttttttttttt',
  'tggggggggggggggggt',
  'gbbbbgggggbbbggggg',
  'gbbbbgggggbbbggggg',
  'gbbbbggpppgggggggg',
  'rrrrrrgpppgrrrrggg',
  'gggggggpppgggggggg',
  'gbbbbgggggbbbggggg',
  'gbbbbgggggbbbggggg',
  'rrrrrrrrrrrrrrrrrr',
  'gddddggccggssggggg',
  'gddddggccggssggggg',
  'gddddggggggssggggg',
  'tttggwwwwggttggggg',
  'gggggggggggggggggg',
  'gggggggggggggggggg',
  'gggggggggggggggggg',
  'tttttttttttttttttt',
];

const CHAR_TYPE: Record<string, TileType> = {
  t: 'tree', g: 'grass', h: 'garden', w: 'water', r: 'road', p: 'plaza',
  b: 'building', d: 'dorm', c: 'canteen', s: 'sport',
};

/** 各类型默认参数（原型模拟）。 */
const TYPE_DEFAULT: Record<TileType, { heat: number; elev: number; pop: number; profile: ProfileId }> = {
  tree: { heat: 18, elev: 0, pop: 15, profile: 'green' },
  grass: { heat: 26, elev: 0, pop: 40, profile: 'green' },
  garden: { heat: 21, elev: 0, pop: 28, profile: 'green' },
  water: { heat: 16, elev: 0, pop: 12, profile: 'green' },
  road: { heat: 52, elev: 0, pop: 35, profile: 'road' },
  plaza: { heat: 62, elev: 0, pop: 300, profile: 'plaza' },
  building: { heat: 44, elev: 3, pop: 180, profile: 'academic' },
  dorm: { heat: 40, elev: 3, pop: 220, profile: 'dorm' },
  canteen: { heat: 48, elev: 2, pop: 260, profile: 'canteen' },
  sport: { heat: 58, elev: 0, pop: 200, profile: 'sport' },
  parking: { heat: 64, elev: 0, pop: 30, profile: 'gate' },
};

/** 地标覆盖：位置、名称、可选的类型 / 人群档案 / 人数 / 高度。 */
type Landmark = Partial<Pick<Tile, 'type' | 'profile' | 'pop' | 'elev' | 'baseHeat' | 'name' | 'waterSource' | 'presetTool'>> & {
  x: number;
  y: number;
  name: string;
  /** 是否在地图上显示文字标注（只在每个组团的一个锚点地块上开启，避免堆字）。 */
  label?: boolean;
};

function rect(
  x0: number, y0: number, x1: number, y1: number,
  patch: Partial<Tile> & { name: string; label?: boolean },
): Landmark[] {
  const out: Landmark[] = [];
  const count = (x1 - x0 + 1) * (y1 - y0 + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      // pop 传入的是整个组团的人数，平均分摊到组团的每一栋/每一块
      out.push({ x, y, ...patch, pop: patch.pop !== undefined ? patch.pop / count : undefined });
    }
  }
  return out;
}

const LANDMARKS: Landmark[] = [
  // —— 教学区（西北）——
  ...rect(1, 2, 4, 3, { name: '教学楼组团', profile: 'academic', pop: 2400, elev: 3 }),
  ...rect(1, 4, 4, 4, { name: '3号教学楼', profile: 'academic', pop: 1200, elev: 3 }),
  // —— 图书馆 / 校医院（东北）——
  ...rect(11, 2, 12, 3, { name: '图书馆', profile: 'academic', pop: 1600, elev: 4 }),
  ...rect(13, 2, 13, 3, { name: '校医院', type: 'building', profile: 'clinic', pop: 360, elev: 2, baseHeat: 78 }),
  // —— 科研楼 / 工程训练中心（西南中）——
  ...rect(1, 7, 2, 8, { name: '科研楼', profile: 'academic', pop: 800, elev: 4 }),
  ...rect(3, 7, 4, 8, { name: '工程训练中心', profile: 'academic', pop: 900, elev: 3 }),
  // —— 体育馆 / 大学生活动中心（东南中）——
  ...rect(10, 7, 11, 8, { name: '体育馆', profile: 'academic', pop: 900, elev: 3 }),
  ...rect(12, 7, 12, 8, { name: '大学生活动中心', profile: 'academic', pop: 500, elev: 2 }),
  // —— 中心广场 ——
  ...rect(7, 4, 9, 6, { name: '中心广场', type: 'plaza', profile: 'plaza', pop: 900, baseHeat: 68 }),
  // —— 生活区 ——
  ...rect(1, 10, 4, 12, { name: '学生公寓', profile: 'dorm', pop: 3600, elev: 3 }),
  ...rect(7, 10, 8, 11, { name: '学者餐厅', type: 'canteen', profile: 'canteen', pop: 1400, elev: 2 }),
  // —— 运动区 ——
  ...rect(11, 10, 12, 12, { name: '田径运动场', type: 'sport', profile: 'sport', pop: 800, baseHeat: 80 }),
  // —— 水岸与校门 ——
  ...rect(5, 13, 8, 13, { name: '唐岛湾 · 校缘水岸', type: 'water', profile: 'green', pop: 80 }),
  { x: 0, y: 9, name: '西门 · 外卖集散点', type: 'road', profile: 'gate', pop: 200, baseHeat: 72 },
  { x: 13, y: 9, name: '东门 · 通勤口', type: 'road', profile: 'gate', pop: 190, baseHeat: 78 },
  // —— 容易被忽略的服务点（公平议题的关键）——
  // 后勘水泥院子、无遮无荫，是校园里最容易被忽略、却最热的角落。
  //
  // 参数是反复调平衡后定下的，改动前请先看 balance.test.ts：
  //   baseHeat 72：基础热度不再被 100 上限削平，放一处遮阳棚热指数会真实下降，
  //                不会出现"放了没反应"；但单处仍差一口气，需要成片改造。
  //   pop 提到 80~200：让"脆弱群体高暴露率"在开局明显高于学生，
  //                第四关的「公平差 ≤ 10」才有真实空间（开局约 9pp，需要用改造压下去）。
  { x: 5, y: 10, name: '后勤保洁休息点', type: 'grass', profile: 'service', pop: 150, baseHeat: 72 },
  { x: 0, y: 10, name: '共享单车停放点', type: 'parking', profile: 'gate', pop: 80, baseHeat: 72 },
  { x: 0, y: 11, name: '后勤车辆停车点', type: 'parking', profile: 'service', pop: 80, baseHeat: 72 },
  { x: 5, y: 5, name: '梧桐林荫道', type: 'tree', profile: 'green', pop: 45 },
  // —— 附属幼儿园（儿童敏感点）——
  ...rect(12, 4, 13, 4, { name: '附属幼儿园', type: 'building', profile: 'kindergarten', pop: 460, elev: 1, baseHeat: 76 }),
  { x: 13, y: 7, name: '校友林', type: 'tree', profile: 'green', pop: 20, label: true },
  { x: 13, y: 8, name: '校友林', type: 'tree', profile: 'green', pop: 20 },

  // —— 东侧扩展区：艺术中心、家属生活区与滨水庭院 ——
  ...rect(14, 6, 16, 8, { name: '艺术与创新中心', profile: 'academic', pop: 720, elev: 3 }),
  ...rect(14, 10, 16, 12, { name: '家属生活区', type: 'dorm', profile: 'dorm', pop: 1800, elev: 2 }),
  ...rect(14, 14, 16, 15, { name: '滨水庭院', type: 'garden', profile: 'green', pop: 260, baseHeat: 22 }),
  ...rect(1, 14, 3, 16, { name: '北岸花园', type: 'garden', profile: 'green', pop: 420, baseHeat: 24 }),
  { x: 17, y: 9, name: '东侧服务门', type: 'road', profile: 'gate', pop: 220, baseHeat: 78 },

  // —— 文字锚点：每个组团只在地图上限一个标注，避免整张图堆满重复文字 ——
  ...([
    [8, 5], [2, 2], [11, 2], [13, 2], [1, 7], [3, 7], [10, 7], [12, 7],
    [2, 11], [7, 10], [11, 11], [6, 13], [0, 9], [13, 9], [5, 10], [0, 10],
    [0, 11], [5, 5], [12, 4], [15, 6], [15, 10], [15, 14], [2, 14], [17, 9],
  ] as [number, number][]).map(([x, y]) => ({ x, y, label: true } as Landmark)),
];

/**
 * 人群档案：峰值比例 mult、群体构成 mix、户外暴露比例 outdoor。
 *
 * outdoor 是本作品最关键的一个建模假设：**只有暴露在户外的人才会被计入热暴露**。
 * 学生在教学楼里、老人在校医院里时，屋顶再烫也不等同于他们被暴晒；
 * 而保洁、绿化、门岗、骑手几乎全天在户外，这正是他们风险更高的原因。
 */
export const PROFILES: Record<ProfileId, { mult: [number, number, number, number]; outdoor: [number, number, number, number]; mix: PopMix; tag: string }> = {
  academic: { tag: '教学科研', mult: [1.0, 0.35, 0.5, 0.5], outdoor: [0.3, 0.12, 0.15, 0.3], mix: { students: 0.95, kids: 0, elders: 0, workers: 0.05, riders: 0 } },
  plaza: { tag: '公共活动', mult: [0.5, 1.0, 0.7, 0.9], outdoor: [0.9, 1.0, 0.95, 1.0], mix: { students: 0.8, kids: 0.03, elders: 0.07, workers: 0.05, riders: 0.05 } },
  dorm: { tag: '生活起居', mult: [0.45, 0.35, 0.5, 0.9], outdoor: [0.2, 0.15, 0.2, 0.4], mix: { students: 0.93, kids: 0, elders: 0, workers: 0.07, riders: 0 } },
  canteen: { tag: '就餐', mult: [0.55, 1.0, 0.35, 1.0], outdoor: [0.4, 0.75, 0.3, 0.75], mix: { students: 0.8, kids: 0, elders: 0, workers: 0.12, riders: 0.08 } },
  sport: { tag: '运动', mult: [0.5, 0.25, 0.35, 1.0], outdoor: [0.9, 0.5, 0.6, 1.0], mix: { students: 0.9, kids: 0.03, elders: 0.02, workers: 0.05, riders: 0 } },
  clinic: { tag: '医疗', mult: [0.7, 0.8, 0.8, 0.5], outdoor: [0.4, 0.4, 0.4, 0.3], mix: { students: 0.2, kids: 0.1, elders: 0.5, workers: 0.15, riders: 0.05 } },
  kindergarten: { tag: '幼教', mult: [1.0, 0.6, 0.7, 0.05], outdoor: [0.65, 0.45, 0.45, 0.1], mix: { students: 0.05, kids: 0.7, elders: 0.05, workers: 0.2, riders: 0 } },
  gate: { tag: '通勤 / 配送', mult: [0.6, 1.0, 0.8, 0.7], outdoor: [0.9, 1.0, 1.0, 0.9], mix: { students: 0.55, kids: 0, elders: 0.05, workers: 0.1, riders: 0.3 } },
  green: { tag: '绿地游憩', mult: [0.15, 0.2, 0.2, 0.3], outdoor: [0.9, 0.9, 0.9, 0.9], mix: { students: 0.5, kids: 0.15, elders: 0.2, workers: 0.1, riders: 0.05 } },
  road: { tag: '道路通勤', mult: [0.9, 0.5, 0.5, 0.7], outdoor: [1.0, 0.9, 0.9, 1.0], mix: { students: 0.6, kids: 0.05, elders: 0.05, workers: 0.15, riders: 0.15 } },
  service: { tag: '后勤服务', mult: [0.8, 0.9, 0.9, 0.4], outdoor: [1.0, 1.0, 1.0, 1.0], mix: { students: 0.05, kids: 0, elders: 0.05, workers: 0.8, riders: 0.1 } },
};

/** 某地块在某时刻的户外暴露比例。 */
export function tileOutdoor(tile: Tile, hour: Hour): number {
  const idx = HOURS.indexOf(hour);
  return PROFILES[tile.profile].outdoor[idx] ?? 1;
}

export const TYPE_NAME: Record<TileType, string> = {
  tree: '林荫', grass: '绿地', garden: '庭院', water: '水体', road: '道路', plaza: '广场',
  building: '建筑', dorm: '公寓', canteen: '餐厅', sport: '运动场', parking: '停车点',
};

export const TYPE_TAG: Record<TileType, string> = {
  tree: '林木', grass: '绿地', garden: '庭院花园', water: '水体', road: '道路', plaza: '硬质广场',
  building: '建筑屋顶', dorm: '公寓', canteen: '餐厅', sport: '塑胶场地', parking: '停车地面',
};

/** 生成全部地块（模块加载时执行一次，纯函数）。 */
export function createTilesFromRows(rows: string[], patches: Landmark[] = []): Tile[] {
  const patchMap = new Map<string, Landmark>();
  for (const lm of patches) {
    const key = `${lm.x},${lm.y}`;
    const prev = patchMap.get(key);
    patchMap.set(key, prev ? { ...prev, ...lm } : lm);
  }
  const width = Math.min(GRID, Math.max(...rows.map((row) => row.length), 1));
  const tiles: Tile[] = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const ch = rows[y]?.[x] ?? '.';
      const patch = patchMap.get(`${x},${y}`);
      const isVoid = ch === '.' || y >= rows.length || x >= width;
      const base = CHAR_TYPE[ch] ?? 'grass';
      const type = patch?.type ?? base;
      const def = TYPE_DEFAULT[type];
      tiles.push({
        id: `t${x}-${y}`,
        x, y, type,
        name: patch?.name ?? TYPE_NAME[type],
        elev: patch?.elev ?? def.elev,
        baseHeat: patch?.baseHeat ?? def.heat,
        pop: patch?.pop ?? def.pop,
        profile: patch?.profile ?? def.profile,
        landmark: Boolean(patch?.label),
        void: isVoid,
        waterSource: patch?.waterSource,
        presetTool: patch?.presetTool,
      });
    }
  }
  return tiles;
}

export function createTiles(): Tile[] {
  return createTilesFromRows(RAW_MAP, LANDMARKS);
}

export const TILES: Tile[] = createTiles();

const L1_ROWS = [
  'tttttttttt', 'tggggggggt', 'gbbbgggbgg', 'gbbbgpppgg',
  'rrrrgpppgr', 'gggggpppgg', 'gbgggggbgg', 'gdddggcssg',
  'gdddggcssg', 'tttwwggttt',
];
const L2_ROWS = [
  'tttttttttttttttttt', 'tgggggggggggggggggt', 'gbbbbggggggggbbbgg',
  'gbbbbggggggggbbbgg', 'rrrrggppppgggggggg', 'ggggggppppgggggggg',
  'gggggggggggggggggg', 'ggggbbbbggggbbbbgg', 'ggggbbbbggggbbbbgg',
  'rrrrrrrrrrrrrrrrrr', 'gggggggggggggggggg', 'tttttttttttttttttt',
];
const L3_ROWS = [
  '....tttttttt....', '..gggggggggggg..', '.ggbbbbggggbbgg.', '.ggbbbbggggbbgg.',
  '.ggggggppppgggg.', 'rrrrrrgppppgrrrr', 'gggggggggggggggg',
  'ggbbggggggggbbgg', 'ggbbggwwwwggbbgg', 'ggggggwwwwgggggg',
  'gggggggggggggggg', 'ggggssssssssgggg', 'ggggssssssssgggg',
  '..gggggggggggg..', '...ttggggggtt...', '....tttttttt....',
];
const L5_ROWS = [
  'tttttttttttttttttt', 'tgggggggggggggggggt', 'ggggbbggggggbbgggg',
  'ggggbbggppggbbgggg', 'rrrrrrggppggrrrrgg', 'ggggggggppgggggggg',
  'gggggggggggggggggg', 'ggbbggggggggggbbgg', 'ggbbggggggggggbbgg',
  'rrrrrrrrrrrrrrrrrr', 'gggggggggggggggggg', 'ggggccggggggssgggg',
  'ggggccggggggssgggg', 'ggggggggggggssgggg', 'gggggggggggggggggg',
  'tttggggggggggggttt', 'tttggwwwwwggggtttt', 'tttttttttttttttttt',
];
/** 校园沙盒里的人为硬质铺装：这些地块本身就更热，用来体现“可改造空间”。 */
const L5_HOT: Landmark[] = [
  ...rect(7, 4, 11, 6, { name: '中央硬质广场', type: 'plaza', profile: 'plaza', pop: 900, baseHeat: 74, label: true }),
  ...rect(12, 11, 14, 13, { name: '运动硬地', type: 'sport', profile: 'sport', pop: 900, baseHeat: 80 }),
];

const L1_PATCHES: Landmark[] = [
  ...rect(5, 3, 7, 5, { name: '潮汐广场', type: 'plaza', profile: 'plaza', pop: 780, baseHeat: 74, label: true }),
  { x: 6, y: 2, name: '图书馆', type: 'building', profile: 'academic', pop: 960, elev: 4, label: true },
  { x: 0, y: 4, name: '西侧消防栓', type: 'road', profile: 'service', pop: 20, waterSource: 'hydrant', label: true },
  { x: 3, y: 9, name: '雨水池', type: 'water', profile: 'green', pop: 20, waterSource: 'pond', label: true },
  { x: 2, y: 7, name: '入口树阵', type: 'tree', profile: 'green', pop: 30, presetTool: 'tree' },
];
const L2_PATCHES: Landmark[] = [
  { x: 13, y: 2, name: '图书馆', type: 'building', profile: 'academic', pop: 1400, elev: 4, label: true },
  ...rect(7, 4, 9, 5, { name: '雾港广场', type: 'plaza', profile: 'plaza', pop: 900, baseHeat: 74, label: true }),
  ...rect(6, 4, 6, 5, { name: '西侧硬质广场', type: 'plaza', profile: 'plaza', pop: 700, baseHeat: 72 }),
  { x: 2, y: 9, name: '西侧消防栓', type: 'road', profile: 'service', pop: 20, waterSource: 'hydrant', label: true },
  { x: 16, y: 9, name: '东侧消防栓', type: 'road', profile: 'service', pop: 20, waterSource: 'hydrant', label: true },
  { x: 8, y: 5, name: '喷泉庭院', type: 'plaza', profile: 'plaza', pop: 120, presetTool: 'water' },
];
const L3_PATCHES: Landmark[] = [
  { x: 5, y: 4, name: '林间阅览馆', type: 'building', profile: 'academic', pop: 780, elev: 3, label: true },
  { x: 8, y: 8, name: '镜面水庭', type: 'water', profile: 'green', pop: 80, waterSource: 'pond', label: true },
  { x: 0, y: 5, name: '北侧消防栓', type: 'road', profile: 'service', pop: 20, waterSource: 'hydrant', label: true },
  ...rect(10, 11, 12, 12, { name: '运动看台', type: 'sport', profile: 'sport', pop: 900, baseHeat: 82, label: true }),
  { x: 6, y: 6, name: '初始树荫', type: 'grass', profile: 'green', pop: 30, presetTool: 'tree' },
];
const L4_PATCHES: Landmark[] = [
  { x: 10, y: 1, name: '图书馆', type: 'building', profile: 'academic', pop: 1400, elev: 4, label: true },
  { x: 8, y: 5, name: '中心广场', type: 'plaza', profile: 'plaza', pop: 900, baseHeat: 68, label: true },
  { x: 4, y: 9, name: '后勤消防栓', type: 'road', profile: 'service', pop: 20, waterSource: 'hydrant', label: true },
  { x: 6, y: 13, name: '唐岛湾水岸', type: 'water', profile: 'green', pop: 80, waterSource: 'pond', label: true },
  { x: 5, y: 5, name: '既有树阵', type: 'grass', profile: 'green', pop: 50, presetTool: 'tree' },
];
const L5_PATCHES: Landmark[] = [
  ...L5_HOT,
  { x: 4, y: 11, name: '生活服务中心', type: 'canteen', profile: 'canteen', pop: 1100, elev: 2, label: true },
  { x: 13, y: 11, name: '体育馆', type: 'building', profile: 'sport', pop: 900, elev: 3 },
  { x: 2, y: 9, name: '西侧消防栓', type: 'road', profile: 'service', pop: 20, waterSource: 'hydrant', label: true },
  { x: 6, y: 16, name: '雨水花园', type: 'water', profile: 'green', pop: 80, waterSource: 'pond', label: true },
  { x: 8, y: 3, name: '中央庭院喷泉', type: 'plaza', profile: 'plaza', pop: 80, presetTool: 'water' },
];

const MAPS: Record<string, MapData> = {
  l1: { id: 'l1', name: '潮汐入口', width: 10, height: 10, tiles: createTilesFromRows(L1_ROWS, L1_PATCHES) },
  l2: { id: 'l2', name: '双岸长廊', width: 18, height: 12, tiles: createTilesFromRows(L2_ROWS, L2_PATCHES) },
  l3: { id: 'l3', name: '环湖运动岛', width: 16, height: 16, tiles: createTilesFromRows(L3_ROWS, L3_PATCHES) },
  l4: { id: 'l4', name: '旧校区组团', width: 18, height: 18, tiles: createTilesFromRows(RAW_MAP, [...LANDMARKS, ...L4_PATCHES]) },
  l5: { id: 'l5', name: '自由滨水城', width: 18, height: 18, tiles: createTilesFromRows(L5_ROWS, L5_PATCHES) },
};

export function getMap(levelId: string): MapData {
  return MAPS[levelId] ?? MAPS.l4;
}

export function tileAtFor(levelId: string, x: number, y: number): Tile | undefined {
  const map = getMap(levelId);
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return undefined;
  const tile = map.tiles[y * GRID + x];
  return tile && !tile.void ? tile : undefined;
}


export function tileAt(x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return undefined;
  return TILES[y * GRID + x];
}

/** 依据时刻计算某地块的人数（按档案曲线缩放）。 */
export function tilePopulation(tile: Tile, hour: Hour): number {
  const idx = HOURS.indexOf(hour);
  const m = PROFILES[tile.profile].mult[idx] ?? 0.5;
  return Math.round(tile.pop * m);
}

/** 依据时刻计算某地块各群体人数。 */
export function tileGroups(tile: Tile, hour: Hour): PopMix {
  const total = tilePopulation(tile, hour);
  const mix = PROFILES[tile.profile].mix;
  const out = {} as PopMix;
  (Object.keys(mix) as GroupId[]).forEach((g) => {
    out[g] = total * mix[g];
  });
  return out;
}
