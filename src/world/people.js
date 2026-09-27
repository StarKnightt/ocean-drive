// A few people on Ocean Drive at sunrise: a jogger on the park promenade, a barefoot
// beach walker at the waterline (sandals in hand), a cafe worker on one hotel terrace, a
// cyclist on a city bike passing now and then, and a small stroller far up the beach.
//
// Each figure is ONE SkinnedMesh: lofted body segments (torso with chest/waist/hip
// shaping, tapering limbs, hands, feet/shoes, neck, head with nose/jaw/ears, hair mass,
// bun or ponytail) and, for the cyclist, the bike itself, all skinned to one skeleton.
// Clothing is vertex colour + per-vertex roughness/sheen/metal zones on one shared
// material. Animation is procedural (walk/run cycles from gait curves, two-bone IK for
// pedalling, handlebars and wiping), with feet solved onto the ground.
//
// Shadows: the sun shadow map is static (renderer.shadowMap.autoUpdate = false), so the
// figures don't cast into it. Instead each figure has a second SkinnedMesh on the same
// skeleton whose vertices are projected along the sun onto the ground (curb, road crown,
// terraces, facades, sand) - the long 7 deg shadows. Its fragments get exact ground depth
// from a per-pixel ray so overlapping layers darken only once, and it darkens by the
// local ambient / (direct + ambient) ratio, so ground already in a static shadow (palms)
// is left alone.
//
// API: buildPeople(scene, { beach, hotels, getCars, walker, shot, mode }) ->
//   { colliders: [{x, z, r}] (live, for walker circles), update(dt, camera), people }
// ?shot=1: frozen, deterministic, clear of the harness views; ?shot=1&people=closeup
// places everyone at fixed close-up spots for tools/shot-one.mjs.
import * as THREE from 'three';
import { PARK, SUN, compassToDir, CURB_HEIGHT, LANES, SAND, SEA_LEVEL, SIDEWALK_W, SIDEWALK_E, HOTEL, SAND_DETAIL_Z, WET_LINE_X, roadHeight } from './layout.js';

const D2R = Math.PI / 180;
const TAU = Math.PI * 2;
const SUN_DIR = compassToDir(SUN.azimuthDeg, SUN.elevationDeg, new THREE.Vector3());
const CULL = 150;                // m: figures further than this are hidden
const TERRACE_Y = CURB_HEIGHT + 0.45;
const FOG = 1 / 200;
const SHADOW_GAIN = 1.6;      // direct-light share -> shadow darkness, matched to the palm shadows
const promenadeX = (z) => PARK.promenadeX + 2.6 * Math.sin(z / 19) + 1.2 * Math.sin(z / 7.3);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------------------
// Bones (every figure gets the full set; the bike bones only carry geometry on the cyclist)
const B = {
  ROOT: 0, PELVIS: 1, SPINE: 2, CHEST: 3, NECK: 4, HEAD: 5,
  THIGH_L: 6, SHIN_L: 7, FOOT_L: 8, TOE_L: 9, THIGH_R: 10, SHIN_R: 11, FOOT_R: 12, TOE_R: 13,
  ARM_L: 14, FORE_L: 15, HAND_L: 16, ARM_R: 17, FORE_R: 18, HAND_R: 19, PONY: 20,
  STEER: 21, WHEEL_F: 22, WHEEL_R: 23, CRANK: 24, PEDAL_L: 25, PEDAL_R: 26,
};
const PARENT = [-1, 0, 1, 2, 3, 4, 1, 6, 7, 8, 1, 10, 11, 12, 3, 14, 15, 3, 17, 18, 5, 0, 21, 0, 0, 24, 24];

// material zones: [roughness, sheen, metalness]
const MAT = {
  skin: [0.52, 0.18, 0], cotton: [0.86, 0.75, 0], linen: [0.9, 0.6, 0], tech: [0.6, 0.35, 0],
  shoe: [0.62, 0.25, 0], sole: [0.85, 0.05, 0], hair: [0.48, 0.55, 0], lips: [0.4, 0.1, 0],
  paint: [0.32, 0.0, 0.05], chrome: [0.22, 0, 1], rubber: [0.85, 0.05, 0], leather: [0.5, 0.15, 0],
  wicker: [0.85, 0.3, 0], lens: [0.1, 0, 0.6], apron: [0.8, 0.8, 0],
};

// Joint rest positions (person-local, feet at y = 0, facing +z, left = +x) for a 1.75 m man.
function joints(s, fem) {
  const hx = (fem ? 0.093 : 0.09) * s, sx = (fem ? 0.163 : 0.182) * s;
  const J = [];
  J[B.ROOT] = [0, 0, 0];
  J[B.PELVIS] = [0, 0.97 * s, 0];
  J[B.SPINE] = [0, 1.08 * s, 0];
  J[B.CHEST] = [0, 1.22 * s, 0];
  J[B.NECK] = [0, 1.48 * s, -0.01 * s];
  J[B.HEAD] = [0, 1.585 * s, 0.0];
  for (const [side, t, sh, f, toe] of [[1, B.THIGH_L, B.SHIN_L, B.FOOT_L, B.TOE_L], [-1, B.THIGH_R, B.SHIN_R, B.FOOT_R, B.TOE_R]]) {
    J[t] = [side * hx, 0.91 * s, 0];
    J[sh] = [side * hx, 0.485 * s, 0.004 * s];
    J[f] = [side * hx, 0.08 * s, 0];
    J[toe] = [side * hx, 0.025 * s, 0.135 * s];
  }
  for (const [side, a, fo, h] of [[1, B.ARM_L, B.FORE_L, B.HAND_L], [-1, B.ARM_R, B.FORE_R, B.HAND_R]]) {
    J[a] = [side * sx, 1.43 * s, -0.012 * s];
    J[fo] = [side * sx, 1.14 * s, -0.018 * s];
    J[h] = [side * sx, 0.885 * s, -0.005 * s];
  }
  J[B.PONY] = [0, 1.705 * s, -0.078 * s];
  // bike (not scaled): steering at the head tube top, axles, bottom bracket, pedals
  J[B.STEER] = [0, 0.84, 0.34];
  J[B.WHEEL_F] = [0, 0.35, 0.56];
  J[B.WHEEL_R] = [0, 0.35, -0.54];
  J[B.CRANK] = [0, 0.29, -0.06];
  J[B.PEDAL_L] = [0.135, 0.29 + 0.17, -0.06];
  J[B.PEDAL_R] = [-0.135, 0.29 - 0.17, -0.06];
  return J;
}

// ---------------------------------------------------------------------------
// Geometry assembly
class Mesher {
  constructor() { this.P = []; this.N = []; this.C = []; this.M = []; this.SI = []; this.SW = []; this.I = []; this.n = 0; }
  // verts: [{p, c: THREE.Color, m, b: [i, j], w: [a, b]}], tris: flat index list
  // ring: [first vertex, count] of a cross-section whose centre is inside the surface
  add(verts, tris, ring) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts.flatMap((v) => v.p), 3));
    g.setIndex(tris);
    g.computeVertexNormals();
    // outward normals: flip the winding if that ring's normals point inward
    const cen = new THREE.Vector3(), nrm = g.attributes.normal;
    const [r0, rn] = ring;
    for (let i = r0; i < r0 + rn; i++) { const p = verts[i].p; cen.x += p[0] / rn; cen.y += p[1] / rn; cen.z += p[2] / rn; }
    let dot = 0;
    for (let i = r0; i < r0 + rn; i++) {
      const p = verts[i].p;
      dot += (p[0] - cen.x) * nrm.getX(i) + (p[1] - cen.y) * nrm.getY(i) + (p[2] - cen.z) * nrm.getZ(i);
    }
    if (dot < 0) {
      for (let i = 0; i < tris.length; i += 3) { const t = tris[i + 1]; tris[i + 1] = tris[i + 2]; tris[i + 2] = t; }
      g.setIndex(tris);
      g.computeVertexNormals();
    }
    const nn = g.attributes.normal.array;
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      this.P.push(...v.p);
      this.N.push(nn[i * 3], nn[i * 3 + 1], nn[i * 3 + 2]);
      this.C.push(v.c.r, v.c.g, v.c.b);
      this.M.push(...v.m);
      this.SI.push(v.b[0], v.b[1], 0, 0);
      this.SW.push(v.w[0], v.w[1], 0, 0);
    }
    for (const t of tris) this.I.push(t + this.n);
    this.n += verts.length;
    g.dispose();
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.M, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.SW, 4));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
    return g;
  }
}

// Loft a closed tube: fn(u, v) -> {p, c, m, b, w}; u along (nu+1 rings), v around (nv).
function loft(ms, nu, nv, fn, { capStart = true, capEnd = true } = {}) {
  const verts = [], tris = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j < nv; j++) verts.push(fn(i / nu, j / nv));
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const j1 = (j + 1) % nv;
      const a = i * nv + j, b = i * nv + j1, c = (i + 1) * nv + j, d = (i + 1) * nv + j1;
      tris.push(a, c, b, b, c, d);
    }
  }
  const cap = (ring, start) => {
    const p = [0, 0, 0];
    for (let j = 0; j < nv; j++) for (let k = 0; k < 3; k++) p[k] += verts[ring * nv + j].p[k] / nv;
    const k = verts.length;
    verts.push({ ...verts[ring * nv], p });
    for (let j = 0; j < nv; j++) {
      const a = ring * nv + j, b = ring * nv + (j + 1) % nv;
      if (start) tris.push(k, a, b); else tris.push(k, b, a);
    }
  };
  if (capStart) cap(0, true);
  if (capEnd) cap(nu, false);
  ms.add(verts, tris, [Math.floor(nu / 2) * nv, nv]);
}

// Hermite-interpolated profile keys [[t, ...values]] (clamped at the ends).
function profile(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0].slice(1);
  if (t >= keys[n - 1][0]) return keys[n - 1].slice(1);
  let i = 0;
  while (keys[i + 1][0] < t) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(n - 1, i + 2)];
  const h = k2[0] - k1[0], s = (t - k1[0]) / h;
  const h00 = 2 * s ** 3 - 3 * s * s + 1, h10 = s ** 3 - 2 * s * s + s, h01 = -2 * s ** 3 + 3 * s * s, h11 = s ** 3 - s * s;
  const out = [];
  for (let c = 1; c < k1.length; c++) {
    const m1 = (k2[c] - k0[c]) / Math.max(1e-6, k2[0] - k0[0]), m2 = (k3[c] - k1[c]) / Math.max(1e-6, k3[0] - k1[0]);
    out.push(h00 * k1[c] + h10 * h * m1 + h01 * k2[c] + h11 * h * m2);
  }
  return out;
}
// periodic keys over [0, 1)
function cyc(keys, p) {
  p -= Math.floor(p);
  const n = keys.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) if (keys[k][0] <= p) i = k;
  const at = (k) => { const q = ((k % n) + n) % n, w = Math.floor(k / n); return [keys[q][0] + w, keys[q][1]]; };
  const k0 = at(i - 1), k1 = at(i), k2 = at(i + 1), k3 = at(i + 2);
  const h = k2[0] - k1[0], s = (p - k1[0]) / h;
  const m1 = (k2[1] - k0[1]) / (k2[0] - k0[0]), m2 = (k3[1] - k1[1]) / (k3[0] - k1[0]);
  return (2 * s ** 3 - 3 * s * s + 1) * k1[1] + (s ** 3 - 2 * s * s + s) * h * m1 + (-2 * s ** 3 + 3 * s * s) * k2[1] + (s ** 3 - s * s) * h * m2;
}

