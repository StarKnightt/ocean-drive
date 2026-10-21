// The "demo day" mission, end to end: the start ring -> intro card -> the clock -> a blocker
// on foot (-10 s) and from a car -> the server room -> E at the red button (won) -> Enter
// (run it again) -> the clock runs out (lost) -> Enter (retry) -> E (close).
// Usage: node tools/mission-test.mjs   (dev server on :5173). Screenshots in shots/mission-test/.
// Headless; CHROMIUM=/path/to/chrome to pick the browser. Exits 1 on a failed check.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.URL ?? 'http://localhost:5173/';
const outDir = path.resolve('shots', 'mission-test');
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
// (no dynamic resolution: a resize clears the canvas, and a slow software GPU is always resizing)
await page.goto(url + '?autostart&dynres=0&gpuguard=0&quality=' + (process.env.Q ?? 'low'));
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 600000 });
await page.waitForTimeout(15000);   // the start-up resolution ramp

const ev = (f, a) => page.evaluate(f, a);
const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const shot = async (name) => { await frames(4); await page.screenshot({ path: path.join(outDir, `${name}.png`) }); };
const state = () => ev(() => ({ s: __mission.state, left: +__mission.timeLeft.toFixed(1) }));
const fails = [];
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${info}`); if (!ok) fails.push(name); };
// simulated walk (Shift held) to a point
const walkTo = (x, z, maxT = 60) => ev(({ x, z, maxT }) => {
  const w = __walker; let t = 0;
  while (t < maxT && Math.hypot(x - w.pos.x, z - w.pos.y) > 0.3) { w.yaw = -Math.atan2(x - w.pos.x, -(z - w.pos.y)); w.simulate(['KeyW', 'ShiftLeft'], 0.1); t += 0.1; }
  w.simulate([], 0.3);
}, { x, z, maxT });
const look = (x, z, pitch = 0) => ev(({ x, z, pitch }) => { const w = __walker; w.yaw = -Math.atan2(x - w.pos.x, -(z - w.pos.y)); w.pitch = pitch * Math.PI / 180; w.apply(); }, { x, z, pitch });
const m = await ev(() => ({ start: __mission.start, door: __mission.door, button: __mission.button }));

await shot('01-spawn-marker');
check('idle at load', (await state()).s === 'idle');
await walkTo(m.start.x, m.start.z + 0.2);
await frames(3);
check('the ring starts the intro', (await state()).s === 'intro');
await shot('02-intro');
await page.keyboard.press('Enter');
await frames(3);
check('enter starts the clock', (await state()).s === 'run');
await look(m.door.x, m.door.z, -2);
await shot('03-running');

// a blocker on foot
await ev(() => { const b = __mission.blockers[0]; __walker.teleport(b.x, b.z + 5, 0, 0); });
await frames(6);
const before = (await state()).left;
const b0 = await ev(() => ({ x: __mission.blockers[0].x, z: __mission.blockers[0].z }));
await walkTo(b0.x, b0.z + 0.4, 4);
await frames(3);
const after = (await state()).left;
check('a blocker costs 10 s', before - after > 9 && before - after < 12, `${before} -> ${after}`);
check('and says their line', await ev(() => __mission.blockers[0].bubble?.textContent === __mission.blockers[0].line));
await ev(() => { const b = __mission.blockers[0]; __walker.set(b.x + 0.3, 1.85, b.z - 3.2, 175, -6); });
await page.waitForTimeout(1500);
await shot('04-blocker-hit');
await ev(() => __walker.set(-12.5, 1.85, -40, 358, 8));
await page.waitForTimeout(3000);
await shot('05-beacon');
// a blocker from a car
const car = await ev(async () => {
  __vehicles.mount('car');
  const b = __mission.blockers[1];
  b.x = -15.6;
  __vehicles.place(-15.8, b.z + 1.0, 0);
  const t0 = __mission.timeLeft;
  await new Promise((r) => setTimeout(r, 4000));
  const r = { hit: b.hit, lost: +(t0 - __mission.timeLeft).toFixed(1) };
  __vehicles.dismount();
  return r;
});
check('a blocker hit from a car', car.hit && car.lost > 9, JSON.stringify(car));

// the server room
await ev(({ x, z }) => __walker.teleport(x - 4, z, 90, 0), m.door);
await walkTo(m.door.x, m.door.z);
await look(m.button.x, m.button.z, -4);
await shot('06-server-room');
await walkTo(m.button.x - 1.0, m.button.z);
await look(m.button.x, m.button.z, -18);
await frames(3);
check('the reboot prompt at the button', await ev(() => document.getElementById('mission-prompt').classList.contains('show')));
await shot('07-button');
await page.keyboard.press('KeyE');
await frames(3);
check('E reboots: won', (await state()).s === 'won');
check('E did not open a car', !(await ev(() => __vehicles.riding)));
await shot('08-won');

// run it again, let the clock run out
await page.keyboard.press('Enter');
await frames(3);
const again = await state();
check('enter runs it again from the ring', again.s === 'run' && again.left > 178);
await ev(() => __mission.setTime(0.3));
await frames(10);
check('the clock runs out: lost', (await state()).s === 'lost');
await shot('09-lost');
await page.keyboard.press('Enter');
await frames(3);
check('enter retries', (await state()).s === 'run');
await ev(() => __mission.setTime(0.2));
await frames(10);
await page.keyboard.press('KeyE');
await frames(3);
check('E closes the card', (await state()).s === 'idle');

check('no page errors', errors.length === 0, errors.join(' | '));
console.log(`screenshots in ${outDir}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
