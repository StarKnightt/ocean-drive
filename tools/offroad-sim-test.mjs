// Node-only checks of the open-world vehicle sim (specs.js OPEN_SPECS, spec.open): per-body
// road speeds, the lifted hero cap, grass and promenade speeds, curb mounting, sand
// bogging and rocking free, water stalls, the swash drift, the beach ramps and the soft
// world edge (world/extent.js). The default game (OPEN_WORLD off) is covered by
// vehicle-sim-test.mjs; this builds open vehicles explicitly, so the flag is not needed.
// Usage: node tools/offroad-sim-test.mjs
import { createVehicle, stepVehicle, buildGrid, ACCESS_ZS, canRestart, promenadeX } from '../src/vehicles/sim.js';
import { OPEN_SPECS, specFor, OPEN_WORLD } from '../src/vehicles/specs.js';
import { groundHeight, PARK, RAMPS, RAMP_X, SEA_LEVEL, rampHeight, sandHeight } from '../src/world/layout.js';
import { insideWorld, edgeDistance, edgeSteer, extentBounds } from '../src/world/extent.js';
import { createSurf } from '../src/world/surf.js';

const surf = createSurf({ frozen: true });
// the seawall as beach.js will build it in phase 1: cut at the stair accesses and the ramps,
// with cheek walls either side of each
const boxes = [];
const gaps = [...ACCESS_ZS.map((a) => [a - 1.2, a + 1.2]), ...RAMPS.map((r) => [r.z - r.hw - 0.2, r.z + r.hw + 0.2])].sort((a, b) => a[0] - b[0]);
const cuts = [-600, ...gaps.flat(), 600];
for (let i = 0; i < cuts.length; i += 2) boxes.push({ min: { x: PARK.wallX - 0.3, y: 0, z: cuts[i] }, max: { x: PARK.wallX + 0.4, y: 0.68, z: cuts[i + 1] } });
for (const a of ACCESS_ZS) for (const s of [-1, 1]) { const zc = a + s * 1.3; boxes.push({ min: { x: 10.75, y: 0, z: zc - 0.1 }, max: { x: 12.6, y: 0.78, z: zc + 0.1 } }); }
for (const r of RAMPS) for (const s of [-1, 1]) { const zc = r.z + s * (r.hw + 0.1); boxes.push({ min: { x: RAMP_X.x0, y: 0, z: zc - 0.1 }, max: { x: RAMP_X.x1 + 0.3, y: 0.95, z: zc + 0.1 } }); }
const world = {
  groundAt: groundHeight,
  waterDepthAt: (x, z) => surf.waterDepthAt(x, z),
  swashAt: (x, z) => surf.swashAt(x, z),
  grid: buildGrid(boxes, []),
  dynamic: () => [],
};
const flat = { groundAt: () => 0, grid: buildGrid([], []), dynamic: () => [], edgeDistance: () => 1e9 };

