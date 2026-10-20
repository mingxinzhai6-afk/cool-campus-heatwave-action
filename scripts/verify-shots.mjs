/**
 * 浏览器验收脚本：跑通"简报 → 放置 → 事件 → 复盘"主流程，并输出截图。
 * 用法： node scripts/verify-shots.mjs [baseUrl]
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] ?? 'http://localhost:4174';
const outDir = new URL('../docs/screenshots/', import.meta.url).pathname;
await mkdir(outDir, { recursive: true });

// 允许通过 PW_CHROME 指定本机已有的 Chromium，避免重复下载。
const executablePath = process.env.PW_CHROME || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });

async function shot(name) {
  await page.screenshot({ path: `${outDir}${name}.png` });
  console.log('  ✓', name);
}

console.log('== 桌面端 ==');
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await shot('01-intro-desktop');

// 进入第 1 关
await page.getByRole('button', { name: /进入处置/ }).click();
await page.waitForTimeout(700);
await shot('02-game-desktop');

// 选择行道树
await page.locator('.dock-tools button', { hasText: '行道树' }).first().click();
await page.waitForTimeout(250);
// 悬停中心广场以显示效果预览（SVG 中心附近）
const map = page.locator('.iso-map');
const box = await map.boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.52);
  await page.waitForTimeout(400);
  await shot('03-placement-preview');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.52);
  await page.waitForTimeout(400);
}

// 打开参谋建议
await page.getByRole('button', { name: /查看参谋建议/ }).click();
await page.waitForTimeout(600);
await shot('04-advice');
await page.locator('.advice-panel .ghost.small').click();

// 打开全部图层
for (const label of ['遮阴', '人群', '脆弱群体']) {
  await page.locator('.layer-row .chip', { hasText: label }).click();
  await page.waitForTimeout(200);
}
await shot('05-layers');
for (const label of ['遮阴', '人群', '脆弱群体']) {
  await page.locator('.layer-row .chip', { hasText: label }).click();
}

// 推进两回合触发事件
await page.locator('.round-card .primary').click();
await page.waitForTimeout(500);
await page.locator('.round-card .primary').click();
await page.waitForTimeout(900);
await shot('06-result-desktop');

// 方法页
await page.goto(base + '/method', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await shot('07-method-desktop');

// 行动清单
await page.goto(base + '/plan', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await shot('08-plan-desktop');

console.log('== 移动端 ==');
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await mobile.goto(base + '/', { waitUntil: 'networkidle' });
await mobile.waitForTimeout(900);
await mobile.screenshot({ path: `${outDir}09-intro-mobile.png` });
console.log('  ✓ 09-intro-mobile');
await mobile.getByRole('button', { name: /进入处置/ }).click();
await mobile.waitForTimeout(700);
await mobile.screenshot({ path: `${outDir}10-game-mobile.png` });
console.log('  ✓ 10-game-mobile');
await mobile.locator('.mobile-tabs button', { hasText: '目标' }).click();
await mobile.waitForTimeout(400);
await mobile.screenshot({ path: `${outDir}11-goals-mobile.png` });
console.log('  ✓ 11-goals-mobile');

// 简易溢出检查
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log('桌面端横向溢出:', overflow, 'px');

await browser.close();
console.log('完成，截图位于 docs/screenshots/');
