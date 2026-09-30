// Vehicle specs: the three rideables as they drive today (SPECS) plus the open-world set
// (OPEN_SPECS): the same three with the road-only limits lifted, and the modern bodies from
// blender/modern.py K, all on the shared surface table (SURF). Pure data and maths (no three,
// no DOM) so the Node tests can load it.
//
// OPEN_WORLD picks which set specFor() hands out. It is off by default; turn it on with
// ?openworld=1 in the URL, globalThis.OPEN_WORLD = true before the app loads, or
// OPEN_WORLD=1 in the environment (Node). ?shot=1 always forces it off.
import { crossStreetAt } from '../world/layout.js';

function readFlag() {
  const g = globalThis;
  const q = g.location?.search ? new URLSearchParams(g.location.search) : null;
  if (q?.has('shot')) return false;
  if (g.OPEN_WORLD != null) return !!g.OPEN_WORLD;
  const env = g.process?.env?.OPEN_WORLD;
  if (env != null) return env === '1' || env === 'true';
  if (q?.has('openworld')) return q.get('openworld') !== '0';
  return false;
}
export const OPEN_WORLD = readFlag();

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
  // the hero convertible: a soft, heavy cruiser. Road and cross streets only: every curb
  // (sidewalks, the park side, the curb ramps' upper part) stops it
  car: {
    kind: 'car',
    wheelbase: 2.96, track: 1.61, wheelR: 0.36,
    wheels: [[-0.805, -1.34], [0.805, -1.34], [-0.805, 1.62], [0.805, 1.62]],   // FL FR RL RR
    // (a chain down the middle plus four at the corners, so an angled nose or tail can't
    // swing into a parked car: local z, radius, local x)
    circles: [...[-1.95, -1.3, -0.65, 0, 0.65, 1.3, 1.95].map((z) => [z, 0.93]), ...[[-2.2, -0.4], [-2.2, 0.4], [2.2, -0.4], [2.2, 0.4]].map(([z, x]) => [z, 0.62, x])],
    maxStep: 0.1, accessStep: 0.1, maxDepth: 0.1, xMin: -Infinity, maxGround: 0.1,
    // west bound: the hotel patios, except down the cross streets
    x0At: (z, x0) => (crossStreetAt(z, -0.5) ? -52 : x0),
    vmax: { pavement: [19.4, 21], grass: [3, 3], wetsand: [3, 3], sand: [3, 3] },
    roll: { pavement: 0.2, grass: 1, wetsand: 1, sand: 1 },
    accel: 2.2, accelHard: 2.9, brake: 6.5, handbrake: 4.2, revAccel: 1.6, revMax: 3.4, engineBrake: 0.45,
    steerMax: 0.46, steerV: 7.5, steerRate: 4, grip: { hard: 6, soft: 6 }, bounce: 0.06,
    waterK: 0.1, eye: [-0.42, 1.29, 0.24],
    // 3-speed automatic: upshift road speeds (m/s) at light / full throttle, per gear
    idle: 620, redline: 4400, ratios: [0, 224, 135, 89], shiftAt: [null, [5.5, 9.5], [10.5, 15.5]],
  },
};

// Shared surface table for the open-world cars. grip scales the lateral grip, roll is the
// extra rolling drag (m/s², scaled by the body's offroad factor where offroad is set), vmax
// the top-speed multiplier at offroad 0.5 and 1.0, bump the ride-noise amplitude (m).
export const SURF = {
  road:      { grip: 1.0,  roll: 0,   vmax: [1, 1],       bump: 0 },
  sidewalk:  { grip: 1.0,  roll: 0.05, vmax: [1, 1],      bump: 0 },
  ramp:      { grip: 0.95, roll: 0.05, vmax: [1, 1],      bump: 0 },
  promenade: { grip: 0.95, roll: 0.1, vmax: [1, 1],       bump: 0.004 },
  grass:     { grip: 0.55, roll: 0.9, vmax: [0.45, 0.65], bump: 0.015, offroad: true },
  wetsand:   { grip: 0.65, roll: 0.6, vmax: [0.6, 0.8],   bump: 0.008, offroad: true },
  sand:      { grip: 0.4,  roll: 2.2, vmax: [0.35, 0.7],  bump: 0,     offroad: true },
  water:     { grip: 0.3,  roll: 1,   vmax: [0.6, 0.8],   bump: 0 },
};
// offroad drag scale: 1 for the sedan (0.6), less for the trucks
export const offroadDrag = (offroad) => Math.max(0.2, (1.25 - offroad) / 0.65);

