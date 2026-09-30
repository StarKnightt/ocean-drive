// Vehicle physics shared by the beach cruiser, the lifeguard ATV and the 1950s convertible. Pure maths (no three,
// no DOM) so it runs in Node tests: a kinematic bicycle model with tyre slip, per-surface
// speed caps and rolling resistance, sub-stepped circle-vs-box / circle-vs-circle
// collisions, wheel contact heights driving pitch / roll / a sprung body, and a hop.
//
// Open-world specs (spec.open, see specs.js) add: the shared surface table, curb mounting,
// sand sinking, water stalls, the beach ramps, soft world edges (world/extent.js) and
// collision contacts with impulses and a yaw kick instead of the axis slide.
//
// Conventions (same as the walker): +x east, -z north; yaw 0 faces north, forward is
// (-sin yaw, -cos yaw), right is (cos yaw, -sin yaw). Model local: forward = -z, right = +x.
import {
  SEA_LEVEL, PARK, SAND, WET_LINE_X, SIDEWALK_W, LANES, CROSS, RAMP_X,
  groundHeight, sandHeight, crossStreetAt, rampAt, rampHeight, surfaceNoise,
} from '../world/layout.js';
import { edgeDistance, softDistance, EDGE_SOFT } from '../world/extent.js';
import { SPECS, SURF, OPEN_WORLD, specFor, offroadDrag } from './specs.js';

export { SPECS, SURF, OPEN_WORLD, specFor };

const G = 9.8;
// seawall accesses (beach.js ACCESS_Z + MORE_ACCESS_Z) and their step profile
export const ACCESS_ZS = [-30, 32, -322, -245, -134, 134, 245, 322];
const ACCESS_HALF = 1.2;
const STEPS = [[10.8, 11.1, 0.33], [11.1, 11.4, 0.5], [11.4, 12.55, 0.7]];
export const nearAccess = (z, pad = 0) => ACCESS_ZS.some((a) => Math.abs(z - a) < ACCESS_HALF + pad);
const onStairs = (x, z) => x >= STEPS[0][0] && x < STEPS[2][1] && nearAccess(z);
export const promenadeX = (z) => PARK.promenadeX + 2.6 * Math.sin(z / 19) + 1.2 * Math.sin(z / 7.3);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// collision prefilter radius around the vehicle (m, plus the frame's travel)
export const DYN_RADIUS = 12;
// open world: longest substep (m) and the substep ceiling (world.maxSubsteps overrides it)
export const MAX_STEP_LEN = 0.15;
export const MAX_SUBSTEPS = 16;
// restitution per contact material
const RESTITUTION = { wall: 0.1, post: 0.2, car: 0.3 };
const FRICTION = 0.3;

// people are hard blockers, never impulse targets: tagged person, or an ownerless small circle
export const isPersonCircle = (q) => q.person ?? (!q.owner && q.r > 0 && q.r < 0.6);

// Ground the vehicle's wheels roll on: the seawall access steps for the bike, else the
// ground (no tower decks or stairs). Open world: plus the beach ramps and the lawn / paver bumps.
export function rideGround(kind, x, z, groundAt = groundHeight, open = false) {
  if (kind === 'bike' && x >= STEPS[0][0] && x < STEPS[2][1] && nearAccess(z)) return STEPS.find((q) => x < q[1])[2];
  if (!open) return groundAt(x, z);
  return (rampHeight(x, z) ?? groundAt(x, z)) + surfaceNoise(x, z);
}

// Surface under (x, z): kind + softness 0..1 + water depth (dynamic swash if available).
// open: also out.detail, the SURF key (road, sidewalk, ramp, promenade, grass, sand,
// wetsand, water); out.kind stays the coarse kind the audio and spray use.
export function surfaceAt(x, z, world, out = {}, open = false) {
  out.depth = 0; out.soft = 0; out.covered = false;
  if (x < PARK.x0) {
    out.kind = 'pavement';
    if (open) {
      const c = x < SIDEWALK_W.x1 ? crossStreetAt(z) : null;
      out.detail = x >= SIDEWALK_W.x1 && x < LANES.x1 ? 'road' : c && Math.abs(z - c.z) < CROSS.hw ? 'road' : 'sidewalk';
    }
  } else if (open && x <= RAMP_X.x1 && x >= RAMP_X.x0 && rampAt(z)) {
    out.kind = 'pavement'; out.detail = 'ramp';
  } else if (x < SAND.x0 + 0.55) {
    out.kind = Math.abs(x - promenadeX(z)) < 2.2 || x > PARK.x1 - 1.2 ? 'pavement' : 'grass';
    if (open) out.detail = out.kind === 'grass' ? 'grass' : 'promenade';
  } else {
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
    if (open) out.detail = out.kind;
  }
  return out;
}

