// System 2: the Art Deco hotel row along Ocean Drive (west side, facades at x ~ -30).
// Every building is assembled procedurally from a seeded spec: stucco volumes with
// rounded corners, eyebrow sunshades, central pylons / fins / bays, stepped parapets,
// speed lines, recessed windows (instanced glass that reflects the analytic sky),
// porches, cafe patios and invented neon-letter signs. Static geometry is merged per
// material and per street chunk; windows, reveals and furniture are instanced.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HOTEL, BLOCK, CURB_HEIGHT, SIDEWALK_W } from './layout.js';
import { mulberry32, noiseColorTexture, noiseNormalTexture } from '../textures/noise.js';

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
    this.pos = []; this.nrm = []; this.col = []; this.uv = []; this.aw = [];
    this.c = [1, 1, 1];
    this.w = [0, 3, 0];
  }
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
    g.computeBoundingSphere();
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
function ribbon(b, pts, y0, y1, out, caps = true) {
  if (pts.length < 2) return;
  const inset = 0.03;
  const A = pts.map((p) => [p.x - p.n[0] * inset, 0, p.z - p.n[2] * inset]);
  const B = pts.map((p) => [p.x + p.n[0] * out, 0, p.z + p.n[2] * out]);
  const Y = (p, y) => [p[0], y, p[2]];
  for (let i = 0; i < pts.length - 1; i++) {
    const n0 = pts[i].n, n1 = pts[i + 1].n;
    b.quad(Y(B[i], y0), Y(B[i + 1], y0), Y(B[i + 1], y1), Y(B[i], y1), n0, n1, n1, n0);
    b.quad(Y(A[i], y1), Y(B[i], y1), Y(B[i + 1], y1), Y(A[i + 1], y1), UP);
    b.quad(Y(A[i], y0), Y(B[i], y0), Y(B[i + 1], y0), Y(A[i + 1], y0), [0, -1, 0]);
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
  white: 0xf2efe8, warmWhite: 0xefe9dc, cream: 0xeee2c8, pink: 0xf0d2cf, blush: 0xecc9c1,
  mint: 0xcfe6d8, lemon: 0xf1e3ae, lavender: 0xdad2e6, peach: 0xf1d2bb, powder: 0xcde0e8,
  teal: 0x62b3ab, aqua: 0x93cfcc, coral: 0xe3968e, rose: 0xe3a1b0, seagreen: 0x8ccaab,
  butter: 0xeed27e, lilac: 0xb6a5d3, sky: 0x8dbcd6, salmon: 0xeaa283, sand: 0xd9c9a8,
  stoneGrey: 0xd3d2c7, mintDeep: 0x7fbfa4,
};
const SCHEMES = [
  { body: COL.white, trim: COL.teal, accent: COL.rose },
  { body: COL.white, trim: COL.butter, accent: COL.sky },
  { body: COL.pink, trim: COL.white, accent: COL.coral },
  { body: COL.mint, trim: COL.white, accent: COL.seagreen },
  { body: COL.lemon, trim: COL.white, accent: COL.butter },
  { body: COL.lavender, trim: COL.white, accent: COL.lilac },
  { body: COL.peach, trim: COL.cream, accent: COL.salmon },
  { body: COL.powder, trim: COL.white, accent: COL.sky },
  { body: COL.cream, trim: COL.seagreen, accent: COL.salmon },
  { body: COL.warmWhite, trim: COL.aqua, accent: COL.aqua },
  { body: COL.white, trim: COL.coral, accent: COL.mintDeep },
  { body: COL.blush, trim: COL.warmWhite, accent: COL.teal },
];
const FRAME_COLS = [0xeceeea, 0xeceeea, 0x3a342d, 0xb9bdbc, 0x4b8f88];
const CURTAINS = [0xe8e0cf, 0xf2efe6, 0xd9cbb0, 0xc9dcd8, 0xe9cfc9, 0xd8d0c0, 0xb8c9d4];
const UMBRELLA_COLS = [0xf1efe9, 0x2f8f7f, 0xd9477a, 0xf0c64a, 0x3c7e4a, 0x2d5f8f, 0xe9e2d0, 0xc9343e];
const AWNING_COLS = [0x2e7fa8, 0x2f8f7f, 0xd24a74, 0x3d7d4e, 0xe0a33a, 0x7a4f9a, 0xcf5a3c];

// Invented names only.
const NAMES = [
  'CORALINE', 'SEAGROVE', 'BELLA MAR', 'PALMIRA', 'AZURINE', 'ORIANA', 'MARINELLA', 'SOLANA',
  'DUNEHAVEN', 'VISTAMAR', 'LA PERLITA', 'HALLORAN', 'ROSALIND', 'FAIRHOLM', 'CALYPSO', 'WYNDMERE',
  'MARBELLE', 'ISLA VERDE', 'COQUINA', 'PALOMA', 'LUNA MAR', 'ASHBY', 'HELIOS', 'SEAFOAM',
  'BRIARCLIFF', 'MONTCLAIRE', 'ALDEMAR', 'NEREIDA', 'SUNHAVEN', 'CORAL BAY', 'MAREVISTA', 'LINDEN',
];

// ---------------------------------------------------------------------------
// Sign atlas: painted metal letters with thin neon tubes (faint at sunrise).
class SignAtlas {
  constructor(W = 4096, H = 2048) {
    this.W = W; this.H = H;
    this.cv = document.createElement('canvas'); this.cv.width = W; this.cv.height = H;
    this.ev = document.createElement('canvas'); this.ev.width = W; this.ev.height = H;
    this.ctx = this.cv.getContext('2d'); this.ectx = this.ev.getContext('2d');
    this.ectx.fillStyle = '#000'; this.ectx.fillRect(0, 0, W, H);
    // horizontal signs pack in shelves on the left, vertical columns on the right
    this.VX = W - 1100;
    this.hp = { x: 4, y: 4, rowH: 0, x0: 4, x1: this.VX - 4 };
    this.vp = { x: this.VX, y: 4, rowH: 0, x0: this.VX, x1: W - 4 };
  }
  alloc(w, h, vertical = false) {
    const s = vertical ? this.vp : this.hp;
    if (s.x + w > s.x1) { s.x = s.x0; s.y += s.rowH + 6; s.rowH = 0; }
    if (s.y + h > this.H - 4) return null;
    const r = { x: s.x, y: s.y, w, h };
    s.x += w + 6; s.rowH = Math.max(s.rowH, h);
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
    // return edge of the channel letter (reads as depth), then the painted face
    ctx.fillStyle = st.edge;
    ctx.fillText(ch, x + px * 0.035, y + px * 0.045);
    ctx.fillStyle = st.fill;
    ctx.fillText(ch, x, y);
    // neon tube: a thin light line following the letter
    ctx.lineWidth = Math.max(2, px * 0.028);
    ctx.strokeStyle = st.tube;
    ctx.globalAlpha = 0.85;
    ctx.save();
    ctx.translate(x, y); ctx.scale(0.86, 0.86);
    ctx.strokeText(ch, 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
    ectx.lineWidth = Math.max(2, px * 0.03);
    ectx.strokeStyle = st.tube;
    ectx.save();
    ectx.translate(x, y); ectx.scale(0.86, 0.86);
    ectx.strokeText(ch, 0, 0);
    ectx.restore();
  }
  horizontal(text, st, px = 112) {
    this.ctx.font = this.font(px, st.font);
    const sp = px * (st.font === 'script' ? 0.02 : 0.16);
    const ws = [...text].map((ch) => this.ctx.measureText(ch).width);
    const total = ws.reduce((a, b) => a + b, 0) + sp * (ws.length - 1);
    const r = this.alloc(Math.ceil(total + px * 0.3), Math.ceil(px * 1.3));
    if (!r) return null;
    let x = r.x + px * 0.15;
    [...text].forEach((ch, i) => {
      if (ch !== ' ') this.letter(this.ctx, this.ectx, ch, x + ws[i] / 2, r.y + r.h / 2, px, st);
      x += ws[i] + sp;
    });
    return { uv: this.uv(r), aspect: r.w / r.h };
  }
  vertical(text, st, px = 92) {
    const chars = [...text.replace(/ /g, '')];
    const cell = px * 1.08;
    const r = this.alloc(Math.ceil(px * 1.2), Math.ceil(cell * chars.length + px * 0.2), true);
    if (!r) return null;
    chars.forEach((ch, i) => this.letter(this.ctx, this.ectx, ch, r.x + r.w / 2, r.y + px * 0.1 + cell * (i + 0.5), px, st));
    return { uv: this.uv(r), aspect: r.w / r.h, n: chars.length };
  }
  textures() {
    const map = new THREE.CanvasTexture(this.cv);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    const em = new THREE.CanvasTexture(this.ev);
    em.colorSpace = THREE.SRGBColorSpace;
    return { map, em };
  }
}

// Plane of letters standing just off a wall (normal N), centred at c.
function signQuad(b, c, N, w, h, uv) {
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
  const floors = o.floors ?? (2 + Math.floor(rnd() * 2.999));
  const gH = 3.9 + rnd() * 0.5;
  const fh = 3.0 + rnd() * 0.3;
  const H = G + gH + (floors - 1) * fh;
  const scheme = o.scheme ?? pick(rnd, SCHEMES);
  const setback = o.setback ?? (rnd() < 0.6 ? 0 : 0.5 + rnd() * 1.5);
  const style = o.style ?? pick(rnd, ['pylon', 'fin', 'bay', 'ziggurat', 'band', 'plain', 'fin', 'pylon']);
  const ww = pick(rnd, [1.2, 1.35, 1.5, 1.65]);
  return {
    z0, z1, floors, gH, fh, H, ph: 0.9 + rnd() * 0.8, scheme, style,
    fx: HOTEL.frontX - setback,
    r0: o.r0 ?? (rnd() < 0.22 ? 1.4 + rnd() * 1.4 : 0),
    r1: o.r1 ?? (rnd() < 0.22 ? 1.4 + rnd() * 1.4 : 0),
    ww, pier: 0.75 + rnd() * 0.7, paired: rnd() < 0.3, ribbonWin: style === 'ziggurat' ? rnd() < 0.7 : rnd() < 0.12,
    eyebrow: pick(rnd, ['full', 'full', 'window', 'window', 'band']), eyeOut: 0.5 + rnd() * 0.4,
    frame: pick(rnd, FRAME_COLS), frameStyle: pick(rnd, ['h3', 'cross', 'grid', 'h3', 'cross']),
    canopy: o.canopy ?? pick(rnd, ['full', 'entrance', 'entrance', 'awning', 'none']),
    porch: o.porch ?? rnd() < 0.75,
    patio: o.patio ?? pick(rnd, ['umbrella', 'umbrella', 'awning', 'porch', 'none']),
    rail: pick(rnd, ['wall', 'pipe', 'wall']),
    portholes: rnd() < 0.4, glassBlock: rnd() < 0.5, medallions: rnd() < 0.35,
    name: o.name, signFont: pick(rnd, ['geo', 'geo', 'condensed', 'script']),
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
    c, N: wall.N, w, h: o.round ? w : h, depth: o.depth ?? 0.24, round: !!o.round,
    kind: o.kind ?? 'win', interior: o.interior, reveal: wall.color, frame: o.frame ?? ctx.frame, frameStyle: o.frameStyle ?? ctx.frameStyle,
  });
}

function interiorFor(rnd, kind) {
  if (kind === 'lobby') return [6, 0, rnd(), rnd()];
  if (kind === 'store') return [rnd() < 0.5 ? 6 : 2, 0.3 + rnd() * 0.3, rnd(), rnd()];
  const r = rnd();
  if (r < 0.3) return [0, 0, rnd(), rnd()];
  if (r < 0.48) return [1, 0.15 + rnd() * 0.7, rnd(), rnd()];
  if (r < 0.82) return [2, 0.25 + rnd() * 0.6, rnd(), rnd()];
  if (r < 0.95) return [3, 0.5 + rnd() * 0.4, rnd(), rnd()];
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
function buildHotel(S, B, ctx, atlas) {
  const rnd = mulberry32(S.seed);
  const { z0, z1, fx, gH, fh, H, ph, floors } = S;
  const zc = (z0 + z1) / 2, W = z1 - z0;
  const top = H + ph;
  const back = HOTEL.backX;
  const { body, trim, accent } = S.scheme;
  const paint = B.paint, metal = B.metal;
  paint.w = [G + gH, fh, 1];
  ctx.frame = S.frame;
  ctx.frameStyle = S.frameStyle;

  // ---- facade planning -------------------------------------------------------
  const r0 = Math.min(S.r0, W * 0.2), r1 = Math.min(S.r1, W * 0.2);
  let cw = 0;
  if (S.style === 'pylon') cw = 2.4 + rnd() * 0.6;
  else if (S.style === 'fin') cw = 1.0;
  else if (S.style === 'bay') cw = Math.min(W * 0.42, 5.5 + rnd() * 1.5);
  else if (S.style === 'ziggurat') cw = 3.0;
  const front = { o: [fx, 0, 0], N: [1, 0, 0], holes: [], color: body };  // u = -z
  const zf0 = z0 + r0 + (r0 > 0 ? 0.7 : 0.9), zf1 = z1 - r1 - (r1 > 0 ? 0.7 : 0.9);
  const halves = cw > 0 ? [[zf0, zc - cw / 2 - 0.45], [zc + cw / 2 + 0.45, zf1]] : [[zf0, zf1]];
  const unit = S.paired ? S.ww * 2 + 0.22 : S.ww;
  const pier = S.ribbonWin ? 0.14 : S.pier;
  const upperCols = [];
  for (const [a, bnd] of halves) {
    // mirror the second half of a symmetric facade
    let cols = spread(a, bnd, S.ribbonWin ? 1.1 : unit, pier);
    upperCols.push(...cols);
  }
  const winH = Math.min(1.55, fh - 1.45);
  const sill = 0.85;
  const eyebrowYs = [];
  for (let f = 1; f < floors; f++) {
    const y0 = G + gH + (f - 1) * fh;
    const yc = y0 + sill + winH / 2;
    eyebrowYs.push(y0 + sill + winH + 0.2);
    for (const zcol of upperCols) {
      const ints = interiorFor(rnd, 'win');
      if (S.paired && !S.ribbonWin) {
        for (const s of [-1, 1]) {
          windowRecord(ctx, front, -(zcol + s * (S.ww / 2 + 0.11)), yc, S.ww, winH, { interior: ints });
        }
      } else {
        windowRecord(ctx, front, -zcol, yc, S.ribbonWin ? 1.1 : S.ww, winH, { interior: interiorFor(rnd, 'win') });
      }
    }
  }
  // ground floor: storefront windows either side of a central entrance
  const doorW = 2.0 + rnd() * 0.6, doorH = 2.6;
  const storeH = 2.45, storeSill = 0.5;
  const entranceInBay = S.style === 'bay';
  if (!entranceInBay) windowRecord(ctx, front, -zc, G + doorH / 2, doorW, doorH, { kind: 'door', interior: [6, 0, rnd(), rnd()], depth: 0.35 });
  const gz0 = entranceInBay ? zc + cw / 2 + 0.5 : zc + doorW / 2 + 0.9;
  const storeCols = [...spread(gz0, zf1, 2.6, 0.7)];
  const mirrorCols = storeCols.map((z) => 2 * zc - z);
  let gbDone = false;
  for (const z of [...storeCols, ...mirrorCols]) {
    windowRecord(ctx, front, -z, G + storeSill + storeH / 2, 2.6, storeH, { kind: 'store', interior: interiorFor(rnd, 'store'), depth: 0.3 });
  }
  if (S.glassBlock && !entranceInBay && storeCols.length) {
    // glass-block panels flanking the entrance
    const gz = zc + doorW / 2 + 0.55;
    if (storeCols[0] - 1.3 > gz + 0.4) {
      for (const s of [-1, 1]) windowRecord(ctx, front, -(zc + s * (gz - zc)), G + 0.3 + 1.2, 0.6, 2.4, { kind: 'block', depth: 0.12 });
      gbDone = true;
    }
  }
  // portholes on the top floor near the ends, or flanking the door
  if (S.portholes && floors >= 3) {
    const y = G + gH + (floors - 2) * fh + sill + winH / 2;
    const zs = [zf0 + 0.2, zf1 - 0.2].filter((z) => upperCols.every((c) => Math.abs(c - z) > unit / 2 + 0.7));
    for (const z of zs) windowRecord(ctx, front, -z, y, 0.75, 0.75, { round: true, depth: 0.2, interior: [0, 0, rnd(), rnd()] });
  }

  // ---- main volume --------------------------------------------------------------
  paint.color(body);
  planarWall(paint, front.o, front.N, -(z1 - r1), -(z0 + r0), G - 0.2, top, front.holes);
  if (r0 > 0) arcWall(paint, fx - r0, z0 + r0, r0, -Math.PI / 2, 0, G - 0.2, top, 12);
  if (r1 > 0) arcWall(paint, fx - r1, z1 - r1, r1, 0, Math.PI / 2, G - 0.2, top, 12);
  // side walls, with a few small windows toward the front where they show
  for (const side of [-1, 1]) {
    const z = side < 0 ? z0 : z1, r = side < 0 ? r0 : r1;
    const N = [0, 0, side];
    const wall = { o: [0, 0, z], N, holes: [], color: body };
    const Rv = cross(UP, N);                          // u axis: +x for +z, -x for -z
    const uF = (fx - r) * Rv[0], uB = back * Rv[0];
    if (S.detail > 0) {
      for (let f = 1; f < floors; f++) {
        const y = G + gH + (f - 1) * fh + sill + 0.65;
        for (const d of [2.4, 6.2]) {
          const x = fx - r - d;
          windowRecord(ctx, wall, x * Rv[0], y, 0.9, 1.25, { interior: interiorFor(rnd, 'win'), depth: 0.18 });
        }
      }
    }
    planarWall(paint, wall.o, N, Math.min(uF, uB), Math.max(uF, uB), G - 0.2, top, wall.holes);
  }
  paint.color(body);
  box(paint, back, back + 0.2, G - 0.2, top, z0, z1, { '+x': true });
  // roof, with a stair/elevator bulkhead and plant boxes
  paint.color(COL.stoneGrey);
  paint.quad([back, H, z0], [fx - 0.2, H, z0], [fx - 0.2, H, z1], [back, H, z1], UP);
  paint.color(body);
  const bh = 2.2 + rnd() * 1.2, bx = back + 3 + rnd() * 6, bz = z0 + 2 + rnd() * (W - 7);
  box(paint, bx, bx + 3 + rnd() * 2, H, H + bh, bz, bz + 3, { '-y': true });
  paint.color(0xb9b7ae);
  for (let i = 0; i < 2 + rnd() * 3; i++) {
    const ax = back + 2 + rnd() * 12, az = z0 + 1 + rnd() * (W - 3);
    box(paint, ax, ax + 1.1, H, H + 0.9, az, az + 1.1, { '-y': true });
  }

  // ---- ornament -------------------------------------------------------------------
  paint.w = [G + gH, fh, 0.5];
  const full = outline(fx, z0, z1, r0, r1);
  const splitAt = cw > 0 ? [outline(fx, z0, z1, r0, r1, -Infinity, zc - cw / 2), outline(fx, z0, z1, r0, r1, zc + cw / 2, Infinity)] : [full];
  // plinth
  paint.color(new THREE.Color(body).multiplyScalar(0.9).getHex());
  ribbon(paint, full, G - 0.2, G + 0.5, 0.05);
  // coping and a thin stripe under it
  paint.color(trim);
  ribbon(paint, full, top - 0.12, top + 0.05, 0.08);
  if (S.style !== 'plain' || rnd() < 0.5) ribbon(paint, full, top - 0.55, top - 0.36, 0.02);
  // eyebrow sunshades over each upper window row
  paint.color(S.eyebrow === 'band' ? trim : (rnd() < 0.5 ? body : trim));
  for (const y of eyebrowYs) {
    if (S.eyebrow === 'window' && !S.ribbonWin) {
      for (const zcol of upperCols) {
        const hw = unit / 2 + 0.3;
        ribbon(paint, [{ x: fx, z: zcol - hw, n: [1, 0, 0] }, { x: fx, z: zcol + hw, n: [1, 0, 0] }], y, y + 0.12, S.eyeOut * 0.8);
      }
    } else {
      for (const pts of splitAt) ribbon(paint, pts, y, y + 0.12, S.eyeOut);
    }
    if (S.eyebrow === 'band' || S.style === 'band') {
      paint.color(accent);
      for (const pts of splitAt) ribbon(paint, pts, y + 0.2, y + 0.42, 0.015);
      paint.color(trim);
    }
  }
  // speed lines wrapping rounded corners
  for (const [r, zA, zB] of [[r0, -Infinity, z0 + r0 + 1.6], [r1, z1 - r1 - 1.6, Infinity]]) {
    if (r <= 0) continue;
    const pts = outline(fx, z0, z1, r0, r1, zA, zB, 12);
    paint.color(trim);
    for (let k = 0; k < 3; k++) ribbon(paint, pts, H - 0.3 + k * 0.2, H - 0.24 + k * 0.2, 0.035);
  }
  // decorative medallions high on the facade
  if (S.medallions && S.style !== 'bay') {
    paint.color(trim);
    const y = top - 0.95 - (S.style === 'band' ? 0.2 : 0);
    const n = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const z = zf0 + 0.6 + i * 0.75;
      if (upperCols.some((c) => Math.abs(c - z) < unit / 2 + 0.4)) continue;
      cyl(paint, [fx - 0.02, y, z], [fx + 0.06, y, z], 0.26, 16, [0, 1, 0], 0, Math.PI * 2, true);
    }
  }

  // ---- central element -------------------------------------------------------------
  let signDone = false;
  const signStyle = {
    // painted channel letters that read against pale stucco
    fill: S.style === 'pylon' ? pick(rnd, ['#f5f1e8', '#f7efd8']) : pick(rnd, ['#2f6a6a', '#8a3f45', '#9a6f32', '#34506e', '#3c3f45', '#b85f5a', '#3f7a5e']),
    edge: 'rgba(30,25,22,0.6)',
    tube: pick(rnd, ['#ff9fc4', '#9ff2ea', '#fff2c0', '#ffc59a', '#c8b8ff']),
    font: S.signFont,
  };
  const name = S.name;
  if (S.style === 'pylon') {
    const pd = 0.35, yb = G + gH - 0.25, yt = top + 2.4 + rnd() * 2.2;
    const col = rnd() < 0.5 ? accent : trim;
    paint.color(col);
    const pw = { o: [fx + pd, 0, 0], N: [1, 0, 0], holes: [], color: col };
    // glass-block strip down the pylon below the letters
    const letterTop = yt - 0.7;
    let vs = name ? atlas.vertical(name, signStyle) : null;
    const lh = vs ? Math.min(0.85, (letterTop - (yb + 2.5)) / vs.n) : 0;
    if (lh < 0.4) vs = null;
    const signBottom = vs ? letterTop - lh * vs.n : letterTop;
    if (S.glassBlock && signBottom - yb > 3.5) windowRecord(ctx, pw, -zc, (yb + 0.5 + signBottom - 0.5) / 2, 0.7, signBottom - yb - 1.0, { kind: 'block', depth: 0.1 });
    planarWall(paint, pw.o, pw.N, -(zc + cw / 2), -(zc - cw / 2), yb, yt, pw.holes);
    box(paint, fx - 0.3, fx + pd, yb, yt, zc - cw / 2, zc + cw / 2, { '+x': true, '-x': true });
    // stepped cap and horizontal bars near the top
    paint.color(trim);
    box(paint, fx - 0.3, fx + pd + 0.08, yt, yt + 0.25, zc - cw / 2 - 0.08, zc + cw / 2 + 0.08);
    box(paint, fx - 0.3, fx + pd + 0.02, yt + 0.25, yt + 0.6, zc - cw / 2 + 0.35, zc + cw / 2 - 0.35);
    for (let k = 0; k < 4; k++) {
      const y = top - 0.4 - k * 0.45;
      for (const s of [-1, 1]) box(paint, fx + pd - 0.02, fx + pd + 0.05, y, y + 0.14, zc + s * (cw / 2) - (s > 0 ? 0.45 : 0), zc + s * (cw / 2) + (s < 0 ? 0.45 : 0));
    }
    if (vs) {
      signQuad(B.signs, [fx + pd + 0.06, (letterTop + signBottom) / 2, zc], [1, 0, 0], lh * vs.aspect * vs.n, lh * vs.n, vs.uv);
      signDone = true;
    }
  } else if (S.style === 'fin') {
    const fd = 1.15, ft = 0.32, yb = G + gH + 0.2, yt = top + 2.6 + rnd() * 2.0;
    const col = rnd() < 0.5 ? trim : accent;
    paint.color(col);
    box(paint, fx - 0.2, fx + fd - ft / 2, yb, yt, zc - ft / 2, zc + ft / 2);
    cyl(paint, [fx + fd - ft / 2, yb, zc], [fx + fd - ft / 2, yt, zc], ft / 2, 10, [1, 0, 0], -Math.PI / 2, Math.PI / 2);
    box(paint, fx - 0.2, fx + fd * 0.7, yt, yt + 0.5, zc - ft / 2 - 0.05, zc + ft / 2 + 0.05);
    box(paint, fx - 0.2, fx + fd * 0.4, yt + 0.5, yt + 0.95, zc - ft / 2 - 0.05, zc + ft / 2 + 0.05);
    // underside cap
    paint.quad([fx - 0.2, yb, zc - ft / 2], [fx + fd - ft / 2, yb, zc - ft / 2], [fx + fd - ft / 2, yb, zc + ft / 2], [fx - 0.2, yb, zc + ft / 2], [0, -1, 0]);
    const vs = name ? atlas.vertical(name, signStyle) : null;
    if (vs) {
      const lh = Math.min(0.8, (yt - 0.5 - (yb + 1.0)) / vs.n);
      const yc = yt - 0.4 - (lh * vs.n) / 2;
      const w = lh * vs.aspect * vs.n;
      for (const s of [-1, 1]) signQuad(B.signs, [fx + 0.1 + fd / 2, yc, zc + s * (ft / 2 + 0.04)], [0, 0, s], w, lh * vs.n, vs.uv);
      signDone = true;
    }
  } else if (S.style === 'bay') {
    const bd = 0.9, rb = 0.8;
    const bz0 = zc - cw / 2, bz1 = zc + cw / 2, bfx = fx + bd, btop = top + 0.5;
    const bw = { o: [bfx, 0, 0], N: [1, 0, 0], holes: [], color: body };
    const bays = spread(bz0 + rb + 0.3, bz1 - rb - 0.3, S.ww, 0.6);
    for (let f = 1; f < floors; f++) {
      const y0 = G + gH + (f - 1) * fh;
      for (const z of bays) windowRecord(ctx, bw, -z, y0 + sill + winH / 2, S.ww, winH, { interior: interiorFor(rnd, 'win') });
    }
    windowRecord(ctx, bw, -zc, G + doorH / 2, doorW, doorH, { kind: 'door', interior: [6, 0, rnd(), rnd()], depth: 0.35 });
    paint.color(body);
    planarWall(paint, bw.o, bw.N, -(bz1 - rb), -(bz0 + rb), G - 0.2, btop, bw.holes);
    arcWall(paint, bfx - rb, bz0 + rb, rb, -Math.PI / 2, 0, G - 0.2, btop, 8);
    arcWall(paint, bfx - rb, bz1 - rb, rb, 0, Math.PI / 2, G - 0.2, btop, 8);
    box(paint, fx - 0.1, bfx - rb, G - 0.2, btop, bz0, bz1, { '+x': true, '-x': true, '-y': true });
    const bo = outline(bfx, bz0, bz1, rb, rb, -Infinity, Infinity, 8);
    paint.color(trim);
    ribbon(paint, bo, btop - 0.1, btop + 0.06, 0.07);
    for (let k = 0; k < 3; k++) ribbon(paint, bo, btop - 0.75 + k * 0.17, btop - 0.69 + k * 0.17, 0.03);
    for (const y of eyebrowYs) ribbon(paint, bo, y, y + 0.12, S.eyeOut * 0.9);
    // vertical racing stripes rising up the bay
    paint.color(accent);
    for (const s of [-1, 1]) box(paint, bfx - 0.01, bfx + 0.02, G + gH, btop - 0.9, zc + s * (cw / 2 - rb - 0.12) - 0.07, zc + s * (cw / 2 - rb - 0.12) + 0.07);
    if (name) {
      const hs = atlas.horizontal(name, signStyle);
      if (hs) {
        const h = Math.min(0.7, (cw - 1.2) / hs.aspect);
        signQuad(B.signs, [bfx + 0.06, top - 0.35, zc], [1, 0, 0], h * hs.aspect, h, hs.uv);
        signDone = true;
      }
    }
  } else if (S.style === 'ziggurat') {
    // stepped parapet and a relief panel down the middle
    paint.color(COL.stoneGrey);
    box(paint, fx - 0.2, fx + 0.05, G + gH + 0.1, top, zc - cw / 2, zc + cw / 2, { '-x': true });
    paint.color(body);
    const steps = 3;
    let w = Math.min(W * 0.5, 9);
    for (let s = 0; s < steps; s++) {
      const y0 = top + s * 0.65;
      box(paint, fx - 1.2, fx + 0.03, y0, y0 + 0.65, zc - w / 2, zc + w / 2, { '-y': true });
      paint.color(trim);
      box(paint, fx - 1.2, fx + 0.09, y0 + 0.53, y0 + 0.65, zc - w / 2 - 0.05, zc + w / 2 + 0.05);
      paint.color(body);
      w -= 2.2;
      if (w < 1.4) break;
    }
  }

  // ---- ground floor: canopy, entrance, porch, patio ----------------------------------
  paint.w = [100, fh, 0.8];
  const canY = G + gH - 0.35;
  if (S.canopy === 'full') {
    paint.color(trim);
    for (const pts of (S.style === 'bay' ? splitAt : [full])) ribbon(paint, pts, canY, canY + 0.22, 1.3);
    paint.color(accent);
    for (const pts of (S.style === 'bay' ? splitAt : [full])) ribbon(paint, pts.map((p) => ({ ...p })), canY + 0.22, canY + 0.3, 0.02);
  }
  const entranceX = S.style === 'bay' ? fx + 0.9 : fx;
  let pilasterTop = G + gH - 0.4;
  if (S.canopy === 'entrance' || S.canopy === 'awning' || S.style === 'bay') {
    // entrance canopy: thin slab with a rounded front
    const cwid = doorW + 1.6 + rnd() * 1.2, cp = 1.6 + rnd() * 0.6;
    const cy = G + doorH + 0.45;
    pilasterTop = cy - 0.01;
    const shape = new THREE.Shape();
    const rr = Math.min(0.6, cp * 0.5);
    shape.moveTo(entranceX - 0.05, -(zc - cwid / 2));
    shape.lineTo(entranceX + cp - rr, -(zc - cwid / 2));
    shape.absarc(entranceX + cp - rr, -(zc - cwid / 2) - rr, rr, Math.PI / 2, 0, true);
    shape.lineTo(entranceX + cp, -(zc + cwid / 2) + rr);
    shape.absarc(entranceX + cp - rr, -(zc + cwid / 2) + rr, rr, 0, -Math.PI / 2, true);
    shape.lineTo(entranceX - 0.05, -(zc + cwid / 2));
    const eg = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false, curveSegments: 6 });
    eg.rotateX(-Math.PI / 2);
    paint.color(trim);
    pushGeometry(paint, eg, new THREE.Matrix4().makeTranslation(0, cy, 0));
    eg.dispose();
    paint.color(accent);
    box(paint, entranceX + cp - 0.02, entranceX + cp + 0.01, cy + 0.02, cy + 0.12, zc - cwid / 2 + rr, zc + cwid / 2 - rr);
    if (!signDone && name) {
      const hs = atlas.horizontal(name, signStyle);
      if (hs) {
        const h = Math.min(0.7, (cwid + 1.6) / hs.aspect);
        signQuad(B.signs, [entranceX + cp - 0.12, cy + 0.2 + h / 2, zc], [1, 0, 0], h * hs.aspect, h, hs.uv);
        signDone = true;
      }
    }
  }
  if (!signDone && name) {
    const hs = atlas.horizontal(name, signStyle);
    if (hs) {
      const h = Math.min(1.0, (W * 0.6) / hs.aspect, ph + 0.5);
      const y = S.style === 'ziggurat' ? top + 0.55 : top - ph / 2 - 0.05;
      signQuad(B.signs, [fx + (S.style === 'ziggurat' ? 0.09 : 0.06), y, zc], [1, 0, 0], h * hs.aspect, h, hs.uv);
    }
  }
  // fluted pilasters flanking the entrance
  if (!entranceInBay && rnd() < 0.6) {
    paint.color(trim);
    for (const s of [-1, 1]) {
      const pz = zc + s * (doorW / 2 + 0.3);
      box(paint, fx - 0.05, fx + 0.1, G, pilasterTop, pz - 0.2, pz + 0.2, { '-x': true });
      for (let k = 0; k < 4; k++) {
        const z = pz - 0.15 + k * 0.1;
        cyl(paint, [fx + 0.1, G, z], [fx + 0.1, pilasterTop, z], 0.045, 5, [1, 0, 0], -Math.PI / 2, Math.PI / 2);
      }
    }
  }

  if (S.detail > 0 && S.porch) buildPorch(S, B, ctx, rnd, { doorW, zc, zf0, zf1, storeCols, mirrorCols, gbDone });
  if (S.detail > 0 && (S.canopy === 'awning' || S.patio === 'awning')) {
    for (const z of [...storeCols, ...mirrorCols]) awning(B.fabric, fx, z, 2.9, G + storeSill + storeH + 0.35, 1.3, S.awningColor ?? pick(rnd, AWNING_COLS), rnd() < 0.6);
  }
}

