/**
 * 横版小程序外壳部件（微信小程序风格）：
 *   MpStatusBar —— 顶部状态栏（时刻 / 信号 / Wi-Fi / 电量）
 *   MpNavbar    —— 导航栏（返回 + 居中标题 + 微信风格胶囊）
 */

export type MpRoute = '/' | '/plan' | '/method';

/* ---------------- 状态栏 ---------------- */
export function MpStatusBar({ hour }: { hour: number }) {
  return (
    <div className="mp-chrome" aria-hidden="true">
      <div className="mp-left">
        <span className="mp-time">{String(hour).padStart(2, '0')}:00</span>
        <svg className="mp-glyph" viewBox="0 0 17 12" width="15" height="11" fill="currentColor">
          <rect x="0" y="7" width="3" height="5" rx="1" />
          <rect x="4.5" y="5" width="3" height="7" rx="1" />
          <rect x="9" y="2.5" width="3" height="9.5" rx="1" />
          <rect x="13.5" y="0" width="3" height="12" rx="1" opacity="0.35" />
        </svg>
        <svg className="mp-glyph" viewBox="0 0 16 12" width="15" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M1.5 4.2a10.5 10.5 0 0 1 13 0" />
          <path d="M4 7a6.5 6.5 0 0 1 8 0" />
          <circle cx="8" cy="10" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      </div>
      <div className="mp-right">
        <svg className="mp-glyph" viewBox="0 0 25 12" width="23" height="11">
          <rect x="0.5" y="0.5" width="20" height="11" rx="3" fill="none" stroke="currentColor" opacity="0.5" />
          <rect x="2" y="2" width="14" height="8" rx="1.6" fill="currentColor" />
          <rect x="22" y="3.5" width="2.5" height="5" rx="1" fill="currentColor" opacity="0.5" />
        </svg>
      </div>
    </div>
  );
}

/* ---------------- 导航栏 ---------------- */
export function MpNavbar({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div className="mp-navbar">
      {onBack ? (
        <button className="mp-nav-back" onClick={onBack} aria-label="返回">‹</button>
      ) : (
        <span className="mp-nav-back empty" aria-hidden="true" />
      )}
      <strong className="mp-nav-title">{title}</strong>
      {/* 微信风格胶囊：••• 与 ◉ 固定在导航栏右侧 */}
      <div className="mp-capsule" aria-hidden="true">
        <span className="mp-dots">•••</span>
        <span className="mp-divider" />
        <span className="mp-ring" />
      </div>
    </div>
  );
}

/* 底部 TabBar 已按需求整组删除（推演 / 行动清单 / 方法与边界）。
   行动清单仍可从「结算复盘 → 查看行动清单」进入；方法与边界仍可从右上角「控制台 ⌘」菜单进入。 */
