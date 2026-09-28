// Screenshot tools/car-debug.html (every parked model x LOD in isolation) from several views
// into shots/car-debug/, and dump each model's materials / bounds / wheel nodes.
// Usage: node tools/car-debug.mjs [views=front,q34,side,top] [file=/models/parked.glb]
import { chromium } from 'playwright';
import fs from 'node:fs';
const views = (process.argv[2] || 'front,q34,side,top').split(',');
const file = process.argv[3] || '/models/parked.glb';
fs.mkdirSync('shots/car-debug', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1616,900'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
for (const v of views) {
  await page.goto(`http://localhost:5173/tools/car-debug.html?view=${v}&file=${file}`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `shots/car-debug/${v}.png` });
  if (v === views[0]) console.log(JSON.stringify(await page.evaluate(() => window.__info), null, 0).replace(/\},"/g, '},\n"'));
}
await browser.close();