// ---------------------------------------------------------------------------
// static collider grid (boxes + circles), 4 m cells. An item with disabled = true (a parked
// car that has been driven off) is skipped.

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
          if (it.disabled) continue;
          if (fn(it)) return true;
        }
      }
      return false;
    },
  };
}

// ---------------------------------------------------------------------------

// kind: 'bike' | 'atv' | 'car' (the hero) or an open-world body name, or a spec object
export function createVehicle(kind, { x, z, yaw = 0 }, world) {
  const spec = typeof kind === 'object' ? kind : specFor(kind);
  const k = spec.kind;
  const v = {
    kind: k, body: spec.body ?? k, spec, x, z, yaw,
    vx: 0, vz: 0, lon: 0, steer: 0, lean: 0, leanV: 0,
    wheelH: spec.wheels.map(() => 0), groundY: 0,
    bodyY: 0, bodyV: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0, pitchT: 0, rollT: 0,
    airY: 0, vyAir: 0, grounded: true,
    crank: 0, wheelRot: 0, pedal: 0, rpm: spec.idle ?? 0, throttle: 0, load: 0, gear: 1, shiftT: 0, braking: 0, engineOn: k !== 'car',
    boostT: 0, bump: 0, land: 0, t: 0, parked: true, ridden: false,
    surf: { kind: 'pavement', soft: 0, depth: 0 },
    wheelDepth: spec.wheels.map(() => 0),
    circlesWorld: spec.circles.map(([, r]) => ({ x, z, r, owner: null })),
  };
  if (spec.open) {
    Object.assign(v, {
      yawV: 0, sink: spec.wheels.map(() => 0), bogged: false, stalled: false, stallT: 0,
      hit: null, curb: 0, edge: Infinity, outsideT: 0, _rock: 0,
    });
    const m = spec.mass ?? 1500, L = spec.length ?? 4.8, W = spec.width ?? 1.8;
    spec._m ??= m;
    spec._I ??= m * (L * L + W * W) / 12;
    spec._reach ??= Math.max(...spec.circles.map(([lz, r, lx = 0]) => Math.hypot(lz, lx) + r));
  }
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
  const open = !!v.spec.open;
  for (let i = 0; i < v.spec.wheels.length; i++) {
    const [px, pz] = wheelPoint(v, i, x, z, yaw);
    out[i] = rideGround(v.kind, px, pz, world.groundAt, open);
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
const _t = [0, 0, 0, 0];
function targets(v) {
  let h = v.wheelH;
  const S = v.spec;
  if (v.sink) { for (let i = 0; i < h.length; i++) _t[i] = h[i] - v.sink[i]; h = _t; }
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
  v.spec.circles.forEach(([lz, , lx = 0], i) => { const o = v.circlesWorld[i]; o.x = v.x + lx * c + lz * s; o.z = v.z - lx * s + lz * c; });
}

const dynOf = (v, world) => v._dyn ?? world.dynamic();
const edgeOf = (world, x, z) => (world.edgeDistance ? world.edgeDistance(x, z) : edgeDistance(x, z, world.tier));

const _h = [0, 0, 0, 0];
// world: { groundAt, waterDepthAt?, swashAt?, bounds, grid, dynamic: () => circles[],
//   open world only: tier?, edgeDistance?(x, z), maxSubsteps? }
// turnOnly: a rotation in place (after a slide), which may dip a corner a few cm deeper.
// terrainOnly (open specs): only the terrain rules, the world edge and people; walls,
// posts and cars are left to contact()
export function blockedAt(v, x, z, yaw, world, airY = 0, turnOnly = false, terrainOnly = false) {
  const S = v.spec, B = world.bounds;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  // wheels: steps up and deep water
  wheelHeights(v, world, x, z, yaw, _h);
  let deepest = Infinity, now = Infinity;
  for (let i = 0; i < S.wheels.length; i++) {
    const [px, pz] = wheelPoint(v, i, x, z, yaw);
    const lim = (v.kind === 'bike' && nearAccess(pz, 0.3) && px > 10 && px < 13 ? S.accessStep : S.maxStep) + airY;
    if (_h[i] - v.wheelH[i] > lim) return 'step';
    // (open world: the seawall stairs stay for the bike and people)
    if (S.open && v.kind !== 'bike' && onStairs(px, pz) && !onStairs(...wheelPoint(v, i))) return 'step';
    if (S.maxGround != null && _h[i] > S.maxGround) return 'curb';
    if (SEA_LEVEL - _h[i] > S.maxDepth) deepest = Math.min(deepest, _h[i]);
    now = Math.min(now, v.wheelH[i]);
  }
  // past the wading depth the deepest wheel may not get any deeper (heading back out is
  // fine); turning at the limit may swing a corner up to 5 cm further, so it can turn back
  if (turnOnly ? SEA_LEVEL - deepest > S.maxDepth + 0.05 : deepest < now) return 'deep';
  const gy = v.groundY;
  const edgeC = S.open ? edgeOf(world, x, z) : 0;
  const dyn = dynOf(v, world);
  for (const [lz, r, lx = 0] of S.circles) {
    const cx = x + lx * c + lz * s, cz = z - lx * s + lz * c;
    if (S.open) {
      if (edgeC < S._reach + 0.5 && edgeOf(world, cx, cz) < r) return 'bounds';
    } else {
      const x0 = S.x0At ? S.x0At(cz, B.x0) : Math.max(B.x0, S.xMin);
      if (cx - r < x0 || cx + r > B.x1 || cz - r < B.z0 || cz + r > B.z1) return 'bounds';
    }
    if (!(S.open && terrainOnly)) {
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
    }
    for (const q of dyn) {
      if (q.owner === v || !(q.r > 0) || v._inside?.has(q)) continue;
      if (S.open && terrainOnly && !isPersonCircle(q)) continue;
      const rr = r + q.r;
      if ((cx - q.x) ** 2 + (cz - q.z) ** 2 < rr * rr) return S.open && isPersonCircle(q) ? 'person' : 'wall';
    }
  }
  return null;
}

// The deepest overlap of the vehicle's circles at (x, z, yaw) with a wall, post, car or other
// dynamic circle (people excluded: they are hard blockers in blockedAt). Returns out filled
// with { nx, nz (unit, pointing out of the obstacle), depth, px, pz (contact point on the
// obstacle's surface), obj, material: 'wall' | 'post' | 'car' }, or null.
export function contact(v, x, z, yaw, world, out = {}) {
  const S = v.spec, gy = v.groundY, airY = v.airY;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  let best = 0;
  const dyn = dynOf(v, world);
  const take = (depth, nx, nz, px, pz, obj, material) => {
    if (depth <= best) return;
    best = depth;
    out.depth = depth; out.nx = nx; out.nz = nz; out.px = px; out.pz = pz; out.obj = obj; out.material = material;
  };
  for (const [lz, r, lx = 0] of S.circles) {
    const cx = x + lx * c + lz * s, cz = z - lx * s + lz * c;
    world.grid.query(cx - r, cz - r, cx + r, cz + r, (q) => {
      if (q.min) {
        if (q.max.y < gy + 0.12 + airY || q.min.y > gy + 1.3) return false;
        const qx = clamp(cx, q.min.x, q.max.x), qz = clamp(cz, q.min.z, q.max.z);
        const dx = cx - qx, dz = cz - qz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) return false;
        if (d2 > 1e-10) { const d = Math.sqrt(d2); take(r - d, dx / d, dz / d, qx, qz, q, 'wall'); }
        else {
          // centre inside the box: out through the nearest face
          const f = [[cx - q.min.x, -1, 0], [q.max.x - cx, 1, 0], [cz - q.min.z, 0, -1], [q.max.z - cz, 0, 1]].sort((a, b) => a[0] - b[0])[0];
          take(r + f[0], f[1], f[2], cx + f[1] * f[0], cz + f[2] * f[0], q, 'wall');
        }
        return false;
      }
      const dx = cx - q.x, dz = cz - q.z, rr = r + q.r, d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) return false;
      const d = Math.sqrt(d2) || 1e-6;
      take(rr - d, dx / d, dz / d, q.x + dx / d * q.r, q.z + dz / d * q.r, q, 'post');
      return false;
    });
    for (const q of dyn) {
      if (q.owner === v || !(q.r > 0) || v._inside?.has(q) || isPersonCircle(q)) continue;
      const dx = cx - q.x, dz = cz - q.z, rr = r + q.r, d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1e-6;
      take(rr - d, dx / d, dz / d, q.x + dx / d * q.r, q.z + dz / d * q.r, q, 'car');
    }
  }
  return best > 0 ? out : null;
}

