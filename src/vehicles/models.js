// Procedural models: a pastel beach cruiser (fat whitewall balloon tyres, swept-back bars,
// cantilever frame, fenders, chain guard, sprung saddle, wicker basket, kickstand) and a
// red lifeguard ATV (knobby tyres, lofted body and fenders, floorboards, tubular racks and
// brush guard, light bar hoop with a whip flag, rescue can). No text anywhere.
//
// Every moving part is one merged mesh with vertex colours and a per-vertex
// metalness / roughness / emission attribute (aMRE), so each vehicle is a handful of draw
// calls. Model local frame: forward = -z, right = +x, y up, origin on the ground.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { QUALITY } from '../quality.js';

const DETAIL = QUALITY.tier === 'high' ? 2 : QUALITY.tier === 'medium' ? 1 : 0;
const RAD = [6, 8, 10][DETAIL];            // tube radial segments
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// ---------------------------------------------------------------------------
// material + geometry helpers

export function vehicleMaterial(key) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const u = { uLights: { value: 0 }, uBeaconA: { value: 0 }, uBeaconB: { value: 0 } };
  mat.userData.u = u;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aMRE;\nvarying vec3 vMRE;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMRE = aMRE;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMRE;\nuniform float uLights, uBeaconA, uBeaconB;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vMRE.y;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMRE.x;')
      // emission codes: < 0.7 lamps (on while ridden), 0.8 / 0.9 the two beacon banks
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vMRE.z > 0.01) {
          float k = vMRE.z < 0.7 ? vMRE.z * (0.25 + uLights) : vMRE.z < 0.85 ? 0.12 + uBeaconA * 2.5 : 0.12 + uBeaconB * 2.5;
          totalEmissiveRadiance += diffuseColor.rgb * k;
        }`)
      // sides away from the low sun sit in soft sky shade; no blown-out chrome glints
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= 0.8;')
      .replace('#include <opaque_fragment>', 'outgoingLight = min(outgoingLight, vec3(3.0));\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => 'vehicle-mre-v1';
  return mat;
}

class Parts {
  constructor() { this.list = []; }
  add(g, hex, metal = 0, rough = 0.6, emis = 0) {
    g = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count, c = new THREE.Color(hex);
    const col = new Float32Array(n * 3), mre = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col.set([c.r, c.g, c.b], i * 3); mre.set([metal, rough, emis], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aMRE', new THREE.BufferAttribute(mre, 3));
    this.list.push(g);
    return g;
  }
  // geometry that already carries per-vertex colour (tyres): keep it
  addColored(g, metal, rough) {
    g = g.index ? g.toNonIndexed() : g;
    const n = g.attributes.position.count, mre = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) mre.set([metal, rough, 0], i * 3);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    g.setAttribute('aMRE', new THREE.BufferAttribute(mre, 3));
    this.list.push(g);
  }
  mesh(mat, { cast = true, matrix = null } = {}) {
    const g = mergeGeometries(this.list);
    if (matrix) g.applyMatrix4(matrix);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    return m;
  }
}

function tube(pts, r, seg = 0, closed = false, radial = RAD) {
  const c = new THREE.CatmullRomCurve3(pts.map(V3), closed, 'centripetal');
  return new THREE.TubeGeometry(c, seg || Math.max(4, Math.round(c.getLength() / 0.03)), r, radial, closed);
}
function rod(a, b, r, radial = RAD, r2 = r) {
  const A = V3(a), B = V3(b);
  const g = new THREE.CylinderGeometry(r2, r, A.distanceTo(B), radial);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  return g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
}
const box = (c, s) => new THREE.BoxGeometry(s[0], s[1], s[2]).translate(c[0], c[1], c[2]);
function helix(c, r, h, turns, tr) {
  const pts = [];
  for (let i = 0; i <= turns * 12; i++) { const a = (i / 12) * Math.PI * 2; pts.push([c[0] + Math.cos(a) * r, c[1] + (h * i) / (turns * 12), c[2] + Math.sin(a) * r]); }
  return tube(pts, tr, turns * 12, false, 5);
}
// rounded-rectangle loop in a horizontal plane
function rectLoop(x0, x1, z0, z1, y, rc = 0.04) {
  const pts = [];
  const corners = [[x1 - rc, z0 + rc, -Math.PI / 2], [x1 - rc, z1 - rc, 0], [x0 + rc, z1 - rc, Math.PI / 2], [x0 + rc, z0 + rc, Math.PI]];
  for (const [cx, cz, a0] of corners) for (let k = 0; k <= 3; k++) { const a = a0 + (k / 3) * (Math.PI / 2); pts.push([cx + Math.cos(a) * rc, y, cz + Math.sin(a) * rc]); }
  return pts;
}

// grid sheet from rows of points (rows x cols), oriented so its normals face `out(p)`,
// optionally doubled with a back face `thick` behind it
function sheet(rows, out, thick = 0.004) {
  const nr = rows.length, nc = rows[0].length;
  const pos = [], idx = [];
  for (const r of rows) for (const p of r) pos.push(p[0], p[1], p[2]);
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < nc - 1; j++) {
    const a = i * nc + j, b = a + 1, c = a + nc, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const mk = (flip) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos.slice(), 3));
    g.setIndex(flip ? idx.map((_, i) => idx[i - (i % 3) + (2 - (i % 3))]) : idx.slice());
    g.computeVertexNormals();
    return g;
  };
  let g = mk(false);
  const mid = Math.floor(nr / 2) * nc + Math.floor(nc / 2);
  const P = new THREE.Vector3().fromBufferAttribute(g.attributes.position, mid);
  const N = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, mid);
  const flip = N.dot(out(P)) < 0;
  if (flip) g = mk(true);
  if (!thick) return g;
  const back = mk(!flip);
  const bp = back.attributes.position, bn = g.attributes.normal;
  for (let i = 0; i < bp.count; i++) bp.setXYZ(i, bp.getX(i) - bn.getX(i) * thick, bp.getY(i) - bn.getY(i) * thick, bp.getZ(i) - bn.getZ(i) * thick);
  back.computeVertexNormals();
  return mergeGeometries([g, back]);
}

// fender shell swept along an arc around a wheel (in the y-z plane). theta 0 = top,
// negative = forward. prof: [[x, radialOffset], ...] across the fender.
function fender(c, ry, rz, a0, a1, prof, n = 24) {
  const rows = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n, ca = Math.cos(a), sa = Math.sin(a);
    rows.push(prof.map(([x, dr]) => [c[0] + x, c[1] + (ry + dr) * ca, c[2] + (rz + dr) * sa]));
  }
  return sheet(rows, (p) => new THREE.Vector3(0, p.y - c[1], p.z - c[2]), 0.004);
}

// body loft: keys [z, halfWidth, bottom, top], sampled smoothly; ring mirrored about x = 0
function loftBody(keys, step = 0.04) {
  const zs = [];
  for (let z = keys[0][0]; z < keys[keys.length - 1][0] - 1e-6; z += step) zs.push(z);
  zs.push(keys[keys.length - 1][0]);
  const at = (z) => {
    let i = 0;
    while (i < keys.length - 2 && z > keys[i + 1][0]) i++;
    const A = keys[i], B = keys[i + 1], t = (z - A[0]) / (B[0] - A[0]), s = t * t * (3 - 2 * t);
    return [A[1] + (B[1] - A[1]) * s, A[2] + (B[2] - A[2]) * s, A[3] + (B[3] - A[3]) * s];
  };
  const half = (w, b, t) => [[0, b], [w - 0.05, b], [w, b + 0.05], [w, t - 0.07], [w - 0.025, t - 0.02], [w - 0.09, t], [0, t + 0.01]];
  const rings = zs.map((z) => {
    const [w, b, t] = at(z), P = half(w, b, t), ring = [];
    for (let i = P.length - 1; i > 0; i--) ring.push([-P[i][0], P[i][1]]);
    for (const p of P) ring.push(p);
    return ring;
  });
  const n = rings[0].length, pos = [], idx = [];
  zs.forEach((z, k) => { for (const [x, y] of rings[k]) pos.push(x, y, z); });
  for (let k = 0; k < zs.length - 1; k++) for (let i = 0; i < n - 1; i++) { const a = k * n + i, b = a + n; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  for (const [k, flip] of [[0, false], [zs.length - 1, true]]) {
    const c = pos.length / 3, ring = rings[k];
    pos.push(0, ring.reduce((s, p) => s + p[1], 0) / ring.length, zs[k]);
    for (let i = 0; i < n - 1; i++) { const a = k * n + i; if (flip) idx.push(c, a + 1, a); else idx.push(c, a, a + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // outward check on the widest ring
  const mid = Math.floor(zs.length / 2) * n + Math.floor(n * 0.7);
  const P = new THREE.Vector3().fromBufferAttribute(g.attributes.position, mid), N = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, mid);
  if (N.x * P.x + N.y * (P.y - 0.65) < 0) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.computeVertexNormals(); }
  return g;
}

// lathe around the x axle from [radius, axial] points, with a colour per vertex
function latheX(prof, segs, colorAt) {
  const g = new THREE.LatheGeometry(prof.map(([r, a]) => new THREE.Vector2(r, a)), segs).rotateZ(Math.PI / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    c.set(colorAt(Math.hypot(p.getY(i), p.getZ(i)), p.getX(i)));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function blobTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(0,0,0,0.62)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.38)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let BLOB = null;
function blob(w, l) {
  BLOB ??= new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, color: 0x2a1c14 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2), BLOB);
  m.renderOrder = 1;
  return m;
}

// a pivot whose local +y is the steering axis through `top` (a, b: two points on it)
function steerPivot(top, bottom) {
  const pivot = new THREE.Object3D();
  pivot.position.copy(V3(top));
  pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), V3(top).sub(V3(bottom)).normalize());
  pivot.updateMatrix();
  return { pivot, inv: pivot.matrix.clone().invert() };
}

// ---------------------------------------------------------------------------
// beach cruiser

const FRAME = 0xf0afbe, CREAM = 0xf4ecda, CHROME = 0xeeeeee, TYRE = 0x1c1b1a, WALL = 0xefe6d0;
const SADDLE = 0x5b3a26, GRIP = 0x6a4631, WICKER = 0xc9a268, WICKER2 = 0xb08650, DARK = 0x2a2b2d;

function bikeWheel(R, TR, rear) {
  const P = new Parts();
  const Rc = R - TR, tyreProf = [];
  // the section from bead to bead over the tread (the inside is hidden by the rim)
  for (let i = 0; i <= 22; i++) { const a = -2.15 + (i / 22) * 4.3; tyreProf.push([Rc + TR * Math.cos(a), 0.062 * Math.sin(a)]); }
  P.addColored(latheX(tyreProf, [32, 40, 56][DETAIL], (r, ax) => (Math.abs(ax) > 0.03 && r > Rc - 0.03 && r < Rc + 0.012 ? WALL : TYRE)), 0, 0.85);
  const rimR = Rc - TR * 0.55;
  P.add(new THREE.CylinderGeometry(rimR, rimR, 0.05, 48, 1, true).rotateZ(Math.PI / 2), CHROME, 1, 0.16);
  for (const s of [-1, 1]) P.add(new THREE.TorusGeometry(rimR, 0.006, 5, 48).rotateY(Math.PI / 2).translate(s * 0.025, 0, 0), CHROME, 1, 0.16);
  const hubR = rear ? 0.045 : 0.03;
  P.add(new THREE.CylinderGeometry(hubR, hubR, rear ? 0.12 : 0.1, 16).rotateZ(Math.PI / 2), CHROME, 1, 0.2);
  for (const s of [-1, 1]) P.add(new THREE.CylinderGeometry(0.042, 0.042, 0.006, 16).rotateZ(Math.PI / 2).translate(s * 0.036, 0, 0), CHROME, 1, 0.2);
  P.add(new THREE.CylinderGeometry(0.009, 0.009, 0.16, 6).rotateZ(Math.PI / 2), 0x9a9a9a, 1, 0.3);
  if (rear) P.add(new THREE.CylinderGeometry(0.038, 0.038, 0.006, 18).rotateZ(Math.PI / 2).translate(0.065, 0, 0), DARK, 0.7, 0.4);
  const nS = [20, 28, 36][DETAIL];
  for (let i = 0; i < nS; i++) {
    const a = (i / nS) * Math.PI * 2, s = i % 2 ? 1 : -1, cr = ((i >> 1) % 2 ? 1 : -1) * 0.32;
    P.add(rod([s * 0.036, 0.04 * Math.cos(a), 0.04 * Math.sin(a)], [s * 0.008, (rimR - 0.004) * Math.cos(a + cr), (rimR - 0.004) * Math.sin(a + cr)], 0.0019, 3), CHROME, 1, 0.25);
  }
  return P;
}

export function buildBike(mat = vehicleMaterial()) {
  const R = 0.335, TR = 0.055;
  const FA = [0, R, -0.7], RA = [0, R, 0.52], BB = [0, 0.29, 0];
  const HT_T = [0, 0.93, -0.44], HT_B = [0, 0.735, -0.515];
  const root = new THREE.Group(), tilt = new THREE.Group();
  root.add(tilt);
  const pink = (g) => F.add(g, FRAME, 0.15, 0.32);
  const F = new Parts();
  // cantilever frame: swooping top tube into the seat stays, twin lower tube, down tube
  pink(tube([[0, 0.75, -0.505], [0, 0.6, -0.45], [0, 0.42, -0.26], [0, 0.31, -0.06], BB], 0.021));
  pink(tube([[0, 0.905, -0.447], [0, 0.845, -0.22], [0, 0.795, 0.05], [0, 0.77, 0.2]], 0.02));
  for (const s of [-1, 1]) {
    pink(tube([[0, 0.797, 0.1], [s * 0.02, 0.75, 0.27], [s * 0.045, 0.57, 0.44], [s * 0.055, R + 0.01, 0.52]], 0.013));
    pink(rod([s * 0.025, 0.29, 0.01], [s * 0.056, R, 0.52], 0.013));
    F.add(box([s * 0.058, R, 0.52], [0.008, 0.05, 0.04]), 0xb9b9b9, 1, 0.3);
  }
  pink(tube([[0, 0.665, -0.475], [0, 0.61, -0.25], [0, 0.56, -0.03], [0, 0.5, 0.092]], 0.017));
  pink(rod(BB, [0, 0.87, 0.254], 0.02));
  pink(rod([0, 0.71, -0.525], [0, 0.955, -0.43], 0.026));
  for (const p of [[0, 0.71, -0.525], [0, 0.955, -0.43]]) F.add(rod([p[0], p[1] - 0.012, p[2] - 0.005], [p[0], p[1] + 0.012, p[2] + 0.005], 0.031, 14), CHROME, 1, 0.18);
  pink(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 14).rotateZ(Math.PI / 2).translate(...BB));
  // rear fender (cream) and its stays
  F.add(fender(RA, R + 0.04, R + 0.04, -0.35, 2.15, [[-0.07, -0.032], [-0.05, -0.012], [-0.025, -0.002], [0, 0], [0.025, -0.002], [0.05, -0.012], [0.07, -0.032]]), CREAM, 0.1, 0.35);
  for (const s of [-1, 1]) F.add(rod([s * 0.06, R, 0.52], [s * 0.062, R + 0.3 * Math.cos(1.5), 0.52 + 0.33 * Math.sin(1.5)], 0.004, 4), CHROME, 1, 0.2);
  F.add(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 16).rotateX(Math.PI / 2).rotateX(-0.5).translate(0, R + 0.36 * Math.cos(1.95), 0.52 + 0.36 * Math.sin(1.95) + 0.01), 0xc0302a, 0.1, 0.3, 0.3);   // tail reflector
  // chain guard: a cream teardrop plate over the chain, rolled edge
  {
    const sh = new THREE.Shape(), rc = 0.118;
    for (let i = 0; i <= 14; i++) { const a = Math.PI / 2 + (i / 14) * Math.PI; const x = rc * Math.cos(a), y = rc * Math.sin(a); if (i) sh.lineTo(x, y); else sh.moveTo(x, y); }
    sh.lineTo(0.47, -0.005);
    for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; sh.lineTo(0.47 + 0.045 * Math.cos(a), 0.04 + 0.045 * Math.sin(a)); }
    sh.lineTo(0.0, rc);
    const g = new THREE.ShapeGeometry(sh, 6);
    const m4 = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)).setPosition(0.088, 0.29, 0);
    g.applyMatrix4(m4);
    // a thin double-sided plate
    const flat = new THREE.BufferGeometry();
    flat.setAttribute('position', g.attributes.position.clone());
    flat.setIndex(g.index.clone());
    flat.computeVertexNormals();
    const n0 = new THREE.Vector3().fromBufferAttribute(flat.attributes.normal, 0);
    if (n0.x < 0) { const a = flat.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } flat.computeVertexNormals(); }
    const backG = flat.clone();
    { const a = backG.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } backG.translate(-0.004, 0, 0); backG.computeVertexNormals(); }
    F.add(flat, CREAM, 0.1, 0.35); F.add(backG, CREAM, 0.1, 0.35);
    const outline = sh.getPoints(4).map((p) => [0.088, 0.29 + p.y, p.x]);
    F.add(tube(outline, 0.005, outline.length * 2, true, 5), CREAM, 0.1, 0.35);
  }
  // chain (under the guard), coaster brake arm
  for (const s of [1, -1]) F.add(rod([0.066, 0.29 + s * 0.1, 0], [0.066, R + s * 0.036, 0.52], 0.005, 4), DARK, 0.6, 0.5);
  F.add(rod([-0.056, R, 0.5], [-0.034, 0.305, 0.25], 0.008, 5), DARK, 0.6, 0.5);
  // seat post, sprung saddle
  F.add(rod([0, 0.86, 0.25], [0, 0.955, 0.29], 0.013), CHROME, 1, 0.16);
  {
    const g = new THREE.SphereGeometry(1, 24, 12);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const f = 0.42 + 0.58 * THREE.MathUtils.smoothstep(z, -0.9, 0.35);
      p.setXYZ(i, x * 0.135 * f, y * (y > 0 ? 0.05 : 0.03), z * 0.145);
    }
    g.computeVertexNormals();
    F.add(g.rotateX(0.06).translate(0, 1.0, 0.32), SADDLE, 0, 0.5);
    F.add(new THREE.CylinderGeometry(0.1, 0.12, 0.012, 20).scale(1, 1, 1.05).translate(0, 0.975, 0.35), DARK, 0.5, 0.5);
  }
  for (const s of [-1, 1]) {
    F.add(helix([s * 0.075, 0.935, 0.41], 0.016, 0.042, 5, 0.0035), CHROME, 1, 0.2);
    F.add(rod([0, 0.955, 0.29], [s * 0.075, 0.935, 0.41], 0.005, 5), CHROME, 1, 0.2);
  }
  F.add(rod([0, 0.955, 0.29], [0, 0.985, 0.2], 0.006, 5), CHROME, 1, 0.2);
  const frameMesh = F.mesh(mat);
  tilt.add(frameMesh);

  // steering: fork, stem, swept-back bars, grips, bell, front fender, wicker basket
  const { pivot, inv } = steerPivot(HT_T, HT_B);
  const steer = new THREE.Group();
  pivot.add(steer);
  tilt.add(pivot);
  const S = new Parts();
  S.add(box([0, 0.712, -0.522], [0.13, 0.035, 0.05]), FRAME, 0.15, 0.32);
  for (const s of [-1, 1]) S.add(tube([[s * 0.05, 0.712, -0.522], [s * 0.052, 0.55, -0.586], [s * 0.053, 0.43, -0.648], [s * 0.054, R, -0.7]], 0.013), FRAME, 0.15, 0.32);
  S.add(rod([0, 0.93, -0.44], [0, 1.0, -0.413], 0.012), CHROME, 1, 0.16);
  S.add(rod([0, 1.0, -0.413], [0, 1.005, -0.47], 0.013), CHROME, 1, 0.16);
  const bar = [[-0.345, 1.1, -0.1], [-0.33, 1.096, -0.2], [-0.27, 1.075, -0.33], [-0.16, 1.035, -0.44], [-0.05, 1.008, -0.47], [0.05, 1.008, -0.47], [0.16, 1.035, -0.44], [0.27, 1.075, -0.33], [0.33, 1.096, -0.2], [0.345, 1.1, -0.1]];
  S.add(tube(bar, 0.011, 80), CHROME, 1, 0.14);
  for (const s of [-1, 1]) {
    S.add(rod([s * 0.346, 1.1, -0.085], [s * 0.334, 1.097, -0.21], 0.018, 12), GRIP, 0, 0.7);
    S.add(new THREE.SphereGeometry(0.019, 10, 6).scale(1, 1, 0.5).translate(s * 0.346, 1.1, -0.082), GRIP, 0, 0.7);
  }
  S.add(new THREE.SphereGeometry(0.03, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(-0.2, 1.06, -0.42), CHROME, 1, 0.12);
  S.add(fender(FA, R + 0.04, R + 0.04, -1.05, 1.85, [[-0.07, -0.032], [-0.05, -0.012], [-0.025, -0.002], [0, 0], [0.025, -0.002], [0.05, -0.012], [0.07, -0.032]]), CREAM, 0.1, 0.35);
  for (const s of [-1, 1]) S.add(rod([s * 0.057, R, -0.7], [s * 0.06, R + 0.31 * Math.cos(-0.9), -0.7 + 0.33 * Math.sin(-0.9)], 0.004, 4), CHROME, 1, 0.2);
  {
    // wicker basket: tapered woven walls, a thick rolled rim, stays to the axle and the bars
    const y0 = 0.8, y1 = 1.03, z0 = -0.665, z1 = -0.945;
    const hw = (y) => 0.175 + (y - y0) * 0.12, cz = (z0 + z1) / 2, hd = (y) => (z0 - z1) / 2 + (y - y0) * 0.08;
    const wallRows = [];
    for (let k = 0; k <= 6; k++) {
      const y = y0 + ((y1 - y0) * k) / 6;
      wallRows.push(rectLoop(-hw(y), hw(y), cz - hd(y), cz + hd(y), y, 0.035));
    }
    S.add(sheet(wallRows, (p) => new THREE.Vector3(p.x, 0, p.z - cz), 0.004), WICKER2, 0, 0.85);
    const nW = 9;
    for (let k = 0; k < nW; k++) {
      const y = y0 + 0.012 + ((y1 - y0 - 0.02) * k) / (nW - 1), e = 0.004;
      S.add(tube(rectLoop(-hw(y) - e, hw(y) + e, cz - hd(y) - e, cz + hd(y) + e, y, 0.035), 0.0085, 64, true, 5), k % 2 ? WICKER : 0xd6b27a, 0, 0.85);
    }
    S.add(tube(rectLoop(-hw(y1) - 0.006, hw(y1) + 0.006, cz - hd(y1) - 0.006, cz + hd(y1) + 0.006, y1 + 0.006, 0.04), 0.013, 64, true, 6), WICKER2, 0, 0.8);
    S.add(box([0, y0 + 0.004, cz], [2 * hw(y0), 0.008, 2 * hd(y0)]), WICKER2, 0, 0.9);
    for (const s of [-1, 1]) {
      S.add(rod([s * 0.13, y0, cz + 0.05], [s * 0.058, R + 0.01, -0.7], 0.0045, 5), CHROME, 1, 0.2);
      S.add(rod([s * 0.1, y1 - 0.02, z0 + 0.01], [s * 0.1, 1.03, -0.45], 0.005, 5), CHROME, 1, 0.2);
    }
  }
  const steerMesh = S.mesh(mat, { matrix: inv });
  steer.add(steerMesh);

  // wheels (the front one rides in the steering frame)
  const wheelF = bikeWheel(R, TR, false).mesh(mat);
  const wheelR = bikeWheel(R, TR, true).mesh(mat);
  const fHold = new THREE.Object3D();
  fHold.position.copy(V3(FA).applyMatrix4(inv));
  fHold.quaternion.copy(pivot.quaternion).invert();
  fHold.add(wheelF);
  steer.add(fHold);
  wheelR.position.copy(V3(RA));
  tilt.add(wheelR);

  // cranks and pedals (pedals stay level)
  const crank = new THREE.Group();
  crank.position.copy(V3(BB));
  tilt.add(crank);
  const C = new Parts();
  C.add(new THREE.CylinderGeometry(0.1, 0.1, 0.006, 32).rotateZ(Math.PI / 2).translate(0.066, 0, 0), 0x8e9093, 1, 0.3);
  C.add(new THREE.CylinderGeometry(0.07, 0.07, 0.008, 24).rotateZ(Math.PI / 2).translate(0.067, 0, 0), FRAME, 0.15, 0.35);
  C.add(rod([0.08, 0, 0], [0.086, -0.165, 0], 0.011), CHROME, 1, 0.18);
  C.add(rod([-0.08, 0, 0], [-0.086, 0.165, 0], 0.011), CHROME, 1, 0.18);
  C.add(new THREE.CylinderGeometry(0.012, 0.012, 0.17, 8).rotateZ(Math.PI / 2), CHROME, 1, 0.2);
  crank.add(C.mesh(mat));
  const pedals = [];
  for (const s of [-1, 1]) {
    const hold = new THREE.Object3D();
    hold.position.set(s * 0.09, s * -0.165, 0);
    const Pp = new Parts();
    Pp.add(box([s * 0.06, 0, 0], [0.095, 0.022, 0.068]), 0x222222, 0, 0.75);
    for (const z of [-0.036, 0.036]) Pp.add(box([s * 0.06, 0, z], [0.1, 0.026, 0.006]), CHROME, 1, 0.25);
    Pp.add(box([s * 0.06, 0, 0], [0.012, 0.008, 0.07]).translate(s * 0.05, 0, 0), 0xffb13a, 0, 0.4, 0.25);   // amber reflector
    hold.add(Pp.mesh(mat));
    crank.add(hold);
    pedals.push(hold);
  }

  // kickstand (left, behind the bottom bracket)
  const kick = new THREE.Group();
  kick.position.set(-0.05, 0.3, 0.12);
  const K = new Parts();
  K.add(rod([0, 0, 0], [0, -0.315, 0], 0.009, 6), CHROME, 1, 0.22);
  K.add(new THREE.SphereGeometry(0.014, 8, 6).scale(1.4, 0.5, 1.4).translate(0, -0.318, 0), 0x333333, 0, 0.8);
  kick.add(K.mesh(mat));
  tilt.add(kick);

  const shadow = blob(0.85, 1.9);
  return { root, tilt, steer, wheelF, wheelR, crank, pedals, kick, shadow, mat, R };
}

// ---------------------------------------------------------------------------
// lifeguard ATV

const RED = 0xc4231d, BLACK = 0x1c1d1f, TUBEC = 0x232527, GREY = 0x7c8086, SEAT = 0x1a1b1d;

function knobbyWheel(R, w, side) {
  const P = new Parts();
  const hw = w / 2;
  const prof = [[0.19, -hw * 0.85], [0.215, -hw * 0.98], [0.245, -hw], [0.272, -hw * 0.96], [0.286, -hw * 0.8], [0.292, -hw * 0.45], [0.293, 0],
    [0.292, hw * 0.45], [0.286, hw * 0.8], [0.272, hw * 0.96], [0.245, hw], [0.215, hw * 0.98], [0.19, hw * 0.85]];
  P.addColored(latheX(prof, [28, 36, 48][DETAIL], () => 0x1b1b1b), 0, 0.9);
  const nK = [14, 18, 22][DETAIL];
  const rT = 0.293;
  for (let i = 0; i < nK; i++) {
    const a = (i / nK) * Math.PI * 2, a2 = a + Math.PI / nK;
    for (const [ax, aa, lw] of [[-hw * 0.22, a, 0.05], [hw * 0.22, a2, 0.05]]) P.add(box([ax, rT + 0.011, 0], [lw, 0.022, 0.048]).rotateX(aa), 0x1e1e1e, 0, 0.9);
    for (const s of [-1, 1]) P.add(box([s * hw * 0.8, 0.283 + 0.008, 0], [0.05, 0.02, 0.042]).rotateY(s * 0.25).rotateX(s > 0 ? a : a2), 0x1e1e1e, 0, 0.9);
  }
  // dished steel wheel, lug nuts on the outer face
  P.add(new THREE.CylinderGeometry(0.192, 0.192, w * 0.86, 28, 1, true).rotateZ(Math.PI / 2), GREY, 0.55, 0.45);
  const fx = side * w * 0.2;
  P.add(new THREE.CylinderGeometry(0.19, 0.19, 0.012, 28).rotateZ(Math.PI / 2).translate(fx, 0, 0), GREY, 0.55, 0.45);
  P.add(new THREE.TorusGeometry(0.19, 0.012, 6, 28).rotateY(Math.PI / 2).translate(side * w * 0.43, 0, 0), GREY, 0.55, 0.4);
  P.add(new THREE.CylinderGeometry(0.055, 0.06, 0.04, 16).rotateZ(side * Math.PI / 2).translate(fx + side * 0.02, 0, 0), 0x9ea2a7, 0.8, 0.3);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    P.add(new THREE.CylinderGeometry(0.011, 0.011, 0.02, 6).rotateZ(Math.PI / 2).translate(fx + side * 0.012, Math.cos(a) * 0.085, Math.sin(a) * 0.085), 0xb9bcc0, 0.9, 0.3);
  }
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    P.add(new THREE.CylinderGeometry(0.022, 0.022, 0.014, 10).rotateZ(Math.PI / 2).translate(fx, Math.cos(a) * 0.14, Math.sin(a) * 0.14), 0x5f6368, 0.5, 0.5);   // vent holes (dark)
  }
  return P;
}

export function buildAtv(mat = vehicleMaterial()) {
  const R = 0.31;
  const root = new THREE.Group(), tilt = new THREE.Group();
  root.add(tilt);
  const B = new Parts();
  const red = (g) => B.add(g, RED, 0.05, 0.34);
  const tub = (g) => B.add(g, TUBEC, 0.5, 0.45);
  // body
  red(loftBody([[-1.0, 0.24, 0.5, 0.62], [-0.92, 0.29, 0.46, 0.74], [-0.7, 0.3, 0.45, 0.8], [-0.5, 0.27, 0.45, 0.86], [-0.3, 0.22, 0.45, 0.9],
    [-0.1, 0.18, 0.42, 0.84], [0.3, 0.2, 0.42, 0.84], [0.55, 0.3, 0.45, 0.8], [0.9, 0.3, 0.46, 0.77], [1.0, 0.26, 0.5, 0.64]]));
  // fenders: flat-topped arcs over each wheel, the outer lip rolled down
  const prof = (s) => [[0.2, -0.01], [0.27, 0], [0.4, 0.012], [0.52, 0.004], [0.6, -0.028], [0.628, -0.1]].map(([x, d]) => [s * x - s * 0.49, d]);
  for (const s of [-1, 1]) {
    red(fender([s * 0.49, R, -0.625], 0.39, 0.44, -1.25, 1.45, prof(s), 28));
    red(fender([s * 0.47, R, 0.625], 0.39, 0.44, -1.45, 1.3, prof(s).map(([x, d]) => [x + s * 0.02, d]), 28));
    // floorboards: ribbed black plates with a raised outer lip
    B.add(box([s * 0.4, 0.345, 0], [0.4, 0.03, 0.5]), BLACK, 0, 0.8);
    for (let z = -0.21; z <= 0.21; z += 0.06) B.add(box([s * 0.4, 0.365, z], [0.36, 0.012, 0.018]), 0x2a2b2d, 0, 0.8);
    B.add(box([s * 0.595, 0.385, 0], [0.025, 0.07, 0.5]), BLACK, 0, 0.8);
    // front A-arms and shocks (red springs), rear shocks
    for (const y of [0.29, 0.42]) tub(tube([[s * 0.12, y, -0.52], [s * 0.36, y, -0.625], [s * 0.12, y, -0.72]], 0.013, 12));
    B.add(rod([s * 0.31, 0.33, -0.6], [s * 0.18, 0.68, -0.6], 0.012), 0x9fa3a8, 0.8, 0.3);
    B.add(helix([0, 0, 0], 0.028, 0.2, 7, 0.006).applyMatrix4(new THREE.Matrix4().makeRotationZ(s * 0.36)).translate(s * 0.285, 0.38, -0.6), 0xd23a2a, 0.3, 0.4);
    B.add(rod([s * 0.26, R + 0.02, 0.6], [s * 0.18, 0.7, 0.45], 0.013), 0x9fa3a8, 0.8, 0.3);
    // headlights in the front fascia
    B.add(new THREE.SphereGeometry(0.055, 16, 10).scale(1.2, 0.8, 0.45).translate(s * 0.15, 0.6, -0.995), 0xfff2dc, 0.2, 0.1, 0.6);
    B.add(new THREE.TorusGeometry(0.058, 0.009, 6, 18).scale(1.2, 0.8, 1).translate(s * 0.15, 0.6, -0.99), 0x2a2a2a, 0.6, 0.4);
  }
  B.add(box([0, 0.52, -1.0], [0.16, 0.08, 0.02]), BLACK, 0, 0.7);   // grille
  // seat, tank cap, engine, exhaust
  B.add(new RoundedBoxGeometry(0.36, 0.13, 0.76, 3, 0.05).translate(0, 0.905, 0.25), SEAT, 0, 0.55);
  B.add(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 16).translate(0, 0.905, -0.27), 0xb0b3b7, 0.9, 0.25);
  B.add(box([0, 0.36, 0.02], [0.34, 0.26, 0.5]), 0x3a3c3f, 0.4, 0.6);
  B.add(new THREE.CylinderGeometry(0.085, 0.085, 0.16, 14).translate(0, 0.48, -0.18), 0x55585c, 0.6, 0.5);
  for (let k = 0; k < 5; k++) B.add(new THREE.CylinderGeometry(0.1, 0.1, 0.008, 14).translate(0, 0.42 + k * 0.03, -0.18), 0x6a6d71, 0.6, 0.5);
  B.add(tube([[0.08, 0.5, -0.26], [0.25, 0.52, -0.1], [0.3, 0.58, 0.3], [0.3, 0.63, 0.46]], 0.024, 30), 0xa4a7ab, 0.8, 0.35);
  B.add(new THREE.CylinderGeometry(0.062, 0.062, 0.36, 16).rotateX(Math.PI / 2).translate(0.3, 0.64, 0.64), 0x3b3d40, 0.6, 0.45);
  B.add(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 10).rotateX(Math.PI / 2).translate(0.3, 0.64, 0.845), 0xd4d6d9, 1, 0.2);
  B.add(new THREE.CylinderGeometry(0.035, 0.035, 1.0, 12).rotateZ(Math.PI / 2).translate(0, R, 0.625), 0x2c2e30, 0.5, 0.5);   // rear axle
  // front and rear racks, brush guard
  const rack = (x0, x1, z0, z1, y) => {
    tub(tube(rectLoop(x0, x1, z0, z1, y, 0.05), 0.014, 60, true));
    for (let k = 1; k < 4; k++) { const x = x0 + ((x1 - x0) * k) / 4; tub(rod([x, y, z0 + 0.02], [x, y, z1 - 0.02], 0.009, 6)); }
    for (let k = 1; k < 3; k++) { const z = z0 + ((z1 - z0) * k) / 3; tub(rod([x0 + 0.02, y, z], [x1 - 0.02, y, z], 0.009, 6)); }
  };
  rack(-0.45, 0.45, -1.06, -0.62, 0.86);
  for (const s of [-1, 1]) for (const z of [-1.0, -0.66]) tub(rod([s * 0.38, 0.86, z], [s * 0.36, z < -0.8 ? 0.62 : 0.72, z], 0.011, 6));
  rack(-0.48, 0.48, 0.42, 1.04, 0.86);
  for (const s of [-1, 1]) for (const z of [0.46, 1.0]) tub(rod([s * 0.42, 0.86, z], [s * 0.36, z > 0.8 ? 0.64 : 0.74, z], 0.011, 6));
  tub(tube([[-0.32, 0.45, -1.02], [-0.33, 0.64, -1.1], [-0.22, 0.72, -1.13], [0.22, 0.72, -1.13], [0.33, 0.64, -1.1], [0.32, 0.45, -1.02]], 0.019, 40));
  tub(rod([-0.31, 0.55, -1.07], [0.31, 0.55, -1.07], 0.014));
  for (const s of [-1, 1]) tub(rod([s * 0.2, 0.72, -1.12], [s * 0.2, 0.47, -1.02], 0.012));
  // light bar hoop over the rear rack, beacons, whip flag
  tub(tube([[-0.44, 0.86, 0.47], [-0.435, 1.28, 0.5], [-0.39, 1.41, 0.5], [0.39, 1.41, 0.5], [0.435, 1.28, 0.5], [0.44, 0.86, 0.47]], 0.02, 50));
  B.add(new RoundedBoxGeometry(0.76, 0.07, 0.11, 2, 0.02).translate(0, 1.465, 0.5), BLACK, 0.2, 0.5);
  for (let k = 0; k < 6; k++) {
    const x = -0.3 + k * 0.12, left = k < 3;
    const col = k % 2 ? 0xff3a28 : 0xffac30;
    for (const z of [0.444, 0.556]) B.add(box([x, 1.47, z], [0.1, 0.045, 0.006]), col, 0, 0.25, left ? 0.8 : 0.9);
  }
  tub(rod([0.44, 0.86, 1.0], [0.47, 2.35, 1.06], 0.005, 5));
  {
    const rows = [[[0.47, 2.34, 1.06], [0.47, 2.18, 1.06]], [[0.47, 2.29, 1.3], [0.47, 2.27, 1.3]]];
    B.add(sheet(rows, () => new THREE.Vector3(1, 0, 0), 0.003), 0xff6a1a, 0, 0.8);
  }
  // rescue can strapped across the rear rack, a white kit box
  B.add(new THREE.CapsuleGeometry(0.075, 0.42, 4, 14).rotateZ(Math.PI / 2).translate(0.02, 0.945, 0.9), 0xd8261c, 0.05, 0.35);
  for (const x of [-0.12, 0.16]) B.add(new THREE.TorusGeometry(0.078, 0.007, 5, 20).rotateY(Math.PI / 2).translate(x, 0.945, 0.9), 0x111111, 0, 0.7);
  B.add(new RoundedBoxGeometry(0.36, 0.2, 0.24, 2, 0.02).translate(-0.02, 0.965, 0.62), 0xeeebe4, 0, 0.5);
  B.add(box([-0.02, 1.0, 0.62], [0.365, 0.008, 0.245]), 0xb8b6b0, 0, 0.5);
  const body = B.mesh(mat);
  tilt.add(body);

  // handlebars on a tilted steering column
  const { pivot, inv } = steerPivot([0, 1.0, -0.4], [0, 0.86, -0.45]);
  const steer = new THREE.Group();
  pivot.add(steer);
  tilt.add(pivot);
  const H = new Parts();
  H.add(rod([0, 0.86, -0.45], [0, 1.0, -0.4], 0.02), TUBEC, 0.5, 0.45);
  H.add(new RoundedBoxGeometry(0.3, 0.09, 0.16, 2, 0.03).translate(0, 1.03, -0.45), RED, 0.05, 0.34);
  H.add(new THREE.SphereGeometry(0.035, 12, 8).scale(1.4, 0.8, 0.5).translate(0, 1.035, -0.53), 0xfff2dc, 0.2, 0.1, 0.6);
  H.add(tube([[-0.43, 1.085, -0.34], [-0.3, 1.065, -0.4], [-0.13, 1.05, -0.43], [0.13, 1.05, -0.43], [0.3, 1.065, -0.4], [0.43, 1.085, -0.34]], 0.013, 50), 0x9c9fa3, 0.8, 0.3);
  for (const s of [-1, 1]) {
    H.add(rod([s * 0.32, 1.068, -0.39], [s * 0.445, 1.088, -0.33], 0.02, 12), BLACK, 0, 0.8);
    H.add(tube([[s * 0.26, 1.07, -0.425], [s * 0.34, 1.07, -0.445], [s * 0.41, 1.072, -0.42]], 0.006, 10, false, 5), 0xb4b7bb, 0.9, 0.3);
    H.add(box([s * 0.25, 1.07, -0.41], [0.05, 0.04, 0.04]), BLACK, 0, 0.6);
  }
  steer.add(H.mesh(mat, { matrix: inv }));

  // wheels on suspension (front ones steer)
  const wheels = [];
  for (const [x, z, w] of [[-0.49, -0.625, 0.2], [0.49, -0.625, 0.2], [-0.47, 0.625, 0.25], [0.47, 0.625, 0.25]]) {
    const hold = new THREE.Object3D();
    hold.position.set(x, R, z);
    const m = knobbyWheel(R, w, Math.sign(x)).mesh(mat);
    hold.add(m);
    tilt.add(hold);
    wheels.push({ hold, mesh: m, x, z });
  }
  const shadow = blob(1.7, 2.6);
  return { root, tilt, steer, wheels, shadow, mat, R };
}
