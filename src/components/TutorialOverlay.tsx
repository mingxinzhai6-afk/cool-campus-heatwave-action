/**
 * 新手引导浮层：高亮目标元素 + 指令气泡。
 *
 * 浮层渲染在外壳内部，与地图共用同一个坐标系——手机端「完整版小程序」
 * 整块等比缩放（竖屏还会旋转 90°）时，气泡和高亮随之一起缩放，
 * 呈现和电脑端完全一致。
 *
 * 位置的精确性靠三枚探针：它们固定定位在外壳内的 (0,0) / (100,0) / (0,100)，
 * 量出这两个基向量在视口中的方向与长度，就能把任意目标的视口矩形
 * 反算回外壳局部坐标——无论外壳如何平移 / 缩放 / 旋转，高亮都不会错位。
 *
 * 高亮用一圈带脉冲动画的描边（不遮罩整个界面，避免玩家看不到全局），
 * 位置由目标元素的 getBoundingClientRect 实时计算，因此响应式布局下也不会错位。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TutorialStep } from '../data/tutorial';

type Rect = { x: number; y: number; w: number; h: number };

function measure(selector?: string): Rect | null {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** 外壳局部坐标 → 视口坐标的线性映射（三枚探针量得；无变换时为恒等）。 */
type Basis = { ox: number; oy: number; ax: number; ay: number; bx: number; by: number; det: number };

const IDENTITY: Basis = { ox: 0, oy: 0, ax: 1, ay: 0, bx: 0, by: 1, det: 1 };

function measureBasis(p0: HTMLElement | null, px: HTMLElement | null, py: HTMLElement | null): Basis {
  if (!p0 || !px || !py) return IDENTITY;
  const r0 = p0.getBoundingClientRect();
  const rx = px.getBoundingClientRect();
  const ry = py.getBoundingClientRect();
  // 局部 x 轴 / y 轴：每 100 局部像素对应视口中的位移向量
  const ax = (rx.left - r0.left) / 100;
  const ay = (rx.top - r0.top) / 100;
  const bx = (ry.left - r0.left) / 100;
  const by = (ry.top - r0.top) / 100;
  const det = ax * by - ay * bx;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-6) return { ...IDENTITY, ox: r0.left, oy: r0.top };
  return { ox: r0.left, oy: r0.top, ax, ay, bx, by, det };
}

