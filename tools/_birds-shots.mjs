// Bird close-ups (same window setup as shot-one.mjs). Usage: node tools/_birds-shots.mjs <label> [list-only]
import { chromium } from 'playwright';
import fs from 'node:fs';

const label = process.argv[2] || 'birds';
const url = process.env.SHOT_URL || 'http://localhost:5173/';
const W = 1024, H = 576;
fs.mkdirSync(`shots/${label}`, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome', headless: false,
  args: ['--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 600)); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url + (url.includes('?') ? '&' : '?') + 'shot=1');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
const list = await page.evaluate(() => window.__birds?.list());
console.log(JSON.stringify(list));
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
const views = JSON.parse(process.env.VIEWS || '[]');
for (const [name, x, eye, z, h, p] of views) {
  await page.evaluate(([x, eye, z, h, p]) => window.__setCam(x, window.__groundHeight(x, z) + eye, z, h, p), [x, eye, z, h, p]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `shots/${label}/${name}.png` });
  console.log('saved', `shots/${label}/${name}.png`, JSON.stringify(await page.evaluate(() => window.__renderInfo())));
}
await browser.close();
