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
  const g = new THREE.LatheGeometry(pts, 48).rotateZ(Math.PI / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  const black = new THREE.Color(0x141414), white = new THREE.Color(0xf6f4ee);
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getY(i), p.getZ(i));
    const c = r > 0.255 && r < 0.3 ? white : black;   // whitewall band, ~1/3 of the sidewall
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    if (flatten && p.getY(i) < -(WHEEL_R - 0.018)) p.setY(i, -(WHEEL_R - 0.018));   // contact patch
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
function hubGeometry() {
  const pts = [[0.001, 0.085], [0.04, 0.084], [0.06, 0.07], [0.1, 0.06], [0.16, 0.05], [0.2, 0.035], [0.235, 0.02], [0.25, 0.0]].map(([r, y]) => new THREE.Vector2(r, y));
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
  c.filter = 'blur(7px)';
  c.fillStyle = 'rgba(0,0,0,0.97)';
  c.fillRect(22, 8, 84, 112);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// shared (paint-independent) materials and geometry
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const chrome = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.07, envMapIntensity: 1.3, side: THREE.DoubleSide });
  groundReflect(chrome, 'chrome', CAR_MAX_RADIANCE);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, metalness: 1, roughness: 0.16, envMapIntensity: 1.0, side: THREE.DoubleSide });
  groundReflect(hubMat, 'hub', CAR_MAX_RADIANCE);
  const rubber = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  clampRadiance(rubber, 'rubber');
  const canvasTop = new THREE.MeshStandardMaterial({ color: 0xb49a70, roughness: 0.95 });
  const ivory = new THREE.MeshStandardMaterial({ color: 0xf1ead8, roughness: 0.35 });
  const plate = new THREE.MeshStandardMaterial({ color: 0xf0ecdc, roughness: 0.5, metalness: 0.2 });
  const leather = new THREE.MeshStandardMaterial({ map: pleatTexture(), color: 0xfffaf0, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.8 });
  const carpet = new THREE.MeshStandardMaterial({ color: 0x3a3430, roughness: 0.95 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe4e0, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.38, envMapIntensity: 2.5, depthWrite: false, side: THREE.DoubleSide });
  const red = new THREE.MeshStandardMaterial({ color: 0xa3161a, roughness: 0.3, emissive: 0x3a0404 });
  const lens = new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.25, metalness: 0.1, envMapIntensity: 0.6 });
  clampRadiance(lens, 'lens');
  const blob = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

  // chrome parts merged
  const W = halfWidth;
  const bumperF = tube([[-0.98, 0.42, 2.42], [-0.9, 0.42, 2.64], [-0.4, 0.41, 2.73], [0.4, 0.41, 2.73], [0.9, 0.42, 2.64], [0.98, 0.42, 2.42]], 0.085, 40);
  const bumperR = tube([[-0.98, 0.44, -2.5], [-0.9, 0.44, -2.68], [-0.4, 0.43, -2.74], [0.4, 0.43, -2.74], [0.9, 0.44, -2.68], [0.98, 0.44, -2.5]], 0.08, 40);
  const spear = (s) => tube([[s * (W(2.3) + 0.004), 0.66, 2.3], [s * (W(0) + 0.006), 0.62, 0], [s * (W(-1.6) + 0.006), 0.66, -1.6], [s * (W(-2.5) + 0.002), 0.78, -2.5]], 0.012, 40);
  const beltTrim = (s) => tube([[s * (W(0.7) - 0.07), belt(0.7) + 0.02, 0.7], [s * (W(-0.3) - 0.07), belt(-0.3) + 0.02, -0.3], [s * (W(-1.25) - 0.07), belt(-1.25) + 0.02, -1.25]], 0.014, 20);
  const frame = tube([[-0.93, 0.98, 0.74], [-0.9, 1.25, 0.57], [-0.84, 1.4, 0.46], [0, 1.43, 0.44], [0.84, 1.4, 0.46], [0.9, 1.25, 0.57], [0.93, 0.98, 0.74]], 0.02, 48);
  const grilleBars = [];
  for (let i = 0; i < 5; i++) grilleBars.push(new THREE.BoxGeometry(1.36, 0.02, 0.03).translate(0, 0.5 + i * 0.045, 2.645));
  for (let i = 0; i < 9; i++) grilleBars.push(new THREE.BoxGeometry(0.018, 0.2, 0.03).translate(-0.6 + i * 0.15, 0.59, 2.645));
  grilleBars.push(tube([[-0.7, 0.48, 2.63], [-0.72, 0.6, 2.63], [-0.7, 0.71, 2.63], [0.7, 0.71, 2.63], [0.72, 0.6, 2.63], [0.7, 0.48, 2.63], [-0.7, 0.48, 2.63]], 0.016, 40));
  // hood centre strip, door handles, mirrors
  grilleBars.push(tube([[0, belt(2.5) + 0.04, 2.5], [0, belt(1.6) + 0.045, 1.6], [0, belt(0.8) + 0.04, 0.8]], 0.012, 16));
  for (const s of [-1, 1]) {
    grilleBars.push(new THREE.BoxGeometry(0.02, 0.025, 0.14).translate(s * (W(-0.3) + 0.01), 0.84, -0.32));
    grilleBars.push(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 6).translate(s * (W(0.55) - 0.06), belt(0.55) + 0.06, 0.55));
    grilleBars.push(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 16).rotateZ(Math.PI / 2).rotateY(0.3 * s).translate(s * (W(0.55) - 0.06), belt(0.55) + 0.14, 0.55));
  }
  const headRings = [], heads = [];
  for (const s of [-1, 1]) for (const dx of [0.62, 0.84]) {
    headRings.push(new THREE.TorusGeometry(0.095, 0.022, 8, 20).translate(s * dx, 0.73, 2.57));
    heads.push(new THREE.SphereGeometry(0.09, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.4).translate(s * dx, 0.73, 2.565));
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
  const bootGeo = new RoundedBoxGeometry(1.72, 0.16, 0.5, 4, 0.07).translate(0, 0.97, -1.46);    // tan canvas boot over the folded top
  const wheelGeo = new THREE.TorusGeometry(0.21, 0.022, 10, 32).rotateX(0.45).translate(0.42, 1.0, 0.36);
  const column = new THREE.CylinderGeometry(0.022, 0.03, 0.42, 8).rotateX(Math.PI / 2 - 0.45).translate(0.42, 0.93, 0.5);
  const spokes = [0, 2.1, 4.2].map((a) => new THREE.BoxGeometry(0.2, 0.012, 0.012).translate(0.1, 0, 0).rotateZ(a).rotateX(0.45).translate(0.42, 1.0, 0.36));
  const darkGeo = mergeGeometries([
    column,
    new THREE.BoxGeometry(1.7, 0.18, 4.6).translate(0, 0.2, 0),                            // chassis: dark core under the car
    new THREE.BoxGeometry(1.34, 0.2, 0.05).translate(0, 0.6, 2.625),                       // grille cavity
    ...WHEELS_Z.flatMap((z) => [-1, 1].map((s) => new THREE.CylinderGeometry(ARCH_R - 0.02, ARCH_R - 0.02, 0.36, 18, 1, true).rotateZ(Math.PI / 2).translate(s * (TRACK + 0.02), WHEEL_R + 0.03, z))),  // well liners
  ].map((g) => { g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv'); return g; }));
  const dashGeo = new RoundedBoxGeometry(1.74, 0.24, 0.34, 3, 0.07).translate(0, 0.86, 0.6);
  const carpetGeo = new THREE.PlaneGeometry(1.7, 2.0).rotateX(-Math.PI / 2).translate(0, 0.505, -0.3);
  const tails = mergeGeometries([-1, 1].map((s) => new THREE.CapsuleGeometry(0.05, 0.12, 4, 10).rotateX(Math.PI / 2).translate(s * 0.86, 0.98, -2.62)));
  const lensGeo = mergeGeometries(heads);
  const ivoryGeo = mergeGeometries([wheelGeo, ...spokes].map((g) => { g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv'); return g; }));
  // door shut lines (dark hairlines on the flanks) and plain license plates
  const gaps = [];
  for (const s of [-1, 1]) for (const z of [0.72, -0.62]) {
    const pts = [];
    for (let y = 0.36; y <= belt(z) - 0.02; y += 0.06) pts.push([s * (W(z) + 0.004), y, z]);
    gaps.push(tube(pts, 0.005, 12));
  }
  const gapGeo = mergeGeometries(gaps);
  const plateGeo = mergeGeometries([new THREE.BoxGeometry(0.5, 0.15, 0.01).translate(0, 0.28, 2.78), new THREE.BoxGeometry(0.5, 0.15, 0.01).translate(0, 0.62, -2.67)]);

  SHARED = {
    chrome, rubber, leather, dark, carpet, glass, red, lens, blob,
    hubMat, canvasTop, ivory, plate, ivoryGeo, gapGeo, plateGeo,
    body: bodyGeometry(), chromeGeo, glassGeo, seatGeo, bootGeo, darkGeo, dashGeo, carpetGeo, tails, lensGeo,
    tyreFlat: tyreGeometry(true), tyre: tyreGeometry(false), hub: hubGeometry(),
  };
  return SHARED;
}

// place a car on the cambered road: height at its centre, rolled to the cross slope
function seat(obj, x, z, rotY) {
  const slope = (roadHeight(x + 0.9) - roadHeight(x - 0.9)) / 1.8;
  obj.position.set(x, roadHeight(x), z);
  obj.rotation.set(0, rotY, 0);
  obj.rotateZ(Math.atan(slope) * (rotY === 0 ? 1 : -1));
}

// the cube env has no ground: the lower half of the reflection is the dark street,
// which gives the paint and chrome a crisp horizon line
function groundReflect(mat, key, maxRadiance = 0) {
  mat.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <envmap_physical_pars_fragment>',
      THREE.ShaderChunk.envmap_physical_pars_fragment.replace('return envMapColor.rgb * envMapIntensity;',
        'return envMapColor.rgb * envMapIntensity * mix(vec3(0.13, 0.12, 0.115), vec3(1.0), smoothstep(-0.012, 0.012, reflectVec.y));'));
    if (maxRadiance) clampChunk(s, maxRadiance);
  };
  mat.customProgramCacheKey = () => 'car-refl-' + key + maxRadiance;
}

// keep small bright parts (chrome, whitewalls, lenses) under the bloom threshold (4.0):
// their sun/sky glints otherwise bloom into glowing orbs
const CAR_MAX_RADIANCE = 3.0;
function clampChunk(s, m) {
  s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>',
    `outgoingLight = min(outgoingLight, vec3(${m.toFixed(2)}));
#include <opaque_fragment>`);
}
function clampRadiance(mat, key) {
  mat.onBeforeCompile = (s) => clampChunk(s, CAR_MAX_RADIANCE);
  mat.customProgramCacheKey = () => 'car-clamp-' + key;
}

function makeCar({ paint, flatten, cast }) {
  const S = shared();
  const car = new THREE.Group();
  const paintMat = new THREE.MeshPhysicalMaterial({ color: paint, roughness: 0.28, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.8 });
  groundReflect(paintMat, 'paint');
  paintMat.envMap = S.chrome.envMap;
  const add = (g, m) => { const o = new THREE.Mesh(g, m); car.add(o); return o; };
  add(S.body, paintMat);
  add(S.dashGeo, paintMat);
  add(S.chromeGeo, S.chrome);
  add(S.seatGeo, S.leather);
  add(S.bootGeo, S.canvasTop);
  add(S.ivoryGeo, S.ivory);
  add(S.gapGeo, S.dark);
  add(S.plateGeo, S.plate);
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
    const hub = new THREE.Mesh(S.hub, S.hubMat);
    hub.scale.x = s;
    hub.position.x = s * 0.095;
    w.add(hub);
    w.position.set(s * TRACK, WHEEL_R, z);
    car.add(w);
    wheels.push(w);
  }
  car.traverse((o) => { if (o.isMesh) { o.castShadow = cast && o.material !== S.glass; o.receiveShadow = true; } });
  // soft dark contact patch under the car
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 6.0).rotateX(-Math.PI / 2), S.blob);
  blob.position.y = 0.012;
  blob.renderOrder = 1;
  blob.castShadow = false;
  car.add(blob);
  return { car, wheels };
}

