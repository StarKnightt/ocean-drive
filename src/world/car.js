// Classic late-50s American-style convertible (no badges, no make): lofted body with
// long hood, tail fins and real wheel wells, open cockpit with cream bench seats,
// chrome bumpers and trim, whitewall tyres. A parked hero car at the west curb plus a
// moving variant driven by the audio engine's car passes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CAR, roadHeight, CROSS, CROSS_STREETS, crossLegs, DISTRICT } from './layout.js';
import { registerLod } from './lod.js';

export const blockedBay = (zc, hl) => CROSS_STREETS.some((c) => {
  if (Math.abs(zc - c.z) < CROSS.hw + CROSS.R + hl + 0.5) return true;
  return !c.far && crossLegs(c.z).some(([a, b]) => zc + hl > a - 0.5 && zc - hl < b + 0.5);
});

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
  const prof = [[0.18, -w * 0.75], [0.2, -w * 0.9], [0.25, -w], [0.31, -w * 1.02], [0.345, -w * 0.9], [WHEEL_R, -w * 0.55], [WHEEL_R + 0.004, 0],
    [WHEEL_R, w * 0.55], [0.345, w * 0.9], [0.31, w * 1.02], [0.25, w], [0.2, w * 0.9], [0.18, w * 0.75]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 48).rotateZ(Math.PI / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  const black = new THREE.Color(0x141414), white = new THREE.Color(0xf6f4ee);
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getY(i), p.getZ(i));
    const c = r > 0.255 && r < 0.282 ? white : black;   // thin whitewall ring on a black sidewall
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    if (flatten && p.getY(i) < -(WHEEL_R - 0.018)) p.setY(i, -(WHEEL_R - 0.018));   // contact patch
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
function hubGeometry() {
  const pts = [[0.001, 0.05], [0.03, 0.05], [0.045, 0.042], [0.08, 0.036], [0.13, 0.028], [0.17, 0.018], [0.19, 0.01], [0.2, 0.0]].map(([r, y]) => new THREE.Vector2(r, y));
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

export function blobTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  // darkest right under the body, fading out well inside the quad (road colour at the edges)
  c.filter = 'blur(9px)';
  c.fillStyle = 'rgba(0,0,0,0.42)';
  c.fillRect(38, 20, 52, 88);
  c.filter = 'blur(5px)';
  c.fillStyle = 'rgba(0,0,0,0.38)';
  c.fillRect(46, 30, 36, 68);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// shared (paint-independent) materials and geometry
let SHARED = null;
export function shared() {
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
    gaps.push(tube(pts, 0.0065, 12));
  }
  // hood and trunk shut lines across the deck, hood edges, fender seams behind the arches
  const hoodY = (x, z) => belt(z) + 0.01 + 0.035 * (1 - (x / W(z)) ** 2);
  { const pts = []; for (let x = -W(1.38) + 0.1; x <= W(1.38) - 0.1 + 1e-6; x += 0.1) pts.push([x, hoodY(x, 1.38), 1.38]); gaps.push(tube(pts, 0.006, 20)); }
  { const pts = []; for (let x = -0.72; x <= 0.72 + 1e-6; x += 0.12) pts.push([x, crown(-1.58) + 0.008, -1.58]); gaps.push(tube(pts, 0.006, 14)); }
  for (const s of [-1, 1]) {
    const hood = [];
    for (let z = 1.38; z <= 2.45; z += 0.1) hood.push([s * (W(z) - 0.1), hoodY(W(z) - 0.1, z), z]);
    gaps.push(tube(hood, 0.006, 12));
    for (const z of [1.62 - ARCH_R - 0.22, -1.52 + ARCH_R + 0.22]) {
      const pts = [];
      for (let y = WHEEL_R + ARCH_R * 0.6; y <= belt(z) - 0.03; y += 0.06) pts.push([s * (W(z) + 0.004), y, z]);
      if (pts.length > 1) gaps.push(tube(pts, 0.005, 8));
    }
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
// (shared with the Blender-modelled cars in cars-glb.js)
export function seat(obj, x, z, rotY) {
  const slope = (roadHeight(x + 0.9) - roadHeight(x - 0.9)) / 1.8;
  obj.position.set(x, roadHeight(x), z);
  obj.rotation.set(0, rotY, 0);
  obj.rotateZ(Math.atan(slope) * (rotY === 0 ? 1 : -1));
}

// the cube env has no ground: the lower half of the reflection is the dark street,
// which gives the paint and chrome a crisp horizon line
// coat: gain on the clearcoat's environment reflection. At the flanks' near-normal incidence
// the coat's 4 % of the dim probe vanishes under the sunlit base colour, so paint gets more
// (the upper body then carries the sky band, the lower flanks the dark street)
export function groundReflect(mat, key, maxRadiance = 0, ground = 1, coat = 1) {
  const g = [0.13, 0.12, 0.115].map((v) => (v * ground).toFixed(3)).join(', ');
  mat.onBeforeCompile = (s) => {
    if (coat !== 1) s.fragmentShader = s.fragmentShader.replace('( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat',
      `( clearcoatSpecularDirect + clearcoatSpecularIndirect * ${coat.toFixed(2)} ) * material.clearcoat`);
    s.fragmentShader = s.fragmentShader.replace('#include <envmap_physical_pars_fragment>',
      THREE.ShaderChunk.envmap_physical_pars_fragment.replace('return envMapColor.rgb * envMapIntensity;',
        // (the probe holds the sun disc: capped so rough paint doesn't smear it into a glowing blob;
        // the sun's own highlight comes from the direct light)
        `return min(envMapColor.rgb, vec3(2.2)) * envMapIntensity * mix(vec3(${g}), vec3(1.0), smoothstep(-0.012, 0.012, reflectVec.y));`));
    // the coat's sun highlight: small and hard. (three widens it by the screen-space normal
    // variation, which on the long curved panels turns the sun into a soft blob)
    s.fragmentShader = s.fragmentShader.replace('#include <lights_physical_fragment>',
      THREE.ShaderChunk.lights_physical_fragment.replace('material.clearcoatRoughness += geometryRoughness;', 'material.clearcoatRoughness += 0.15 * geometryRoughness;'));
    // ...and GGX's long tail under the 5x sun, once capped, saturates into a wide flat disc:
    // the direct coat term is squeezed (x^2 / (x + 400)) so only the core stays over the cap
    s.fragmentShader = s.fragmentShader.replace('#include <lights_physical_pars_fragment>',
      THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        'clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );',
        '{ vec3 ccS = ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material ); clearcoatSpecularDirect += ccS * ccS / ( ccS + vec3( 400.0 ) ); }'));
    if (maxRadiance) clampChunk(s, maxRadiance);
  };
  mat.customProgramCacheKey = () => 'car-refl2-' + key + maxRadiance + '-' + ground + '-' + coat;
}

// keep small bright parts (chrome, whitewalls, lenses) under the bloom threshold (4.0):
// their sun/sky glints otherwise bloom into glowing orbs
export const CAR_MAX_RADIANCE = 3.0;
function clampChunk(s, m) {
  s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>',
    `outgoingLight = min(outgoingLight, vec3(${m.toFixed(2)}));
#include <opaque_fragment>`);
}
export function clampRadiance(mat, key) {
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

// Modern parked cars (sedan / hatch / SUV / pickup). Bodies are lofted like the hero car:
// curved cross-sections swept along the length over a rounded plan outline, with fender
// flares, a beltline crease, a sloping hood and deck; the greenhouse is lofted on the
// shoulders with tumblehome, a rounded roof edge, raked screens and a crowned roofline.
// Lamps are strips wrapped round the body corners; tyres are lathed with tread grooves
// and a flattened contact patch, on spoked rims. Geometry is built once per type.
const MODERN = {
  sedan: { L: 4.75, W: 0.9, wb: 1.42, r: 0.33, belt: 0.98, nose: 0.74, deck: 0.99, tail: 0.92, zA: 0.98, zRf: 0.18, zRr: -0.85, zR: -1.55, top: 1.45, Wt: 0.64, doors: [0.95, -0.15, -1.2] },
  hatch: { L: 4.15, W: 0.88, wb: 1.28, r: 0.32, belt: 0.96, nose: 0.74, deck: 0.96, tail: 0.9, zA: 0.9, zRf: 0.1, zRr: -1.35, zR: -1.85, top: 1.47, Wt: 0.63, doors: [0.85, -0.35, -1.3] },
  suv: { L: 4.7, W: 0.95, wb: 1.42, r: 0.37, belt: 1.13, nose: 0.98, deck: 1.1, tail: 1.02, zA: 1.32, zRf: 0.55, zRr: -1.85, zR: -2.2, top: 1.75, Wt: 0.74, doors: [1.25, 0.0, -1.15] },
  pickup: { L: 5.3, W: 0.97, wb: 1.65, r: 0.38, belt: 1.12, nose: 1.0, deck: 1.14, tail: 1.1, zA: 1.55, zRf: 0.85, zRr: -0.38, zR: -0.58, top: 1.82, Wt: 0.76, doors: [1.5, 0.3, -0.5] },
};
const MODERN_GEO = {};
const stripUv = (g) => { g = g.index ? g.toNonIndexed() : g; for (const a of ['uv', 'uv1']) if (g.attributes[a]) g.deleteAttribute(a); return g; };
// loft half-profiles (x >= 0, bottom centre -> top centre) mirrored into closed rings
function loftGeometry(zs, section, caps) {
  const rings = zs.map((z) => {
    const P = section(z), ring = [];
    for (let i = P.length - 1; i > 0; i--) ring.push([-P[i][0], P[i][1]]);
    for (const q of P) ring.push(q);
    return ring;
  });
  const n = rings[0].length, pos = [], idx = [];
  zs.forEach((z, k) => { for (const [x, y] of rings[k]) pos.push(x, y, z); });
  for (let k = 0; k < zs.length - 1; k++) for (let i = 0; i < n - 1; i++) {
    const a = k * n + i, b = a + n;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  if (caps) for (const [k, flip] of [[0, true], [zs.length - 1, false]]) {
    const c = pos.length / 3, ring = rings[k];
    pos.push(0, ring.reduce((t, q) => t + q[1], 0) / ring.length, zs[k]);
    for (let i = 0; i < n - 1; i++) { const a = k * n + i; if (flip) idx.push(c, a + 1, a); else idx.push(c, a, a + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// a strip through a list of 3D points, extruded +-h/2 vertically (lamps), both sides
function stripGeometry(pts, h) {
  const pos = [], idx = [];
  for (const [x, y, z] of pts) pos.push(x, y - h / 2, z, x, y + h / 2, z);
  for (let i = 0; i < pts.length - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function mirrorX(g) {
  g = g.clone();
  g.scale(-1, 1, 1);
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  g.computeVertexNormals();
  return g;
}
function modernTyre(r) {
  // lathe profile (radius, axial): rounded shoulders, four tread ribs, sidewall bulge
  const w = 0.11, prof = [[r * 0.64, -w * 0.8], [r * 0.7, -w * 0.95], [r * 0.85, -w * 1.02], [r * 0.95, -w * 0.95], [r - 0.004, -w * 0.78]];
  for (let k = 0; k <= 8; k++) { const a = -w * 0.7 + (1.4 * w * k) / 8; prof.push([k % 2 ? r - 0.009 : r, a]); }
  prof.push([r - 0.004, w * 0.78], [r * 0.95, w * 0.95], [r * 0.85, w * 1.02], [r * 0.7, w * 0.95], [r * 0.64, w * 0.8]);
  const g = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 40).rotateZ(Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -(r - 0.015)) p.setY(i, -(r - 0.015));   // contact patch
  g.computeVertexNormals();
  return g;
}
function modernRim(r) {
  const rr = r * 0.62;
  const dish = new THREE.LatheGeometry([[0.0, 0.06], [0.05, 0.06], [0.07, 0.05], [rr * 0.9, 0.03], [rr, 0.035], [rr, 0.0]].map(([a, b]) => new THREE.Vector2(a, b)), 32).rotateZ(-Math.PI / 2);
  const parts = [dish];
  for (let k = 0; k < 5; k++) parts.push(new THREE.BoxGeometry(0.03, rr * 0.9, 0.05).translate(0, rr * 0.5, 0).rotateX((k * Math.PI * 2) / 5).translate(0.07, 0, 0));
  parts.push(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12).rotateZ(Math.PI / 2).translate(0.09, 0, 0));
  return mergeGeometries(parts.map(stripUv));
}
function modernGeometry(type) {
  if (MODERN_GEO[type]) return MODERN_GEO[type];
  const T = MODERN[type], H = T.L / 2, R = T.r + 0.035, RC = 0.5;
  // plan outline: rounded corners, fender flares over the wheels
  const halfW = (z) => {
    const e = Math.abs(z) - (H - RC);
    let w = e > 0 ? T.W - RC + Math.sqrt(Math.max(0, RC * RC - e * e * 0.92)) : T.W;
    for (const wz of [T.wb, -T.wb]) w += 0.02 * Math.exp(-(((z - wz) / 0.55) ** 2));
    return w;
  };
  const archY = (z) => {
    let y = 0;
    for (const wz of [T.wb, -T.wb]) { const d = z - wz; if (Math.abs(d) < R) y = Math.max(y, T.r + Math.sqrt(R * R - d * d) * 0.97); }
    return y;
  };
  const ease = (t) => t * t * (3 - 2 * t);
  const deckTop = (z) => {
    if (z > T.zA) { const t = (z - T.zA) / (H - T.zA); return T.belt - (T.belt - T.nose) * Math.pow(t, 1.8) + 0.02 * Math.sin(Math.PI * t); }
    if (z < T.zR) { const t = (T.zR - z) / (T.zR + H); return T.deck + (T.belt - T.deck) * (1 - t) - (T.deck - T.tail) * Math.pow(t, 3); }
    return T.belt;
  };
  const bottom = (z) => 0.25 + 0.14 * Math.max(0, (Math.abs(z) - (H - 0.32)) / 0.32) ** 2;   // bumpers turn under
  const roofY = (z) => {
    if (z >= T.zRf) { const t = Math.max(0, (T.zA - z) / (T.zA - T.zRf)); return T.belt + (T.top - T.belt) * (1 - (1 - t) ** 1.4); }
    if (z <= T.zRr) { const t = Math.max(0, (z - T.zR) / (T.zRr - T.zR)); return T.belt + (T.top - T.belt) * (1 - (1 - t) ** 1.3); }
    return T.top + 0.03 * Math.sin(Math.PI * (z - T.zRr) / (T.zRf - T.zRr));
  };
  const zs = [];
  for (let z = -H; z <= H + 1e-6; z += 0.04) zs.push(+z.toFixed(3));
  const body = loftGeometry(zs, (z) => {
    const W = halfW(z), ay = archY(z), well = ay > 0.3, t = deckTop(z), b = bottom(z);
    const sill = Math.max(b + 0.06, 0.32);
    const P = [[0, b], [W - 0.34, well ? ay : b], [W - 0.07, well ? ay : b + 0.02], [W - 0.03, well ? ay + 0.015 : sill]];
    // flank: bulge at ~0.55 m, a crease below the shoulder, then tumblehome into the shoulder
    for (const [f, dx] of [[0.0, -0.012], [0.35, 0.0], [0.62, -0.006], [0.8, -0.02], [0.84, -0.012], [0.93, -0.035]]) {
      const y = Math.max(P[P.length - 1][1] + 0.01, sill + (t - 0.035 - sill) * f);
      P.push([W + dx, y]);
    }
    P.push([W - 0.07, t - 0.005], [W - 0.18, t + 0.018], [W * 0.5, t + 0.03], [0, t + 0.034]);
    return P;
  }, true);
  // greenhouse on the shoulders: tumblehome sides, rounded roof edge, crowned roof
  const gz = [];
  for (let z = T.zR; z <= T.zA + 1e-6; z += 0.04) gz.push(+z.toFixed(3));
  gz.push(T.zA);
  const ghSection = (z, inset = 0) => {
    const y = Math.max(roofY(z), T.belt + 0.004), k = Math.min(1, (y - T.belt) / (T.top - T.belt));
    const xb = halfW(z) - 0.075, xt = Math.min(xb, xb + (T.Wt - xb) * k);
    const rr = Math.min(0.09, (y - T.belt) * 0.45);
    const side = [], corner = [];
    for (let i = 0; i <= 3; i++) { const f = i / 3; side.push([xb + (xt - xb) * f + 0.018 * Math.sin(Math.PI * f) * k - inset, T.belt + (y - rr - T.belt) * f]); }
    for (let i = 1; i <= 4; i++) { const a = (i / 4) * Math.PI / 2; corner.push([xt - rr + rr * Math.cos(a) - inset, y - rr + rr * Math.sin(a) + inset * 0.5]); }
    return { side, corner, y, xt, rr, top: [[xt * 0.5, y + 0.02 * k + inset * 0.5], [0, y + 0.026 * k + inset * 0.5]] };
  };
  const glass = loftGeometry([...new Set(gz)].sort((a, b) => a - b), (z) => {
    const s = ghSection(z);
    return [[0, T.belt - 0.02], [s.side[0][0], T.belt - 0.02], ...s.side, ...s.corner, ...s.top];
  }, false);
  const paint = [body];
  // painted roof over the roof span, and the A / C (D) pillars along the glass edges
  const rz = [];
  for (let z = T.zRr - 0.03; z <= T.zRf + 0.03 + 1e-6; z += 0.04) rz.push(+z.toFixed(3));
  paint.push(loftGeometry(rz, (z) => {
    const s = ghSection(z, -0.006);
    return [[0, s.y - 0.05], [s.corner[0][0], s.y - 0.05], ...s.corner.slice(1), ...s.top];
  }, true));
  const edge = (z0, z1, n) => { const pts = []; for (let i = 0; i <= n; i++) { const z = z0 + ((z1 - z0) * i) / n, s = ghSection(z); pts.push([s.corner[1][0] + 0.004, s.corner[1][1], z]); } return pts; };
  const bigC = type === 'suv' ? 0.05 : type === 'pickup' ? 0.045 : 0.075;
  for (const s of [-1, 1]) {
    const flip = (pts) => pts.map(([x, y, z]) => [s * x, y, z]);
    paint.push(tube(flip(edge(T.zRf - 0.02, T.zA - 0.05, 10)), 0.038, 14));
    paint.push(tube(flip(edge(T.zR + 0.05, T.zRr + 0.02, 8)), bigC, 12));
    // mirror on a stalk
    const mz = T.zA - 0.18, mx = halfW(mz) - 0.06;
    paint.push(new RoundedBoxGeometry(0.19, 0.12, 0.1, 2, 0.04).translate(s * (mx + 0.19), T.belt + 0.1, mz));
  }
  // dark trim: window surround, B pillar, stalks, door seams + handles, liners, grille, underbody
  const trim = [];
  const pillarZ = type === 'suv' ? [T.doors[1], T.doors[2] - 0.08] : type === 'pickup' ? [T.doors[1]] : [T.doors[1]];
  for (const s of [-1, 1]) {
    const flip = (pts) => pts.map(([x, y, z]) => [s * x, y, z]);
    trim.push(tube(flip(edge(T.zR + 0.08, T.zA - 0.08, 20).map(([x, y, z]) => [x - 0.006, y - 0.012, z])), 0.01, 30));   // upper DLO trim
    const belts = []; for (let z = T.zR + 0.04; z <= T.zA - 0.04 + 1e-6; z += 0.1) belts.push([halfW(z) - 0.07, T.belt + 0.004, z]);
    trim.push(tube(flip(belts), 0.011, 24));
    for (const z of pillarZ) { const g = ghSection(z); trim.push(tube(flip([[g.side[0][0] + 0.004, T.belt, z], [g.side[2][0] + 0.004, g.side[2][1], z], [g.corner[1][0], g.corner[1][1] - 0.01, z]]), 0.03, 6)); }
    const mz = T.zA - 0.18, mx = halfW(mz) - 0.06;
    trim.push(new THREE.BoxGeometry(0.16, 0.035, 0.05).translate(s * (mx + 0.06), T.belt + 0.06, mz));
    for (const z of T.doors) {
      const pts = [];
      for (let y = 0.36; y <= T.belt - 0.02; y += 0.05) pts.push([halfW(z) + 0.004, y, z]);
      trim.push(tube(flip(pts), 0.005, 10));
    }
    for (let i = 0; i < T.doors.length - 1; i++) trim.push(new RoundedBoxGeometry(0.02, 0.028, 0.14, 1, 0.008).translate(s * (halfW(T.doors[i]) + 0.008), T.belt - 0.09, T.doors[i] - 0.2));
    for (const wz of [T.wb, -T.wb]) trim.push(new THREE.CylinderGeometry(R - 0.01, R - 0.01, 0.36, 18, 1, true).rotateZ(Math.PI / 2).translate(s * (halfW(wz) - 0.2), T.r, wz));
  }
  trim.push(new RoundedBoxGeometry((halfW(H) - 0.12) * 2, 0.14, 0.04, 2, 0.015).translate(0, T.nose - 0.2, H - 0.005));   // grille
  trim.push(new RoundedBoxGeometry((halfW(H) - 0.05) * 2, 0.08, 0.06, 2, 0.02).translate(0, bottom(H) + 0.05, H - 0.02));  // lower lip
  trim.push(new THREE.BoxGeometry(T.W * 1.6, 0.14, T.L - 1.2).translate(0, 0.23, 0));
  // lamps wrapped round the corners (strip following the plan outline, just proud of it)
  const lampPts = (front, y) => {
    const sgn = front ? 1 : -1, pts = [];
    for (let i = 0; i <= 8; i++) { const z = sgn * (H - 0.32 + (0.32 * i) / 8); pts.push([halfW(z) + 0.004, y, z]); }
    const zEnd = sgn * (H + 0.004);
    for (let i = 1; i <= 3; i++) pts.push([halfW(sgn * H) - (0.3 * i) / 3, y, zEnd]);
    return pts;
  };
  const head = stripGeometry(lampPts(true, T.nose - 0.08), 0.085);
  const tailG = stripGeometry(lampPts(false, T.tail - 0.07), 0.1);
  const lens = mergeGeometries([head, mirrorX(head)]);
  const red = mergeGeometries([tailG, mirrorX(tailG)]);
  MODERN_GEO[type] = {
    T, wheelX: halfW(T.wb) - 0.13, paint: mergeGeometries(paint.map(stripUv)), glass: stripUv(glass), trim: mergeGeometries(trim.map(stripUv)),
    lens: stripUv(lens), red: stripUv(red), tyre: modernTyre(T.r), rim: modernRim(T.r),
  };
  return MODERN_GEO[type];
}
// body colour per vertex: paint with road grime creeping up the lower sills
function paintColors(g, hex) {
  const c = new THREE.Color(hex), d = new THREE.Color(0x5a5248), p = g.attributes.position, a = new Float32Array(p.count * 3), t = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    t.copy(c).lerp(d, 0.45 * (1 - THREE.MathUtils.smoothstep(p.getY(i), 0.3, 0.52)));
    a[i * 3] = t.r; a[i * 3 + 1] = t.g; a[i * 3 + 2] = t.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
let SEDAN = null;
function sedanParts() {
  if (SEDAN) return SEDAN;
  // dark tinted glass: a Fresnel mirror of the sky (clearcoat), the street its dark lower half
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c1115, roughness: 0.05, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.5, side: THREE.DoubleSide });
  groundReflect(glass, 'modern-glass');
  const alloy = new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 0.75, roughness: 0.38, side: THREE.DoubleSide });
  // parked: lamps are unlit smoked glass over a dark reflector, no emissive glow
  const lens = new THREE.MeshPhysicalMaterial({ color: 0x3a3e42, roughness: 0.15, metalness: 0.3, clearcoat: 1, envMapIntensity: 0.7, side: THREE.DoubleSide });
  clampRadiance(lens, 'modern-lens');
  const tail = new THREE.MeshPhysicalMaterial({ color: 0x5c0b0d, roughness: 0.2, clearcoat: 1, envMapIntensity: 0.7, side: THREE.DoubleSide });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x19191a, roughness: 0.9, side: THREE.DoubleSide });
  SEDAN = { glass, alloy, lens, tail, rubber };
  return SEDAN;
}
function modernPaint(env, key) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.3, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04, envMap: env, envMapIntensity: 1.4 });
  groundReflect(m, key);
  return m;
}
function makeSedan(paint, env, type = 'sedan') {
  const S = shared(), P = sedanParts(), G = modernGeometry(type);
  for (const m of [P.glass, P.alloy, P.lens, P.tail]) m.envMap = env;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(paintColors(G.paint.clone(), paint), modernPaint(env, 'sedan')), new THREE.Mesh(G.glass, P.glass),
    new THREE.Mesh(G.trim, S.dark), new THREE.Mesh(G.lens, P.lens), new THREE.Mesh(G.red, P.tail));
  for (const z of [G.T.wb, -G.T.wb]) for (const s of [-1, 1]) {
    const t = new THREE.Mesh(G.tyre, P.rubber);
    t.position.set(s * G.wheelX, G.T.r, z);
    const r = new THREE.Mesh(G.rim, P.alloy);
    r.position.copy(t.position);
    r.scale.x = s;
    g.add(t, r);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.2, G.T.L + 0.6).rotateX(-Math.PI / 2), S.blob);
  blob.position.y = 0.012;
  blob.renderOrder = 1;
  blob.castShadow = false;
  g.add(blob);
  return g;
}

