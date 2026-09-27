// Shared surf clock: one list of wave events drives the visuals (shore-break crest,
// whitewater roller, swash sheet running up the sand) and, in live mode, is fed by the
// audio engine's own wave-break schedule so the crash and the wash-in line up.
// In ?shot mode (or before audio starts) a deterministic schedule is used instead.
//
// Event timing mirrors audio/waves.js breakAt(): with tempo k, the lip hits the water
// at 2.15k s, foam runs up the sand from 2.2k for 2.3k s, recedes from 4.5k over 4k s.
import * as THREE from 'three';
import { BREAK_X, SHORE_X, SWASH_MAX, SEA_LEVEL, sandHeight, sandDetail } from './layout.js';
import { mulberry32 } from '../textures/noise.js';

export const SURF_EVENTS = 4;
const T_BREAK = 2.15, T_WASH = 2.2, T_UP = 2.3, T_DOWN = 4.0, T_END = 9.5, T_LEAD = 5.0;

// ---------------------------------------------------------------------------
// swash model (JS; the GLSL below is the same maths)

function runupAt(e, z) {
  const R = Math.min(e.runup, SWASH_MAX);
  return R * (0.8 + 0.12 * Math.sin(z * 0.061 + e.ph) + 0.08 * Math.sin(z * 0.17 + 2 * e.ph))
    * (0.85 + 0.15 * Math.exp(-(((z - e.z) / 70) ** 2)));
}
// landward edge of one event's water at time t: { front, fresh } or null
function eventFront(e, z, t) {
  const tau = t - e.t0, k = e.k;
  const tb = T_WASH * k, tu = T_UP * k, td = T_DOWN * k;
  if (tau < tb || tau > tb + tu + td) return null;
  let r, fresh;
  if (tau < tb + tu) {
    const u = (tau - tb) / tu;
    r = 1 - (1 - u) * (1 - u);
    fresh = 1;
  } else {
    const d = (tau - tb - tu) / td;
    r = 1 - Math.pow(d, 1.4);
    fresh = 1 - d;
  }
  // lace lobes on the leading edge
  const lobes = (0.22 * Math.sin(z * 0.83 + e.ph * 3) + 0.12 * Math.sin(z * 2.1 + e.ph * 5) + 0.3 * Math.abs(Math.sin(z * 1.9 + e.ph * 2)) - 0.15) * r;
  return { front: BREAK_X - runupAt(e, z) * r + lobes, fresh };
}

