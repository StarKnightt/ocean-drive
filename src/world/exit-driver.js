// A traffic car's driver getting out when the player takes the car (vehicles/index.js, at a
// stopped car's driver door): the seated body is lifted out of the seat onto the road beside
// the door (drive_car crossfading to standing, 0.9 s), turns and waves at the new driver, then
// walks off: round the end of the car if the nearer sidewalk is on its far side, over to that
// sidewalk and along it, away from the player. Released once far away and out of view.
// No struggle, no hurry: the tone is "borrowing".
import * as THREE from 'three';
import { SIDEWALK_W, SIDEWALK_E } from './layout.js';
import { contactTexture } from './crowd.js';

const EXIT_T = 0.9, R = 0.3;
// the driver's door swinging open while they climb out and shut behind them (the bodies have
// no door node: a painted panel with its window frame, hinged at the door's front edge)
const DOOR = { len: 1.05, open: 1.05, openT: 0.35, shutAt: EXIT_T + 0.5, shutT: 0.3 };
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (t) => t * t * (3 - 2 * t);

export function createExitDrivers(scene, { heightAt, max = 3 } = {}) {
  const live = [];
  // a fixed pool of collider circles (the walker and the vehicles see them; r 0 when unused)
  const colliders = Array.from({ length: max }, () => ({ x: 0, z: 0, r: 0, person: true }));
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere();
  // a contact patch under each one on foot, and a door panel per slot
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x0c0806, map: contactTexture(), transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const shadowGeo = new THREE.PlaneGeometry(0.62, 0.7).rotateX(-Math.PI / 2);
  const panelGeo = new THREE.BoxGeometry(0.05, 0.62, DOOR.len).translate(0, 0.31, DOOR.len / 2);
  const frameGeo = new THREE.BoxGeometry(0.035, 0.4, DOOR.len * 0.8).translate(0, 0.62 + 0.2, DOOR.len * 0.45);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2226, roughness: 0.08, metalness: 0.6, transparent: true, opacity: 0.55 });
  const pool = Array.from({ length: max }, () => {
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.renderOrder = 1; shadow.visible = false;
    const paint = new THREE.MeshStandardMaterial({ color: 0xb9bcbf, roughness: 0.3, metalness: 0.35 });
    const door = new THREE.Group();
    const panel = new THREE.Mesh(panelGeo, paint);
    panel.castShadow = true;
    door.add(panel, new THREE.Mesh(frameGeo, glassMat));
    door.visible = false;
    scene.add(shadow, door);
    return { shadow, door, paint, D: null };
  });

  // info: { P, matrix (the body root's world matrix in the seat), drive (its drive_car action) },
  // car: { x, z, yaw, len, width }, door: { x, z }, face: () => { x, z } (whom to wave at)
  function start(info, car, door, face) {
    if (!info?.P) return null;
    if (live.length >= max) finish(live[0]);
    const P = info.P;
    info.matrix.decompose(_p, _q, _s);
    scene.add(P.root);
    P.home = scene;
    P.root.position.copy(_p);
    P.root.quaternion.copy(_q);
    P.root.scale.copy(_s);
    P.setVisible(true);
    P.setLevel(0);
    _e.setFromQuaternion(_q, 'YXZ');
    const fem = !!P.asset.fem;
    const stand = P.action('idle_standing') ?? P.action('idle_breathing');
    const wave = P.action('wave');
    const walk = P.action(fem ? 'walk_casual_f' : 'walk_casual_m') ?? P.action('walk_casual_m');
    for (const a of [stand, wave, walk]) if (a) { a.reset().play(); a.setEffectiveWeight(0); }
    // out beside the door, a step clear of the body
    const ox = door.x - car.x, oz = door.z - car.z, ol = Math.hypot(ox, oz) || 1;
    const out = { x: door.x + (ox / ol) * 0.35, z: door.z + (oz / ol) * 0.35 };
    // the nearer sidewalk, and the way along it away from whoever took the car
    const f = face();
    const sideE = Math.abs(out.x - SIDEWALK_E.x0) < Math.abs(out.x - SIDEWALK_W.x1);
    const walkX = sideE ? (SIDEWALK_E.x0 + SIDEWALK_E.x1) / 2 - 0.8 : (SIDEWALK_W.x0 + SIDEWALK_W.x1) / 2 + 1.5;
    // (behind the car: out of the way of where its new driver will take it)
    const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
    const away = Math.sign(-fz) || Math.sign(out.z - f.z) || 1;
    const pts = [];
    // (the sidewalk across the car: round its end first)
    if (Math.sign(walkX - car.x) !== Math.sign(out.x - car.x)) pts.push({ x: out.x, z: car.z + away * (car.len / 2 + 1.2) });
    pts.push({ x: walkX, z: (pts[0]?.z ?? out.z) + away * 2.5 }, { x: walkX, z: out.z + away * 90 });
    const D = {
      P, stand, wave, walk, drive: info.drive, phase: 'exit', t: 0,
      p0: P.root.position.clone(), yaw0: _e.y, out, pts, face, speed: 0,
      walkSpeed: walk ? P.speedOf(walk.getClip().name) : 1.3,
      reactT: 1.2 + Math.random() * 0.6, x: out.x, z: out.z, heading: Math.atan2(ox, oz), col: colliders.find((c) => !live.some((d) => d.col === c)),
    };
    // the door: hinged at its front edge on the driver's side, painted as the car
    const slot = pool.find((q) => !q.D);
    if (slot) {
      slot.D = D; D.slot = slot;
      const along = ox * fx + oz * fz;
      let nx = ox - along * fx, nz = oz - along * fz;
      const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      const side = (car.width ?? 1.9) / 2 + 0.03;
      D.hinge = { x: car.x + nx * side + fx * (along + 0.55), z: car.z + nz * side + fz * (along + 0.55), fx, fz, nx, nz };
      slot.paint.color.setHex(car.color ?? 0xb9bcbf);
      slot.door.position.set(D.hinge.x, heightAt(D.hinge.x, D.hinge.z) + 0.32, D.hinge.z);
      slot.shadow.visible = true;
    }
    live.push(D);
    return D;
  }

  function poseDoor(D) {
    const s = D.slot, h = D.hinge;
    if (!s || !h) return;
    const t = D.age;
    const k = t < DOOR.shutAt ? smooth(Math.min(1, t / DOOR.openT)) : 1 - smooth(Math.min(1, (t - DOOR.shutAt) / DOOR.shutT));
    s.door.visible = k > 0.02;
    if (!s.door.visible) return;
    const a = k * DOOR.open, dx = -h.fx * Math.cos(a) + h.nx * Math.sin(a), dz = -h.fz * Math.cos(a) + h.nz * Math.sin(a);
    s.door.rotation.set(0, Math.atan2(dx, dz), 0);
  }

  function finish(D) {
    const i = live.indexOf(D);
    if (i >= 0) live.splice(i, 1);
    D.P.mixer.stopAllAction();
    D.P.root.removeFromParent();
    D.P.home = null;
    if (D.col) D.col.r = 0;
    if (D.slot) { D.slot.D = null; D.slot.door.visible = false; D.slot.shadow.visible = false; D.slot = null; }
  }

  function weights(D, w) {
    if (D.drive) D.drive.setEffectiveWeight(w.drive ?? 0);
    D.stand?.setEffectiveWeight(w.stand ?? 0);
    D.wave?.setEffectiveWeight(w.wave ?? 0);
    D.walk?.setEffectiveWeight(w.walk ?? 0);
  }

  function update(dt, camera) {
    if (!live.length) return;
    if (camera) { pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm); }
    for (const D of [...live]) {
      D.t += dt;
      D.age = (D.age ?? 0) + dt;
      poseDoor(D);
      const r = D.P.root;
      if (D.phase === 'exit') {
        // from the seat up, out and down onto the road beside the door
        const k = Math.min(1, D.t / EXIT_T), s = smooth(k);
        const gy = heightAt(D.out.x, D.out.z);
        r.position.set(THREE.MathUtils.lerp(D.p0.x, D.out.x, s), THREE.MathUtils.lerp(D.p0.y, gy, s) + Math.sin(Math.PI * k) * 0.12, THREE.MathUtils.lerp(D.p0.z, D.out.z, s));
        D.heading = D.yaw0 + wrap(Math.atan2(D.out.x - D.p0.x, D.out.z - D.p0.z) - D.yaw0) * smooth(Math.min(1, k * 1.6));
        weights(D, { drive: 1 - s, stand: s });
        if (k >= 1) { D.phase = 'react'; D.t = 0; }
      } else if (D.phase === 'react') {
        // turn to the car's new driver and wave
        const f = D.face();
        const want = Math.atan2(f.x - D.x, f.z - D.z);
        D.heading += wrap(want - D.heading) * (1 - Math.exp(-dt * 5));
        const w = smooth(Math.min(1, D.t / 0.3)) * (1 - smooth(Math.max(0, Math.min(1, (D.t - D.reactT + 0.3) / 0.3))));
        weights(D, { stand: 1 - w, wave: w });
        if (D.t >= D.reactT) { D.phase = 'walk'; D.t = 0; }
      } else {
        const tgt = D.pts[0];
        if (tgt) {
          const dx = tgt.x - D.x, dz = tgt.z - D.z, d = Math.hypot(dx, dz);
          D.speed += ((d < 0.3 && D.pts.length === 1 ? 0 : 1.3) - D.speed) * (1 - Math.exp(-dt * 2.5));
          if (d < 0.6 && D.pts.length > 1) D.pts.shift();
          else if (d > 1e-3) {
            const st = Math.min(d, D.speed * dt);
            D.x += (dx / d) * st; D.z += (dz / d) * st;
            D.heading += wrap(Math.atan2(dx, dz) - D.heading) * (1 - Math.exp(-dt * 4));
          }
        }
        const w = smooth(Math.min(1, D.speed / 0.6));
        weights(D, { stand: 1 - w, walk: w });
        if (D.walk) D.walk.timeScale = THREE.MathUtils.clamp(D.speed / D.walkSpeed, 0.5, 1.4);
        r.position.set(D.x, heightAt(D.x, D.z), D.z);
        // released far away and out of view (or after a minute)
        const far = camera ? Math.hypot(camera.position.x - D.x, camera.position.z - D.z) : 0;
        sph.center.set(D.x, r.position.y + 0.9, D.z); sph.radius = 1.2;
        if ((far > 60 && !frustum.intersectsSphere(sph)) || D.t > 70 || far > 160) { finish(D); continue; }
      }
      D.x = r.position.x; D.z = r.position.z;
      r.rotation.set(0, D.heading, 0);
      if (D.slot) {
        // (the patch fades in as the feet come down to the road)
        const sh = D.slot.shadow, on = D.phase === 'exit' ? smooth(Math.min(1, D.t / EXIT_T)) : 1;
        sh.position.set(D.x, heightAt(D.x, D.z) + 0.012, D.z);
        sh.rotation.y = D.heading;
        sh.scale.setScalar(Math.max(0.01, on));
      }
      D.P.mixer.update(dt);
      if (D.col) { D.col.x = D.x; D.col.z = D.z; D.col.r = D.phase === 'exit' ? 0 : R; }
    }
  }

  return {
    colliders, update, start,
    get live() { return live; },
    // for the traffic sim: people on foot in the lanes (cars wait for them)
    obstacles(out) { for (const D of live) if (D.phase !== 'exit') out.push({ x: D.x, z: D.z, r: 0.35, v: 0, vx: 0, vz: 0 }); return out; },
    state: () => live.map((D) => ({ phase: D.phase, x: +D.x.toFixed(2), z: +D.z.toFixed(2), heading: +D.heading.toFixed(2), speed: +D.speed.toFixed(2) })),
  };
}
