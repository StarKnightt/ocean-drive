// System 3: palms of Ocean Drive / Lummus Park. Mostly tall slender coconut palms
// (curved, ringed grey-tan trunks, drooping pinnate fronds, dead fronds and nuts under
// the crown), some royal palms (smooth grey trunk, green crownshaft) and a few sabal
// palms (boot-covered trunk, fan fronds) in the park.
// Geometry: a handful of trunk and frond variants in two BatchedMeshes (one draw call
// each, plus one each in the shadow pass); leaflets are alpha-cut ribbons so frond
// shadows show the gaps between them. Wind sways crowns and frond tips in the vertex
// shader (frozen in ?shot mode through the time passed to update()).
import * as THREE from 'three';
import { SIDEWALK_W, SIDEWALK_E, PARK, CAR, CURB_HEIGHT, CROSS, CROSS_STREETS, crossLegs, crossStreetAt, DISTRICT } from './layout.js';
import { registerLodHook, LOD } from './lod.js';
import { mulberry32, fbmField } from '../textures/noise.js';
import { QUALITY } from '../quality.js';
import { staticCull } from '../renderer/batched-cull.js';

// ---------------------------------------------------------------------------
// Placement (pure data, also used by the audio engine)
const SPAN = 300;

function plan() {
  let rnd = mulberry32(3301);
  const trees = [];
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
  // coconut trunk variants (see TRUNK_DEFS): 0 young 6 m, 1 gentle curve 10 m, 2 strong
  // lean 11 m, 3 S-curve 14 m, 4 very tall 19 m (over the 5-storey roofs), 5 near straight
  const tree = (x, z, row, ground, o = {}) => {
    const r = rnd();
    let species = 'coconut';
    if (row === 'park') species = r < 0.12 ? 'sabal' : r < 0.2 ? 'royal' : 'coconut';
    else if (row === 'edge' && r < 0.1) species = 'sabal';
    else if (r < 0.08) species = 'royal';
    const variant = o.variant ?? (species !== 'coconut' ? 0
      : row === 'park' ? pick([0, 1, 2, 2, 3, 3, 4, 1])
        : pick([0, 1, 1, 3, 3, 4, 4, 5, 0, 1, 3, 5, 4]));
    // lean direction and amount vary a lot: mostly toward the ocean (+x) but anything
    // from near vertical (shear cancels the variant's lean) to steep
    const spread = row === 'park' ? 1.3 : 1.2;
    const rotY = o.rotY ?? ((rnd() - 0.5) * 2 * spread + (rnd() < (row === 'park' ? 0.3 : 0.12) ? Math.PI : 0));
    // street-side palms mostly near upright (0-12 deg, a few ~20), stronger leans in the park
    const street = row !== 'park';
    const k = o.k ?? (street ? (rnd() < 0.1 ? 0.08 : -0.08 - rnd() * 0.06) : rnd() < 0.25 ? -0.1 - rnd() * 0.05 : (rnd() - 0.3) * 0.18);
    // height: 6-20 m so crowns layer, some above the hotel roofs
    const hs = o.hs ?? (0.78 + rnd() * 0.5);
    trees.push({ x, z, row, ground, species: o.species ?? species, variant, rotY, k, hs, scale: 0.88 + rnd() * 0.26, seed: Math.floor(rnd() * 1e9) });
  };
  // irregular rows: mostly 7-14 m, the odd long gap, the odd close pair
  const row = (x0, rowName, ground, skip, zA = -SPAN, zB = SPAN) => {
    for (let z = zA; z <= zB;) {
      const x = x0 + (rnd() - 0.5) * 0.3;
      if (!skip(z)) {
        tree(x, z + (rnd() - 0.5), rowName, ground);
        if (rnd() < 0.22) {
          // close pair, leaning apart or crossing
          const dz = 1.6 + rnd() * 1.2, first = trees[trees.length - 1];
          const rot = rnd() < 0.5 ? first.rotY + Math.PI * (0.6 + rnd() * 0.4) : first.rotY + 0.5;
          if (!skip(z + dz)) tree(x + (rnd() - 0.5) * 0.4, z + dz, rowName, ground, { rotY: rot, hs: first.hs * (0.7 + rnd() * 0.25) });
        }
      }
      z += rnd() < 0.18 ? 17 + rnd() * 9 : 7 + rnd() * 7;
    }
  };
  // hotel side: planting islands in the parking lane
  // hotel side: sidewalk tree grates just behind the curb
  row(SIDEWALK_W.x1 - 0.9, 'hotel', 0, () => false);
  // park edge along the park-side sidewalk
  row(SIDEWALK_E.x1 + 0.9, 'edge', 1, () => false);
  // Lummus Park: dense scattered clusters, clear of the winding promenade
  const promenade = (x, z) => Math.abs(x - PARK.promenadeX - 2.6 * Math.sin(z / 19) - 1.2 * Math.sin(z / 7.3)) < 3.0;
  // (a few near the ocean-side wall frame the sea and sun from inside the park)
  for (const [x, z, v] of [[11.2, -18, 0], [11.3, -8.6, 0], [10.6, -26, 1], [10.8, -1, 2]]) tree(x, z, 'park', 1, { species: 'coconut', variant: v, rotY: (rnd() - 0.5) * 0.5 });
  for (let z = -SPAN; z <= SPAN; z += 6 + rnd() * 7) {
    const cx = PARK.x0 + 2 + rnd() * (PARK.x1 - PARK.x0 - 4);
    const n = rnd() < 0.35 ? 1 : rnd() < 0.65 ? 2 : 3 + Math.floor(rnd() * 2);
    const pts = [];
    for (let k = 0; k < n * 5 && pts.length < n; k++) {
      const a = rnd() * Math.PI * 2, d = pts.length ? 1.3 + rnd() * 1.6 : 0;
      const x = cx + Math.cos(a) * d, zz = z + Math.sin(a) * d;
      if (promenade(x, zz)) continue;
      if (x < PARK.x0 + 1.2 || x > PARK.x1 - 1.0) continue;
      if (Math.abs(zz + 14) < 5 && x > 2 && x < 7) continue;   // keep the park view east open around the viewer
      if (trees.some((t) => Math.hypot(t.x - x, t.z - zz) < 1.3) || pts.some((p) => Math.hypot(p[0] - x, p[1] - zz) < 1.3)) continue;
      pts.push([x, zz]);
    }
    for (const [x, zz] of pts) tree(x, zz, 'park', 1);
  }
  // the ends of the extended district (own random stream: everything above is unchanged)
  rnd = mulberry32(3302);
  for (const [zA, zB] of [[-EXT, -SPAN - 4], [SPAN + 4, EXT]]) {
    row(SIDEWALK_W.x1 - 0.9, 'hotel', 0, () => false, zA, zB);
    row(SIDEWALK_E.x1 + 0.9, 'edge', 1, () => false, zA, zB);
    for (let z = zA; z <= zB; z += 6 + rnd() * 7) {
      const x = PARK.x0 + 2 + rnd() * (PARK.x1 - PARK.x0 - 4);
      if (promenade(x, z) || x > PARK.x1 - 1.0) continue;
      tree(x, z, 'park', 1);
    }
  }
  // cross streets: palms along both sidewalks out past the hotels into the haze (own stream)
  rnd = mulberry32(3303);
  for (const c of CROSS_STREETS.filter((q) => !q.far)) for (const s of [-1, 1]) {
    for (let x = -60 - rnd() * 6; x > -205; x -= 12 + rnd() * 7) {
      if (rnd() < 0.12) continue;
      tree(x, c.z + s * (CROSS.hw + 1.25 + (rnd() - 0.5) * 0.2), 'cross', 0, { hs: 0.7 + rnd() * 0.4 });
    }
  }
  // no tree grates in the cross-street mouths or on the crosswalk ramps
  const legs = CROSS_STREETS.filter((c) => !c.far).flatMap((c) => crossLegs(c.z));
  return trees.filter((t) => t.row !== 'hotel' || (!crossStreetAt(t.z, 1.5) && !legs.some(([a, b]) => t.z > a - 1.2 && t.z < b + 1.2)));
}
const EXT = DISTRICT.zMax + 8;

