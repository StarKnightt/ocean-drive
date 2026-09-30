// Node test of the brake / reverse input path in vehicles/index.js (DOM stubbed; no
// rendering): S brakes and then reverses (R to the audio), W drives out of R, the touch stick
// pulled back does the same, the touch Brake stops without reversing, a failed get-out
// ("No room") hands the controls back, and lost controls (pointer lock gone) brake the car.
// Usage: node tools/brake-input-test.mjs
const ctx2d = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
const el = () => ({
  style: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  appendChild() {}, set innerHTML(v) {}, set textContent(v) {}, getContext: () => ctx2d, width: 0, height: 0,
  querySelector: () => el(), setAttribute() {},
});
const listeners = {};
globalThis.document = { createElement: el, head: el(), body: el(), documentElement: el() };
globalThis.addEventListener = (t, fn) => { (listeners[t] ??= []).push(fn); };
globalThis.window = globalThis;
globalThis.location = { search: '' };
globalThis.matchMedia = () => ({ matches: false });
globalThis.devicePixelRatio = 1;
globalThis.screen = { width: 1920, height: 1080 };
const THREE = await import('three');
const { createVehicles } = await import('../src/vehicles/index.js');
const { groundHeight, CAR, CURB_HEIGHT } = await import('../src/world/layout.js');

const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(info)}`); };
const kmh = (ms) => +(ms * 3.6).toFixed(1);

let blocked = false;
const walker = {
  active: true, keys: new Set(), stick: null, jumpReq: false, brakeHeld: false, yaw: 0, pitch: 0, airY: 0, feetY: CURB_HEIGHT,
  pos: new THREE.Vector2(), vel: new THREE.Vector2(),
  world: { bounds: { x0: -27.8, x1: 110, z0: -340, z1: 340 }, heightAt: (x, z) => groundHeight(x, z) },
  blocked: () => blocked,
  set(x, y, z, h, p) { this.pos.set(x, z); this.feetY = y - 1.7; this.yaw = -h * Math.PI / 180; this.pitch = p * Math.PI / 180; },
};
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 2000);
const root = new THREE.Group(), eye = new THREE.Object3D();
root.add(eye);
const car = {
  pose: { x: CAR.x, z: CAR.z, yaw: Math.PI },
  apply: (v) => { root.position.set(v.x, v.baseT, v.z); root.rotation.set(0, v.yaw + Math.PI, 0); },
  eye: (out) => eye.getWorldPosition(out), root,
};
const audio = [];
const V = createVehicles(new THREE.Scene(), {
  walker, camera, beach: { groundAt: groundHeight, waterDepthAt: () => 0, swashAt: () => ({ covered: false }) },
  staticBoxes: [], staticCircles: [], audio: { vehicle: (s) => audio.push(s) }, renderer: { getDrawingBufferSize: (v) => v.set(1024, 576) },
  car, movers: [],
});
const cv = V.list.find((e) => e.kind === 'car').v;
V.place(-19.75, 0, Math.PI, 'car');
walker.pos.set(-21, -2.9); walker.feetY = 0.05;
V.update(1 / 60);
V.mount('car');
for (let i = 0; i < 90; i++) V.update(1 / 60);
const start = () => { V.place(-19.75, -150, Math.PI); V.simulate(['KeyW'], 7); return cv.lon; };
const press = (code) => listeners.keydown.forEach((fn) => fn({ code, repeat: false }));

// keyboard: S brakes, then R
{
  const v0 = start();
  const z0 = cv.z;
  const r = V.simulate(['KeyS'], 6);
  const stopAt = r.log.find((p) => p.v <= 0.05);
  const dist = Math.abs((stopAt?.z ?? cv.z) - z0);
  check('S brakes from speed', v0 > 10 && stopAt && dist < v0 * v0 / (2 * 6), { from: kmh(v0), dist: +dist.toFixed(1), stopT: stopAt?.t });
  const last = audio.at(-1);
  check('holding S backs up in R (~20 km/h), audio told gear R with the throttle on', cv.reverse && kmh(-cv.lon) > 17 && last.gear === -1 && last.throttle > 0.9 && last.braking === 0, { kmh: kmh(cv.lon), gear: last.gear, throttle: last.throttle });
  V.simulate(['KeyW'], 3);
  check('W brakes out of R and drives forward', !cv.reverse && cv.lon > 3 && audio.at(-1).gear >= 1, { kmh: kmh(cv.lon), gear: audio.at(-1).gear });
}
// touch: the stick pulled back
{
  start();
  walker.stick = { x: 0, y: -1 };
  V.simulate([], 7);
  check('touch stick pulled back: brakes, then reverses', cv.reverse && kmh(-cv.lon) > 17, { kmh: kmh(cv.lon) });
  walker.stick = { x: 0, y: 1 };
  V.simulate([], 3);
  check('touch stick pushed forward again: drives out of R', !cv.reverse && cv.lon > 3, { kmh: kmh(cv.lon) });
  walker.stick = null;
}
// touch Brake button held: footbrake + handbrake, never R
{
  const v0 = start();
  walker.brakeHeld = true;
  const r = V.simulate([], 4);
  walker.brakeHeld = false;
  const stopAt = r.log.find((p) => p.v <= 0.05);
  check('touch Brake held stops the car firmly and never reverses', stopAt && stopAt.t < v0 / 7 + 0.5 && cv.lon > -0.05, { from: kmh(v0), stopT: stopAt?.t, lon: +cv.lon.toFixed(3) });
}
// E at speed with no room to get out: once stopped the controls come back
{
  start();
  blocked = true;
  press('KeyE');
  V.simulate([], 5);
  blocked = false;
  const stillIn = V.riding;
  V.simulate(['KeyS'], 4);
  check('failed get-out (no room) hands the controls back: S reverses', stillIn && cv.reverse && kmh(-cv.lon) > 12, { riding: stillIn, kmh: kmh(cv.lon) });
  start();
  press('KeyE');
  press('KeyE');
  V.simulate(['KeyW'], 2);
  check('E pressed again while stopping cancels the get-out', V.riding && cv.lon > 4, { kmh: kmh(cv.lon) });
}
// lost controls (pointer lock released: walker inactive): the car is braked, not left rolling
{
  const v0 = start();
  walker.active = false;
  let t = 0;
  for (; t < 5 && cv.lon > 0.05; t += 1 / 60) V.update(1 / 60);
  walker.active = true;
  check('controls lost at speed: the car brakes to a stop', v0 > 10 && cv.lon <= 0.05 && t < v0 / 6 + 0.5, { from: kmh(v0), t: +t.toFixed(2) });
}
// a tab switch clears held keys
{
  walker.keys.add('KeyW');
  globalThis.document.hidden = true;
  listeners.visibilitychange?.forEach((fn) => fn());
  globalThis.document.hidden = false;
  check('a tab switch releases held keys', walker.keys.size === 0, {});
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
