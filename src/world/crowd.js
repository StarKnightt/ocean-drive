// Ocean Drive's people, Mixamo-bodied (world/mixamo.js): strollers, joggers and roller
// skaters on the park promenade, walkers on both sidewalks (one of them crossing Ocean Drive
// at the crosswalks), beach walkers at the waterline, people sitting on the park benches and
// at the hotel cafe tables, a few standing about - and a seated driver in every traffic car
// plus the player's own arms and legs at the convertible's wheel.
//
// Movers follow a path (open: they turn round at the ends; or a closed loop) at a lateral
// offset (keep right), and steer round whatever is ahead in their corridor - the player on
// foot, the player's bike / ATV / convertible, each other, street furniture and palms: they
// sidestep when there is room, slow and wait when there isn't, and turn back if blocked for
// long. Locomotion crossfades walk <-> idle (and jog / skate), the walk / jog playback rate
// follows the ground speed through each clip's measured foot speed, so feet don't slide.
// Crossers wait at the curb for a gap the cars can't stop for, and are handed to the traffic
// sim (peds()) so cars stop for them.
//
// Cost control: animation and draw only within CULL and the view frustum, LOD1 beyond
// LOD_AT, mixers stepped at a lower rate further away; tiered population.
// ?shot=1: frozen and deterministic, the harness frames as clear as before (a jogger south of
// view 1, a beach walker north of view 5, a far stroller); ?shot=1&people=closeup: the
// close-up placements of CLOSEUP below (tools/people-shots.mjs).
import * as THREE from 'three';
import { PARK, SUN, compassToDir, CURB_HEIGHT, SIDEWALK_W, SIDEWALK_E, HOTEL, LANES, CROSSWALK_Z, crossLegs, CROSS_STREETS } from './layout.js';
import { STREET_COLLIDERS, BENCHES } from './street.js';
import { PALM_TREES } from './palms.js';
import { QUALITY } from '../quality.js';
import { hotelLane } from './lanes.js';
import { createPerson, attachSkates, bakeSkateClip, SKATE_LIFT, ik2, measureGrip, gripHand, setWorldQuat } from './mixamo.js';

const TAU = Math.PI * 2;
const TIER = QUALITY.tier;
const CULL = { high: 140, medium: 100, low: 70 }[TIER] ?? 100;
const LOD_AT = { high: 16, medium: 12, low: 9 }[TIER] ?? 12;
const SHADOW_AT = { high: 75, medium: 50, low: 35 }[TIER] ?? 50;
const TERRACE_Y = CURB_HEIGHT + 0.45;
const SUN_DIR = compassToDir(SUN.azimuthDeg, SUN.elevationDeg, new THREE.Vector3());
const R_PERSON = 0.28;
export const promenadeX = (z) => PARK.promenadeX + 2.6 * Math.sin(z / 19) + 1.2 * Math.sin(z / 7.3);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------------------
// paths: polylines with arc length; closed loops wrap, open ones end (movers turn round)
function makePath(pts, { closed = false, half = 1.5, cross = null } = {}) {
  if (closed) pts = [...pts, pts[0]];
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = L[L.length - 1];
  const P = {
    total, closed, half, cross,
    at(s, out = {}) {
      if (closed) s = ((s % total) + total) % total; else s = clamp(s, 0, total);
      let lo = 0, hi = L.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
      const t = (s - L[lo]) / (L[hi] - L[lo] || 1), a = pts[lo], b = pts[hi];
      const dx = b[0] - a[0], dz = b[1] - a[1], dl = Math.hypot(dx, dz) || 1;
      out.x = a[0] + dx * t; out.z = a[1] + dz * t; out.dx = dx / dl; out.dz = dz / dl;
      return out;
    },
    // road crossings along the path: [{ s0, s1, z }] (s where it leaves / regains a curb)
    crossings: [],
  };
  if (cross) {
    // find where the path runs over the roadway
    const N = Math.ceil(total / 0.25), q = {};
    let inside = false, s0 = 0, deep = 0;
    for (let i = 0; i <= N; i++) {
      const s = (i / N) * total;
      P.at(s, q);
      const on = q.x > SIDEWALK_W.x1 && q.x < SIDEWALK_E.x0;
      if (on && !inside) { inside = true; s0 = s; deep = 0; }
      if (on) deep = Math.max(deep, Math.min(q.x - SIDEWALK_W.x1, SIDEWALK_E.x0 - q.x));
      // (a step down into the gutter round a pinch in the sidewalk isn't a crossing)
      if (!on && inside) { inside = false; if (deep > 1) P.crossings.push({ s0, s1: s, z: q.z }); }
    }
  }
  return P;
}
const sampled = (z0, z1, fx, step = 1) => { const pts = []; for (let z = z0; z <= z1 + 1e-6; z += step) pts.push([fx(z), z]); return pts; };

// ---------------------------------------------------------------------------
// static obstacles (palms, lamps, bins, benches...) in a coarse grid
function staticGrid(furniture = []) {
  const cell = 4, map = new Map(), all = [];
  const key = (i, j) => i * 100003 + j;
  const add = (x, z, r) => {
    const i = Math.floor(x / cell), j = Math.floor(z / cell);
    const k = key(i, j);
    if (!map.has(k)) map.set(k, []);
    const o = { x, z, r };
    map.get(k).push(o);
    all.push(o);
  };
  for (const c of STREET_COLLIDERS) {
    if (c.r) add(c.x, c.z, c.r);
    else if (c.min) {
      const w = c.max.x - c.min.x, d = c.max.z - c.min.z;
      if (w > 6 || d > 6) continue;
      // boxes as a row of circles along their long side
      const n = Math.max(1, Math.round(Math.max(w, d) / 0.6));
      const r = Math.min(w, d) / 2 + 0.05;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        add(w > d ? c.min.x + w * t : (c.min.x + c.max.x) / 2, w > d ? (c.min.z + c.max.z) / 2 : c.min.z + d * t, Math.max(r, Math.max(w, d) / n / 2));
      }
    }
  }
  for (const t of PALM_TREES) add(t.x, t.z, 0.3);
  for (const f of furniture) add(f.x, f.z, f.r);
  return {
    all,
    near(x, z, out) {
      const i0 = Math.floor(x / cell), j0 = Math.floor(z / cell);
      for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
        const l = map.get(key(i, j));
        if (l) for (const o of l) out.push(o);
      }
      return out;
    },
  };
}

// soft elliptical contact patch (alpha only), darkest under the middle
function contactTexture() {
  const N = 64, px = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N * 2 - 1, v = (j + 0.5) / N * 2 - 1;
    const r = Math.min(1, Math.hypot(u, v));
    px.set([255, 255, 255, Math.round(255 * (1 - r) ** 1.8)], (j * N + i) * 4);
  }
  const t = new THREE.DataTexture(px, N, N);
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// wardrobe: clothing dyes per zone [r, g, b, amount] (linear), picked per person
const lin = (hex, a = 1) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b, a]; };
const TOPS = [0xf4f1ea, 0xe8756a, 0x3fa9a6, 0xf2a6b8, 0x243a5e, 0xf2c94c, 0x9bc46a, 0xb9a6d9, 0x2b2b2e, 0x9aa3a8, 0x6fb6e0, 0xd8573f].map((h) => lin(h, 0.92));
const BOTTOMS = [null, null, lin(0xc8b894, 0.9), lin(0xf0eee8, 0.9), lin(0x22252b, 0.9), lin(0x2d3b5a, 0.85), lin(0x6d6a44, 0.9)];
const SHOES = [null, null, lin(0xf2f2ee, 0.85), lin(0x3a3e45, 0.85), lin(0x9a4a3a, 0.8)];
function outfit(rnd) {
  const t = TOPS[Math.floor(rnd() * TOPS.length)];
  return [rnd() < 0.2 ? null : t, BOTTOMS[Math.floor(rnd() * BOTTOMS.length)], SHOES[Math.floor(rnd() * SHOES.length)]];
}