export function createSurf({ frozen = false, anchorTime = 12.0 } = {}) {
  const events = [];
  const rnd = mulberry32(9121);
  let external = false;
  const make = (t0, o = {}) => ({
    t0, k: o.k ?? 0.85 + rnd() * 0.35, size: o.size ?? 0.55 + rnd() * 0.45,
    runup: 0, z: o.z ?? (rnd() - 0.5) * 80, ph: rnd() * 6.283,
  });
  const withRunup = (e, r) => { e.runup = r ?? (4 + rnd() * 4) * e.size; return e; };

  // deterministic schedule: a hero wash is 3/4 of the way up the sand at the frozen
  // shot time, the next set is building offshore
  const hero = withRunup(make(anchorTime - 3.9, { k: 1, size: 0.95, z: -8 }), 6.6);
  events.push(hero);
  let tNext = hero.t0 + 6.0, tPrev = hero.t0;
  for (let i = 0; i < 3; i++) { tPrev -= 6 + rnd() * 4; events.unshift(withRunup(make(tPrev))); }

  function extendTo(t) {
    if (external) return;
    while (tNext < t + T_LEAD + 1) { events.push(withRunup(make(tNext))); tNext += 6 + rnd() * 4; }
  }

  const uA = Array.from({ length: SURF_EVENTS }, () => new THREE.Vector4(-1e4, 1, 0, 0));
  const uB = Array.from({ length: SURF_EVENTS }, () => new THREE.Vector4());
  const uniforms = { uSurfA: { value: uA }, uSurfB: { value: uB }, uSurfT: { value: 0 } };

  let now = frozen ? anchorTime : 0;

  function active(t) {
    return events.filter((e) => t >= e.t0 - T_LEAD && t <= e.t0 + T_END * e.k);
  }

  const api = {
    uniforms,
    events,
    get time() { return now; },
    // live mode: audio reports each scheduled break; `visualT0` is on this clock
    pushAudioWave({ visualT0, k, size, runup, z }) {
      if (!external) {
        external = true;
        // drop deterministic waves that have not started yet
        for (let i = events.length - 1; i >= 0; i--) if (events[i].t0 > now) events.splice(i, 1);
      }
      const e = make(visualT0, { k, size, z });
      e.runup = runup;
      events.push(e);
      while (events.length > 24) events.shift();
    },
    update(t) {
      now = t;
      extendTo(t);
      const act = active(t).sort((a, b) => b.t0 - a.t0).slice(0, SURF_EVENTS);
      for (let i = 0; i < SURF_EVENTS; i++) {
        const e = act[i];
        if (e) { uA[i].set(e.t0, e.k, e.size, Math.min(e.runup, SWASH_MAX)); uB[i].set(e.z, e.ph, 0, 0); }
        else { uA[i].set(-1e4, 1, 0, 0); uB[i].set(0, 0, 0, 0); }
      }
      uniforms.uSurfT.value = t;
    },
    // Swash over the sand at (x, z): { covered, depth (m), foam 0..1, front (x of the
    // water's landward edge), fresh 0..1 (1 = rushing up, 0 = drained) }
    swashAt(x, z, t = now) {
      let best = null;
      for (const e of active(t)) {
        const f = eventFront(e, z, t);
        if (f && (!best || f.front < best.front)) best = f;
      }
      if (!best || x < best.front) return { covered: false, depth: 0, foam: 0, front: best ? best.front : BREAK_X, fresh: 0 };
      const s = x - best.front;
      const depth = Math.min(0.12, 0.012 + s * 0.022) * (0.35 + 0.65 * best.fresh);
      return { covered: true, depth, foam: Math.exp(-s / 0.5) * (0.4 + 0.6 * best.fresh), front: best.front, fresh: best.fresh };
    },
    // Water depth over the ground (swash sheet or the sea itself), m. 0 = dry.
    waterDepthAt(x, z, t = now) {
      const ground = sandHeight(x) + sandDetail(x, z);
      const sea = Math.max(0, SEA_LEVEL - ground);
      const sw = api.swashAt(x, z, t);
      return Math.max(sea, sw.covered ? sw.depth : 0);
    },
  };
  api.update(now);
  return api;
}

// ---------------------------------------------------------------------------
// GLSL: same model for the shaders (self-contained: also used in vertex shaders)

// Foam lace for the sea and the swash sheet (needs odNoise / odHash from the sky GLSL).
// Thin bubble filaments where Voronoi cells meet (F2 - F1), domain-warped at two scales
// and broken up by noise so no closed ring reads as a disc, over a thin milky film: the
// space between the strands is never darker than the clear water around the foam.
export const FOAM_GLSL = /* glsl */ `
vec2 odVor(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float m1 = 8.0, m2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 r = o + vec2(odHash(i + o), odHash(i + o + 19.7)) * 0.9 - f;
    float d = dot(r, r);
    if (d < m1) { m2 = m1; m1 = d; } else if (d < m2) m2 = d;
  }
  return sqrt(vec2(m1, m2));
}
float odFoam(vec2 p, float t) {
  vec2 w = vec2(odNoise(p * 0.9 + 2.3), odNoise(p * 0.9 + 7.9)) - 0.5;
  vec2 w2 = vec2(odNoise(p * 3.1 + 4.1), odNoise(p * 3.1 + 1.3)) - 0.5;
  vec2 pw = p + w * 1.1 + w2 * 0.2;
  vec2 A = odVor(pw * 2.6 + vec2(t * 0.15, 0.0));
  vec2 B = odVor(pw * 6.5 + w * 1.3 - vec2(0.0, t * 0.1) + 3.1);
  float fine = 1.0 - smoothstep(0.015, 0.04, fwidth(p.x) + fwidth(p.y));
  float wa = 0.05 + 0.12 * odNoise(p * 1.7 + 5.0);
  float la = 1.0 - smoothstep(0.0, wa, A.y - A.x);
  float lb = 1.0 - smoothstep(0.0, wa * 0.8, B.y - B.x);
  float brk = smoothstep(0.28, 0.62, odNoise(pw * 1.9 + 11.0));
  float brk2 = smoothstep(0.25, 0.6, odNoise(pw * 4.3 + 17.0));
  float grain = fine > 0.0 ? smoothstep(0.62, 0.85, odNoise(p * 26.0 + w * 3.0)) * fine : 0.0;
  float dens = odNoise(p * 0.6 + t * 0.05);
  // worm-like strands (isolines of warped value noise) so the net is never all polygons
  float r1 = 1.0 - abs(odNoise(pw * 3.3 + w2 * 1.5 + vec2(t * 0.05, 0.0)) * 2.0 - 1.0);
  float r2 = 1.0 - abs(odNoise(pw * 7.9 - w * 2.0 + 3.7) * 2.0 - 1.0);
  float lr = smoothstep(0.86, 0.97, r1) * 0.75 + smoothstep(0.88, 0.98, r2) * 0.45 * brk2;
  // bubbly clots where the foam gathers
  float clot = smoothstep(0.64, 0.82, odNoise(pw * 2.2 + 9.0)) * smoothstep(0.35, 0.7, odNoise(pw * 9.0 + 1.0));
  float lace = max(max(la * brk * 0.7, lr), clot * 0.65) + lb * brk2 * brk * (0.25 + 0.2 * dens) + grain * 0.22;
  float fPatch = smoothstep(0.3, 0.75, odNoise(pw * vec2(0.45, 0.2) + vec2(0.0, t * 0.03)));
  float film = 0.2 * fPatch * smoothstep(0.2, 0.8, odNoise(pw * 1.3 + 3.0));
  return clamp(lace * (0.3 + 0.7 * fPatch) + film, 0.0, 1.0);
}
`;

