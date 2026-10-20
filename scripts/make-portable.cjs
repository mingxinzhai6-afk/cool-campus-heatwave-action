/**
 * 免安装试玩包：把 vite 构建产物（dist）改造成 file:// 双击即可运行的版本。
 *
 * 背景：vite 产物是 <script type="module">，浏览器在 file:// 下会因 CORS 拒绝加载模块脚本。
 * 做法：
 *   1. 用 esbuild 把入口模块重新打成 IIFE（传统脚本），写成 dist/app.js；
 *   2. 把 index.html 里的模块脚本标签换成普通 <script defer>；
 *   3. HTML / CSS 里残留的绝对路径统一改成相对路径（./），适配 file:// 与任意子目录部署。
 *
 * 用法：npm run build:portable
 *   产物目录：<项目根>/portable/（含 index.html、app.js、assets、使用说明.txt）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'portable');

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('找不到 dist/index.html —— 请先运行 vite build（npm run build:portable 会自动先构建）');
  process.exit(1);
}

/* ---------- 1. 找到模块入口并转成 IIFE ---------- */
async function main() {
let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const scriptRe = /<script type="module"[^>]*src="([^"]+)">[^<]*<\/script>|<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/;
const m = html.match(scriptRe);
if (!m) {
  console.log('未发现模块脚本标签（可能已是传统脚本）');
} else {
  const srcRel = (m[1] || m[2]).replace(/^\.\//, '');
  const entry = path.join(DIST, srcRel);
  if (!fs.existsSync(entry)) {
    console.error('找不到入口脚本:', entry);
    process.exit(1);
  }
  // IIFE 里没有 import.meta：把「资源相对定位」改为以页面地址为基准的 assets/ 目录。
  // 产物里资源名（如 logo-mark-x.png）是相对 JS 文件（assets/ 目录）解析的，
  // 所以基准要写成 new URL("assets/", document.baseURI)，否则会指到根目录。
  const chunk = fs.readFileSync(entry, 'utf8');
  const before = (chunk.match(/import\.meta\.url/g) || []).length;
  const fixed = chunk.replace(/import\.meta\.url/g, 'new URL("assets/", document.baseURI).href');
  console.log('资源基准改写：import.meta.url ×' + before + ' → assets/ 目录（document.baseURI）');
  const tmpEntry = path.join(DIST, 'assets', '__portable_entry.js');
  fs.writeFileSync(tmpEntry, fixed, 'utf8');
  await esbuild.build({
    entryPoints: [tmpEntry],
    bundle: true,
    format: 'iife',
    target: ['es2019'],
    minify: true,
    outfile: path.join(DIST, 'app.js'),
    logLevel: 'warning',
  });
  fs.unlinkSync(tmpEntry);
  await esbuild.stop();
  html = html.replace(scriptRe, '<script defer src="./app.js"></script>');
  console.log('已把模块脚本转成 IIFE 传统脚本（app.js，import.meta.url → document.baseURI）');
}

/* ---------- 2. 绝对路径 → 相对路径；并去掉 file:// 下的拦截属性 ---------- */
html = html.replace(/(\s(?:src|href)=")\/(?!\/)/g, '$1./');
// crossorigin 会让样式表/脚本在 file:// 下被当作跨域请求而加载失败；
// modulepreload 指向打包前的模块文件（IIFE 方案里已不需要）
html = html.replace(/\s+crossorigin(="[^"]*")?/g, '');
html = html.replace(/<link rel="modulepreload"[^>]*>\s*/g, '');
fs.writeFileSync(path.join(DIST, 'index.html'), html, 'utf8');
console.log('index.html：绝对路径已改为相对、crossorigin/modulepreload 已移除');

const cssFiles = fs.readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.css'));
for (const f of cssFiles) {
  const fp = path.join(DIST, 'assets', f);
  const css = fs.readFileSync(fp, 'utf8');
  const next = css.replace(/url\(\//g, 'url(./').replace(/url\("\/"/g, 'url("./').replace(/url\('\/'/g, "url('./");
  if (next !== css) {
    fs.writeFileSync(fp, next, 'utf8');
    console.log('已把 CSS 里的绝对路径改为相对：', f);
  }
}

/* ---------- 3. 输出试玩包目录 ---------- */
/* 注意：本机 Node 上 fs.cpSync 会原生崩溃（0xC0000409），改用逐文件复制 */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dest, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
fs.rmSync(OUT, { recursive: true, force: true });
copyDir(DIST, OUT);
fs.writeFileSync(
  path.join(OUT, '使用说明.txt'),
  [
    '清凉一夏 · 热浪行动 —— 电脑版免安装试玩',
    '========================================',
    '',
    '怎么玩：双击本文件夹里的 index.html，用浏览器打开即可（推荐 Chrome / Edge 最新版）。',
    '无需安装任何软件、无需联网。',
    '',
    '如果双击后页面空白：',
    '  1) 请确认使用的是 Chrome 或 Edge（非 IE）；',
    '  2) 右键 index.html →「打开方式」→ 选择 Chrome / Edge；',
    '  3) 仍不行时，换一台电脑或用「本机服务器」方式：把整个文件夹放到任意 HTTP 服务下打开。',
    '',
    '玩法速览：',
    '  · 打开后先看关卡简报 → 点「进入处置 · 开始规划」；',
    '  · 选中工具后在目标地块点两下（第一下预览、第二下放置）；',
    '  · 「推进时间」查看人群与热力变化，结束后查看结算复盘；',
    '  · 「方法与边界」页可查看完整设计说明。',
    '',
    '制作：清凉一夏 · 热浪行动团队',
    '',
  ].join('\r\n'),
  'utf8'
);
console.log('试玩包已生成：' + OUT);
}

main().catch((e) => {
  console.error('生成试玩包失败：', e);
  process.exit(1);
});
