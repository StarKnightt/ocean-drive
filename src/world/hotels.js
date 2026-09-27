// System 2: the Art Deco hotel row along Ocean Drive (west side, facades at x ~ -30).
// Every building is assembled procedurally from a seeded spec: stucco volumes with
// rounded corners, eyebrow sunshades, central pylons / fins / bays, stepped parapets,
// speed lines, recessed windows (instanced glass that reflects the analytic sky),
// porches, cafe patios and invented neon-letter signs. Static geometry is merged per
// material and per street chunk; windows, reveals and furniture are instanced.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { HOTEL, BLOCK, CURB_HEIGHT, SIDEWALK_W, CROSS, CROSS_STREETS, DISTRICT } from './layout.js';
import { registerLod } from './lod.js';
import { mulberry32, noiseColorTexture, noiseNormalTexture } from '../textures/noise.js';
import { QUALITY } from '../quality.js';

const G = CURB_HEIGHT;          // sidewalk level, where the buildings stand
const PATIO_X = HOTEL.patioX;   // porches come forward to here
const UP = [0, 1, 0];

// ---------------------------------------------------------------------------
// small vector helpers on [x, y, z] arrays
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const neg = (a) => [-a[0], -a[1], -a[2]];

// ---------------------------------------------------------------------------
// Geometry accumulator: non-indexed triangles with normal, colour, uv (metres) and a
// per-vertex weathering record (first upper-floor height, floor height, amount).
class Buf {
  constructor() {
    this.pos = []; this.nrm = []; this.col = []; this.uv = []; this.aw = []; this.ae = []; this.ab = [];
    this.c = [1, 1, 1];
    this.w = [0, 3, 0];
    this.e = [0, 0, 0];  // eyebrow height above each floor line (0 = none), top eyebrow row, coping
    this.b = [1, 1, 1, 0]; // paint band colour + mode (1: window strips, 2: spandrels between them)
  }
  band(hex, mode) { const c = new THREE.Color(hex); this.b = [c.r, c.g, c.b, mode]; return this; }
  color(hex) { const c = new THREE.Color(hex); this.c = [c.r, c.g, c.b]; return this; }
  v(p, n, uv) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.col.push(this.c[0], this.c[1], this.c[2]);
    if (uv) this.uv.push(uv[0], uv[1]);
    else if (Math.abs(n[1]) > 0.7) this.uv.push(p[0], p[2]);
    else if (Math.abs(n[0]) >= Math.abs(n[2])) this.uv.push(-p[2], p[1]);
    else this.uv.push(p[0], p[1]);
    this.aw.push(this.w[0], this.w[1], this.w[2]);
    this.ae.push(this.e[0], this.e[1], this.e[2]);
    this.ab.push(this.b[0], this.b[1], this.b[2], this.b[3]);
  }
  tri(a, b, c, na, nb, nc) { this.v(a, na); this.v(b, nb); this.v(c, nc); }
  quad(a, b, c, d, na, nb = na, nc = na, nd = na) {
    const fn = cross(sub(b, a), sub(c, a));
    if (dot(fn, add(add(na, nb), nc)) < 0) { this.tri(a, c, b, na, nc, nb); this.tri(a, d, c, na, nd, nc); }
    else { this.tri(a, b, c, na, nb, nc); this.tri(a, c, d, na, nc, nd); }
  }
  quadUV(a, b, c, d, n, ua, ub, uc, ud) {
    const fn = cross(sub(b, a), sub(c, a));
    if (dot(fn, n) < 0) { this.v(a, n, ua); this.v(c, n, uc); this.v(b, n, ub); this.v(a, n, ua); this.v(d, n, ud); this.v(c, n, uc); }
    else { this.v(a, n, ua); this.v(b, n, ub); this.v(c, n, uc); this.v(a, n, ua); this.v(c, n, uc); this.v(d, n, ud); }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aW', new THREE.Float32BufferAttribute(this.aw, 3));
    g.setAttribute('aE', new THREE.Float32BufferAttribute(this.ae, 3));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(this.ab, 4));
    g.computeBoundingSphere();
    // the plain arrays cost ~8x the Float32 copies and closures in buildHotels keep every
    // Buf alive, so drop them once copied
    this.count = this.pos.length / 3;
    this.pos = []; this.nrm = []; this.col = []; this.uv = []; this.aw = []; this.ae = []; this.ab = [];
    return g;
  }
  get empty() { return this.pos.length === 0; }
}

const WF = { o: [0, 0, 0], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const P = (F, x, y, z) => [
  F.o[0] + F.X[0] * x + F.Y[0] * y + F.Z[0] * z,
  F.o[1] + F.X[1] * x + F.Y[1] * y + F.Z[1] * z,
  F.o[2] + F.X[2] * x + F.Y[2] * y + F.Z[2] * z,
];

// Box in a local frame F (origin + orthonormal axes). skip: set of '+x','-x',...
function lbox(b, F, x0, x1, y0, y1, z0, z1, skip) {
  const s = skip || {};
  if (!s['+x']) b.quad(P(F, x1, y0, z0), P(F, x1, y1, z0), P(F, x1, y1, z1), P(F, x1, y0, z1), F.X);
  if (!s['-x']) b.quad(P(F, x0, y0, z0), P(F, x0, y1, z0), P(F, x0, y1, z1), P(F, x0, y0, z1), neg(F.X));
  if (!s['+y']) b.quad(P(F, x0, y1, z0), P(F, x1, y1, z0), P(F, x1, y1, z1), P(F, x0, y1, z1), F.Y);
  if (!s['-y']) b.quad(P(F, x0, y0, z0), P(F, x1, y0, z0), P(F, x1, y0, z1), P(F, x0, y0, z1), neg(F.Y));
  if (!s['+z']) b.quad(P(F, x0, y0, z1), P(F, x1, y0, z1), P(F, x1, y1, z1), P(F, x0, y1, z1), F.Z);
  if (!s['-z']) b.quad(P(F, x0, y0, z0), P(F, x1, y0, z0), P(F, x1, y1, z0), P(F, x0, y1, z0), neg(F.Z));
}
const box = (b, x0, x1, y0, y1, z0, z1, skip) => lbox(b, WF, x0, x1, y0, y1, z0, z1, skip);

// Cylinder (or part of one) from p0 to p1; angle 0 points along `ref`.
function cyl(b, p0, p1, r, seg, ref, a0 = 0, a1 = Math.PI * 2, caps = false) {
  const A = norm(sub(p1, p0));
  const B = norm(sub(ref, scl(A, dot(ref, A))));
  const C = cross(A, B);
  let prev = null;
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    const d = add(scl(B, Math.cos(a)), scl(C, Math.sin(a)));
    const q0 = add(p0, scl(d, r)), q1 = add(p1, scl(d, r));
    if (prev) {
      b.quad(prev.q0, q0, q1, prev.q1, prev.d, d, d, prev.d);
      if (caps) {
        b.tri(p0, prev.q0, q0, neg(A), neg(A), neg(A));
        b.tri(p1, q1, prev.q1, A, A, A);
      }
    }
    prev = { q0, q1, d };
  }
}

// Vertical wall on a circular arc in the xz plane; angle a -> (cos a, sin a) in (x, z).
function arcWall(b, cx, cz, r, a0, a1, y0, y1, seg) {
  for (let i = 0; i < seg; i++) {
    const aa = a0 + ((a1 - a0) * i) / seg, ab = a0 + ((a1 - a0) * (i + 1)) / seg;
    const na = [Math.cos(aa), 0, Math.sin(aa)], nb = [Math.cos(ab), 0, Math.sin(ab)];
    const pa = [cx + r * na[0], 0, cz + r * na[2]], pb = [cx + r * nb[0], 0, cz + r * nb[2]];
    b.quad([pa[0], y0, pa[2]], [pb[0], y0, pb[2]], [pb[0], y1, pb[2]], [pa[0], y1, pa[2]], na, nb, nb, na);
  }
}

// Flat wall in the plane through o with normal N, u along R = up x N, v = world y.
// holes: [{ u, v, w, h }] or [{ u, v, r, round: true }].
function planarWall(b, o, N, u0, u1, v0, v1, holes) {
  const R = cross(UP, N);
  const shape = new THREE.Shape([
    new THREE.Vector2(u0, v0), new THREE.Vector2(u1, v0), new THREE.Vector2(u1, v1), new THREE.Vector2(u0, v1),
  ]);
  for (const h of holes) {
    const p = new THREE.Path();
    if (h.round) p.absarc(h.u, h.v, h.r, 0, Math.PI * 2, true);
    else {
      p.moveTo(h.u - h.w / 2, h.v - h.h / 2);
      p.lineTo(h.u - h.w / 2, h.v + h.h / 2);
      p.lineTo(h.u + h.w / 2, h.v + h.h / 2);
      p.lineTo(h.u + h.w / 2, h.v - h.h / 2);
    }
    shape.holes.push(p);
  }
  const g = new THREE.ShapeGeometry(shape, 16).toNonIndexed();
  const pa = g.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const u = pa.getX(i), v = pa.getY(i);
    b.v([o[0] + R[0] * u, v, o[2] + R[2] * u], N);
  }
  g.dispose();
}

// Point list along a facade outline: rounded corners (radius r0 at z0, r1 at z1) and
// the straight front at x = fx, clipped to [zFrom, zTo]; each point carries its normal.
function outline(fx, z0, z1, r0, r1, zFrom = -Infinity, zTo = Infinity, seg = 10) {
  const pts = [];
  const push = (x, z, nx, nz) => {
    const l = pts[pts.length - 1];
    if (l && Math.hypot(l.x - x, l.z - z) < 1e-4) return;
    pts.push({ x, z, n: [nx, 0, nz] });
  };
  if (r0 > 0 && zFrom <= z0 + 1e-3) {
    for (let i = 0; i <= seg; i++) {
      const a = -Math.PI / 2 + (Math.PI / 2) * (i / seg);
      push(fx - r0 + r0 * Math.cos(a), z0 + r0 + r0 * Math.sin(a), Math.cos(a), Math.sin(a));
    }
  }
  const za = Math.max(zFrom, z0 + r0), zb = Math.min(zTo, z1 - r1);
  if (zb > za) { push(fx, za, 1, 0); push(fx, zb, 1, 0); }
  if (r1 > 0 && zTo >= z1 - 1e-3) {
    for (let i = 0; i <= seg; i++) {
      const a = (Math.PI / 2) * (i / seg);
      push(fx - r1 + r1 * Math.cos(a), z1 - r1 + r1 * Math.sin(a), Math.cos(a), Math.sin(a));
    }
  }
  return pts;
}

// Solid strip along an outline: projects `out` metres from the wall between y0 and y1.
// Used for eyebrow sunshades, copings, racing stripes, speed lines and plinths.
function ribbon(b, pts, y0, y1, out, caps = true, under = null) {
  if (pts.length < 2) return;
  const inset = 0.03;
  const A = pts.map((p) => [p.x - p.n[0] * inset, 0, p.z - p.n[2] * inset]);
  const B = pts.map((p) => [p.x + p.n[0] * out, 0, p.z + p.n[2] * out]);
  const Y = (p, y) => [p[0], y, p[2]];
  const top = b.c;
  for (let i = 0; i < pts.length - 1; i++) {
    const n0 = pts[i].n, n1 = pts[i + 1].n;
    b.quad(Y(B[i], y0), Y(B[i + 1], y0), Y(B[i + 1], y1), Y(B[i], y1), n0, n1, n1, n0);
    b.quad(Y(A[i], y1), Y(B[i], y1), Y(B[i + 1], y1), Y(A[i + 1], y1), UP);
    if (under !== null) b.color(under);
    b.quad(Y(A[i], y0), Y(B[i], y0), Y(B[i + 1], y0), Y(A[i + 1], y0), [0, -1, 0]);
    b.c = top;
  }
  if (caps) {
    const k = pts.length - 1;
    const t0 = norm(sub([pts[0].x, 0, pts[0].z], [pts[1].x, 0, pts[1].z]));
    const t1 = norm(sub([pts[k].x, 0, pts[k].z], [pts[k - 1].x, 0, pts[k - 1].z]));
    b.quad(Y(A[0], y0), Y(B[0], y0), Y(B[0], y1), Y(A[0], y1), t0);
    b.quad(Y(A[k], y0), Y(B[k], y0), Y(B[k], y1), Y(A[k], y1), t1);
  }
}

function pushGeometry(b, geo, matrix) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(matrix);
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) b.v([p.getX(i), p.getY(i), p.getZ(i)], [n.getX(i), n.getY(i), n.getZ(i)]);
  g.dispose();
}

// ---------------------------------------------------------------------------
// Palette: realistic pastel albedos (sRGB). Ocean Drive reads mostly white and cream
// with pastel bodies here and there and stronger pastel trim.
const COL = {
  white: 0xe9e8e3, warmWhite: 0xe8e3d8, cream: 0xe8dcc4, pink: 0xeccad0, blush: 0xe8c6c2,
  mint: 0xc4e3d3, seafoam: 0xb6dfd2, aquaBody: 0xbfe0e0, lemon: 0xefe4b4, lavender: 0xd6cce6,
  peach: 0xefd0bc, powder: 0xc6dbe8,
  teal: 0x4fa79f, aqua: 0x7cc7c4, coral: 0xe0938d, rose: 0xe09aae, seagreen: 0x7fc2a3,
  butter: 0xefe0a4, lilac: 0xb3a2d4, sky: 0x86b6d6, salmon: 0xe6a58e, sand: 0xd9c9a8,
  stoneGrey: 0xcfcec6, mintDeep: 0x80d4d8, pinkDeep: 0xe6a3b3,
};
const SCHEMES = [
  { body: COL.white, trim: COL.teal, accent: COL.rose },
  { body: COL.white, trim: COL.aqua, accent: COL.pinkDeep },
  { body: COL.pink, trim: COL.white, accent: COL.coral },
  { body: COL.mint, trim: COL.white, accent: COL.teal },
  { body: COL.lemon, trim: COL.white, accent: COL.aqua },
  { body: COL.lavender, trim: COL.white, accent: COL.lilac },
  { body: COL.cream, trim: COL.teal, accent: COL.coral },
  { body: COL.warmWhite, trim: COL.rose, accent: COL.seagreen },
  { body: COL.powder, trim: COL.white, accent: COL.sky },
  { body: COL.white, trim: COL.seagreen, accent: COL.salmon },
  { body: COL.seafoam, trim: COL.white, accent: COL.teal },
  { body: COL.white, trim: COL.coral, accent: COL.mintDeep },
  { body: COL.aquaBody, trim: COL.white, accent: COL.rose },
  { body: COL.white, trim: COL.lilac, accent: COL.aqua },
  { body: COL.blush, trim: COL.white, accent: COL.seagreen },
];
// white / silver / anodised aluminium; the odd dark bronze or teal frame
const FRAME_COLS = [0xf0f0ec, 0xf0f0ec, 0xe6e7e4, 0xc4c8c9, 0xb3b8ba, 0xf0f0ec, 0x5a5550, 0x5f9d96];
const CURTAINS = [0xe8e0cf, 0xf2efe6, 0xd9cbb0, 0xc9dcd8, 0xe9cfc9, 0xd8d0c0, 0xb8c9d4];
const UMBRELLA_COLS = [0xf1efe9, 0xece6d6, 0x2f8f7f, 0xd9477a, 0xf1efe9, 0x2d6f9f, 0xe9e2d0, 0xc9343e, 0x3f8a5a, 0xf2ede2];
const AWNING_COLS = [0x2e7fa8, 0x2f8f7f, 0xd24a74, 0x3d7d4e, 0xe0a33a, 0x7a4f9a, 0xcf5a3c];

// Invented names only.
const NAMES = [
  'CORALINE', 'SEAGROVE', 'BELLA MAR', 'ORCHIDEA', 'MARISOL', 'ORIANA', 'MARINELLA', 'SOLANA',
  'DUNEHAVEN', 'VISTAMAR', 'LA PERLITA', 'HALLORAN', 'ROSALIND', 'FAIRHOLM', 'CALYPSO', 'WYNDMERE',
  'MARBELLE', 'ISLA VERDE', 'COQUINA', 'PALOMA', 'LUNA MAR', 'ASHBY', 'HELIOS', 'SEAFOAM',
  'BRIARCLIFF', 'MONTCLAIRE', 'ALDEMAR', 'NEREIDA', 'SUNHAVEN', 'CORAL BAY', 'MAREVISTA', 'LINDEN',
];
// more invented names for the extended district
const MORE_NAMES = [
  'SOLMARE', 'AZULEJO', 'BAHIA LUZ', 'VERANDINE', 'CORALETTE', 'MAREA', 'ESTRELLITA', 'LAGUNITA',
  'PERLAMAR', 'SEABRIGHT', 'BRISA', 'MAR AZUL', 'GLENWOOD', 'LINDAMAR', 'CALLOWAY', 'ALMIRA',
  'VISTA SOL', 'COSTA LUNA', 'AURELIA', 'LUMARA', 'BAYBERRY', 'MARIGOLD', 'PALMETTE', 'CORINNA',
  'BELLWOOD', 'LA GAVIOTA', 'ROSEMERE', 'FLORAMAR', 'OCEANETTE', 'SUNMERE', 'ALBA MAR', 'NOVAMAR',
  'AMBERLY', 'KESTREL',
];

// ---------------------------------------------------------------------------
// Sign atlas: painted metal letters with thin neon tubes (faint at sunrise).
class SignAtlas {
  constructor(W = 4096, H = 4096) {
    this.W = W; this.H = H;
    this.cv = document.createElement('canvas'); this.cv.width = W; this.cv.height = H;
    this.ev = document.createElement('canvas'); this.ev.width = W; this.ev.height = H;
    this.ctx = this.cv.getContext('2d'); this.ectx = this.ev.getContext('2d');
    this.ectx.fillStyle = '#000'; this.ectx.fillRect(0, 0, W, H);
    // horizontal signs pack in shelves on the left, vertical columns on the right
    this.VX = W - 1500;
    this.hp = { x: 4, y: 4, rowH: 0, x0: 4, x1: this.VX - 4 };
    this.vp = { x: this.VX, y: 4, rowH: 0, x0: this.VX, x1: W - 4 };
  }
  alloc(w, h, vertical = false) {
    const s = vertical ? this.vp : this.hp;
    if (s.x + w > s.x1) { s.x = s.x0; s.y += s.rowH + 24; s.rowH = 0; }
    if (s.y + h > this.H - 4) { this.miss = (this.miss ?? 0) + 1; return null; }
    const r = { x: s.x, y: s.y, w, h };
    s.x += w + 24; s.rowH = Math.max(s.rowH, h);
    return r;
  }
  uv(r) { return [r.x / this.W, 1 - (r.y + r.h) / this.H, (r.x + r.w) / this.W, 1 - r.y / this.H]; }
  font(px, style) {
    return style === 'script'
      ? `italic bold ${px}px "Segoe Script", "Brush Script MT", "Century Gothic", sans-serif`
      : style === 'condensed'
        ? `bold ${px}px "Bahnschrift SemiBold Condensed", "Bahnschrift", "Arial Narrow", sans-serif`
        : `bold ${px}px "Century Gothic", "Futura", "Avenir", "Bahnschrift", "Segoe UI", sans-serif`;
  }
  letter(ctx, ectx, ch, x, y, px, st) {
    ctx.font = ectx.font = this.font(px, st.font);
    ctx.textAlign = ectx.textAlign = 'center';
    ctx.textBaseline = ectx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // return edge of the channel letter (reads as depth), then the painted face,
    // thickened so strokes survive mip filtering at 80 m
    ctx.fillStyle = ctx.strokeStyle = st.edge;
    ctx.lineWidth = px * 0.09;
    ctx.fillText(ch, x + px * 0.04, y + px * 0.05);
    ctx.strokeText(ch, x + px * 0.04, y + px * 0.05);
    ctx.fillStyle = ctx.strokeStyle = st.fill;
    ctx.lineWidth = px * 0.07;
    ctx.fillText(ch, x, y);
    ctx.strokeText(ch, x, y);
    // neon tube (unlit at sunrise): only a faint emissive trace
    ectx.lineWidth = Math.max(2, px * 0.02);
    ectx.strokeStyle = st.tube;
    ectx.save();
    ectx.translate(x, y); ectx.scale(0.86, 0.86);
    ectx.strokeText(ch, 0, 0);
    ectx.restore();
  }
  clip(r, fn) {
    for (const c of [this.ctx, this.ectx]) { c.save(); c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip(); }
    fn();
    this.ctx.restore(); this.ectx.restore();
  }
  horizontal(text, st, px = 150) {
    px *= this.scale ?? 1;
    const key = `${text}|${st.fill}|${st.font}|${st.tube}`;
    this.cache ??= new Map();
    if (this.cache.has(key)) return this.cache.get(key);
    const r = this.horizontal0(text, st, px);
    this.cache.set(key, r);
    return r;
  }
  horizontal0(text, st, px) {
    this.ctx.font = this.font(px, st.font);
    const sp = px * (st.font === 'script' ? 0.02 : 0.16);
    const ws = [...text].map((ch) => this.ctx.measureText(ch).width);
    const total = ws.reduce((a, b) => a + b, 0) + sp * (ws.length - 1);
    const r = this.alloc(Math.ceil(total + px * 0.4), Math.ceil(px * 1.45));
    if (!r) return null;
    let x = r.x + px * 0.2;
    this.clip(r, () => [...text].forEach((ch, i) => {
      if (ch !== ' ') this.letter(this.ctx, this.ectx, ch, x + ws[i] / 2, r.y + r.h / 2, px, st);
      x += ws[i] + sp;
    }));
    return { uv: this.uv(r), aspect: r.w / r.h };
  }
  vertical(text, st0, px = 130) {
    px *= this.scale ?? 1;
    // upright letters stacked top to bottom (never rotated text); script does not stack
    const st = st0.font === 'script' ? { ...st0, font: 'geo' } : st0;
    const chars = [...text.replace(/ /g, '')];
    const cell = px * 1.12;
    this.ctx.font = this.font(px, st.font);
    const wMax = Math.max(...chars.map((ch) => this.ctx.measureText(ch).width));
    const r = this.alloc(Math.ceil(Math.max(px * 1.25, wMax + px * 0.3)), Math.ceil(cell * chars.length + px * 0.25), true);
    if (!r) return null;
    this.clip(r, () => chars.forEach((ch, i) => this.letter(this.ctx, this.ectx, ch, r.x + r.w / 2, r.y + px * 0.12 + cell * (i + 0.5), px, st)));
    return { uv: this.uv(r), aspect: r.w / r.h, n: chars.length };
  }
  textures() {
    // Upload only the rows the shelves used (the atlas fills from the top), the faint neon
    // layer at half resolution and, on lower tiers, a downscaled copy; the full-size
    // canvases are freed. The UVs were laid out for the full atlas, so the textures remap
    // v -> 1 - (1 - v) * H / usedH.
    const s = QUALITY.signAtlas;
    const usedH = Math.min(this.H, 4 * Math.ceil((Math.max(this.hp.y + this.hp.rowH, this.vp.y + this.vp.rowH) + 8) / 4));
    const shrink = (src, f) => {
      if (f === 1 && usedH === this.H) return src;
      const c = document.createElement('canvas');
      c.width = Math.round(this.W * f); c.height = Math.round(usedH * f);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, this.W, usedH, 0, 0, c.width, c.height);
      src.width = src.height = 1;
      return c;
    };
    this.cv = shrink(this.cv, s); this.ev = shrink(this.ev, s * 0.5);
    const k = this.H / usedH;
    const make = (cv) => {
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.repeat.set(1, k);
      t.offset.set(0, 1 - k);
      return t;
    };
    const map = make(this.cv);
    map.anisotropy = 8;
    const em = make(this.ev);
    return { map, em };
  }
}