const yawFor = (heading) => -heading * Math.PI / 180;   // compass heading -> yaw
const E = yawFor(90), W = yawFor(270), N = yawFor(0), S = yawFor(180);
const make = (body, pose, w = world) => { const v = createVehicle(OPEN_SPECS[body], pose, w); v.parked = false; v.ridden = true; v.engineOn = true; return v; };
const drive = (v, input, seconds, w = world, stop, dt = 1 / 60) => {
  let t = 0;
  for (; t < seconds; t += dt) {
    stepVehicle(v, typeof input === 'function' ? input(v, t) : input, dt, w);
    if (stop && stop(v, t)) break;
  }
  return t;
};
const kmh = (v) => +(v.lon * 3.6).toFixed(1);
const results = [];
const check = (name, ok, info) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(info)}`); };

check('OPEN_WORLD is off by default; specFor keeps the current specs', OPEN_WORLD === false && specFor('car') === specFor('car', false) && !specFor('car').open && specFor('car', true).body === 'hero', { OPEN_WORLD });

// --- road: 0-100 and top speed per body (flat, unbounded)
for (const [body, t100, top] of [['sedan', 9, 170], ['hatch', 10, 150], ['pickup', 11, 150], ['coupe', 8.5, 175], ['hero', 14.5, 120]]) {
  const v = make(body, { x: -18, z: 0, yaw: N }, flat);
  let t = null;
  drive(v, { throttle: 1, steer: 0 }, 120, flat, (q, s) => { if (t === null && q.lon > 100 / 3.6) t = s; return false; });
  check(`${body} 0-100 km/h ~${t100} s, top ~${top} km/h`, t > t100 * 0.85 && t < t100 * 1.2 && kmh(v) > top * 0.93 && kmh(v) < top * 1.02, { t100: +t?.toFixed(2), kmh: kmh(v), gear: v.gear, rpm: Math.round(v.rpm) });
}
{
  const v = make('sedan', { x: -18, z: 0, yaw: N }, flat);
  drive(v, { throttle: 1, steer: 0 }, 30, flat);
  check('sedan shifts up through its gears', v.gear >= 5 && v.rpm < v.spec.redline, { gear: v.gear, rpm: Math.round(v.rpm) });
}

// --- grass vs the promenade, per body (the park, heading north)
// (a PD line follower: lateral error plus its rate along the curving line)
const onLine = (xAt) => (v) => {
  const slope = (xAt(v.z + 0.5) - xAt(v.z - 0.5));
  const e = v.x - xAt(v.z), de = v.vx - slope * v.vz;
  return { throttle: 1, steer: Math.max(-1, Math.min(1, -(e * 0.5 + de * 0.4))), hard: false };
};
const speeds = {};
for (const body of ['sedan', 'pickup']) {
  // top speed on the lawn (a long straight run up the park)
  const g = make(body, { x: -7.5, z: 300, yaw: N });
  drive(g, onLine(() => -7.5), 25);
  // coasting from 30 km/h for 3 s: the lawn drags more than the pavers
  const coast = (xAt) => {
    const v = make(body, { x: xAt(250), z: 250, yaw: N });
    v.vz = -30 / 3.6; v.lon = 30 / 3.6;
    let off = 0;
    drive(v, (q) => ({ ...onLine(xAt)(q), throttle: 0 }), 3, world, (q) => { if (q.surf.detail !== (xAt === promenadeX ? 'promenade' : 'grass')) off++; return false; });
    return { kmh: kmh(v), off };
  };
  speeds[body] = { grassTop: kmh(g), surf: g.surf.detail, coastGrass: coast(() => -7.5), coastPavers: coast(promenadeX) };
}
{
  const q = speeds.sedan;
  check('sedan: lawn top speed well under the road (< 65 km/h)', q.grassTop < 65 && q.grassTop > 30 && q.surf === 'grass', q);
  check('sedan: the lawn drags more than the promenade pavers', q.coastGrass.kmh < q.coastPavers.kmh - 5 && q.coastGrass.off + q.coastPavers.off === 0, { grass: q.coastGrass, pavers: q.coastPavers });
}
check('pickup copes with grass better than the sedan', speeds.pickup.grassTop > speeds.sedan.grassTop + 5, { sedan: speeds.sedan.grassTop, pickup: speeds.pickup.grassTop });

// --- curbs: mount slowly with a bump; at 50 km/h lose >= 40 % of the speed (no world
// edge here: the patio line is 3.8 m past the hotel-side curb, shorter than a car)
const open = { ...world, edgeDistance: () => 1e9 };
for (const [name, x0, yaw, past] of [['park-side curb (x -14.5)', -16.5, E, (v) => v.x > -12.5], ['hotel-side curb (x -24)', -21, W, (v) => v.x < -26.5]]) {
  for (const body of ['sedan', 'hero']) {
    let v = make(body, { x: x0, z: 200, yaw }, open);
    v.vx = -Math.sin(yaw) * 12 / 3.6; v.vz = -Math.cos(yaw) * 12 / 3.6; v.lon = 12 / 3.6;
    let curb = 0;
    drive(v, { throttle: 0.3, steer: 0 }, 5, open, (q) => { curb = Math.max(curb, q.curb); return past(q); });
    const mounted = past(v);
    v = make(body, { x: x0 + (yaw === E ? -4 : 4), z: 200, yaw }, open);
    v.vx = -Math.sin(yaw) * 50 / 3.6; v.vz = -Math.cos(yaw) * 50 / 3.6; v.lon = 50 / 3.6;
    const v0 = v.lon;
    drive(v, { throttle: 0, steer: 0 }, 3, open, (q) => past(q));
    check(`${body} mounts the ${name} at 12 km/h; loses >= 40 % at 50 km/h`, mounted && curb > 0.1 && v.lon < v0 * 0.6 && v.lon > v0 * 0.2, { curb: +curb.toFixed(3), kmhAfter: kmh(v) });
  }
}

// --- dry sand: the sedan bogs at full throttle and rocks free; the pickup does not bog
{
  const v = make('sedan', { x: 40, z: -150, yaw: S });
  drive(v, { throttle: 1, steer: 0 }, 6);
  const bogged = v.bogged, speed = kmh(v), sink = +Math.max(...v.sink).toFixed(3);
  // more throttle only digs deeper
  drive(v, { throttle: 1, steer: 0 }, 3);
  const deeper = v.bogged && Math.abs(v.lon) < 0.4;
  check('sedan bogs in dry sand at full throttle (and stays bogged on it)', bogged && deeper && speed < 1.5, { kmh: speed, sink });
  // rock it: reverse, then ease forward
  let freed = false, cycles = 0;
  for (; cycles < 8 && !freed; cycles++) {
    drive(v, { throttle: -1, steer: 0 }, 0.7);
    drive(v, { throttle: 0.5, steer: 0 }, 1.5);
    drive(v, { throttle: 0.6, steer: 0 }, 4, world, (q) => { if (q.lon > 1.5) freed = true; return freed; });
  }
  check('sedan rocks free (reverse, then ease forward)', freed && !v.bogged, { cycles, kmh: kmh(v), sink: +Math.max(...v.sink).toFixed(3) });
}
{
  const v = make('pickup', { x: 40, z: -150, yaw: S });
  drive(v, { throttle: 1, steer: 0 }, 6);
  check('pickup does not bog in dry sand', !v.bogged && kmh(v) > 20, { kmh: kmh(v), sink: +Math.max(...v.sink).toFixed(3) });
}
{
  const v = make('sedan', { x: 84, z: -150, yaw: S });
  drive(v, { throttle: 1, steer: 0 }, 8);
  check('sedan runs fast on the packed wet sand', v.surf.kind === 'wetsand' && kmh(v) > 50 && !v.bogged, { kmh: kmh(v), surf: v.surf.kind });
}

// --- water: the sedan stalls at about its intake depth, the pickup wades on
function wade(body) {
  const v = make(body, { x: 84, z: 60, yaw: E });
  let stallDepth = null, maxDepth = 0;
  drive(v, { throttle: 1, steer: 0 }, 25, world, (q) => {
    const d = Math.max(...q.wheelDepth);
    maxDepth = Math.max(maxDepth, d);
    if (q.stalled && stallDepth === null) stallDepth = d;
    return q.stalled && Math.abs(q.lon) < 0.05;
  });
  return { v, stallDepth, maxDepth };
}
{
  const s = wade('sedan'), p = wade('pickup');
  check('sedan stalls wading at ~0.3-0.4 m', s.v.stalled && !s.v.engineOn && s.stallDepth > 0.25 && s.stallDepth < 0.42, { stallDepth: +s.stallDepth?.toFixed(3) });
  check('stalled sedan cannot restart while the intake is under water', !canRestart(s.v), { depth: +Math.max(...s.v.wheelDepth).toFixed(3) });
  check('pickup wades past the sedan\'s stall depth without stalling', p.maxDepth > (s.stallDepth ?? 0) + 0.05 && (!p.v.stalled || p.stallDepth > 0.5), { maxDepth: +p.maxDepth.toFixed(3), stallDepth: p.stallDepth && +p.stallDepth.toFixed(3) });
  // tow it back to the beach (put it on dry sand): the engine may start again
  s.v.x = 60; s.v.vx = s.v.vz = 0;
  drive(s.v, { throttle: 0, steer: 0 }, 0.2);
  check('stalled sedan may restart once out of the water', canRestart(s.v), {});
}
{
  // the swash front running up the beach pushes a car standing in it west
  let t = 0;
  const ws = {
    ...world, grid: buildGrid([], []),
    waterDepthAt: (x) => (x > 50 ? 0.12 : 0),
    swashAt: () => ({ covered: true, depth: 0.12, front: 70 - 2.5 * t, fresh: 1 }),
  };
  const still = { ...ws, swashAt: () => ({ covered: true, depth: 0.12, front: 70, fresh: 1 }) };
  const a = make('sedan', { x: 60, z: 0, yaw: N }, ws), b = make('sedan', { x: 60, z: 0, yaw: N }, still);
  for (; t < 2; t += 1 / 60) { stepVehicle(a, { throttle: 0, steer: 0 }, 1 / 60, ws); stepVehicle(b, { throttle: 0, steer: 0 }, 1 / 60, still); }
  check('the swash drifts a car in the surf up the beach', a.x < b.x - 0.05 && Math.abs(b.x - 60) < 0.01, { drift: +(a.x - b.x).toFixed(3) });
}

// --- the beach ramps (z -95 and +95)
check('ramp grades from the park to the sand crest', Math.abs(rampHeight(RAMP_X.x0, -95) - 0.15) < 1e-6 && Math.abs(rampHeight(RAMP_X.x1, -95) - sandHeight(RAMP_X.x1)) < 1e-6 && rampHeight(10, -80) === null, { top: +rampHeight(RAMP_X.x1, -95).toFixed(3) });
for (const body of ['sedan', 'hero', 'pickup', 'atv']) {
  const down = make(body, { x: 3, z: -95, yaw: E });
  drive(down, { throttle: 0.6, steer: 0 }, 8, world, (q) => q.x > 18);
  const up = make(body, { x: 16, z: 95, yaw: W });
  up.vx = -3; up.lon = 3;   // (rolling in off the beach: a car can't pull away gently in dry sand)
  drive(up, { throttle: 0.6, steer: 0 }, 10, world, (q) => q.x < 4);
  check(`${body} drives down the z -95 ramp onto the beach and up the z 95 ramp`, down.x > 18 && up.x < 4, { down: +down.x.toFixed(2), up: +up.x.toFixed(2) });
}
{
  const v = make('sedan', { x: 3, z: -80, yaw: E });
  drive(v, { throttle: 1, steer: 0, hard: true }, 5);
  check('the seawall still stops a car away from the ramps', v.x < PARK.wallX - 0.3, { x: +v.x.toFixed(2) });
  const a = make('atv', { x: 25, z: -30, yaw: W });
  drive(a, { throttle: 1, steer: 0, hard: true }, 8);
  check('the ATV still cannot climb the access steps', a.x > 12.9, { x: +a.x.toFixed(2) });
  const s = make('sedan', { x: 25, z: -30, yaw: W });
  drive(s, { throttle: 1, steer: 0, hard: true }, 8);
  check('nor can a car', s.x > 12.9, { x: +s.x.toFixed(2) });
}

// --- the world extent and its soft edge
{
  const pts = { road: insideWorld(-18, 0), crossWest: insideWorld(-85, 79), backRow: insideWorld(-85, 40), north: insideWorld(-18, -600), beach: insideWorld(60, 500) };
  check('extent: Ocean Drive, the beach and the cross streets to x -90; not the back row', pts.road && pts.crossWest && !pts.backRow && !pts.north && pts.beach, pts);
  const b = extentBounds();
  check('extent bounds x -90..110, z ±560', b.x0 === -90 && b.x1 === 110 && b.z0 === -560 && b.z1 === 560, b);
  check('edge distance ~ metres to the boundary', Math.abs(edgeDistance(0, -550) - 10) < 1e-6 && edgeDistance(0, -570) < 0 && Math.abs(edgeDistance(-18, 0) - 9.8) < 1e-6, { d: edgeDistance(0, -550) });
  const r = edgeSteer(-18, -548, yawFor(10)), l = edgeSteer(-18, -548, yawFor(-10));
  check('edge steering bias turns a car heading out back in (the shorter way); none mid-road', r > 0.2 && l < -0.2 && edgeSteer(-18, 0, N) === 0 && edgeSteer(-18, -548, S) === 0, { right: +r.toFixed(3), left: +l.toFixed(3) });
  // (a car can't brake from speed in 25 m: the taper takes the edge off, the bound holds it)
  const edgeRun = (w) => {
    const v = make('hero', { x: -18, z: -420, yaw: N }, w);
    let near = 0, outside = false;
    drive(v, { throttle: 1, steer: 0, hard: true }, 20, w, (q) => {
      if (q.z < -548) near = Math.max(near, kmh(q));
      outside ||= q.edge < 0;
      return false;
    });
    return { z: +v.z.toFixed(2), near, outside };
  };
  const tapered = edgeRun(world), untapered = edgeRun({ ...world, softDistance: () => Infinity });
  check('the world edge tapers the speed and holds the car inside', !tapered.outside && tapered.z > -560 && tapered.near < untapered.near - 12, { tapered, untapered });
  const c = make('sedan', { x: -20, z: 79, yaw: W });
  drive(c, { throttle: 0.6, steer: 0 }, 12);
  check('a car drives down 8 ST to the back row and stops at x -90', c.x < -80 && c.x > -90, { x: +c.x.toFixed(2) });
}

const failed = results.filter((q) => !q.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
