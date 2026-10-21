// In-page A/B of the player's body: walking up the park-side sidewalk (first or third person),
// alternating 2 s windows with the avatar on / off, CPU work p50 / p95 per state. Machine
// load that drifts between runs cancels out. URL=... MODE=fp|tp node tools/_tp-ab.mjs
import { chromium } from 'playwright';
const vp = (process.env.PERF_VIEWPORT ?? '1920x1080').split('x').map(Number);
const browser = await chromium.launch({
  headless: false,
  args: ['--mute-audio', `--window-position=${process.env.PERF_POS ?? '1940,120'}`, '--window-size=1603,902', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
});
try {
  const page = await browser.newPage({ viewport: { width: vp[0], height: vp[1] } });
  await page.goto((process.env.URL ?? 'http://localhost:5199/') + (process.env.Q ?? ''));
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
  await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 30000 });
  await page.mouse.click(960, 500);
  await page.waitForTimeout(2000);
  const mode = process.env.MODE ?? 'tp';
  const res = { on: [], off: [] };
  for (let lap = 0; lap < +(process.env.LAPS ?? 3); lap++) {
    await page.evaluate((m) => { window.__footView.set(m); window.__walker.teleport(-12.2, 40, 0, 0); window.__footCam.snap(); }, mode);
    await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
    await page.waitForTimeout(600);
    for (let i = 0; i < 8; i++) {
      const on = i % 2 === (lap % 2);
      const r = await page.evaluate(async (on) => {
        if (window.__avatar) window.__avatar.off = !on;
        await new Promise((r) => setTimeout(r, 200));
        window.__frameCpu(true);
        await new Promise((r) => setTimeout(r, 1400));
        return window.__frameCpu();
      }, on);
      res[on ? 'on' : 'off'].push(r);
    }
    await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
  }
  const med = (a, k) => { const b = a.map((x) => x[k]).sort((x, y) => x - y); return b[b.length >> 1]; };
  console.log(mode, 'avatar on  p50', med(res.on, 'p50'), 'p95', med(res.on, 'p95'), '| off p50', med(res.off, 'p50'), 'p95', med(res.off, 'p95'));
  console.log(JSON.stringify(res));
} finally {
  await browser.close();
}
