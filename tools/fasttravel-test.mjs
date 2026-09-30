// Node-only checks of fast travel (src/player/fasttravel.js) on the real walk world: the
// street, beach (towers, seawall access) and hotel builders run under a small DOM / canvas
// shim, so the colliders, footprints, cafe furniture and deck heights are the game's own. The
// parked fleet (loaded from GLBs in the game) stands in as one continuous curb row, with the
// gaps the layout keeps (the hero's bay, the mid-block crosswalk).
// Every destination must resolve to a spot the game's own Walker.blocked() accepts, on the
// walk world's surface, inside the world extent, clear of the cafe furniture; the vehicle
// carries (2, 3, 5, 7) must land on the roadway, clear for a car body, facing along it.
// Usage: node tools/fasttravel-test.mjs
const stub = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : k === 'width' || k === 'height' ? 256 : stub()), apply: () => stub(), set: () => true });
const img = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) });
const ctx2d = () => new Proxy({}, {
  get: (t, k) => (k === 'createImageData' || k === 'getImageData' ? (a, b, w, h) => (typeof a === 'object' ? img(a.width, a.height) : w ? img(w, h) : img(a, b))
    : k === 'measureText' ? (s) => ({ width: String(s).length * 8 }) : k === 'then' ? undefined : k in t ? t[k] : stub()),
  set: (t, k, v) => { t[k] = v; return true; },
});
const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, append() {}, appendChild() {}, addEventListener() {}, setAttribute() {}, querySelector: () => el() });
globalThis.window = globalThis;
globalThis.location = new URL('http://localhost/?quality=high');
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', hardwareConcurrency: 8, maxTouchPoints: 0 }, configurable: true });
Object.assign(globalThis, { screen: { width: 1920, height: 1080 }, devicePixelRatio: 1, innerWidth: 1920, innerHeight: 1080, addEventListener() {} });
globalThis.document = {
  createElement: (t) => (t === 'canvas' ? { width: 256, height: 256, style: {}, getContext: () => ctx2d(), addEventListener() {}, toDataURL: () => '' } : el()),
  head: el(), body: el(), documentElement: el(), addEventListener() {},
};

const THREE = await import('three');
const { EYE_HEIGHT, SEA_LEVEL, LANES, PARKING, CAR, CROSS, crossStreetAt, groundHeightOpen, DISTRICT } = await import('../src/world/layout.js');
const { edgeDistance, extentBounds, insideWorld, softDistance, EDGE_SOFT } = await import('../src/world/extent.js');
const { buildStreet, STREET_COLLIDERS } = await import('../src/world/street.js');
const { PALM_TREES } = await import('../src/world/palms.js');
const { createSurf } = await import('../src/world/surf.js');
const { buildBeach } = await import('../src/world/beach.js');
const { buildHotels } = await import('../src/world/hotels.js');
const { Walker } = await import('../src/player/walker.js');
const { createVehicle, blockedAt, buildGrid, settle } = await import('../src/vehicles/sim.js');
const { OPEN_SPECS } = await import('../src/vehicles/specs.js');
const { PARKED } = await import('../src/vehicles/index.js');
const FT = await import('../src/player/fasttravel.js');

const scene = new THREE.Scene();
buildStreet(scene);
const beach = buildBeach(scene, createSurf({ frozen: true }));
const hotels = await buildHotels(scene, async () => {});
const tier = 'high';

