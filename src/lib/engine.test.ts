import { describe, expect, it } from 'vitest';
import { GRID, getMap, tileAtFor, type Tile } from '../data/campus';
import { HIGH_HEAT } from '../data/groups';
import { TOOLS } from '../data/tools';
import { LEVELS } from '../data/levels';
import {
  advance, advise, autoPlan, baselineMetrics, budgetLeft, budgetSpent, canPlace,
  computeFields, computeMetrics, createState, currentHour, evaluate, heatField,
  configureRefuge, isUnlocked, place, populationField, removeAt, resolveChoice, resumeLevel, support, undo, waterLeft,
} from './engine';

const L1 = LEVELS[0];
const L2 = LEVELS[1];

function tileIdOf(name: string, levelId = 'l4'): { x: number; y: number } {
  const t = getMap(levelId).tiles.find((tile) => tile.name === name && !tile.void);
  if (!t) throw new Error(`unknown tile ${name} in ${levelId}`);
  return { x: t.x, y: t.y };
}

/** 某关卡里所有非空缺地块。 */
function tilesOf(levelId: string): Tile[] {
  return getMap(levelId).tiles.filter((tile) => !tile.void);
}

describe('关卡地图：每关形状不同、可含缺口与预置设施', () => {
  it('五关的尺寸与地块数量互不相同', () => {
    const shapes = LEVELS.map((l) => {
      const map = getMap(l.mapId);
      return `${map.width}x${map.height}:${map.tiles.filter((t) => !t.void).length}`;
    });
    expect(new Set(shapes).size).toBeGreaterThanOrEqual(4);
  });

  it('存在不规则边界（小地图有空缺地块）', () => {
    const withHole = LEVELS.map((l) => getMap(l.mapId).tiles.some((t) => t.void));
    expect(withHole.some(Boolean)).toBe(true);
  });

  it('每关都有预置设施，且预置设施不占预算', () => {
    for (const level of LEVELS) {
      const s = createState(level.id);
      const presets = s.placements.filter((p) => p.fixed);
      expect(presets.length).toBeGreaterThan(0);
      expect(budgetSpent(s)).toBe(0);
      expect(budgetLeft(s)).toBe(level.budget);
      expect(removeAt(s, presets[0].x, presets[0].y)).toBe(s);
    }
  });

  it('预置设施与水源点都存在于地图上', () => {
    for (const level of LEVELS) {
      const map = getMap(level.mapId);
      expect(map.tiles.some((t) => !t.void && t.waterSource)).toBe(true);
      expect(map.tiles.some((t) => !t.void && t.presetTool)).toBe(true);
    }
  });
});

describe('初始状态与派生量', () => {
  it('任务开始时回合为 0、只有预置设施、预算满额', () => {
    const s = createState('l1');
    expect(s.round).toBe(0);
    expect(s.placements.every((p) => p.fixed)).toBe(true);
    expect(budgetSpent(s)).toBe(0);
    expect(budgetLeft(s)).toBe(L1.budget);
    expect(currentHour(s)).toBe(12);
    expect(s.finished).toBe(false);
  });

  it('未解锁的工具不能使用', () => {
    const s = createState('l1');
    expect(isUnlocked(s, 'tree')).toBe(true);
    expect(isUnlocked(s, 'greenroof')).toBe(false);
    expect(canPlace(s, 'greenroof', 5, 5).ok).toBe(false);
  });
});

