// Ride test: walk up to the bike and the ATV, mount with E, ride / drive with the keyboard
// (real key presses) and scripted key sequences (vehicles.simulate), check speeds per
// surface, collisions, dismounting and that the ATV stays on the beach; screenshots in
// shots/ride-test/. Usage: node tools/ride-test.mjs   (dev server on :5173)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.URL ?? 'http://localhost:5173/';
const outDir = path.resolve('shots', 'ride-test');
fs.mkdirSync(outDir, { recursive: true });
const W = 1024, H = 576;
const browser = await chromium.launch({
  channel: 'chrome', headless: false,
  args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url + '?autostart');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.mouse.click(W / 2, H / 2);   // focus (no pointer lock in ?autostart without a lock request)

const report = { checks: {}, shots: [] };
const results = [];
const check = (name, ok, info) => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(info)}`); };
async function shot(name, wait = 500) {
  await page.waitForTimeout(wait);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  report.shots.push(file);
  console.log('shot', file);
}
const st = () => page.evaluate(() => ({ riding: window.__vehicles.riding, near: window.__vehicles.near, list: window.__vehicles.state(), walker: { x: +window.__walker.pos.x.toFixed(2), z: +window.__walker.pos.y.toFixed(2) } }));
// stand `dist` m from a vehicle, looking at it
async function approach(kind, dist, bearing) {
  await page.evaluate(({ kind, dist, bearing }) => {
    const v = window.__vehicles.list.find((e) => e.kind === kind).v;
    const a = bearing * Math.PI / 180;
    const x = v.x + Math.sin(a) * dist, z = v.z - Math.cos(a) * dist;
    const h = (Math.atan2(v.x - x, -(v.z - z)) * 180) / Math.PI;
    window.__walker.teleport(x, z, h, -18);
  }, { kind, dist, bearing });
  await page.waitForTimeout(400);
}
// scripted riding toward waypoints: re-aim every 0.1 s with A / D, W (+ Shift) held
async function rideTo(x, z, { hard = true, maxT = 60, stopAt = 1.2 } = {}) {
  return page.evaluate(({ x, z, hard, maxT, stopAt }) => {
    const V = window.__vehicles, v = V.current;
    const bySurf = {};
    let t = 0, bumps = 0, maxBump = 0, stuck = 0, reverses = 0;
    while (t < maxT) {
      const dx = x - v.x, dz = z - v.z, d = Math.hypot(dx, dz);
      if (d < stopAt) break;
      const want = Math.atan2(-dx, -dz);                 // yaw that faces the target
      const err = Math.atan2(Math.sin(want - v.yaw), Math.cos(want - v.yaw));
      const keys = ['KeyW'];
      if (hard) keys.push('ShiftLeft');
      if (err > 0.06) keys.push('KeyA'); else if (err < -0.06) keys.push('KeyD');
      const r = V.simulate(keys, 0.1);
      for (const p of r.log) {
        const s = p.surf;
        bySurf[s] = Math.max(bySurf[s] ?? 0, Math.abs(p.v));
      }
      if (r.maxBump > 0.5) { bumps++; maxBump = Math.max(maxBump, r.maxBump); }
      t += 0.1;
      stuck = Math.abs(v.lon) < 0.2 && t > 1 ? stuck + 1 : 0;
      // stuck against something: back off with the wheel turned the other way, like a rider would
      if (stuck > 8) {
        if (++reverses > 6) break;
        V.simulate(['KeyS', err > 0 ? 'KeyD' : 'KeyA'], 2.2);
        V.simulate([], 0.3);
        stuck = 0; t += 2.5;
      }
    }
    V.simulate([], 0.1);
    return { at: [+v.x.toFixed(2), +v.z.toFixed(2)], t: +t.toFixed(1), reached: Math.hypot(x - v.x, z - v.z) < stopAt + 0.3, bySurf, bumps, maxBump: +maxBump.toFixed(2), reverses, speed: +v.lon.toFixed(2) };
  }, { x, z, hard, maxT, stopAt });
}
async function brake(sec = 3) { await page.evaluate((s) => window.__vehicles.simulate(['KeyS'], s), sec); }

// ---------------------------------------------------------------------------
// 1. the bike: prompt, mount with E
await approach('bike', 1.9, 250);
let s = await st();
const promptShown = await page.evaluate(() => document.getElementById('ride-prompt').classList.contains('show') && document.getElementById('ride-prompt').textContent);
check('bike prompt appears when looking at it within reach', s.near === 'bike' && !!promptShown, { near: s.near, prompt: promptShown });
await shot('1-bike-prompt');
await approach('bike', 1.9, 70);
await page.evaluate(() => { window.__walker.yaw += Math.PI; });   // facing away
await page.waitForTimeout(200);
s = await st();
check('no prompt when looking away', s.near === null, { near: s.near });
await approach('bike', 1.9, 250);
await page.keyboard.press('KeyE');
await page.waitForTimeout(700);
s = await st();
check('E mounts the bike', s.riding && s.list.find((q) => q.kind === 'bike').ridden, s);
await shot('2-bike-first-person', 200);
// real keyboard: pedal (W + Shift) for 3 s on the grass / promenade, heading north-west
await page.evaluate(() => { const v = window.__vehicles.current; window.__vehicles.place(v.x, v.z, 0.35); });
await page.keyboard.down('KeyW');
await page.waitForTimeout(1500);
await shot('3-bike-riding-park', 0);
await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(1500);
const realV = await page.evaluate(() => window.__vehicles.current.lon);
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');
check('real W key pedals the bike', realV > 2.5, { speed: +realV.toFixed(2) });
await page.keyboard.down('KeyS'); await page.waitForTimeout(1500); await page.keyboard.up('KeyS');
// promenade: along the path northwards, then back to the access at z = -30
let r = await rideTo(-2.5, -60, { maxT: 30 });
report.checks.bikePromenade = r;
check('bike on the promenade reaches ~6 m/s', (r.bySurf.pavement ?? 0) > 5.3, r);
await shot('4-bike-promenade', 100);
await page.evaluate(() => window.__vehicles.place(6.5, -30, -Math.PI / 2));   // lined up with the z = -30 access
r = await rideTo(18, -30, { hard: false, maxT: 20 });
report.checks.bikeAccess = r;
check('bike rides down the seawall access onto the sand', r.at[0] > 15, r);
await shot('5-bike-on-sand', 100);
r = await rideTo(40, -60, { maxT: 30 });
report.checks.bikeDrySand = r;
check('bike on dry soft sand ~3 m/s', (r.bySurf.sand ?? 0) > 2.4 && (r.bySurf.sand ?? 9) < 3.4, r);
r = await rideTo(87.5, -75, { maxT: 40 });
r = await rideTo(87.5, -120, { maxT: 30 });
report.checks.bikeWetSand = r;
check('bike on hard wet sand faster (~5.7 m/s)', (r.bySurf.wetsand ?? 0) > 4.8, r);
r = await rideTo(110, -121, { maxT: 20 });
const bikeWater = await page.evaluate(() => { const v = window.__vehicles.current; return { x: +v.x.toFixed(2), depth: +(-1 - window.__beach.groundAt(v.x, v.z)).toFixed(3), speed: +v.lon.toFixed(2) }; });
check('bike stops before ~0.2 m of water', bikeWater.depth < 0.21 && bikeWater.x < 97.5, { ...r, ...bikeWater });
await page.evaluate(() => { window.__walker.yaw += 0; window.__walker.pitch = -0.35; });
await shot('6-bike-in-swash', 300);
// collision: into the seawall away from an access, at speed
await page.evaluate(() => window.__vehicles.place(14.6, -60, Math.PI / 2));
r = await rideTo(5, -60, { maxT: 3 });
check('the seawall stops the bike (no tunnelling)', r.at[0] > 12.3 && r.maxBump > 0.5, r);
// dismount
await brake(2);
await page.keyboard.press('KeyE');
await page.waitForTimeout(400);
s = await st();
const bk = s.list.find((q) => q.kind === 'bike');
const off = Math.hypot(s.walker.x - bk.x, s.walker.z - bk.z);
check('E dismounts beside the bike, which stays put', !s.riding && !bk.ridden && off > 0.5 && off < 2.2, { walker: s.walker, bike: bk, off: +off.toFixed(2) });
await page.evaluate(() => window.__walker.simulate([], 0.5));
await shot('7-after-dismount', 300);
// the parked bike blocks the walker
const walkInto = await page.evaluate(() => {
  const w = window.__walker, v = window.__vehicles.list[0].v;
  w.teleport(v.x - 2.5, v.z, 90, 0);
  w.yaw = -Math.atan2(v.x - w.pos.x, -(v.z - w.pos.y));
  w.simulate(['KeyW'], 3);
  return +Math.hypot(w.pos.x - v.x, w.pos.y - v.z).toFixed(2);
});
check('the parked bike is solid to the walker', walkInto > 0.45, { dist: walkInto });

// ---------------------------------------------------------------------------
// 2. the ATV
await approach('atv', 2.2, 90);
s = await st();
check('ATV prompt', s.near === 'atv', { near: s.near });
await page.keyboard.press('KeyE');
await page.waitForTimeout(900);
s = await st();
check('E mounts the ATV', s.riding && s.list.find((q) => q.kind === 'atv').ridden, s);
const idle = await page.evaluate(() => ({ rpm: Math.round(window.__vehicles.current.rpm), audio: window.__audio.stats() }));
check('ATV idles when mounted and stopped', idle.rpm > 1300 && idle.rpm < 1700, idle);
await shot('8-atv-first-person', 200);
// real keys: throttle away from the tower
await page.evaluate(() => { const v = window.__vehicles.current; window.__vehicles.place(v.x, v.z, -Math.PI / 2); });   // face east
await page.keyboard.down('KeyW');
await page.waitForTimeout(2000);
await page.keyboard.up('KeyW');
const atvReal = await page.evaluate(() => ({ speed: +window.__vehicles.current.lon.toFixed(2), rpm: Math.round(window.__vehicles.current.rpm) }));
check('real W key drives the ATV', atvReal.speed > 3, atvReal);
r = await rideTo(30, -100, { maxT: 30 });
report.checks.atvSoft = r;
check('ATV on soft sand ~8 m/s (boost)', (r.bySurf.sand ?? 0) > 7 && (r.bySurf.sand ?? 99) < 9, r);
r = await rideTo(88, -80, { maxT: 20 });
r = await rideTo(88, -250, { maxT: 30 });
report.checks.atvHard = r;
check('ATV on hard sand ~12 m/s (boost)', Math.max(r.bySurf.wetsand ?? 0, r.bySurf.water ?? 0) > 10.5, r);
await shot('9-atv-hard-sand', 50);
// splash through the swash
r = await rideTo(93, -330, { maxT: 20, stopAt: 2 });
r = await rideTo(93.5, -200, { maxT: 20 });
report.checks.atvSwash = r;
await page.evaluate(() => window.__vehicles.simulate(['KeyW', 'ShiftLeft', 'KeyA'], 0.6));
await shot('10-atv-swash-spray', 0);
check('ATV splashes through the swash', !!r.bySurf.water || r.bySurf.wetsand > 0, r);
// deep water stops it
r = await rideTo(110, -200, { maxT: 12 });
const atvWater = await page.evaluate(() => { const v = window.__vehicles.current; return { x: +v.x.toFixed(2), depth: +(-1 - window.__beach.groundAt(v.x, v.z)).toFixed(3) }; });
check('ATV stops before deep water', atvWater.depth < 0.34 && atvWater.x < 100, { ...r, ...atvWater });
// beach only: drive at the seawall / park
r = await rideTo(0, -200, { maxT: 20 });
check('ATV stays on the beach (does not reach the park)', r.at[0] > 13, r);
r = await rideTo(0, -245, { maxT: 12 });
check('ATV cannot climb the z = -245 access', r.at[0] > 13, r);
// the whole beach north -> south
r = await rideTo(60, -330, { maxT: 40 });
r = await rideTo(60, 330, { maxT: 120 });
check('ATV drives the whole beach length', r.at[1] > 325, r);
// collision with a lifeguard tower at speed
await page.evaluate(() => window.__vehicles.place(30, 200, -Math.PI / 2));
r = await rideTo(50, 200, { maxT: 6 });
check('ATV stops against the tower (no tunnelling)', r.at[0] < 43.2 && r.maxBump > 1, r);
await brake(2);
await page.keyboard.press('KeyE');
await page.waitForTimeout(400);
s = await st();
const av = s.list.find((q) => q.kind === 'atv');
check('E dismounts the ATV; engine off', !s.riding && Math.hypot(s.walker.x - av.x, s.walker.z - av.z) < 2.6, { walker: s.walker, atv: av });
// dismount at speed: brakes first
await approach('atv', 2.2, 90);
await page.keyboard.press('KeyE');
await page.waitForTimeout(700);
await page.evaluate(() => window.__vehicles.simulate(['KeyW', 'ShiftLeft'], 3));
await page.keyboard.press('KeyE');
const brakeOff = await page.evaluate(() => { const V = window.__vehicles; for (let i = 0; i < 400 && V.riding; i++) V.update(1 / 60); return { riding: V.riding, speed: V.list[1].v.lon }; });
check('E at speed brakes, then gets off', !brakeOff.riding, brakeOff);

// ---------------------------------------------------------------------------
// 2b. the convertible: prompt from the sidewalk, starter, driver view, roads only
{
  const carV = () => page.evaluate(() => { const v = window.__vehicles.list.find((e) => e.kind === 'car').v; return { x: +v.x.toFixed(2), z: +v.z.toFixed(2), yaw: +v.yaw.toFixed(3), lon: +v.lon.toFixed(2), rpm: Math.round(v.rpm), gear: v.gear, on: v.engineOn, ridden: v.ridden }; });
  const start = await carV();
  await approach('car', 2.4, 270);
  s = await st();
  const carPrompt = await page.evaluate(() => document.getElementById('ride-prompt').textContent);
  check('car prompt "E drive" from the sidewalk', s.near === 'car' && /drive/.test(carPrompt), { near: s.near, prompt: carPrompt });
  await shot('13-car-prompt');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  let c = await carV();
  check('E sits you in the car; starter cranking (engine not yet on)', c.ridden && !c.on, c);
  await page.waitForTimeout(1200);
  c = await carV();
  check('the V8 catches and idles ~620 rpm', c.on && c.rpm > 500 && c.rpm < 1400, c);
  await shot('14-car-driver-view', 300);
  // real keys: W pulls away down the west lane
  await page.evaluate(() => { const v = window.__vehicles.current; window.__vehicles.place(-19.75, v.z, Math.PI); });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  await shot('15-car-driving', 0);
  await page.keyboard.up('KeyW');
  c = await carV();
  check('real W key drives the car', c.lon > 4, c);
  // steer (A / D) and the steering wheel turns with it
  const steer = await page.evaluate(() => { const V = window.__vehicles; V.simulate(['KeyW', 'KeyD'], 1.2); return +V.current.steer.toFixed(3); });
  check('D steers right', steer > 0.05, { steer });
  await shot('16-car-steering', 0);
  // down the drive to the south end at speed, then brake
  r = await rideTo(-19.75, 300, { maxT: 60, stopAt: 3 });
  report.checks.carDrive = r;
  check('car reaches ~60-70 km/h on the road', (r.bySurf.pavement ?? 0) * 3.6 > 58 && (r.bySurf.pavement ?? 99) * 3.6 < 76, r);
  await brake(4);
  // curbs: try to drive onto the park-side sidewalk and the hotel side
  await page.evaluate(() => window.__vehicles.place(-17, 250, -Math.PI / 2));
  r = await rideTo(-5, 250, { maxT: 5 });
  check('park-side curb stops the car', r.at[0] < -14.4, r);
  await page.evaluate(() => window.__vehicles.place(-20, 250, Math.PI / 2));
  r = await rideTo(-35, 250, { maxT: 5 });
  check('hotel-side curb stops the car', r.at[0] > -24.1, r);
  // a cross street (7 ST, z = 190)
  await page.evaluate(() => window.__vehicles.place(-19, 190, Math.PI / 2));
  r = await rideTo(-40, 190, { maxT: 12, hard: false });
  check('car drives into a cross street', r.at[0] < -32, r);
  await shot('17-car-cross-street', 100);
  // a parked car stops it
  const pk = await page.evaluate(() => { const c = window.__cars.colliders.find((q) => !q.hero && q.min.z > 20 && q.min.z < 120); return c && { z: c.min.z, x: (c.min.x + c.max.x) / 2 }; });
  if (pk) {
    await page.evaluate((pk) => window.__vehicles.place(pk.x, pk.z - 14, Math.PI), pk);
    r = await rideTo(pk.x, pk.z + 6, { maxT: 6 });
    check('a parked car stops it (no tunnelling)', r.at[1] < pk.z - 2.5, { ...r, parkedZ: pk.z });
  }
  // exit: sidewalk side when parked at the curb; the car stays
  await page.evaluate(() => window.__vehicles.place(-22.75, -40, Math.PI));
  await brake(1);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(500);
  s = await st();
  c = await carV();
  check('E gets out on the sidewalk side; engine off; car stays', !s.riding && s.walker.x < -24 && !c.on && Math.abs(c.z + 40) < 0.5, { walker: s.walker, car: c });
  await shot('18-car-after-exit', 300);
  // the parked car is solid to the walker
  const solid = await page.evaluate(() => {
    const w = window.__walker, v = window.__vehicles.list.find((e) => e.kind === 'car').v;
    w.teleport(v.x - 2.6, v.z, 90, 0);
    w.simulate(['KeyW'], 3);
    return +(v.x - w.pos.x).toFixed(2);
  });
  check('the parked convertible is solid to the walker', solid > 1.0, { dx: solid });
  // put it back where it was (the ride test runs before other shots)
  await page.evaluate((p) => window.__vehicles.place(p.x, p.z, p.yaw, 'car'), start);
}

// ---------------------------------------------------------------------------
// 3. waterline foam (swash over the feet)
await page.evaluate(() => { window.__walker.teleport(91.5, 14, 110, -38); });
const swash = await page.evaluate(async () => {
  for (let i = 0; i < 160; i++) {
    const w = window.__walker, sw = window.__beach.swashAt(w.pos.x + 1.5, w.pos.y);
    if (sw.covered && sw.depth > 0.02) return { waited: i * 0.25, ...sw };
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
});
await shot('11-waterline-foam', 50);
await page.evaluate(() => { window.__walker.pitch = -0.6; window.__walker.apply(); });
await shot('12-waterline-foam-down', 400);
report.checks.swash = swash;

const perf = await page.evaluate(() => window.__renderInfo());
report.perf = perf;
report.errors = errors;
report.results = results;
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
const failed = results.filter((q) => !q.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed; render ${JSON.stringify(perf)}; errors ${errors.length ? errors.slice(0, 5) : 'none'}`);
await browser.close();
