// Ocean Drive traffic, pure maths (no three, no DOM: runs in Node tests). A few cars cruise
// the two travel lanes at 20-30 km/h with the Intelligent Driver Model: each follows the
// nearest thing ahead in its lane - the car in front, a stop line, or an obstacle (the
// player on foot, the player's bike / ATV / convertible, the cyclist) - and so slows, stops
// short and pulls away smoothly. Pedestrians have right of way on the crosswalks: a car
// stops for anyone on one or stepping off the curb onto it. The 11 ST signal cycles and
// cars obey it (a yellow is run only when stopping would be too hard).
//
// The lanes form one loop: southbound (x -19.75, +z) and northbound (x -16.25, -z), joined
// out of sight beyond the district ends, where a car leaving one lane re-enters the other
// (with a new model and colour, and only when that entry is clear and far from the viewer).
//
// Conventions: z grows southward; a car's `z` is its centre, `dir` +1 southbound / -1
// northbound, `len` its length.
import { LANES, CROSSWALK_Z, CROSS_STREETS, crossLegs, SIDEWALK_W, SIDEWALK_E } from './layout.js';

export const LANE_X = { 1: LANES.centerX - 1.75, [-1]: LANES.centerX + 1.75 };
export const END_Z = 460;             // loop ends: re-entry beyond the district, out of sight
export const LANE_HALF = 1.15;        // half width of a car's swept path (for obstacles)
export const IDM = { a: 1.0, b: 1.8, T: 1.5, s0: 2.4, s0Stop: 0.7, s0Obst: 2.2, delta: 4 };
const BRAKE_HARD = 5;                 // m/s2: beyond this a car can't stop for a line: it goes
export const SIGNAL_Z = CROSS_STREETS.find((c) => c.signal)?.z ?? -190;
// Ocean Drive signal cycle (s): green, yellow, then red while the cross street runs
export const SIGNAL = { green: 22, yellow: 3.5, red: 14.5 };
export const SIGNAL_CYCLE = SIGNAL.green + SIGNAL.yellow + SIGNAL.red;
export function signalState(t) {
  const q = ((t % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  if (q < SIGNAL.green) return 'green';
  if (q < SIGNAL.green + SIGNAL.yellow) return 'yellow';
  return 'red';
}
// the cross street's heads: green inside Ocean Drive's red, less an all-red second each side
export function crossSignalState(t) {
  const q = ((t % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE, r0 = SIGNAL.green + SIGNAL.yellow + 1;
  if (q < r0 || q >= SIGNAL_CYCLE - 1) return 'red';
  return q < SIGNAL_CYCLE - 4 ? 'green' : 'yellow';
}

// crosswalks over Ocean Drive: [z0, z1] with the signal flag
export const CROSSWALKS = [
  { z0: CROSSWALK_Z - 2, z1: CROSSWALK_Z + 2, signal: false },
  ...CROSS_STREETS.filter((c) => !c.far).flatMap((c) => crossLegs(c.z).map(([z0, z1]) => ({ z0, z1, signal: !!c.signal }))),
].sort((a, b) => a.z0 - b.z0);
// pedestrian zone of a crosswalk: the roadway plus a step of sidewalk on each side
const PED_X0 = SIDEWALK_W.x1 - 1.2, PED_X1 = SIDEWALK_E.x0 + 1.2;
// the stop line a car heading `dir` holds before a crosswalk (its front stops here)
export const stopLine = (cw, dir) => (dir > 0 ? cw.z0 - 1.6 : cw.z1 + 1.6);
// the signal's stop lines (the outer legs of the intersection)
const SIG_LEGS = crossLegs(SIGNAL_Z);
export const signalLine = (dir) => (dir > 0 ? SIG_LEGS[0][0] - 1.8 : SIG_LEGS[1][1] + 1.8);

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// opts: { count, seed, pickModel(rnd) -> { model, len, classic } }
export function createTrafficSim({ count = 4, seed = 11, pickModel = () => ({ model: 'sedan', len: 4.8 }) } = {}) {
  const rnd = rng(seed);
  const cars = [];
  let t = 0, ids = 0;
  const clearT = new Map(CROSSWALKS.map((cw) => [cw, 0]));   // a short wait after a crosswalk clears
  const desired = () => (20 + rnd() * 10) / 3.6;
  function makeCar(dir, z, v) {
    const m = pickModel(rnd);
    return {
      id: ++ids, dir, z, x: LANE_X[dir], v, v0: desired(), a: 0, len: m.len, model: m.model, classic: !!m.classic, color: m.color,
      braking: false, brakeT: 0, reason: null, blockedT: 0, honk: 0, honked: false, holdT: 0, hidden: false, respawns: 0,
      // (people.js / audio compatibility: the old audio car's fields)
      active: true, progress: 0.5, speed: v,
    };
  }
  // initial spread: alternate lanes, evenly along the loop with some jitter
  for (let i = 0; i < count; i++) {
    const dir = i % 2 ? -1 : 1;
    const f = (i + 0.5 + (rnd() - 0.5) * 0.5) / count;
    cars.push(makeCar(dir, dir * (-END_Z + 2 * END_Z * f) * 0.85, desired()));
  }

  // the thing each car follows: gap to it (bumper to bumper) and its speed
  function leader(c, peds, obstacles, sig) {
    let gap = Infinity, vl = 0, s0 = IDM.s0, reason = null;
    const front = c.z + c.dir * c.len / 2;
    const ahead = (z) => (z - front) * c.dir;   // distance of a point ahead of the front
    for (const o of cars) {
      if (o === c || o.dir !== c.dir || o.hidden) continue;
      const d = ahead(o.z - o.dir * o.len / 2);
      if (d > -0.5 && d < gap && (o.z - c.z) * c.dir > 0) { gap = d; vl = o.v; s0 = IDM.s0; reason = 'car'; }
    }
    // obstacles in the lane (player, vehicles, cyclist): stop short of them
    for (const o of obstacles) {
      if (Math.abs(o.x - c.x) > LANE_HALF + (o.r ?? 0.3)) continue;
      const d = ahead(o.z - c.dir * (o.r ?? 0.3));
      if (d > -c.len * 0.6 && d < gap) { gap = Math.max(d, 0); vl = Math.max(0, (o.v ?? 0)); s0 = IDM.s0Obst; reason = 'obstacle'; }
    }
    // crosswalks: pedestrians have right of way
    const brakeDist = (c.v * c.v) / (2 * BRAKE_HARD);
    for (const cw of CROSSWALKS) {
      const line = stopLine(cw, c.dir);
      const d = ahead(line);
      if (d < -0.3 || d > 70 || d > gap) continue;
      let busy = false;
      for (const p of peds) if (p.x > PED_X0 && p.x < PED_X1 && p.z > cw.z0 - 0.5 && p.z < cw.z1 + 0.5) { busy = true; break; }
      if (busy) clearT.set(cw, 0.9);
      if ((busy || clearT.get(cw) > 0) && d > brakeDist - 0.5) { gap = Math.max(d, 0); vl = 0; s0 = IDM.s0Stop; reason = 'crosswalk'; }
    }
    // the signal
    if (sig !== 'green') {
      const d = ahead(signalLine(c.dir));
      const need = sig === 'yellow' ? (c.v * c.v) / (2 * 3) : brakeDist;
      if (d > -0.3 && d < 90 && d < gap && d > need - 0.5) { gap = Math.max(d, 0); vl = 0; s0 = IDM.s0Stop; reason = 'signal'; }
    }
    return { gap, vl, s0, reason };
  }

  function idm(c, L) {
    const { a, b, T, delta } = IDM;
    const free = 1 - Math.pow(c.v / c.v0, delta);
    if (!isFinite(L.gap)) return a * free;
    const ss = L.s0 + Math.max(0, c.v * T + (c.v * (c.v - L.vl)) / (2 * Math.sqrt(a * b)));
    const g = Math.max(L.gap - 0.0, 0.05);
    return a * (free - (ss / g) ** 2);
  }

  // re-entry at a loop end: the other lane, out of sight, clear of the car ahead there
  function tryRespawn(c, viewer) {
    const dir = -c.dir, z = -dir * END_Z;
    const clear = cars.every((o) => o === c || o.hidden || o.dir !== dir || Math.abs(o.z - z) > 30);
    const far = !viewer || Math.hypot(viewer.x - LANE_X[dir], viewer.z - z) > 150;
    if (!clear || !far) return false;
    const n = makeCar(dir, z, 0);
    Object.assign(c, { ...n, id: c.id, respawns: c.respawns + 1, v: n.v0 * 0.8, hidden: false });
    return true;
  }

  const api = {
    cars,
    get time() { return t; },
    get signal() { return signalState(t); },
    // input: { peds: [{x, z}], obstacles: [{x, z, r, v?}], viewer: {x, z} }
    update(dt, { peds = [], obstacles = [], viewer = null } = {}) {
      dt = Math.min(dt, 0.1);
      t += dt;
      for (const cw of CROSSWALKS) clearT.set(cw, Math.max(0, clearT.get(cw) - dt));
      const sig = signalState(t);
      // two passes of half steps keep the hard stops short at low frame rates
      const n = dt > 0.034 ? 2 : 1, h = dt / n;
      for (let k = 0; k < n; k++) {
        for (const c of cars) {
          if (c.hidden) { c.holdT += h; if (tryRespawn(c, viewer)) c.holdT = 0; continue; }
          const L = leader(c, peds, obstacles, sig);
          let acc = idm(c, L);
          acc = Math.max(-7, Math.min(IDM.a, acc));
          c.v = Math.max(0, c.v + acc * h);
          // the last creep of the model's approach: at the stopping distance, stand still
          if (L.reason && acc < 0 && c.v < 0.4 && L.gap < L.s0 + 0.6) c.v = 0;
          // never into anything: hold short of the leader's bumper
          const step = c.v * h;
          if (L.reason && L.gap - step < (L.reason === 'car' ? 1.0 : L.reason === 'obstacle' ? 0.8 : 0.1)) {
            c.v = Math.min(c.v, Math.max(0, (L.gap - (L.reason === 'car' ? 1.0 : 0.8)) / h) * 0.5);
          }
          c.z += c.dir * c.v * h;
          c.a = acc;
          c.reason = L.reason;
          c.braking = acc < -0.35 || (c.v < 0.4 && !!L.reason && L.gap < 12);
          // blocked by an obstacle (not a light, crosswalk or car): honk once after 4 s
          if (L.reason === 'obstacle' && c.v < 0.2) c.blockedT += h; else { c.blockedT = 0; c.honked = false; }
          if (c.blockedT > 4 && !c.honked) { c.honked = true; c.honk++; }
          if (c.dir * c.z > END_Z) { c.hidden = true; c.holdT = 0; c.v = 0; }
          c.speed = c.v;
          c.progress = c.hidden ? 1 : 0.5;
          c.active = !c.hidden;
        }
      }
      return api;
    },
  };
  return api;
}
