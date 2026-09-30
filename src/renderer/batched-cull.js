// Per-instance frustum culling for a BatchedMesh whose instances never move (palms, the
// parked fleet). three's own pass fetches each instance matrix and transforms its geometry's
// bounding sphere in every render pass (main, sun shadow, mirror); here the world spheres are
// computed once and each pass is a plane test over a flat array. Instances may still change
// visibility or geometry (setVisibleAt / setGeometryIdAt: the LOD swaps), not their matrix.
// Opaque batches only. With `sort`, instances draw front to back along the view (as three's
// opaque sort does) in an order kept from the last main-camera pose and re-sorted (insertion
// sort: nearly sorted already) once the camera has moved or turned; cameras marked
// userData.noSort (the hero's mirror) and orthographic ones (the sun) reuse it.
// Uses three r186 BatchedMesh internals.
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _s = new THREE.Sphere(), _f = new THREE.Frustum(), _pm = new THREE.Matrix4();
const _fw = new THREE.Vector3(), _cp = new THREE.Vector3();

export function staticCull(bm, { pad = 1.15, sort = false } = {}) {
  const info = bm._instanceInfo, n = info.length;
  const S = new Float32Array(n * 4);
  bm.updateMatrixWorld(true);
  for (let i = 0; i < n; i++) {
    if (!info[i].active) continue;
    // (the largest of the instance's LOD geometries would be exact; the current one, padded)
    bm.getMatrixAt(i, _m);
    bm.getBoundingSphereAt(info[i].geometryIndex, _s).applyMatrix4(_m).applyMatrix4(bm.matrixWorld);
    S[i * 4] = _s.center.x; S[i * 4 + 1] = _s.center.y; S[i * 4 + 2] = _s.center.z; S[i * 4 + 3] = _s.radius * pad;
  }
  const order = new Uint32Array(n).map((_, i) => i);
  const key = new Float32Array(n);
  const at = new THREE.Vector3(Infinity, 0, 0), f0 = new THREE.Vector3(0, 0, 0);
  function resort(camera) {
    camera.getWorldPosition(_cp);
    camera.getWorldDirection(_fw);
    if (_cp.distanceToSquared(at) < 1 && _fw.dot(f0) > 0.998) return;
    at.copy(_cp); f0.copy(_fw);
    for (let i = 0; i < n; i++) key[i] = (S[i * 4] - _cp.x) * _fw.x + (S[i * 4 + 1] - _cp.y) * _fw.y + (S[i * 4 + 2] - _cp.z) * _fw.z;
    for (let a = 1; a < n; a++) {
      const id = order[a], k = key[id];
      let b = a - 1;
      while (b >= 0 && key[order[b]] > k) { order[b + 1] = order[b]; b--; }
      order[b + 1] = id;
    }
  }
  bm.perObjectFrustumCulled = true;
  bm.sortObjects = false;
  bm.onBeforeRender = function (renderer, scene, camera, geometry) {
    if (sort && camera.isPerspectiveCamera && !camera.userData.noSort) resort(camera);
    const index = geometry.getIndex();
    const bpe = index === null ? 1 : index.array.BYTES_PER_ELEMENT;
    _f.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    const P = _f.planes;
    const p0 = P[0], p1 = P[1], p2 = P[2], p3 = P[3], p4 = P[4], p5 = P[5];
    const starts = this._multiDrawStarts, counts = this._multiDrawCounts, geos = this._geometryInfo;
    const indirect = this._indirectTexture.image.data;
    let k = 0;
    for (let j = 0; j < n; j++) {
      const i = order[j], it = info[i];
      if (!it.visible || !it.active) continue;
      const x = S[i * 4], y = S[i * 4 + 1], z = S[i * 4 + 2], r = -S[i * 4 + 3];
      if (p0.normal.x * x + p0.normal.y * y + p0.normal.z * z + p0.constant < r) continue;
      if (p1.normal.x * x + p1.normal.y * y + p1.normal.z * z + p1.constant < r) continue;
      if (p2.normal.x * x + p2.normal.y * y + p2.normal.z * z + p2.constant < r) continue;
      if (p3.normal.x * x + p3.normal.y * y + p3.normal.z * z + p3.constant < r) continue;
      if (p4.normal.x * x + p4.normal.y * y + p4.normal.z * z + p4.constant < r) continue;
      if (p5.normal.x * x + p5.normal.y * y + p5.normal.z * z + p5.constant < r) continue;
      const g = geos[it.geometryIndex];
      starts[k] = g.start * bpe;
      counts[k] = g.count;
      indirect[k] = i;
      k++;
    }
    this._indirectTexture.needsUpdate = true;
    this._multiDrawCount = k;
    this._multiDrawBytesPerElement = bpe;
    this._visibilityChanged = false;
  };
  return bm;
}