export const PALM_TREES = plan();

// Wind-rustle sound sources: one per ~45 m of each row near the block, ~100 m beyond it
// through the district.
export const PALM_CLUSTERS = (() => {
  const bins = new Map();
  for (const t of PALM_TREES) {
    if (Math.abs(t.z) > DISTRICT.zMax + 5) continue;
    const band = Math.abs(t.z) <= 80 ? Math.floor((t.z + 80) / 45) : `f${Math.floor((t.z + 1000) / 100)}`;
    const key = `${t.row === 'hotel' ? 0 : 1}|${band}`;
    const b = bins.get(key) ?? { x: 0, z: 0, n: 0 };
    b.x += t.x; b.z += t.z; b.n++;
    bins.set(key, b);
  }
  return [...bins.values()].map((b) => [+(b.x / b.n).toFixed(1), +(b.z / b.n).toFixed(1)]);
})();

// ---------------------------------------------------------------------------
// Textures
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// Frond atlas, three columns of 256 px: leaflets (u across the leaflet, v along the
// rachis, 6 leaflets per tile, tiling in v), sabal fan (u radius, v angle), solid rachis.
const LEAF_TILE = 0.42;   // metres of rachis per texture tile
const LEAF_SLANT = 0.78;  // leaflet tip runs this many tiles toward the frond tip
const LEAF_N = 7;         // leaflets per tile and side
function frondAtlas() {
  const [cv, c] = canvas(768, 512);
  const rnd = mulberry32(91);
  // leaflets are drawn on a taller scratch canvas and blurred, so the alpha edge is a
  // smooth ramp (magnified up close it stays a clean curve, not texel steps), then the
  // middle 512 rows are copied in (no blurred-away rows at the tile edges)
  const [lc, l2] = canvas(256, 768);
  {
  const c = l2;
  c.save();
  c.translate(0, 128);
  // many long narrow leaflets with sky between them; tips of varying length separate
  for (let k = -16; k < 26; k++) {
    const y0 = k * (512 / LEAF_N) + (rnd() - 0.5) * 8, y1 = y0 + LEAF_SLANT * 512 + (rnd() - 0.5) * 40;
    const L = 190 + rnd() * 64, w0 = 66 + rnd() * 12;   // ~4 cm blades, ~75% coverage
    const pts = [], back = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const x = 6 + (L - 6) * t, y = y0 + (y1 - y0) * t + Math.sin(t * 3.1) * 14 + t * t * 22;
      const w = w0 * Math.min(1, t / 0.08 + 0.35) * Math.pow(1 - t, 0.65) * 0.5;
      pts.push([x, y - w]); back.push([x, y + w]);
    }
    const g = c.createLinearGradient(0, 0, 256, 0);
    const brown = rnd() < 0.18;
    g.addColorStop(0, '#b8cfa6'); g.addColorStop(0.7, '#cfdcac');
    g.addColorStop(1, brown ? '#b39462' : '#dcdca6');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) c.lineTo(p[0], p[1]);
    for (let i = back.length - 1; i >= 0; i--) c.lineTo(back[i][0], back[i][1]);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(245,244,210,0.8)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(6, y0); c.lineTo(L * 0.9, y0 + (y1 - y0) * 0.9); c.stroke();
  }
  c.restore();
  }
  const [bc, b2] = canvas(256, 768);
  b2.filter = 'blur(1.6px)';
  b2.drawImage(lc, 0, 0);
  c.drawImage(bc, 0, 128, 256, 512, 0, 0, 256, 512);
  c.fillStyle = '#c9cc9a'; c.fillRect(0, 0, 7, 512);   // leaflet bases along the rachis
  // sabal fan: segments joined to ~half radius, split tapering tips beyond
  const segs = 36, sh = 512 / segs;
  for (let i = 0; i < segs; i++) {
    const y = i * sh, rs = (0.42 + rnd() * 0.18) * 256, rt = (0.86 + rnd() * 0.14) * 256;
    const l = 0.82 + rnd() * 0.18;
    c.fillStyle = `rgb(${Math.round(196 * l)},${Math.round(212 * l)},${Math.round(160 * l)})`;
    c.fillRect(256, y, rs, sh + 0.5);
    c.beginPath();
    c.moveTo(256 + rs - 2, y + 1.5); c.lineTo(256 + rt, y + sh * 0.5); c.lineTo(256 + rs - 2, y + sh - 1.5);
    c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,230,0.35)';
    c.fillRect(256, y + sh * 0.45, rs, 1.5);
  }
  const rg = c.createLinearGradient(512, 0, 768, 0);
  rg.addColorStop(0, '#b9b27c'); rg.addColorStop(1, '#d6cf98');
  c.fillStyle = rg; c.fillRect(512, 0, 256, 512);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Trunk atlas 512 x 512 (1 m tall): left half coconut / royal leaf-scar rings and
