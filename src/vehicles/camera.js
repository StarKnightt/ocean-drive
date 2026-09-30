// Third-person chase camera for the cars: a spring arm behind and above the car whose yaw
// follows the direction of travel with a lag (so a drift shows the car's side), the look
// offset from the mouse / drag orbiting round it, a wider field of view with speed, and an
// arm that shortens rather than pass through a facade, wall or parked car (thin posts and
// palm trunks are ignored so the view doesn't jitter along a row of them).
import * as THREE from 'three';

const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _m = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createChaseCamera() {
  let yaw = null, len = 6, pitch = 0;
  const st = { x: 0, y: 0, z: 0 };
  return {
    reset() { yaw = null; },
    // v: the sim vehicle; rel / look pitch: the rider's look offset; grid: world.grid (boxes);
    // out: camera; returns the fov to use
    update(v, dt, { rel = 0, lookPitch = 0, grid = null, camera, groundAt = null }) {
      const S = v.spec, L = S.length ?? 4.8;
      const arm = 1.05 * L + 1.3, height = 1.55 + 0.35 * ((S.width ?? 1.8) - 1.6) + 0.12 * L;
      // heading: the velocity's once moving, else the car's (forward is -sin yaw, -cos yaw)
      const sp = Math.hypot(v.vx, v.vz);
      const moveYaw = sp > 1 ? Math.atan2(-v.vx, -v.vz) : v.yaw;
      const want = v.lon < -0.5 ? v.yaw : wrap(v.yaw + wrap(moveYaw - v.yaw) * Math.min(1, sp / 6));
      if (yaw === null) yaw = v.yaw;
      yaw = wrap(yaw + wrap(want - yaw) * (1 - Math.exp(-dt * 3.2)));
      pitch += (lookPitch - pitch) * (1 - Math.exp(-dt * 8));
      const a = yaw + rel;
      const tx = v.x, ty = v.bodyY + 1.05, tz = v.z;
      // arm: behind (the back of heading a is +sin a, +cos a), up by the height, tilted by the look
      const tilt = THREE.MathUtils.clamp(-pitch, -0.35, 0.9);
      let want2 = arm;
      const bx = Math.sin(a), bz = Math.cos(a);
      if (grid) {
        // six samples along the arm against the static boxes and the thick circles
        for (let i = 1; i <= 6; i++) {
          const d = (arm * i) / 6;
          const px = tx + bx * d * Math.cos(tilt * 0.5), pz = tz + bz * d * Math.cos(tilt * 0.5), py = ty + height * (d / arm) + Math.sin(tilt) * d * 0.5;
          const hit = grid.query(px - 0.3, pz - 0.3, px + 0.3, pz + 0.3, (q) => {
            if (q.min) return q.max.y > py - 0.3 && q.min.y < py + 0.3 && px > q.min.x - 0.3 && px < q.max.x + 0.3 && pz > q.min.z - 0.3 && pz < q.max.z + 0.3;
            return q.r >= 0.3 && (px - q.x) ** 2 + (pz - q.z) ** 2 < (q.r + 0.3) ** 2;
          });
          if (hit) { want2 = Math.max(1.6, (arm * (i - 1)) / 6); break; }
        }
      }
      // shorten at once, lengthen slowly
      len = want2 < len ? want2 : len + (want2 - len) * (1 - Math.exp(-dt * 1.5));
      const k = len / arm;
      let cx = tx + bx * len * Math.cos(tilt * 0.5), cz = tz + bz * len * Math.cos(tilt * 0.5);
      let cy = ty + height * k + Math.sin(tilt) * len * 0.5;
      if (groundAt) cy = Math.max(cy, groundAt(cx, cz) + 0.35);
      // a little smoothing on the camera point itself (the sim steps at the frame rate)
      const f = 1 - Math.exp(-dt * 18);
      st.x += (cx - st.x) * (st.init ? f : 1); st.y += (cy - st.y) * (st.init ? f : 1); st.z += (cz - st.z) * (st.init ? f : 1);
      st.init = true;
      camera.position.set(st.x, st.y, st.z);
      _t.set(tx, ty + 0.35 - Math.sin(tilt) * 0.6, tz);
      _m.lookAt(camera.position, _t, _up);
      camera.quaternion.setFromRotationMatrix(_m);
      return 60 + Math.min(1, Math.abs(v.lon) / 30) * 12;
    },
    snap() { st.init = false; },
  };
}
