// Large / high-DPI display stress test: loads the app at a big viewport and device scale
// factor, then idles, walks or rides for a while and reports frame times, render size,
// JS heap, GPU memory estimate and any WebGL context loss.
// Usage: node tools/bigscreen-test.mjs <W> <H> <DSF> [seconds=20] [mode=idle|walk|ride] [query]
//   e.g. node tools/bigscreen-test.mjs 1920 1080 2 60 walk
import { chromium } from 'playwright';

const [W = 1920, H = 1080, DSF = 2, SECS = 20] = process.argv.slice(2, 6).map(Number);
const mode = process.argv[6] || 'idle';
const query = process.argv[7] || '';
const url = (process.env.URL ?? 'http://localhost:5173/') + '?autostart' + (query ? '&' + query : '');

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--mute-audio', '--window-position=1940,120', '--window-size=1296,760',
    '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('crash', () => errors.push('PAGE CRASHED'));
await page.addInitScript(() => {
  window.__ctxLost = 0;
  window.__frameLog = [];
  addEventListener('webglcontextlost', () => { window.__ctxLost++; }, true);
  let last = 0;
  const tick = (t) => { if (last) window.__frameLog.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

const t0 = Date.now();
await page.goto(url);
let ready = true;
try {
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
} catch { ready = false; }
const loadMs = Date.now() - t0;
const startup = await page.evaluate(() => {
  const f = window.__frameLog.splice(0);
  return { worstStartupFrameMs: Math.round(Math.max(0, ...f)), heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null };
});

const heap = [];
const sample = () => page.evaluate(() => (performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null));
if (mode === 'ride') {
  await page.evaluate(() => {
    const V = window.__vehicles;
    const atv = V.state().find((v) => /atv/i.test(v.kind ?? v.name ?? v.id ?? ''));
    const p = atv ?? V.state()[1] ?? V.state()[0];
    window.__walker.teleport(p.x - 2.2, p.z, 90, -10);
    window.__walker.simulate([], 0.3);
  });
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(500);
}
await page.evaluate(() => { window.__frameLog.length = 0; });
const legs = [[-26, -60], [-26, 60], [20, 60], [80, 0], [20, -60], [-26, -60]];
const end = Date.now() + SECS * 1000;
let leg = 0;
while (Date.now() < end) {
  if (mode === 'walk') {
    await page.evaluate(([x, z]) => {
      const w = window.__walker;
      w.yaw = -Math.atan2(x - w.pos.x, -(z - w.pos.y));
      w.simulate(['KeyW', 'ShiftLeft'], 0.2);
      return Math.hypot(x - w.pos.x, z - w.pos.y);
    }, legs[leg % legs.length]).then((d) => { if (d < 1.5) leg++; });
  } else if (mode === 'ride') {
    await page.evaluate(() => window.__vehicles.simulate(['KeyW', Math.sin(Date.now() / 3000) > 0 ? 'KeyA' : 'KeyD'], 0.2));
  }
  await page.waitForTimeout(200);
  if (heap.length < (Date.now() - (end - SECS * 1000)) / 5000) heap.push(await sample());
}
const r = await page.evaluate(() => {
  const f = window.__frameLog.slice().sort((a, b) => a - b);
  const q = (p) => +(f[Math.min(f.length - 1, Math.floor(f.length * p))] ?? 0).toFixed(1);
  const cv = document.querySelector('canvas');
  return {
    frames: f.length, medianMs: q(0.5), p95Ms: q(0.95), maxMs: q(1), over100: f.filter((x) => x > 100).length,
    canvas: cv ? `${cv.width}x${cv.height}` : null, mp: cv ? +(cv.width * cv.height / 1e6).toFixed(2) : null,
    dynres: window.__dynres?.(), info: window.__renderInfo?.(), gpu: window.__gpuBudget?.(),
    boot: window.__bootTimes?.map(([l, t]) => `${t} ${l}`), ctxLost: window.__ctxLost, tier: window.__quality?.tier, shadow: window.__quality?.shadowMap,
  };
});
console.log(JSON.stringify({ W, H, DSF, mode, SECS, query, ready, loadMs, ...startup, ...r, heapMB: heap, errors }, null, 1));
await browser.close();