// Plane of letters standing just off a wall (normal N), centred at c.
function signQuad(b, c, N, w, h, uv) {
  c = add(c, scl(N, 0.06));   // channel letters stand on stand-offs, clear of the wall
  const R = norm(cross(UP, N));
  const hw = scl(R, w / 2), hh = [0, h / 2, 0];
  const p = (sx, sy) => add(add(c, scl(hw, sx)), scl(hh, sy));
  b.quadUV(p(-1, -1), p(1, -1), p(1, 1), p(-1, 1), N,
    [uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]);
}

// ---------------------------------------------------------------------------
// Building spec
function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length) % arr.length]; }

function makeSpec(rnd, z0, z1, o = {}) {
  const floors = o.floors ?? pick(rnd, [2, 2, 3, 3, 4, 4, 5, 6, 7]);
  const gH = 3.9 + rnd() * 0.5;
  const fh = 3.0 + rnd() * 0.3;
  const H = G + gH + (floors - 1) * fh;
  const scheme = o.scheme ?? pick(rnd, SCHEMES);
  const setback = o.setback ?? (rnd() < 0.6 ? 0 : 0.5 + rnd() * 1.5);
  const style = o.style ?? pick(rnd, ['pylon', 'fin', 'bay', 'ziggurat', 'band', 'plain', 'corner', 'twin', 'tower', 'fin', 'pylon', 'twin']);
  const ww = pick(rnd, [0.9, 1.05, 1.2, 1.35, 1.5]);
  const r1d = style === 'corner' ? 2.6 + rnd() * 1.2 : (rnd() < 0.22 ? 1.4 + rnd() * 1.4 : 0);
  const winLayout = o.winLayout ?? (style === 'ziggurat' ? 'ribbon' : pick(rnd, ['punched', 'triple', 'ribbon', 'pair', 'triple', 'punched']));
  const whiteBody = isWhite(scheme.body) || scheme.body === COL.cream;
  const band = o.band ?? (whiteBody
    ? { col: isWhite(scheme.trim) ? scheme.accent : lighten(scheme.trim, 0.35), mode: rnd() < 0.5 ? 1 : 2 }
    : { col: COL.white, mode: rnd() < 0.6 ? 2 : 1 });
  return {
    z0, z1, floors, gH, fh, H, ph: o.ph ?? (0.7 + rnd() * 1.1), scheme, style, band, winLayout,
    fx: HOTEL.frontX - setback,
    r0: o.r0 ?? (rnd() < 0.22 ? 1.4 + rnd() * 1.4 : 0),
    r1: o.r1 ?? r1d,
    ww, pier: 0.6 + rnd() * 0.9, paired: winLayout === 'pair', ribbonWin: winLayout === 'ribbon',
    winH: o.winH ?? (1.35 + rnd() * 0.3), paneW: 0.75 + rnd() * 0.35,
    eyebrow: o.eyebrow ?? pick(rnd, ['full', 'window', 'window', 'band']), eyeOut: o.eyeOut ?? (0.6 + rnd() * 0.35), eyeT: 0.15 + rnd() * 0.05,
    eyeCol: o.eyeCol ?? pick(rnd, ['white', 'white', 'body', 'trim']),
    frame: o.frame ?? pick(rnd, FRAME_COLS), frameStyle: pick(rnd, ['h3', 'cross', 'grid', 'h3', 'cross', 'plain', 'plain']),
    canopy: o.canopy ?? pick(rnd, ['full', 'entrance', 'entrance', 'awning', 'none']),
    porch: o.porch ?? rnd() < 0.8,
    patio: o.patio ?? pick(rnd, ['umbrella', 'tent', 'awning', 'canopy', 'umbrella', 'porch']),
    umbrellaCol: o.umbrellaCol ?? pick(rnd, UMBRELLA_COLS), canopyCol: o.canopyCol ?? pick(rnd, [0x3f9a5e, 0x3d9ad6, 0xd9668c, 0x2f8f7f]), canopyAlt: o.canopyAlt, signTop: o.signTop, signBottom: o.signBottom,
    rail: o.rail ?? pick(rnd, ['wall', 'pipe', 'wall', 'pipe']),
    portholes: o.portholes ?? rnd() < 0.45, glassBlock: rnd() < 0.5, medallions: o.medallions ?? rnd() < 0.45,
    fountain: o.fountain ?? rnd() < 0.55,          // "frozen fountain" relief over the entrance
    fins: o.fins ?? (style === 'band' || style === 'plain' || style === 'twin' ? rnd() < 0.6 : false),
    parapetStep: o.parapetStep ?? (style !== 'ziggurat' && style !== 'tower' && rnd() < 0.75),
    finial: o.finial ?? rnd() < 0.6,
    roof: o.roof ?? pick(rnd, ['tank', 'ac', 'sign', 'ac', 'tank', 'none']),
    ac: rnd() < 0.7,
    name: o.name, signFont: pick(rnd, ['geo', 'geo', 'condensed', 'script']),
    noSidewalk: !!o.noSidewalk, awningColor: o.awningColor, exposed: o.exposed ?? [false, false],
    detail: o.detail ?? 1,
    seed: Math.floor(rnd() * 1e9),
  };
}

// ---------------------------------------------------------------------------
// Window records -> wall holes + instances.
function windowRecord(ctx, wall, u, v, w, h, o = {}) {
  const hole = o.round ? { u, v, r: w / 2, round: true } : { u, v, w, h };
  wall.holes.push(hole);
  const R = cross(UP, wall.N);
  const c = [wall.o[0] + R[0] * u, v, wall.o[2] + R[2] * u];
  ctx.windows.push({
    c, N: wall.N, w, h: o.round ? w : h, depth: o.depth ?? 0.3, round: !!o.round,
    kind: o.kind ?? 'win', interior: o.interior, reveal: wall.color, collar: o.collar ?? ctx.collar, frame: o.frame ?? ctx.frame, frameStyle: o.frameStyle ?? ctx.frameStyle,
    panes: o.panes ?? 1, surround: o.surround ?? ctx.surround, sill: o.sill ?? true,
  });
}

function interiorFor(rnd, kind) {
  if (kind === 'lobby') return [6, 0, rnd(), rnd()];
  if (kind === 'store') return [rnd() < 0.5 ? 6 : 2, 0.3 + rnd() * 0.3, rnd(), rnd()];
  // mostly plain reflective panes; blinds / curtains here and there, the odd one open
  const r = rnd();
  if (r < 0.46) return [0, rnd(), rnd(), rnd()];
  if (r < 0.62) return [1, 0.1 + rnd() * 0.8, rnd(), rnd()];
  if (r < 0.8) return [2, 0.2 + rnd() * 0.6, rnd(), rnd()];
  if (r < 0.94) return [3, 0.4 + rnd() * 0.5, rnd(), rnd()];
  return [7, 0, rnd(), rnd()];
}

