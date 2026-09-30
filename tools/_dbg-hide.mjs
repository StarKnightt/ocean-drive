import { chromium } from 'playwright';
const keys = process.argv.slice(2);
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1040,736', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
await page.goto('http://localhost:5173/?shot=1');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 60000 });
for (const k of keys) {
  const r = await page.evaluate((k) => {
    const h = window.__scene.getObjectByName('hotels');
    const out = [];
    h.children.forEach((c) => {
      const key = c.material && c.material.customProgramCacheKey ? c.material.customProgramCacheKey() : '';
      c.visible = k === 'none' ? true : k.startsWith('=') ? key.startsWith(k.slice(1)) : !(key === k || (k.startsWith('#') && out.length === Number(k.slice(1))));
      out.push(key.slice(0, 30));
    });
    return out;
  }, k);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `shots/dbg-${k.replace('#', 'n')}.png` });
  console.log(k, k === 'none' ? r.join(',') : '');
}
await browser.close();
