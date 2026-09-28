// Traffic by-eye check (headed, muted, second monitor): the 11 ST signal red / green release,
// brake lights, a crosswalk stop for the walker, and a 60 s watch for popping and overlaps.
// Usage: node tools/traffic-shots.mjs [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || 'shots/traffic');
fs.mkdirSync(OUT, { recursive: true });
const W = 1024, H = 576;
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`,
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
const cam = (x, z, heading, pitch = -4, y = null) => page.evaluate(([x, z, h, p, y]) => window.__setCam(x, y ?? window.__groundHeight(x, z) + 1.62, z, h, p), [x, z, heading, pitch, y]);
const near = (z0, z1) => page.evaluate(([z0, z1]) => window.__traffic.state().filter((c) => !c.hidden && c.z > z0 && c.z < z1), [z0, z1]);
const waitFor = async (fn, arg, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(200); } return false; };

// 1. the 11 ST signal: park-side corner north of the junction, looking along the drive
await cam(-12.2, -170, 0, -3);
// a red with a car held at it (up to a few cycles)
const heldAtRed = () => window.__traffic.signal === 'red' && window.__traffic.state().some((c) => !c.hidden && c.v < 0.05 && c.reason === 'signal');
report.heldAtRed = await waitFor(heldAtRed, null, 200000);
await page.waitForTimeout(1500);
report.red = { signal: await page.evaluate(() => window.__traffic.signal), cars: await near(-240, -140) };
await shot('1-signal-red');
await waitFor(() => window.__traffic.signal === 'green', null, 20000);
await page.waitForTimeout(3500);
report.green = { signal: await page.evaluate(() => window.__traffic.signal), cars: await near(-240, -140) };
await shot('2-signal-green-release');

// 2. brake lights: behind a car pulling up at the next red
await cam(-13.0, -168, 20, -6);
report.brakeSeen = await waitFor(() => window.__traffic.state().some((c) => !c.hidden && c.braking && c.z > -200 && c.z < -150), null, 120000);
report.brake = await near(-200, -150);
await shot('3-brake-lights');

// 3. the walker on the 5 ST crosswalk (z = -10): an approaching car stops for them
await cam(-12.5, -10, 0, -4);
const approaching = await waitFor(() => window.__traffic.state().some((c) => !c.hidden && c.dir === -1 && c.z > 5 && c.z < 60), null, 60000);
await cam(-15.4, -10, 180, -4);            // step out onto the road in the path of the northbound lane
report.crosswalkStopped = await waitFor(() => window.__traffic.state().some((c) => !c.hidden && c.dir === -1 && c.v < 0.05 && c.z > -8 && c.z < 20), null, 25000);
await page.waitForTimeout(1500);
report.crosswalk = { approaching, cars: await near(-60, 60) };
await shot('4-crosswalk-stop');
await cam(-12.0, -10, 180, -4);            // back on the sidewalk: they move off
await page.waitForTimeout(4000);
report.crosswalkAfter = await near(-60, 60);
await shot('5-crosswalk-release');

// 4. 60 s watch from the sidewalk: pops (a visible car jumping), overlaps (same-lane gaps)
await cam(-24.0, 40, 180, -3);
report.watch = await page.evaluate(() => new Promise((res) => {
  const T = window.__traffic, cam = window.__scene.children.find((o) => o.isCamera) ?? null;
  const last = new Map();
  let pops = 0, minGap = 1e9, frames = 0, maxJump = 0, overlaps = 0, maxDt = 0, slow = 0, prev = 0;
  const t0 = performance.now();
  (function tick() {
    frames++;
    const now = performance.now();
    if (prev) { const dt = now - prev; maxDt = Math.max(maxDt, dt); if (dt > 50) slow++; }
    prev = now;
    const cars = T.cars.filter((c) => !c.hidden);
    for (const c of cars) {
      const p = last.get(c.id);
      if (p && p.r === c.respawns) { const j = Math.abs(c.z - p.z); maxJump = Math.max(maxJump, j); if (j > 3) pops++; }
      last.set(c.id, { z: c.z, r: c.respawns });
    }
    for (const dir of [1, -1]) {
      const l = cars.filter((c) => c.dir === dir).sort((a, b) => a.z - b.z);
      for (let i = 1; i < l.length; i++) {
        const gap = l[i].z - l[i - 1].z - (l[i].len + l[i - 1].len) / 2;
        minGap = Math.min(minGap, gap);
        if (gap < 0.3) overlaps++;
      }
    }
    if (performance.now() - t0 < 60000) requestAnimationFrame(tick);
    else res({ frames, maxDtMs: Math.round(maxDt), slowFrames: slow, pops, maxJump: +maxJump.toFixed(2), minGap: +minGap.toFixed(2), overlaps, respawns: T.cars.map((c) => c.respawns), classics: T.cars.filter((c) => c.classic).length, models: T.cars.map((c) => c.model) });
  })();
}));
await shot('6-sidewalk-watch');

// 5. a classic in traffic, seen from the sidewalk as it drives by
report.classicSeen = await waitFor(() => window.__traffic.state().some((c) => !c.hidden && c.model === 'classic' && Math.abs(c.z) < 200), null, 240000);
if (report.classicSeen) {
  const c = await page.evaluate(() => window.__traffic.state().find((c) => !c.hidden && c.model === 'classic' && Math.abs(c.z) < 200));
  const zc = c.z + c.dir * 16;
  await cam(c.dir > 0 ? -24.5 : -11.5, zc, c.dir > 0 ? 0 : 180, -5);
  await waitFor((z) => { const q = window.__traffic.state().find((c) => c.model === 'classic' && !c.hidden); return q && Math.abs(q.z - z) < 7; }, zc, 15000);
  report.classic = await page.evaluate(() => window.__traffic.state().find((c) => c.model === 'classic' && !c.hidden));
  await shot('7-classic-drive-by');
}
report.errors = errors;
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
const brief = (l) => l.map((c) => `${c.model}${c.dir > 0 ? 'S' : 'N'}@${c.z}:${c.v}${c.braking ? 'B' : ''}${c.reason ? '(' + c.reason + ')' : ''}`).join(' ');
log('heldAtRed', report.heldAtRed, 'crosswalkStopped', report.crosswalkStopped);
log('red', report.red.signal, brief(report.red.cars));
log('green', report.green.signal, brief(report.green.cars));
log('brake', report.brakeSeen, brief(report.brake));
log('crosswalk', report.crosswalk.approaching, brief(report.crosswalk.cars));
log('after', brief(report.crosswalkAfter));
log('watch', JSON.stringify(report.watch));
log('classic', report.classicSeen, report.classic ? brief([report.classic]) : '');
log('errors', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