// Striped canvas awning over a storefront window.
function awning(b, fx, zc, w, yTop, d, color, striped) {
  const drop = 0.7, val = 0.28;
  b.color(color);
  const v = striped ? 0.25 : 0.75;
  const a = [fx, yTop, zc - w / 2], bb = [fx, yTop, zc + w / 2];
  const c = [fx + d, yTop - drop, zc + w / 2], dd = [fx + d, yTop - drop, zc - w / 2];
  const n = norm([drop, d, 0]);
  const su = (z) => (z - (zc - w / 2)) / 0.32;
  b.quadUV(a, bb, c, dd, n, [su(zc - w / 2), v], [su(zc + w / 2), v], [su(zc + w / 2), v], [su(zc - w / 2), v]);
  const e = [fx + d, yTop - drop - val, zc + w / 2], f = [fx + d, yTop - drop - val, zc - w / 2];
  b.quadUV(dd, c, e, f, [1, 0, 0], [su(zc - w / 2), v], [su(zc + w / 2), v], [su(zc + w / 2), v], [su(zc - w / 2), v]);
  for (const s of [-1, 1]) {
    const z = zc + s * w / 2;
    b.v([fx, yTop, z], [0, 0, s], [0, v]); b.v([fx + d, yTop - drop, z], [0, 0, s], [0, v]); b.v([fx + d, yTop - drop - val, z], [0, 0, s], [0, v]);
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
  // raised terrazzo porch
  terr.quad([fx, py, pz0], [px, py, pz0], [px, py, pz1], [fx, py, pz1], UP);
  paint.color(new THREE.Color(scheme.body).multiplyScalar(0.92).getHex());
  box(paint, fx - 0.1, px, G - 0.1, py, pz0, pz1, { '+y': true, '-x': true, '-y': true });
  // steps down to the sidewalk at the entrance
  const sw = L.doorW + 0.8;
  for (let i = 0; i < 3; i++) {
    const y = G + 0.15 * (i + 1), x1 = px + 0.32 * (3 - i);
    paint.color(COL.stoneGrey);
    box(paint, px - 0.05, x1, G - 0.05, y, zc - sw / 2, zc + sw / 2, { '+y': true, '-x': true, '-y': true });
    terr.quad([px - 0.05, y, zc - sw / 2], [x1, y, zc - sw / 2], [x1, y, zc + sw / 2], [px - 0.05, y, zc + sw / 2], UP);
  }
  // low front wall with rounded cap, or pipe railing, with a gap at the steps
  const rails = [[pz0, zc - sw / 2], [zc + sw / 2, pz1]];
  const railCol = rnd() < 0.5 ? scheme.trim : scheme.accent;
  for (const [a, b] of rails) {
    if (b - a < 0.5) continue;
    if (S.rail === 'wall') {
      paint.color(railCol);
      box(paint, px - 0.24, px, py, py + 0.72, a, b, { '-y': true });
      cyl(paint, [px - 0.12, py + 0.72, a], [px - 0.12, py + 0.72, b], 0.12, 8, [0, 1, 0], -Math.PI / 2, Math.PI / 2);
      paint.color(scheme.body);
      box(paint, px - 0.26, px + 0.02, py - 0.02, py + 0.12, a, b, { '-y': true });
    } else {
      paint.color(railCol);
      box(paint, px - 0.22, px, py, py + 0.35, a, b, { '-y': true });
      metal.color(railCol === scheme.trim ? scheme.accent : scheme.trim);
      for (let k = 0; k < 3; k++) {
        const y = py + 0.5 + k * 0.17;
        cyl(metal, [px - 0.11, y, a], [px - 0.11, y, b], 0.022, 6, [0, 1, 0]);
      }
      for (let z = a; z <= b + 1e-3; z += Math.max(1.2, (b - a) / Math.ceil((b - a) / 1.8))) {
        cyl(metal, [px - 0.11, py + 0.35, z], [px - 0.11, py + 0.9, z], 0.03, 6, [1, 0, 0]);
      }
    }
    // planters with shrubs at the wall ends
    paint.color(scheme.accent);
    for (const z of [a + 0.45, b - 0.45]) {
      box(paint, px - 0.8, px - 0.25, py, py + 0.55, z - 0.3, z + 0.3, { '-y': true });
      ctx.shrubs.push({ x: px - 0.52, y: py + 0.62, z, s: 0.5 + rnd() * 0.2 });
    }
  }
  // cafe tables on the porch
  const depth = px - fx;
  if (S.patio !== 'none' && depth > 1.6) {
    for (let z = pz0 + 1.3; z < pz1 - 1.0; z += 2.1 + rnd() * 0.5) {
      if (Math.abs(z - zc) < sw / 2 + 0.7) continue;
      tableSet(ctx, rnd, (fx + px) / 2 + 0.1, py, z, depth > 2.4 ? 3 : 2);
    }
  }
  // sidewalk cafe with market umbrellas
  if (S.patio === 'umbrella') {
    const col = pick(rnd, UMBRELLA_COLS);
    for (let z = pz0 + 1.4; z < pz1 - 1.2; z += 3.0 + rnd() * 0.6) {
      if (Math.abs(z - zc) < sw / 2 + 1.2) continue;
      const x = px + 1.15;
      ctx.umbrellas.push({ x, y: G, z, color: rnd() < 0.8 ? col : pick(rnd, UMBRELLA_COLS), r: 1.15 + rnd() * 0.15, h: 2.55 + rnd() * 0.15 });
      metal.color(0xd9d6cf);
      tableSet(ctx, rnd, x, G, z, 4, true);
    }
  }
}

function tableSet(ctx, rnd, x, y, z, chairs, pole = false) {
  const a0 = rnd() * Math.PI * 2;
  ctx.tables.push({ x, y, z, rot: a0, tall: pole });
  const chairCol = ctx.chairCol;
  for (let i = 0; i < chairs; i++) {
    const a = a0 + (i / chairs) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
    const r = 0.62 + rnd() * 0.1;
    ctx.chairs.push({ x: x + Math.cos(a) * r, y, z: z + Math.sin(a) * r, rot: -a - Math.PI / 2 + (rnd() - 0.5) * 0.5, color: chairCol });
  }
}

// ---------------------------------------------------------------------------
// Materials
function paintMaterial() {
  const map = noiseColorTexture({ size: 512, seed: 91, colorA: [238, 236, 232], colorB: [255, 255, 255], baseCells: 6, speckle: 0.035, contrast: 1.1 });
  map.repeat.set(1 / 3.0, 1 / 3.0);
  const normalMap = noiseNormalTexture({ size: 256, seed: 17, baseCells: 32, strength: 1.0, octaves: 3 });
  normalMap.repeat.set(1 / 1.2, 1 / 1.2);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map, normalMap, normalScale: new THREE.Vector2(0.09, 0.09), roughness: 0.9 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aW;\nvarying vec3 vOdW;\nvarying vec3 vOdP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvOdW = aW;\nvOdP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vOdW;
        varying vec3 vOdP;
        float odVh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float odVn(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(odVh(i), odVh(i + vec2(1.0, 0.0)), f.x), mix(odVh(i + vec2(0.0, 1.0)), odVh(i + vec2(1.0, 1.0)), f.x), f.y);
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
          // grime splashed up at the foot of the wall
          float dirt = exp(-hb / 0.45) * (0.7 + 0.3 * odVn(vec2(along * 3.0, 0.0)));
          float k = (1.0 - 0.07 * st * vOdW.z * vert - 0.2 * dirt * vOdW.z * vert) * (0.965 + 0.06 * pch);
          reflectedLight.directDiffuse *= k;
          reflectedLight.indirectDiffuse *= k;
          // less sky seen low in the street; contact occlusion at the foot
          float ao = (0.72 + 0.28 * smoothstep(0.0, 9.0, hb)) * (1.0 - 0.4 * exp(-hb / 0.4) * vert);
          reflectedLight.indirectDiffuse *= ao;
          // light bounced off the sunlit sidewalk and street onto the lower facade
          reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.10, 0.075, 0.055) * exp(-hb / 2.5) * vert;
        }`);
  };
  m.customProgramCacheKey = () => 'hotel-paint-v1';
  return m;
}

function glassMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x0a0c0f, roughness: 0.08, metalness: 0.0, envMapIntensity: 0 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aWin;\nvarying vec4 vWin;\nvarying vec2 vGUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin;\nvGUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vWin;\nvarying vec2 vGUv;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (vWin.x > 3.5 && vWin.x < 4.5 && length(vGUv - 0.5) > 0.5) discard;`)
      .replace('#include <opaque_fragment>', `
        #ifdef USE_FOG
        {
          vec3 nW = normalize(inverseTransformDirection(normal, viewMatrix));
          // panes are never perfectly flat or aligned: a small per-window tilt
          vec3 tilt = vec3(0.0, fract(vWin.w * 7.13) - 0.5, fract(vWin.w * 3.71) - 0.5) * 0.045;
          vec3 nT = normalize(nW + tilt - nW * dot(tilt, nW));
          vec3 I = normalize(vFogOffset);
          vec3 R = reflect(I, nT);
          float cosT = clamp(dot(-I, nT), 0.0, 1.0);
          float F = 0.08 + 0.92 * pow(1.0 - cosT, 5.0);
          vec3 Rs = normalize(vec3(R.x, max(R.y, 0.0), R.z));
          vec3 sky = max(odSkyBase(Rs, 0.0) - odSunGlow(dot(Rs, OD_SUN), 0.7, 0.0), 0.0);
          // below the horizon: the street, palms and park across the road
          float band = smoothstep(0.0, 0.035, R.y) * (1.0 - smoothstep(0.05, 0.28, R.y));
          float palms = band * smoothstep(0.35, 0.65, fract(sin(floor(atan(R.z, R.x) * 60.0) * 91.7) * 473.1)) * 0.75;
          vec3 refl = mix(sky, vec3(0.045, 0.045, 0.04), max(smoothstep(0.02, -0.05, R.y), palms));
          vec3 glint = directLight.color * pow(max(dot(R, OD_SUN), 0.0), 20000.0) * 10.0;

          // what is behind the glass
          vec2 uv = vGUv;
          float type = vWin.x > 3.5 && vWin.x < 4.5 ? 0.0 : vWin.x;
          vec3 room = vec3(0.010, 0.009, 0.009) * (1.0 + 2.0 * (1.0 - uv.y));
          float sunIn = max(dot(nW, OD_SUN), 0.0);
          // (sun reaching the curtains through the pane, plus dim room light)
          vec3 lightIn = directLight.color * sunIn * 0.2 + vec3(0.045, 0.045, 0.055);
          float pk = fract(vWin.z * 3.0);
          vec3 cur = pk < 0.35 ? vec3(0.74, 0.73, 0.70) : pk < 0.55 ? vec3(0.66, 0.60, 0.50)
                   : pk < 0.7 ? vec3(0.45, 0.56, 0.58) : pk < 0.82 ? vec3(0.66, 0.50, 0.48)
                   : pk < 0.92 ? vec3(0.40, 0.42, 0.50) : vec3(0.55, 0.60, 0.46);
          cur *= 0.85 + 0.15 * vWin.z;
          vec3 inner = room;
          float open = 0.0;
          if (type > 0.5 && type < 1.5) {          // venetian blinds lowered part way
            float cover = step(1.0 - vWin.y, uv.y);
            float slat = 0.7 + 0.3 * smoothstep(0.3, 0.5, fract(uv.y * 26.0));
            inner = mix(room, cur * lightIn * slat, cover);
          } else if (type > 1.5 && type < 2.5) {   // curtains drawn to the sides
            float hf = vWin.y * 0.5;
            float cover = step(uv.x, hf) + step(1.0 - hf, uv.x);
            float fold = 0.75 + 0.25 * sin(uv.x * 70.0 + vWin.w * 9.0);
            inner = mix(room, cur * lightIn * fold, clamp(cover, 0.0, 1.0));
          } else if (type > 2.5 && type < 3.5) {   // sheer curtain
            inner = mix(room, cur * lightIn * (0.8 + 0.2 * sin(uv.x * 90.0)), vWin.y * 0.75);
          } else if (type > 5.5 && type < 6.5) {   // lobby / shop: lamps on, warm
            inner = vec3(0.06, 0.042, 0.026) * (0.6 + 0.8 * smoothstep(0.0, 0.4, uv.y) * (1.0 - smoothstep(0.7, 1.0, uv.y))) + vec3(0.02) * step(0.9, fract(uv.x * 4.0));
          } else if (type > 6.5) {                  // casement left open
            open = 1.0;
            inner = room * 0.6;
          }
          F *= 1.0 - open;
          outgoingLight = inner * (1.0 - F) + refl * F + glint * (1.0 - open);
        }
        #endif
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'hotel-glass-v1';
  return m;
}

function fabricMaterial() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, 64, 32);          // top half (v 0.5..1): solid
  c.fillStyle = '#000'; c.fillRect(0, 32, 64, 32);         // bottom half: stripes
  c.fillStyle = '#fff'; c.fillRect(0, 32, 32, 32);
  const map = new THREE.CanvasTexture(cv);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map, roughness: 0.85, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', `
        float odSt = texture2D(map, vMapUv).r;
        diffuseColor.rgb = mix(vec3(0.86, 0.85, 0.82), vColor.rgb, odSt);`)
      .replace('#include <color_fragment>', '')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        #ifdef USE_FOG
        {
          // canvas glows with the sun shining through it
          vec3 wn = inverseTransformDirection(normal, viewMatrix);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * OD_SUNCOL * OD_SUN_I * 0.022 * max(-wn.y, 0.0);
        }
        #endif`);
  };
  m.customProgramCacheKey = () => 'hotel-fabric-v1';
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
  bx(0.42, 0.035, 0.42, 0, 0.45, 0);
  bx(0.42, 0.36, 0.03, 0, 0.66, -0.2);
  bx(0.42, 0.04, 0.03, 0, 0.86, -0.2);
  for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) bx(0.025, 0.45, 0.025, x, 0.225, z);
  return mergeGeometries(parts);
}
function tableGeometry() {
  const top = new THREE.CylinderGeometry(0.36, 0.36, 0.03, 20); top.translate(0, 0.74, 0);
  const pole = new THREE.CylinderGeometry(0.03, 0.03, 0.72, 6); pole.translate(0, 0.37, 0);
  const base = new THREE.CylinderGeometry(0.22, 0.24, 0.03, 12); base.translate(0, 0.015, 0);
  return mergeGeometries([top, pole, base]);
}
function umbrellaGeometry() {
  // eight ribbed panels sagging slightly between the ribs, plus a short valance
  const g = new THREE.ConeGeometry(1, 0.32, 16, 2, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
    const a = Math.atan2(z, x), rr = Math.hypot(x, z);
    const sag = (1 - Math.abs(Math.cos(a * 4))) * 0.04 * rr;
    p.setY(i, y - sag);
  }
  g.translate(0, 0.16, 0);
  const val = new THREE.CylinderGeometry(1, 1, 0.16, 16, 1, true);
  val.translate(0, -0.08, 0);
  const m = mergeGeometries([g.toNonIndexed(), val.toNonIndexed()]);
  m.computeVertexNormals();
  return m;
}
function shrubGeometry() {
  const g = new THREE.IcosahedronGeometry(0.5, 2);
  const p = g.attributes.position;
  const rnd = mulberry32(3);
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!cache.has(key)) cache.set(key, 0.8 + rnd() * 0.35);
    const k = cache.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.9, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Street plan: the authored block z in [-70, 70], then simpler buildings beyond.