// Evenly spaced window centres in [za, zb].
function spread(za, zb, unit, pier) {
  const L = zb - za;
  const n = Math.floor((L + pier) / (unit + pier));
  if (n <= 0) return [];
  const gap = (L - n * unit) / (n + 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(za + gap * (i + 1) + unit * i + unit / 2);
  return out;
}

// ---------------------------------------------------------------------------
const lighten = (hex, t) => new THREE.Color(hex).lerp(new THREE.Color(0xffffff), t).getHex();
const darken = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();
const isWhite = (hex) => { const c = new THREE.Color(hex); return Math.min(c.r, c.g, c.b) > 0.85; };

// Grime decal on a wall: a streaky alpha quad hanging down from `c` (top centre).
function grime(b, c, N, w, h, strength, rnd) {
  const R = norm(cross(UP, N));
  const o = add(c, scl(N, 0.012));
  const hw = scl(R, w / 2);
  const u0 = rnd() * 0.75, u1 = u0 + 0.12 + rnd() * 0.13;
  const vTop = rnd() < 0.5 ? 1.0 : 0.5;          // two streak families in the atlas
  b.c = [strength, rnd(), rnd()];                 // g: dirt kind (soot / rust / algae), b: warmth
  const p = (s, y) => add(add(o, scl(hw, s)), [0, y, 0]);
  b.quadUV(p(-1, -h), p(1, -h), p(1, 0), p(-1, 0), N, [u0, vTop - 0.5], [u1, vTop - 0.5], [u1, vTop], [u0, vTop]);
}

// Segments of [a, b] left after removing the (sorted, merged) exclusion intervals.
function segmentsOf(a, b, excl) {
  const out = [];
  let s = a;
  for (const [ea, eb] of excl) {
    if (eb <= s) continue;
    if (ea >= b) break;
    if (ea > s) out.push([s, Math.min(ea, b)]);
    s = Math.max(s, eb);
  }
  if (b > s) out.push([s, b]);
  return out;
}

function buildHotel(S, B, ctx, atlas) {
  const rnd = mulberry32(S.seed);
  const { z0, z1, fx, gH, fh, H, ph, floors } = S;
  const zc = (z0 + z1) / 2, W = z1 - z0;
  const top = H + ph;
  const back = HOTEL.backX;
  const { body, trim, accent } = S.scheme;
  const paint = B.paint, metal = B.metal;
  const detail = S.detail > 0;
  ctx.frame = S.frame;
  ctx.frameStyle = S.frameStyle;
  ctx.collar = isWhite(trim) ? (isWhite(accent) ? COL.stoneGrey : accent) : trim;
  const winH = Math.min(S.winH, fh - 1.4);
  const sill = 0.8;
  const eyeOff = sill + winH + 0.1;                     // eyebrow underside above each floor line
  const whiteBody = isWhite(body) || body === COL.cream;
  const bandCol = S.band.col;
  // white hotels carry pastel eyebrows (ref03 pink slabs), pastel hotels white ones
  const eyeCol = whiteBody ? (S.eyeCol === 'trim' && !isWhite(trim) ? trim : (isWhite(bandCol) ? trim : bandCol)) : COL.white;
  const eyeUnder = whiteBody ? darken(eyeCol, 0.97) : lighten(body, 0.55);
  ctx.surround = whiteBody ? (isWhite(trim) ? bandCol : trim) : COL.white;
  const Y0 = G + gH;                                    // first upper floor line
  const lastEye = Y0 + (floors - 2) * fh + eyeOff;
  paint.w = [Y0, fh, 1];
  paint.e = [0, 0, 0];

  // ---- facade planning -------------------------------------------------------
  const r0 = Math.min(S.r0, W * 0.22), r1 = Math.min(S.r1, W * 0.22);
  let cw = 0;
  if (S.style === 'pylon') cw = 2.4 + rnd() * 0.6;
  else if (S.style === 'fin') cw = 1.0;
  else if (S.style === 'bay') cw = Math.min(W * 0.42, 5.5 + rnd() * 1.5);
  else if (S.style === 'ziggurat') cw = 3.0;
  else if (S.style === 'tower') cw = Math.min(W * 0.3, 3.4 + rnd() * 1.0);
  else if (S.style === 'twin') cw = 1.5;
  const bays = [];
  if (S.style === 'bay') bays.push([zc - cw / 2, zc + cw / 2, true]);
  if (S.style === 'twin') {
    const bw = Math.min(W * 0.24, 3.8 + rnd() * 1.2);
    for (const s of [-1, 1]) { const c = zc + s * W * 0.26; bays.push([c - bw / 2, c + bw / 2, false]); }
  }
  const front = { o: [fx, 0, 0], N: [1, 0, 0], holes: [], color: body };  // u = -z
  const zf0 = z0 + r0 + (r0 > 0 ? 0.7 : 0.9), zf1 = z1 - r1 - (r1 > 0 ? 0.7 : 0.9);
  const excl = [];
  if (cw > 0 && S.style !== 'bay') excl.push([zc - cw / 2 - 0.45, zc + cw / 2 + 0.45]);
  for (const [a, b] of bays) excl.push([a - 0.4, b + 0.4]);
  excl.sort((p, q) => p[0] - q[0]);
  const segs = segmentsOf(zf0, zf1, excl);
  const triple = S.winLayout === 'triple';
  const unit = S.paired ? S.ww * 2 + 0.22 : triple ? S.paneW * 3 : S.ww;
  const pier = triple ? 0.9 + S.pier * 0.6 : S.pier;
  const upperCols = [];
  const colW = new Map();   // z -> { w, n }: opening width and pane count
  for (const [a, b] of segs) {
    if (S.ribbonWin) {
      // continuous ribbon glazing, broken by a pier every ~7 m
      const L = b - a;
      if (L < 1.4) continue;
      const k = Math.ceil((L - 0.4) / 7.5), sub = (L - 0.4 - 0.8 * (k - 1)) / k;
      for (let i = 0; i < k; i++) {
        const n = Math.max(1, Math.round(sub / S.paneW));
        const z = a + 0.2 + sub / 2 + i * (sub + 0.8);
        upperCols.push(z); colW.set(z, { w: sub, n });
      }
    } else {
      for (const z of spread(a, b, unit, pier)) { upperCols.push(z); colW.set(z, { w: unit, n: triple ? 3 : 1 }); }
    }
  }
  upperCols.sort((p, q) => p - q);

  // porthole columns: flanking the central element, else the outermost columns
  const portCols = new Map();   // z -> lowest floor index with portholes
  if (S.portholes && upperCols.length >= 2 && !S.ribbonWin) {
    if (cw > 0 && S.style !== 'bay' && S.style !== 'twin') {
      const l = upperCols.filter((z) => z < zc), r = upperCols.filter((z) => z > zc);
      if (l.length && r.length) { portCols.set(l[l.length - 1], 1); portCols.set(r[0], 1); }
    } else {
      portCols.set(upperCols[0], Math.max(1, floors - 2));
      portCols.set(upperCols[upperCols.length - 1], Math.max(1, floors - 2));
    }
  }

  const acUnits = [];
  const upperWin = (wall, u, yc, w, f, o = {}) => {
    windowRecord(ctx, wall, u, yc, w, winH, { interior: interiorFor(rnd, 'win'), depth: 0.34, ...o });
    if (detail && S.ac && rnd() < 0.2 && w < 1.8) acUnits.push({ wall, u, y: yc - winH / 2 - 0.08 });
    else if (detail && rnd() < 0.16) {
      // run off one sill corner or the middle, varied width, length and strength
      const Rv = cross(UP, wall.N);
      const uu = u + (rnd() - 0.5) * w * 0.7;
      const c = [wall.o[0] + Rv[0] * uu, yc - winH / 2 - 0.08, wall.o[2] + Rv[2] * uu];
      grime(B.grime, c, wall.N, w * (0.2 + rnd() * 0.6), 0.3 + rnd() * rnd() * 2.2, 0.12 + rnd() * 0.35, rnd);
    }
  };
  const eyebrowYs = [];
  for (let f = 1; f < floors; f++) {
    const y0 = Y0 + (f - 1) * fh;
    const yc = y0 + sill + winH / 2;
    eyebrowYs.push(y0 + eyeOff);
    for (const zcol of upperCols) {
      if (portCols.has(zcol) && f >= portCols.get(zcol)) {
        windowRecord(ctx, front, -zcol, yc + 0.05, 0.86, 0.86, { round: true, depth: 0.28, interior: [0, rnd(), rnd(), rnd()] });
        continue;
      }
      const cwd = colW.get(zcol);
      if (S.paired) {
        for (const s of [-1, 1]) upperWin(front, -(zcol + s * (S.ww / 2 + 0.11)), yc, S.ww, f);
      } else if (cwd.n > 1) {
        upperWin(front, -zcol, yc, cwd.w, f, { panes: cwd.n, frameStyle: 'panes', depth: 0.3 });
      } else {
        upperWin(front, -zcol, yc, cwd.w, f);
      }
    }
  }

  // ground floor: storefronts either side of a central entrance
  const doorW = 2.0 + rnd() * 0.6, doorH = 2.6;
  const storeH = 2.45, storeSill = 0.5;
  const entranceInBay = S.style === 'bay';
  const entranceOnTower = S.style === 'tower';
  if (!entranceInBay && !entranceOnTower) windowRecord(ctx, front, -zc, G + doorH / 2, doorW, doorH, { kind: 'door', interior: [6, 0, rnd(), rnd()], depth: 0.35 });
  const gExcl = excl.filter((e) => S.style === 'twin' ? e[1] - e[0] > 2 : true).map((e) => [...e]);
  if (!entranceInBay && !entranceOnTower) gExcl.push([zc - doorW / 2 - 0.9, zc + doorW / 2 + 0.9]);
  gExcl.sort((p, q) => p[0] - q[0]);
  const storeAll = [];
  for (const [a, b] of segmentsOf(zf0, zf1, gExcl)) storeAll.push(...spread(a, b, 2.6, 0.7));
  const storeCols = storeAll.filter((z) => z > zc), mirrorCols = storeAll.filter((z) => z <= zc);
  for (const z of storeAll) {
    windowRecord(ctx, front, -z, G + storeSill + storeH / 2, 2.6, storeH, { kind: 'store', interior: interiorFor(rnd, 'store'), depth: 0.3 });
  }
  let gbDone = false;
  if (S.glassBlock && !entranceInBay && !entranceOnTower && storeCols.length) {
    const gz = zc + doorW / 2 + 0.55;
    if (storeCols[0] - 1.3 > gz + 0.4) {
      for (const s of [-1, 1]) windowRecord(ctx, front, -(zc + s * (gz - zc)), G + 0.3 + 1.2, 0.6, 2.4, { kind: 'block', depth: 0.12 });
      gbDone = true;
    }
  }
  if (S.portholes && !gbDone && !entranceInBay && !entranceOnTower && storeCols.length) {
    const gz = zc + doorW / 2 + 0.75;
    if (storeCols[0] - 1.3 > gz + 0.35) {
      for (const s of [-1, 1]) windowRecord(ctx, front, -(zc + s * (gz - zc)), G + 1.75, 0.7, 0.7, { round: true, depth: 0.25, interior: [6, 0, rnd(), rnd()] });
    }
  }

  // Rounded corner / bay end with glass wrapping round it on every upper floor:
  // solid stucco bands between the floors, faceted panes in shallow reveals.
  const arcWin = (cx, cz, r, a0, a1, yTop) => {
    const seg = Math.max(3, Math.round((r * Math.abs(a1 - a0)) / 0.55));
    const ys = [G - 0.2];
    for (let f = 1; f < floors; f++) {
      const y0 = Y0 + (f - 1) * fh;
      ys.push(y0 + sill, y0 + sill + winH);
    }
    ys.push(yTop);
    for (let k = 0; k < ys.length; k += 2) arcWall(paint, cx, cz, r, a0, a1, ys[k], ys[k + 1], seg);
    const dA = (a1 - a0) / seg, ch = 2 * r * Math.sin(Math.abs(dA) / 2), rc = r * Math.cos(dA / 2);
    for (let f = 1; f < floors; f++) {
      const yc = Y0 + (f - 1) * fh + sill + winH / 2;
      for (let i = 0; i < seg; i++) {
        const am = a0 + dA * (i + 0.5);
        const N = [Math.cos(am), 0, Math.sin(am)];
        const wl = { o: [cx + rc * N[0], 0, cz + rc * N[2]], N, holes: [], color: body };
        windowRecord(ctx, wl, 0, yc, ch, winH, { depth: 0.1, frameStyle: 'plain', sill: false, surround: null, interior: interiorFor(rnd, 'win') });
      }
    }
  };
  paint.color(body);
  paint.band(bandCol, S.band.mode);
  paint.e = [eyeOff, lastEye + 0.02, top];
  planarWall(paint, front.o, front.N, -(z1 - r1), -(z0 + r0), G - 0.2, top, front.holes);
  if (r0 > 0) arcWin(fx - r0, z0 + r0, r0, -Math.PI / 2, 0, top);
  if (r1 > 0) arcWin(fx - r1, z1 - r1, r1, 0, Math.PI / 2, top);
  paint.e = [0, 0, top];
  paint.b = [1, 1, 1, 0];
  for (const side of [-1, 1]) {
    const z = side < 0 ? z0 : z1, r = side < 0 ? r0 : r1;
    const N = [0, 0, side];
    const wall = { o: [0, 0, z], N, holes: [], color: body };
    const Rv = cross(UP, N);
    const uF = (fx - r) * Rv[0], uB = back * Rv[0];
    const exposed = side < 0 ? S.exposed[0] : S.exposed[1];
    const ds = [];
    if (exposed) for (let d = 2.4; d < fx - r - back - 2; d += 3.0 + rnd() * 0.6) ds.push(d);
    else ds.push(2.4, 6.2, 10.4);
    if (detail || exposed) {
      for (let f = 1; f < floors; f++) {
        const y = Y0 + (f - 1) * fh + sill + 0.65;
        for (const d of ds) {
          if (d > 7 && !exposed && rnd() < 0.5) continue;
          const x = fx - r - d;
          windowRecord(ctx, wall, x * Rv[0], y, 0.9, 1.25, { interior: interiorFor(rnd, 'win'), depth: 0.2 });
          if (S.ac && rnd() < 0.25) acUnits.push({ wall, u: x * Rv[0], y: y - 0.7 });
        }
      }
    }
    planarWall(paint, wall.o, N, Math.min(uF, uB), Math.max(uF, uB), G - 0.2, top, wall.holes);
  }
  paint.color(body);
  box(paint, back, back + 0.2, G - 0.2, top, z0, z1, { '+x': true });
  paint.color(COL.stoneGrey);
  paint.quad([back, H, z0], [fx - 0.2, H, z0], [fx - 0.2, H, z1], [back, H, z1], UP);
  paint.color(body);
  const bh = 2.2 + rnd() * 1.2, bx = back + 3 + rnd() * 6, bz = z0 + 2 + rnd() * (W - 7);
  box(paint, bx, bx + 3 + rnd() * 2, H, H + bh, bz, bz + 3, { '-y': true });

  // AC units under windows, each dribbling a rust-brown streak down the stucco
  for (const a of acUnits) {
    const N = a.wall.N, Rv = cross(UP, N);
    const c = [a.wall.o[0] + Rv[0] * a.u, a.y, a.wall.o[2] + Rv[2] * a.u];
    const F = { o: c, X: N, Y: UP, Z: cross(N, UP) };
    paint.color(pick(rnd, [0xcfcdc5, 0xbdbbb3, 0xd8d6cf]));
    lbox(paint, F, -0.05, 0.36, -0.5, -0.06, -0.34, 0.34, { '-x': true });
    paint.color(0x77756f);
    lbox(paint, F, 0.36, 0.372, -0.44, -0.12, -0.28, 0.28, { '-x': true });
    metal.color(0x6b6a66);
    lbox(metal, F, 0.05, 0.3, -0.53, -0.5, -0.3, -0.26);
    lbox(metal, F, 0.05, 0.3, -0.53, -0.5, 0.26, 0.3);
    grime(B.grime, add(c, [0, -0.5, 0]), N, 0.35 + rnd() * 0.35, 1.3 + rnd() * 2.2, 0.55 + rnd() * 0.3, rnd);
  }
  // coping drips and dirty patches under the parapet and along the base
  if (detail) {
    for (let z = z0 + r0 + 0.5; z < z1 - r1 - 0.5; z += 0.8 + rnd() * 2.4) {
      if (rnd() < 0.45) grime(B.grime, [fx, top - 0.14, z], [1, 0, 0], 0.3 + rnd() * 0.8, 0.4 + rnd() * 1.4, 0.2 + rnd() * 0.3, rnd);
    }
    // downspouts at the square ends of the front, with a stain down each
    const pipeCol = rnd() < 0.5 ? darken(body, 0.9) : 0xb9b7b0;
    for (const [z, r] of [[z0 + 0.22, r0], [z1 - 0.22, r1]]) {
      if (r > 0 || rnd() < 0.35) continue;
      metal.color(pipeCol);
      cyl(metal, [fx + 0.09, G + 0.05, z], [fx + 0.09, H - 0.1, z], 0.05, 6, [1, 0, 0], 0, Math.PI * 2);
      cyl(metal, [fx + 0.09, H - 0.1, z], [fx - 0.3, H + 0.15, z], 0.05, 6, [0, 1, 0]);
      for (let y = G + 1.2; y < H; y += 1.8) box(metal, fx - 0.01, fx + 0.1, y, y + 0.05, z - 0.07, z + 0.07);
      grime(B.grime, [fx, H - 0.2, z], [1, 0, 0], 0.35, H - G - 0.5, 0.35, rnd);
    }
    // conduit run along the top of the ground floor to a meter box, wall vents
    if (rnd() < 0.7) {
      metal.color(0x9c9a94);
      const cz0 = z0 + r0 + 0.6, cz1 = cz0 + 2 + rnd() * 3, cy = G + gH - 0.12;
      cyl(metal, [fx + 0.03, cy, cz0], [fx + 0.03, cy, cz1], 0.018, 5, [0, 1, 0]);
      cyl(metal, [fx + 0.03, cy, cz0], [fx + 0.03, G + 1.4, cz0], 0.018, 5, [1, 0, 0]);
      metal.color(0x8d8b85);
      box(metal, fx - 0.01, fx + 0.14, G + 0.9, G + 1.45, cz0 - 0.22, cz0 + 0.22);
    }
    for (let i = 0; i < 2; i++) {
      const vz = z0 + r0 + 1 + rnd() * (W - r0 - r1 - 2), vy = Y0 + Math.floor(rnd() * Math.max(1, floors - 1)) * fh + 0.25;
      metal.color(0xcfccc4);
      box(metal, fx - 0.01, fx + 0.03, vy, vy + 0.3, vz - 0.2, vz + 0.2);
      metal.color(0x3a3936);
      for (let k = 0; k < 4; k++) box(metal, fx + 0.03, fx + 0.035, vy + 0.05 + k * 0.06, vy + 0.08 + k * 0.06, vz - 0.16, vz + 0.16);
    }
  }

  // ---- ornament -------------------------------------------------------------------
  paint.w = [Y0, fh, 0.5];
  const full = outline(fx, z0, z1, r0, r1);
  const cut = cw > 0 && S.style !== 'bay' && S.style !== 'twin';
  const splitAt = cut ? [outline(fx, z0, z1, r0, r1, -Infinity, zc - cw / 2), outline(fx, z0, z1, r0, r1, zc + cw / 2, Infinity)] : [full];
  paint.color(darken(body, 0.88));
  ribbon(paint, full, G - 0.2, G + 0.5, 0.05);
  paint.color(trim);
  ribbon(paint, full, top - 0.12, top + 0.05, 0.08);
  if (['pylon', 'twin', 'tower', 'ziggurat', 'fin'].includes(S.style)) {
    // triple speed lines across the parapet band
    paint.color(isWhite(trim) ? accent : trim);
    for (let k = 0; k < 3; k++) ribbon(paint, full, top - 0.85 + k * 0.2, top - 0.77 + k * 0.2, 0.03);
  } else if (S.style !== 'plain' || rnd() < 0.5) {
    paint.color(isWhite(trim) ? accent : trim);
    ribbon(paint, full, top - 0.55, top - 0.4, 0.02);
  }
  // eyebrows: thin pale slabs, 8-10 cm, cantilevered 40-70 cm
  // eyebrows: deep cantilevered slabs (0.6-0.95 m) with a thick front edge, pastel
  // underside on white hotels
  const eT = S.eyeT;
  for (const y of eyebrowYs) {
    paint.color(eyeCol);
    if (S.eyebrow === 'window') {
      for (const zcol of upperCols) {
        if (portCols.has(zcol) && portCols.get(zcol) <= 1) continue;
        const hw = colW.get(zcol).w / 2 + 0.35;
        ribbon(paint, [{ x: fx, z: zcol - hw, n: [1, 0, 0] }, { x: fx, z: zcol + hw, n: [1, 0, 0] }], y, y + eT, S.eyeOut, true, eyeUnder);
      }
      if (r0 > 0) ribbon(paint, outline(fx, z0, z1, r0, r1, -Infinity, z0 + r0 + 0.4, 12), y, y + eT, S.eyeOut, true, eyeUnder);
      if (r1 > 0) ribbon(paint, outline(fx, z0, z1, r0, r1, z1 - r1 - 0.4, Infinity, 12), y, y + eT, S.eyeOut, true, eyeUnder);
    } else {
      for (const pts of splitAt) ribbon(paint, pts, y, y + eT, S.eyeOut, true, eyeUnder);
    }
    if (S.eyebrow === 'band' || S.style === 'band') {
      paint.color(isWhite(trim) ? accent : trim);
      for (const pts of splitAt) ribbon(paint, pts, y + 0.22, y + 0.36, 0.012);
    }
  }
  // speed lines wrapping rounded corners
  for (const [r, zA, zB] of [[r0, -Infinity, z0 + r0 + 1.6], [r1, z1 - r1 - 1.6, Infinity]]) {
    if (r <= 0) continue;
    const pts = outline(fx, z0, z1, r0, r1, zA, zB, 12);
    paint.color(isWhite(trim) ? accent : trim);
    for (let k = 0; k < 3; k++) ribbon(paint, pts, H - 0.3 + k * 0.2, H - 0.24 + k * 0.2, 0.035);
  }
  // relief medallions in the parapet band
  const medal = (z, y, r) => {
    paint.color(accent);
    cyl(paint, [fx - 0.02, y, z], [fx + 0.05, y, z], r, 20, [0, 1, 0], 0, Math.PI * 2, true);
    paint.color(isWhite(trim) ? body : trim);
    cyl(paint, [fx + 0.05, y, z], [fx + 0.08, y, z], r * 0.45, 16, [0, 1, 0], 0, Math.PI * 2, true);
    const tor = new THREE.TorusGeometry(r + 0.06, 0.04, 6, 28);
    paint.color(isWhite(trim) ? lighten(body, 0.5) : trim);
    pushGeometry(paint, tor, new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(fx + 0.02, y, z));
    tor.dispose();
  };
  if (S.medallions && S.style !== 'bay') {
    const y = (top - 0.4 + (lastEye + 0.1)) / 2;
    if (top - 0.4 - (lastEye + 0.1) > 0.75) {
      const r = Math.min(0.42, (top - 0.4 - lastEye - 0.1) * 0.42);
      const mids = [];
      for (let i = 0; i < upperCols.length - 1; i++) mids.push((upperCols[i] + upperCols[i + 1]) / 2);
      const cands = cut ? mids.filter((z) => Math.abs(z - zc) > cw / 2 + 0.8) : mids;
      const n = Math.min(cands.length, 4);
      const chosen = [...cands].sort((p, q) => Math.abs(p - zc) - Math.abs(q - zc)).slice(0, n);
      for (const z of chosen) medal(z, y, r);
    }
  }

  // ---- central element / massing --------------------------------------------------
  let signDone = false;
  const signStyle = {
    fill: ['pylon', 'fin', 'tower', 'twin'].includes(S.style) ? pick(rnd, ['#f5f1e8', '#f7efd8'])
      : pick(rnd, ['#2f6a6a', '#8a3f45', '#34506e', '#3c3f45', '#b85f5a', '#3f7a5e', '#7a5a8a']),
    edge: 'rgba(30,25,22,0.6)',
    tube: pick(rnd, ['#ff9fc4', '#9ff2ea', '#fff2c0', '#ffc59a', '#c8b8ff']),
    font: S.signFont,
  };
  const name = S.name;
  const finSign = (fz, col, yb, yt, fd = 1.15, ft = 0.32) => {
    paint.color(col);
    box(paint, fx - 0.2, fx + fd - ft / 2, yb, yt, fz - ft / 2, fz + ft / 2, { '-y': true });
    cyl(paint, [fx + fd - ft / 2, yb, fz], [fx + fd - ft / 2, yt, fz], ft / 2, 10, [1, 0, 0], -Math.PI / 2, Math.PI / 2);
    paint.color(trim === col ? accent : trim);
    box(paint, fx - 0.2, fx + fd * 0.75, yt, yt + 0.45, fz - ft / 2 - 0.06, fz + ft / 2 + 0.06);
    box(paint, fx - 0.2, fx + fd * 0.45, yt + 0.45, yt + 0.9, fz - ft / 2 - 0.03, fz + ft / 2 + 0.03);
    cyl(paint, [fx + fd * 0.2, yt + 0.9, fz], [fx + fd * 0.2, yt + 2.2, fz], 0.05, 6, [1, 0, 0]);
    cyl(paint, [fx + fd * 0.2, yt + 2.2, fz], [fx + fd * 0.2, yt + 2.42, fz], 0.12, 10, [1, 0, 0], 0, Math.PI * 2, true);
    paint.color(col);
    paint.quad([fx - 0.2, yb, fz - ft / 2], [fx + fd - ft / 2, yb, fz - ft / 2], [fx + fd - ft / 2, yb, fz + ft / 2], [fx - 0.2, yb, fz + ft / 2], [0, -1, 0]);
    const vs = name ? atlas.vertical(name, signStyle) : null;
    if (vs) {
      const lh = Math.min(0.8, (yt - 0.4 - (yb + 1.0)) / vs.n);
      const yc = yt - 0.35 - (lh * vs.n) / 2;
      const w = lh * vs.aspect * vs.n;
      for (const s of [-1, 1]) signQuad(B.signs, [fx + 0.1 + fd / 2, yc, fz + s * (ft / 2 + 0.04)], [0, 0, s], w, lh * vs.n, vs.uv);
      return true;
    }
    return false;
  };

  if (S.style === 'pylon' || S.style === 'twin') {
    const pd = S.style === 'twin' ? 0.3 : 0.35, yb = Y0 - 0.25, yt = top + (S.style === 'twin' ? 1.8 : 2.4) + rnd() * 2.2;
    const col = isWhite(trim) ? accent : trim;
    // letters must read against the pylon: dark metal on a pale pylon
    if (new THREE.Color(col).getHSL({}).l > 0.62) signStyle.fill = pick(rnd, ['#2f5f63', '#7c3a40', '#3a4a66']);
    paint.color(col);
    const pw = { o: [fx + pd, 0, 0], N: [1, 0, 0], holes: [], color: col };
    // letters down the face of the building (readable from the street), a porthole above
    const letterTop = Math.min(yt - 0.7, top + 0.2, S.signTop ?? Infinity);
    if (yt - letterTop > 1.8) windowRecord(ctx, pw, -zc, (yt + letterTop) / 2 + 0.1, Math.min(0.62, cw * 0.4), 0, { round: true, depth: 0.3, interior: [0, rnd(), rnd(), rnd()], collar: isWhite(col) ? accent : COL.white });
    let vs = name ? atlas.vertical(name, signStyle) : null;
    const lh = vs ? Math.min(1.3, cw * 0.78, (letterTop - (S.signBottom ?? yb + 1.6)) / vs.n) : 0;
    if (lh < 0.4) vs = null;
    const signBottom = vs ? letterTop - lh * vs.n : letterTop;
    if (S.glassBlock && signBottom - yb > 3.5) windowRecord(ctx, pw, -zc, (yb + 0.5 + signBottom - 0.5) / 2, 0.7, signBottom - yb - 1.0, { kind: 'block', depth: 0.1 });
    else if (vs) {
      // speed-line grooves under the letters (portholes there read as more letters)
      paint.color(isWhite(col) ? accent : COL.white);
      for (let k = 0; k < 3; k++) {
        const y = signBottom - 0.45 - k * 0.32;
        if (y > yb + 0.8) box(paint, fx + pd, fx + pd + 0.05, y - 0.07, y, zc - cw * 0.36, zc + cw * 0.36);
      }
      paint.color(col);
    } else {
      // a stack of portholes down the pylon
      for (let y = signBottom - 0.75; y > yb + 1.1; y -= 1.35) {
        windowRecord(ctx, pw, -zc, y, Math.min(0.62, cw * 0.4), 0, { round: true, depth: 0.3, interior: [0, rnd(), rnd(), rnd()], collar: isWhite(col) ? accent : COL.white });
      }
    }
    planarWall(paint, pw.o, pw.N, -(zc + cw / 2), -(zc - cw / 2), yb, yt, pw.holes);
    box(paint, fx - 0.3, fx + pd, yb, yt, zc - cw / 2, zc + cw / 2, { '+x': true, '-x': true });
    paint.color(isWhite(col) ? accent : COL.white);
    box(paint, fx - 0.3, fx + pd + 0.08, yt, yt + 0.25, zc - cw / 2 - 0.08, zc + cw / 2 + 0.08);
    box(paint, fx - 0.3, fx + pd + 0.02, yt + 0.25, yt + 0.6, zc - cw / 2 + 0.35, zc + cw / 2 - 0.35);
    box(paint, fx - 0.3, fx + pd - 0.04, yt + 0.6, yt + 0.9, zc - cw / 2 + 0.75, zc + cw / 2 - 0.75);
    for (let k = 0; k < 4; k++) {
      const y = top - 0.4 - k * 0.45;
      for (const s of [-1, 1]) box(paint, fx + pd - 0.02, fx + pd + 0.05, y, y + 0.14, zc + s * (cw / 2) - (s > 0 ? 0.45 : 0), zc + s * (cw / 2) + (s < 0 ? 0.45 : 0));
    }
    if (vs) {
      signQuad(B.signs, [fx + pd + 0.06, (letterTop + signBottom) / 2, zc], [1, 0, 0], lh * vs.aspect * vs.n, lh * vs.n, vs.uv);
      signDone = true;
    }
  } else if (S.style === 'fin') {
    const col = isWhite(trim) ? accent : trim;
    signDone = finSign(zc, col, Y0 + 0.2, top + 2.6 + rnd() * 2.0);
  } else if (S.style === 'tower') {
    const td = 0.55, tfx = fx + td, ttop = top + 3.0 + rnd() * 2.2;
    const tw = { o: [tfx, 0, 0], N: [1, 0, 0], holes: [], color: body };
    const nw = Math.min(1.3, cw - 1.8);
    for (let f = 1; f < floors; f++) {
      const y0 = Y0 + (f - 1) * fh;
      windowRecord(ctx, tw, -zc, y0 + sill + winH / 2, nw, winH, { interior: interiorFor(rnd, 'win') });
    }
    windowRecord(ctx, tw, -zc, G + doorH / 2, doorW, doorH, { kind: 'door', interior: [6, 0, rnd(), rnd()], depth: 0.35 });
    // glass block slot up the tower above the roofline
    windowRecord(ctx, tw, -zc, (top + ttop - 1.2) / 2, 0.8, ttop - top - 1.6, { kind: 'block', depth: 0.1 });
    paint.color(body);
    paint.band(bandCol, S.band.mode);
    paint.e = [eyeOff, lastEye + 0.02, 0];
    planarWall(paint, tw.o, tw.N, -(zc + cw / 2), -(zc - cw / 2), G - 0.2, ttop, tw.holes);
    paint.e = [0, 0, 0];
    paint.b = [1, 1, 1, 0];
    paint.color(eyeCol);
    for (const y of eyebrowYs) ribbon(paint, [{ x: tfx, z: zc - nw / 2 - 0.35, n: [1, 0, 0] }, { x: tfx, z: zc + nw / 2 + 0.35, n: [1, 0, 0] }], y, y + eT, S.eyeOut * 0.8, true, eyeUnder);
    paint.color(body);
    box(paint, fx - 0.3, tfx, G - 0.2, ttop, zc - cw / 2, zc + cw / 2, { '+x': true, '-y': true });
    box(paint, fx - 3, fx - 0.3, top, ttop, zc - cw / 2, zc + cw / 2, { '-y': true, '+x': true });
    const tc = isWhite(trim) ? accent : trim;
    paint.color(tc);
    for (const s of [-1, 1]) box(paint, tfx - 0.01, tfx + 0.06, Y0, ttop - 0.6, zc + s * (cw / 2 - 0.35) - 0.08, zc + s * (cw / 2 - 0.35) + 0.08);
    for (let k = 0; k < 3; k++) box(paint, fx - 0.3, tfx + 0.04, ttop - 1.3 + k * 0.22, ttop - 1.2 + k * 0.22, zc - cw / 2 - 0.04, zc + cw / 2 + 0.04);
    // stepped crown and finial
    let w = cw + 0.2, y = ttop, d = td + 0.3;
    for (let s = 0; s < 3; s++) {
      paint.color(s % 2 ? body : tc);
      const hh = s === 0 ? 0.3 : 0.7;
      box(paint, fx - 2.4 + s * 0.6, fx - 0.3 + d, y, y + hh, zc - w / 2, zc + w / 2);
      y += hh; w *= 0.62; d -= 0.25;
    }
    paint.color(tc);
    cyl(paint, [fx - 0.9, y, zc], [fx - 0.9, y + 2.6, zc], 0.06, 6, [1, 0, 0]);
    cyl(paint, [fx - 0.9, y + 1.0, zc], [fx - 0.9, y + 1.12, zc], 0.2, 10, [1, 0, 0], 0, Math.PI * 2, true);
    cyl(paint, [fx - 0.9, y + 2.6, zc], [fx - 0.9, y + 2.85, zc], 0.13, 10, [1, 0, 0], 0, Math.PI * 2, true);
    if (name) {
      const hs = atlas.horizontal(name, signStyle);
      if (hs) {
        const h = Math.min(0.55, (cw - 0.4) / hs.aspect);
        signQuad(B.signs, [tfx + 0.06, ttop - 1.7 - h / 2, zc], [1, 0, 0], h * hs.aspect, h, hs.uv);
        signDone = true;
      }
    }
  } else if (S.style === 'ziggurat') {
    paint.color(COL.stoneGrey);
    box(paint, fx - 0.2, fx + 0.05, Y0 + 0.1, top, zc - cw / 2, zc + cw / 2, { '-x': true });
    // fluted relief strips down the middle panel
    paint.color(lighten(COL.stoneGrey, 0.3));
    for (let k = -2; k <= 2; k++) box(paint, fx + 0.05, fx + 0.1, Y0 + 0.4, top - 0.3, zc + k * 0.5 - 0.09, zc + k * 0.5 + 0.09, { '-x': true });
    paint.color(body);
    let w = Math.min(W * 0.55, 10);
    for (let s = 0; s < 4; s++) {
      const y0 = top + s * 0.7;
      box(paint, fx - 1.2, fx + 0.03, y0, y0 + 0.7, zc - w / 2, zc + w / 2, { '-y': true });
      paint.color(trim);
      box(paint, fx - 1.2, fx + 0.09, y0 + 0.6, y0 + 0.7, zc - w / 2 - 0.05, zc + w / 2 + 0.05);
      paint.color(body);
      w -= 2.2;
      if (w < 1.4) break;
    }
  }

  // bays (single central bay, or twin bays)
  for (const [bz0, bz1, withDoor] of bays) {
    const bd = 0.9, rb = 0.8, bfx = fx + bd, btop = top + (withDoor ? 0.5 : 0.25);
    const bw = { o: [bfx, 0, 0], N: [1, 0, 0], holes: [], color: body };
    const bc = (bz0 + bz1) / 2;
    const bL = bz1 - bz0 - 2 * rb - 0.4;
    const bn = Math.max(2, Math.round(bL / S.paneW));
    for (let f = 1; f < floors; f++) {
      const y0 = Y0 + (f - 1) * fh;
      upperWin(bw, -bc, y0 + sill + winH / 2, bL, f, { panes: bn, frameStyle: 'panes', depth: 0.28 });
    }
    if (withDoor) windowRecord(ctx, bw, -bc, G + doorH / 2, doorW, doorH, { kind: 'door', interior: [6, 0, rnd(), rnd()], depth: 0.35 });
    else for (const z of spread(bz0 + rb, bz1 - rb, 2.2, 0.5)) windowRecord(ctx, bw, -z, G + storeSill + storeH / 2, 2.2, storeH, { kind: 'store', interior: interiorFor(rnd, 'store'), depth: 0.3 });
    paint.color(body);
    paint.band(bandCol, S.band.mode);
    paint.e = [eyeOff, lastEye + 0.02, btop];
    planarWall(paint, bw.o, bw.N, -(bz1 - rb), -(bz0 + rb), G - 0.2, btop, bw.holes);
    arcWin(bfx - rb, bz0 + rb, rb, -Math.PI / 2, 0, btop);
    arcWin(bfx - rb, bz1 - rb, rb, 0, Math.PI / 2, btop);
    paint.e = [0, 0, 0];
    paint.b = [1, 1, 1, 0];
    box(paint, fx - 0.1, bfx - rb, G - 0.2, btop, bz0, bz1, { '+x': true, '-x': true, '-y': true });
    const bo = outline(bfx, bz0, bz1, rb, rb, -Infinity, Infinity, 8);
    paint.color(trim);
    ribbon(paint, bo, btop - 0.1, btop + 0.06, 0.07);
    paint.color(isWhite(trim) ? accent : trim);
    for (let k = 0; k < 3; k++) ribbon(paint, bo, btop - 0.75 + k * 0.17, btop - 0.69 + k * 0.17, 0.03);
    paint.color(eyeCol);
    for (const y of eyebrowYs) ribbon(paint, bo, y, y + eT, S.eyeOut * 0.9, true, eyeUnder);
    paint.color(accent);
    for (const s of [-1, 1]) box(paint, bfx - 0.01, bfx + 0.02, Y0, btop - 0.9, bc + s * ((bz1 - bz0) / 2 - rb - 0.12) - 0.07, bc + s * ((bz1 - bz0) / 2 - rb - 0.12) + 0.07);
    if (withDoor && name && !signDone) {
      const hs = atlas.horizontal(name, signStyle);
      if (hs) {
        const h = Math.min(0.7, ((bz1 - bz0) - 1.2) / hs.aspect);
        signQuad(B.signs, [bfx + 0.06, top - 0.35, bc], [1, 0, 0], h * hs.aspect, h, hs.uv);
        signDone = true;
      }
    }
  }

  // corner tower rising over the rounded corner at z1
  if (S.style === 'corner' && r1 > 0) {
    const cTop = top + fh * 0.75 + rnd() * 1.2;
    const cx = fx - r1, cz = z1 - r1;
    paint.color(body);
    arcWall(paint, cx, cz, r1, 0, Math.PI / 2, top, cTop, 14);
    box(paint, cx - 0.01, cx, top, cTop, cz, z1, { '+x': true, '+y': true, '-y': true, '+z': true, '-z': true });
    paint.quad([cx, top, cz - 0.01], [fx, top, cz - 0.01], [fx, cTop, cz - 0.01], [cx, cTop, cz - 0.01], [0, 0, -1]);
    paint.quad([cx, top, cz], [cx, top, z1], [cx, cTop, z1], [cx, cTop, cz], [-1, 0, 0]);
    paint.color(COL.stoneGrey);
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI / 2) * (i / 12), b2 = (Math.PI / 2) * ((i + 1) / 12);
      paint.tri([cx, cTop, cz], [cx + r1 * Math.cos(a), cTop, cz + r1 * Math.sin(a)], [cx + r1 * Math.cos(b2), cTop, cz + r1 * Math.sin(b2)], UP, UP, UP);
    }
    const arc = outline(fx, z0, z1, 0, r1, z1 - r1 - 0.001, Infinity, 14).filter((p) => p.z >= z1 - r1 - 0.01);
    paint.color(trim);
    ribbon(paint, arc, cTop - 0.12, cTop + 0.06, 0.1);
    paint.color(isWhite(trim) ? accent : trim);
    for (let k = 0; k < 4; k++) ribbon(paint, arc, cTop - 1.2 + k * 0.2, cTop - 1.13 + k * 0.2, 0.035);
    paint.color(eyeCol);
    ribbon(paint, arc, top, top + 0.09, 0.45);
    // drum, mast and ball finial
    const dx = cx + r1 * 0.35, dz = cz + r1 * 0.35;
    paint.color(body);
    cyl(paint, [dx, cTop, dz], [dx, cTop + 0.7, dz], Math.min(1.1, r1 * 0.55), 18, [1, 0, 0], 0, Math.PI * 2, true);
    paint.color(trim);
    cyl(paint, [dx, cTop + 0.7, dz], [dx, cTop + 0.82, dz], Math.min(1.1, r1 * 0.55) + 0.08, 18, [1, 0, 0], 0, Math.PI * 2, true);
    paint.color(isWhite(trim) ? accent : trim);
    cyl(paint, [dx, cTop + 0.82, dz], [dx, cTop + 3.6, dz], 0.06, 6, [1, 0, 0]);
    cyl(paint, [dx, cTop + 3.6, dz], [dx, cTop + 3.85, dz], 0.15, 10, [1, 0, 0], 0, Math.PI * 2, true);
    for (let k = 0; k < 3; k++) cyl(paint, [dx, cTop + 1.5 + k * 0.5, dz], [dx, cTop + 1.56 + k * 0.5, dz], 0.32 - k * 0.08, 12, [1, 0, 0], 0, Math.PI * 2, true);
  }

  // stepped parapet over the middle
  let raisedTop = top;
  if (S.parapetStep && S.style !== 'ziggurat' && S.style !== 'tower') {
    // stepped (ziggurat) parapet rising to the middle, trim-capped, finials on the shoulders
    let ws = Math.min(W * (0.45 + rnd() * 0.2), 13), y = top;
    const tiers = 2 + (rnd() < 0.5 ? 1 : 0);
    const capCol = whiteBody ? (isWhite(trim) ? bandCol : trim) : COL.white;
    for (let t = 0; t < tiers; t++) {
      const dh = 0.55 + rnd() * 0.4;
      paint.color(body);
      box(paint, fx - 0.3, fx, y, y + dh, zc - ws / 2, zc + ws / 2, { '-y': true });
      paint.color(capCol);
      box(paint, fx - 0.32, fx + 0.1, y + dh - 0.14, y + dh + 0.04, zc - ws / 2 - 0.08, zc + ws / 2 + 0.08);
      if (S.finial && t === 0) {
        for (const s of [-1, 1]) {
          const fz = zc + s * (ws / 2 - 0.2);
          box(paint, fx - 0.25, fx + 0.05, y + dh + 0.04, y + dh + 0.5, fz - 0.15, fz + 0.15);
          cyl(paint, [fx - 0.1, y + dh + 0.5, fz], [fx - 0.1, y + dh + 1.3, fz], 0.05, 6, [1, 0, 0]);
          cyl(paint, [fx - 0.1, y + dh + 1.3, fz], [fx - 0.1, y + dh + 1.5, fz], 0.12, 10, [1, 0, 0], 0, Math.PI * 2, true);
        }
      }
      y += dh; ws *= 0.62;
      if (ws < 1.6) break;
    }
    raisedTop = y;
    if (S.finial && !['pylon', 'fin', 'twin'].includes(S.style)) {
      paint.color(capCol);
      cyl(paint, [fx - 0.15, y, zc], [fx - 0.15, y + 2.2, zc], 0.06, 6, [1, 0, 0]);
      for (let k = 0; k < 3; k++) cyl(paint, [fx - 0.15, y + 0.5 + k * 0.45, zc], [fx - 0.15, y + 0.56 + k * 0.45, zc], 0.28 - k * 0.07, 12, [1, 0, 0], 0, Math.PI * 2, true);
      cyl(paint, [fx - 0.15, y + 2.2, zc], [fx - 0.15, y + 2.42, zc], 0.13, 10, [1, 0, 0], 0, Math.PI * 2, true);
    }
  }

  // extra projecting fins rising above the roofline
  if (S.fins && upperCols.length >= 4 && S.style !== 'twin') {
    const mids = [];
    for (let i = 0; i < upperCols.length - 1; i++) mids.push((upperCols[i] + upperCols[i + 1]) / 2);
    const fcol = isWhite(trim) ? accent : trim;
    const used = new Set();
    for (const t of [zc - W * 0.3, zc + W * 0.3]) {
      const m = mids.reduce((p, q) => (Math.abs(q - t) < Math.abs(p - t) ? q : p), mids[0]);
      if (used.has(m)) continue;
      used.add(m);
      const yt = raisedTop + 1.0 + rnd() * 0.8;
      paint.color(fcol);
      box(paint, fx - 0.1, fx + 0.38, Y0 - 0.1, yt, m - 0.12, m + 0.12, { '-y': true });
      cyl(paint, [fx + 0.38, Y0 - 0.1, m], [fx + 0.38, yt, m], 0.12, 8, [1, 0, 0], -Math.PI / 2, Math.PI / 2);
      paint.quad([fx - 0.1, Y0 - 0.1, m - 0.12], [fx + 0.38, Y0 - 0.1, m - 0.12], [fx + 0.38, Y0 - 0.1, m + 0.12], [fx - 0.1, Y0 - 0.1, m + 0.12], [0, -1, 0]);
      paint.color(trim === fcol ? COL.white : trim);
      box(paint, fx - 0.1, fx + 0.32, yt, yt + 0.3, m - 0.2, m + 0.2);
    }
  }

  // roof clutter that shows over the parapet
  if (S.roof === 'tank' && detail) {
    const tx = fx - 4 - rnd() * 4, tz = z0 + 2.5 + rnd() * (W - 5), lh = 2.0 + rnd() * 0.8, tr = 0.9 + rnd() * 0.4;
    metal.color(0x6f6e69);
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) cyl(metal, [tx + dx * tr * 0.7, H, tz + dz * tr * 0.7], [tx + dx * tr * 0.7, H + lh, tz + dz * tr * 0.7], 0.06, 5, [1, 0, 0]);
    metal.color(pick(rnd, [0xb8b4aa, 0x9c9a94, 0xd2cec4]));
    cyl(metal, [tx, H + lh, tz], [tx, H + lh + 2.0, tz], tr, 16, [1, 0, 0], 0, Math.PI * 2, true);
    const cone = new THREE.ConeGeometry(tr + 0.05, 0.5, 16, 1, true);
    pushGeometry(metal, cone, new THREE.Matrix4().makeTranslation(tx, H + lh + 2.25, tz));
    cone.dispose();
  } else if (S.roof === 'ac' && detail) {
    for (let i = 0; i < 2 + rnd() * 3; i++) {
      const ax = fx - 2.5 - rnd() * 5, az = z0 + 1.5 + rnd() * (W - 4);
      paint.color(pick(rnd, [0xbdbbb3, 0xa9a7a0, 0xcfcdc6]));
      box(paint, ax - 0.6, ax + 0.6, H, H + 1.1 + rnd() * 0.5, az - 0.7, az + 0.7, { '-y': true });
    }
    metal.color(0x8a8984);
    const dz = z0 + 2 + rnd() * (W - 4);
    box(metal, fx - 7, fx - 2, H + 1.4, H + 1.9, dz - 0.25, dz + 0.25);
  }
  if (detail) {
    // rooftop odds and ends over the parapet: a TV mast, a flagpole, a terrace rail
    metal.color(0x7a7974);
    if (rnd() < 0.6) {
      const ax = fx - 3 - rnd() * 4, az = z0 + 2 + rnd() * (W - 4), ah = 2.5 + rnd() * 2.5;
      cyl(metal, [ax, H, az], [ax, H + ah, az], 0.025, 5, [1, 0, 0]);
      for (let k = 0; k < 3; k++) cyl(metal, [ax, H + ah - 0.3 - k * 0.4, az - 0.5 + k * 0.1], [ax, H + ah - 0.3 - k * 0.4, az + 0.5 - k * 0.1], 0.012, 4, [0, 1, 0]);
    }
    if (rnd() < 0.45) {
      const fz = z0 + 1 + rnd() * (W - 2), fh2 = 3.5 + rnd() * 1.5, py0 = raisedTop > top ? raisedTop : top + 0.2;
      metal.color(0xe8e6e0);
      cyl(metal, [fx - 0.4, py0, fz], [fx - 0.4, py0 + fh2, fz], 0.03, 6, [1, 0, 0]);
      cyl(metal, [fx - 0.4, py0 + fh2, fz], [fx - 0.4, py0 + fh2 + 0.08, fz], 0.06, 8, [1, 0, 0], 0, Math.PI * 2, true);
      B.fabric.color(pick(rnd, [0x2d6f9f, 0xc0343c, 0x2f8f7f, 0xe07a9a]));
      const fy = py0 + fh2 - 0.05;
      B.fabric.quadUV([fx - 0.4, fy - 0.7, fz], [fx - 0.35, fy - 0.72, fz + 1.1], [fx - 0.35, fy - 0.02, fz + 1.1], [fx - 0.4, fy, fz], [1, 0, 0], [200, 0.7], [200, 0.7], [200, 0.7], [200, 0.7]);
    }
    if (rnd() < 0.5) {
      const rx = fx - 1.6, ra = z0 + 1 + rnd() * W * 0.3, rb = Math.min(z1 - 1, ra + W * (0.3 + rnd() * 0.3));
      metal.color(isWhite(trim) ? accent : trim);
      for (const y of [H + 0.55, H + 1.0]) cyl(metal, [rx, y, ra], [rx, y, rb], 0.022, 5, [0, 1, 0]);
      for (let z = ra; z <= rb + 1e-3; z += Math.max(0.8, (rb - ra) / Math.ceil((rb - ra) / 1.2))) cyl(metal, [rx, H, z], [rx, H + 1.0, z], 0.022, 5, [1, 0, 0]);
    }
  }
  if (S.roof === 'sign' && name && !signDone) {
    const hs = atlas.horizontal(name, { ...signStyle, fill: pick(rnd, ['#f5f1e8', '#2f6a6a', '#8a3f45']) });
    if (hs) {
      const h = Math.min(1.3, (W * 0.55) / hs.aspect), w = h * hs.aspect;
      const sx = fx - 1.2, y0 = raisedTop + 0.35;
      metal.color(0x5d5c58);
      for (let z = zc - w / 2; z <= zc + w / 2 + 0.01; z += w / Math.max(2, Math.round(w / 1.6))) {
        cyl(metal, [sx - 0.05, top - 0.3, z], [sx - 0.05, y0 + h + 0.15, z], 0.04, 5, [1, 0, 0]);
        cyl(metal, [sx - 0.05, y0 + h + 0.1, z], [sx - 0.9, H, z], 0.03, 5, [1, 0, 0]);
      }
      for (const y of [y0 - 0.05, y0 + h + 0.1]) cyl(metal, [sx - 0.05, y, zc - w / 2], [sx - 0.05, y, zc + w / 2], 0.035, 5, [0, 1, 0]);
      signQuad(B.signs, [sx + 0.02, y0 + h / 2, zc], [1, 0, 0], w, h, hs.uv);
      signDone = true;
    }
  }

  // ---- ground floor: canopy, entrance, relief, porch, patio ------------------------
  paint.w = [100, fh, 0.8];
  const canY = G + gH - 0.35;
  const upperSign = signDone;
  let entSign = false;
  const entStyle = { ...signStyle, fill: new THREE.Color(signStyle.fill).getHSL({}).l > 0.6 ? pick(rnd, ['#2f5f63', '#7c3a40', '#34506e', '#3c3f45']) : signStyle.fill };
  if (S.canopy === 'full') {
    paint.color(isWhite(trim) ? trim : eyeCol);
    for (const pts of splitAt) ribbon(paint, pts, canY, canY + 0.14, 1.3);
    paint.color(accent);
    for (const pts of splitAt) ribbon(paint, pts, canY + 0.14, canY + 0.2, 0.02);
  }
  const entranceX = S.style === 'bay' ? fx + 0.9 : S.style === 'tower' ? fx + 0.55 : fx;
  let pilasterTop = G + gH - 0.4;
  let canopyTop = G + doorH + 0.2;
  if (S.canopy === 'entrance' || S.canopy === 'awning' || S.style === 'bay' || S.style === 'tower') {
    const cwid = doorW + 1.6 + rnd() * 1.2, cp = 1.6 + rnd() * 0.6;
    const cy = G + doorH + 0.45;
    pilasterTop = cy - 0.01;
    canopyTop = cy + 0.16;
    const shape = new THREE.Shape();
    const rr = Math.min(0.6, cp * 0.5);
    shape.moveTo(entranceX - 0.05, -(zc - cwid / 2));
    shape.lineTo(entranceX + cp - rr, -(zc - cwid / 2));
    shape.absarc(entranceX + cp - rr, -(zc - cwid / 2) - rr, rr, Math.PI / 2, 0, true);
    shape.lineTo(entranceX + cp, -(zc + cwid / 2) + rr);
    shape.absarc(entranceX + cp - rr, -(zc + cwid / 2) + rr, rr, 0, -Math.PI / 2, true);
    shape.lineTo(entranceX - 0.05, -(zc + cwid / 2));
    const eg = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false, curveSegments: 8 });
    eg.rotateX(-Math.PI / 2);
    paint.color(isWhite(trim) ? trim : COL.white);
    pushGeometry(paint, eg, new THREE.Matrix4().makeTranslation(0, cy, 0));
    eg.dispose();
    paint.color(accent);
    box(paint, entranceX + cp - 0.02, entranceX + cp + 0.01, cy + 0.02, cy + 0.12, zc - cwid / 2 + rr, zc + cwid / 2 - rr);
    // tie rods back to the wall
    B.wire.color(0xd8d6cf);
    for (const s of [-1, 1]) cyl(B.wire, [entranceX + cp - 0.25, cy + 0.16, zc + s * (cwid / 2 - 0.3)], [entranceX, cy + 1.2, zc + s * (cwid / 2 - 0.3)], 0.018, 5, [0, 1, 0]);
    if (name) {
      const hs = atlas.horizontal(name, entStyle);
      if (hs) {
        const h = Math.min(0.7, (cwid + 1.6) / hs.aspect);
        // fascia board the channel letters stand on (their shadow lands right behind them)
        const lw = h * hs.aspect;
        paint.color(new THREE.Color(entStyle.fill).getHSL({}).l > 0.5 ? accent : COL.white);
        box(paint, entranceX + cp - 0.3, entranceX + cp - 0.2, cy + 0.16, cy + 0.3 + h, zc - lw / 2 - 0.12, zc + lw / 2 + 0.12);
        signQuad(B.signs, [entranceX + cp - 0.2, cy + 0.23 + h / 2, zc], [1, 0, 0], lw, h, hs.uv);
        signDone = true; entSign = true;
        canopyTop = cy + 0.25 + h;
      }
    }
  }
  if (!entSign && name && !entranceInBay) {
    // raised letters on the wall over the door
    const hs = atlas.horizontal(name, entStyle);
    if (hs) {
      const h = Math.min(0.5, (doorW + 2.4) / hs.aspect);
      const y = S.canopy === 'full' ? canY - 0.12 - h / 2 : G + doorH + 0.3 + h / 2;
      signQuad(B.signs, [entranceX + (S.canopy === 'full' ? 1.32 : 0.06), y, zc], [1, 0, 0], h * hs.aspect, h, hs.uv);
      if (S.canopy !== 'full') canopyTop = y + h / 2 + 0.05;
      signDone = true;
    }
  }
  if (!upperSign && name) {
    const hs = atlas.horizontal(name, signStyle);
    if (hs) {
      const onStep = raisedTop > top + 0.5;
      const h = Math.min(1.0, (W * 0.6) / hs.aspect, onStep ? raisedTop - top - 0.1 : ph + 0.5);
      const y = S.style === 'ziggurat' ? top + 0.55 : onStep ? (top + raisedTop) / 2 - 0.05 : top - ph / 2 - 0.05;
      signQuad(B.signs, [fx + (S.style === 'ziggurat' ? 0.09 : 0.06), y, zc], [1, 0, 0], h * hs.aspect, h, hs.uv);
    }
  }
  // "frozen fountain" relief panel over the entrance
  if (S.fountain && detail && S.style !== 'bay') {
    const fy0 = Math.max(canopyTop + 0.15, S.canopy === 'full' ? canY + 0.3 : 0), fy1 = Y0 + sill - 0.2;
    if (fy1 - fy0 > 0.7) {
      const fh2 = Math.min(1.5, fy1 - fy0), fw = Math.min(3.2, doorW + 1.0);
      const yb = fy0, x = entranceX;
      const rc = isWhite(body) ? (isWhite(trim) ? accent : trim) : lighten(body, 0.55);
      const F = { o: [x, yb, zc], X: [1, 0, 0], Y: UP, Z: [0, 0, 1] };
      paint.color(rc);
      // recessed-looking panel frame: proud base course and cornice
      lbox(paint, F, -0.02, 0.14, 0, 0.12, -fw / 2 - 0.1, fw / 2 + 0.1, { '-x': true });
      lbox(paint, F, -0.02, 0.16, fh2 - 0.1, fh2, -fw / 2 - 0.15, fw / 2 + 0.15, { '-x': true });
      lbox(paint, F, -0.02, 0.1, fh2 - 0.2, fh2 - 0.1, -fw / 2 - 0.05, fw / 2 + 0.05, { '-x': true });
      // rising stepped bars, tallest (and most projecting) in the middle
      const nb = 7;
      for (let i = 0; i < nb; i++) {
        const t = i - (nb - 1) / 2, hh = (fh2 - 0.2) * (0.95 - Math.abs(t) * 0.13);
        lbox(paint, F, -0.02, 0.2 - Math.abs(t) * 0.025, 0.12, hh, t * 0.24 - 0.08, t * 0.24 + 0.08, { '-x': true });
        lbox(paint, F, -0.02, 0.24 - Math.abs(t) * 0.025, hh - 0.12, hh, t * 0.24 - 0.1, t * 0.24 + 0.1, { '-x': true });
      }
      // half sunburst either side
      for (const s of [-1, 1]) {
        const c = [x + 0.03, yb + 0.12, zc + s * (nb * 0.24 / 2 + 0.6)];
        cyl(paint, [c[0] - 0.05, c[1], c[2]], [c[0] + 0.13, c[1], c[2]], 0.34, 12, [0, 1, 0], -Math.PI / 2, Math.PI / 2, true);
        for (let k = 0; k < 5; k++) {
          const a = (k / 4 - 0.5) * Math.PI * 0.9;
          const d = [0, Math.cos(a), Math.sin(a)];
          const RF = { o: c, X: [1, 0, 0], Y: d, Z: cross([1, 0, 0], d) };
          lbox(paint, RF, -0.05, 0.12, 0.4, Math.min(0.9, fh2 - 0.3), -0.065, 0.065, { '-x': true });
        }
      }
    }
  }
  // fluted pilasters flanking the entrance
  if (!entranceInBay && !entranceOnTower && rnd() < 0.6) {
    paint.color(isWhite(body) ? trim : COL.white);
    for (const s of [-1, 1]) {
      const pz = zc + s * (doorW / 2 + 0.3);
      box(paint, fx - 0.05, fx + 0.1, G, pilasterTop, pz - 0.2, pz + 0.2, { '-x': true });
      for (let k = 0; k < 4; k++) {
        const z = pz - 0.15 + k * 0.1;
        cyl(paint, [fx + 0.1, G, z], [fx + 0.1, pilasterTop, z], 0.045, 5, [1, 0, 0], -Math.PI / 2, Math.PI / 2);
      }
    }
  }

  if (detail && S.porch) buildPorch(S, B, ctx, rnd, { doorW, zc, zf0, zf1, storeCols, mirrorCols, gbDone, entranceX });
  if (detail && (S.canopy === 'awning' || S.patio === 'awning')) {
    const acol = S.awningColor ?? pick(rnd, AWNING_COLS);
    const striped = rnd() < 0.65;
    const deep = S.patio === 'awning';
    for (const z of storeAll) awning(B.fabric, B.wire, fx, z, 3.0, G + storeSill + storeH + (deep ? 0.55 : 0.35), deep ? 2.4 : 1.3, acol, striped, rnd, deep ? 0.8 : 0.62);
  }
}