// the parked row: one curb-long box, broken where the layout leaves bays
const curb = [];
const gaps = [[CAR.z - 6.5, CAR.z + 6.5], [-10 - 6.5, -10 + 6.5], [22, 44]].sort((a, b) => a[0] - b[0]);
let z0 = DISTRICT.zMin;
for (const [a, b] of gaps) { curb.push([z0, a]); z0 = b; }
curb.push([z0, DISTRICT.zMax]);
const parkedBoxes = curb.map(([a, b]) => ({ min: { x: CAR.x - 1.0, y: 0, z: a }, max: { x: CAR.x + 1.0, y: 1.5, z: b } }));
const heroBox = { min: { x: CAR.x - 1.0, y: 0, z: CAR.z - 2.9 }, max: { x: CAR.x + 1.0, y: 1.2, z: CAR.z + 2.9 } };
const staticBoxes = [
  ...STREET_COLLIDERS.filter((c) => c.min), ...beach.colliders, ...parkedBoxes, heroBox,
  ...hotels.userData.footprints.map((f) => ({ min: { x: -80, y: -5, z: f.z0 }, max: { x: f.fx, y: 60, z: f.z1 } })),
];
const staticCircles = [
  ...STREET_COLLIDERS.filter((c) => c.r),   // (the knockable bins too: they stand there)
  ...PALM_TREES.filter((t) => Math.abs(t.z) < extentBounds(tier).z1 + 10).map((t) => ({ x: t.x, z: t.z, r: 0.26 })),
];
const vworld = { groundAt: beach.groundAt, waterDepthAt: beach.waterDepthAt, swashAt: beach.swashAt, grid: buildGrid(staticBoxes, staticCircles), dynamic: () => [], tier };
// the ATV and the bike where they park, as vehicle circles (the walker collides with them)
const atv = createVehicle('atv', PARKED.atv, vworld), bike = createVehicle('bike', PARKED.bike, vworld);
const walkWorld = {
  heightAt: beach.heightAt, boxes: staticBoxes, circles: [...staticCircles, ...atv.circlesWorld, ...bike.circlesWorld],
  bounds: { ...extentBounds(tier), soft: EDGE_SOFT.walker },
  inside: (x, z) => edgeDistance(x, z, tier) >= 0,
  softDistance: (x, z) => softDistance(x, z, tier), softWidth: EDGE_SOFT.walker,
};
const walker = new Walker(new THREE.PerspectiveCamera(), el(), walkWorld);
const cafe = [
  ...hotels.userData.tables.filter((t) => t.y < 0.3).map((t) => ({ x: t.x, z: t.z, r: 0.42 })),
  ...hotels.userData.chairs.filter((c) => c.y < 0.3).map((c) => ({ x: c.x, z: c.z, r: 0.27 })),
];
const heroPose = { x: CAR.x, z: CAR.z, yaw: Math.PI };
const carOf = (pose, body) => ({ pose, doors: FT.doorPoints(pose, body === 'hero' ? 0.1 : -0.25, body === 'hero' ? 2 : 1.9) });
const base = {
  world: walkWorld, towers: beach.towers, cafe, start: FT.START,
  hero: carOf(heroPose, 'hero'), atv: { pose: { x: atv.x, z: atv.z, yaw: atv.yaw } },
};
// the saved car: the hero at its curb, a sedan in the curb row, one on a cross street, one left on the beach
const SAVED = {
  hero: carOf(heroPose, 'hero'),
  curb: carOf({ x: CAR.x, z: -1.5, yaw: Math.PI }, 'sedan'),
  cross: carOf({ x: -70, z: -79 - (CROSS.hw - 1.15), yaw: -Math.PI / 2 }, 'sedan'),
  beach: carOf({ x: 30, z: -60, yaw: 0.4 }, 'sedan'),
};