// Nose-to-tail parked cars along the rest of the lane (a few empty bays), a muted modern
// palette; merged by material so the whole row costs a handful of draw calls.
function parkedFleet(scene, taken, { z0 = -88, z1 = 90, seed = 7331, parent = scene, clip = false } = {}) {
  const S = shared(), P = sedanParts();
  const rnd = (() => { let a = seed; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const cols = [0xb9bcbf, 0xe4e4e0, 0x1c1d1f, 0x1f2c44, 0x4a4d52, 0x8a1e1e, 0xb8a98a, 0xa6a9ac, 0x2e3033];
  const types = ['sedan', 'sedan', 'hatch', 'suv', 'suv', 'pickup'].map(modernGeometry);
  const parts = { body: [], glass: [], trim: [], lens: [], red: [], tyre: [], rim: [], blob: [] };
  const colliders = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const add = (list, geo, m, col) => { const g = geo.clone().applyMatrix4(m); list.push(col === undefined ? g : paintColors(g, col)); };
  for (let z = z0; z < z1;) {
    const ty = types[Math.floor(rnd() * types.length)], T = ty.T;
    const zc = z + T.L / 2;
    z += T.L + 0.7 + rnd() * 1.6;
    if (clip && zc + T.L / 2 > z1) break;
    if (Math.abs(zc - CAR.z) < 6.5 || Math.abs(zc - (-10)) < 6.5 || (zc > 22 && zc < 44) || taken.some((t) => Math.abs(zc - t) < 5.6) || rnd() < 0.2) continue;
    const x = CAR.x + 0.05 + (rnd() - 0.5) * 0.3;
    const mark = Object.values(parts).map((l) => l.length);
    q.setFromEuler(new THREE.Euler(0, (rnd() - 0.5) * 0.09, 0));
    m4.compose(new THREE.Vector3(x, roadHeight(x), zc), q, one);
    add(parts.body, ty.paint, m4, cols[Math.floor(rnd() * cols.length)]);
    add(parts.glass, ty.glass, m4);
    add(parts.trim, ty.trim, m4);
    add(parts.lens, ty.lens, m4);
    add(parts.red, ty.red, m4);
    add(parts.blob, new THREE.PlaneGeometry(2.2, T.L + 0.6).rotateX(-Math.PI / 2).translate(0, 0.012, 0), m4);
    for (const wz of [T.wb, -T.wb]) for (const sx of [-1, 1]) {
      const w = new THREE.Matrix4().compose(new THREE.Vector3(sx * ty.wheelX, T.r, wz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6.28, 0, 0)), new THREE.Vector3(sx, 1, 1)).premultiply(m4);
      add(parts.tyre, ty.tyre, w);
      add(parts.rim, ty.rim, w);
    }
    // no parking in the cross-street mouths or on their crosswalks (decided after the
    // random draws, so the rest of the row is unchanged)
    if (blockedBay(zc, T.L / 2)) { Object.values(parts).forEach((l, k) => { l.length = mark[k]; }); continue; }
    colliders.push({ min: { x: x - 1.0, y: 0, z: zc - T.L / 2 - 0.05 }, max: { x: x + 1.0, y: T.top, z: zc + T.L / 2 + 0.05 } });
  }
  if (!colliders.length) return colliders;
  for (const m of [P.glass, P.alloy, P.lens, P.tail]) m.envMap = scene.environment;
  const strip = (g) => { g = g.index ? g.toNonIndexed() : g; if (g.attributes.uv) g.deleteAttribute('uv'); if (g.attributes.uv1) g.deleteAttribute('uv1'); return g; };
  const mk = (list, mat, shadow = true, keepUv = false) => {
    const m = new THREE.Mesh(mergeGeometries(keepUv ? list : list.map(strip)), mat);
    m.castShadow = m.receiveShadow = shadow;
    parent.add(m);
    return m;
  };
  mk(parts.body, modernPaint(scene.environment, 'fleet'));
  mk(parts.glass, P.glass);
  mk(parts.trim, S.dark);
  mk(parts.lens, P.lens);
  mk(parts.red, P.tail);
  mk(parts.tyre, P.rubber);
  mk(parts.rim, P.alloy);
  const b = mk(parts.blob, S.blob, false, true);
  b.renderOrder = 1;
  return colliders;
}

// procedural parked cars: a few single spots, the authored block's fleet and one row per
// extended block (distance culled). Returns their colliders.
export function buildParkedProcedural(scene) {
  const colliders = [];
  for (const [z, col, type] of [[-1.5, 0xb9bcbf, 'sedan'], [-24, 0x1f2c44, 'suv'], [-31.5, 0x8a1e1e, 'hatch'], [58, 0xe4e4e0, 'pickup']]) {
    const s = makeSedan(col, scene.environment, type);
    seat(s, CAR.x + 0.05, z, 0);
    scene.add(s);
    const hl = MODERN[type].L / 2 + 0.05;
    colliders.push({ min: { x: CAR.x + 0.05 - 1.0, y: 0, z: z - hl }, max: { x: CAR.x + 0.05 + 1.0, y: MODERN[type].top, z: z + hl } });
  }
  colliders.push(...parkedFleet(scene, [-1.5, -24, -31.5, 58]));
  // the extended blocks: one row per block, clear of the intersections, culled by distance
  const stops = [DISTRICT.zMin - 4, ...CROSS_STREETS.filter((c) => !c.far && Math.abs(c.z) > 100).map((c) => c.z), -79, 79, DISTRICT.zMax + 4].sort((a, b) => a - b);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (a === -79 && b === 79) continue;   // the authored block (row above)
    const za = a <= DISTRICT.zMin - 4 ? a : a + 17, zb = b >= DISTRICT.zMax + 4 ? b : b - 16;
    if (zb - za < 8) continue;
    const g = new THREE.Group();
    colliders.push(...parkedFleet(scene, [], { z0: za, z1: zb, seed: 9100 + i * 77, parent: g, clip: true }));
    scene.add(g);
    registerLod(g, za, zb, 'cars');
  }
  return colliders;
}

