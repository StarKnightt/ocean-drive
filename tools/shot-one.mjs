// Single ad-hoc camera screenshot (same window setup as shots.mjs).
// Usage: node tools/shot-one.mjs <out.png> <x> <eyeAboveGround> <z> <heading> <pitch>
import { chromium } from 'playwright';

const [out, x, eye, z, heading, pitch] = process.argv.slice(2);
const url = process.env.SHOT_URL || 'http://localhost:5173/';
const W = 1024, H = 576;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(url + (url.includes('?') ? '&' : '?') + 'shot=1');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.evaluate(([x, eye, z, h, p]) => {
  window.__setCam(x, window.__groundHeight(x, z) + eye, z, h, p);
}, [x, eye, z, heading, pitch].map(Number));
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
