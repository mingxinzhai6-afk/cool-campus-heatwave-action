/**
 * 清凉校园 · 热浪行动 —— 小程序原生游戏页
 *
 * 规则、渲染与主项目完全同源：
 *   - 引擎与数据：../core/**（由主项目 tsc -p tsconfig.mp.json 编译，勿手改）
 *   - 地图：../render/**（Canvas 版等轴渲染器 + 命中测试）
 * 本文件只负责页面状态、界面数据与交互编排。
 */
const engine = require('../../core/lib/engine.js');
const levelsMod = require('../../core/data/levels.js');
const toolsMod = require('../../core/data/tools.js');
const campus = require('../../core/data/campus.js');
const groupsMod = require('../../core/data/groups.js');
const feedbackMod = require('../../core/lib/feedback.js');
const tutorialMod = require('../../core/data/tutorial.js');
const render = require('../../render/draw.js');
const hitMod = require('../../render/hit.js');
const pdfMod = require('../../render/pdf.js');
const audio = require('../../lib/audio.js');

const TUTORIAL_STEPS = tutorialMod.TUTORIAL_STEPS;
const TUTORIAL_TRIGGERS = tutorialMod.TUTORIAL_TRIGGERS;

const LEVELS = levelsMod.LEVELS;
const WEATHER = levelsMod.WEATHER;
const getLevel = levelsMod.getLevel;
const TOOLS = toolsMod.TOOLS;
const TOOL_ORDER = toolsMod.TOOL_ORDER;
const GRID = campus.GRID;
const getMap = campus.getMap;
const tileAtFor = campus.tileAtFor;
const HIGH_HEAT = groupsMod.HIGH_HEAT;

const METRIC_LABEL = {
  popExposed: '高暴露人数', dangerPop: '危险暴露人数', avgHeat: '加权热指数',
  vulnExposed: '脆弱群体高暴露', equityGap: '公平差', shadeCoverage: '遮阴覆盖',
  comfort: '舒适度指数', budgetLeft: '预算结余',
};
const METRIC_UNIT = { popExposed: '人', dangerPop: '人', vulnExposed: '人', equityGap: 'pp', shadeCoverage: '%', comfort: '', avgHeat: '', budgetLeft: '万' };

function round1(v) { return Math.round(v * 10) / 10; }
function fmtHour(h) { return h + ':00'; }

