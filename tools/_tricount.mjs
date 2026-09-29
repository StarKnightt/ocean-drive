// scratch: triangles per mesh of the hero's LOD0 in a GLB
// Usage: node tools/_tricount.mjs file.glb [...]
import fs from 'node:fs';
globalThis.self ??= globalThis;
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const load = (f) => new Promise((res, rej) => {
  const b = fs.readFileSync(f);
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej);
});
for (const f of process.argv.slice(2)) {
  const g = await load(f);
  const root = g.scene.getObjectByName('convertible');
  const t = {};
  root.traverse((o) => {
    if (!o.isMesh) return;
    const k = (o.parent.isMesh || o.parent.name === 'convertible' ? o.name : o.parent.name).replace(/_\d+$/, '');
    t[k] = (t[k] || 0) + (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  console.log(f, Object.values(t).reduce((a, b) => a + b, 0), JSON.stringify(t));
}
