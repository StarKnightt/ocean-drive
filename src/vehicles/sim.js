// Vehicle physics shared by the beach cruiser and the lifeguard ATV. Pure maths (no three,
// no DOM) so it runs in Node tests: a kinematic bicycle model with tyre slip, per-surface
// speed caps and rolling resistance, sub-stepped circle-vs-box / circle-vs-circle
// collisions, wheel contact heights driving pitch / roll / a sprung body, and a hop.
//
// Conventions (same as the walker): +x east, -z north; yaw 0 faces north, forward is
// (-sin yaw, -cos yaw), right is (cos yaw, -sin yaw). Model local: forward = -z, right = +x.
import { SEA_LEVEL, PARK, SAND, WET_LINE_X, groundHeight, sandHeight } from '../world/layout.js';

const G = 9.8;
// seawall accesses (beach.js ACCESS_Z + MORE_ACCESS_Z) and their step profile
export const ACCESS_ZS = [-30, 32, -322, -245, -134, 134, 245, 322];
const ACCESS_HALF = 1.2;
const STEPS = [[10.8, 11.1, 0.33], [11.1, 11.4, 0.5], [11.4, 12.55, 0.7]];
export const nearAccess = (z, pad = 0) => ACCESS_ZS.some((a) => Math.abs(z - a) < ACCESS_HALF + pad);
export const promenadeX = (z) => PARK.promenadeX + 2.6 * Math.sin(z / 19) + 1.2 * Math.sin(z / 7.3);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const SPECS = {
  bike: {
    kind: 'bike',
    wheelbase: 1.22, wheelR: 0.335,
    wheels: [[0, -0.7], [0, 0.52]],                // local x, z: front, rear
    circles: [[-0.48, 0.3], [0.32, 0.3]],          // local z, radius
    maxStep: 0.17, accessStep: 0.23, maxDepth: 0.2, xMin: -Infinity,
    // [hard, harder (Shift)] top speeds, m/s
    vmax: { pavement: [4.6, 6.2], grass: [3.2, 4.2], wetsand: [4.3, 5.7], sand: [2.2, 3.0] },
    roll: { pavement: 0.12, grass: 0.5, wetsand: 0.35, sand: 1.4 },
    accel: 1.7, accelHard: 2.4, brake: 4.5, revAccel: 1.2, revMax: 0.9, engineBrake: 0,
    steerMax: 0.62, steerV: 3.2, steerRate: 7, grip: { hard: 16, soft: 10 },
    waterK: 0.22, eye: [0, 1.62, 0.26],
  },
  atv: {
    kind: 'atv',
    wheelbase: 1.25, track: 0.97, wheelR: 0.31,
    wheels: [[-0.485, -0.625], [0.485, -0.625], [-0.485, 0.625], [0.485, 0.625]],   // FL FR RL RR
    circles: [[-0.62, 0.6], [0.05, 0.6], [0.6, 0.6]],
    maxStep: 0.3, accessStep: 0.3, maxDepth: 0.32, xMin: 12.9,
    vmax: { pavement: [10, 12.5], grass: [8, 10], wetsand: [10, 12.5], sand: [6.5, 8.3] },
    roll: { pavement: 0.3, grass: 0.8, wetsand: 0.55, sand: 1.2 },
    accel: 4.2, accelHard: 5.6, brake: 7, revAccel: 2.5, revMax: 3.2, engineBrake: 0.9,
    steerMax: 0.6, steerV: 5, steerRate: 6, grip: { hard: 9, soft: 5 },
    waterK: 0.45, eye: [0, 1.6, 0.3],
    rideH: 0, idle: 1450, redline: 7600,
  },
};

// Ground the vehicle's wheels roll on: the seawall access steps for the bike, else the
// ground (no tower decks or stairs).
export function rideGround(kind, x, z, groundAt = groundHeight) {
  if (kind === 'bike' && x >= STEPS[0][0] && x < STEPS[2][1] && nearAccess(z)) return STEPS.find((q) => x < q[1])[2];
  return groundAt(x, z);
}

