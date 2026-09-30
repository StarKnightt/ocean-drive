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
  window.__hitches = [];
  const tick = (t) => {
    if (last) {
      window.__frameLog.push(t - last);
      if (t - last > 200 && !window.__sceneReady) (window.__longBoot ??= []).push([Math.round(last), Math.round(t - last)]);
      if (t - last > 100 && window.__sceneReady) {
        const i = window.__renderInfo?.(), c = window.__walker?.pos;
        window.__hitches.push([Math.round(t), Math.round(t - last), i?.geometries, i?.textures, i?.programs, c && Math.round(c.x), c && Math.round(c.y)]);
      }
    }
    last = t; requestAnimationFrame(tick);
  };
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
  const top = f.slice().sort((a, b) => b - a).slice(0, 5).map(Math.round);
  return { longBoot: window.__longBoot ?? [], readyAtMs: Math.round(performance.now()), worstStartupFrameMs: Math.round(Math.max(0, ...f)), startupTop5: top, startupOver200: f.filter((x) => x > 200).length,
    heapAtReadyMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null };
});

const heap = [];
const sample = () => page.evaluate(() => (performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null));
if (mode === 'ride') {
  // mount the ATV (retry from a few sides until the ride starts)
  for (const [dx, dz] of [[-2.2, 0], [2.2, 0], [0, 2.2], [0, -2.2]]) {
    const ok = await page.evaluate(async ([dx, dz]) => {
      const V = window.__vehicles;
      const p = V.state().find((v) => /atv/i.test(v.kind)) ?? V.state()[1] ?? V.state()[0];
      window.__walker.teleport(p.x + dx, p.z + dz, 90, -10);
      window.__walker.simulate([], 0.3);
      await new Promise((r) => setTimeout(r, 400));   // the frame loop finds the nearby vehicle
      V.toggle();
      await new Promise((r) => setTimeout(r, 1500));
      return !!V.riding;
    }, [dx, dz]);
    if (ok) break;
  }
}
const riding = mode === 'ride' ? await page.evaluate(() => window.__vehicles.riding ?? null) : undefined;
const sr0 = await page.evaluate(() => { window.__frameLog.length = 0; return window.__renderInfo().shadowRenders; });
const tRun = Date.now();
// up and down the hotel sidewalk (a clear lane), under the facades
const legs = [[-27.5, -64], [-27.5, 64]];
if (mode === 'walk') await page.evaluate(() => window.__walker.teleport(-27.5, 40, 0, 0));
const end = Date.now() + SECS * 1000;
let leg = 0;
while (Date.now() < end) {
  // real-time movement: hold keys in the walker's key set, the frame loop does the rest
  if (mode === 'walk') {
    await page.evaluate(([x, z]) => {
      const w = window.__walker;
      w.yaw = -Math.atan2(x - w.pos.x, -(z - w.pos.y));
      w.keys.add('KeyW'); w.keys.add('ShiftLeft');
      return Math.hypot(x - w.pos.x, z - w.pos.y);
    }, legs[leg % legs.length]).then((d) => { if (d < 2.5) leg++; });
  } else if (mode === 'ride') {
    await page.evaluate(() => {
      const k = window.__walker.keys, left = Math.sin(Date.now() / 3000) > 0;
      k.add('KeyW'); k.delete(left ? 'KeyD' : 'KeyA'); k.add(left ? 'KeyA' : 'KeyD');
    });
  }
  await page.waitForTimeout(200);
  if (heap.length < (Date.now() - (end - SECS * 1000)) / 5000) heap.push(await sample());
}
const sr1 = await page.evaluate(() => window.__renderInfo().shadowRenders);
const pos1 = await page.evaluate(() => [window.__walker.pos.x, window.__walker.pos.y].map((v) => +v.toFixed(1)));
const shadowPerSec = +((sr1 - sr0) / ((Date.now() - tRun) / 1000)).toFixed(1);
const r = await page.evaluate(() => {
  const f = window.__frameLog.slice().sort((a, b) => a - b);
  const q = (p) => +(f[Math.min(f.length - 1, Math.floor(f.length * p))] ?? 0).toFixed(1);
  const cv = document.querySelector('canvas');
  return {
    frames: f.length, medianMs: q(0.5), p95Ms: q(0.95), maxMs: q(1), over100: f.filter((x) => x > 100).length,
    canvas: cv ? `${cv.width}x${cv.height}` : null, mp: cv ? +(cv.width * cv.height / 1e6).toFixed(2) : null,
    dynres: window.__dynres?.(), info: window.__renderInfo?.(), gpu: window.__gpuBudget?.(),
    hitches: window.__hitches.slice(0, 20),
    boot: window.__bootTimes?.map(([l, t]) => `${t} ${l}`), ctxLost: window.__ctxLost, tier: window.__quality?.tier, shadow: window.__quality?.shadowMap,
  };
});
console.log(JSON.stringify({ W, H, DSF, mode, SECS, query, ready, loadMs, ...startup, riding, shadowPerSec, legs: leg, endPos: pos1, ...r, gpuGuard: await page.evaluate(() => window.__gpuGuard?.()), heapMB: heap, errors }, null, 1));
await browser.close();
