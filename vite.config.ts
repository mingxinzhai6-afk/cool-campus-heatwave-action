import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 相对路径：既能在本地服务器（含子路径）运行，也支持免安装试玩包用 file:// 双击打开
  base: './',
  build: {
    // 单页应用：静态部署，深层路由由 try_files 回退到 index.html
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
  server: { port: 5174, host: true },
  preview: { port: 4174, host: true },
});
