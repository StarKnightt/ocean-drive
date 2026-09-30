// Node-only checks of the traffic model (src/world/traffic-sim.js): following distance,
// crosswalk stops for pedestrians, the 11 ST signal, stopping short of a player obstacle
// (and honking once), and a continuous flow with no overlaps.
// Usage: node tools/traffic-sim-test.mjs
import { createTrafficSim, createPicker, CROSSWALKS, stopLine, signalLine, signalState, SIGNAL, SIGNAL_CYCLE, LANE_X, END_Z } from '../src/world/traffic-sim.js';
import { CROSSWALK_Z } from '../src/world/layout.js';

const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(info)}`); };
const DT = 1 / 60;
const front = (c) => c.z + c.dir * c.len / 2, rear = (c) => c.z - c.dir * c.len / 2;
const pick = () => ({ model: 'sedan', len: 4.8 });

// 1. following: a slow leader, the follower settles at a safe gap and never closes it
{
  const sim = createTrafficSim({ count: 2, seed: 3, pickModel: pick });
  const [a, b] = sim.cars;
  Object.assign(a, { dir: 1, x: LANE_X[1], z: 60, v: 3, v0: 3 });      // leader, 11 km/h
  Object.assign(b, { dir: 1, x: LANE_X[1], z: 20, v: 7.5, v0: 7.5 });  // follower at 27 km/h
  let minGap = Infinity;
  for (let t = 0; t < 40; t += DT) {
    sim.update(DT);
    minGap = Math.min(minGap, rear(a) - front(b));
  }
  const gap = rear(a) - front(b);
  check('follower keeps a safe gap behind a slow car', minGap > 2 && gap > 4 && gap < 12 && Math.abs(b.v - a.v) < 0.3, { minGap: +minGap.toFixed(2), gap: +gap.toFixed(2), vLead: a.v, vFollow: +b.v.toFixed(2) });
}
// the leader stops dead: the follower stops behind it
{
  const sim = createTrafficSim({ count: 2, seed: 4, pickModel: pick });
  const [a, b] = sim.cars;
  Object.assign(a, { dir: -1, x: LANE_X[-1], z: 100, v: 0, v0: 0.001 });
  Object.assign(b, { dir: -1, x: LANE_X[-1], z: 160, v: 8, v0: 8 });
  for (let t = 0; t < 30; t += DT) sim.update(DT);
  const gap = (b.z - b.len / 2) - (a.z + a.len / 2);
  check('follower stops behind a stopped car (northbound)', b.v < 0.05 && gap > 1.5 && gap < 4, { gap: +gap.toFixed(2), v: b.v });
}

// 2. crosswalk at z = -10: a pedestrian on it, the car stops at the line, then goes on
{
  const sim = createTrafficSim({ count: 1, seed: 5, pickModel: pick });
  const [c] = sim.cars;
  Object.assign(c, { dir: 1, x: LANE_X[1], z: -80, v: 7.5, v0: 7.5 });
  const cw = CROSSWALKS.find((q) => Math.abs((q.z0 + q.z1) / 2 - CROSSWALK_Z) < 0.1);
  const line = stopLine(cw, 1);
  const ped = { x: -18, z: CROSSWALK_Z };
  let maxFront = -Infinity;
  for (let t = 0; t < 20; t += DT) { sim.update(DT, { peds: [ped] }); maxFront = Math.max(maxFront, front(c)); }
  check('car stops at the crosswalk line for a pedestrian', c.v < 0.05 && maxFront < line + 0.3 && maxFront > line - 3, { front: +maxFront.toFixed(2), line, reason: c.reason, braking: c.braking });
  let tGo = null;
  for (let t = 0; t < 10; t += DT) { sim.update(DT, { peds: [] }); if (tGo === null && c.v > 3) tGo = t; }
  check('then pulls away smoothly once it is clear', tGo !== null && tGo > 0.9 && tGo < 6 && front(c) > cw.z1, { tGo: tGo && +tGo.toFixed(2), z: +c.z.toFixed(1) });
  // a pedestrian on the sidewalk step, about to cross, also stops it
  const sim2 = createTrafficSim({ count: 1, seed: 6, pickModel: pick });
  const c2 = sim2.cars[0];
  Object.assign(c2, { dir: -1, x: LANE_X[-1], z: 60, v: 7.5, v0: 7.5 });
  for (let t = 0; t < 20; t += DT) sim2.update(DT, { peds: [{ x: -14.0, z: CROSSWALK_Z }] });
  check('a pedestrian at the curb about to step on stops it too', c2.v < 0.05 && front(c2) > stopLine(cw, -1) - 0.3, { front: +front(c2).toFixed(2), line: stopLine(cw, -1) });
  // someone well back on the sidewalk does not
  const sim3 = createTrafficSim({ count: 1, seed: 7, pickModel: pick });
  const c3 = sim3.cars[0];
  Object.assign(c3, { dir: -1, x: LANE_X[-1], z: 60, v: 7.5, v0: 7.5 });
  for (let t = 0; t < 15; t += DT) sim3.update(DT, { peds: [{ x: -11, z: CROSSWALK_Z }] });
  check('a pedestrian away from the curb is ignored', c3.z < CROSSWALK_Z - 5, { z: +c3.z.toFixed(1) });
  // a car already too close to stop keeps going (no emergency stop in the crosswalk)
  const sim4 = createTrafficSim({ count: 1, seed: 8, pickModel: pick });
  const c4 = sim4.cars[0];
  Object.assign(c4, { dir: 1, x: LANE_X[1], z: line - 2.4 - 1, v: 8, v0: 8 });
  for (let t = 0; t < 4; t += DT) sim4.update(DT, { peds: [{ x: -15, z: CROSSWALK_Z }] });
  check('a car too close to stop does not brake inside the crosswalk', c4.z > cw.z1, { z: +c4.z.toFixed(1) });
}

// 3. the 11 ST signal
{
  const sim = createTrafficSim({ count: 1, seed: 9, pickModel: pick });
  const [c] = sim.cars;
  c.hidden = true;
  while (sim.signal !== 'red') sim.update(DT);
  const line = signalLine(1);
  Object.assign(c, { hidden: false, dir: 1, x: LANE_X[1], z: line - 40, v: 7.5, v0: 7.5 });
  let maxFront = -Infinity, waited = 0;
  while (sim.signal === 'red') { sim.update(DT); maxFront = Math.max(maxFront, front(c)); if (c.v < 0.05) waited += DT; }
  check('car stops at the red light', maxFront < line + 0.3 && maxFront > line - 4 && waited > 2, { front: +maxFront.toFixed(2), line, waited: +waited.toFixed(1) });
  for (let t = 0; t < 10; t += DT) sim.update(DT);
  check('and goes on green', front(c) > line + 20 && c.v > 5, { z: +c.z.toFixed(1), v: +c.v.toFixed(2) });
  // cycle proportions
  const counts = { green: 0, yellow: 0, red: 0 };
  for (let t = 0; t < SIGNAL_CYCLE; t += 0.1) counts[signalState(t)]++;
  check('signal cycles green / yellow / red', counts.green > 200 && counts.yellow > 30 && counts.red > 130, counts);
  // a car at the line when it turns yellow goes; one far enough away stops
  const sim2 = createTrafficSim({ count: 2, seed: 10, pickModel: pick });
  const [n, f] = sim2.cars;
  while (sim2.signal !== 'green') sim2.update(DT);
  while (sim2.signal === 'green') sim2.update(DT);   // yellow now
  Object.assign(n, { dir: -1, x: LANE_X[-1], z: signalLine(-1) + 2.4 + 2, v: 8, v0: 8 });
  Object.assign(f, { dir: -1, x: LANE_X[-1], z: signalLine(-1) + 2.4 + 45, v: 8, v0: 8 });
  for (let t = 0; t < 12; t += DT) sim2.update(DT);
  check('yellow: the close car goes through, the far one stops', n.z < signalLine(-1) - 10 && f.v < 0.1 && front(f) > signalLine(-1) - 0.3, { close: +n.z.toFixed(1), farFront: +front(f).toFixed(2), line: signalLine(-1) });
}

// 4. the player standing in the lane: stop short, never overlap, honk once after 4 s
{
  const sim = createTrafficSim({ count: 1, seed: 12, pickModel: pick });
  const [c] = sim.cars;
  Object.assign(c, { dir: 1, x: LANE_X[1], z: 100, v: 8, v0: 8 });
  const me = { x: LANE_X[1] + 0.6, z: 140, r: 0.3 };
  let minClear = Infinity;
  for (let t = 0; t < 16; t += DT) { sim.update(DT, { obstacles: [me] }); minClear = Math.min(minClear, me.z - me.r - front(c)); }
  check('car stops short of the player in the lane', c.v < 0.05 && minClear > 0.5 && minClear < 4, { clear: +minClear.toFixed(2) });
  check('honks once when blocked for more than 4 s', c.honk === 1, { honk: c.honk, blockedT: +c.blockedT.toFixed(1) });
  for (let t = 0; t < 10; t += DT) sim.update(DT, { obstacles: [me] });
  check('...and only once', c.honk === 1, { honk: c.honk });
  // the player's convertible parked across the lane edge (a big obstacle circle)
  const sim2 = createTrafficSim({ count: 1, seed: 13, pickModel: pick });
  const c2 = sim2.cars[0];
  Object.assign(c2, { dir: -1, x: LANE_X[-1], z: 50, v: 8, v0: 8 });
  const car = [-1.95, -0.65, 0.65, 1.95].map((dz) => ({ x: LANE_X[-1] - 1.2, z: 0 + dz, r: 0.93 }));
  let minC = Infinity;
  for (let t = 0; t < 12; t += DT) { sim2.update(DT, { obstacles: car }); minC = Math.min(minC, rear(c2) - 0 - 1.95 - 0.93 - (front(c2) - rear(c2) > 0 ? 0 : 0)); }
  const clear2 = (front(c2)) - (0 + 1.95 + 0.93);
  check('stops for the player vehicle half in its lane', c2.v < 0.05 && clear2 > 0.5, { clear: +clear2.toFixed(2) });
  // it moves away: the car pulls away
  car.forEach((q) => { q.x = -30; });
  for (let t = 0; t < 8; t += DT) sim2.update(DT, { obstacles: car });
  check('and pulls away when it is gone', c2.z < -10, { z: +c2.z.toFixed(1) });
  // an obstacle in the other lane is ignored
  const sim3 = createTrafficSim({ count: 1, seed: 14, pickModel: pick });
  const c3 = sim3.cars[0];
  Object.assign(c3, { dir: 1, x: LANE_X[1], z: 100, v: 8, v0: 8 });
  for (let t = 0; t < 10; t += DT) sim3.update(DT, { obstacles: [{ x: LANE_X[-1] + 0.3, z: 140, r: 0.3 }] });
  check('an obstacle in the other lane does not stop it', c3.z > 150, { z: +c3.z.toFixed(1) });
}

// 4b. reacting to the player: predictive braking, startle beep, swerve, passing a stopped car
{
  // the player's car coming out of a side street toward the lane: braked for before it is in it
  const sim = createTrafficSim({ count: 1, seed: 31, pickModel: pick });
  const c = sim.cars[0];
  Object.assign(c, { dir: 1, x: LANE_X[1], z: 100, v: 8, v0: 8 });
  const me = { x: LANE_X[1] - 6, z: 116, r: 1, vx: 4, vz: 0, player: true };
  let firstBrake = null, minClear = Infinity;
  for (let t = 0; t < 6; t += DT) {
    if (me.x < LANE_X[1]) me.x += me.vx * DT; else { me.vx = 0; }
    sim.update(DT, { obstacles: [me] });
    if (firstBrake === null && c.a < -0.5) firstBrake = { t: +t.toFixed(2), gapX: +(LANE_X[1] - me.x).toFixed(2) };
    minClear = Math.min(minClear, me.z - me.r - front(c));
  }
  check('predictive braking: it brakes for the player\'s car while it is still out of the lane, and stops short', firstBrake && firstBrake.gapX > 1.15 + 1 && minClear > 0.5, { firstBrake, clear: +minClear.toFixed(2) });
  check('and beeps at it (the startle honk, with the driver\'s gesture)', c.honk >= 1 && (c.startles ?? 0) >= 1, { honk: c.honk, startles: c.startles });
  // swerve: something just over the lane edge (a bin, a door-parked car's mirror): edges round it
  const sim2 = createTrafficSim({ count: 1, seed: 32, pickModel: pick });
  const c2 = sim2.cars[0];
  Object.assign(c2, { dir: 1, x: LANE_X[1], z: 100, v: 7, v0: 7 });
  const post = { x: LANE_X[1] - 1.2, z: 140, r: 0.4 };
  let maxOff = 0;
  for (let t = 0; t < 12; t += DT) { sim2.update(DT, { obstacles: [post] }); maxOff = Math.max(maxOff, c2.xOff); }
  check('swerve: it edges round an obstacle that only partly blocks the lane, then back', c2.z > 150 && maxOff > 0.3 && maxOff <= 0.95 && Math.abs(c2.xOff) < 0.05, { z: +c2.z.toFixed(1), maxOff: +maxOff.toFixed(2), off: +c2.xOff.toFixed(2) });
  // passing: a car left standing in the lane; after the wait it goes round through the other lane
  const sim3 = createTrafficSim({ count: 1, seed: 33, pickModel: pick });
  const c3 = sim3.cars[0];
  Object.assign(c3, { dir: -1, x: LANE_X[-1], z: 100, v: 8, v0: 8 });
  const parked = [-1.9, -0.95, 0, 0.95, 1.9].map((dz) => ({ x: LANE_X[-1], z: 40 + dz, r: 0.95, vx: 0, vz: 0 }));
  let maxOut = 0, hit = false, passedAt = null;
  for (let t = 0; t < 40; t += DT) {
    sim3.update(DT, { obstacles: parked });
    maxOut = Math.max(maxOut, Math.abs(c3.xOff));
    for (const o of parked) if (Math.abs(o.x - c3.x) < 0.95 + 0.9 && Math.abs(o.z - c3.z) < c3.len / 2 + 0.95 - 0.3) hit = true;
    if (passedAt === null && rear(c3) < 40 - 1.9 - 3) passedAt = +t.toFixed(1);
  }
  check('passing: after waiting it swings into the other lane, round the stopped car (never through it) and back', c3.passes === 1 && maxOut > 3 && !hit && passedAt !== null && Math.abs(c3.xOff) < 0.05 && c3.z < 0, { passes: c3.passes, maxOut: +maxOut.toFixed(2), hit, passedAt, z: +c3.z.toFixed(1), off: +c3.xOff.toFixed(2) });
  // not while the other lane has traffic coming
  const sim4 = createTrafficSim({ count: 2, seed: 34, pickModel: pick });
  const [a, b] = sim4.cars;
  Object.assign(a, { dir: -1, x: LANE_X[-1], z: 100, v: 8, v0: 8 });
  Object.assign(b, { dir: 1, x: LANE_X[1], z: 60, v: 0, v0: 0.001 });
  for (let t = 0; t < 20; t += DT) sim4.update(DT, { obstacles: parked });
  check('no pass while the other lane is busy within 60 m', !(a.passes > 0) && a.v < 0.05, { passes: a.passes ?? 0 });
  // detach (the player takes it): hidden now, back from a loop end later
  const sim5 = createTrafficSim({ count: 1, seed: 35, pickModel: pick });
  const d = sim5.cars[0];
  Object.assign(d, { dir: 1, x: LANE_X[1], z: 0, v: 0 });
  sim5.detach(d);
  const r0 = d.respawns;
  for (let t = 0; t < 30 && d.respawns === r0; t += DT) sim5.update(DT, { viewer: { x: -18, z: 0 } });
  check('detach: the taken car leaves the lane and its slot re-enters from a loop end', d.respawns === r0 + 1 && Math.abs(Math.abs(d.z) - END_Z) < 20, { respawns: d.respawns, z: +d.z.toFixed(1) });
}

// 5. continuous flow: 5 cars, 20 minutes, viewer mid-drive
{
  const sim = createTrafficSim({ count: 5, seed: 21, pickModel: (r) => ({ model: 'x', len: 4.2 + r() * 1.2 }) });
  let overlaps = 0, minVisible = 99, passes = { 1: 0, [-1]: 0 }, maxSpeed = 0, respawns = 0;
  const lastSide = new Map();
  const viewer = { x: -26, z: 0 };
  for (let t = 0; t < 1200; t += DT) {
    // a pedestrian crossing at z = -10 for 8 s every 60 s
    const peds = t % 60 < 8 ? [{ x: -24 + ((t % 60) / 8) * 10, z: CROSSWALK_Z }] : [];
    sim.update(DT, { peds, viewer });
    let vis = 0;
    for (const c of sim.cars) {
      if (c.hidden) continue;
      vis++;
      maxSpeed = Math.max(maxSpeed, c.v);
      for (const o of sim.cars) if (o !== c && !o.hidden && o.dir === c.dir && Math.abs(o.z - c.z) < (o.len + c.len) / 2) overlaps++;
      const side = Math.sign(c.z);
      const prev = lastSide.get(c);
      if (prev !== undefined && prev !== side && Math.abs(c.z) < 5) passes[c.dir]++;
      lastSide.set(c, side);
    }
    if (t > 120) minVisible = Math.min(minVisible, vis);
  }
  respawns = sim.cars.reduce((n, c) => n + c.respawns, 0);
  check('no two cars ever overlap in a lane', overlaps === 0, { overlaps });
  check('continuous flow past the viewer, both directions', passes[1] > 8 && passes[-1] > 8, { passes, respawns });
  check('cars stay on the drive (at least 2 of 5 visible)', minVisible >= 2, { minVisible });
  check('cruise speed 20-30 km/h', maxSpeed * 3.6 > 19 && maxSpeed * 3.6 < 31, { maxKmh: +(maxSpeed * 3.6).toFixed(1) });
  const far = sim.cars.every((c) => Math.abs(c.z) <= END_Z + 1);
  check('cars stay within the loop', far, { zs: sim.cars.map((c) => +c.z.toFixed(0)) });
}

// 8. the high-tier fleet (30 cars, the renderer's picker): a steady line in loose platoons,
// every body style on the road, never two consecutive cars of the same model and colour
{
  const KINDS = ['sedan', 'hatch', 'suv', 'pickup', 'coupe', 'wagon', 'crossover'];
  const lens = Object.fromEntries(KINDS.map((k, i) => [k, 4.2 + 0.18 * i]));
  const paints = Array.from({ length: 16 }, (_, i) => 0x101010 * (i + 1));
  let sim = null;
  const onRoad = () => (sim ? sim.cars.filter((c) => c.classic && !c.hidden).length : 0);
  const pickModel = createPicker({ kinds: KINDS, lens, paints, classicFree: () => 4 - onRoad(), classicOnRoad: onRoad });
  sim = createTrafficSim({ count: 30, seed: 11, pickModel });
  const viewer = { x: -26, z: 0 };
  let same = 0, pairs = 0, overlaps = 0, minNear = Infinity, under30 = 0, gapsAll = 0;
  const follow = [];
  const models = new Set();
  for (let t = 0; t < 900; t += DT) {
    sim.update(DT, { viewer });
    if (Math.round(t / DT) % 60) continue;
    let nearN = 0;
    for (const dir of [1, -1]) {
      const l = sim.cars.filter((c) => !c.hidden && c.dir === dir).sort((a, b) => (a.z - b.z) * dir);
      for (const c of l) { models.add(c.model); if (Math.abs(c.z) < 250) nearN++; }
      for (let i = 1; i < l.length; i++) {
        const a = l[i - 1], b = l[i];
        pairs++;
        if (a.model === b.model && a.color === b.color) same++;
        const gap = Math.abs(b.z - a.z) - (a.len + b.len) / 2;
        if (gap < 0.3) overlaps++;
        gapsAll++;
        if (gap < 30) under30++;
        if (gap < 40) follow.push(gap / ((a.len + b.len) / 2));
      }
    }
    if (t > 60) minNear = Math.min(minNear, nearN);
  }
  check('30 cars: never two consecutive cars of one model and colour', same === 0 && pairs > 1000, { same, pairs });
  check('30 cars: all seven bodies and a classic on the road', KINDS.every((k) => models.has(k)) && models.has('classic'), { models: [...models] });
  check('30 cars: no overlaps', overlaps === 0, { overlaps });
  check('30 cars: a steady line (>= 10 within 250 m of the viewer)', minNear >= 10, { minNear });
  follow.sort((a, b) => a - b);
  const med = follow[follow.length >> 1];
  check('30 cars: platoons 2-4 car lengths apart (median following gap), most gaps < 30 m', med > 2 && med < 4 && under30 / gapsAll > 0.5, { medianLengths: +med.toFixed(2), under30: +(under30 / gapsAll).toFixed(2) });
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
