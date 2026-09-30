// scratch by-eye probe (headed, muted, second monitor): parked + traffic car close-ups from
// the sidewalk with the traffic frozen and posed. Usage: node tools/_traffic-probe.mjs [only]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('shots/_traffic-probe');
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[2] || '';
const W = 1024, H = 576;
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`,
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5173/?autostart');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const aim = (x, z, tx, tz, pitch = -4, y = null) => page.evaluate(([x, z, tx, tz, p, y]) => {
  const h = Math.atan2(tx - x, -(tz - z)) * 180 / Math.PI;
  window.__setCam(x, y ?? window.__groundHeight(x, z) + 1.62, z, h, p);
}, [x, z, tx, tz, pitch, y]);
const shot = async (name) => { if (only && !name.includes(only)) return; await page.waitForTimeout(700); const p = path.join(OUT, name + '.png'); await page.screenshot({ path: p }); console.log('shot', p); };
// freeze the traffic and pose car i: { z, dir, v, braking, model? }
const pose = (list) => page.evaluate((list) => {
  const T = window.__traffic;
  T.debug.freeze = true;
  const cars = T.cars;
  cars.forEach((c) => { c.z = 1000 * (c.dir > 0 ? 1 : -1) * 0 + 440 * c.dir; });
  list.forEach((p, i) => {
    const c = cars.find((q) => (p.model ? q.model === p.model : true) && !q.posed && (p.classic === undefined || q.classic === p.classic)) ?? cars[i];
    c.posed = true;
    Object.assign(c, { z: p.z, v: p.v ?? 0, a: p.a ?? 0, braking: !!p.braking, hidden: false });
  });
  cars.forEach((c) => { delete c.posed; });
  return list.map(() => 0);
}, list);

// parked cars from the hotel sidewalk
await pose([]);
await aim(-25.6, -16, -22.7, -24, -8); await shot('p1-parked-suv-front34');
await aim(-25.8, -29, -22.7, -24, -8); await shot('p2-parked-rear34');
await aim(-25.5, -3.5, -22.7, -1.5, -10); await shot('p3-parked-sedan-side');
await aim(-25.6, 50, -22.7, 58, -8); await shot('p4-parked-pickup');
// traffic: a braking modern car close to the camera (southbound lane x -19.75), seen from behind
for (const model of ['sedan', 'suv', 'hatch', 'crossover', 'wagon', 'pickup', 'coupe']) {
  if (only && !('t-' + model).includes(only) && !only.startsWith('t-all')) continue;
  await page.evaluate((m) => { const T = window.__traffic; T.debug.freeze = true; }, model);
  const ok = await page.evaluate((model) => {
    const T = window.__traffic;
    // rebind one slot to this model (as a respawn would)
    const c = T.cars.find((q) => !q.classic);
    Object.assign(c, { model, len: 4.9, color: 0x2f5d8c, respawns: c.respawns + 1, z: 30, v: 0, a: -1.5, braking: true, hidden: false, dir: 1, x: -19.75 });
    T.cars.forEach((q) => { if (q !== c) q.z = 440 * q.dir; });
    return true;
  }, model);
  await page.waitForTimeout(300);
  await aim(-24.6, 21, -19.75, 30, -6); await shot(`t-${model}-rear34-brake`);
  await aim(-24.6, 38, -19.75, 30, -6); await shot(`t-${model}-front34`);
}
// the classic in traffic
await page.evaluate(() => {
  const T = window.__traffic;
  const c = T.cars.find((q) => q.classic) ?? T.cars[0];
  T.cars.forEach((q) => { if (q !== c) q.z = 440 * q.dir; });
  Object.assign(c, { z: 30, v: 0, a: 0, braking: false, hidden: false, dir: 1, x: -19.75 });
});
await page.waitForTimeout(300);
await aim(-24.6, 36, -19.75, 30, -6); await shot('t-classic-front34');
await aim(-24.8, 30, -19.75, 30, -4); await shot('t-classic-side');
// the 11 ST signal head close (east mast)
await aim(-12.6, -163, -16.25, -179, 11); await shot('s1-signal-head');
console.log('errors', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
