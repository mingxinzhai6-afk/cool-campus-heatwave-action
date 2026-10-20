const MUSIC_URL = new URL('../../assets/Blueprint_for_Daylight.mp4', import.meta.url).href;

/** jsdom 等测试环境不实现媒体播放，直接跳过，避免无意义的控制台噪音。 */
const CAN_PLAY_MEDIA = typeof navigator === 'undefined' || !/jsdom/i.test(navigator.userAgent);

/**
 * 音频：本地背景音乐 + 程序化交互提示音。
 * 背景音轨使用 assets 里的 mp4，音量由 <audio> 元素单独控制（不经过 Web Audio 主增益）；交互提示仍由 Web Audio 负责。
 * 注意：不再合成持续的环境 pad（低通嗡声），否则会和背景音乐叠成“两路声音”。
 */
export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: HTMLAudioElement | null = null;
  private muted = true;
  private volume = 0.32;
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.started = true;

    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      this.started = false;
      return;
    }
    this.ctx = ctx;

    const music = new Audio(MUSIC_URL);
    music.loop = true;
    music.preload = 'auto';
    music.volume = 0.3;
    music.muted = this.muted;
    this.music = music;

    // —— 以下全部同步完成，确保 this.master 与 this.ctx 同时可用 ——
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 6;
    comp.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : this.volume;
    master.connect(comp);
    this.master = master;

    // 只有这一句是异步的；失败也不影响后续交互时再次 resume
    try { await ctx.resume(); } catch { /* 交给后续用户交互恢复 */ }
    this.playMusic();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.08);
    }
    // 音乐是独立的 <audio> 元素，必须同步它自己的 muted，否则会“播放但无声”。
    if (this.music) this.music.muted = muted;
    if (muted) { if (CAN_PLAY_MEDIA) this.music?.pause(); }
    else this.playMusic();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx && this.master && !this.muted) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
    }
  }

  /** 保留接口（历史上用来调节合成 pad 的强度）。背景音乐不随强度变化，这里是有意的空实现。 */
  setIntensity(_intensity: number): void {
    /* 不再合成持续 pad，避免与背景音乐叠成两路声音。 */
  }

  /** 背景音乐：低音量循环播放；被浏览器自动播放策略拦截时静默等待下一次用户交互。 */
  private playMusic(): void {
    if (!CAN_PLAY_MEDIA || !this.music || this.muted) return;
    this.music.muted = false;
    try {
      const result = this.music.play();
      if (result && typeof result.catch === 'function') void result.catch(() => { /* 等待下一次用户点击 */ });
    } catch {
      /* 部分环境（如 jsdom）不实现 play()，忽略即可 */
    }
  }

  /** 交互音效：放置 / 拆除 / 推进 / 达标 / 错误。 */
  blip(kind: 'place' | 'remove' | 'advance' | 'star' | 'error'): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const spec: Record<string, { f: number; dur: number; type: OscillatorType }> = {
      place: { f: 523.25, dur: 0.16, type: 'triangle' },
      remove: { f: 196, dur: 0.2, type: 'sine' },
      advance: { f: 392, dur: 0.24, type: 'triangle' },
      star: { f: 784, dur: 0.5, type: 'sine' },
      error: { f: 130, dur: 0.24, type: 'sawtooth' },
    };
    const s = spec[kind];
    const osc = ctx.createOscillator();
    osc.type = s.type;
    osc.frequency.setValueAtTime(s.f, now);
    if (kind === 'place') osc.frequency.exponentialRampToValueAtTime(s.f * 1.5, now + s.dur);
    if (kind === 'star') osc.frequency.exponentialRampToValueAtTime(s.f * 2, now + s.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.22, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + s.dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + s.dur + 0.02);
  }
}
