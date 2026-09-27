// First-person walker: pointer-lock mouse look (drag-to-look fallback), WASD with smooth
// acceleration, ground following over curbs, sand, seawall steps and the lifeguard tower
// stairs, circle-vs-box/circle collisions, head bob and sway synced to the step cycle.
import * as THREE from 'three';
import { EYE_HEIGHT, SEA_LEVEL } from '../world/layout.js';

const WALK = 1.4, STROLL = 2.6;         // m/s
const RADIUS = 0.3;
const STEP_UP = 0.46;                   // highest ledge that can be stepped onto
const MAX_WADE = 0.5;                   // deepest water the walker goes into
const BOB = 0.025;                      // m, vertical head bob at walking pace

export class Walker {
  // world: { heightAt(x, z, currentY), boxes: [{min,max}], circles: [{x,z,r}], bounds: {x0,x1,z0,z1} }
  constructor(camera, dom, world) {
    this.camera = camera;
    this.dom = dom;
    this.world = world;
    this.yaw = 0;
    this.pitch = 0;
    this.pos = new THREE.Vector2();     // feet x, z
    this.feetY = 0;
    this.vel = new THREE.Vector2();
    this.keys = new Set();
    this.virtualKeys = null;            // set by simulate()
    this.locked = false;
    this.active = false;                // walking enabled (locked, or ?autostart / drag mode)
    this.stepDist = 0;
    this.phase = 0;                     // step cycle (radians, pi per step)
    this.bobAmp = 0;
    this.onStep = null;                 // (info) => {}
    this.onLockChange = null;
    this.onLockError = null;
    this.dragLook = false;
    camera.rotation.order = 'YXZ';

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      if (this.locked) this.dragLook = false;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      // no pointer lock (iframe, browser policy): walk anyway, look by dragging
      this.dragLook = true;
      this.onLockError?.();
    });
    let dragging = false;
    dom.addEventListener('mousedown', () => { dragging = true; });
    window.addEventListener('mouseup', () => { dragging = false; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked && !(this.dragLook && dragging)) return;
      const k = this.locked ? 0.0021 : 0.004;
      this.yaw -= e.movementX * k;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * k, -1.48, 1.48);   // +-85 deg
    });
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  lock() {
    try {
      const r = this.dom.requestPointerLock();
      if (r && r.catch) r.catch(() => { this.dragLook = true; this.onLockError?.(); });
    } catch {
      this.dragLook = true;
      this.onLockError?.();
    }
  }

  // Harness / teleport. Compass heading: 0 = north (-z), 90 = east (+x). y = eye height.
  set(x, y, z, headingDeg, pitchDeg) {
    this.pos.set(x, z);
    this.feetY = y - EYE_HEIGHT;
    this.vel.set(0, 0);
    this.yaw = -THREE.MathUtils.degToRad(headingDeg);
    this.pitch = THREE.MathUtils.degToRad(pitchDeg);
    this.bobAmp = 0;
    this.camera.position.set(x, y, z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
  // put the walker on the walkable surface at (x, z) (currentY picks deck vs ground)
  teleport(x, z, headingDeg = this.heading, pitchDeg = THREE.MathUtils.radToDeg(this.pitch), currentY = -Infinity) {
    const g = this.world.heightAt(x, z, currentY);
    this.set(x, g + EYE_HEIGHT, z, headingDeg, pitchDeg);
  }
  get heading() { return -THREE.MathUtils.radToDeg(this.yaw); }

  key(...codes) { const k = this.virtualKeys ?? this.keys; return codes.some((c) => k.has(c)); }

  update(dt) {
    dt = Math.min(dt, 0.05);
    if (!(dt > 0)) return;
    const moving = this.active || this.virtualKeys;
    const f = moving ? (this.key('KeyW', 'ArrowUp') ? 1 : 0) - (this.key('KeyS', 'ArrowDown') ? 1 : 0) : 0;
    const r = moving ? (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0) : 0;
    const fast = this.key('ShiftLeft', 'ShiftRight');
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let tx = -sy * f + cy * r, tz = -cy * f - sy * r;
    const tl = Math.hypot(tx, tz);
    const speed = fast ? STROLL : WALK;
    if (tl > 0) { tx = (tx / tl) * speed; tz = (tz / tl) * speed; }
    // smooth acceleration, quicker to stop than to start
    const a = 1 - Math.exp(-dt * (tl > 0 ? 6 : 9));
    this.vel.x += (tx - this.vel.x) * a;
    this.vel.y += (tz - this.vel.y) * a;
    if (this.vel.lengthSq() < 1e-6) this.vel.set(0, 0);

    const before = this.pos.clone();
    this.move(this.vel.x * dt, this.vel.y * dt);
    const moved = this.pos.distanceTo(before);
    const v = moved / dt;
    if (moved < this.vel.length() * dt * 0.3) this.vel.multiplyScalar(0.5);   // pushing into a wall

    // ground following: step up quickly, settle down a little softer
    const g = this.world.heightAt(this.pos.x, this.pos.y, this.feetY);
    const k = g > this.feetY ? 16 : 11;
    this.feetY += (g - this.feetY) * (1 - Math.exp(-dt * k));
    if (Math.abs(g - this.feetY) < 0.002) this.feetY = g;

    // step cycle: stride from distance walked
    const stride = v > 2.0 ? 0.95 : 0.75;
    this.bobAmp += ((v > 0.2 ? Math.min(1, v / WALK) : 0) - this.bobAmp) * (1 - Math.exp(-dt * 5));
    if (v > 0.2) {
      this.phase += (moved / stride) * Math.PI;
      this.stepDist += moved;
      if (this.stepDist >= stride) {
        this.stepDist -= stride;
        this.onStep?.({ x: this.pos.x, z: this.pos.y, feetY: this.feetY, speed: v });
      }
    } else if (this.stepDist > 0) {
      this.stepDist = Math.max(0, this.stepDist - dt * 0.5);   // next step comes promptly when walking resumes
    }
    this.apply();
  }

  apply() {
    // head bob: lowest at each foot strike, small lateral sway and roll with the stride
    const b = this.bobAmp;
    const bob = -BOB * b * (1 - Math.abs(Math.sin(this.phase)));
    const sway = 0.012 * b * Math.sin(this.phase * 0.5);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    this.camera.position.set(this.pos.x + cy * sway, this.feetY + EYE_HEIGHT + bob, this.pos.y - sy * sway);
    this.camera.rotation.set(this.pitch + 0.004 * b * Math.sin(this.phase * 2), this.yaw, 0.0035 * b * Math.sin(this.phase * 0.5));
  }

  // Move with sliding collisions (axis-separated, then push-out).
  move(dx, dz) {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.1));
    for (let i = 0; i < steps; i++) {
      this.tryAxis(dx / steps, 0);
      this.tryAxis(0, dz / steps);
    }
  }

  tryAxis(dx, dz) {
    const nx = this.pos.x + dx, nz = this.pos.y + dz;
    if (this.blocked(nx, nz)) return false;
    this.pos.set(nx, nz);
    return true;
  }

  blocked(x, z) {
    const W = this.world, b = W.bounds;
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return true;
    const g = W.heightAt(x, z, this.feetY);
    if (g - this.feetY > STEP_UP) return true;
    if (SEA_LEVEL - g > MAX_WADE) return true;
    const feet = this.feetY, head = feet + 1.8;
    for (const c of W.circles) {
      const dx = x - c.x, dz = z - c.z, rr = RADIUS + c.r;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    for (const q of W.boxes) {
      if (q.max.y < feet + 0.05 || q.min.y > head) continue;  // below the feet, or overhead
      const cx = Math.max(q.min.x, Math.min(x, q.max.x)), cz = Math.max(q.min.z, Math.min(z, q.max.z));
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < RADIUS * RADIUS) return true;
    }
    return false;
  }

  // Test hook: hold `keys` for `seconds` of simulated time. Returns the path.
  simulate(keys, seconds, dt = 1 / 60) {
    this.virtualKeys = new Set(keys);
    const log = [];
    for (let t = 0; t < seconds; t += dt) {
      this.update(dt);
      if (log.length === 0 || t - log[log.length - 1].t >= 0.25) log.push({ t, x: +this.pos.x.toFixed(2), z: +this.pos.y.toFixed(2), y: +this.feetY.toFixed(3) });
    }
    this.virtualKeys = null;
    return log;
  }
}