export const ENGINES = {
  i4: { idle: 800, redline: 6500 },
  v6: { idle: 700, redline: 6200 },
  v8mod: { idle: 650, redline: 5800 },
  v8classic: { idle: 620, redline: 4400 },
};

// Modern bodies: geometry from blender/modern.py K (u forward, so local z = -u; track and W0
// are half widths), handling from PLAN-openworld.md 4.4.
const BODIES = {
  hatch:     { L: 4.20, W0: 0.885, uF: 1.29, uR: -1.29, R: 0.315, track: 0.76, top: 1.48, mass: 1150, kmh: [150, 165], t100: 10,   steer: 0.58, grip: 9,   offroad: 0.55, intake: 0.30, sinkCap: 0.12, engine: 'i4', gears: 5 },
  sedan:     { L: 4.80, W0: 0.915, uF: 1.42, uR: -1.42, R: 0.335, track: 0.80, top: 1.45, mass: 1450, kmh: [170, 185], t100: 9,    steer: 0.52, grip: 8.5, offroad: 0.6,  intake: 0.32, sinkCap: 0.12, engine: 'i4', gears: 6 },
  wagon:     { L: 4.86, W0: 0.905, uF: 1.43, uR: -1.47, R: 0.33,  track: 0.79, top: 1.47, mass: 1550, kmh: [165, 180], t100: 9.5,  steer: 0.52, grip: 8.5, offroad: 0.6,  intake: 0.34, sinkCap: 0.12, engine: 'i4', gears: 6 },
  coupe:     { L: 5.05, W0: 0.96,  uF: 1.5,  uR: -1.42, R: 0.34,  track: 0.79, top: 1.36, mass: 1500, kmh: [175, 195], t100: 8.5,  steer: 0.48, grip: 7,   offroad: 0.5,  intake: 0.30, sinkCap: 0.12, engine: 'v8classic', gears: 4 },
  crossover: { L: 4.45, W0: 0.93,  uF: 1.36, uR: -1.36, R: 0.355, track: 0.81, top: 1.63, mass: 1600, kmh: [160, 175], t100: 9.5,  steer: 0.52, grip: 8,   offroad: 0.8,  intake: 0.42, sinkCap: 0.08, engine: 'i4', gears: 6 },
  suv:       { L: 4.72, W0: 0.955, uF: 1.41, uR: -1.41, R: 0.37,  track: 0.83, top: 1.76, mass: 2100, kmh: [160, 170], t100: 10.5, steer: 0.50, grip: 7.5, offroad: 0.9,  intake: 0.50, sinkCap: 0.05, engine: 'v6', gears: 6 },
  pickup:    { L: 5.36, W0: 0.99,  uF: 1.7,  uR: -1.62, R: 0.39,  track: 0.86, top: 1.88, mass: 2300, kmh: [150, 165], t100: 11,   steer: 0.46, grip: 7,   offroad: 1.0,  intake: 0.55, sinkCap: 0.05, engine: 'v8mod', gears: 6 },
};

