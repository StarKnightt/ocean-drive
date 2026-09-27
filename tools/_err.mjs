import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio', '--window-position=1940,120'] });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', String(e.stack || e).slice(0, 1500)));
await p.goto('http://localhost:5173/?shot=1');
await p.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
console.log(JSON.stringify(await p.evaluate(() => window.__hotelStats)));
await b.close();
