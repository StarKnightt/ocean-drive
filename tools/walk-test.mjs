// Automated walk: sidewalk -> crosswalk -> park -> seawall steps -> sand -> tower deck ->
// waterline, plus a check that the visual moving car follows the audio car.
// Usage: node tools/walk-test.mjs   (dev server on :5173). Screenshots in shots/walk-test/.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.URL ?? 'http://localhost:5173/';
const outDir = path.resolve('shots', 'walk-test');
fs.mkdirSync(outDir, { recursive: true });

const W = 1024, H = 576;
const browser = await chromium.launch({
  headless: false,
  args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url + '?autostart');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });

const report = { legs: [], checks: {}, shots: [] };
const log = (...a) => console.log(...a);

// Follow a waypoint: re-aim every 0.25 s of simulated time, stop within 0.35 m.
async function walkTo(x, z, { fast = false, maxT = 90 } = {}) {
  const r = await page.evaluate(({ x, z, fast, maxT }) => {
    const w = window.__walker;
    let t = 0, stuck = 0, last = w.pos.clone();
    let maxY = -1e9;
    while (t < maxT) {
      const dx = x - w.pos.x, dz = z - w.pos.y;
      if (Math.hypot(dx, dz) < 0.35) break;
      w.yaw = -Math.atan2(dx, -dz);
      w.simulate(fast ? ['KeyW', 'ShiftLeft'] : ['KeyW'], 0.25);
      maxY = Math.max(maxY, w.feetY);
      t += 0.25;
      if (w.pos.distanceTo(last) < 0.02) {
        if (++stuck > 12) break;
        w.simulate([stuck % 2 ? 'KeyA' : 'KeyD'], 0.6);   // sidestep round the obstacle
      } else stuck = 0;
      last.copy(w.pos);
    }
    w.simulate([], 0.6);   // come to rest
    return { x: +w.pos.x.toFixed(2), z: +w.pos.y.toFixed(2), feetY: +w.feetY.toFixed(3), ground: +window.__beach.groundAt(w.pos.x, w.pos.y).toFixed(3), maxY: +maxY.toFixed(3), t, reached: Math.hypot(x - w.pos.x, z - w.pos.y) < 0.5 };
  }, { x, z, fast, maxT });
  report.legs.push({ to: [x, z], ...r });
  log(`walk -> (${x}, ${z}): at (${r.x}, ${r.z}) feet ${r.feetY} ground ${r.ground} maxFeet ${r.maxY} in ${r.t}s ${r.reached ? 'OK' : 'NOT REACHED'}`);
  return r;
}
async function look(heading, pitch) {
  await page.evaluate(({ heading, pitch }) => {
    const w = window.__walker;
    w.yaw = -heading * Math.PI / 180;
    w.pitch = pitch * Math.PI / 180;
    w.apply();
  }, { heading, pitch });
}
async function shot(name, wait = 400) {
  await page.waitForTimeout(wait);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  report.shots.push(file);
  log('shot', file);
}
const steps = () => page.evaluate(() => window.__stepLog.splice(0));

await shot('0-start-frame', 800);

// 1. sidewalk north to the crosswalk, then across the street
await walkTo(-26.4, -9);
report.checks.sidewalk = await steps();
await walkTo(-22.5, -10);
await walkTo(-18, -10);
await look(90, -4);
await shot('1-crossing-street');
await walkTo(-11, -10);
report.checks.road = await steps();

// 2. park and promenade to the seawall steps at z = -30
await walkTo(0, -22);
await walkTo(10.2, -30);
await look(90, -12);
await shot('2-seawall-steps');
await walkTo(14, -30);
const onSand = await page.evaluate(() => ({ feet: window.__walker.feetY, ground: window.__beach.groundAt(window.__walker.pos.x, window.__walker.pos.y) }));
report.checks.park = await steps();
// check the wall is solid away from the steps
await walkTo(14, -40);
const wallTry = await walkTo(10, -40, { maxT: 8 });
report.checks.wallBlocks = wallTry.x > 12.3;

// 3. through the dune-fence gap, to the foot of the tower stairs, up onto the deck
await walkTo(14, -30);
await walkTo(18, -30);
const st = await page.evaluate(() => window.__beach.surfaces);
const stairZ = (st.stair.z0 + st.stair.z1) / 2;
await walkTo(st.stair.x0 - 1.5, stairZ);
report.checks.sand = await steps();
await walkTo(st.deck.x0 + 1.2, stairZ);
const deck = await page.evaluate(() => ({ feet: window.__walker.feetY, base: window.__beach.surfaces.base, deckY: window.__beach.surfaces.deckY }));
report.checks.deck = { feetAboveSand: +(deck.feet - deck.base).toFixed(3), expected: +(deck.deckY - deck.base).toFixed(3) };
report.checks.stairs = await steps();
await look(95, -3);
await shot('3-tower-deck-ocean');
// railing stops a walk off the deck edge
const railTry = await walkTo(st.deck.x0 + 1.2, st.deck.z1 + 2, { maxT: 6 });
report.checks.railBlocks = railTry.z < st.deck.z1;

// 4. back down and to the water
await walkTo(st.deck.x0 + 0.4, stairZ);
await walkTo(st.stair.x0 - 1.0, stairZ);
report.checks.down = { feet: (await page.evaluate(() => window.__walker.feetY)), ground: (await page.evaluate(() => window.__beach.groundAt(window.__walker.pos.x, window.__walker.pos.y))) };
await walkTo(37, 14);   // round the tower and the parked ATV
await walkTo(80, 14);
await walkTo(91.9, 14);
// stand at the waterline until a swash washes over the feet
const swash = await page.evaluate(async () => {
  for (let i = 0; i < 160; i++) {
    const w = window.__walker, s = window.__beach.swashAt(w.pos.x, w.pos.y);
    if (s.covered && s.depth > 0.015) return { waited: i * 0.25, ...s };
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
});
report.checks.swashAtFeet = swash;
await look(110, -38);
await shot('4-waterline-feet', 150);
// wade in a few steps, then a little deeper (stops before 0.5 m)
await walkTo(93.5, 14.5);
await walkTo(96, 15);
report.checks.water = await steps();
await look(100, -30);
await shot('5-wading');
const deep = await walkTo(120, 15, { maxT: 20 });
report.checks.wadeLimit = { x: deep.x, depth: +(-1 - deep.ground).toFixed(3) };

// 5. traffic: cars on the drive, moving, with voices
const car = await page.evaluate(async () => {
  const T = window.__traffic;
  const a = T.state();
  await new Promise((r) => setTimeout(r, 1500));
  const b = T.state();
  const moved = b.filter((q) => { const p = a.find((o) => o.id === q.id); return p && !q.hidden && Math.abs(q.z - p.z) > 0.5; }).length;
  return { cars: b, moved, signal: T.signal, audio: window.__audio.stats() };
});
report.checks.car = car;
report.errors = errors;
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
const surf = (l) => [...new Set((l || []).map((s) => s.surface))].join(',');
log('surfaces: sidewalk', surf(report.checks.sidewalk), '| road', surf(report.checks.road), '| park', surf(report.checks.park),
  '| sand', surf(report.checks.sand), '| stairs', surf(report.checks.stairs), '| water', surf(report.checks.water));
log('deck', report.checks.deck, 'wallBlocks', report.checks.wallBlocks, 'railBlocks', report.checks.railBlocks, 'wadeLimit', report.checks.wadeLimit);
log('swash', JSON.stringify(report.checks.swashAtFeet), 'onSand', JSON.stringify(onSand));
log('car', JSON.stringify(car));
log('errors', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
