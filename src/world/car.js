// Classic late-50s American-style convertible (no badges, no make): lofted body with
// long hood, tail fins and real wheel wells, open cockpit with cream bench seats,
// chrome bumpers and trim, whitewall tyres. A parked hero car at the west curb plus a
// moving variant driven by the audio engine's car passes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CAR, roadHeight } from './layout.js';

const LEN = 5.3, HALF = LEN / 2;
const WHEEL_R = 0.36, WHEELS_Z = [1.62, -1.52], TRACK = 0.8;
const ARCH_R = 0.45;
const OPEN = [-1.3, 0.74];   // cockpit (open) between these z

// ---------------------------------------------------------------------------
// body section parameters along z (car local: +z forward, +x = left side, y up)
function halfWidth(z) {
  let w = 1.0;
  if (z > 2.05) w -= 0.2 * ((z - 2.05) / (HALF - 2.05)) ** 2;
  if (z < -2.2) w -= 0.1 * ((-2.2 - z) / (HALF - 2.2)) ** 2;
  return w;
}
function belt(z) {
  if (z > 0.74) return 0.97 - 0.15 * Math.pow((z - 0.74) / (HALF - 0.74), 1.6);   // hood falls to the nose
  if (z < -1.0) return 0.94 + 0.17 * Math.pow(Math.min(1, (-1.0 - z) / 1.55), 1.8); // rising fins
  return 0.95;
}
function crown(z) {
  if (z > 0.74) return belt(z) + 0.035;
  return 0.92 - 0.05 * Math.pow(Math.max(0, (-2.0 - z) / 0.65), 2);                  // flat rear deck, below the fin tops
}
function archY(z) {
  let y = 0.3;
  for (const wz of WHEELS_Z) {
    const d = z - wz;
    if (Math.abs(d) < ARCH_R) y = Math.max(y, WHEEL_R + 0.02 + Math.sqrt(ARCH_R * ARCH_R - d * d) * 0.95);
  }
  return y;
}