const se = (q, n) => Math.sign(q) * Math.abs(q) ** (2 / n);
const W1 = (b) => ({ b: [b, 0], w: [1, 0] });
const W2 = (b0, b1, t) => ({ b: [b0, b1], w: [1 - t, t] });

// ---------------------------------------------------------------------------
// Clothing zones (colour, material, cloth thickness) from the rest position
function outfitZones(o, s) {
  const S = (v) => v * s;
  const skin = { c: o.skin, m: MAT.skin, off: 0 };
  const top = o.top && { c: o.top.col, m: o.top.mat, off: (o.top.off ?? 0.006) * s };
  const bot = o.bottom && { c: o.bottom.col, m: o.bottom.mat, off: (o.bottom.off ?? 0.006) * s };
  const apron = o.apron && { c: o.apron, m: MAT.apron, off: 0.013 * s };
  return (part, x, y, z, lz) => {
    const ax = Math.abs(x);
    if (part === 'torso') {
      if (apron && z > 0.01 * s && y < S(1.335) && y > S(0.84) && ax < (y > S(1.07) ? S(0.105) : S(0.175))) return apron;
      if (apron && y > S(1.07) && y < S(1.1) && z <= 0.01 * s) return apron;             // waist ties
      if (top && y >= S(o.top.hem)) {
        if (y > S(1.462)) return skin;
        if (o.top.kind === 'tank') {
          if (y > S(1.33) && ax > S(0.098)) return skin;
          if (y > S(1.35) && ax < S(0.066) && z > 0) return skin;
          if (y > S(1.41) && ax < S(0.06) && z < 0) return skin;
        }
        if (o.top.kind === 'shirt' && z > 0 && y > S(1.38) && ax < (y - S(1.38)) * 1.2) return skin;
        if (o.top.kind === 'shirt' && y > S(1.44) && y < S(1.462)) return { ...top, off: top.off + 0.006 * s };   // collar
        return top;
      }
      if (bot && y <= S(o.bottom.waist)) return bot;
      return skin;
    }
    if (part === 'thigh' || part === 'shin') {
      if (apron && part === 'thigh' && lz > -0.02 * s && y > S(0.55)) return apron;
      if (top && o.top.hem < 0.95 && part === 'thigh' && y >= S(o.top.hem)) return { ...top, off: top.off + 0.01 * s };
      if (bot && y >= S(o.bottom.hem)) {
        if (o.bottom.cuff && y < S(o.bottom.hem + 0.05)) return { ...bot, off: bot.off + 0.009 * s };
        return bot;
      }
      if (o.socks && y < S(o.socks.top)) return { c: o.socks.col, m: MAT.cotton, off: 0.004 * s };
      return skin;
    }
    if (part === 'arm' || part === 'fore') {
      if (top && y >= S(o.top.sleeve)) {
        if (o.top.roll && y < S(o.top.sleeve + 0.05)) return { ...top, off: top.off + 0.01 * s };
        return top;
      }
      return skin;
    }
    return skin;
  };
}

// ---------------------------------------------------------------------------
// Body
const TORSO_M = [   // y (1.75 m man), half-width, front depth, back depth
  [0.83, 0.12, 0.08, 0.085], [0.88, 0.162, 0.1, 0.118], [0.94, 0.172, 0.1, 0.128], [1.0, 0.163, 0.095, 0.108],
  [1.07, 0.148, 0.094, 0.094], [1.15, 0.153, 0.1, 0.094], [1.23, 0.163, 0.114, 0.1], [1.31, 0.173, 0.12, 0.102],
  [1.38, 0.178, 0.1, 0.1], [1.43, 0.162, 0.072, 0.084], [1.47, 0.09, 0.05, 0.06], [1.505, 0.058, 0.045, 0.05],
];
const TORSO_F = [
  [0.83, 0.125, 0.08, 0.09], [0.88, 0.172, 0.1, 0.125], [0.94, 0.182, 0.1, 0.132], [1.0, 0.168, 0.092, 0.11],
  [1.07, 0.132, 0.085, 0.085], [1.15, 0.136, 0.09, 0.088], [1.23, 0.148, 0.1, 0.093], [1.31, 0.155, 0.1, 0.094],
  [1.38, 0.16, 0.09, 0.092], [1.43, 0.146, 0.068, 0.078], [1.47, 0.082, 0.047, 0.055], [1.505, 0.052, 0.042, 0.046],
];
const THIGH = [[-0.06, 0.074, 0.08, -0.01], [0, 0.084, 0.088, 0], [0.15, 0.082, 0.087, 0.006], [0.4, 0.073, 0.077, 0.008], [0.7, 0.061, 0.064, 0.006], [0.9, 0.051, 0.054, 0.003], [1.0, 0.048, 0.052, 0.005], [1.07, 0.044, 0.046, 0.004]];
const SHIN = [[-0.05, 0.046, 0.05, 0.004], [0.05, 0.047, 0.05, 0.002], [0.28, 0.047, 0.056, -0.012], [0.5, 0.04, 0.046, -0.008], [0.75, 0.031, 0.033, -0.002], [0.93, 0.027, 0.029, 0], [1.03, 0.028, 0.03, 0]];
const UPPER = [[-0.15, 0.022, 0.026, 0], [-0.09, 0.044, 0.047, 0], [0, 0.051, 0.053, 0], [0.18, 0.048, 0.051, -0.002], [0.5, 0.041, 0.043, 0], [0.85, 0.035, 0.038, 0], [1.03, 0.033, 0.035, 0]];
const FORE = [[-0.06, 0.032, 0.035, 0], [0.15, 0.036, 0.037, 0.004], [0.5, 0.03, 0.029, 0.002], [0.85, 0.021, 0.026, 0], [1.03, 0.018, 0.025, 0]];
const HAND = [[-0.04, 0.016, 0.024, 0], [0.15, 0.02, 0.037, 0.003], [0.45, 0.019, 0.042, 0.005], [0.62, 0.016, 0.039, 0.008], [0.85, 0.012, 0.031, 0.012], [1.0, 0.006, 0.018, 0.014]];

function buildBody(ms, o, J) {
  const s = o.height / 1.75, g = o.girth ?? 1, fem = o.fem, lim = fem ? 0.9 : 1;
  const zone = outfitZones(o, s);
  const V = (p, z, b) => ({ p, c: z.c, m: z.m, ...b });

  // torso: superellipse sections, pelvis -> spine -> chest weights
  const T = fem ? TORSO_F : TORSO_M;
  const y0 = T[0][0], y1 = T[T.length - 1][0];
  const bust = fem ? 0.03 : 0;
  loft(ms, 26, 22, (u, v) => {
    const yy = lerp(y0, y1, u), [a0, bf, bb] = profile(T, yy);
    const th = v * TAU, c = Math.cos(th), sn = Math.sin(th);
    const n = lerp(2.5, 2.2, smooth(1.0, 1.2, yy));
    const a = a0 * s * g, x = a * se(c, n);
    let z = (sn > 0 ? bf : bb) * s * g * se(sn, n);
    if (sn > 0 && bust) z += bust * s * Math.exp(-(((yy - 1.27) / 0.05) ** 2)) * Math.exp(-(((Math.abs(x) / s - 0.062) / 0.05) ** 2));
    const y = yy * s;
    const zn = zone('torso', x, y, z, z);
    const r = Math.hypot(x, z) || 1;
    const p = [x + (x / r) * zn.off, y, z + (z / r) * zn.off];
    let w;
    if (yy < 0.99) w = W1(B.PELVIS);
    else if (yy < 1.11) w = W2(B.PELVIS, B.SPINE, smooth(0.99, 1.11, yy));
    else if (yy < 1.24) w = W2(B.SPINE, B.CHEST, smooth(1.11, 1.24, yy));
    else w = W2(B.CHEST, B.NECK, 0.35 * smooth(1.45, 1.505, yy));
    return V(p, zn, w);
  });

  // neck
  const nk = J[B.NECK];
  loft(ms, 6, 14, (u, v) => {
    const th = v * TAU, y = lerp(1.44, 1.64, u) * s;
    const r = lerp(0.056, 0.05, u) * s * lim * (fem ? 1 : 1.04);
    const p = [r * Math.cos(th), y, nk[2] + 0.012 * s * u + r * 1.04 * Math.sin(th)];
    const w = u < 0.5 ? W2(B.CHEST, B.NECK, 0.3 + u) : W2(B.NECK, B.HEAD, (u - 0.5) * 1.2);
    return V(p, { c: o.skin, m: MAT.skin }, w);
  });

  buildHead(ms, o, J, s);

  // limbs along -y from their joint
  const limb = (bone, parent, child, part, keys, len, t0, t1, nu, nv, k = 1) => {
    const O = J[bone];
    loft(ms, nu, nv, (u, v) => {
      const t = lerp(t0, t1, u), [rx0, rz0, cz] = profile(keys, t);
      const th = v * TAU, c = Math.cos(th), sn = Math.sin(th);
      const rx = rx0 * s * k, rz = rz0 * s * k;
      const x = O[0] + rx * c, y = O[1] - t * len, lz = cz * s + rz * sn, z = O[2] + lz;
      const zn = zone(part, x, y, z, lz);
      const p = [x + c * zn.off, y, z + sn * zn.off];
      let w = W1(bone);
      if (child !== null && t > 0.8) w = W2(bone, child, 0.5 * smooth(0.8, 1.0, t));
      if (parent !== null && t < 0.2) w = W2(bone, parent, 0.5 * (1 - smooth(-0.05, 0.2, t)));
      return V(p, zn, w);
    });
  };
  for (const [th, sh, ft, tb, ar, fo, ha] of [[B.THIGH_L, B.SHIN_L, B.FOOT_L, B.TOE_L, B.ARM_L, B.FORE_L, B.HAND_L], [B.THIGH_R, B.SHIN_R, B.FOOT_R, B.TOE_R, B.ARM_R, B.FORE_R, B.HAND_R]]) {
    const lt = J[th][1] - J[sh][1], ls = J[sh][1] - J[ft][1];
    limb(th, B.PELVIS, sh, 'thigh', THIGH, lt, -0.06, 1.07, 18, 16, (fem ? 1.0 : 1) * g);
    limb(sh, th, ft, 'shin', SHIN, ls, -0.05, 1.03, 16, 14, lim * g);
    const la = J[ar][1] - J[fo][1], lf = J[fo][1] - J[ha][1];
    limb(ar, B.CHEST, fo, 'arm', UPPER, la, -0.15, 1.03, 14, 14, lim * g);
    limb(fo, ar, ha, 'fore', FORE, lf, -0.06, 1.03, 12, 12, lim);
    limb(ha, fo, null, 'hand', HAND, 0.185 * s, -0.04, 1.0, 10, 10, lim);
    // thumb, rigid on the hand
    const H = J[ha], side = Math.sign(H[0]);
    loft(ms, 5, 8, (u, v) => {
      const th2 = v * TAU, r = lerp(0.012, 0.008, u) * s * lim;
      const a = [H[0] - side * 0.004 * s, H[1] - 0.035 * s, H[2] + 0.028 * s];
      const d = [0, -0.72, 0.69], L = 0.065 * s * u;
      const p = [a[0] + r * Math.cos(th2), a[1] + d[1] * L + r * 0.7 * Math.sin(th2) * 0.7, a[2] + d[2] * L + r * Math.sin(th2) * 0.7];
      return V(p, { c: o.skin, m: MAT.skin }, W1(ha));
    });
    buildFoot(ms, o, J, ft, tb, s);
  }
  if (o.hair.style === 'ponytail') {
    const P0 = J[B.PONY];
    loft(ms, 10, 10, (u, v) => {
      const th = v * TAU, r = profile([[0, 0.026], [0.25, 0.03], [0.7, 0.02], [1, 0.004]], u)[0] * s;
      const L = 0.23 * s * u;
      const p = [P0[0] + r * Math.cos(th), P0[1] - L * 0.92 + 0.02 * s * Math.sin(u * 3), P0[2] - L * 0.38 + r * Math.sin(th)];
      return V(p, { c: o.hair.col, m: MAT.hair }, W1(B.PONY));
    });
  }
  if (o.hair.style === 'bun') {
    const C = [0, J[B.HEAD][1] + 0.13 * s, -0.095 * s];
    loft(ms, 8, 12, (u, v) => {
      const ph = lerp(0.1, Math.PI - 0.1, u), th = v * TAU, r = 0.042 * s;
      return V([C[0] + r * Math.sin(ph) * Math.cos(th), C[1] + r * 0.9 * -Math.cos(ph), C[2] + r * 0.85 * Math.sin(ph) * Math.sin(th)], { c: o.hair.col, m: MAT.hair }, W1(B.HEAD));
    });
  }
}

