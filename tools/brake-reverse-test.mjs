// Node-only checks of the brakes and the reverse gear on every drivable body (no browser):
// S brakes firmly from full speed, selects R once nearly stopped and backs up at ~20-25 km/h
// (the bike walks back), W while reversing brakes and then drives forward, a car sliding
// backwards after a spin brakes on S, the touch Brake (a pure brake) never reverses, and
// braking works on sand, grass, in the water, after a curb hit and in the soft world edge.
// Usage: node tools/brake-reverse-test.mjs
import { createVehicle, stepVehicle, buildGrid } from '../src/vehicles/sim.js';
import { OPEN_SPECS, SPECS } from '../src/vehicles/specs.js';
import { groundHeight } from '../src/world/layout.js';
import { createSurf } from '../src/world/surf.js';

const surf = createSurf({ frozen: true });
const world = {
  groundAt: groundHeight,
  waterDepthAt: (x, z) => surf.waterDepthAt(x, z),
  swashAt: (x, z) => surf.swashAt(x, z),
  grid: buildGrid([], []),
  dynamic: () => [],
};
const open = { ...world, edgeDistance: () => 1e9, softDistance: () => Infinity };
const flat = { groundAt: () => 0, waterDepthAt: () => 0, bounds: { x0: -1e4, x1: 1e4, z0: -1e4, z1: 1e4 }, grid: buildGrid([], []), dynamic: () => [], edgeDistance: () => 1e9, softDistance: () => Infinity };