// Canvas awning over a storefront: sagging cloth on a thin tubular frame, open sides,
// scalloped valance.
function awning(b, metal, fx, zc, w, yTop, d, color, striped, rnd, drop = 0.62) {
  const val = 0.3, nu = Math.max(8, Math.round(w / 0.64)), nv = 4;
  const sag = (0.05 + rnd() * 0.03) * Math.max(1, d / 2);
  b.color(color);
  const uOff = striped ? 0 : 100;
  const su = (z) => uOff + (z - (zc - w / 2)) / 0.64;
  const P2 = (i, j) => {
    const t = i / nu, s = j / nv;
    const z = zc - w / 2 + w * t;
    const x = fx + d * s;
    const y = yTop - drop * s - sag * Math.sin(Math.PI * s) * (0.6 + 0.4 * Math.sin(Math.PI * t * 1.0));
    return [x, y, z];
  };
  const n = norm([drop, d, 0]);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = P2(i, j), bb = P2(i + 1, j), c = P2(i + 1, j + 1), e = P2(i, j + 1);
    b.quadUV(a, bb, c, e, n, [su(a[2]), 0.7], [su(bb[2]), 0.7], [su(c[2]), 0.7], [su(e[2]), 0.7]);
  }
  // valance hanging from the front bar, scalloped along its lower edge (alpha)
  for (let i = 0; i < nu; i++) {
    const a = P2(i, nv), bb = P2(i + 1, nv);
    const a2 = [a[0] + 0.02, a[1] - val, a[2]], b2 = [bb[0] + 0.02, bb[1] - val, bb[2]];
    b.quadUV(a2, b2, bb, a, [1, 0, 0], [su(a[2]), 0.0], [su(bb[2]), 0.0], [su(bb[2]), 0.25], [su(a[2]), 0.25]);
  }
  metal.color(0xcfcdc6);
  const f0 = P2(0, nv), f1 = P2(nu, nv);
  cyl(metal, [f0[0], f0[1] + 0.01, f0[2]], [f1[0], f1[1] + 0.01, f1[2]], 0.018, 5, [0, 1, 0]);
  for (const z of [zc - w / 2 + 0.03, zc + w / 2 - 0.03]) {
    cyl(metal, [fx, yTop, z], [fx + d, yTop - drop, z], 0.016, 5, [0, 1, 0]);
    cyl(metal, [fx, yTop - drop - 0.35, z], [fx + d * 0.75, yTop - drop * 0.8, z], 0.013, 5, [0, 1, 0]);
  }
}

