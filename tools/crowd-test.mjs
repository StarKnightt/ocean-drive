// Crowd behaviour test (?autostart, real time): people step round / wait for the player
// and resume, never walk through the player, keep apart, the crosser waits at the curb and
// the cars stop for it, the clips play at foot speed; screenshots in shots/crowd-test/.
// Usage: node tools/crowd-test.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('shots', 'crowd-test');
fs.mkdirSync(outDir, { recursive: true });
const W = 1024, H = 576;
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5173/?autostart');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 180000 });
const results = [];
const check = (name, ok, info) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(info)}`); };

// stand the player `ahead` m in front of agent `name` on its path (at its lateral offset),
// looking at it; then record for `secs`
async function block(name, ahead, secs, { moveAwayAt = null, shotAt = null, file = null } = {}) {
  await page.evaluate(({ name, ahead }) => {
    const A = window.__people.people[name];
    const q = {};
    A.path.at(A.s + A.dir * ahead, q);
    const nx = q.dx * A.dir, nz = q.dz * A.dir;
    const x = q.x - nz * A.lat, z = q.z + nx * A.lat;
    const h = Math.atan2(A.x - x, -(A.z - z)) * 180 / Math.PI;
    window.__walker.teleport(x, z, h, -4);
    window.__blockAt = { x, z };
  }, { name, ahead });
  const trace = [];
  const t0 = Date.now();
  let moved = false, shot = false;
  while (Date.now() - t0 < secs * 1000) {
    const t = (Date.now() - t0) / 1000;
    if (moveAwayAt != null && t > moveAwayAt && !moved) {
      moved = true;
      await page.evaluate(() => { const b = window.__blockAt; window.__walker.teleport(b.x - 6, b.z, 90, -4); });
    }
    if (shotAt != null && t > shotAt && !shot) { shot = true; await page.screenshot({ path: path.join(outDir, file) }); }
    trace.push(await page.evaluate((name) => {
      const A = window.__people.people[name], w = window.__walker.pos;
      const o = A.blockBy; return { t: performance.now() / 1000, d: Math.hypot(A.x - w.x, A.z - w.y), v: A.speed, lat: A.lat, s: A.s, dir: A.dir, state: A.state, x: +A.x.toFixed(2), z: +A.z.toFixed(2), by: o ? (o.agent ? o.agent.name : o.player ? 'player' : o.vehicle ? 'vehicle' : 'static ' + o.x.toFixed(2) + ',' + o.z.toFixed(2) + ' r' + o.r.toFixed(2)) : null };
    }, name));
    await page.waitForTimeout(100);
  }
  return trace;
}

// 1. promenade stroller meets the player standing in its way: slows, steps round, never
// closer than ~0.6 m, keeps going
{
  const name = await page.evaluate(() => window.__people.agents.find((a) => a.kind === 'walk' && a.path?.half > 1.5 && a.path.half < 2.5).name);
  const tr = await block(name, 7, 9, { shotAt: 4.2, file: '1-sidestep.png' });
  const minD = Math.min(...tr.map((p) => p.d));
  const minV = Math.min(...tr.map((p) => p.v));
  const maxLat = Math.max(...tr.map((p) => Math.abs(p.lat - tr[0].lat)));
  const passed = tr[tr.length - 1].d > 2 && tr.some((p) => p.d < 1.6);
  check('promenade walker steps round the player (min distance >= 0.55 m, sidestep, passes)', minD >= 0.55 && maxLat > 0.4 && passed, { name, minD: +minD.toFixed(2), minV: +minV.toFixed(2), sidestep: +maxLat.toFixed(2), end: +tr[tr.length - 1].d.toFixed(2) });
}
// 2. hotel-sidewalk walker (the planned lane), the player standing in its way: waits
// (no walking through), then goes on once the player steps away
{
  const name = await page.evaluate(() => window.__people.agents.find((a) => a.kind === 'walk' && a.path?.half === 0.3).name);
  const tr = await block(name, 5, 11, { moveAwayAt: 5, shotAt: 3.5, file: '2-waits.png' });
  const before = tr.filter((p, i) => i < tr.length * 0.45);
  const after = tr.slice(-12);
  const minD = Math.min(...before.map((p) => p.d));
  const resumed = after.some((p) => p.v > 0.7);
  if (!resumed) console.log('  (trace tail)', JSON.stringify(after.filter((p, i) => i % 3 === 0).map((p) => [p.x, p.z, +p.v.toFixed(2), p.by])));
  check('sidewalk walker never walks through the player and resumes when the way clears', minD >= 0.5 && resumed, { name, minD: +minD.toFixed(2), vAfter: +Math.max(...after.map((p) => p.v)).toFixed(2), minVBefore: +Math.min(...before.map((p) => p.v)).toFixed(2), turned: tr.some((p) => p.dir !== tr[0].dir) });
}
// 3. skater overtakes / passes the player on the promenade
{
  const name = await page.evaluate(() => window.__people.agents.find((a) => a.kind === 'skate').name);
  const tr = await block(name, 16, 8, { shotAt: 3.2, file: '3-skater.png' });
  const minD = Math.min(...tr.map((p) => p.d));
  check('skater glides round the player', minD >= 0.55 && tr[tr.length - 1].d > 3, { name, minD: +minD.toFixed(2), minV: +Math.min(...tr.map((p) => p.v)).toFixed(2) });
}
// 4. separation: nobody inside anybody else over 6 s
{
  await page.evaluate(() => window.__walker.teleport(-3, 20, 180, 0));
  let worst = Infinity, pair = null;
  for (let i = 0; i < 30; i++) {
    const r = await page.evaluate(() => {
      const A = window.__people.agents.filter((a) => !a.hidden && a.path);
      let w = Infinity, p = null;
      for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) { const d = Math.hypot(A[i].x - A[j].x, A[i].z - A[j].z); if (d < w) { w = d; p = [A[i].name, A[j].name]; } }
      return { w, p };
    });
    if (r.w < worst) { worst = r.w; pair = r.p; }
    await page.waitForTimeout(200);
  }
  check('movers keep apart (closest pair >= 0.45 m)', worst >= 0.45, { closest: +worst.toFixed(2), pair });
}
// 5. the crosser: waits at the curb when a car is close, the cars stop for it on the crosswalk
{
  const name = await page.evaluate(() => window.__people.agents.find((a) => a.path?.crossings?.length).name);
  await page.evaluate((name) => { const A = window.__people.people[name]; window.__walker.teleport(-8, A.z < -40 ? -60 : -4, 270, 0); }, name);
  const states = new Set(); let stoppedFor = 0, onRoad = 0, crossed = 0, hit = false, last = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 70000) {
    const r = await page.evaluate((name) => {
      const A = window.__people.people[name];
      const cars = window.__traffic.cars.filter((c) => !c.hidden);
      const on = A.x > -24 && A.x < -14.5;
      // a car body overlapping the crosser
      const hit = cars.some((c) => Math.abs(c.x - A.x) < 1.0 && Math.abs(c.z - A.z) < c.len / 2);
      return { state: A.state, on, x: A.x, z: A.z, stop: cars.filter((c) => c.reason === 'crosswalk' && c.v < 0.3).length, hit };
    }, name);
    states.add(r.state);
    if (r.on) onRoad++;
    if (r.stop) stoppedFor++;
    if (r.hit) hit = true;
    if (last && last.on && !r.on) crossed++;
    last = r;
    if (crossed >= 2) break;
    await page.waitForTimeout(200);
  }
  check('crosser crosses Ocean Drive, no car drives through it', crossed >= 1 && !hit, { name, crossed, states: [...states], samplesOnRoad: onRoad, samplesCarsStopped: stoppedFor });
}
// 6. foot speed: walkers' playback rate follows the ground speed (clip speed x rate ~ v);
// drawn walkers only (off-screen ones aren't animated, their rate is stale until seen)
{
  await page.evaluate(() => { const A = window.__people.agents.find((a) => a.kind === 'walk' && a.path?.half > 1.5); const x = A.x - 6, z = A.z; window.__walker.teleport(x, z, Math.atan2(A.x - x, -(A.z - z)) * 180 / Math.PI, -4); });
  await page.waitForTimeout(2000);
  const r = await page.evaluate(() => window.__people.agents.filter((a) => a.kind === 'walk' && a.visible && a.speed > 0.9).slice(0, 6).map((a) => ({ n: a.name, v: +a.speed.toFixed(2), foot: +(a.clipSpeed * a.loco.timeScale).toFixed(2), clip: a.loco.getClip().name })));
  check('walk playback matches ground speed within 10 %', r.length > 0 && r.every((x) => Math.abs(x.foot - x.v) / x.v < 0.1), r);
}
console.log(JSON.stringify(await page.evaluate(() => window.__crowdStats())));
if (errors.length) console.log('ERRORS\n' + errors.slice(0, 10).join('\n'));
console.log(results.filter((r) => r.ok).length + '/' + results.length + ' passed');
await browser.close();
