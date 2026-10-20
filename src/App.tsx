import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import IsoMap, { type Layers } from './components/IsoMap';
import Toolbar from './components/Toolbar';
import { LayerPanel, LogPanel, MetricsPanel, ObjectivePanel, TileInspector, TimeArc } from './components/Panels';
import { AdviceModal, EventModal, HelpModal, LevelIntro, LevelResult, VenueModal } from './components/Modals';
import { MpNavbar, MpStatusBar } from './components/MpChrome';
import { MethodPage, PlanPage } from './components/Pages';
import TutorialOverlay from './components/TutorialOverlay';
import { TUTORIAL_STEPS, TUTORIAL_TRIGGERS, type TutorialAction } from './data/tutorial';
import { tileAtFor, type Hour } from './data/campus';
import { LEVELS, getLevel } from './data/levels';
import { TOOL_ORDER, TOOLS, type ToolId } from './data/tools';
import { Ambience } from './lib/audio';
import { LOGO_MARK } from './lib/brand';
import { buildFeedback, buildRemovalFeedback, type Feedback } from './lib/feedback';
import {
  advance, advise, autoPlan, budgetLeft, canPlace, computeMetrics, configureRefuge, createState,
  currentHour, evaluate, heatField, place, removeAt, resolveChoice, resumeLevel, undo, waterLeft,
  vulnerableHotCount,
  type GameState, type Suggestion,
} from './lib/engine';
import { HIGH_HEAT } from './data/groups';
import { GRID } from './data/campus';

type Route = '/' | '/method' | '/plan';

