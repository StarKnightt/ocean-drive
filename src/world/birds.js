// Birds of a Miami Beach sunrise: brown pelicans skimming the swell in single file,
// laughing and ring-billed gulls wheeling overhead and loafing on the sand, sanderlings
// chasing the swash, boat-tailed grackles on the sidewalks, a magnificent frigatebird high
// up and a distant line of cormorants crossing the sunrise.
//
// One InstancedMesh per species. Wings are two-bone (shoulder, wrist); head, legs, tail and
// the folded wings are rigid parts. The vertex shader poses every part from three
// per-instance pose vectors that the CPU behaviours below write each frame. The sun shadow
// map is static, so ground birds get planar-projected sun shadows instead (their own draw
// call per species). 5 lit + 3 shadow draw calls in total.
//
//   const birds = createBirds(scene, { beach, surf, shot });
//   birds.update(dt, camera);
//   birds.gullSource(L)      -> { x, y, z, vx, vy, vz } of a visible gull (for the gull calls)
//   birds.onFlutter = (p) => ...   a gull took off near the player
//   birds.setQuality('low' | 'medium' | 'high')
import * as THREE from 'three';
import { SHORE_X, SEA_LEVEL } from './layout.js';
import { sunDir, SUN_COLOR } from '../sky.js';
import { mulberry32 } from '../textures/noise.js';
import { PALM_TREES } from './palms.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
const approach = (v, target, rate, dt) => v + (target - v) * Math.min(1, rate * dt);
// yaw (forward = (sin yaw, 0, cos yaw)) for a compass bearing (0 = north = -z, 90 = east = +x)
const yawOfCompass = (deg) => { const a = (deg * Math.PI) / 180; return Math.atan2(Math.sin(a), -Math.cos(a)); };
const WIND_YAW = yawOfCompass(112);   // light onshore breeze: loafing gulls face it
const SEAWARD_YAW = yawOfCompass(92);

const COUNTS = {
  high: { pelican: 6, gull: 12, sand: 10, grackle: 5, flock: 9, frigate: 1 },
  medium: { pelican: 5, gull: 9, sand: 8, grackle: 4, flock: 7, frigate: 1 },
  low: { pelican: 4, gull: 6, sand: 6, grackle: 3, flock: 0, frigate: 0 },
};

// part ids (vertex attribute aPart)
const BODY = 0, WING_IN = 1, WING_OUT = 2, FOLD = 3, HEAD = 4, LEG = 5, TAIL = 6;

// ---------------------------------------------------------------------------
// geometry

const C = (hex) => new THREE.Color(hex).toArray();
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