// input: { throttle -1..1, steer -1..1 (+ = right), hard (Shift / boost), hop (edge) }
export function stepVehicle(v, input, dt, world) {
  dt = Math.min(dt, 0.05);
  if (!(dt > 0)) return v;
  const S = v.spec;
  v.bump = 0; v.land = 0;
  v.t += dt;
  // one pass over the moving colliders per frame: only those within reach this frame
  const speed0 = Math.hypot(v.vx, v.vz);
  const R = DYN_RADIUS + speed0 * dt, buf = (v._dynBuf ??= []);
  buf.length = 0;
  for (const q of world.dynamic()) {
    if (q.owner === v) continue;
    const dx = q.x - v.x, dz = q.z - v.z, rr = R + (q.r > 0 ? q.r : 0);
    if (dx * dx + dz * dz < rr * rr) buf.push(q);
  }
  v._dyn = buf;
  const c = Math.hypot(v.x - (v._sx ?? 1e9), v.z - (v._sz ?? 1e9));
  if (c > 0.25 || v._sf === undefined || ++v._sf > 3) { surfaceAt(v.x, v.z, world, v.surf, !!S.open); v._sx = v.x; v._sz = v.z; v._sf = 0; }
  if (S.open) {
    v.hit = null; v.curb = 0;
    v.edge = edgeOf(world, v.x, v.z);
    const sd = world.softDistance ? world.softDistance(v.x, v.z) : world.edgeDistance ? Infinity : softDistance(v.x, v.z, world.tier);
    v._edgeK = clamp(sd / EDGE_SOFT.vehicle, 0, 1);
    v.outsideT = v.edge < 0 ? v.outsideT + dt : 0;
    swashDrift(v, dt, world);
  }
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
  if (v.kind === 'car' || S.open) {
    // no drive before the engine has caught (the brakes work)
    if (!v.engineOn) input = { ...input, throttle: Math.min(0, input.throttle) };
    v._inside = overlapping(v, world);
  }
  let speed = Math.hypot(v.vx, v.vz);
  let n;
  if (S.open) {
    n = clamp(Math.ceil(Math.max(speed, 0.5) * dt / 0.08), 1, world.maxSubsteps ?? MAX_SUBSTEPS);
    // at low frame rates lower the speed rather than lengthen the step (tunnelling)
    if (speed * dt / n > MAX_STEP_LEN) { const k = MAX_STEP_LEN * n / (speed * dt); v.vx *= k; v.vz *= k; }
  } else n = clamp(Math.ceil(Math.max(speed, 0.5) * dt / 0.08), 1, 12);
  const h = dt / n;
  for (let i = 0; i < n; i++) (S.open ? substepOpen : substep)(v, input, h, world, hard);
  v.throttle = input.throttle;
  post(v, input, dt, world, hard);
  v._dyn = null;
  return v;
}

