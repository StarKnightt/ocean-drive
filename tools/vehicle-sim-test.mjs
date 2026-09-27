// Node-only checks of the vehicle physics (no browser): speeds per surface, the water
// limit, the ATV's beach-only bound, the seawall accesses and no tunnelling at speed.
// Usage: node tools/vehicle-sim-test.mjs
import { createVehicle, stepVehicle, buildGrid, ACCESS_ZS } from '../src/vehicles/sim.js';
import { groundHeight, SEA_LEVEL, PARK } from '../src/world/layout.js';
import { createSurf } from '../src/world/surf.js';

const surf = createSurf({ frozen: true });
// the seawall as beach.js builds it: solid except at the accesses, plus the cheek walls
const boxes = [];
const cuts = [-350, ...[...ACCESS_ZS].sort((a, b) => a - b).flatMap((a) => [a - 1.2, a + 1.2]), 350];
for (let i = 0; i < cuts.length; i += 2) boxes.push({ min: { x: PARK.wallX - 0.3, y: 0, z: cuts[i] }, max: { x: PARK.wallX + 0.4, y: 0.68, z: cuts[i + 1] } });
for (const a of ACCESS_ZS) for (const s of [-1, 1]) { const zc = a + s * 1.3; boxes.push({ min: { x: 10.75, y: 0, z: zc - 0.1 }, max: { x: 12.6, y: 0.78, z: zc + 0.1 } }); }
const thin = { min: { x: 60, y: -2, z: 99.95 }, max: { x: 70, y: 3, z: 100.05 } };   // a 10 cm wall across the sand
boxes.push(thin);
const world = {
  groundAt: groundHeight,
  waterDepthAt: (x, z) => surf.waterDepthAt(x, z),
  swashAt: (x, z) => surf.swashAt(x, z),
  bounds: { x0: -27.8, x1: 110, z0: -340, z1: 340 },
  grid: buildGrid(boxes, []),
  dynamic: () => [],
};
const yawFor = (heading) => -heading * Math.PI / 180;   // compass heading -> yaw
function run(kind, pose, input, seconds) {
  const v = createVehicle(kind, pose, world);
  v.parked = false; v.ridden = true;
  let maxV = 0, t = 0;
  const surfs = new Set();
  for (; t < seconds; t += 1 / 60) {
    stepVehicle(v, typeof input === 'function' ? input(v, t) : input, 1 / 60, world);
    maxV = Math.max(maxV, Math.abs(v.lon));
    surfs.add(v.surf.kind);
  }
  return { maxV: +maxV.toFixed(2), end: +Math.abs(v.lon).toFixed(2), x: +v.x.toFixed(2), z: +v.z.toFixed(2), surfs: [...surfs].join(',') };
}
const results = [];
const check = (name, ok, info) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(info)}`); };

// bike: promenade (x ~ promenade line), heading north
let r = run('bike', { x: 0.2, z: 120, yaw: yawFor(0) }, (v) => ({ throttle: 1, steer: Math.max(-1, Math.min(1, -(v.x - (PARK.promenadeX + 2.6 * Math.sin(v.z / 19) + 1.2 * Math.sin(v.z / 7.3))) * 0.8)), hard: true }), 10);
check('bike pavement top speed ~6 m/s (Shift)', r.maxV > 5.5 && r.maxV < 6.6, r);
r = run('bike', { x: -18, z: 200, yaw: yawFor(0) }, { throttle: 1, steer: 0 }, 10);
check('bike road cruise ~4.6 m/s', r.end > 4.2 && r.end < 5.0, r);
r = run('bike', { x: 30, z: 120, yaw: yawFor(0) }, { throttle: 1, steer: 0, hard: true }, 10);
check('bike dry soft sand ~3 m/s', r.maxV > 2.5 && r.maxV < 3.3, r);
r = run('bike', { x: 87, z: 120, yaw: yawFor(0) }, { throttle: 1, steer: 0, hard: true }, 10);
check('bike damp / wet sand faster than dry', r.maxV > 4.5, r);
r = run('bike', { x: 86, z: 60, yaw: yawFor(90) }, { throttle: 1, steer: 0, hard: true }, 20);
const bikeDepth = SEA_LEVEL - groundHeight(r.x + 0.7, r.z);
check('bike stops before 0.2 m of water', bikeDepth <= 0.2 + 0.03 && r.end < 0.8, { ...r, depthAhead: +bikeDepth.toFixed(3) });
// bike through the z = -30 access onto the sand; the wall stops it at z = -40
r = run('bike', { x: 8, z: -30, yaw: yawFor(90) }, { throttle: 1, steer: 0 }, 6);
check('bike rides down the seawall access onto the sand', r.x > 14, r);
r = run('bike', { x: 14.5, z: -30, yaw: yawFor(270) }, { throttle: 1, steer: 0 }, 6);
check('bike rides up the access from the sand into the park', r.x < 9, r);
r = run('bike', { x: 8, z: -40, yaw: yawFor(90) }, { throttle: 1, steer: 0, hard: true }, 5);
check('seawall blocks the bike away from an access', r.x < 11.8, r);
// hop
{
  const v = createVehicle('bike', { x: -18, z: 0, yaw: 0 }, world); v.parked = false;
  let top = 0;
  for (let i = 0; i < 90; i++) { stepVehicle(v, { throttle: 0.5, steer: 0, hop: i === 10 }, 1 / 60, world); top = Math.max(top, v.airY); }
  check('bike hop ~0.25 m', top > 0.2 && top < 0.35, { top: +top.toFixed(3) });
}
// steering and lean
{
  const v = createVehicle('bike', { x: -18, z: 250, yaw: 0 }, world); v.parked = false;
  for (let i = 0; i < 240; i++) stepVehicle(v, { throttle: 1, steer: i > 120 ? 1 : 0 }, 1 / 60, world);
  check('bike leans into a right turn', v.lean > 0.1 && v.yaw < -0.3, { lean: +v.lean.toFixed(3), yaw: +v.yaw.toFixed(3) });
}

// ATV
r = run('atv', { x: 87.5, z: -150, yaw: yawFor(180) }, { throttle: 1, steer: 0, hard: true }, 12);
check('ATV hard wet sand ~12 m/s (boost)', r.maxV > 11.3 && r.maxV < 13, r);
r = run('atv', { x: 87.5, z: -150, yaw: yawFor(180) }, { throttle: 1, steer: 0 }, 12);
check('ATV hard sand ~10 m/s', r.maxV > 9.2 && r.maxV < 10.6, r);
r = run('atv', { x: 30, z: -150, yaw: yawFor(180) }, { throttle: 1, steer: 0, hard: true }, 12);
check('ATV dry soft sand ~8 m/s (boost)', r.maxV > 7.4 && r.maxV < 8.8, r);
r = run('atv', { x: 25, z: 30, yaw: yawFor(270) }, { throttle: 1, steer: 0, hard: true }, 8);
check('ATV stays on the beach (x >= 12.9 + radius)', r.x > 13.3, r);
r = run('atv', { x: 25, z: -30, yaw: yawFor(270) }, { throttle: 1, steer: 0, hard: true }, 8);
check('ATV cannot climb the access steps', r.x > 13.3, r);
r = run('atv', { x: 84, z: 60, yaw: yawFor(90) }, { throttle: 1, steer: 0, hard: true }, 20);
const atvDepth = SEA_LEVEL - groundHeight(r.x + 1.1, r.z);
check('ATV splashes in but stops before 0.32 m', atvDepth < 0.36 && r.x > 91 && r.end < 1, { ...r, depthAhead: +atvDepth.toFixed(3) });
r = run('atv', { x: 65, z: 80, yaw: yawFor(180) }, { throttle: 1, steer: 0, hard: true }, 6);
check('ATV at speed does not tunnel through a 10 cm wall', r.z < 99.95 - 1.1, r);
r = run('atv', { x: 50, z: -335, yaw: yawFor(180) }, { throttle: 1, steer: 0, hard: true }, 95);
check('ATV runs the whole beach north -> south (z -335 -> 330)', r.z > 330 - 1, r);
{
  const v = createVehicle('atv', { x: 40, z: -100, yaw: yawFor(180) }, world); v.parked = false;
  let minP = 0, maxP = 0, maxR = 0;
  for (let i = 0; i < 600; i++) { stepVehicle(v, { throttle: 1, steer: 0.3 * Math.sin(i / 50) }, 1 / 60, world); minP = Math.min(minP, v.pitch); maxP = Math.max(maxP, v.pitch); maxR = Math.max(maxR, Math.abs(v.roll)); }
  check('ATV pitches / rolls over the sand mounds', maxP - minP > 0.01 && maxR > 0.005, { pitchRange: +(maxP - minP).toFixed(4), maxRoll: +maxR.toFixed(4), rpm: Math.round(v.rpm) });
}
const failed = results.filter((q) => !q.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
