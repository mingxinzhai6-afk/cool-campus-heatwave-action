import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import IsoMap, { type Layers } from './IsoMap';
import { advance, createState, place } from '../lib/engine';
import { getMap } from '../data/campus';

/** 当前关卡地图上的非空缺地块数量。 */
function tileCount(levelId: string): number {
  return getMap(levelId).tiles.filter((t) => !t.void).length;
}

const base = {
  layers: { heat: true, shade: false, people: false, sensitive: false } as Layers,
  toolId: null,
  hover: null,
  adviceMark: null,
  pickMark: null,
  focus: [],
  rotation: 0,
  onHover: () => {},
  onTileClick: () => {},
};

describe('IsoMap 静态渲染冒烟测试', () => {
  it('渲染全部地块与交互区', () => {
    const html = renderToStaticMarkup(<IsoMap state={createState('l1')} hour={12} {...base} />);
    expect(html).toContain('class="iso-map"');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
    expect((html.match(/class="tile"/g) ?? []).length).toBe(tileCount('l1'));
    expect((html.match(/class="hit-layer"/g) ?? []).length).toBe(1);
  });

  it('开启全部图层并放置设施后仍可渲染', () => {
    let state = createState('l4');
    state = place(state, 'tree', 2, 14);
    state = place(state, 'canopy', 8, 5);
    state = place(state, 'station', 5, 10);
    state = place(state, 'greenroof', 11, 2);
    const layers: Layers = { heat: true, shade: true, people: true, sensitive: true };
    const withTool = renderToStaticMarkup(
      <IsoMap state={state} hour={14} {...base} layers={layers} toolId="mist" hover={{ x: 8, y: 4 }} />,
    );
    expect(withTool).toContain('class="ghost"');
    expect(withTool).toContain('class="pulse"');

    const withAdvice = renderToStaticMarkup(
      <IsoMap state={state} hour={14} {...base} layers={layers} adviceMark={{ x: 5, y: 10 }} />,
    );
    expect(withAdvice).toContain('class="advice-mark"');
  });

  it('四个时刻都能渲染', () => {
    for (const hour of [8, 12, 14, 18] as const) {
      const html = renderToStaticMarkup(<IsoMap state={createState('l5')} hour={hour} {...base} layers={{ heat: true, shade: true, people: true, sensitive: true }} />);
      expect(html.length).toBeGreaterThan(5000);
    }
  });

  it('推进到第二回合后事件状态仍可渲染', () => {
    let state = createState('l1');
    state = advance(state);
    expect(state.round).toBe(1);
    const html = renderToStaticMarkup(<IsoMap state={state} hour={14} {...base} />);
    expect(html).toContain('iso-map');
  });

  it('不同关卡 / 不同天气时刻渲染结果明显不同（不能每关都长一个样）', () => {
    const l1 = renderToStaticMarkup(<IsoMap state={createState('l1')} hour={12} {...base} />);
    const l2 = renderToStaticMarkup(<IsoMap state={createState('l2')} hour={12} {...base} />);
    const l4 = renderToStaticMarkup(<IsoMap state={createState('l4')} hour={8} {...base} />);
    const l5 = renderToStaticMarkup(<IsoMap state={createState('l5')} hour={8} {...base} />);
    expect(l1).not.toBe(l2);   // 天气不同 → 氛围不同
    expect(l1).not.toBe(l4);   // 时刻不同 → 天光不同
    expect(l4).not.toBe(l5);   // 天气不同
  });

  it('开局在地图上标出本关重点区域，放置第一处改造后消失', () => {
    const focus = [{ x: 8, y: 5, label: '中心广场' }];
    const freshState = { ...createState('l4'), placements: [] };
    const fresh = renderToStaticMarkup(<IsoMap state={freshState} hour={8} {...base} focus={focus} />);
    expect(fresh).toContain('focus-ring');
    expect(fresh).toContain('中心广场');
    const after = place(freshState, 'tree', 8, 3);
    const played = renderToStaticMarkup(<IsoMap state={after} hour={8} {...base} focus={focus} />);
    expect(played).not.toContain('focus-ring');
  });

  it('橙色预警有极热地块高亮，降雨天气渲染雨丝，天气氛围各不相同', () => {
    const orange = renderToStaticMarkup(<IsoMap state={createState('l2')} hour={14} {...base} />);
    expect(orange).toContain('#ff2d10');   // 极热地块亮边
    expect(orange).toContain('#ff5f2e');   // 橙色预警的氛围色
    const rainState = { ...createState('l1'), weather: 'rain' as const };
    const rain = renderToStaticMarkup(<IsoMap state={rainState} hour={12} {...base} />);
    expect(rain).toContain('class="rain"');
    expect(rain).toContain('#4f74a8');     // 降雨氛围色
    expect(rain).not.toContain('#ff5f2e');
  });

  it('任意角度都能渲染，地块数量不变，且不同朝向确实不同', () => {
    const seen = new Set<string>();
    for (const rotation of [0, 37, 45, 90, 135, 200, 270, 330]) {
      const html = renderToStaticMarkup(
        <IsoMap state={createState('l4')} hour={14} {...base} rotation={rotation} />,
      );
      expect(html).not.toContain('NaN');
      expect((html.match(/class="tile"/g) ?? []).length).toBe(tileCount('l4'));
      seen.add(html);
    }
    // 连续旋转：每个角度都是不同的投影，包括 45° 这种"某个立面恰好侧对观察者"的临界角
    expect(seen.size).toBe(8);
  });

  it('地图随角度连续旋转（绕竖直轴），且 360° 回到原视角', () => {
    const render = (rotation: number) =>
      renderToStaticMarkup(<IsoMap state={createState('l1')} hour={12} {...base} rotation={rotation} />);

    const at0 = render(0);
    const at90 = render(90);
    const at360 = render(360);

    // 转 90° 后画面必须不同（建筑换了可见立面、地块换了位置）
    expect(at90).not.toBe(at0);
    // 360° 与 0° 完全一致
    expect(at360).toBe(at0);
    expect(at0).not.toContain('NaN');

    // 连续旋转：44° 与 0°、46° 与 44° 都是不同的投影（不再吸附到 90° 的倍数）
    const at44 = render(44);
    const at46 = render(46);
    expect(at44).not.toBe(at0);
    expect(at46).not.toBe(at44);
    expect(at44).not.toContain('NaN');
    expect(at46).not.toContain('NaN');
  });
});
