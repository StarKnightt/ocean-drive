// scratch: why the top-speed run gets stuck
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1040,736'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
await page.goto('http://localhost:5173/?autostart');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate(() => { window.__vehicles.mount('car'); });
await page.waitForTimeout(2000);
await page.evaluate(() => { for (const t of window.__traffic.cars) { t.hidden = true; t.v = 0; t.z = t.dir * 470; } });
await page.waitForTimeout(300);
const out = await page.evaluate(() => {
  const V = window.__vehicles, v = V.current;
  V.place(-19.75, 18, Math.PI);
  const ev = [];
  let t = 0, prev = 0;
  while (t < 30 && v.z < 300) {
    const err = Math.atan2(Math.sin(Math.PI - v.yaw), Math.cos(Math.PI - v.yaw)) + (v.x + 19.75) * 0.05;
    const keys = ['KeyW', 'ShiftLeft'];
    if (err > 0.06) keys.push('KeyA'); else if (err < -0.06) keys.push('KeyD');
    const r = V.simulate(keys, 0.1);
    t += 0.1;
    if (v.lon < prev - 0.5 || r.maxBump > 0.5) ev.push({ t: +t.toFixed(1), x: +v.x.toFixed(2), z: +v.z.toFixed(2), lon: +v.lon.toFixed(2), prev: +prev.toFixed(2), bump: r.maxBump, gear: v.gear, surf: v.surf.kind });
    prev = v.lon;
  }
  return { t, z: v.z, lon: v.lon, ev: ev.slice(0, 30) };
});
console.log(JSON.stringify(out, null, 0));
await browser.close();
