import { useState } from 'react';
import { HOUR_LABEL, tileAt } from '../data/campus';
import { GROUPS, HIGH_HEAT, type GroupId } from '../data/groups';
import { TOOLS, TOOL_ORDER } from '../data/tools';
import { getLevel, LEVELS } from '../data/levels';
import { budgetLeft, computeMetrics, evaluate, support, type GameState } from '../lib/engine';

/* ============================== 方法与社会意义 ============================== */
export function MethodPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="page">
      <header className="page-head">
        <button className="ghost" onClick={onBack}>← 返回推演</button>
        <h1>方法与边界</h1>
        <p className="page-sub">这个作品在算什么，以及它刻意不去声称什么。</p>
      </header>

      <section className="page-card">
        <h2>1. 一句话定位</h2>
        <p>
          《清凉一夏 · 热浪行动》是一个<strong>校园微气候改善决策游戏</strong>。玩家是校园里的学生规划志愿者，
          在有限预算和施工档期的约束下，为不同的地块选择行道树、遮阳棚、透水铺装、浅水景观、雾森、饮水补给点与绿色屋顶，
          在四个时刻里观察<strong>“谁被晒到了”</strong>，最后接受一组成人不太会写进任务书的验收条件：
          不仅整体要降温，<strong>脆弱群体的改善幅度还不能低于平均水平</strong>。
        </p>
      </section>

      <section className="page-card">
        <h2>2. 核心公式（全部在 <code>src/lib/engine.ts</code> 中实现为纯函数）</h2>
        <pre className="formula">{`地表热指数 tile.heat
  = clamp( baseHeat × 时刻系数 × 天气系数 + 事件修正
           − 遮阴降温 − 蒸散降温 , 12 , 100 )

户外暴露人数
  = Σ 地块人数 × 该地块该时刻的“户外暴露比例”

加权平均热指数
  = Σ (heat × 户外人数) / Σ 户外人数

公平差
  = 脆弱群体高暴露率 − 学生高暴露率（百分点）

遮阴覆盖 / 舒适度
  = 按户外人数加权的遮阴覆盖比例 / 舒适度贡献`}</pre>
        <p>
          <strong>时刻系数</strong>（08:00 / 12:00 / 14:00 / 18:00）与<strong>天气系数</strong>（常规 / 黄色 / 橙色预警 / 雷阵雨）
          共同决定同一块地在一天中的冷热变化；<strong>距离衰减</strong>用 <code>1 − (d/R)^1.6</code> 计算，
          并且每种影响（遮阴、蒸散、舒适度）都有单点上限，避免“堆设施把温度刷到不真实的低值”。
        </p>
      </section>

      <section className="page-card">
        <h2>3. 为什么只统计“户外暴露”</h2>
        <p>
          屋顶再烫，也不等于站在教室里的人被暴晒。作品把每个地块在四个时刻的<strong>户外暴露比例</strong>作为独立参数：
          教学楼 14:00 只有 15% 的人算暴露，食堂取餐高峰 12:00 有 75% 的人在排队，
          而后勤保洁、门岗、绿化与外卖骑手<strong>几乎 100% 在户外</strong>。这正是热浪里最容易被忽略、风险却最高的一群人。
        </p>
        <p>
          四个脆弱群体的权重不同：老人 1.9、儿童 1.8、户外劳动者 1.5、骑手 1.4，学生为基准 1.0。
          权重只影响<strong>公平差</strong>与暴露率的比较口径，不改变每个人的物理暴露值。
        </p>
      </section>

      <section className="page-card">
        <h2>4. 为什么公平用“率差”，而不是平均值</h2>
        <p>
          如果只看平均温度，一个把中心广场浇得很凉、却把后勤休息点晾在一边的方案，看起来也会很漂亮。
          用<strong>高暴露率之差</strong>（脆弱群体 vs 学生）衡量，就能暴露这种“平均值陷阱”：
          第四关里，只跟着参谋建议走的贪心方案反而把公平差<em>拉大</em>了。
        </p>
      </section>

      <section className="page-card">
        <h2>5. 数据来源与模拟边界</h2>
        <table className="data-table">
          <tbody>
            <tr><th>校园地名与建筑位置</th><td>参考山东科技大学青岛校区的公开印象做了<strong>风格化重构</strong>，不代表真实布局或校方规划。</td></tr>
            <tr><th>地表热指数</th><td><strong>原型估算</strong>（0–100 的无量纲指数，<strong>不是摄氏度</strong>），由编写者按常见下垫面差异设定。</td></tr>
            <tr><th>人数、人群构成、户外比例</th><td><strong>原型模拟数据</strong>，不是真实人口统计，也不来自任何门禁或定位数据。</td></tr>
            <tr><th>造价、半径、降温效果</th><td><strong>为本作品设定的模拟参数</strong>，用于比较取舍，不是工程预算或经认证的实测效果。</td></tr>
            <tr><th>活动、事件与人物</th><td>全部为虚构设定，不对应任何真实人员或真实事件。</td></tr>
            <tr><th>图像与音频</th><td>地图、建筑、树木、云朵、图标全部由 SVG 程序绘制；交互提示音由 Web Audio 实时合成，背景音乐为本地 assets 音频文件并压低音量播放。</td></tr>
          </tbody>
        </table>
        <p className="warn-note">
          边界说明：本作品用于说明决策取舍与公平议题，<strong>不是热环境预测工具</strong>，也不能用于任何真实区域的评估。
          正式应用前，应由建筑环境、气象与后勤专业人员核校参数与结论。
        </p>
      </section>

      <section className="page-card">
        <h2>6. AI 使用说明</h2>
        <p>
          作品中的<strong>“参谋建议”是本地规则推理</strong>（<code>src/lib/advisor.ts</code> 同源的评分函数位于
          <code>engine.ts</code> 的 <code>advise()</code>）：枚举当前可放置的“工具 × 地块”组合，按
          “高暴露人数下降 + 脆弱群体暴露下降 + 平均热指数下降 + 舒适度提升”打分排序，并给出可复现的理由。
          <strong>全程不调用任何大模型 API</strong>，现场断网也能完整演示，答辩时可以逐条解释“为什么给出这条建议”。
        </p>
      </section>

      <section className="page-card">
        <h2>7. 相关科普入口</h2>
        <ul className="link-list">
          <li>中国气象局 · 高温预警与防暑科普：<span className="link">www.cma.gov.cn</span></li>
          <li>中华人民共和国应急管理部 · 高温天气防护：<span className="link">www.mem.gov.cn</span></li>
          <li>国家疾病预防控制局 · 高温热浪健康防护：<span className="link">www.ndcpa.gov.cn</span></li>
        </ul>
        <p className="muted small">以上仅为公开信息入口，具体建议请以官方最新发布为准。</p>
      </section>
    </div>
  );
}

