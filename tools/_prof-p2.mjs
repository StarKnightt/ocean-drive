// Profile probe: the hero's first-person drive and a parked-row SUV drive with ?prof on.
// Prints per-second CPU work p50 / p95 and the ?prof section averages per phase.
// Usage: URL=http://localhost:5233/ node tools/_prof-p2.mjs [query] [phases=car,drive]
import { chromium } from 'playwright';
const q = process.argv[2] ?? '?prof';
const phases = (process.argv[3] ?? 'car,drive').split(',');
const browser = await chromium.launch({
  headless: false,
  args: ['--mute-audio', `--window-position=${process.env.PERF_POS ?? '1940,120'}`, '--window-size=1603,902', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto((process.env.URL ?? 'http://localhost:5233/') + q);
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
  await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 30000 });
  await page.mouse.click(960, 500);
  await page.waitForTimeout(500);
  if (process.env.EXPR) console.log('expr', await page.evaluate(process.env.EXPR));
  const sample = async (label, sec) => {
    const rows = [];
    for (let i = 0; i < sec; i++) {
      rows.push(await page.evaluate(async () => {
        window.__frameCpu(true);
        const t0 = performance.now();
        while (performance.now() - t0 < 1000) await new Promise((r) => requestAnimationFrame(r));
        return { ...window.__frameCpu(), calls: window.__renderInfo().calls, gpu: window.__gpuGuard().lastMs };
      }));
      const r = rows.at(-1);
      console.log(label, i + 1, `p50 ${r.p50} p95 ${r.p95} max ${r.max} calls ${r.calls} gpu ${r.gpu}`);
    }
    const split = await page.evaluate(() => {
      const L = (window.__frameLog ?? []).splice(0);
      const st = (a) => { const s = a.map((r) => r[0]).sort((x, y) => x - y), rs = a.map((r) => r[4]).sort((x, y) => x - y); const p = (b, f) => b.length ? b[Math.min(b.length - 1, Math.floor(b.length * f))] : 0; return { n: a.length, p50: p(s, 0.5), p95: p(s, 0.95), render50: p(rs, 0.5), render95: p(rs, 0.95) }; };
      return { shadow: st(L.filter((r) => r[1])), plain: st(L.filter((r) => !r[1])) };
    });
    console.log(label, 'split', JSON.stringify(split));
    console.log(label, 'mirror', JSON.stringify(await page.evaluate(() => window.__mirrorStats ?? null)));
    for (const f of await page.evaluate(() => (window.__slowFrames ?? []).splice(0))) console.log(label, 'slow', JSON.stringify(f));
    const prof = await page.evaluate(() => window.__prof?.());
    const med = (k) => rows.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
    console.log(label, 'median p50', med('p50'), 'p95', med('p95'), 'prof', JSON.stringify(prof));
  };
  if (phases.includes('walk')) {
    await page.evaluate(() => window.__walker.teleport(-24, 30, 0, 0));
    await page.keyboard.down('KeyW');
    await sample('walk', 10);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(300);
  }
  if (phases.includes('car')) {
    await page.evaluate(() => { const v = window.__vehicles.list.find((e) => e.kind === 'car').v; window.__walker.teleport(v.x - 2.4, v.z, 90, -5); });
    await page.waitForTimeout(500);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(300);
    await page.evaluate(() => { if (!window.__vehicles.riding) window.__vehicles.mount('car'); });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const v = window.__vehicles.current; window.__vehicles.place(-19.75, v.z, Math.PI); });
    await page.keyboard.down('KeyW');
    await sample('car', 12);
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyS'); await page.waitForTimeout(2500); await page.keyboard.up('KeyS');
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(1500);
  }
  if (phases.includes('drive')) {
    const ok = await page.evaluate(() => {
      const V = window.__vehicles, s = V.parkedNear?.(-22, -60, 'suv')?.[0];
      if (!s) return false;
      const d = V.doorsOf(s)[0];
      window.__walker.teleport(d.x + 0.3, d.z, Math.atan2(s.x - d.x, -(s.z - d.z)) * 180 / Math.PI, -8);
      return true;
    });
    if (ok) {
      await page.waitForTimeout(500);
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(1200);
      await page.keyboard.press('KeyC');
      await page.evaluate(() => { const v = window.__vehicles.current; if (v) window.__vehicles.place(-16.25, v.z, 0); });
      await page.keyboard.down('KeyW');
      await sample('drive', 12);
      await page.keyboard.up('KeyW');
    }
  }
  if (errors.length) console.log('errors', errors.slice(0, 5));
} finally {
  await browser.close();
}
