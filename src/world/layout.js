// Shared layout constants (meters, y up).
// +x = east (ocean), -x = west (hotels), -z = north, +z = south.

export const BLOCK = { zMin: -70, zMax: 70 };
// How far the street / beach visually continue north and south of the block.
export const WORLD_Z = 2500;

export const HOTEL = {
  frontX: -30,        // main facade line
  maxSetback: 3,      // some facades step back up to 3 m
  patioX: -28,        // porches / patios may come forward to here
  backX: -55,
};

export const CURB_HEIGHT = 0.15;

export const SIDEWALK_W = { x0: -30, x1: -24 };   // hotel-side sidewalk
export const PARKING = { x0: -24, x1: -21.5 };
export const LANES = { x0: -21.5, x1: -14.5, centerX: -18 };
export const SIDEWALK_E = { x0: -14.5, x1: -10 }; // park-side sidewalk
export const PARK = { x0: -10, x1: 12, promenadeX: 0, wallX: 12 };
export const SAND = { x0: 12, waterline: 90 };
// Mean sea level sits 1 m below the street (park/beach crest are ~1.5 m above the
// water), so the sea reads as a band below the horizon from the park.
export const SEA_LEVEL = -1.0;
export const OCEAN = { x0: 86, y: SEA_LEVEL };

export const CAR = { x: -22.75, z: 8 };
export const CROSSWALK_Z = -10;

// Road surface height: crowned (cambered) at the centre line, draining to both gutters.
export const ROAD_CROWN = 0.09;
export function roadHeight(x) {
  const c = LANES.centerX;
  const w = x < c ? c - PARKING.x0 : LANES.x1 - c;
  const t = Math.min(1, Math.abs(x - c) / w);
  return ROAD_CROWN * (1 - t * t);
}
export const TOWER = { x: 45, z: 5, deckHeight: 2.7 };
// Lifeguard towers along the extended beach (the first is the original one).
export const TOWERS = [
  TOWER,
  { x: 45, z: -200, deckHeight: 2.7, palette: 'lime' },
  { x: 45, z: 200, deckHeight: 2.7, palette: 'sunset' },
];

// The walkable, fully detailed district: the original block plus 2-3 blocks each way.
export const DISTRICT = { zMin: -340, zMax: 340 };

// Cross streets meeting Ocean Drive from the west (T intersections; the park is east).
// hw: roadway half width, gap: half the gap between the hotel rows, R: curb-return
// radius, xw0..xw1: the crosswalk over the cross street along the hotel sidewalk.
export const CROSS = { hw: 5.5, gap: 9, R: 1.8, xw0: -29.6, xw1: -26.0, rampRun: 1.3, crown: 0.06 };
export const CROSS_STREETS = [
  ...[-850, -740, -630, -520, -410].map((z) => ({ z, far: true })),
  { z: -300, name: '12 ST' }, { z: -190, name: '11 ST', signal: true }, { z: -79, name: '10 ST' },
  { z: 79, name: '8 ST' }, { z: 190, name: '7 ST' }, { z: 300, name: '6 ST' },
  ...[410, 520, 630, 740, 850].map((z) => ({ z, far: true })),
];
// Ocean Drive crosswalk legs north / south of a cross street: [z0, z1]
export function crossLegs(zc) {
  const e = CROSS.hw + CROSS.R;
  return [[zc - e - 4.2, zc - e - 0.2], [zc + e + 0.2, zc + e + 4.2]];
}
export function crossStreetAt(z, pad = 0) {
  for (const c of CROSS_STREETS) if (Math.abs(z - c.z) < CROSS.gap + pad) return c;
  return null;
}
// Cross-street pavement height (crowned along its centre line, flat where it meets
// Ocean Drive's gutter).
export function crossRoadHeight(x, dz) {
  const t = Math.min(1, Math.abs(dz) / CROSS.hw);
  const fade = Math.min(1, Math.max(0, (SIDEWALK_W.x1 - x) / 4));
  return CROSS.crown * (1 - t * t) * fade;
}
// Walk height on the hotel side where a cross street cuts the sidewalk; null elsewhere.
function crossGround(x, z) {
  const c = crossStreetAt(z);
  if (!c) return null;
  const dz = z - c.z, adz = Math.abs(dz), { hw, R, xw0, xw1, rampRun } = CROSS;
  if (adz < hw) return crossRoadHeight(x, dz);
  if (adz < hw + R && x > SIDEWALK_W.x1 - R) {
    // curb return: road outside the quarter circle
    const cx = SIDEWALK_W.x1 - R, cz = c.z + Math.sign(dz) * (hw + R);
    if (Math.hypot(x - cx, z - cz) > R) return 0;
  }
  if (x > xw0 && x < xw1 && adz < hw + rampRun) return CURB_HEIGHT * (adz - hw) / rampRun;   // curb ramp
  return null;
}

