// Forces a WebGL context loss and checks the recovery: message, one reload at a lighter
// tier, and no reload loop on a second loss.
// Usage: node tools/ctxloss-test.mjs   (dev server on :5173). Screenshots in shots/ctxloss/.
import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.env.URL ?? 'http://localhost:5173/';
fs.mkdirSync('shots/ctxloss', { recursive: true });
const browser = await chromium.launch({
  headless: false,
  args: ['--mute-audio', '--window-position=1940,120', '--window-size=1040,736', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const ready = () => page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });

await page.goto(url + '?autostart');
await ready();
await page.evaluate(() => window.__loseContext());
await page.waitForTimeout(400);
const msg1 = await page.textContent('#gpu-reset').catch(() => null);
await page.screenshot({ path: 'shots/ctxloss/1-message.png' });
await page.waitForURL(/gpureset=1/, { timeout: 10000 });
await ready();
const after = await page.evaluate(() => ({ url: location.search, tier: window.__quality.tier }));
await page.evaluate(() => window.__loseContext());
await page.waitForTimeout(3000);
const msg2 = await page.textContent('#gpu-reset').catch(() => null);
const url2 = await page.evaluate(() => location.search);
await page.screenshot({ path: 'shots/ctxloss/2-second-loss.png' });
console.log(JSON.stringify({ msg1, after, msg2, stayedPut: url2 === after.url, errors }, null, 1));
await browser.close();