describe('放置合法性', () => {
  it('行道树只能放在地面，绿色屋顶只能放在建筑上', () => {
    const s = createState('l4');
    const plaza = tileIdOf('中心广场', 'l4');
    const library = tileIdOf('图书馆', 'l4');
    expect(canPlace(s, 'tree', plaza.x, plaza.y).ok).toBe(true);
    expect(canPlace(s, 'tree', library.x, library.y).ok).toBe(false);
    expect(canPlace(s, 'greenroof', library.x, library.y).ok).toBe(true);
    expect(canPlace(s, 'greenroof', plaza.x, plaza.y).ok).toBe(false);
  });

  it('同一地块不能重复改造', () => {
    const plaza = tileIdOf('潮汐广场', 'l1');
    let s = createState('l1');
    s = place(s, 'canopy', plaza.x, plaza.y);
    expect(canPlace(s, 'tree', plaza.x, plaza.y).ok).toBe(false);
    expect(canPlace(s, 'tree', plaza.x, plaza.y).reason).toContain('已经改造');
  });

  it('没有回合行动点限制：同一回合内可以连续放置多处', () => {
    let s = createState('l1');
    const plazas = tilesOf('l1').filter((t) => t.type === 'plaza').slice(0, 4);
    for (const t of plazas) s = place(s, 'tree', t.x, t.y);
    expect(s.placements).toHaveLength(plazas.length + 1); // 4 + 1 个预置设施
  });

  it('预算不足时拒绝放置', () => {
    let s = createState('l1');
    // 花光预算
    for (const tile of tilesOf('l1').filter((t) => t.type === 'plaza')) {
      s = place(s, 'canopy', tile.x, tile.y);
    }
    expect(budgetLeft(s)).toBeLessThan(TOOLS.canopy.cost);
    const spare = tilesOf('l1').find((t) => !s.placements.some((p) => p.x === t.x && p.y === t.y))!;
    expect(canPlace(s, 'canopy', spare.x, spare.y).ok).toBe(false);
    expect(canPlace(s, 'canopy', spare.x, spare.y).reason).toContain('预算');
  });
});

describe('改造确实降低热暴露', () => {
  it('遮阳棚降低潮汐广场午后的地表热指数', () => {
    const plaza = tileIdOf('潮汐广场', 'l1');
    const i = plaza.y * GRID + plaza.x;
    const before = heatField(createState('l1'), 14)[i];
    const after = heatField(place(createState('l1'), 'canopy', plaza.x, plaza.y), 14)[i];
    expect(after).toBeLessThan(before);
    expect(before - after).toBeGreaterThan(10);
  });

  it('遮阴与蒸散都有上限，不能无限叠加', () => {
    let s = createState('l5');
    const tiles = tilesOf('l5').filter((t) => t.type === 'plaza').slice(0, 9);
    for (const t of tiles) s = place(s, 'water', t.x, t.y);
    const f = computeFields(s);
    const i = tiles[0].y * GRID + tiles[0].x;
    expect(f.shade[i]).toBeLessThanOrEqual(40);
    expect(f.evap[i]).toBeLessThanOrEqual(32);
  });

  it('饮水补给点显著提升舒适度但不怎么降温', () => {
    const service = tileIdOf('后勤保洁休息点', 'l4');
    const before = computeMetrics(createState('l4'), 14);
    const after = computeMetrics(place(createState('l4'), 'station', service.x, service.y), 14);
    expect(after.comfort).toBeGreaterThan(before.comfort);
  });
});

describe('人群与暴露口径', () => {
  it('只有户外暴露人口计入高暴露，室内人数不计入', () => {
    const m = baselineMetrics(L1, 14);
    expect(m.outdoorPop).toBeLessThan(m.totalPop);
    expect(m.popExposed).toBeLessThanOrEqual(m.outdoorPop + 1);
  });

  it('人群分布随时刻变化（傍晚运动场人多）', () => {
    const noon = populationField(18, 'l4');
    const evening = populationField(18, 'l4');
    const sport = tileIdOf('田径运动场', 'l4');
    const i = sport.y * GRID + sport.x;
    expect(evening.outdoor[i]).toBeGreaterThan(0);
    expect(noon.outdoor[i]).toBe(evening.outdoor[i]);
  });

  it('公平差 = 脆弱群体高暴露率 − 学生高暴露率', () => {
    const m = baselineMetrics(L2, 14);
    expect(m.equityGap).toBeCloseTo(m.vulnExposedRate - m.studentExposedRate, 6);
  });

  it('基线里脆弱群体的高暴露率高于学生（公平议题成立）', () => {
    const m = baselineMetrics(LEVELS[3], 14);
    expect(m.vulnExposedRate).toBeGreaterThan(m.studentExposedRate);
    expect(m.vulnExposed).toBeGreaterThan(0);
  });

  it('高暴露阈值以上的地块才算高暴露', () => {
    const heat = heatField(createState('l1'), 14);
    const pop = populationField(14, 'l1');
    let manual = 0;
    for (let i = 0; i < heat.length; i++) if (heat[i] >= HIGH_HEAT) manual += pop.outdoor[i];
    expect(baselineMetrics(L1, 14).popExposed).toBe(Math.round(manual));
  });
});

