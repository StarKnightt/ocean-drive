// Node smoke test of world/traffic.js (the drawing / collider layer over traffic-sim.js) with
// a stand-in model kit and a stubbed DOM: instances bind, move, spin their wheels, light the
// brake lamps, the collider circles follow, classics come and go, the signal lamps switch.
// Usage: node tools/traffic-visual-test.mjs
const ctx2d = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
const el = () => ({ style: {}, classList: { toggle() {}, add() {}, remove() {} }, appendChild() {}, getContext: () => ctx2d, width: 0, height: 0 });
globalThis.document = { createElement: el, head: el(), body: el(), documentElement: el() };
globalThis.addEventListener = () => {};
globalThis.window = globalThis;
globalThis.location = { search: '' };
globalThis.matchMedia = () => ({ matches: false });
globalThis.devicePixelRatio = 1;
globalThis.screen = { width: 1920, height: 1080 };
const THREE = await import('three');
const { buildTraffic } = await import('../src/world/traffic.js');
const { SIGNAL_LIGHTS } = await import('../src/world/street.js');
const { CROSSWALK_Z } = await import('../src/world/layout.js');

const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(info)}`); };
const scene = new THREE.Scene();
let built = 0;
const mk = () => {
  const root = new THREE.Group();
  const sway = new THREE.Group();
  root.add(sway);
  const levels = [new THREE.Group(), new THREE.Group()];
  levels.forEach((l) => sway.add(l));
  const wheels = levels.map((l) => [0, 1, 2, 3].map(() => { const w = new THREE.Group(); l.add(w); return w; }));
  return { root, sway, levels, wheels };
};
const classics = [0, 1].map(() => { const m = mk(); return { car: m.root, sway: m.sway, levels: m.levels, wheels: [...m.wheels[0], ...m.wheels[1]], wheelR: 0.36, tail: new THREE.MeshPhysicalMaterial({ emissive: 0x2a0304 }) }; });
const kit = {
  kinds: ['sedan', 'suv'], lens: { sedan: 4.8, suv: 4.7 }, classics, paints: [0x112233, 0x445566], lod1At: 42,
  makeModern(kind, paint, tail) { built++; const m = mk(); scene.add(m.root); return { root: m.root, levels: m.levels, wheels: m.wheels, wheelR: 0.34, len: this.lens[kind], kind, paint: this.paint(0xffffff) }; },
  paint: (c) => new THREE.MeshPhysicalMaterial({ color: c }), tail: () => new THREE.MeshPhysicalMaterial({ emissive: 0x2a0304 }),
};
// SIGNAL_LIGHTS stand-ins (the street isn't built here)
SIGNAL_LIGHTS.od = [0, 1, 2].map(() => ({ visible: false }));
SIGNAL_LIGHTS.cross = [0, 1, 2].map(() => ({ visible: false }));

const T = buildTraffic(scene, { kit, seed: 5 });
check('traffic built with cars and 5 collider circles each', T.cars.length >= 2 && T.colliders.length === T.cars.length * 5, { cars: T.cars.length, colliders: T.colliders.length });
const camera = new THREE.PerspectiveCamera();
camera.position.set(-26, 1.8, 0);
const walker = { x: -26, z: 0 };
let lampsSeen = new Set(), brakeLit = 0, spins = 0, classicSeen = 0, maxVisible = 0, colliderOk = true;
for (let i = 0; i < 60 * 600; i++) {
  // the walker crosses at z = -10 every 50 s
  const t = i / 60;
  const crossing = t % 50 < 7;
  walker.x = crossing ? -25 + (t % 50) * 1.8 : -26;
  walker.z = crossing ? CROSSWALK_Z : 0;
  T.update(1 / 60, { camera, peds: [walker], obstacles: [{ x: walker.x, z: walker.z, r: 0.35 }] });
  lampsSeen.add(SIGNAL_LIGHTS.od.findIndex((m) => m.visible));
  let vis = 0;
  for (const c of T.cars) {
    if (c.hidden) continue;
    const circ = T.colliders.filter((q) => q.car === c && q.x === c.x && Math.abs(q.z - c.z) < 3);
    if (circ.length !== 5 || circ.some((q) => q.r !== 0.95)) colliderOk = false;
  }
  scene.traverse((o) => { if (o.isGroup && o.visible && o.parent === scene) vis++; });
  maxVisible = Math.max(maxVisible, vis);
  if (T.cars.some((c) => c.braking)) brakeLit++;
  if (T.cars.some((c) => c.classic && !c.hidden)) classicSeen++;
}
for (const c of classics) if (c.car.parent === null) scene.add(c.car);
const anyWheel = scene.children.some((r) => { let s = 0; r.traverse((o) => { if (o.rotation.x > 1) s++; }); return s > 0; });
check('signal lamps cycled through red, yellow and green', lampsSeen.has(0) && lampsSeen.has(1) && lampsSeen.has(2), { seen: [...lampsSeen] });
check('collider circles follow every visible car', colliderOk, {});
check('brake lights on at some point (crosswalk, signal, followers)', brakeLit > 60, { framesBraking: brakeLit });
check('wheels spin', anyWheel, {});
check('modern instances are cached per slot and model', built <= T.cars.length * 2, { built });
check('classic convertibles appear now and then', classicSeen > 0, { framesWithClassic: classicSeen });
const lit = T.cars.map((c) => c.braking);
check('state() and audioList() report', T.state().length === T.cars.length && Array.isArray(T.audioList()), { signal: T.signal });
const shot = buildTraffic(new THREE.Scene(), { kit, shot: true });
check('?shot mode: no traffic', shot.cars.length === 0 && shot.colliders.length === 0, {});
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
