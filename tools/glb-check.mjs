// Node-only structure check of the car GLBs (no browser): every parked kind at LOD0 + LOD1
// with four wheel pivots, glass, a roof over the cabin, bounds; the convertible's nodes.
// Usage: node tools/glb-check.mjs
import fs from 'node:fs';
globalThis.self ??= globalThis;   // (textures just fail to load in Node)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const load = (f) => new Promise((res, rej) => {
  const b = fs.readFileSync(f);
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej);
});
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log('FAIL', msg); } };
const parked = await load('public/models/parked.glb');
parked.scene.updateMatrixWorld(true);
const box = new THREE.Box3(), tmp = new THREE.Box3();
for (const kind of ['sedan', 'hatch', 'suv', 'pickup', 'coupe', 'wagon', 'crossover']) {
  for (const sfx of ['', '_L1']) {
    const root = parked.scene.getObjectByName(kind + sfx);
    check(!!root, `${kind}${sfx} present`);
    if (!root) continue;
    box.makeEmpty();
    const mats = {};
    let roofTop = -1, cabinGlass = 0;
    root.traverse((o) => {
      if (!o.isMesh) return;
      tmp.setFromObject(o); box.union(tmp);
      const n = o.material.name;
      mats[n] = (mats[n] ?? 0) + o.geometry.attributes.position.count;
      if (n === 'paint' && /_gh/.test(o.name + o.parent?.name)) roofTop = Math.max(roofTop, tmp.max.y);
      if (n === 'tint' || n === 'glass') cabinGlass += o.geometry.attributes.position.count;
    });
    const wheels = ['FL', 'FR', 'RL', 'RR'].map((w) => root.getObjectByName(`${kind}_wheel_${w}${sfx}`));
    check(wheels.every(Boolean), `${kind}${sfx} has 4 wheel pivots`);
    check(wheels.every((w) => w && w.children.length), `${kind}${sfx} wheel meshes under the pivots`);
    check(cabinGlass > 0, `${kind}${sfx} has glass`);
    const size = box.getSize(new THREE.Vector3());
    console.log(`${(kind + sfx).padEnd(13)} L ${size.z.toFixed(2)} W ${size.x.toFixed(2)} H ${size.y.toFixed(2)}  mats ${Object.keys(mats).length}  glass ${cabinGlass}v  roof ${roofTop.toFixed(2)}`);
  }
}
const hero = await load('public/models/convertible.glb');
for (const n of ['convertible', 'convertible_L1', 'wheel_FL', 'wheel_RR_L1', 'steering_wheel', 'driver_seat', 'driver_eye', 'speedo_needle', 'driver_pelvis', 'grip_L', 'grip_R', 'rear_mirror']) check(!!hero.scene.getObjectByName(n), `convertible node ${n}`);
const hm = new Set();
hero.scene.traverse((o) => { if (o.isMesh) hm.add(o.material.name); });
console.log('convertible materials', [...hm].sort().join(' '));
for (const m of ['paint', 'paint2', 'chrome', 'screen', 'dial_glass', 'interior', 'vinyl', 'vinyl2', 'carpet', 'tail', 'gauge_speedo', 'gauge_fuel', 'gauge_temp', 'needle', 'engine', 'dashtop', 'brushed', 'enamel']) check(hm.has(m), `convertible material ${m}`);
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
