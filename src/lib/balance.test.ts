import { describe, expect, it } from 'vitest';
import { LEVELS, type Level } from '../data/levels';
import { GRID } from '../data/campus';
import { TOOLS, TOOL_ORDER, type ToolId } from '../data/tools';
import {
  advance, advise, autoPlan, baselineMetrics, budgetLeft, canPlace, computeMetrics,
  createState, evaluate, metricValue, place, resolveChoice, support,
  type GameState, type Metrics,
} from './engine';

/**
 * 关卡平衡回归测试。
 *
 * 用两种"机器人玩家"把每关跑一遍，确保：
 *   1. 看懂目标、认真规划的玩家可以拿到 3 星（关卡是可达的）；
 *   2. 只跟着参谋建议走的玩家拿不到满分（决策空间仍然存在）；
 *   3. 什么都不做的玩家一定失败（目标不是白送的）。
 */
describe('关卡平衡', () => {
  const playable = LEVELS.filter((l) => !l.sandbox);

  for (const level of playable) {
    it(`${level.name}：认真规划可以拿到 3 星`, () => {
      expect(play(level, 'smart').stars).toBe(3);
    });

    it(`${level.name}：原地不动无法达标`, () => {
      expect(play(level, 'idle').stars).toBeLessThan(3);
    });

    it(`${level.name}：点一下「自动布置方案」，一路推进到最后仍然全部达标`, () => {
      // 需求：「自动布置方案」必须一次到位——不用再让玩家手动修改。
      // 端到端：出发时一键布置 → 推完所有回合（含事件）→ 结算时每个验收目标都达成。
      let s = autoPlan(createState(level.id), level.hours[0]);
      let guard = 0;
      while (!s.finished && guard++ < 50) {
        if (s.pendingEvent) {
          const ev = s.pendingEvent;
          // 两难选择统一取第一项（notice 不会进 pendingEvent，这里兜底清掉）
          s = ev.kind === 'choice' ? resolveChoice(s, ev.choices[0].id) : { ...s, pendingEvent: null };
          continue;
        }
        s = advance(s);
      }
      const ev = evaluate(s);
      for (const r of ev.results) {
        expect(r.ok, `${r.goal.label}：推进到最后为 ${r.value.toFixed(1)}`).toBe(true);
      }
      expect(ev.stars).toBe(3);
      expect(budgetLeft(s)).toBeGreaterThanOrEqual(0);
    });

    it(`${level.name}：基线指标在合理区间`, () => {
      const m = baselineMetrics(level, level.hours[level.hours.length - 1]);
      expect(m.avgHeat).toBeGreaterThan(20);
      expect(m.avgHeat).toBeLessThan(100);
      expect(m.outdoorPop).toBeGreaterThan(0);
      expect(m.popExposed).toBeLessThanOrEqual(m.outdoorPop + 1);
      expect(m.outdoorPop).toBeLessThanOrEqual(m.totalPop + 1);
    });
  }

  it('第四关：只跟参谋建议走拿不到满分（公平议题需要主动决策）', () => {
    // 第四关的核心目标是「脆弱群体与学生的暴露差」。
    // 参谋建议按"改善效果 ÷ 造价"排序，天然偏向人多的大广场；
    // 而缩小暴露差必须把预算投向后勤休息点、外卖集散点、幼儿园这些脆弱群体集中、
    // 但人数不多的点位——这正是本关想让玩家体会的取舍。
    expect(play(LEVELS[3], 'advisor').stars).toBeLessThan(3);
  });

  it('沙盒模式不设验收线', () => {
    expect(play(LEVELS[4], 'smart').stars).toBe(3);
  });
});

type PlayMode = 'advisor' | 'smart' | 'idle';
type PlayResult = {
  stars: number; earned: number; max: number; support: number; tools: string;
  results: ReturnType<typeof evaluate>['results'];
};

