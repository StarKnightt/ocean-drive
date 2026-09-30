// CDP CPU profile of a phase (walk | car | drive): self time per function, top 40.
// Usage: URL=http://localhost:5233/ node tools/_cpuprof.mjs walk [query]
import { chromium } from 'playwright';
const phase = process.argv[2] ?? 'walk';
const q = process.argv[3] ?? '';
const browser = await chromium.launch({
  headless: false,
  args: ['--mute-audio', '--window-position=1940,120', '--window-size=1603,902', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto((process.env.URL ?? 'http://localhost:5233/') + q);
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
  await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 30000 });
  await page.mouse.click(960, 500);
  await page.waitForTimeout(800);
  if (phase === 'walk') {
    await page.evaluate(() => window.__walker.teleport(-24, 30, 0, 0));
    await page.keyboard.down('KeyW');
  } else if (phase === 'car') {
    await page.evaluate(() => { const v = window.__vehicles.list.find((e) => e.kind === 'car').v; window.__walker.teleport(v.x - 2.4, v.z, 90, -5); });
    await page.waitForTimeout(500);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(300);
    await page.evaluate(() => { if (!window.__vehicles.riding) window.__vehicles.mount('car'); });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const v = window.__vehicles.current; window.__vehicles.place(-19.75, v.z, Math.PI); });
    await page.keyboard.down('KeyW');
  } else {
    await page.evaluate(() => {
      const V = window.__vehicles, s = V.parkedNear?.(-22, -60, 'suv')?.[0];
      const d = V.doorsOf(s)[0];
      window.__walker.teleport(d.x + 0.3, d.z, Math.atan2(s.x - d.x, -(s.z - d.z)) * 180 / Math.PI, -8);
    });
    await page.waitForTimeout(600);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(1300);
    await page.keyboard.press('KeyC');
    await page.evaluate(() => { const v = window.__vehicles.current; if (v) window.__vehicles.place(-16.25, v.z, 0); });
    await page.keyboard.down('KeyW');
  }
  console.log('riding', await page.evaluate(() => window.__vehicles.riding));
  await page.waitForTimeout(1500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await page.waitForTimeout(8000);
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas, counts = new Map();
  profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) ?? 0) + (dt[i] ?? 0)));
  let total = 0;
  for (const [id, us] of counts) {
    const n = byId.get(id), f = n.callFrame;
    const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop().split('?')[0]}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + us);
    if (f.functionName !== '(idle)' && f.functionName !== '(program)') total += us;
  }
  // inclusive time per function (counted once per stack)
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const incl = new Map();
  for (const [id, us] of counts) {
    const seen = new Set();
    for (let q = id; q != null; q = parent.get(q)) {
      const f = byId.get(q).callFrame;
      const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop().split('?')[0]}:${f.lineNumber + 1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      incl.set(key, (incl.get(key) ?? 0) + us);
    }
  }
  console.log('--- inclusive');
  for (const [k, us] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, 60)) console.log((us / 1000).toFixed(1).padStart(8), k);
  console.log('--- self');
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 30);
  console.log('busy ms', (total / 1000).toFixed(0), 'over 8 s');
  for (const [k, us] of top) console.log((us / 1000).toFixed(1).padStart(8), k);
} finally {
  await browser.close();
}