// ---------------------------------------------------------------------------
// cast: what each person does (tiers: 1 all, 2 medium+, 3 high only)
function castList(benches, chairs, furniture) {
  const P = [];
  const prom = (z0, z1) => makePath(sampled(z0, z1, promenadeX, 1), { half: 1.9 });
  let laneObs = furniture;
  const hotelWalk = (z0, z1) => makePath(hotelLane(z0, z1, laneObs), { half: 0.3 });
  const parkWalk = (z0, z1) => makePath(sampled(z0, z1, () => -12.1, 2), { half: 0.8 });
  const beach = (z0, z1, x = 89.6) => makePath(sampled(z0, z1, (z) => x + 1.1 * Math.sin(z / 15) + 0.4 * Math.sin(z / 5.3 + 1), 1), { half: 3 });
  // promenade strollers
  P.push({ tier: 1, kind: 'walk', char: 'megan', clip: 'walk_casual_f', path: prom(-120, 110), s: 70, dir: 1, v: 1.25 });
  P.push({ tier: 1, kind: 'walk', char: 'bryce', clip: 'walk_happy_m', path: prom(-150, 140), s: 150, dir: -1, v: 1.35 });
  P.push({ tier: 2, kind: 'walk', char: 'elizabeth', clip: 'walk_texting_f', path: prom(-90, 130), s: 40, dir: -1, v: 1.05 });
  P.push({ tier: 3, kind: 'walk', char: 'lewis', clip: 'walk_holding_object', path: prom(-60, 150), s: 120, dir: 1, v: 1.2 });
  P.push({ tier: 3, kind: 'walk', char: 'sophie', clip: 'walk_feminine_f', path: prom(-150, 60), s: 30, dir: 1, v: 1.2 });
  // joggers and skaters
  P.push({ tier: 1, kind: 'jog', char: 'lewis', clip: 'jog', path: prom(-200, 200), s: 230, dir: -1, v: 2.9 });
  P.push({ tier: 2, kind: 'jog', char: 'sophie', clip: 'run_f', path: prom(-180, 180), s: 60, dir: 1, v: 2.7 });
  P.push({ tier: 1, kind: 'skate', char: 'megan', clip: 'skate', path: prom(-220, 220), s: 300, dir: 1, v: 4.0 });
  P.push({ tier: 2, kind: 'skate', char: 'bryce', clip: 'skate', path: prom(-220, 220), s: 140, dir: -1, v: 4.4 });
  // benches near the start (sitting clips), cafe tables (a pair talking, one drinking)
  const bs = benches.filter((b) => b.z > -60 && b.z < 70).sort((a, b) => Math.abs(a.z - 20) - Math.abs(b.z - 20));
  const sits = [['sophie', 'sit_idle_f', 1], ['bryce', 'sit_drinking', 1], ['lewis', 'sit_looking_around', 2], ['elizabeth', 'sit_fidget_feet', 3]];
  sits.forEach(([char, clip, tier], i) => { if (bs[i]) P.push({ tier, kind: 'sit', char, clip, seat: { x: bs[i].x + 0.03, y: bs[i].seatY, z: bs[i].z + (i % 2 ? 0.35 : -0.3), yaw: Math.PI / 2 + bs[i].rot, bench: true } }); });
  // cafe: chairs on the terraces within the first blocks, two at one table facing each other
  const cs = chairs.filter((c) => Math.abs(c.z) < 60 && c.x > HOTEL.frontX - 0.5).sort((a, b) => Math.abs(a.z - 14) - Math.abs(b.z - 14));
  const pair = [];
  for (const c of cs) {
    const o = cs.find((d) => d !== c && Math.hypot(d.x - c.x, d.z - c.z) < 1.5 && Math.hypot(d.x - c.x, d.z - c.z) > 0.9);
    if (o) { pair.push(c, o); break; }
  }
  if (pair.length) {
    P.push({ tier: 1, kind: 'sit', char: 'megan', clip: 'sit_talking_2', seat: { x: pair[0].x, y: pair[0].y + 0.45, z: pair[0].z, yaw: pair[0].rot, cafe: true } });
    P.push({ tier: 2, kind: 'sit', char: 'bryce', clip: 'sit_talking', seat: { x: pair[1].x, y: pair[1].y + 0.45, z: pair[1].z, yaw: pair[1].rot, cafe: true } });
  }
  const lone = cs.find((c) => !pair.includes(c) && Math.abs(c.z - (pair[0]?.z ?? 0)) > 8);
  if (lone) P.push({ tier: 3, kind: 'sit', char: 'lewis', clip: 'sit_drinking', seat: { x: lone.x, y: lone.y + 0.45, z: lone.z, yaw: lone.rot, cafe: true } });
  // (the sidewalk lanes keep clear of the people sat at the cafe tables: hips and knees)
  laneObs = [...furniture, ...P.filter((c) => c.seat?.cafe).map(({ seat: t }) => ({ x: t.x + Math.sin(t.yaw) * 0.15, z: t.z + Math.cos(t.yaw) * 0.15, r: 0.34 }))];
  // sidewalks
  P.push({ tier: 1, kind: 'walk', char: 'bryce', clip: 'walk_casual_m', path: hotelWalk(-150, 150), s: 180, dir: -1, v: 1.3 });
  P.push({ tier: 2, kind: 'walk', char: 'elizabeth', clip: 'walk_briefcase_f', path: hotelWalk(-120, 70), s: 120, dir: 1, v: 1.4 });
  P.push({ tier: 3, kind: 'walk', char: 'lewis', clip: 'walk_shopping_bag_m', path: parkWalk(-150, 150), s: 100, dir: 1, v: 1.3 });
  // crosser: hotel sidewalk south to the mid-block crosswalk, over, north up the park side,
  // back over at the 10 ST south leg
  {
    const zc = CROSSWALK_Z, leg = crossLegs(CROSS_STREETS.find((c) => c.name === '10 ST').z)[1], z10 = (leg[0] + leg[1]) / 2;
    const xh = -26.4, xp = -12.3;
    const pts = [...hotelLane(z10, zc, laneObs), ...sampled(z10, zc, () => xp, 2).reverse()];
    P.push({ tier: 1, kind: 'walk', char: 'sophie', clip: 'walk_casual_f', path: makePath(pts, { closed: true, half: 0.7, cross: true }), s: 20, dir: 1, v: 1.3, crosser: true });
  }
  // beach
  P.push({ tier: 1, kind: 'walk', char: 'lewis', clip: 'walk_casual_m', path: beach(-60, 60), s: 50, dir: 1, v: 1.0 });
  P.push({ tier: 2, kind: 'walk', char: 'megan', clip: 'walk_casual_f', path: beach(-170, -110, 88.4), s: 10, dir: 1, v: 1.05 });
  // standing about: a phone call by the promenade, someone looking round on the sidewalk
  P.push({ tier: 2, kind: 'stand', char: 'elizabeth', clip: 'idle_phone_talk_f', at: { x: promenadeX(-28) - 2.6, z: -28, yaw: 1.2 } });
  P.push({ tier: 3, kind: 'stand', char: 'bryce', clip: 'idle_looking_around', at: { x: -12.6, z: 58, yaw: -2.2 } });
  return P;
}

