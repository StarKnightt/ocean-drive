// First-person walker: pointer-lock mouse look (drag-to-look fallback), WASD with smooth
// acceleration, ground following over curbs, sand, seawall steps and the lifeguard tower
// stairs, circle-vs-box/circle collisions, head bob and sway synced to the step cycle,
// Space to jump (collisions stay at ground level; soft landing dip).
import * as THREE from 'three';
import { EYE_HEIGHT, SEA_LEVEL } from '../world/layout.js';

const WALK = 1.4, STROLL = 2.6;         // m/s
const RADIUS = 0.3;
const STEP_UP = 0.46;                   // highest ledge that can be stepped onto
const MAX_WADE = 0.5;                   // deepest water the walker goes into
const BOB = 0.025;                      // m, vertical head bob at walking pace
const GRAVITY = 9.8;
const JUMP_V = Math.sqrt(2 * GRAVITY * 0.45);   // 0.45 m apex
const DIP_K = 120;                      // landing dip spring stiffness (1/s^2)

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
    this.stick = null;                  // { x: strafe, y: forward } in [-1, 1], touch joystick
    this.locked = false;
    this.active = false;                // walking enabled (locked, or ?autostart / drag mode)
    this.stepDist = 0;
    this.phase = 0;                     // step cycle (radians, pi per step)
    this.bobAmp = 0;
    this.onStep = null;                 // (info) => {}
    this.onLockChange = null;
    this.onLockError = null;            // ({ dragLook }) => {}, after a failed lock request
    this.dragLook = false;
    this.lockFails = 0;
    this.unlockedAt = -1e9;
    this.promiseLock = false;           // requestPointerLock() returns a promise (errors come through it)
    this.retried = false;
    this.retryTimer = 0;
    this.skipMoves = 0;
    this.airY = 0;                      // feet above the followed ground during a jump
    this.vy = 0;
    this.jumpReq = false;
    this.dip = 0; this.dipV = 0;        // landing dip of the head (spring)
    camera.rotation.order = 'YXZ';

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === dom;
      if (this.locked) { this.dragLook = false; this.lockFails = 0; this.retried = false; this.skipMoves = 2; }
      else if (was) this.unlockedAt = performance.now();
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { if (!this.promiseLock) this.lockFailed(); });
    let dragging = false;
    dom.addEventListener('mousedown', () => { dragging = true; });
    window.addEventListener('mouseup', () => { dragging = false; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked && !(this.dragLook && dragging)) return;
      // the first events after locking, and Chrome's occasional spurious warps, jump the view
      if (this.locked && (this.skipMoves > 0 || Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400)) { this.skipMoves--; return; }
      const k = this.locked ? 0.0021 : 0.004;
      this.yaw -= e.movementX * k;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * k, -1.48, 1.48);   // +-85 deg
    });
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') {
        if (!e.repeat && this.active) this.jumpReq = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  // Call straight from a click handler (needs the user gesture).
  lock() {
    clearTimeout(this.retryTimer);
    const el = this.dom;
    if (this.locked) return;
    if (!el.requestPointerLock) { this.lockFailed(true); return; }
    const plain = () => {
      try {
        const r = el.requestPointerLock();
        if (r?.then) r.catch(() => this.lockFailed());
      } catch { this.lockFailed(); }
    };
    let r;
    try { r = el.requestPointerLock({ unadjustedMovement: true }); } catch { plain(); return; }
    if (r?.then) {
      this.promiseLock = true;
      // raw mouse counts aren't available everywhere: fall back to the ordinary lock
      r.catch((e) => { if (e?.name === 'NotSupportedError') plain(); else this.lockFailed(); });
    }
  }

  lockFailed(unsupported = false) {
    if (this.locked) return;
    // Chrome refuses a re-lock for ~1 s after leaving it with Esc; the click's activation
    // is still valid a moment later, so retry once when that has passed
    const since = performance.now() - this.unlockedAt;
    if (!unsupported && since < 1500 && !this.retried) {
      this.retried = true;
      this.retryTimer = setTimeout(() => this.lock(), Math.max(0, 1150 - since));
      return;
    }
    this.retried = false;
    // a few refusals in a row (iframe, browser policy): walk anyway, look by dragging
    if (unsupported || ++this.lockFails >= 3) this.dragLook = true;
    this.onLockError?.({ dragLook: this.dragLook });
  }

  // Touch input: look by a drag delta (radians), queue a jump.
  look(dYaw, dPitch) {
    this.yaw -= dYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dPitch, -1.48, 1.48);
  }
  jump() { if (this.active) this.jumpReq = true; }

  // Harness / teleport. Compass heading: 0 = north (-z), 90 = east (+x). y = eye height.
  set(x, y, z, headingDeg, pitchDeg) {
    this.pos.set(x, z);
    this.feetY = y - EYE_HEIGHT;
    this.vel.set(0, 0);
    this.yaw = -THREE.MathUtils.degToRad(headingDeg);
    this.pitch = THREE.MathUtils.degToRad(pitchDeg);
    this.bobAmp = 0;
    this.airY = 0; this.vy = 0; this.dip = 0; this.dipV = 0; this.jumpReq = false;
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
    let f = moving ? (this.key('KeyW', 'ArrowUp') ? 1 : 0) - (this.key('KeyS', 'ArrowDown') ? 1 : 0) : 0;
    let r = moving ? (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0) : 0;
    let speed = this.key('ShiftLeft', 'ShiftRight') ? STROLL : WALK;
    // analog stick (touch joystick): deflection sets the pace, a light run near full tilt
    const st = this.stick;
    if (moving && !f && !r && st) {
      const m = Math.min(1, Math.hypot(st.x, st.y));
      if (m > 0.08) {
        f = st.y; r = st.x;
        speed = m > 0.85 ? STROLL : WALK * Math.max(0.3, m / 0.85);
      }
    }
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let tx = -sy * f + cy * r, tz = -cy * f - sy * r;
    const tl = Math.hypot(tx, tz);
    if (tl > 0) { tx = (tx / tl) * speed; tz = (tz / tl) * speed; }
    // soft ends of the walkable district: walking on toward z0 / z1 slows to a stop
    const B = this.world.bounds;
    if (B.soft) {
      const room = tz < 0 ? this.pos.y - B.z0 : B.z1 - this.pos.y;
      tz *= Math.pow(THREE.MathUtils.clamp(room / B.soft, 0, 1), 0.75);
    }
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

    // jump: a ballistic offset above the followed ground. Collisions, ledges and the deck
    // are still resolved at ground level, so a jump never clears a railing or a wall.
    const airborne = this.airY > 0 || this.vy > 0;
    if ((this.jumpReq || (this.virtualKeys && this.key('Space'))) && !airborne && Math.abs(g - this.feetY) < 0.05) {
      this.vy = JUMP_V;
    }
    this.jumpReq = false;
    if (this.airY > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.airY += this.vy * dt;
      if (this.airY <= 0) {
        const impact = -this.vy;
        this.airY = 0; this.vy = 0;
        this.dipV -= impact * 0.3;
        this.onStep?.({ x: this.pos.x, z: this.pos.y, feetY: this.feetY, speed: v, land: true, impact });
        this.stepDist = 0;
      }
    }
    // landing dip: critically damped spring
    this.dipV += (-DIP_K * this.dip - 2 * Math.sqrt(DIP_K) * this.dipV) * dt;
    this.dip += this.dipV * dt;

    // step cycle: stride from distance walked (no steps in the air)
    const stride = v > 2.0 ? 0.95 : 0.75;
    const inAir = this.airY > 0;
    this.bobAmp += ((v > 0.2 && !inAir ? Math.min(1, v / WALK) : 0) - this.bobAmp) * (1 - Math.exp(-dt * 5));
    if (!inAir && v > 0.2) {
      this.phase += (moved / stride) * Math.PI;
      this.stepDist += moved;
      if (this.stepDist >= stride) {
        this.stepDist -= stride;
        this.onStep?.({ x: this.pos.x, z: this.pos.y, feetY: this.feetY, speed: v });
      }
    } else if (!inAir && this.stepDist > 0) {
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
    this.camera.position.set(this.pos.x + cy * sway, this.feetY + this.airY + EYE_HEIGHT + bob + this.dip, this.pos.y - sy * sway);
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
