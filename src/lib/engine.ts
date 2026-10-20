/**
 * 规则引擎（纯函数）。
 *
 * 全部核心计算都集中在这里，与 React 解耦，可单独用 vitest 测试、也可在答辩时逐条讲清：
 *   1. computeFields   —— 每个改造对周边地块的遮阴 / 蒸散 / 舒适度贡献（按距离衰减）
 *   2. heatField       —— 某时刻的地表热指数场（原型估算，非实测温度）
 *   3. populationField —— 某时刻各群体在地块上的分布
 *   4. computeMetrics  —— 热暴露、脆弱群体暴露、公平指数、遮阴覆盖、舒适度、预算
 *   5. evaluate        —— 目标达成与星级
 *
 * ⚠️ 所有参数都是为本作品设定的模拟规则，不是城市气候模型，也不是真实测量结果。
 */
import {
  GRID, HOUR_MULT, HOURS, PROFILES, getMap, tileAtFor, tileGroups, tileOutdoor, tilePopulation,
  type Hour, type PopMix, type Tile,
} from '../data/campus';
import {
  DANGER_HEAT, GROUPS, GROUP_ORDER, HIGH_HEAT, VULNERABLE_GROUPS, type GroupId,
} from '../data/groups';
import {
  COMFORT_CAP, EVAP_CAP, SHADE_CAP, TOOLS, falloff, type ToolId,
} from '../data/tools';
import {
  WEATHER, getLevel, lastHour,
  type EventEffect, type Goal, type Level, type LevelEvent, type WeatherId,
} from '../data/levels';

export type Placement = {
  id: number;
  toolId: ToolId;
  x: number;
  y: number;
  /** 放置时所处的回合（用于每回合行动点统计）。 */
  round: number;
  /** 是否为关卡开局已有设施，不能拆除且不占预算。 */
  fixed?: boolean;
};

export type LogKind = 'place' | 'remove' | 'event' | 'choice' | 'system' | 'undo';
export type LogEntry = { id: number; round: number; kind: LogKind; text: string; icon: string };

export type GameState = {
  levelId: string;
  /** 当前回合下标（对应 level.hours）。 */
  round: number;
  placements: Placement[];
  /** 事件带来的支持度修正。 */
  supportMods: number;
  weather: WeatherId;
  /** 事件带来的全局热指数修正。 */
  heatDelta: number;
  disabledTools: ToolId[];
  /** 是否开放图书馆纳凉点。 */
  refuge: boolean;
  /** 图书馆实际开放的时段。 */
  refugeHours: Hour[];
  /** 已消耗的非就近取水量。 */
  waterUsed: number;
  resolvedEvents: string[];
  pendingEvent: LevelEvent | null;
  finished: boolean;
  log: LogEntry[];
  seq: number;
  past: Snapshot[];
};

type Snapshot = {
  placements: Placement[];
  supportMods: number;
  weather: WeatherId;
  heatDelta: number;
  disabledTools: ToolId[];
  refuge: boolean;
  refugeHours: Hour[];
  waterUsed: number;
  /* 下面几项让「推进时间 / 事件选择 / 重做本关」等操作也能整步撤销 */
  round: number;
  finished: boolean;
  resolvedEvents: string[];
  pendingEvent: GameState['pendingEvent'];
};

const BASE_SUPPORT = 60;

/** 舒适度指数放大系数：把人均舒适度贡献映射到 0–100 的可读区间。 */
const COMFORT_SCALE = 7;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/* ------------------------------------------------------------------ *
 * 派生量
 * ------------------------------------------------------------------ */
export function budgetSpent(state: GameState): number {
  return state.placements.reduce((sum, p) => sum + (p.fixed ? 0 : TOOLS[p.toolId].cost), 0);
}

export function waterLeft(state: GameState): number {
  return Math.max(0, getLevel(state.levelId).waterSupply - state.waterUsed);
}

function hasNearbyWater(levelId: string, x: number, y: number): boolean {
  return getMap(levelId).tiles.some((tile) => !tile.void && tile.waterSource && Math.max(Math.abs(tile.x - x), Math.abs(tile.y - y)) <= 1);
}

function waterCost(state: GameState, toolId: ToolId, x: number, y: number): number {
  const use = TOOLS[toolId].waterUse;
  return use > 0 && !hasNearbyWater(state.levelId, x, y) ? use : 0;
}

export function budgetLeft(state: GameState): number {
  return getLevel(state.levelId).budget - budgetSpent(state);
}

export function support(state: GameState): number {
  const placed = state.placements.reduce((sum, p) => sum + TOOLS[p.toolId].support, 0);
  return Math.round(clamp(BASE_SUPPORT + placed + state.supportMods, 0, 100));
}

export function currentHour(state: GameState): Hour {
  const level = getLevel(state.levelId);
  return level.hours[Math.min(state.round, level.hours.length - 1)];
}

export function isUnlocked(state: GameState, toolId: ToolId): boolean {
  const level = getLevel(state.levelId);
  return level.unlock.includes(toolId) && !state.disabledTools.includes(toolId);
}

/* ------------------------------------------------------------------ *
 * 1. 改造影响场
 * ------------------------------------------------------------------ */
