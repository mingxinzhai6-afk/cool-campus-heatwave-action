/**
 * 小程序音效：与电脑版同一套程序化合成音色（place / remove / advance / star / error）。
 *
 * 全部由 wx.createWebAudioContext 现场合成——不需要任何音频文件：
 *   · 不增加小程序包体积（上限 2MB，背景音乐那种 7.8MB 的 mp4 放不进来）；
 *   · 不需要服务器与域名配置（作品整体保持零网络请求）；
 *   · 基础库不支持 WebAudio 时自动静默降级，所有调用变成空操作。
 *
 * 用法：audio.blip('place')；声音总开关 audio.setMuted(true/false)。
 */
'use strict';

/** 与电脑版 audio.ts 完全一致的音色参数。rampTo = 结束时频率倍数（滑音）。 */
const SPEC = {
  place: { f: 523.25, dur: 0.16, type: 'triangle', rampTo: 1.5 },
  remove: { f: 196, dur: 0.2, type: 'sine' },
  advance: { f: 392, dur: 0.24, type: 'triangle' },
  star: { f: 784, dur: 0.5, type: 'sine', rampTo: 2 },
  error: { f: 130, dur: 0.24, type: 'sawtooth' },
};

let ctx = null;
let master = null;
let muted = false;
let unavailable = false;
let music = null;       // 背景音乐（InnerAudioContext）
let musicTried = false; // 防止 onError 兜底里无限重试

/** 惰性创建音频上下文（首次发声一般在用户点击里，符合浏览器的自动播放限制）。 */
function ensure() {
  if (unavailable) return null;
  if (ctx && master) return ctx;
  if (typeof wx === 'undefined' || typeof wx.createWebAudioContext !== 'function') {
    unavailable = true;
    return null;
  }
  try {
    ctx = wx.createWebAudioContext();
    master = ctx.createGain();
    // 主增益留一点余量，避免连续点击时削顶
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  } catch (e) {
    unavailable = true;
    ctx = null;
    master = null;
    return null;
  }
  return ctx;
}

/** 播放一个交互音效；任何一步不被支持时静默跳过，绝不抛出。 */
function blip(kind) {
  if (muted) return;
  const spec = SPEC[kind];
  if (!spec) return;
  const c = ensure();
  if (!c) return;
  try {
    if (typeof c.resume === 'function') {
      try { c.resume(); } catch (e) { /* 已恢复或暂不可用 */ }
    }
    const now = c.currentTime;
    const osc = c.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.f, now);
    if (spec.rampTo && typeof osc.frequency.exponentialRampToValueAtTime === 'function') {
      osc.frequency.exponentialRampToValueAtTime(spec.f * spec.rampTo, now + spec.dur);
    }
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.22, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + spec.dur);
    osc.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + spec.dur + 0.02);
  } catch (e) {
    /* 个别机型不支持某个节点：静默忽略，不影响游戏 */
  }
}

/* ============================ 背景音乐 ============================ */

const BGM_SRC = '/assets/bgm.m4a'; // 代码包内路径（176 秒，单声道 40kbps ≈ 0.9MB）
let musicPlaying = false;          // 是否正在播放（用于避免重复 play() 导致从头重播）

/**
 * 开始播放背景音乐（幂等：正在播放时直接返回）。
 * 注意：微信 InnerAudioContext 对「正在播放」的音频再调 play() 会从头重播，
 * 所以进入关卡、切回前台等时机再次调用时，必须靠这里的播放状态判断挡住。
 */
function startMusic() {
  if (muted) return;
  if (typeof wx === 'undefined' || typeof wx.createInnerAudioContext !== 'function') return;
  if (!music) {
    try {
      // iOS 静音拨片不影响游戏内音乐（与电脑版"默认有声音"的体验一致）
      if (typeof wx.setInnerAudioOption === 'function') {
        wx.setInnerAudioOption({ obeyMuteSwitch: false });
      }
      music = wx.createInnerAudioContext();
      music.src = BGM_SRC;
      music.loop = true;
      music.volume = 0.32;
      // 用播放事件维护状态：pause/stop 后才能再次 play（play 会从暂停处继续，不会重播）
      if (typeof music.onPlay === 'function') music.onPlay(function () { musicPlaying = true; });
      if (typeof music.onPause === 'function') music.onPause(function () { musicPlaying = false; });
      if (typeof music.onStop === 'function') music.onStop(function () { musicPlaying = false; });
      music.onError(function () {
        // 个别环境不能直接播放代码包文件：复制到用户目录后用 wxfile:// 播放（只兜底一次）
        if (musicTried) return;
        musicTried = true;
        musicPlaying = false;
        try {
          const fsm = wx.getFileSystemManager();
          const dest = wx.env.USER_DATA_PATH + '/bgm.m4a';
          let needCopy = true;
          try { fsm.accessSync(dest); needCopy = false; } catch (e) { needCopy = true; }
          if (needCopy) fsm.copyFileSync(BGM_SRC, dest);
          music.src = dest;
          music.play();
        } catch (e) { /* 彻底不可用时静默 */ }
      });
    } catch (e) {
      music = null;
      return;
    }
  }
  if (musicPlaying) return;                      // 已在播放：不要再 play()，否则会从头重播
  try {
    if (music.paused === false) { musicPlaying = true; return; }  // 双保险：系统侧已在播放
  } catch (e) { /* 读不到 paused 时忽略 */ }
  try {
    music.play();                                // 暂停后调用会从暂停位置继续
  } catch (e) { /* 忽略 */ }
}

/** 页面卸载时释放（避免离开页面还占着音频通道）。 */
function stopMusic() {
  if (!music) return;
  try { music.stop(); } catch (e) { /* 忽略 */ }
  try { music.destroy(); } catch (e) { /* 忽略 */ }
  music = null;
  musicPlaying = false;
}

/** 暂停背景音乐但保留实例（页面进入后台时用；回到前台再 startMusic 从暂停处续播）。 */
function pauseMusic() {
  if (!music) return;
  musicPlaying = false;
  try { music.pause(); } catch (e) { /* 忽略 */ }
}

module.exports = {
  blip: blip,
  startMusic: startMusic,
  stopMusic: stopMusic,
  pauseMusic: pauseMusic,
  setMuted: function (m) {
    muted = !!m;
    if (m) {
      musicPlaying = false;
      if (music) {
        try { music.pause(); } catch (e) { /* 忽略 */ }
      }
    } else {
      startMusic();
    }
  },
  isMuted: function () { return muted; },
};
