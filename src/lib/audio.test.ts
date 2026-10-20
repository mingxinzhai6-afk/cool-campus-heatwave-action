// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Ambience } from './audio';

/**
 * 回归测试：用假的 AudioContext 重现"start() 尚未完成时调用 setMuted()"的场景。
 *
 * 之前的 bug：start() 里 `this.ctx = ctx` 先赋值，`this.master` 在 `await ctx.resume()`
 * 之后才创建，导致 setMuted() 访问 this.master.gain 抛 TypeError，整页白屏。
 * 真实浏览器有 AudioContext，而 jsdom 没有，所以必须显式注入假实现才能覆盖到。
 */

class FakeParam {
  value = 0;
  setTargetAtTime(): void { /* noop */ }
  setValueAtTime(): void { /* noop */ }
  exponentialRampToValueAtTime(): void { /* noop */ }
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  delayTime = new FakeParam();
  type = '';
  connect(): this { return this; }
  start(): void { /* noop */ }
  stop(): void { /* noop */ }
}

class FakeAudioContext {
  currentTime = 0;
  destination = new FakeNode();
  createGain() { return new FakeNode(); }
  createDynamicsCompressor() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createOscillator() { return new FakeNode(); }
  createDelay() { return new FakeNode(); }
  createBufferSource() { return new FakeNode(); }
  createBuffer() { return {}; }
  /** 故意延迟 resolve，模拟真实浏览器：调用方不会 await 就继续往下走。 */
  resume(): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

type AudioGlobal = { AudioContext?: unknown; Audio?: unknown };
const g = globalThis as AudioGlobal;
const original = g.AudioContext;
const originalAudio = g.Audio;

function withFakeAudio(): void {
  g.AudioContext = FakeAudioContext;
  (window as unknown as AudioGlobal).AudioContext = FakeAudioContext;
}

afterEach(() => {
  g.AudioContext = original;
  (window as unknown as AudioGlobal).AudioContext = original;
  g.Audio = originalAudio;
  (window as unknown as AudioGlobal).Audio = originalAudio;
});

describe('Ambience 音频引擎', () => {
  it('没有 AudioContext 时静默降级，不抛异常', async () => {
    g.AudioContext = undefined;
    (window as unknown as AudioGlobal).AudioContext = undefined;
    const a = new Ambience();
    await expect(a.start()).resolves.toBeUndefined();
    expect(() => {
      a.setMuted(false);
      a.setIntensity(0.8);
      a.blip('place');
    }).not.toThrow();
  });

  it('start() 未完成时调用 setMuted / blip 不会崩溃（回归）', async () => {
    withFakeAudio();
    const a = new Ambience();
    const starting = a.start();   // 故意不 await
    expect(() => {
      a.setMuted(false);          // 旧实现在这里抛 TypeError: reading 'gain'
      a.setVolume(0.5);
      a.setIntensity(0.4);
      a.blip('advance');
    }).not.toThrow();
    await expect(starting).resolves.toBeUndefined();
    expect(() => {
      a.setMuted(true);
      a.blip('star');
    }).not.toThrow();
  });

  it('重复 start() 只初始化一次', async () => {
    withFakeAudio();
    const a = new Ambience();
    await a.start();
    await expect(a.start()).resolves.toBeUndefined();
  });

  it('所有交互音效都可调用', async () => {
    withFakeAudio();
    const a = new Ambience();
    await a.start();
    a.setMuted(false);
    for (const kind of ['place', 'remove', 'advance', 'star', 'error'] as const) {
      expect(() => a.blip(kind)).not.toThrow();
    }
  });

  it('开启声音时会把背景音乐元素自身的 muted 同步复位（回归）', async () => {
    withFakeAudio();
    type Captured = { muted: boolean; loop: boolean; volume: number; plays: number };
    const created: Captured[] = [];
    class CapturedAudio implements Captured {
      src = '';
      loop = false;
      preload = '';
      volume = 1;
      muted = false;
      plays = 0;
      constructor(src?: string) {
        this.src = src ?? '';
        created.push(this);
      }
      play(): Promise<void> { this.plays += 1; return Promise.resolve(); }
      pause(): void { /* noop */ }
    }
    g.Audio = CapturedAudio;
    (window as unknown as AudioGlobal).Audio = CapturedAudio;

    const a = new Ambience();
    await a.start();
    expect(created).toHaveLength(1);
    expect(created[0].loop).toBe(true);
    expect(created[0].muted).toBe(true); // 默认静音

    a.setMuted(false);
    expect(created[0].muted).toBe(false); // 关键：元素自身必须解除静音，否则“播放但无声”
    expect(created[0].volume).toBeLessThan(0.45); // 背景音乐音量（调大后仍为音效留出空间）

    a.setMuted(true);
    expect(created[0].muted).toBe(true);
  });

  it('启动时不再合成持续 pad，避免与背景音乐叠成两路声音（回归）', async () => {
    let oscillators = 0;
    class CountingContext extends FakeAudioContext {
      createOscillator() { oscillators += 1; return new FakeNode(); }
    }
    g.AudioContext = CountingContext;
    (window as unknown as AudioGlobal).AudioContext = CountingContext;

    const a = new Ambience();
    await a.start();
    // 旧实现会在这里创建 4 个持续振荡器，形成低通“电流嗡声”
    expect(oscillators).toBe(0);

    // 交互提示音仍然保留（瞬时振荡器，播完即停）
    a.setMuted(false);
    a.blip('place');
    expect(oscillators).toBe(1);
  });
});
