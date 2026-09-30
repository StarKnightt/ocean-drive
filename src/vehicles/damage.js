// Damage-lite on the player's modern cars: an impact over DENT_SPEED pushes the body panels
// in round the contact point (the vertices of the paint and trim meshes within ~0.35-0.6 m,
// by up to 6 cm, with a smooth falloff; the normals recomputed). The car's geometry is shared
// with the fleet, so the dented meshes get their own copies on the first dent (and give them
// back on dispose). CPU work only on an impact frame. The dents are kept in the car's own
// frame, so the saved car (vehicles/index.js) comes back with them.
import * as THREE from 'three';

export const DENT_SPEED = 3.5;      // m/s into the obstacle
const MAX_DENTS = 24;
const MAX_DISP = 0.07;              // m, the most any vertex is pushed in, all dents together
const MAX_DISP_TRIM = 0.02;         // the grille and trim (the dark backing behind them can't dent: kept in front of it)
const _p = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix4(), _nm = new THREE.Matrix3();

// view: the drivable modern car (world/cars-glb.js makeDrivable)
export function createDamage(view) {
  const I = view.inst, root = view.root, L0 = I.levels[0];
  const targets = [];
  L0.traverse((o) => {
    if (!o.isMesh || o.material?.transparent || !o.geometry.attributes.position?.array) return;
    // the painted body, and the dark trim round it (the meshes that kept their arrays)
    if (o.material === I.paint || o.geometry.userData.keepArrays) targets.push({ mesh: o, own: false, shared: o.geometry, cap: o.material === I.paint ? MAX_DISP : MAX_DISP_TRIM });
  });
  const dents = [];

  function own(t) {
    if (t.own) return;
    const g = t.shared.clone();
    // (quantized normals can't be recomputed in place: a float copy)
    const n = g.attributes.normal;
    if (n && (n.normalized || n.isInterleavedBufferAttribute)) {
      const a = new Float32Array(n.count * 3);
      for (let i = 0; i < n.count; i++) { a[i * 3] = n.getX(i); a[i * 3 + 1] = n.getY(i); a[i * 3 + 2] = n.getZ(i); }
      g.setAttribute('normal', new THREE.BufferAttribute(a, 3));
    }
    t.mesh.geometry = g;
    t.own = true;
  }

  // c, n: the contact point and the inward direction (from the obstacle into the car), car
  // local; depth (m), R (m)
  function dentLocal(c, n, depth, R) {
    root.updateMatrixWorld(true);
    for (const t of targets) {
      const g = t.shared;
      const pos = g.attributes.position;
      // (in the mesh's frame: the contact and the push)
      _m.copy(t.mesh.matrixWorld).invert().multiply(root.matrixWorld);
      const lc = _c.copy(c).applyMatrix4(_m);
      _nm.getNormalMatrix(_m);
      const ln = _n.copy(n).applyMatrix3(_nm).normalize();
      const sc = t.mesh.matrixWorld.getMaxScaleOnAxis() / root.matrixWorld.getMaxScaleOnAxis() || 1;
      const Rl = R / sc, dl = depth / sc;
      let any = false;
      const moved = [];
      // (a quick reject on the bounds)
      g.boundingBox ?? g.computeBoundingBox();
      const b = g.boundingBox;
      if (lc.x < b.min.x - Rl || lc.x > b.max.x + Rl || lc.y < b.min.y - Rl || lc.y > b.max.y + Rl || lc.z < b.min.z - Rl || lc.z > b.max.z + Rl) continue;
      for (let i = 0; i < pos.count; i++) {
        const dx = pos.getX(i) - lc.x, dy = pos.getY(i) - lc.y, dz = pos.getZ(i) - lc.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > Rl * Rl) continue;
        if (!any) { own(t); any = true; }
        const P = t.mesh.geometry.attributes.position;
        // (smooth falloff, crumpled a little so the reflections break up; the vertex never
        // further than MAX_DISP from where it was modelled, however many dents pile up, so
        // panels don't cross through each other)
        const q = 1 - Math.sqrt(d2) / Rl, f = q * q * (3 - 2 * q), h = Math.sin(pos.getX(i) * 91.7 + pos.getY(i) * 57.3 + pos.getZ(i) * 33.1) * 43758.5;
        const k = dl * f * (0.88 + 0.24 * (h - Math.floor(h)));
        let ox = P.getX(i) + ln.x * k - pos.getX(i), oy = P.getY(i) + ln.y * k - pos.getY(i), oz = P.getZ(i) + ln.z * k - pos.getZ(i);
        const ol = Math.hypot(ox, oy, oz), cap = t.cap / sc;
        if (ol > cap) { const s = cap / ol; ox *= s; oy *= s; oz *= s; }
        P.setXYZ(i, pos.getX(i) + ox, pos.getY(i) + oy, pos.getZ(i) + oz);
        moved.push(i);
      }
      if (any) {
        const G = t.mesh.geometry, N = G.attributes.normal;
        G.attributes.position.needsUpdate = true;
        // (the shading of the dented vertices only: the rest keep their authored normals)
        if (N) {
          const tmp = new THREE.BufferGeometry();
          tmp.setAttribute('position', G.attributes.position);
          if (G.index) tmp.setIndex(G.index);
          tmp.computeVertexNormals();
          const TN = tmp.attributes.normal, N0 = g.attributes.normal;
          // (on the modelled normal's side: a face wound the other way doesn't turn black)
          for (const i of moved) {
            let x = TN.getX(i), y = TN.getY(i), z = TN.getZ(i);
            if (N0 && x * N0.getX(i) + y * N0.getY(i) + z * N0.getZ(i) < 0) { x = -x; y = -y; z = -z; }
            if (!(x * x + y * y + z * z > 1e-6)) { x = N0?.getX(i) ?? 0; y = N0?.getY(i) ?? 1; z = N0?.getZ(i) ?? 0; }
            N.setXYZ(i, x, y, z);
          }
          N.needsUpdate = true;
          tmp.deleteAttribute('normal');
        }
        G.computeBoundingSphere();
      }
    }
  }

  return {
    get count() { return dents.length; },
    // an impact: world contact point (x, z) at bumper height, the contact normal (nx, nz: out
    // of the obstacle, into the car), the impact speed
    hit(px, py, pz, nx, nz, speed) {
      if (speed < DENT_SPEED || dents.length >= MAX_DENTS) return false;
      const s = Math.min(1, (speed - DENT_SPEED) / 7);
      const depth = 0.03 + 0.05 * s, R = 0.35 + 0.3 * s;
      root.updateMatrixWorld(true);
      // (the contact sits on the car's outline: a little in from the collision circles' edge)
      const c = root.worldToLocal(_p.set(px, py, pz)).clone();
      const inv = _m.copy(root.matrixWorld).invert();
      const n = new THREE.Vector3(nx, 0, nz).transformDirection(inv);
      dents.push({ c: c.toArray().map((q) => +q.toFixed(3)), n: n.toArray().map((q) => +q.toFixed(3)), depth: +depth.toFixed(3), R: +R.toFixed(3) });
      dentLocal(c, n, depth, R);
      return true;
    },
    save: () => dents.slice(),
    load(list) {
      if (!Array.isArray(list)) return;
      for (const d of list.slice(0, MAX_DENTS)) {
        if (!d?.c || !d?.n) continue;
        dents.push(d);
        dentLocal(new THREE.Vector3().fromArray(d.c), new THREE.Vector3().fromArray(d.n), d.depth, d.R);
      }
    },
    dispose() {
      for (const t of targets) if (t.own) { t.mesh.geometry.dispose(); t.mesh.geometry = t.shared; t.own = false; }
    },
  };
}
