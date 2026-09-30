// On-foot third-person camera: over the right shoulder, about 3 m back and 1.7 m up at a level
// look, orbiting round the body with the mouse / drag look (walker.yaw / pitch; the walker
// moves relative to it). The arm shortens at once against facades, walls, the seawall and cars
// and lengthens again slowly (vehicles/camera.js), rising a little over the head when it is
// short; the shoulder offset pulls in the same way by a wall at the side. Palm trunks and
// posts don't shorten it (one close behind would put the camera in the body's back): the
// camera slides round them instead. It never goes under the ground or the sea. blendFrom()
// eases in from wherever the camera was (the first-person eye, a car's view); blendOnto()
// eases a first-person camera in from the third-person one.
import * as THREE from 'three';
import { armBlocked, armLength } from '../vehicles/camera.js';
import { SEA_LEVEL } from '../world/layout.js';

export const TP = { arm: 3.0, height: 1.35, lift: 0.35, side: 0.4, pad: 0.22, thick: 0.6, pitchMin: -1.05, pitchMax: 0.5 };
const N = 12;          // samples along the arm
const THIN_PAD = 0.3;  // m kept from a trunk or post

export function createFootCamera({ grid, groundAt, extra = () => [] }) {
  let len = TP.arm, side = TP.side, pivotY = null, blend = null;
  const P = new THREE.Vector3(), C = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
  const blocked = (x, y, z) => {
    if (armBlocked(grid, x, y, z, TP.pad, TP.thick)) return true;
    // (the live cars standing about: circles along their length, up to the roof)
    for (const c of extra()) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + TP.pad) ** 2 && y < groundAt(c.x, c.z) + 1.6) return true;
    return false;
  };
  // out of any trunk or post round the camera point: pushed out radially
  let thin = null;
  const pushThin = (q) => {
    if (q.min || q.r >= TP.thick || q.r <= 0) return false;
    const dx = C.x - q.x, dz = C.z - q.z, d = Math.hypot(dx, dz), R = q.r + THIN_PAD;
    if (d < R) { thin = q; const k = d > 1e-4 ? R / d : 1; C.x = q.x + (d > 1e-4 ? dx : R) * k; C.z = q.z + (d > 1e-4 ? dz : 0) * k; }
    return false;
  };
  function applyBlend(camera, dt) {
    if (!blend) return;
    blend.t += dt / blend.dur;
    const k = Math.min(1, blend.t), s = k * k * (3 - 2 * k);
    camera.position.lerpVectors(blend.pos, camera.position, s);
    camera.quaternion.slerpQuaternions(blend.quat, camera.quaternion, s);
    if (k >= 1) blend = null;
  }
  return {
    get length() { return len; },
    get blending() { return !!blend; },
    get thin() { return thin; },
    blendFrom(camera, dur = 0.45) { blend = { t: 0, dur, pos: camera.position.clone(), quat: camera.quaternion.clone() }; },
    snap() { pivotY = null; len = TP.arm; side = TP.side; },
    // first person with a blend running: ease the walker's eye camera in from the saved pose
    blendOnto(camera, dt) { applyBlend(camera, dt); },
    update(walker, dt, camera) {
      dt = Math.min(dt, 0.1);
      const x = walker.pos.x, z = walker.pos.y;
      const want = walker.feetY + TP.height + walker.airY * 0.45;
      pivotY = pivotY === null ? want : pivotY + (want - pivotY) * (1 - Math.exp(-dt * 12));
      const yaw = walker.yaw, pitch = walker.pitch;
      const cp = Math.cos(pitch), fx = -Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cp;
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      // the shoulder offset, pulled in by a wall at the side
      let sideWant = TP.side;
      for (let i = 1; i <= 3; i++) {
        const d = (TP.side * i) / 3;
        if (blocked(x + rx * d, pivotY, z + rz * d)) { sideWant = (TP.side * (i - 1)) / 3; break; }
      }
      side = armLength(side, sideWant, dt, 3);
      P.set(x + rx * side, pivotY, z + rz * side);
      // the arm back along the look
      let armWant = TP.arm;
      for (let i = 1; i <= N; i++) {
        const d = (TP.arm * i) / N, u = d / TP.arm;
        if (blocked(P.x - fx * d, P.y - fy * d + TP.lift * u, P.z - fz * d)) { armWant = Math.max(0.35, (TP.arm * (i - 1)) / N); break; }
      }
      len = armLength(len, armWant, dt, 2);
      const u = len / TP.arm, rise = 0.45 * (1 - u) ** 2;
      C.set(P.x - fx * len, P.y - fy * len + TP.lift * u, P.z - fz * len);
      if (rise > 0.01 && !blocked(C.x, C.y + rise, C.z)) C.y += rise;
      thin = null;
      grid.query(C.x - 0.9, C.z - 0.9, C.x + 0.9, C.z + 0.9, pushThin);
      // above the ground and the sea
      C.y = Math.max(C.y, groundAt(C.x, C.z) + 0.3, SEA_LEVEL + 0.55);
      camera.position.copy(C);
      camera.quaternion.copy(q.setFromEuler(e.set(pitch, yaw, 0)));
      applyBlend(camera, dt);
    },
  };
}
