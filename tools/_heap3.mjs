// Sampling heap profiler from page start: live bytes at scene-ready by allocation site.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--mute-audio', '--window-position=1940,120', '--window-size=1100,700', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 65536 });
await page.goto('http://localhost:5173/?autostart' + (process.argv[2] ? '&' + process.argv[2] : ''));
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate(() => { window.gc?.(); });
const heapMB = await page.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1));
const { profile } = await cdp.send('HeapProfiler.getSamplingProfile');
const bySite = new Map(), byLeafFn = new Map();
const walk = (node, stack) => {
  const cf = node.callFrame;
  const here = cf.url ? `${cf.functionName || '(anon)'} ${cf.url.replace(/.*\/src\//, 'src/').replace(/\?.*/, '')}:${cf.lineNumber + 1}` : `${cf.functionName || '(native)'}`;
  const s = [...stack, here];
  if (node.selfSize) {
    // attribute to the innermost app frame (src/) plus its app caller
    const app = s.filter((f) => f.includes('src/'));
    const key = app.slice(-2).join(' <- ') || s.slice(-2).join(' <- ');
    bySite.set(key, (bySite.get(key) ?? 0) + node.selfSize);
    const leaf = here;
    byLeafFn.set(leaf, (byLeafFn.get(leaf) ?? 0) + node.selfSize);
  }
  for (const c of node.children) walk(c, s);
};
walk(profile.head, []);
const fmt = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, b]) => `${(b / 1048576).toFixed(1)}MB ${k}`);
console.log(JSON.stringify({ heapMB, sampledMB: +([...bySite.values()].reduce((a, b) => a + b, 0) / 1048576).toFixed(1), bySite: fmt(bySite), byLeaf: fmt(byLeafFn).slice(0, 15) }, null, 1));
await browser.close();
