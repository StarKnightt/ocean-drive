// ad-hoc: load the game (?autostart), print crowd stats + errors, screenshot views.
// Usage: node tools/_crowd-probe.mjs <label> [query] ["x,y,z,heading,pitch;..."] [waitMs]
import { chromium } from 'playwright';
import fs from 'node:fs';
const label = process.argv[2] || 'probe';
const query = process.argv[3] || '';
const views = (process.argv[4] || '-26,1.7,40,342,4').split(';').map((v) => v.split(',').map(Number));
const wait = +(process.argv[5] || 1500);
fs.mkdirSync('shots/crowd', { recursive: true });
const W = 1024, H = 576;
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5173/?autostart' + (query ? '&' + query : ''));
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 180000 });
let i = 0;
for (const [x, y, z, h, p] of views) {
  await page.evaluate(([x, y, z, h, p]) => window.__walker.teleport ? window.__walker.teleport(x, z, h, p) : window.__setCam(x, y, z, h, p), [x, y, z, h, p]);
  await page.waitForTimeout(wait);
  const f = `shots/crowd/${label}-${i++}.png`;
  await page.screenshot({ path: f });
  console.log('saved', f);
}
console.log(JSON.stringify(await page.evaluate(() => ({ crowd: window.__crowdStats?.(), info: window.__renderInfo() }))));
console.log(errors.filter((e) => !/X4122|GPU stall/.test(e)).slice(0, 12).join('\n'));
await browser.close();
