// scratch: the hero's hood, trunk, quarters and side from outside (the streak check), optimised vs raw export
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = 'shots/_drive-probe';
fs.mkdirSync(out, { recursive: true });
const W = 1024, H = 576;
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'] });
for (const q of (process.argv[2] || 'opt,raw').split(',')) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(`http://localhost:5173/?shot=1${q === 'raw' ? '&hero=raw' : ''}`);
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
  for (const [n, x, y, z, h, p] of [['hood', -25.1, 1.75, 8, 90, -18], ['hood-front', -24.8, 1.5, 13.5, 27, -12], ['trunk', -19.5, 1.5, 3.0, 225, -12], ['quarter-road', -19.0, 1.3, 4.0, 236, -8], ['side-road', -16.3, 1.2, 8, 270, -4]]) {
    await page.evaluate(([x, y, z, h, p]) => window.__setCam(x, y, z, h, p), [x, y, z, h, p]);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/h-${n}-${q}.png` });
  }
  await page.close();
}
await browser.close();