export type Fields = { shade: Float64Array; evap: Float64Array; comfort: Float64Array; drain: Float64Array };

export function computeFields(state: Pick<GameState, 'placements' | 'refuge'> & Partial<Pick<GameState, 'levelId' | 'refugeHours'>>, hour?: Hour): Fields {
  const map = getMap(state.levelId ?? 'l4');
  const shade = new Float64Array(GRID * GRID);
  const evap = new Float64Array(GRID * GRID);
  const comfort = new Float64Array(GRID * GRID);
  const drain = new Float64Array(GRID * GRID);

  for (const p of state.placements) {
    const tool = TOOLS[p.toolId];
    const minX = Math.max(0, Math.floor(p.x - tool.radius));
    const maxX = Math.min(GRID - 1, Math.ceil(p.x + tool.radius));
    const minY = Math.max(0, Math.floor(p.y - tool.radius));
    const maxY = Math.min(GRID - 1, Math.ceil(p.y + tool.radius));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const tile = map.tiles[y * GRID + x];
        if (!tile || tile.void) continue;
        const w = falloff(Math.hypot(x - p.x, y - p.y), tool.radius);
        if (w <= 0) continue;
        const i = y * GRID + x;
        shade[i] += tool.shade * w;
        evap[i] += tool.evap * w;
        comfort[i] += tool.comfort * w;
        drain[i] += tool.drain * w;
      }
    }
  }

  // 图书馆纳凉点由场馆自己的开放时段控制，不再依赖推进末尾的事件选择。
  const refugeOpen = state.refuge && (!hour || !state.refugeHours || state.refugeHours.length === 0 || state.refugeHours.includes(hour));
  if (refugeOpen) {
    for (const tile of map.tiles) {
      if (tile.void || !tile.name.includes('图书馆') && !tile.name.includes('阅览馆')) continue;
      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const w = falloff(Math.hypot(x - tile.x, y - tile.y), 2.2);
          if (w <= 0) continue;
          const i = y * GRID + x;
          shade[i] += 6 * w;
          comfort[i] += 20 * w;
        }
      }
    }
  }

  for (let i = 0; i < shade.length; i++) {
    shade[i] = Math.min(shade[i], SHADE_CAP);
    evap[i] = Math.min(evap[i], EVAP_CAP);
    comfort[i] = Math.min(comfort[i], COMFORT_CAP);
  }
  return { shade, evap, comfort, drain };
}

/* ------------------------------------------------------------------ *
 * 2. 热指数场
 * ------------------------------------------------------------------ */
/**
 * 热指数上限。
 *
 * 注意这里是 105 而不是 100：此前压到 100 时，第四关那批"基础热度就很高"的地块
 * （后勤休息点、外卖集散点、单车点等）会在 时刻系数 × 天气系数 之后全部被顶到同一个数，
 * 地块之间失去区分度，玩家会看到"放了遮阳棚、热指数确实降了 20 多度，却仍然高于
 * 高暴露阈值 72，人数一个都没减少"，于是以为改造没生效。
 * 放宽到 105 让这些点保留各自的真实热度落差，一次改造就能把它们拉回阈值以下。
 * UI 侧的显示数值与配色仍按 100 封顶，观感不变。
 */
const HEAT_MAX = 105;

