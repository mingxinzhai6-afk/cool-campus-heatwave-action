/**
 * 给小程序编译产物（wechat-miniprogram-app/core）里的相对 require 补全 .js 后缀。
 * tsc 输出的 CommonJS 是 require("../data/campus") 这种无后缀形式；
 * 小程序对模块路径解析更严格，统一补成 require("../data/campus.js") 最稳。
 * 由 npm run mp:build 在 tsc 之后自动执行。
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, 'wechat-miniprogram-app', 'core');
let fixed = 0;

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!name.endsWith('.js')) continue;
    const src = fs.readFileSync(p, 'utf8');
    const out = src.replace(/require\((["'])(\.{1,2}\/[^"']+)\1\)/g, function (m, q, spec) {
      if (spec.endsWith('.js') || spec.endsWith('.json')) return m;
      fixed++;
      return 'require(' + q + spec + '.js' + q + ')';
    });
    if (out !== src) fs.writeFileSync(p, out);
  }
}

if (fs.existsSync(root)) {
  walk(root);
  console.log('mp-fix-requires: 补全了 ' + fixed + ' 处 require 路径');
} else {
  console.log('mp-fix-requires: 目录不存在，跳过 ' + root);
}