// dynamic circles already overlapping the vehicle (someone walked into it, the traffic car
// drove through it) don't block it, so it can always pull away
function overlapping(v, world) {
  let set = null;
  for (const q of dynOf(v, world)) {
    if (q.owner === v || !(q.r > 0)) continue;
    for (const o of v.circlesWorld) {
      const rr = o.r + q.r;
      if ((o.x - q.x) ** 2 + (o.z - q.z) ** 2 < rr * rr) { (set ??= new Set()).add(q); break; }
    }
  }
  return set;
}

// the swash front pushes a vehicle standing in it up and down the beach (along x)
function swashDrift(v, dt, world) {
  if (!world.swashAt || v.x < SAND.x0 + 30) { v._front = undefined; return; }
  const sw = world.swashAt(v.x, v.z);
  const prev = v._front;
  v._front = sw.front;
  if (prev === undefined || !(sw.covered || v.surf.kind === 'water')) return;
  const fv = (sw.front - prev) / dt;
  if (!(Math.abs(fv) < 20)) return;   // a new wave took over the front
  const depth = Math.max(sw.depth ?? 0, v.surf.depth);
  v.vx += fv * 0.35 * clamp(depth / 0.15, 0.2, 1) * dt;
}

const _sinkMean = (v) => { let s = 0; for (const q of v.sink) s += q; return s / v.sink.length; };
const surfK = (v) => {
  const t = clamp(((v.spec.offroad ?? 0.5) - 0.5) / 0.5, 0, 1);
  return (e) => lerp(e.vmax[0], e.vmax[1], t);
};