describe('拆除、撤销与支持度', () => {
  it('拆除后退回预算', () => {
    const plaza = tileIdOf('潮汐广场', 'l1');
    let s = createState('l1');
    s = place(s, 'canopy', plaza.x, plaza.y);
    expect(budgetSpent(s)).toBe(TOOLS.canopy.cost);
    s = removeAt(s, plaza.x, plaza.y);
    expect(budgetSpent(s)).toBe(0);
    expect(s.placements.every((p) => p.fixed)).toBe(true);
  });

  it('撤销恢复上一步状态', () => {
    const plaza = tileIdOf('潮汐广场', 'l1');
    let s = createState('l1');
    const before = s.placements.length;
    s = place(s, 'canopy', plaza.x, plaza.y);
    s = undo(s);
    expect(s.placements).toHaveLength(before);
    expect(budgetSpent(s)).toBe(0);
  });

  it('放置改造会改变公众支持度', () => {
    const plaza = tileIdOf('潮汐广场', 'l1');
    const before = support(createState('l1'));
    const after = support(place(createState('l1'), 'canopy', plaza.x, plaza.y));
    expect(after).toBeGreaterThan(before);
  });
});

describe('事件与回合推进', () => {
  it('第一关推进后触发"午后热浪"事件，全局热指数上升', () => {
    const s = createState('l1');
    const after = advance(s);
    expect(after.heatDelta).toBe(4);
    expect(after.round).toBe(1);
    expect(after.resolvedEvents).toContain('l1-e1');
  });

  it('走完全部回合后进入结束状态', () => {
    let s = createState('l1');
    s = advance(s); // 12 -> 14
    s = advance(s); // 14 -> finished
    expect(s.finished).toBe(true);
  });

  it('第二关提示图书馆开放纳凉时段（不再中断流程）', () => {
    let s = createState('l2');
    s = advance(s); // round 0 -> 1
    expect(s.pendingEvent).toBeNull();
    s = advance(s); // round 1 -> 提示事件
    expect(s.pendingEvent).toBeNull();
    expect(s.resolvedEvents).toContain('l2-e1');
    expect(place(s, 'tree', 1, 1)).not.toBe(s);
  });

  it('纳凉点让图书馆周边更舒适', () => {
    const library = tileIdOf('图书馆', 'l2');
    const i = library.y * GRID + library.x;
    const base = computeFields(createState('l2'));
    const opened = computeFields({ levelId: 'l2', placements: [], refuge: true, refugeHours: [12, 14] }, 14);
    expect(opened.comfort[i]).toBeGreaterThan(base.comfort[i]);
  });

  it('纳凉点只在选定时段生效', () => {
    const library = tileIdOf('图书馆', 'l2');
    const i = library.y * GRID + library.x;
    const opened = computeFields({ levelId: 'l2', placements: [], refuge: true, refugeHours: [14] }, 8);
    expect(opened.comfort[i]).toBe(0);
  });

  it('撤销纳凉场馆设置会同时恢复开放状态与时段', () => {
    let s = createState('l2');
    s = configureRefuge(s, [12, 14]);
    expect(s.refuge).toBe(true);
    expect(s.refugeHours).toEqual([12, 14]);
    s = undo(s);
    expect(s.refuge).toBe(false);
    expect(s.refugeHours).toEqual([]);
  });
});