function streetPlan() {
  const rnd = mulberry32(20260927);
  const S = SCHEMES;
  const plan = [
    // z0, z1, overrides
    [-70, -52.5, { floors: 3, style: 'band', r0: 3.2, r1: 0, scheme: S[0], name: 'THE CORALINE', canopy: 'entrance', patio: 'awning', porch: true }],
    [-50.8, -35.6, { floors: 3, style: 'fin', r0: 0, r1: 0, scheme: S[3], name: 'SEAGROVE', canopy: 'full', patio: 'porch' }],
    [-33.8, -15.2, { floors: 4, style: 'ziggurat', r0: 0, r1: 0, scheme: { body: COL.white, trim: COL.mintDeep, accent: COL.seagreen }, name: 'BELLA MAR', canopy: 'full', patio: 'porch', setback: 0.8 }],
    [-13.6, 2.2, { floors: 3, style: 'pylon', r0: 0, r1: 0, scheme: S[2], name: 'PALMIRA', canopy: 'entrance', patio: 'umbrella', porch: true, setback: 0 }],
    [3.8, 24.6, { floors: 3, style: 'bay', r0: 1.8, r1: 1.8, scheme: S[1], name: 'AZURINE', canopy: 'awning', patio: 'awning', setback: 0.4 }],
    [26.4, 40.2, { floors: 2, style: 'plain', r0: 1.6, r1: 1.6, scheme: S[5], name: 'ORIANA', canopy: 'full', patio: 'umbrella' }],
    [41.8, 56.0, { floors: 4, style: 'fin', r0: 0, r1: 0, scheme: S[6], name: 'MARINELLA', canopy: 'entrance', patio: 'umbrella', setback: 1.2 }],
    [57.6, 70, { floors: 3, style: 'pylon', r0: 0, r1: 3.0, scheme: S[7], name: 'SOLANA', canopy: 'full', patio: 'awning' }],
  ];
  const specs = plan.map(([a, b, o]) => makeSpec(rnd, a, b, { ...o, detail: 1 }));
  let nameI = 8;
  // continuing blocks: 18 m cross streets every ~160 m
  for (const dir of [1, -1]) {
    let blockStart = dir > 0 ? BLOCK.zMax + 18 : BLOCK.zMin - 18;
    while (Math.abs(blockStart) < 900) {
      const blockLen = 150 + rnd() * 30;
      let z = 0;
      while (z < blockLen - 10) {
        const w = Math.min(12 + rnd() * 13, blockLen - z);
        if (w < 8) break;
        const first = z === 0, last = z + w >= blockLen - 12;
        const za = dir > 0 ? blockStart + z : blockStart - z - w;
        const zb = za + w;
        const near = Math.abs((za + zb) / 2) < 260;
        const corner = dir > 0 ? { r0: first ? 2.5 + rnd() : undefined, r1: last ? 2.5 + rnd() : undefined }
          : { r1: first ? 2.5 + rnd() : undefined, r0: last ? 2.5 + rnd() : undefined };
        specs.push(makeSpec(rnd, za, zb, {
          ...Object.fromEntries(Object.entries(corner).filter(([, v]) => v !== undefined)),
          detail: near ? 1 : 0, name: near || rnd() < 0.5 ? NAMES[nameI++ % NAMES.length] : undefined,
        }));
        z += w + (rnd() < 0.5 ? 1.2 + rnd() * 2.5 : 0.4);
      }
      blockStart += dir * (blockLen + 18);
    }
  }
  return specs;
}