// ---------------------------------------------------------------------------
export function buildCrowd(scene, assets, { beach, hotels, walker = null, getCars = () => [], shot = false, mode = null } = {}) {
  // (the promenade's paving is laid 2 cm proud of the lawn)
  const heightAt = (x, z) => (beach ? beach.groundAt(x, z) : CURB_HEIGHT) + (x > PARK.x0 && x < PARK.x1 && Math.abs(x - promenadeX(z)) < 2.2 ? 0.02 : 0);
  const closeup = shot && mode === 'closeup';
  const tierN = { high: 3, medium: 2, low: 1 }[TIER] ?? 2;
  const chairs = hotels?.userData?.chairs ?? [];
  // street-level cafe furniture on the hotel sidewalk (terrace tables sit higher)
  const furniture = [
    ...(hotels?.userData?.tables ?? []).filter((t) => t.y < 0.3).map((t) => ({ x: t.x, z: t.z, r: 0.42 })),
    ...chairs.filter((c) => c.y < 0.3).map((c) => ({ x: c.x, z: c.z, r: 0.27 })),
  ];
  const grid = staticGrid(furniture);
  // (the lane planner sees exactly what the steering will: the same circles)
  const lanes = grid.all.filter((o) => o.x < -23.5 && o.x > -29.5);
  const cast = castList(BENCHES, chairs, lanes).filter((c) => c.tier <= tierN);
  const rnd = rng(4242);
  const colliders = [];
  const agents = [];
  let vehicles = null;
  const chars = assets.chars;
  const pickChar = (want) => chars[want] ? want : Object.keys(chars)[Math.floor(rnd() * Object.keys(chars).length)];
  const skateClips = new Map();

  for (const c of cast) {
    const name = pickChar(c.char);
    const asset = chars[name];
    const P = createPerson(asset, { tints: outfit(rnd) });
    scene.add(P.root);
    if (P.shadow) scene.add(P.shadow);
    const A = { ...c, P, name: c.kind + '-' + agents.length, index: agents.length, x: 0, z: 0, heading: 0, speed: 0, lat: 0, latT: 0, blockedT: 0, acc: 0, visible: true, skip: agents.length % 4, state: 'go', waitT: 0 };
    // clip set: locomotion / idle, per character's sex where the clip has one
    const fem = asset.fem;
    const fix = (clip) => {
      if (!asset.clips.has(clip)) return clip;
      if (fem && /_m$/.test(clip) && asset.clips.has(clip.replace(/_m$/, '_f'))) return clip.replace(/_m$/, '_f');
      if (!fem && /_f$/.test(clip) && asset.clips.has(clip.replace(/_f$/, '_m'))) return clip.replace(/_f$/, '_m');
      return clip;
    };
    if (c.kind === 'skate') {
      A.skates = attachSkates(P, assets.skate);
      if (!skateClips.has(name)) skateClips.set(name, bakeSkateClip(P, { period: 1.75 }));
      asset.clips.set('skate', skateClips.get(name));
      A.loco = P.action('skate');
      A.idle = P.action('idle_standing');
      A.lift = SKATE_LIFT;
    } else if (c.kind === 'walk' || c.kind === 'jog') {
      A.loco = P.action(fix(c.clip));
      A.walk = c.kind === 'jog' ? P.action(fem ? 'walk_casual_f' : 'walk_casual_m') : null;
      A.idle = P.action(fem ? (rnd() < 0.5 ? 'idle_weight_shift_f' : 'idle_happy') : (rnd() < 0.5 ? 'idle_breathing' : 'idle_standing'));
      A.clipSpeed = P.speedOf(A.loco.getClip().name);
      if (A.walk) A.walkSpeed = P.speedOf(A.walk.getClip().name);
    } else {
      A.loco = null;
      A.idle = P.action(fix(c.clip));
      if (A.idle.getClip().duration > 12) A.idle.setLoop(THREE.LoopPingPong);
    }
    A.lift ??= 0;
    for (const a of [A.loco, A.walk, A.idle]) if (a) { a.play(); a.time = rnd() * a.getClip().duration; a.setEffectiveWeight(0); }
    A.idle?.setEffectiveWeight(1);
    A.col = { x: 0, z: 0, r: 0, person: true };
    colliders.push(A.col);
    if (c.path) {
      A.s = clamp(c.s, 0, c.path.total);
      A.speed = c.v;
      A.v0 = c.v * (0.94 + 0.12 * rnd());
      A.keep = c.kind === 'skate' ? 0.9 : c.kind === 'jog' ? 0.8 : 0.35 + 0.4 * rnd();
      A.lat = A.latT = Math.min(A.keep, c.path.half - 0.3);
    }
    if (c.seat) placeSeated(A);
    if (c.at) { A.x = c.at.x; A.z = c.at.z; A.heading = c.at.yaw; }
    agents.push(A);
  }

  // seated: hips over the seat (the sitting clips sit on a ~0.45 m chair), facing its way
  function placeSeated(A) {
    const { P } = A, st = A.seat;
    const r = P.root;
    r.position.set(0, 0, 0); r.rotation.set(0, 0, 0);
    P.mixer.update(0);
    r.updateMatrixWorld(true);
    const h = P.bones.Hips.getWorldPosition(new THREE.Vector3());
    const s = P.asset.hipsY / 0.98;
    // the thighs rest on the seat ~11 cm under the hip joints
    const seatAbove = h.y - 0.11 * s;
    const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
    // hips a few cm behind the seat centre (towards the backrest)
    const back = st.bench ? -0.06 : -0.04;
    const hx = h.x * cy + h.z * sy, hz = -h.x * sy + h.z * cy;
    A.x = st.x - hx + sy * back; A.z = st.z - hz + cy * back;
    A.baseY = st.y - seatAbove;
    A.heading = st.yaw;
  }

  // shot placements
  const byKind = (k, i = 0) => agents.filter((a) => a.kind === k)[i];
  const setOnPath = (A, z, dir) => {
    // the path point nearest z
    let best = 0, bd = Infinity; const q = {};
    for (let s = 0; s <= A.path.total; s += 0.5) { A.path.at(s, q); const d = Math.abs(q.z - z); if (d < bd) { bd = d; best = s; } }
    A.s = best; A.dir = dir;
  };
  if (shot) {
    if (closeup) {
      // tools/people-shots.mjs frames these: walker, jogger, skater (promenade z -30..-20),
      // bench sitter (nearest bench to z 20)
      const W = byKind('walk', 0), J = byKind('jog', 0), S = byKind('skate', 0);
      if (W) { setOnPath(W, -20, -1); W.speed = W.v0; }
      if (J) { setOnPath(J, -26, 1); J.speed = J.v0; }
      if (S) { setOnPath(S, -32, -1); S.speed = S.v0; }
      for (const a of agents) if (a.path && a !== W && a !== J && a !== S) a.hidden = true;
    } else {
      // as clear of the five harness views as the old cast: a jogger south of view 1, a beach
      // stroller north of view 5, a far stroller up the beach; everyone else off stage
      const J = byKind('jog', 0), B = agents.find((a) => a.kind === 'walk' && a.path?.half === 3), F = agents.filter((a) => a.kind === 'walk' && a.path?.half === 3)[1];
      for (const a of agents) a.hidden = true;
      if (J) { J.hidden = false; J.fixed = { x: promenadeX(85) + 0.65, z: 85, heading: Math.PI }; J.speed = J.v0; }
      if (B) { B.hidden = false; B.fixed = { x: 88, z: -66, heading: 0 }; B.speed = B.v0; }
      if (F) { F.hidden = false; F.fixed = { x: 88.2, z: -140, heading: 0 }; F.speed = F.v0; }
    }
  }

  // --- per-frame -----------------------------------------------------------------------
  const frustum = new THREE.Frustum(), projM = new THREE.Matrix4(), sph = new THREE.Sphere();
  const near = [], q = {}, q2 = {};
  let frame = 0;
  function obstaclesFor(A, out) {
    out.length = 0;
    if (walker && !vehicles?.riding) out.push({ x: walker.pos.x, z: walker.pos.y, r: 0.32, player: true });
    if (vehicles) for (const e of vehicles.list) for (const c of e.v.circlesWorld) if (Math.abs(c.x - A.x) < 10 && Math.abs(c.z - A.z) < 10) out.push({ x: c.x, z: c.z, r: c.r, player: !!e.v.ridden, vehicle: true });
    for (const B of agents) {
      if (B === A || B.hidden || Math.abs(B.x - A.x) >= 9 || Math.abs(B.z - A.z) >= 9) continue;
      // someone sitting is passed like the chair they sit on (the lanes are planned round them)
      if (B.seat) out.push({ x: B.x, z: B.z, r: 0.3 });
      else out.push({ x: B.x, z: B.z, r: B.kind === 'skate' ? 0.35 : R_PERSON, agent: B });
    }
    grid.near(A.x, A.z, out);
    return out;
  }

  // crossers: wait at the curb unless every car that would reach the crosswalk soon can stop
  function roadClear(z) {
    // (the player's car too: on the crosswalk, or coming and too close to stop)
    const pv = vehicles?.current;
    if (pv && pv.x > SIDEWALK_W.x1 - 1 && pv.x < SIDEWALK_E.x0 + 1) {
      const sp = Math.abs(pv.lon), d = (z - pv.z) * Math.sign(pv.vz || 1);
      if (Math.abs(pv.z - z) < 5 || (sp > 0.5 && d > 0 && d < 45 && d < (sp * sp) / 5 + 5)) return false;
    }
    for (const c of getCars() || []) {
      if (c.hidden) continue;
      // on the crosswalk now
      if (Math.abs(c.z - z) < c.len / 2 + 2.5) return false;
      const d = (z - c.z) * c.dir - c.len / 2 - 2.5;   // its front to the crosswalk's near edge
      if (d < 0 || d > 45) continue;
      if (c.v > 0.5 && d < (c.v * c.v) / (2 * 2.5) + 2.5) return false;   // too close to stop for us
    }
    return true;
  }

  // the ridden vehicle (or any moving one) within 25 m, faster than 1.5 m/s, whose line
  // passes within ~1.6 m of the body in the next 2.2 s: the lateral offset to step to (away
  // from the line on the side the walker is already on; round the far side if the corridor
  // has no room there)
  const MISS = 1.6, _tq = {};
  function threatFrom(A) {
    if (!vehicles) return null;
    let best = null;
    for (const e of vehicles.list) {
      const v = e.v, sp = Math.hypot(v.vx, v.vz);
      if (sp < 1.5 || Math.abs(v.x - A.x) > 25 || Math.abs(v.z - A.z) > 25) continue;
      const rx = A.x - v.x, rz = A.z - v.z;
      const t = (rx * v.vx + rz * v.vz) / (sp * sp);
      if (t < 0 || t > 2.2 || (best && t > best.t)) continue;
      const mx = rx - v.vx * t, mz = rz - v.vz * t, half = (v.spec.width ?? 1.8) / 2;
      if (Math.hypot(mx, mz) > half + MISS) continue;
      A.path.at(A.s, _tq);
      const rxh = -_tq.dz * A.dir, rzh = _tq.dx * A.dir;
      const along = mx * rxh + mz * rzh, side = Math.sign(along) || 1, clear = half + MISS + 0.3;
      let target = A.lat + side * (clear - Math.abs(along));
      // (not into the hotel fronts)
      if (Math.abs(target) > A.path.half + 2.5 || _tq.x + rxh * target < HOTEL.frontX + 0.5) target = A.lat - side * (clear + Math.abs(along));
      best = { t, target };
    }
    return best;
  }

  function steer(A, dt) {
    const path = A.path;
    A.blockBy = null;
    if (A.ghost > 0) A.ghost -= dt;
    if (A.passT > 0) A.passT -= dt;
    path.at(A.s, q);
    const dx = q.dx * A.dir, dz = q.dz * A.dir, rx = -dz, rz = dx;   // travel dir, right hand
    const look = Math.max(2.8, A.speed * (A.kind === 'skate' ? 2.4 : 2.0));
    let vT = A.v0, latT = Math.min(A.keep, path.half - 0.3), best = Infinity, blocked = false;
    // ends of open paths: slow, turn round
    if (!path.closed) {
      const left = A.dir > 0 ? path.total - A.s : A.s;
      vT = Math.min(vT, 0.35 + left * 0.6);
      if (left < 0.4) { A.dir *= -1; A.lat = -A.lat; A.latT = -A.latT; return; }
    }
    // crossings: wait at the curb (in the traffic sim's pedestrian zone, so the cars see
    // us) until the road is clear; once on it, keep going
    if (path.crossings.length) {
      latT = 0;
      if (path.crossings.some((c) => A.s >= c.s0 - 0.05 && A.s <= c.s1)) A.state = 'crossing';
      else {
        const next = path.crossings.find((c) => { const u = c.s0 - A.s; return u > 0 && u < 0.7; });
        if (!next) A.state = 'go';
        else if (A.state !== 'crossing') {
          if (roadClear(next.z)) A.state = 'crossing';
          else { vT = 0; A.state = 'waiting'; }
        }
      }
    }
    // threat pass: a vehicle coming at speed on a line that passes close: step well off it
    // (past the lane corridor), then rejoin once it has gone by
    const threat = threatFrom(A);
    if (threat) {
      A.dodgeT = 1.1;
      A.dodgeLat = clamp(threat.target, -(path.half + 2.5), path.half + 2.5);
    }
    if (A.dodgeT > 0) {
      A.dodgeT -= dt;
      A.state = 'dodge';
      latT = A.dodgeLat;
      vT = Math.min(vT, 0.25);
    } else if (A.state === 'dodge') A.state = 'go';
    obstaclesFor(A, near);
    for (const o of near) {
      if (A.dodgeT > 0 && o.vehicle) continue;
      const ox = o.x - A.x, oz = o.z - A.z;
      const along = ox * dx + oz * dz, side = ox * rx + oz * rz;
      if (along < -0.2 || along > look) continue;
      // (a stand-off with someone on a tight lane: shoulders turned, they brush past)
      const need = o.r + R_PERSON + (o.player ? 0.45 : o.agent ? (A.passT > 0 ? -0.1 : 0.22) : 0.12);
      // (the other agent's own sidestep: count the one ahead / oncoming)
      if (Math.abs(side) >= need) continue;
      if (along >= best) continue;
      // sidestep: the side that needs the smaller move and stays in the corridor
      const oncoming = !!o.agent && Math.sin(o.agent.heading) * dx + Math.cos(o.agent.heading) * dz < 0;
      // (oncoming, each takes a little over half the gap - both to their right)
      const own = oncoming ? need * 0.56 : need;
      const toLeft = A.lat + side - own, toRight = A.lat + side + own;
      // (for each other, people step a little off a tight lane, shoulders past the furniture)
      const lim = o.agent ? Math.max(path.half - 0.2, 0.45) : path.half - 0.2;
      const okL = toLeft > -lim, okR = toRight < lim;
      let t = null;
      if (okR && (!okL || Math.abs(toRight - A.lat) <= Math.abs(toLeft - A.lat) + (oncoming ? 0.6 : 0))) t = toRight;
      else if (okL) t = toLeft;
      // no room to step round a post / table edge the lane already skirts: squeeze past it
      const noStep = t === null || path.crossings.length && A.state === 'crossing';
      if (noStep && !o.agent && !o.player && !o.vehicle) {
        if (A.ghost > 0 || Math.abs(side) >= o.r + 0.15) continue;
        // (judged where the lane itself passes it: a curving lane swings clear of what's dead ahead now)
        path.at(A.s + A.dir * along, q2);
        const px = q2.x - q2.dz * A.dir * A.lat, pz = q2.z + q2.dx * A.dir * A.lat;
        if (Math.hypot(o.x - px, o.z - pz) >= o.r + 0.15) continue;
      }
      best = along;
      if (noStep) {
        // no room: slow down and wait short of it
        vT = Math.min(vT, Math.max(0, (along - need * 0.6) * 0.9));
        blocked = true;
        A.blockBy = o;
      } else {
        latT = t;
        // ease off while stepping round (more for the player)
        const k = o.player ? 0.55 : 0.8;
        vT = Math.min(vT, A.v0 * (k + (1 - k) * smooth(0.5, look, along)));
        if (Math.abs(t - A.lat) > 0.5 && along < 1.2) vT = Math.min(vT, 0.5);
      }
    }
    // (a dodge wins over sidestepping round furniture and people)
    if (A.dodgeT > 0) latT = A.dodgeLat;
    // hard stop short of the player / others in front (never walk into them)
    for (const o of near) {
      if (!o.player && !o.agent) continue;
      const ox = o.x - A.x, oz = o.z - A.z, d = Math.hypot(ox, oz);
      if (d < o.r + R_PERSON + (o.agent && A.passT > 0 ? -0.15 : 0.15) && (ox * dx + oz * dz) > 0) { vT = 0; blocked = true; A.blockBy = o; }
    }
    if (A.state === 'waiting') blocked = false;
    A.blockedT = blocked && vT < 0.15 ? A.blockedT + dt : Math.max(0, A.blockedT - dt * 2);
    // held up by furniture alone (a lane pinched tighter than planned): edge past it
    const bb = A.blockBy;
    if (A.blockedT > 1.5 && bb && !bb.agent && !bb.player && !bb.vehicle) { A.ghost = 1.5; A.blockedT = 0; }
    if (A.blockedT > 1.5 && bb?.agent) { A.passT = 2; A.blockedT = 0; }
    if (A.blockedT > 5 + A.skip * 0.8 && !path.crossings.length) {
      // blocked for long: turn back
      A.dir *= -1; A.lat = -A.lat; A.blockedT = 0; latT = -latT;
    }
    const acc = vT < A.speed ? 3.2 : 1.1;
    A.speed += (vT - A.speed) * (1 - Math.exp(-dt * acc));
    if (A.speed < 0.02 && vT === 0) A.speed = 0;
    const rate = (A.dodgeT > 0 ? 2.4 : A.kind === 'skate' ? 1.2 : 0.8) * dt;
    let dLat = clamp(latT - A.lat, -rate, rate);
    // never step sideways into a vehicle (back to the lane beside a car that has stopped)
    if (dLat) {
      path.at(A.s, q);
      const tx = q.dx * A.dir, tz = q.dz * A.dir, nl = A.lat + dLat;
      const px = q.x - tz * nl, pz = q.z + tx * nl;
      for (const o of near) {
        if (!o.vehicle) continue;
        const dn = Math.hypot(px - o.x, pz - o.z);
        if (dn < o.r + R_PERSON + 0.08 && dn < Math.hypot(A.x - o.x, A.z - o.z)) { dLat = 0; break; }
      }
    }
    A.lat += dLat;
    A.latT = latT;
    A.s += A.dir * A.speed * dt;
    if (path.closed) A.s = ((A.s % path.total) + path.total) % path.total;
    path.at(A.s, q);
    const nx = q.dx * A.dir, nz = q.dz * A.dir;
    A.x = q.x - nz * A.lat; A.z = q.z + nx * A.lat;
    // face where it's going (the lateral drift turns the body a little)
    const vx = nx * Math.max(A.speed, 0.05) + -nz * dLat / Math.max(dt, 1e-3), vz = nz * Math.max(A.speed, 0.05) + nx * dLat / Math.max(dt, 1e-3);
    const want = Math.atan2(vx, vz);
    A.heading += wrap(want - A.heading) * (1 - Math.exp(-dt * (A.kind === 'skate' ? 3 : 5)));
  }

  function animate(A, dt) {
    const v = A.speed;
    if (A.kind === 'skate') {
      const w = smooth(0.4, 1.6, v);
      A.loco.setEffectiveWeight(w);
      A.idle.setEffectiveWeight(1 - w);
      A.loco.timeScale = clamp(v / 4.0, 0.55, 1.25);
    } else if (A.kind === 'walk' || A.kind === 'jog') {
      if (A.kind === 'jog') {
        // jog above ~1.9 m/s, walk below, idle standing
        const wj = smooth(1.6, 2.3, v), wi = 1 - smooth(0.08, 0.5, v);
        A.loco.setEffectiveWeight((1 - wi) * wj);
        A.walk.setEffectiveWeight((1 - wi) * (1 - wj));
        A.idle.setEffectiveWeight(wi);
        A.loco.timeScale = clamp(v / A.clipSpeed, 0.7, 1.35);
        A.walk.timeScale = clamp(v / A.walkSpeed, 0.6, 1.5);
      } else {
        const wi = 1 - smooth(0.08, 0.55, v);
        A.loco.setEffectiveWeight(1 - wi);
        A.idle.setEffectiveWeight(wi);
        A.loco.timeScale = clamp(v / A.clipSpeed, 0.55, 1.4);
      }
    }
    A.acc += dt;
    A.P.mixer.update(A.acc);
    A.acc = 0;
  }

  // contact shadows: a soft dark patch under each person's feet (one instanced draw)
  const contact = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    color: 0x0c0806, map: contactTexture(), transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }), agents.length);
  contact.frustumCulled = false;
  contact.renderOrder = 1;
  contact.castShadow = false;
  contact.receiveShadow = false;
  scene.add(contact);
  const _cm = new THREE.Matrix4(), _cq = new THREE.Quaternion(), _cs = new THREE.Vector3(), _cp = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
  function placeContact(i, A, groundY) {
    if (A.hidden || !A.visible) _cs.set(0, 0, 0);
    else if (A.seat) _cs.set(0.8, 1, 0.95);
    else _cs.set(A.kind === 'skate' ? 0.5 : 0.62, 1, A.kind === 'skate' ? 0.8 : 0.7);
    // (sat: under the seat and the feet in front of it)
    const fwd = A.seat ? 0.28 : 0;
    _cp.set(A.x + Math.sin(A.heading) * fwd, groundY + 0.012, A.z + Math.cos(A.heading) * fwd);
    contact.setMatrixAt(i, _cm.compose(_cp, _cq.setFromAxisAngle(_Y, A.heading), _cs));
  }

  function place(A) {
    const r = A.P.root;
    const g = A.seat ? A.baseY : heightAt(A.x, A.z);
    r.position.set(A.x, (A.seat ? g : g + A.lift), A.z);
    r.rotation.set(0, A.heading, 0);
    const gy = A.seat?.cafe ? TERRACE_Y : A.seat ? heightAt(A.x, A.z) : g;
    if (A.P.per) {
      A.P.per.uBaseY.value = A.seat?.cafe ? TERRACE_Y : A.seat ? CURB_HEIGHT : g;
      A.P.per.uWallX.value = HOTEL.frontX;
    }
    placeContact(A.index, A, gy);
    contact.instanceMatrix.needsUpdate = true;
    A.col.x = A.x; A.col.z = A.z;
    const rr = A.seat ? 0.36 : A.kind === 'skate' ? 0.34 : R_PERSON;
    // never grow over the player (the walker would be stuck inside the circle)
    A.col.r = A.hidden ? 0 : walker ? Math.min(rr, Math.max(0, Math.hypot(walker.pos.x - A.x, walker.pos.y - A.z) - 0.305)) : rr;
  }

  // first placement (and the frozen ?shot pose)
  for (const A of agents) {
    if (A.path) {
      A.path.at(A.s, q);
      const nx = q.dx * A.dir, nz = q.dz * A.dir;
      A.x = q.x - nz * A.lat; A.z = q.z + nx * A.lat; A.heading = Math.atan2(nx, nz);
    }
    if (A.fixed) { A.x = A.fixed.x; A.z = A.fixed.z; A.heading = A.fixed.heading; }
    animate(A, 0);
    place(A);
    A.P.setVisible(!A.hidden);
  }

  const debug = { freeze: false };
  function update(dt, camera) {
    if (camera) {
      projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projM);
    }
    if (shot || debug.freeze) return;
    dt = Math.min(dt, 0.1);
    frame++;
    for (const A of agents) {
      if (A.hidden) continue;
      if (A.path) steer(A, dt);
      const d = camera ? Math.hypot(camera.position.x - A.x, camera.position.z - A.z) : 0;
      // drawn: in range and in view (the long shadow reaches ~8 m away from the sun)
      let vis = d < CULL;
      if (vis && camera) {
        const g = A.seat ? A.baseY : heightAt(A.x, A.z);
        sph.center.set(A.x, g + 0.9, A.z); sph.radius = 1.3;
        const body = frustum.intersectsSphere(sph);
        sph.center.set(A.x - SUN_DIR.x * 4, g, A.z - SUN_DIR.z * 4); sph.radius = 5;
        vis = body || frustum.intersectsSphere(sph);
      }
      if (vis !== A.visible) { A.visible = vis; A.P.setVisible(vis); }
      A.acc += dt;
      if (vis) {
        A.P.setLevel(d < LOD_AT ? 0 : 1);
        if (A.P.shadow) A.P.shadow.visible = d < SHADOW_AT;
        // animation LOD: every frame near, every 2nd / 4th further out
        const every = d < 30 ? 1 : d < 65 ? 2 : 4;
        if ((frame + A.skip) % every === 0) { const a = A.acc; A.acc = 0; animate(A, a); }
      }
      place(A);
    }
  }

  // ------------------------------------------------------------------------------------
  // Drivers: a Mixamo body seated in each traffic car (the Driving clip, hands IK'd to the
  // rim grips) and the player's own body in the convertible (head and hair hidden from the
  // first-person camera; hands on the wheel as it turns)
  const driverChars = Object.keys(chars);
  let driverN = 0, lastCam = null, playerDriver = null;
  const drivers = [];
  function seatBody(P, anchor, fwd = 0) {
    const r = P.root;
    const a = P.action('drive_car');
    a.play();
    a.time = (driverN * 0.37) % a.getClip().duration;
    P.mixer.update(0);
    anchor.add(r);
    r.position.set(0, 0, 0); r.rotation.set(0, 0, 0);
    anchor.updateMatrixWorld(true);
    const h = anchor.worldToLocal(P.bones.Hips.getWorldPosition(new THREE.Vector3()));
    r.position.sub(h);
    r.position.z += fwd;
    return a;
  }
  const _t = new THREE.Vector3(), _p = new THREE.Vector3(), _aq = new THREE.Quaternion(), _s = new THREE.Vector3();
  const _u = new THREE.Vector3(), _ax = new THREE.Vector3(), _tg = new THREE.Vector3(), _F = new THREE.Vector3(), _N = new THREE.Vector3();
  const _wq = new THREE.Quaternion(), _wm = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1), _wr = new THREE.Vector3();
  // Hands on the rim. The rim is the grips' parent (the steering-wheel pivot: local +y down the
  // column, rim angle c clockwise from twelve as the driver sees it, point (-r sin c, y, -r cos c)).
  // Each hand holds a rim point; the wheel's turn `rig.wheelAngle` carries it round, and once it
  // has been carried too far from the hand's home (nine / three) the hand lets go and takes a
  // new hold ahead of the turn (hand over hand, one at a time), drifting home when the wheel
  // rests. Without a wheel angle (the traffic) the hands stay on the grips.
  const HOLD_LIM = 1.25, REGRIP_T = 0.24;
  function rimFrame(rig) {
    const wh = rig.gripL?.parent;
    if (!wh) return null;
    // the rim's rest frame (the pivot unturned): wheel angle is applied by rim angle instead
    if (wh.userData.q0) _wm.compose(wh.position, wh.userData.q0, _one).premultiply(wh.parent.matrixWorld);
    else _wm.copy(wh.matrixWorld);
    _wq.setFromRotationMatrix(_wm);
    return wh;
  }
  function rimPoint(r, y, c, out) { return out.set(-r * Math.sin(c), y, -r * Math.cos(c)).applyMatrix4(_wm); }
  function handsOnRim(P, rig, G, st, dt, full = true) {
    const wh = rimFrame(rig);
    if (!wh) return;
    const B = P.bones, w = rig.wheelAngle ?? 0;
    const aq = rig.pelvis.getWorldQuaternion(_aq);
    const dw = st.w === undefined ? 0 : w - st.w;
    st.w = w;
    st.still = Math.abs(dw) < 1e-3 ? (st.still ?? 0) + dt : 0;
    for (const [side, grip, sx] of [['Left', rig.gripL, 1], ['Right', rig.gripR, -1]]) {
      if (!grip) continue;
      const r = Math.hypot(grip.position.x, grip.position.z), y = grip.position.y;
      const cGrip = Math.atan2(-grip.position.x, -grip.position.z);
      const home = rig.wheelAngle === undefined ? cGrip : Math.sign(cGrip) * 1.48;
      const h = (st[side] ??= { h: home - w, mv: null });
      const other = st[side === 'Left' ? 'Right' : 'Left'];
      // spun faster than hands can follow (a quick flick, the wheel unwinding): the rim slides
      // through the loosened hands, which stay put
      const fast = dt > 0 && Math.abs(dw) / dt > 5;
      if (fast) {
        const c = h.mv ? THREE.MathUtils.lerp(h.mv.c0, h.mv.h1 + w - dw, THREE.MathUtils.smoothstep(h.mv.t, 0, 1)) : h.h + w - dw;
        h.mv = null;
        h.h = c - w;
        h.slide = 0.25;
      } else if (h.mv) {
        h.mv.t += dt / REGRIP_T;
        if (h.mv.t >= 1) { h.h = h.mv.h1; h.mv = null; }
      } else {
        const c0 = h.h + w;
        h.h = Math.atan2(Math.sin(c0), Math.cos(c0)) - w;
        const d = h.h + w - home;
        const busy = !!other?.mv;
        // (a hand is carried further up over the top than down towards six)
        const lim = Math.sign(d) === Math.sign(home) ? HOLD_LIM * 0.65 : HOLD_LIM * 1.1;
        if (st.still > 0.35) {
          // the wheel at rest: back to nine / three, one hand at a time
          if (Math.abs(d) > 0.2 && !busy) h.mv = { t: 0, c0: h.h + w, h1: home - w };
        } else if (Math.abs(d) > lim && (!busy || Math.abs(d) > lim + 0.6)) {
          // a new hold ahead of the turn (the wheel carries it back through home)
          const ahead = dw && Math.sign(dw) === Math.sign(d) ? -Math.sign(d) * 0.6 : 0;
          h.mv = { t: 0, c0: h.h + w, h1: home + ahead - w };
        }
      }
      let c = h.h + w, lift = 0, k = 1;
      if (h.slide > 0) { h.slide -= dt; k = 0.7; }
      if (h.mv) {
        const e = THREE.MathUtils.smoothstep(h.mv.t, 0, 1);
        c = THREE.MathUtils.lerp(h.mv.c0, h.mv.h1 + w, e);
        lift = Math.sin(Math.PI * Math.min(1, h.mv.t));
        k = 1 - 0.8 * lift;
      }
      // rim point, outward radial, column axis (away from the driver), world
      rimPoint(r, y, c, _tg);
      _u.set(-Math.sin(c), 0, -Math.cos(c)).applyQuaternion(_wq);
      _ax.set(0, 1, 0).applyQuaternion(_wq);
      _tg.addScaledVector(_ax, -0.06 * lift).addScaledVector(_u, 0.03 * lift);
      // knuckles along the rim: the hand points forward and a little outward over it, the palm
      // faces in against it (thumb up at nine and three)
      const g = G?.[side];
      _F.copy(_ax).multiplyScalar(0.8).addScaledVector(_u, 0.35).normalize();
      _N.copy(_u).multiplyScalar(-0.8).addScaledVector(_ax, 0.35).normalize();
      const reach = g ? g.reach : 0.09;
      h.W = (h.W ?? new THREE.Vector3()).copy(_tg).addScaledVector(_N, -0.036).addScaledVector(_F, -reach * 0.8);
      h.F = (h.F ?? new THREE.Vector3()).copy(_F);
      h.N = (h.N ?? new THREE.Vector3()).copy(_N);
      h.k = k;
    }
    // reach: lean the chest over the wheel and bring the shoulders forward as far as the
    // arms fall short of the holds
    let need = 0;
    for (const side of ['Left', 'Right']) {
      const h = st[side];
      if (!h?.W) continue;
      const S = B[side + 'Arm'].getWorldPosition(_s);
      const L = B[side + 'ForeArm'].position.length() * B[side + 'Arm'].getWorldScale(_p).x + B[side + 'Hand'].position.length() * B[side + 'ForeArm'].getWorldScale(_p).x;
      need = Math.max(need, S.distanceTo(h.W) - 0.96 * L);
    }
    const lean = THREE.MathUtils.clamp(need / 0.5, 0, 0.14);
    if (lean > 0) {
      _ax.set(1, 0, 0).applyQuaternion(aq);
      for (const [n, f] of [['Spine1', 0.45], ['Spine2', 0.55]]) {
        const b = B[n];
        if (!b) continue;
        setWorldQuat(b, _wq.setFromAxisAngle(_ax, lean * f).multiply(b.getWorldQuaternion(_aq)));
      }
      rig.pelvis.getWorldQuaternion(_aq);
    }
    for (const [side, sx] of [['Left', 1], ['Right', -1]]) {
      const h = st[side];
      if (!h?.W) continue;
      // the collarbone swings the shoulder towards the hold (a little)
      const C = B[side + 'Shoulder'];
      if (C && need > 0) {
        const S = B[side + 'Arm'].getWorldPosition(_s), c0 = C.getWorldPosition(_t);
        const from = _u.subVectors(S, c0), to = _F.subVectors(h.W, c0).setLength(from.length());
        const q = _wq.setFromUnitVectors(from.normalize(), to.normalize());
        _wq.slerp(_aq.identity(), 1 - THREE.MathUtils.clamp(need / 0.3, 0, 0.35));
        setWorldQuat(C, q.multiply(C.getWorldQuaternion(_aq)));
        rig.pelvis.getWorldQuaternion(_aq);
      }
      const pole = _p.set(sx * 0.7, -1, -0.25).applyQuaternion(_aq);
      ik2(B[side + 'Arm'], B[side + 'ForeArm'], B[side + 'Hand'], h.W, pole);
      if (G?.[side] && full) gripHand(B[side + 'Hand'], G[side], h.F, h.N, h.k);
      (st.dbg ??= {})[side] = { F: h.F.toArray(), N: h.N.toArray(), W: h.W.toArray(), need, lean };
    }
  }
  // Feet in the convertible's footwell (car-local m; flat floor y 0.455 to z 0.27, then the toe
  // board; the throttle is floor-hinged at z 0.28, its pad rising ~48 deg to z 0.44 at x 0.28;
  // the hanging brake pad at x 0.45): the right foot heel-on-hinge along the throttle, over
  // on the brake when braking; the left resting on the floor, toes up the toe board
  const FEET = {
    Right: { ankle: [0.285, 0.6, 0.275], toe: [0.285, 0.655, 0.405], knee: [-0.2, 1, 0.3] },
    Left: { ankle: [0.53, 0.54, 0.185], toe: [0.535, 0.5, 0.33], knee: [0.22, 1, 0.3] },
  };
  const BRAKE_DX = 0.165;
  function feetOnPedals(P, frame, st, v, dt) {
    const B = P.bones;
    if (!B.RightUpLeg || !B.RightToeBase) return;
    const brk = v && (v.braking > 0.05 || v.throttle < -0.05) ? 1 : 0;
    const press = v ? Math.max(0, v.throttle ?? 0) : 0;
    st.brk = THREE.MathUtils.damp(st.brk ?? 0, brk, 9, dt);
    st.press = THREE.MathUtils.damp(st.press ?? 0, press, 12, dt);
    const M = frame.matrixWorld;
    for (const side of ['Left', 'Right']) {
      const f = FEET[side], R = side === 'Right';
      // (moving across to the brake the foot lifts off the throttle: a small arc)
      const dx = R ? st.brk * BRAKE_DX : 0, lift = R ? Math.sin(Math.PI * st.brk) * 0.05 : 0;
      const dz = R ? 0.035 * st.press * (1 - st.brk) : 0;
      _tg.fromArray(f.ankle); _tg.x += dx; _tg.y += lift; _tg.z += dz;
      _tg.applyMatrix4(M);
      _N.fromArray(f.knee).transformDirection(M);
      ik2(B[side + 'UpLeg'], B[side + 'Leg'], B[side + 'Foot'], _tg, _N);
      // sole on the pad / floor: aim the ankle -> ball of the foot at the toe target
      const Ft = B[side + 'Foot'];
      const A = Ft.getWorldPosition(_t);
      _u.subVectors(B[side + 'ToeBase'].getWorldPosition(_s), A).normalize();
      _F.fromArray(f.toe); _F.x += dx; _F.y += lift; _F.z += dz * 1.2;
      _F.applyMatrix4(M).sub(A).normalize();
      setWorldQuat(Ft, _wq.setFromUnitVectors(_u, _F).multiply(Ft.getWorldQuaternion(_aq)));
    }
  }
  const makeDriver = ({ rig }) => {
    const name = driverChars[driverN++ % driverChars.length];
    const P = createPerson(chars[name], { tints: outfit(rnd), shadow: false });
    P.setLevel(1);
    const G = measureGrip(P), hold = {};
    const a = seatBody(P, rig.pelvis);
    // (the honk: a hand off the wheel onto the horn, faded in for the traffic's beeps)
    const hk = P.action('drive_honk');
    if (hk) { hk.play(); hk.setEffectiveWeight(0); }
    let acc = 0, t = 0, hw = 0;
    drivers.push(P);
    return {
      body: P.root,
      P,
      update(rg, car) {
        if (hk) {
          const want = car?.honkAnim > 0 ? 1 : 0;
          if (want && hw < 0.02) hk.time = 0;
          hw += (want - hw) * Math.min(1, (acc + 1 / 60) * 7);
          hk.setEffectiveWeight(hw);
          a.setEffectiveWeight(1 - hw);
        }
        const cam = lastCam;
        rg.pelvis.getWorldPosition(_t);
        const d = cam ? cam.position.distanceTo(_t) : 0;
        let show = d < 90;
        if (show && cam) { sph.center.copy(_t); sph.radius = 1.4; show = frustum.intersectsSphere(sph); }
        P.dbg = { d, show, at: [_t.x, _t.z] };
        if (show !== P.visible) P.setVisible(show);
        acc += 1 / 60;
        if (!show) return;
        t++;
        if (d > 35 && t % 3) return;
        P.setLevel(d < 10 ? 0 : 1);
        const step = acc;
        P.mixer.update(acc);
        acc = 0;
        P.root.updateMatrixWorld(true);
        if (d < 45 && hw < 0.1) handsOnRim(P, rg, G, hold, step, d < 16);
      },
    };
  };
  function attachDrivers(traffic, cars) {
    if (!driverChars.length) return;
    traffic?.attachDrivers?.(makeDriver);
    // the player at the convertible's wheel
    if (cars?.drive?.attachDriver && !shot) {
      // (jeans and sneakers in the footwell, a plain tee: bare forearms on the wheel, no tattoos)
      const name = chars.megan ? 'megan' : driverChars[0];
      const P = createPerson(chars[name], { tints: [lin(0xb9d3e3, 0.85), null, null], shadow: false });
      P.setLevel(0);
      P.root.name = 'player-driver';
      const G = measureGrip(P), hold = {}, feet = {};
      // (sat a little forward of the seat anchor, the eye with her, and a touch longer in the
      // arm than the model: the hands reach nine and three on the big rim)
      const FWD = 0.1;
      for (const s of ['Left', 'Right']) { P.bones[s + 'ForeArm'].position.multiplyScalar(1.1); P.bones[s + 'Hand'].position.multiplyScalar(1.1); }
      let seated = false, t0 = null;
      cars.drive.attachDriver(P.root, {
        forward: FWD,
        update(rig, v) {
          if (!seated) { seated = true; seatBody(P, rig.pelvis, FWD); }
          const dt = t0 === null ? 1 / 60 : THREE.MathUtils.clamp(rig.t - t0, 0, 0.1);
          t0 = rig.t;
          P.mixer.update(dt);
          // (the first-person camera sits in the head: no head, no hair; shown in the chase view)
          P.bones.Head.scale.setScalar(rig.chase ? 1 : 0.001);
          P.root.updateMatrixWorld(true);
          handsOnRim(P, rig, G, hold, dt);
          feetOnPedals(P, rig.pelvis.parent, feet, v, dt);
        },
      });
      playerDriver = P;
      P.hold = hold; P.grip = G;
    }
  }

  // the player's body in a driven modern car (vehicles/index.js): one character, moved from
  // car to car; hands on its rim (drive view: vehicles' attachDriver hook)
  let modernDriver = null, modernDetach = null;
  function seatPlayer(view) {
    if (!driverChars.length || !view?.attachDriver) return () => {};
    if (!modernDriver) {
      const name = chars.megan ? 'megan' : driverChars[0];
      const P = createPerson(chars[name], { tints: [lin(0xb9d3e3, 0.85), null, null], shadow: false });
      P.setLevel(0);
      P.root.name = 'player-driver-modern';
      modernDriver = { P, G: measureGrip(P) };
    }
    modernDetach?.();
    const { P, G } = modernDriver, hold = {};
    let seated = false, t0 = null;
    modernDetach = view.attachDriver(P.root, {
      update(rig, v) {
        if (!seated) { seated = true; seatBody(P, rig.pelvis); }
        const dt = t0 === null ? 1 / 60 : THREE.MathUtils.clamp(rig.t - t0, 0, 0.1);
        t0 = rig.t;
        P.mixer.update(dt);
        P.bones.Head.scale.setScalar(rig.chase ? 1 : 0.001);
        P.root.updateMatrixWorld(true);
        handsOnRim(P, rig, G, hold, dt);
      },
    });
    return () => { modernDetach?.(); modernDetach = null; };
  }

  const tris = agents.reduce((n, A) => n + A.P.asset.tris0, 0);
  window.__crowdStats = () => ({
    agents: agents.length, visible: agents.filter((a) => a.visible && !a.hidden).length,
    lod0: agents.filter((a) => a.visible && !a.hidden && a.P.level === 0).length,
    kinds: agents.reduce((o, a) => ((o[a.kind] = (o[a.kind] ?? 0) + 1), o), {}),
  });
  return {
    agents, colliders, tris, debug, drivers,
    people: Object.fromEntries(agents.map((a) => [a.name, a])),
    setVehicles(v) { vehicles = v; },
    get playerDriver() { return playerDriver; },
    attachDrivers,
    seatPlayer,
    // pedestrians for the traffic sim (right of way on the crosswalks)
    peds() { const out = []; for (const A of agents) if (!A.hidden && A.path?.crossings.length) out.push({ x: A.x, z: A.z }); return out; },
    update(dt, camera) { lastCam = camera; update(dt, camera); },
  };
}
