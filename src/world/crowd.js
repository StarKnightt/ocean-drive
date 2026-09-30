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
import { createPerson, attachSkates, bakeSkateClip, SKATE_LIFT, ik2 } from './mixamo.js';

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
  P.push({ tier: 1, kind: 'walk', char: 'lewis', clip: 'walk_stroll_old', path: beach(-60, 60), s: 50, dir: 1, v: 0.85 });
  P.push({ tier: 2, kind: 'walk', char: 'megan', clip: 'walk_casual_f', path: beach(-170, -110, 88.4), s: 10, dir: 1, v: 1.05 });
  // standing about: a phone call by the promenade, someone looking round on the sidewalk
  P.push({ tier: 2, kind: 'stand', char: 'elizabeth', clip: 'idle_phone_talk_f', at: { x: promenadeX(-28) - 2.6, z: -28, yaw: 1.2 } });
  P.push({ tier: 3, kind: 'stand', char: 'bryce', clip: 'idle_looking_around', at: { x: -12.6, z: 58, yaw: -2.2 } });
  return P;
}

// ---------------------------------------------------------------------------
export function buildCrowd(scene, assets, { beach, hotels, walker = null, getCars = () => [], shot = false, mode = null } = {}) {
  const heightAt = (x, z) => (beach ? beach.groundAt(x, z) : CURB_HEIGHT);
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
    const A = { ...c, P, name: c.kind + '-' + agents.length, x: 0, z: 0, heading: 0, speed: 0, lat: 0, latT: 0, blockedT: 0, acc: 0, visible: true, skip: agents.length % 4, state: 'go', waitT: 0 };
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
    A.col = { x: 0, z: 0, r: 0 };
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
    obstaclesFor(A, near);
    for (const o of near) {
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
    const rate = (A.kind === 'skate' ? 1.2 : 0.8) * dt;
    const dLat = clamp(latT - A.lat, -rate, rate);
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

  function place(A) {
    const r = A.P.root;
    const g = A.seat ? A.baseY : heightAt(A.x, A.z);
    r.position.set(A.x, (A.seat ? g : g + A.lift), A.z);
    r.rotation.set(0, A.heading, 0);
    if (A.P.per) {
      A.P.per.uBaseY.value = A.seat?.cafe ? TERRACE_Y : A.seat ? CURB_HEIGHT : g;
      A.P.per.uWallX.value = HOTEL.frontX;
    }
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
  function seatBody(P, anchor) {
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
    return a;
  }
  const _t = new THREE.Vector3(), _p = new THREE.Vector3(), _aq = new THREE.Quaternion(), _s = new THREE.Vector3();
  function handsToWheel(P, rig, w = 1) {
    const aq = rig.pelvis.getWorldQuaternion(_aq);
    for (const [side, grip, sx] of [['Left', rig.gripL, 1], ['Right', rig.gripR, -1]]) {
      if (!grip) continue;
      const B = P.bones;
      grip.getWorldPosition(_t);
      B[side + 'Arm'].getWorldPosition(_s);
      // the wrist sits a hand's breadth short of the grip, towards the shoulder
      const toS = _s.clone().sub(_t).normalize();
      const wrist = _t.clone().addScaledVector(toS, 0.075);
      const pole = _p.set(sx * 0.7, -1, -0.25).applyQuaternion(aq);
      ik2(B[side + 'Arm'], B[side + 'ForeArm'], B[side + 'Hand'], wrist, pole, w);
    }
  }
  const makeDriver = ({ rig }) => {
    const name = driverChars[driverN++ % driverChars.length];
    const P = createPerson(chars[name], { tints: outfit(rnd), shadow: false });
    P.setLevel(1);
    const a = seatBody(P, rig.pelvis);
    let acc = 0, t = 0;
    drivers.push(P);
    return {
      body: P.root,
      update(rg, car) {
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
        P.mixer.update(acc);
        acc = 0;
        P.root.updateMatrixWorld(true);
        if (d < 45) handsToWheel(P, rg);
      },
    };
  };
  function attachDrivers(traffic, cars) {
    if (!driverChars.length) return;
    traffic?.attachDrivers?.(makeDriver);
    // the player at the convertible's wheel
    if (cars?.drive?.attachDriver && !shot) {
      // (long sleeves: the wheel view is all arms - plain, no tattoos - and just the hands show)
      const name = chars.sophie ? 'sophie' : driverChars[0];
      const P = createPerson(chars[name], { tints: [lin(0x9aa3a8, 0.9), lin(0x2d3b5a, 0.85), null], shadow: false });
      P.setLevel(0);
      P.root.name = 'player-driver';
      let seated = false;
      cars.drive.attachDriver(P.root, {
        update(rig) {
          if (!seated) { seated = true; seatBody(P, rig.pelvis); }
          P.mixer.update(1 / 60);
          // (the first-person camera sits in the head: no head, no hair)
          P.bones.Head.scale.setScalar(0.001);
          P.root.updateMatrixWorld(true);
          handsToWheel(P, rig);
        },
      });
      playerDriver = P;
    }
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
    // pedestrians for the traffic sim (right of way on the crosswalks)
    peds() { const out = []; for (const A of agents) if (!A.hidden && A.path?.crossings.length) out.push({ x: A.x, z: A.z }); return out; },
    update(dt, camera) { lastCam = camera; update(dt, camera); },
  };
}
