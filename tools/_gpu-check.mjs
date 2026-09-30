import { chromium } from 'playwright';
const b = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=900,600', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
await p.goto('http://localhost:5173/?autostart');
await p.waitForFunction(() => window.__sceneReady === true, null, { timeout: 180000 });
console.log(await p.evaluate(() => JSON.stringify({ tier: window.__quality.tier, r: window.__quality.gpu.renderer, v: navigator.userAgent })));
await b.close();