// top-speed factor in the soft band at a world edge
const edgeCap = (v) => { const k = v._edgeK ?? 1; return 0.15 + 0.85 * k * k; };
function vmaxFor(v, hard) {
  const S = v.spec, su = v.surf, k = hard ? 1 : 0;
  let vm;
  if (S.open && !S.surfTable) {
    const f = surfK(v), top = S.vtop[k];
    if (su.kind === 'water') vm = top * f(SURF.wetsand) * clamp(1 - su.depth / (S.intake * 1.1), 0.05, 1);
    else if (su.kind === 'sand' || su.kind === 'wetsand') vm = top * lerp(f(SURF.wetsand), f(SURF.sand), su.soft);
    else vm = top * f(SURF[su.detail] ?? SURF.road);
    return vm * edgeCap(v);
  }
  if (su.kind === 'water') vm = S.vmax.wetsand[k] * clamp(1 - su.depth / S.waterK, 0.08, 1);
  else if (su.kind === 'sand' || su.kind === 'wetsand') vm = lerp(S.vmax.wetsand[k], S.vmax.sand[k], su.soft);
  else vm = S.vmax[su.kind][k];
  if (S.open) vm *= edgeCap(v);
  return vm;
}
function rollFor(v) {
  const S = v.spec, su = v.surf;
  if (S.open && !S.surfTable) {
    const drag = offroadDrag(S.offroad ?? 0.6);
    let r;
    if (su.kind === 'water') r = (SURF.water.roll + SURF.water.depthRoll * su.depth) * drag;
    else if (su.kind === 'sand' || su.kind === 'wetsand') r = lerp(SURF.wetsand.roll, SURF.sand.roll, su.soft) * drag;
    else { const e = SURF[su.detail] ?? SURF.road; r = e.roll * (e.offroad ? drag : 1); }
    return S.rollBase + r + _sinkMean(v) * 25;
  }
  if (su.kind === 'water') return S.roll.wetsand + 3 * su.depth;
  if (su.kind === 'sand' || su.kind === 'wetsand') return lerp(S.roll.wetsand, S.roll.sand, su.soft);
  return S.roll[su.kind];
}
function gripFor(v) {
  const S = v.spec, su = v.surf;
  if (!S.open || S.surfTable) return 1;
  if (su.kind === 'water') return SURF.water.grip;
  if (su.kind === 'sand' || su.kind === 'wetsand') return lerp(SURF.wetsand.grip, SURF.sand.grip, su.soft);
  return (SURF[su.detail] ?? SURF.road).grip;
}

// longitudinal drive / brake / resistance and steering for one substep (shared by both paths)
function drive(v, input, h, hard) {
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
  // handbrake (car): drags the car down and lets the tail slide
  const hb = !!input.handbrake && !!S.handbrake;
  if (hb && Math.abs(lon) > 0.05) a -= Math.sign(lon) * S.handbrake;
  v.braking = (thr < -0.05 && lon > 0.3) || (thr > 0.05 && lon < -0.3) ? Math.abs(thr) : hb ? 0.7 : 0;
  // open world: inside the soft band at a world edge the car is reined in to the taper
  if (S.open && (v._edgeK ?? 1) < 1) {
    const cap = vmaxFor(v, true);
    if (Math.abs(lon) > cap) a -= Math.sign(lon) * Math.min(6, (Math.abs(lon) - cap) * 3);
  }
  // gravity along the slope between the wheels (the access steps count as a ramp)
  a -= G * clamp(Math.sin(v.pitchT), -0.1, 0.1) * 0.8;
  const lon0 = lon;
  lon += a * h;
  if (hb && lon0 !== 0 && Math.sign(lon) !== Math.sign(lon0)) lon = 0;
  const driving = (thr > 0.05 && lon > 0.3) || (thr < -0.05 && lon < -0.3);
  // (open world: the surface's own drag, sand and sinking, holds back a driven car too)
  const rf = rollFor(v);
  const surfDrag = S.open && !S.surfTable ? rf - S.rollBase : 0;
  const res = (driving ? surfDrag : rf + (Math.abs(thr) < 0.05 ? S.engineBrake : 0)) * h;
  lon = Math.sign(lon) * Math.max(0, Math.abs(lon) - res);
  const soft = v.surf.kind === 'sand' ? v.surf.soft : 0;
  lat *= Math.exp(-h * lerp(S.grip.hard, S.grip.soft, soft) * gripFor(v) * (hb ? 0.3 : 1));
  // steering: less lock at speed; soft sand makes the bike wander
  const al = Math.abs(lon);
  const lock = S.steerMax / (1 + (al / S.steerV) ** 2);
  v.steer += (input.steer * lock - v.steer) * (1 - Math.exp(-h * S.steerRate));
  let d = v.steer;
  if (v.kind === 'bike' && soft > 0 && al > 0.3) d += soft * (0.05 + 0.07 * Math.max(0, 1 - al / 3)) * Math.sin(v.t * 6.1 + 2 * Math.sin(v.t * 2.3));
  const yawRate = -lon * Math.tan(d) / S.wheelbase;
  return { fx, fz, rx, rz, lon, lat, yawRate };
}

