/**
 * 任务进度条的纯计算逻辑（与 React 解耦，便于单测）。
 *
 * 曾经的 bug：用「基线 → 目标」做 min-max 归一化，当基线本身就已经满足目标时
 * 直接返回 100%，于是第四关的公平差条一开局就是满的、之后怎么改都不动，
 * 看起来像坏了。现在直接以目标值归一化：
 *   - `>=` 类目标（如舒适度 ≥ 30）：进度 = 当前值 / 目标值
 *   - `<=` 类目标（如高暴露 ≤ 200）：进度 = 目标值 / 当前值
 * 两者都满足"达标即 100%、离目标越远越低"，且超出目标后会真实掉下来，
 * 玩家能看出方案变差了。
 */

export type GoalOp = '<=' | '>=';

export function goalProgress(op: GoalOp, value: number, target: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(target)) return 0;
  if (op === '>=') return clampPct((value / Math.max(target, 1e-6)) * 100);
  if (value <= target) return 100;
  return clampPct((target / value) * 100);
}

export function isGoalMet(op: GoalOp, value: number, target: number): boolean {
  return op === '<=' ? value <= target : value >= target;
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));
}
