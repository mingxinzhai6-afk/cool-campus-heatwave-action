import { useState, type CSSProperties } from 'react';
import {
  HOUR_LABEL, PROFILES, TYPE_TAG, tileGroups, tileOutdoor, tilePopulation,
  GRID, type Hour, type Tile,
} from '../data/campus';
import { GROUPS, GROUP_ORDER, HIGH_HEAT, VULNERABLE_GROUPS } from '../data/groups';
import { TOOLS } from '../data/tools';
import { HEAT_LEGEND, heatLabel } from '../lib/iso';
import { goalProgress, isGoalMet } from '../lib/goalProgress';
import {
  computeFields, evaluate, heatField,
  support, type GameState, type Metrics, type Suggestion,
} from '../lib/engine';
import type { Level } from '../data/levels';
import type { Layers } from './IsoMap';

/* ------------------------------ 通用小组件 ------------------------------ */
function Stat({ label, value, unit, tone, hint }: { label: string; value: string | number; unit?: string; tone?: 'good' | 'warn' | 'bad'; hint?: string }) {
  return (
    <div className={`stat ${tone ?? ''}`} title={hint}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}<em>{unit}</em></span>
    </div>
  );
}

/* ------------------------------ 图层与图例 ------------------------------ */
export function LayerPanel({ layers, onToggle }: { layers: Layers; onToggle: (k: keyof Layers) => void }) {
  const items: { key: keyof Layers; label: string; icon: string }[] = [
    { key: 'heat', label: '热力', icon: '🌡' },
    { key: 'shade', label: '遮阴', icon: '🌳' },
    { key: 'people', label: '人群', icon: '👥' },
    { key: 'sensitive', label: '脆弱群体', icon: '⚠' },
  ];
    return (
    <>
      <div className="panel layer-panel">
        <h3 className="panel-title">图层</h3>
        <div className="layer-row">
          {items.map((it) => (
            <button key={it.key} className={`chip ${layers[it.key] ? 'on' : ''}`} onClick={() => onToggle(it.key)}>
              <span>{it.icon}</span>{it.label}
            </button>
          ))}
        </div>
      </div>
      {/* 热指数色带：独立成卡片并吸底显示——左栏内容再长也始终贴在底部可见。
          （放在带 backdrop-filter 的 panel 内部时 Chrome 的 sticky 不生效，所以单独成块。） */}
      {layers.heat && (
        <div className="legend">
          <div className="legend-bar">
            {HEAT_LEGEND.map((s) => (
              <span key={s.t} className="legend-stop" style={{ background: s.color }} title={`${s.t} ${s.label}`} />
            ))}
          </div>
          <div className="legend-scale">
            <span>20 凉爽</span><span>地表热指数（原型估算）</span><span>100 极热</span>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------ 时间弧线 ------------------------------ */
// 太阳、进度弧与刻度共用同一条椭圆弧：所有位置都由「时刻 → 角度」这一个映射算出，
// 所以大字号显示的当前时刻、太阳所在位置和橙色进度始终严格对应。
const ARC = { cx: 150, cy: 80, rx: 132, ry: 70 };
const ARC_START_HOUR = 8;
const ARC_END_HOUR = 18;
const ARC_START = { x: ARC.cx - ARC.rx, y: ARC.cy };
const ARC_END = { x: ARC.cx + ARC.rx, y: ARC.cy };
const ARC_PATH = `M ${ARC_START.x} ${ARC_START.y} A ${ARC.rx} ${ARC.ry} 0 0 1 ${ARC_END.x} ${ARC_END.y}`;
const TICK_HOURS = [10, 15];

/** 把时刻映射到椭圆弧上的角度：8:00 在左端，13:00 在最高点，18:00 在右端。 */
function arcAngle(hour: number) {
  const p = Math.min(1, Math.max(0, (hour - ARC_START_HOUR) / (ARC_END_HOUR - ARC_START_HOUR)));
  return Math.PI * (1 - p);
}

function arcPoint(hour: number) {
  const angle = arcAngle(hour);
  return { x: ARC.cx + Math.cos(angle) * ARC.rx, y: ARC.cy - Math.sin(angle) * ARC.ry };
}

export function TimeArc({ hours, hour }: { hours: Hour[]; hour: Hour }) {
  // 两端各留一点余量，避免太阳与光晕贴边被裁掉；进度弧和太阳共用同一个角度。
  const raw = (hour - ARC_START_HOUR) / (ARC_END_HOUR - ARC_START_HOUR);
  const progress = Math.min(0.94, Math.max(0.06, raw));
  const angle = Math.PI * (1 - progress);
  const sun = { x: ARC.cx + Math.cos(angle) * ARC.rx, y: ARC.cy - Math.sin(angle) * ARC.ry };
  // 进度弧直接画到太阳所在的那个点，弧长与角度天然一致，不会再出现「进度条没追到太阳」。
  const progressPath = `M ${ARC_START.x} ${ARC_START.y} A ${ARC.rx} ${ARC.ry} 0 0 1 ${sun.x} ${sun.y}`;
  const period = hour < 12 ? '上午' : hour < 17 ? '午餐 · 高温时段' : '傍晚';
  return (
    <div className="time-arc" aria-label={`当前时刻 ${HOUR_LABEL[hour]}`}>
      <svg className="time-arc-svg" viewBox="0 0 300 104" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="timeArcProgress" gradientUnits="userSpaceOnUse" x1={ARC_START.x} y1="0" x2={ARC_END.x} y2="0">
            <stop offset="0" stopColor="#f3a45b" />
            <stop offset="1" stopColor="#ec7f3a" />
          </linearGradient>
        </defs>
        <path className="time-arc-track" d={ARC_PATH} />
        <path className="time-arc-progress" d={progressPath} />
        {TICK_HOURS.map((h) => {
          const point = arcPoint(h);
          return (
            <g key={h}>
              <line className="time-tick" x1={point.x} y1={point.y} x2={point.x} y2={50} />
              <text className="time-tick-label" x={point.x} y={62}>{h}:00</text>
            </g>
          );
        })}
        <circle className="time-sun-glow" cx={sun.x} cy={sun.y} r="14" />
        <circle className="time-sun" cx={sun.x} cy={sun.y} r="9" />
        <g className="time-rays" transform={`translate(${sun.x} ${sun.y})`}>
          {[0, 45, 90, 135].map((rotation) => <line key={rotation} x1="0" y1="-13" x2="0" y2="-18" transform={`rotate(${rotation})`} />)}
        </g>
      </svg>
      <div className="time-arc-readout">
        <strong>{String(hour).padStart(2, '0')}:00 <span>{hour < 12 ? '上午' : hour < 17 ? '午后' : '傍晚'}</span></strong>
        <small>当前时段 · {period}</small>
      </div>
      <div className="time-arc-hours">
        {hours.map((h) => <span key={h} className={h === hour ? 'active' : h < hour ? 'past' : ''}>{h}:00</span>)}
      </div>
    </div>
  );
}

/* ------------------------------ 指标面板 ------------------------------ */
export function MetricsPanel({ state, metrics, hour, onOpenAdvice, adviceCount }: {
  state: GameState; metrics: Metrics; hour: Hour; onOpenAdvice: () => void; adviceCount: number;
}) {
  const [showMore, setShowMore] = useState(false);
  const heatTone = metrics.avgHeat >= 70 ? 'bad' : metrics.avgHeat >= 58 ? 'warn' : 'good';
  const gapTone = metrics.equityGap > 8 ? 'bad' : metrics.equityGap > 3 ? 'warn' : 'good';
  const exposedTone = metrics.popExposed > 700 ? 'bad' : metrics.popExposed > 400 ? 'warn' : 'good';
  const vulnTone = metrics.vulnExposed > 250 ? 'bad' : metrics.vulnExposed > 120 ? 'warn' : 'good';
  return (
    <div className="panel metrics-panel">
      <h3 className="panel-title">当前态势 <span className="panel-sub">{HOUR_LABEL[hour]}</span></h3>

      {/* 只留四个最关键的数字 */}
      <div className="stat-grid">
        <Stat label="高暴露人数" value={metrics.popExposed} unit="人" tone={exposedTone} hint="地表热指数 ≥ 72 的地块上、处于户外的人。这是本关要降低的核心数字。" />
        <Stat label="其中脆弱群体" value={metrics.vulnExposed} unit="人" tone={vulnTone} hint="儿童 / 老人 / 户外劳动者 / 骑手。" />
        <Stat label="舒适度指数" value={metrics.comfort.toFixed(0)} tone={metrics.comfort > 40 ? 'good' : metrics.comfort > 20 ? 'warn' : 'bad'} hint="遮阴坐凳、饮水补给、风感等停留体验。" />
        <Stat label="遮阴覆盖" value={metrics.shadeCoverage.toFixed(0)} unit="%" tone={metrics.shadeCoverage > 45 ? 'good' : 'warn'} />
      </div>

      <button className="link-toggle" onClick={() => setShowMore((v) => !v)}>
        {showMore ? '收起其他指标 ▴' : '其他指标 ▾'}
      </button>

      {showMore && (
        <>
          <div className="stat-grid">
            <Stat label="加权平均热指数" value={metrics.avgHeat.toFixed(1)} tone={heatTone} hint="按户外人数加权的平均地表热指数（0–100，原型估算）" />
            <Stat label="酷热人数" value={metrics.dangerPop} unit="人" tone={metrics.dangerPop > 200 ? 'bad' : undefined} hint="地表热指数 ≥ 85 的地块上的人" />
            <Stat label="公平差" value={metrics.equityGap.toFixed(1)} unit="pp" tone={gapTone} hint="脆弱群体高暴露率 − 学生高暴露率（百分点）" />
            <Stat label="公众支持度" value={support(state)} tone={support(state) > 70 ? 'good' : undefined} />
          </div>
          <div className="group-summary">
            {GROUP_ORDER.map((g) => (
              <span key={g} className="group-chip" style={{ borderColor: GROUPS[g].color }}>
                <i style={{ background: GROUPS[g].color }} />{GROUPS[g].name}
              </span>
            ))}
          </div>
        </>
      )}

        <button className="primary ghost metrics-advice" onClick={onOpenAdvice}>
        💡 看看参谋建议 {adviceCount > 0 && <em className="badge">{adviceCount}</em>}
      </button>
    </div>
  );
}

/* ------------------------------ 任务目标 ------------------------------ */
export function ObjectivePanel({ level, state }: { level: Level; state: GameState }) {
  const evaluation = evaluate(state);
  return (
    <div className="panel">
      <h3 className="panel-title">任务目标 <span className="panel-sub">{level.name}</span></h3>
      {level.sandbox ? (
        <p className="muted">沙盒模式：没有验收线，自由尝试各种组合，观察不同人群的热暴露变化。</p>
      ) : (
        <ul className="goal-list">
          {evaluation.results.map((r) => {
            const pct = progressPercent(r.goal.op, r.value, r.goal.value);
            const met = isGoalMetLocal(r.goal.op, r.value, r.goal.value);
            return (
              <li key={r.goal.id} className={r.ok ? 'goal ok' : 'goal'}>
                <div className="goal-head">
                  <span className="goal-check">{r.ok ? '✓' : '○'}</span>
                  <span className="goal-label">{r.goal.label}</span>
                  {r.goal.core && <span className="goal-core">核心</span>}
                  {met && <span className="goal-met">已达标</span>}
                </div>
                <div className="goal-bar"><i style={{ width: `${pct}%` }} /></div>
                <div className="goal-foot">
                  <span>{r.goal.atHour ? `${r.goal.atHour}:00 验收` : '关卡末验收'}</span>
                  <span>当前 {fmtVal(r.goal.metric, r.value)} / 目标 {r.goal.op}{fmtVal(r.goal.metric, r.goal.value)}</span>
                </div>
                {r.goal.hint && <div className="goal-hint">{r.goal.hint}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * 任务进度条：按"目标本身"归一化，保证单调、可解释。
 *
 * 旧实现用"基线 → 目标"做 min-max 归一化，在目标已被基线满足时会直接返回 100%，
 * 于是第四关的公平差条一开局就是满的、之后怎么改都不动，看起来像坏了。
 * 具体规则见 lib/goalProgress.ts，那里有对应的单元测试。
 */
const progressPercent = goalProgress;
const isGoalMetLocal = isGoalMet;

function fmtVal(metric: string, v: number): string {
  if (metric === 'avgHeat' || metric === 'equityGap') return v.toFixed(1);
  if (metric === 'shadeCoverage' || metric === 'comfort') return v.toFixed(0);
  if (metric === 'budgetLeft') return `${v.toFixed(0)} 万`;
  return `${Math.round(v)}`;
}

/* ------------------------------ 参谋建议 ------------------------------ */
export function AdvicePanel({ advice, onPick, onClose, hour }: {
  advice: Suggestion[]; onPick: (s: Suggestion) => void; onClose: () => void; hour: Hour;
}) {
  return (
    <div className="panel advice-panel">
      <h3 className="panel-title">参谋建议 <span className="panel-sub">本地规则推理 · 非大模型生成</span></h3>
      <p className="muted small">
        依据 {hour}:00 的人群分布与地表热指数，按“热暴露下降 + 脆弱群体改善 + 舒适度提升 ÷ 造价”排序。
      </p>
      {advice.length === 0 ? (
        <p className="muted">当前回合已没有明显更优的地块了，可以推进时间，或换一种思路。</p>
      ) : (
        <ol className="advice-list">
          {advice.map((s, i) => (
            <li key={`${s.toolId}-${s.x}-${s.y}`}>
              <div className="advice-head">
                <span className="advice-rank">{i + 1}</span>
                <strong>{TOOLS[s.toolId].name}</strong>
                <span className="advice-cost">{s.cost} 万</span>
              </div>
              <div className="advice-loc">📍 {s.tileName}</div>
              <div className="advice-reason">{s.reason}</div>
              <button className="primary small" onClick={() => onPick(s)}>在地图上标出并采用</button>
            </li>
          ))}
        </ol>
      )}
      <button className="ghost small" onClick={onClose}>收起</button>
    </div>
  );
}

/* ------------------------------ 事件日志 ------------------------------ */
export function LogPanel({ state }: { state: GameState }) {
  const log = [...state.log].reverse().slice(0, 14);
  return (
    <div className="panel">
      <h3 className="panel-title">决策记录</h3>
      <ul className="log-list">
        {log.map((e) => (
          <li key={e.id} className={`log-${e.kind}`}>
            <span className="log-icon">{e.icon}</span>
            <span className="log-text">{e.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------ 地块详情 ------------------------------ */
export function TileInspector({ tile, hour, state, onClose }: {
  tile: Tile | null; hour: Hour; state: GameState; onClose: () => void;
}) {
  if (!tile) {
    return (
      <div className="panel inspector">
        <h3 className="panel-title">地块详情</h3>
        <p className="muted">点击地块查看地块的热指数、人群构成与已建设施。</p>
      </div>
    );
  }
  const i = tile.y * GRID + tile.x;
  const heat = heatField(state, hour)[i];
  const fields = computeFields(state);
  const groups = tileGroups(tile, hour);
  const total = tilePopulation(tile, hour);
  const outdoor = Math.round(total * tileOutdoor(tile, hour));
  const facilities = state.placements.filter((p) => p.x === tile.x && p.y === tile.y);
  const vuln = VULNERABLE_GROUPS.reduce((s, g) => s + groups[g], 0);

  return (
    <div className="panel inspector">
      <div className="inspector-head">
        <h3 className="panel-title">{tile.name}</h3>
        <button className="icon-btn" onClick={onClose} aria-label="关闭地块详情">×</button>
      </div>
      <div className="inspector-tags">
        <span className="tag">{TYPE_TAG[tile.type]}</span>
        <span className="tag">{PROFILES[tile.profile].tag}</span>
        {tile.landmark && <span className="tag gold">地标</span>}
      </div>
      <div className="inspector-heat" style={{ '--h': `${heat}%` } as CSSProperties}>
        <div className="heat-pill">
          <strong>{heat.toFixed(0)}</strong>
          <span>地表热指数 · {heatLabel(heat)}</span>
        </div>
        {heat >= HIGH_HEAT && <span className="danger-badge">高暴露</span>}
      </div>
      <div className="stat-grid tight">
        <Stat label="在场人数" value={total} unit="人" />
        <Stat label="户外暴露" value={outdoor} unit="人" />
        <Stat label="脆弱群体" value={Math.round(vuln)} unit="人" tone={vuln / Math.max(1, total) > 0.3 ? 'warn' : undefined} />
        <Stat label="遮阴降温" value={fields.shade[i].toFixed(1)} tone={fields.shade[i] > 3 ? 'good' : undefined} />
        <Stat label="蒸散降温" value={fields.evap[i].toFixed(1)} />
        <Stat label="舒适度" value={fields.comfort[i].toFixed(0)} tone={fields.comfort[i] > 20 ? 'good' : undefined} />
      </div>
      <div className="group-bars">
        {GROUP_ORDER.map((g) => {
          const pct = total > 0 ? (groups[g] / total) * 100 : 0;
          if (pct < 0.5) return null;
          return (
            <div key={g} className="group-bar">
              <span className="group-name" style={{ color: GROUPS[g].color }}>{GROUPS[g].short} {GROUPS[g].name}</span>
              <div className="bar"><i style={{ width: `${pct}%`, background: GROUPS[g].color }} /></div>
              <span className="group-pct">{pct.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
      <div className="inspector-placement">
        {facilities.length > 0
          ? <>已建设施：{facilities.map((f, k) => (
              <span key={k}>
                {k > 0 && '、'}
                <strong>{TOOLS[f.toolId].name}</strong>
                {f.fixed ? '（关卡自带）' : ''}
              </span>
            ))}</>
          : <span className="muted">这里还没有任何改造，选一个工具点这里就能放下第一处。</span>}
      </div>
    </div>
  );
}
