// Walking profile: ?prof per-section averages and CPU work p50 / p95 over a sidewalk walk,
// first person and (TP=1) third person. PERF_POS / PERF_VIEWPORT as perf-primary.
// Usage: URL=http://localhost:5199/ node tools/_tp-prof.mjs [query]
import { chromium } from 'playwright';
const q = process.argv[2] ?? '?prof';
const vp = (process.env.PERF_VIEWPORT ?? '1920x1080').split('x').map(Number);
const browser = await chromium.launch({
  headless: false,
  args: ['--mute-audio', `--window-position=${process.env.PERF_POS ?? '1940,120'}`, '--window-size=1603,902', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
});
try {
  const page = await browser.newPage({ viewport: { width: vp[0], height: vp[1] } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto((process.env.URL ?? 'http://localhost:5199/') + q);
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
  await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 30000 });
  await page.mouse.click(960, 500);
  await page.waitForTimeout(500);
  for (const mode of (process.env.MODES ?? 'fp,tp').split(',')) {
    await page.evaluate((m) => window.__footView?.set(m), mode);
    await page.evaluate(() => window.__walker.teleport(-12.2, 40, 0, 0));
    await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
    await page.waitForTimeout(1500);
    const secs = [];
    for (let i = 0; i < +(process.env.SECS ?? 12); i++) {
      secs.push(await page.evaluate(async () => {
        window.__frameCpu(true);
        const g = [];
        const t0 = performance.now();
        while (performance.now() - t0 < 1000) { await new Promise((r) => requestAnimationFrame(r)); g.push(window.__gpuGuard().lastMs); }
        g.sort((a, b) => a - b);
        return { ...window.__frameCpu(), gpu: +g[g.length >> 1].toFixed(2) };
      }));
    }
    await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
    const prof = await page.evaluate(() => window.__prof());
    const med = (k) => { const a = secs.map((s) => s[k]).sort((x, y) => x - y); return a[a.length >> 1]; };
    console.log(mode, 'work p50', med('p50'), 'p95', med('p95'), 'gpu', med('gpu'), '| per s p95', secs.map((s) => s.p95).join(' '));
    console.log(mode, 'prof', JSON.stringify(prof));
  }
  console.log('errors', errors.length ? errors.slice(0, 5) : 'none');
} finally {
  await browser.close();
}
