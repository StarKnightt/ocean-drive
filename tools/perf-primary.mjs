// Normal-mode quality / dynamic-resolution check on the PRIMARY monitor: a muted 1920x1080
// window at (0, 0), plain http://localhost:5173/ (no quality override), click to start,
// then 20 s walking, 20 s on the ATV, 20 s in the convertible. Logs the detected tier and
// renderer, the canvas size, and once a second: render scale, fps, GPU ms (timer query).
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
await page.goto('http://localhost:5173/' + q);
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
      return { ...window.__dynres(), frames: cpu.length, cpuP50: p(cpu, 0.5), cpuMax: p(cpu, 1), gpuP50: p(gpu, 0.5), gpuP95: p(gpu, 0.95), shadow: window.__gpuGuard().shadowMap, calls: window.__renderInfo().calls };
    }, { drive });
    rows.push({ label, t: rows.length + 1, ...r });
    console.log(label.padEnd(5), String(rows.length).padStart(3), `scale ${r.scale} pr ${r.pixelRatio.toFixed(2)} fps ${r.frames} cpu p50 ${r.cpuP50} max ${r.cpuMax} | gpu p50 ${r.gpuP50} p95 ${r.gpuP95} ms | shadow ${r.shadow} calls ${r.calls}`);
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
const g = await page.evaluate(() => window.__gpuGuard());
const scales = [...new Set(rows.map((r) => r.scale))];
const all = rows.map((r) => r.gpuP50).sort((a, b) => a - b);
console.log('summary', JSON.stringify({ tier: Q.tier, scalesSeen: scales, minScale: Math.min(...rows.map((r) => r.scale)), gpuP50median: all[Math.floor(all.length / 2)], gpuP95max: Math.max(...rows.map((r) => r.gpuP95)), guardDrops: g.drops, worstGpuMs: g.worstMs, errors }));
await browser.close();