function buildPorch(S, B, ctx, rnd, L) {
  const { fx, z0, z1, scheme } = S;
  const paint = B.paint, metal = B.metal, terr = B.terrazzo;
  const px = PATIO_X, py = G + 0.45;
  const pz0 = z0 + 0.5 + (S.r0 > 0 ? S.r0 : 0), pz1 = z1 - 0.5 - (S.r1 > 0 ? S.r1 : 0);
  if (pz1 - pz0 < 5) return;
  const zc = L.zc;
  paint.w = [100, 3, 0.9];
  paint.e = [0, 0, 0];
  terr.quad([fx, py, pz0], [px, py, pz0], [px, py, pz1], [fx, py, pz1], UP);
  paint.color(darken(isWhite(scheme.body) ? COL.stoneGrey : scheme.body, 0.92));
  box(paint, fx - 0.1, px, G - 0.1, py, pz0, pz1, { '+y': true, '-x': true, '-y': true });
  const sw = L.doorW + 0.8;
  for (let i = 0; i < 3; i++) {
    const y = G + 0.15 * (i + 1), x1 = px + 0.32 * (3 - i);
    paint.color(COL.stoneGrey);
    box(paint, px - 0.05, x1, G - 0.05, y, zc - sw / 2, zc + sw / 2, { '+y': true, '-x': true, '-y': true });
    terr.quad([px - 0.05, y, zc - sw / 2], [x1, y, zc - sw / 2], [x1, y, zc + sw / 2], [px - 0.05, y, zc + sw / 2], UP);
  }
  // handrails beside the steps
  metal.color(0xd9d7d0);
  for (const s of [-1, 1]) {
    const z = zc + s * (sw / 2 - 0.08);
    cyl(metal, [px + 0.96, G + 0.95, z], [px, py + 0.9, z], 0.02, 5, [0, 1, 0]);
    cyl(metal, [px + 0.96, G, z], [px + 0.96, G + 0.95, z], 0.022, 5, [1, 0, 0]);
  }
  // low front wall (rounded cap, accent band) or pipe railing, open at the steps
  const rails = [[pz0, zc - sw / 2], [zc + sw / 2, pz1]];
  const wallCol = isWhite(scheme.body) ? (isWhite(scheme.trim) ? COL.white : lighten(scheme.trim, 0.35)) : lighten(scheme.body, 0.2);
  const bandCol = isWhite(scheme.trim) ? scheme.accent : scheme.trim;
  for (const [a, b] of rails) {
    if (b - a < 0.5) continue;
    if (S.rail === 'wall') {
      paint.color(wallCol);
      box(paint, px - 0.22, px, py, py + 0.62, a, b, { '-y': true });
      paint.color(COL.white);
      cyl(paint, [px - 0.11, py + 0.62, a], [px - 0.11, py + 0.62, b], 0.12, 8, [0, 1, 0], -Math.PI / 2, Math.PI / 2);
      paint.color(bandCol);
      box(paint, px - 0.005, px + 0.012, py + 0.36, py + 0.44, a, b);
      // porthole cut-outs / ring motifs along the wall
      for (let z = a + 1.2; z < b - 0.8; z += 2.4) {
        const tor = new THREE.TorusGeometry(0.16, 0.035, 5, 18);
        pushGeometry(paint, tor, new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(px + 0.015, py + 0.2, z));
        tor.dispose();
      }
    } else {
      // low stucco wall with a capped top, Deco grille panels above between square posts:
      // grouped vertical bars around a ring, flat top rail
      const wy = py + 0.42;
      paint.color(wallCol);
      box(paint, px - 0.22, px, py, wy, a, b, { '-y': true });
      paint.color(COL.white);
      box(paint, px - 0.26, px + 0.04, wy, wy + 0.06, a, b);
      const gcol = isWhite(scheme.trim) ? scheme.accent : scheme.trim;
      const np = Math.max(1, Math.round((b - a) / 1.25)), pw = (b - a) / np;
      const top = wy + 0.5, gx = px - 0.11;
      for (let i = 0; i <= np; i++) {
        const z = a + pw * i;
        paint.color(wallCol);
        box(paint, px - 0.24, px + 0.02, wy, top + 0.08, z - 0.1, z + 0.1);
        paint.color(COL.white);
        box(paint, px - 0.27, px + 0.05, top + 0.08, top + 0.13, z - 0.13, z + 0.13);
      }
      metal.color(gcol);
      box(metal, gx - 0.025, gx + 0.025, top - 0.03, top, a, b);
      box(metal, gx - 0.015, gx + 0.015, wy + 0.06, wy + 0.09, a, b);
      for (let i = 0; i < np; i++) {
        const zc2 = a + pw * (i + 0.5), yc = (wy + 0.09 + top - 0.03) / 2, rr = 0.13;
        const tor = new THREE.TorusGeometry(rr, 0.013, 4, 20);
        pushGeometry(metal, tor, new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(gx, yc, zc2));
        tor.dispose();
        for (const dz of [-0.07, 0, 0.07]) box(metal, gx - 0.008, gx + 0.008, wy + 0.09, yc - Math.sqrt(Math.max(0, rr * rr - dz * dz)), zc2 + dz - 0.008, zc2 + dz + 0.008);
        for (const dz of [-0.07, 0, 0.07]) box(metal, gx - 0.008, gx + 0.008, yc + Math.sqrt(Math.max(0, rr * rr - dz * dz)), top - 0.03, zc2 + dz - 0.008, zc2 + dz + 0.008);
        for (const s of [-1, 1]) for (const k of [0.3, 0.42]) {
          const z = zc2 + s * pw * k;
          box(metal, gx - 0.008, gx + 0.008, wy + 0.09, top - 0.03, z - 0.008, z + 0.008);
        }
        for (const s of [-1, 1]) box(metal, gx - 0.008, gx + 0.008, yc - 0.008, yc + 0.008, zc2 + s * rr, zc2 + s * pw * 0.42);
      }
    }
    // planters with palms or shrubs at the wall ends
    paint.color(pick(rnd, [COL.white, bandCol, 0xd8d3c8]));
    for (const z of [a + 0.45, b - 0.45]) {
      box(paint, px - 0.8, px - 0.25, py, py + 0.5, z - 0.3, z + 0.3, { '-y': true });
      if (rnd() < 0.5) ctx.shrubs.push({ x: px - 0.52, y: py + 0.58, z, s: 0.5 + rnd() * 0.2 });
      else ctx.palms.push({ x: px - 0.52, y: py + 0.5, z, s: 0.9 + rnd() * 0.4, pot: false });
    }
  }
  // potted palms flanking the steps, a menu board on the sidewalk
  for (const s of [-1, 1]) ctx.palms.push({ x: px - 0.45, y: py, z: zc + s * (sw / 2 + 0.45), s: 1.1 + rnd() * 0.4, pot: true, potCol: pick(rnd, [0xe9e6de, 0xb8704f, 0x4d4a46, 0xe9e6de]) });
  if (!S.noSidewalk) {
    // A-frame chalkboard: two leaves meeting at the top
    const mz = zc + (rnd() < 0.5 ? -1 : 1) * (sw / 2 + 0.7), mx = px + 0.5;
    for (const s of [-1, 1]) {
      const Yv = norm([-s * 0.2, 1, 0]);
      const Xv = norm([1, s * 0.2, 0]);
      metal.color(0x5a4430);
      lbox(metal, { o: [mx + s * 0.18, G, mz], X: Xv, Y: Yv, Z: [0, 0, 1] }, -0.015, 0.015, 0, 0.92, -0.28, 0.28);
      metal.color(0x2b2d2c);
      lbox(metal, { o: [mx + s * 0.18, G, mz], X: [s * Xv[0], s * Xv[1], 0], Y: Yv, Z: [0, 0, 1] }, 0.015, 0.02, 0.1, 0.84, -0.23, 0.23);
    }
  }
  // cafe tables packed along the porch: two-tops, two rows where it is deep enough
  const depth = px - fx;
  if (S.patio !== 'none' && depth > 1.5) {
    const rows = depth > 2.6 ? [fx + 0.9, px - 0.75] : [fx + Math.min(depth * 0.55, 1.4)];
    for (const tx of rows) {
      for (let z = pz0 + 0.9; z < pz1 - 0.7; z += 1.3 + rnd() * 0.25) {
        if (Math.abs(z - zc) < sw / 2 + 0.5) continue;
        tableSet(ctx, rnd, tx, py, z, 2, 'square', Math.PI / 2);
      }
    }
  }
  // bulbs strung under a full-length canopy
  if (S.canopy === 'full' && rnd() < 0.7) {
    const y = G + S.gH - 0.45;
    festoon(ctx, B.wire, [fx + 1.15, y, pz0 + 0.3], [fx + 1.15, y, zc - 1.2], 0.18);
    festoon(ctx, B.wire, [fx + 1.15, y, zc + 1.2], [fx + 1.15, y, pz1 - 0.3], 0.18);
  }
  if (S.noSidewalk || S.patio === 'porch') return;
  // dense sidewalk cafe: two rows of tables between the porch and the walkway,
  // covered according to the house (umbrellas, white tents, a stretched canopy, awnings)
  const segs = [[pz0 + 0.2, zc - sw / 2 - 0.9], [zc + sw / 2 + 0.9, pz1 - 0.2]].filter(([a, b]) => b - a > 1.8);
  const xs = [px + 0.85, px + 2.25];
  for (const [a, b] of segs) {
    for (const x of xs) {
      for (let z = a + 0.6; z < b - 0.5; z += 1.35 + rnd() * 0.25) tableSet(ctx, rnd, x, G, z, rnd() < 0.6 ? 2 : 4, 'square', rnd() < 0.7 ? Math.PI / 2 : rnd() * 0.3);
    }
    // planters along the walkway edge
    for (let z = a + 0.4; z < b; z += 2.8 + rnd() * 0.6) {
      paint.color(pick(rnd, [COL.white, 0xd8d3c8, isWhite(scheme.trim) ? scheme.accent : scheme.trim]));
      box(paint, px + 2.95, px + 3.35, G, G + 0.55, z - 0.35, z + 0.35, { '-y': true });
      ctx.shrubs.push({ x: px + 3.15, y: G + 0.62, z, s: 0.45 + rnd() * 0.15 });
    }
  }
  const ux = px + 1.55;
  if (S.patio === 'umbrella') {
    // big square umbrellas, edges overlapping; the odd one in a second colour
    const alt = pick(rnd, UMBRELLA_COLS);
    for (const [a, b] of segs) {
      const n = Math.max(1, Math.round((b - a) / 2.45));
      const st = (b - a) / n;
      const first = ctx.umbrellas.length;
      for (let i = 0; i < n; i++) {
        const z = a + st * (i + 0.5);
        ctx.umbrellas.push({ x: ux, y: G, z, color: rnd() < 0.8 ? S.umbrellaCol : alt, r: Math.min(1.4, st * 0.56), h: 2.4 + rnd() * 0.15 });
      }
      const us = ctx.umbrellas.slice(first);
      for (let i = 0; i < us.length - 1; i++) festoon(ctx, B.wire, [ux, G + us[i].h - 0.35, us[i].z], [ux, G + us[i + 1].h - 0.35, us[i + 1].z], 0.25);
    }
  } else if (S.patio === 'tent') {
    for (const [a, b] of segs) tentRow(ctx, B.fabric, B.wire, px + 0.25, px + 2.95, a, b, S.tentCol ?? 0xf2efe8);
  } else if (S.patio === 'canopy') {
    const yTop = (S.canopy === 'full' ? G + S.gH - 0.4 : G + S.gH - 0.25);
    // separate sagging bays (never one sheet), the house colour with the odd second colour
    const alt = S.canopyAlt ?? pick(rnd, [0xe07a9a, 0x4fa36a, 0xf1eee6]);
    const striped = rnd() < 0.4;
    for (const [a, b] of segs) {
      const d = px + 3.0 - fx;
      const nb = Math.max(1, Math.round((b - a) / 3.8));
      const bw = (b - a) / nb;
      for (let k = 0; k < nb; k++) {
        const z0 = a + bw * k;
        awning(B.fabric, B.wire, fx, z0 + bw / 2, bw - 0.28, yTop - (k % 2) * 0.06, d, k % 3 === 2 ? alt : S.canopyCol, striped, rnd, 1.0);
      }
      metal.color(0xd8d6cf);
      for (let i = 0; i <= nb; i++) cyl(metal, [fx + d, G, a + 0.05 + (b - a - 0.1) * (i / nb)], [fx + d, yTop - 1.0, a + 0.05 + (b - a - 0.1) * (i / nb)], 0.035, 6, [1, 0, 0]);
      festoon(ctx, B.wire, [fx + d - 0.1, yTop - 1.05, a + 0.2], [fx + d - 0.1, yTop - 1.05, b - 0.2], 0.12);
    }
  }
  // second menu board at the other end
  const mz2 = pz1 - 0.9, mx2 = px + 3.6;
  for (const s of [-1, 1]) {
    const Yv = norm([-s * 0.2, 1, 0]), Xv = norm([1, s * 0.2, 0]);
    metal.color(0x5a4430);
    lbox(metal, { o: [mx2 + s * 0.18, G, mz2], X: Xv, Y: Yv, Z: [0, 0, 1] }, -0.015, 0.015, 0, 0.92, -0.28, 0.28);
    metal.color(0x2b2d2c);
    lbox(metal, { o: [mx2 + s * 0.18, G, mz2], X: [s * Xv[0], s * Xv[1], 0], Y: Yv, Z: [0, 0, 1] }, 0.015, 0.02, 0.1, 0.84, -0.23, 0.23);
  }
}