export default function TutorialOverlay({
  step, index, total, onSkip, onPrev, onNext,
}: {
  step: TutorialStep;
  index: number;
  total: number;
  onSkip: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [spot, setSpot] = useState<Rect | null>(null);
  const [basis, setBasis] = useState<Basis>(IDENTITY);
  const p0Ref = useRef<HTMLElement | null>(null);
  const pxRef = useRef<HTMLElement | null>(null);
  const pyRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      setRect(measure(step.target));
      setSpot(measure(step.spotlight));
      setBasis(measureBasis(p0Ref.current, pxRef.current, pyRef.current));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const t = window.setInterval(update, 400); // 面板展开/收起后位置会变，定时兜底
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.clearInterval(t);
    };
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSkip]);

  /** 视口坐标 → 外壳局部坐标（基向量映射的逆）。 */
  const toLocal = (x: number, y: number) => ({
    x: (basis.by * (x - basis.ox) - basis.bx * (y - basis.oy)) / basis.det,
    y: (-basis.ay * (x - basis.ox) + basis.ax * (y - basis.oy)) / basis.det,
  });

  const toLocalRect = (r: Rect | null): Rect | null => {
    if (!r) return null;
    const a = toLocal(r.x, r.y);
    const b = toLocal(r.x + r.w, r.y + r.h);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  };

  const rectL = toLocalRect(rect);
  const spotL = toLocalRect(spot);

  /** 视口在外壳局部坐标系中的可视范围（缩放 / 旋转后依然成立）。 */
  const lv = (() => {
    const cs = [toLocal(0, 0), toLocal(window.innerWidth, 0), toLocal(window.innerWidth, window.innerHeight), toLocal(0, window.innerHeight)];
    const x0 = Math.min(...cs.map((c) => c.x));
    const x1 = Math.max(...cs.map((c) => c.x));
    const y0 = Math.min(...cs.map((c) => c.y));
    const y1 = Math.max(...cs.map((c) => c.y));
    return { x0, y0, w: x1 - x0, h: y1 - y0 };
  })();

  // 气泡定位（全部在外壳局部坐标里算）：默认跟着高亮目标；
  // steps 可指定 bubbleTarget（如工具坞）把气泡挪离地图。
  // 先按 place 放在锚点外侧；若会盖住高亮目标（导致没法点），就翻到对面。
  const bubbleRaw = (() => {
    const base = step.bubbleTarget ? toLocalRect(measure(step.bubbleTarget)) : null;
    const anchor = base ?? rectL;
    if (!anchor) return { left: lv.x0 + lv.w / 2, top: lv.y0 + lv.h / 2, transform: 'translate(-50%, -50%)' } as const;
    const gap = 12;
    const BW = 268;   // 气泡近似宽度（局部像素，随外壳缩放）
    const BH = 150;   // 气泡近似高度
    const clampX = (x: number) => Math.min(Math.max(x, lv.x0 + BW / 2 + 12), lv.x0 + lv.w - BW / 2 - 12);
    const cx = clampX(anchor.x + anchor.w / 2);
    const cy = anchor.y + anchor.h / 2;

    const candidates: Record<string, { left: number; top: number; transform: string; box: [number, number, number, number] }> = {
      top: { left: cx, top: anchor.y - gap, transform: 'translate(-50%, -100%)', box: [cx - BW / 2, anchor.y - gap - BH, cx + BW / 2, anchor.y - gap] },
      bottom: { left: cx, top: anchor.y + anchor.h + gap, transform: 'translate(-50%, 0)', box: [cx - BW / 2, anchor.y + anchor.h + gap, cx + BW / 2, anchor.y + anchor.h + gap + BH] },
      left: { left: Math.max(anchor.x - gap, lv.x0 + BW + 12), top: cy, transform: 'translate(-100%, -50%)', box: [anchor.x - gap - BW, cy - BH / 2, anchor.x - gap, cy + BH / 2] },
      right: { left: Math.min(anchor.x + anchor.w + gap + BW / 2, lv.x0 + lv.w - BW / 2 - 12), top: cy, transform: 'translate(-50%, -50%)', box: [anchor.x + anchor.w + gap, cy - BH / 2, anchor.x + anchor.w + gap + BW, cy + BH / 2] },
    };
    const order = [step.place ?? 'bottom', 'bottom', 'top', 'left', 'right'];
    const overlaps = (b: [number, number, number, number]) =>
      step.bubbleOverlapOk || !rectL ? false : !(b[2] < rectL.x - 4 || b[0] > rectL.x + rectL.w + 4 || b[3] < rectL.y - 4 || b[1] > rectL.y + rectL.h + 4);
    for (const side of order) {
      const c = candidates[side];
      if (!c) continue;
      const inside = c.box[0] >= lv.x0 + 8 && c.box[1] >= lv.y0 + 8 && c.box[2] <= lv.x0 + lv.w - 8 && c.box[3] <= lv.y0 + lv.h - 8;
      if (inside && !overlaps(c.box)) return { left: c.left, top: c.top, transform: c.transform } as const;
    }
    // 都放不下就放在视野中央偏上
    return { left: clampX(lv.x0 + lv.w / 2), top: lv.y0 + 110, transform: 'translate(-50%, 0)' } as const;
  })();

  const isLast = index >= total - 1;

  /**
   * 气泡挡住了下面的面板时，滚轮 / 手指滑动依然滚动气泡下方的内容。
   * （第 4 步让玩家「把面板向下滑」找图层板块，而气泡正停在面板中间——
   * 不转发的话悬停在气泡上就是死区：滚轮不动、手指也滑不动。）
   */
  const findScroller = (x: number, y: number): HTMLElement | null => {
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      if (el.closest('.tut-bubble')) continue;   // 跳过气泡自身
      let node: HTMLElement | null = el instanceof HTMLElement ? el : null;
      while (node) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
        node = node.parentElement;
      }
      break;   // 只认气泡下面最顶层的那个元素，它属于哪个滚动容器就滚哪个
    }
    return null;
  };

  // 外壳局部坐标系里每 1 个视口像素等于 1/scale 个局部像素；滚轮步长随缩放折算
  const scale = Math.hypot(basis.ax, basis.ay) || 1;

  const forwardWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const target = findScroller(e.clientX, e.clientY);
    if (target) target.scrollBy({ top: e.deltaY / scale });
  };

  /**
   * 触摸转发：手指按在气泡上下滑，滚动气泡下方那个面板，气泡本身不动。
   * 手指位移经 toLocal 换算到外壳局部坐标再套用，手机端等比缩放（fit）与
   * 竖屏旋转（rot-90）时，滑动方向与速度都和面板真实跟手一致。
   */
  const touchDrag = useRef<{ scroller: HTMLElement; startLocalY: number; startTop: number } | null>(null);

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) { touchDrag.current = null; return; }
    const t = e.touches[0];
    const scroller = findScroller(t.clientX, t.clientY);
    touchDrag.current = scroller
      ? { scroller, startLocalY: toLocal(t.clientX, t.clientY).y, startTop: scroller.scrollTop }
      : null;
  };

  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const drag = touchDrag.current;
    if (!drag || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dy = drag.startLocalY - toLocal(t.clientX, t.clientY).y;   // 手指在局部坐标里向上的位移
    drag.scroller.scrollTop = drag.startTop + dy;
  };

  const endTouch = () => { touchDrag.current = null; };

  const probeStyle = (left: number | string, top: number | string): React.CSSProperties => ({
    position: 'fixed', left, top, width: 0, height: 0, visibility: 'hidden', pointerEvents: 'none',
  });

  return (
    <>
      {/* 探针：量出「外壳局部坐标 → 视口坐标」的映射，高亮位置按该坐标系的逆计算 */}
      <i ref={p0Ref as React.Ref<HTMLElement>} style={probeStyle(0, 0)} aria-hidden="true" />
      <i ref={pxRef as React.Ref<HTMLElement>} style={probeStyle('100px', 0)} aria-hidden="true" />
      <i ref={pyRef as React.Ref<HTMLElement>} style={probeStyle(0, '100px')} aria-hidden="true" />

      {step.spotlight && (
        <div
          className={spotL ? 'tut-dim' : 'tut-dim full'}
          aria-hidden="true"
          style={spotL ? {
            left: spotL.x - 8,
            top: spotL.y - 8,
            width: spotL.w + 16,
            height: spotL.h + 16,
          } : undefined}
        />
      )}

      {rectL && (
        <div
          className={`tut-highlight shape-${step.shape ?? 'block'}`}
          style={{
            left: rectL.x - 6,
            top: rectL.y - 6,
            width: rectL.w + 12,
            height: rectL.h + 12,
            borderRadius: (step.shape === 'circle' ? '50%' : '14px'),
          }}
          aria-hidden="true"
        />
      )}

      <div
        className="tut-bubble tut-pos"
        style={bubbleRaw}
        role="dialog"
        aria-label="新手引导"
        onWheel={forwardWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={endTouch}
        onTouchCancel={endTouch}
      >
        <h4 className="tut-title">{step.title}</h4>
        {step.body.split('\n').map((line, i) => (
          <p key={i} className="tut-body">{line}</p>
        ))}
        <div className="tut-actions">
          <button className="tut-skip" onClick={onSkip}>跳过引导</button>
          <span className="tut-step-no">{index + 1} / {total}</span>
          <span className="tut-nav">
            <button className="ghost" onClick={onPrev} disabled={index === 0} aria-label="上一步">‹</button>
            <button className="primary tut-next" onClick={onNext} aria-label={isLast ? '开始游戏' : '下一步'}>
              {isLast ? '开始游戏' : '下一步 ›'}
            </button>
          </span>
        </div>
        {step.target && (
          <p className="tut-tip">{step.tip ?? (step.manual ? '完成上面的操作后，点「下一步」继续' : '完成上面的操作后会自动进入下一步')}</p>
        )}
      </div>
    </>
  );
}