// Plain modern sedan (muted paint, tinted glass cabin, body-colour roof and pillars).
let SEDAN = null;
function sedanParts() {
  if (SEDAN) return SEDAN;
  const body = mergeGeometries([
    new RoundedBoxGeometry(1.8, 0.62, 4.6, 4, 0.16).translate(0, 0.62, 0),
    new RoundedBoxGeometry(1.74, 0.2, 1.3, 3, 0.08).translate(0, 0.9, 1.45),     // hood rise
    new RoundedBoxGeometry(1.5, 0.08, 2.1, 3, 0.03).translate(0, 1.43, -0.25),   // roof
    ...[-0.76, 0.76].flatMap((x) => [[x, 0.62], [x, -1.08]].map(([px, pz]) => new THREE.BoxGeometry(0.06, 0.52, 0.08).translate(px, 1.17, pz))),
  ].map((g) => { g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv'); return g; }));
  const cabinGeo = new RoundedBoxGeometry(1.56, 0.52, 2.3, 3, 0.1).translate(0, 1.16, -0.25);
  const tyreGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 24).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.225, 16).rotateZ(Math.PI / 2);
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2328, roughness: 0.08, metalness: 0.4, envMapIntensity: 1.5 });
  SEDAN = { body, cabinGeo, tyreGeo, rimGeo, glass };
  return SEDAN;
}
function makeSedan(paint, env) {
  const S = shared(), P = sedanParts();
  P.glass.envMap = env;
  const g = new THREE.Group();
  const pm = new THREE.MeshPhysicalMaterial({ color: paint, roughness: 0.35, metalness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.08, envMap: env, envMapIntensity: 1.4 });
  groundReflect(pm, 'sedan');
  g.add(new THREE.Mesh(P.body, pm), new THREE.Mesh(P.cabinGeo, P.glass));
  for (const z of [1.4, -1.4]) for (const s of [-1, 1]) {
    const t = new THREE.Mesh(P.tyreGeo, S.dark); t.position.set(s * 0.78, 0.33, z);
    const r = new THREE.Mesh(P.rimGeo, S.chrome); r.position.copy(t.position);
    g.add(t, r);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 5.4).rotateX(-Math.PI / 2), S.blob);
  blob.position.y = 0.012;
  blob.renderOrder = 1;
  g.add(blob);
  return g;
}

export function buildCars(scene) {
  const S0 = shared();
  for (const m of [S0.chrome, S0.hubMat, S0.glass, S0.lens]) m.envMap = scene.environment;
  // hero: parked at the west curb, facing south (the direction of the west lane), top down
  const hero = makeCar({ paint: 0x86cfc1, flatten: true, cast: true });
  seat(hero.car, CAR.x, CAR.z, 0);
  // a few ordinary parked cars along the lane, gaps between, the hero spot kept clear
  for (const [z, col] of [[-1.5, 0xa9adb1], [-24, 0x2e3a4e], [-31.5, 0xd8d7d2], [58, 0x5b5f63]]) {
    const s = makeSedan(col, scene.environment);
    seat(s, CAR.x + 0.05, z, 0);
    scene.add(s);
  }
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
      seat(mover.car, c.x, c.z, c.dir > 0 ? 0 : Math.PI);
      spin += (c.speed * dt) / WHEEL_R;
      for (const w of mover.wheels) w.rotation.x = spin;
    },
  };
}