export default function App() {
  const [route, setRoute] = useState<Route>(() => normalizeRoute(window.location.pathname));
  const [levelId, setLevelId] = useState('l1');
  const [state, setState] = useState<GameState>(() => createState('l1'));
  const [toolId, setToolId] = useState<ToolId | null>(null);
  const [removeMode, setRemoveMode] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState<{ x: number; y: number } | null>(null);
  /** 参谋建议里「在地图上标出并采用」的点位（地图上的红钉 📍）。 */
  const [pickMark, setPickMark] = useState<{ x: number; y: number } | null>(null);
  /** 两式放置的中间态：点第一下选中的地块（预览卡固定在这里，再点同一块地才放下）。 */
  const [previewPin, setPreviewPin] = useState<{ x: number; y: number } | null>(null);
  const [layers, setLayers] = useState<Layers>({ heat: true, shade: false, people: false, sensitive: false });
  const [adviceOpen, setAdviceOpen] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [showResult, setShowResult] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [rotation, setRotation] = useState(0);
  // 拖动视角滑条时：滑条本身走快速通道（每帧都跟手），整张地图的旋转渲染降级为
  // 可中断的低优先级更新——手机上不会因为地图重绘把拖动卡住。外观没有任何变化。
  const deferredRotation = useDeferredValue(rotation);
  const [audioOn, setAudioOn] = useState(false);
  const [showControlMenu, setShowControlMenu] = useState(false);
  const [mobileTab, setMobileTab] = useState<'map' | 'stats' | 'goals' | 'info'>('map');
  const [toast, setToast] = useState<string | null>(null);
  /** 重要提示（如"图层暂无匹配地块"的解释）：更大、更久，区别于普通小提示。 */
  const [toastImportant, setToastImportant] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [venue, setVenue] = useState<{ x: number; y: number; name: string } | null>(null);
  const [refugeDraft, setRefugeDraft] = useState<Hour[]>([]);

  const audioRef = useRef<Ambience | null>(null);
  /** 每关各自的推演进度：重做本关、切关再回来时，回到玩家原来的界面（见 openLevel）。 */
  const levelStatesRef = useRef<Record<string, GameState>>({});
  /** 已通关（拿到 3 星）的关卡：一次性成就，「重做本关」把推演重置了也照样记着。 */
  const passedRef = useRef<Set<string>>(new Set());
  const level = getLevel(levelId);
  const hour = currentHour(state);

  /* ---------------- 新手引导 ---------------- */
  // 首次打开作品自动进入引导；老玩家可用控制台里的「新手引导」重新播放
  const [tutStep, setTutStep] = useState<number | null>(0);
  const tutActive = tutStep !== null && !showIntro;
  const startTutorial = useCallback(() => {
    setTutStep(0);
    setShowHelp(false);
  }, []);
  const endTutorial = useCallback(() => setTutStep(null), []);

  /** 玩家完成了某个动作后，若正卡在对应的那一步，就自动推进到下一步。 */
  const notifyTutorial = useCallback((action: TutorialAction) => {
    setTutStep((cur) => {
      if (cur === null) return null;
      // 越界保护：教程数据被改动（增加/重排步骤）时不应抛错
      const step = TUTORIAL_STEPS[cur];
      if (!step) return null;
      return TUTORIAL_TRIGGERS[step.id]?.includes(action) ? cur + 1 : cur;
    });
  }, []);

  /* ---------------- 路由 ---------------- */
  const nav = useCallback((r: Route) => {
    // 免安装试玩包用 file:// 打开时，pushState 到绝对路径会被浏览器拒绝：
    // 失败也不影响切页，只是地址栏不变（返回键在本地文件模式下不可用）。
    try {
      window.history.pushState({}, '', r);
    } catch {
      /* file:// 下忽略地址变化 */
    }
    setRoute(r);
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(normalizeRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /* ---------------- 手机 / 窄屏：完整三栏小程序等比缩放到一屏 ---------------- */
  // ≤1080px 不做标签页布局，而是把「左栏 + 地图 + 右栏 + 工具坞」整块 16:10 设计稿
  // （1180×737.5）等比缩放进视口：三栏与地图同屏可见；竖屏自动旋转 90° 成横屏。
  // 状态走 React（写进根节点 className）——命令式 classList 会被后续重渲染覆盖，
  // 那样选中工具（根节点类名切换）时缩放/旋转就会丢失、界面"跳回竖屏"。
  const [phoneMode, setPhoneMode] = useState<'off' | 'fit' | 'rot90'>('off');
  useLayoutEffect(() => {
    const DESIGN_W = 1180;
    const DESIGN_H = 737.5;
    const apply = () => {
      const el = document.querySelector('.app') as HTMLElement | null;
      if (!el) return;
      const narrow = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1080px)').matches;
      if (!narrow) {
        setPhoneMode('off');
        el.style.removeProperty('--fit-scale');
        return;
      }
      const portrait = window.innerHeight > window.innerWidth;
      const s = portrait
        ? Math.min(window.innerWidth / DESIGN_H, window.innerHeight / DESIGN_W)
        : Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
      setPhoneMode(portrait ? 'rot90' : 'fit');
      el.style.setProperty('--fit-scale', s.toFixed(4));
    };
    apply();
    // 手机浏览器地址栏收放会引发细碎的 resize：防抖后再重算，避免拖动过程中
    // 整块小程序被反复重新缩放（旋转、真正改尺寸时 150ms 后照样生效）。
    let timer: number | null = null;
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(apply, 150);
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
    };
  }, []);

  /* ---------------- 手机端：首次触控自动全屏（隐藏地址栏）+ 尝试锁定横屏 ---------------- */
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(max-width: 1080px) and (pointer: coarse)').matches) return;
    const onFirstTouch = () => {
      const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
      try {
        el.requestFullscreen?.()
          .then(() => {
            const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
            orientation.lock?.('landscape').catch(() => { /* iOS 等不支持时忽略 */ });
          })
          .catch(() => { /* 环境不支持或用户拒绝时保持现状 */ });
      } catch { /* 忽略 */ }
      window.removeEventListener('pointerdown', onFirstTouch, true);
    };
    window.addEventListener('pointerdown', onFirstTouch, true);
    return () => window.removeEventListener('pointerdown', onFirstTouch, true);
  }, []);

  /* ---------------- 派生态 ---------------- */
  const metrics = useMemo(() => computeMetrics(state, hour), [state, hour]);
  const evaluation = useMemo(() => evaluate(state), [state]);
  const advice = useMemo<Suggestion[]>(
    () => (adviceOpen ? advise(state, hour) : []),
    [adviceOpen, state, hour],
  );
  const adviceMark = advice[0] ? { x: advice[0].x, y: advice[0].y } : null;

  /* ---------------- 音频 ---------------- */
  useEffect(() => {
    if (!audioRef.current) audioRef.current = new Ambience();
    if (audioOn) void audioRef.current.start();
    audioRef.current.setMuted(!audioOn);
  }, [audioOn]);

  useEffect(() => {
    audioRef.current?.setIntensity(Math.max(0, Math.min(1, (metrics.avgHeat - 40) / 45)));
  }, [metrics.avgHeat]);

  const blip = useCallback((kind: Parameters<Ambience['blip']>[0]) => {
    audioRef.current?.blip(kind);
  }, []);

  /* ---------------- 结算弹窗 ---------------- */
  useEffect(() => {
    if (state.finished) {
      setShowResult(true);
      blip('star');
    }
  }, [state.finished, blip]);

  /* 已结算后从行动清单等页面回到推演：重新弹出复盘。
     否则 finished=true 会让推进按钮禁用，而复盘弹窗又不会重现，玩家将无法再看到结算结果。 */
  useEffect(() => {
    if (route === '/' && state.finished) setShowResult(true);
  }, [route, state.finished]);

  /* 任何推演变化都同步进本关缓存：切关再回来、重做本关时才能原样恢复玩家界面。 */
  useEffect(() => {
    levelStatesRef.current[levelId] = state;
  }, [levelId, state]);

  /* 结算达到 3 星即记为「已通关」（粘性，不受之后「重做本关」影响）。 */
  useEffect(() => {
    if (state.finished && evaluate(state).stars >= 3) passedRef.current.add(levelId);
  }, [levelId, state]);

  /* ---------------- 操作 ---------------- */
  /** 打开某一关：玩过就回到该关原来的界面（每关进度独立保留），没玩过才新建并弹关卡简报。 */
  const openLevel = useCallback((id: string) => {
    const saved = levelStatesRef.current[id];
    setLevelId(id);
    setState(saved ?? createState(id));
    setToolId(null);
    setRemoveMode(false);
    setPinned(null);
    setPickMark(null);
    setAdviceOpen(false);
    setShowResult(false);
    setVenue(null);
    setShowIntro(!saved);
    setMobileTab('map');
    if (audioRef.current) { void audioRef.current.start(); audioRef.current.setMuted(!audioOn); }
  }, [audioOn]);

  /** 重做本关：地图改造清空、时刻与预算复位，决策记录保留（见 engine.resumeLevel）。 */
  const handleRedo = useCallback(() => {
    setShowResult(false);
    setState((s) => resumeLevel(s));
  }, []);

  /** 通关进度：拿到 3 星才算通关。控制台最多只能切到「最高已通关关卡 + 1」，
      没通关不能跳到后面的关卡（与结算页「3 星才能进入下一关」一致）。 */
  const unlockedMax = useMemo(() => {
    let maxPassed = 0;
    for (const l of LEVELS) {
      if (passedRef.current.has(l.id)) maxPassed = Math.max(maxPassed, l.index);
    }
    return Math.min(maxPassed + 1, LEVELS.length);
  }, [levelId, state]);

  const handleTileClick = useCallback((x: number, y: number) => {
    if (removeMode) {
      const target = state.placements.find((p) => p.x === x && p.y === y);
      if (target) {
        const before = computeMetrics(state, hour);
        const next = removeAt(state, x, y);
        if (next !== state) {
          setFeedback(buildRemovalFeedback(before, computeMetrics(next, hour), {
            toolName: TOOLS[target.toolId].name,
            tileName: tileAtFor(state.levelId, x, y)?.name ?? '地块',
          }));
          blip('remove');
        }
        setState(next);
      }
      return;
    }
    if (toolId) {
      // 两式放置（手机与电脑统一）：点第一下弹预览卡，点第二下（同一块地）才放下
      if (!(previewPin && previewPin.x === x && previewPin.y === y)) {
        setPreviewPin({ x, y });
        return;
      }
      const check = canPlace(state, toolId, x, y);
      if (!check.ok) { setToast(check.reason ?? '无法在此放置'); blip('error'); setPreviewPin(null); return; }
      const before = computeMetrics(state, hour);
      const next = place(state, toolId, x, y);
      setPreviewPin(null);
      if (next !== state) {
        const after = computeMetrics(next, hour);
        // 改造后该地块的热指数：用引擎算出的热力场取这一格
        const heatAfter = heatField(next, hour)[y * GRID + x];
        const heatBefore = heatField(state, hour)[y * GRID + x];
        setFeedback(buildFeedback(before, after, {
          toolName: TOOLS[toolId].name,
          tileName: tileAtFor(state.levelId, x, y)?.name ?? '地块',
          tileWasExposed: heatBefore >= HIGH_HEAT,
          tileHeatAfter: heatAfter,
        }));
        blip('place');
        notifyTutorial('toolPlaced');
        // 放下任一处改造后，红钉即完成使命
        setPickMark(null);
      }
      setState(next);
      return;
    }
    setPinned({ x, y });
    const tile = tileAtFor(state.levelId, x, y);
    if (tile?.name.includes('图书馆') || tile?.name.includes('阅览馆')) {
      setVenue({ x, y, name: tile.name });
      setRefugeDraft(state.refugeHours.length ? state.refugeHours : level.hours);
      notifyTutorial('venueOpened');
    }
  }, [removeMode, toolId, state, hour, level.hours, blip, notifyTutorial, previewPin]);

  const handleAdvance = useCallback(() => {
    setState((s) => {
      if (s.pendingEvent || s.finished) return s;
      return advance(s);
    });
    setToolId(null);
    blip('advance');
    notifyTutorial('advanced');
  }, [blip, notifyTutorial]);

  const handleChoose = useCallback((id: string) => {
    setState((s) => resolveChoice(s, id));
  }, []);

  const handleUndo = useCallback(() => {
    setState((s) => undo(s));
    blip('remove');
  }, [blip]);

  const handleAdvicePick = useCallback((s: Suggestion) => {
    setToolId(s.toolId);
    setPreviewPin(null);
    setPinned({ x: s.x, y: s.y });
    setPickMark({ x: s.x, y: s.y });
    setAdviceOpen(false);
    setMobileTab('map');
    notifyTutorial('advicePicked');
  }, [notifyTutorial]);

  const rotate = useCallback((delta: number) => {
    setRotation((r) => ((r + delta) % 360 + 360) % 360);
    setHover(null);
    notifyTutorial('rotated');
  }, [notifyTutorial]);

  const handleVenueSave = useCallback(() => {
    setState((s) => configureRefuge(s, refugeDraft));
    setVenue(null);
    setToast(`已安排 ${refugeDraft.map((h) => `${h}:00`).join('、')} 开放纳凉`);
    notifyTutorial('venueConfigured');
  }, [refugeDraft, notifyTutorial]);

  const handleAutoPlan = useCallback(() => {
    setState((s) => autoPlan(s, currentHour(s)));
    setAdviceOpen(false);
    blip('place');
    notifyTutorial('advicePlanned');
  }, [blip, notifyTutorial]);

  /* ---------------- 键盘 ---------------- */
  useEffect(() => {
    if (route !== '/' || showIntro || state.pendingEvent) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key === 'u' || e.key === 'U') { handleUndo(); return; }
      if (e.key === 'q' || e.key === 'Q') { rotate(-15); return; }
      if (e.key === 'e' || e.key === 'E') { rotate(15); return; }
      if (e.key === 'Enter') { handleAdvance(); return; }
      const n = Number(e.key);
      if (n >= 1 && n <= TOOL_ORDER.length) {
        const id = TOOL_ORDER[n - 1];
        if (level.unlock.includes(id)) { setToolId(id); setRemoveMode(false); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route, showIntro, state.pendingEvent, handleUndo, handleAdvance, rotate, level.unlock]);

  useEffect(() => {
    if (!toast) return;
    // 停留时长与普通提示一致（1.8s）；醒目性靠样式（top 大卡片）而非更久
    const t = setTimeout(() => { setToast(null); setToastImportant(false); }, 1800);
    return () => clearTimeout(t);
  }, [toast, toastImportant]);

  // 换工具/收起工具：清掉两式放置的预览中间态；红钉在取消选中后收起
  useEffect(() => {
    setPreviewPin(null);
    if (!toolId) setPickMark(null);
  }, [toolId]);

  // 操作反馈：停留 5 秒后自动收起（与小程序端一致）
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(t);
  }, [feedback]);

  // 切换关卡时清掉上一条反馈
  useEffect(() => {
    setFeedback(null);
  }, [levelId]);

  /* ---------------- 放置预览 ---------------- */
  const preview = useMemo(() => {
    // 点过第一下后，预览卡固定在被点中的地块上；否则跟随鼠标悬停
    const point = previewPin ?? hover;
    if (!toolId || !point) return null;
    const check = canPlace(state, toolId, point.x, point.y);
    if (!check.ok) return { ok: false as const, reason: check.reason ?? '' };
    const before = metrics;
    const after = computeMetrics(place(state, toolId, point.x, point.y), hour);
    return { ok: true as const, before, after, tile: tileAtFor(state.levelId, point.x, point.y) };
  }, [toolId, previewPin, hover, state, hour, metrics]);

  /* ---------------- 页面路由 ---------------- */
  const mpShellClass = `app${phoneMode !== 'off' ? ' phone-fit' : ''}${phoneMode === 'rot90' ? ' rot-90' : ''}`;
  if (route === '/method') {
    return (
      <div className={mpShellClass}>
        <MpStatusBar hour={hour} />
        <MpNavbar title="方法与边界" onBack={() => nav('/')} />
        <div className="mp-page-body"><MethodPage onBack={() => nav('/')} /></div>
      </div>
    );
  }
  if (route === '/plan') {
    return (
      <div className={mpShellClass}>
        <MpStatusBar hour={hour} />
        <MpNavbar title="行动清单" onBack={() => nav('/')} />
        <div className="mp-page-body">
          <PlanPage state={state} onBack={() => nav('/')} onNextLevel={() => { if (level.index < LEVELS.length) { openLevel(LEVELS[level.index].id); nav('/'); } }} />
        </div>
      </div>
    );
  }

  // 地块详情只跟随「点击选中」的地块：悬停不再弹出详情，避免鼠标扫过时信息乱跳
  const inspectedTile = pinned ? tileAtFor(state.levelId, pinned.x, pinned.y) ?? null : null;
  const nextHour = level.hours[state.round + 1];
  const isLastRound = state.round >= level.hours.length - 1;

  return (
      <div className={`${mpShellClass} ${toolId ? 'placing' : ''}`}>
      {/* —— 横版小程序外壳：状态栏 + 导航栏（返回/标题/微信风格胶囊） —— */}
      <MpStatusBar hour={hour} />
      <MpNavbar title="热浪行动" />

      {/* ============ 顶栏 ============ */}
      <header className="hud">
        <div className="hud-brand" onClick={() => nav('/')} title="返回关卡选择">
          <img className="brand-mark" src={LOGO_MARK} alt="" width={46} height={46} />
          <div className="hud-brand-text">
            <strong className="hud-brand-title">清凉一夏</strong>
            <span className="hud-brand-sub">热浪行动 · 校园微气候策略</span>
          </div>
        </div>

        <div className="hud-stats">
          <span className={`hud-pill ${budgetLeft(state) < 6 ? 'warn' : ''}`}><small>预算</small> <b>{budgetLeft(state)}</b> 万</span>
          <span className={`hud-pill ${metrics.popExposed > 700 ? 'bad' : ''}`}><small>高暴露</small> <b>{metrics.popExposed}</b> 人</span>
          <span className={`hud-pill ${metrics.vulnExposed > 250 ? 'bad' : ''}`} title="儿童 / 老人 / 户外劳动者 / 骑手"><small>脆弱群体</small> <b>{metrics.vulnExposed}</b> 人</span>
          <span className={`hud-pill water-pill ${waterLeft(state) <= level.waterSupply * 0.25 ? 'low' : ''}`} title="靠近水池与消防栓的设施不耗水，远处需水设施会消耗本关水量"><small>💧水源</small> <b>{waterLeft(state).toFixed(1)}</b> / {level.waterSupply}</span>
        </div>

        <button
          className={`control-trigger ${showControlMenu ? 'active' : ''}`}
          onClick={() => setShowControlMenu((v) => !v)}
          aria-expanded={showControlMenu}
          aria-controls="control-menu"
        >
          <span className="control-trigger-icon">⌘</span><span>控制台</span><span className="control-chevron">{showControlMenu ? '⌃' : '⌄'}</span>
        </button>

        {showControlMenu && (
          <div className="control-menu" id="control-menu">
            <div className="control-menu-head"><div><strong>控制台</strong><span>把不常用的操作收在这里</span></div><button className="control-close" onClick={() => setShowControlMenu(false)} aria-label="关闭控制台">×</button></div>
            <div className="control-section">
              <span className="control-label">选择场景</span>
              <div className="control-levels">{LEVELS.map((l) => {
                const locked = l.index > unlockedMax;
                return (
                  <button
                    key={l.id}
                    className={`${l.id === levelId ? 'active' : ''} ${locked ? 'locked' : ''}`}
                    disabled={locked}
                    title={locked ? '先通关上一关（拿到 3 星）才能解锁' : undefined}
                    onClick={() => { openLevel(l.id); setShowControlMenu(false); }}
                  >
                    <b>{String(l.index).padStart(2, '0')}</b><span>{l.name}</span>{locked ? <em className="level-lock">🔒</em> : null}
                  </button>
                );
              })}</div>
            </div>
            <div className="control-section control-actions">
              <span className="control-label">地图与推演</span>
              <div className="control-action-grid">
                <button onClick={() => setLayers((l) => ({ ...l, heat: !l.heat }))}><span>◌</span>热力层</button>
                <button onClick={() => setLayers((l) => ({ ...l, shade: !l.shade }))}><span>◇</span>遮阴层</button>
                <button onClick={() => rotate(-15)}><span>↺</span>左转 15°</button>
                <button onClick={() => rotate(15)}><span>↻</span>右转 15°</button>
                <button onClick={() => { handleAutoPlan(); setShowControlMenu(false); }}><span>✦</span>自动规划</button>
                <button onClick={() => { setShowHelp(true); setShowControlMenu(false); }}><span>?</span>玩法说明</button>
                <button onClick={() => { openLevel(levelId); setShowControlMenu(false); startTutorial(); }}><span>🎓</span>新手引导</button>
              </div>
            </div>
            <div className="control-footer">
              <button onClick={() => setAudioOn((v) => !v)}>{audioOn ? '◉ 声音已开' : '○ 声音已关'}</button>
              <button onClick={() => { nav('/method'); setShowControlMenu(false); }}>方法与边界</button>
              <button onClick={() => { nav('/plan'); setShowControlMenu(false); }}>行动清单</button>
            </div>
          </div>
        )}
      </header>

      {/* ============ 主体 ============ */}
      <main className="stage">
        <aside className={`side left ${mobileTab === 'stats' ? 'show' : ''}`}>
          <div className="side-inner">
            <div className="round-card">
              <TimeArc hours={level.hours} hour={hour} />
              <button
                className="primary"
                onClick={state.finished ? () => setShowResult(true) : handleAdvance}
                disabled={!state.finished && !!state.pendingEvent}
              >
                {state.finished ? '查看结算复盘' : isLastRound ? '结束推演 · 生成复盘' : `推进到 ${nextHour}:00 →`}
              </button>
              <p className="round-note">改造可以随时放置，没有回合限制；推进时间只是看看人群和热力怎么变。</p>
            </div>

            <MetricsPanel state={state} metrics={metrics} hour={hour} onOpenAdvice={() => { setAdviceOpen(true); notifyTutorial('adviceOpened'); }} adviceCount={advice.length} />
            <button className="primary ghost auto-plan-btn" onClick={handleAutoPlan} disabled={state.finished}>
              ✦ 自动布置方案
            </button>
            <LayerPanel layers={layers} onToggle={(k) => {
              const turningOn = !layers[k];
              setLayers((l) => ({ ...l, [k]: !l[k] }));
              // 脆弱群体图层在多数关卡天然为空（他们多在树荫处）——打开时空图层会像"坏了"，给一句解释
              if (k === 'sensitive' && turningOn && vulnerableHotCount(state, hour) === 0) {
                setToast('🌿 本时刻没有「脆弱群体聚集且受热」的地块——他们大多在树荫处；第 4 关这个图层会非常关键');
                setToastImportant(true);
              }
              notifyTutorial('layerToggled');
            }} />
          </div>
        </aside>

        <section className={`map-area ${mobileTab === 'map' ? 'show' : ''}`}>
          <IsoMap
            levelId={levelId}
            state={state}
            hour={hour}
            layers={layers}
            toolId={toolId}
            hover={hover}
            adviceMark={adviceMark}
            pickMark={pickMark}
            focus={level.focus}
            rotation={deferredRotation}
            onHover={setHover}
            onTileClick={handleTileClick}
          />

          <div className="view-controls">
            <button onClick={() => rotate(-15)} title="逆时针微调" aria-label="逆时针旋转">↺</button>
            <div className="view-slider">
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={rotation}
                onChange={(e) => {
                  setRotation(Number(e.target.value) % 360);
                  setHover(null);
                  // 引导第 4 步就是教"拖这条滑块转视角"，拖动本身必须算完成任务
                  notifyTutorial('rotated');
                }}
                aria-label="地图旋转角度"
              />
              <span className="view-angle">{Math.round(rotation)}°</span>
            </div>
            <button onClick={() => rotate(15)} title="顺时针微调" aria-label="顺时针旋转">↻</button>
            <button className="view-reset" onClick={() => { setRotation(0); setHover(null); notifyTutorial('rotated'); }} title="回到正北朝向" aria-label="重置视角">⌂</button>
          </div>

          {/* 开局标出本关重点；地图自带的预设设施（fixed）不算“已经放置”，放下第一处新改造后才消失 */}
          {level.focus.length > 0 && state.placements.every((p) => p.fixed) && !state.finished && (
            <div className="focus-hint">
              🎯 本关重点：{level.focus.map((f) => f.label).join(' · ')}
            </div>
          )}

          {toolId && (
            <div className="placing-hint">
              <span className="dot-pulse" /> 正在放置：<strong>{TOOLS[toolId].name}</strong>
              <span className="muted">点一下地块看预览 · 再点一下放下 · 再点工具取消</span>
            </div>
          )}

          {/* —— 操作反馈卡：每次放置/拆除后给出人话点评（贴在地图左上角） —— */}
          {feedback && (
            <div className={`feedback-card tone-${feedback.tone}`} role="status" aria-live="polite">
              <div className="feedback-head">
                <span className="feedback-icon">{feedback.icon}</span>
                <strong className="feedback-title">{feedback.title}</strong>
                <button className="feedback-close" onClick={() => setFeedback(null)} aria-label="关闭提示">×</button>
              </div>
              <p className="feedback-detail">{feedback.detail}</p>
              {feedback.next && <p className="feedback-next">💡 {feedback.next}</p>}
            </div>
          )}

          {preview && (
            <div className={`preview-card ${preview.ok ? '' : 'invalid'}`}>
              {preview.ok ? (
                <>
                  <div className="preview-head">
                    <strong>{TOOLS[toolId!].name}</strong>
                    <span>→ {preview.tile?.name}</span>
                  </div>
                  <Delta label="加权热指数" value={preview.before.avgHeat - preview.after.avgHeat} unit="" digits={1} good />
                  <Delta label="户外高暴露" value={preview.before.popExposed - preview.after.popExposed} unit="人" digits={0} good />
                  <Delta label="脆弱高暴露" value={preview.before.vulnExposed - preview.after.vulnExposed} unit="人" digits={0} good />
                  <Delta label="公平差" value={preview.before.equityGap - preview.after.equityGap} unit="pp" digits={1} good />
                  <Delta label="舒适度" value={preview.after.comfort - preview.before.comfort} unit="" digits={0} good />
                  <div className="preview-foot">花费 {TOOLS[toolId!].cost} 万 · 半径 {TOOLS[toolId!].radius} 格</div>
                </>
              ) : (
                <div className="preview-head invalid-text">✕ {preview.reason}</div>
              )}
            </div>
          )}

          {state.pendingEvent && <div className="map-dim" />}
        </section>


        <aside className={`side right ${mobileTab === 'goals' || mobileTab === 'info' ? 'show' : ''}`}>
          <div className="side-inner">
            <ObjectivePanel level={level} state={state} />
            <TileInspector tile={inspectedTile} hour={hour} state={state} onClose={() => setPinned(null)} />
            <LogPanel state={state} />
          </div>
        </aside>

        <Toolbar
          state={state}
          selected={toolId}
          removeMode={removeMode}
              onSelect={(t) => { setToolId(t); setRemoveMode(false); setPreviewPin(null); notifyTutorial('toolSelected'); }}
              onToggleRemove={() => { setRemoveMode((v) => !v); setToolId(null); setPreviewPin(null); }}
          onUndo={handleUndo}
          canUndo={state.past.length > 0}
        />
      </main>

      {/* ============ 移动端标签栏 ============ */}
      <nav className="mobile-tabs">
        {([['map', '🗺 地图'], ['stats', '📊 态势'], ['goals', '🎯 目标'], ['info', '📋 记录']] as const).map(([k, label]) => (
          <button key={k} className={mobileTab === k ? 'active' : ''} onClick={() => setMobileTab(k)}>{label}</button>
        ))}
      </nav>

      {/* ============ 弹层 ============ */}
      {showIntro && <LevelIntro level={level} onStart={() => { setShowIntro(false); setAudioOn(true); }} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {venue && <VenueModal name={venue.name} hours={level.hours} selected={refugeDraft} onToggle={(h) => setRefugeDraft((current) => current.includes(h) ? current.filter((v) => v !== h) : [...current, h].sort())} onSave={handleVenueSave} onClose={() => setVenue(null)} />}
      {adviceOpen && !showIntro && (
        <AdviceModal
          advice={advice}
          hour={hour}
          onPick={handleAdvicePick}
          onAutoPlan={handleAutoPlan}
          onClose={() => { setAdviceOpen(false); notifyTutorial('adviceClosed'); }}
        />
      )}
      {state.pendingEvent && state.pendingEvent.kind === 'choice' && !showIntro && (
        <EventModal event={state.pendingEvent} onChoose={handleChoose} />
      )}
      {showResult && !showIntro && (
        <LevelResult
          state={state}
          evaluation={evaluation}
          hasNext={level.index < LEVELS.length}
          onNext={() => openLevel(LEVELS[Math.min(level.index, LEVELS.length - 1)].id)}
          onRetry={handleRedo}
          onPlan={() => { setShowResult(false); nav('/plan'); }}
        />
      )}

      {toast && <div className={toastImportant ? 'toast toast-important' : 'toast'}>{toast}</div>}

      {/* —— 新手引导 —— */}
      {tutActive && tutStep !== null && tutStep < TUTORIAL_STEPS.length && (
        <TutorialOverlay
          step={TUTORIAL_STEPS[tutStep]}
          index={tutStep}
          total={TUTORIAL_STEPS.length}
          onSkip={endTutorial}
          onPrev={() => setTutStep((s) => Math.max(0, (s ?? 0) - 1))}
          onNext={() => setTutStep((s) => {
            const next = (s ?? 0) + 1;
            return next >= TUTORIAL_STEPS.length ? null : next;
          })}
        />
      )}

      </div>
  );
}

function Delta({ label, value, unit, digits, good }: { label: string; value: number; unit: string; digits: number; good?: boolean }) {
  const positive = value > 0.0001;
  const negative = value < -0.0001;
  const cls = positive && good ? 'up' : negative && good ? 'down-bad' : 'flat';
  return (
    <div className={`delta ${cls}`}>
      <span>{label}</span>
      <strong>{positive ? '↓' : negative ? '↑' : '·'} {Math.abs(value).toFixed(digits)}{unit}</strong>
    </div>
  );
}

function normalizeRoute(path: string): Route {
  if (path.startsWith('/method')) return '/method';
  if (path.startsWith('/plan')) return '/plan';
  return '/';
}