// vertical cracks, right half sabal criss-cross leaf-base boots. Albedo + normal map.
function trunkTextures() {
  const S = 512, H = new Float32Array(S * S);
  const [cv, c] = canvas(S, S);
  const rnd = mulberry32(17);
  const img = c.createImageData(S, S);
  const rings = [];
  // closely spaced, irregular, bumpy leaf-scar rings (~3-6 cm apart)
  for (let y = 0; y < S;) { rings.push({ y, w: 2.5 + rnd() * 3, a: 0.55 + rnd() * 0.45, ph: rnd() * 6.28, f: 1 + Math.floor(rnd() * 3), amp: 2 + rnd() * 5 }); y += 16 + rnd() * 16; }
  const bump = fbmField(256, { seed: 5, baseCells: 24, octaves: 2 });
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let h = 0.5, alb = 0.9;
    const n = (rnd() - 0.5) * 0.04 + (x < 256 ? (bump[(y >> 1) * 256 + x] - 0.5) * 0.18 : 0);
    if (x < 256) {
      for (const r of rings) {
        const yy = r.y + r.amp * Math.sin((x / 256) * Math.PI * 2 * r.f + r.ph) + 1.5 * Math.sin((x / 256) * Math.PI * 2 * 7 + r.ph * 3);
        let d = Math.abs(y - yy); d = Math.min(d, S - d);
        if (d < r.w * 2.5) { const k = Math.exp(-(d * d) / (r.w * r.w)) * r.a; h -= 0.55 * k; alb -= 0.42 * k; }
        else if (d < r.w * 5) h += 0.06 * r.a;   // slightly swollen between scars
      }
    } else {
      // diamond lattice of split leaf bases
      const u = (x - 256) / 256, v = y / S;
      const a = (u * 6 + v * 7) % 1, b = (u * 6 - v * 7 + 14) % 1;
      const cell = Math.min(a, 1 - a, b, 1 - b);
      h = 0.3 + Math.min(1, cell * 6) * 0.6 - (Math.abs(a - 0.5) < 0.06 && b > 0.3 ? 0.35 : 0);
      alb = 0.55 + 0.4 * Math.min(1, cell * 5);
    }
    h += n; alb += n;
    H[y * S + x] = h;
    const i = (y * S + x) * 4, v = Math.max(0, Math.min(255, alb * 255));
    img.data[i] = v; img.data[i + 1] = v * 0.97; img.data[i + 2] = v * 0.92; img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  const [nc, nx] = canvas(S, S);
  const nimg = nx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const half = x >= 256 ? 256 : 0, lx = x - half;
    const hx = (H[y * S + half + ((lx + 1) % 256)] - H[y * S + half + ((lx + 255) % 256)]) * 3.0;
    const hy = (H[((y + 1) % S) * S + x] - H[((y + S - 1) % S) * S + x]) * 3.0;
    const l = Math.hypot(hx, hy, 1);
    const i = (y * S + x) * 4;
    nimg.data[i] = (-hx / l * 0.5 + 0.5) * 255;
    nimg.data[i + 1] = (hy / l * 0.5 + 0.5) * 255;
    nimg.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    nimg.data[i + 3] = 255;
  }
  nx.putImageData(nimg, 0, 0);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(nc);
  for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  return { map, normalMap };
}

// ---------------------------------------------------------------------------
// Geometry helpers: indexed position / normal / uv (+ color for trunks)
class Mesher {
  constructor(color) { this.p = []; this.uv = []; this.c = color ? [] : null; this.idx = []; }
  v(p, uv, col) { this.p.push(p[0], p[1], p[2]); this.uv.push(uv[0], uv[1]); if (this.c) this.c.push(col.r, col.g, col.b); return this.p.length / 3 - 1; }
  grid(rows, cols, fn) {
    // rows x cols vertices; fn(i, j) -> [pos, uv, col]
    const base = this.p.length / 3;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const [p, uv, col] = fn(i, j); this.v(p, uv, col); }
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
      const a = base + i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      this.idx.push(a, b, c, b, d, c);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.c) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

const bez = (P, t) => {
  const u = 1 - t;
  return [0, 1, 2].map((k) => u * u * u * P[0][k] + 3 * u * u * t * P[1][k] + 3 * u * t * t * P[2][k] + t * t * t * P[3][k]);
};

