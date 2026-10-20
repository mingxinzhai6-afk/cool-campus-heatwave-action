import { HOUR_LABEL, type Hour } from '../data/campus';
import { LEVELS, WEATHER, type Level, type LevelEvent } from '../data/levels';
import { TOOLS } from '../data/tools';
import { evaluate, support, type Evaluation, type GameState, type Suggestion } from '../lib/engine';
import { LOGO_MARK } from '../lib/brand';
import { ToolGlyph } from './Toolbar';

/* ------------------------------ 关卡简报 ------------------------------ */
export function LevelIntro({ level, onStart }: { level: Level; onStart: () => void }) {
  const weather = WEATHER[level.startWeather];
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="关卡简报">
      <div className="modal intro-modal">
        <div className="intro-brand">
          <img className="intro-brand-mark" src={LOGO_MARK} alt="" width={46} height={46} />
          <div className="intro-brand-text">
            <strong>清凉一夏 · 热浪行动</strong>
            <span>校园微气候改善决策游戏 · 为最需要的人降温</span>
          </div>
        </div>

        <div className="intro-top">
          <div>
            <span className="intro-index">第 {level.index} 关 / {LEVELS.length}</span>
            <h2>{level.name}</h2>
            <p className="intro-tagline">{level.tagline}</p>
          </div>
          <div className="intro-weather">
            <span className="weather-icon">{weather.icon}</span>
            <div>
              <strong>{weather.name}</strong>
              <span>{weather.note}</span>
            </div>
          </div>
        </div>

        <p className="intro-story">☀️ {level.story}</p>

        <div className="intro-grid">
          <div className="intro-card">
            <h4>本关资源</h4>
            <ul className="intro-list">
              <li><span className="intro-ico">💰</span>预算 <strong>{level.budget} 万</strong></li>
              <li><span className="intro-ico">💧</span>水量 <strong>{level.waterSupply} 单位</strong></li>
              <li><span className="intro-ico">⏰</span>验收时刻 <strong>{level.hours.map((h) => HOUR_LABEL[h].slice(0, 5)).join(' / ')}</strong></li>
            </ul>
          </div>
          <div className="intro-card unlock-card">
            <h4>解锁奖励</h4>
            <div className="unlock-row">
              {level.unlock.map((t) => (
                <span key={t} className="unlock-chip" title={TOOLS[t].desc}>
                  <ToolGlyph toolId={t} size={22} />{TOOLS[t].name}
                </span>
              ))}
            </div>
          </div>
        </div>

        {!level.sandbox && (
          <div className="intro-goals">
            <div className="intro-goals-head">
              <h4>🎯 验收目标</h4>
              <div className="goal-legend">
                <span><i className="dot core" />核心目标</span>
                <span><i className="dot challenge" />挑战目标</span>
              </div>
            </div>
            <ul>
              {level.goals.map((g, i) => (
                <li key={g.id}>
                  <span className={`dot ${g.core ? 'core' : 'challenge'}`} />
                  {i + 1}: {g.label}
                </li>
              ))}
            </ul>
          </div>
        )}

        <button className="primary big" onClick={onStart}>进入处置 · 开始规划</button>
      </div>
    </div>
  );
}

export function VenueModal({ name, hours, selected, onToggle, onSave, onClose }: { name: string; hours: Hour[]; selected: Hour[]; onToggle: (hour: Hour) => void; onSave: () => void; onClose: () => void }) {
  return (
    <div className="modal-backdrop venue-backdrop" role="dialog" aria-modal="true" aria-label={`${name}开放设置`}>
      <div className="modal venue-modal">
        <div className="venue-mark">◫</div>
        <div className="venue-heading"><span className="intro-index">场馆设置</span><h2>{name}</h2><p>把室内空间变成高温时段的临时纳凉点</p></div>
        <div className="venue-note">开放后，场馆周边会获得舒适度与遮阴加成。你可以按人流和天气选择时段。</div>
        <div className="venue-hours">{hours.map((hour) => <button key={hour} className={selected.includes(hour) ? 'selected' : ''} onClick={() => onToggle(hour)}><b>{hour}:00</b><span>{hour < 12 ? '上午' : hour < 17 ? '高温时段' : '傍晚'}</span></button>)}</div>
        <div className="venue-actions"><button className="ghost" onClick={onClose}>暂不设置</button><button className="primary" onClick={onSave} disabled={selected.length === 0}>保存开放时段</button></div>
      </div>
    </div>
  );
}


/* ------------------------------ 参谋建议（弹窗） ------------------------------ */
export function AdviceModal({ advice, hour, onPick, onAutoPlan, onClose }: {
  advice: Suggestion[];
  hour: Hour;
  onPick: (s: Suggestion) => void;
  onAutoPlan: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop advice-backdrop" role="dialog" aria-modal="true" aria-label="参谋建议">
      <div className="modal advice-modal">
        <div className="venue-heading">
          <span className="intro-index">参谋建议</span>
          <h2>💡 推荐点位</h2>
          <p>本地规则推理 · 非大模型生成</p>
        </div>
        <div className="venue-note">
          依据 {hour}:00 的人群分布与地表热指数，按“热暴露下降 + 脆弱群体改善 + 舒适度提升 ÷ 造价”排序。
        </div>
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
        <div className="advice-actions">
          <button className="ghost" onClick={onClose}>返回</button>
          <button className="primary" onClick={onAutoPlan}>✦ 自动布置方案</button>
        </div>
      </div>
    </div>
  );
}


