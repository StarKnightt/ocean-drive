// Screenshot tools/people-debug.html (all Mixamo characters on one clip) into shots/people-debug/.
// Usage: node tools/people-debug.mjs <label> "<query>" [t1,t2,...]
//   e.g. node tools/people-debug.mjs walk "clip=walk_casual_m&view=front" 0,0.25,0.5
import { chromium } from 'playwright';
import fs from 'node:fs';
const label = process.argv[2] || 'debug';
const query = process.argv[3] || '';
const ts = (process.argv[4] || '0').split(',').map(Number);
fs.mkdirSync('shots/people-debug', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1616,900'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type(), m.text()); });
await page.goto(`http://localhost:5173/tools/people-debug.html?${query}`);
await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
console.log(JSON.stringify(await page.evaluate(() => window.__info)));
for (const t of ts) {
  await page.evaluate((t) => window.__render(t), t);
  await page.waitForTimeout(200);
  const f = `shots/people-debug/${label}-${t}.png`;
  await page.screenshot({ path: f });
  console.log('saved', f);
}
await browser.close();
