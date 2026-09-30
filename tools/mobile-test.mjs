// Mobile / tablet emulation test: tier detection, loader + overlay fit, tap to start,
// joystick walk, drag-look, jump, screenshots (portrait + landscape) into shots/mobile/.
// Usage: node tools/mobile-test.mjs [device names...]   (dev server must be running on :5173)
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.SHOT_URL || 'http://localhost:5173/';
const outDir = path.resolve('shots', 'mobile');
fs.mkdirSync(outDir, { recursive: true });
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['iPhone 13', 'Pixel 7', 'iPad (gen 7)'];
const expectTier = { 'iPhone 13': 'low', 'Pixel 7': 'low', 'iPad (gen 7)': 'medium' };

const browser = await chromium.launch({
  headless: false,
  args: ['--mute-audio', '--window-position=1940,120', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

for (const name of names) {
  const d = devices[name];
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
  console.log(`\n== ${name} (${d.viewport.width}x${d.viewport.height} @${d.deviceScaleFactor})`);
  const ctx = await browser.newContext({ ...d });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(([x, y, id]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })),
  });

  const t0 = Date.now();
  await page.goto(url + '?hud');
  await sleep(1500);
  await page.screenshot({ path: path.join(outDir, `${slug}-loader.png`) });
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 180000 });
  await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 30000 });
  console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const q = await page.evaluate(() => ({ tier: window.__quality.tier, gpu: window.__quality.gpu.renderer, why: window.__quality.why, dyn: window.__dynres() }));
  console.log('quality', JSON.stringify(q));
  check(q.tier === expectTier[name], `tier ${q.tier} (expected ${expectTier[name]})`);

  // overlay caption fits the screen
  const vp = page.viewportSize();
  const cap = await page.evaluate(() => {
    const r = document.querySelector('#overlay .caption').getBoundingClientRect();
    return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom, text: document.querySelector('#overlay .how').textContent };
  });
  check(cap.x0 >= 0 && cap.y0 >= 0 && cap.x1 <= vp.width && cap.y1 <= vp.height, `caption inside viewport ${JSON.stringify(cap)}`);
  check(/Tap to walk/.test(cap.text), 'touch caption text');
  await page.screenshot({ path: path.join(outDir, `${slug}-portrait-overlay.png`) });

  // tap to start
  await page.touchscreen.tap(vp.width / 2, vp.height / 2);
  await sleep(600);
  const st = await page.evaluate(() => ({ active: window.__walker.active, touch: window.__touch?.enabled, hidden: document.getElementById('overlay').classList.contains('hidden'), audio: window.__audio.stats().state }));
  check(st.active && st.touch && st.hidden, `tap starts walking ${JSON.stringify(st)}`);

  // joystick: hold the left thumb pushed forward, drag-look with the right at the same time
  const pose = () => page.evaluate(() => ({ x: window.__walker.pos.x, z: window.__walker.pos.y, yaw: window.__walker.yaw, pitch: window.__walker.pitch, y: window.camera?.position?.y }));
  await page.evaluate(() => window.__walker.teleport(-24, 30, 0, 2));   // sidewalk, looking up the street
  await sleep(300);
  const p0 = await pose();
  const jx = vp.width * 0.18, jy = vp.height * 0.72, lx = vp.width * 0.72, ly = vp.height * 0.45;
  await touch('touchStart', [[jx, jy, 1]]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [[jx, jy - i * 9, 1]]); await sleep(16); }
  await touch('touchStart', [[jx, jy - 54, 1], [lx, ly, 2]]);
  for (let i = 1; i <= 20; i++) { await touch('touchMove', [[jx, jy - 54, 1], [lx - i * 4, ly + i * 0.8, 2]]); await sleep(30); }
  await sleep(300);
  await page.screenshot({ path: path.join(outDir, `${slug}-portrait-walking.png`) });
  await sleep(1000);
  const p1 = await pose();
  await touch('touchEnd', [[jx, jy - 54, 1]]);
  await touch('touchEnd', []);
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check(moved > 1.0, `joystick walked ${moved.toFixed(2)} m`);
  check(Math.abs(p1.yaw - p0.yaw) > 0.1, `drag-look turned ${(p1.yaw - p0.yaw).toFixed(3)} rad, pitch ${(p1.pitch - p0.pitch).toFixed(3)}`);
  await sleep(800);
  const p2 = await pose();
  check(Math.hypot(p2.x - p1.x, p2.z - p1.z) < 0.8, 'stops after release');

  // jump button
  const jb = await page.evaluate(() => { const r = document.querySelector('#touch .jump').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.touchscreen.tap(jb.x, jb.y);
  let maxAir = 0;
  for (let i = 0; i < 12; i++) { maxAir = Math.max(maxAir, await page.evaluate(() => window.__walker.airY)); await sleep(40); }
  check(maxAir > 0.2, `jump apex ${maxAir.toFixed(2)} m`);

  // mute button
  const mb = await page.evaluate(() => { const r = document.querySelector('#touch .mute').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.touchscreen.tap(mb.x, mb.y);
  check(await page.evaluate(() => window.__audio.muted), 'mute button mutes');
  await page.touchscreen.tap(mb.x, mb.y);

  // the convertible: Drive button, stick throttle + steer, Brake label, Exit
  {
    const car = () => page.evaluate(() => { const v = window.__vehicles.list.find((e) => e.kind === 'car').v; return { x: v.x, z: v.z, yaw: v.yaw, lon: v.lon, steer: v.steer, on: v.engineOn, ridden: v.ridden }; });
    const btn = (s) => page.evaluate((s) => { const b = document.querySelector(s), r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: b.textContent, show: b.classList.contains('show') }; }, s);
    const c0 = await car();
    await page.evaluate(() => {
      const v = window.__vehicles.list.find((e) => e.kind === 'car').v;
      const x = v.x - 2.4, z = v.z;
      window.__walker.teleport(x, z, (Math.atan2(v.x - x, -(v.z - z)) * 180) / Math.PI, -18);
    });
    await sleep(500);
    const rb = await btn('#touch .ride');
    check(rb.show && rb.text === 'Drive', `Drive button near the convertible ${JSON.stringify({ show: rb.show, text: rb.text })}`);
    await page.touchscreen.tap(rb.x, rb.y);
    await sleep(1800);
    let c = await car();
    const labels = { ride: (await btn('#touch .ride')).text, jump: await page.evaluate(() => document.querySelector('#touch .jump span').textContent) };
    check(c.ridden && c.on && labels.ride === 'Exit' && labels.jump === 'Brake', `tap Drive: seated, V8 running, Exit/Brake labels ${JSON.stringify({ ridden: c.ridden, on: c.on, ...labels })}`);
    await page.screenshot({ path: path.join(outDir, `${slug}-car-driver.png`) });
    await page.evaluate(() => { for (const t of window.__traffic.cars) { t.hidden = true; t.v = 0; t.z = t.dir * 470; } const v = window.__vehicles.current; window.__vehicles.place(-19.75, v.z, Math.PI); });
    await touch('touchStart', [[jx, jy, 4]]);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [[jx, jy - i * 9, 4]]); await sleep(16); }
    await sleep(2500);
    c = await car();
    check(c.lon > 3, `stick forward drives the car ${c.lon.toFixed(2)} m/s`);
    await page.screenshot({ path: path.join(outDir, `${slug}-car-driving.png`) });
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [[jx + i * 8, jy - 54, 4]]); await sleep(16); }
    await sleep(500);
    c = await car();
    check(c.steer > 0.05, `stick right steers right ${c.steer.toFixed(3)}`);
    await touch('touchEnd', []);
    const eb = await btn('#touch .ride');
    await page.touchscreen.tap(eb.x, eb.y);
    for (let i = 0; i < 40 && (await car()).ridden; i++) await sleep(200);
    c = await car();
    const w = await page.evaluate(() => ({ active: window.__walker.active, riding: window.__vehicles.riding }));
    check(!c.ridden && !w.riding && w.active && Math.abs(c.lon) < 0.3, `tap Exit brakes and gets out ${JSON.stringify({ ...w, lon: +c.lon.toFixed(2) })}`);
    await page.evaluate((p) => { window.__vehicles.place(p.x, p.z, p.yaw, 'car'); for (const t of window.__traffic.cars) t.hidden = false; }, c0);
  }

  // landscape
  await page.setViewportSize({ width: vp.height, height: vp.width });
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
  await sleep(900);
  await page.evaluate(() => window.__walker.teleport(5, -14, 102, 1));   // park, toward the sunrise
  await sleep(400);
  const lv = page.viewportSize();
  const canvasOk = await page.evaluate(() => { const c = document.querySelector('canvas'); return c.clientWidth === innerWidth && c.clientHeight === innerHeight; });
  check(canvasOk, 'canvas resized to landscape');
  const ljx = lv.width * 0.15, ljy = lv.height * 0.7;
  await touch('touchStart', [[ljx, ljy, 3]]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [[ljx + i * 3, ljy - i * 8, 3]]); await sleep(16); }
  await sleep(500);
  await page.screenshot({ path: path.join(outDir, `${slug}-landscape-walking.png`) });
  await touch('touchEnd', []);
  await sleep(500);
  const btns = await page.evaluate(() => [...document.querySelectorAll('#touch button')].map((b) => { const r = b.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
  const overlap = btns[0][0] < btns[1][2] && btns[1][0] < btns[0][2] && btns[0][1] < btns[1][3] && btns[1][1] < btns[0][3];
  check(!overlap && btns.every((b) => b[0] >= 0 && b[1] >= 0 && b[2] <= lv.width && b[3] <= lv.height), 'buttons inside screen, not overlapping');
  await page.screenshot({ path: path.join(outDir, `${slug}-landscape.png`) });
  const info = await page.evaluate(() => ({ ...window.__renderInfo(), dyn: window.__dynres(), hud: document.getElementById('hud').textContent }));
  console.log('render', JSON.stringify(info));
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