function substep(v, input, h, world, hard) {
  const S = v.spec;
  const { fx, fz, rx, rz, lon, lat, yawRate } = drive(v, input, h, hard);
  const yaw = v.yaw + yawRate * h;
  let vx = fx * lon + rx * lat, vz = fz * lon + rz * lat;
  const nx = v.x + vx * h, nz = v.z + vz * h;
  const air = v.airY;
  // a blocked turn (a tail swinging into a post) still lets the vehicle roll on straight
  const Y = v.yaw;
  if (!blockedAt(v, nx, nz, yaw, world, air)) { v.x = nx; v.z = nz; v.yaw = yaw; }
  else if (!blockedAt(v, nx, nz, Y, world, air)) { v.x = nx; v.z = nz; }
  else if (!blockedAt(v, nx, v.z, Y, world, air)) {
    v.bump = Math.max(v.bump, Math.abs(vz)); vz = 0; v.x = nx;
    if (!blockedAt(v, v.x, v.z, yaw, world, air, true)) v.yaw = yaw;
  } else if (!blockedAt(v, v.x, nz, Y, world, air)) {
    v.bump = Math.max(v.bump, Math.abs(vx)); vx = 0; v.z = nz;
    if (!blockedAt(v, v.x, v.z, yaw, world, air, true)) v.yaw = yaw;
  } else {
    v.bump = Math.max(v.bump, Math.hypot(vx, vz));
    const k = S.bounce ?? 0.25;
    vx *= -k; vz *= -k;
    if (!blockedAt(v, v.x, v.z, yaw, world, air, true)) v.yaw = yaw;
  }
  v.vx = vx; v.vz = vz;
  wheelHeights(v, world, v.x, v.z, v.yaw, v.wheelH);
  targets(v);
  v.groundY = v.baseT;
}

const _hOld = [0, 0, 0, 0];
const _c = {};
// Open world: terrain, the world edge and people block as before (slide, then bounce);
// walls, posts and cars are resolved as contacts with an impulse, friction and a yaw kick.
function substepOpen(v, input, h, world, hard) {
  const S = v.spec;
  const { fx, fz, rx, rz, lon, lat, yawRate } = drive(v, input, h, hard);
  // collision spin relaxes as the tyres bite
  v.yawV *= Math.exp(-h * 3 * Math.max(0.3, gripFor(v)));
  const yaw = v.yaw + (yawRate + v.yawV) * h;
  let vx = fx * lon + rx * lat, vz = fz * lon + rz * lat;
  const nx = v.x + vx * h, nz = v.z + vz * h;
  const air = v.airY;
  for (let i = 0; i < S.wheels.length; i++) _hOld[i] = v.wheelH[i];
  const Y = v.yaw;
  const B = (x, z, y, turn = false) => blockedAt(v, x, z, y, world, air, turn, true);
  if (!B(nx, nz, yaw)) { v.x = nx; v.z = nz; v.yaw = yaw; }
  else if (!B(nx, nz, Y)) { v.x = nx; v.z = nz; }
  else if (!B(nx, v.z, Y)) {
    v.bump = Math.max(v.bump, Math.abs(vz)); vz = 0; v.x = nx;
    if (!B(v.x, v.z, yaw, true)) v.yaw = yaw;
  } else if (!B(v.x, nz, Y)) {
    v.bump = Math.max(v.bump, Math.abs(vx)); vx = 0; v.z = nz;
    if (!B(v.x, v.z, yaw, true)) v.yaw = yaw;
  } else {
    v.bump = Math.max(v.bump, Math.hypot(vx, vz));
    const k = S.bounce ?? 0.25;
    vx *= -k; vz *= -k; v.yawV = 0;
    if (!B(v.x, v.z, yaw, true)) v.yaw = yaw;
  }
  wheelHeights(v, world, v.x, v.z, v.yaw, v.wheelH);
  // curb mounting: each wheel stepping up more than 8 cm costs speed and kicks the body
  let keep = 1, kick = 0;
  for (let i = 0; i < S.wheels.length; i++) {
    const step = v.wheelH[i] - _hOld[i];
    if (step > 0.08) { keep *= 1 - 0.9 * step; kick += step; }
  }
  if (kick > 0) {
    vx *= keep; vz *= keep;
    v.bodyV += kick * 3;
    v.curb = Math.max(v.curb, kick);
    v.land = Math.max(v.land, kick * 10);
    v.bump = Math.max(v.bump, Math.hypot(vx, vz) * kick * 4);
  }
  // contacts
  const m = S._m, I = S._I;
  for (let it = 0; it < 4; it++) {
    const q = contact(v, v.x, v.z, v.yaw, world, _c);
    if (!q) break;
    v.x += q.nx * (q.depth + 1e-4); v.z += q.nz * (q.depth + 1e-4);
    const ox = q.px - v.x, oz = q.pz - v.z;
    const w = yawRate + v.yawV;
    const pvx = vx + w * oz, pvz = vz - w * ox;
    const vn = pvx * q.nx + pvz * q.nz;
    if (vn >= 0) continue;
    const e = RESTITUTION[q.material] ?? 0.1;
    const kn = oz * q.nx - ox * q.nz;
    const J = -(1 + e) * vn / (1 / m + kn * kn / I);
    vx += J * q.nx / m; vz += J * q.nz / m; v.yawV += J * kn / I;
    // tangential friction scrapes speed off
    const tx = -q.nz, tz = q.nx;
    const vt = pvx * tx + pvz * tz;
    const kt = oz * tx - ox * tz;
    const Jt = clamp(-vt / (1 / m + kt * kt / I), -FRICTION * J, FRICTION * J);
    vx += Jt * tx / m; vz += Jt * tz / m; v.yawV += Jt * kt / I;
    v.yawV = clamp(v.yawV, -3, 3);
    const sp = -vn;
    if (!v.hit || sp > v.hit.speed) v.hit = { speed: sp, tangent: Math.abs(vt), px: q.px, pz: q.pz, nx: q.nx, nz: q.nz, material: q.material, obj: q.obj };
    v.bump = Math.max(v.bump, sp);
  }
  v.vx = vx; v.vz = vz;
  wheelHeights(v, world, v.x, v.z, v.yaw, v.wheelH);
  targets(v);
  v.groundY = v.baseT;
}