// Row of white peaked cafe tents (ref06): pyramid roofs on thin posts, scalloped valance.
function tentRow(ctx, b, metal, x0, x1, za, zb, color) {
  const n = Math.max(1, Math.round((zb - za) / 2.8));
  const st = (zb - za) / n, eave = G + 2.45, apex = eave + 0.75, val = 0.28;
  const xc = (x0 + x1) / 2;
  b.color(color);
  const tuv = (p) => [100 + p[2] / 0.64, 0.7];
  for (let i = 0; i < n; i++) {
    const z0 = za + st * i, z1 = z0 + st, zc = (z0 + z1) / 2;
    const A = [xc, apex, zc];
    const c = [[x0, eave, z0], [x1, eave, z0], [x1, eave, z1], [x0, eave, z1]];
    for (let k = 0; k < 4; k++) {
      const p = c[k], q = c[(k + 1) % 4];
      const n0 = norm(cross(sub(q, p), sub(A, p)));
      const nn = n0[1] < 0 ? neg(n0) : n0;
      b.v(p, nn, tuv(p)); b.v(q, nn, tuv(q)); b.v(A, nn, tuv(A));
    }
    // valance on the street side and the ends
    for (const [p, q, nv] of [[c[1], c[2], [1, 0, 0]], [c[0], c[1], [0, 0, -1]], [c[3], c[2], [0, 0, 1]]]) {
      const u0 = 100 + (p[2] + p[0]) / 0.64, u1 = 100 + (q[2] + q[0]) / 0.64;
      b.quadUV([p[0], p[1] - val, p[2]], [q[0], q[1] - val, q[2]], q, p, nv, [u0, 0.0], [u1, 0.0], [u1, 0.25], [u0, 0.25]);
    }
    metal.color(0xe6e4de);
    for (const p of c) cyl(metal, [p[0], G, p[2]], [p[0], eave, p[2]], 0.03, 5, [1, 0, 0]);
  }
  festoon(ctx, metal, [x1 - 0.05, eave - 0.05, za + 0.1], [x1 - 0.05, eave - 0.05, zb - 0.1], 0.05);
}

// Catenary wire with bulbs every ~0.6 m.
function festoon(ctx, metal, a, b, sagK) {
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const n = Math.max(2, Math.round(L / 0.6));
  metal.color(0x2a2826);
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sagK * L * 0.15 * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
    if (prev) cyl(metal, prev, p, 0.006, 3, [1, 0, 0]);
    if (i > 0 && i < n) ctx.bulbs.push({ x: p[0], y: p[1] - 0.07, z: p[2] });
    prev = p;
  }
}

function tableSet(ctx, rnd, x, y, z, chairs, kind = 'round', rot0 = null) {
  const a0 = rot0 ?? rnd() * Math.PI * 2;
  ctx.tables.push({ x, y, z, rot: a0, kind });
  const chairCol = ctx.chairCol;
  for (let i = 0; i < chairs; i++) {
    const a = a0 + (i / chairs) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
    const r = 0.58 + rnd() * 0.12;
    ctx.chairs.push({ x: x + Math.cos(a) * r, y, z: z + Math.sin(a) * r, rot: -a - Math.PI / 2 + (rnd() - 0.5) * 0.5, color: chairCol });
  }
}

// ---------------------------------------------------------------------------
// Materials
function paintMaterial() {
  // Smooth painted stucco: broad soft albedo patches, a normal map carrying only low,
  // wide trowel undulation (visible at grazing light), barely any fine grain.
  const map = noiseColorTexture({ size: 512, seed: 91, colorA: [242, 240, 236], colorB: [255, 255, 255], baseCells: 3, speckle: 0.004, contrast: 1.0 });
  map.repeat.set(1 / 7.0, 1 / 7.0);
  // fine sand-finish grain (1 m tile, ~3-10 mm grains); the broad trowel undulation is
  // procedural in the shader
  const normalMap = noiseNormalTexture({ size: 512, seed: 17, baseCells: 48, strength: 0.11, octaves: 3 });
  normalMap.repeat.set(1.0, 1.0);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map, normalMap, normalScale: new THREE.Vector2(0.32, 0.32), roughness: 0.9 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aW;\nattribute vec3 aE;\nattribute vec4 aB;\nvarying vec3 vOdW;\nvarying vec3 vOdE;\nvarying vec4 vOdB;\nvarying vec3 vOdP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvOdW = aW;\nvOdE = aE;\nvOdB = aB;\nvOdP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vOdW;
        varying vec3 vOdE;
        varying vec4 vOdB;
        varying vec3 vOdP;
        float odVh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float odVn(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(odVh(i), odVh(i + vec2(1.0, 0.0)), f.x), mix(odVh(i + vec2(0.0, 1.0)), odVh(i + vec2(1.0, 1.0)), f.x), f.y);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // pastel (or white) bands on the facade: window strips (1) or the spandrels and
        // parapet between them (2)
        if (vOdB.w > 0.5 && vOdE.x > 0.0) {
          float up = vOdP.y - vOdW.x;
          float lf = mod(up, vOdW.y);
          float aa = 0.012;
          float strip = smoothstep(0.52 - aa, 0.52 + aa, lf) * (1.0 - smoothstep(vOdE.x - aa, vOdE.x + aa, lf))
                      * step(0.0, up) * step(vOdP.y, vOdE.y + 0.05);
          float spand = step(0.0, up) * (1.0 - strip) * step(vOdP.y, vOdE.z - 0.15 + step(vOdE.z, 0.0) * 1000.0);
          float zone = vOdB.w < 1.5 ? strip : spand;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb / max(vColor.rgb, vec3(0.02)) * vOdB.rgb, zone);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // low, wide trowel undulation of hand-applied stucco
          vec3 gn = inverseTransformDirection(normal, viewMatrix);
          if (abs(gn.y) < 0.6) {
            vec3 Tw = normalize(cross(vec3(0.0, 1.0, 0.0), gn));
            vec2 q = vec2(dot(vOdP, Tw), vOdP.y) * 0.9;
            float e = 0.35;
            float n0 = odVn(q) + 0.5 * odVn(q * 2.3 + 5.0);
            float gx = (odVn(q + vec2(e, 0.0)) + 0.5 * odVn((q + vec2(e, 0.0)) * 2.3 + 5.0)) - n0;
            float gy = (odVn(q + vec2(0.0, e)) + 0.5 * odVn((q + vec2(0.0, e)) * 2.3 + 5.0)) - n0;
            vec3 dW = (Tw * gx + vec3(0.0, gy, 0.0)) * 0.09;
            normal = normalize(normal - (viewMatrix * vec4(dW, 0.0)).xyz);
          }
        }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        {
          vec3 wn = inverseTransformDirection(normal, viewMatrix);
          float vert = 1.0 - abs(wn.y);
          float hb = max(vOdP.y - ${G.toFixed(2)}, 0.0);
          float along = abs(wn.x) > abs(wn.z) ? vOdP.z : vOdP.x;
          // broad patchiness of repainted stucco
          float pch = odVn(vec2(along, vOdP.y) * 0.45) * 0.6 + odVn(vec2(along, vOdP.y) * 1.7) * 0.4;
          // faint rain streaks running down from each ledge (upper floors)
          float up = vOdP.y - vOdW.x;
          float fy = up > 0.0 ? mod(up, vOdW.y) / vOdW.y : 0.0;
          float streak = smoothstep(0.55, 0.9, odVn(vec2(along * 4.0, vOdP.y * 0.22)));
          float st = streak * smoothstep(0.15, 0.8, fy) * (1.0 - smoothstep(0.8, 0.86, fy)) * step(0.0, up);
          // grime splashed up at the foot of the wall, ragged upper edge
          float dirt = exp(-hb / (0.3 + 0.45 * odVn(vec2(along * 1.3, 2.0)))) * (0.6 + 0.4 * odVn(vec2(along * 3.0, vOdP.y * 2.0)));
          // broad water stains
          float stain = smoothstep(0.55, 0.85, odVn(vec2(along * 0.35, vOdP.y * 0.6) + 7.0)) * smoothstep(0.4, 0.7, odVn(vec2(along * 1.4, vOdP.y * 2.2)));
          float k = (1.0 - 0.09 * st * vOdW.z * vert - 0.42 * dirt * vOdW.z * vert - 0.06 * stain * vOdW.z * vert) * (0.975 + 0.04 * pch);
          // patched / repainted rectangles of a slightly different tint
          vec2 pc = vec2(along / 2.9 + odVh(vec2(floor(vOdP.y / 1.7), 5.0)) * 3.0, vOdP.y / 1.7);
          vec2 pci = floor(pc), pf = fract(pc);
          float ph = odVh(pci + 17.3);
          vec2 ps = vec2(0.2 + 0.6 * odVh(pci + 3.1), 0.25 + 0.5 * odVh(pci + 8.7));
          vec2 pd = abs(pf - 0.5) - ps * 0.5;
          float pm = step(0.72, ph) * (1.0 - smoothstep(-0.015, 0.0, max(pd.x, pd.y))) * vert;
          vec3 tint = mix(vec3(1.0), ph > 0.86 ? vec3(1.04, 1.035, 1.02) : vec3(0.94, 0.94, 0.95), pm);
          // under each eyebrow and the coping: a crisp sliver of sun shadow and a softer
          // band where the slab hides the sky
          float dl = 100.0;
          if (vOdE.x > 0.0) {
            float t = (vOdP.y - vOdW.x - vOdE.x) / vOdW.y;
            float ey = vOdW.x + vOdE.x + ceil(t) * vOdW.y;
            if (ey <= vOdE.y) dl = ey - vOdP.y;
            // wall peeking through the seam just above an eyebrow's underside
            float eb = vOdW.x + vOdE.x + floor(t) * vOdW.y;
            if (eb <= vOdE.y && vOdP.y - eb < 0.1 && t >= 0.0) dl = 0.0;
          }
          if (vOdE.z > 0.0 && vOdP.y < vOdE.z - 0.12) dl = min(dl, vOdE.z - 0.12 - vOdP.y);
          dl = max(dl, 0.0);
          float lsh = (1.0 - smoothstep(0.1, 0.26, dl)) * vert;
          float lao = exp(-dl / 0.5) * vert;
          reflectedLight.directDiffuse *= k * tint * (1.0 - 0.92 * lsh);
          reflectedLight.indirectDiffuse *= k * tint * (1.0 - 0.65 * lao);
          // skylight in shade: a cooler, bluish version of the wall colour, not a violet one
          {
            vec3 irr = reflectedLight.indirectDiffuse / max(diffuseColor.rgb, vec3(0.02));
            float irL = dot(irr, vec3(0.3, 0.59, 0.11));
            // sun-facing walls see the peach solar dome and sunlit sand, not the lilac anti-solar
            // sky: a weaker, warm fill there keeps the lit fronts saturated amber-peach
            float sfd = smoothstep(0.1, 0.8, dot(normalize(wn.xz + 1e-5), normalize(OD_SUN.xz))) * vert;
            irr = mix(mix(irr, irL * vec3(0.9, 0.98, 1.1), 0.55), irL * vec3(1.05, 0.96, 0.86) * 0.6, sfd);
            reflectedLight.indirectDiffuse = irr * diffuseColor.rgb;
          }
          // less sky seen low in the street; contact occlusion at the foot
          float ao = (0.72 + 0.28 * smoothstep(0.0, 9.0, hb)) * (1.0 - 0.4 * exp(-hb / 0.4) * vert);
          reflectedLight.indirectDiffuse *= ao;
          float sunFace = 1.0;
          #ifdef USE_FOG
          // the normal map must not let a grazing sun onto faces that cannot see it
          // (ledge undersides sparkled)
          vec3 gnW = inverseTransformDirection(normalize(vNormal), viewMatrix);
          reflectedLight.directDiffuse *= smoothstep(-0.01, 0.06, dot(gnW, OD_SUN));
          // walls turned from the sun see the dim blue anti-solar sky and shaded ground only
          sunFace = dot(normalize(wn.xz + 1e-5), normalize(OD_SUN.xz));
          // (plus light off the sunlit fronts and pavement across the street)
          reflectedLight.indirectDiffuse *= mix(vec3(1.0), vec3(1.55, 1.6, 1.72), smoothstep(0.1, -0.3, sunFace) * vert);
          // sunlit fronts: as warm and saturated as the lit sand (a 7 deg sun through ~30
          // air masses is amber, and the pale paint must not tone-map to washed cream)
          {
            float odSf = smoothstep(0.2, 0.85, sunFace) * vert;
            reflectedLight.directDiffuse *= mix(vec3(1.0), vec3(1.0, 0.83, 0.64), odSf);
            reflectedLight.indirectDiffuse *= mix(vec3(1.0), vec3(1.0, 0.9, 0.78), odSf);
          }
          #endif
          // light bounced off the sunlit sidewalk and street onto the lower facade
          reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.10, 0.075, 0.055) * exp(-hb / 2.5) * vert * (0.3 + 0.7 * smoothstep(-0.3, 0.5, sunFace));
          // slab undersides see the sunlit wall and pavement below them
          reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.26, 0.19, 0.13) * max(-wn.y, 0.0);
        }`);
  };
  m.customProgramCacheKey = () => 'hotel-paint-v3';
  return m;
}

function glassMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x0a0c0f, roughness: 0.08, metalness: 0.0, envMapIntensity: 0 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aWin;\nflat varying vec4 vWin;\nvarying vec2 vGUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin;\nvGUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        flat varying vec4 vWin;
        varying vec2 vGUv;
        float odGh(float x) { return fract(sin(x * 91.73) * 43758.5453); }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float odTy = vWin.x > 9.5 ? vWin.x - 10.0 : vWin.x;
        if (odTy > 3.5 && odTy < 4.5 && length(vGUv - 0.5) > 0.5) discard;`)
      .replace('#include <opaque_fragment>', `
        #ifdef USE_FOG
        {
          float isG = step(9.5, vWin.x);
          float type = odTy;
          bool round = type > 3.5 && type < 4.5;
          if (round) type = 0.0;
          float s = vWin.w;
          vec2 uv = vGUv;
          vec3 nW = normalize(inverseTransformDirection(normal, viewMatrix));
          vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), nW) + 1e-5);
          // panes are never coplanar: a per-pane tilt plus the slow roller wave of old
          // float glass, so every pane shows a different, slightly bent piece of the scene
          float ta = (odGh(s * 7.13) - 0.5) * 0.11 + sin(uv.x * 3.1 + s * 23.0) * 0.022;
          float tb = (odGh(s * 3.71) - 0.5) * 0.11 + sin(uv.y * 4.3 + s * 41.0) * 0.03 + sin(uv.x * 7.0 + uv.y * 2.0 + s * 9.0) * 0.008;
          vec3 nT = normalize(nW + T * ta + vec3(0.0, tb, 0.0));
          vec3 I = normalize(vFogOffset);
          vec3 R = reflect(I, nT);
          float cosT = clamp(dot(-I, nT), 0.0, 1.0);
          vec3 wp = cameraPosition + vFogOffset;

          // glazing kinds: clear (reads nearly black), tinted, and the odd mirror-film pane
          float h0 = odGh(s * 5.31);
          // (old float glass behind screens and a haze of salt: even "clear" panes mirror a
          // good share of the bright sky, reading mid grey-blue rather than black)
          float F0 = h0 < 0.4 ? 0.13 + 0.08 * h0 : h0 < 0.74 ? 0.2 + 0.3 * (h0 - 0.4) : 0.5 + 0.9 * (h0 - 0.74);
          if (round) F0 = max(F0, 0.2);
          if (isG > 0.5) F0 = 0.14 + 0.1 * h0;
          vec3 tint = h0 < 0.4 ? vec3(1.0) : h0 < 0.74 ? mix(vec3(0.82, 0.93, 0.9), vec3(0.8, 0.84, 0.92), odGh(s * 2.9)) : mix(vec3(0.86, 0.93, 1.0), vec3(1.0, 0.9, 0.72), odGh(s * 17.0));
          float F = F0 + (1.0 - F0) * pow(1.0 - cosT, 5.0);
          F = min(1.0, F * 1.5 + 0.05);   // salt-hazed old glass mirrors plenty of sky at these angles

          // reflected scene: sky dome incl. the sun's glare, the ground, and across the road
          // palm trunks / crowns, hedges and parked cars as silhouettes
          vec3 Rs = normalize(vec3(R.x, max(R.y, 0.0), R.z));
          vec3 sky = odSkyBase(Rs, 0.0) + odSunGlow(dot(Rs, OD_SUN), 0.0, 0.5);
          float azc = atan(R.z, R.x) * 7.0 + s * 0.6 + wp.z * 0.05;
          float cell = floor(azc), fc = fract(azc) - 0.5;
          float hp = odGh(cell + 3.7);
          float D = 14.0 + 22.0 * odGh(cell + 11.1);
          float crownEl = (7.5 + 3.5 * odGh(cell + 5.5) - wp.y) / D;
          float trunk = (1.0 - smoothstep(0.03, 0.055, abs(fc + 0.6 * R.y * (odGh(cell) - 0.5)))) * step(R.y, crownEl);
          vec2 cq = vec2(fc * 1.05, (R.y - crownEl) * D * 0.22);
          cq.y += 0.9 * cq.x * cq.x;
          float cr = length(cq * vec2(1.0, 1.5)), cph = atan(cq.y, cq.x);
          float leafy = cr * (1.0 + 0.45 * sin(cph * 7.0 + cell) * sin(cph * 3.0 - cell * 0.7));
          float crown = 1.0 - smoothstep(0.24, 0.4, leafy);
          float palm = step(0.35, hp) * max(trunk, crown);
          float lowEl = (1.3 + 0.5 * odGh(floor(azc * 3.0)) - wp.y) / (10.0 + 4.0 * odGh(cell + 1.3));
          float hedge = step(R.y, lowEl) * step(-0.02, R.y);
          vec3 ground = mix(vec3(0.16, 0.13, 0.10), vec3(0.075, 0.072, 0.07), smoothstep(-0.03, -0.25, R.y));
          vec3 refl = mix(sky, ground, smoothstep(0.012, -0.012, R.y));
          refl = mix(refl, vec3(0.07, 0.08, 0.05), hedge * 0.9);
          refl = mix(refl, vec3(0.07, 0.065, 0.05), palm * 0.9 * step(-0.02, R.y));
          // sun glints: a few panes tilted just right catch the low sun
          refl += OD_SUNCOL * 6.0 * pow(max(dot(R, OD_SUN), 0.0), 900.0) * step(0.8, odGh(s * 31.7));
          refl *= tint;

          // what is behind the glass: rooms are dark next to a sunlit wall
          float sunIn = max(dot(nW, OD_SUN), 0.0);
          vec3 room = vec3(0.05, 0.047, 0.044) * (0.6 + 0.8 * uv.y) * (0.6 + 0.8 * odGh(vWin.z * 13.7))
                    + directLight.color * sunIn * 0.004 * smoothstep(0.2, 0.6, uv.y);
          vec3 lightIn = directLight.color * sunIn * 0.08 + vec3(0.03, 0.03, 0.035);
          float pk = fract(vWin.z * 3.0);
          vec3 cur = pk < 0.35 ? vec3(0.74, 0.73, 0.70) : pk < 0.55 ? vec3(0.66, 0.60, 0.50)
                   : pk < 0.7 ? vec3(0.45, 0.56, 0.58) : pk < 0.82 ? vec3(0.66, 0.50, 0.48)
                   : pk < 0.92 ? vec3(0.40, 0.42, 0.50) : vec3(0.55, 0.60, 0.46);
          cur *= 0.85 + 0.15 * vWin.z;
          vec3 inner = room;
          float open = 0.0;
          if (type > 0.5 && type < 1.5) {          // blinds: slat pitch, tilt, colour, direction vary
            float h1 = odGh(s * 11.7), h2 = odGh(s * 23.1);
            float cover = step(1.0 - vWin.y, uv.y);
            float vert = step(0.72, h2);
            float coord = mix(uv.y, uv.x, vert);
            cover = mix(cover, 1.0, vert * step(0.3, vWin.y));
            float cyc = coord * mix(14.0, 34.0, h1);
            float sl = smoothstep(0.25, 0.55, fract(cyc));
            sl = mix(sl, 0.55, smoothstep(0.25, 0.6, fwidth(cyc)));   // no moire when slats go sub-pixel
            float slat = mix(0.55, 0.85, h1) + (1.0 - mix(0.55, 0.85, h1)) * sl;
            vec3 bc = mix(vec3(0.78, 0.76, 0.72), cur, step(0.5, h2));
            inner = mix(room, bc * lightIn * slat, cover);
          } else if (type > 1.5 && type < 2.5) {   // curtains drawn to the sides
            float hf = vWin.y * 0.5;
            float cover = step(uv.x, hf) + step(1.0 - hf, uv.x);
            float fold = 0.75 + 0.25 * sin(uv.x * 70.0 + s * 9.0) * (1.0 - smoothstep(0.2, 0.5, fwidth(uv.x * 11.0)));
            inner = mix(room, cur * lightIn * fold, clamp(cover, 0.0, 1.0));
          } else if (type > 2.5 && type < 3.5) {   // sheer curtain
            inner = mix(room, cur * lightIn * (0.8 + 0.2 * sin(uv.x * 90.0) * (1.0 - smoothstep(0.2, 0.5, fwidth(uv.x * 14.0)))), vWin.y * 0.7);
          } else if (type > 5.5 && type < 6.5) {   // lobby / shop: deep and dim, a few lamps far inside
            float lamp = step(0.93, odGh(floor(uv.x * 6.0) + s * 7.0)) * smoothstep(0.55, 0.75, uv.y) * (1.0 - smoothstep(0.8, 0.9, uv.y));
            // faint lobby: pale floor near the glass, a counter band, lamps deeper in
            float floorB = smoothstep(0.3, 0.0, uv.y);
            float counter = step(0.3, uv.y) * step(uv.y, 0.42) * step(0.3, fract(uv.x * 1.3 + s));
            inner = vec3(0.04, 0.036, 0.03) * (0.6 + 0.6 * uv.y) + vec3(0.07, 0.06, 0.05) * floorB
                  + vec3(0.05, 0.035, 0.025) * counter + vec3(0.12, 0.08, 0.04) * lamp;
          } else if (type > 6.5) {                  // casement left open
            open = 1.0;
            inner = room * 0.6;
          }
          if (isG > 0.5) inner *= 0.9;
          F *= 1.0 - open;
          outgoingLight = inner * tint * (1.0 - F) + refl * F;
        }
        #endif
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'hotel-glass-v3';
  return m;
}

function fabricMaterial() {
  // u: one stripe pair per unit (r = coloured stripe); v < 0.25: valance, its lower edge
  // cut into scallops (one per stripe) through alpha
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const img = c.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S, v = 1 - (y + 0.5) / S;
    const stripe = u < 0.5 ? 255 : 0;
    let a = 255;
    if (v < 0.25) {
      const vv = v / 0.25, x2 = (u * 2 % 1) * 2 - 1;
      a = vv > 0.42 * (1 - Math.sqrt(Math.max(0, 1 - x2 * x2))) + 0.04 ? 255 : 0;
    }
    const i = (y * S + x) * 4;
    img.data[i] = stripe; img.data[i + 1] = stripe; img.data[i + 2] = stripe; img.data[i + 3] = a;
  }
  c.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(cv);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.NearestFilter;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map, roughness: 0.85, side: THREE.DoubleSide, alphaTest: 0.5 });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', `
        vec4 odTx = texture2D(map, vMapUv);
        float odSt = vMapUv.x > 50.0 ? 1.0 : odTx.r;
        diffuseColor.rgb = mix(vec3(0.88, 0.87, 0.84), vColor.rgb, odSt);
        diffuseColor.a = odTx.a;`)
      .replace('#include <color_fragment>', '')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        #ifdef USE_FOG
        {
          // canvas glows with the sun shining through it
          vec3 wn = inverseTransformDirection(normal, viewMatrix);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * OD_SUNCOL * OD_SUN_I * 0.05 * max(-wn.y, 0.0);
        }
        #endif`);
  };
  m.customProgramCacheKey = () => 'hotel-fabric-v3';
  return m;
}