export const SURF_GLSL = /* glsl */ `
uniform vec4 uSurfA[${SURF_EVENTS}];   // t0, k, size, runup
uniform vec4 uSurfB[${SURF_EVENTS}];   // zc, phase
uniform float uSurfT;
const float SURF_BREAK_X = ${BREAK_X.toFixed(3)};
const float SURF_SHORE_X = ${SHORE_X.toFixed(3)};
float surfHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float surfN(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(surfHash(i), surfHash(i + vec2(1, 0)), u.x), mix(surfHash(i + vec2(0, 1)), surfHash(i + vec2(1, 1)), u.x), u.y);
}

float surfRunup(vec4 A, vec4 B, float z) {
  return A.w * (0.8 + 0.12 * sin(z * 0.061 + B.y) + 0.08 * sin(z * 0.17 + 2.0 * B.y))
    * (0.85 + 0.15 * exp(-pow((z - B.x) / 70.0, 2.0)));
}
// x = landward water edge (1e4 when dry), y = freshness, z = event size
vec3 surfFront(float z, float t) {
  vec3 best = vec3(1e4, 0.0, 0.0);
  for (int i = 0; i < ${SURF_EVENTS}; i++) {
    vec4 A = uSurfA[i]; vec4 B = uSurfB[i];
    float tau = t - A.x, k = A.y;
    float tb = ${T_WASH.toFixed(2)} * k, tu = ${T_UP.toFixed(2)} * k, td = ${T_DOWN.toFixed(2)} * k;
    if (tau < tb || tau > tb + tu + td) continue;
    float r, fresh;
    if (tau < tb + tu) { float u = (tau - tb) / tu; r = 1.0 - (1.0 - u) * (1.0 - u); fresh = 1.0; }
    else { float d = (tau - tb - tu) / td; r = 1.0 - pow(d, 1.4); fresh = 1.0 - d; }
    float lobes = (0.22 * sin(z * 0.83 + B.y * 3.0) + 0.12 * sin(z * 2.1 + B.y * 5.0) + 0.3 * abs(sin(z * 1.9 + B.y * 2.0)) - 0.15) * r;   // scalloped
    float f = SURF_BREAK_X - surfRunup(A, B, z) * r + lobes;
    if (f < best.x) best = vec3(f, fresh, A.z);
  }
  return best;
}
// Approaching crests (height, m) and whitewater on them. x/z world.
float surfCrest(float x, float z, float t, out float white) {
  float h = 0.0; white = 0.0;
  for (int i = 0; i < ${SURF_EVENTS}; i++) {
    vec4 A = uSurfA[i]; vec4 B = uSurfB[i];
    float tau = t - A.x, k = A.y;
    // the set breaks in short overlapping segments: each stretch of shore has its own
    // height, lag and break time, so the crest is never one ruler-straight roller
    float sg = surfN(vec2(z * 0.055 + B.y * 7.0, B.y * 3.1));
    float sg2 = surfN(vec2(z * 0.13 + B.y * 2.0, 5.0 + B.y));
    float tb = ${T_BREAK.toFixed(2)} * k + (sg - 0.5) * 1.6 + (sg2 - 0.5) * 0.5;
    if (tau < -${T_LEAD.toFixed(1)} || tau > tb + 2.5) continue;
    float amp = (0.4 + 0.4 * A.z) * (0.3 + 0.9 * smoothstep(0.2, 0.75, sg)) * (0.75 + 0.5 * sg2);
    float xc = SURF_BREAK_X + (tb - tau) * 3.0 + 1.2 * sin(z * 0.031 + B.y) + 0.5 * sin(z * 0.11 + 2.0 * B.y) + (sg2 - 0.5) * 1.6;
    float d = x - xc;
    float pre = clamp((tau + ${T_LEAD.toFixed(1)}) / (tb + ${T_LEAD.toFixed(1)}), 0.0, 1.0);   // 0 far out .. 1 at the break
    float wf = mix(2.2, 0.8, pre * pre);                 // shoreward face steepens
    float prof = d < 0.0 ? exp(-d * d / (wf * wf)) : exp(-d * d / 7.0);
    float grow = smoothstep(0.0, 0.5, pre);
    float collapse = tau < tb ? 1.0 : exp(-(tau - tb) / 0.45);
    h += amp * prof * grow * mix(0.25, 1.0, collapse);
    // spilling lip: white on the crest top around the break, then the collapsing roller
    float lip = smoothstep(tb - 0.6, tb, tau) * (tau < tb ? 1.0 : exp(-(tau - tb) / 1.2));
    vec2 wq = vec2(z * 1.3, x * 1.9 - t * 2.4);
    wq += vec2(surfN(wq * 0.37 + 3.0), surfN(wq * 0.41 + 8.0)) * 2.6;
    float wn2 = surfN(wq) * 0.65 + surfN(wq * 2.7 + 1.3) * 0.35;
    white = max(white, lip * smoothstep(0.35, 0.9, prof) * smoothstep(0.25, 0.7, wn2) * smoothstep(0.15, 0.5, amp));
  }
  // between the sets: 2-3 rows of small spilling breakers, segmented along the shore,
  // growing as they shoal, white on the crest and a whitewater trail behind once broken
  float ph = (x - SURF_BREAK_X) / 8.5 + t * 3.0 / 8.5 + 0.35 * sin(z * 0.05) + 0.9 * surfN(vec2(z * 0.035, x * 0.04));
  float f = fract(ph), row = floor(ph);
  float seg = smoothstep(0.35, 0.7, surfN(vec2(z * 0.07 + row * 3.7, row * 1.3))) * (0.5 + 0.5 * surfN(vec2(z * 0.19, row * 2.1)));
  float grow = smoothstep(SURF_BREAK_X + 30.0, SURF_BREAK_X + 8.0, x) * smoothstep(SURF_BREAK_X - 1.5, SURF_BREAK_X + 1.5, x);
  float back = exp(-f * f / 0.06), face = exp(-(1.0 - f) * (1.0 - f) / 0.02);
  float rp = max(back, face);
  h += (0.12 + 0.3 * seg) * grow * rp;
  float brk = seg * grow * smoothstep(SURF_BREAK_X + 12.0, SURF_BREAK_X + 5.0, x);
  vec2 wq2 = vec2(z * 0.9, x * 1.1 - t * 1.4);
  wq2 += vec2(surfN(wq2 * 0.43 + 2.0), surfN(wq2 * 0.39 + 6.0)) * 3.0;
  float wn = surfN(wq2) * 0.6 + surfN(wq2 * 2.3 + 4.0) * 0.4;
  white = max(white, brk * (smoothstep(0.8, 0.98, rp) + 0.6 * exp(-f / 0.12)) * smoothstep(0.35, 0.75, wn));
  return h;
}
`;