// Trunk swept along a cubic bezier in the x-y plane (lean toward +x).
function trunkGeometry({ H, lean, bend, species, seed, sc = 0 }) {
  const rnd = mulberry32(seed);
  const P = species === 'coconut'
    ? [[0, 0, 0], [lean * bend + sc, H * 0.33, 0], [lean * (0.55 + 0.35 * bend) - sc * 0.8, H * 0.66, 0], [lean, H, 0]]
    : [[0, 0, 0], [lean * 0.3, H * 0.33, 0], [lean * 0.7, H * 0.66, 0], [lean, H, 0]];
  const segs = 44, rad = 12;
  const col = new THREE.Color(), cA = new THREE.Color(), cB = new THREE.Color();
  const pts = [], tans = [], len = [0];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, p = bez(P, t), q = bez(P, Math.min(1, t + 1e-3)), q0 = bez(P, Math.max(0, t - 1e-3));
    pts.push(p);
    const d = [q[0] - q0[0], q[1] - q0[1], 0], l = Math.hypot(d[0], d[1]);
    tans.push([d[0] / l, d[1] / l]);
    if (i > 0) len.push(len[i - 1] + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]));
  }
  const L = len[segs];
  const crownshaft = species === 'royal' ? 1.9 : 0;
  const radius = (t, s) => {
    const h = t * L;
    if (species === 'coconut') return 0.125 + 0.045 * (1 - t) + 0.17 * Math.exp(-h / 0.5) + 0.008 * Math.sin(h * 1.7 + seed) + 0.035 * s * Math.exp(-h / 0.45);   // slender, rough flared root boss
    if (species === 'royal') return h > L - crownshaft ? 0.215 + 0.02 * Math.sin(((h - (L - crownshaft)) / crownshaft) * Math.PI) : 0.22 + 0.06 * Math.exp(-(((t - 0.4) / 0.25) ** 2)) + 0.1 * Math.exp(-h / 0.6) - 0.03 * t;
    return 0.23 + 0.04 * Math.exp(-h / 0.5) + 0.012 * s;
  };
  const uOff = species === 'sabal' ? 0.5 : 0;
  if (species === 'coconut') { cA.setHex(0xc2bcb0); cB.setHex(0xd8d2c4); }
  else if (species === 'royal') { cA.setHex(0xc4c2bb); cB.setHex(0x5f8a3c); }
  else { cA.setHex(0x7d6c58); cB.setHex(0x6a5a47); }
  const m = new Mesher(true);
  m.grid(segs + 1, rad + 1, (i, j) => {
    const t = i / segs, a = (j / rad) * Math.PI * 2;
    const [tx, ty] = tans[i];
    const N = [-ty, tx, 0];   // in-plane normal; binormal is z
    const r = radius(t, i < 6 ? Math.sin(a * 5 + i * 1.3) * 0.6 + Math.sin(a * 11 + i * 2.1) * 0.4 : Math.sin(a * 3 + i));
    const p = pts[i];
    const pos = [p[0] + (N[0] * Math.cos(a)) * r, p[1] + N[1] * Math.cos(a) * r, Math.sin(a) * r];
    const h = len[i];
    if (species === 'royal') col.copy(h > L - crownshaft ? cB : cA);
    else {
      // light grey to grey-tan; rougher and darker toward the base, a smoother lighter band below the crown
      col.copy(cA).lerp(cB, Math.max(0, Math.min(1, (h - (L - 1.4)) / 1.4)));
      if (species === 'coconut') col.multiplyScalar(0.72 + 0.28 * Math.min(1, h / 1.6));
    }
    return [pos, [uOff + (j / rad) * 0.5, h], col];
  });
  // crown knob of frond bases (coconut / sabal) or spear leaf (royal), closing the top
  const top = pts[segs];
  // coconut / sabal: a shaggy fibrous skirt of old frond bases flaring out where the
  // crown meets the trunk
  const knob = species === 'royal' ? [[0.2, 0.25], [0.12, 0.8], [0.03, 1.5], [0, 1.8]]
    : [[0.15, -0.9], [0.3, -0.45], [0.46, -0.05], [0.44, 0.25], [0.3, 0.55], [0.1, 0.75], [0, 0.8]];
  const kc = new THREE.Color(species === 'royal' ? 0x6f9a44 : 0x8c6d45), kc2 = new THREE.Color(0x5e4a33);
  m.grid(knob.length, rad * 2 + 1, (i, j) => {
    const a = (j / (rad * 2)) * Math.PI * 2, [r0, y] = knob[i];
    const shag = species === 'royal' ? 0 : (j % 2 ? 0.08 : -0.04) * Math.min(1, i / 2) * (i < knob.length - 2 ? 1 : 0);
    const r = r0 * (1 + shag * 2);
    const yy = y - (j % 2 ? 0.12 : 0) * (i === 1 || i === 2 ? 1 : 0);
    return [[top[0] + Math.cos(a) * r, top[1] + yy, Math.sin(a) * r], [uOff + (j / (rad * 2)) * 0.5, L + y], j % 3 ? kc : kc2];
  });
  return { geo: m.geometry(), top: [top[0], top[1] + (species === 'royal' ? 0.25 : 0.45), 0] };
}

// Coconut clusters under the crown: two or three bunches of green / yellow nuts on
// orange-yellow fruit stalks, plus a few bare branched inflorescence stalks
// (local origin = crown attachment point).
function coconutGeometry() {
  const rnd = mulberry32(5);
  const m = new Mesher(true);
  const col = new THREE.Color();
  const addGeo = (g, hex) => {
    col.setHex(hex);
    const base = m.p.length / 3;
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let k = 0; k < p.count; k++) m.v([p.getX(k), p.getY(k), p.getZ(k)], [uv.getX(k) * 0.4, uv.getY(k) * 0.2], col);
    for (let k = 0; k < g.index.count; k++) m.idx.push(base + g.index.getX(k));
  };
  const stalk = (a, b, r, hex) => {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const g = new THREE.CylinderGeometry(r * 0.7, r, d.length(), 5, 1);
    g.translate(0, d.length() / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
    g.translate(a[0], a[1], a[2]);
    addGeo(g, hex);
  };
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI * 2 + rnd() * 0.6;
    const cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5, cy = -0.3 - rnd() * 0.15;
    stalk([Math.cos(a) * 0.15, -0.05, Math.sin(a) * 0.15], [cx, cy + 0.15, cz], 0.035, 0xa8884e);
    const n = 3 + Math.floor(rnd() * 3), yel = rnd() < 0.25;
    for (let i = 0; i < n; i++) {
      const aa = (i / n) * Math.PI * 2 + rnd() * 0.4, rr = 0.2 + rnd() * 0.1;
      const g = new THREE.SphereGeometry(0.13 + rnd() * 0.03, 9, 7);
      g.scale(1, 1.15, 1);
      g.translate(cx + Math.cos(aa) * rr, cy - rnd() * 0.18, cz + Math.sin(aa) * rr);
      addGeo(g, yel && rnd() < 0.6 ? 0x9a8a32 : rnd() < 0.7 ? 0x4f5e22 : 0x6a5428);
    }
  }
  // bare flower stalks: arching orange-yellow strands with a few branches
  for (let k = 0; k < 3; k++) {
    const a = rnd() * Math.PI * 2;
    const p0 = [Math.cos(a) * 0.15, -0.05, Math.sin(a) * 0.15], p1 = [Math.cos(a) * 0.7, -0.35, Math.sin(a) * 0.7];
    stalk(p0, p1, 0.03, 0xb49a62);
    for (let j = 0; j < 4; j++) {
      const t = 0.4 + j * 0.15, q = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t];
      const bb = a + (rnd() - 0.5) * 1.4;
      stalk(q, [q[0] + Math.cos(bb) * 0.35, q[1] - 0.45 - rnd() * 0.2, q[2] + Math.sin(bb) * 0.35], 0.014, 0xbfa46c);
    }
  }
  return m.geometry();
}

