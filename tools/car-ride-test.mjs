// Node smoke test of the convertible ride flow in vehicles/index.js (DOM stubbed; no
// rendering): approach -> E -> starter -> drive -> steer -> stop -> E out on the sidewalk.
// Usage: node tools/car-ride-test.mjs
const ctx2d = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
const el = () => ({
  style: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  appendChild() {}, set innerHTML(v) {}, set textContent(v) {}, getContext: () => ctx2d, width: 0, height: 0,
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

// a walker stand-in with the fields vehicles/index.js uses
const walker = {
  active: true, keys: new Set(), stick: null, jumpReq: false, yaw: 0, pitch: 0, airY: 0, feetY: CURB_HEIGHT,
  pos: new THREE.Vector2(), vel: new THREE.Vector2(),
  world: { bounds: { x0: -27.8, x1: 110, z0: -340, z1: 340 }, heightAt: (x, z) => groundHeight(x, z) },
  blocked: () => false,
  set(x, y, z, h, p) { this.pos.set(x, z); this.feetY = y - 1.7; this.yaw = -h * Math.PI / 180; this.pitch = p * Math.PI / 180; },
};
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 2000);
// a stand-in for the hero model: the eye rides at the anchor offset in the car frame
const root = new THREE.Group(), eye = new THREE.Object3D();
eye.position.set(0.42, 1.18, -0.38);
root.add(eye);
let applied = 0;
const car = {
  pose: { x: CAR.x, z: CAR.z, yaw: Math.PI },
  apply: (v) => { applied++; root.position.set(v.x, v.baseT, v.z); root.rotation.set(-v.pitchT, v.yaw + Math.PI, -v.rollT, 'YXZ'); },
  eye: (out) => eye.getWorldPosition(out), root,
};
const mover = new THREE.Group();
mover.visible = false;
const audioStates = [];
const V = createVehicles(new THREE.Scene(), {
  walker, camera, beach: { groundAt: groundHeight, waterDepthAt: () => 0, swashAt: () => ({ covered: false }) },
  staticBoxes: [], staticCircles: [], audio: { vehicle: (s) => audioStates.push(s) }, renderer: { getDrawingBufferSize: (v) => v.set(1024, 576) },
  car, movers: [mover],
});
const cv = V.list.find((e) => e.kind === 'car').v;
check('car entry created, parked at the hero spot', cv.parked && Math.abs(cv.x - CAR.x) < 1e-6 && applied === 0, { x: cv.x, z: cv.z, applied });
// stand on the sidewalk west of the car, looking east at it
walker.pos.set(CAR.x - 2.4, CAR.z); walker.yaw = -Math.PI / 2;
camera.position.set(walker.pos.x, 1.85, walker.pos.y); camera.rotation.set(0, walker.yaw, 0);
V.update(1 / 60);
check('near = car from the sidewalk', V.near === 'car', { near: V.near });
listeners.keydown.forEach((fn) => fn({ code: 'KeyE', repeat: false }));
check('E mounts the car', V.riding && V.current === cv, { riding: V.riding });
let caught = null;
for (let i = 0; i < 120; i++) { V.update(1 / 60); if (caught === null && cv.engineOn) caught = i / 60; }
check('the engine catches after the starter (~1 s)', caught > 0.9 && caught < 1.2 && cv.rpm > 500, { caught, rpm: Math.round(cv.rpm) });
check('audio got car states (cranking, then running)', audioStates.some((s) => s.kind === 'car' && !s.engineOn) && audioStates.at(-1).engineOn, { n: audioStates.length });
const eyeY = camera.position.y;
check('camera at the driver eye (~1.18 m above the road)', eyeY > 1.08 && eyeY < 1.3, { y: +eyeY.toFixed(3) });
// drive: W for 6 s
const r = V.simulate(['KeyW'], 6);
check('W drives it down the west lane (south)', cv.z > CAR.z + 20 && r.maxSpeed > 8, { z: +cv.z.toFixed(1), max: r.maxSpeed, gear: cv.gear });
V.place(-19.75, cv.z, Math.PI);
V.simulate(['KeyW', 'KeyD'], 1.5);
check('D steers right (yaw falls, heading west of south)', cv.steer > 0.05, { steer: +cv.steer.toFixed(3), yaw: +cv.yaw.toFixed(3) });
// look limits
walker.yaw = cv.yaw + 3; walker.pitch = 1.2;
V.update(1 / 60);
const rel = Math.atan2(Math.sin(walker.yaw - cv.yaw), Math.cos(walker.yaw - cv.yaw));
check('head turn and pitch limited in the driver seat', Math.abs(rel) <= 1.86 && walker.pitch <= 0.5, { rel: +rel.toFixed(2), pitch: walker.pitch });
// handbrake (Space held)
V.place(-19.75, cv.z, Math.PI);
V.simulate(['KeyW'], 3);
const v0 = cv.lon;
V.simulate(['Space'], 1);
check('Space handbrake slows it', cv.lon < v0 - 3, { from: +v0.toFixed(2), to: +cv.lon.toFixed(2) });
// park at the curb and get out: sidewalk side
V.place(CAR.x, CAR.z, Math.PI);
V.update(1 / 60);
listeners.keydown.forEach((fn) => fn({ code: 'KeyE', repeat: false }));
check('E gets out on the sidewalk side, engine off, car stays', !V.riding && walker.pos.x < -24 && !cv.engineOn && Math.abs(cv.z - CAR.z) < 0.2,
  { walker: [+walker.pos.x.toFixed(2), +walker.pos.y.toFixed(2)], car: [cv.x, +cv.z.toFixed(2)] });
check('audio told to switch the engine off', audioStates.at(-1).kind === null, audioStates.at(-1));
// the traffic car as a moving collider
V.place(-19.75, 0, Math.PI, 'car');
walker.pos.set(-21, -2.9); walker.yaw = 0; walker.feetY = 0.05;
V.update(1 / 60);
V.mount('car');
for (let i = 0; i < 80; i++) V.update(1 / 60);
mover.visible = true; mover.position.set(-19.75, 0, 16); mover.rotation.y = 0;
V.simulate(['KeyW'], 5);
check('the moving traffic car blocks it', cv.z + 1.95 + 0.93 < 16 - 1.9 - 0.95 + 0.1, { z: +cv.z.toFixed(2) });
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
