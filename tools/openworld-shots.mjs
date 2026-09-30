// Open-world phase 1 screenshots (shots/openworld-p1/): entering a parked SUV at its door,
// its first-person cockpit, the chase camera and the speedometer HUD, the SUV on the park
// lawn, down the ramp onto the sand, in the shallow surf, and handbrake skid marks.
// Usage: node tools/openworld-shots.mjs   (URL=http://127.0.0.1:port/ for another dev server)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.URL ?? 'http://localhost:5173/';
const outDir = path.resolve('shots', process.env.OUT ?? 'openworld-p1');
fs.mkdirSync(outDir, { recursive: true });
const W = 1280, H = 720;
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url + '?autostart&dynres=0');
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 180000 });
  await page.mouse.click(W / 2, H / 2);
  const shot = async (name, wait = 600, clip = null) => {
    await page.waitForTimeout(wait);
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file, ...(clip ? { clip } : {}) });
    console.log('shot', file);
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  // traffic parked out of the way at the loop ends
  const clearTraffic = () => ev(() => { for (const t of window.__traffic.cars) { t.hidden = true; t.v = 0; t.z = t.dir * 470; } });

  // 1. a parked SUV: stand at its driver door, "E enter", get in
  const suv = await ev(() => {
    const V = window.__vehicles, s = V.parkedNear(-22, 20, 'suv')[0];
    const d = V.doorsOf(s)[0];
    // (standing out from the driver's door, a little toward the front, looking at the door)
    const c = Math.cos(s.pose.yaw), sn = Math.sin(s.pose.yaw), fx = -sn, fz = -c;
    const ox = d.x - s.pose.x, oz = d.z - s.pose.z, ol = Math.hypot(ox, oz);
    const x = d.x + (ox / ol) * 0.75 + fx * 0.9, z = d.z + (oz / ol) * 0.75 + fz * 0.9;
    window.__walker.teleport(x, z, Math.atan2(d.x - fx * 0.6 - x, -(d.z - fz * 0.6 - z)) * 180 / Math.PI, -14);
    return { x: s.x, z: s.z, color: s.color };
  });
  await page.waitForTimeout(800);
  console.log('near', await ev(() => [window.__vehicles.near, window.__vehicles.nearDoor]));
  await shot('6a-parked-suv-enter-prompt', 700);
  await page.keyboard.press('KeyE');
  await shot('6b-entering-the-suv', 260);
  await page.waitForTimeout(1200);
  // 2. the modern cockpit (first person), a little turn of the wheel
  await ev(() => { window.__walker.pitch = -0.12; });
  await shot('7-modern-cockpit', 600);
  await clearTraffic();
  // 3. out onto the drive, chase view, the HUD
  await ev(() => { const V = window.__vehicles, v = V.current; V.place(-16.25, v.z - 10, 0); });
  await page.keyboard.press('KeyC');
  await ev(() => window.__vehicles.simulate(['KeyW', 'ShiftLeft'], 5));
  await page.keyboard.down('KeyW');
  await shot('4-chase-camera', 500);
  await page.keyboard.up('KeyW');
  await shot('8-hud', 50, { x: W - 250, y: H - 190, width: 250, height: 190 });
  await shot('8-hud-in-frame', 50);
  // 4. handbrake drift on the road (chase camera pulled up and round to see the marks)
  await ev(() => { const V = window.__vehicles; V.place(-19, -230, 0); V.simulate(['KeyW', 'ShiftLeft'], 4.5); V.simulate(['KeyW', 'KeyD', 'Space'], 0.8); V.simulate(['KeyA', 'Space'], 0.6); V.simulate(['KeyS'], 1.2); V.simulate([], 0.5); });
  // (the chase arm swung round high over the marks, looking down them to the car)
  await ev(() => {
    const w = window.__walker, V = window.__vehicles, v = V.current, c = V.skids.recent(60);
    const toMarks = Math.atan2(-(c.x - v.x), -(c.z - v.z));   // the yaw that faces from the car to the marks
    w.yaw = toMarks + Math.PI - 0.35; w.pitch = -0.5; V.simulate([], 0.6);
  });
  await shot('5-drift-skid-marks', 900);
  // 5. over the curb and onto the park lawn (side-on)
  await ev(() => {
    const V = window.__vehicles, v = V.current;
    V.place(-16.25, 40, -Math.PI / 2);
    for (let i = 0; i < 80 && v.x < -6.5; i++) V.simulate(['KeyW'], 0.1);
    V.simulate(['KeyS'], 0.8); V.simulate([], 0.3);
  });
  await ev(() => { const w = window.__walker, v = window.__vehicles.current; w.yaw = v.yaw + 0.9; w.pitch = 0.1; });
  console.log('grass', await ev(() => window.__vehicles.current.surf.detail));
  await shot('1-car-on-the-grass', 900);
  // 6. down the z -95 ramp onto the sand
  await ev(() => { const V = window.__vehicles; V.place(4, -95, -Math.PI / 2); V.simulate(['KeyW'], 5); V.simulate([], 0.6); });
  await ev(() => { const w = window.__walker, v = window.__vehicles.current; w.yaw = v.yaw - 0.8; w.pitch = 0.05; });
  await shot('2-car-on-the-sand', 900);
  // 7. into the shallow surf (spray)
  await ev(() => { const V = window.__vehicles; V.place(84, -110, -Math.PI / 2 - 0.25); V.simulate(['KeyW'], 2.5); });
  await page.keyboard.down('KeyW');
  await ev(() => { const w = window.__walker, v = window.__vehicles.current; w.yaw = v.yaw + 1.1; w.pitch = 0.05; });
  await shot('3-car-in-the-shallow-surf', 700);
  await page.keyboard.up('KeyW');
  const st = await ev(() => { const v = window.__vehicles.current; return { x: +v.x.toFixed(1), depth: +Math.max(...v.wheelDepth).toFixed(3), surf: v.surf.kind, stalled: v.stalled }; });
  console.log('surf', JSON.stringify(st));
  // 8. back in first person out in the park: the cockpit at speed on the lawn
  await page.keyboard.press('KeyC');
  await ev(() => { const V = window.__vehicles; V.place(-5, 60, Math.PI); V.simulate(['KeyW'], 2.5); });
  await shot('7b-modern-cockpit-on-the-lawn', 400);
  console.log('errors', errors.length ? errors.slice(0, 5) : 'none');
} finally {
  await browser.close();
}