// open world: sinking into soft sand, per wheel. It grows with softness, engine load and
// wheelspin, and recovers with rolling speed and a gentle throttle; each reversal of the
// throttle (rocking) packs the ruts down.
function sinkStep(v, input, dt) {
  const S = v.spec, cap = S.sinkCap;
  const soft = v.surf.kind === 'sand' ? v.surf.soft : 0;
  const lon = v.vx * -Math.sin(v.yaw) + v.vz * -Math.cos(v.yaw), al = Math.abs(lon);
  const thrRaw = v.engineOn ? input.throttle : Math.min(0, input.throttle);
  const thr = Math.abs(thrRaw);
  const sign = thr > 0.3 ? Math.sign(thrRaw) : 0;
  if (sign && v._rock && sign !== v._rock) for (let i = 0; i < v.sink.length; i++) v.sink[i] *= 0.7;
  if (sign) v._rock = sign;
  const spin = thr > 0.6 ? (thr - 0.5) * 2 * clamp(1 - al / 4, 0, 1) * soft : 0;
  const gentle = thr > 0.05 && thr <= 0.6;
  for (let i = 0; i < v.sink.length; i++) {
    let s = v.sink[i];
    s += soft * (0.012 * v.load + 0.2 * spin) * (1 - s / cap) * dt;
    s -= (s * 0.35 * al + (gentle ? 0.03 : 0) + (soft === 0 ? 0.05 : 0)) * dt;
    v.sink[i] = clamp(s, 0, cap);
  }
  v.bogged = _sinkMean(v) > 0.8 * cap && al < 0.4;
}

// open world: may the engine be restarted here (the intake is clear of the water)?
export function canRestart(v) {
  const S = v.spec;
  return !S.intake || Math.max(...v.wheelDepth) < S.intake - 0.1;
}