const yawFor = (heading) => -heading * Math.PI / 180;
const N = yawFor(0), E = yawFor(90), S = yawFor(180);
const make = (spec, pose, w = flat) => { const v = createVehicle(spec, pose, w); v.parked = false; v.ridden = true; v.engineOn = true; return v; };
const setSpeed = (v, ms) => { v.vx = -Math.sin(v.yaw) * ms; v.vz = -Math.cos(v.yaw) * ms; v.lon = ms; };
// (on the road; the road-only ATV is kept to the beach: its packed wet sand)
const X0 = (spec) => (spec.xMin > 0 ? 87.5 : -18);
const drive = (v, input, seconds, w = flat, stop) => {
  let t = 0;
  for (; t < seconds; t += 1 / 60) {
    stepVehicle(v, typeof input === 'function' ? input(v, t) : input, 1 / 60, w);
    if (stop && stop(v, t)) break;
  }
  return t;
};
const along = (v, x0, z0) => (v.x - x0) * -Math.sin(v.yaw) + (v.z - z0) * -Math.cos(v.yaw);
const kmh = (ms) => +(ms * 3.6).toFixed(1);
// hold S from speed v0 until stopped: distance and time
function brakeRun(v, input, w = flat, max = 20) {
  const x0 = v.x, z0 = v.z;
  const t = drive(v, input, max, w, (q) => q.lon < 0.05);
  return { dist: +Math.hypot(v.x - x0, v.z - z0).toFixed(1), t: +t.toFixed(2) };
}
const results = [];
const check = (name, ok, info) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(info)}`); };

const BODIES = ['bike', 'atv', 'hero', 'classic', 'hatch', 'sedan', 'wagon', 'coupe', 'crossover', 'suv', 'pickup'];
const SPEC_SETS = [...BODIES.map((b) => [b, OPEN_SPECS[b]]), ['road-only car', SPECS.car], ['road-only atv', SPECS.atv], ['road-only bike', SPECS.bike]];
const brakeS = { throttle: -1, steer: 0 }, gas = { throttle: 1, steer: 0 };

for (const [name, spec] of SPEC_SETS) {
  const bike = spec.kind === 'bike', engine = spec.kind !== 'bike';
  // --- full speed, then S: a firm stop (mean deceleration)
  const v = make(spec, { x: X0(spec), z: 0, yaw: N });
  drive(v, { ...gas, hard: true }, bike ? 12 : 40);
  const v0 = v.lon;
  const b = brakeRun(v, brakeS);
  const decel = v0 * v0 / (2 * Math.max(b.dist, 0.01));
  const need = bike ? 3.5 : 6.5;
  check(`${name}: S from full speed (${kmh(v0)} km/h) stops firmly (>= ${need} m/s² mean)`, decel >= need && b.t < v0 / need + 0.5, { ...b, decel: +decel.toFixed(2) });
  // --- keep holding S: R, backing up at the reverse top speed
  drive(v, brakeS, 0.3);
  const engaged = v.reverse;
  drive(v, brakeS, 7);
  const rev = kmh(-v.lon);
  const [lo, hi] = bike ? [1, 5] : [19, 25.5];
  check(`${name}: holding S selects R and backs up at ${lo}-${hi} km/h`, engaged && v.reverse && rev >= lo && rev <= hi && v.braking === 0, { rev, gear: v.gear });
  if (engine) check(`${name}: the revs rise in reverse (the engine pulls)`, v.drive > 0.9 && v.rpm > (spec.idle ?? 0) + 300, { rpm: Math.round(v.rpm), idle: spec.idle });
  // --- W while reversing: brakes, then drives forward out of R
  const vr = -v.lon, x1 = v.x, z1 = v.z;
  const t = drive(v, gas, 5, flat, (q) => q.lon > -0.05);
  const d = Math.hypot(v.x - x1, v.z - z1);
  const braked = vr * vr / (2 * Math.max(d, 0.01)) >= need * 0.9;
  drive(v, gas, 2.5);
  check(`${name}: W while reversing brakes, then drives forward`, braked && !v.reverse && v.lon > (bike ? 1 : 3), { stopT: +t.toFixed(2), stopDist: +d.toFixed(2), fwdKmh: kmh(v.lon), reverse: v.reverse });
  if (bike) continue;
  // --- a car sliding backwards (spun round), not in R: S is the brake, not a feeble reverse pull
  const s = make(spec, { x: X0(spec), z: 0, yaw: N });
  setSpeed(s, -40 / 3.6);
  // (down to the speed where S then selects R and keeps backing up)
  const st = drive(s, brakeS, 5, flat, (q) => q.lon > -0.6);
  check(`${name}: sliding backwards at 40 km/h after a spin, S brakes it (< 2.2 s)`, st < 2.2 && s.braking > 0.9, { t: +st.toFixed(2) });
  // --- the touch Brake (a pure brake input): stops, never reverses
  if (spec.kind === 'car') {
    const q = make(spec, { x: X0(spec), z: 0, yaw: N });
    setSpeed(q, 50 / 3.6);
    const r = brakeRun(q, { throttle: 0, steer: 0, brake: 1, handbrake: true });
    let minLon = 0;
    drive(q, { throttle: 0, steer: 0, brake: 1, handbrake: true }, 2, flat, (p) => { minLon = Math.min(minLon, p.lon); return false; });
    check(`${name}: touch Brake (footbrake + handbrake) stops from 50 km/h in < 16 m and stays put`, r.dist < 16 && minLon > -0.05 && !q.reverse, { ...r, minLon: +minLon.toFixed(3) });
  }
}

// --- braking on the real ground: sand, grass, water, after a curb hit, in the soft world edge
const water = (() => { for (let x = 80; x < 110; x += 0.25) if (surf.waterDepthAt(x, 60) > 0.12) return x; return null; })();
for (const body of ['sedan', 'pickup', 'hero', 'atv', 'bike']) {
  const spec = OPEN_SPECS[body], bike = body === 'bike';
  const v0 = bike ? 4 : 30 / 3.6;
  const need = bike ? 3 : 5.5;
  for (const [where, pose] of [['dry sand', { x: 40, z: -150, yaw: S }], ['grass', { x: -7.5, z: 200, yaw: N }], ['water', { x: water, z: 40, yaw: N }]]) {
    const v = make(spec, pose, open);
    setSpeed(v, v0);
    stepVehicle(v, { throttle: 0, steer: 0 }, 1 / 60, open);
    const surfKind = v.surf.kind;
    const r = brakeRun(v, brakeS, open);
    const decel = v0 * v0 / (2 * Math.max(r.dist, 0.01));
    const sink = v.sink ? +Math.max(...v.sink).toFixed(3) : 0;
    check(`${body}: brakes on ${where} (${surfKind}) from ${kmh(v0)} km/h`, decel >= need && sink < 0.03 && (where !== 'water' || surfKind === 'water'), { ...r, decel: +decel.toFixed(2), sink });
  }
}
{
  // curb: the park-side curb (x -14.5) hit at 50 km/h, then S
  for (const body of ['sedan', 'hero', 'pickup']) {
    const v = make(OPEN_SPECS[body], { x: -20.5, z: 200, yaw: E }, open);
    setSpeed(v, 50 / 3.6);
    drive(v, { throttle: 0, steer: 0 }, 3, open, (q) => q.curb > 0);
    const vc = v.lon;
    const r = brakeRun(v, brakeS, open);
    const decel = vc * vc / (2 * Math.max(r.dist, 0.01));
    check(`${body}: brakes straight after hitting the curb at 50 km/h`, decel > 5.5 && r.t < 3, { kmhAfterCurb: kmh(vc), ...r, decel: +decel.toFixed(2) });
  }
}
{
  // the soft world edge (north end of Ocean Drive): brakes and reverses back inside
  for (const body of ['sedan', 'hero', 'atv']) {
    const v = make(OPEN_SPECS[body], { x: -18, z: -520, yaw: N }, world);
    drive(v, gas, 10, world, (q) => q.z < -545);
    const ve = v.lon, edgeK = v._edgeK;
    const r = brakeRun(v, brakeS, world);
    const z0 = v.z;
    drive(v, brakeS, 5, world);
    const back = v.z - z0;
    check(`${body}: in the soft edge band it brakes and backs out in R`, edgeK < 1 && r.t < ve / 5 + 0.5 && v.reverse && back > 8 && v.edge > 0, { kmhAtEdge: kmh(ve), edgeK: +edgeK.toFixed(2), ...r, backedUp: +back.toFixed(1) });
  }
}
{
  // dry sand: the sedan reverses out (reverse doesn't spin the wheels into it) and braking doesn't dig
  const v = make(OPEN_SPECS.sedan, { x: 40, z: -150, yaw: S }, open);
  const x0 = v.x, z0 = v.z;
  drive(v, brakeS, 5, open);
  check('sedan reverses across dry sand without bogging', v.reverse && -along(v, x0, z0) > 8 && !v.bogged, { back: +(-along(v, x0, z0)).toFixed(1), kmh: kmh(v.lon), sink: +Math.max(...v.sink).toFixed(3) });
  // a car left in R rolls forward on W only after W has brought it to a stop
  const q = make(OPEN_SPECS.sedan, { x: -18, z: 0, yaw: N });
  drive(q, brakeS, 4);
  drive(q, { throttle: 0, steer: 0 }, 1);
  const still = q.reverse;
  drive(q, gas, 4);
  check('R stays selected on coasting, W brakes out of it and drives off', still && !q.reverse && q.lon > 5, { kmh: kmh(q.lon) });
  // engine not yet caught (cranking): S still brakes
  const c = make(OPEN_SPECS.hero, { x: -18, z: 0, yaw: N });
  c.engineOn = false;
  setSpeed(c, 40 / 3.6);
  const r = brakeRun(c, brakeS);
  check('engine off (cranking / stalled): S still brakes', r.dist < 12, r);
}

const failed = results.filter((q) => !q.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