// Pinnate frond: arching rachis along +x (local), leaflet ribbons hanging from both
// sides in a V; uv.x = region + across (0 healthy, 1 ragged), uv.y = rachis tiles.
function pinnateFrond({ L, rise, droop, leaf, v0, v1, region, seed, tw = 0, segs = 14 }) {
  const rnd = mulberry32(seed);
  const rach = (t) => [L * t * (1 - 0.1 * t), L * (rise * t - droop * t * t), 0.06 * L * Math.sin(t * 2.2 + seed) * t];
  const frame = (t) => {
    const p = rach(t), q = rach(t + 0.01);
    const T = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], l = Math.hypot(...T);
    const Tn = T.map((v) => v / l);
    const Nup = [-Tn[1], Tn[0], 0];
    return { p, T: Tn, N: Nup };
  };
  const arc = [0];
  for (let i = 1; i <= segs; i++) { const a = rach((i - 1) / segs), b = rach(i / segs); arc.push(arc[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])); }
  const m = new Mesher(false);
  const t0 = 0.12;
  for (const s of [-1, 1]) {
    const jit = rnd() * 0.1;
    m.grid(segs + 1, 3, (i, j) => {
      const t = t0 + (1 - t0) * (i / segs);
      const { p, N } = frame(t);
      const a = v0 + (v1 - v0) * t + jit;
      // the blade plane twists along the rachis
      const ph = tw * t, cp = Math.cos(ph), sp = Math.sin(ph);
      const dn = -Math.sin(a), dz = s * Math.cos(a);
      const dir = [N[0] * (dn * cp - dz * sp), N[1] * (dn * cp - dz * sp), dn * sp + dz * cp];
      const w = leaf * (0.3 + 0.7 * Math.sin(Math.PI * Math.min(1, (t - t0) * 1.35 + 0.12))) * (1 - 0.5 * t) * (i === segs ? 0.35 : 1);
      const k = j / 2, curl = 0.35 * w * k * k;
      const pos = [p[0] + dir[0] * w * k - N[0] * curl, p[1] + dir[1] * w * k - N[1] * curl, p[2] + dir[2] * w * k];
      const v = (arc[Math.round(i)] * (1 - t0) + L * t0) / LEAF_TILE;
      return [pos, [region + 0.02 + 0.96 * k, v]];
    });
  }
  // rachis / petiole: thin triangular prism, thicker at the base
  m.grid(segs + 1, 4, (i, j) => {
    const t = i / segs, { p, N } = frame(t);
    const r = 0.045 * (1 - 0.75 * t) + 0.008;
    const a = (j / 3) * Math.PI * 2;
    return [[p[0] + N[0] * Math.cos(a) * r, p[1] + N[1] * Math.cos(a) * r, p[2] + Math.sin(a) * r], [3.5, t * 4]];
  });
  return m.geometry();
}

// Sabal costapalmate fan on a long petiole (local +x).
function fanFrond(seed) {
  const rnd = mulberry32(seed);
  const m = new Mesher(false);
  const pl = 1.3, R = 1.05, C = [pl, pl * 0.35, 0];
  m.grid(9, 4, (i, j) => {
    const t = i / 8, a = (j / 3) * Math.PI * 2, r = 0.03 * (1 - 0.4 * t);
    return [[pl * t, pl * 0.35 * t * t + Math.cos(a) * r, Math.sin(a) * r], [3.5, t * 3]];
  });
  const na = 24;
  m.grid(4, na + 1, (i, j) => {
    const r = (i / 3) * R, th = -2.1 + (j / na) * 4.2;
    const pleat = (j % 2 ? 1 : -1) * 0.05 * (r / R);
    const x = C[0] + Math.cos(th) * r * 0.55 + r * 0.45, z = Math.sin(th) * r;
    const y = C[1] + pleat + 0.25 * r * Math.cos(th * 0.5) - 0.45 * (r / R) ** 2 * (0.6 + 0.4 * Math.abs(Math.sin(th))) + (rnd() - 0.5) * 0.02;
    return [[x, y, z], [2.02 + 0.96 * (i / 3), j / na]];
  });
  return m.geometry();
}

// ---------------------------------------------------------------------------
// Shaders
const WIND = { value: 0 };

const SWAY_GLSL = /* glsl */ `
uniform float odWindT;
vec3 odSway(vec3 p) {
  float ph = dot(p.xz, vec2(0.05, 0.03));
  float s = sin(odWindT * 0.8 + ph) + 0.35 * sin(odWindT * 1.9 + ph * 2.1);
  float h = max(p.y, 0.0) / 12.0;
  return vec3(0.75, 0.0, 0.45) * 0.022 * s * h * h;
}`;

// uv -> frond atlas uv, with gradients from the unwrapped coordinates (no seams)
const FROND_TEX_GLSL = /* glsl */ `
float odFh(float n) { return fract(sin(n * 91.345) * 43758.5453); }
vec4 odFrondTex(sampler2D tex, vec2 uv) {
  float region = floor(uv.x);
  float col = region < 1.5 ? 0.0 : region - 1.0;
  float lu = clamp(fract(uv.x), 0.01, 0.99);
  float lv = col < 0.5 ? fract(uv.y) : clamp(uv.y, 0.01, 0.99);
  vec2 auv = vec2((col + lu) / 3.0, lv);
  vec2 gx = vec2(dFdx(uv.x) / 3.0, dFdx(uv.y)), gy = vec2(dFdy(uv.x) / 3.0, dFdy(uv.y));
#ifdef OD_DEPTH
  // shadow pass: near-full-res alpha so leaflet gaps survive in the (2 cm texel) map
  vec4 c = textureLod(tex, auv, 1.0);
#else
  vec4 c = textureGrad(tex, auv, gx, gy);
  // mip levels average the thin blades' alpha below the cut-off: boost it with distance
  vec2 ts = vec2(textureSize(tex, 0));
  float lod = 0.5 * log2(max(dot(gx * ts, gx * ts), dot(gy * ts, gy * ts)) + 1e-8);
  c.a = min(1.0, c.a * (1.0 + max(lod, 0.0) * 0.35));
#endif
  if (region > 0.5 && region < 1.5) {
    // ragged / dead fronds: missing leaflets and snapped tips
    float id = floor((uv.y - lu * ${LEAF_SLANT.toFixed(3)}) * ${LEAF_N.toFixed(1)});
    float h = odFh(id);
    if (h < 0.24 || (h > 0.7 && lu > 0.35 + 0.5 * odFh(id + 3.1))) c.a = 0.0;
  }
  return c;
}`;

const MAP_REPLACE = `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = odFrondTex(map, vMapUv);
  diffuseColor *= sampledDiffuseColor;
#endif`;