function bodyGeometry() {
  const zs = [];
  for (let z = -HALF; z <= HALF + 1e-6; z += 0.05) zs.push(+z.toFixed(3));
  zs.push(OPEN[0] - 0.001, OPEN[0] + 0.001, OPEN[1] - 0.001, OPEN[1] + 0.001);
  zs.sort((a, b) => a - b);
  const section = (z) => {
    const W = halfWidth(z), open = z > OPEN[0] && z < OPEN[1];
    const ay = archY(z), inWell = ay > 0.31;
    const b = belt(z), c = crown(z);
    // right-side half profile from bottom centre to top centre (x >= 0)
    const P = [
      [0, 0.27], [W - 0.38, inWell ? ay : 0.27], [W - 0.05, inWell ? ay : 0.31],
      [W - 0.01, Math.max(0.46, inWell ? ay + 0.02 : 0.46)], [W, 0.62], [W - 0.015, 0.8],
      [W - 0.05, b], [W - 0.1, b + 0.012],
      open ? [W - 0.14, b - 0.04] : [W - 0.3, c - 0.004],
      open ? [W - 0.16, 0.5] : [W * 0.5, c + 0.004],
      open ? [0, 0.5] : [0, c + 0.006],
    ];
    const ring = [];
    for (let i = P.length - 1; i > 0; i--) ring.push([-P[i][0], P[i][1]]);   // left side (mirrored), top -> bottom
    for (const p of P) ring.push(p);                                            // right side, bottom -> top
    return ring;
  };
  const rings = zs.map(section);
  const n = rings[0].length;
  const pos = [], idx = [];
  zs.forEach((z, k) => { for (const [x, y] of rings[k]) pos.push(x, y, z); });
  for (let k = 0; k < zs.length - 1; k++) {
    for (let i = 0; i < n - 1; i++) {
      const a = k * n + i, b = a + n;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  // end caps (fan around the section centroid)
  for (const [k, flip] of [[0, true], [zs.length - 1, false]]) {
    const c = pos.length / 3;
    const ring = rings[k];
    const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    pos.push(0, cy, zs[k]);
    for (let i = 0; i < n - 1; i++) {
      const a = k * n + i;
      if (flip) idx.push(c, a + 1, a); else idx.push(c, a, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tube(points, r, seg = 24) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), seg, r, 10);
}

function tyreGeometry(flatten) {
  // lathe profile (radius, axial) around y, then turned onto the x axle
  const w = 0.105, pts = [];
  const prof = [[0.2, -w * 0.8], [0.25, -w], [0.31, -w * 1.02], [0.345, -w * 0.9], [WHEEL_R, -w * 0.55], [WHEEL_R + 0.004, 0],
    [WHEEL_R, w * 0.55], [0.345, w * 0.9], [0.31, w * 1.02], [0.25, w], [0.2, w * 0.8]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 36).rotateZ(Math.PI / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  const black = new THREE.Color(0x151515), white = new THREE.Color(0xe9e6dc);
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getY(i), p.getZ(i));
    const c = r > 0.235 && r < 0.305 ? white : black;   // whitewall band on both sidewalls
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    if (flatten && p.getY(i) < -(WHEEL_R - 0.018)) p.setY(i, -(WHEEL_R - 0.018));   // contact patch
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
function hubGeometry() {
  const pts = [[0.001, 0.07], [0.06, 0.068], [0.1, 0.055], [0.15, 0.04], [0.19, 0.03], [0.205, 0.0]].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 28).rotateZ(-Math.PI / 2);
}

function pleatTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = '#f0e6d2'; c.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 16; i++) {
    const g = c.createLinearGradient(i * 16, 0, i * 16 + 16, 0);
    g.addColorStop(0, 'rgba(120,100,70,0.35)'); g.addColorStop(0.2, 'rgba(255,255,255,0.15)'); g.addColorStop(0.8, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(120,100,70,0.3)');
    c.fillStyle = g; c.fillRect(i * 16, 0, 16, 64);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function blobTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.filter = 'blur(10px)';
  c.fillStyle = 'rgba(0,0,0,0.92)';
  c.fillRect(30, 14, 68, 100);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// shared (paint-independent) materials and geometry
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const chrome = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, metalness: 1, roughness: 0.08, envMapIntensity: 1.4 });
  const rubber = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const leather = new THREE.MeshStandardMaterial({ map: pleatTexture(), color: 0xfffaf0, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.8 });
  const carpet = new THREE.MeshStandardMaterial({ color: 0x3a3430, roughness: 0.95 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xdfeceb, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.22, envMapIntensity: 1.5, depthWrite: false, side: THREE.DoubleSide });
  const red = new THREE.MeshStandardMaterial({ color: 0xa3161a, roughness: 0.3, emissive: 0x3a0404 });
  const lens = new THREE.MeshStandardMaterial({ color: 0xf4f2e8, roughness: 0.1, metalness: 0.2 });
  const blob = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

  // chrome parts merged
  const W = halfWidth;
  const bumperF = tube([[-0.98, 0.42, 2.42], [-0.9, 0.42, 2.64], [-0.4, 0.41, 2.73], [0.4, 0.41, 2.73], [0.9, 0.42, 2.64], [0.98, 0.42, 2.42]], 0.085, 40);
  const bumperR = tube([[-0.98, 0.44, -2.5], [-0.9, 0.44, -2.68], [-0.4, 0.43, -2.74], [0.4, 0.43, -2.74], [0.9, 0.44, -2.68], [0.98, 0.44, -2.5]], 0.08, 40);
  const spear = (s) => tube([[s * (W(2.3) + 0.004), 0.66, 2.3], [s * (W(0) + 0.006), 0.62, 0], [s * (W(-1.6) + 0.006), 0.66, -1.6], [s * (W(-2.5) + 0.002), 0.78, -2.5]], 0.012, 40);
  const beltTrim = (s) => tube([[s * (W(0.7) - 0.07), belt(0.7) + 0.02, 0.7], [s * (W(-0.3) - 0.07), belt(-0.3) + 0.02, -0.3], [s * (W(-1.25) - 0.07), belt(-1.25) + 0.02, -1.25]], 0.014, 20);
  const frame = tube([[-0.93, 0.98, 0.74], [-0.9, 1.25, 0.57], [-0.84, 1.4, 0.46], [0, 1.43, 0.44], [0.84, 1.4, 0.46], [0.9, 1.25, 0.57], [0.93, 0.98, 0.74]], 0.02, 48);
  const grilleBars = [];
  for (let i = 0; i < 4; i++) grilleBars.push(new THREE.BoxGeometry(1.3, 0.018, 0.02).translate(0, 0.52 + i * 0.05, 2.64));
  const headRings = [], heads = [];
  for (const s of [-1, 1]) for (const dx of [0.62, 0.84]) {
    headRings.push(new THREE.TorusGeometry(0.085, 0.018, 8, 20).translate(s * dx, 0.72, 2.56));
    heads.push(new THREE.CircleGeometry(0.08, 20).translate(s * dx, 0.72, 2.565));
  }
  const gauge = new THREE.CylinderGeometry(0.1, 0.1, 0.02, 20).rotateX(Math.PI / 2 - 0.4).translate(0.42, 0.97, 0.52);
  const chromeGeo = mergeGeometries([bumperF, bumperR, spear(1), spear(-1), beltTrim(1), beltTrim(-1), frame, ...grilleBars, ...headRings, gauge]
    .map((g) => { g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv'); return g; }));

  // windshield glass: a gently curved pane inside the frame
  const gp = [], gi = [];
  for (let j = 0; j <= 1; j++) for (let i = 0; i <= 10; i++) {
    const u = i / 10 * 2 - 1;
    const y = j ? 1.4 : 0.98, z = (j ? 0.46 : 0.74) + Math.abs(u) ** 3 * 0.08;
    gp.push(u * (j ? 0.84 : 0.92), y, z);
  }
  for (let i = 0; i < 10; i++) gi.push(i, i + 11, i + 1, i + 1, i + 11, i + 12);
  const glassGeo = new THREE.BufferGeometry();
  glassGeo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  glassGeo.setIndex(gi);
  glassGeo.computeVertexNormals();

  // interior
  const seatParts = [
    new RoundedBoxGeometry(1.62, 0.18, 0.56, 3, 0.06).translate(0, 0.62, 0.02),
    new RoundedBoxGeometry(1.62, 0.5, 0.14, 3, 0.06).rotateX(-0.22).translate(0, 0.92, -0.3),
    new RoundedBoxGeometry(1.62, 0.18, 0.5, 3, 0.06).translate(0, 0.62, -0.85),
    new RoundedBoxGeometry(1.7, 0.42, 0.14, 3, 0.06).rotateX(-0.2).translate(0, 0.88, -1.17),
    new RoundedBoxGeometry(0.1, 0.36, 1.9, 2, 0.04).translate(0.84, 0.72, -0.4),   // door panels
    new RoundedBoxGeometry(0.1, 0.36, 1.9, 2, 0.04).translate(-0.84, 0.72, -0.4),
  ];
  const seatGeo = mergeGeometries(seatParts);
  const bootGeo = new RoundedBoxGeometry(1.64, 0.14, 0.34, 3, 0.06).translate(0, 0.97, -1.42);   // folded-top boot
  const wheelGeo = new THREE.TorusGeometry(0.2, 0.017, 8, 28).rotateX(0.45).translate(0.42, 1.0, 0.36);
  const column = new THREE.CylinderGeometry(0.022, 0.03, 0.42, 8).rotateX(Math.PI / 2 - 0.45).translate(0.42, 0.93, 0.5);
  const spokes = [0, 2.1, 4.2].map((a) => new THREE.BoxGeometry(0.2, 0.012, 0.012).translate(0.1, 0, 0).rotateZ(a).rotateX(0.45).translate(0.42, 1.0, 0.36));
  const darkGeo = mergeGeometries([
    wheelGeo, column, ...spokes,
    new THREE.BoxGeometry(1.5, 0.14, 4.1).translate(0, 0.24, 0),                           // chassis: dark core under the car
    new THREE.BoxGeometry(1.34, 0.2, 0.05).translate(0, 0.6, 2.625),                       // grille cavity
    ...WHEELS_Z.flatMap((z) => [-1, 1].map((s) => new THREE.CylinderGeometry(ARCH_R - 0.02, ARCH_R - 0.02, 0.36, 18, 1, true).rotateZ(Math.PI / 2).translate(s * (TRACK + 0.02), WHEEL_R + 0.03, z))),  // well liners
  ].map((g) => { g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv'); return g; }));
  const dashGeo = new RoundedBoxGeometry(1.74, 0.24, 0.34, 3, 0.07).translate(0, 0.86, 0.6);
  const carpetGeo = new THREE.PlaneGeometry(1.7, 2.0).rotateX(-Math.PI / 2).translate(0, 0.505, -0.3);
  const tails = mergeGeometries([-1, 1].map((s) => new THREE.CapsuleGeometry(0.05, 0.12, 4, 10).rotateX(Math.PI / 2).translate(s * 0.86, 0.98, -2.62)));
  const lensGeo = mergeGeometries(heads);

  SHARED = {
    chrome, rubber, leather, dark, carpet, glass, red, lens, blob,
    body: bodyGeometry(), chromeGeo, glassGeo, seatGeo, bootGeo, darkGeo, dashGeo, carpetGeo, tails, lensGeo,
    tyreFlat: tyreGeometry(true), tyre: tyreGeometry(false), hub: hubGeometry(),
  };
  return SHARED;
}

function makeCar({ paint, flatten, cast }) {
  const S = shared();
  const car = new THREE.Group();
  const paintMat = new THREE.MeshPhysicalMaterial({ color: paint, roughness: 0.3, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.2 });
  const add = (g, m) => { const o = new THREE.Mesh(g, m); car.add(o); return o; };
  add(S.body, paintMat);
  add(S.dashGeo, paintMat);
  add(S.chromeGeo, S.chrome);
  add(S.seatGeo, S.leather);
  add(S.bootGeo, S.leather);
  add(S.darkGeo, S.dark);
  add(S.carpetGeo, S.carpet);
  add(S.tails, S.red);
  add(S.lensGeo, S.lens);
  const glass = add(S.glassGeo, S.glass);
  glass.renderOrder = 2;
  const wheels = [];
  for (const z of WHEELS_Z) for (const s of [-1, 1]) {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(flatten ? S.tyreFlat : S.tyre, S.rubber));
    const hub = new THREE.Mesh(S.hub, S.chrome);
    hub.scale.x = s;
    hub.position.x = s * 0.095;
    w.add(hub);
    w.position.set(s * TRACK, WHEEL_R, z);
    car.add(w);
    wheels.push(w);
  }
  car.traverse((o) => { if (o.isMesh) { o.castShadow = cast && o.material !== S.glass; o.receiveShadow = true; } });
  // soft dark contact patch under the car
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 6.4).rotateX(-Math.PI / 2), S.blob);
  blob.position.y = 0.012;
  blob.renderOrder = 1;
  blob.castShadow = false;
  car.add(blob);
  return { car, wheels };
}

export function buildCars(scene) {
  // hero: parked at the west curb, facing south (the direction of the west lane), top down
  const hero = makeCar({ paint: 0x86cfc1, flatten: true, cast: true });
  hero.car.position.set(CAR.x, roadHeight(CAR.x), CAR.z);
  hero.car.rotation.z = -0.012;   // sits on the cambered parking lane
  scene.add(hero.car);

  // moving car: follows the audio engine's pass (hidden when no car is sounding)
  const mover = makeCar({ paint: 0xe8a4b8, flatten: false, cast: false });
  mover.car.visible = false;
  scene.add(mover.car);
  let spin = 0;
  return {
    hero: hero.car,
    update(dt, cars) {
      const c = cars && cars.find((k) => k.active && k.progress > 0 && k.progress < 1);
      if (!c) { mover.car.visible = false; return; }
      mover.car.visible = true;
      mover.car.position.set(c.x, roadHeight(c.x), c.z);
      mover.car.rotation.y = c.dir > 0 ? 0 : Math.PI;
      spin += (c.speed * dt) / WHEEL_R;
      for (const w of mover.wheels) w.rotation.x = spin;
    },
  };
}