// moving cars: one mesh per sounding audio car (hidden when none is passing)
export function carMovers(scene, pool) {
  return (dt, cars) => {
    const live = (cars || []).filter((k) => k.active && k.progress > 0 && k.progress < 1);
    for (const m of pool) if (!live.some((k) => k.id === m.id)) m.id = null;
    for (const c of live) {
      const m = pool.find((q) => q.id === c.id) ?? pool.find((q) => q.id === null);
      if (!m) continue;
      m.id = c.id;
      seat(m.car, c.x, c.z, c.dir > 0 ? 0 : Math.PI);
      m.spin += (c.speed * dt) / (m.wheelR ?? WHEEL_R);
      for (const w of m.wheels) w.rotation.x = m.spin;
    }
    for (const m of pool) { m.car.visible = m.id !== null; m.car.userData.audioId = m.id; }
  };
}

// The fully procedural set (fallback when the GLB cars can't load).
export function buildCars(scene) {
  const S0 = shared();
  for (const m of [S0.chrome, S0.hubMat, S0.glass, S0.lens]) m.envMap = scene.environment;
  // hero: parked at the west curb, facing south (the direction of the west lane), top down
  const hero = makeCar({ paint: 0x86cfc1, flatten: true, cast: true });
  seat(hero.car, CAR.x, CAR.z, 0);
  scene.add(hero.car);
  const colliders = [{ min: { x: CAR.x - 1.0, y: 0, z: CAR.z - 2.75 }, max: { x: CAR.x + 1.0, y: 1.2, z: CAR.z + 2.75 } }];
  colliders.push(...buildParkedProcedural(scene));
  const pool = [0xe8a4b8, 0xf2e6c4, 0x9fc8e0].map((paint) => {
    const m = makeCar({ paint, flatten: false, cast: false });
    m.car.visible = false;
    scene.add(m.car);
    return { ...m, id: null, spin: 0 };
  });
  return { hero: hero.car, mover: pool[0].car, movers: pool.map((m) => m.car), colliders, update: carMovers(scene, pool) };
}
