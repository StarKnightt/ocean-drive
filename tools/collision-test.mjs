// Node-only checks of the open-world collision contacts (sim.js contact() and the impulse
// response in substepOpen): head-on versus glancing hits (a yaw kick, never an energy gain),
// no tunnelling at 54 m/s at 20 fps, people as hard blockers that are never entered, the
// 12 m moving-collider prefilter and the grid's disabled flag. Open vehicles are built
// explicitly, so OPEN_WORLD (default off) is not needed.
// Usage: node tools/collision-test.mjs
import { createVehicle, stepVehicle, buildGrid, contact, isPersonCircle, DYN_RADIUS } from '../src/vehicles/sim.js';
import { OPEN_SPECS } from '../src/vehicles/specs.js';
import { groundHeight, PARK } from '../src/world/layout.js';

const yawFor = (heading) => -heading * Math.PI / 180;
const E = yawFor(90), N = yawFor(0), S = yawFor(180);
// flat, unbounded test ground (road surface: x -18)
const flatWorld = (boxes = [], circles = [], dyn = []) => ({ groundAt: () => 0, grid: buildGrid(boxes, circles), dynamic: () => dyn, edgeDistance: () => 1e9 });
const make = (body, pose, w) => { const v = createVehicle(OPEN_SPECS[body], pose, w); v.parked = false; v.ridden = true; v.engineOn = true; return v; };
const launch = (v, speed) => { v.vx = -Math.sin(v.yaw) * speed; v.vz = -Math.cos(v.yaw) * speed; v.lon = speed; };
const energy = (v) => 0.5 * v.spec._m * (v.vx * v.vx + v.vz * v.vz) + 0.5 * v.spec._I * (v.yawV ?? 0) ** 2;
const results = [];
const check = (name, ok, info) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(info)}`); };

// a wall across the road at z = -30 (the car heads north, -z)
const wall = { min: { x: -40, y: 0, z: -31 }, max: { x: 10, y: 2, z: -30 } };

// --- head-on: stops and rebounds a little, no spin, no energy gain
{
  const w = flatWorld([wall]);
  const v = make('sedan', { x: -18, z: 0, yaw: N }, w);
  launch(v, 10);
  const e0 = energy(v);
  let hit = null;
  for (let t = 0; t < 4; t += 1 / 60) { stepVehicle(v, { throttle: 0, steer: 0 }, 1 / 60, w); hit ??= v.hit; }
  check('head-on: the car stops at the wall and does not spin', v.z - 2.4 > -30 - 0.05 && Math.abs(v.yaw) < 0.03 && Math.abs(v.lon) < 1.5 && hit?.material === 'wall' && hit.speed > 6, { z: +v.z.toFixed(2), yaw: +v.yaw.toFixed(3), lon: +v.lon.toFixed(2), hit: hit && { speed: +hit.speed.toFixed(2), material: hit.material } });
  check('head-on: no energy gain', energy(v) <= e0, { e0: Math.round(e0), e1: Math.round(energy(v)) });
}
// --- glancing (25 deg into a wall along the road side): a yaw kick, keeps most of its speed
{
  const side = { min: { x: -14, y: 0, z: -400 }, max: { x: -13, y: 2, z: 400 } };
  const w = flatWorld([side]);
  const v = make('sedan', { x: -18, z: 0, yaw: yawFor(25) }, w);
  launch(v, 15);
  const e0 = energy(v);
  let spin = 0, hit = null, emax = e0;
  for (let t = 0; t < 1.5; t += 1 / 60) {
    const eb = energy(v);
    stepVehicle(v, { throttle: 0, steer: 0 }, 1 / 60, w);
    if (v.hit) { hit ??= v.hit; emax = Math.max(emax, energy(v) - eb + e0); }
    spin = Math.max(spin, Math.abs(v.yawV));
  }
  const heading = -v.yaw * 180 / Math.PI;
  check('glancing: a yaw kick turns the car along the wall', spin > 0.3 && heading < 20 && hit?.material === 'wall', { spin: +spin.toFixed(3), headingDeg: +heading.toFixed(1), hitSpeed: +hit?.speed.toFixed(2), tangent: +hit?.tangent.toFixed(2) });
  check('glancing: keeps most of its speed (a scrape, not a stop)', Math.hypot(v.vx, v.vz) > 15 * 0.55 && v.x < -13 - 0.9, { speed: +Math.hypot(v.vx, v.vz).toFixed(2), x: +v.x.toFixed(2) });
  check('glancing: no energy gain in any contact frame', emax <= e0 + 1e-6, { e0: Math.round(e0), worst: Math.round(emax) });
}
// --- randomised impacts on walls, posts and cars: no contact frame ever adds energy
{
  let rnd = 12345;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  let worst = 0, hits = 0;
  for (let k = 0; k < 300; k++) {
    const post = { x: -18 + (rand() - 0.5) * 3, z: -20, r: 0.1 + rand() * 0.4 };
    const car = { x: -18 + (rand() - 0.5) * 3, z: -20, r: 0.95, owner: null };
    const kind = k % 3;
    const w = flatWorld(kind === 0 ? [wall] : [], kind === 1 ? [post] : [], kind === 2 ? [car] : []);
    const v = make(['sedan', 'hatch', 'pickup', 'coupe', 'hero'][k % 5], { x: -18 + (rand() - 0.5) * 2, z: 0, yaw: (rand() - 0.5) * 1.2 }, w);
    launch(v, 3 + rand() * 25);
    for (let t = 0; t < 2; t += 1 / 60) {
      const eb = energy(v);
      stepVehicle(v, { throttle: 0, steer: 0 }, 1 / 60, w);
      if (v.hit) { hits++; worst = Math.max(worst, (energy(v) - eb) / Math.max(1, eb)); }
    }
  }
  check('300 random impacts (walls, posts, cars): never an energy gain', worst <= 1e-9 && hits > 200, { hits, worstGain: worst });
}

// --- no tunnelling at 54 m/s, dt = 1/20
{
  const lamp = { x: -18, z: -40, r: 0.14 }, palm = { x: -18, z: -40, r: 0.25 };
  const parked = { min: { x: -19, y: 0, z: -42.4 }, max: { x: -17, y: 1.4, z: -37.6 } };
  const thin = { min: { x: -30, y: 0, z: -40.05 }, max: { x: -5, y: 2, z: -39.95 } };
  const cheek = { min: { x: -18.1, y: 0, z: -41 }, max: { x: -17.9, y: 0.9, z: -39 } };   // 0.2 m end-on
  for (const [name, boxes, circles] of [['lamp post', [], [lamp]], ['palm', [], [palm]], ['parked car', [parked], []], ['10 cm wall', [thin], []], ['cheek wall end-on', [cheek], []]]) {
    const w = flatWorld(boxes, circles);
    for (const body of ['sedan', 'coupe', 'pickup']) {
      const v = make(body, { x: -18, z: 20, yaw: N }, w);
      launch(v, 54);
      let through = false;
      for (let t = 0; t < 3; t += 1 / 20) {
        stepVehicle(v, { throttle: 1, steer: 0, hard: true }, 1 / 20, w);
        if (v.z < -40) through = true;
      }
      check(`no tunnelling at 54 m/s, 20 fps: ${body} into a ${name}`, !through, { z: +v.z.toFixed(2) });
    }
  }
  // the seawall (the real terrain, the park side) at 54 m/s heading east away from an access
  const sea = { min: { x: PARK.wallX - 0.3, y: 0, z: -60 }, max: { x: PARK.wallX + 0.4, y: 0.68, z: -20 } };
  const w = { groundAt: groundHeight, grid: buildGrid([sea], []), dynamic: () => [], edgeDistance: () => 1e9 };
  const v = make('sedan', { x: -5, z: -40, yaw: E }, w);
  launch(v, 54);
  let maxX = -Infinity;
  for (let t = 0; t < 2; t += 1 / 20) { stepVehicle(v, { throttle: 1, steer: 0, hard: true }, 1 / 20, w); maxX = Math.max(maxX, v.x); }
  check('no tunnelling at 54 m/s, 20 fps: sedan into the seawall', maxX + 2.4 < PARK.wallX - 0.3 + 0.1, { maxX: +maxX.toFixed(2) });
  // the speed is capped rather than the step lengthened at low frame rates
  const f = make('sedan', { x: -18, z: 0, yaw: N }, flatWorld());
  launch(f, 54);
  stepVehicle(f, { throttle: 0, steer: 0 }, 1 / 20, flatWorld());
  check('at 20 fps the step is capped at 0.15 m (16 substeps)', Math.abs(f.lon) <= 0.15 * 16 * 20 + 1e-6, { lon: +f.lon.toFixed(2) });
}

// --- parked row: the open sedan swerving into it at 15-70 km/h never ends up inside
{
  const row = [];
  for (let k = 0; k < 8; k++) row.push({ min: { x: -23.75, y: 0, z: -140 + k * 6.2 }, max: { x: -21.75, y: 1.4, z: -140 + k * 6.2 + 4.8 } });
  const w = flatWorld(row);
  let worst = 0, n = 0;
  for (const steer of [-1, -0.6, -0.3]) for (const kmh of [15, 40, 70]) for (const z0 of [-170, -160, -152]) {
    const q = make('sedan', { x: -18.5, z: z0, yaw: S }, w);
    launch(q, kmh / 3.6);
    for (let t = 0; t < 4; t += 1 / 60) {
      stepVehicle(q, { throttle: 1, steer: t < 1.2 ? -steer : 0, hard: true }, 1 / 60, w);
      const s = Math.sin(q.yaw), c = Math.cos(q.yaw);
      for (const [lx, lz] of [[-0.8, -2.3], [0.8, -2.3], [-0.8, 2.3], [0.8, 2.3], [-0.9, -2.0], [0.9, -2.0], [-0.9, 2.0], [0.9, 2.0], [-0.9, 0], [0.9, 0]]) {
        const px = q.x + lx * c + lz * s, pz = q.z - lx * s + lz * c;
        for (const b of row) {
          const d = Math.min(px - b.min.x, b.max.x - px, pz - b.min.z, b.max.z - pz);
          if (d > 0) worst = Math.max(worst, d);
        }
      }
    }
    n++;
  }
  check('open sedan never ends up inside a parked car (swerves at 15-70 km/h)', worst < 0.1, { runs: n, deepestM: +worst.toFixed(3) });
}

// --- traffic car (a moving circle): an impulse, tagged 'car'
{
  const tc = { x: -18, z: -15, r: 0.95, owner: null };
  const w = flatWorld([], [], [tc]);
  const v = make('sedan', { x: -18, z: 0, yaw: N }, w);
  launch(v, 8);
  let hit = null;
  for (let t = 0; t < 2; t += 1 / 60) { stepVehicle(v, { throttle: 0, steer: 0 }, 1 / 60, w); hit ??= v.hit; }
  check('car into a traffic car: bounces off, hit tagged car', hit?.material === 'car' && v.z - 2.4 > -15 + 0.95 - 0.05, { z: +v.z.toFixed(2), hit: hit && hit.material });
}

// --- people: hard blockers, never entered, never impulse targets (500 randomised runs)
{
  let rnd = 777;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  let worst = 0, stops = 0, impulses = 0;
  for (let k = 0; k < 500; k++) {
    const people = [];
    for (let i = 0; i < 8; i++) people.push({ x: -18 + (rand() - 0.5) * 8, z: -8 - rand() * 30, r: 0.3 + rand() * 0.1 });
    const w = flatWorld([], [], people);
    const v = make(['sedan', 'pickup', 'hero'][k % 3], { x: -18, z: 0, yaw: (rand() - 0.5) * 0.8 }, w);
    launch(v, rand() * 15);
    const steer = (rand() - 0.5) * 2, thr = 0.3 + rand() * 0.7;
    for (let t = 0; t < 3; t += 1 / 60) {
      stepVehicle(v, { throttle: thr, steer: Math.sin(t * 2 + k) * steer, hard: rand() > 0.5 }, 1 / 60, w);
      if (v.hit) impulses++;
      for (const o of v.circlesWorld) for (const p of people) {
        const pen = o.r + p.r - Math.hypot(o.x - p.x, o.z - p.z);
        if (pen > worst) worst = pen;
      }
    }
    if (Math.abs(v.lon) < 0.5) stops++;
  }
  check('500 random runs: a car is never inside a person circle; people take no impulses', worst <= 0.005 && impulses === 0 && isPersonCircle({ x: 0, z: 0, r: 0.35 }) && !isPersonCircle({ x: 0, z: 0, r: 0.95 }), { deepestM: +worst.toFixed(4), impulses, stoppedRuns: stops });
}

// --- the prefilter: 2000 far moving circles change nothing and are not scanned per substep
{
  const near = { x: -18, z: -15, r: 0.95 };
  const far = [];
  for (let i = 0; i < 2000; i++) far.push({ x: -18 + (i % 40) * 3, z: 200 + Math.floor(i / 40) * 3, r: 0.4 });
  let calls = 0;
  const wA = flatWorld([], [], [near]);
  const wB = { ...flatWorld([], [], []), dynamic: () => { calls++; return [near, ...far]; } };
  const a = make('sedan', { x: -18, z: 0, yaw: N }, wA), b = make('sedan', { x: -18, z: 0, yaw: N }, wB);
  launch(a, 12); launch(b, 12);
  const t0 = performance.now();
  for (let i = 0; i < 180; i++) { stepVehicle(a, { throttle: 0.5, steer: 0.2 }, 1 / 60, wA); stepVehicle(b, { throttle: 0.5, steer: 0.2 }, 1 / 60, wB); }
  const ms = performance.now() - t0;
  check(`prefilter (${DYN_RADIUS} m): far circles change nothing; dynamic() read once per frame`, a.x === b.x && a.z === b.z && a.yaw === b.yaw && calls === 180, { calls, x: +b.x.toFixed(3), msFor360Steps: +ms.toFixed(1) });
}
// --- the grid's disabled flag (a parked car driven off)
{
  const box = { min: { x: -19, y: 0, z: -12.4 }, max: { x: -17, y: 1.4, z: -7.6 } };
  const w = flatWorld([box]);
  const v = make('sedan', { x: -18, z: 0, yaw: N }, w);
  const blocked = !!contact(v, -18, -8, N, w);
  box.disabled = true;
  const freed = !contact(v, -18, -8, N, w);
  check('a disabled collider no longer blocks', blocked && freed, { blocked, freed });
}

const failed = results.filter((q) => !q.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