const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(info)}`); };
const r2 = (v) => +v.toFixed(2);

// --- on foot
function walkCheck(label, id, ctx, extra = () => true) {
  const s = FT.resolveWalk(id, ctx);
  if (!s) { check(`${label}: resolves`, false, { id }); return; }
  const surface = walkWorld.heightAt(s.x, s.z, s.feetY);
  walker.feetY = s.feetY;
  const blocked = walker.blocked(s.x, s.z);
  const inside = edgeDistance(s.x, s.z, tier) >= 0.3;
  const onSurface = Math.abs(surface - s.feetY) < 0.02 && s.feetY > SEA_LEVEL - 0.25;
  const clearCafe = cafe.every((c) => Math.hypot(s.x - c.x, s.z - c.z) > c.r + 0.3);
  // it stays put and on its feet: a second of standing there in the game's walker
  walker.set(s.x, s.feetY + EYE_HEIGHT, s.z, s.heading, s.pitch);
  walker.simulate([], 1);
  const settled = Math.hypot(walker.pos.x - s.x, walker.pos.y - s.z) < 0.01 && Math.abs(walker.feetY - s.feetY) < 0.03;
  // and can walk away (some direction is open within a step)
  const free = [0, 60, 120, 180, 240, 300].some((a) => { const r = (a * Math.PI) / 180; walker.feetY = s.feetY; return !walker.blocked(s.x + Math.sin(r) * 0.4, s.z - Math.cos(r) * 0.4); });
  const ok = !blocked && inside && onSurface && clearCafe && settled && free && extra(s);
  check(`${label}: legal ground`, ok, { x: r2(s.x), z: r2(s.z), feetY: r2(s.feetY), heading: Math.round(s.heading), blocked, inside, onSurface, clearCafe, settled, free });
}
for (const d of FT.DESTINATIONS) {
  if (d.id === 'car') continue;
  const extra = d.id === 'lookout' ? (s) => Math.abs(s.feetY - beach.towers[0].deckY) < 0.02
    : d.id === 'beach' ? (s) => s.x > 80 && Math.hypot(s.z - beach.towers[0].deck.z0, 0) < 12
    : d.id === 'hero' || d.id === 'atv' ? (s) => { const p = d.id === 'hero' ? heroPose : base.atv.pose; return Math.hypot(s.x - p.x, s.z - p.z) < 3.2; }
    : () => true;
  walkCheck(`${d.key} ${d.name}`, d.id, base, extra);
}
for (const [k, car] of Object.entries(SAVED)) {
  walkCheck(`2 Your Car (saved: ${k})`, 'car', { ...base, car }, (s) => Math.min(...car.doors.map((q) => Math.hypot(s.x - q.x, s.z - q.z))) < 1.45);
}

// --- riding: the car carried along, set down on the road
// (the hero driven: its own parked box is off, as in the game)
const vworldHero = { ...vworld, grid: buildGrid(staticBoxes.filter((b) => b !== heroBox), staticCircles) };
function roadCheck(label, id, ctx, body = 'sedan') {
  const p = FT.resolveRoad(id, ctx);
  if (!p) { check(`${label}: resolves`, false, { id }); return; }
  const vworld_ = body === 'hero' ? vworldHero : vworld;
  const v = createVehicle(OPEN_SPECS[body], p, vworld_);
  // (vehicles.place(): a blocked spot slides along the heading to the nearest clear one)
  const put = (x, z) => { Object.assign(v, { x, z, yaw: p.yaw, vx: 0, vz: 0, lon: 0 }); settle(v, vworld_); return !blockedAt(v, x, z, p.yaw, vworld_); };
  let ok = put(p.x, p.z), slid = 0;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  for (let k = 1; !ok && k <= 120; k++) { slid = Math.ceil(k / 2) * 0.25 * (k % 2 ? 1 : -1); ok = put(p.x + fx * slid, p.z + fz * slid); }
  const c = crossStreetAt(v.z);
  const onOcean = v.x > PARKING.x0 + 0.8 && v.x < LANES.x1 - 0.8;
  const onCross = !!c && !c.far && Math.abs(v.z - c.z) < CROSS.hw - 0.8 && v.x < -26;
  const along = onCross ? Math.abs(Math.abs(Math.sin(p.yaw)) - 1) < 1e-6 : Math.abs(Math.sin(p.yaw)) < 1e-6;
  const inside = insideWorld(v.x, v.z, 'vehicle', 1.5, tier);
  const road = Math.abs(groundHeightOpen(v.x, v.z)) < 0.12;
  check(`${label}: on the road`, ok && (onOcean || onCross) && along && inside && road && Math.abs(slid) <= 15,
    { x: r2(v.x), z: r2(v.z), yaw: r2(p.yaw), clear: ok, slid, onOcean, onCross, along, inside, road });
}
for (const [k, car] of Object.entries(SAVED)) roadCheck(`2 Your Car (riding, saved: ${k})`, 'car', { ...base, car });
roadCheck('3 Ocean Drive (riding)', 'hotels', base);
roadCheck('5 11th Street (riding)', 'crossing', base);
roadCheck('7 The Convertible (riding another car)', 'hero', base);
roadCheck('7 The Convertible (riding it: home to its bay)', 'hero', { ...base, riding: 'hero' }, 'hero');

// --- keys: 1-0 are not bound anywhere else in src/
{
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
  walk(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const clash = files.filter((f) => !f.endsWith('fasttravel.js') && /['"](Digit\d|Numpad\d)['"]|e\.key\s*===\s*['"]\d['"]/.test(readFileSync(f, 'utf8')));
  check('1-0 are free keys', clash.length === 0, { clash });
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