function frondMaterial(atlas) {
  const m = new THREE.MeshStandardMaterial({
    map: atlas, roughness: 0.52, side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.odWindT = WIND;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SWAY_GLSL}
varying float vOdK;`)
      // V-folded leaflets face every way: normals bent outward from the crown (both
      // faces), so a grazing 7 deg sun still lights part of every frond
      .replace('#include <beginnormal_vertex>',
        'vec3 objectNormal = normalize(mix(normal * sign(normal.y + 1e-3), normalize(position + vec3(0.0, 0.9, 0.0)), 0.6));')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 odOrg = batchingMatrix[3].xyz;
        vOdK = clamp(length(position) / 2.2, 0.0, 1.0);
        {
          // frond tips flutter; amplitude grows along the rachis
          float ph = fract(sin(dot(odOrg.xz, vec2(12.9898, 78.233)) + float(gl_DrawID)) * 43758.5) * 6.28;
          float k = clamp(length(position.xz) / 4.5, 0.0, 1.2);
          transformed.y += 0.06 * k * k * sin(odWindT * 2.3 + ph + position.x * 0.9);
          transformed.z += 0.035 * k * k * sin(odWindT * 1.7 + ph * 1.3 + position.x * 0.6);
        }`)
      .replace('mvPosition = modelViewMatrix * mvPosition;', 'mvPosition.xyz += odSway(odOrg);\nmvPosition = modelViewMatrix * mvPosition;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FROND_TEX_GLSL}
varying float vOdK;`)
      .replace('#include <map_fragment>', MAP_REPLACE)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        #ifdef USE_FOG
        {
          vec3 odV = -normalize(vFogOffset);
          vec3 odNg = normalize(cross(dFdx(vFogOffset), dFdy(vFogOffset)));
          odNg *= sign(dot(odNg, odV));
          // the bent normals would light every blade; only the face we actually see
          // being sunward gets direct light (backlit fronds stay dark silhouettes)
          float odFace = dot(odNg, OD_SUN);
          float odLit = smoothstep(-0.1, 0.3, odFace);
          reflectedLight.directDiffuse *= mix(0.1, 1.0, odLit);
          reflectedLight.directSpecular *= odLit;
          reflectedLight.directDiffuse += diffuseColor.rgb * directLight.color * 0.1 * odLit;
          // modest olive-gold transmission through single leaflet layers toward the sun
          float odT = max(-odFace, 0.0) * pow(max(dot(-odV, OD_SUN), 0.0), 3.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * vec3(0.85, 0.75, 0.2) * directLight.color * 0.1 * odT;
          // crown interior in deep shade
          reflectedLight.indirectDiffuse *= 0.35 + 0.65 * vOdK;
          reflectedLight.directDiffuse *= 0.55 + 0.45 * vOdK;
        }
        #endif`);
  };
  m.customProgramCacheKey = () => 'palm-frond-v3';
  const depth = new THREE.MeshDepthMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide });
  depth.defines = { OD_DEPTH: '' };
  depth.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FROND_TEX_GLSL}`)
      .replace('#include <map_fragment>', MAP_REPLACE);
  };
  depth.customProgramCacheKey = () => 'palm-frond-depth-v2';
  return { m, depth };
}

function trunkMaterial() {
  const { map, normalMap } = trunkTextures();
  const m = new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(1.7, 1.7), vertexColors: true, roughness: 0.9 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.odWindT = WIND;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SWAY_GLSL}`)
      .replace('mvPosition = modelViewMatrix * mvPosition;', 'mvPosition.xyz += odSway(mvPosition.xyz);\nmvPosition = modelViewMatrix * mvPosition;');
  };
  m.customProgramCacheKey = () => 'palm-trunk-v1';
  return m;
}

// Tree grates (hotel-side planting islands) and sand / mulch circles (park).
function groundMesh(trees) {
  const [cv, c] = canvas(512, 256);
  const rnd = mulberry32(44);
  // square cut-out: mulch with low green plants, a galvanised grate with bold bars over it
  c.fillStyle = '#6b5238'; c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) {
    c.fillStyle = ['#8a6a44', '#4f3b28', '#a07c50', '#5d4631'][i & 3];
    c.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 5, 1 + rnd() * 2);
  }
  for (let i = 0; i < 40; i++) {
    const x = 20 + rnd() * 216, y = 20 + rnd() * 216;
    if (Math.hypot(x - 128, y - 128) < 70) continue;
    c.fillStyle = ['#5f7f36', '#7c9a44', '#4e6b2c'][i % 3];
    c.beginPath(); c.arc(x, y, 5 + rnd() * 9, 0, Math.PI * 2); c.fill();
  }
  // dirty stain ring on the paving around the pit
  const st = c.createRadialGradient(128, 128, 60, 128, 128, 128);
  st.addColorStop(0, 'rgba(0,0,0,0)'); st.addColorStop(1, 'rgba(50,40,30,0.35)');
  c.fillStyle = st; c.fillRect(0, 0, 256, 256);
  c.strokeStyle = '#4f4c46'; c.lineCap = 'butt';
  c.lineWidth = 10; c.strokeRect(10, 10, 236, 236);
  c.lineWidth = 6;
  for (let x = 30; x < 236; x += 22) {
    if (Math.abs(x - 128) < 40) { c.beginPath(); c.moveTo(x, 12); c.lineTo(x, 88); c.moveTo(x, 168); c.lineTo(x, 244); c.stroke(); }
    else { c.beginPath(); c.moveTo(x, 12); c.lineTo(x, 244); c.stroke(); }
  }
  c.strokeStyle = 'rgba(40,36,32,0.5)'; c.lineWidth = 2;
  for (let x = 33; x < 236; x += 22) { c.beginPath(); c.moveTo(x, 12); c.lineTo(x, 244); c.stroke(); }
  c.strokeStyle = '#4f4c46'; c.lineWidth = 8; c.beginPath(); c.arc(128, 128, 44, 0, Math.PI * 2); c.stroke();
  // bare trampled sand / dirt patch with a ragged edge into the lawn
  c.save(); c.beginPath(); c.rect(256, 0, 256, 256); c.clip();
  for (let i = 0; i < 70; i++) {
    const a = rnd() * 6.28, d = rnd() * 70;
    const g = c.createRadialGradient(384 + Math.cos(a) * d, 128 + Math.sin(a) * d, 4, 384 + Math.cos(a) * d, 128 + Math.sin(a) * d, 40 + rnd() * 30);
    g.addColorStop(0, 'rgba(196,176,140,0.55)'); g.addColorStop(1, 'rgba(196,176,140,0)');
    c.fillStyle = g; c.fillRect(256, 0, 256, 256);
  }
  for (let i = 0; i < 1500; i++) {
    const a = rnd() * 6.28, d = Math.sqrt(rnd()) * 100;
    c.fillStyle = rnd() < 0.5 ? 'rgba(150,128,96,0.5)' : 'rgba(220,204,170,0.5)';
    c.fillRect(384 + Math.cos(a) * d, 128 + Math.sin(a) * d, 2, 2);
  }
  for (let i = 0; i < 26; i++) {
    const a = rnd() * 6.28, d = 20 + rnd() * 80, x = 384 + Math.cos(a) * d, y = 128 + Math.sin(a) * d, b = rnd() * 6.28, l = 14 + rnd() * 26;
    c.strokeStyle = rnd() < 0.5 ? 'rgba(120,96,58,0.9)' : 'rgba(150,132,90,0.9)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(b) * l, y + Math.sin(b) * l); c.stroke();
  }
  c.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const kind = new Float32Array(trees.length);
  trees.forEach((t, i) => { kind[i] = t.ground; });
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aKind;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv.x = vMapUv.x * 0.5 + aKind * 0.5;');
  };
  mat.customProgramCacheKey = () => 'palm-ground-v1';
  const im = new THREE.InstancedMesh(geo, mat, trees.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  trees.forEach((t, i) => {
    const size = t.ground ? 2.4 + (t.seed % 7) * 0.15 : 1.4;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.ground ? t.seed % 6 : 0);
    m4.compose(new THREE.Vector3(t.x, CURB_HEIGHT + 0.004, t.z), q, s.set(size, 1, size));
    im.setMatrixAt(i, m4);
  });
  im.receiveShadow = true;
  im.renderOrder = 1;
  return [im];
}