export function EventModal({ event, onChoose }: { event: Extract<LevelEvent, { kind: 'choice' }>; onChoose: (id: string) => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="现场事件">
      <div className="modal event-modal">
        <div className="event-icon">{event.icon}</div>
        <h2>{event.title}</h2>
        <p className="event-body">{event.body}</p>
        <p className="event-prompt">{event.prompt}</p>
        <div className="event-options">
          {event.choices.map((c) => (
            <button key={c.id} className="event-option" onClick={() => onChoose(c.id)}>
              <strong>{c.label}</strong>
              <span>{c.detail}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ 怎么玩 ------------------------------ */
export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="怎么玩">
      <div className="modal help-modal">
        <h2>三步上手</h2>
        <ol className="help-steps">
          <li>
            <strong>看两个数字</strong>
            <span>顶部「高暴露」是当前被晒到的人数，「脆弱群体」是其中最需要照顾的人（儿童 / 老人 / 户外劳动者 / 骑手）。把它们降下来就赢了。</span>
          </li>
          <li>
            <strong>放一个改造</strong>
            <span>点底部工具栏选一个（比如「遮阳棚」），鼠标移到地图上会显示效果预览，点一下就放下。预算和水量都是有限资源；靠近池塘或消防栓的需水设施可以就近取水。</span>
          </li>
          <li>
            <strong>推进时间看变化</strong>
            <span>点「推进到 14:00」，人群和热力会随时间变化。目标通常在某个时刻验收，达成后自动进入复盘。</span>
          </li>
        </ol>
        <div className="help-extras">
          <p>📚 <strong>纳凉场馆</strong>：直接点击地图上的图书馆或阅览馆，选择它开放的高温时段；不需要等到事件弹窗。</p>
          <p>🔭 <strong>转视角</strong>：拖动地图右下角的滑块可任意角度旋转（或按 Q / E 微调 15°），被高楼挡住的地块换个角度就能点到。</p>
          <p>✦ <strong>方案建议</strong>：点「自动布置方案」，系统会按任务目标自动铺好一套直接达标的方案，不用再手动调整。</p>
          <p>🎯 <strong>重点区域</strong>：开局的黄色虚线圈就是本关最该处理的地方，放下第一处改造后自动消失。</p>
        </div>
        <button className="primary big" onClick={onClose}>知道了，开始</button>
      </div>
    </div>
  );
}
export function LevelResult({ state, evaluation, onNext, onRetry, onPlan, hasNext }: {
  state: GameState; evaluation: Evaluation; onNext: () => void; onRetry: () => void; onPlan: () => void; hasNext: boolean;
}) {
  const level = evaluation.level;
  const results = evaluate(state).results;
  // 两星及以下先留在本关：鼓励重做一次，并提示可以用「自动布置方案」直接铺出达标方案
  const canAdvance = evaluation.stars >= 3;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="推演复盘">
      <div className="modal result-modal">
        <div className="stars">
          {[1, 2, 3].map((i) => (
            <span key={i} className={`star ${evaluation.stars >= i ? 'filled' : ''}`} style={{ animationDelay: `${i * 0.12}s` }}>★</span>
          ))}
        </div>
        <h2>{evaluation.headline}</h2>
        <p className="result-detail">{evaluation.detail}</p>
        <p className="result-score">得分 {evaluation.earned} / {evaluation.max}{evaluation.max > 0 ? `（${Math.round(evaluation.ratio * 100)}%）` : ''} · 公众支持度 {support(state)}</p>

        {!level.sandbox && (
          <ul className="result-goals">
            {results.map((r) => (
              <li key={r.goal.id} className={r.ok ? 'ok' : 'fail'}>
                <span className="goal-check">{r.ok ? '✓' : '✗'}</span>
                <span className="goal-label">{r.goal.label}</span>
                <span className="goal-val">{r.value.toFixed(1)} / {r.goal.op}{r.goal.value}{r.goal.core ? ' · 核心' : ''}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="result-lesson">💡 {level.lesson}</div>

        {!canAdvance && (
          <p className="result-encourage">
            💪 还差一点，先别急着下一关！点「重做本关」回到地图，再按「✦ 自动布置方案」试试——
            它会按任务目标一次铺好整套方案，拿到 3 星就能进入下一关。
          </p>
        )}

        <div className="result-actions">
          <button className="ghost" onClick={onRetry}>重做本关</button>
          <button className="ghost" onClick={onPlan}>查看行动清单</button>
          {hasNext && (
            <button
              className="primary"
              onClick={onNext}
              disabled={!canAdvance}
              title={canAdvance ? undefined : '本关拿到 3 星后才能进入下一关'}
            >
              进入下一关 →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
