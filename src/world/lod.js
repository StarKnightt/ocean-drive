// Distance culling for the extended district: per-block objects are shown only while the
// viewer is within a tier-dependent distance of their z range (frustum culling handles the
// rest). Objects register with a kind:
//   'detail' - small parts of a block (window frames, furniture, patios, street furniture)
//   'cars'   - parked-car rows
// plus update hooks (palm crown LOD). updateLod(camera) returns true when something changed.
import { QUALITY } from '../quality.js';

const RADIUS = {
  high: { detail: 170, cars: 260, palmNear: 150 },
  medium: { detail: 130, cars: 190, palmNear: 110 },
  low: { detail: 80, cars: 120, palmNear: 70 },
};
export const LOD = RADIUS[QUALITY.tier] ?? RADIUS.high;

const items = [];
const hooks = [];
let lastZ = NaN;

export function registerLod(obj, z0, z1, kind) {
  items.push({ obj, z0: Math.min(z0, z1), z1: Math.max(z0, z1), r: LOD[kind] ?? LOD.detail });
}
// fn(cameraPosition) -> true if it changed anything
export function registerLodHook(fn) { hooks.push(fn); }

export function updateLod(camera) {
  const z = camera.position.z;
  if (Math.abs(z - lastZ) < 2) return false;
  lastZ = z;
  let changed = false;
  for (const it of items) {
    const d = Math.max(0, it.z0 - z, z - it.z1);
    const v = d < it.r;
    if (it.obj.visible !== v) { it.obj.visible = v; changed = true; }
  }
  for (const fn of hooks) if (fn(camera.position)) changed = true;
  return changed;
}
window.__lod = { items, LOD };