// ---------------------------------------------------------------------------
export function buildPalms(scene) {
  const group = new THREE.Group();
  group.name = 'palms';

  // trunk variants
  const trunkDefs = [
    { species: 'coconut', H: 5.8, lean: 1.1, bend: 1.0, seed: 1, sc: 0.3 },     // young, curved
    { species: 'coconut', H: 10, lean: 1.6, bend: 0.8, seed: 2, sc: 0.35 },
    { species: 'coconut', H: 11, lean: 3.4, bend: 1.0, seed: 3, sc: 0.2 },
    { species: 'coconut', H: 14, lean: 1.8, bend: 0.6, seed: 4, sc: 1.1 },      // S-curve
    { species: 'coconut', H: 19, lean: 2.4, bend: 0.5, seed: 7, sc: 1.4 },      // towers over the roofs
    { species: 'coconut', H: 12, lean: 0.8, bend: 0.3, seed: 8, sc: 0.45 },     // near straight
    { species: 'royal', H: 14, lean: 0.15, bend: 0, seed: 5 },
    { species: 'sabal', H: 7, lean: 0.35, bend: 0, seed: 6 },
  ];
  const trunks = trunkDefs.map(trunkGeometry);
  const nutGeo = coconutGeometry();

  // frond variants
  const frondDefs = [
    // arc out, then the tip drops well below the midrib; leaflets hang from the rachis
    { L: 5.0, rise: 0.42, droop: 0.8, leaf: 0.95, v0: 0.45, v1: 0.9, region: 0, seed: 11, tw: 0.5 },
    { L: 4.6, rise: 0.48, droop: 0.95, leaf: 0.9, v0: 0.5, v1: 1.0, region: 0, seed: 12, tw: -0.6 },
    { L: 5.2, rise: 0.35, droop: 0.75, leaf: 1.0, v0: 0.45, v1: 0.9, region: 1, seed: 13, tw: 0.8 },
    { L: 4.4, rise: 0.5, droop: 1.15, leaf: 0.85, v0: 0.55, v1: 1.05, region: 0, seed: 14, tw: -0.4 },
    { L: 4.0, rise: 0.05, droop: 0.35, leaf: 0.75, v0: 1.25, v1: 1.45, region: 1, seed: 15 },   // dead, hanging
    { L: 3.8, rise: 0.55, droop: 1.1, leaf: 0.85, v0: 0.35, v1: 0.8, region: 0, seed: 16 },    // royal: flatter, plumose
  ];
  const frondGeos = [...frondDefs.map((d) => pinnateFrond(d)), fanFrond(17)];
  // distant crowns: the same fronds with a coarse rachis (FROND_LOW + g)
  const FROND_LOW = frondGeos.length;
  frondGeos.push(...frondDefs.map((d) => pinnateFrond({ ...d, segs: 5 })));

  const countV = (g) => g.attributes.position.count, countI = (g) => g.index.count;
  const trunkTris = [...trunks.map((t) => t.geo), nutGeo];

  // instance lists
  const trunkInst = [], frondInst = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0), Zax = new THREE.Vector3(0, 0, 1), Xax = new THREE.Vector3(1, 0, 0);
  const col = new THREE.Color();
  let treeI = -1;
  for (const t of PALM_TREES) {
    treeI++;
    const rnd = mulberry32(t.seed);
    const ti = t.species === 'royal' ? 6 : t.species === 'sabal' ? 7 : t.variant;
    const base = new THREE.Vector3(t.x, CURB_HEIGHT, t.z);
    q.setFromAxisAngle(Y, t.rotY);
    const sc = t.scale * (t.species === 'sabal' ? 0.95 : 1);
    // per-tree height stretch (capped ~21 m) and lean shear
    const hy = Math.max(0.8, Math.min(t.hs, 21 / (trunkDefs[ti].H * sc)));
    const tm = new THREE.Matrix4().compose(base, q, new THREE.Vector3(1, 1, 1))
      .multiply(new THREE.Matrix4().set(1, t.k, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1))
      .multiply(new THREE.Matrix4().makeScale(sc, sc * hy, sc));
    trunkInst.push({ g: ti, m: tm, c: col.setScalar(0.94 + rnd() * 0.12).clone() });
    const top = new THREE.Vector3(...trunks[ti].top).applyMatrix4(tm);
    const bleach = rnd();
    const fresh = new THREE.Color().setRGB(0.1, 0.2, 0.038).lerp(new THREE.Color(0.2, 0.26, 0.05), bleach).multiplyScalar(0.85 + 0.3 * rnd());   // mid-deep olive; the warm sun makes the gold
    // lower tiers thin the crowns of palms beyond the walkable block (separate random
    // stream, so the kept fronds are exactly the 'high' ones)
    const thin = Math.abs(t.z) > 100 ? QUALITY.farFoliage : 1;
    const rThin = mulberry32(t.seed + 7919);
    const addFrond = (g, az, pitch, s, c, roll = 0) => {
      if (thin < 1 && rThin() > thin) return;
      qa.setFromAxisAngle(Y, t.rotY + az);
      qb.setFromAxisAngle(Zax, pitch);
      const qr = new THREE.Quaternion().setFromAxisAngle(Xax, roll);
      const qq = qa.clone().multiply(qb).multiply(qr);
      // far crowns keep ~60% of their fronds (hashed, no random draws), always the first
      const n = frondInst.length, first = !frondInst.length || frondInst[n - 1].tree !== treeI;
      frondInst.push({ g, m: new THREE.Matrix4().compose(top, qq, new THREE.Vector3(s, s, s).multiplyScalar(sc)), c: c.clone(), tree: treeI, keep: first || ((Math.imul(n + 1, 2654435761) >>> 0) % 10) < 6 });
    };
    if (t.species === 'sabal') {
      const n = 16 + Math.floor(rnd() * 8);
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        addFrond(6, i * 2.3999 + rnd() * 0.3, 0.9 - 1.4 * f + (rnd() - 0.5) * 0.2, 0.85 + rnd() * 0.25, col.copy(fresh).multiplyScalar(0.8 + 0.3 * rnd()), (rnd() - 0.5) * 0.6);
      }
      for (let i = 0; i < 3; i++) addFrond(6, rnd() * 6.28, -1.3 - rnd() * 0.3, 0.8, col.setRGB(0.3, 0.2, 0.09), rnd());
      continue;
    }
    if (t.species === 'royal') {
      const n = 12 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        addFrond(5, i * 2.3999 + rnd() * 0.3, 1.0 - 1.35 * f + (rnd() - 0.5) * 0.15, 1.2 + rnd() * 0.3, col.copy(fresh).multiplyScalar(1.05).lerp(new THREE.Color(0.2, 0.38, 0.06), 0.4), (rnd() - 0.5) * 0.5);
      }
      continue;
    }
    // full ball: spear + young fronds up top, middle fronds horizontal, only the lower
    // ones arch out and droop; some missing / broken, lopsided per tree
    const young = ti === 0;
    const n = (young ? 16 : 22) + Math.floor(rnd() * 11);
    const droopBias = (rnd() - 0.5) * 0.3, spin = rnd() * 6.28, fsc = (young ? 0.8 : 1.12) * (0.9 + rnd() * 0.2);
    const lop = rnd() * 0.35, lopAz = rnd() * 6.28;
    addFrond(3, spin, 1.5, 0.45 * fsc, col.copy(fresh).multiplyScalar(1.2), 0);
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      if (f > 0.2 && rnd() < 0.08) continue;
      const g = [0, 1, 2, 3][Math.floor(rnd() * 4)];
      const az = spin + i * 2.3999 + (rnd() - 0.5) * 0.45;
      const pitch = 1.3 - 2.0 * Math.pow(f, 0.9) + droopBias - lop * Math.cos(az - lopAz) + (rnd() - 0.5) * 0.25;
      const s = ((f < 0.12 ? 0.55 + f * 3.5 : 0.97) + rnd() * 0.12) * fsc * (rnd() < 0.05 ? 0.6 : 1);
      // older (lower) fronds yellower
      const c = col.copy(fresh).lerp(new THREE.Color(0.3, 0.28, 0.08), f * f * 0.6 * (0.4 + bleach)).multiplyScalar(0.85 + 0.3 * rnd());
      addFrond(g, az, pitch, s, c, (rnd() - 0.5) * 0.8);
    }
    // brown / tan dead fronds hanging under most crowns
    const dead = young ? Math.floor(rnd() * 2) : rnd() < 0.15 ? 1 : 2 + Math.floor(rnd() * 4);
    for (let i = 0; i < dead; i++) {
      addFrond(4, rnd() * 6.28, -1.52 - rnd() * 0.08, (0.8 + rnd() * 0.15) * fsc, col.setRGB(0.24, 0.21, 0.15).multiplyScalar(0.8 + 0.4 * rnd()), (rnd() - 0.5) * 0.8);   // dull dry grey-tan, limp against the trunk
    }
    if (!young && rnd() < 0.85) {
      qa.setFromAxisAngle(Y, rnd() * 6.28);
      trunkInst.push({ g: trunks.length, m: new THREE.Matrix4().compose(top.clone().add(new THREE.Vector3(0, -0.05, 0)), qa, new THREE.Vector3(sc, sc, sc)), c: col.setScalar(1).clone() });
    }
  }

  const batched = (geos, insts, mat) => {
    const usedV = geos.reduce((a, g) => a + countV(g), 0), usedI = geos.reduce((a, g) => a + countI(g), 0);
    const bm = new THREE.BatchedMesh(insts.length, usedV, usedI, mat);
    const ids = geos.map((g) => bm.addGeometry(g));
    for (const it of insts) {
      const id = bm.addInstance(ids[it.g]);
      it.id = id;
      bm.setMatrixAt(id, it.m);
      bm.setColorAt(id, it.c);
    }
    bm.castShadow = true;
    bm.receiveShadow = true;
    return staticCull(bm, { sort: true });
  };

  const tMesh = batched(trunkTris, trunkInst, trunkMaterial());
  const atlas = frondAtlas();
  const { m: fMat, depth } = frondMaterial(atlas);
  const fMesh = batched(frondGeos, frondInst, fMat);
  fMesh.customDepthMaterial = depth;
  // crown LOD: beyond LOD.palmNear the coarse fronds, and fewer of them
  {
    const byTree = PALM_TREES.map(() => []);
    for (const f of frondInst) byTree[f.tree].push(f);
    const far = new Uint8Array(PALM_TREES.length);
    registerLodHook((p) => {
      let changed = false;
      PALM_TREES.forEach((t, i) => {
        const isFar = Math.hypot(t.x - p.x, t.z - p.z) > LOD.palmNear ? 1 : 0;
        if (isFar === far[i]) return;
        far[i] = isFar;
        changed = true;
        for (const f of byTree[i]) {
          if (f.g < FROND_LOW - 1) fMesh.setGeometryIdAt(f.id, isFar ? FROND_LOW + f.g : f.g);
          fMesh.setVisibleAt(f.id, !isFar || f.keep);
        }
      });
      return changed;
    });
  }
  // (crowns only grazed by a 7 deg sun; their own shadow on each other only blackened them)
  fMesh.receiveShadow = false;
  group.add(tMesh, fMesh, ...groundMesh(PALM_TREES));
  window.__palmTrees = PALM_TREES;
  scene.add(group);

  window.__palmStats = { trees: PALM_TREES.length, fronds: frondInst.length, trunks: trunkInst.length, clusters: PALM_CLUSTERS.length };
  return {
    group,
    update(time) { WIND.value = time; },
  };
}
