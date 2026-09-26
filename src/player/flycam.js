// Minimal first-person camera: pointer-lock mouse look, WASD, walk or fly.
// Full walking (collisions, stairs, footsteps) comes with the player system.
import * as THREE from 'three';
import { EYE_HEIGHT, groundHeight } from '../world/layout.js';

export class FlyCam {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.yaw = 0;
    this.pitch = 0;
    this.fly = false;
    this.keys = new Set();
    this.locked = false;
    camera.rotation.order = 'YXZ';

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -1.5, 1.5);
    });
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyF') this.fly = !this.fly;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  lock() { this.dom.requestPointerLock(); }

  // Compass heading: 0 = north (-z), 90 = east (+x). Pitch positive = up.
  set(x, y, z, headingDeg, pitchDeg) {
    this.camera.position.set(x, y, z);
    this.yaw = -THREE.MathUtils.degToRad(headingDeg);
    this.pitch = THREE.MathUtils.degToRad(pitchDeg);
    this.apply();
  }

  apply() {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  update(dt) {
    const k = this.keys;
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 3.2 : 1) * (this.fly ? 10 : 1.5);
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const p = this.camera.position;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    p.x += (-sy * f + cy * r) * speed * dt;
    p.z += (-cy * f - sy * r) * speed * dt;
    if (this.fly) {
      const u = (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') || k.has('ControlLeft') ? 1 : 0);
      p.y += u * speed * dt;
    } else if (this.locked) {
      p.y = groundHeight(p.x, p.z) + EYE_HEIGHT;
    }
    this.apply();
  }
}
