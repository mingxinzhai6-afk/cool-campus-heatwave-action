import { describe, expect, it } from 'vitest';
import { LEVELS } from '../data/levels';
import { baselineMetrics, computeMetrics, createState } from './engine';
import { goalProgress, isGoalMet } from './goalProgress';

/**
 * 任务进度条的语义回归测试。
 *
 * 背景：进度条原来用「基线 → 目标」做 min-max 归一化，于是第四关的公平差条
 * 一开局就是满的（基线 1.58 已优于目标 8），玩家会以为目标完成了、之后怎么改都不动。
 * 现在改为按目标本身归一化：
 *   - 目标已完成 → 100%，并且界面上会标「已达标」；
 *   - 目标未完成 → 按"距离目标还有多远"单调变化，越接近越满。
 */
describe('任务进度条语义', () => {
  it('目标未达成时不显示 100%，且第四关的公平差开局确实有改善空间', () => {
    // 第四关开局：公平差高于目标（不达标），进度条必须留出空间，
    // 并且玩家把它压到目标以下后应该变为 100% + 「已达标」。
    const l4 = LEVELS[3];
    const goal = l4.goals[0];
    expect(goal.metric).toBe('equityGap');
    const v0 = computeMetrics(createState(l4.id), goal.atHour ?? 14).equityGap;

    expect(isGoalMet(goal.op, v0, goal.value)).toBe(false);
    expect(goalProgress(goal.op, v0, goal.value)).toBeLessThan(100);

    // 改善到目标以下 → 达标
    const improved = goal.value - 2;
    expect(isGoalMet(goal.op, improved, goal.value)).toBe(true);
    expect(goalProgress(goal.op, improved, goal.value)).toBe(100);
  });

  it('达标程度越高，进度条越满（<= 类目标单调）', () => {
    // 高暴露人数 ≤ 700：越少越接近满格
    const widths = [1779, 1200, 900, 700].map((v) => goalProgress('<=', v, 700));
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
    expect(widths[widths.length - 1]).toBe(100);
    expect(widths[0]).toBeLessThan(50);
  });

  it('达标程度越高，进度条越满（>= 类目标单调）', () => {
    // 舒适度 ≥ 30：越高越满
    const widths = [0, 10, 20, 30].map((v) => goalProgress('>=', v, 30));
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
    expect(widths[widths.length - 1]).toBe(100);
  });

  it('进度条不会因为基线已达标就锁死在 100%（旧实现的 bug）', () => {
    // 旧实现：ref(1.58) <= target(8) 时直接返回 100，之后无论怎么改都是 100。
    // 新实现：一旦真的超出目标，宽度必须掉下来，玩家才能看出"公平差恶化了"。
    expect(goalProgress('<=', 1.58, 8)).toBe(100);   // 好于目标 → 满
    expect(goalProgress('<=', 12, 8)).toBeLessThan(100); // 恶化后必须变化
    expect(goalProgress('<=', 12, 8)).toBeCloseTo(66.7, 0);
  });

  it('五关的目标在开局时都能算出一条合理的进度', () => {
    for (const level of LEVELS) {
      if (level.sandbox) continue;
      const m0 = baselineMetrics(level, level.hours[level.hours.length - 1]);
      for (const goal of level.goals) {
        const h = goal.atHour ?? level.hours[level.hours.length - 1];
        const m = computeMetrics(createState(level.id), h);
        const v = goal.metric === 'popExposed' ? m.popExposed
          : goal.metric === 'equityGap' ? m.equityGap
          : goal.metric === 'comfort' ? m.comfort
          : goal.metric === 'shadeCoverage' ? m.shadeCoverage : m0.popExposed;
        const w = goalProgress(goal.op, v, goal.value);
        expect(Number.isFinite(w)).toBe(true);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(100);
      }
    }
  });
});
