// One screenshot from a pose (optionally after an expression). Usage:
// URL=http://localhost:5233/ node tools/_look.mjs out.png x y z heading pitch ["expr"] [query] [wait ms]
import { chromium } from 'playwright';
const [out = 'shots/_look.png', x = -24, y = 1.8, z = 30, h = 0, p = 0, expr = '', q = '', wait = 1500] = process.argv.slice(2);
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1296,860'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto((process.env.URL ?? 'http://localhost:5233/') + '?autostart' + (q ? '&' + q : ''));
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
  await page.waitForTimeout(1200);
  await page.evaluate(([x, y, z, h, p]) => window.__setCam(+x, +y, +z, +h, +p), [x, y, z, h, p]);
  if (expr) console.log('expr', JSON.stringify(await page.evaluate(expr)));
  await page.waitForTimeout(+wait);
  await page.screenshot({ path: out });
  console.log('saved', out);
} finally {
  await browser.close();
}
