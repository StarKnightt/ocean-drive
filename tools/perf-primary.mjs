// Normal-mode quality / dynamic-resolution check on the PRIMARY monitor: a muted 1920x1080
// window at (0, 0), plain http://localhost:5173/ (no quality override), click to start,
// then 20 s walking, 20 s on the ATV, 20 s in the convertible, 20 s in a parked SUV taken off
// the curb (chase view, handbrake turns). Logs the detected tier and renderer, the canvas
// size, and once a second: render scale, fps, main-thread work per frame (p50 / p95), GPU ms
// (timer query) and sun-shadow re-renders per second; per-phase medians in the summary.
// URL=... points it at another dev server.
// Usage: node tools/perf-primary.mjs [query]
// PERF_POS=x,y moves the window (e.g. onto a second monitor); PERF_VIEWPORT=WxH fixes the
// CSS viewport instead of sizing the window (so a 1080p canvas fits on any screen).
import { chromium } from 'playwright';
const q = process.argv[2] ?? '';
const vp = process.env.PERF_VIEWPORT?.split('x').map(Number);
const browser = await chromium.launch({
  headless: false,
  args: ['--mute-audio', `--window-position=${process.env.PERF_POS ?? '0,0'}`, '--window-size=1603,902', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage({ viewport: vp ? { width: vp[0], height: vp[1] } : null });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto((process.env.URL ?? 'http://localhost:5173/') + q);
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
const Q = await page.evaluate(() => ({ tier: window.__quality.tier, detected: window.__quality.detected, renderer: window.__quality.gpu.renderer, maxTex: window.__quality.gpu.maxTex, shadowMap: window.__quality.shadowMap, msaa: window.__quality.msaa, bloom: window.__quality.bloom, maxPixels: window.__quality.maxPixels, why: window.__quality.why }));
console.log('quality', JSON.stringify(Q));
await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 30000 });
await page.mouse.click(960, 500);
await page.waitForTimeout(500);
const view = await page.evaluate(() => { const c = document.querySelector('canvas'); return { screen: [screen.width, screen.height], inner: [innerWidth, innerHeight], dpr: devicePixelRatio, native: [Math.round(innerWidth * devicePixelRatio), Math.round(innerHeight * devicePixelRatio)], canvas: [c.width, c.height], budget: window.__gpuBudget() }; });
console.log('view', JSON.stringify(view));

const rows = [];
const sampleFor = async (label, sec, drive) => {
  for (let i = 0; i < sec; i++) {
    const r = await page.evaluate(async ({ drive }) => {
      const gpu = [], cpu = [];
      window.__frameCpu?.(true);
      const sh0 = window.__renderInfo().shadowRenders;
      let last = performance.now();
      const t0 = last;
      while (performance.now() - t0 < 1000) {
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now(); cpu.push(now - last); last = now;
        gpu.push(window.__gpuGuard().lastMs);
        if (drive) window.__vehicles.simulate?.length;   // (keys are held by the harness)
      }
      cpu.sort((a, b) => a - b); gpu.sort((a, b) => a - b);
      const p = (a, f) => +a[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2);
      const work = window.__frameCpu?.() ?? {};
      return { ...window.__dynres(), frames: cpu.length, cpuP50: p(cpu, 0.5), cpuMax: p(cpu, 1), gpuP50: p(gpu, 0.5), gpuP95: p(gpu, 0.95), shadow: window.__gpuGuard().shadowMap, calls: window.__renderInfo().calls,
        workP50: work.p50, workP95: work.p95, workMax: work.max, shadowPerS: window.__renderInfo().shadowRenders - sh0 };
    }, { drive });
    rows.push({ label, t: rows.length + 1, ...r });
    console.log(label.padEnd(5), String(rows.length).padStart(3), `scale ${r.scale} pr ${r.pixelRatio.toFixed(2)} fps ${r.frames} frame p50 ${r.cpuP50} max ${r.cpuMax} | cpu work p50 ${r.workP50} p95 ${r.workP95} | gpu p50 ${r.gpuP50} p95 ${r.gpuP95} ms | shadow ${r.shadow} ${r.shadowPerS}/s calls ${r.calls}`);
  }
};
// walk up the sidewalk
await page.evaluate(() => window.__walker.teleport(-24, 30, 0, 0));
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
await sampleFor('walk', 20);
await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
// ATV on the beach
await page.evaluate(() => { const v = window.__vehicles.list.find((e) => e.kind === 'atv').v; window.__walker.teleport(v.x - 2.2, v.z, 90, -18); });
await page.waitForTimeout(500);
await page.keyboard.press('KeyE');
await page.waitForTimeout(1000);
await page.evaluate(() => window.__vehicles.place(60, -200, Math.PI));
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
await sampleFor('atv', 20, true);
await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
await page.keyboard.press('KeyE');
await page.waitForTimeout(2500);
// the convertible down the drive
await page.evaluate(() => { const v = window.__vehicles.list.find((e) => e.kind === 'car').v; window.__walker.teleport(v.x - 2.4, v.z, 90, -5); });
await page.waitForTimeout(500);
await page.keyboard.press('KeyE');
await page.waitForTimeout(1800);
await page.evaluate(() => { const v = window.__vehicles.current; window.__vehicles.place(-19.75, v.z, Math.PI); });
await page.keyboard.down('KeyW');
await sampleFor('car', 20, true);
await page.keyboard.up('KeyW');
await page.keyboard.down('KeyS'); await page.waitForTimeout(2500); await page.keyboard.up('KeyS');
await page.keyboard.press('KeyE');
await page.waitForTimeout(1500);
// open world: a parked SUV off the curb, chase view, down the drive with handbrake turns
const suv = await page.evaluate(() => {
  const V = window.__vehicles, s = V.parkedNear?.(-22, -60, 'suv')?.[0];
  if (!s) return null;
  const d = V.doorsOf(s)[0];
  window.__walker.teleport(d.x + 0.3, d.z, Math.atan2(s.x - d.x, -(s.z - d.z)) * 180 / Math.PI, -8);
  return { x: s.x, z: s.z };
});
if (suv) {
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(1200);
  await page.keyboard.press('KeyC');
  await page.evaluate(() => { const v = window.__vehicles.current; if (v) window.__vehicles.place(-16.25, v.z, 0); });
  await page.keyboard.down('KeyW');
  const drift = setInterval(async () => {
    try { await page.keyboard.down('Space'); await page.keyboard.down('KeyD'); await page.waitForTimeout(500); await page.keyboard.up('KeyD'); await page.keyboard.up('Space'); } catch {}
  }, 4000);
  await sampleFor('drive', 20, true);
  clearInterval(drift);
  await page.keyboard.up('KeyW');
}
const g = await page.evaluate(() => window.__gpuGuard());
const scales = [...new Set(rows.map((r) => r.scale))];
const all = rows.map((r) => r.gpuP50).sort((a, b) => a - b);
const med = (a) => { const b = a.filter((x) => x != null).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
const phase = (lb) => { const r = rows.filter((q) => q.label === lb); return r.length ? { workP50: med(r.map((q) => q.workP50)), workP95: med(r.map((q) => q.workP95)), gpuP50: med(r.map((q) => q.gpuP50)), shadowPerS: Math.max(...r.map((q) => q.shadowPerS)) } : null; };
console.log('summary', JSON.stringify({ tier: Q.tier, scalesSeen: scales, minScale: Math.min(...rows.map((r) => r.scale)), gpuP50median: all[Math.floor(all.length / 2)], gpuP95max: Math.max(...rows.map((r) => r.gpuP95)), phases: { walk: phase('walk'), atv: phase('atv'), car: phase('car'), drive: phase('drive') }, guardDrops: g.drops, worstGpuMs: g.worstMs, errors }));
await browser.close();
