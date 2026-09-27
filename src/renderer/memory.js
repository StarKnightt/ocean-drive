// Free the CPU-side copies of static data once the GPU has it. World geometry and
// canvas-painted textures are built once and never re-uploaded (a lost WebGL context
// reloads the page), so after upload their arrays and canvases are only memory.
import * as THREE from 'three';

function dropArray() { this.array = null; }

// Static mesh geometry under root: bounds are computed first (culling needs them), then
// each static attribute drops its array right after its upload. Dynamic attributes,
// points / lines, skinned and batched meshes keep theirs.
export function releaseGeometryAfterUpload(root) {
  const done = new Set();
  root.traverse((o) => {
    // (BatchedMesh computes per-instance bounds from its arrays on demand)
    if (!o.isMesh || o.isSkinnedMesh || o.isBatchedMesh || !o.geometry || o.geometry.userData.keepArrays) return;
    const g = o.geometry;
    if (o.isInstancedMesh) { o.computeBoundingSphere(); o.computeBoundingBox(); }
    if (done.has(g)) return;
    done.add(g);
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingBox) g.computeBoundingBox();
    if (g.morphAttributes && Object.keys(g.morphAttributes).length) return;
    for (const a of [...Object.values(g.attributes), g.index]) {
      if (!a || a.isInterleavedBufferAttribute || a.usage !== THREE.StaticDrawUsage) continue;
      a.onUpload(dropArray);
    }
  });
}

// Canvas-backed textures: once every texture that reads a canvas has been uploaded, the
// canvas is shrunk to 1x1, which frees its (often GPU-side) backing store. The original
// size is kept in userData.size for memory estimates.
export function releaseCanvasesAfterUpload(textures) {
  const users = new Map();
  for (const t of textures) {
    const im = t.image;
    if (!(im instanceof HTMLCanvasElement) || t.isVideoTexture) continue;
    if (!users.has(im)) users.set(im, new Set());
    users.get(im).add(t);
  }
  for (const [cv, set] of users) {
    for (const t of set) {
      const prev = t.onUpdate;
      t.onUpdate = (tex) => {
        prev?.(tex);
        tex.userData.size = [cv.width, cv.height];
        set.delete(tex);
        tex.onUpdate = prev ?? null;
        if (set.size === 0 && cv.width > 1) cv.width = cv.height = 1;
      };
    }
  }
}