export function heatField(state: GameState, hour: Hour): Float64Array {
  const fields = computeFields(state, hour);
  const weather = WEATHER[state.weather];
  const map = getMap(state.levelId);
  const out = new Float64Array(GRID * GRID);
  for (let i = 0; i < out.length; i++) {
    const tile = map.tiles[i];
    if (!tile || tile.void) continue;
    const base = tile.baseHeat * HOUR_MULT[hour] * weather.mult + state.heatDelta;
    out[i] = clamp(base - fields.shade[i] - fields.evap[i], 12, HEAT_MAX);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 3. 人群场
 * ------------------------------------------------------------------ */
export type PopulationField = {
  /** 地块上的总人数（所有人，含室内）。 */
  total: Float64Array;
  /** 暴露在户外的人数（本作品的暴露口径）。 */
  outdoor: Float64Array;
  byGroup: Record<GroupId, Float64Array>;
  /** 各群体暴露在户外的人数。 */
  byGroupOutdoor: Record<GroupId, Float64Array>;
};

export function populationField(hour: Hour, levelId = 'l4'): PopulationField {
  const map = getMap(levelId);
  const total = new Float64Array(GRID * GRID);
  const outdoor = new Float64Array(GRID * GRID);
  const byGroup = {
    students: new Float64Array(GRID * GRID),
    kids: new Float64Array(GRID * GRID),
    elders: new Float64Array(GRID * GRID),
    workers: new Float64Array(GRID * GRID),
    riders: new Float64Array(GRID * GRID),
  } as Record<GroupId, Float64Array>;
  const byGroupOutdoor = {
    students: new Float64Array(GRID * GRID),
    kids: new Float64Array(GRID * GRID),
    elders: new Float64Array(GRID * GRID),
    workers: new Float64Array(GRID * GRID),
    riders: new Float64Array(GRID * GRID),
  } as Record<GroupId, Float64Array>;

  for (let i = 0; i < map.tiles.length; i++) {
    const tile = map.tiles[i];
    if (!tile || tile.void) continue;
    const p = tilePopulation(tile, hour);
    const of = tileOutdoor(tile, hour);
    total[i] = p;
    outdoor[i] = p * of;
    const groups = tileGroups(tile, hour);
    for (const g of GROUP_ORDER) {
      byGroup[g][i] = groups[g];
      byGroupOutdoor[g][i] = groups[g] * of;
    }
  }
  return { total, outdoor, byGroup, byGroupOutdoor };
}

/* ------------------------------------------------------------------ *
 * 4. 指标
 * ------------------------------------------------------------------ */
export type Metrics = {
  hour: Hour;
  avgHeat: number;
  popExposed: number;
  dangerPop: number;
  vulnExposed: number;
  vulnAvgHeat: number;
  studentAvgHeat: number;
  /** 脆弱群体高暴露率（%）。 */
  vulnExposedRate: number;
  /** 学生高暴露率（%）。 */
  studentExposedRate: number;
  /** 公平差 = 脆弱群体高暴露率 − 学生高暴露率（百分点）。 */
  equityGap: number;
  shadeCoverage: number;
  comfort: number;
  budgetSpent: number;
  budgetLeft: number;
  groupAvgHeat: Record<GroupId, number>;
  hottest: { tileId: string; name: string; heat: number; pop: number }[];
  /** 校园总人数（含室内）。 */
  totalPop: number;
  /** 暴露在户外的人数。 */
  outdoorPop: number;
  /** 脆弱群体暴露在户外的人数。 */
  vulnOutdoorPop: number;
};

export function computeMetrics(state: GameState, hour: Hour): Metrics {
  const heat = heatField(state, hour);
  const pop = populationField(hour, state.levelId);
  const fields = computeFields(state, hour);

  let outdoorSum = 0;
  let heatOutdoorSum = 0;
  let popSum = 0;
  let popExposed = 0;
  let dangerPop = 0;
  let shadePop = 0;
  let comfortPopSum = 0;

  for (let i = 0; i < heat.length; i++) {
    const h = heat[i];
    const o = pop.outdoor[i];
    popSum += pop.total[i];
    outdoorSum += o;
    heatOutdoorSum += h * o;
    if (h >= HIGH_HEAT) popExposed += o;
    if (h >= DANGER_HEAT) dangerPop += o;
    if (fields.shade[i] >= 3) shadePop += o;
    comfortPopSum += Math.min(100, fields.comfort[i]) * o;
  }

  const groupAvgHeat = {} as Record<GroupId, number>;
  const groupOutdoorPop = {} as Record<GroupId, number>;
  const groupExposed = {} as Record<GroupId, number>;
  let vulnWeightedSum = 0;
  let vulnWeightedCount = 0;
  let vulnExposed = 0;
  let vulnOutdoorPop = 0;

  for (const g of GROUP_ORDER) {
    let gOutdoor = 0;
    let gHeat = 0;
    let gExposed = 0;
    const weight = VULNERABLE_GROUPS.includes(g) ? GROUPS[g].vuln : 0;
    for (let i = 0; i < heat.length; i++) {
      const go = pop.byGroupOutdoor[g][i];
      gOutdoor += go;
      gHeat += heat[i] * go;
      if (heat[i] >= HIGH_HEAT) gExposed += go;
      if (weight > 0) {
        vulnWeightedSum += heat[i] * go * weight;
        vulnWeightedCount += go * weight;
      }
    }
    groupAvgHeat[g] = gOutdoor > 0 ? gHeat / gOutdoor : 0;
    groupOutdoorPop[g] = gOutdoor;
    groupExposed[g] = gExposed;
    if (weight > 0) {
      vulnExposed += gExposed;
      vulnOutdoorPop += gOutdoor;
    }
  }

  const vulnAvgHeat = vulnWeightedCount > 0 ? vulnWeightedSum / vulnWeightedCount : 0;
  const vulnExposedRate = vulnOutdoorPop > 0 ? (vulnExposed / vulnOutdoorPop) * 100 : 0;
  const studentExposedRate = groupOutdoorPop.students > 0
    ? (groupExposed.students / groupOutdoorPop.students) * 100
    : 0;

  const map = getMap(state.levelId);
  const hottest = map.tiles.filter((tile) => !tile.void).map((tile) => ({ tile, i: tile.y * GRID + tile.x }))
    .map(({ tile, i }) => ({ tileId: tile.id, name: tile.name, heat: heat[i], pop: pop.outdoor[i] }))
    .sort((a, b) => b.heat - a.heat || b.pop - a.pop)
    .slice(0, 6);

  return {
    hour,
    avgHeat: outdoorSum > 0 ? heatOutdoorSum / outdoorSum : 0,
    popExposed: Math.round(popExposed),
    dangerPop: Math.round(dangerPop),
    vulnExposed: Math.round(vulnExposed),
    vulnAvgHeat,
    studentAvgHeat: groupAvgHeat.students,
    vulnExposedRate,
    studentExposedRate,
    equityGap: vulnExposedRate - studentExposedRate,
    shadeCoverage: outdoorSum > 0 ? (shadePop / outdoorSum) * 100 : 0,
    comfort: outdoorSum > 0 ? Math.min(100, (comfortPopSum / outdoorSum) * COMFORT_SCALE) : 0,
    budgetSpent: budgetSpent(state),
    budgetLeft: budgetLeft(state),
    groupAvgHeat,
    hottest,
    totalPop: Math.round(popSum),
    outdoorPop: Math.round(outdoorSum),
    vulnOutdoorPop: Math.round(vulnOutdoorPop),
  };
}

/* ------------------------------------------------------------------ *
 * 5. 操作合法性
 * ------------------------------------------------------------------ */
const GROUND_TYPES = new Set(['grass', 'garden', 'tree', 'road', 'plaza', 'sport', 'parking']);
const BUILDING_TYPES = new Set(['building', 'dorm', 'canteen']);

export type PlaceCheck = { ok: boolean; reason?: string };

export function canPlace(state: GameState, toolId: ToolId, x: number, y: number): PlaceCheck {
  if (state.finished) return { ok: false, reason: '本轮推演已结束' };
  if (state.pendingEvent) return { ok: false, reason: '先处理当前事件' };
  const tile = tileAtFor(state.levelId, x, y);
  if (!tile) return { ok: false, reason: '超出校园范围' };
  if (!isUnlocked(state, toolId)) return { ok: false, reason: '该工具尚未解锁' };
  if (state.placements.some((p) => p.x === x && p.y === y)) return { ok: false, reason: '该地块已经改造过' };
  const tool = TOOLS[toolId];
  if (tool.target === 'building' && !BUILDING_TYPES.has(tile.type)) {
    return { ok: false, reason: '只能放在建筑屋顶' };
  }
  if (tool.target === 'ground' && !GROUND_TYPES.has(tile.type)) {
    return { ok: false, reason: '不能放在建筑或水面上' };
  }
  if (budgetLeft(state) < tool.cost) return { ok: false, reason: '预算不足' };
  const requiredWater = waterCost(state, toolId, x, y);
  if (waterLeft(state) < requiredWater) return { ok: false, reason: `水源不足（还需要 ${requiredWater.toFixed(1)} 单位）` };
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * 6. 状态变更
 * ------------------------------------------------------------------ */
export function createState(levelId: string): GameState {
  const level = getLevel(levelId);
  return {
    levelId: level.id,
    round: 0,
    placements: getMap(level.id).tiles.filter((tile) => tile.presetTool && !tile.void).map((tile, index) => ({
      id: index + 1, toolId: tile.presetTool!, x: tile.x, y: tile.y, round: 0, fixed: true,
    })),
    supportMods: 0,
    weather: level.startWeather,
    heatDelta: 0,
    disabledTools: [],
    refuge: false,
    refugeHours: [],
    waterUsed: 0,
    resolvedEvents: [],
    pendingEvent: null,
    finished: false,
    log: [
      { id: 1, round: 0, kind: 'system', icon: '🚩', text: `任务开始：${level.name}｜预算 ${level.budget} 万，可以随时放置改造` },
    ],
    seq: 1,
    past: [],
  };
}

function snapshot(state: GameState): Snapshot {
  return {
    placements: state.placements.map((p) => ({ ...p })),
    supportMods: state.supportMods,
    weather: state.weather,
    heatDelta: state.heatDelta,
    disabledTools: [...state.disabledTools],
    refuge: state.refuge,
    refugeHours: [...state.refugeHours],
    waterUsed: state.waterUsed,
    round: state.round,
    finished: state.finished,
    resolvedEvents: [...state.resolvedEvents],
    pendingEvent: state.pendingEvent,
  };
}

/** 记一条历史（撤销用），最多保留最近 60 步。 */
function withHistory(state: GameState, prev: GameState): GameState {
  return { ...state, past: [...prev.past, snapshot(prev)].slice(-60) };
}

function pushLog(state: GameState, kind: LogKind, text: string, icon: string): GameState {
  const id = state.seq + 1;
  const log = [...state.log, { id, round: state.round, kind, icon, text }].slice(-80);
  return { ...state, seq: id, log };
}

/** 纯放置（不记撤销历史）：供内部搜索/评估候选点复用，试算不产生副作用。 */
function placeCore(state: GameState, toolId: ToolId, x: number, y: number): GameState {
  const check = canPlace(state, toolId, x, y);
  if (!check.ok) return state;
  const tool = TOOLS[toolId];
  const requiredWater = waterCost(state, toolId, x, y);
  const next: GameState = {
    ...state,
    waterUsed: state.waterUsed + requiredWater,
    placements: [...state.placements, { id: state.seq + 1, toolId, x, y, round: state.round }],
  };
  return pushLog(next, 'place', `在「${tileAtFor(state.levelId, x, y)?.name ?? '地块'}」建成${tool.name}（造价 ${tool.cost} 万）`, '🏗');
}

export function place(state: GameState, toolId: ToolId, x: number, y: number): GameState {
  const next = placeCore(state, toolId, x, y);
  return next === state ? state : withHistory(next, state);
}

export function removeAt(state: GameState, x: number, y: number): GameState {
  const target = state.placements.find((p) => p.x === x && p.y === y);
  if (!target) return state;
  if (target.fixed) return state;
  const tool = TOOLS[target.toolId];
  const returnedWater = waterCost(state, target.toolId, x, y);
  const next: GameState = {
    ...state,
    waterUsed: Math.max(0, state.waterUsed - returnedWater),
    placements: state.placements.filter((p) => p !== target),
  };
  return withHistory(pushLog(next, 'remove', `拆除「${tileAtFor(state.levelId, x, y)?.name ?? '地块'}」的${tool.name}，退回 ${tool.cost} 万预算`, '🧹'), state);
}

export function configureRefuge(state: GameState, hours: Hour[]): GameState {
  const selected = [...new Set(hours)].sort((a, b) => a - b);
  const next: GameState = {
    ...state,
    refuge: selected.length > 0,
    refugeHours: selected,
  };
  return withHistory(pushLog(next, 'system', `纳凉场馆开放时段：${selected.map((hour) => `${hour}:00`).join('、') || '未安排'}`, '📚'), state);
}

export function undo(state: GameState): GameState {
  const prev = state.past[state.past.length - 1];
  if (!prev) return state;
  const next: GameState = {
    ...state,
    ...prev,
    placements: prev.placements.map((p) => ({ ...p })),
    disabledTools: [...prev.disabledTools],
    refugeHours: [...prev.refugeHours],
    resolvedEvents: [...prev.resolvedEvents],
    past: state.past.slice(0, -1),
  };
  return pushLog(next, 'undo', '撤销上一步操作', '↩');
}

function applyEffect(state: GameState, effect: EventEffect | undefined, title: string, icon: string): GameState {
  if (!effect) return pushLog(state, 'event', title, icon);
  let next = state;
  if (effect.weather) next = { ...next, weather: effect.weather };
  if (typeof effect.support === 'number') next = { ...next, supportMods: next.supportMods + effect.support };
  if (typeof effect.heatDelta === 'number') next = { ...next, heatDelta: next.heatDelta + effect.heatDelta };
  if (effect.disableTools) next = { ...next, disabledTools: Array.from(new Set([...next.disabledTools, ...effect.disableTools])) };
  if (effect.refuge) next = { ...next, refuge: true, refugeHours: getLevel(state.levelId).hours };
  const detail = effect.note ? `｜${effect.note}` : '';
  return pushLog(next, 'event', `${title}${detail}`, icon);
}

function nextRound(state: GameState): GameState {
  const level = getLevel(state.levelId);
  const next = state.round + 1;
  if (next >= level.hours.length) {
    return pushLog({ ...state, finished: true }, 'system', '推演结束，正在生成评估…', '📊');
  }
  return pushLog({ ...state, round: next }, 'system', `推进到 ${level.hours[next]}:00，人群与热力分布发生变化`, '⏱');
}

export function advance(state: GameState): GameState {
  if (state.finished || state.pendingEvent) return state;
  const base = withHistory(state, state);   // 留一步历史：推进（含随之触发的事件效果）也能一键撤销
  const level = getLevel(base.levelId);
  const ev = level.events.find((e) => e.atRound === base.round && !base.resolvedEvents.includes(e.id));
  let s = base;
  if (ev) {
    if (ev.kind === 'choice') {
      return pushLog({ ...s, pendingEvent: ev }, 'event', `事件：${ev.title}`, ev.icon);
    }
    s = applyEffect(s, ev.effect, ev.title, ev.icon);
    s = { ...s, resolvedEvents: [...s.resolvedEvents, ev.id] };
  }
  return nextRound(s);
}

export function resolveChoice(state: GameState, optionId: string): GameState {
  const ev = state.pendingEvent;
  if (!ev || ev.kind !== 'choice') return state;
  const opt = ev.choices.find((c) => c.id === optionId);
  if (!opt) return state;
  const base = withHistory(state, state);   // 留一步历史：事件选择可以一键撤回、重新选
  let s = applyEffect(base, opt.effect, `${ev.title} → ${opt.label}`, ev.icon);
  s = { ...s, resolvedEvents: [...s.resolvedEvents, ev.id], pendingEvent: null };
  return nextRound(s);
}

/**
 * 重做本关：地图回到开局——清空玩家放置的全部改造（关卡自带的设施保留），
 * 预算、时刻与天气一并复位；但**决策记录不清除**，旧记录保留并追加一条重做说明。
 */
export function resumeLevel(state: GameState): GameState {
  if (!state.finished) return state;
  const fresh = createState(state.levelId);
  return withHistory(
    {
      ...fresh,
      log: [
        ...state.log,
        { id: state.seq + 1, round: state.round, kind: 'system' as const, icon: '↩', text: '重做本关：地图上的改造已清空，决策记录保留' },
      ],
      seq: state.seq + 1,
    },
    state,
  );
}

/**
 * 一键自动布置：以「直接达成关卡验收目标」为第一优先的贪心搜索。
 * 每一步在候选点位里挑“目标整体完成度提升最大”的一次改造；全部目标达成即停手（不浪费预算）。
 * 评分在「预演态」上进行：把还没发生的天气类事件（如“预警升级 全局热指数 +5”）提前算进来，
 * 两难选择取最不利的一档——保证方案在推进过程中被事件削一波之后依然达标。
 * 候选点位来自三类情报的并集：又热又有人（通用）+ 脆弱群体集中且仍热（公平差）+ 高人流无遮阴（遮阴覆盖）。
 * 没有验收目标的沙盒关卡退回“改善效果 ÷ 造价”的通用贪心。
 */
export function autoPlan(state: GameState, hour: Hour, maxSteps = 24): GameState {
  const level = getLevel(state.levelId);
  let s = state;
  let count = 0;
  for (let i = 0; i < maxSteps; i++) {
    const step = level.goals.length > 0 ? bestGoalStep(s, level) : bestGainStep(s, hour);
    if (!step) break;
    const next = placeCore(s, step.toolId, step.x, step.y);
    if (next === s) break;
    s = next;
    count += 1;
  }
  if (count === 0) return state;
  const allMet = level.goals.length > 0 && evaluate(projectUpcoming(s, level)).results.every((r) => r.ok);
  // 整批布置只记一条历史：一次「撤销」就能把整套方案收回去
  return withHistory(pushLog(s, 'system', allMet
    ? `一键自动布置完成：${count} 处改造，全部验收目标已达成`
    : `一键自动布置完成：${count} 处改造`, '🤖'), state);
}

/** 预演：把关卡里“还没发生”的事件效果提前叠加到状态上（只看天气/热力/禁用类硬效果，两难选择取最热的一档做保守估计）。 */
function projectUpcoming(state: GameState, level: Level): GameState {
  let heatDelta = state.heatDelta;
  let weather = state.weather;
  let disabledTools = state.disabledTools;
  let refuge = state.refuge;
  for (const ev of level.events) {
    if (ev.atRound < state.round || state.resolvedEvents.includes(ev.id)) continue;
    const effects = (ev.kind === 'choice' ? ev.choices.map((c) => c.effect) : [ev.effect])
      .filter((e): e is EventEffect => Boolean(e));
    let worst: EventEffect | null = null;
    for (const e of effects) {
      if (!worst || (e.heatDelta ?? 0) > (worst.heatDelta ?? 0)) worst = e;
    }
    if (!worst) continue;
    heatDelta += worst.heatDelta ?? 0;
    if (worst.weather) weather = worst.weather;
    if (worst.disableTools) disabledTools = Array.from(new Set([...disabledTools, ...worst.disableTools]));
    if (worst.refuge) refuge = true;
  }
  return { ...state, heatDelta, weather, disabledTools, refuge };
}

/** 通用贪心（沙盒用）：沿参谋建议反复挑性价比最高的一处，直到预算用尽或没有更优选项。 */
function bestGainStep(state: GameState, hour: Hour): { toolId: ToolId; x: number; y: number } | null {
  const tips = advise(state, hour);
  const pick = tips.find((t) => canPlace(state, t.toolId, t.x, t.y).ok && budgetLeft(state) >= TOOLS[t.toolId].cost);
  return pick ? { toolId: pick.toolId, x: pick.x, y: pick.y } : null;
}

/** 目标感知的一步：在候选点位上找让目标完成度上升最多的一次改造（全部评分基于预演态）。 */
function bestGoalStep(state: GameState, level: Level): { toolId: ToolId; x: number; y: number } | null {
  const proj = projectUpcoming(state, level);
  if (evaluate(proj).results.every((r) => r.ok)) return null;   // 事件之后依然全部达成 → 停手
  const base = goalProgress(proj, level);
  let best: { toolId: ToolId; x: number; y: number } | null = null;
  let bestScore = base + 1e-6;
  for (const spot of goalCandidates(proj, level)) {
    for (const toolId of Object.keys(TOOLS) as ToolId[]) {
      if (!isUnlocked(state, toolId)) continue;
      if (budgetLeft(state) < TOOLS[toolId].cost) continue;
      if (!canPlace(state, toolId, spot.x, spot.y).ok) continue;
      const after = placeCore(state, toolId, spot.x, spot.y);
      const score = goalProgress(projectUpcoming(after, level), level) - TOOLS[toolId].cost * 0.002;   // 同分优先便宜的
      if (score > bestScore) { bestScore = score; best = { toolId, x: spot.x, y: spot.y }; }
    }
  }
  return best;
}

/** 单个目标是否已达成。 */
function goalMet(state: GameState, goal: Goal, fallback: Hour): boolean {
  const m = computeMetrics(state, goal.atHour ?? fallback);
  const v = metricValue(m, goal.metric);
  return goal.op === '<=' ? v <= goal.value : v >= goal.value;
}

/** 目标完成度（0 到满分）：每个目标按“离达成还有多远”折算到 0–1，再按分值加权求和，作为连续优化的地形。 */
function goalProgress(state: GameState, level: Level): number {
  const fallback = lastHour(level);
  const cache = new Map<Hour, Metrics>();
  let total = 0;
  for (const goal of level.goals) {
    const h = goal.atHour ?? fallback;
    let m = cache.get(h);
    if (!m) { m = computeMetrics(state, h); cache.set(h, m); }
    const v = metricValue(m, goal.metric);
    const p = goal.op === '>='
      ? (goal.value > 0 ? Math.min(1, v / goal.value) : v >= goal.value ? 1 : 0)
      : (goal.value > 0 ? Math.min(1, goal.value / Math.max(v, 1e-6)) : v <= goal.value ? 1 : 0);
    total += p * goal.points;
  }
  return total;
}

/** 候选点位：又热又有人 + 脆弱群体集中且仍热 + 高人流无遮阴，三路并集去重。
 *  统一按「第一个未达成目标的验收时刻」取人群与热力——不用关卡最后一档，
 *  因为验收时刻未必是最后一档（例如第 2 关验收在 14:00，但还能推到更晚）。 */
function goalCandidates(state: GameState, level: Level): { x: number; y: number }[] {
  const fallback = lastHour(level);
  const focus = level.goals.find((g) => !goalMet(state, g, fallback));
  const hour = focus?.atHour ?? level.goals[0]?.atHour ?? fallback;
  const map = getMap(level.id);
  const pop = populationField(hour, level.id);
  const heat = heatField(state, hour);
  const fields = computeFields(state, hour);

  const hotPop: { x: number; y: number; score: number }[] = [];
  const vulnHot: { x: number; y: number; score: number }[] = [];
  const shadeGap: { x: number; y: number; score: number }[] = [];
  for (const tile of map.tiles) {
    if (tile.void) continue;
    const i = tile.y * GRID + tile.x;
    const o = pop.outdoor[i];
    const dom = dominantGroup(tile);
    const vuln = VULNERABLE_GROUPS.includes(dom.id);
    const hotness = Math.max(0, heat[i] - 55);
    // ① 又热又有人（脆弱群体加权）——降高暴露、升舒适度
    const hp = o * (vuln ? 1.35 : 1) * hotness;
    if (hp > 0) hotPop.push({ x: tile.x, y: tile.y, score: hp });
    // ② 脆弱群体集中且地表仍很热——缩公平差的关键点位（后勤休息点、外卖集散点、幼儿园……）
    if (vuln && heat[i] >= HIGH_HEAT - 6) vulnHot.push({ x: tile.x, y: tile.y, score: (heat[i] - 60) * (1 + o) });
    // ③ 人流大但还没被遮住——提遮阴覆盖的关键点位
    if (o > 0 && fields.shade[i] < 3) shadeGap.push({ x: tile.x, y: tile.y, score: o * (1 + hotness / 40) });
  }
  const take = (list: { x: number; y: number; score: number }[], n: number) => list.sort((a, b) => b.score - a.score).slice(0, n);
  const merged = new Map<string, { x: number; y: number }>();
  for (const c of [...take(hotPop, 16), ...take(vulnHot, 14), ...take(shadeGap, 14)]) {
    merged.set(`${c.x},${c.y}`, { x: c.x, y: c.y });
  }
  return Array.from(merged.values());
}

/* ------------------------------------------------------------------ *
 * 7. 关卡评估
 * ------------------------------------------------------------------ */
export type GoalResult = { goal: Goal; value: number; ok: boolean; earned: number };

export type Evaluation = {
  level: Level;
  results: GoalResult[];
  earned: number;
  max: number;
  ratio: number;
  stars: number;
  passed: boolean;
  headline: string;
  detail: string;
};

export function metricValue(m: Metrics, metric: Goal['metric']): number {
  switch (metric) {
    case 'popExposed': return m.popExposed;
    case 'dangerPop': return m.dangerPop;
    case 'avgHeat': return m.avgHeat;
    case 'vulnExposed': return m.vulnExposed;
    case 'equityGap': return m.equityGap;
    case 'shadeCoverage': return m.shadeCoverage;
    case 'comfort': return m.comfort;
    case 'budgetLeft': return m.budgetLeft;
    default: return 0;
  }
}

export function evaluate(state: GameState): Evaluation {
  const level = getLevel(state.levelId);
  const fallback = lastHour(level);
  const metricsCache = new Map<Hour, Metrics>();
  const metricsAt = (h: Hour) => {
    const cached = metricsCache.get(h);
    if (cached) return cached;
    const m = computeMetrics(state, h);
    metricsCache.set(h, m);
    return m;
  };

  const results: GoalResult[] = level.goals.map((goal) => {
    const m = metricsAt(goal.atHour ?? fallback);
    const value = metricValue(m, goal.metric);
    const ok = goal.op === '<=' ? value <= goal.value : value >= goal.value;
    return { goal, value, ok, earned: ok ? goal.points : 0 };
  });

  const max = results.reduce((s, r) => s + r.goal.points, 0);
  const earned = results.reduce((s, r) => s + r.earned, 0);
  const ratio = max > 0 ? earned / max : 1;
  const stars = max === 0 ? 3 : ratio >= 0.85 ? 3 : ratio >= 0.6 ? 2 : ratio >= 0.3 ? 1 : 0;
  const passed = max === 0 ? true : stars >= 1;

  const coreFailed = results.filter((r) => r.goal.core && !r.ok);
  const headline = level.sandbox
    ? '沙盒方案已生成'
    : stars === 3 ? '优秀：清凉与公平同时达标'
    : stars === 2 ? '良好：整体达标，仍有短板'
    : stars === 1 ? '合格：有改善，但目标未完全达成'
    : '未达标：关键目标没有守住';

  const detail = level.sandbox
    ? '沙盒模式不设验收线，请对比不同方案的热暴露与公平指数。'
    : coreFailed.length > 0
      ? `核心目标未达成：${coreFailed.map((r) => r.goal.label).join('；')}`
      : '所有核心目标达成，继续保持对脆弱群体的关注。';

  return { level, results, earned, max, ratio, stars, passed, headline, detail };
}

/* ------------------------------------------------------------------ *
 * 8. 参谋建议（本地规则推理，不调用任何大模型）
 * ------------------------------------------------------------------ */
export type Suggestion = {
  toolId: ToolId;
  x: number;
  y: number;
  tileName: string;
  gain: number;
  cost: number;
  reason: string;
};

function dominantGroup(tile: Tile): { id: GroupId; share: number } {
  const mix = PROFILES[tile.profile].mix;
  let best: GroupId = 'students';
  let bestShare = -1;
  for (const g of GROUP_ORDER) {
    if ((mix[g] ?? 0) > bestShare) { bestShare = mix[g] ?? 0; best = g; }
  }
  return { id: best, share: bestShare };
}

/** 综合改善分：高暴露人数、脆弱群体暴露、平均热指数、舒适度。 */
function improvement(before: Metrics, after: Metrics): number {
  return (
    (before.popExposed - after.popExposed) * 0.6 +
    (before.vulnExposed - after.vulnExposed) * 1.2 +
    (before.equityGap - after.equityGap) * 4 +
    (before.avgHeat - after.avgHeat) * 12 +
    (after.comfort - before.comfort) * 0.8
  );
}

export function advise(state: GameState, hour: Hour): Suggestion[] {
  const before = computeMetrics(state, hour);
  const pop = populationField(hour, state.levelId);
  const heat = heatField(state, hour);

  // 候选地块：又热、又有人，且脆弱群体占比高的优先
  const map = getMap(state.levelId);
  const candidates = map.tiles.filter((tile) => !tile.void).map((tile) => {
    const i = tile.y * GRID + tile.x;
    const dom = dominantGroup(tile);
    const vulnBoost = VULNERABLE_GROUPS.includes(dom.id) ? 1.35 : 1;
    const hotness = Math.max(0, heat[i] - 55);
    return { tile, score: pop.outdoor[i] * vulnBoost * hotness };
  })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  const byTool = new Map<ToolId, Suggestion>();
  for (const cand of candidates) {
    for (const toolId of Object.keys(TOOLS) as ToolId[]) {
      if (!isUnlocked(state, toolId)) continue;
      if (!canPlace(state, toolId, cand.tile.x, cand.tile.y).ok) continue;
      const after = computeMetrics(placeCore(state, toolId, cand.tile.x, cand.tile.y), hour);
      const gain = improvement(before, after);
      const prev = byTool.get(toolId);
      if (prev && prev.gain >= gain) continue;
      const dom = dominantGroup(cand.tile);
      const g = GROUPS[dom.id];
      const people = Math.round(tilePopulation(cand.tile, hour) * tileOutdoor(cand.tile, hour));
      byTool.set(toolId, {
        toolId,
        x: cand.tile.x,
        y: cand.tile.y,
        tileName: cand.tile.name,
        gain,
        cost: TOOLS[toolId].cost,
        reason: `${cand.tile.name}·${g.name}约占 ${(dom.share * 100).toFixed(0)}%${people > 0 ? `（${people} 人）` : ''}；${TOOLS[toolId].forIssue}`,
      });
    }
  }

  return Array.from(byTool.values())
    .filter((s) => s.gain > 0)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 3);
}

/** 未改造时的基线指标，用于关卡简报说明"不做事会有多热"。 */
export function baselineMetrics(level: Level, hour: Hour): Metrics {
  return computeMetrics(createState(level.id), hour);
}

export const GRID_SIZE = GRID;
export { HOURS };
export type { PopMix };

/**
 * 「脆弱群体聚集（占比 ≥35%）且受热（热指数 ≥ 高暴露线）」的地块数。
 * 该图层在多数关卡天然为空（脆弱群体扎堆的林荫本来就凉快）——
 * UI 用它判断要不要给玩家一句解释，避免误以为图层坏了。
 */
export function vulnerableHotCount(state: GameState, hour: Hour): number {
  const heat = heatField(state, hour);
  const map = getMap(state.levelId);
  let n = 0;
  for (const tile of map.tiles) {
    if (tile.void) continue;
    const i = tile.y * GRID + tile.x;
    if (heat[i] < HIGH_HEAT) continue;
    const gs = tileGroups(tile, hour);
    let total = 0;
    let vuln = 0;
    for (const g of GROUP_ORDER) {
      total += gs[g];
      if (VULNERABLE_GROUPS.includes(g)) vuln += gs[g];
    }
    if (total > 0 && vuln / total >= 0.35) n++;
  }
  return n;
}