function buildHead(ms, o, J, s) {
  const H = J[B.HEAD], f = o.fem ? 0.95 : 1;
  const C = [0, H[1] + 0.062 * s, 0.013 * s];
  const R = [0.075 * s * f, 0.106 * s * f, 0.095 * s * f];
  const hair = o.hair, tight = hair.style === 'ponytail' || hair.style === 'bun';
  const lip = o.skin.clone().multiply(new THREE.Color(0.82, 0.62, 0.6));
  loft(ms, 20, 24, (u, v) => {
    const ph = lerp(0.04, Math.PI - 0.04, u), th = v * TAU - Math.PI / 2;
    let dx = Math.sin(ph) * Math.cos(th), dy = -Math.cos(ph), dz = Math.sin(ph) * Math.sin(th);
    // v = 0.25 faces +z (front)
    let kx = 1, ky = 1, kz = 1;
    if (dy < 0) kx *= 1 - 0.3 * dy * dy;                                   // jaw narrows
    if (dy < 0 && dz < 0) kz *= 1 - 0.45 * (-dy) * (-dz);                  // under the skull, into the neck
    if (dy > 0 && dz < 0) kz *= 1 + 0.07 * dy * (-dz);                     // occiput
    if (dz > 0.3) kz *= 1 - 0.05 * dz;                                     // flatter face
    let x = dx * R[0] * kx, y = dy * R[1] * ky, z = dz * R[2] * kz;
    const front = Math.max(0, dz);
    // nose (bridge to tip), brow, eye sockets, cheekbones, chin, ears
    const nose = 0.021 * s * Math.exp(-((dx / 0.1) ** 2) - (((dy + 0.08) / 0.15) ** 2)) * (0.45 + 0.55 * smooth(0.12, -0.2, dy)) * front ** 3;
    const brow = 0.005 * s * Math.exp(-(((dy - 0.2) / 0.07) ** 2)) * front ** 4;
    const eye = -0.007 * s * Math.exp(-(((Math.abs(dx) - 0.33) / 0.12) ** 2) - (((dy - 0.1) / 0.08) ** 2)) * front;
    const cheek = 0.004 * s * Math.exp(-(((Math.abs(dx) - 0.55) / 0.15) ** 2) - (((dy + 0.05) / 0.12) ** 2)) * front;
    const chin = 0.008 * s * Math.exp(-((dx / 0.25) ** 2) - (((dy + 0.82) / 0.12) ** 2)) * front;
    const ear = 0.016 * s * Math.exp(-(((dz + 0.12) / 0.14) ** 2) - ((dy / 0.2) ** 2)) * Math.abs(dx) ** 10;
    const bump = nose + brow + eye + cheek + chin + ear;
    const rl = Math.hypot(dx, dy, dz) || 1;
    // hair: above a hairline that sits high at the forehead, above the ears, low at the nape
    const hl = 0.12 + 0.32 * front ** 1.4 - 0.55 * Math.max(0, -dz) - (tight ? 0 : 0.05) * Math.max(0, -dz);
    const hk = smooth(hl, hl + 0.08, dy);
    const thick = (tight ? 0.007 : hair.style === 'short' ? 0.012 : 0.016) * s * hk * (1 + 0.4 * Math.max(0, dy));
    const off = bump + thick;
    x += (dx / rl) * off; y += (dy / rl) * off; z += (dz / rl) * off;
    let c = o.skin, m = MAT.skin;
    if (hk > 0.5) { c = hair.col; m = MAT.hair; }
    else if (front > 0.9 && Math.abs(dy + 0.5) < 0.05 && Math.abs(dx) < 0.3) { c = lip; m = MAT.lips; }
    if (o.glasses && front > 0.55 && Math.abs(dy - 0.11) < 0.055 && hk < 0.5) {
      c = o.glasses; m = MAT.lens;
      x += (dx / rl) * 0.006 * s; z += (dz / rl) * 0.006 * s;
    }
    const w = dy < -0.55 && dz < 0.2 ? W2(B.HEAD, B.NECK, 0.3) : W1(B.HEAD);
    return { p: [C[0] + x, C[1] + y, C[2] + z], c, m, ...w };
  });
}

// Foot / shoe lofted along +z from the heel; toes skinned to the toe bone.
function buildFoot(ms, o, J, ft, tb, s) {
  const A = J[ft], shoe = o.shoes;
  const len = (o.fem ? 0.245 : 0.265) * s, z0 = -0.058 * s;
  const K = shoe
    ? [[0, 0.03, 0.058], [0.07, 0.038, 0.08], [0.22, 0.043, 0.094], [0.42, 0.046, 0.082], [0.62, 0.05, 0.062], [0.8, 0.051, 0.05], [0.93, 0.045, 0.04], [1, 0.022, 0.03]]
    : [[0, 0.026, 0.05], [0.07, 0.032, 0.074], [0.22, 0.037, 0.088], [0.42, 0.039, 0.07], [0.62, 0.043, 0.045], [0.8, 0.045, 0.03], [0.93, 0.04, 0.022], [1, 0.018, 0.014]];
  const sole = -0.08 * s - (shoe ? 0.006 * s : 0);
  loft(ms, 16, 14, (u, v) => {
    const [w0, h0] = profile(K, u), th = v * TAU;
    const w = w0 * s, h = h0 * s;
    const c = Math.cos(th), sn = Math.sin(th);
    const x = A[0] + w * se(c, 3.2) + (A[0] > 0 ? 1 : -1) * 0.006 * s * u;   // toes splay slightly out
    const yl = sole + h / 2 + (h / 2) * se(sn, sn < 0 ? 5 : 2.4);
    const z = A[2] + z0 + u * len;
    let col = o.skin, m = MAT.skin;
    if (shoe) {
      if (yl < sole + 0.02 * s) { col = shoe.sole; m = MAT.sole; }
      else { col = shoe.col; m = MAT.shoe; if (shoe.accent && yl < sole + 0.045 * s && u > 0.25 && u < 0.7 && Math.abs(c) > 0.7) col = shoe.accent; }
    }
    const wt = u > 0.66 ? W2(ft, tb, smooth(0.66, 0.8, u)) : W1(ft);
    return { p: [x, A[1] + yl, z], c: col, m, ...wt };
  });
}

// ---------------------------------------------------------------------------
// Small rigid primitives (bike, props)
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3(), _n1 = new THREE.Vector3(), _n2 = new THREE.Vector3();
function tube(ms, pts, r, nv, bone, col, mat, rEnd = r) {
  // pts: array of [x,y,z] polyline (smoothly sampled by the caller)
  const n = pts.length - 1;
  const frames = pts.map((p, i) => {
    _a.fromArray(pts[Math.max(0, i - 1)]); _b.fromArray(pts[Math.min(n, i + 1)]);
    const t = _t.subVectors(_b, _a).normalize().clone();
    const up = Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const n1 = new THREE.Vector3().crossVectors(t, up).normalize(), n2 = new THREE.Vector3().crossVectors(t, n1).normalize();
    return [n1, n2];
  });
  loft(ms, n, nv, (u, v) => {
    const i = Math.round(u * n), th = v * TAU, rr = lerp(r, rEnd, u);
    const [n1, n2] = frames[i], p = pts[i];
    return { p: [p[0] + rr * (n1.x * Math.cos(th) + n2.x * Math.sin(th)), p[1] + rr * (n1.y * Math.cos(th) + n2.y * Math.sin(th)), p[2] + rr * (n1.z * Math.cos(th) + n2.z * Math.sin(th))], c: col, m: mat, ...W1(bone) };
  });
}
const seg = (a, b, k = 1) => Array.from({ length: k + 1 }, (_, i) => a.map((v, j) => lerp(v, b[j], i / k)));
function curve(points, k) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return c.getPoints(k).map((p) => [p.x, p.y, p.z]);
}
// torus around the x axis (wheels): centre c, ring radius R, tube radii (radial rr, axial rx)
function torusX(ms, c, R, rr, rx, nu, nv, bone, col, mat, a0 = 0, a1 = TAU) {
  const full = a1 - a0 >= TAU - 1e-6;
  const verts = [], tris = [];
  const nU = full ? nu : nu + 1;
  for (let i = 0; i < nU; i++) {
    const a = a0 + (a1 - a0) * (i / nu);
    for (let j = 0; j < nv; j++) {
      const b = (j / nv) * TAU;
      const rad = R + rr * Math.cos(b);
      verts.push({ p: [c[0] + rx * Math.sin(b), c[1] + rad * Math.cos(a), c[2] + rad * Math.sin(a)], c: col, m: mat, ...W1(bone) });
    }
  }
  for (let i = 0; i < nu; i++) {
    const i1 = full ? (i + 1) % nu : i + 1;
    for (let j = 0; j < nv; j++) {
      const j1 = (j + 1) % nv;
      tris.push(i * nv + j, i1 * nv + j, i * nv + j1, i * nv + j1, i1 * nv + j, i1 * nv + j1);
    }
  }
  addTorus(ms, { verts, tris }, c, R);
}
// torus normals computed analytically (around the tube centre line)
function addTorus(ms, { verts, tris }, c, R) {
  const base = ms.n;
  for (const v of verts) {
    const p = v.p, ry = p[1] - c[1], rz = p[2] - c[2], rl = Math.hypot(ry, rz) || 1;
    const cy = c[1] + (ry / rl) * R, cz = c[2] + (rz / rl) * R;
    const nx = p[0] - c[0], ny = p[1] - cy, nz = p[2] - cz, nl = Math.hypot(nx, ny, nz) || 1;
    ms.P.push(...p); ms.N.push(nx / nl, ny / nl, nz / nl); ms.C.push(v.c.r, v.c.g, v.c.b); ms.M.push(...v.m);
    ms.SI.push(v.b[0], v.b[1], 0, 0); ms.SW.push(v.w[0], v.w[1], 0, 0);
  }
  // winding: make the first triangle agree with its vertex normal
  const p0 = verts[tris[0]].p, p1 = verts[tris[1]].p, p2 = verts[tris[2]].p;
  _a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]); _b.set(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
  _n1.crossVectors(_a, _b);
  _n2.fromArray(ms.N, (base + tris[0]) * 3);
  const flip = _n1.dot(_n2) < 0;
  for (let i = 0; i < tris.length; i += 3) {
    if (flip) ms.I.push(tris[i] + base, tris[i + 2] + base, tris[i + 1] + base);
    else ms.I.push(tris[i] + base, tris[i + 1] + base, tris[i + 2] + base);
  }
  ms.n += verts.length;
}
function box(ms, c, h, bone, col, mat, rotY = 0) {
  // axis-aligned (optionally yawed) box: flat-shaded faces
  const verts = [], tris = [];
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  const P = (x, y, z) => [c[0] + x * cs + z * sn, c[1] + y, c[2] - x * sn + z * cs];
  const faces = [
    [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]],
    [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]],
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
  ];
  const base = ms.n;
  const nrm = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  faces.forEach((f, i) => {
    const k = verts.length / 1;
    for (const q of f) {
      verts.push(P(q[0] * h[0], q[1] * h[1], q[2] * h[2]));
      const n = nrm[i];
      ms.N.push(n[0] * cs + n[2] * sn, n[1], -n[0] * sn + n[2] * cs);
    }
    tris.push(k, k + 1, k + 2, k, k + 2, k + 3);
  });
  for (const p of verts) { ms.P.push(...p); ms.C.push(col.r, col.g, col.b); ms.M.push(...mat); ms.SI.push(bone, 0, 0, 0); ms.SW.push(1, 0, 0, 0); }
  for (const t of tris) ms.I.push(t + base);
  ms.n += verts.length;
}