export const EYE_HEIGHT = 1.7;

// Sun: compass azimuth (0 = north, 90 = east) and elevation above horizon.
export const SUN = { azimuthDeg: 100, elevationDeg: 7 };

export function compassToDir(azimuthDeg, elevationDeg, target) {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  target.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  return target;
}

// Sand surface height: slightly raised behind the park wall, sloping gently to the water.
export function sandHeight(x) {
  if (x < SAND.x0) return CURB_HEIGHT;
  if (x < SAND.waterline - 4) {
    const t = (x - SAND.x0) / (SAND.waterline - 4 - SAND.x0);
    return 0.55 - (0.55 - (SEA_LEVEL + 0.1)) * t;
  }
  // beach face steepens into the water
  const t = (x - (SAND.waterline - 4)) / 26;
  return SEA_LEVEL + 0.1 - 1.6 * Math.min(1, t) * Math.min(1, t) - 0.2 * Math.max(0, t - 1);
}

// x where the beach face meets mean sea level
export const SHORE_X = (() => {
  let x = SAND.waterline - 10;
  while (sandHeight(x) > SEA_LEVEL && x < SAND.waterline + 30) x += 0.05;
  return x;
})();

// The shore break: small sunrise waves spill here, a few metres off the shoreline.
export const BREAK_X = SHORE_X + 2.5;
// Highest swash reach (the wet/dry line sits just above it).
export const SWASH_MAX = 5.5;
export const WET_LINE_X = BREAK_X - SWASH_MAX - 0.6;

// Low mounds and wind undulations on the dry beach (m). Zero at the park wall, in the
// swash zone and far along the shore (where the low-res sand takes over).
export const SAND_DETAIL_Z = 340;
export function sandDetail(x, z) {
  const fade = smooth(SAND.x0 + 0.6, SAND.x0 + 4, x) * (1 - smooth(WET_LINE_X - 6, WET_LINE_X - 1, x))
    * (1 - smooth(SAND_DETAIL_Z - 40, SAND_DETAIL_Z, Math.abs(z)));
  if (fade <= 0) return 0;
  const h = 0.05 * Math.sin(x * 0.21 + Math.sin(z * 0.05) * 1.7) * Math.sin(z * 0.13 + x * 0.04)
    + 0.03 * Math.sin(x * 0.61 + z * 0.23 + 1.3) * Math.sin(z * 0.37 - x * 0.19)
    + 0.012 * Math.sin(x * 1.7 + z * 0.9) * Math.sin(z * 1.3 - x * 0.7 + 2.1);
  return h * fade;
}
function smooth(a, b, v) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Walkable ground height used by the camera (beach.js adds the tower deck and stairs).
export function groundHeight(x, z) {
  if (x < SIDEWALK_W.x1) return crossGround(x, z) ?? CURB_HEIGHT;
  if (x < LANES.x1) return roadHeight(x);
  if (x < SAND.x0) return CURB_HEIGHT;
  return sandHeight(x) + sandDetail(x, z);   // (under the sea: the seabed you wade on)
}