// Streaky dirt decals (AC drips, sill runs, coping drips). Alpha texture: top half long
// thin runs, bottom half broader softer ones; per-decal strength in the vertex colour r.
function grimeMaterial() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const img = c.createImageData(S, S);
  const rnd = mulberry32(606);
  for (const half of [0, 1]) {
    const cols = [];
    let x = 0;
    while (x < S) {
      const w = half ? 6 + rnd() * 18 : 2 + rnd() * 7;
      cols.push({ x0: x, x1: x + w, a: rnd() < 0.35 ? 0 : 0.35 + rnd() * 0.65, L: 0.3 + rnd() * 0.7 });
      x += w;
    }
    for (let y = 0; y < S / 2; y++) {
      const t = y / (S / 2);
      for (let xx = 0; xx < S; xx++) {
        const col = cols.find((k) => xx < k.x1);
        const e = Math.min(xx - col.x0, col.x1 - xx) / Math.max(1, (col.x1 - col.x0) * 0.5);
        const edge = Math.min(1, e * 1.5);
        const fall = t < col.L ? Math.pow(1 - t / col.L, half ? 0.7 : 1.1) : 0;
        const a = col.a * edge * fall * (0.8 + 0.2 * rnd());
        const i = ((y + half * S / 2) * S + xx) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * Math.min(1, a));
      }
    }
  }
  c.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({
    color: 0x463a2e, map, vertexColors: true, transparent: true, depthWrite: false, roughness: 0.95,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      diffuseColor.a *= min(vColor.r * 1.4, 0.9);
      // not one grey decal: soot-grey, rust-brown under metal, green-black algae runs
      vec3 odK = vColor.g < 0.5 ? mix(vec3(0.24, 0.22, 0.2), vec3(0.34, 0.26, 0.18), vColor.b)
               : vColor.g < 0.8 ? vec3(0.46, 0.27, 0.14) : vec3(0.18, 0.22, 0.14);
      diffuseColor.rgb = odK;
      diffuseColor.a *= vColor.g < 0.5 ? 1.0 : 0.75;`);
  };
  m.customProgramCacheKey = () => 'hotel-grime-v2';
  return m;
}

function terrazzoMaterial() {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d');
  c.fillStyle = '#e6dfd2'; c.fillRect(0, 0, size, size);
  const rnd = mulberry32(55);
  const chips = ['#b9b2a6', '#8f8a82', '#d7a9a2', '#9fc1b3', '#f3efe8', '#6f6a63', '#c9b48f'];
  for (let i = 0; i < 9000; i++) {
    c.fillStyle = chips[Math.floor(rnd() * chips.length)];
    const r = 0.6 + rnd() * rnd() * 3.2;
    c.beginPath();
    c.ellipse(rnd() * size, rnd() * size, r, r * (0.6 + rnd() * 0.4), rnd() * 3, 0, Math.PI * 2);
    c.fill();
  }
  // brass divider strips
  c.strokeStyle = 'rgba(170,135,70,0.8)'; c.lineWidth = 2;
  c.strokeRect(1, 1, size - 2, size - 2);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1 / 1.2, 1 / 1.2);
  map.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map, roughness: 0.4 });
}

function glassBlockMaterial() {
  const s = 256, n = 4;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const c = cv.getContext('2d');
  c.fillStyle = '#d9dcd8'; c.fillRect(0, 0, s, s);
  const cell = s / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const g = c.createRadialGradient(i * cell + cell * 0.45, j * cell + cell * 0.4, 2, i * cell + cell / 2, j * cell + cell / 2, cell * 0.6);
    g.addColorStop(0, '#dfeaec'); g.addColorStop(0.6, '#a9bcc2'); g.addColorStop(1, '#8aa0a8');
    c.fillStyle = g;
    c.fillRect(i * cell + 4, j * cell + 4, cell - 8, cell - 8);
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      c.beginPath(); c.moveTo(i * cell + 10, j * cell + 14 + k * 14);
      c.bezierCurveTo(i * cell + 24, j * cell + 8 + k * 14, i * cell + 40, j * cell + 22 + k * 14, i * cell + cell - 10, j * cell + 14 + k * 14);
      c.stroke();
    }
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1 / 0.8, 1 / 0.8);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.25 });
}

// ---------------------------------------------------------------------------
// Instanced furniture geometry
function chairGeometry() {
  const parts = [];
  const bx = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); parts.push(g); };
  // bistro chair: slatted seat in a frame, two back uprights with three curved-back
  // slats, splayed legs
  bx(0.42, 0.025, 0.03, 0, 0.45, 0.195); bx(0.42, 0.025, 0.03, 0, 0.45, -0.195);
  bx(0.03, 0.025, 0.42, 0.195, 0.45, 0); bx(0.03, 0.025, 0.42, -0.195, 0.45, 0);
  for (let i = 0; i < 5; i++) bx(0.36, 0.018, 0.06, 0, 0.455, -0.15 + i * 0.075);
  for (const x of [-0.19, 0.19]) bx(0.028, 0.46, 0.028, x, 0.69, -0.21);
  for (let i = 0; i < 3; i++) {
    const y = 0.64 + i * 0.1;
    for (let k = 0; k < 4; k++) bx(0.1, 0.05, 0.02, -0.15 + k * 0.1, y, -0.215 - 0.018 * Math.cos((k - 1.5) * 0.7));
  }
  for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
    const g = new THREE.CylinderGeometry(0.012, 0.014, 0.46, 5);
    g.rotateZ(-x * 0.25).rotateX(z * 0.25).translate(x * 1.06, 0.225, z * 1.06);
    parts.push(g.toNonIndexed());
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}
function tableGeometry() {
  const top = new THREE.BoxGeometry(0.7, 0.03, 0.7); top.translate(0, 0.745, 0);
  const pole = new THREE.CylinderGeometry(0.03, 0.03, 0.72, 6); pole.translate(0, 0.37, 0);
  const base = new THREE.CylinderGeometry(0.22, 0.25, 0.03, 12); base.translate(0, 0.015, 0);
  return mergeGeometries([top.toNonIndexed(), pole.toNonIndexed(), base.toNonIndexed()]);
}
// Square market umbrella (half-size 1 before scaling): four panels on diagonal ribs,
// the cloth sagging between the ribs, and a straight valance all round.
function umbrellaGeometry() {
  const n = 12;
  const g = new THREE.PlaneGeometry(2, 2, n, n).rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const r = Math.max(Math.abs(x), Math.abs(z));
    const q = r > 1e-4 ? Math.min(Math.abs(x), Math.abs(z)) / r : 1;
    p.setY(i, 0.34 * (1 - r) - 0.07 * r * (1 - q));
  }
  const parts = [g.toNonIndexed()];
  for (let s = 0; s < 4; s++) {
    const v = new THREE.PlaneGeometry(2, 0.2).translate(0, -0.1, 1).rotateY((s * Math.PI) / 2);
    parts.push(v.toNonIndexed());
  }
  const m = mergeGeometries(parts);
  m.computeVertexNormals();
  return m;
}
// Small potted palm: short trunk, a dozen arching fronds (unit height ~1.3 m).
// Potted areca palm: a clump of thin cane stems splaying out of the pot, each ending in
// an arching feathery frond of many fine leaflets (unit height ~1.5 m).
function pottedPalmGeometry() {
  const rnd = mulberry32(12);
  const P = [];
  const tri = (a, b, c) => P.push(...a, ...b, ...c);
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
  // bushy uneven clump: many arching stems of different heights, leaning unevenly
  for (let f = 0; f < 17; f++) {
    const az = rnd() * Math.PI * 2, spread = 0.1 + rnd() * 0.45;
    const ca = Math.cos(az), sa = Math.sin(az);
    const h = 0.3 + rnd() * rnd() * 0.9;
    // cane: thin 3-sided stem, leaning out
    const s0 = [0, 0, 0], s1 = [ca * spread * h, h, sa * spread * h];
    for (let k = 0; k < 3; k++) {
      const a0 = (k / 3) * Math.PI * 2, a1 = ((k + 1) / 3) * Math.PI * 2, r = 0.012;
      const o0 = [Math.cos(a0) * r, 0, Math.sin(a0) * r], o1 = [Math.cos(a1) * r, 0, Math.sin(a1) * r];
      quad([s0[0] + o0[0], 0, s0[2] + o0[2]], [s0[0] + o1[0], 0, s0[2] + o1[2]], [s1[0] + o1[0], s1[1], s1[2] + o1[2]], [s1[0] + o0[0], s1[1], s1[2] + o0[2]]);
    }
    // frond: rachis continues up and out, arching over; 24 pairs of fine leaflets
    const len = 0.5 + rnd() * 0.5, nL = 26;
    const rib = (t) => {
      const L = t * len;
      return [s1[0] + ca * L * (0.35 + spread), s1[1] + 0.5 * L - 1.3 * L * L, s1[2] + sa * L * (0.35 + spread)];
    };
    const side = [-sa, 0, ca];
    for (let k = 1; k <= nL; k++) {
      const t = k / (nL + 1), c = rib(t), c2 = rib(Math.min(1, t + 0.02));
      const ll = 0.24 * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.1)) * (1 - 0.3 * t) + 0.04;
      for (const sg of [-1, 1]) {
        const tip = [c[0] + side[0] * sg * ll * 0.8 + ca * ll * 0.35, c[1] - ll * (0.45 + 0.3 * t), c[2] + side[2] * sg * ll * 0.8 + sa * ll * 0.35];
        tri(c, c2, tip);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((P.length / 3) * 2).fill(0), 2));
  g.computeVertexNormals();
  return g;
}
// Leafy shrub: a dark, lumpy core (the shade inside the bush) wrapped in ~90 alpha
// leaf-spray cards facing outward, lit with radial normals so the clump reads round
// but ragged, with gaps and individual leaves at the silhouette.
let LEAF_TEX = null;
function leafTexture() {
  if (LEAF_TEX) return LEAF_TEX;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  const rnd = mulberry32(515);
  c.fillStyle = '#2c3a22'; c.fillRect(0, 0, 8, 8);           // opaque core swatch
  for (let i = 0; i < 26; i++) {
    const x = 18 + rnd() * 96, y = 18 + rnd() * 96, a = rnd() * Math.PI, l = 10 + rnd() * 9;
    const v = 150 + rnd() * 105;
    c.fillStyle = `rgb(${v * 0.82 | 0},${v | 0},${v * 0.7 | 0})`;
    c.beginPath(); c.ellipse(x, y, l, l * 0.42, a, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(40,50,30,0.5)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  }
  LEAF_TEX = new THREE.CanvasTexture(cv);
  LEAF_TEX.colorSpace = THREE.SRGBColorSpace;
  return LEAF_TEX;
}
function shrubGeometry() {
  const rnd = mulberry32(8181);
  const core = mergeVertices(new THREE.IcosahedronGeometry(0.4, 2).deleteAttribute('normal').deleteAttribute('uv'));
  const cp = core.attributes.position;
  const v = new THREE.Vector3();
  const lobe = (d) => 0.86 + 0.12 * Math.sin(d.x * 5.1 + 1.3) * Math.sin(d.z * 4.3 + 0.7) + 0.08 * Math.sin(d.y * 6.0 + d.x * 3.0);
  for (let i = 0; i < cp.count; i++) {
    v.fromBufferAttribute(cp, i).normalize();
    const r = 0.4 * lobe(v) * (0.9 + 0.12 * rnd());
    cp.setXYZ(i, v.x * r, v.y * r * (v.y < -0.3 ? 0.7 : 0.92), v.z * r);
  }
  core.computeVertexNormals();
  const cn = core.index ? core.toNonIndexed() : core;
  cn.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(cn.attributes.position.count * 2).fill(0.02), 2));
  const pos = [], nor = [], uv = [];
  const n = new THREE.Vector3(), t = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let k = 0; k < 90; k++) {
    n.set(rnd() * 2 - 1, rnd() * 1.6 - 0.5, rnd() * 2 - 1).normalize();
    const r = 0.5 * lobe(n) * (0.82 + 0.28 * rnd());
    c.copy(n).multiplyScalar(r); c.y *= n.y < -0.3 ? 0.75 : 0.92;
    // card roughly tangent to the surface, tilted at random
    t.crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
    b.crossVectors(n, t);
    const a = rnd() * 6.28, tilt = (rnd() - 0.5) * 1.2;
    const u = t.clone().multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
    const w = n.clone().cross(u).normalize().applyAxisAngle(u, tilt);
    const sz = 0.2 + rnd() * 0.12;
    const quad = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, -1, 0, 0], [1, 1, 1, 1], [-1, 1, 0, 1]];
    for (const [qx, qy, qu, qv] of quad) {
      const P = c.clone().addScaledVector(u, qx * sz * 0.5).addScaledVector(w, qy * sz * 0.5);
      pos.push(P.x, P.y, P.z);
      const N = P.clone().normalize().lerp(n, 0.4).normalize();
      nor.push(N.x, N.y, N.z);
      uv.push(0.12 + qu * 0.86, 0.12 + qv * 0.86);
    }
  }
  const cards = new THREE.BufferGeometry();
  cards.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  cards.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  cards.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return mergeGeometries([cn, cards]);
}

// ---------------------------------------------------------------------------
// Street plan: the authored block z in [-70, 70], then simpler buildings beyond.
function streetPlan() {
  const rnd = mulberry32(20260927);
  const S = SCHEMES;
  const plan = [
    // z0, z1, overrides
    // about half white / cream with strong pastel trim and bands, half pale pastel with white bands
    [-70, -52.5, { floors: 2, style: 'band', r0: 3.2, r1: 0, scheme: { body: COL.warmWhite, trim: COL.teal, accent: COL.rose }, band: { col: 0xb3dcc6, mode: 1 }, winLayout: 'triple', name: 'THE CORALINE', canopy: 'entrance', patio: 'awning', awningColor: 0x2e7fa8, porch: true, portholes: true, medallions: true, roof: 'ac', exposed: [true, false] }],
    [-50.8, -35.6, { floors: 4, style: 'fin', r0: 0, r1: 0, scheme: { body: COL.mint, trim: COL.white, accent: COL.teal }, band: { col: COL.white, mode: 2 }, winLayout: 'pair', eyebrow: 'window', name: 'SEAGROVE', canopy: 'full', patio: 'umbrella', umbrellaCol: 0xd9477a, portholes: true, roof: 'tank' }],
    [-33.8, -15.2, { floors: 5, style: 'ziggurat', r0: 0, r1: 0, scheme: { body: COL.white, trim: COL.aqua, accent: COL.pinkDeep }, band: { col: 0xb4dedb, mode: 1 }, winLayout: 'ribbon', eyebrow: 'full', name: 'BELLA MAR', canopy: 'full', patio: 'tent', setback: 0.8, eyeCol: 'trim', fountain: true, roof: 'tank' }],
    [-13.6, 2.2, { floors: 3, style: 'pylon', r0: 0, r1: 0, scheme: { body: COL.pink, trim: COL.white, accent: COL.coral }, band: { col: COL.white, mode: 2 }, winLayout: 'punched', eyebrow: 'window', name: 'ORCHIDEA', canopy: 'entrance', patio: 'umbrella', umbrellaCol: 0x3f8a5a, porch: true, setback: 0, portholes: true, fountain: true, medallions: true, parapetStep: true, finial: true }],
    [3.8, 24.6, { floors: 4, style: 'twin', r0: 1.8, r1: 1.8, scheme: { body: COL.warmWhite, trim: COL.mintDeep, accent: COL.teal }, band: { col: 0x9ee6ec, mode: 1 }, winLayout: 'triple', eyebrow: 'window', name: 'MARISOL', signTop: 10.4, signBottom: 5.4, canopy: 'entrance', patio: 'canopy', canopyCol: 0x3d9ad6, canopyAlt: 0xe98fae, setback: 0.4, portholes: false, fountain: true, medallions: true, roof: 'ac', parapetStep: true }],
    [26.4, 40.2, { floors: 3, style: 'corner', r0: 0, r1: 3.2, scheme: { body: COL.lavender, trim: COL.white, accent: COL.lilac }, band: { col: COL.white, mode: 2 }, winLayout: 'ribbon', eyebrow: 'full', name: 'ORIANA', canopy: 'full', patio: 'porch', noSidewalk: true, portholes: true, parapetStep: true, rail: 'pipe' }],
    [41.8, 56.0, { floors: 7, style: 'tower', r0: 0, r1: 0, scheme: { body: COL.white, trim: COL.sky, accent: COL.coral }, band: { col: 0xb5d0e6, mode: 1 }, winLayout: 'triple', eyebrow: 'window', name: 'MARINELLA', canopy: 'entrance', patio: 'umbrella', umbrellaCol: 0xf1efe9, setback: 1.2, roof: 'tank' }],
    [57.6, 70, { floors: 2, style: 'plain', r0: 0, r1: 3.0, scheme: { body: COL.lemon, trim: COL.white, accent: COL.aqua }, band: { col: COL.white, mode: 2 }, winLayout: 'pair', eyebrow: 'full', name: 'SOLANA', canopy: 'full', patio: 'awning', awningColor: 0x3d7d4e, parapetStep: true, roof: 'sign', fins: true, exposed: [false, true] }],
  ];
  const specs = plan.map(([a, b, o]) => makeSpec(rnd, a, b, { porch: true, ...o, detail: 1 }));
  const names = [...NAMES.slice(8), ...MORE_NAMES];
  let nameI = 0;
  // continuing blocks between the cross streets (layout.CROSS_STREETS): full detail
  // through the walkable district, the simpler far row beyond it
  for (const dir of [1, -1]) {
    const ends = [...CROSS_STREETS.filter((c) => c.z * dir > 0).map((c) => Math.abs(c.z)).sort((a, b) => a - b), 960];
    for (let k = 0; k < ends.length - 1; k++) {
      const blockStart = ends[k] + CROSS.gap, blockLen = ends[k + 1] - CROSS.gap - blockStart;
      let z = 0;
      while (z < blockLen - 8) {
        let w = Math.min(12 + rnd() * 13, blockLen - z);
        if (blockLen - (z + w) < 10) w = blockLen - z;   // the corner building runs to the cross street
        const first = z === 0, last = z + w >= blockLen - 0.01;
        const za = dir > 0 ? blockStart + z : -(blockStart + z + w);
        const zb = za + w;
        const near = Math.abs((za + zb) / 2) < DISTRICT.zMax + 5;
        const corner = dir > 0 ? { r0: first ? 2.5 + rnd() : undefined, r1: last ? 2.5 + rnd() : undefined }
          : { r1: first ? 2.5 + rnd() : undefined, r0: last ? 2.5 + rnd() : undefined };
        specs.push(makeSpec(rnd, za, zb, {
          ...Object.fromEntries(Object.entries(corner).filter(([, v]) => v !== undefined)),
          detail: near ? 1 : 0, name: near || rnd() < 0.5 ? names[nameI++ % names.length] : undefined,
          exposed: dir > 0 ? [first, last] : [last, first],
        }));
        z += w + (rnd() < 0.5 ? 1.2 + rnd() * 2.5 : 0.4);
      }
    }
  }
  return specs;
}

// ---------------------------------------------------------------------------
// pause(): optional async yield, awaited every ~120 ms of building so the page can paint
export async function buildHotels(scene, pause = null) {
  const group = new THREE.Group();
  group.name = 'hotels';
  const specs = streetPlan();
  // sign atlases: the original block and its neighbouring blocks share the first (as
  // before); the outer district and the far row use a second one
  const atlases = [new SignAtlas(), new SignAtlas()];
  const atlasOf = (ci) => (chunks[ci].min >= -200 && chunks[ci].max <= 200 ? 0 : 1);
  // one chunk per block (split at the cross streets): merged and instanced meshes per
  // chunk, so frustum culling works per block and the small parts of far blocks can be
  // dropped by distance (lod.js)
  const edges = CROSS_STREETS.map((c) => c.z).sort((a, b) => a - b);
  const chunks = [...edges, Infinity].map((max, i) => ({
    max, min: i ? edges[i - 1] : -Infinity,
    paint: new Buf(), metal: new Buf(), fabric: new Buf(), terrazzo: new Buf(), block: new Buf(), signs: new Buf(), grime: new Buf(), wire: new Buf(),
    base: new THREE.Group(), detail: new THREE.Group(),
  }));
  const chunkOf = (z) => chunks.findIndex((c) => z < c.max);
  const ctx = { windows: [], chairs: [], tables: [], umbrellas: [], shrubs: [], palms: [], bulbs: [], chairCol: 0x6b5a45 };
  const rndC = mulberry32(99);
  // the authored block first (as always), then outward, so the nearest buildings get their
  // sign-atlas space first
  const order = [...specs.slice(0, 8), ...specs.slice(8).sort((a, b) => Math.abs(a.z0 + a.z1) - Math.abs(b.z0 + b.z1))];
  let tYield = performance.now();
  for (const S of order) {
    if (pause && performance.now() - tYield > 120) { await pause(); tYield = performance.now(); }
    const zc = (S.z0 + S.z1) / 2;
    const B = chunks.find((c) => zc < c.max);
    ctx.chairCol = pick(rndC, [0xc0343c, 0xe07a9a, 0xefece6, 0x3f8a5a, 0x2d6f9f, 0x6b5a45, 0xd9a13a, 0x2f8f7f, 0xefece6, 0xc0343c]);
    // far LOD: lower tiers leave out the row beyond the haze distance (kept as footprints)
    if (Math.abs(zc) > QUALITY.hotelFar) continue;
    const atlas = atlases[atlasOf(chunkOf(zc))];
    atlas.scale = S.detail > 0 ? 1 : 0.6;   // the far row's letters need less resolution
    const miss0 = atlas.miss ?? 0;
    buildHotel(S, B, ctx, atlas);
    if ((atlas.miss ?? 0) > miss0) (atlas.missAt ??= []).push(Math.round(zc));
  }

  // window frames, sills, glass-block infill -> merged; glass and reveals -> instanced
  const rnd = mulberry32(4711);
  const glassIdx = [], revealRect = [], revealRound = [];
  for (const w of ctx.windows) {
    if (pause && performance.now() - tYield > 120) { await pause(); tYield = performance.now(); }
    const B = chunks.find((c) => w.c[2] < c.max);
    const Nv = w.N, Z = cross(Nv, UP);
    const F = { o: w.c, X: Nv, Y: UP, Z };
    if (w.kind === 'block') {
      B.block.w = [0, 3, 0];
      const d = w.depth;
      B.block.quad(P(F, -d, -w.h / 2, -w.w / 2), P(F, -d, w.h / 2, -w.w / 2), P(F, -d, w.h / 2, w.w / 2), P(F, -d, -w.h / 2, w.w / 2), Nv);
      (w.round ? revealRound : revealRect).push(w);
      continue;
    }
    // one glass instance per pane, each with its own interior and reflection seed
    const np = w.panes || 1;
    for (let k = 0; k < np; k++) {
      const pw = w.w / np, u = -w.w / 2 + pw * (k + 0.5);
      const it = k === 0 ? w.interior : (w.kind === 'win' ? interiorFor(rnd, 'win') : w.interior);
      glassIdx.push({ w, u, pw, it });
    }
    (w.round ? revealRound : revealRect).push(w);
    const m = B.metal;
    const t = w.kind === 'door' ? 0.08 : w.kind === 'store' ? 0.07 : 0.05;
    const x0 = -w.depth - 0.015, x1 = -w.depth + 0.04;
    const hw = w.w / 2, hh = w.h / 2;
    const fc = w.kind === 'door' || w.kind === 'store' ? (isWhite(w.frame) || w.frame === 0x5f9d96 ? 0xbfc3c3 : w.frame) : (w.frame ?? 0xf0f0ec);
    m.color(w.frameCol ?? fc);
    B.paint.w = [100, 3, 0.3];
    B.paint.e = [0, 0, 0];
    B.paint.b = [1, 1, 1, 0];
    if (w.round) {
      // porthole: a fat projecting collar with a stepped inner ring, metal frame at the glass
      const basis = () => new THREE.Matrix4().makeBasis(new THREE.Vector3(...neg(Z)), new THREE.Vector3(...UP), new THREE.Vector3(...Nv));
      const col = new THREE.TorusGeometry(hw + 0.1, 0.1, 10, 36);
      const cm = basis(); cm.setPosition(...add(w.c, scl(Nv, 0.05)));
      B.paint.color(w.collar ?? 0xffffff);
      pushGeometry(B.paint, col, cm);
      col.dispose();
      const ring = new THREE.TorusGeometry(hw + 0.01, 0.04, 6, 32);
      const rm = basis(); rm.setPosition(...add(w.c, scl(Nv, 0.0)));
      B.paint.color(lighten(w.collar ?? 0xffffff, 0.4));
      pushGeometry(B.paint, ring, rm);
      ring.dispose();
      const tor = new THREE.TorusGeometry(hw - 0.03, 0.045, 6, 24);
      const mat = basis(); mat.setPosition(...add(w.c, scl(Nv, -w.depth + 0.03)));
      pushGeometry(m, tor, mat);
      tor.dispose();
      lbox(m, F, x0, x1, -0.02, 0.02, -hw, hw);
      continue;
    }
    // projecting surround moulding round upper windows, in the trim / band colour
    if (w.kind === 'win' && w.surround != null) {
      const s = 0.09, o = 0.05;
      B.paint.color(w.surround);
      lbox(B.paint, F, -0.02, o, hh, hh + s, -hw - s, hw + s, { '-x': true });
      lbox(B.paint, F, -0.02, o, -hh - s, hh, -hw - s, -hw, { '-x': true });
      lbox(B.paint, F, -0.02, o, -hh - s, hh, hw, hw + s, { '-x': true });
    }
    lbox(m, F, x0, x1, hh - t, hh, -hw, hw);
    lbox(m, F, x0, x1, -hh, -hh + t, -hw, hw);
    lbox(m, F, x0, x1, -hh + t, hh - t, -hw, -hw + t);
    lbox(m, F, x0, x1, -hh + t, hh - t, hw - t, hw);
    const style = w.kind === 'door' ? 'door' : w.kind === 'store' ? 'store' : (w.frameStyle === 'plain' && w.w > 1.4 ? 'cross' : w.frameStyle) ?? 'h3';
    const bar = t * 0.6;
    if (style === 'panes') {
      for (let i = 1; i < np; i++) lbox(m, F, x0, x1 + 0.01, -hh, hh, -hw + (w.w * i) / np - t * 0.55, -hw + (w.w * i) / np + t * 0.55);
      if (w.h > 1.3) lbox(m, F, x0, x1, hh - 0.36 - bar / 2, hh - 0.36 + bar / 2, -hw, hw);
    } else if (style === 'h3') {
      for (const f of [1 / 3, 2 / 3]) lbox(m, F, x0, x1, -hh + w.h * f - bar / 2, -hh + w.h * f + bar / 2, -hw, hw);
      if (w.w > 1.3) lbox(m, F, x0, x1, -hh, hh, -bar / 2, bar / 2);
    } else if (style === 'cross') {
      lbox(m, F, x0, x1, -hh, hh, -bar / 2, bar / 2);
      lbox(m, F, x0, x1, hh - w.h * 0.3 - bar / 2, hh - w.h * 0.3 + bar / 2, -hw, hw);
    } else if (style === 'grid') {
      for (const f of [1 / 3, 2 / 3]) {
        lbox(m, F, x0, x1, -hh, hh, -hw + w.w * f - bar / 2, -hw + w.w * f + bar / 2);
        lbox(m, F, x0, x1, -hh + w.h * f - bar / 2, -hh + w.h * f + bar / 2, -hw, hw);
      }
    } else if (style === 'door') {
      lbox(m, F, x0, x1 + 0.02, -hh, hh, -t / 2, t / 2);
      lbox(m, F, x0, x1, hh - 0.55, hh - 0.55 + t, -hw, hw);
      lbox(m, F, x1, x1 + 0.05, -0.1, -0.04, -hw + 0.15, -0.15);
      lbox(m, F, x1, x1 + 0.05, -0.1, -0.04, 0.15, hw - 0.15);
    } else if (style === 'store') {
      const n = Math.max(1, Math.round(w.w / 1.3));
      for (let i = 1; i < n; i++) lbox(m, F, x0, x1, -hh, hh, -hw + (w.w * i) / n - bar / 2, -hw + (w.w * i) / n + bar / 2);
      lbox(m, F, x0, x1, hh - 0.5, hh - 0.5 + bar, -hw, hw);
    }
    // projecting sill under upper windows
    if (w.kind === 'win' && w.sill) {
      B.paint.color(w.surround ?? lighten(w.reveal, 0.15));
      lbox(B.paint, F, -w.depth, 0.15, -hh - 0.1, -hh, -hw - 0.14, hw + 0.14, { '-x': true });
    }
  }
  // assign per-window frame colours by building (stored on spec via window order)
  const glassMat = glassMaterial();
  const quad = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2);
  // per-chunk instanced mesh from a list of { z, m (Matrix4), color?, ... } records
  const perChunk = (geo, mat, recs, where, fn) => {
    const byChunk = chunks.map(() => []);
    for (const r of recs) byChunk[chunkOf(r.z)].push(r);
    byChunk.forEach((list, ci) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((r, i) => {
        mesh.setMatrixAt(i, r.m);
        if (r.color !== undefined) mesh.setColorAt(i, r.color.isColor ? r.color : new THREE.Color(r.color));
      });
      mesh.castShadow = mesh.receiveShadow = true;
      fn?.(mesh, list);
      chunks[ci][where].add(mesh);
    });
  };
  const m4 = new THREE.Matrix4(), vX = new THREE.Vector3(), vY = new THREE.Vector3(), vZ = new THREE.Vector3();
  const setM = (w, depthOffset, sx, sy, sz, u = 0) => {
    const Z = cross(w.N, UP);
    vX.set(...w.N); vY.set(0, 1, 0); vZ.set(...Z);
    m4.makeBasis(vX.multiplyScalar(sx), vY.multiplyScalar(sy), vZ.multiplyScalar(sz));
    const p = add(add(w.c, scl(w.N, depthOffset)), scl(Z, u));
    m4.setPosition(p[0], p[1], p[2]);
    return m4;
  };
  const glassRecs = glassIdx.map((g) => {
    const w = g.w;
    const m = setM(w, -w.depth, 1, w.h, g.pw, g.u).clone();
    const it = g.it ?? [0, 0, rnd(), rnd()];
    // storefront / door kinds keep their type; x encodes 4 = round, +10 = ground-floor glass
    const ground = w.kind === 'door' || w.kind === 'store' ? 10 : 0;
    return { z: w.c[2], m, a: [(w.round ? 4 : it[0]) + ground, it[1], it[2], rnd()] };
  });
  perChunk(quad, glassMat, glassRecs, 'base', (glass, list) => {
    const aWin = new Float32Array(list.length * 4);
    list.forEach((r, i) => aWin.set(r.a, i * 4));
    glass.geometry = quad.clone();
    glass.geometry.setAttribute('aWin', new THREE.InstancedBufferAttribute(aWin, 4));
    glass.castShadow = false;
    glass.receiveShadow = false;   // deep in its reveal the pane only picked up shadow acne
  });

  // reveals: open boxes (rect) and open tubes (round), coloured like their wall
  const revealGeo = (() => {
    const b = new Buf();
    const F = WF;
    // local x from 0 (wall plane) to -1 (glass); y, z in [-0.5, 0.5]; faces point inward
    b.quad(P(F, 0, 0.5, -0.5), P(F, -1, 0.5, -0.5), P(F, -1, 0.5, 0.5), P(F, 0, 0.5, 0.5), [0, -1, 0]);
    b.quad(P(F, 0, -0.5, -0.5), P(F, -1, -0.5, -0.5), P(F, -1, -0.5, 0.5), P(F, 0, -0.5, 0.5), [0, 1, 0]);
    b.quad(P(F, 0, -0.5, 0.5), P(F, -1, -0.5, 0.5), P(F, -1, 0.5, 0.5), P(F, 0, 0.5, 0.5), [0, 0, -1]);
    b.quad(P(F, 0, -0.5, -0.5), P(F, -1, -0.5, -0.5), P(F, -1, 0.5, -0.5), P(F, 0, 0.5, -0.5), [0, 0, 1]);
    const g = b.geometry();
    g.deleteAttribute('color'); g.deleteAttribute('aW'); g.deleteAttribute('aE'); g.deleteAttribute('aB');
    return g;
  })();
  const revealMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  // jambs, head and sill of the opening: less sky reaches deep into the reveal
  const revealAO = (mat, key) => {
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vRD;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRD = clamp(-position.x, 0.0, 1.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vRD;')
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
          reflectedLight.indirectDiffuse *= 1.0 - 0.8 * sqrt(clamp(vRD, 0.0, 1.0));
          reflectedLight.directDiffuse *= 1.0 - 0.45 * vRD;`);
    };
    mat.customProgramCacheKey = () => key;
  };
  revealAO(revealMat, 'hotel-reveal-v2');
  const col = new THREE.Color();
  perChunk(revealGeo, revealMat, revealRect.map((w) => ({ z: w.c[2], m: setM(w, 0, w.depth, w.h, w.w).clone(), color: col.setHex(w.reveal).multiplyScalar(0.9).clone() })), 'base');
  if (revealRound.length) {
    const tube = new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 1, true).rotateZ(Math.PI / 2).translate(-0.5, 0, 0);
    const rMat = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.BackSide });
    revealAO(rMat, 'hotel-reveal-round-v2');
    perChunk(tube, rMat, revealRound.map((w) => ({ z: w.c[2], m: setM(w, 0, w.depth, w.h, w.w).clone(), color: col.setHex(w.reveal).multiplyScalar(0.93).clone() })), 'base');
  }

  // merged static meshes per chunk
  const paintMat = paintMaterial();
  const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.08 });
  const grimeMat = grimeMaterial();
  const fabricMat = fabricMaterial();
  const terrMat = terrazzoMaterial();
  const blockMat = glassBlockMaterial();
  // one sign material pair per atlas
  const signMats = atlases.map((at) => {
    const { map: signMap, em: signEm } = at.textures();
    const signMat = new THREE.MeshStandardMaterial({
      map: signMap, alphaTest: 0.5, alphaToCoverage: true, roughness: 0.5, metalness: 0.25,
      emissive: 0xffffff, emissiveMap: signEm, emissiveIntensity: 0.08, side: THREE.DoubleSide,
    });
    // soft contact shadow of the channel letters on the wall just behind them
    const signShadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, map: signMap, transparent: true, opacity: 0.4, depthWrite: false });
    signShadowMat.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed += -normal * 0.05 + vec3(0.0, -0.03, 0.0);');
      s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', `
        vec2 odTs = 1.5 / vec2(textureSize(map, 0));
        float odA = 0.0;
        for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) odA += texture2D(map, vMapUv + vec2(float(i), float(j)) * odTs * 4.0).a;
        diffuseColor.a *= odA / 9.0;`);
    };
    signShadowMat.customProgramCacheKey = () => 'sign-shadow-v1';
    return { signMat, signShadowMat };
  });
  const isSignMat = (m) => signMats.some((q) => q.signMat === m);
  for (const c of chunks) {
    if (pause && performance.now() - tYield > 120) { await pause(); tYield = performance.now(); }
    // base: the building shells, awnings, signs and glass (always drawn); detail: frames,
    // grime, wires, terrazzo, glass block and furniture (dropped with distance)
    const add = (buf, mat, cast = true, where = 'base') => {
      if (buf.empty) return null;
      const g = buf.geometry();
      if (isSignMat(mat) || mat === terrMat || mat === blockMat) g.deleteAttribute('color');
      if (mat === grimeMat) { const m2 = new THREE.Mesh(g, mat); m2.receiveShadow = true; m2.renderOrder = 2; c[where].add(m2); return m2; }
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      c[where].add(mesh);
      return mesh;
    };
    add(c.paint, paintMat);
    add(c.metal, metalMat, true, 'detail');
    add(c.fabric, fabricMat);
    add(c.terrazzo, terrMat, false, 'detail');
    add(c.block, blockMat, false, 'detail');
    if (!c.signs.empty) {
      const { signMat, signShadowMat } = signMats[atlasOf(chunks.indexOf(c))];
      const sm = add(c.signs, signMat);
      const sh = new THREE.Mesh(sm.geometry, signShadowMat);
      sh.renderOrder = 3;
      c.detail.add(sh);
    }
    add(c.grime, grimeMat, false, 'detail');
    add(c.wire, metalMat, false, 'detail');
  }

  // furniture
  const furnMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.2 });
  const q = new THREE.Quaternion(), yAx = new THREE.Vector3(0, 1, 0), s1 = new THREE.Vector3(1, 1, 1);
  const place = (geo, mat, items, fn) => {
    perChunk(geo, mat, items.map((it) => {
      q.setFromAxisAngle(yAx, it.rot ?? 0);
      return { z: it.z, m: new THREE.Matrix4().compose(new THREE.Vector3(it.x, it.y, it.z), q, fn ? fn(it) : s1), color: it.color };
    }), 'detail');
  };
  if (ctx.chairs.length) place(chairGeometry(), furnMat, ctx.chairs);
  if (ctx.tables.length) {
    ctx.tables.forEach((t) => { t.color = 0xe9e6df; });
    place(tableGeometry(), furnMat, ctx.tables);
  }
  if (ctx.umbrellas.length) {
    const umMat = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide });
    umMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
        #ifdef USE_FOG
        { vec3 wn = inverseTransformDirection(normal, viewMatrix);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * OD_SUNCOL * OD_SUN_I * 0.02 * max(-wn.y, 0.0); }
        #endif`);
    };
    umMat.customProgramCacheKey = () => 'hotel-umbrella-v1';
    place(umbrellaGeometry(), umMat,
      ctx.umbrellas.map((u) => ({ ...u, y: u.y + u.h - 0.3, rot: 0 })), (u) => new THREE.Vector3(u.r, 1, u.r));
    const pole = new THREE.CylinderGeometry(0.022, 0.022, 1, 6).translate(0, 0.5, 0);
    place(pole, furnMat,
      ctx.umbrellas.map((u) => ({ x: u.x, y: u.y, z: u.z, color: 0xd8d4cc })), (u) => new THREE.Vector3(1, ctx.umbrellas[0].h, 1));
  }
  if (ctx.shrubs.length) {
    const shrubMat = new THREE.MeshStandardMaterial({ roughness: 0.85, map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
    const rs = mulberry32(8);
    place(shrubGeometry(), shrubMat,
      ctx.shrubs.map((s) => ({ ...s, rot: rs() * 6, color: [0x3f5a2c, 0x4a6632, 0x355026, 0x56703a][Math.floor(rs() * 4)] })),
      (s) => new THREE.Vector3(s.s * 1.3, s.s * 1.1, s.s * 1.3));
  }
  if (ctx.palms.length) {
    const rp = mulberry32(31);
    const potted = ctx.palms.filter((p) => p.pot);
    if (potted.length) {
      const pot = new THREE.CylinderGeometry(0.3, 0.22, 0.55, 14).translate(0, 0.275, 0);
      place(pot, new THREE.MeshStandardMaterial({ roughness: 0.7 }),
        potted.map((p) => ({ x: p.x, y: p.y, z: p.z, color: p.potCol })));
    }
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide, map: leafTexture(), alphaTest: 0.5 });
    leafMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.directDiffuse += diffuseColor.rgb * directLight.color * 0.12;
        reflectedLight.indirectDiffuse *= 1.3;`);
    };
    leafMat.customProgramCacheKey = () => 'hotel-potpalm-v2';
    // bushy clipped shrubs in the terrace planters and pots
    place(shrubGeometry().scale(1.1, 1.0, 1.1).translate(0, 0.42, 0), leafMat,
      ctx.palms.map((p) => ({ x: p.x, y: p.y + (p.pot ? 0.5 : 0), z: p.z, s: p.s, rot: rp() * 6.28, color: [0x4f7a2e, 0x5b8636, 0x46702a, 0x668a3a][Math.floor(rp() * 4)] })),
      (p) => new THREE.Vector3(p.s * 0.8, p.s * 0.7, p.s * 0.8));
  }
  if (ctx.bulbs.length) {
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1d8, emissive: 0xffc27a, emissiveIntensity: 0.9, roughness: 0.3 });
    perChunk(new THREE.IcosahedronGeometry(0.03, 1), bulbMat, ctx.bulbs.map((b) => ({ z: b.z, m: new THREE.Matrix4().makeTranslation(b.x, b.y, b.z) })), 'detail',
      (bm) => { bm.castShadow = bm.receiveShadow = false; });
  }

  for (const c of chunks) {
    group.add(c.base, c.detail);
    if (c.detail.children.length) registerLod(c.detail, Math.max(c.min, -5000), Math.min(c.max, 5000), 'detail');
  }
  // walk collision: each building's front line (patios in front are raised terraces)
  group.userData.footprints = specs.map((S) => ({ z0: S.z0, z1: S.z1, fx: S.fx }));
  scene.add(group);
  window.__hotelStats = { grimeVerts: chunks.reduce((n, c) => n + (c.grime.count ?? 0), 0), buildings: specs.length, windows: ctx.windows.length, chairs: ctx.chairs.length, umbrellas: ctx.umbrellas.length, signMiss: atlases.map((a) => a.miss ?? 0), signMissAt: atlases.flatMap((a) => a.missAt ?? []), chunks: chunks.length };
  return group;
}
