// Ad-hoc camera views for inspecting details (same window setup as shots.mjs).
// Usage: node tools/views.mjs <label> "x,y,z,heading,pitch[,fov]" ["..."]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [label = 'views', ...poses] = process.argv.slice(2);
const url = process.env.SHOT_URL || 'http://localhost:5173/';
const outDir = path.resolve('shots', label);
fs.mkdirSync(outDir, { recursive: true });

const W = 1024, H = 576;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url + (url.includes('?') ? '&' : '?') + 'shot=1');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });

for (const [i, p] of poses.entries()) {
  const [x, y, z, heading, pitch] = p.split(',').map(Number);
  await page.evaluate(([x, y, z, h, pt]) => window.__setCam(x, y, z, h, pt), [x, y, z, heading, pitch]);
  await page.waitForTimeout(1500);
  const file = path.join(outDir, `view${i + 1}.png`);
  await page.screenshot({ path: file });
  console.log('saved', file, JSON.stringify(await page.evaluate(() => window.__renderInfo())));
}
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'));
await browser.close();