// ---------------------------------------------------------------------------
export function buildHotels(scene) {
  const group = new THREE.Group();
  group.name = 'hotels';
  const specs = streetPlan();
  const atlas = new SignAtlas();
  const chunks = [{ max: -80 }, { max: 80 }, { max: Infinity }].map((c) => ({
    ...c, paint: new Buf(), metal: new Buf(), fabric: new Buf(), terrazzo: new Buf(), block: new Buf(), signs: new Buf(),
  }));
  const ctx = { windows: [], chairs: [], tables: [], umbrellas: [], shrubs: [], chairCol: 0x6b5a45 };
  const rndC = mulberry32(99);
  for (const S of specs) {
    const zc = (S.z0 + S.z1) / 2;
    const B = chunks.find((c) => zc < c.max);
    ctx.chairCol = pick(rndC, [0x6b5a45, 0x3b3b3b, 0xe8e6e0, 0x7a8f8c, 0x8a6b4a, 0x2f5f6f]);
    buildHotel(S, B, ctx, atlas);
  }

  // window frames, sills, glass-block infill -> merged; glass and reveals -> instanced
  const rnd = mulberry32(4711);
  const glassIdx = [], revealRect = [], revealRound = [];
  for (const w of ctx.windows) {
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
    glassIdx.push(w);
    (w.round ? revealRound : revealRect).push(w);
    const m = B.metal;
    const t = w.kind === 'door' ? 0.08 : w.kind === 'store' ? 0.07 : 0.05;
    const x0 = -w.depth - 0.015, x1 = -w.depth + 0.04;
    const hw = w.w / 2, hh = w.h / 2;
    const fc = w.kind === 'door' || w.kind === 'store' ? (w.frame ?? 0x3a342d) : (w.frame ?? 0xeceeea);
    m.color(w.frameCol ?? fc);
    if (w.round) {
      const tor = new THREE.TorusGeometry(hw - 0.02, 0.04, 6, 24);
      const mat = new THREE.Matrix4().makeBasis(new THREE.Vector3(...neg(Z)), new THREE.Vector3(...UP), new THREE.Vector3(...Nv));
      mat.setPosition(...add(w.c, scl(Nv, -w.depth + 0.02)));
      pushGeometry(m, tor, mat);
      tor.dispose();
      continue;
    }
    lbox(m, F, x0, x1, hh - t, hh, -hw, hw);
    lbox(m, F, x0, x1, -hh, -hh + t, -hw, hw);
    lbox(m, F, x0, x1, -hh + t, hh - t, -hw, -hw + t);
    lbox(m, F, x0, x1, -hh + t, hh - t, hw - t, hw);
    const style = w.kind === 'door' ? 'door' : w.kind === 'store' ? 'store' : w.frameStyle ?? ['h3', 'cross', 'grid'][Math.floor(rnd() * 3)];
    const bar = t * 0.6;
    if (style === 'h3') {
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
    if (w.kind === 'win') {
      B.paint.color(w.reveal);
      B.paint.w = [100, 3, 0.3];
      lbox(B.paint, F, -w.depth, 0.06, -hh - 0.06, -hh, -hw - 0.06, hw + 0.06, { '-x': true });
    }
  }
  // assign per-window frame colours by building (stored on spec via window order)
  const glassMat = glassMaterial();
  const quad = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2);
  const glass = new THREE.InstancedMesh(quad, glassMat, glassIdx.length);
  const aWin = new Float32Array(glassIdx.length * 4);
  const m4 = new THREE.Matrix4(), vX = new THREE.Vector3(), vY = new THREE.Vector3(), vZ = new THREE.Vector3();
  const setM = (w, depthOffset, sx, sy, sz) => {
    const Z = cross(w.N, UP);
    vX.set(...w.N); vY.set(0, 1, 0); vZ.set(...Z);
    m4.makeBasis(vX.multiplyScalar(sx), vY.multiplyScalar(sy), vZ.multiplyScalar(sz));
    const p = add(w.c, scl(w.N, depthOffset));
    m4.setPosition(p[0], p[1], p[2]);
    return m4;
  };
  glassIdx.forEach((w, i) => {
    glass.setMatrixAt(i, setM(w, -w.depth, 1, w.h, w.w));
    const it = w.interior ?? [0, 0, rnd(), rnd()];
    aWin.set([w.round ? 4 : it[0], it[1], it[2], it[3]], i * 4);
  });
  glass.geometry = quad.clone();
  glass.geometry.setAttribute('aWin', new THREE.InstancedBufferAttribute(aWin, 4));
  glass.receiveShadow = true;
  group.add(glass);

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
    g.deleteAttribute('color'); g.deleteAttribute('aW');
    return g;
  })();
  const revealMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const reveals = new THREE.InstancedMesh(revealGeo, revealMat, revealRect.length);
  const col = new THREE.Color();
  revealRect.forEach((w, i) => {
    reveals.setMatrixAt(i, setM(w, 0, w.depth, w.h, w.w));
    reveals.setColorAt(i, col.setHex(w.reveal).multiplyScalar(0.93));
  });
  reveals.castShadow = reveals.receiveShadow = true;
  group.add(reveals);
  if (revealRound.length) {
    const tube = new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 1, true).rotateZ(Math.PI / 2).translate(-0.5, 0, 0);
    const rMat = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.BackSide });
    const rr = new THREE.InstancedMesh(tube, rMat, revealRound.length);
    revealRound.forEach((w, i) => {
      rr.setMatrixAt(i, setM(w, 0, w.depth, w.h, w.w));
      rr.setColorAt(i, col.setHex(w.reveal).multiplyScalar(0.93));
    });
    rr.castShadow = rr.receiveShadow = true;
    group.add(rr);
  }

  // merged static meshes per chunk
  const paintMat = paintMaterial();
  const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.35 });
  const fabricMat = fabricMaterial();
  const terrMat = terrazzoMaterial();
  const blockMat = glassBlockMaterial();
  const { map: signMap, em: signEm } = atlas.textures();
  const signMat = new THREE.MeshStandardMaterial({
    map: signMap, alphaTest: 0.5, roughness: 0.5, metalness: 0.25,
    emissive: 0xffffff, emissiveMap: signEm, emissiveIntensity: 0.35, side: THREE.DoubleSide,
  });
  for (const c of chunks) {
    const add = (buf, mat, cast = true) => {
      if (buf.empty) return;
      const g = buf.geometry();
      if (mat === signMat || mat === terrMat || mat === blockMat) g.deleteAttribute('color');
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      group.add(mesh);
    };
    add(c.paint, paintMat);
    add(c.metal, metalMat);
    add(c.fabric, fabricMat);
    add(c.terrazzo, terrMat, false);
    add(c.block, blockMat, false);
    add(c.signs, signMat);
  }

  // furniture
  const furnMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.2 });
  const q = new THREE.Quaternion(), yAx = new THREE.Vector3(0, 1, 0), s1 = new THREE.Vector3(1, 1, 1);
  const place = (mesh, items, fn) => {
    items.forEach((it, i) => {
      q.setFromAxisAngle(yAx, it.rot ?? 0);
      m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, fn ? fn(it) : s1);
      mesh.setMatrixAt(i, m4);
      if (it.color !== undefined) mesh.setColorAt(i, col.setHex(it.color));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  if (ctx.chairs.length) place(new THREE.InstancedMesh(chairGeometry(), furnMat, ctx.chairs.length), ctx.chairs);
  if (ctx.tables.length) {
    ctx.tables.forEach((t) => { t.color = 0xe9e6df; });
    place(new THREE.InstancedMesh(tableGeometry(), furnMat, ctx.tables.length), ctx.tables);
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
    place(new THREE.InstancedMesh(umbrellaGeometry(), umMat, ctx.umbrellas.length),
      ctx.umbrellas.map((u) => ({ ...u, y: u.y + u.h - 0.3, rot: 0.2 })), (u) => new THREE.Vector3(u.r, 1, u.r));
    const pole = new THREE.CylinderGeometry(0.022, 0.022, 1, 6).translate(0, 0.5, 0);
    place(new THREE.InstancedMesh(pole, furnMat, ctx.umbrellas.length),
      ctx.umbrellas.map((u) => ({ x: u.x, y: u.y, z: u.z, color: 0xd8d4cc })), (u) => new THREE.Vector3(1, ctx.umbrellas[0].h, 1));
  }
  if (ctx.shrubs.length) {
    const shrubMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const rs = mulberry32(8);
    place(new THREE.InstancedMesh(shrubGeometry(), shrubMat, ctx.shrubs.length),
      ctx.shrubs.map((s) => ({ ...s, rot: rs() * 6, color: [0x3f5a2c, 0x4a6632, 0x355026, 0x56703a][Math.floor(rs() * 4)] })),
      (s) => new THREE.Vector3(s.s * 1.3, s.s * 1.1, s.s * 1.3));
  }

  scene.add(group);
  window.__hotelStats = { buildings: specs.length, windows: ctx.windows.length, chairs: ctx.chairs.length, umbrellas: ctx.umbrellas.length };
  return group;
}
