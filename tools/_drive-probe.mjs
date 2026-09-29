// scratch: driver-view and outside shots of the hero convertible -> shots/_drive-probe/
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = 'shots/_drive-probe';
fs.mkdirSync(out, { recursive: true });
const W = 1024, H = 576;
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await page.goto('http://localhost:5173/?autostart');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.mouse.click(W / 2, H / 2);
const shot = async (n, w = 600) => { await page.waitForTimeout(w); await page.screenshot({ path: `${out}/${n}.png` }); console.log(n); };
const only = process.argv[2] || 'in,out';
if (only.includes('out')) {
  // outside: the prompt view (13), side profile, hood close-up
  await page.evaluate(() => { const v = window.__vehicles.list.find((e) => e.kind === 'car').v; window.__walker.teleport(v.x - 2.4, v.z, 90, -18); });
  await shot('o1-prompt');
  await page.evaluate(() => { const v = window.__vehicles.list.find((e) => e.kind === 'car').v; window.__walker.teleport(v.x + 6.5, v.z - 1, 270, -4); });
  await shot('o2-side');
  await page.evaluate(() => { const v = window.__vehicles.list.find((e) => e.kind === 'car').v; window.__walker.teleport(v.x - 2.2, v.z + 5.5, 200, -22); });
  await shot('o3-front-q');
}
if (only.includes('in')) {
  await page.evaluate(() => { const v = window.__vehicles.list.find((e) => e.kind === 'car').v; window.__walker.teleport(v.x - 2.4, v.z, 90, -18); });
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(1800);
  await shot('i1-driver', 300);
  await page.evaluate(() => { window.__walker.pitch = -0.62; });
  await shot('i2-down', 300);
  await page.evaluate(() => { window.__walker.pitch = -0.05; window.__walker.yaw -= 1.1; });
  await shot('i3-right', 300);
  await page.evaluate(() => { window.__walker.yaw += 2.0; window.__walker.pitch = -0.2; });
  await shot('i4-left', 300);
  await page.evaluate(() => { window.__walker.yaw -= 0.9; window.__walker.pitch = -0.052; });
  await page.evaluate(() => { for (const t of window.__traffic.cars) { t.hidden = true; t.v = 0; t.z = t.dir * 470; } const v = window.__vehicles.current; window.__vehicles.place(-19.75, v.z, Math.PI); window.__vehicles.simulate(['KeyW'], 5); });
  await shot('i5-cruise', 100);
  await page.evaluate(() => { window.__vehicles.simulate(['KeyW', 'KeyD'], 0.9); });
  await shot('i6-steer', 50);
}
await browser.close();
