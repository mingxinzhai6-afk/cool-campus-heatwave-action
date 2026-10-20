// 零依赖静态服务器：把 dist/ 当成站点根目录发布，带 SPA 路由回退。
// 用法：node serve-dist.mjs [port]（默认 5174），然后打开 http://localhost:5174
// 不需要 npm install，只用 Node 内置模块 —— 现场演示离线可用。
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const port = Number(process.argv[2] || 5174);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  // 只允许 root 之内的路径，避免 ../ 越界读取
  let filePath = normalize(join(root, urlPath));
  if (!filePath.startsWith(root)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  // SPA 回退：文件不存在或目录一律返回 index.html
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, 'index.html');
  }
  const type = types[extname(filePath).toLowerCase()] || 'application/octet-stream';
  // 本地演示常会重新构建：禁用缓存，避免浏览器一直跑旧包
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  createReadStream(filePath).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`清凉校园已在 http://localhost:${port} 启动（Ctrl+C 停止）`);
});
