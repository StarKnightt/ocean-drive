// Node checks of the knockable props (src/world/props-dyn.js) and the road-closed edges
// (src/world/edges.js): a slow car is stopped by a bin (it stays), a fast one knocks it
// (collider off, launched ahead, it lands on its side and stays down; the car loses a little
// speed), a barricade is three colliders along its length, and it is stood back up out of
// view later. Usage: node tools/props-test.mjs
globalThis.document = { createElement: () => ({ getContext: () => null, width: 0, height: 0 }) };
globalThis.window = globalThis;
globalThis.location = { search: '' };
globalThis.matchMedia = () => ({ matches: false });
globalThis.devicePixelRatio = 1;
globalThis.screen = { width: 1920, height: 1080 };
const THREE = await import('three');
const { createDynProps, KNOCK_SPEED } = await import('../src/world/props-dyn.js');
const { edgeProps } = await import('../src/world/edges.js');

const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(info)}`); };
const mat = new THREE.MeshBasicMaterial();
const kinds = {
  bin: { mass: 9, lie: 0.3, parts: [{ geo: new THREE.CylinderGeometry(0.3, 0.3, 0.9).translate(0, 0.45, 0), mat }] },
  barricade: { mass: 14, lie: 0.12, parts: [{ geo: new THREE.BoxGeometry(2.3, 1.2, 0.1), mat }] },
};
const ground = () => 0.15;
const scene = new THREE.Scene();
let shadows = 0;
const P = createDynProps(scene, { kinds, groundAt: ground, requestShadow: () => shadows++, items: [
  { kind: 'bin', x: 0, z: 0, rot: 0, r: 0.3 },
  { kind: 'barricade', x: 10, z: 0, rot: 0, r: 0.4, span: 0.85 },
] });
const car = (x, z, vz) => ({ x, z, vx: 0, vz, lon: Math.abs(vz), spec: { length: 4.5, mass: 1500 }, circlesWorld: [-1.9, -0.95, 0, 0.95, 1.9].map((dz) => ({ x, z: z + dz, r: 0.95 })) });

check('one InstancedMesh per part, each prop on the ground; the barricade has three colliders', P.meshes.length === 2 && P.colliders.length === 4 && Math.abs(P.props[0].pos.y - 0.15) < 1e-6, { meshes: P.meshes.length, colliders: P.colliders.length });
// slow: solid
let v = car(0, -3.2, 1.0);
check('below the knock speed the bin is solid (not knocked)', P.sweep(v).length === 0 && P.props[0].state === 'rest' && P.props[0].col.r > 0, { speed: 1, KNOCK_SPEED });
// fast: knocked
v = car(0, -3.2, 9);
const k = P.sweep(v);
const bin = P.props[0];
check('at 9 m/s the car knocks it: collider off, launched ahead and up, the car a little slower', k.length === 1 && bin.col.r === 0 && bin.vel.z > 9 && bin.vel.y > 1 && v.vz < 9 && v.vz > 8, { vel: bin.vel.toArray().map((q) => +q.toFixed(2)), carVz: +v.vz.toFixed(2) });
const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
cam.position.set(0, 2, -10); cam.lookAt(0, 0, 10); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
let maxY = 0;
for (let t = 0; t < 6; t += 1 / 60) { P.update(1 / 60, cam); maxY = Math.max(maxY, bin.pos.y); }
const up = new THREE.Vector3(0, 1, 0).applyQuaternion(bin.q);
check('it flies, lands and comes to rest on its side further on', bin.state === 'down' && bin.pos.z > 3 && maxY > 0.5 && Math.abs(up.y) < 0.3 && Math.abs(bin.pos.y - (0.15 + 0.3)) < 0.02, { state: bin.state, z: +bin.pos.z.toFixed(2), maxY: +maxY.toFixed(2), upY: +up.y.toFixed(2) });
check('the shadow map is refreshed while it moves', shadows > 0, { shadows });
// the barricade: hit at its end circle
v = car(10.8, -3, 6);
check('a barricade is knocked at its end, not only its middle', P.sweep(v).length === 1 && P.props[1].cols.every((c) => c.r === 0), {});
// reset: 90 s later, out of view
for (let t = 0; t < 95; t += 0.05) P.update(0.05, cam);
check('still down while its spot is in view', bin.state === 'down', { state: bin.state });
cam.position.set(0, 2, -80); cam.lookAt(0, 2, -200); cam.updateMatrixWorld();
P.update(0.1, cam);
check('stood back up out of view (collider back)', bin.state === 'rest' && bin.col.r > 0 && Math.abs(bin.pos.z) < 1e-6, { state: bin.state });
// the edges: barricades across both ends of the drive and each near cross street
const E = edgeProps('high');
const bars = E.filter((p) => p.kind === 'barricade');
check('road-closed barricades at both ends of Ocean Drive and across the six near cross streets', bars.filter((p) => p.z < -500).length === 3 && bars.filter((p) => p.z > 500).length === 3 && bars.length === 24 && E.some((p) => p.kind === 'cone'), { bars: bars.length, cones: E.length - bars.length });

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
