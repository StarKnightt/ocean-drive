// Evaluate an expression in the page after __sceneReady. Usage: node tools/_eval.mjs "<expr>" [query] [W H DSF]
import { chromium } from 'playwright';
const [expr, query = '', W = 1024, H = 576, DSF = 1] = process.argv.slice(2);
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1100,700', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: +DSF });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto('http://localhost:5173/?autostart' + (query ? '&' + query : ''));
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.waitForTimeout(1000);
console.log(JSON.stringify(await page.evaluate(expr), null, 1));
await browser.close();