function play(level: Level, mode: PlayMode): PlayResult {
  let s = createState(level.id);
  let guard = 0;
  while (!s.finished && guard++ < 400) {
    if (s.pendingEvent) {
      const ev = s.pendingEvent;
      if (ev.kind === 'choice') {
        let best = ev.choices[0].id;
        if (mode === 'smart') {
          let bestScore = -1;
          for (const c of ev.choices) {
            const score = evaluate(resolveChoice(s, c.id)).earned;
            if (score > bestScore) { bestScore = score; best = c.id; }
          }
        }
        s = resolveChoice(s, best);
      }
      continue;
    }

    if (mode === 'advisor') {
      const pick = advise(s, level.hours[s.round]).find((t) => canPlace(s, t.toolId, t.x, t.y).ok);
      if (pick) { s = place(s, pick.toolId, pick.x, pick.y); continue; }
    } else if (mode === 'smart') {
      const step = bestStep(s, level);
      if (step) { s = place(s, step.toolId, step.x, step.y); continue; }
    }
    s = advance(s);
  }
  const ev = evaluate(s);
  const counts = new Map<string, number>();
  for (const p of s.placements) counts.set(p.toolId, (counts.get(p.toolId) ?? 0) + 1);
  return {
    stars: ev.stars, earned: ev.earned, max: ev.max, support: support(s),
    tools: Array.from(counts).map(([k, v]) => `${TOOLS[k as ToolId].name}×${v}`).join(' ') || '无',
    results: ev.results,
  };
}

/** 目标感知：在全部可放的 (工具, 地块) 中选“目标完成度提升最大”的一步。 */
function bestStep(s: GameState, level: Level): { toolId: ToolId; x: number; y: number } | null {
  const ref = reference(level);
  const reserve = Math.max(0, ...level.goals.filter((g) => g.metric === 'budgetLeft').map((g) => g.value));
  let best: { toolId: ToolId; x: number; y: number } | null = null;
  let bestScore = progressScore(s, level, ref);
  const baseline = bestScore;
  for (const toolId of TOOL_ORDER) {
    if (!level.unlock.includes(toolId)) continue;
    if (budgetLeft(s) - TOOLS[toolId].cost < reserve) continue;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (!canPlace(s, toolId, x, y).ok) continue;
        const after = place(s, toolId, x, y);
        const score = progressScore(after, level, ref) - TOOLS[toolId].cost * 0.001;
        if (score > bestScore) { bestScore = score; best = { toolId, x, y }; }
      }
    }
  }
  if (best && bestScore > baseline + 1e-6) return best;
  return null;
}

const refCache = new Map<string, Map<number, Metrics>>();
function reference(level: Level): Map<number, Metrics> {
  const cached = refCache.get(level.id);
  if (cached) return cached;
  const map = new Map<number, Metrics>();
  for (const goal of level.goals) {
    const h = goal.atHour ?? level.hours[level.hours.length - 1];
    if (!map.has(h)) map.set(h, baselineMetrics(level, h));
  }
  refCache.set(level.id, map);
  return map;
}

/** 把每个目标的完成度映射到 0–1，再按分值加权求和，得到平滑的优化地形。 */
function progressScore(s: GameState, level: Level, ref: Map<number, Metrics>): number {
  let total = 0;
  for (const goal of level.goals) {
    const h = goal.atHour ?? level.hours[level.hours.length - 1];
    const m = computeMetrics(s, h);
    const v = metricValue(m, goal.metric);
    const r = ref.get(h);
    const rv = r ? metricValue(r, goal.metric) : v;
    let p: number;
    if (goal.op === '<=') {
      if (rv <= goal.value) p = 1;
      else if (v <= goal.value) p = 1 + (goal.value - v) / Math.max(1, rv - goal.value) * 0.1;
      else p = (rv - v) / (rv - goal.value);
    } else {
      if (rv >= goal.value) p = 1;
      else if (v >= goal.value) p = 1 + (v - goal.value) / Math.max(1, goal.value - rv) * 0.1;
      else p = (v - rv) / (goal.value - rv);
    }
    total += Math.max(0, p) * goal.points;
  }
  return total;
}
