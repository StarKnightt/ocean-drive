// Close-ups of the Mixamo people in the running game (?autostart): a walker at ~10 m, a
// jogger, a roller skater, a bench sitter, a cafe guest, a traffic driver. The crowd (and the
// traffic) run for a moment, then freeze while the camera is placed relative to the subject.
// Usage: node tools/people-shots.mjs [label] [query]   -> shots/people-<label>/
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const label = process.argv[2] || 'latest';
const query = process.argv[3] || '';
const outDir = path.resolve('shots', 'people-' + label);
fs.mkdirSync(outDir, { recursive: true });
const W = 1024, H = 576;
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5173/?autostart' + (query ? '&' + query : ''));
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 180000 });

// frame agent #i of `kind` (or a predicate) from `dist` m at `bearing` deg off its facing
async function frame(name, pick, { dist = 10, bearing = 30, eyeUp = 0, pitch = null, run = 1500, lookY = 1.0 } = {}) {
  await page.evaluate(() => { window.__people.debug.freeze = false; });
  // put the camera near first so the subject is animated (LOD / culling use the camera)
  const ok = await page.evaluate(({ pick, dist, bearing, eyeUp, pitch, lookY, pre }) => {
    const A = window.__people.agents.filter((a) => !a.hidden && (a.kind === pick.kind) && (pick.seat == null || !!a.seat?.[pick.seat]) && (!pick.beach || a.path?.half === 3))[pick.i ?? 0];
    if (!A) return null;
    const h = A.heading + bearing * Math.PI / 180;
    const x = A.x + Math.sin(h) * dist, z = A.z + Math.cos(h) * dist;
    const dx = A.x - x, dz = A.z - z;
    const heading = Math.atan2(dx, -dz) * 180 / Math.PI;
    const g = window.__groundHeight(A.x, A.z), gc = window.__groundHeight(x, z);
    const ty = (A.seat ? A.baseY + 0.5 : g + lookY);
    const p = pitch ?? Math.atan2(ty - (gc + 1.7 + eyeUp), dist) * 180 / Math.PI;
    if (pre) return { x, z, heading, p };
    window.__walker.set(x, gc + 1.7 + eyeUp, z, heading, p);
    return { name: A.name, x: +A.x.toFixed(1), z: +A.z.toFixed(1), speed: +A.speed.toFixed(2), level: A.P.level };
  }, { pick, dist, bearing, eyeUp, pitch, lookY, pre: false });
  if (!ok) { console.log('no subject for', name); return; }
  await page.waitForTimeout(run);
  await page.evaluate(() => { window.__people.debug.freeze = true; });
  // re-frame on the frozen subject
  const info = await page.evaluate(({ pick, dist, bearing, eyeUp, pitch, lookY }) => {
    const A = window.__people.agents.filter((a) => !a.hidden && (a.kind === pick.kind) && (pick.seat == null || !!a.seat?.[pick.seat]) && (!pick.beach || a.path?.half === 3))[pick.i ?? 0];
    const h = A.heading + bearing * Math.PI / 180;
    const x = A.x + Math.sin(h) * dist, z = A.z + Math.cos(h) * dist;
    const heading = Math.atan2(A.x - x, -(A.z - z)) * 180 / Math.PI;
    const gc = window.__groundHeight(x, z);
    const ty = (A.seat ? A.baseY + 0.5 : window.__groundHeight(A.x, A.z) + lookY);
    const p = pitch ?? Math.atan2(ty - (gc + 1.7 + eyeUp), dist) * 180 / Math.PI;
    window.__walker.set(x, gc + 1.7 + eyeUp, z, heading, p);
    return { name: A.name, at: [+A.x.toFixed(1), +A.z.toFixed(1)], speed: +A.speed.toFixed(2), state: A.state, clip: A.loco?.getClip().name ?? A.idle?.getClip().name };
  }, { pick, dist, bearing, eyeUp, pitch, lookY });
  await page.waitForTimeout(700);
  const f = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: f });
  console.log('saved', f, JSON.stringify(info));
}

await frame('beach-walker', { kind: 'walk', beach: true }, { dist: 9, bearing: 60 });
await frame('walker-10m', { kind: 'walk', i: 0 }, { dist: 10, bearing: 25 });
await frame('walker-4m', { kind: 'walk', i: 0 }, { dist: 4, bearing: 35, run: 400 });
await frame('jogger', { kind: 'jog', i: 0 }, { dist: 6, bearing: 40 });
// the same frame without the jogger: anything left over the head is the scene behind
await page.evaluate(() => { const A = window.__people.agents.filter((a) => !a.hidden && a.kind === 'jog')[0]; A.P.setVisible(false); });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(outDir, 'jogger-hidden.png') });
await page.evaluate(() => { const A = window.__people.agents.filter((a) => !a.hidden && a.kind === 'jog')[0]; A.P.setVisible(true); });
await frame('skater', { kind: 'skate', i: 0 }, { dist: 6, bearing: 50 });
await frame('skater-side', { kind: 'skate', i: 0 }, { dist: 5, bearing: 90, run: 600 });
await frame('bench', { kind: 'sit', seat: 'bench' }, { dist: 3.2, bearing: 20, run: 500 });
await frame('cafe', { kind: 'sit', seat: 'cafe' }, { dist: 3.2, bearing: 75, run: 500 });
// (from the terrace side, over the table: hips on the chair, hands at the table)
await frame('cafe-b', { kind: 'sit', seat: 'cafe' }, { dist: 2.4, bearing: -35, eyeUp: 0.55, run: 500 });
await frame('stand', { kind: 'stand', i: 0 }, { dist: 4, bearing: 10, run: 500 });

// a traffic driver: the nearest car to the camera, frozen, seen through the side window
await page.evaluate(() => { window.__people.debug.freeze = false; window.__walker.set(-12.5, 1.85, 0, 270, 0); });
await page.waitForTimeout(2500);
const car = await page.evaluate(() => {
  const T = window.__traffic;
  T.debug.freeze = true;
  const cam = window.__walker.pos;
  const cs = T.cars.filter((c) => !c.hidden && Math.abs(c.z) < 200).sort((a, b) => Math.hypot(a.x - cam.x, a.z - cam.y) + (a.classic ? 0 : 300) - Math.hypot(b.x - cam.x, b.z - cam.y) - (b.classic ? 0 : 300));
  const c = cs[0];
  if (!c) return null;
  // the driver sits left of centre (a southbound car's left is +x): stand off that side,
  // a little ahead, looking in through the side window
  const left = c.dir > 0 ? 1 : -1;
  const x = c.x + left * 2.7, z = c.z + c.dir * 2.2;
  const tx = c.x + left * 0.35, tz = c.z - c.dir * 0.3;
  const heading = Math.atan2(tx - x, -(tz - z)) * 180 / Math.PI;
  window.__walker.set(x, 0.1 + 1.5, z, heading, -7);
  return { model: c.model, classic: c.classic, dir: c.dir, x: c.x, z: c.z };
});
console.log('car', JSON.stringify(car));
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(outDir, 'traffic-driver.png') });
console.log('saved', path.join(outDir, 'traffic-driver.png'));
console.log(JSON.stringify(await page.evaluate(() => ({ crowd: window.__crowdStats?.(), info: window.__renderInfo() }))));
if (errors.length) console.log('ERRORS\n' + errors.slice(0, 10).join('\n'));
await browser.close();
