// scratch: per-material vertex boxes (car-local, world matrices applied) of a GLB node inside a box
// Usage: node tools/_nodes.mjs <glb> <node> [x0,x1,y0,y1,z0,z1]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const n = doc.getRoot().listNodes().find((q) => q.getName() === (process.argv[3] ?? 'trim'));
const M = n.getWorldMatrix();
const [x0, x1, y0, y1, z0, z1] = (process.argv[4] ?? '0.05,0.85,-1,1.0,-0.9,1.3').split(',').map(Number);
const hist = {};
for (const p of n.getMesh().listPrimitives()) {
  const a = p.getAttribute('POSITION'), el = [];
  const mn = [9, 9, 9], mx = [-9, -9, -9]; let c = 0;
  for (let i = 0; i < a.getCount(); i++) {
    const v = a.getElement(i, el);
    const x = M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], y = M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], z = M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14];
    if (x < x0 || x > x1 || z < z0 || z > z1 || y > y1 || y < y0) continue;
    c++; [x, y, z].forEach((q, k) => { mn[k] = Math.min(mn[k], q); mx[k] = Math.max(mx[k], q); });
  }
  if (c) console.log(p.getMaterial()?.getName(), c, mn.map((q) => q.toFixed(3)).join(','), '->', mx.map((q) => q.toFixed(3)).join(','));
}
