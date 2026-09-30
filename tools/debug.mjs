// Quick debug: load a URL, print all console messages, save one screenshot.
// Usage: node tools/debug.mjs "<query>" [out.png]
import { chromium } from 'playwright';

const q = process.argv[2] || 'shot=1';
const out = process.argv[3] || 'shots/debug.png';
const browser = await chromium.launch({
  headless: false,
  args: ['--mute-audio', '--window-position=1940,120', '--window-size=1040,736', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 576 }, deviceScaleFactor: 1 });
page.on('console', (m) => console.log(`[${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
await page.goto('http://localhost:5173/?' + q);
try {
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 60000 });
} catch (e) { console.log('not ready', e.message); }
if (process.argv[4]) await page.evaluate(process.argv[4]);
await page.waitForTimeout(1000);
await page.screenshot({ path: out });
await browser.close();
