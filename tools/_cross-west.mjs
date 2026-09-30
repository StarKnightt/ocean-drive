// scratch: looking west down the cross streets from Ocean Drive (towers must not block them)
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = 'shots/_cross-west';
fs.mkdirSync(out, { recursive: true });
const W = 1024, H = 576;
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto('http://localhost:5173/?shot=1');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
for (const [n, z] of [['6st', 300], ['7st', 190], ['8st', 79], ['10st', -79], ['11st', -190]]) {
  for (const [tag, x] of [['od', -12], ['deep', -45]]) {
    await page.evaluate(([x, z]) => window.__setCam(x, 1.7, z, 270, 2), [x, z]);
    await page.waitForTimeout(1200);
    const f = `${out}/${n}-${tag}.png`;
    await page.screenshot({ path: f });
    console.log(f);
  }
}
await browser.close();
