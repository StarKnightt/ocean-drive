// Reachability walk from the app's globals: unique ArrayBuffer bytes by first path found.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--mute-audio', '--window-position=1940,120', '--window-size=1100,700', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
await page.goto('http://localhost:5173/?autostart');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  window.gc?.();
  const seen = new WeakSet(), bufs = new Set();
  const sums = {};
  const roots = Object.keys(window).filter((k) => k.startsWith('__')).map((k) => [k, window[k]]);
  const queue = [];
  for (const [k, v] of roots) queue.push([v, k, 0]);
  let n = 0;
  while (queue.length && n < 3e7) {
    const [v, path, d] = queue.shift();
    n++;
    if (v === null || (typeof v !== 'object' && typeof v !== 'function')) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      if (!bufs.has(v.buffer)) {
        bufs.add(v.buffer);
        const key = path.split('.').slice(0, 4).join('.').replace(/\[\d+\]/g, '[]');
        sums[key] = (sums[key] ?? 0) + v.buffer.byteLength;
      }
      continue;
    }
    if (v instanceof ArrayBuffer) continue;
    if (v instanceof Node || v instanceof Window) continue;
    if (d > 40) continue;
    let keys;
    try { keys = v instanceof Map ? [...v.entries()].map((e, i) => [i, e[1]]) : v instanceof Set ? [...v].map((x, i) => [i, x]) : Object.keys(v).map((k) => [k, v[k]]); } catch { continue; }
    for (const [k, x] of keys) if (x && (typeof x === 'object' || typeof x === 'function')) queue.push([x, Array.isArray(v) ? `${path}[${k}]` : `${path}.${k}`, d + 1]);
  }
  const tot = [...bufs].reduce((a, b) => a + b.byteLength, 0);
  return {
    heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), typedMB: +(tot / 1048576).toFixed(1), visited: n,
    top: Object.entries(sums).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, b]) => `${(b / 1048576).toFixed(1)} ${k}`),
  };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