Page({
  data: {
    ready: false,
    levelIndex: 1,
    levelName: '',
    levelTagline: '',
    levelStory: '',
    weatherName: '',
    weatherNote: '',
    weatherIcon: '',
    hourText: '--:--',
    advanceLabel: '推进时间 →',
    finished: false,
    budgetLeft: 0,
    waterLeft: 0,
    statRows: [],
    goals: [],
    tools: [],
    log: [],
    layers: { heat: true, shade: false, people: false, sensitive: false },
    layerList: [
      { id: 'heat', name: '热力', icon: '🌡' },
      { id: 'shade', name: '遮阴', icon: '🌳' },
      { id: 'people', name: '人群', icon: '👥' },
      { id: 'sensitive', name: '脆弱群体', icon: '⚠' },
    ],
    toolId: null,
    removeMode: false,
    rotation: 0,
    focusText: '',
    placingName: '',
    toast: null,
    feedback: null,
    preview: null,
    pinned: null,
    /* 弹窗 */
    introOpen: false,
    intro: null,
    eventOpen: false,
    event: null,
    resultOpen: false,
    result: null,
    venueOpen: false,
    venueName: '',
    venueHours: [],
    allHours: [],
    menuOpen: false,
    menuLevels: [],
    soundOn: true,
    /* 参谋建议 */
    adviceOpen: false,
    adviceList: [],
    adviceScrollH: 250,
    /* 其他指标（展开更多） */
    extraOpen: false,
    extraRows: [],
    /* 行动清单 / 打印导出 */
    planOpen: false,
    planStats: [],
    planGroups: [],
    planHot: [],
    planHeadline: '',
    /* 新手引导浮层 */
    tut: null,
    tutShape: 'block',
    tutDimFull: false,
    tutHiStyle: '',
    tutBubbleStyle: '',
  },

  /* ================= 生命周期 ================= */
  onLoad: function () {
    this.saved = {};          // 每关保留推演进度
    this.passed = {};         // 已通关（3 星）的关卡：一次性成就，重做本关也不会清除
    this.unlockedMax = 1;     // 控制台最多可切换到第几关（= 最高已通关关卡 + 1）
    this.zoom = 1;            // 地图缩放（双指捏合调整；1 = 适配全图）
    this.pan = { x: 0, y: 0 }; // 地图平移（放大后单指拖动建筑；复位视角/切关时清零）
    this.timers = {};
    // 音效开关（默认开；记住上次选择）
    let soundOn = true;
    try {
      const saved = wx.getStorageSync('soundOn');
      if (saved === false || saved === 'false') soundOn = false;
      else if (saved === true || saved === 'true') soundOn = true;
    } catch (e) { /* 存储不可用时用默认值 */ }
    this.soundOn = soundOn;
    audio.setMuted(!soundOn);
    this.setData({ soundOn: soundOn });
    // 背景音乐从进入游戏（页面加载）就开始循环，不必等玩家点按钮
    audio.startMusic();
    const first = LEVELS[0].id;
    this.openLevel(first, true);
  },

  onReady: function () {
    this.setupCanvas();
  },

  /** 从后台切回前台：若系统把音乐暂停了，这里续播（幂等，已播放时无副作用）。 */
  onShow: function () {
    if (this.soundOn !== false) audio.startMusic();
  },

  /** 进入后台：暂停音乐，避免锁屏/切应用时还在响。 */
  onHide: function () {
    audio.pauseMusic();
  },

  onUnload: function () {
    if (this.timers.toast) clearTimeout(this.timers.toast);
    if (this.timers.feedback) clearTimeout(this.timers.feedback);
    if (this.timers.redraw) clearTimeout(this.timers.redraw);
    if (this.tutTimer) clearInterval(this.tutTimer);
    audio.stopMusic();
  },

  /* ================= 关卡与状态 ================= */
  openLevel: function (levelId, first) {
    if (this.levelId && this.state && this.levelId !== levelId) {
      this.saved[this.levelId] = this.state;   // 记住上一关的推演进度
    }
    const level = getLevel(levelId);
    this.levelId = levelId;
    this.state = (this.saved[levelId] && this.saved[levelId].levelId === levelId) ? this.saved[levelId] : engine.createState(levelId);
    this.rotation = 0;
    this.toolId = null;
    this.removeMode = false;
    this.hover = null;
    this.pinned = null;
    this.pickMark = null;
    this.adviceMark = null;
    this.resultShown = false;
    this.layers = { heat: true, shade: false, people: false, sensitive: false };
    const w = WEATHER[level.startWeather];
    this.setData({
      introOpen: true,
      menuOpen: false,
      resultOpen: false,
      eventOpen: false,
      pinned: null,
      venueOpen: false,
      intro: {
        index: level.index,
        name: level.name,
        tagline: level.tagline,
        story: level.story,
        lesson: level.lesson,
        weatherIcon: w.icon,
        weatherName: w.name,
        weatherNote: w.note,
        budget: level.budget,
        water: level.waterSupply,
        hours: level.hours.map(fmtHour).join(' / '),
        unlock: level.unlock.map(function (id) { return { id: id, name: TOOLS[id].name, desc: TOOLS[id].desc }; }),
        goals: level.goals.map(function (g) {
          return { label: g.label, core: !!g.core, points: g.points, at: g.atHour ? fmtHour(g.atHour) : '最后时刻' };
        }),
      },
    });
    this.refresh();
  },

  stateName: function () { return getLevel(this.levelId).name; },

  /* ================= Canvas ================= */
  setupCanvas: function () {
    const self = this;
    const q = wx.createSelectorQuery();
    q.select('#map').fields({ node: true, size: true, rect: true }).exec(function (res) {
      if (!res || !res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      let dpr = 2;
      let winW = 844;
      let winH = 390;
      try {
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        dpr = info.pixelRatio || 2;
        winW = info.windowWidth || winW;
        winH = info.windowHeight || winH;
      } catch (e) { /* 保持默认 */ }
      self.winW = winW;
      self.winH = winH;
      canvas.width = Math.round(res[0].width * dpr);
      canvas.height = Math.round(res[0].height * dpr);
      self.canvas = canvas;
      self.ctx = ctx;
      self.cw = res[0].width;
      self.ch = res[0].height;
      self.canvasLeft = res[0].left || 0;
      self.canvasTop = res[0].top || 0;
      self.dpr = dpr;
      self.setData({ ready: true });
      self.redraw();
    });
  },

  redraw: function () {
    if (!this.ctx || !this.state) return;
    this.frame = hitMod.buildFrame(this.levelId, this.rotation, this.cw, this.ch, this.zoom || 1, this.pan);
    render.drawMap(this.ctx, {
      levelId: this.levelId,
      state: this.state,
      hour: engine.currentHour(this.state),
      layers: this.layers,
      toolId: this.toolId,
      hover: this.hover,
      adviceMark: this.adviceMark,
      pickMark: this.pickMark,
      focus: getLevel(this.levelId).focus,
      rotation: this.rotation,
      frame: this.frame,
      cw: this.cw,
      ch: this.ch,
      dpr: this.dpr,
    });
  },

  redrawSoon: function () {
    const self = this;
    if (this._raf) return;
    if (this.canvas && this.canvas.requestAnimationFrame) {
      this._raf = true;
      this.canvas.requestAnimationFrame(function () { self._raf = false; self.redraw(); });
    } else {
      this.redraw();
    }
  },

  /* ================= 界面数据刷新 ================= */
  refresh: function () {
    const level = getLevel(this.levelId);
    const s = this.state;
    const hour = engine.currentHour(s);
    const metrics = engine.computeMetrics(s, hour);
    const w = WEATHER[s.weather];

    const statRows = [
      { key: 'popExposed', name: '高暴露人数', value: String(metrics.popExposed), unit: '人', danger: false },
      { key: 'vulnExposed', name: '其中脆弱群体', value: String(metrics.vulnExposed), unit: '人', danger: false },
      { key: 'comfort', name: '舒适度指数', value: String(Math.round(metrics.comfort)), unit: '', danger: metrics.comfort < 20 },
      { key: 'shadeCoverage', name: '遮阴覆盖', value: String(Math.round(metrics.shadeCoverage)), unit: '%', danger: false },
    ];

    const goals = level.goals.map(function (g) {
      const m = engine.computeMetrics(s, g.atHour || level.hours[level.hours.length - 1]);
      const v = engine.metricValue(m, g.metric);
      const ok = g.op === '<=' ? v <= g.value : v >= g.value;
      return {
        label: g.label,
        core: !!g.core,
        ok: ok,
        current: Math.round(v * 10) / 10,
        target: (g.op === '<=' ? '≤ ' : '≥ ') + g.value + (METRIC_UNIT[g.metric] || ''),
        hour: g.atHour ? fmtHour(g.atHour) : '全程',
      };
    });

    const tools = TOOL_ORDER.map(function (id, idx) {
      const t = TOOLS[id];
      const unlocked = engine.isUnlocked(s, id);
      const affordable = engine.budgetLeft(s) >= t.cost;
      return {
        id: id,
        name: t.name,
        short: t.short,
        cost: t.cost,
        radius: t.radius,
        key: idx + 1,
        unlocked: unlocked,
        affordable: affordable,
        selected: this.toolId === id,
        unlockAt: t.unlockAt,
      };
    }, this);

    const log = s.log.slice(-10).reverse().map(function (e) { return { icon: e.icon, text: e.text }; });

    const isLastRound = s.round >= level.hours.length - 1;
    const nextHour = level.hours[s.round + 1];

    this.setData({
      levelIndex: level.index,
      levelName: level.name,
      levelTagline: level.tagline,
      weatherName: w.name,
      weatherIcon: w.icon,
      hourText: fmtHour(hour) + (HOUR_TAG[hour] ? ' ' + HOUR_TAG[hour] : ''),
      advanceLabel: s.finished ? '查看结算复盘' : isLastRound ? '结束推演 · 生成复盘' : '推进到 ' + fmtHour(nextHour) + ' →',
      finished: s.finished,
      budgetLeft: engine.budgetLeft(s),
      waterLeft: round1(engine.waterLeft(s)),
      statRows: statRows,
      goals: goals,
      tools: tools,
      log: log,
      layers: this.layers,
      toolId: this.toolId,
      removeMode: this.removeMode,
      rotation: this.rotation,
      focusText: (level.focus && level.focus.length > 0 && s.placements.every(function (p) { return p.fixed; }) && !s.finished)
        ? '🎯 ' + level.focus.map(function (f) { return f.label; }).join(' · ')
        : '',
      placingName: this.toolId ? TOOLS[this.toolId].name : '',
      canUndo: s.past.length > 0,
      extraRows: [
        { key: 'dangerPop', name: '危险暴露人数', value: String(metrics.dangerPop), unit: '人' },
        { key: 'avgHeat', name: '加权热指数', value: metrics.avgHeat.toFixed(1), unit: '' },
        { key: 'equityGap', name: '公平差', value: metrics.equityGap.toFixed(1), unit: 'pp' },
        { key: 'budgetLeft', name: '预算结余', value: String(metrics.budgetLeft), unit: '万' },
      ],
    });
    if (this.tutStep != null) this.refreshTutLayout();

    // 结算自动弹出（推进到结束或事件处理完）
    if (s.finished && !this.resultShown) {
      this.resultShown = true;
      this.showResult();
    }
  },

  showResult: function () {
    audio.blip('star');
    const ev = engine.evaluate(this.state);
    const level = getLevel(this.levelId);
    // 3 星即通关（与「进入下一关」的门槛一致）；粘性记录，解除后续的菜单跳关限制
    if (ev.stars >= 3) this.passed[this.levelId] = true;
    const next = LEVELS[level.index] || null;
    this.setData({
      resultOpen: true,
      result: {
        stars: ev.stars,
        headline: ev.headline,
        detail: ev.detail,
        scoreText: '得分 ' + ev.earned + ' / ' + ev.max + (ev.max > 0 ? '（' + Math.round(ev.ratio * 100) + '%）' : '') + ' · 公众支持度 ' + engine.support(this.state),
        lesson: level.lesson,
        sandbox: !!level.sandbox,
        canAdvance: ev.stars >= 3 && !!next,
        nextName: next ? next.name : '',
        rows: level.sandbox ? [] : ev.results.map(function (r) {
          return {
            label: r.goal.label,
            ok: r.ok,
            right: r.value.toFixed(1) + ' / ' + r.goal.op + r.goal.value + (r.goal.core ? ' · 核心' : ''),
          };
        }),
      },
    });
  },

  /* ================= 参谋建议 ================= */
  onAdviceOpen: function () {
    if (this.state.finished) { this.showToast('推演已结束，先重做本关'); return; }
    const tips = engine.advise(this.state, engine.currentHour(this.state));
    this.adviceData = tips;
    // scroll-view 必须给确定像素高度才滚动：按屏幕高度算（92vh 减去底部按钮行与内边距）
    const adviceScrollH = Math.max(160, Math.round((this.winH || 390) * 0.92 - 70));
    this.setData({
      adviceOpen: true,
      adviceScrollH: adviceScrollH,
      adviceList: tips.map(function (t, i) {
        return { idx: i, rank: i + 1, toolName: TOOLS[t.toolId].name, cost: t.cost, tileName: t.tileName, reason: t.reason };
      }),
    });
    this.notifyTutorial('adviceOpened');
  },

  onAdvicePick: function (e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const s = this.adviceData && this.adviceData[idx];
    if (!s) return;
    this.toolId = s.toolId;
    this.removeMode = false;
    this._previewTile = null;
    this.hover = null;
    this.setData({ preview: null });
    this.pinned = { x: s.x, y: s.y };
    this.pickMark = { x: s.x, y: s.y };
    this.setData({ adviceOpen: false });
    this.notifyTutorial('advicePicked');
    this.refresh();
    this.redrawSoon();
  },

  onAdviceClose: function () {
    this.setData({ adviceOpen: false });
    this.notifyTutorial('adviceClosed');
  },

  onAdviceAutoPlan: function () {
    this.setData({ adviceOpen: false });
    this.notifyTutorial('advicePlanned');
    this.onAutoPlan();
  },

  onExtraToggle: function () {
    this.setData({ extraOpen: !this.data.extraOpen });
  },

  /* ================= 行动清单 / 打印导出 ================= */
  /** 汇总「行动清单」的数据：概览统计、按工具分组的改造点位、仍需重点关注的地点（对齐 H5 版）。 */
  buildPlanData: function () {
    const s = this.state;
    const level = getLevel(this.levelId);
    const hour = level.hours[level.hours.length - 1];
    const metrics = engine.computeMetrics(s, hour);
    const evaluation = engine.evaluate(s);
    const byTool = {};
    s.placements.forEach(function (p) {
      if (!byTool[p.toolId]) byTool[p.toolId] = [];
      const t = tileAtFor(s.levelId, p.x, p.y);
      byTool[p.toolId].push((t ? t.name : '地块') + (p.fixed ? '（自带）' : ''));
    });
    const groups = TOOL_ORDER.filter(function (id) { return byTool[id]; }).map(function (id) {
      const t = TOOLS[id];
      return {
        toolName: t.name,
        meta: '×' + byTool[id].length + ' · 单个 ' + t.cost + ' 万 · 半径 ' + t.radius + ' 格',
        locs: byTool[id],
        issue: t.forIssue,
        caveat: t.caveat,
      };
    });
    const hot = metrics.hottest.filter(function (h) { return h.heat >= HIGH_HEAT; }).slice(0, 5).map(function (h) {
      return { name: h.name, heat: Math.round(h.heat), pop: Math.round(h.pop) };
    });
    return {
      levelName: level.name,
      levelIndex: level.index,
      hourLabel: fmtHour(hour),
      totalCount: s.placements.length,
      spent: metrics.budgetSpent,
      left: metrics.budgetLeft,
      support: engine.support(s),
      avgHeat: metrics.avgHeat.toFixed(1),
      vulnExposed: metrics.vulnExposed,
      groups: groups,
      hot: hot,
      headline: evaluation.headline + '：' + evaluation.detail,
    };
  },

  onPlanOpen: function () {
    const d = this.buildPlanData();
    this.planSheet = d;
    this.setData({
      menuOpen: false,
      planOpen: true,
      planStats: [
        { label: '改造点位', value: d.totalCount },
        { label: '预计花费', value: d.spent + ' 万' },
        { label: '剩余预算', value: d.left + ' 万' },
        { label: '公众支持度', value: d.support },
        { label: '加权热指数', value: d.avgHeat },
        { label: '脆弱群体高暴露', value: d.vulnExposed + ' 人' },
      ],
      planGroups: d.groups,
      planHot: d.hot,
      planHeadline: d.headline,
    });
  },

  onPlanClose: function () {
    this.setData({ planOpen: false });
  },

  /** 打印 / 导出 PDF：把清单排版成 A4 画布 → 生成单页 PDF → 调起微信文档预览（可转发/保存/打印）。 */
  onExportPdf: function () {
    const self = this;
    const d = this.planSheet || this.buildPlanData();
    const W = 1240;
    const H = 1754;
    const q = wx.createSelectorQuery();
    q.select('#pdfcanvas').fields({ node: true, size: true }).exec(function (res) {
      if (!res || !res[0] || !res[0].node) { self.showToast('导出画布不可用，请重试'); return; }
      try {
        const canvas = res[0].node;
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        pdfMod.drawPlanSheet(ctx, {
          title: '清凉改造行动清单',
          sub: '第 ' + d.levelIndex + ' 关 · ' + d.levelName + '｜结算于 ' + d.hourLabel + '｜可直接打印或截图提交给后勤',
          stats: [
            { label: '改造点位', value: d.totalCount },
            { label: '预计花费', value: d.spent + ' 万' },
            { label: '剩余预算', value: d.left + ' 万' },
            { label: '公众支持度', value: d.support },
            { label: '加权热指数', value: d.avgHeat },
            { label: '脆弱群体高暴露', value: d.vulnExposed + ' 人' },
          ],
          headline: d.headline,
          groups: d.groups,
          hot: d.hot,
          emptyText: '还没有任何改造。回到地图，先从「又热又有人」的地块开始。',
          footer: '本清单由「清凉校园 · 热浪行动」本地推演引擎生成（模拟参数，非实测数据），用于说明决策取舍与公平议题。',
        }, W, H);
        wx.canvasToTempFilePath({
          canvas: canvas,
          fileType: 'jpg',
          quality: 0.92,
          destWidth: W,
          destHeight: H,
          success: function (r) {
            try {
              const fs = wx.getFileSystemManager();
              const buf = fs.readFileSync(r.tempFilePath);
              const pdf = pdfMod.buildPdf(new Uint8Array(buf), W, H);
              const filePath = wx.env.USER_DATA_PATH + '/行动清单.pdf';
              fs.writeFileSync(filePath, pdf.buffer);
              wx.openDocument({
                filePath: filePath,
                fileType: 'pdf',
                showMenu: true,
                fail: function () {
                  // 部分环境（如工具模拟器）打不开文档预览时，退化为图片大图预览——内容同样完整
                  wx.previewImage({ urls: [r.tempFilePath] });
                },
              });
            } catch (e) {
              self.showToast('生成 PDF 失败：' + (e.message || e));
            }
          },
          fail: function () { self.showToast('导出图片失败，请重试'); },
        });
      } catch (e) {
        self.showToast('导出失败：' + (e.message || e));
      }
    });
  },

  /* ================= 新手引导 ================= */
  /** 玩家完成某个动作后调用：命中当前步骤的触发条件就自动进入下一步。 */
  notifyTutorial: function (action) {
    if (this.tutStep == null) return;
    const step = TUTORIAL_STEPS[this.tutStep];
    if (!step) return;
    const trig = TUTORIAL_TRIGGERS[step.id];
    if (trig && trig.indexOf(action) >= 0) this.gotoTutStep(this.tutStep + 1);
  },

  gotoTutStep: function (idx) {
    const self = this;
    if (this.tutTimer) { clearInterval(this.tutTimer); this.tutTimer = null; }
    if (idx == null || idx < 0 || idx >= TUTORIAL_STEPS.length) {
      this.tutStep = null;
      this.setData({ tut: null, tutHiStyle: '', tutDimFull: false });
      return;
    }
    this.tutStep = idx;
    const step = TUTORIAL_STEPS[idx];
    this.setData({
      tut: {
        title: step.title,
        lines: step.body.split('\n'),
        idxText: (idx + 1) + ' / ' + TUTORIAL_STEPS.length,
        nextLabel: idx >= TUTORIAL_STEPS.length - 1 ? '开始游戏' : '下一步 ›',
        tip: step.tip ? step.tip : (step.target ? (step.manual ? '完成上面的操作后，点「下一步」继续' : '完成上面的操作后会自动进入下一步') : ''),
      },
      tutShape: step.shape || 'block',
      tutDimFull: !!step.spotlight,
      tutHiStyle: '',
    });
    this.refreshTutLayout();
    this.tutTimer = setInterval(function () { self.refreshTutLayout(); }, 700);
  },

  onTutSkip: function () {
    this.gotoTutStep(null);
    this.showToast('已跳过引导，可从「关卡 ▾ → 重播新手引导」再看');
  },

  onTutPrev: function () {
    if (this.tutStep == null) return;
    this.gotoTutStep(Math.max(0, this.tutStep - 1));
  },

  onTutNext: function () {
    if (this.tutStep == null) return;
    this.gotoTutStep(this.tutStep + 1);
  },

  onTutReplay: function () {
    this.setData({ menuOpen: false });
    this.gotoTutStep(0);
  },

  onTutScroll: function () {
    if (this.tutStep == null) return;
    const self = this;
    if (this._tutScrollPend) return;
    this._tutScrollPend = setTimeout(function () { self._tutScrollPend = null; self.refreshTutLayout(); }, 120);
  },

  /** 教程里的网页版选择器 → 小程序选择器（'' = 该目标不在小程序里，用气泡提示兜底）。 */
  mapTutSelector: function (sel) {
    if (!sel) return '';
    return TUT_SELECTOR_MAP[sel] !== undefined ? TUT_SELECTOR_MAP[sel] : sel;
  },

  /** 量取当前步骤的「高亮目标」和「气泡锚点」两处矩形，然后重排浮层（与电脑版同规则）。 */
  refreshTutLayout: function () {
    const self = this;
    if (this.tutStep == null || !this.data.tut) return;
    const step = TUTORIAL_STEPS[this.tutStep];
    const targetSel = this.mapTutSelector(step.target) || '#tut-none';
    const anchorSel = this.mapTutSelector(step.bubbleTarget) || targetSel;
    const q = wx.createSelectorQuery();
    q.select(targetSel).boundingClientRect(function (r) { self._tutTargetRect = (r && r.width) ? r : null; });
    q.select(anchorSel).boundingClientRect(function (r) { self._tutAnchorRect = (r && r.width) ? r : null; });
    q.exec(function () { self.applyTutLayout(); });
  },

  /** 摆放高亮圈与气泡：高亮跟目标；气泡跟随电脑版锚点规则（大多挂左侧面板），
      锚点滑出视野时回退到左下角默认位——引导始终在左侧。 */
  applyTutLayout: function () {
    const step = TUTORIAL_STEPS[this.tutStep];
    if (!step) return;
    const W = this.winW || 844;
    const H = this.winH || 390;
    const BW = 244;
    const BH = 150;
    const target = this._tutTargetRect;
    const anchorRaw = this._tutAnchorRect;

    let hi = '';
    if (target) {
      hi = 'left:' + Math.round(target.left - 6) + 'px; top:' + Math.round(target.top - 6) +
        'px; width:' + Math.round(target.width + 12) + 'px; height:' + Math.round(target.height + 12) + 'px;';
    }

    const visible = anchorRaw &&
      anchorRaw.top < H - 16 && anchorRaw.top + anchorRaw.height > 16 &&
      anchorRaw.left < W - 16 && anchorRaw.left + anchorRaw.width > 16;
    const anchor = visible ? anchorRaw : null;

    const gap = 10;
    let bx;
    let by;
    if (!anchor) {
      if (step.spotlight) { bx = (W - BW) / 2; by = (H - BH) / 2; }
      else { bx = 12; by = H - BH - 88; }
    } else {
      const cx = anchor.left + anchor.width / 2;
      const cy = anchor.top + anchor.height / 2;
      const order = [step.place || 'bottom', 'top', 'bottom', 'left', 'right'];
      for (let i = 0; i < order.length && bx === undefined; i++) {
        const p = order[i];
        let l;
        let t;
        if (p === 'top') { l = cx - BW / 2; t = anchor.top - BH - gap; }
        else if (p === 'bottom') { l = cx - BW / 2; t = anchor.top + anchor.height + gap; }
        else if (p === 'left') { l = anchor.left - BW - gap; t = cy - BH / 2; }
        else { l = anchor.left + anchor.width + gap; t = cy - BH / 2; }
        l = Math.min(Math.max(l, 8), W - BW - 8);
        t = Math.min(Math.max(t, 8), H - BH - 8);
        const over = !step.bubbleOverlapOk && target &&
          !(l + BW < target.left - 4 || l > target.left + target.width + 4 || t + BH < target.top - 4 || t > target.top + target.height + 4);
        if (!over) { bx = l; by = t; }
      }
      if (bx === undefined) {
        bx = Math.min(Math.max(cx - BW / 2, 8), W - BW - 8);
        by = Math.min(Math.max(anchor.top + anchor.height + gap, 8), H - BH - 8);
      }
    }

    // 个别步骤的气泡微调（如第 10 步往右上让出弹窗里的时段文字），仍夹在屏幕内
    const nudge = TUT_NUDGE[step.id];
    if (nudge) {
      bx = Math.min(Math.max(bx + nudge.dx, 8), W - BW - 8);
      by = Math.min(Math.max(by + nudge.dy, 8), H - BH - 8);
    }

    /* 弹窗（简报/建议/场馆/清单/结算/事件）打开时会盖住黄色高亮：
       高亮直接收起（被弹窗覆盖），气泡里提醒玩家关掉弹窗回来看高亮位置；
       弹窗关闭后下一次布局刷新会自动恢复高亮。 */
    const covered = !!(this.data.adviceOpen || this.data.venueOpen || this.data.resultOpen ||
      this.data.eventOpen || this.data.planOpen || this.data.introOpen);
    const tip = step.target
      ? (covered
        ? '先关闭弹窗回到地图，就能看到黄色高亮的位置'
        : (step.tip || (step.manual ? '完成上面的操作后，点「下一步」继续' : '完成上面的操作后会自动进入下一步')))
      : '';

    this.setData({
      tutHiStyle: covered ? '' : hi,
      tutDimFull: !!step.spotlight,
      tutBubbleStyle: 'left:' + Math.round(bx) + 'px; top:' + Math.round(by) + 'px;',
    });
    if (this.data.tut && this.data.tut.tip !== tip) {
      this.setData({ tut: Object.assign({}, this.data.tut, { tip: tip }) });
    }
  },

  /* ================= 交互 ================= */
  hitAt: function (x, y) {
    if (!this.frame) return null;
    const p = this.frame.toViewBox(x, y);
    return hitMod.hitTile(this.frame, p.vx, p.vy);
  },

  onCanvasTouchStart: function (e) {
    const touches = (e && e.touches) || [];
    if (touches.length >= 2) {
      // 双指按下：进入缩放模式，记录初始指距与当前缩放
      const dx = touches[0].x - touches[1].x;
      const dy = touches[0].y - touches[1].y;
      this._pinch = { dist: Math.max(1, Math.sqrt(dx * dx + dy * dy)), zoom: this.zoom || 1 };
      this._pinchMoved = false;
      this._touchTile = null;
      return;
    }
    const t = touches[0];
    if (!t) return;
    this._pinch = null;
    this._pinchMoved = false;
    // 单指：可能是「点按放置」，也可能是「放大后拖动看建筑」——先记录起点，移动超过阈值才判定为拖动
    this._drag = { x0: t.x, y0: t.y, panX: (this.pan && this.pan.x) || 0, panY: (this.pan && this.pan.y) || 0, moved: false };
    this._dragMoved = false;
    // canvas 触摸事件的 x/y 已经是「相对 canvas 左上角」的坐标；只记落点，供点击命中兜底
    this._touchTile = this.hitAt(t.x, t.y) || null;
  },

  /** 单指拖动（放大后）：左右/上下平移地图，把想看的建筑拖到眼前。 */
  onCanvasTouchDrag: function (t) {
    // 未放大（1×）时地图锁定居中，拖动没有意义——不进入拖动判定，
    // 否则手指轻点时几像素的自然漂移会被当成拖动，把「查看地块详情」的点按吞掉。
    if ((this.zoom || 1) <= 1.001) return;
    const d = this._drag;
    if (!d) return;
    const dx = t.x - d.x0;
    const dy = t.y - d.y0;
    // 阈值放宽到 12px：手指点按时的轻微移动仍按点按处理
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 12) return;
    d.moved = true;
    this._dragMoved = true;
    this._touchTile = null;   // 拖动过程中不再保留落点，避免松手后误触发点按
    this.pan = { x: d.panX + dx, y: d.panY + dy };
    this.redrawSoon();
  },

  /** 双指捏合：缩放地图视角（放大可看清中间的建筑群，缩小回全图）。 */
  onCanvasTouchMove: function (e) {
    const touches = (e && e.touches) || [];
    if (touches.length >= 2) {
      if (!this._pinch) return;
      const dx = touches[0].x - touches[1].x;
      const dy = touches[0].y - touches[1].y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const next = Math.min(2.6, Math.max(0.6, this._pinch.zoom * (dist / this._pinch.dist)));
      if (Math.abs(next - (this.zoom || 1)) < 0.01) return;
      this.zoom = next;
      this._pinchMoved = true;
      this.redrawSoon();
      return;
    }
    const t = touches[0];
    if (t) this.onCanvasTouchDrag(t);
  },

  onCanvasTouchEnd: function (e) {
    const touches = (e && e.touches) || [];
    if (touches.length < 2) this._pinch = null;   // 松开任意一根手指即结束本次缩放
    if (touches.length === 0) this._drag = null;
  },

  onCanvasTap: function (e) {
    // 刚做完双指缩放或拖动地图：忽略紧随其后的这次 tap，避免误放置/误选地块
    if (this._pinchMoved || this._dragMoved) { this._pinchMoved = false; this._dragMoved = false; return; }
    // 注意：tap 事件的 detail.x/y 是「屏幕坐标」（相对页面显示区左上角），
    // 必须减去 canvas 在屏幕上的偏移量，换回 canvas 局部坐标再命中选择器。
    const t = e.detail;
    let tile = null;
    if (t && typeof t.x === 'number' && typeof t.y === 'number') {
      tile = this.hitAt(t.x - (this.canvasLeft || 0), t.y - (this.canvasTop || 0));
    }
    if (!tile) tile = this._touchTile || null; // 兜底：用最近一次触摸按下的落点
    if (!tile) return;

    // 放置交互（手机端两指点按）：点第一下弹预览卡，点第二下（同一块地）才放下
    if (this.toolId && !this.removeMode) {
      const pv = this._previewTile;
      if (pv && pv.x === tile.x && pv.y === tile.y) {
        this._previewTile = null;
        this.hover = null;
        this.setData({ preview: null });
        this.handleTileClick(tile.x, tile.y);
      } else {
        this._previewTile = { x: tile.x, y: tile.y };
        this.hover = { x: tile.x, y: tile.y };
        this.updatePreview();
        this.redrawSoon();
      }
      return;
    }
    this.handleTileClick(tile.x, tile.y);
  },

  handleTileClick: function (x, y) {
    const s = this.state;
    const hour = engine.currentHour(s);
    const level = getLevel(this.levelId);
    const tile = tileAtFor(this.levelId, x, y);

    if (this.removeMode) {
      const target = s.placements.find(function (p) { return p.x === x && p.y === y; });
      if (!target) return;
      if (target.fixed) { this.showToast('关卡自带的设施不能拆除'); return; }
      const before = engine.computeMetrics(s, hour);
      const next = engine.removeAt(s, x, y);
      if (next !== s) {
        this.state = next;
        audio.blip('remove');
        this.showFeedback(feedbackMod.buildRemovalFeedback(before, engine.computeMetrics(next, hour), {
          toolName: TOOLS[target.toolId].name,
          tileName: tile ? tile.name : '地块',
        }));
      }
      this.refresh();
      this.redrawSoon();
      return;
    }

    if (this.toolId) {
      const check = engine.canPlace(s, this.toolId, x, y);
      if (!check.ok) { audio.blip('error'); this.showToast(check.reason || '无法在此放置'); return; }
      const before = engine.computeMetrics(s, hour);
      const next = engine.place(s, this.toolId, x, y);
      if (next !== s) {
        audio.blip('place');
        const after = engine.computeMetrics(next, hour);
        const heatAfter = engine.heatField(next, hour)[y * GRID + x];
        const heatBefore = engine.heatField(s, hour)[y * GRID + x];
        this.state = next;
        this.pickMark = null;
        this.notifyTutorial('toolPlaced');
        this.showFeedback(feedbackMod.buildFeedback(before, after, {
          toolName: TOOLS[this.toolId].name,
          tileName: tile ? tile.name : '地块',
          tileWasExposed: heatBefore >= HIGH_HEAT,
          tileHeatAfter: heatAfter,
        }));
      }
      this.updatePreview();
      this.refresh();
      this.redrawSoon();
      return;
    }

    // 无工具：查看地块详情；图书馆/阅览馆直接打开纳凉设置
    if (tile) {
      const gs = campus.tileGroups(tile, hour);
      const total = (gs.students || 0) + (gs.kids || 0) + (gs.elders || 0) + (gs.workers || 0) + (gs.riders || 0);
      this.pinned = {
        name: tile.name,
        type: TILE_TYPE_NAME[tile.type] || tile.type,
        heat: Math.round(engine.heatField(s, hour)[y * GRID + x]),
        people: Math.round(campus.tilePopulation(tile, hour) * campus.tileOutdoor(tile, hour)),
        groups: [
          { name: '学生', share: total > 0 ? Math.round((gs.students / total) * 100) : 0 },
          { name: '老人', share: total > 0 ? Math.round((gs.elders / total) * 100) : 0 },
          { name: '儿童', share: total > 0 ? Math.round((gs.kids / total) * 100) : 0 },
        ].filter(function (g) { return g.share > 0; }),
        facilityText: s.placements.filter(function (p) { return p.x === x && p.y === y; })
          .map(function (p) { return TOOLS[p.toolId].name + (p.fixed ? '（自带）' : ''); })
          .join('、'),
        venue: /图书馆|阅览馆/.test(tile.name),
      };
      // 写进 data，右侧「地块详情」卡片才会显示（此前只赋了实例字段，界面一直不更新）
      this.setData({ pinned: this.pinned });
      if (this.pinned.venue) {
        const draft = s.refugeHours.length ? s.refugeHours : level.hours;
        this.setData({
          venueOpen: true,
          venueName: tile.name,
          allHours: level.hours.map(function (h) {
            return { hour: h, on: draft.indexOf(h) >= 0, tag: h < 12 ? '上午' : h < 17 ? '高温时段' : '傍晚' };
          }),
          venueHours: draft,
          venueCanSave: draft.length > 0,
        });
        this.notifyTutorial('venueOpened');
      }
      this.refresh();
      this.redrawSoon();
    }
  },

  updatePreview: function () {
    const s = this.state;
    if (!this.toolId || !this.hover) { if (this.data.preview) this.setData({ preview: null }); return; }
    const hour = engine.currentHour(s);
    const check = engine.canPlace(s, this.toolId, this.hover.x, this.hover.y);
    if (!check.ok) {
      this.setData({ preview: { ok: false, reason: check.reason || '' } });
      return;
    }
    const before = engine.computeMetrics(s, hour);
    const after = engine.computeMetrics(engine.place(s, this.toolId, this.hover.x, this.hover.y), hour);
    const tile = tileAtFor(this.levelId, this.hover.x, this.hover.y);
    const tool = TOOLS[this.toolId];
    // 预先算好展示文本：箭头表示指标实际变化方向，颜色表示好坏
    const rows = [];
    const addRow = function (name, improvement, downIsGood, unit) {
      const abs = Math.abs(Math.round(improvement * 10) / 10);
      const arrow = Math.abs(improvement) < 0.05 ? '—' : (downIsGood ? (improvement > 0 ? '↓' : '↑') : (improvement > 0 ? '↑' : '↓'));
      rows.push({
        name: name,
        text: arrow === '—' ? '不变' : arrow + abs + (unit || ''),
        cls: improvement > 0.05 ? 'good' : improvement < -0.05 ? 'bad' : '',
      });
    };
    addRow('加权热指数', before.avgHeat - after.avgHeat, true, '');
    addRow('户外高暴露', before.popExposed - after.popExposed, true, '人');
    addRow('脆弱高暴露', before.vulnExposed - after.vulnExposed, true, '人');
    addRow('公平差', before.equityGap - after.equityGap, true, 'pp');
    addRow('舒适度', after.comfort - before.comfort, false, '');
    this.setData({
      preview: {
        ok: true,
        tileName: tile ? tile.name : '地块',
        toolName: tool.name,
        rows: rows,
        cost: tool.cost,
        radius: tool.radius,
      },
    });
  },

  onToolTap: function (e) {
    if (this.state.finished) { this.showToast('推演已结束，先重做本关或进入下一关'); return; }
    const id = e.currentTarget.dataset.id;
    const unlocked = engine.isUnlocked(this.state, id);
    if (!unlocked) { this.showToast('该工具第 ' + TOOLS[id].unlockAt + ' 关解锁'); return; }
    const left = engine.budgetLeft(this.state);
    if (left < TOOLS[id].cost) {
      this.showToast('预算不足：还差 ' + (TOOLS[id].cost - left) + ' 万，可先拆除或用撤销退回预算');
      return;
    }
    const next = this.toolId === id ? null : id;
    this.toolId = next;
    this.removeMode = false;
    // 换工具/收起工具时清掉未完成的预览（两指点按的中间态）
    this._previewTile = null;
    this.hover = null;
    this.setData({ preview: null });
    if (!next) this.pickMark = null;
    this.notifyTutorial('toolSelected');
    this.updatePreview();
    this.refresh();
    this.redrawSoon();
  },

  onRemoveToggle: function () {
    this.removeMode = !this.removeMode;
    if (this.removeMode) { this.toolId = null; this.hover = null; }
    this._previewTile = null;
    this.setData({ preview: null });
    this.updatePreview();
    this.refresh();
    this.redrawSoon();
  },

  onLayerToggle: function (e) {
    const id = e.currentTarget.dataset.id;
    const turningOn = !this.layers[id];
    this.layers[id] = turningOn;
    this.setData({ layers: this.layers });
    // 脆弱群体图层在多数关卡天然为空（他们多在树荫处）——打开时空图层会像"坏了"，给一句解释
    if (id === 'sensitive' && turningOn && engine.vulnerableHotCount(this.state, engine.currentHour(this.state)) === 0) {
      this.showToast('本时刻没有「脆弱群体聚集且受热」的地块——他们大多在树荫处；第 4 关这个图层会非常关键');
    }
    this.notifyTutorial('layerToggled');
    this.redrawSoon();
  },

  onRotation: function (e) {
    this.rotation = Number(e.detail.value) % 360;
    this.setData({ rotation: this.rotation });
    this.notifyTutorial('rotated');
    this.redrawSoon();
  },

  onRotateStep: function (e) {
    const d = Number(e.currentTarget.dataset.d);
    this.rotation = ((this.rotation + d) % 360 + 360) % 360;
    this.hover = null;
    this.setData({ rotation: this.rotation });
    this.notifyTutorial('rotated');
    this.redrawSoon();
  },

  onRotateReset: function () {
    this.rotation = 0;
    this.zoom = 1;                // 重置视角同时把双指缩放复位回全图
    this.pan = { x: 0, y: 0 };    // 平移也一并复位
    this.hover = null;
    this.setData({ rotation: 0 });
    this.notifyTutorial('rotated');
    this.redrawSoon();
  },

  onAdvance: function () {
    const s = this.state;
    if (s.finished) { this.showResult(); return; }
    if (s.pendingEvent) { this.showToast('请先处理当前事件'); return; }
    const beforeLog = s.log.length;
    const next = engine.advance(s);
    this.state = next;
    this.toolId = null;
    audio.blip('advance');
    this.notifyTutorial('advanced');
    // 通知类事件的效果已自动生效：用一条提示告诉玩家
    const fresh = next.log.slice(beforeLog);
    const evt = fresh.find(function (e) { return e.kind === 'event'; });
    if (evt) this.showToast(evt.icon + ' ' + evt.text);
    if (next.pendingEvent) {
      const ev = next.pendingEvent;
      this.setData({
        eventOpen: true,
        event: {
          icon: ev.icon,
          title: ev.title,
          body: ev.body,
          prompt: ev.prompt,
          choices: ev.choices.map(function (c) { return { id: c.id, label: c.label, detail: c.detail }; }),
        },
      });
    }
    this.refresh();
    this.redrawSoon();
  },

  onChoose: function (e) {
    const id = e.currentTarget.dataset.id;
    this.state = engine.resolveChoice(this.state, id);
    this.setData({ eventOpen: false, event: null });
    this.refresh();
    this.redrawSoon();
  },

  onUndo: function () {
    const before = this.state.past.length;
    this.state = engine.undo(this.state);
    if (this.state.past.length === before) { this.showToast('没有可撤销的操作'); return; }
    this.toolId = null;
    this.hover = null;
    this.resultShown = false;
    this.setData({ resultOpen: false });
    this.refresh();
    this.redrawSoon();
  },

  onAutoPlan: function () {
    if (this.state.finished) { this.showToast('推演已结束，先重做本关'); return; }
    this.state = engine.autoPlan(this.state, engine.currentHour(this.state));
    this.toolId = null;
    this.showToast('🤖 已按任务目标自动布置');
    this.refresh();
    this.redrawSoon();
  },

  /* ================= 弹窗 ================= */
  onEnterLevel: function () {
    this.setData({ introOpen: false });
    // 背景音乐在用户手势里首次启动（微信的自动播放策略要求；幂等，重复调用无副作用）
    audio.startMusic();
    this.redraw();
    // 第一次进入处置时自动播放新手引导（与电脑版一致；之后可从「关卡」菜单重播）
    if (!this.tutOnce) { this.tutOnce = true; this.gotoTutStep(0); }
  },

  onVenueToggleHour: function (e) {
    const h = Number(e.currentTarget.dataset.hour);
    const list = this.data.venueHours.slice();
    const idx = list.indexOf(h);
    if (idx >= 0) list.splice(idx, 1); else list.push(h);
    list.sort(function (a, b) { return a - b; });
    this.setData({
      venueHours: list,
      venueCanSave: list.length > 0,
      allHours: this.data.allHours.map(function (a) { return { hour: a.hour, on: list.indexOf(a.hour) >= 0, tag: a.tag }; }),
    });
  },

  onVenueSave: function () {
    this.state = engine.configureRefuge(this.state, this.data.venueHours);
    const text = this.data.venueHours.map(fmtHour).join('、');
    this.setData({ venueOpen: false });
    this.notifyTutorial('venueConfigured');
    this.showToast('📚 已安排 ' + (text || '未开') + ' 开放纳凉');
    this.refresh();
    this.redrawSoon();
  },

  onVenueClose: function () {
    this.setData({ venueOpen: false });
  },

  onResultRedo: function () {
    this.state = engine.resumeLevel(this.state);
    this.resultShown = false;
    this.setData({ resultOpen: false });
    this.refresh();
    this.redrawSoon();
  },

  /** 复盘里的「查看行动清单」：直接叠开行动清单弹窗（关闭后回到复盘）。 */
  onResultPlan: function () {
    this.onPlanOpen();
  },

  onResultNext: function () {
    const level = getLevel(this.levelId);
    const next = LEVELS[level.index];
    if (!next) return;
    this.resultShown = false;
    this.setData({ resultOpen: false });
    this.openLevel(next.id);
  },

  onResultClose: function () {
    this.setData({ resultOpen: false });
  },

  onMenuOpen: function () {
    const cur = this.levelId;
    // 通关进度：拿到 3 星才算通关；没通关时菜单里不能跳到更远的关卡
    let maxPassed = 0;
    const ids = Object.keys(this.passed || {});
    for (let i = 0; i < ids.length; i++) {
      const lv = getLevel(ids[i]);
      if (lv) maxPassed = Math.max(maxPassed, lv.index);
    }
    this.unlockedMax = Math.min(maxPassed + 1, LEVELS.length);
    const cap = this.unlockedMax;
    this.setData({
      menuOpen: true,
      menuLevels: LEVELS.map(function (l) {
        return { id: l.id, index: l.index, name: l.name, current: l.id === cur, locked: l.index > cap };
      }),
    });
  },

  onMenuClose: function () {
    this.setData({ menuOpen: false });
  },

  /** 音效开关（菜单里切换；选择会被记住） */
  onSoundToggle: function () {
    this.soundOn = !this.soundOn;
    audio.setMuted(!this.soundOn);
    this.setData({ soundOn: this.soundOn });
    try { wx.setStorageSync('soundOn', this.soundOn); } catch (e) { /* 忽略 */ }
    // 打开时给一声提示音（同时也在用户手势里激活音频上下文）
    if (this.soundOn) audio.blip('advance');
  },

  onMenuPick: function (e) {
    const id = e.currentTarget.dataset.id;
    // 未通关不能从菜单跳到更远的关卡（与结算页「3 星才能进入下一关」一致）
    const target = getLevel(id);
    if (target && target.index > (this.unlockedMax || 1)) {
      this.showToast('先通关上一关（拿到 3 星）才能解锁这一关');
      return;
    }
    if (id === this.levelId) { this.setData({ menuOpen: false }); return; }
    // 不覆盖当前进度：存下来再切
    if (this.state) this.saved[this.levelId] = this.state;
    const level = getLevel(id);
    const saved = this.saved[id];
    this.levelId = id;
    this.state = saved && saved.levelId === id ? saved : engine.createState(id);
    this.rotation = 0;
    this.zoom = 1;                // 切关后回到全图视角
    this.pan = { x: 0, y: 0 };
    this.toolId = null;
    this.removeMode = false;
    this.hover = null;
    this.pinned = null;
    this.pickMark = null;
    this.adviceMark = null;
    this.resultShown = this.state.finished;
    const w = WEATHER[level.startWeather];
    this.setData({
      menuOpen: false,
      resultOpen: false,
      eventOpen: false,
      introOpen: !saved,
      pinned: null,
      intro: {
        index: level.index,
        name: level.name,
        tagline: level.tagline,
        story: level.story,
        lesson: level.lesson,
        weatherIcon: w.icon,
        weatherName: w.name,
        weatherNote: w.note,
        budget: level.budget,
        water: level.waterSupply,
        hours: level.hours.map(fmtHour).join(' / '),
        unlock: level.unlock.map(function (tid) { return { name: TOOLS[tid].name, desc: TOOLS[tid].desc }; }),
        goals: level.goals.map(function (g) {
          return { label: g.label, core: !!g.core, points: g.points, at: g.atHour ? fmtHour(g.atHour) : '最后时刻' };
        }),
      },
    });
    this.refresh();
    this.redrawSoon();
  },

  /* ================= 提示 ================= */
  noop: function () { },

  showToast: function (text) {
    const self = this;
    this.setData({ toast: text });
    if (this.timers.toast) clearTimeout(this.timers.toast);
    this.timers.toast = setTimeout(function () { self.setData({ toast: null }); }, 2200);
  },

  showFeedback: function (fb) {
    const self = this;
    this.setData({ feedback: fb });
    if (this.timers.feedback) clearTimeout(this.timers.feedback);
    this.timers.feedback = setTimeout(function () { self.setData({ feedback: null }); }, 5000);
  },
});