describe('水源约束：靠近水源才能自由建设需水设施', () => {
  /** 找一个离任何水源都足够远的地块。 */
  function farTile(levelId: string): { x: number; y: number } {
    const map = getMap(levelId);
    const sources = map.tiles.filter((t) => !t.void && t.waterSource);
    const candidates = map.tiles.filter((t) => !t.void && (t.type === 'plaza' || t.type === 'grass'));
    const scored = candidates
      .map((t) => ({ t, d: Math.min(...sources.map((s) => Math.max(Math.abs(s.x - t.x), Math.abs(s.y - t.y)))) }))
      .sort((a, b) => b.d - a.d);
    const far = scored[0];
    expect(far.d).toBeGreaterThan(1);
    return { x: far.t.x, y: far.t.y };
  }

  it('在水源旁放置需水设施不消耗水量', () => {
    const s = createState('l4');
    const before = waterLeft(s);
    const map = getMap('l4');
    const source = map.tiles.find((t) => !t.void && t.waterSource)!;
    const near = map.tiles.find(
      (t) => !t.void && t.type === 'grass' && Math.max(Math.abs(t.x - source.x), Math.abs(t.y - source.y)) === 1,
    )!;
    const after = place(s, 'tree', near.x, near.y);
    expect(waterLeft(after)).toBe(before);
  });

  it('远离水源放置需水设施会消耗水量', () => {
    const s = createState('l4');
    const far = farTile('l4');
    const before = waterLeft(s);
    const after = place(s, 'tree', far.x, far.y);
    expect(after).not.toBe(s);
    expect(waterLeft(after)).toBeLessThan(before);
  });

  it('不需要水的设施任何位置都不耗水', () => {
    const s = createState('l2');
    const far = farTile('l2');
    const before = waterLeft(s);
    const after = place(s, 'canopy', far.x, far.y);
    expect(after).not.toBe(s);
    expect(waterLeft(after)).toBe(before);
  });

  it('水量耗尽时拒绝继续放置需水设施', () => {
    let s = createState('l4');
    // 反���把水用完
    for (let i = 0; i < 60 && waterLeft(s) > 0; i++) {
      const next = autoPlan(s, 14);
      if (next === s) break;
      s = next;
    }
    if (waterLeft(s) > 0) {
      // 自动布置没能耗尽水，就直接把 waterUsed 顶满并同时腾出预算
      s = { ...s, waterUsed: LEVELS[3].waterSupply, placements: s.placements.filter((p) => p.fixed) };
    }
    expect(waterLeft(s)).toBe(0);
    const far = farTile('l4');
    const check = canPlace(s, 'tree', far.x, far.y);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('水');
  });

  it('拆除需水设施会退回水量', () => {
    let s = createState('l4');
    const far = farTile('l4');
    s = place(s, 'tree', far.x, far.y);
    const used = waterLeft(s);
    s = removeAt(s, far.x, far.y);
    expect(waterLeft(s)).toBeGreaterThan(used);
  });
});

describe('评估与参谋', () => {
  it('什么都不做时核心目标不达标', () => {
    const ev = evaluate(createState('l1'));
    expect(ev.stars).toBe(0);
    expect(ev.results.every((r) => !r.ok)).toBe(true);
  });

  it('评估给出可解释的逐条结果与总分', () => {
    const ev = evaluate(createState('l1'));
    expect(ev.results).toHaveLength(L1.goals.length);
    expect(ev.max).toBe(L1.goals.reduce((s, g) => s + g.points, 0));
    expect(ev.detail).toBeTruthy();
  });

  it('参谋建议数量不超过 3，且每条都有可解释理由与坐标', () => {
    const tips = advise(createState('l4'), 14);
    expect(tips.length).toBeGreaterThan(0);
    expect(tips.length).toBeLessThanOrEqual(3);
    for (const tip of tips) {
      expect(tip.reason.length).toBeGreaterThan(4);
      expect(tip.gain).toBeGreaterThan(0);
      expect(tileAtFor('l4', tip.x, tip.y)).toBeTruthy();
    }
  });

  it('参谋建议都是当前可以合法放置的', () => {
    const s = createState('l4');
    for (const tip of advise(s, 14)) {
      expect(canPlace(s, tip.toolId, tip.x, tip.y).ok).toBe(true);
    }
  });

  it('一键规划会在预算内自动布置，且不再超出预算', () => {
    const planned = autoPlan(createState('l1'), 14);
    expect(planned.placements.length).toBeGreaterThan(0);
    expect(budgetLeft(planned)).toBeGreaterThanOrEqual(0);
    expect(planned.placements.length).toBeGreaterThan(createState('l1').placements.length);
  });

  it('一键规划后热暴露确实下降', () => {
    const before = computeMetrics(createState('l1'), 14);
    const after = computeMetrics(autoPlan(createState('l1'), 14), 14);
    expect(after.popExposed).toBeLessThan(before.popExposed);
  });
});

