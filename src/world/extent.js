// Where the player may go (movement), as opposed to DISTRICT (art density: palms, sand
// detail, crowd). A union of rectangles per quality tier, plus the distance to its edge for
// the soft tapers: the walker's speed taper, the vehicles' top-speed taper and steering bias
// back toward the interior, and the turn-back fade when something ends up outside.
//
// Phase 1 extent: Ocean Drive and the beach to z ±560, the hotel patios as the west line
// (the hotel footprints are colliders beyond it), the near cross streets west to the back
// row (x −90), the sea to the wade limits (x 110; the water depth rules stop things first).
//
// Each rectangle marks which of its sides are soft: the open ends of a road, where the
// tapers apply. The others are hard (a facade row, the sea) or interior (an overlap with
// another rectangle) and only bound movement.
import { HOTEL, CROSS, CROSS_STREETS, LANES } from './layout.js';

export const EDGE_SOFT = { walker: 14, vehicle: 25 };

function rects({ zMax, crossWest }) {
  const out = [{ x0: HOTEL.patioX + 0.2, x1: 110, z0: -zMax, z1: zMax, soft: { z0: true, z1: true }, name: 'ocean-drive' }];
  // the cross-street rectangles reach well into Ocean Drive so a car turning in is always
  // wholly inside one of them
  for (const c of CROSS_STREETS) {
    if (c.far || Math.abs(c.z) > zMax) continue;
    out.push({ x0: crossWest, x1: LANES.centerX, z0: c.z - CROSS.gap, z1: c.z + CROSS.gap, soft: { x0: true }, name: c.name ?? `cross ${c.z}` });
  }
  return out;
}

export const EXTENT = {
  high: { rects: rects({ zMax: 560, crossWest: -90 }) },
  medium: { rects: rects({ zMax: 560, crossWest: -90 }) },
  low: { rects: rects({ zMax: 560, crossWest: -90 }) },
};
const tierOf = (tier) => EXTENT[tier] ?? EXTENT.high;

// signed distance to the edge of the union (m): positive inside. It is the largest inner
// distance over the rectangles, which is exact away from the concave corners and
// conservative (too small) at them.
export function edgeDistance(x, z, tier = 'high') {
  let best = -Infinity;
  for (const r of tierOf(tier).rects) {
    const d = Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z);
    if (d > best) best = d;
  }
  return best;
}

// distance to the nearest soft side (the open road ends), for the tapers: Infinity away
// from them, <= 0 outside the extent
export function softDistance(x, z, tier = 'high') {
  let best = -Infinity;
  for (const r of tierOf(tier).rects) {
    const inner = Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z);
    if (inner < 0) { if (inner > best) best = inner; continue; }
    const s = r.soft;
    let d = Infinity;
    if (s.x0) d = Math.min(d, x - r.x0);
    if (s.x1) d = Math.min(d, r.x1 - x);
    if (s.z0) d = Math.min(d, z - r.z0);
    if (s.z1) d = Math.min(d, r.z1 - z);
    if (d > best) best = d;
  }
  return best;
}

// who: 'walker' | 'vehicle' (the same space today); r: a circle that must fit wholly inside
export function insideWorld(x, z, who = 'walker', r = 0, tier = 'high') {
  return edgeDistance(x, z, tier) >= r;
}

// 0 at a soft edge .. 1 at EDGE_SOFT[who] metres in (for speed tapers)
export function edgeFactor(x, z, who = 'vehicle', tier = 'high') {
  const d = softDistance(x, z, tier) / EDGE_SOFT[who];
  return d <= 0 ? 0 : d >= 1 ? 1 : d * d * (3 - 2 * d);
}

// A steering bias (-1..1, + = right) that turns a vehicle at (x, z) heading yaw back toward
// the interior inside the soft band; 0 further in or when already heading inward. It turns
// the way the vehicle is already angled (the shorter way round).
export function edgeSteer(x, z, yaw, tier = 'high') {
  const soft = EDGE_SOFT.vehicle, d = softDistance(x, z, tier);
  if (!(d < soft)) return 0;
  const e = 0.5;
  const f = (px, pz) => Math.min(soft * 2, softDistance(px, pz, tier));
  const gx = f(x + e, z) - f(x - e, z), gz = f(x, z + e) - f(x, z - e);
  const g = Math.hypot(gx, gz);
  if (g < 1e-6) return 0;
  // forward (-sin yaw, -cos yaw), right (cos yaw, -sin yaw)
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  if ((gx * fx + gz * fz) / g > 0.7) return 0;
  const side = (gx * rx + gz * rz) / g;
  const w = 1 - Math.max(0, d) / soft;
  return Math.max(-1, Math.min(1, (side >= 0 ? 1 : -1) * w * 0.6));
}

// The rectangle that bounds the whole extent (for code that still wants x0/x1/z0/z1).
export function extentBounds(tier = 'high') {
  const b = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const r of tierOf(tier).rects) { b.x0 = Math.min(b.x0, r.x0); b.x1 = Math.max(b.x1, r.x1); b.z0 = Math.min(b.z0, r.z0); b.z1 = Math.max(b.z1, r.z1); }
  return b;
}