function buildBike(ms, o, J, saddle) {
  const frame = o.bike.frame, dark = new THREE.Color(0x1d1d1e), chrome = new THREE.Color(0xb9bcbf), tyre = new THREE.Color(0x262626);
  const brown = new THREE.Color(0x5a3a24), wick = new THREE.Color(0xa88a5c);
  const R = B.ROOT, S = B.STEER;
  const BB = J[B.CRANK];
  // wheels: tyre, rim, hub, 28 crossed spokes
  for (const [bone, c] of [[B.WHEEL_F, J[B.WHEEL_F]], [B.WHEEL_R, J[B.WHEEL_R]]]) {
    torusX(ms, c, 0.331, 0.02, 0.02, 44, 8, bone, tyre, MAT.rubber);
    torusX(ms, c, 0.307, 0.008, 0.011, 44, 5, bone, chrome, MAT.chrome);
    tube(ms, seg([c[0] - 0.05, c[1], c[2]], [c[0] + 0.05, c[1], c[2]]), 0.018, 8, bone, chrome, MAT.chrome);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU, side = i % 2 ? 1 : -1, cross = (i % 4 < 2 ? 1 : -1) * 0.35;
      const h = [c[0] + side * 0.03, c[1] + 0.024 * Math.cos(a), c[2] + 0.024 * Math.sin(a)];
      const e = [c[0], c[1] + 0.301 * Math.cos(a + cross), c[2] + 0.301 * Math.sin(a + cross)];
      tube(ms, seg(h, e), 0.0014, 3, bone, chrome, MAT.chrome);
    }
  }
  // fenders (frame colour), front on the fork
  torusX(ms, J[B.WHEEL_F], 0.37, 0.006, 0.03, 18, 6, S, frame, MAT.paint, -0.35, 2.3);
  torusX(ms, J[B.WHEEL_R], 0.37, 0.006, 0.03, 18, 6, R, frame, MAT.paint, 0.9, 3.9);
  // step-through frame: curved down tube, seat tube, stays, head tube
  const HTb = [0, 0.6, 0.4], HTt = J[B.STEER];
  tube(ms, curve([[0, 0.7, 0.378], [0, 0.5, 0.27], [0, 0.34, 0.08], [BB[0], BB[1] + 0.02, BB[2]]], 12), 0.02, 10, R, frame, MAT.paint);
  tube(ms, curve([[0, 0.61, 0.395], [0, 0.42, 0.24], [0, 0.33, 0.05], [0, 0.3, -0.03]], 10), 0.014, 8, R, frame, MAT.paint);
  const ST = [0, 0.8, -0.26];
  tube(ms, seg(BB, ST, 2), 0.017, 10, R, frame, MAT.paint);
  tube(ms, seg(HTb, HTt, 2), 0.022, 10, R, frame, MAT.paint);
  const RA = J[B.WHEEL_R];
  for (const x of [-1, 1]) {
    tube(ms, seg([x * 0.02, BB[1], BB[2]], [x * 0.06, RA[1], RA[2]], 3), 0.01, 6, R, frame, MAT.paint);
    tube(ms, seg([x * 0.015, 0.76, -0.25], [x * 0.06, RA[1] + 0.01, RA[2]], 3), 0.009, 6, R, frame, MAT.paint);
    // rear rack side rails and struts
    tube(ms, seg([x * 0.075, 0.74, -0.3], [x * 0.075, 0.74, -0.8], 2), 0.006, 5, R, dark, MAT.paint);
    tube(ms, seg([x * 0.075, 0.74, -0.74], [x * 0.065, RA[1], RA[2] - 0.01], 2), 0.005, 5, R, dark, MAT.paint);
  }
  for (const z of [-0.42, -0.58, -0.74]) tube(ms, seg([-0.075, 0.742, z], [0.075, 0.742, z]), 0.005, 5, R, dark, MAT.paint);
  // seat post + sprung saddle
  tube(ms, seg(ST, [saddle[0], saddle[1] - 0.06, saddle[2]], 2), 0.012, 8, R, chrome, MAT.chrome);
  for (const x of [-0.045, 0.045]) tube(ms, curve([[x, saddle[1] - 0.06, saddle[2] - 0.02], [x * 1.3, saddle[1] - 0.045, saddle[2] - 0.07], [x * 1.3, saddle[1] - 0.02, saddle[2] - 0.08]], 6), 0.007, 6, R, dark, MAT.chrome);
  loft(ms, 12, 14, (u, v) => {
    const [w, h] = profile([[0, 0.035, 0.03], [0.12, 0.105, 0.05], [0.4, 0.1, 0.048], [0.7, 0.045, 0.04], [1, 0.024, 0.03]], u);
    const th = v * TAU;
    const x = w * se(Math.cos(th), 2.6), y = saddle[1] - 0.025 + h * 0.5 * se(Math.sin(th), 2.6) + 0.012 * Math.sin(u * Math.PI);
    return { p: [saddle[0] + x, y, saddle[2] - 0.11 + u * 0.27], c: brown, m: MAT.leather, ...W1(R) };
  });
  // fork, stem, swept-back bars, grips, basket (all steer)
  const FA = J[B.WHEEL_F];
  for (const x of [-1, 1]) tube(ms, curve([[x * 0.028, HTb[1], HTb[2]], [x * 0.045, 0.47, 0.49], [x * 0.052, FA[1], FA[2]]], 6), 0.011, 6, S, frame, MAT.paint);
  tube(ms, seg(HTt, [0, 0.98, 0.31], 2), 0.013, 8, S, chrome, MAT.chrome);
  for (const x of [-1, 1]) {
    tube(ms, curve([[0, 0.98, 0.31], [x * 0.14, 0.99, 0.3], [x * 0.24, 1.0, 0.2], [x * 0.28, 1.01, 0.1]], 10), 0.011, 7, S, chrome, MAT.chrome);
    tube(ms, seg([x * 0.28, 1.01, 0.11], [x * 0.295, 1.012, 0.0], 2), 0.017, 8, S, brown, MAT.leather);
  }
  box(ms, [0, 0.92, 0.53], [0.17, 0.12, 0.13], S, wick, MAT.wicker);
  // chainring + guard, cranks, pedals
  torusX(ms, [-0.058, BB[1], BB[2]], 0.09, 0.008, 0.004, 28, 5, B.CRANK, dark, MAT.chrome);
  box(ms, [-0.068, BB[1] + 0.02, (BB[2] + RA[2]) / 2], [0.004, 0.06, 0.3], R, frame, MAT.paint);
  tube(ms, seg([-0.07, BB[1], BB[2]], [0.07, BB[1], BB[2]]), 0.02, 8, R, chrome, MAT.chrome);
  tube(ms, seg([-0.075, BB[1], BB[2]], J[B.PEDAL_R].map((v, i) => (i === 0 ? -0.08 : v))), 0.011, 6, B.CRANK, chrome, MAT.chrome);
  tube(ms, seg([0.075, BB[1], BB[2]], J[B.PEDAL_L].map((v, i) => (i === 0 ? 0.08 : v))), 0.011, 6, B.CRANK, chrome, MAT.chrome);
  for (const [bone, x] of [[B.PEDAL_L, 1], [B.PEDAL_R, -1]]) {
    const P = J[bone];
    box(ms, [P[0] + x * 0.03, P[1], P[2]], [0.045, 0.012, 0.04], bone, dark, MAT.rubber);
  }
}

// ---------------------------------------------------------------------------
// Materials
let BODY_MAT = null;
function bodyMaterial() {
  if (BODY_MAT) return BODY_MAT;
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.8, metalness: 0, sheen: 1, sheenRoughness: 0.75, sheenColor: new THREE.Color(0.55, 0.55, 0.55) });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aMat;\nvarying vec3 vPMat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPMat = aMat;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPMat;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vPMat.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vPMat.z;')
      .replace('#include <lights_physical_fragment>', THREE.ShaderChunk.lights_physical_fragment.replace('material.sheenColor = sheenColor;', 'material.sheenColor = sheenColor * vPMat.y;'));
  };
  m.customProgramCacheKey = () => 'people-body-v1';
  BODY_MAT = m;
  return m;
}

const f5 = (v) => v.toFixed(5);
const GROUND_GLSL = /* glsl */ `
  float odSm(float a, float b, float v) { float t = clamp((v - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
  float odRoad(float x) {
    float c = ${f5(LANES.centerX)};
    float w = x < c ? c - (${f5(SIDEWALK_W.x1)}) : (${f5(LANES.x1)}) - c;
    float t = min(1.0, abs(x - c) / w);
    return 0.09 * (1.0 - t * t);
  }
  float odSand(vec2 p) {
    float x = p.x, z = p.y, h;
    if (x < ${f5(SAND.waterline - 4)}) {
      float t = (x - ${f5(SAND.x0)}) / ${f5(SAND.waterline - 4 - SAND.x0)};
      h = 0.55 - (0.55 - ${f5(SEA_LEVEL + 0.1)}) * t;
    } else {
      float t = (x - ${f5(SAND.waterline - 4)}) / 26.0;
      h = ${f5(SEA_LEVEL + 0.1)} - 1.6 * min(1.0, t) * min(1.0, t) - 0.2 * max(0.0, t - 1.0);
    }
    float fade = odSm(${f5(SAND.x0 + 0.6)}, ${f5(SAND.x0 + 4)}, x) * (1.0 - odSm(${f5(WET_LINE_X - 6)}, ${f5(WET_LINE_X - 1)}, x))
      * (1.0 - odSm(${f5(SAND_DETAIL_Z - 40)}, ${f5(SAND_DETAIL_Z)}, abs(z)));
    h += fade * (0.05 * sin(x * 0.21 + sin(z * 0.05) * 1.7) * sin(z * 0.13 + x * 0.04)
      + 0.03 * sin(x * 0.61 + z * 0.23 + 1.3) * sin(z * 0.37 - x * 0.19)
      + 0.012 * sin(x * 1.7 + z * 0.9) * sin(z * 1.3 - x * 0.7 + 2.1));
    return h;
  }
  float odGround(vec2 p) {
    float x = p.x;
    if (x < ${f5(HOTEL.patioX)}) return uTerraceY;
    if (x < ${f5(SIDEWALK_W.x1)}) return ${f5(CURB_HEIGHT)};
    if (x < ${f5(SIDEWALK_E.x0)}) return odRoad(x);
    if (x < ${f5(SAND.x0)}) return ${f5(CURB_HEIGHT)};
    return odSand(p);
  }
`;

