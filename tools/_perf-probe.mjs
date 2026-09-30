// ad-hoc: time people/traffic updates + CPU profile (self time by function) while walking
// and driving the convertible, like perf-primary. Usage: node tools/_perf-probe.mjs [query]
import { chromium } from 'playwright';
const q = process.argv[2] ?? '';
const browser = await chromium.launch({
  channel: 'chrome', headless: false,
  args: ['--mute-audio', '--window-position=1940,120', '--window-size=1603,902', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage({ viewport: null });
await page.goto('http://localhost:5173/' + q);
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 30000 });
await page.mouse.click(700, 400);
await page.waitForTimeout(500);
await page.evaluate(() => {
  const T = (window.__T = { people: 0, traffic: 0, n: 0 });
  for (const [k, o] of [['people', window.__people], ['traffic', window.__traffic]]) {
    const f = o.update.bind(o);
    o.update = (...a) => { const t = performance.now(); const r = f(...a); T[k] += performance.now() - t; return r; };
  }
  const loop = () => { T.n++; requestAnimationFrame(loop); }; loop();
});
const cdp = await page.context().newCDPSession(page);
const measure = async (label, ms, profile) => {
  await page.evaluate(() => { const T = window.__T; T.people = T.traffic = T.n = 0; });
  if (profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  await page.waitForTimeout(ms);
  const T = await page.evaluate(() => ({ ...window.__T, info: window.__renderInfo(), crowd: window.__crowdStats?.() }));
  console.log(label, 'frames', T.n, 'fps', (T.n / (ms / 1000)).toFixed(0), 'people ms/f', (T.people / T.n).toFixed(2), 'traffic ms/f', (T.traffic / T.n).toFixed(2), 'calls', T.info.calls, JSON.stringify(T.crowd));
  if (profile) {
    const { profile: p } = await cdp.send('Profiler.stop');
    const self = new Map(); const dt = p.timeDeltas; const byId = new Map(p.nodes.map((n) => [n.id, n]));
    p.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0)); });
    const tot = [...self.values()].reduce((a, b) => a + b, 0);
    console.log([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `  ${(100 * v / tot).toFixed(1)}%  ${k}`).join('\n'));
  }
};
if (process.env.SINGLE) console.log('forced single pass', await page.evaluate(() => {
  const s = new Set();
  window.__scene.traverse((o) => { for (const m of [o.material].flat()) if (m?.transparent && m.side === 2 && !m.forceSinglePass) s.add(m); });
  for (const m of s) m.forceSinglePass = true;
  return [...s].map((m) => m.name || m.type).join(',');
}));
await page.evaluate(() => window.__walker.teleport(-24, 30, 0, 0));
await page.keyboard.down('KeyW');
await measure('walk', 5000, false);
await page.keyboard.up('KeyW');
await page.evaluate(() => { const v = window.__vehicles.list.find((e) => e.kind === 'car').v; window.__walker.teleport(v.x - 2.4, v.z, 90, -5); });
await page.waitForTimeout(500);
await page.keyboard.press('KeyE');
await page.waitForTimeout(1800);
await page.evaluate(() => { const v = window.__vehicles.current; window.__vehicles.place(-19.75, v.z, Math.PI); });
await page.keyboard.down('KeyW');
await measure('car', 6000, true);
await page.keyboard.up('KeyW');
await browser.close();