class Geo {
  constructor() { this.pos = []; this.part = []; this.cA = []; this.cB = []; this.cU = []; this.fe = []; this.idx = []; }
  v(x, y, z, part, c) {
    const a = c.a ?? c, b = c.b ?? a, u = c.u ?? a, fe = c.fe ?? [0, 0, 0];
    this.pos.push(x, y, z); this.part.push(part);
    this.cA.push(...a); this.cB.push(...b); this.cU.push(...u); this.fe.push(...fe);
    return this.part.length - 1;
  }
  // closed loft along z; stations [z, halfWidth, halfHeight, yCentre, xCentre?]
  loft(st, part, col, seg = 10) {
    const rings = st.map(([z, w, h, y, x = 0], i) => {
      const ring = [];
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * TAU, cx = Math.cos(a), sy = Math.sin(a);
        ring.push(this.v(x + w * cx, y + h * sy, z, part, col({ i, z, up: sy, side: cx, n: st.length })));
      }
      return ring;
    });
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < seg; k++) {
      const a = rings[i][k], b = rings[i][(k + 1) % seg], c = rings[i + 1][k], d = rings[i + 1][(k + 1) % seg];
      this.idx.push(a, b, c, b, d, c);
    }
  }
  // grid of vertex indices -> triangles; front face up when rows run +x and columns run -z
  grid(rows, flip) {
    for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < rows[r].length - 1; c++) {
      const a = rows[r][c], b = rows[r + 1][c], d = rows[r][c + 1], e = rows[r + 1][c + 1];
      if (flip) this.idx.push(a, d, b, b, d, e); else this.idx.push(a, b, d, b, e, d);
    }
  }
  // flat plate from rows of [x, y, z] points (rows root -> tip along -z, points right -> left)
  plate(rows, part, col) {
    this.grid(rows.map((row, r) => row.map(([x, y, z], c) => this.v(x, y, z, part, col(r / (rows.length - 1), c / (row.length - 1))))), false);
  }
  // both wings: stations [x, zLead, zTrail]; stations up to `wrist` are the arm, from it the hand
  wings({ st, wrist, y, camber, segs = 4, droop = 0, col }) {
    const xw = st[wrist][0], xt = st[st.length - 1][0];
    for (const s of [1, -1]) {
      const arm = [], hand = [];
      st.forEach(([x, lead, trail], i) => {
        const row = (outer) => {
          const out = [];
          for (let j = 0; j <= segs; j++) {
            const v = j / segs, xf = x / xt;
            const yy = y + camber * (lead - trail) * Math.sin(Math.PI * v) * (1 - 0.6 * xf) - droop * xf * xf;
            const c = col(xf, v);
            c.fe = outer ? [(x - xw) / (xt - xw), v, 1] : [0, v, 0];
            out.push(this.v(s * x, yy, lead + (trail - lead) * v, outer ? WING_OUT : WING_IN, c));
          }
          return out;
        };
        if (i <= wrist) arm.push(row(false));
        if (i >= wrist) hand.push(row(true));
      });
      this.grid(arm, s < 0); this.grid(hand, s < 0);
    }
  }
  // thin leg from hip to ankle plus a toe fan; mirrored for both sides
  legs({ hip, foot, r, toe, hind = 0, col }) {
    for (const s of [1, -1]) {
      const p0 = new THREE.Vector3(s * hip[0], hip[1], hip[2]), p1 = new THREE.Vector3(s * foot[0], foot[1], foot[2]);
      const ax = p1.clone().sub(p0).normalize();
      const u = new THREE.Vector3(1, 0, 0).cross(ax).normalize(), w = ax.clone().cross(u);
      const rings = [p0, p1].map((p, k) => {
        const ring = [];
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU, rr = r * (k ? 0.8 : 1.6);
          const q = p.clone().addScaledVector(u, Math.cos(a) * rr).addScaledVector(w, Math.sin(a) * rr);
          ring.push(this.v(q.x, q.y, q.z, LEG, col));
        }
        return ring;
      });
      for (let i = 0; i < 4; i++) {
        const a = rings[0][i], b = rings[0][(i + 1) % 4], c = rings[1][i], d = rings[1][(i + 1) % 4];
        this.idx.push(a, b, c, b, d, c);
      }
      const fx = s * foot[0], fy = 0.003, fz = foot[2];
      const heel = this.v(fx, fy, fz - hind, LEG, col);
      const toes = [[-0.55, 0.85], [0, 1], [0.55, 0.85]].map(([dx, dz]) => this.v(fx + dx * toe, fy, fz + dz * toe, LEG, col));
      const mid = this.v(fx, fy + 0.002, fz, LEG, col);
      this.idx.push(heel, toes[0], mid, mid, toes[0], toes[1], mid, toes[1], toes[2], heel, mid, toes[2]);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.setAttribute('cA', new THREE.Float32BufferAttribute(this.cA, 3));
    g.setAttribute('cB', new THREE.Float32BufferAttribute(this.cB, 3));
    g.setAttribute('cU', new THREE.Float32BufferAttribute(this.cU, 3));
    g.setAttribute('aFeather', new THREE.Float32BufferAttribute(this.fe, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

// folded wings: a slim blade lying along each upper flank (stations carry their own x)
function foldBlades(g, st, col) {
  for (const s of [1, -1]) g.loft(st.map(([z, w, h, y, x]) => [z, w, h, y, s * x]), FOLD, col, 6);
}

// Laughing gull (palette A, breeding: black hood, dark mantle) / ring-billed gull (B).
function gullGeo() {
  const g = new Geo();
  const WHITE = C(0xe6e6e2), MANTLE_A = C(0x585c63), MANTLE_B = C(0xa4abb3), HOOD = C(0x1b1b1e), BLACK = C(0x141416);
  const UNDERTIP = C(0x3a3a3d), BILL_A = C(0x5e1818), BILL_B = C(0xd6b444), LEG_A = C(0x331818), LEG_B = C(0xc4a23c);
  g.loft([[-0.14, 0.012, 0.012, 0.15], [-0.10, 0.034, 0.03, 0.153], [-0.04, 0.054, 0.05, 0.158], [0.02, 0.06, 0.057, 0.163],
    [0.065, 0.05, 0.052, 0.17], [0.095, 0.032, 0.036, 0.187], [0.11, 0, 0, 0.195]], BODY, (q) => {
    const top = smooth(0.2, 0.6, q.up) * (q.z < 0.07 ? 1 : 0);
    return { a: mix(WHITE, MANTLE_A, top), b: mix(WHITE, MANTLE_B, top) };
  }, 12);
  g.loft([[0.07, 0.02, 0.022, 0.193], [0.10, 0.026, 0.028, 0.212], [0.125, 0.029, 0.03, 0.222], [0.148, 0.025, 0.025, 0.225],
    [0.164, 0.014, 0.015, 0.222], [0.17, 0, 0, 0.221]], HEAD, (q) => ({ a: q.z > 0.09 ? HOOD : WHITE, b: WHITE }), 10);
  g.loft([[0.16, 0.0075, 0.009, 0.221], [0.185, 0.006, 0.0075, 0.2205], [0.203, 0.0042, 0.0058, 0.219], [0.215, 0.0018, 0.0032, 0.2165],
    [0.218, 0, 0, 0.215]], HEAD, (q) => ({ a: BILL_A, b: q.i === 2 ? BLACK : BILL_B }), 6);
  g.plate([[[0.03, 0.153, -0.115], [0, 0.155, -0.115], [-0.03, 0.153, -0.115]], [[0.05, 0.15, -0.2], [0, 0.152, -0.205], [-0.05, 0.15, -0.2]]],
    TAIL, () => ({ a: WHITE }));
  g.wings({
    st: [[0.02, 0.07, -0.065], [0.10, 0.075, -0.07], [0.17, 0.078, -0.06], [0.22, 0.07, -0.05], [0.30, 0.052, -0.05], [0.36, 0.04, -0.047],
      [0.41, 0.028, -0.044], [0.45, 0.008, -0.04], [0.48, -0.01, -0.037], [0.50, -0.026, -0.034]],
    wrist: 3, y: 0.18, camber: 0.07, col: (xf, v) => {
      const trail = v > 0.9 && xf < 0.66;
      return {
        a: xf > 0.7 ? BLACK : trail ? WHITE : MANTLE_A,
        b: xf > 0.8 ? (xf > 0.94 && v > 0.2 && v < 0.8 ? WHITE : BLACK) : trail ? WHITE : MANTLE_B,
        u: xf > 0.8 ? UNDERTIP : WHITE,
      };
    },
  });
  foldBlades(g, [[0.06, 0.004, 0.016, 0.186, 0.047], [0.0, 0.012, 0.027, 0.19, 0.057], [-0.07, 0.012, 0.024, 0.183, 0.051],
    [-0.14, 0.008, 0.012, 0.172, 0.03], [-0.2, 0.004, 0.005, 0.165, 0.014], [-0.215, 0, 0, 0.164, 0.01]],
  (q) => ({ a: q.z < -0.1 ? BLACK : MANTLE_A, b: q.z < -0.19 ? WHITE : q.z < -0.11 ? BLACK : MANTLE_B }));
  g.legs({ hip: [0.022, 0.115, 0.0], foot: [0.022, 0.004, 0.006], r: 0.0045, toe: 0.034, hind: 0.012, col: { a: LEG_A, b: LEG_B } });
  return {
    geo: g.build(),
    rig: { shoulder: [0.035, 0.185, 0.035], wrist: [0.22, 0.18, 0.0], neck: [0, 0.19, 0.085], hip: [0.022, 0.115, 0.0], tail: [0, 0.153, -0.115], legSwing: 0.45, height: 0.23 },
  };
}

// Brown pelican (flight only): pale head on a drawn-in neck, long bill and pouch, broad
// fingered wings.
function pelicanGeo() {
  const g = new Geo();
  const UNDER = C(0x3a342e), BACK = C(0x6e675e), HEADC = C(0xd8cca6), NECK = C(0xe0dbd0), NAPE = C(0x4a3326);
  const BILL = C(0x8a7e6c), BILLTIP = C(0xa06a3a), POUCH = C(0x3e342c), DARK = C(0x221f1c), COVERT = C(0x7a736b), UCOV = C(0x4c4640);
  g.loft([[-0.40, 0.025, 0.025, 0.0], [-0.32, 0.08, 0.07, 0.0], [-0.18, 0.14, 0.12, 0.0], [-0.02, 0.16, 0.135, 0.01], [0.12, 0.135, 0.125, 0.03],
    [0.22, 0.095, 0.105, 0.06], [0.29, 0.055, 0.07, 0.085], [0.32, 0, 0, 0.09]], BODY, (q) => ({ a: mix(UNDER, BACK, smooth(0.1, 0.7, q.up)) }), 12);
  g.loft([[0.16, 0.07, 0.08, 0.10], [0.25, 0.076, 0.086, 0.14], [0.33, 0.068, 0.075, 0.16], [0.39, 0.058, 0.062, 0.162], [0.43, 0.04, 0.045, 0.157],
    [0.45, 0, 0, 0.152]], HEAD, (q) => ({ a: q.z > 0.3 ? HEADC : q.up > 0.4 ? NAPE : NECK }), 10);
  g.loft([[0.41, 0.032, 0.026, 0.158], [0.5, 0.03, 0.022, 0.146], [0.6, 0.025, 0.018, 0.128], [0.7, 0.02, 0.014, 0.108], [0.77, 0.016, 0.011, 0.093],
    [0.8, 0.009, 0.009, 0.085], [0.806, 0, 0, 0.08]], HEAD, (q) => ({ a: q.i >= 4 ? BILLTIP : BILL }), 6);
  g.loft([[0.40, 0.028, 0.03, 0.125], [0.52, 0.026, 0.03, 0.113], [0.64, 0.02, 0.02, 0.1], [0.73, 0, 0, 0.09]], HEAD, () => ({ a: POUCH }), 6);
  g.plate([[[0.07, 0, -0.36], [0, 0.005, -0.36], [-0.07, 0, -0.36]], [[0.11, -0.005, -0.52], [0, 0, -0.54], [-0.11, -0.005, -0.52]]], TAIL, () => ({ a: DARK }));
  g.wings({
    st: [[0.08, 0.17, -0.2], [0.3, 0.19, -0.21], [0.5, 0.18, -0.18], [0.55, 0.17, -0.17], [0.72, 0.135, -0.15], [0.86, 0.105, -0.14],
      [0.98, 0.075, -0.13], [1.05, 0.04, -0.105]],
    wrist: 3, y: 0.03, camber: 0.06, droop: 0.03, col: (xf, v) => ({
      a: xf > 0.53 || v > 0.55 ? DARK : COVERT,
      u: xf < 0.5 && v < 0.4 ? UCOV : DARK,
    }),
  });
  return {
    geo: g.build(),
    rig: { shoulder: [0.1, 0.05, 0.07], wrist: [0.55, 0.03, 0.0], neck: [0, 0.12, 0.2], hip: [0, 0, 0], tail: [0, 0, -0.36], legSwing: 0, fingers: 5, fingerLen: 0.4 },
  };
}

// Magnificent frigatebird: black, long angular crooked wings, deeply forked tail.
function frigateGeo() {
  const g = new Geo();
  const BLACK = C(0x101012), BILL = C(0x70727a);
  g.loft([[-0.24, 0.02, 0.02, 0], [-0.15, 0.055, 0.055, 0], [0.0, 0.07, 0.07, 0], [0.12, 0.055, 0.06, 0.01], [0.2, 0.035, 0.04, 0.02], [0.23, 0, 0, 0.025]],
    BODY, () => ({ a: BLACK }), 10);
  g.loft([[0.17, 0.03, 0.035, 0.025], [0.23, 0.035, 0.036, 0.032], [0.28, 0.024, 0.024, 0.032], [0.3, 0, 0, 0.03]], HEAD, () => ({ a: BLACK }), 8);
  g.loft([[0.28, 0.009, 0.011, 0.03], [0.38, 0.007, 0.008, 0.027], [0.44, 0.004, 0.006, 0.022], [0.455, 0, 0, 0.016]], HEAD, () => ({ a: BILL }), 6);
  for (const s of [1, -1]) {
    const rows = [[[0.035, 0, -0.2], [-0.005, 0, -0.2]], [[0.075, 0, -0.45], [0.05, 0, -0.45]], [[0.105, 0, -0.68], [0.095, 0, -0.68]]];
    g.plate(rows.map((row) => (s > 0 ? row : row.map(([x, y, z]) => [-x, y, z]).reverse())), TAIL, () => ({ a: BLACK }));
  }
  g.wings({
    st: [[0.05, 0.12, -0.14], [0.25, 0.13, -0.1], [0.42, 0.14, -0.08], [0.47, 0.13, -0.075], [0.65, 0.07, -0.08], [0.82, 0.0, -0.08],
      [0.97, -0.08, -0.1], [1.1, -0.17, -0.13]],
    wrist: 3, y: 0.02, camber: 0.05, col: () => ({ a: BLACK }),
  });
  return { geo: g.build(), rig: { shoulder: [0.05, 0.02, 0.05], wrist: [0.47, 0.02, 0.02], neck: [0, 0.03, 0.18], hip: [0, 0, 0], tail: [0, 0, -0.2], legSwing: 0 } };
}

// Sanderling: pale grey above, white below, black bill and legs.
function sanderlingGeo() {
  const g = new Geo();
  const WHITE = C(0xe8e8e3), GREY = C(0x9b9892), DARK = C(0x3b3a37), BLACK = C(0x111111);
  g.loft([[-0.075, 0.008, 0.008, 0.075], [-0.055, 0.02, 0.019, 0.076], [-0.02, 0.03, 0.029, 0.078], [0.02, 0.031, 0.03, 0.08], [0.045, 0.024, 0.025, 0.086],
    [0.06, 0, 0, 0.092]], BODY, (q) => ({ a: mix(WHITE, GREY, smooth(0.05, 0.45, q.up)) }), 10);
  g.loft([[0.04, 0.013, 0.014, 0.09], [0.057, 0.017, 0.018, 0.098], [0.072, 0.016, 0.016, 0.1], [0.083, 0.009, 0.01, 0.1], [0.087, 0, 0, 0.0995]],
    HEAD, (q) => ({ a: q.up > 0.35 ? GREY : WHITE }), 8);
  g.loft([[0.082, 0.0028, 0.003, 0.0995], [0.1, 0.002, 0.002, 0.098], [0.111, 0, 0, 0.0965]], HEAD, () => ({ a: BLACK }), 5);
  g.plate([[[0.012, 0.078, -0.06], [0, 0.079, -0.06], [-0.012, 0.078, -0.06]], [[0.016, 0.076, -0.084], [0, 0.077, -0.086], [-0.016, 0.076, -0.084]]],
    TAIL, (r, c) => ({ a: c === 0.5 ? DARK : GREY }));
  g.wings({
    st: [[0.01, 0.035, -0.035], [0.05, 0.035, -0.033], [0.08, 0.03, -0.03], [0.13, 0.015, -0.03], [0.17, -0.002, -0.028], [0.2, -0.02, -0.026]],
    wrist: 2, y: 0.085, camber: 0.05, segs: 4, col: (xf, v) => {
      const bar = v > 0.45 && v < 0.75 && xf > 0.15 && xf < 0.8;
      return { a: bar ? WHITE : v < 0.25 || xf > 0.62 ? DARK : GREY, u: WHITE };
    },
  });
  foldBlades(g, [[0.035, 0.003, 0.01, 0.087, 0.022], [0.0, 0.007, 0.016, 0.09, 0.028], [-0.05, 0.006, 0.012, 0.085, 0.022],
    [-0.085, 0.003, 0.004, 0.08, 0.01], [-0.09, 0, 0, 0.079, 0.008]], (q) => ({ a: q.z < -0.05 ? DARK : GREY }));
  g.legs({ hip: [0.01, 0.055, 0.0], foot: [0.01, 0.002, 0.004], r: 0.002, toe: 0.016, hind: 0, col: { a: BLACK } });
  return {
    geo: g.build(),
    rig: { shoulder: [0.016, 0.088, 0.02], wrist: [0.08, 0.085, 0.0], neck: [0, 0.09, 0.045], hip: [0.01, 0.055, 0.0], tail: [0, 0.078, -0.06], legSwing: 0.7, height: 0.11 },
  };
}

// Boat-tailed grackle: glossy blue-black male (A), brown female (B), long keeled tail.
function grackleGeo() {
  const g = new Geo();
  const BLACK = C(0x0c0d14), BLUE = C(0x121628), F_TOP = C(0x4a3a2a), F_UNDER = C(0x806a4c), F_DARK = C(0x2e241a), BILL = C(0x0a0a0a);
  g.loft([[-0.085, 0.012, 0.012, 0.1], [-0.06, 0.027, 0.027, 0.1], [-0.02, 0.04, 0.038, 0.102], [0.025, 0.043, 0.041, 0.107], [0.06, 0.034, 0.035, 0.116],
    [0.085, 0, 0, 0.125]], BODY, (q) => ({ a: mix(BLACK, BLUE, smooth(0, 0.8, q.up)), b: mix(F_UNDER, F_TOP, smooth(-0.2, 0.5, q.up)) }), 10);
  g.loft([[0.055, 0.02, 0.024, 0.125], [0.08, 0.025, 0.027, 0.137], [0.1, 0.022, 0.024, 0.14], [0.115, 0.012, 0.013, 0.139], [0.12, 0, 0, 0.138]],
    HEAD, (q) => ({ a: mix(BLACK, BLUE, 0.5), b: q.up > 0.3 ? F_TOP : F_UNDER }), 8);
  g.loft([[0.11, 0.0055, 0.007, 0.138], [0.135, 0.0035, 0.0045, 0.136], [0.156, 0, 0, 0.133]], HEAD, () => ({ a: BILL }), 5);
  g.plate([[[0.018, 0.104, -0.07], [0, 0.099, -0.07], [-0.018, 0.104, -0.07]], [[0.028, 0.102, -0.17], [0, 0.09, -0.17], [-0.028, 0.102, -0.17]],
    [[0.033, 0.098, -0.27], [0, 0.085, -0.275], [-0.033, 0.098, -0.27]]], TAIL, () => ({ a: BLACK, b: F_DARK }));
  g.wings({
    st: [[0.02, 0.05, -0.05], [0.07, 0.052, -0.048], [0.1, 0.048, -0.045], [0.16, 0.03, -0.042], [0.21, 0.01, -0.038], [0.25, -0.012, -0.03]],
    wrist: 2, y: 0.118, camber: 0.05, col: () => ({ a: BLACK, b: F_DARK }),
  });
  foldBlades(g, [[0.05, 0.004, 0.014, 0.12, 0.038], [0.0, 0.01, 0.022, 0.122, 0.043], [-0.06, 0.008, 0.016, 0.113, 0.034],
    [-0.1, 0.004, 0.006, 0.106, 0.018], [-0.11, 0, 0, 0.105, 0.012]], () => ({ a: BLUE, b: F_DARK }));
  g.legs({ hip: [0.014, 0.07, 0.0], foot: [0.014, 0.003, 0.006], r: 0.003, toe: 0.022, hind: 0.016, col: { a: BILL } });
  return {
    geo: g.build(),
    rig: { shoulder: [0.03, 0.12, 0.04], wrist: [0.1, 0.118, 0.0], neck: [0, 0.125, 0.065], hip: [0.014, 0.07, 0.0], tail: [0, 0.1, -0.07], legSwing: 0.5, fingers: 4, fingerLen: 0.3, height: 0.15 },
  };
}

// ---------------------------------------------------------------------------
// materials

const RIG_VERT = /* glsl */ `
attribute float aPart;
attribute vec3 cA;
attribute vec3 cB;
attribute vec3 cU;
attribute vec3 aFeather;
attribute vec4 aPoseA;   // shoulder elevation, wrist dihedral, fold 0..1, hand sweep
attribute vec4 aPoseB;   // head pitch, head thrust, leg phase, leg tuck 0..1
attribute vec4 aPoseC;   // head yaw, tail pitch, -, palette B mix
uniform vec3 uShoulder;
uniform vec3 uWrist;
uniform vec3 uNeck;
uniform vec3 uHip;
uniform vec3 uTailP;
uniform float uLegSwing;
mat3 bRotX(float a) { float c = cos(a), s = sin(a); return mat3(1., 0., 0., 0., c, s, 0., -s, c); }
mat3 bRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0., -s, 0., 1., 0., s, 0., c); }
mat3 bRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0., -s, c, 0., 0., 0., 1.); }
void birdDeform(inout vec3 p, inout vec3 n) {
  float part = aPart;
  float s = p.x < 0.0 ? -1.0 : 1.0;
  if (part > 1.5 && part < 2.5) {             // hand: dihedral at the wrist, swept by a shear
    vec3 W = vec3(uWrist.x * s, uWrist.yz);   // (keeps the wrist line joined to the arm)
    vec3 q = p - W;
    q.z -= aPoseA.w * abs(q.x);
    mat3 R = bRotZ(aPoseA.y * s);
    p = W + R * q; n = R * n;
  }
  if (part > 0.5 && part < 2.5) {             // whole spread wing about the shoulder
    vec3 S = vec3(uShoulder.x * s, uShoulder.yz);
    float f = aPoseA.z;
    mat3 R = bRotZ(aPoseA.x * s) * bRotY(f * 1.3 * s);
    p = S + R * ((p - S) * (1.0 - f)); n = R * n;
  } else if (part > 2.5 && part < 3.5) {      // folded wing, grows in as the wing folds
    vec3 S = vec3(uShoulder.x * s, uShoulder.yz);
    p = S + (p - S) * aPoseA.z;
  } else if (part > 3.5 && part < 4.5) {      // head
    mat3 R = bRotY(aPoseC.x) * bRotX(aPoseB.x);
    p = uNeck + R * (p - uNeck) + vec3(0.0, 0.0, aPoseB.y); n = R * n;
  } else if (part > 4.5 && part < 5.5) {      // legs: alternate swing, tucked in flight
    vec3 H = vec3(uHip.x * s, uHip.yz);
    float a = sin(aPoseB.z * 6.2832 + (s > 0.0 ? 0.0 : 3.1416)) * uLegSwing + aPoseB.w * 1.4;
    mat3 R = bRotX(a);
    p = H + R * ((p - H) * (1.0 - 0.92 * aPoseB.w)); n = R * n;
  } else if (part > 5.5) {                    // tail
    mat3 R = bRotX(aPoseC.y);
    p = uTailP + R * (p - uTailP); n = R * n;
  }
}
`;

function rigUniforms(rig) {
  const v = (a) => ({ value: new THREE.Vector3(...a) });
  return { uShoulder: v(rig.shoulder), uWrist: v(rig.wrist), uNeck: v(rig.neck), uHip: v(rig.hip), uTailP: v(rig.tail), uLegSwing: { value: rig.legSwing } };
}

const sunView = { value: new THREE.Vector3() };

function litMaterial(rig, { rough = 0.8, rim = 1.0, trans = 0.35, tint = null } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: 0, side: THREE.DoubleSide });
  const rimCol = new THREE.Color().copy(SUN_COLOR).multiplyScalar(rim);
  if (tint) rimCol.multiply(new THREE.Color(tint));
  const uniforms = {
    ...rigUniforms(rig), uSunView: sunView, uRim: { value: rimCol }, uTrans: { value: trans },
    uFingers: { value: rig.fingers ?? 0 }, uFingerLen: { value: rig.fingerLen ?? 0.3 },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = RIG_VERT + `varying vec3 bCol; varying vec3 bColU; varying vec3 bFeather; varying float bThin;\n` + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal = normal; vec3 bPos = position; birdDeform(bPos, objectNormal);
        bCol = mix(cA, cB, aPoseC.w); bColU = aPart > 0.5 && aPart < 2.5 ? cU : bCol; bFeather = aFeather;
        bThin = (aPart > 0.5 && aPart < 2.5) || aPart > 5.5 ? 1.0 : 0.0;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = bPos;');
    sh.fragmentShader = `uniform vec3 uSunView; uniform vec3 uRim; uniform float uTrans; uniform float uFingers; uniform float uFingerLen;
varying vec3 bCol; varying vec3 bColU; varying vec3 bFeather; varying float bThin;\n` + sh.fragmentShader
      .replace('#include <color_fragment>', `
        if (bFeather.z > 0.5 && uFingers > 0.5) {       // slotted primaries at the wing tip
          float fz = smoothstep(1.0 - uFingerLen, 1.0, bFeather.x);
          float slot = abs(fract(bFeather.y * uFingers) - 0.5) * 2.0;
          if (slot > 1.0 - fz * 0.78) discard;
        }
        diffuseColor.rgb *= gl_FrontFacing ? bCol : bColU;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {   // backlit by the low sun: warm feather-edge rim, light through the thin wings and tail
          vec3 bV = normalize(vViewPosition);
          float back = max(0.0, dot(-bV, uSunView));
          float fres = pow(1.0 - abs(dot(normal, bV)), 3.0);
          totalEmissiveRadiance += uRim * (fres * pow(back, 3.0) * (0.25 + diffuseColor.rgb) + bThin * uTrans * pow(back, 5.0) * diffuseColor.rgb);
        }`);
  };
  m.customProgramCacheKey = () => 'od-bird-lit';
  return m;
}

const sunWorld = { value: sunDir.clone().normalize() };
const SHADE = { value: new THREE.Color(0.6, 0.64, 0.76) };

function shadowMaterial(rig) {
  const m = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: true, depthFunc: THREE.LessDepth, fog: false, toneMapped: false,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const uniforms = { ...rigUniforms(rig), uSunDir: sunWorld, uShade: SHADE, uBirdH: { value: rig.height ?? 0.2 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = RIG_VERT + `attribute vec4 aGround; uniform vec3 uSunDir; uniform float uBirdH; varying float bShade;\n` + sh.vertexShader
      .replace('#include <begin_vertex>', 'vec3 bPos = position; vec3 bN = normal; birdDeform(bPos, bN); vec3 transformed = bPos;')
      .replace('#include <project_vertex>', `
        // project along the sun onto the ground plane under the bird (so overlapping parts
        // land at equal depth and the LessDepth test keeps them from darkening twice)
        vec4 bW = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        vec3 bO = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
        float bPlane = aGround.x + aGround.y * (bW.x - bO.x) + aGround.z * (bW.z - bO.z);
        float bDen = max(0.02, uSunDir.y - aGround.y * uSunDir.x - aGround.z * uSunDir.z);
        vec3 bP = bW.xyz - uSunDir * max(0.0, (bW.y - bPlane) / bDen);
        bP.y += 0.015;
        vec4 mvPosition = viewMatrix * vec4(bP, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        // one flat depth per bird (the nearer of its feet and its shadow tip), so parts that
        // overlap in the shadow fail the LessDepth test exactly instead of streaking
        float bScale = length(instanceMatrix[0].xyz);
        vec2 bH = normalize(uSunDir.xz) * (uBirdH * bScale * sqrt(1.0 - uSunDir.y * uSunDir.y) / uSunDir.y);
        vec4 bC0 = projectionMatrix * viewMatrix * vec4(bO.x, aGround.x, bO.z, 1.0);
        vec4 bC1 = projectionMatrix * viewMatrix * vec4(bO.x - bH.x, aGround.x - aGround.y * bH.x - aGround.z * bH.y, bO.z - bH.y, 1.0);
        float bZ = min(bC0.z / max(bC0.w, 1e-3), bC1.z / max(bC1.w, 1e-3));
        gl_Position.z = bZ * gl_Position.w;
        bShade = aGround.w;`);
    sh.fragmentShader = `uniform vec3 uShade; varying float bShade;\n` + sh.fragmentShader
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4(mix(vec3(1.0), uShade, bShade), 1.0);');
  };
  m.customProgramCacheKey = () => 'od-bird-shadow';
  return m;
}

// ---------------------------------------------------------------------------
// instancing

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _s = new THREE.Vector3(), _p = new THREE.Vector3();

class Species {
  constructor(scene, { geo, rig }, n, matOpts, withShadow) {
    this.n = n;
    const attr = () => new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.pa = attr(); this.pb = attr(); this.pc = attr();
    geo.setAttribute('aPoseA', this.pa); geo.setAttribute('aPoseB', this.pb); geo.setAttribute('aPoseC', this.pc);
    this.mesh = new THREE.InstancedMesh(geo, litMaterial(rig, matOpts), n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'birds';
    scene.add(this.mesh);
    if (withShadow) {
      this.gr = attr();
      geo.setAttribute('aGround', this.gr);
      this.shadow = new THREE.InstancedMesh(geo, shadowMaterial(rig), n);
      this.shadow.instanceMatrix = this.mesh.instanceMatrix;
      this.shadow.frustumCulled = false;
      this.shadow.renderOrder = 1;
      this.shadow.name = 'bird-shadows';
      scene.add(this.shadow);
    }
    for (let i = 0; i < n; i++) this.hide(i);
  }
  set(i, pos, yaw, pitch, roll, scale, P, ground = null) {
    _e.set(pitch, yaw, roll); _q.setFromEuler(_e); _s.setScalar(scale);
    _m.compose(pos, _q, _s).toArray(this.mesh.instanceMatrix.array, i * 16);
    const k = i * 4, a = this.pa.array, b = this.pb.array, c = this.pc.array;
    a[k] = P.sh; a[k + 1] = P.wr; a[k + 2] = P.fold; a[k + 3] = P.sw;
    b[k] = P.hp; b[k + 1] = P.hb; b[k + 2] = P.leg; b[k + 3] = P.tuck;
    c[k] = P.hy; c[k + 1] = P.tail; c[k + 2] = 0; c[k + 3] = P.v;
    if (this.gr) {
      const g = this.gr.array;
      if (ground) { g[k] = ground[0]; g[k + 1] = ground[1]; g[k + 2] = ground[2]; g[k + 3] = ground[3]; } else g[k + 3] = 0;
    }
  }
  hide(i) {
    _m.makeScale(0, 0, 0).toArray(this.mesh.instanceMatrix.array, i * 16);
    if (this.gr) this.gr.array[i * 4 + 3] = 0;
  }
  commit() {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.pa.needsUpdate = this.pb.needsUpdate = this.pc.needsUpdate = true;
    if (this.gr) this.gr.needsUpdate = true;
  }
}

const pose = () => ({ sh: 0, wr: 0, fold: 0, sw: 0, hp: 0, hb: 0, leg: 0, tuck: 1, hy: 0, tail: 0, v: 0 });

// Flap cycle blended over a glide pose. Downstroke (42% of the beat) faster than the
// upstroke, during which the hand flexes down and sweeps back.
function wingPose(P, glide, w, ph, amp, down = 0.42) {
  ph -= Math.floor(ph);
  let sh, wr, sw = 0;
  if (ph < down) { const u = ph / down; sh = Math.cos(Math.PI * u); wr = 0.3 * Math.sin(Math.PI * u); }
  else { const u = (ph - down) / (1 - down); sh = -Math.cos(Math.PI * u); wr = -0.95 * Math.sin(Math.PI * u); sw = 0.7 * Math.sin(Math.PI * u); }
  P.sh = lerp(glide[0], amp * sh + 0.12 * amp, w);
  P.wr = lerp(glide[1], amp * wr, w);
  P.sw = lerp(glide[2], amp * sw, w);
}

// ---------------------------------------------------------------------------

export function createBirds(scene, { beach, surf, shot = false } = {}) {
  const rnd = mulberry32(7717);
  const R = (a, b) => a + rnd() * (b - a);
  const groundAt = (x, z) => beach.groundAt(x, z);
  const groundPlane = (x, z, strength) => {
    const g0 = groundAt(x, z);
    return [g0, (groundAt(x + 0.5, z) - groundAt(x - 0.5, z)), (groundAt(x, z + 0.5) - groundAt(x, z - 0.5)), strength];
  };
  const initialTier = window.__quality?.tier ?? 'high';
  const MAX = COUNTS.high;

  const pelicans = new Species(scene, pelicanGeo(), MAX.pelican, { rough: 0.85, rim: 0.9, trans: 0.12 }, false);
  const gulls = new Species(scene, gullGeo(), MAX.gull, { rough: 0.75, rim: 1.0, trans: 0.45 }, true);
  const sands = new Species(scene, sanderlingGeo(), MAX.sand, { rough: 0.8, rim: 1.0, trans: 0.35 }, true);
  const grackles = new Species(scene, grackleGeo(), MAX.grackle + MAX.flock, { rough: 0.38, rim: 0.8, trans: 0.1, tint: 0xb8b0ff }, true);
  const frigates = new Species(scene, frigateGeo(), MAX.frigate, { rough: 0.7, rim: 0.6, trans: 0.1 }, false);

  let T = 0;
  const player = new THREE.Vector3(1e5, 0, 1e5);
  const P = pose();
  const tmp = new THREE.Vector3();
  let counts = COUNTS[initialTier] ?? COUNTS.high;
  const api = { onFlutter: null };

  // ---- brown pelicans: a line gliding low over the swell beyond the break ----
  const PEL = { speed: 10, spacing: 5.4, range: 380 };
  // at the frozen shot time the line is heading south, well up the beach to the north
  const pass = { t0: -19, dir: 1, lane: 108, cycle: 15, ph: 3 };
  function newPass(t) {
    pass.t0 = t; pass.dir = rnd() < 0.5 ? 1 : -1; pass.lane = R(100, 116); pass.cycle = R(12, 18); pass.ph = R(0, 10);
  }
  function updatePelicans() {
    const n = counts.pelican;
    const dur = (2 * PEL.range + n * PEL.spacing) / PEL.speed;
    if (T > pass.t0 + dur) newPass(T + (shot ? 0 : R(0, 12)));
    const tau = T - pass.t0;
    const zL = -pass.dir * PEL.range + pass.dir * PEL.speed * tau;
    for (let i = 0; i < MAX.pelican; i++) {
      if (i >= n || tau < 0) { pelicans.hide(i); continue; }
      const z = zL - pass.dir * i * PEL.spacing;
      if (Math.abs(z) > PEL.range + 20) { pelicans.hide(i); continue; }
      const x = pass.lane + 0.7 * Math.sin(i * 1.9) + 0.5 * Math.sin(T * 0.13 + i * 0.7);
      // skimming the swell: the line rides up and over each swell
      const swell = 0.35 * Math.sin(z * 0.07 - T * 0.55 + x * 0.02);
      const y = SEA_LEVEL + 1.7 + 0.25 * Math.sin(i * 2.3) + swell;
      const dy = 0.35 * Math.cos(z * 0.07 - T * 0.55) * 0.07 * PEL.speed;
      // follow-the-leader: the flap bout ripples down the line
      const tl = tau + pass.ph - i * 0.42;
      const c = tl - pass.cycle * Math.floor(tl / pass.cycle);
      const w = smooth(0, 0.35, c) * (1 - smooth(3.1, 3.6, c));
      wingPose(P, [-0.02 + 0.015 * Math.sin(T * 1.1 + i), -0.1, 0.16], w, (T - i * 0.42) * 1.45, 0.48);
      P.fold = 0; P.hp = 0.04; P.hb = 0; P.tuck = 1; P.hy = 0.05 * Math.sin(T * 0.3 + i); P.tail = 0.05; P.v = 0;
      _p.set(x, y, z);
      pelicans.set(i, _p, pass.dir > 0 ? 0 : Math.PI, -dy / PEL.speed * 0.6 - 0.03, 0.03 * Math.sin(T * 0.7 + i * 1.3), 1, P);
    }
  }

  // ---- gulls ----
  const gullList = [];
  const standSpots = [[86.2, -31], [87.4, -29.2], [84.9, -33.4], [88.3, -34.5], [80.5, 26], [82, 24.2], [88.6, 56], [76, -55]];
  function landingSpot(avoid) {
    for (let k = 0; k < 20; k++) {
      const x = R(77, 89.3), z = R(-68, 68);
      if (Math.hypot(x - player.x, z - player.z) < 14) continue;
      if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < 20) continue;
      return { x, z };
    }
    return { x: 84, z: player.z > 0 ? -50 : 50 };
  }
  function newOrbit(g, cx, cz) {
    g.orbit = { cx: cx ?? R(30, 125), cz: cz ?? R(-75, 75), r: R(12, 30), dir: rnd() < 0.5 ? 1 : -1, h: R(7, 24) };
  }
  for (let i = 0; i < MAX.gull; i++) {
    const v = rnd() < 0.6 ? 0 : 1;
    const g = {
      i, v, scale: v ? 1.12 : 1, pos: new THREE.Vector3(), yaw: R(-3, 3), speed: 0, vy: 0, bank: 0, pitch: 0,
      mode: 'soar', t: 0, dur: R(25, 80), flapW: 0, flapPh: rnd(), flapUntil: 0, nextFlap: R(0, 8), fold: 0, tuck: 1,
      legPh: 0, hy: 0, hyT: 0, nextLook: 0, walkTo: null, nextWalk: R(6, 25), standUntil: 0, yawOff: R(-0.35, 0.35),
      callUntil: 0, land: null, flee: 0, active: true, from: null,
    };
    const spot = i < standSpots.length && i % 3 !== 2 ? standSpots[i] : null;
    if (spot) {
      g.mode = 'stand'; g.fold = 1; g.tuck = 0;
      g.pos.set(spot[0], groundAt(spot[0], spot[1]), spot[1]);
      g.yaw = WIND_YAW + g.yawOff; g.standUntil = R(60, 200);
    } else {
      newOrbit(g);
      const a = rnd() * TAU;
      g.pos.set(g.orbit.cx + Math.sin(a) * g.orbit.r, 0, g.orbit.cz + Math.cos(a) * g.orbit.r);
      g.pos.y = groundAt(g.pos.x, g.pos.z) + g.orbit.h;
      g.yaw = a + (g.orbit.dir * Math.PI) / 2; g.speed = 8.5;
    }
    gullList.push(g);
  }
  const fwd = (yaw) => tmp.set(Math.sin(yaw), 0, Math.cos(yaw));
  function steer(g, tx, tz, dt, maxTurn) {
    const want = Math.atan2(tx - g.pos.x, tz - g.pos.z);
    const turn = clamp(wrapPi(want - g.yaw) * 1.4, -maxTurn, maxTurn);
    g.yaw = wrapPi(g.yaw + turn * dt);
    g.bank = approach(g.bank, -Math.atan((g.speed * turn) / 9.81), 2.5, dt);
    return turn;
  }
  function takeoff(g, yaw) {
    g.mode = 'takeoff'; g.t = 0; g.flee = yaw; g.speed = 0.6; g.vy = 0; g.flapPh = 0.45; g.walkTo = null;
    const d = g.pos.distanceTo(player);
    if (d < 16 && api.onFlutter) {
      const f = fwd(yaw);
      api.onFlutter({ x: g.pos.x, y: g.pos.y + 0.3, z: g.pos.z, vx: f.x * 5, vy: 2.5, vz: f.z * 5, dist: d });
    }
  }
  function updateGull(g, dt) {
    const gy = groundAt(g.pos.x, g.pos.z);
    const pd = Math.hypot(g.pos.x - player.x, g.pos.z - player.z) + Math.max(0, Math.abs(player.y - 1.7 - g.pos.y) - 1);
    g.t += dt;
    let flapFreq = 2.9, flapAmp = 0.9, glide = [0.1 + 0.03 * Math.sin(T * 1.7 + g.i), -0.2, 0.34];
    P.hp = 0.12; P.hb = 0; P.tail = 0; P.leg = 0;
    if (g.mode === 'stand' || g.mode === 'walk') {
      g.fold = Math.min(1, g.fold + dt * 2.5); g.tuck = Math.max(0, g.tuck - dt * 4);
      g.pos.y = gy; g.speed = 0; g.bank = 0; g.pitch = approach(g.pitch, 0, 6, dt);
      if (pd < 6 && !shot) {
        const away = Math.atan2(g.pos.x - player.x, g.pos.z - player.z);
        takeoff(g, wrapPi(away + 0.4 * wrapPi(WIND_YAW - away)));
      } else {
        const sw = surf.swashAt(g.pos.x, g.pos.z, shot ? T : undefined);
        if (!g.walkTo && sw.covered && sw.depth > 0.025) g.walkTo = { x: g.pos.x - R(1.2, 2.2), z: g.pos.z + R(-0.6, 0.6) };
        if (!g.walkTo && T > g.nextWalk) {
          g.walkTo = { x: clamp(g.pos.x + R(-2.5, 2.5), 76, 89), z: g.pos.z + R(-3, 3) };
          g.nextWalk = T + R(8, 30);
        }
        if (g.walkTo) {
          g.mode = 'walk';
          const dx = g.walkTo.x - g.pos.x, dz = g.walkTo.z - g.pos.z, d = Math.hypot(dx, dz);
          const want = Math.atan2(dx, dz);
          g.yaw = wrapPi(g.yaw + clamp(wrapPi(want - g.yaw), -4 * dt, 4 * dt));
          if (Math.abs(wrapPi(want - g.yaw)) < 0.6) {
            const sp = Math.min(0.5, d * 2 + 0.1);
            g.pos.x += (dx / d) * sp * dt; g.pos.z += (dz / d) * sp * dt;
            g.legPh += dt * 2.6;
          }
          if (d < 0.08) { g.walkTo = null; g.mode = 'stand'; }
        } else {
          g.legPh = approach(g.legPh, Math.round(g.legPh * 2) / 2, 10, dt);
          g.yaw = wrapPi(g.yaw + clamp(wrapPi(WIND_YAW + g.yawOff - g.yaw), -1.2 * dt, 1.2 * dt));
        }
        if (T > g.nextLook) { g.hyT = R(-0.9, 0.9) * (rnd() < 0.3 ? 0 : 1); g.nextLook = T + R(1.2, 5); }
        if (T > g.standUntil && g.mode === 'stand') takeoff(g, WIND_YAW + R(-0.5, 0.5));
      }
      P.hp = T < g.callUntil ? -0.55 : 0.05;
      P.leg = g.legPh;
      g.hy = approach(g.hy, g.hyT, 8, dt);
    } else if (g.mode === 'takeoff') {
      g.fold = Math.max(0, g.fold - dt * 6);
      g.speed = Math.min(8.5, g.speed + dt * 5.5);
      g.vy = g.t < 1.4 ? 2.8 : lerp(2.8, 0.8, smooth(1.4, 2.6, g.t));
      if (g.t > 0.45) g.tuck = Math.min(1, g.tuck + dt * 1.6);
      steer(g, g.pos.x + Math.sin(g.flee) * 50, g.pos.z + Math.cos(g.flee) * 50, dt, 1.5);
      g.pitch = approach(g.pitch, -0.3, 5, dt);
      g.flapW = 1; flapFreq = 4.2; flapAmp = 1.05;
      if (g.t > 2.6) {
        g.mode = 'soar'; g.t = 0; g.dur = R(18, 50);
        const f = fwd(g.yaw);
        newOrbit(g, clamp(g.pos.x + f.x * 35, 20, 130), clamp(g.pos.z + f.z * 35, -90, 90));
        g.orbit.h = clamp(g.pos.y - gy + R(3, 10), 6, 22);
      }
    } else if (g.mode === 'soar' || g.mode === 'flyTo') {
      let tx, tz, hT, spT = 8.5;
      if (g.mode === 'soar') {
        const o = g.orbit;
        const a = Math.atan2(g.pos.x - o.cx, g.pos.z - o.cz) + o.dir * 0.55;
        tx = o.cx + Math.sin(a) * o.r; tz = o.cz + Math.cos(a) * o.r;
        o.cx += Math.sin(T * 0.05 + g.i) * 0.4 * dt; o.cz += Math.cos(T * 0.04 + g.i * 2) * 0.4 * dt;
        hT = o.h + 1.5 * Math.sin(T * 0.21 + g.i);
        if (g.t > g.dur && !shot) { g.mode = 'flyTo'; g.land = landingSpot(g.from); g.t = 0; }
      } else {
        tx = g.land.x; tz = g.land.z;
        const d = Math.hypot(tx - g.pos.x, tz - g.pos.z);
        hT = clamp(d * 0.16, 0.2, 22);
        spT = clamp(d * 0.5 + 3.5, 4, 8.5);
        if (d < 4.5 && g.pos.y - gy < 1.8) { g.mode = 'land'; g.t = 0; g.from = { x: g.pos.x, y: g.pos.y, z: g.pos.z }; }
        if (Math.hypot(tx - player.x, tz - player.z) < 8) g.land = landingSpot();
      }
      steer(g, tx, tz, dt, g.mode === 'soar' ? 0.9 : 1.2);
      g.speed = approach(g.speed, spT, 0.8, dt);
      g.vy = approach(g.vy, clamp((hT - (g.pos.y - gy)) * 0.35, -2.2, 1.8), 1.5, dt);
      g.pitch = approach(g.pitch, -Math.atan2(g.vy, g.speed) * 0.7, 3, dt);
      g.fold = Math.max(0, g.fold - dt * 4); g.tuck = Math.min(1, g.tuck + dt);
      // soaring: long glides broken by short bouts of flapping
      if (T > g.nextFlap) { g.flapUntil = T + R(3, 6) / flapFreq; g.nextFlap = g.flapUntil + R(4, 14); }
      const want = T < g.flapUntil || g.vy > 1.2 ? 1 : 0;
      g.flapW = approach(g.flapW, want, 5, dt);
      glide[2] += Math.abs(g.bank) * 0.25;
    } else if (g.mode === 'land') {
      const u = Math.min(1, g.t / 1.1);
      g.pos.x = lerp(g.from.x, g.land.x, 1 - (1 - u) * (1 - u));
      g.pos.z = lerp(g.from.z, g.land.z, 1 - (1 - u) * (1 - u));
      g.pos.y = lerp(g.from.y, groundAt(g.pos.x, g.pos.z), Math.sin((u * Math.PI) / 2));
      g.speed = 0; g.bank = approach(g.bank, 0, 5, dt); g.vy = 0;
      g.yaw = wrapPi(g.yaw + clamp(wrapPi(WIND_YAW - g.yaw), -1.5 * dt, 1.5 * dt));
      g.pitch = -0.6 * Math.sin(Math.PI * Math.min(1, u * 1.1));
      g.tuck = Math.max(0, g.tuck - dt * 3);
      g.flapW = u > 0.45 ? 1 : 0.3; flapFreq = 4.6; flapAmp = 0.55; glide = [0.5, -0.1, 0.1];
      if (u >= 1) {
        g.mode = 'stand'; g.t = 0; g.standUntil = T + R(50, 160); g.nextWalk = T + R(5, 20); g.yawOff = R(-0.35, 0.35);
      }
    }
    if (g.mode !== 'stand' && g.mode !== 'walk' && g.mode !== 'land') {
      const f = fwd(g.yaw);
      g.pos.addScaledVector(f, g.speed * dt);
      g.pos.y += g.vy * dt;
      g.pos.y = Math.max(g.pos.y, groundAt(g.pos.x, g.pos.z) + (g.mode === 'takeoff' ? 0 : 0.8));
    }
    g.flapPh += dt * flapFreq;
    if (g.fold >= 1) { P.sh = 0; P.wr = 0; P.sw = 0; g.flapW = 0; }
    else if (g.mode === 'stand' || g.mode === 'walk') { P.sh = 0.9 * (1 - g.fold); P.wr = -0.2; P.sw = 0.3; }
    else wingPose(P, glide, g.flapW, g.flapPh, flapAmp);
    P.fold = g.fold; P.tuck = g.tuck; P.hy = g.hy; P.v = g.v;
    const walkBob = g.mode === 'walk' ? 0.004 * Math.abs(Math.sin(g.legPh * Math.PI * 2)) : 0;
    _p.set(g.pos.x, g.pos.y + walkBob, g.pos.z);
    const h = g.pos.y - groundAt(g.pos.x, g.pos.z);
    const roll = g.bank + (g.mode === 'walk' ? 0.05 * Math.sin(g.legPh * TAU) : 0);
    gulls.set(g.i, _p, g.yaw, g.pitch, roll, g.scale, P, groundPlane(g.pos.x, g.pos.z, 1 - smooth(0.3, 4, h)));
  }

  // ---- sanderlings chasing the swash edge ----
  const flock = { zc: -32, mode: 'forage', t: 0, dur: 3 };
  const sandList = Array.from({ length: MAX.sand }, (_, i) => ({
    i, x: SHORE_X - 3, z: flock.zc + (i - MAX.sand / 2) * 0.9 + R(-0.3, 0.3), dz: (i - MAX.sand / 2) * 0.85 + R(-0.35, 0.35),
    dx: R(0.05, 0.9), legPh: rnd(), peck: R(0, 1), peckRate: R(2.8, 4), yaw: SEAWARD_YAW, from: null, to: null, y: 0, flapPh: rnd(), speed: 0,
  }));
  function edgeAt(x, z) {
    const sw = surf.swashAt(x, z, shot ? T : undefined);
    return { edge: Math.min(sw.front, SHORE_X + 0.3), sw };
  }
  for (const b of sandList) b.x = edgeAt(b.x, b.z).edge - 0.3 - b.dx;
  function updateSand(dt) {
    const n = counts.sand;
    if (flock.mode === 'forage' && !shot) {
      for (let i = 0; i < n; i++) {
        const b = sandList[i];
        if (Math.hypot(b.x - player.x, b.z - player.z) < 5) {
          const dir = player.z > b.z ? -1 : 1;
          flock.mode = 'fly'; flock.t = 0; flock.dur = R(2.6, 3.4);
          flock.zc = clamp(flock.zc + dir * R(20, 30), -70, 50);
          if (Math.abs(flock.zc - player.z) < 10) flock.zc = player.z + dir * 14;
          for (let k = 0; k < n; k++) {
            const s = sandList[k];
            s.from = { x: s.x, z: s.z };
            const tz = flock.zc + s.dz;
            s.to = { x: edgeAt(s.x, tz).edge - 0.4 - s.dx, z: tz };
          }
          break;
        }
      }
    }
    if (flock.mode === 'fly') {
      flock.t += dt;
      const u = Math.min(1, flock.t / flock.dur);
      for (let i = 0; i < n; i++) {
        const b = sandList[i];
        const e = u * u * (3 - 2 * u);
        const nx = lerp(b.from.x, b.to.x, e) + 3.5 * Math.sin(Math.PI * u), nz = lerp(b.from.z, b.to.z, e);
        b.yaw = Math.atan2(nx - b.x, nz - b.z) || b.yaw;
        b.x = nx; b.z = nz;
        b.y = groundAt(b.x, b.z) + (1.2 + 0.2 * Math.sin(i * 2.1)) * Math.sin(Math.PI * Math.min(1, u * 1.08));
        b.flapPh += dt * 13;
        P.fold = u < 0.08 ? 1 - u / 0.08 : u > 0.93 ? (u - 0.93) / 0.07 : 0;
        if (u > 0.8) { P.sh = 0.9; P.wr = 0.1; P.sw = 0.1; } else wingPose(P, [0.2, -0.1, 0.3], 1, b.flapPh, 0.95);
        P.hp = 0.1; P.hb = 0; P.leg = 0; P.tuck = u > 0.1 && u < 0.85 ? 1 : 0; P.hy = 0; P.tail = 0; P.v = 0;
        _p.set(b.x, b.y, b.z);
        const h = b.y - groundAt(b.x, b.z);
        sands.set(i, _p, b.yaw, -0.1, 0, 1, P, groundPlane(b.x, b.z, 1 - smooth(0.2, 2, h)));
      }
      if (u >= 1) flock.mode = 'forage';
    } else {
      flock.zc = clamp(flock.zc + Math.sin(T * 0.037) * 0.12 * dt, -70, 50);
      for (let i = 0; i < n; i++) {
        const b = sandList[i];
        const { edge, sw } = edgeAt(b.x, b.z);
        const tx = edge - 0.18 - b.dx;
        const ex = tx - b.x;
        let vx = 0;
        if (sw.covered && b.x > sw.front + 0.05) vx = -2.4;
        else if (Math.abs(ex) > 0.12) vx = Math.sign(ex) * Math.min(2.3, 0.45 + Math.abs(ex) * 3.2);
        const vz = clamp((flock.zc + b.dz - b.z) * 0.4, -0.35, 0.35) * (vx !== 0 ? 1 : 0.3);
        b.x += vx * dt; b.z += vz * dt;
        const sp = Math.hypot(vx, vz);
        b.speed = approach(b.speed, sp, 12, dt);
        if (sp > 0.05) {
          b.yaw = wrapPi(b.yaw + clamp(wrapPi(Math.atan2(vx, vz) - b.yaw), -14 * dt, 14 * dt));
          b.legPh += (sp * dt) / 0.055;
          P.hp = 0.15; b.peck = 0;
        } else {
          b.legPh = approach(b.legPh, Math.round(b.legPh * 2) / 2, 12, dt);
          b.yaw = wrapPi(b.yaw + clamp(wrapPi(SEAWARD_YAW + 0.8 * Math.sin(T * 0.3 + i * 1.7) - b.yaw), -2 * dt, 2 * dt));
          b.peck += dt * b.peckRate;
          // quick "sewing machine" probes into the wet sand, with short pauses
          const pc = b.peck % 3;
          P.hp = pc < 2 ? 0.2 + 0.95 * Math.pow(Math.abs(Math.sin(pc * Math.PI)), 0.6) : 0.1;
        }
        P.sh = 0; P.wr = 0; P.sw = 0; P.fold = 1; P.hb = 0; P.leg = b.legPh; P.tuck = 0; P.hy = 0; P.tail = 0; P.v = 0;
        b.y = groundAt(b.x, b.z);
        _p.set(b.x, b.y + (sp > 0.05 ? 0.003 * Math.abs(Math.sin(b.legPh * TAU)) : 0), b.z);
        sands.set(i, _p, b.yaw, P.hp > 0.5 ? 0.25 : 0.05, 0, 1, P, groundPlane(b.x, b.z, 1));
      }
    }
    for (let i = n; i < MAX.sand; i++) sands.hide(i);
  }

  // ---- boat-tailed grackles on the sidewalks ----
  const strips = {
    hotelS: { x0: -27.5, x1: -24.7, z0: 46, z1: 64 },
    patio: { x0: -27.5, x1: -25.2, z0: -15, z1: -5 },
    park: { x0: -14, x1: -10.9, z0: 44, z1: 62 },
  };
  const grackleList = [['hotelS', 0, -26.2, 49], ['hotelS', 1, -25.4, 51.5], ['park', 0, -12.4, 47], ['patio', 0, -26.4, -9], ['hotelS', 0, -26.8, 57]]
    .map(([s, v, x, z], i) => ({
      i, strip: strips[s], v, scale: v ? 0.82 : 1, x, z, y: 0, yaw: R(-3, 3), mode: 'walk', t: 0, dur: R(1, 3), target: { x, z },
      legPh: 0, peck: 0, hy: 0, hyT: 0, tail: 0.06, from: null, to: null, flapPh: rnd(),
    }));
  // the static shadow map can't show birds' shadows, so a sun shadow is drawn only where the
  // sidewalk is sunlit: the street-side palm trunks throw long thin shadows west across it
  const sunH = Math.hypot(sunDir.x, sunDir.z), shadeX = -sunDir.x / sunH, shadeZ = -sunDir.z / sunH;
  const trunks = PALM_TREES.filter((t) => t.x < -8 && Math.abs(t.z) < 90);
  function inTrunkShade(x, z) {
    for (const t of trunks) {
      const dx = x - t.x, dz = z - t.z, along = dx * shadeX + dz * shadeZ;
      if (along > -0.3 && along < 22 && Math.abs(dx * shadeZ - dz * shadeX) < 0.4) return true;
    }
    return false;
  }
  function pickTarget(b, far) {
    const s = b.strip;
    for (let k = 0; k < 16; k++) {
      const x = R(s.x0, s.x1), z = far ? R(s.z0, s.z1) : clamp(b.z + R(-2.5, 2.5), s.z0, s.z1);
      if (k < 12 && inTrunkShade(x, z)) continue;
      if (!far || Math.hypot(x - player.x, z - player.z) > 8) return { x, z };
    }
    return { x: R(s.x0, s.x1), z: player.z > (s.z0 + s.z1) / 2 ? s.z0 : s.z1 };
  }
  function updateGrackles(dt) {
    const n = counts.grackle;
    for (let i = 0; i < MAX.grackle; i++) {
      const b = grackleList[i];
      if (i >= n) { grackles.hide(i); continue; }
      b.t += dt;
      const gy = groundAt(b.x, b.z);
      P.sh = 0; P.wr = 0; P.sw = 0; P.fold = 1; P.hp = 0; P.hb = 0; P.tuck = 0; P.tail = b.tail; P.v = b.v;
      let pitch = 0, y = gy;
      if (b.mode !== 'fly' && !shot && Math.hypot(b.x - player.x, b.z - player.z) < 3.5) {
        b.mode = 'fly'; b.t = 0; b.from = { x: b.x, z: b.z }; b.to = pickTarget(b, true);
        b.dur = Math.hypot(b.to.x - b.x, b.to.z - b.z) / 6.5 + 0.6;
      }
      if (b.mode === 'fly') {
        const u = Math.min(1, b.t / b.dur), e = u * u * (3 - 2 * u);
        const nx = lerp(b.from.x, b.to.x, e), nz = lerp(b.from.z, b.to.z, e);
        const want = Math.atan2(b.to.x - b.from.x, b.to.z - b.from.z);
        b.yaw = wrapPi(b.yaw + clamp(wrapPi(want - b.yaw), -10 * dt, 10 * dt));
        b.x = nx; b.z = nz;
        y = groundAt(nx, nz) + 1.8 * Math.sin(Math.PI * u);
        b.flapPh += dt * 7.5;
        P.fold = u < 0.08 ? 1 - u / 0.08 : u > 0.94 ? (u - 0.94) / 0.06 : 0;
        if (u > 0.78) { P.sh = 0.85; P.wr = 0.2; P.sw = 0.15; pitch = -0.5; } else { wingPose(P, [0.1, -0.1, 0.2], u < 0.55 ? 1 : 0.6, b.flapPh, 0.95); pitch = u < 0.3 ? -0.25 : 0; }
        P.tuck = u > 0.12 && u < 0.8 ? 1 : 0; P.tail = 0.05;
        if (u >= 1) { b.mode = 'look'; b.t = 0; b.dur = R(0.8, 2); }
      } else {
        if (b.t > b.dur) {
          const r = rnd();
          b.mode = r < 0.45 ? 'walk' : r < 0.8 ? 'peck' : 'look';
          b.t = 0; b.dur = b.mode === 'walk' ? R(1.5, 4) : b.mode === 'peck' ? R(0.8, 2.2) : R(0.8, 2.5);
          if (b.mode === 'walk') b.target = pickTarget(b, false);
          if (b.mode === 'look') { b.hyT = R(-0.9, 0.9); if (rnd() < 0.5) b.tail = 0.28; }
        }
        b.tail = approach(b.tail, 0.06, 3, dt);
        if (b.mode === 'walk') {
          const dx = b.target.x - b.x, dz = b.target.z - b.z, d = Math.hypot(dx, dz);
          if (d > 0.05) {
            const want = Math.atan2(dx, dz);
            b.yaw = wrapPi(b.yaw + clamp(wrapPi(want - b.yaw), -5 * dt, 5 * dt));
            const sp = 0.32;
            b.x += (dx / d) * sp * dt; b.z += (dz / d) * sp * dt;
            b.legPh += dt * 3.3;
            // head holds still in space while the body walks under it, then thrusts forward
            const f = b.legPh * 2 - Math.floor(b.legPh * 2);
            P.hb = 0.014 * (f < 0.75 ? 0.5 - f / 0.75 : -0.5 + (f - 0.75) / 0.25);
            P.hp = 0.1;
          } else b.mode = 'look';
          b.hy = approach(b.hy, 0, 6, dt);
        } else {
          b.legPh = approach(b.legPh, Math.round(b.legPh * 2) / 2, 10, dt);
          if (b.mode === 'peck') {
            b.peck += dt * 2.6;
            const pc = b.peck % 1;
            P.hp = pc < 0.45 ? 1.25 * Math.sin((pc / 0.45) * Math.PI) : 0;
            pitch = P.hp * 0.25;
            b.hy = approach(b.hy, 0, 6, dt);
          } else b.hy = approach(b.hy, b.hyT, 7, dt);
        }
        P.leg = b.legPh;
      }
      P.hy = b.hy;
      _p.set(b.x, y, b.z);
      b.shade = approach(b.shade ?? 1, inTrunkShade(b.x, b.z) ? 0 : 1, 6, dt);
      grackles.set(i, _p, b.yaw, pitch, 0, b.scale, P, groundPlane(b.x, b.z, (1 - smooth(0.2, 3, y - gy)) * 0.85 * b.shade));
    }
  }

  // ---- distant cormorants crossing the sunrise, far out over the sea ----
  const line = { t0: -40, dir: 1, x: 340, y: 26 };
  function updateFlock() {
    const n = counts.flock, speed = 13, len = 1500;
    if (T > line.t0 + len / speed) { line.t0 = T + (shot ? 0 : R(20, 60)); line.dir = -line.dir; line.x = R(260, 420); line.y = R(18, 34); }
    const zL = -line.dir * 750 + line.dir * speed * (T - line.t0);
    for (let k = 0; k < MAX.flock; k++) {
      const i = MAX.grackle + k;
      if (k >= n || T < line.t0) { grackles.hide(i); continue; }
      const side = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2);
      const z = zL - line.dir * Math.abs(side) * 5.5, x = line.x + side * 4 + 1.2 * Math.sin(T * 0.3 + k);
      wingPose(P, [0, 0, 0], 1, T * 3.1 + k * 0.37, 0.75);
      P.fold = 0; P.hp = 0; P.hb = 0; P.leg = 0; P.tuck = 1; P.hy = 0; P.tail = 0; P.v = 0;
      _p.set(x, line.y + 0.8 * Math.sin(T * 0.4 + k * 1.3) + Math.abs(side) * 0.3, z);
      grackles.set(i, _p, line.dir > 0 ? 0 : Math.PI, 0, 0, 3.4, P);
    }
  }

  // ---- a magnificent frigatebird hanging high over the beach ----
  function updateFrigate() {
    if (!counts.frigate) { frigates.hide(0); return; }
    const r = 75, v = 7.5, a = (T * v) / r + 1.2;
    const x = 70 + r * Math.sin(a), z = -25 + r * Math.cos(a), y = 88 + 5 * Math.sin(T * 0.07);
    P.sh = 0.06 + 0.04 * Math.sin(T * 0.9); P.wr = -0.3 + 0.03 * Math.sin(T * 0.9 + 1); P.sw = 0.5; P.fold = 0;
    P.hp = 0.15; P.hb = 0; P.leg = 0; P.tuck = 1; P.hy = 0.2 * Math.sin(T * 0.2); P.tail = 0.06 * Math.sin(T * 0.5); P.v = 0;
    _p.set(x, y, z);
    frigates.set(0, _p, Math.atan2(Math.cos(a), -Math.sin(a)), 0.05, -0.18, 1, P);
  }

  function step(dt) {
    T += dt;
    updatePelicans();
    for (const g of gullList) {
      if (!g.active) { gulls.hide(g.i); continue; }
      updateGull(g, dt);
    }
    updateSand(dt);
    updateGrackles(dt);
    updateFlock();
    updateFrigate();
  }

  function setQuality(tier) {
    counts = COUNTS[tier] ?? COUNTS.high;
    gullList.forEach((g, i) => { g.active = i < counts.gull; });
  }
  setQuality(initialTier);

  // settle into a natural state (deterministic: seeded, no player, fixed step)
  for (let k = 0; k < 360; k++) step(1 / 30);
  for (const s of [pelicans, gulls, sands, grackles, frigates]) s.commit();

  const frustum = new THREE.Frustum(), _pm = new THREE.Matrix4();
  Object.assign(api, {
    setQuality,
    update(dt, camera) {
      if (!shot) {
        player.copy(camera.position);
        step(Math.min(dt, 0.1));
      }
      camera.updateMatrixWorld();
      sunView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
      _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(_pm);
      for (const s of [pelicans, gulls, sands, grackles, frigates]) s.commit();
    },
    // audio hook: a visible gull (preferably flying) to voice the next call, or null
    gullSource(L) {
      const vis = [], near = [];
      for (const g of gullList) {
        if (!g.active) continue;
        const d = Math.hypot(g.pos.x - L.x, g.pos.y - L.y, g.pos.z - L.z);
        if (d > 150) continue;
        near.push(g);
        if (d < 110 && frustum.containsPoint(g.pos)) vis.push(g, ...(g.mode === 'stand' || g.mode === 'walk' ? [] : [g, g]));
      }
      const pool = vis.length ? vis : near;
      if (!pool.length) return null;
      const g = pool[Math.floor(Math.random() * pool.length)];
      if (g.mode === 'stand') g.callUntil = T + 1.6;
      const f = Math.sin(g.yaw), h = Math.cos(g.yaw);
      return { x: g.pos.x, y: g.pos.y + 0.2, z: g.pos.z, vx: f * g.speed, vy: g.vy, vz: h * g.speed };
    },
    // harness/debug: where everyone is
    list() {
      const r = (v) => Math.round(v * 10) / 10;
      return {
        pelicans: Array.from({ length: counts.pelican }, (_, i) => {
          const a = pelicans.mesh.instanceMatrix.array; return [r(a[i * 16 + 12]), r(a[i * 16 + 13]), r(a[i * 16 + 14])];
        }),
        gulls: gullList.filter((g) => g.active).map((g) => [g.mode, r(g.pos.x), r(g.pos.y), r(g.pos.z)]),
        sand: sandList.slice(0, counts.sand).map((b) => [r(b.x), r(b.z)]),
        grackles: grackleList.slice(0, counts.grackle).map((b) => [b.mode, r(b.x), r(b.z)]),
      };
    },
  });
  return api;
}