/* ============================== 行动清单 ============================== */
export function PlanPage({ state, onBack, onNextLevel }: { state: GameState; onBack: () => void; onNextLevel?: () => void }) {
  const level = getLevel(state.levelId);
  const hour = level.hours[level.hours.length - 1];
  const metrics = computeMetrics(state, hour);
  const evaluation = evaluate(state);
  const byTool = new Map<string, { x: number; y: number; name: string }[]>();
  for (const p of state.placements) {
    const list = byTool.get(p.toolId) ?? [];
    list.push({ x: p.x, y: p.y, name: tileAt(p.x, p.y)?.name ?? '地块' });
    byTool.set(p.toolId, list);
  }
  const vulnHot = metrics.hottest.filter((h) => h.heat >= HIGH_HEAT).slice(0, 5);
  /* 应用内打印预览：点「打印 / 导出 PDF」先看到纸面效果（纯页面渲染，任何环境都不会空白） */
  const [preview, setPreview] = useState(false);
  /** 还有下一关时才显示「进入下一关」。 */
  const hasNext = level.index < LEVELS.length;

  return (
    <div className={`page ${preview ? 'preview-mode' : ''}`}>
      {preview && (
        <div className="print-toolbar" role="toolbar" aria-label="打印预览工具栏">
          <span className="print-toolbar-title">打印预览 · 这就是打印出来的样子</span>
          <div className="print-toolbar-actions">
            <button className="ghost" onClick={() => setPreview(false)}>返回编辑</button>
            <button className="primary" onClick={() => window.print()}>开始打印 / 另存为 PDF</button>
          </div>
        </div>
      )}
      <header className="page-head">
        <div className="page-nav">
          <button className="primary" onClick={onBack}>← 返回推演</button>
          {hasNext && onNextLevel && (
            <button
              className="primary"
              onClick={onNextLevel}
              disabled={evaluation.stars < 3}
              title={evaluation.stars < 3 ? '本关拿到 3 星后才能进入下一关；可回到地图按「✦ 自动布置方案」直接铺好达标方案' : undefined}
            >
              进入下一关 →
            </button>
          )}
        </div>
        <h1>清凉改造行动清单</h1>
        <p className="page-sub">{level.name} · 结算于 {HOUR_LABEL[hour]} · 可直接打印或截图提交给后勤</p>
        <button className="primary" onClick={() => setPreview(true)}>打印 / 导出 PDF</button>
      </header>

      <section className="page-card plan-summary">
        <div className="plan-stats">
          <div><span>改造点位</span><strong>{state.placements.length}</strong></div>
          <div><span>预计花费</span><strong>{metrics.budgetSpent} 万</strong></div>
          <div><span>剩余预算</span><strong>{budgetLeft(state)} 万</strong></div>
          <div><span>公众支持度</span><strong>{support(state)}</strong></div>
          <div><span>午后加权热指数</span><strong>{computeMetrics(state, 14).avgHeat.toFixed(1)}</strong></div>
          <div><span>脆弱群体高暴露</span><strong>{computeMetrics(state, 14).vulnExposed} 人</strong></div>
        </div>
        <p className="plan-headline">{evaluation.headline}：{evaluation.detail}</p>
      </section>

      <section className="page-card">
        <h2>改造点位</h2>
        {state.placements.length === 0 ? (
          <p className="muted">还没有任何改造。回到地图，先从“又热又有人”的地块开始。</p>
        ) : (
          <ul className="plan-list">
            {TOOL_ORDER.filter((t) => byTool.has(t)).map((toolId) => (
              <li key={toolId}>
                <div className="plan-tool">
                  <strong>{TOOLS[toolId].name}</strong>
                  <span>×{byTool.get(toolId)!.length} · 单个 {TOOLS[toolId].cost} 万 · 半径 {TOOLS[toolId].radius} 格</span>
                </div>
                <div className="plan-locs">
                  {byTool.get(toolId)!.map((loc, i) => <span key={i} className="tag">{loc.name}</span>)}
                </div>
                <p className="muted small">作用：{TOOLS[toolId].forIssue}。注意：{TOOLS[toolId].caveat}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="page-card">
        <h2>仍需重点关注的地点</h2>
        {vulnHot.length === 0 ? (
          <p className="muted">当前没有高暴露地块，注意维持养护与补水。</p>
        ) : (
          <ul className="plan-hot">
            {vulnHot.map((h) => (
              <li key={h.tileId}><strong>{h.name}</strong> 热指数 {h.heat.toFixed(0)}，户外约 {Math.round(h.pop)} 人</li>
            ))}
          </ul>
        )}
      </section>

      <section className="page-card">
        <h2>这份清单的社会意义</h2>
        <ul className="plan-why">
          <li>
            <strong>先人后物、先弱后强：</strong>把遮阴和饮水优先给户外劳动者、骑手、老人与儿童，
            优先级的依据写在每一关的验收条件里，而不是一句口号。
          </li>
          <li>
            <strong>把“公平”做成可验收的数字：</strong>公平差指标让“广场更漂亮”无法替代“最需要的人真的被照顾到”。
          </li>
          <li>
            <strong>把预算当成真实的约束：</strong>每一处改造都要在造价、档期与维护之间取舍，避免“全都想要”的假方案。
          </li>
          <li>
            <strong>可复核、可解释：</strong>所有计算都是可读的纯函数，任何一条建议都能被追问“为什么”。
          </li>
        </ul>
        <p className="muted small">
          本清单为<strong>模拟推演结果</strong>，不构成工程建议。落地前需结合真实场地测量、结构与后勤条件重新评估。
        </p>
      </section>

      <section className="page-card glossary">
        <h2>术语</h2>
        <p><strong>地表热指数</strong>：0–100 的无量纲指数，越高表示地表越热；不是摄氏度。</p>
        <p><strong>高暴露</strong>：地表热指数 ≥ 72 的地块上、且处于户外的人。</p>
        <p><strong>公平差</strong>：脆弱群体高暴露率 − 学生高暴露率，单位百分点（pp）。</p>
        <p><strong>脆弱群体</strong>：{(['kids', 'elders', 'workers', 'riders'] as GroupId[]).map((g) => GROUPS[g].name).join(' / ')}。</p>
        <p><strong>遮阴覆盖</strong>：处于遮阴设施影响范围内（遮阴贡献 ≥ 3）的户外人口比例。</p>
      </section>
    </div>
  );
}
