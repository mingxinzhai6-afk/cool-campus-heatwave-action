/**
 * 品牌标志资源。
 *
 * 原始图：`assets/logo-source.png`（1024×1024 的方形应用图标）。
 * 由它派生出界面用到的两份资源：
 *   - assets/logo-mark.png：只保留「叶·水滴·太阳」图形并铺白底，用于 HUD 角标、简报抬头与浏览器图标（小尺寸下依然清晰）；
 *   - assets/logo.png：完整图标（含底部「清凉一夏」字带），用于生成 Apple 主屏图标等大尺寸场景。
 * 两者都随构建产物打包，文件名带哈希。
 */
export const LOGO_MARK = new URL('../../assets/logo-mark.png', import.meta.url).href;