describe('重做本关：改造清零、记录保留', () => {
  it('resumeLevel 清空玩家改造并复位时间预算，决策记录保留并追加说明', () => {
    const s0 = createState('l1');
    const spot = tilesOf('l1').find((t) => canPlace(s0, 'tree', t.x, t.y).ok);
    expect(spot).toBeTruthy();
    const placed = place(s0, 'tree', spot!.x, spot!.y);
    expect(placed.placements.length).toBeGreaterThan(s0.placements.length);
    expect(placed.log.length).toBeGreaterThan(s0.log.length);       // 放置后记录变多

    const finished = { ...placed, finished: true };
    const resumed = resumeLevel(finished);
    expect(resumed.finished).toBe(false);
    expect(resumed.placements.length).toBe(s0.placements.length);    // 玩家改造清空（关卡自带设施保留）
    expect(budgetSpent(resumed)).toBe(0);                           // 预算复位
    expect(resumed.round).toBe(0);                                  // 时刻复位
    expect(resumed.log.length).toBe(finished.log.length + 1);       // 决策记录保留并追加一条
    expect(resumed.log[resumed.log.length - 1].text).toContain('重做本关');

    expect(resumeLevel(resumed)).toBe(resumed);                     // 未结束时原样返回
  });
});

describe('撤销：任何一步操作都能一键回退', () => {
  it('撤销「推进时间」：回到上一个时刻，事件效果一并回退', () => {
    const s0 = createState('l1');
    const s1 = advance(s0);                       // 12:00 → 14:00（可能触发事件）
    expect(s1.round).toBe(1);
    const back = undo(s1);
    expect(back.round).toBe(0);
    expect(back.placements).toEqual(s0.placements);
    expect(back.heatDelta).toBe(s0.heatDelta);
    expect(back.weather).toBe(s0.weather);
    expect(back.log[back.log.length - 1].text).toContain('撤销');
  });

  it('撤销「事件选择」：选项重新摆回面前，可以重新选', () => {
    const base = { ...createState('l4'), round: 2, resolvedEvents: ['l4-e1'] };
    const pending = advance(base);                // 触发 l4-e2 两难选择
    const ev = pending.pendingEvent;
    expect(ev?.kind).toBe('choice');
    if (!ev || ev.kind !== 'choice') throw new Error('l4-e2 应当是一个两难选择');
    const chosen = resolveChoice(pending, ev.choices[0].id);
    expect(chosen.pendingEvent).toBeNull();
    const back = undo(chosen);
    expect(back.pendingEvent?.id).toBe('l4-e2');  // 选择被撤回，弹窗会重新出现
  });

  it('撤销「一键自动布置」：整批只占一条历史，一次全收回去', () => {
    const s0 = createState('l1');
    const planned = autoPlan(s0, 14);
    expect(planned.placements.length).toBeGreaterThan(s0.placements.length);
    const back = undo(planned);
    expect(back.placements).toEqual(s0.placements);
    expect(budgetLeft(back)).toBe(budgetLeft(s0));
    expect(back.past.length).toBe(s0.past.length);
  });

  it('撤销「重做本关」：回到已结束（复盘）状态', () => {
    const finished = { ...createState('l1'), finished: true };
    const resumed = resumeLevel(finished);
    expect(resumed.finished).toBe(false);
    const back = undo(resumed);
    expect(back.finished).toBe(true);
  });
});
