// A/B in one session (?shot=1 view 3): the palms' staticCull vs three's own BatchedMesh pass.
import { chromium } from 'playwright';
import fs from 'node:fs';
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1040,736', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
  await page.goto((process.env.URL ?? 'http://localhost:5233/') + '?shot=1');
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
  const [x, y, z, h, p] = (process.env.POSE ?? '5,1.7,-14,102,1').split(',').map(Number);
  await page.evaluate(([x, y, z, h, p]) => window.__setCam(x, y, z, h, p), [x, y, z, h, p]);
  await page.waitForTimeout(2500);
  fs.mkdirSync('shots/_ab/a', { recursive: true }); fs.mkdirSync('shots/_ab/b', { recursive: true });
  await page.screenshot({ path: 'shots/_ab/a/s.png' });
  await page.screenshot({ path: 'shots/_ab/a/s2.png' });
  if (!process.env.CONTROL) console.log(await page.evaluate((mode) => {
    const palms = window.__scene.getObjectByName('palms');
    const out = [];
    palms.traverse((o) => {
      if (!o.isBatchedMesh) return;
      const proto = Object.getPrototypeOf(o);
      o.onBeforeRender = proto.onBeforeRender;
      o.sortObjects = true;
      o._visibilityChanged = true;
      out.push(o._instanceInfo.length);
    });
    window.__renderer.shadowMap.needsUpdate = true;
    return out;
  }));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shots/_ab/b/s.png' });
  fs.copyFileSync('shots/_ab/a/s2.png', 'shots/_ab/b/s2.png');
} finally {
  await browser.close();
}
