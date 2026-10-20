import { chromium } from '@playwright/test';
const base = 'http://localhost:5199/';
const b = await chromium.launch({ executablePath: '/home/ze/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' });
const p = await b.newPage({ viewport:{width:1440,height:900}, deviceScaleFactor:2 });
await p.goto(base, { waitUntil:'load' });
await p.waitForTimeout(800);
await p.getByRole('button',{name:/进入处置/}).click();
await p.waitForTimeout(900);
// close intro done; capture map area
await p.locator('.map-area').screenshot({ path:'/tmp/map-l1.png' });
// sandbox level 5 via control console
await p.getByRole('button',{ name:/控制台/ }).click();
await p.waitForTimeout(300);
await p.locator('.control-levels button').nth(4).click();
await p.waitForTimeout(600);
await p.getByRole('button',{name:/进入处置/}).click();
await p.waitForTimeout(900);
await p.locator('.map-area').screenshot({ path:'/tmp/map-l5.png' });
// level 4 (default campus) 
await p.getByRole('button', { name:/控制台/ }).click();
await p.waitForTimeout(300);
await p.locator('.control-levels button').nth(3).click();
await p.waitForTimeout(600);
await p.getByRole('button',{name:/进入处置/}).click();
await p.waitForTimeout(900);
await p.locator('.map-area').screenshot({ path:'/tmp/map-l4.png' });
await b.close();
console.log('ok');