// Projected sun shadow for one figure (same skeleton, same geometry).
const SH_SHARED = {
  uSun: { value: SUN_DIR.clone() },
  uInvProj: { value: new THREE.Matrix4() },
  uProj: { value: new THREE.Matrix4() },
  uViewport: { value: new THREE.Vector4(0, 0, 1, 1) },
};
function shadowMaterial(per) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  m.fog = false;
  m.transparent = true;
  m.depthWrite = true;
  m.toneMapped = false;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.ZeroFactor;
  m.blendDst = THREE.SrcColorFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  const decl = /* glsl */ `
    uniform vec3 uSun;
    uniform float uBaseY, uWallX, uTerraceY, uStrength;
    varying float vOdH;
    ${GROUND_GLSL}`;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, SH_SHARED, per);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${decl}
        vec3 odProject(vec3 p) {
          vec3 q = p - uSun * ((p.y - uBaseY) / uSun.y);
          for (int i = 0; i < 2; i++) { float g = odGround(q.xz); q = p - uSun * ((p.y - g) / uSun.y); }
          if (q.x < uWallX + 0.03) q = p - uSun * ((p.x - uWallX - 0.03) / uSun.x);
          return q;
        }`)
      .replace('#include <skinnormal_vertex>', '#include <skinnormal_vertex>\nobjectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvOdH = transformed.y - uBaseY;\ntransformed = odProject(transformed);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${decl}
        uniform mat4 uInvProj, uProj;
        uniform vec4 uViewport;`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        // exact ground point under this pixel: every shadow layer gets the same depth, so
        // overlapping body parts darken the ground only once
        vec2 odNdc = (gl_FragCoord.xy - uViewport.xy) / uViewport.zw * 2.0 - 1.0;
        vec4 odV = uInvProj * vec4(odNdc, -1.0, 1.0);
        vec3 odDir = normalize(transpose(mat3(viewMatrix)) * normalize(odV.xyz / odV.w));
        vec3 odO = cameraPosition;
        float odT = 1e5;
        bool odWall = false;
        if (odDir.y < -1e-4) {
          odT = (uBaseY - odO.y) / odDir.y;
          for (int i = 0; i < 3; i++) { vec3 P = odO + odDir * odT; odT = (odGround(P.xz) - odO.y) / odDir.y; }
        }
        vec3 odP = odO + odDir * odT;
        if ((odP.x < uWallX + 0.03 || odDir.y >= -1e-4) && odDir.x < 0.0) {
          odT = (uWallX + 0.03 - odO.x) / odDir.x; odP = odO + odDir * odT; odWall = true;
        }
        vec3 odQ = odP - odDir * (0.035 + 0.0006 * odT);
        vec4 odClip = uProj * viewMatrix * vec4(odQ, 1.0);
        gl_FragDepth = 0.5 * odClip.z / odClip.w + 0.5;
        normal = normalize((viewMatrix * vec4(odWall ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), 0.0)).xyz);`)
      .replace('#include <opaque_fragment>', /* glsl */ `
        // darken by what the sun adds here (nothing where the ground is already in shadow),
        // softer further from the caster (penumbra), fading into the haze
        vec3 odD = reflectedLight.directDiffuse, odI = reflectedLight.indirectDiffuse;
        // (the scene's ground materials read darker in shade than this lambert ratio: gain)
        vec3 odRatio = 1.0 - clamp(odD / max(odD + odI, vec3(1e-5)) * ${f5(SHADOW_GAIN)}, 0.0, 0.85);
        float odK = uStrength * mix(1.0, 0.62, smoothstep(0.2, 1.8, vOdH)) * exp(-odT * ${f5(FOG)});
        gl_FragColor = vec4(mix(vec3(1.0), odRatio, odK), 1.0);
        if (uStrength > 5.0) gl_FragColor = vec4(vec3(1.0 - odRatio.g) * (uStrength - 5.0), 1.0);`);
  };
  m.customProgramCacheKey = () => 'people-shadow-v1';
  return m;
}

// ---------------------------------------------------------------------------
// Figure: skeleton + skinned body + projected shadow
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _e = new THREE.Euler();

function makeFigure(scene, o) {
  const s = o.height / 1.75;
  const J = joints(s, o.fem);
  const ms = new Mesher();
  let saddle = null;
  if (o.bike) {
    // saddle from the rider's leg: hip over the pedal at the bottom with a slight knee bend
    const leg = J[B.THIGH_L][1] - J[B.FOOT_L][1];
    const hipY = 0.29 - 0.17 + 0.1 + leg * 0.955, hipZ = -0.06 - 0.21;
    saddle = [0, hipY - 0.085, hipZ];
    o.bike.hip = [hipY, hipZ];
  }
  buildBody(ms, o, J);
  if (o.sandals) {
    const H = J[B.HAND_R];
    for (const dx of [-0.011, 0.011]) box(ms, [H[0] + dx, H[1] - 0.29 * s, H[2] + 0.02 * s + dx], [0.006, 0.12 * s, 0.045 * s], B.HAND_R, o.sandals, MAT.leather, dx * 8);
  }
  if (o.cloth) {
    const H = J[B.HAND_R];
    box(ms, [H[0], H[1] - 0.12 * s, H[2] + 0.02 * s], [0.03, 0.05, 0.05], B.HAND_R, o.cloth, MAT.cotton, 0.4);
  }
  if (o.bike) buildBike(ms, o, J, saddle);
  const geo = ms.geometry();

  const bones = J.map(() => new THREE.Bone());
  bones.forEach((b, i) => {
    const p = PARENT[i];
    if (p < 0) b.position.fromArray(J[i]);
    else { b.position.set(J[i][0] - J[p][0], J[i][1] - J[p][1], J[i][2] - J[p][2]); bones[p].add(b); }
  });
  const root = bones[0];
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const rest = bones.map((b) => b.position.clone());

  const mesh = new THREE.SkinnedMesh(geo, bodyMaterial());
  mesh.bindMode = THREE.DetachedBindMode;
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  const per = { uBaseY: { value: 0 }, uWallX: { value: HOTEL.frontX }, uTerraceY: { value: TERRACE_Y }, uStrength: { value: 1.0 } };
  const shadow = new THREE.SkinnedMesh(geo, shadowMaterial(per));
  shadow.bindMode = THREE.DetachedBindMode;
  shadow.bind(skeleton, new THREE.Matrix4());
  shadow.frustumCulled = false;
  shadow.castShadow = false;
  shadow.receiveShadow = true;
  shadow.renderOrder = 2;
  shadow.onBeforeRender = (renderer, _s, camera) => {
    SH_SHARED.uInvProj.value.copy(camera.projectionMatrixInverse);
    SH_SHARED.uProj.value.copy(camera.projectionMatrix);
    renderer.getCurrentViewport(SH_SHARED.uViewport.value);
    shadow.material.uniformsNeedUpdate = true;
  };
  scene.add(root, mesh, shadow);

  // ground-contact markers: heel and ball under each foot, toe tip on the toe bone
  const markers = [];
  for (const [ft, tb] of [[B.FOOT_L, B.TOE_L], [B.FOOT_R, B.TOE_R]]) {
    const sole = -0.08 * s - (o.shoes ? 0.006 * s : 0);
    for (const z of [-0.05, 0.1]) { const m = new THREE.Object3D(); m.position.set(0, sole, z * s); bones[ft].add(m); markers.push(m); }
    const m = new THREE.Object3D(); m.position.set(0, sole + 0.055 * s, 0.075 * s); bones[tb].add(m); markers.push(m);
  }
  return { o, s, J, bones, root, rest, mesh, shadow, per, markers, saddle, tris: geo.index.count / 3 };
}

// ---------------------------------------------------------------------------
// Gaits (degrees; phase 0 = left heel strike; foot = world pitch, toes down +)
const WALK = {
  hip: [[0, 25], [0.15, 19], [0.5, -12], [0.6, -9], [0.75, 12], [0.88, 26]],
  knee: [[0, 3], [0.13, 16], [0.36, 5], [0.5, 9], [0.62, 40], [0.73, 62], [0.87, 24], [0.95, 4]],
  foot: [[0, -21], [0.1, 0], [0.4, 2], [0.52, 16], [0.62, 40], [0.72, 12], [0.82, -3], [0.93, -16]],
  toe: [[0, 0], [0.45, 0], [0.55, -18], [0.62, -36], [0.7, -6], [0.8, 0]],
  lift: null, arm: 15, armBase: 3, elbow: 14, elbowAmp: 14, yaw: 4, chestYaw: 8, list: 3, sway: 0.02, lean: 2, bob: 1,
};
const RUN = {
  hip: [[0, 26], [0.12, 12], [0.33, -14], [0.45, -6], [0.6, 18], [0.8, 38], [0.92, 32]],
  knee: [[0, 20], [0.12, 40], [0.33, 20], [0.48, 62], [0.62, 102], [0.78, 72], [0.92, 28]],
  foot: [[0, -6], [0.08, 0], [0.22, 4], [0.34, 32], [0.45, 30], [0.6, 8], [0.8, -4], [0.93, -10]],
  toe: [[0, 0], [0.22, 0], [0.3, -20], [0.36, -30], [0.44, -5], [0.55, 0]],
  lift: [[0, 0], [0.33, 0], [0.42, 0.05], [0.5, 0.01]],
  arm: 30, armBase: 8, elbow: 86, elbowAmp: 10, yaw: 7, chestYaw: 14, list: 4, sway: 0.008, lean: 7, bob: 1,
};
const hipMid = (G) => { const v = G.hip.map((k) => k[1]); return [(Math.max(...v) + Math.min(...v)) / 2, (Math.max(...v) - Math.min(...v)) / 2]; };
const KEYS = ['pelvisX', 'pelvisY', 'pelvisZ', 'spineX', 'spineY', 'spineZ', 'chestX', 'chestY', 'chestZ', 'neckX', 'neckY', 'headX', 'headY', 'headZ',
  'hipL', 'hipR', 'abdL', 'abdR', 'kneeL', 'kneeR', 'footL', 'footR', 'toeL', 'toeR', 'shL', 'shR', 'armAbL', 'armAbR', 'elL', 'elR', 'wrL', 'wrR',
  'sway', 'lift', 'pony', 'ponyZ'];
const newPose = () => Object.fromEntries(KEYS.map((k) => [k, 0]));
function mixPose(a, b, t, out = newPose()) { for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * t; return out; }

function gaitPose(G, p, st, out = newPose()) {
  const A = st.amp ?? 1, [hm, hr] = hipMid(G);
  for (const [side, ph] of [['L', p], ['R', p + 0.5]]) {
    out['hip' + side] = cyc(G.hip, ph) * A * D2R;
    out['knee' + side] = cyc(G.knee, ph) * (0.85 + 0.15 * A) * D2R;
    out['foot' + side] = cyc(G.foot, ph) * A * D2R;
    out['toe' + side] = cyc(G.toe, ph) * D2R;
    // arm follows the opposite leg, lagging a little
    const n = (cyc(G.hip, ph + 0.5 - 0.04) - hm) / hr;
    const amp = G.arm * (st.arm ?? 1) * (side === 'R' ? st.armR ?? 1 : 1);
    out['sh' + side] = (G.armBase + amp * n) * D2R;
    out['el' + side] = (G.elbow + G.elbowAmp * Math.max(0, n) + (st.elbow ?? 0)) * D2R;
    out['armAb' + side] = (st.armAb ?? 5) * D2R;
    out['wr' + side] = (G === RUN ? 12 : 4) * D2R;
    out['abd' + side] = 0;
  }
  const c = Math.cos(TAU * (p - 0.03)), sn = Math.sin(TAU * p);
  out.pelvisY = -G.yaw * c * D2R;
  out.chestY = G.chestYaw * c * D2R;
  out.pelvisZ = G.list * sn * D2R;
  out.spineZ = -0.55 * out.pelvisZ;
  out.chestZ = -0.35 * out.pelvisZ;
  out.pelvisX = (G.lean * 0.6 + (st.lean ?? 0)) * D2R + 0.012 * Math.cos(TAU * 2 * p);
  out.spineX = G.lean * 0.25 * D2R;
  out.chestX = G.lean * 0.15 * D2R + (st.chest ?? 0) * D2R;
  const lean = out.pelvisX + out.spineX + out.chestX;
  out.neckX = -lean * 0.4; out.headX = -lean * 0.55 + (st.look ?? 0) * D2R;
  out.neckY = -(out.pelvisY + out.chestY) * 0.5; out.headY = -(out.pelvisY + out.chestY) * 0.45;
  out.headZ = -(out.pelvisZ + out.spineZ + out.chestZ) * 0.8;
  out.sway = G.sway * sn;
  out.lift = G.lift ? cyc(G.lift, (p * 2) % 1) : 0;
  out.pony = 0.35 + 0.25 * Math.sin(TAU * 2 * p - 1.2);
  out.ponyZ = 0.18 * Math.sin(TAU * p);
  return out;
}
function standPose(t, st, out = newPose()) {
  for (const k of KEYS) out[k] = 0;
  const br = Math.sin(t * 1.4 + (st.seed ?? 0));
  out.kneeL = 4 * D2R; out.kneeR = 7 * D2R; out.hipL = 3 * D2R; out.hipR = 6 * D2R;
  out.footL = 0; out.footR = 0;
  out.shL = 3 * D2R; out.shR = 2 * D2R; out.elL = 12 * D2R; out.elR = 14 * D2R;
  out.armAbL = out.armAbR = 5 * D2R; out.wrL = out.wrR = 5 * D2R;
  out.pelvisZ = 2.5 * D2R; out.spineZ = -1.5 * D2R; out.chestX = 0.008 * br; out.headX = 2 * D2R;
  out.pony = 0.3;
  return out;
}

function applyPose(F, P) {
  const b = F.bones;
  for (let i = 1; i < b.length; i++) { b[i].quaternion.identity(); b[i].position.copy(F.rest[i]); }
  b[B.PELVIS].rotation.set(P.pelvisX, P.pelvisY, P.pelvisZ, 'YXZ');
  b[B.SPINE].rotation.set(P.spineX, P.spineY, P.spineZ, 'YXZ');
  b[B.CHEST].rotation.set(P.chestX, P.chestY, P.chestZ, 'YXZ');
  b[B.NECK].rotation.set(P.neckX, P.neckY, 0, 'YXZ');
  b[B.HEAD].rotation.set(P.headX, P.headY, P.headZ, 'YXZ');
  const lean = P.pelvisX + P.spineX + P.chestX;
  for (const [sd, sg, th, sh, ft, tb, ar, fo, ha] of [['L', 1, B.THIGH_L, B.SHIN_L, B.FOOT_L, B.TOE_L, B.ARM_L, B.FORE_L, B.HAND_L], ['R', -1, B.THIGH_R, B.SHIN_R, B.FOOT_R, B.TOE_R, B.ARM_R, B.FORE_R, B.HAND_R]]) {
    b[th].rotation.set(-P['hip' + sd], 0, sg * P['abd' + sd] - P.pelvisZ * 0.9);
    b[sh].rotation.set(P['knee' + sd], 0, 0);
    b[ft].rotation.set(P['foot' + sd] - (P.pelvisX - P['hip' + sd] + P['knee' + sd]), 0, 0);
    b[tb].rotation.set(P['toe' + sd], 0, 0);
    b[ar].rotation.set(-P['sh' + sd] - lean, 0, sg * P['armAb' + sd] - P.chestZ - P.spineZ - P.pelvisZ);
    b[fo].rotation.set(-P['el' + sd], 0, 0);
    b[ha].rotation.set(-P['wr' + sd], 0, 0);
  }
  b[B.PONY].rotation.set(P.pony - P.headX - P.neckX - lean, 0, P.ponyZ);
}

// place the root and drop the figure so its lowest sole point touches the ground
function settle(F, x, z, heading, ground, P) {
  const r = F.root;
  const cs = Math.cos(heading), sn = Math.sin(heading);
  r.position.set(x + cs * P.sway, 0, z - sn * P.sway);
  r.rotation.set(0, heading, 0);
  r.updateMatrixWorld(true);
  let min = Infinity;
  for (const m of F.markers) min = Math.min(min, m.getWorldPosition(_v1).y);
  r.position.y = ground - min + P.lift;
  r.updateMatrixWorld(true);
}

// stride length (m per cycle) that keeps the planted foot from sliding
function calibrate(F, G, st) {
  const P = newPose(), N = 160;
  let dist = 0, contact = 0, prev = null;
  for (let i = 0; i <= N; i++) {
    const p = i / N;
    gaitPose(G, p, st, P);
    applyPose(F, P);
    F.root.position.set(0, 0, 0); F.root.rotation.set(0, 0, 0);
    F.root.updateMatrixWorld(true);
    let min = Infinity, arg = -1, z = 0;
    F.markers.forEach((m, k) => { m.getWorldPosition(_v1); if (_v1.y < min) { min = _v1.y; arg = k; z = _v1.z; } });
    const air = G.lift && cyc(G.lift, (p * 2) % 1) > 0.004;
    if (prev && !air && prev.arg === arg && i > 0) { dist += prev.z - z; contact++; }
    prev = { arg, z };
  }
  return contact ? (dist / contact) * N : 1.3;
}

// two-bone IK towards a world target, bending towards `pole` (world direction)
function setBoneDir(bone, childRest, dir) {
  bone.parent.getWorldQuaternion(_q);
  _v3.copy(childRest).normalize().applyQuaternion(_q);
  _q2.setFromUnitVectors(_v3, _v4.copy(dir).normalize());
  bone.quaternion.copy(_q).invert().multiply(_q2).multiply(_q);
  bone.updateMatrixWorld(true);
}
function ik2(upper, lower, end, target, pole) {
  const S = upper.getWorldPosition(new THREE.Vector3());
  const a = lower.position.length(), b = end.position.length();
  const D = new THREE.Vector3().subVectors(target, S);
  const d = clamp(D.length(), 1e-4, (a + b) * 0.9995);
  D.normalize();
  const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
  const pp = pole.clone().addScaledVector(D, -pole.dot(D)).normalize();
  const E = S.clone().addScaledVector(D, x).addScaledVector(pp, h);
  setBoneDir(upper, lower.position, E.clone().sub(S));
  const T = S.clone().addScaledVector(D, d);
  setBoneDir(lower, end.position, T.sub(E));
}
function setWorldQuat(bone, q) {
  bone.parent.getWorldQuaternion(_q);
  bone.quaternion.copy(_q).invert().multiply(q);
  bone.updateMatrixWorld(true);
}

// ---------------------------------------------------------------------------
// Paths
function polyPath(pts) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = L[L.length - 1];
  return {
    total,
    at(s) {
      s = ((s % total) + total) % total;
      let lo = 0, hi = L.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
      const t = (s - L[lo]) / (L[hi] - L[lo] || 1), a = pts[lo], b = pts[hi];
      return { x: lerp(a[0], b[0], t), z: lerp(a[1], b[1], t), dx: b[0] - a[0], dz: b[1] - a[1] };
    },
  };
}
// out-and-back loop: two lines joined by half-circle turns at the ends
function loopPath(fx0, fx1, z0, z1, step = 0.5) {
  const pts = [];
  for (let z = z0; z <= z1; z += step) pts.push([fx0(z), z]);
  const turn = (za, xa, xb, dir) => {
    const cx = (xa + xb) / 2, r = Math.abs(xb - xa) / 2 + 1e-3;
    for (let i = 1; i < 10; i++) { const a = (i / 10) * Math.PI; pts.push([cx + (xa < xb ? -1 : 1) * r * Math.cos(a), za + dir * r * Math.sin(a) * 1.4]); }
  };
  turn(z1, fx0(z1), fx1(z1), 1);
  for (let z = z1; z >= z0; z -= step) pts.push([fx1(z), z]);
  turn(z0, fx1(z0), fx0(z0), -1);
  pts.push(pts[0]);
  return polyPath(pts);
}

// ---------------------------------------------------------------------------
// Cast
const C = (hex) => new THREE.Color(hex);
function cast() {
  return {
    jogger: {
      height: 1.68, fem: true, girth: 0.95, skin: C(0x8a5a3c),
      hair: { col: C(0x1c1410), style: 'ponytail' },
      top: { col: C(0x2f8c95), mat: MAT.tech, kind: 'tank', hem: 0.99, sleeve: 99, off: 0.004 },
      bottom: { col: C(0x1b1b1f), mat: MAT.tech, waist: 1.02, hem: 0.74, off: 0.006 },
      socks: { col: C(0xf2f2ef), top: 0.12 },
      shoes: { col: C(0xe9e9e6), sole: C(0xd0cfcb), accent: C(0xe0604e) },
    },
    walker: {
      height: 1.8, fem: false, girth: 1.02, skin: C(0xd6a487),
      hair: { col: C(0x9a948c), style: 'short' },
      top: { col: C(0xbfd2de), mat: MAT.linen, kind: 'shirt', hem: 0.87, sleeve: 1.02, roll: true, off: 0.013 },
      bottom: { col: C(0xcdbf9f), mat: MAT.linen, waist: 1.03, hem: 0.3, cuff: true, off: 0.011 },
      shoes: null, sandals: C(0x5c3d25),
    },
    worker: {
      height: 1.66, fem: true, girth: 1.0, skin: C(0x5b3a27),
      hair: { col: C(0x121010), style: 'bun' },
      top: { col: C(0xf3f2ee), mat: MAT.cotton, kind: 'shirt', hem: 1.0, sleeve: 1.06, roll: true, off: 0.008 },
      bottom: { col: C(0x202023), mat: MAT.cotton, waist: 1.02, hem: 0.1, off: 0.008 },
      apron: C(0x18181a), cloth: C(0xe8e6e0),
      shoes: { col: C(0x151515), sole: C(0x151515) },
    },
    cyclist: {
      height: 1.77, fem: false, girth: 1.0, skin: C(0xb57d5c),
      hair: { col: C(0x241a14), style: 'short' }, glasses: C(0x0c0c0d),
      top: { col: C(0x6f7d55), mat: MAT.cotton, kind: 'tee', hem: 0.98, sleeve: 1.3, off: 0.009 },
      bottom: { col: C(0x2b3552), mat: MAT.cotton, waist: 1.03, hem: 0.56, off: 0.01 },
      socks: { col: C(0xdedcd6), top: 0.1 },
      shoes: { col: C(0x8f8f8c), sole: C(0xe6e4df) },
      bike: { frame: C(0x9fd0c0) },
    },
    distant: {
      height: 1.64, fem: true, girth: 0.97, skin: C(0xe0b596),
      hair: { col: C(0x5a3b22), style: 'ponytail' },
      top: { col: C(0xf1efe8), mat: MAT.cotton, kind: 'tee', hem: 0.95, sleeve: 1.33, off: 0.009 },
      bottom: { col: C(0x9e3b3b), mat: MAT.cotton, waist: 1.02, hem: 0.76, off: 0.01 },
      shoes: null,
    },
  };
}

// cafe tables on the chosen terrace, read back from the hotel furniture instances
function findTables(hotels, x0, x1, z0, z1, y) {
  const out = [];
  hotels?.traverse((m) => {
    if (!m.isInstancedMesh) return;
    const g = m.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    if (Math.abs(bb.max.y - 0.76) > 0.02 || Math.abs(bb.max.x - 0.35) > 0.02) return;
    const mt = new THREE.Matrix4(), p = new THREE.Vector3();
    for (let i = 0; i < m.count; i++) {
      m.getMatrixAt(i, mt); p.setFromMatrixPosition(mt);
      if (p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1 && Math.abs(p.y - y) < 0.05) out.push({ x: p.x, z: p.z });
    }
  });
  return out.sort((a, b) => a.z - b.z);
}

// ---------------------------------------------------------------------------
export function buildPeople(scene, { beach, hotels, getCars = () => [], walker = null, shot = false, mode = null } = {}) {
  const heightAt = (x, z) => (beach ? beach.groundAt(x, z) : 0.15);
  const closeup = shot && mode === 'closeup';
  const R = cast();
  const people = [];
  const colliders = [];
  const P0 = newPose(), P1 = newPose(), P2 = newPose();

  // --- path walkers (jogger, beach walker, distant stroller) ---
  function pathPerson(F, path, o) {
    const st = o.style;
    const strideW = calibrate(F, WALK, st), strideR = o.run ? calibrate(F, RUN, st) : strideW;
    const col = { x: 0, z: 0, r: 0 };
    colliders.push(col);
    const P = {
      F, path, s: o.s0 ?? 0, speed: o.speed, phase: o.phase0 ?? 0, heading: 0, x: 0, z: 0, col, visible: true, turnSlow: o.turnSlow ?? 0,
      update(dt, cam, frozen) {
        // target speed: slow at the turns, stop for a player standing in the way
        let target = o.speed;
        const here = this.path.at(this.s);
        const ahead = this.path.at(this.s + 3.5);
        const bend = Math.abs(wrapAngle(Math.atan2(ahead.dx, ahead.dz) - Math.atan2(here.dx, here.dz)));
        if (bend > 0.35) target = Math.min(target, o.turnSpeed ?? 1.2);
        if (walker && !frozen) {
          const hx = Math.sin(this.heading), hz = Math.cos(this.heading);
          const rx = walker.pos.x - this.x, rz = walker.pos.y - this.z;
          const along = rx * hx + rz * hz, lat = Math.abs(rx * hz - rz * hx);
          if (along > 0 && along < 2.4 && lat < 0.8) target = 0;
        }
        if (!frozen) {
          this.speed += (target - this.speed) * (1 - Math.exp(-dt * 2.2));
          this.s += this.speed * dt;
        }
        const q = this.path.at(this.s);
        this.x = q.x; this.z = q.z;
        const th = Math.atan2(q.dx, q.dz);
        this.heading = frozen ? th : this.heading + wrapAngle(th - this.heading) * (1 - Math.exp(-dt * 5));
        const runW = o.run ? smooth(1.5, 2.3, this.speed) : 0;
        const stride = lerp(strideW * (o.strideK ?? 1), strideR, runW);
        if (!frozen) this.phase += (this.speed / stride) * dt;
        col.x = this.x; col.z = this.z;
        // never grow over the player (the walker would be stuck inside the circle)
        col.r = walker ? Math.min(0.3, Math.max(0, Math.hypot(walker.pos.x - this.x, walker.pos.y - this.z) - 0.305)) : 0.3;
        const d = cam ? Math.hypot(cam.position.x - this.x, cam.position.z - this.z) : 0;
        this.visible = d < CULL;
        F.mesh.visible = F.shadow.visible = this.visible;
        if (!this.visible) return;
        gaitPose(WALK, this.phase, st, P0);
        if (runW > 0) mixPose(P0, gaitPose(RUN, this.phase, st, P1), runW, P0);
        const standW = 1 - smooth(0.05, 0.45, this.speed);
        if (standW > 0) mixPose(P0, standPose(performance.now() / 1000, st, P2), standW, P0);
        applyPose(F, P0);
        if (o.carry) o.carry(F, P0);
        const g = heightAt(this.x, this.z);
        settle(F, this.x, this.z, this.heading, g, P0);
        F.per.uBaseY.value = g;
      },
    };
    return P;
  }

  // jogger: promenade, north <-> south over ~150 m, keeping to the right of the path
  {
    const F = makeFigure(scene, R.jogger);
    const path = loopPath((z) => promenadeX(z) - 0.65, (z) => promenadeX(z) + 0.65, -75, 75);
    const p = pathPerson(F, path, { speed: 2.9, run: true, turnSpeed: 1.3, style: { amp: 1.0, arm: 0.95, lean: 1, seed: 1 }, s0: 30 });
    p.name = 'jogger';
    people.push(p);
  }
  // beach walker: slow stroll on the wet sand, feet in the swash at the seaward bends
  {
    const F = makeFigure(scene, R.walker);
    const path = loopPath((z) => 90.1 + 1.2 * Math.sin(z / 16) + 0.4 * Math.sin(z / 5.1 + 1), (z) => 89.5 + 1.0 * Math.sin(z / 13 + 2), -40, 50, 0.4);
    const carry = (Fi, P) => { P.shR = 6 * D2R; P.elR = 22 * D2R; Fi.bones[B.FORE_R].rotation.x = -P.elR; Fi.bones[B.ARM_R].rotation.x = -P.shR - (P.pelvisX + P.spineX + P.chestX); };
    const p = pathPerson(F, path, { speed: 0.95, strideK: 1, turnSpeed: 0.6, style: { amp: 0.8, arm: 0.8, armR: 0.25, look: 8, seed: 2 }, carry, s0: 20 });
    p.name = 'walker';
    people.push(p);
  }
  // distant stroller far up the beach (scale figure)
  {
    const F = makeFigure(scene, R.distant);
    const path = loopPath((z) => 88.2 + 0.8 * Math.sin(z / 9), (z) => 87.6 + 0.7 * Math.sin(z / 11 + 1), -160, -112, 0.5);
    const p = pathPerson(F, path, { speed: 1.05, turnSpeed: 0.6, style: { amp: 0.9, arm: 0.9, seed: 3 }, s0: 10 });
    p.name = 'distant';
    people.push(p);
  }

  // --- cafe worker on the MARISOL terrace (the music patio at z ~ -10 is ORCHIDEA) ---
  {
    const F = makeFigure(scene, R.worker);
    const fp = hotels?.userData?.footprints?.find((f) => f.z0 > 3 && f.z1 < 26) ?? { z0: 3.8, z1: 24.6, fx: -30.4 };
    let tables = findTables(hotels, fp.fx, HOTEL.patioX, fp.z0, fp.z1, TERRACE_Y);
    if (!tables.length) tables = [7.2, 8.6, 10, 18.4, 19.8, 21.2].map((z) => ({ x: fp.fx + 1.32, z }));
    // one run of tables on the north side of the entrance steps
    const zc = (fp.z0 + fp.z1) / 2;
    let run = tables.filter((t) => t.z < zc - 1.5);
    if (run.length < 2) run = tables;
    const standX = Math.max(fp.fx + 0.34, run[0].x - 0.6);
    F.per.uWallX.value = fp.fx;
    const st = { amp: 0.75, arm: 0.7, seed: 4 };
    const strideW = calibrate(F, WALK, st) * 0.8;
    const W = {
      F, name: 'worker', x: standX, z: run[run.length - 1].z, heading: Math.PI / 2, phase: 0, speed: 0, visible: true,
      i: run.length - 1, dir: -1, task: 'wipe', t: 0, dur: 7, wipeW: 0, chairW: 0, seed: 0,
      update(dt, cam, frozen) {
        const tbl = run[this.i];
        if (!frozen) this.t += dt;
        let tx = standX, tz = tbl.z, face = Math.PI / 2;
        if (this.task === 'chair') tz = tbl.z + this.dir * 0.62;
        if (!frozen && this.t > this.dur) {
          this.t = 0;
          if (this.task === 'wipe') { this.task = 'chair'; this.dur = 3.2; }
          else if (this.task === 'chair') {
            if (this.i + this.dir < 0 || this.i + this.dir >= run.length) this.dir *= -1;
            this.i += this.dir; this.task = 'move'; this.dur = 20;
          } else { this.task = 'wipe'; this.dur = 6 + ((this.i * 7919) % 5); }
        }
        // steer to the spot, stepping round on the way
        const dx = tx - this.x, dz = tz - this.z, dist = Math.hypot(dx, dz);
        let target = 0, want = face;
        if (dist > 0.06) { want = Math.atan2(dx, dz); target = Math.abs(wrapAngle(want - this.heading)) < 0.5 ? Math.min(0.75, dist * 1.6) : 0; }
        else if (this.task === 'move') { this.task = 'wipe'; this.t = 0; this.dur = 6 + ((this.i * 7919) % 5); }
        if (!frozen) {
          this.speed += (target - this.speed) * (1 - Math.exp(-dt * 4));
          const turn = wrapAngle(want - this.heading) * (1 - Math.exp(-dt * 3));
          this.heading += turn;
          if (dist > 1e-3) { const k = Math.min(dist, this.speed * dt) / dist; this.x += dx * k; this.z += dz * k; }
          this.phase += ((this.speed + Math.abs(turn / dt) * 0.12) / strideW) * dt;
          const settled = dist < 0.08 && Math.abs(wrapAngle(face - this.heading)) < 0.2;
          this.wipeW += ((this.task === 'wipe' && settled ? 1 : 0) - this.wipeW) * (1 - Math.exp(-dt * 3));
          this.chairW += ((this.task === 'chair' && settled ? 1 : 0) - this.chairW) * (1 - Math.exp(-dt * 3));
        }
        const d = cam ? Math.hypot(cam.position.x - this.x, cam.position.z - this.z) : 0;
        this.visible = d < CULL;
        F.mesh.visible = F.shadow.visible = this.visible;
        if (!this.visible) return;
        const moveW = smooth(0.02, 0.25, this.speed + Math.abs(wrapAngle(want - this.heading)) * 0.3);
        standPose(this.t + 3, st, P0);
        if (moveW > 0) mixPose(P0, gaitPose(WALK, this.phase, st, P1), moveW, P0);
        // bend over the table: hips back, torso forward, legs stay upright
        const bw = this.wipeW * 0.95 + this.chairW * 0.55;
        P0.pelvisX += 0.3 * bw; P0.spineX += 0.2 * bw; P0.chestX += 0.12 * bw;
        P0.hipL += 0.3 * bw; P0.hipR += 0.34 * bw; P0.kneeL += 0.08 * bw; P0.kneeR += 0.1 * bw;
        P0.neckX += 0.1 * bw; P0.headX += 0.2 * bw;
        applyPose(F, P0);
        const back = 0.07 * bw;
        const g = TERRACE_Y;
        settle(F, this.x - Math.sin(this.heading) * back, this.z - Math.cos(this.heading) * back, this.heading, g, P0);
        F.per.uBaseY.value = g;
        const b = F.bones;
        if (this.wipeW > 0.01) {
          // right hand circles over the table top, left hand rests on its edge
          const k = this.t * 5.2 + this.seed;
          const top = g + 0.765 + 0.03;
          const hx = tbl.x - 0.14 + 0.11 * Math.cos(k), hz = tbl.z - 0.06 + 0.14 * Math.sin(k);
          blendIK(b[B.ARM_R], b[B.FORE_R], b[B.HAND_R], new THREE.Vector3(hx - 0.05, top + 0.07, hz), new THREE.Vector3(0.2, -0.4, -1), this.wipeW);
          blendIK(b[B.ARM_L], b[B.FORE_L], b[B.HAND_L], new THREE.Vector3(tbl.x - 0.33, top + 0.08, tbl.z + 0.2), new THREE.Vector3(0.2, -0.4, 1), this.wipeW);
          handFlat(b[B.HAND_R], this.wipeW); handFlat(b[B.HAND_L], this.wipeW);
        }
        if (this.chairW > 0.01) {
          // straighten the chair: both hands on its back, a small push-pull
          const k = Math.sin(this.t * 3.1) * 0.03;
          const cz = tbl.z + this.dir * 0.62;
          blendIK(b[B.ARM_R], b[B.FORE_R], b[B.HAND_R], new THREE.Vector3(tbl.x - 0.12 + k, g + 0.98, cz - 0.17), new THREE.Vector3(0, -0.4, -1), this.chairW);
          blendIK(b[B.ARM_L], b[B.FORE_L], b[B.HAND_L], new THREE.Vector3(tbl.x - 0.12 + k, g + 0.98, cz + 0.17), new THREE.Vector3(0, -0.4, 1), this.chairW);
        }
      },
    };
    people.push(W);
  }

  // --- cyclist: a slow city-bike ride along the road every minute or so ---
  {
    const F = makeFigure(scene, R.cyclist);
    const col = { x: 0, z: 0, r: 0 };
    colliders.push(col);
    const rnd = rng(77);
    const Cy = {
      F, name: 'cyclist', state: 'wait', timer: 22 + rnd() * 10, dir: 1, x: -20.5, z: 0, speed: 0, v0: 4.2, wheel: 0, crank: 0,
      coast: 0, drift: 0, visible: false, heading: 0,
      update(dt, cam, frozen) {
        if (!frozen) {
          const cars = (getCars() || []).filter((k) => k.active && k.progress > 0 && k.progress < 1);
          if (this.state === 'wait') {
            this.timer -= dt;
            if (this.timer <= 0) {
              if (cars.length) this.timer = 2;   // a car is passing: wait for a clear road
              else {
                this.state = 'ride'; this.dir = rnd() < 0.5 ? 1 : -1; this.z = -this.dir * 125; this.speed = this.v0 = 3.9 + rnd() * 0.7;
              }
            }
          } else {
            // a car coming up behind in the same lane: keep well over to the right
            const behind = cars.some((k) => k.dir === this.dir && (this.z - k.z) * this.dir > -4 && (this.z - k.z) * this.dir < 45);
            this.drift += ((behind ? 1 : 0) - this.drift) * (1 - Math.exp(-dt * 1.5));
            let target = this.v0;
            if (walker) {
              const rx = walker.pos.x - this.x, rz = (walker.pos.y - this.z) * this.dir;
              if (rz > 0 && rz < 7 && Math.abs(rx) < 1.1) target = 0;
            }
            this.speed += (target - this.speed) * (1 - Math.exp(-dt * (target < this.speed ? 2.5 : 0.8)));
            this.z += this.dir * this.speed * dt;
            this.coast = (this.coast + dt) % 9;
            const pedal = this.coast < 6.5 && this.speed > 0.8;
            this.wheel += (this.speed * dt) / 0.351;
            if (pedal) this.crank += (this.speed * dt) / 0.351 / 2.3;   // freewheels while coasting
            if (Math.abs(this.z) > 126) { this.state = 'wait'; this.timer = 12 + rnd() * 25; }
          }
        }
        const baseX = this.dir > 0 ? -20.45 : -15.55;
        this.x = baseX + (this.dir > 0 ? -0.55 : 0.5) * this.drift;
        this.heading = this.dir > 0 ? 0 : Math.PI;
        const riding = this.state === 'ride';
        const d = cam ? Math.hypot(cam.position.x - this.x, cam.position.z - this.z) : 0;
        this.visible = riding && d < CULL;
        F.mesh.visible = F.shadow.visible = this.visible;
        col.x = this.x; col.z = this.z;
        col.r = riding && walker ? Math.min(0.55, Math.max(0, Math.hypot(walker.pos.x - this.x, walker.pos.y - this.z) - 0.305)) : 0;
        if (!this.visible) return;
        poseCyclist(F, this, P0);
      },
    };
    people.push(Cy);
  }

  function poseCyclist(F, c, P) {
    const b = F.bones, bk = F.o.bike;
    standPose(0, {}, P);
    P.pelvisX = 0.3; P.spineX = 0.1; P.chestX = 0.05; P.neckX = -0.12; P.headX = -0.22;
    const sway = Math.sin(c.crank * 2) * 0.012 * (c.speed > 0.8 ? 1 : 0);
    P.pelvisZ = sway; P.chestZ = -sway * 0.5;
    applyPose(F, P);
    const y = roadHeight(c.x);
    const r = F.root;
    r.position.set(c.x, y, c.z);
    r.rotation.set(0, c.heading, -sway * 0.6, 'YXZ');
    // saddle: pelvis sits on it (the hip joints a little above and in front of the sit bones)
    b[B.PELVIS].position.set(0, bk.hip[0] + 0.06 * F.s - 0.02, bk.hip[1] + 0.02);
    b[B.WHEEL_F].rotation.x = c.wheel;
    b[B.WHEEL_R].rotation.x = c.wheel;
    b[B.CRANK].rotation.x = c.crank;
    b[B.PEDAL_L].rotation.x = -c.crank;
    b[B.PEDAL_R].rotation.x = -c.crank;
    b[B.STEER].rotation.y = 0.02 * Math.sin(c.wheel * 0.21) + sway * 0.8;
    r.updateMatrixWorld(true);
    const rq = r.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rq), up = new THREE.Vector3(0, 1, 0);
    for (const [pd, th, sh, ft, side, phase] of [[B.PEDAL_L, B.THIGH_L, B.SHIN_L, B.FOOT_L, 1, 0], [B.PEDAL_R, B.THIGH_R, B.SHIN_R, B.FOOT_R, -1, Math.PI]]) {
      // ball of the foot on the pedal; ankle a little lower at the back of the stroke
      const pedal = b[pd].getWorldPosition(new THREE.Vector3());
      const a = c.crank + phase;
      const pitch = (14 + 10 * Math.sin(a + 0.6)) * D2R;
      const fq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch).premultiply(rq);
      const ball = new THREE.Vector3(side * 0.012, -0.08 * F.s + 0.012, 0.115 * F.s).applyQuaternion(fq);
      const ankle = pedal.clone().add(new THREE.Vector3(0, 0.02, 0)).sub(ball);
      ik2(b[th], b[sh], b[ft], ankle, fwd.clone().addScaledVector(new THREE.Vector3(side, 0, 0).applyQuaternion(rq), 0.08));
      setWorldQuat(b[ft], fq);
    }
    for (const [ar, fo, ha, side] of [[B.ARM_L, B.FORE_L, B.HAND_L, 1], [B.ARM_R, B.FORE_R, B.HAND_R, -1]]) {
      const grip = b[B.STEER].localToWorld(new THREE.Vector3(side * 0.288, 1.011, 0.055).sub(new THREE.Vector3(...F.J[B.STEER])));
      const wrist = grip.clone().addScaledVector(fwd, -0.075).addScaledVector(up, 0.035);
      const pole = new THREE.Vector3(side * 0.8, -0.5, -0.4).applyQuaternion(rq);
      ik2(b[ar], b[fo], b[ha], wrist, pole);
      const hq = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.35, 0, side * 1.3, 'ZXY')).premultiply(rq);
      setWorldQuat(b[ha], hq);
    }
  }

  // IK blended over the FK pose by w; pole in the figure's own frame
  function blendIK(up, lo, end, target, pole, w) {
    const qa = up.quaternion.clone(), qb = lo.quaternion.clone();
    const root = up.parent.parent.parent.parent;
    const pw = pole.clone().applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
    ik2(up, lo, end, target, pw);
    const ia = up.quaternion.clone(), ib = lo.quaternion.clone();
    up.quaternion.copy(qa).slerp(ia, w);
    lo.quaternion.copy(qb).slerp(ib, w);
    up.updateMatrixWorld(true);
  }
  function handFlat(h, w) { h.rotation.x += -0.5 * w; h.updateMatrixWorld(true); }

  // --- ?shot placements: frozen, deterministic ---
  const byName = Object.fromEntries(people.map((p) => [p.name, p]));
  if (shot) {
    const setPath = (p, z, north) => {
      // move along its loop to the leg that passes z heading north / south
      const n = Math.ceil(p.path.total / 0.25);
      let best = 0, bd = Infinity;
      for (let i = 0; i < n; i++) {
        const q = p.path.at(i * 0.25);
        if ((q.dz < 0) !== north) continue;
        const dd = Math.abs(q.z - z);
        if (dd < bd) { bd = dd; best = i * 0.25; }
      }
      p.s = best;
    };
    const J = byName.jogger, Wk = byName.walker, Ds = byName.distant, Wo = byName.worker, Cy = byName.cyclist;
    if (closeup) {
      setPath(J, -40, false); J.phase = 0.36; J.speed = 2.9;
      setPath(Wk, 20, true); Wk.phase = 0.12; Wk.speed = 0.95;
      setPath(Ds, -135, true); Ds.phase = 0.3; Ds.speed = 1.05;
      Wo.task = 'wipe'; Wo.t = 1.3; Wo.wipeW = 1;
      Cy.state = 'ride'; Cy.dir = 1; Cy.z = -30; Cy.speed = 4.2; Cy.crank = 0.6; Cy.wheel = 1.3;
    } else {
      // clear of the five harness views: jogger south of view 1 (and left of the tower
      // view), walker north of view 5, the stroller far north; the worker is indoors and
      // the cyclist not riding
      J.path = { total: 1e9, at: () => ({ x: promenadeX(85) + 0.65, z: 85, dx: 0, dz: -1 }) }; J.phase = 0.2; J.speed = 2.9;
      Wk.path = { total: 1e9, at: () => ({ x: 88, z: -66, dx: 0, dz: 1 }) }; Wk.phase = 0.6; Wk.speed = 0.95;
      setPath(Ds, -140, true);
      Cy.state = 'wait'; Cy.timer = 1e9;
    }
    for (const p of people) p.update(1 / 60, null, true);
    if (!closeup) Wo.F.mesh.visible = Wo.F.shadow.visible = false;
  }

  return {
    people: byName,
    colliders,
    tris: people.reduce((a, p) => a + p.F.tris, 0),
    update(dt, camera) {
      if (shot) return;
      dt = Math.min(dt, 0.1);
      for (const p of people) p.update(dt, camera, false);
    },
  };
}
