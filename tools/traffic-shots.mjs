// Traffic by-eye check (headed, muted, second monitor): the 11 ST signal red (captured with
// red time left and cars held at the line) / green release, a braking car close to the
// camera with its brake lamps lit, a crosswalk stop for the walker framed across the zebra,
// a 60 s watch for popping, overlaps, density and variety, and a classic driving by.
// Usage: node tools/traffic-shots.mjs [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || 'shots/traffic');
fs.mkdirSync(OUT, { recursive: true });
const W = 1024, H = 576;
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`,
  // an occluded window drops to ~1 fps otherwise, and the sim with it
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5173/?autostart');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const report = {};
const log = (...a) => console.log(...a);
const shot = async (name) => { const p = path.join(OUT, name + '.png'); await page.screenshot({ path: p }); log('shot', p); };
// camera at (x, z) looking at (tx, tz)
const aim = (x, z, tx, tz, pitch = -4) => page.evaluate(([x, z, tx, tz, p]) => {
  window.__setCam(x, window.__groundHeight(x, z) + 1.62, z, Math.atan2(tx - x, -(tz - z)) * 180 / Math.PI, p);
}, [x, z, tx, tz, pitch]);
const near = (z0, z1) => page.evaluate(([z0, z1]) => window.__traffic.state().filter((c) => !c.hidden && c.z > z0 && c.z < z1), [z0, z1]);
const waitFor = async (fn, arg, ms, step = 150) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(step); } return false; };
// seconds of red left on Ocean Drive (the cycle in traffic-sim.js: green 22, yellow 3.5, red 14.5)
const redLeft = () => page.evaluate(() => 40 - (window.__traffic.time % 40));

// 1. the 11 ST signal from the park-side sidewalk south of the junction, looking north past the
// northbound queue to the head over its lane: red with >= 6 s left and a car held at the line
await aim(-12.4, -163, -16.4, -186, 1);
const heldAtRed = () => {
  const T = window.__traffic, q = T.time % 40;
  return T.signal === 'red' && 40 - q > 6 && T.state().some((c) => !c.hidden && c.dir === -1 && c.v < 0.05 && c.reason === 'signal');
};
// step the sim to 4 s into red first, so a slow (loaded) render loop can't miss the phase
await page.evaluate(() => {
  const T = window.__traffic;
  let need = (29.5 - (T.time % 40) + 40) % 40;
  if (need > 4) while (need > 0) { T.sim.update(0.05); need -= 0.05; }
});
report.heldAtRed = await waitFor(heldAtRed, null, 200000);
await page.waitForTimeout(400);
report.red = { signal: await page.evaluate(() => window.__traffic.signal), redLeft: +(await redLeft()).toFixed(1), cars: await near(-240, -140) };
report.red.stoppedAtRed = report.red.signal === 'red' && report.red.cars.some((c) => c.dir === -1 && c.v < 0.05 && c.reason === 'signal');
await shot('1-signal-red');
await waitFor(() => window.__traffic.signal === 'green', null, 20000);
await page.waitForTimeout(3500);
report.green = { signal: await page.evaluate(() => window.__traffic.signal), cars: await near(-240, -140) };
await shot('2-signal-green-release');

// 2. brake lamps: a northbound car braking for the next yellow / red, 6-22 m ahead of the camera
await aim(-12.6, -158, -16.3, -176, -2);
const braking = () => window.__traffic.state().some((c) => !c.hidden && c.dir === -1 && c.braking && c.v > 0.8 && c.z < -164 && c.z > -180);
report.brakeSeen = await waitFor(braking, null, 200000, 100);
report.brake = await near(-200, -150);
await shot('3-brake-lights');

// 3. the walker at the 5 ST crosswalk (z = -10), on the park-side corner stepping off the curb:
// an approaching northbound car stops at the stop bar, the zebra between it and the camera
await aim(-12.5, -12.3, -16.3, 4, -8);
report.crosswalkApproaching = await waitFor(() => window.__traffic.state().some((c) => !c.hidden && c.dir === -1 && c.z > 5 && c.z < 60), null, 90000);
await aim(-13.9, -12.3, -17.2, 4, -9);            // in the crossing's pedestrian zone
report.crosswalkStopped = await waitFor(() => window.__traffic.state().some((c) => !c.hidden && c.dir === -1 && c.v < 0.05 && c.reason === 'crosswalk' && c.z > -8 && c.z < 20), null, 40000);
await page.waitForTimeout(1200);
report.crosswalk = await near(-60, 60);
await shot('4-crosswalk-stop');
await aim(-11.2, -12.3, -17.2, 4, -9);            // back on the sidewalk: they move off
await page.waitForTimeout(4000);
report.crosswalkAfter = await near(-60, 60);
await shot('5-crosswalk-release');

// 4. 60 s watch from the sidewalk: pops (a visible car jumping), overlaps (same-lane gaps),
// cars within 250 m, and consecutive cars in a lane sharing model + colour
await aim(-24.0, 40, -19, 90, -3);
report.watch = await page.evaluate(() => new Promise((res) => {
  const T = window.__traffic;
  const last = new Map();
  let pops = 0, minGap = 1e9, frames = 0, maxJump = 0, overlaps = 0, maxDt = 0, slow = 0, prev = 0, near250 = 0, same = 0, pairs = 0;
  const models = new Set();
  const t0 = performance.now();
  (function tick() {
    frames++;
    const now = performance.now();
    if (prev) { const dt = now - prev; maxDt = Math.max(maxDt, dt); if (dt > 50) slow++; }
    prev = now;
    const cars = T.cars.filter((c) => !c.hidden);
    for (const c of cars) {
      models.add(c.model);
      const p = last.get(c.id);
      if (p && p.r === c.respawns) { const j = Math.abs(c.z - p.z); maxJump = Math.max(maxJump, j); if (j > 3) pops++; }
      last.set(c.id, { z: c.z, r: c.respawns });
    }
    near250 = Math.max(near250, cars.filter((c) => Math.abs(c.z - 40) < 250).length);
    for (const dir of [1, -1]) {
      const l = cars.filter((c) => c.dir === dir).sort((a, b) => a.z - b.z);
      for (let i = 1; i < l.length; i++) {
        const gap = l[i].z - l[i - 1].z - (l[i].len + l[i - 1].len) / 2;
        minGap = Math.min(minGap, gap);
        if (gap < 0.3) overlaps++;
        if (frames % 60 === 0) { pairs++; if (l[i].model === l[i - 1].model && l[i].color === l[i - 1].color) same++; }
      }
    }
    if (performance.now() - t0 < 60000) requestAnimationFrame(tick);
    else res({ frames, maxDtMs: Math.round(maxDt), slowFrames: slow, pops, maxJump: +maxJump.toFixed(2), minGap: +minGap.toFixed(2), overlaps, total: T.cars.length, near250, sameModelColourPairs: same, pairsChecked: pairs, models: [...models].sort(), classics: T.cars.filter((c) => c.classic && !c.hidden).length });
  })();
}));
await shot('6-sidewalk-watch');

// 5. a classic in traffic, seen from the sidewalk as it drives by
report.classicSeen = await waitFor(() => window.__traffic.state().some((c) => !c.hidden && c.model === 'classic' && Math.abs(c.z) < 200), null, 240000);
if (report.classicSeen) {
  const c = await page.evaluate(() => window.__traffic.state().find((c) => !c.hidden && c.model === 'classic' && Math.abs(c.z) < 200));
  const zc = c.z + c.dir * 16;
  await aim(c.dir > 0 ? -24.5 : -11.5, zc, c.dir > 0 ? -21 : -15, zc + c.dir * 30, -5);
  await waitFor((z) => { const q = window.__traffic.state().find((c) => c.model === 'classic' && !c.hidden); return q && Math.abs(q.z - z) < 7; }, zc, 15000);
  report.classic = await page.evaluate(() => window.__traffic.state().find((c) => c.model === 'classic' && !c.hidden));
  await shot('7-classic-drive-by');
}
report.errors = errors;
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
const brief = (l) => l.map((c) => `${c.model}${c.dir > 0 ? 'S' : 'N'}@${c.z}:${c.v}${c.braking ? 'B' : ''}${c.reason ? '(' + c.reason + ')' : ''}`).join(' ');
log('heldAtRed', report.heldAtRed, 'stoppedAtRed', report.red.stoppedAtRed, 'redLeft', report.red.redLeft, 'crosswalkStopped', report.crosswalkStopped);
log('red', report.red.signal, brief(report.red.cars));
log('green', report.green.signal, brief(report.green.cars));
log('brake', report.brakeSeen, brief(report.brake));
log('crosswalk', brief(report.crosswalk));
log('after', brief(report.crosswalkAfter));
log('watch', JSON.stringify(report.watch));
log('classic', report.classicSeen, report.classic ? brief([report.classic]) : '');
log('errors', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
