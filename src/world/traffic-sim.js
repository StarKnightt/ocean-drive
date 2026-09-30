// Ocean Drive traffic, pure maths (no three, no DOM: runs in Node tests). A steady slow line
// of cars cruises the two travel lanes at 20-30 km/h in loose platoons (2-4 car lengths
// apart, longer breaks between platoons) with the Intelligent Driver Model: each follows the
// nearest thing ahead in its lane - the car in front, a stop line, or an obstacle (the
// player on foot, the player's bike / ATV / convertible, the cyclist) - and so slows, stops
// short and pulls away smoothly. Pedestrians have right of way on the crosswalks: a car
// stops for anyone on one or stepping off the curb onto it. The 11 ST signal cycles and
// cars obey it (a yellow is run only when stopping would be too hard).
//
// The lanes form one loop: southbound (x -19.75, +z) and northbound (x -16.25, -z), joined
// out of sight beyond the district ends, where a car leaving one lane re-enters the other
// (with a new model and colour - never the model and colour of the car it follows - once the
// lane's next gap has opened behind the last car in, and only far from the viewer).
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

// Model / colour dealer for the traffic: bodies and paints are dealt from shuffled decks (every
// one before any repeats) and never match the car being followed; a classic convertible now
// and then (always one on the road while a classic is free). classicFree / classicOnRoad:
// counts supplied by the renderer.
export function createPicker({ kinds, lens, paints, classicLen = 5.76, classicShare = 0.15, classicFree = () => 0, classicOnRoad = () => 0 }) {
  const decks = new Map();
  const deal = (src, rnd) => {
    let d = decks.get(src);
    if (!d || !d.length) {
      d = src.slice();
      for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
      decks.set(src, d);
    }
    return d.pop();
  };
  return (rnd, prev) => {
    const classic = classicFree() > 0 && !prev?.classic && (classicOnRoad() === 0 || rnd() < classicShare);
    if (classic || !kinds.length) return { model: 'classic', len: classicLen, classic: true };
    let model = deal(kinds, rnd);
    for (let t = 0; t < 4 && kinds.length > 1 && model === prev?.model; t++) model = deal(kinds, rnd);
    let color = deal(paints, rnd);
    for (let t = 0; t < 6 && paints.length > 1 && color === prev?.color; t++) color = deal(paints, rnd);
    return { model, len: lens[model] + 0.1, color };
  };
}

// a lane's next entry gap (bumper to bumper, m): mostly 2-4 car lengths inside a platoon,
// now and then a break between platoons
export const nextGap = (rnd, len) => (rnd() < 0.8 ? (2 + 2 * rnd()) * len : 22 + rnd() * 36);

// opts: { count, seed, pickModel(rnd, prev) -> { model, len, classic, color } } (prev: the car
// the new one will follow in its lane, or null)
export function createTrafficSim({ count = 4, seed = 11, pickModel = () => ({ model: 'sedan', len: 4.8 }) } = {}) {
  const rnd = rng(seed);
  const cars = [];
  let t = 0, ids = 0;
  const clearT = new Map(CROSSWALKS.map((cw) => [cw, 0]));   // a short wait after a crosswalk clears
  // a platoon forms behind its slower leader (21-25 km/h): a car joining one would like 29-30,
  // so it closes up to a few car lengths and stays there (with a desired speed only just over
  // the leader's, the model's following gap stretches to five or more)
  const desired = (lead = null) => (lead ? 29 + rnd() : 21 + rnd() * 4) / 3.6;
  function makeCar(dir, z, v, prev = null, follow = false) {
    const m = pickModel(rnd, prev);
    return {
      id: ++ids, dir, z, x: LANE_X[dir], v, v0: desired(follow ? prev : null), a: 0, len: m.len, model: m.model, classic: !!m.classic, color: m.color,
      braking: false, brakeT: 0, reason: null, blockedT: 0, stunT: 0, honk: 0, honked: false, holdT: 0, hidden: false, respawns: 0,
      // (people.js / audio compatibility: the old audio car's fields)
      active: true, progress: 0.5, speed: v,
    };
  }
  // initial spread: per lane, platoons of 3-6 from the far end back, the breaks between them
  // sized so the lane's share of the fleet fills most of the loop
  for (const dir of [1, -1]) {
    const n = dir > 0 ? Math.ceil(count / 2) : Math.floor(count / 2);
    if (!n) continue;
    const sizes = [];
    for (let left = n; left > 0;) { const k = Math.min(left, 3 + Math.floor(rnd() * 4)); sizes.push(k); left -= k; }
    const inner = n * (4.8 + 3 * 4.8), span = 2 * END_Z * 0.92;
    const brk = Math.max(20, (span - inner) / sizes.length);
    let p = END_Z * 0.92, prev = null;
    for (const k of sizes) {
      for (let i = 0; i < k; i++) {
        const c = makeCar(dir, 0, 0, prev, i > 0);
        c.v = c.v0;
        p -= c.len / 2;
        c.z = dir * p;
        p -= c.len / 2 + (i < k - 1 ? (2 + 2 * rnd()) * c.len : brk * (0.6 + 0.8 * rnd()));
        cars.push(c);
        prev = c;
      }
    }
  }
  const gapNext = { 1: nextGap(rnd, 4.8), [-1]: nextGap(rnd, 4.8) };

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

  // re-entry at a loop end: the other lane, out of sight, once the lane's next gap has opened
  // behind the last car in (a new model and colour, unlike the car it follows)
  function tryRespawn(c, viewer) {
    const dir = -c.dir, z = -dir * END_Z;
    let last = null;
    for (const o of cars) if (o !== c && !o.hidden && o.dir === dir && (!last || o.z * dir < last.z * dir)) last = o;
    const far = !viewer || Math.hypot(viewer.x - LANE_X[dir], viewer.z - z) > 150;
    if (!far || (last && (last.z - z) * dir - last.len / 2 - 2.5 < gapNext[dir])) return false;
    const n = makeCar(dir, z, 0, last, gapNext[dir] < 5 * 4.8);
    gapNext[dir] = nextGap(rnd, n.len);
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
          // bumped by the player: stopped, hazards on, for stunT seconds
          if (c.stunT > 0) {
            c.stunT = Math.max(0, c.stunT - h);
            c.v = 0; c.a = 0; c.braking = true; c.reason = 'stunned'; c.speed = 0;
            continue;
          }
          const L = leader(c, peds, obstacles, sig);
          let acc = idm(c, L);
          acc = Math.max(-7, Math.min(IDM.a, acc));
          c.v = Math.max(0, c.v + acc * h);
          // the last creep of the model's approach: at the stopping distance, stand still
          if (L.reason && acc < 0 && c.v < 0.4 && L.gap < L.s0 + 0.6) c.v = 0;
          // held at a light or crosswalk a little short of the line: stay put, don't creep up
          if ((L.reason === 'signal' || L.reason === 'crosswalk') && c.v < 0.4 && L.gap < L.s0 + 2.5) { c.v = 0; acc = Math.min(acc, 0); }
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