// Surface under (x, z): kind + softness 0..1 + water depth (dynamic swash if available)
export function surfaceAt(x, z, world, out = {}) {
  out.depth = 0; out.soft = 0; out.covered = false;
  if (x < PARK.x0) out.kind = 'pavement';
  else if (x < SAND.x0 + 0.55) out.kind = Math.abs(x - promenadeX(z)) < 2.2 || x > PARK.x1 - 1.2 ? 'pavement' : 'grass';
  else {
    const d = world.waterDepthAt ? world.waterDepthAt(x, z) : Math.max(0, SEA_LEVEL - world.groundAt(x, z));
    out.depth = d;
    if (d > 0.015) { out.kind = 'water'; out.soft = 0.2; }
    else {
      // dry sand is soft; the damp band hardens toward the wet sand the swash packs down
      out.soft = 1 - smooth(WET_LINE_X - 14, WET_LINE_X - 3, x);
      out.covered = !!(world.swashAt && world.swashAt(x, z).covered);
      if (out.covered) out.soft = 0;
      out.kind = out.soft > 0.5 ? 'sand' : 'wetsand';
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// static collider grid (boxes + circles), 4 m cells

export function buildGrid(boxes, circles, cell = 4) {
  const map = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  const add = (item, x0, z0, x1, z1) => {
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
      const k = key(i, j);
      let a = map.get(k);
      if (!a) map.set(k, (a = []));
      a.push(item);
    }
  };
  for (const b of boxes) if (b.max.x - b.min.x < 400 && b.max.z - b.min.z < 900) add(b, b.min.x, b.min.z, b.max.x, b.max.z);
  for (const c of circles) add(c, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r);
  let stamp = 0;
  const seen = new WeakMap();
  return {
    query(x0, z0, x1, z1, fn) {
      stamp++;
      for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
        const a = map.get(key(i, j));
        if (!a) continue;
        for (const it of a) {
          if (seen.get(it) === stamp) continue;
          seen.set(it, stamp);
          if (fn(it)) return true;
        }
      }
      return false;
    },
  };
}

// ---------------------------------------------------------------------------

export function createVehicle(kind, { x, z, yaw = 0 }, world) {
  const spec = SPECS[kind];
  const v = {
    kind, spec, x, z, yaw,
    vx: 0, vz: 0, lon: 0, steer: 0, lean: 0, leanV: 0,
    wheelH: spec.wheels.map(() => 0), groundY: 0,
    bodyY: 0, bodyV: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0, pitchT: 0, rollT: 0,
    airY: 0, vyAir: 0, grounded: true,
    crank: 0, wheelRot: 0, pedal: 0, rpm: spec.idle ?? 0, throttle: 0, load: 0,
    boostT: 0, bump: 0, land: 0, t: 0, parked: true, ridden: false,
    surf: { kind: 'pavement', soft: 0, depth: 0 },
    wheelDepth: spec.wheels.map(() => 0),
    circlesWorld: spec.circles.map(([, r]) => ({ x, z, r, owner: null })),
  };
  for (const c of v.circlesWorld) c.owner = v;
  settle(v, world);
  return v;
}

function wheelPoint(v, i, x = v.x, z = v.z, yaw = v.yaw) {
  const [lx, lz] = v.spec.wheels[i];
  const s = Math.sin(yaw), c = Math.cos(yaw);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}
function wheelHeights(v, world, x, z, yaw, out) {
  for (let i = 0; i < v.spec.wheels.length; i++) {
    const [px, pz] = wheelPoint(v, i, x, z, yaw);
    out[i] = rideGround(v.kind, px, pz, world.groundAt);
  }
  return out;
}

// drop the vehicle onto the ground at its pose (no bounce)
export function settle(v, world) {
  wheelHeights(v, world, v.x, v.z, v.yaw, v.wheelH);
  targets(v);
  v.bodyY = v.baseT; v.bodyV = 0; v.pitch = v.pitchT; v.pitchV = 0; v.roll = v.rollT; v.rollV = 0;
  v.groundY = v.baseT;
  syncCircles(v);
}
function targets(v) {
  const h = v.wheelH, S = v.spec;
  if (v.kind === 'bike') {
    v.baseT = (h[0] + h[1]) / 2;
    v.pitchT = Math.atan2(h[0] - h[1], S.wheelbase);
    v.rollT = 0;
  } else {
    v.baseT = (h[0] + h[1] + h[2] + h[3]) / 4;
    v.pitchT = Math.atan2((h[0] + h[1]) - (h[2] + h[3]), 2 * S.wheelbase);
    v.rollT = Math.atan2((h[1] + h[3]) - (h[0] + h[2]), 2 * S.track);
  }
}
export function syncCircles(v) {
  const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
  v.spec.circles.forEach(([lz], i) => { const o = v.circlesWorld[i]; o.x = v.x + lz * s; o.z = v.z + lz * c; });
}

const _h = [0, 0, 0, 0];
// world: { groundAt, waterDepthAt?, swashAt?, bounds, grid, dynamic: () => circles[] }
export function blockedAt(v, x, z, yaw, world, airY = 0) {
  const S = v.spec, B = world.bounds;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  // wheels: steps up and deep water
  wheelHeights(v, world, x, z, yaw, _h);
  for (let i = 0; i < S.wheels.length; i++) {
    const [px, pz] = wheelPoint(v, i, x, z, yaw);
    const lim = (v.kind === 'bike' && nearAccess(pz, 0.3) && px > 10 && px < 13 ? S.accessStep : S.maxStep) + airY;
    if (_h[i] - v.wheelH[i] > lim) return 'step';
    if (SEA_LEVEL - _h[i] > S.maxDepth && _h[i] < v.wheelH[i]) return 'deep';   // (heading back out is fine)
  }
  const gy = v.groundY;
  for (const [lz, r] of S.circles) {
    const cx = x + lz * s, cz = z + lz * c;
    if (cx - r < Math.max(B.x0, S.xMin) || cx + r > B.x1 || cz - r < B.z0 || cz + r > B.z1) return 'bounds';
    const hit = world.grid.query(cx - r, cz - r, cx + r, cz + r, (q) => {
      if (q.min) {
        if (q.max.y < gy + 0.12 + airY || q.min.y > gy + 1.3) return false;
        const qx = clamp(cx, q.min.x, q.max.x), qz = clamp(cz, q.min.z, q.max.z);
        return (cx - qx) ** 2 + (cz - qz) ** 2 < r * r;
      }
      const rr = r + q.r;
      return (cx - q.x) ** 2 + (cz - q.z) ** 2 < rr * rr;
    });
    if (hit) return 'wall';
    for (const q of world.dynamic()) {
      if (q.owner === v || !(q.r > 0)) continue;
      const rr = r + q.r;
      if ((cx - q.x) ** 2 + (cz - q.z) ** 2 < rr * rr) return 'wall';
    }
  }
  return null;
}

// input: { throttle -1..1, steer -1..1 (+ = right), hard (Shift / boost), hop (edge) }
export function stepVehicle(v, input, dt, world) {
  dt = Math.min(dt, 0.05);
  if (!(dt > 0)) return v;
  const S = v.spec;
  v.bump = 0; v.land = 0;
  v.t += dt;
  const c = Math.hypot(v.x - (v._sx ?? 1e9), v.z - (v._sz ?? 1e9));
  if (c > 0.25 || v._sf === undefined || ++v._sf > 3) { surfaceAt(v.x, v.z, world, v.surf); v._sx = v.x; v._sz = v.z; v._sf = 0; }
  if (input.hop && v.kind === 'atv') v.boostT = 1.3;
  v.boostT = Math.max(0, v.boostT - dt);
  const hard = !!input.hard || v.boostT > 0;
  // hop (bike): ballistic lift; ledges up to the hop height can be cleared
  if (v.kind === 'bike') {
    if (input.hop && v.grounded && v.airY <= 0) { v.vyAir = 2.3; v.grounded = false; }
    if (v.airY > 0 || v.vyAir > 0) {
      v.vyAir -= G * dt;
      v.airY += v.vyAir * dt;
      if (v.airY <= 0) { v.land = -v.vyAir; v.airY = 0; v.vyAir = 0; v.grounded = true; v.bodyV -= v.land * 0.25; }
    }
  }
  if (v.parked) { v.vx = v.vz = 0; input = { throttle: 0, steer: 0 }; }
  const speed = Math.hypot(v.vx, v.vz);
  const n = clamp(Math.ceil(Math.max(speed, 0.5) * dt / 0.08), 1, 12);
  const h = dt / n;
  for (let i = 0; i < n; i++) substep(v, input, h, world, hard);
  v.throttle = input.throttle;
  post(v, input, dt, world, hard);
  return v;
}

function vmaxFor(v, hard) {
  const S = v.spec, su = v.surf, k = hard ? 1 : 0;
  let vm;
  if (su.kind === 'water') vm = S.vmax.wetsand[k] * clamp(1 - su.depth / S.waterK, 0.08, 1);
  else if (su.kind === 'sand' || su.kind === 'wetsand') vm = lerp(S.vmax.wetsand[k], S.vmax.sand[k], su.soft);
  else vm = S.vmax[su.kind][k];
  return vm;
}
function rollFor(v) {
  const S = v.spec, su = v.surf;
  if (su.kind === 'water') return S.roll.wetsand + 3 * su.depth;
  if (su.kind === 'sand' || su.kind === 'wetsand') return lerp(S.roll.wetsand, S.roll.sand, su.soft);
  return S.roll[su.kind];
}

function substep(v, input, h, world, hard) {
  const S = v.spec;
  const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
  const fx = -sy, fz = -cy, rx = cy, rz = -sy;
  let lon = v.vx * fx + v.vz * fz, lat = v.vx * rx + v.vz * rz;
  const vmax = vmaxFor(v, hard);
  const thr = input.throttle;
  let a = 0;
  if (thr > 0.05) {
    if (lon < -0.3) a = S.brake * thr;
    else {
      // drive force tapers to zero at the surface's top speed (resistance included)
      const q = lon / (vmax * Math.max(0.35, thr));
      a = (hard ? S.accelHard : S.accel) * thr * clamp(1 - q * q * Math.abs(q), -2, 1);
    }
  } else if (thr < -0.05) {
    if (lon > 0.3) a = -S.brake * -thr;
    else a = -S.revAccel * -thr * clamp(1 + lon / S.revMax, -2, 1);
  }
  // gravity along the slope between the wheels (the access steps count as a ramp)
  a -= G * clamp(Math.sin(v.pitchT), -0.1, 0.1) * 0.8;
  lon += a * h;
  const driving = (thr > 0.05 && lon > 0.3) || (thr < -0.05 && lon < -0.3);
  const res = (driving ? 0 : rollFor(v) + (Math.abs(thr) < 0.05 ? S.engineBrake : 0)) * h;
  lon = Math.sign(lon) * Math.max(0, Math.abs(lon) - res);
  const soft = v.surf.kind === 'sand' ? v.surf.soft : 0;
  lat *= Math.exp(-h * lerp(S.grip.hard, S.grip.soft, soft));
  // steering: less lock at speed; soft sand makes the bike wander
  const al = Math.abs(lon);
  const lock = S.steerMax / (1 + (al / S.steerV) ** 2);
  v.steer += (input.steer * lock - v.steer) * (1 - Math.exp(-h * S.steerRate));
  let d = v.steer;
  if (v.kind === 'bike' && soft > 0 && al > 0.3) d += soft * (0.05 + 0.07 * Math.max(0, 1 - al / 3)) * Math.sin(v.t * 6.1 + 2 * Math.sin(v.t * 2.3));
  const yaw = v.yaw - lon * Math.tan(d) / S.wheelbase * h;
  let vx = fx * lon + rx * lat, vz = fz * lon + rz * lat;
  const nx = v.x + vx * h, nz = v.z + vz * h;
  const air = v.airY;
  // a blocked turn (a tail swinging into a post) still lets the vehicle roll on straight
  const Y = v.yaw;
  if (!blockedAt(v, nx, nz, yaw, world, air)) { v.x = nx; v.z = nz; v.yaw = yaw; }
  else if (!blockedAt(v, nx, nz, Y, world, air)) { v.x = nx; v.z = nz; }
  else if (!blockedAt(v, nx, v.z, Y, world, air)) { v.bump = Math.max(v.bump, Math.abs(vz)); vz = 0; v.x = nx; }
  else if (!blockedAt(v, v.x, nz, Y, world, air)) { v.bump = Math.max(v.bump, Math.abs(vx)); vx = 0; v.z = nz; }
  else {
    v.bump = Math.max(v.bump, Math.hypot(vx, vz));
    vx *= -0.25; vz *= -0.25;
    if (!blockedAt(v, v.x, v.z, yaw, world, air)) v.yaw = yaw;
  }
  v.vx = vx; v.vz = vz;
  wheelHeights(v, world, v.x, v.z, v.yaw, v.wheelH);
  targets(v);
  v.groundY = v.baseT;
}

function post(v, input, dt, world, hard) {
  const S = v.spec;
  const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
  const lon = v.vx * -sy + v.vz * -cy;
  const dLon = lon - v.lon;
  v.lon = lon;
  const al = Math.abs(lon);
  // body: sprung toward the wheel contacts; past full droop it falls freely
  const K = v.kind === 'bike' ? 220 : 70, C = 2 * (v.kind === 'bike' ? 0.6 : 0.35) * Math.sqrt(K);
  const comp = v.baseT - v.bodyY;
  const wasAir = comp < -0.1;
  const acc = comp > -0.1 ? K * comp - C * v.bodyV : -G;
  v.bodyV += acc * dt;
  v.bodyY += v.bodyV * dt;
  if (v.bodyY < v.baseT - 0.12) { if (v.bodyV < -1.5) v.land = Math.max(v.land, -v.bodyV); v.bodyY = v.baseT - 0.12; v.bodyV = Math.max(0, v.bodyV); }
  if (wasAir && v.baseT - v.bodyY >= -0.1 && v.bodyV < -1) v.land = Math.max(v.land, -v.bodyV);
  // pitch / roll springs (with squat and dive from the acceleration)
  const accel = dLon / dt;
  const pT = v.pitchT + (v.kind === 'atv' ? clamp(accel, -8, 8) * 0.006 : 0);
  const Kp = v.kind === 'bike' ? 260 : 90, Cp = 2 * 0.45 * Math.sqrt(Kp);
  v.pitchV += (Kp * (pT - v.pitch) - Cp * v.pitchV) * dt;
  v.pitch += v.pitchV * dt;
  if (v.kind === 'atv') {
    // body roll: terrain plus a lean out of the turn
    const turn = -((v.yaw - (v._yaw ?? v.yaw) + Math.PI * 3) % (Math.PI * 2) - Math.PI) / dt;
    const rT = v.rollT + clamp(lon * turn, -9, 9) * 0.008;
    v.rollV += (90 * (rT - v.roll) - 2 * 0.4 * Math.sqrt(90) * v.rollV) * dt;
    v.roll += v.rollV * dt;
    v.turn = turn;
  } else {
    const turn = -((v.yaw - (v._yaw ?? v.yaw) + Math.PI * 3) % (Math.PI * 2) - Math.PI) / dt;
    v.turn = turn;
    let leanT = v.parked ? -0.13 : clamp(Math.atan(lon * turn / G), -0.55, 0.55);
    if (!v.parked && v.surf.kind === 'sand' && al > 0.3) leanT += v.surf.soft * 0.03 * Math.sin(v.t * 4.7 + 1.3 * Math.sin(v.t * 1.9));
    const k = v.parked ? 5 : 8;
    v.lean += (leanT - v.lean) * (1 - Math.exp(-dt * k));
    v.roll = -v.lean + v.rollT;
  }
  v._yaw = v.yaw;
  v.wheelRot += lon / S.wheelR * dt;
  // pedalling (single speed, 44/18): the cranks turn only while pedalling forward
  if (v.kind === 'bike') {
    const pedalling = input.throttle > 0.05 && lon > -0.1;
    v.pedal += ((pedalling ? 1 : 0) - v.pedal) * (1 - Math.exp(-dt * 8));
    if (pedalling) v.crank += Math.max(lon, 0.6) / (S.wheelR * 2.44) * dt * (hard ? 1.05 : 1);
    v.coasting = !pedalling && lon > 0.4;
  } else {
    // CVT: revs rise with throttle, then with road speed
    const thr = Math.max(0, input.throttle);
    const target = S.idle + thr * (hard ? 3600 : 2800) + al * 330 + (thr > 0 ? 400 : 0);
    v.rpm += (clamp(target, S.idle, S.redline) - v.rpm) * (1 - Math.exp(-dt * (target > v.rpm ? 5 : 2.5)));
    v.load = thr * clamp(1 - al / (vmaxFor(v, hard) + 0.5), 0.15, 1);
  }
  // water depth under the wheels (spray, splash sound)
  for (let i = 0; i < S.wheels.length; i++) {
    const [px, pz] = wheelPoint(v, i);
    v.wheelDepth[i] = px > SAND.x0 + 30 && world.waterDepthAt ? world.waterDepthAt(px, pz) : 0;
  }
  syncCircles(v);
}

// Where the rider steps off: left side, right side, behind, in front (local offsets)
export function dismountSpots(v) {
  const w = v.kind === 'bike' ? 0.75 : 1.15, l = v.kind === 'bike' ? 1.3 : 1.7;
  const out = [];
  for (const [lx, lz] of [[-w, 0], [w, 0], [-w, 0.5], [w, 0.5], [0, l], [0, -l], [-w - 0.5, 0], [w + 0.5, 0]]) {
    const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
    out.push([v.x + lx * c + lz * s, v.z - lx * s + lz * c]);
  }
  return out;
}

export { sandHeight };