function post(v, input, dt, world, hard) {
  const S = v.spec;
  const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
  const lon = v.vx * -sy + v.vz * -cy;
  const dLon = lon - v.lon;
  v.lon = lon;
  const al = Math.abs(lon);
  // body: sprung toward the wheel contacts; past full droop it falls freely
  const K = v.kind === 'bike' ? 220 : v.kind === 'car' ? 42 : 70, C = 2 * (v.kind === 'bike' ? 0.6 : v.kind === 'car' ? 0.28 : 0.35) * Math.sqrt(K);
  const comp = v.baseT - v.bodyY;
  const wasAir = comp < -0.1;
  const acc = comp > -0.1 ? K * comp - C * v.bodyV : -G;
  v.bodyV += acc * dt;
  v.bodyY += v.bodyV * dt;
  if (v.bodyY < v.baseT - 0.12) { if (v.bodyV < -1.5) v.land = Math.max(v.land, -v.bodyV); v.bodyY = v.baseT - 0.12; v.bodyV = Math.max(0, v.bodyV); }
  if (wasAir && v.baseT - v.bodyY >= -0.1 && v.bodyV < -1) v.land = Math.max(v.land, -v.bodyV);
  // pitch / roll springs (with squat and dive from the acceleration)
  const accel = dLon / dt;
  const car = v.kind === 'car';
  const pT = v.pitchT + (v.kind === 'atv' ? clamp(accel, -8, 8) * 0.006 : car ? clamp(accel, -8, 8) * 0.0095 : 0);
  const Kp = v.kind === 'bike' ? 260 : car ? 34 : 90, Cp = 2 * (car ? 0.3 : 0.45) * Math.sqrt(Kp);
  v.pitchV += (Kp * (pT - v.pitch) - Cp * v.pitchV) * dt;
  v.pitch += v.pitchV * dt;
  if (v.kind === 'atv' || car) {
    // body roll: terrain plus a lean out of the turn (the convertible wallows on soft springs)
    const turn = -((v.yaw - (v._yaw ?? v.yaw) + Math.PI * 3) % (Math.PI * 2) - Math.PI) / dt;
    const rT = v.rollT + clamp(lon * turn, -9, 9) * (car ? 0.011 : 0.008);
    const Kr = car ? 30 : 90;
    v.rollV += (Kr * (rT - v.roll) - 2 * (car ? 0.3 : 0.4) * Math.sqrt(Kr) * v.rollV) * dt;
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
  } else if (car) {
    // N-speed automatic: shift points rise with the throttle; a torque converter lets the
    // revs flare above road speed when pulling away
    const thr = v.engineOn ? Math.max(0, input.throttle) : 0;
    const N = S.ratios.length - 1;
    const up = (g) => lerp(S.shiftAt[g][0], S.shiftAt[g][1], thr);
    v.shiftT = Math.max(0, v.shiftT - dt);
    if (v.gear < N && lon > up(v.gear) && v.shiftT <= 0) { v.gear++; v.shiftT = 0.45; }
    else if (v.gear > 1 && lon < up(v.gear - 1) - 3 && v.shiftT <= 0) { v.gear--; v.shiftT = 0.3; }
    if (lon < -0.3) v.gear = 1;
    const conv = S.idle + thr * (hard ? 1500 : 1150) * clamp(1 - al / 9, 0.2, 1);
    const target = v.engineOn ? Math.max(al * S.ratios[v.gear] + thr * 380, conv) : 0;
    v.rpm += (clamp(target, v.engineOn ? S.idle : 0, S.redline) - v.rpm) * (1 - Math.exp(-dt * (v.shiftT > 0.2 ? 10 : 4)));
    v.load = thr * clamp(1 - al / (vmaxFor(v, hard) + 1), 0.2, 1);
  } else {
    // CVT: revs rise with throttle, then with road speed
    const thr = v.engineOn ? Math.max(0, input.throttle) : 0;
    const target = v.engineOn ? S.idle + thr * (hard ? 3600 : 2800) + al * 330 + (thr > 0 ? 400 : 0) : 0;
    v.rpm += (clamp(target, v.engineOn ? S.idle : 0, S.redline) - v.rpm) * (1 - Math.exp(-dt * (target > v.rpm ? 5 : 2.5)));
    v.load = thr * clamp(1 - al / (vmaxFor(v, hard) + 0.5), 0.15, 1);
  }
  // water depth under the wheels (spray, splash sound)
  for (let i = 0; i < S.wheels.length; i++) {
    const [px, pz] = wheelPoint(v, i);
    v.wheelDepth[i] = px > SAND.x0 + 30 && world.waterDepthAt ? world.waterDepthAt(px, pz) : 0;
  }
  if (S.open) {
    if (S.sinkCap) sinkStep(v, input, dt);
    // the engine drowns once the water (plus the bow wave at speed) reaches the intake
    if (S.intake) {
      const dep = Math.max(...v.wheelDepth) + Math.min(0.15, 0.04 * al);
      if (v.engineOn && dep > S.intake) {
        v.stallT += dt;
        if (v.stallT > 0.4) { v.engineOn = false; v.stalled = true; v.stallT = 0; }
      } else v.stallT = 0;
      if (v.stalled && v.engineOn) v.stalled = false;
    }
  }
  syncCircles(v);
}

// Where the rider steps off: left side, right side, behind, in front (local offsets)
export function dismountSpots(v) {
  if (v.kind === 'car') {
    // beside the doors on either side, a little further out, then the ends
    const out = [];
    for (const [lx, lz] of [[-1.5, 0.1], [1.5, 0.1], [-1.5, -0.5], [1.5, -0.5], [-1.5, 0.8], [1.5, 0.8], [-2.0, 0.1], [2.0, 0.1], [0, 3.4], [0, -3.4]]) {
      const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
      out.push([v.x + lx * c + lz * s, v.z - lx * s + lz * c]);
    }
    return out;
  }
  const w = v.kind === 'bike' ? 0.75 : 1.15, l = v.kind === 'bike' ? 1.3 : 1.7;
  const out = [];
  for (const [lx, lz] of [[-w, 0], [w, 0], [-w, 0.5], [w, 0.5], [0, l], [0, -l], [-w - 0.5, 0], [w + 0.5, 0]]) {
    const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
    out.push([v.x + lx * c + lz * s, v.z - lx * s + lz * c]);
  }
  return out;
}

export { sandHeight };