/** 时段短签（与主项目一致的语感）。 */
const HOUR_TAG = { 8: '晨间', 12: '正午', 14: '午后', 18: '傍晚' };

/**
 * 个别步骤的气泡微调（dx 正数=右移，dy 正数=下移）：用于避让弹窗里的文字。
 * 第 10 步（设置开放时段）的气泡默认落在场馆弹窗按钮区上方，会压住时段说明文字，往右上让一点。
 */
const TUT_NUDGE = { venueSet: { dx: 20, dy: -16 } };

/** 教程步骤里的网页版选择器 → 小程序里的对应选择器（'' = 该目标在小程序不存在，只用气泡提示）。 */
const TUT_SELECTOR_MAP = {
  '.auto-plan-btn': '.auto-plan-btn',
  '.dock-tools': '.dock-tools',
  '.focus-hint': '.focus-hint',
  '.view-controls': '.view-controls',
  '.round-card': '.round-card',
  '.side.left': '.col-left',
  '.side.right': '.col-right',
  '.metrics-panel': '.card-stat',
  '.metrics-advice': '.btn-advice',
  '.layer-row': '.row-layers',
  '.layer-panel': '.card-layers',
  '.advice-modal': '.advice-modal',
  '.advice-list .primary.small': '.advice-pick',
  '.venue-actions': '.venue-actions',
  '.venue-pin': '', // 地图上的冰蓝角标画在 canvas 里，无法框选 → 该步只用气泡提示
};

const TILE_TYPE_NAME = {
  grass: '绿地', garden: '庭院', tree: '林荫', water: '水体', road: '道路',
  plaza: '广场', building: '建筑', dorm: '公寓', canteen: '餐厅', sport: '运动场', parking: '停车点',
};
