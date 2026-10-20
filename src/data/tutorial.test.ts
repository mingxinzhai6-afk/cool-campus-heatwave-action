import { describe, expect, it } from 'vitest';
import { TUTORIAL_STEPS, TUTORIAL_TRIGGERS } from './tutorial';

describe('新手引导步骤数据', () => {
  it('「参谋建议」之后紧跟「采用建议的两种方式」', () => {
    const ids = TUTORIAL_STEPS.map((s) => s.id);
    const advice = ids.indexOf('advice');
    expect(advice).toBeGreaterThanOrEqual(0);
    expect(ids[advice + 1]).toBe('adviceUse');
  });

  it('「看看数字变了没有」之后紧跟「图层板块」，介绍四个开关并提醒向下滑', () => {
    const ids = TUTORIAL_STEPS.map((s) => s.id);
    const readMetrics = ids.indexOf('readMetrics');
    expect(ids[readMetrics + 1]).toBe('layers');
    const step = TUTORIAL_STEPS.find((s) => s.id === 'layers');
    expect(step).toBeTruthy();
    for (const label of ['热力', '遮阴', '人群', '脆弱群体']) expect(step!.body).toContain(label);
    expect(step!.body).toContain('向下滑');   // 图层在面板偏下，提醒玩家下滑查看
    expect(step!.target).toBe('.layer-row');
    expect(TUTORIAL_TRIGGERS.layers).toEqual(['layerToggled']);
  });

  it('气泡锚点避开关键元素：看数字步不压数字、参谋建议步只圈按钮且不压按钮、图层步不压开关', () => {
    const byId = new Map(TUTORIAL_STEPS.map((s) => [s.id, s]));
    // 读数字步：气泡挂在态势数字面板上方，完整露出 stat-grid 与按钮
    expect(byId.get('readMetrics')!.bubbleTarget).toBe('.metrics-panel');
    // 参谋建议步：高亮圈只圈按钮本身，气泡挂在按钮上方且不允许覆盖按钮
    const advice = byId.get('advice')!;
    expect(advice.target).toBe('.metrics-advice');
    expect(advice.bubbleTarget).toBe('.metrics-advice');
    expect(advice.bubbleOverlapOk).toBeFalsy();
    // 图层步：气泡挂在整块图层面板上方，不挡开关与色带
    expect(byId.get('layers')!.bubbleTarget).toBe('.layer-panel');
    expect(byId.get('layers')!.place).toBe('top');
  });

  it('新步骤介绍两个按钮的用法：高亮只圈「在地图上标出并采用」按钮，气泡指向建议弹窗右侧', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'adviceUse');
    expect(step).toBeTruthy();
    expect(step!.body).toContain('在地图上标出并采用');
    expect(step!.body).toContain('自动布置方案');
    expect(step!.target).toBe('.advice-list .primary.small');
    expect(step!.bubbleTarget).toBe('.advice-modal');
    expect(step!.place).toBe('right');
  });

  it('触发器：采用建议步接受「标出并采用 / 自动布置 / 返回」任一完成动作', () => {
    expect(TUTORIAL_TRIGGERS.adviceUse).toEqual(['advicePicked', 'advicePlanned', 'adviceClosed']);
  });

  it('第一步欢迎页：聚光灯只打在引导气泡上，并提醒引导主要在左侧', () => {
    const welcome = TUTORIAL_STEPS.find((s) => s.id === 'welcome');
    expect(welcome).toBeTruthy();
    expect(welcome!.spotlight).toBe('.tut-bubble');
    expect(welcome!.body).toContain('左侧');
    // 只有第一步做全屏变暗，后续步骤不压暗界面
    for (const s of TUTORIAL_STEPS.filter((x) => x.id !== 'welcome')) {
      expect(s.spotlight).toBeUndefined();
    }
  });

  it('步骤 id 唯一、编号连续（第 1 步 起逐条 +1）、文案完整', () => {
    const ids = TUTORIAL_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const numbered = TUTORIAL_STEPS.filter((s) => /^第 \d+ 步/.test(s.title));
    expect(numbered).toHaveLength(11);
    numbered.forEach((s, i) => expect(s.title.startsWith(`第 ${i + 1} 步`)).toBe(true));
    for (const s of TUTORIAL_STEPS) expect(s.body.trim().length).toBeGreaterThan(10);
  });
});
