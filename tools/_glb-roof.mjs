// Which material covers the roof of each modern body: triangles with their centre on the
// top of the greenhouse between the windscreen and the rear window, per material.
// Usage: node tools/_glb-roof.mjs [public/models/parked.glb]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { getSceneVertexCount } from '@gltf-transform/functions';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2] ?? 'public/models/parked.glb');
void getSceneVertexCount;
const root = doc.getRoot();
const mul = (a, b) => { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return o; };
const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const want = (process.argv[3] ?? 'suv').split(',');
for (const kind of want) {
  const top = root.listNodes().find((n) => n.getName() === kind);
  if (!top) continue;
  const inv = (() => { const t = top.getTranslation(); return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -t[0], -t[1], -t[2], 1]; })();
  const stats = {};
  const walk = (node, parentM) => {
    const M = mul(parentM, node.getMatrix());
    const mesh = node.getMesh();
    if (mesh) for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), idx = prim.getIndices(), mat = prim.getMaterial()?.getName() ?? '?';
      const n = idx ? idx.getCount() : pos.getCount();
      const el = [0, 0, 0];
      for (let t = 0; t < n; t += 3) {
        let c = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const i = idx ? idx.getScalar(t + k) : t + k;
          pos.getElement(i, el);
          const w = apply(M, el);
          c = c.map((v, q) => v + w[q] / 3);
        }
        const s = (stats[node.getName() + ':' + mat] ??= { tris: 0, roof: 0, maxY: -9 });
        s.tris++;
        s.maxY = Math.max(s.maxY, c[1]);
        stats[node.getName() + ':' + mat].ys ??= [];
        if (c[1] > (process.env.YMIN ? +process.env.YMIN : 1.7) && c[2] > (+process.env.Z0 || -1.8) && c[2] < (+process.env.Z1 || 0.45)) s.roof++;
      }
    }
    for (const ch of node.listChildren()) walk(ch, M);
  };
  walk(top, inv);
  console.log(kind);
  for (const [k, s] of Object.entries(stats)) if (s.roof) console.log('  ', k.padEnd(40), 'roof tris', s.roof, 'of', s.tris, 'maxY', s.maxY.toFixed(3));
}
