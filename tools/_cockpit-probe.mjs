// scratch: hero cockpit checks -> shots/_cockpit-probe/
// outside views of the windscreen / wheel, close-ups of hands, legs and the cluster from the
// seat, and the camera's roll angle through a firm turn at speed
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = 'shots/_cockpit-probe';
fs.mkdirSync(out, { recursive: true });
const W = 1024, H = 576;
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await page.goto('http://localhost:5173/?autostart');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.mouse.click(W / 2, H / 2);
await page.waitForTimeout(2500);
const shot = async (n, w = 700) => { await page.waitForTimeout(w); await page.screenshot({ path: `${out}/${n}.png` }); console.log(n); };
const only = process.argv[2] || 'out,in,roll';
const tp = (dx, dz, hd, p) => page.evaluate(([dx, dz, hd, p]) => { const v = window.__vehicles.list.find((e) => e.kind === 'car').v; window.__walker.teleport(v.x + dx, v.z + dz, hd, p); }, [dx, dz, hd, p]);
if (only.includes('out')) {
  await tp(-2.4, 0, 90, -18); await shot('o1-prompt');
  await tp(-1.9, -0.9, 60, -22); await shot('o2-screen-near');
  await tp(2.8, -1.2, 250, -14); await shot('o3-screen-road');
  await tp(0.6, -3.2, 175, -16); await shot('o4-screen-front');
}
if (only.includes('in') || only.includes('roll')) {
  await tp(-2.4, 0, 90, -18);
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(2200);
}
if (only.includes('in')) {
  const cam = (yaw, pitch, fov) => page.evaluate(([yaw, pitch, fov]) => { const w = window.__walker; w.pitch = pitch; if (yaw !== null) w.yaw += yaw; w.camera.zoom = fov ? 65 / fov : 1; w.camera.updateProjectionMatrix(); }, [yaw, pitch, fov]);
  await cam(0, -0.05, null); await shot('i1-driver', 300);
  await cam(0, -0.62, null); await shot('i2-down', 300);
  await cam(0, -0.3, 30); await shot('i3-cluster-zoom', 300);
  await cam(0.3, -0.28, 16); await shot('i4-lefthand-zoom', 300);
  await cam(-0.6, -0.28, 16); await shot('i5-righthand-zoom', 300);
  await cam(0.35, -0.95, 55); await shot('i6-footwell', 300);
  await cam(0, 0.25, 30); await shot('i7-mirror-header', 300);
  await cam(0.55, -0.1, 45); await shot('i8-left-pillar', 300);
  await cam(-1.6, -0.45, 70); await shot('i9-passenger', 300);
  await page.evaluate(() => { const w = window.__walker; w.yaw += 0.7; w.pitch = -0.05; w.camera.zoom = 1; w.camera.updateProjectionMatrix(); });
}
if (only.includes('roll')) {
  await page.evaluate(() => { for (const t of window.__traffic.cars) { t.hidden = true; t.v = 0; t.z = t.dir * 470; } const v = window.__vehicles.current; window.__vehicles.place(-19.75, v.z, Math.PI); window.__vehicles.simulate(['KeyW'], 5); });
  await shot('r0-cruise', 200);
  const rollOf = () => page.evaluate(() => {
    const c = window.__walker.camera, v = window.__vehicles.current;
    const e = c.matrixWorld.elements;
    return { camRollDeg: +(Math.asin(e[1]) * 180 / Math.PI).toFixed(2), simRollDeg: +((v.roll - v.rollT) * 180 / Math.PI).toFixed(2), lon: +v.lon.toFixed(2), steer: +v.steer.toFixed(3) };
  });
  console.log('straight', JSON.stringify(await rollOf()));
  for (const [k, t] of [['KeyD', 0.8], ['KeyD', 0.8], ['KeyA', 1.6]]) {
    await page.evaluate(async ([k, t]) => { window.__vehicles.simulate(['KeyW', k], t); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }, [k, t]);
    console.log(k, t, JSON.stringify(await rollOf()));
    await page.screenshot({ path: `${out}/r-${k}-${t}.png` });
  }
}
await browser.close();
