// The world's soft ends, made diegetic: a row of road-closed barricades and cones across
// Ocean Drive a little inside each open end (z ±560 on the extent) and across each near cross
// street toward its west end, where the vehicles' turn-back steering and the walker's slow-down
// begin. They are soft: knockable like the bins (world/props-dyn.js), and the extent's taper
// still turns the player round beyond them. Geometry and the prop list only; props-dyn draws
// them. Open world only (never in ?shot).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EXTENT, EDGE_SOFT } from './extent.js';
import { SIDEWALK_W, SIDEWALK_E, LANES, PARKING, CROSS, CROSS_STREETS } from './layout.js';
import { promenadeX } from './crowd.js';

const INSET = EDGE_SOFT.vehicle - 4;   // m inside the open end

function colored(g, hex) {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const box = (w, h, d, x, y, z, hex) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), hex);
const strip = (g) => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k); return g; };

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  if (g?.fillRect) {
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, 256, 32);
    g.fillStyle = '#e8622a';
    for (let x = -64; x < 320; x += 48) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 24, 32); g.lineTo(x + 48, 0); g.lineTo(x + 24, 0); g.closePath(); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function signTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 80;
  const g = c.getContext('2d');
  if (g?.fillRect) {
    g.fillStyle = '#f6f3ea'; g.fillRect(0, 0, 256, 80);
    g.strokeStyle = '#1b1b1b'; g.lineWidth = 5; g.strokeRect(6, 6, 244, 68);
    g.fillStyle = '#1b1b1b';
    g.font = '700 38px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('ROAD CLOSED', 128, 42, 228);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// kinds for props-dyn: the barricade (frame, striped rails, sign) and the cone; the sign
// faces -z at rot 0 (edgeProps turns it to face the way the player comes)
export function edgeKinds(furnitureMat) {
  const W = 2.3;
  // A-frame legs at each end, three rails across (their faces carry the stripe texture)
  const frame = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) frame.push(colored(new THREE.BoxGeometry(0.06, 1.3, 0.06).rotateX(sz * 0.22).translate(sx * (W / 2 - 0.12), 0.63, sz * 0.14), 0xe9e6de));
    frame.push(box(0.08, 0.06, 0.62, sx * (W / 2 - 0.12), 0, 0, 0x2b2b2b));
    // a sandbag over each foot (Type III: weighted, not staked)
    frame.push(colored(new THREE.CylinderGeometry(0.13, 0.15, 0.56, 8).rotateX(Math.PI / 2).scale(1, 0.55, 1).translate(sx * (W / 2 - 0.12), 0.1, 0), 0x9c8a66));
  }
  const rails = [0.42, 0.7, 0.98].map((y) => new THREE.BoxGeometry(W, 0.2, 0.025).translate(0, y, -0.02));
  const sign = new THREE.PlaneGeometry(0.95, 0.3).rotateY(Math.PI).translate(0, 1.32, -0.03);
  const signBack = mergeGeometries([box(0.97, 0.32, 0.015, 0, 1.16, -0.02, 0xd9d6ce), box(0.05, 0.1, 0.03, 0, 1.07, -0.02, 0xe9e6de)].map(strip));
  const cone = [
    colored(new THREE.CylinderGeometry(0.035, 0.16, 0.62, 16, 1, true).translate(0, 0.35, 0), 0xe8622a),
    colored(new THREE.CylinderGeometry(0.105, 0.125, 0.12, 16, 1, true).translate(0, 0.3, 0).scale(1.02, 1, 1.02), 0xf2f0ea),
    box(0.4, 0.04, 0.4, 0, 0, 0, 0x2a2a2a),
  ];
  const railMat = new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.5, metalness: 0 });
  const signMat = new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.55, metalness: 0 });
  return {
    barricade: {
      mass: 14, lie: 0.12,
      parts: [
        { geo: mergeGeometries([...frame, signBack].map(strip)), mat: furnitureMat },
        { geo: mergeGeometries(rails.map(strip)), mat: railMat },
        { geo: sign, mat: signMat, shadow: false },
      ],
    },
    cone: { mass: 3, lie: 0.15, parts: [{ geo: mergeGeometries(cone.map(strip)), mat: furnitureMat }] },
  };
}

// the prop list: [{ kind, x, z, rot, r, span? }] (props-dyn puts them on the ground)
export function edgeProps(tier = 'high') {
  const out = [];
  const rects = (EXTENT[tier] ?? EXTENT.high).rects;
  const od = rects.find((r) => r.name === 'ocean-drive');
  if (od) {
    for (const s of [-1, 1]) {
      if (!(s < 0 ? od.soft.z0 : od.soft.z1)) continue;
      const z = s < 0 ? od.z0 + INSET : od.z1 - INSET;
      // barricades over the lanes (their long side across the road), a gap-toothed line
      for (const x of [LANES.x0 + 1.3, LANES.centerX, LANES.x1 - 1.3]) out.push({ kind: 'barricade', x, z: z + (x === LANES.centerX ? s * 0.4 : 0), rot: s < 0 ? Math.PI : 0, r: 0.4, span: 0.85 });
      // cones: the parking lane, both sidewalks, the promenade
      for (const x of [(PARKING.x0 + PARKING.x1) / 2, SIDEWALK_W.x1 - 1.2, SIDEWALK_E.x0 + 1.4, promenadeX(z) - 1, promenadeX(z) + 1]) {
        out.push({ kind: 'cone', x, z, rot: 0, r: 0.2 });
      }
    }
  }
  // the near cross streets, toward their west ends
  for (const c of CROSS_STREETS) {
    if (c.far) continue;
    const r = rects.find((q) => q.soft.x0 && Math.abs((q.z0 + q.z1) / 2 - c.z) < 1);
    if (!r) continue;
    const x = r.x0 + INSET;
    for (const dz of [-2.8, 0, 2.8]) out.push({ kind: 'barricade', x: x + (dz ? 0 : 0.4), z: c.z + dz, rot: -Math.PI / 2, r: 0.4, span: 0.85 });
    for (const s of [-1, 1]) out.push({ kind: 'cone', x, z: c.z + s * (CROSS.hw + 1.2), rot: 0, r: 0.2 });
  }
  return out;
}
