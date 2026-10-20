// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

// 整机负载高时（浏览器开着演示页等），jsdom 里挂载整套 App 会明显变慢：
// 给这组冒烟测试更宽松的超时，避免把"机器忙"误报成"功能坏了"。
vi.setConfig({ testTimeout: 20_000 });

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let el: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = '';
  el = document.createElement('div');
  el.id = 'root';
  document.body.appendChild(el);
});

async function mount() {
  await act(async () => {
    root = createRoot(el);
    root.render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
  });
}

function clickText(text: string) {
  // 引导浮层通过 Portal 挂在 body 上，统一从 body 里找按钮
  const btn = Array.from(document.body.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(text));
  if (!btn) throw new Error(`找不到按钮：${text}`);
  (btn as HTMLButtonElement).click();
}

describe('App 交互冒烟测试', () => {
  it('挂载后能看到简报', async () => {
    await mount();
    expect(el.textContent ?? '').toContain('清凉一夏');
    expect(el.textContent ?? '').toContain('进入处置');
  });

  it('进入处置后能看到地图、工具坞与目标', async () => {
    await mount();
    await act(async () => { clickText('进入处置'); });
    expect(el.querySelector('.iso-map')).toBeTruthy();
    expect(el.querySelectorAll('.dock-tools button').length).toBeGreaterThan(4);
    expect(el.textContent ?? '').toContain('任务目标');
  });

  it('选工具、放置、推进回合、打开参谋都不报错', async () => {
    await mount();
    await act(async () => { clickText('进入处置'); });

    // 选择第一个工具
    await act(async () => {
      (el.querySelector('.dock-tools button') as HTMLButtonElement).click();
    });
    expect(el.textContent ?? '').toContain('正在放置');

    // 点击地图上的地块（交互层 path：地面 + 建筑立面）
    const hits = el.querySelectorAll('.hit-layer path');
    expect(hits.length).toBeGreaterThanOrEqual(80);
    await act(async () => {
      hits[100].dispatchEvent(new MouseEvent('click', { bubbles: true }));   // 第一下：弹预览卡
    });
    await act(async () => {
      hits[100].dispatchEvent(new MouseEvent('click', { bubbles: true }));   // 第二下：放置
    });

    // 打开参谋建议
    await act(async () => { clickText('看看参谋建议'); });
    expect(el.textContent ?? '').toContain('参谋建议');

    // 推进时间
    const advance = Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('推进到'));
    expect(advance).toBeTruthy();
    await act(async () => { (advance as HTMLButtonElement).click(); });
    expect(el.textContent ?? '').toContain('午后热浪');
  });

  it('可以旋转视角（拖条与按钮）', async () => {
    await mount();
    await act(async () => { clickText('进入处置'); });
    const label = () => el.querySelector('.iso-map')?.getAttribute('aria-label') ?? '';
    expect(label()).toContain('视角 0 度');

    // 连续旋转拖条：可以拖到任意角度
    const slider = el.querySelector('.view-slider input[type="range"]') as HTMLInputElement;
    expect(slider).toBeTruthy();
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('360');
    await act(async () => {
      // React 追踪 input.value 的赋值，必须用原型上的原生 setter 绕过它，再派发事件
      const proto = Object.getPrototypeOf(slider) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(slider, '90');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // 视角连续旋转：拖到 90° 就是 90°
    expect(label()).toContain('视角 90 度');

    // 微调按钮：每按一次转 15°，显示值就是实际角度（不吸附）
    const right = el.querySelector('.view-controls button[aria-label="顺时针旋转"]') as HTMLButtonElement;
    expect(right).toBeTruthy();
    await act(async () => { right.click(); });   // 90 + 15 = 105
    expect(label()).toContain('视角 105 度');

    await act(async () => { right.click(); });   // 105 + 15 = 120
    expect(label()).toContain('视角 120 度');

    await act(async () => { right.click(); });   // 120 + 15 = 135
    expect(label()).toContain('视角 135 度');

    const left = el.querySelector('.view-controls button[aria-label="逆时针旋转"]') as HTMLButtonElement;
    await act(async () => { left.click(); });    // 135 − 15 = 120
    expect(label()).toContain('视角 120 度');

    // 重置按钮回到 0°
    const reset = el.querySelector('.view-controls button[aria-label="重置视角"]') as HTMLButtonElement;
    expect(reset).toBeTruthy();
    await act(async () => { reset.click(); });
    expect(label()).toContain('视角 0 度');

    // 反向转 15°：0 → 345
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    });
    expect(label()).toContain('视角 345 度');
  });

  it('一键帮我规划会真的放下改造', async () => {
    await mount();
    await act(async () => { clickText('进入处置'); });
    await act(async () => { clickText('自动布置方案'); });
    expect(el.textContent ?? '').toContain('自动布置');
  });

  it('地图左下角的时刻/天气图标已移除，旋转控件不受影响', async () => {
    await mount();
    await act(async () => { clickText('进入处置'); });
    expect(el.querySelector('.map-badge')).toBeNull();
    expect(el.querySelector('.view-controls')).toBeTruthy();
    expect(el.querySelector('.focus-hint')).toBeTruthy();   // 本关重点仍在
  });

  it('结算不足 3 星时不能进入下一关，并鼓励用自动布置方案；达标后解锁', async () => {
    await mount();
    await act(async () => { clickText('进入处置'); });
    const advance = () => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('推进到')) as HTMLButtonElement;
    await act(async () => { advance().click(); });
    await act(async () => { clickText('结束推演'); });           // 0 星结算
    const nextBtn = Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('进入下一关')) as HTMLButtonElement;
    expect(nextBtn).toBeTruthy();
    expect(nextBtn.disabled).toBe(true);                         // 两星及以下不能按
    expect(el.textContent ?? '').toContain('自动布置方案');       // 提示 + 鼓励
    expect(el.textContent ?? '').toContain('还差一点');

    // 重做（清空改造、回到开局）→ 自动布置 → 推进 → 再次结算 → 3 星解锁
    await act(async () => { clickText('重做本关'); });
    await act(async () => { clickText('自动布置方案'); });
    await act(async () => { advance().click(); });
    await act(async () => { clickText('结束推演'); });
    const nextBtn2 = Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('进入下一关')) as HTMLButtonElement;
    expect(nextBtn2.disabled).toBe(false);
  });

  it('撤销：推进时间后一键回到上一时刻', async () => {
    await mount();
    await act(async () => { clickText('进入处置'); });
    const advance = Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('推进到')) as HTMLButtonElement;
    await act(async () => { advance.click(); });
    expect(el.textContent ?? '').toContain('结束推演');          // 已到最后一个时刻
    await act(async () => { clickText('撤销'); });
    expect(el.textContent ?? '').toContain('推进到 14:00');      // 回到上一时刻，按钮恢复
    expect(el.textContent ?? '').not.toContain('结束推演');
  });

  it('撤销：一键自动布置整批一次收回', async () => {
    await mount();
    await act(async () => { clickText('进入处置'); });
    const budget = () => {
      const pill = Array.from(el.querySelectorAll('.hud-pill')).find((p) => (p.textContent ?? '').includes('预算'));
      return pill?.querySelector('b')?.textContent ?? '';
    };
    expect(budget()).toBe('20');
    await act(async () => { clickText('自动布置方案'); });
    expect(el.textContent ?? '').toContain('一键自动布置完成');
    expect(budget()).not.toBe('20');                            // 已经花掉一部分
    await act(async () => { clickText('撤销'); });
    expect(el.textContent ?? '').toContain('撤销上一步操作');    // 决策记录留痕
    expect(budget()).toBe('20');                                // 预算整批退回
  });

  it('结算后从行动清单返回推演，会重新弹出复盘且按钮不再被禁用', async () => {
    await mount();
    await act(async () => { clickText('进入处置'); });

    // 推进到最后一个时刻，再结束推演
    const advance = Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('推进到'));
    expect(advance).toBeTruthy();
    await act(async () => { (advance as HTMLButtonElement).click(); });
    await act(async () => { clickText('结束推演'); });
    expect(el.textContent ?? '').toContain('重做本关');       // 复盘弹窗出现

    // 查看行动清单 → 返回推演：复盘必须重新出现（此前会卡住：弹窗不重现、按钮被禁用）
    await act(async () => { clickText('查看行动清单'); });
    expect(el.textContent ?? '').toContain('清凉改造行动清单');
    expect(el.textContent ?? '').not.toContain('重做本关');

    await act(async () => { clickText('← 返回推演'); });
    expect(el.textContent ?? '').toContain('重做本关');       // 复盘重新弹出

    const reviewBtn = Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('查看结算复盘'));
    expect(reviewBtn).toBeTruthy();
    expect((reviewBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('重做本关：地图改造清零、决策记录保留、不弹简报、可再次结算', async () => {
    await mount();
    await act(async () => { clickText('进入处置'); });
    await act(async () => { clickText('自动布置方案'); });   // 留下一批改造
    expect(el.textContent ?? '').toContain('建成');

    const advance = () => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('推进到')) as HTMLButtonElement;
    await act(async () => { advance().click(); });
    await act(async () => { clickText('结束推演'); });
    expect(el.querySelector('.result-modal')).toBeTruthy();   // 复盘出现

    await act(async () => { clickText('重做本关'); });
    expect(el.querySelector('.result-modal')).toBeNull();     // 复盘关闭
    expect(el.textContent ?? '').not.toContain('进入处置');    // 没有再弹关卡简报
    expect(el.textContent ?? '').toContain('预算 20 万');       // 改造已清空，预算回到开局
    // 决策记录保留：旧记录还在，并追加一条「重做本关」说明
    const logItems = Array.from(el.querySelectorAll('.log-list li'));
    expect(logItems.length).toBeGreaterThan(1);
    expect(el.textContent ?? '').toContain('重做本关：地图上的改造已清空，决策记录保留');

    // 回到开局后重新推进，可再次结算
    await act(async () => { advance().click(); });
    await act(async () => { clickText('结束推演'); });
    expect(el.querySelector('.result-modal')).toBeTruthy();
  });

  it('每关保留各自的推演进度：切到别的关再回来，还是原来的界面', async () => {
    await mount();
    await act(async () => { clickText('进入处置'); });
    await act(async () => { clickText('自动布置方案'); });
    const advance = () => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('推进到')) as HTMLButtonElement;
    await act(async () => { advance().click(); });
    await act(async () => { clickText('结束推演'); });
    await act(async () => { clickText('重做本关'); });

    // 切到第 2 关：第一次打开，应弹关卡简报
    await act(async () => { clickText('控制台'); });
    await act(async () => { clickText('热浪橙色预警'); });
    expect(el.textContent ?? '').toContain('进入处置');
    await act(async () => { clickText('进入处置'); });
    expect(el.textContent ?? '').not.toContain('重做本关：现有改造与记录原样保留');   // 这是第 2 关自己的界面

    // 回到第 1 关：不再弹简报，直接回到离开时的界面
    await act(async () => { clickText('控制台'); });
    await act(async () => { clickText('正午的中心广场'); });
    expect(el.textContent ?? '').not.toContain('进入处置');
    // 重做本关清了地图改造：预算回到开局；决策记录仍保留
    const l1LogItems = Array.from(el.querySelectorAll('.log-list li'));
    expect(l1LogItems.length).toBeGreaterThan(1);
    expect(el.textContent ?? '').toContain('重做本关：地图上的改造已清空，决策记录保留');
    expect(el.textContent ?? '').toContain('预算 20 万');                        // 第 1 关的改造已清空
  });

  it('未通关时控制台里下一关是锁定的；拿到 3 星后解锁', async () => {
    await mount();
    await act(async () => { clickText('进入处置'); });

    // 没通关：第 2 关按钮禁用，点击不会切关
    await act(async () => { clickText('控制台'); });
    const l2Btn = () => Array.from(el.querySelectorAll('.control-levels button')).find((b) => (b.textContent ?? '').includes('热浪橙色预警')) as HTMLButtonElement;
    expect(l2Btn().disabled).toBe(true);
    await act(async () => { l2Btn().click(); });
    expect(el.textContent ?? '').toContain('正午的中心广场');   // 仍在第 1 关
    await act(async () => { clickText('控制台'); });             // 收起控制台

    // 自动布置 + 推进 + 结算拿到 3 星
    await act(async () => { clickText('自动布置方案'); });
    const advance = () => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('推进到')) as HTMLButtonElement;
    await act(async () => { advance().click(); });
    await act(async () => { clickText('结束推演'); });
    expect(el.querySelector('.result-modal')).toBeTruthy();
    await act(async () => { clickText('重做本关'); });

    // 通关后：第 2 关解锁，控制台可以切过去
    await act(async () => { clickText('控制台'); });
    expect(l2Btn().disabled).toBe(false);
    await act(async () => { l2Btn().click(); });
    expect(el.textContent ?? '').toContain('进入处置');          // 第 2 关的关卡简报
  });

  it('引导第一步：其余界面变灰暗，气泡提醒查看左侧', async () => {
    await mount();
    await act(async () => { clickText('进入处置'); });
    const bubbleText = document.body.querySelector('.tut-bubble')?.textContent ?? '';
    expect(bubbleText).toContain('左侧');                    // 提醒引导主要在左侧
    expect(document.body.querySelector('.tut-dim')).toBeTruthy();   // 全屏变暗（聚光灯遮罩）出现
    await act(async () => { clickText('下一步'); });           // 欢迎页 → 第 1 步（选工具）
    expect(document.body.querySelector('.tut-dim')).toBeNull();     // 后续步骤不再压暗界面
  });

  /** 走到「图层板块」步：欢迎 → 选工具 → 放置 → 看数字 → 下一步。 */
  async function walkTutorialToLayers() {
    await act(async () => { clickText('进入处置'); });
    await act(async () => { clickText('下一步'); });                     // 欢迎 → 选工具
    await act(async () => { (el.querySelector('.dock-tools button') as HTMLButtonElement).click(); });
    // 放置：逐个试交互层里的地块，直到教程推进到第 3 步（说明真的放下了）
    const hits = el.querySelectorAll('.hit-layer path');
    for (let i = 0; i < hits.length; i += 3) {
      await act(async () => { hits[i].dispatchEvent(new MouseEvent('click', { bubbles: true })); }); // 第一下：弹预览卡
      await act(async () => { hits[i].dispatchEvent(new MouseEvent('click', { bubbles: true })); }); // 第二下：放置
      if ((document.body.textContent ?? '').includes('第 3 步')) break;
    }
    expect(document.body.textContent ?? '').toContain('第 3 步');
    await act(async () => { clickText('下一步'); });                     // 看数字 → 图层
  }

  /** 一路走到「采用建议的两种方式」步（建议弹窗开着，等待玩家选择完成方式）。 */
  async function walkTutorialToAdviceUse() {
    await walkTutorialToLayers();
    const chip = el.querySelector('.layer-panel .layer-row button') as HTMLButtonElement;
    expect(chip).toBeTruthy();
    await act(async () => { chip.click(); });                            // 图层 → 认识右侧面板
    await act(async () => { clickText('下一步'); });                     // 面板 → 转动视角
    const rotateBtn = el.querySelector('.view-controls button[aria-label="顺时针旋转"]') as HTMLButtonElement;
    expect(rotateBtn).toBeTruthy();
    await act(async () => { rotateBtn.click(); });                       // 转视角 → 听参谋建议
    await act(async () => { clickText('看看参谋建议'); });                // 打开弹窗 → 采用建议
    expect(el.querySelector('.advice-modal')).toBeTruthy();
  }

  it('引导：图层板块介绍四个开关，拨动开关即完成本步', async () => {
    await mount();
    await walkTutorialToLayers();
    expect(document.body.textContent ?? '').toContain('第 4 步 · 图层板块');
    for (const label of ['热力', '遮阴', '人群', '脆弱群体']) expect(el.textContent ?? '').toContain(label);
    const chip = el.querySelector('.layer-panel .layer-row button') as HTMLButtonElement;
    expect(chip).toBeTruthy();
    await act(async () => { chip.click(); });                            // 拨动开关即完成，自动进入下一步
    expect(document.body.textContent ?? '').toContain('第 5 步 · 认识右侧面板');
  });

  it('引导：打开参谋建议后，介绍「在地图上标出并采用 / 自动布置方案」', async () => {
    await mount();
    await walkTutorialToAdviceUse();
    expect(document.body.textContent ?? '').toContain('第 8 步 · 采用建议的两种方式');
    expect(el.textContent ?? '').toContain('在地图上标出并采用');
    expect(el.textContent ?? '').toContain('自动布置方案');
  });

  it('引导：点「在地图上标出并采用」完成本步，自动进入下一步', async () => {
    await mount();
    await walkTutorialToAdviceUse();
    await act(async () => { clickText('在地图上标出并采用'); });
    expect(el.querySelector('.advice-modal')).toBeNull();            // 弹窗关闭
    expect(el.querySelector('.pick-mark')).toBeTruthy();             // 地图上出现红钉
    expect(document.body.textContent ?? '').toContain('第 9 步 · 打开图书馆');   // 自动进入下一步
  });

  it('引导：点「自动布置方案」也能完成本步', async () => {
    await mount();
    await walkTutorialToAdviceUse();
    const autoBtn = Array.from(el.querySelectorAll('.advice-modal button')).find((b) => (b.textContent ?? '').includes('自动布置方案')) as HTMLButtonElement;
    expect(autoBtn).toBeTruthy();
    await act(async () => { autoBtn.click(); });
    expect(el.querySelector('.advice-modal')).toBeNull();
    expect(document.body.textContent ?? '').toContain('第 9 步 · 打开图书馆');
    expect(el.textContent ?? '').toContain('一键自动布置完成');   // 真的铺下了方案
  });

  it('引导：点「返回」关闭建议弹窗也算完成本步，不会卡在已消失的目标上', async () => {
    await mount();
    await walkTutorialToAdviceUse();
    await act(async () => { clickText('返回'); });
    expect(el.querySelector('.advice-modal')).toBeNull();
    expect(document.body.textContent ?? '').toContain('第 9 步 · 打开图书馆');
  });

  it('手机窄屏：完整三栏小程序等比缩放（phone-fit），竖屏旋转（rot-90）', async () => {
    const original = Reflect.get(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true, writable: true,
      value: (q: string) => ({
        matches: q.includes('1080'),
        media: q, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    try {
      await mount();
      const app = el.querySelector('.app') as HTMLElement;
      expect(app.classList.contains('phone-fit')).toBe(true);       // 窄屏 → 整块缩放模式
      expect(app.classList.contains('rot-90')).toBe(false);         // jsdom 视口 1024×768 → 横屏不旋转
      expect(app.style.getPropertyValue('--fit-scale')).not.toBe(''); // 写入缩放比例
    } finally {
      if (original === undefined) delete (window as unknown as Record<string, unknown>).matchMedia;
      else Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: original });
    }
  });
});
