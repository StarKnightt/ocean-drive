// Draw calls per top-level scene object from a given view: each object hidden in turn,
// one render into a small target, the drop in calls. Usage:
// URL=http://localhost:5233/ node tools/_calls-by-object.mjs [x z heading pitch] [mount]
import { chromium } from 'playwright';
const [x = -24, z = 30, h = 0, pitch = 0, mount = ''] = process.argv.slice(2);
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1603,902'] });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto((process.env.URL ?? 'http://localhost:5233/') + '?autostart');
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  if (mount) {
    await page.evaluate(() => window.__vehicles.mount('car'));
    await page.waitForTimeout(2500);
  } else {
    await page.evaluate(([x, z, h, p]) => window.__walker.teleport(+x, +z, +h, +p), [x, z, h, pitch]);
    await page.waitForTimeout(1500);
  }
  const rows = await page.evaluate(() => {
    const s = window.__scene, r = window.__renderer, cam = window.__camera;
    const calls = () => { r.info.reset(); r.render(s, cam); return r.info.render.calls; };
    const all = calls();
    const out = [];
    s.children.forEach((o, i) => {
      if (!o.visible) return;
      o.visible = false;
      const d = all - calls();
      o.visible = true;
      if (d > 0) out.push([i, o.name || o.type, d, !!o.userData.levels]);
    });
    out.sort((a, b) => b[2] - a[2]);
    const byKind = {};
    for (const [, n, d, lv] of out) { const k = lv ? 'car' : /^person/.test(n) ? 'person' : /^parked/.test(n) ? 'parked' : n; byKind[k] = (byKind[k] ?? 0) + d; }
    return { all, byKind, top: out.slice(0, 25) };
  });
  console.log(JSON.stringify(rows));
} finally {
  await browser.close();
}
