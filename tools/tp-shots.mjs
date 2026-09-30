// Third-person on foot: the screenshots in shots/third-person/ (standing, walking, running,
// jumping, on the beach, in the surf, against a wall, at the car door and getting in, and the
// first-person shadow). Walks with the real keys so the animation runs at the frame rate.
// Usage: URL=http://localhost:5199/ node tools/tp-shots.mjs   (OUT=dir to write elsewhere)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.env.OUT ?? 'shots/third-person');
fs.mkdirSync(outDir, { recursive: true });
const W = 1280, H = 720;
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 140}`] });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto((process.env.URL ?? 'http://localhost:5199/') + '?autostart');
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
  await page.waitForTimeout(1200);
  // (the traffic parked out of the way, so every frame is about the body)
  const quiet = () => page.evaluate(() => { for (const t of window.__traffic.cars) { t.hidden = true; t.v = 0; t.z = t.dir * 470; } });
  await quiet();
  const pose = async (x, z, heading, pitch, mode = 'tp') => {
    await page.evaluate(([x, z, h, p, m]) => { window.__footView.set(m); window.__walker.teleport(x, z, h, p); window.__footCam.snap(); }, [x, z, heading, pitch, mode]);
    await page.waitForTimeout(900);
  };
  const shot = async (name) => { const f = path.join(outDir, name + '.png'); await page.screenshot({ path: f }); console.log('shot', f); return f; };
  const hold = async (keys, ms, name, at = ms) => {
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(at);
    if (name) await shot(name);
    await page.waitForTimeout(Math.max(0, ms - at));
    for (const k of keys.slice().reverse()) await page.keyboard.up(k);
  };
  const state = () => page.evaluate(() => ({ av: window.__avatar.state(), len: +window.__footCam.length.toFixed(2), cam: window.__camera.position.toArray().map((v) => +v.toFixed(2)) }));

  // standing on the hotel sidewalk, the camera over the right shoulder
  await pose(0.6, 28, 290, -4);
  await page.waitForTimeout(600);
  await shot('01-standing');
  // walking (strafing right: the body turns to its way, seen in profile)
  await pose(-26.2, 20, 0, -3);
  await hold(['KeyD'], 1600, null);
  await pose(-12.4, 40, 0, -4);
  await hold(['KeyW'], 1800, '02-walking', 1500);
  await pose(-12.4, 40, 270, -4);
  await hold(['KeyD'], 1800, '02b-walking-profile', 1400);
  // running (Shift)
  await pose(-12.4, 44, 270, -4);
  await hold(['ShiftLeft', 'KeyD'], 2200, '03-running', 1700);
  // jumping: a running jump, mid-air
  await pose(0, 10, 270, -2);
  for (const k of ['ShiftLeft', 'KeyD']) await page.keyboard.down(k);
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  await page.waitForTimeout(260);
  await shot('04-jumping');
  const jump = await state();
  await page.waitForTimeout(500);
  for (const k of ['KeyD', 'ShiftLeft']) await page.keyboard.up(k);
  // the beach: walking across the sand, the sun low over the water ahead
  await pose(40, 6, 90, -6);
  await hold(['KeyW'], 1600, '05-beach', 1300);
  await pose(46, 14, 0, -6);
  await hold(['KeyD'], 1600, '05b-beach-profile', 1300);
  // the surf: wading along the shore
  await pose(93.8, 10, 0, -10);
  await hold(['KeyD'], 1500, null);
  await pose(94.4, 8, 180, -10);
  await hold(['KeyA'], 2200, '06-surf', 1700);
  const surf = await state();
  // against a wall: back to a hotel's terrace wall, the arm shortened (and a free arm beside it)
  await pose(-27.5, 16.5, 90, -6);
  await page.waitForTimeout(600);
  const wall = await state();
  await shot('07-wall-camera');
  await pose(-12.2, 16.5, 90, -6);
  const open = await state();
  // a palm trunk right behind: the camera slides round it, the arm stays long
  await pose(-25.2, 26, 330, -4);
  const palm = { ...(await state()), thin: await page.evaluate(() => !!window.__footCam.thin) };
  await shot('07b-palm-behind');
  // next to the convertible's driver door, then getting in
  const door = await page.evaluate(() => {
    const V = window.__vehicles, e = V.list.find((q) => q.kind === 'car');
    const d = V.doorsOf(e).find((q) => q.side === 'driver');
    const x = d.x + (d.x - e.v.x) * 0.3, z = d.z + 1.1;
    window.__footView.set('tp');
    window.__walker.teleport(x, z, (Math.atan2(e.v.x - x, -(e.v.z - z)) * 180) / Math.PI + 25, -8);
    window.__footCam.snap();
    return { x, z, near: V.near };
  });
  await page.waitForTimeout(1000);
  await shot('08-car-door');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  await shot('08b-getting-in');
  const entering = await state();
  await page.waitForTimeout(330);
  await shot('08c-getting-in-seat');
  await page.waitForTimeout(1200);
  await shot('08d-seated');
  const inCar = await page.evaluate(() => ({ riding: window.__vehicles.riding, av: window.__avatar.state() }));
  // the chase view, then out of the car from it
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(900);
  await shot('08e-chase');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(260);
  await shot('08f-getting-out');
  await page.waitForTimeout(1300);
  await shot('08g-out');
  const out = await state();
  const carView = await page.evaluate(() => localStorage.getItem('ocean-drive.view'));
  // first person: the body's long shadow ahead, walking away from the sun
  await pose(30, 20, 280, -32, 'fp');
  await hold(['KeyW'], 1500, '09-first-person-shadow', 1200);
  await pose(-4, 30, 275, -30, 'fp');
  await hold(['KeyW'], 1500, '09b-first-person-shadow-lawn', 1200);
  console.log(JSON.stringify({ jump, surf, wall, open, palm, door, entering, inCar, out, carView }));
  console.log('errors', errors.length ? errors.slice(0, 5) : 'none');
} finally {
  await browser.close();
}
