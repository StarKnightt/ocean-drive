// ad-hoc: evaluate an expression in tools/people-debug.html
import { chromium } from 'playwright';
const query = process.argv[2] || '';
const expr = process.argv[3] || '1';
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=816,500'] });
const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto(`http://localhost:5173/tools/people-debug.html?${query}`);
await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
console.log(JSON.stringify(await page.evaluate(expr), null, 1));
if (process.argv[4]) { await page.evaluate(() => window.__render(0.25)); await page.screenshot({ path: process.argv[4] }); }
await browser.close();
