"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFeedback = buildFeedback;
exports.buildRemovalFeedback = buildRemovalFeedback;
/**
 * 操作反馈：每次放置 / 拆除改造后，根据指标变化给出一句人话点评。
 *
 * 设计要点：
 *   - 只说**具体发生了什么**，不空泛地夸奖；
 *   - 数值没动时给出原因（例如"热指数降了但仍在高暴露阈值以上"），
 *     避免玩家以为"改造没生效"——这曾是第四关最容易被误判为 bug 的地方；
 *   - 顺带给下一步的方向性建议，让反馈有行动价值。
 */
const groups_1 = require("../data/groups.js");
function diff(before, after) {
    return {
        heat: before.avgHeat - after.avgHeat,
        exposed: before.popExposed - after.popExposed,
        vuln: before.vulnExposed - after.vulnExposed,
        // 公平差下降是好事：脆弱群体与学生的暴露差距在收窄
        equity: before.equityGap - after.equityGap,
        comfort: after.comfort - before.comfort,
        shade: after.shadeCoverage - before.shadeCoverage,
    };
}
const n0 = (v) => Math.round(v);
const n1 = (v) => v.toFixed(1);
/**
 * 生成一句反馈。
 *
 * @param tileWasExposed 目标地块改造前是否处于高暴露（热指数 ≥ 阈值）
 * @param tileHeatAfter  改造后该地块的热指数
 */
function buildFeedback(before, after, ctx) {
    const d = diff(before, after);
    const exposedDelta = d.exposed;
    const comfortUp = d.comfort > 0.5;
    // 1) 高暴露人数明显下降
    if (exposedDelta >= 30) {
        const parts = [`加权热指数 ↓${n1(d.heat)}`];
        if (d.vuln > 0)
            parts.push(`脆弱群体高暴露 ↓${n0(d.vuln)} 人`);
        if (comfortUp)
            parts.push(`舒适度 ↑${n0(d.comfort)}`);
        const best = exposedDelta >= 200 ? '非常好的一步' : '这一步很有效';
        return {
            tone: 'good',
            icon: '✅',
            title: `${best}：高暴露人数 ↓${n0(exposedDelta)} 人`,
            detail: `${ctx.tileName}的${ctx.toolName}带动了周边，${parts.join('，')}。`,
            next: d.equity < -0.5 ? '不过公平差反而扩大了，留意脆弱群体集中的地点。' : undefined,
        };
    }
    // 2) 有人数下降但不多
    if (exposedDelta > 0) {
        return {
            tone: 'good',
            icon: '🙂',
            title: `略有改善：高暴露 ↓${n0(exposedDelta)} 人`,
            detail: `${ctx.tileName}降温了，但覆盖的人不算多。想更快见效，可以挑人流更密、更晒的地块。`,
            next: comfortUp ? `舒适度同时 ↑${n0(d.comfort)}。` : undefined,
        };
    }
    // 3) 人数没变，但地块本身的热指数已经降下去了（最容易被误读成"没生效"）
    if (ctx.tileWasExposed && ctx.tileHeatAfter < groups_1.HIGH_HEAT) {
        return {
            tone: 'good',
            icon: '🌿',
            title: '改造生效了，但人数暂时没变',
            detail: `${ctx.tileName}的热指数已经降到高暴露线（${groups_1.HIGH_HEAT}）以下，只是它周围还热，正在暴晒的人还没被覆盖到。再加一处相邻的改造就能把这片连起来。`,
        };
    }
    // 4) 热指数也降了，但人还留在高暴露区
    if (d.heat > 0.5) {
        return {
            tone: 'warn',
            icon: '🌡',
            title: '热指数降了，但还没跨过高暴露线',
            detail: `${ctx.tileName}降温 ${n1(d.heat)}，可它本身太热（当前 ${n0(ctx.tileHeatAfter)}，阈值 ${groups_1.HIGH_HEAT}），人还处在高暴露状态。在这里再叠一处改造，或换更强力的工具更合适。`,
            next: '同一地块只能放一处改造——可以放到紧邻的格子上，效果会叠加。',
        };
    }
    // 5) 舒适度上去了（如饮水点：降温不强但对人很实在）
    if (comfortUp) {
        return {
            tone: 'info',
            icon: '🥤',
            title: '舒服了，但热暴露没变',
            detail: `${ctx.toolName}主要提升舒适度（↑${n0(d.comfort)}）。它对户外劳动者的实际帮助很大，但如果目标是压低高暴露人数，还需要能真正遮阴或蒸散的手段。`,
        };
    }
    // 6) 完全没有变化
    return {
        tone: 'warn',
        icon: '❓',
        title: '这一步几乎没有影响',
        detail: `${ctx.tileName}本来就不算热或没有人暴露在外，改造在这里效果有限。挑一个更红、人更多的地块试试。`,
    };
}
/** 拆除改造后的反馈。 */
function buildRemovalFeedback(before, after, ctx) {
    const d = diff(before, after);
    // 拆除后"改善"为负，这里的 d.exposed 是 before-after，拆除会让它变负
    if (Math.abs(d.exposed) < 1 && Math.abs(d.heat) < 0.2) {
        return {
            tone: 'info',
            icon: '🧹',
            title: `拆除了${ctx.toolName}`,
            detail: `${ctx.tileName}的指标几乎没有变化，预算已退回，可以换个位置重建。`,
        };
    }
    return {
        tone: 'warn',
        icon: '🧹',
        title: `拆除${ctx.toolName}后，热暴露上升 ${n0(Math.abs(d.exposed))} 人`,
        detail: `这片区域重新变热了（热指数 +${n1(Math.abs(d.heat))}）。如果预算够，建议在原处或附近重建。`,
    };
}