// acceleration that gives the 0-100 km/h time with the sim's drive taper a·(1 − q³)
function accelFor(t100, vtop) {
  const target = 100 / 3.6, N = 400;
  let I = 0;
  for (let i = 0; i < N; i++) { const q = ((i + 0.5) / N * target) / vtop; I += (target / N) / (1 - q * q * q); }
  return I / t100;
}
// N-speed ratios (rpm per m/s) and upshift speeds at light / full throttle
function gearbox(vtop, redline, n) {
  const top = 0.62 * redline / vtop, first = 0.85 * redline / (vtop * 0.2);
  const ratios = [0], shiftAt = [null];
  for (let g = 1; g <= n; g++) ratios.push(Math.round(first * (top / first) ** ((g - 1) / (n - 1))));
  for (let g = 1; g < n; g++) { const hi = 0.85 * redline / ratios[g]; shiftAt.push([+(hi * 0.55).toFixed(2), +hi.toFixed(2)]); }
  return { ratios, shiftAt };
}
// collision circles: a chain down the middle plus four at the corners (as the hero's)
function circlesFor(L, W0) {
  const r = W0 + 0.015, half = L / 2 - r, n = Math.max(3, Math.ceil((2 * half) / 0.65) + 1) | 1;
  const out = [];
  for (let i = 0; i < n; i++) out.push([+(-half + (2 * half * i) / (n - 1)).toFixed(3), r]);
  const cz = L / 2 - 0.66, cx = Math.max(0.2, W0 + 0.09 - 0.62);
  for (const [z, x] of [[-cz, -cx], [-cz, cx], [cz, -cx], [cz, cx]]) out.push([+z.toFixed(3), 0.62, +x.toFixed(3)]);
  return out;
}
function modern(body, b) {
  const vtop = [b.kmh[0] / 3.6, b.kmh[1] / 3.6];
  const eng = ENGINES[b.engine];
  const accel = accelFor(b.t100, vtop[0]);
  return {
    kind: 'car', body, open: true, engine: b.engine,
    wheelbase: b.uF - b.uR, track: 2 * b.track, wheelR: b.R,
    wheels: [[-b.track, -b.uF], [b.track, -b.uF], [-b.track, -b.uR], [b.track, -b.uR]],
    circles: circlesFor(b.L, b.W0), length: b.L, width: 2 * b.W0,
    maxStep: b.offroad >= 0.8 ? 0.3 : 0.2, accessStep: b.offroad >= 0.8 ? 0.3 : 0.2,
    intake: b.intake, maxDepth: b.intake + 0.2, mass: b.mass, offroad: b.offroad, sinkCap: b.sinkCap,
    vtop, rollBase: 0.2,
    accel, accelHard: accel * 1.2, brake: 8, handbrake: 4.2, revAccel: 2, revMax: 4, engineBrake: 0.5,
    steerMax: b.steer, steerV: 9, steerRate: 5, grip: { hard: b.grip, soft: b.grip }, bounce: 0.06,
    waterK: 0.1, eye: [-(b.track - 0.42), 1.02 + (b.top - 1.45) * 0.9, 0.1],
    idle: eng.idle, redline: eng.redline, ...gearbox(vtop[1], eng.redline, b.gears),
  };
}

const heroOpen = (() => {
  const { maxGround, x0At, ...car } = SPECS.car;
  const vtop = [120 / 3.6, 135 / 3.6];
  const accel = accelFor(12, vtop[0]);
  return {
    ...car, kind: 'car', body: 'hero', open: true, engine: 'v8classic',
    xMin: -Infinity, maxStep: 0.2, accessStep: 0.2, intake: 0.32, maxDepth: 0.52,
    mass: 1750, offroad: 0.5, sinkCap: 0.12, length: 5.76, width: 2.0,
    vtop, rollBase: 0.2, accel, accelHard: accel * 1.2,
    // shifts spread over the wider speed range (the 3-speed keeps its ratios)
    shiftAt: [null, [6, 12], [12, 20]],
  };
})();

export const OPEN_SPECS = {
  bike: { ...SPECS.bike, body: 'bike', open: true, surfTable: true, xMin: -Infinity, mass: 95, length: 1.8, width: 0.6 },
  atv: { ...SPECS.atv, body: 'atv', open: true, surfTable: true, xMin: -Infinity, intake: 0.40, maxDepth: 0.60, mass: 380, length: 2.0, width: 1.2, offroad: 1, sinkCap: 0.05 },
  hero: heroOpen,
  classic: { ...heroOpen, body: 'classic' },
  ...Object.fromEntries(Object.entries(BODIES).map(([k, b]) => [k, modern(k, b)])),
};
export const BODY_NAMES = Object.keys(BODIES);

// the spec a vehicle of this kind / body is built from; 'car' means the hero
export function specFor(kind, open = OPEN_WORLD) {
  if (!open && SPECS[kind]) return SPECS[kind];
  return OPEN_SPECS[kind === 'car' ? 'hero' : kind] ?? SPECS[kind];
}
