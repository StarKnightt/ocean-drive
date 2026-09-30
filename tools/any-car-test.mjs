// Node test of the drivable parked fleet in vehicles/index.js (DOM stubbed, no rendering):
// walk to a parked sedan's driver door -> "E enter" -> its batched instance and spot
// collider are switched off -> the starter -> drive -> get out anywhere -> the car stays
// (solid to the walker) and the spot stays free; the chase camera sits behind the car;
// recovery puts a car back on the road; at most six live cars (the oldest out of sight goes
// back to its spot). Usage: node tools/any-car-test.mjs
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
const { OPEN_SPECS } = await import('../src/vehicles/specs.js');

const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(info)}`); };
const key = (code) => listeners.keydown.forEach((fn) => fn({ code, repeat: false }));

// a stand-in parked fleet: a sedan and an SUV at the west curb, each with its collider box
// (as cars-glb.js buildFleet), plus seven hatchbacks 65 m apart down the drive
const boxes = [];
const mkSpot = (kind, x, z, yaw = 0, i = 0) => {
  const L = OPEN_SPECS[kind].length;
  const col = { min: { x: x - 1, y: 0, z: z - L / 2 }, max: { x: x + 1, y: 1.5, z: z + L / 2 }, parked: i };
  boxes.push(col);
  return { kind, x, z, color: 0x8a1e1e, col, taken: false, index: i, pose: { x, z, yaw: yaw - Math.PI } };
};
const cars = [mkSpot('sedan', CAR.x, 30, 0, 0), mkSpot('suv', CAR.x, 40, 0, 1)];
for (let k = 0; k < 7; k++) cars.push(mkSpot('hatch', CAR.x, -150 - k * 65, 0, 2 + k));
let takes = 0, releases = 0;
const fleet = {
  cars,
  take(c) { takes++; c.taken = true; c.col.disabled = true; },
  release(c) { releases++; c.taken = false; c.col.disabled = false; },
};
let made = 0, disposed = 0;
const kit = {
  seatZ: { sedan: 0.35, suv: 0.4, hatch: 0.3 },
  makeDrivable(kind) {
    made++;
    const root = new THREE.Group(), eye = new THREE.Object3D();
    eye.position.set(0.42, 1.05, 0.3);
    root.add(eye);
    const rig = { chase: false, pelvis: new THREE.Object3D() };
    return {
      kind, root, rig, applied: 0,
      apply(v) { this.applied++; root.position.set(v.x, v.bodyY, v.z); root.rotation.set(-v.pitch, v.yaw + Math.PI, -v.roll, 'YXZ'); root.updateMatrixWorld(true); },
      eye: (out) => eye.getWorldPosition(out),
      eyeQuat: (out) => root.getWorldQuaternion(out).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)),
      lod() {}, attachDriver() { return () => {}; }, dispose() { disposed++; },
    };
  },
};
let seated = 0;
const walker = {
  active: true, keys: new Set(), stick: null, jumpReq: false, yaw: 0, pitch: 0, airY: 0, feetY: CURB_HEIGHT,
  pos: new THREE.Vector2(), vel: new THREE.Vector2(),
  world: { bounds: { x0: -27.8, x1: 110, z0: -340, z1: 340 }, heightAt: (x, z) => groundHeight(x, z), circles: [] },
  blocked(x, z) {
    for (const c of this.world.circles) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + 0.3) ** 2) return true;
    return false;
  },
  set(x, y, z, h, p) { this.pos.set(x, z); this.feetY = y - 1.7; this.yaw = -h * Math.PI / 180; this.pitch = p * Math.PI / 180; },
};
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 2000);
const audioStates = [];
const V = createVehicles(new THREE.Scene(), {
  walker, camera, beach: { groundAt: groundHeight, waterDepthAt: () => 0, swashAt: () => ({ covered: false }) },
  staticBoxes: boxes, staticCircles: [], audio: { vehicle: (s) => audioStates.push(s) }, renderer: { getDrawingBufferSize: (v) => v.set(1024, 576) },
  fleet, kit, seatPlayer: () => { seated++; return () => {}; },
});
const look = (x, z) => { walker.yaw = -Math.atan2(x - walker.pos.x, -(z - walker.pos.y)); camera.position.set(walker.pos.x, 1.85, walker.pos.y); camera.rotation.set(0, walker.yaw, 0, 'YXZ'); camera.updateMatrixWorld(); };

// 1. at the sedan's driver door (the road side of a car parked at the west curb, facing south)
const sedan = cars[0];
const [dDoor, pDoor] = V.doorsOf(sedan);
check('the driver door is on the car\'s left (road side), the passenger door on the sidewalk side', dDoor.side === 'driver' && dDoor.x > sedan.x && pDoor.x < sedan.x, { driver: [+dDoor.x.toFixed(2), +dDoor.z.toFixed(2)], passenger: [+pDoor.x.toFixed(2), +pDoor.z.toFixed(2)] });
walker.pos.set(dDoor.x + 0.3, dDoor.z); look(sedan.x, sedan.z);
V.update(1 / 60);
check('near: "E enter" at the driver door', V.near === 'car' && V.nearDoor === 'driver', { near: V.near, door: V.nearDoor });
walker.pos.set(dDoor.x + 3, dDoor.z); look(sedan.x, sedan.z);
V.update(1 / 60);
check('no prompt 3 m from the door', V.near === null, { near: V.near });
walker.pos.set(dDoor.x + 0.3, dDoor.z); look(sedan.x, sedan.z);
V.update(1 / 60);
key('KeyF');
const e = V.currentEntry;
check('F (as E) gets in: a live sedan, the spot taken, its collider off, the player seated', V.riding && e?.body === 'sedan' && e.origin === 'parked' && sedan.taken && sedan.col.disabled && made === 1 && seated === 1, { riding: V.riding, body: e?.body, taken: sedan.taken, made, seated });
const blockedOld = V.world.grid.query(sedan.col.min.x, sedan.col.min.z, sedan.col.max.x, sedan.col.max.z, () => true);
check('the spot\'s collider no longer blocks (grid)', !blockedOld, {});
let caught = null;
for (let i = 0; i < 90; i++) { V.update(1 / 60); if (caught === null && e.v.engineOn) caught = i / 60; }
check('the modern starter catches in ~0.45 s', caught > 0.35 && caught < 0.6, { caught });
const cam = camera.position.clone();
check('first-person camera at the driver\'s eye', Math.abs(cam.y - 1.05) < 0.25 && Math.hypot(cam.x - e.v.x, cam.z - e.v.z) < 1.2, { y: +cam.y.toFixed(2) });
check('audio gets the i4 engine profile and a door event', audioStates.some((s) => s.kind === 'car' && s.engine === 'i4') && audioStates.some((s) => s.event === 'door'), { engine: audioStates.at(-1).engine });

// 2. pull out and drive south down the lane
V.place(-19.75, 30, Math.PI);
const r = V.simulate(['KeyW'], 5);
check('W drives it down the lane', e.v.z > 50 && r.maxSpeed > 8, { z: +e.v.z.toFixed(1), max: r.maxSpeed, gear: e.v.gear });
// 3. chase camera: behind and above the car
V.setView('chase');
V.simulate(['KeyW'], 1);
const fwd = new THREE.Vector3(-Math.sin(e.v.yaw), 0, -Math.cos(e.v.yaw));
const off = camera.position.clone().sub(new THREE.Vector3(e.v.x, e.v.bodyY, e.v.z));
check('chase camera sits behind and above the car', off.dot(fwd) < -3 && off.y > 1.2 && e.drive.rig.chase === true, { behind: +off.dot(fwd).toFixed(2), up: +off.y.toFixed(2) });
V.setView('fp');
// 4. handbrake drift: the tail steps out (slip) and skid marks are laid
V.place(-19.75, 60, Math.PI);
V.simulate(['KeyW', 'ShiftLeft'], 3);
let maxSlip = 0, maxSkid = 0;
for (let i = 0; i < 60; i++) { V.simulate(['KeyD', 'Space'], 1 / 60); maxSlip = Math.max(maxSlip, Math.abs(e.v.slip)); maxSkid = Math.max(maxSkid, e.v.skid); }
check('handbrake + steer at speed: the car slides (slip > 2 m/s) and marks the road', maxSlip > 2 && maxSkid > 0.4 && V.skids.count > 5, { slip: +maxSlip.toFixed(2), skid: +maxSkid.toFixed(2), marks: V.skids.count });
// 5. exit anywhere (mid-road): the car stays, solid to the walker, the spot stays free
V.place(-18, 120, Math.PI);
V.simulate([], 0.3);
key('KeyE');
const left = V.list.find((q) => q === e);
check('E gets out mid-road; the car stays there, engine off', !V.riding && left && Math.abs(left.v.z - 120) < 0.3 && !left.v.engineOn && Math.hypot(walker.pos.x - left.v.x, walker.pos.y - left.v.z) < 2.6, { walker: [+walker.pos.x.toFixed(2), +walker.pos.y.toFixed(2)] });
check('the car left there is solid to the walker; the spot is still free', walker.blocked(left.v.x, left.v.z) && sedan.taken, {});
// 6. recovery: the car put in the park comes back to the road, facing along it
walker.pos.set(left.v.x + 1.6, left.v.z); look(left.v.x, left.v.z);
V.update(1 / 60);
key('KeyE');
for (let i = 0; i < 40; i++) V.update(1 / 60);
V.place(2, 150, Math.PI / 2);
V.recover(true, true);
check('recovery puts it on the nearest road lane, at rest, engine on', e.v.x < -14.5 && e.v.x > -21.5 && Math.abs(e.v.lon) < 0.01 && e.v.engineOn, { x: +e.v.x.toFixed(2), z: +e.v.z.toFixed(2), yaw: +e.v.yaw.toFixed(2) });
V.simulate(['KeyS'], 0.5);
key('KeyE');
// 7. the live cap: enter the seven far hatchbacks one by one
walker.pos.set(0, 200);
for (const s of cars.slice(2)) {
  const [d] = V.doorsOf(s);
  walker.pos.set(d.x + 0.3, d.z); look(s.x, s.z);
  V.update(1 / 60);
  key('KeyE');
  for (let i = 0; i < 40; i++) V.update(1 / 60);
  V.simulate([], 0.2);
  key('KeyE');
}
const live = V.list.filter((q) => q.origin === 'parked').length;
check('at most six live cars: the oldest out of sight went back to its spot', live <= 6 && releases >= 1 && disposed === releases && !cars[0].taken, { live, releases, disposed, sedanBack: !cars[0].taken });
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
