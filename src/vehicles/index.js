// Rideable vehicles: the beach cruiser parked by the promenade near the z = -30 seawall
// access and the lifeguard ATV by the main tower. Walk up to one and look at it: "E - ride"
// (a Ride button on touch). E again gets off (the vehicle brakes first if it is moving;
// the rider steps off beside it and it stays there).
//
// While riding, the walker is paused: this module reads the keys / touch stick, steps the
// physics (sim.js), poses the model, puts the camera at the rider's eye (mouse / drag look
// stays free, relative to the vehicle) and drives the ride sounds.
import * as THREE from 'three';
import { EYE_HEIGHT, TOWER } from '../world/layout.js';
import { QUALITY } from '../quality.js';
import { createVehicle, stepVehicle, blockedAt, buildGrid, settle, dismountSpots } from './sim.js';
import { buildBike, buildAtv } from './models.js';

export const PARKED = {
  bike: { x: 7.5, z: -26.5, yaw: -0.17 },
  atv: { x: TOWER.x + 1.2, z: TOWER.z + 4.8, yaw: 0.35 - Math.PI },
};
const REACH = { bike: 2.5, atv: 2.9 };
const RIDE_PITCH = { bike: -13, atv: -9 };   // deg, the view settles to this on mounting
const BASE_FOV = 50;
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _v2 = new THREE.Vector2();

const CSS = `
#ride-prompt { position: fixed; left: 50%; top: 61%; transform: translate(-50%, 0); z-index: 4; pointer-events: none;
  font: 400 12px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; letter-spacing: 0.16em; color: rgba(255, 250, 242, 0.88);
  text-shadow: 0 1px 8px rgba(30, 18, 12, 0.55); opacity: 0; transition: opacity 0.35s ease; white-space: nowrap; }
#ride-prompt.show { opacity: 1; }
#ride-prompt b { display: inline-block; min-width: 1.35em; padding: 0.28em 0.3em; margin-right: 0.55em; border: 1px solid rgba(255, 250, 242, 0.55);
  border-radius: 3px; font-weight: 500; text-align: center; letter-spacing: 0; }
html.touch #ride-prompt { display: none; }
`;

// ---------------------------------------------------------------------------
// spray / roost particles (one Points draw call)

function createSpray(scene) {
  const N = QUALITY.tier === 'high' ? 220 : QUALITY.tier === 'medium' ? 140 : 60;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), al = new Float32Array(N), sz = new Float32Array(N);
  const P = Array.from({ length: N }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, a: 0, s: 0, g: 1 }));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aA', new THREE.BufferAttribute(al, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aS', new THREE.BufferAttribute(sz, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uScale: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute vec3 aCol; attribute float aA; attribute float aS;
      uniform float uScale;
      varying vec3 vCol; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aA > 0.001 ? clamp(aS * uScale / max(-mv.z, 0.1), 1.0, 90.0) : 0.0;
        vCol = aCol; vA = aA;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol; varying float vA;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(c, c);
        if (r2 > 1.0) discard;
        gl_FragColor = vec4(vCol, vA * pow(1.0 - r2, 1.5));
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  scene.add(pts);
  let head = 0, live = 0;
  const WATER = [0.95, 0.95, 0.93], SANDC = [0.6, 0.5, 0.38];
  return {
    emit(x, y, z, vx, vy, vz, sand) {
      const i = head; head = (head + 1) % N;
      const p = P[i];
      p.life = 0; p.max = sand ? 0.5 + Math.random() * 0.4 : 0.45 + Math.random() * 0.5;
      p.vx = vx; p.vy = vy; p.vz = vz; p.a = sand ? 0.55 : 0.8; p.s = (sand ? 0.035 : 0.04) + Math.random() * 0.05; p.g = sand ? 1 : 0.9;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      col.set(sand ? SANDC : WATER, i * 3);
      live = N;
    },
    update(dt, renderer, camera) {
      if (!live) return;
      let any = false;
      for (let i = 0; i < N; i++) {
        const p = P[i];
        if (p.life >= p.max) { al[i] = 0; continue; }
        any = true;
        p.life += dt;
        p.vy -= 9.8 * p.g * dt;
        const d = Math.exp(-dt * 1.2);
        p.vx *= d; p.vz *= d;
        pos[i * 3] += p.vx * dt; pos[i * 3 + 1] += p.vy * dt; pos[i * 3 + 2] += p.vz * dt;
        const f = p.life / p.max;
        al[i] = p.a * (1 - f) * Math.min(1, p.life * 20);
        sz[i] = p.s * (1 + f * 1.5);
      }
      if (!any) live = 0;
      for (const k of ['position', 'aCol', 'aA', 'aS']) g.attributes[k].needsUpdate = true;
      renderer.getDrawingBufferSize(_v2);
      mat.uniforms.uScale.value = _v2.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    },
    points: pts,
  };
}

// ---------------------------------------------------------------------------

export function createVehicles(scene, { walker, camera, beach, staticBoxes, staticCircles, dynamicCircles = [], audio, shot = false, renderer, requestShadow = () => {}, getTouch = () => null }) {
  const dyn = [];
  const world = {
    groundAt: beach.groundAt,
    waterDepthAt: beach.waterDepthAt,
    swashAt: beach.swashAt,
    bounds: walker.world.bounds,
    grid: buildGrid(staticBoxes, staticCircles),
    dynamic: () => dyn,
  };
  const list = [];
  for (const kind of ['bike', 'atv']) {
    const m = kind === 'bike' ? buildBike() : buildAtv();
    const pose = { ...PARKED[kind] };
    let v = createVehicle(kind, pose, world);
    // keep the parking spot clear of benches, palms and props (deterministic nudge)
    for (let k = 0; k < 40 && blockedAt(v, v.x, v.z, v.yaw, world); k++) {
      const a = k * 2.4, r = 0.3 + k * 0.08;
      v = createVehicle(kind, { ...pose, x: pose.x + Math.cos(a) * r, z: pose.z + Math.sin(a) * r }, world);
    }
    v.parked = true;
    if (kind === 'bike') { v.lean = -0.13; v.roll = 0.13; }
    scene.add(m.root, m.shadow);
    const e = { kind, v, m, kick: 1 };
    list.push(e);
    pose3(e, 0);
    if (shot) { m.root.visible = false; m.shadow.visible = false; }
  }
  const colliders = list.flatMap((e) => e.v.circlesWorld);
  const spray = createSpray(scene);

  // UI
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const prompt = document.createElement('div');
  prompt.id = 'ride-prompt';
  document.body.appendChild(prompt);
  let promptText = '', hintT = 0, touchMode = null;
  const showPrompt = (html) => {
    if (html !== promptText) { promptText = html; if (html) prompt.innerHTML = html; }
    prompt.classList.toggle('show', !!html);
  };

  let rider = null;            // the entry being ridden
  let near = null;             // mountable entry in reach
  let trans = null;            // mount camera transition
  let offReq = false, offFail = 0;
  let rel = 0, lastYaw = 0, lookIdle = 0;
  let lastShadow = null;
  let virtualKeys = null;
  let fov = BASE_FOV;

  function key(...codes) { const k = virtualKeys ?? walker.keys; return codes.some((c) => k.has(c)); }

  function pose3(e, t) {
    const { v, m } = e;
    m.root.position.set(v.x, v.bodyY + v.airY, v.z);
    m.root.rotation.set(0, v.yaw, 0);
    m.tilt.rotation.set(v.pitch, 0, v.roll);
    if (e.kind === 'bike') {
      m.steer.rotation.y = -v.steer * 1.15;
      m.wheelF.rotation.x = m.wheelR.rotation.x = -v.wheelRot;
      m.crank.rotation.x = -v.crank;
      for (const p of m.pedals) p.rotation.x = v.crank;
      const k = e.kick;
      m.kick.rotation.set(THREE.MathUtils.lerp(-1.45, -0.32, k), 0, THREE.MathUtils.lerp(-0.08, -0.42, k));
    } else {
      m.steer.rotation.y = -v.steer * 1.5;
      const R = m.R, by = v.bodyY + v.airY, sp = Math.sin(v.pitch), cp = Math.cos(v.pitch), sr = Math.sin(v.roll), cr = Math.cos(v.roll);
      m.wheels.forEach((w, i) => {
        const T = v.wheelH[i] + R;
        const y = ((T - by + w.z * sp) / cp - w.x * sr) / cr;
        w.hold.position.y = THREE.MathUtils.clamp(y, R - 0.1, R + 0.16);
        if (i < 2) w.hold.rotation.y = -v.steer;
        w.mesh.rotation.x = -v.wheelRot;
      });
      const u = m.mat.userData.u, on = v.ridden;
      u.uLights.value = on ? 1 : 0;
      const c = (t % 0.9) / 0.9, flash = (c0) => { const q = (c - c0 + 1) % 1; return q < 0.1 || (q > 0.17 && q < 0.27) ? 1 : 0; };
      u.uBeaconA.value = on ? flash(0) : 0;
      u.uBeaconB.value = on ? flash(0.5) : 0;
    }
    const s = m.shadow;
    s.position.set(v.x - 0.25, v.baseT + 0.025, v.z);
    s.rotation.set(v.pitchT, v.yaw, v.rollT, 'YXZ');
    s.material.opacity = 1;
    s.scale.setScalar(1 / (1 + (v.bodyY + v.airY - v.baseT) * 1.5));
  }

  function eyeWorld(e, bob, out) {
    const { v } = e, S = v.spec;
    _e.set(v.pitch, v.yaw, v.roll, 'YXZ');
    _q.setFromEuler(_e);
    out.set(S.eye[0] + bob.x, S.eye[1] + bob.y, S.eye[2]).applyQuaternion(_q);
    out.x += v.x; out.y += v.bodyY + v.airY; out.z += v.z;
    return out;
  }
  function headQuat(e, out) {
    const { v } = e;
    const k = e.kind === 'bike' ? 0.55 : 0.8;
    _e.set(v.pitch * 0.85, v.yaw, v.roll * k, 'YXZ');
    out.setFromEuler(_e);
    _e.set(walker.pitch, rel, 0, 'YXZ');
    return out.multiply(_q2.setFromEuler(_e));
  }

  function mount(e) {
    if (rider || !e) return false;
    rider = e;
    const v = e.v;
    v.parked = false; v.ridden = true;
    rel = wrap(walker.yaw - v.yaw);
    lastYaw = walker.yaw;
    trans = { t: 0, pos: camera.position.clone(), quat: camera.quaternion.clone(), rel0: rel, pitch0: walker.pitch };
    walker.vel.set(0, 0);
    walker.jumpReq = false;
    hintT = 3.5;
    offReq = false;
    return true;
  }
  function dismount() {
    if (!rider) return false;
    const e = rider, v = e.v;
    for (const [x, z] of dismountSpots(v)) {
      const feet = walker.world.heightAt(x, z, v.groundY + 0.3);
      if (Math.abs(feet - v.groundY) > 0.5) continue;
      walker.feetY = feet;
      if (walker.blocked(x, z)) continue;
      camera.getWorldDirection(_v);
      const heading = THREE.MathUtils.radToDeg(Math.atan2(_v.x, -_v.z));
      walker.set(x, feet + EYE_HEIGHT, z, heading, THREE.MathUtils.radToDeg(walker.pitch));
      v.ridden = false; v.parked = true;
      v.vx = v.vz = 0; v.lon = 0; v.steer *= 0.3; v.airY = 0; v.vyAir = 0;
      rider = null; trans = null; offReq = false;
      audio?.vehicle?.({ kind: null });
      requestShadow();
      return true;
    }
    offFail = 2;
    return false;
  }
  function toggle() {
    if (rider) { if (Math.abs(rider.v.lon) > 1.2) offReq = true; else dismount(); return; }
    if (near) mount(near);
  }

  addEventListener('keydown', (ev) => {
    if (ev.code !== 'KeyE' || ev.repeat || shot) return;
    if (!walker.active && !rider) return;
    toggle();
  });

  function findNear() {
    if (!walker.active || walker.airY > 0) return null;
    camera.getWorldDirection(_v);
    const fl = Math.hypot(_v.x, _v.z) || 1, fx = _v.x / fl, fz = _v.z / fl;
    let best = null, bd = Infinity;
    for (const e of list) {
      const v = e.v;
      let d = Infinity;
      for (const c of v.circlesWorld) d = Math.min(d, Math.hypot(walker.pos.x - c.x, walker.pos.y - c.z));
      if (d > REACH[e.kind] || Math.abs(walker.feetY - v.groundY) > 0.8) continue;
      const dx = v.x - walker.pos.x, dz = v.z - walker.pos.y, dl = Math.hypot(dx, dz) || 1;
      const facing = (dx * fx + dz * fz) / dl;
      if (d > 1.1 && facing < 0.62) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function readInput(e) {
    const active = walker.active || virtualKeys;
    let f = 0, r = 0, hard = false;
    if (active) {
      f = (key('KeyW', 'ArrowUp') ? 1 : 0) - (key('KeyS', 'ArrowDown') ? 1 : 0);
      r = (key('KeyD', 'ArrowRight') ? 1 : 0) - (key('KeyA', 'ArrowLeft') ? 1 : 0);
      hard = key('ShiftLeft', 'ShiftRight');
      const st = walker.stick;
      if (!f && !r && st) {
        const m = Math.min(1, Math.hypot(st.x, st.y));
        if (m > 0.08) { f = st.y; r = st.x * Math.min(1, 1.3 * Math.abs(st.x) / Math.max(m, 1e-3)); hard = hard || m > 0.92; }
      }
    }
    let hop = walker.jumpReq || (virtualKeys ? key('Space') : false);
    walker.jumpReq = false;
    if (offReq) {
      const lon = e.v.lon;
      f = Math.abs(lon) > 0.3 ? -Math.sign(lon) : 0; r = 0; hard = false; hop = false;
    }
    return { throttle: THREE.MathUtils.clamp(f, -1, 1), steer: THREE.MathUtils.clamp(r, -1, 1), hard, hop };
  }

  let clock = 0;
  function update(dt) {
    dt = Math.min(dt, 0.05);
    clock += dt;
    dyn.length = 0;
    for (const c of dynamicCircles) dyn.push(c);
    for (const e of list) if (e !== rider) for (const c of e.v.circlesWorld) dyn.push(c);

    // the other vehicles: kickstand, settle, visibility
    for (const e of list) {
      if (e === rider) continue;
      const v = e.v;
      if (e.kind === 'bike' && (Math.abs(v.lean + 0.13) > 0.002 || e.kick < 1)) {
        e.kick = Math.min(1, e.kick + dt * 3);
        stepVehicle(v, { throttle: 0, steer: 0, hard: false, hop: false }, dt, world);
        pose3(e, clock);
        requestShadow();
      } else if (Math.abs(v.bodyY - v.baseT) > 0.002 || Math.abs(v.bodyV) > 0.01) {
        stepVehicle(v, { throttle: 0, steer: 0, hard: false, hop: false }, dt, world);
        pose3(e, clock);
      }
      const far = Math.hypot(camera.position.x - v.x, camera.position.z - v.z) > 240;
      e.m.root.visible = e.m.shadow.visible = !far;
    }

    if (!rider) {
      near = findNear();
      showPrompt(near ? '<b>E</b>ride' : '');
      setTouch(near ? 'ride' : null);
      fov += (BASE_FOV - fov) * (1 - Math.exp(-dt * 6));
      applyFov();
      spray.update(dt, renderer, camera);
      return;
    }

    const e = rider, v = e.v;
    near = null;
    if (e.kind === 'bike') e.kick = Math.max(0, e.kick - dt * 4);
    let input = { throttle: 0, steer: 0, hard: false, hop: false };
    if (trans) {
      trans.t += dt / 0.4;
      walker.jumpReq = false;
    } else input = readInput(e);
    stepVehicle(v, input, dt, world);
    if (offReq && Math.abs(v.lon) < 1.0) dismount();
    if (!rider) { spray.update(dt, renderer, camera); return; }
    pose3(e, clock);

    // look: mouse / drag deltas since the last frame move the head relative to the vehicle
    const d = wrap(walker.yaw - lastYaw);
    if (Math.abs(d) > 1e-5) { rel = wrap(rel + d); lookIdle = 0; } else lookIdle += dt;
    if (lookIdle > 1.4 && Math.abs(v.lon) > 1.5 && !trans) rel *= Math.exp(-dt * 1.3);
    if (trans) {
      const k = Math.min(1, trans.t), s = k * k * (3 - 2 * k);
      rel = trans.rel0 * (1 - s);
      walker.pitch = THREE.MathUtils.lerp(trans.pitch0, THREE.MathUtils.degToRad(RIDE_PITCH[e.kind]), s);
    }
    walker.yaw = v.yaw + rel;
    lastYaw = walker.yaw;

    // camera: rider's eye, pedalling bob / engine shake
    const bob = { x: 0, y: 0 };
    if (e.kind === 'bike') {
      const a = Math.min(1, Math.abs(v.lon) / 3) * v.pedal;
      bob.y = 0.012 * a * Math.sin(v.crank * 2);
      bob.x = 0.008 * a * Math.sin(v.crank);
    } else {
      const j = 0.0006 + 0.0012 * (v.rpm - 1400) / 6000;
      bob.y = j * Math.sin(clock * 83) + j * 0.6 * Math.sin(clock * 131);
      bob.x = j * 0.5 * Math.sin(clock * 97);
    }
    eyeWorld(e, bob, _v);
    headQuat(e, _q);
    if (trans && trans.t < 1) {
      const k = trans.t, s = k * k * (3 - 2 * k);
      camera.position.lerpVectors(trans.pos, _v, s);
      camera.quaternion.slerpQuaternions(trans.quat, _q, s);
    } else {
      trans = null;
      camera.position.copy(_v);
      camera.quaternion.copy(_q);
    }
    walker.pos.set(v.x, v.z);
    walker.feetY = v.groundY;
    fov += (56 + Math.min(1, Math.abs(v.lon) / 12) * 5 - fov) * (1 - Math.exp(-dt * 3));
    applyFov();

    // spray from the wheels in the swash, roost from the ATV on soft sand
    const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw), al = Math.abs(v.lon);
    v.spec.wheels.forEach(([lx, lz], i) => {
      const dep = v.wheelDepth[i];
      const wx = v.x + lx * cy + lz * sy, wz = v.z - lx * sy + lz * cy, gy = v.wheelH[i];
      const side = lx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(lx);
      if (dep > 0.015 && al > 1.2) {
        const rate = (e.kind === 'atv' ? 45 : 16) * Math.min(1, al / 7) * Math.min(1, dep / 0.07);
        for (let n = poisson(rate * dt); n > 0; n--) {
          const up = (1.2 + Math.random() * 2.2) * Math.min(1.3, al / 6);
          const back = -v.lon * (0.25 + Math.random() * 0.3), out = side * (0.6 + Math.random() * 1.4);
          spray.emit(wx + side * 0.1, gy + 0.05, wz, -sy * back + cy * out, up, -cy * back - sy * out, false);
        }
      }
      if (e.kind === 'atv' && i >= 2 && v.surf.kind === 'sand' && v.surf.soft > 0.3 && input.throttle > 0.4 && al > 1.5) {
        for (let n = poisson(22 * v.surf.soft * dt); n > 0; n--) {
          const back = 1.5 + Math.random() * 2.5, out = side * Math.random() * 0.7;
          spray.emit(wx, gy + 0.04, wz + 0, sy * back + cy * out, 0.8 + Math.random() * 1.4, cy * back - sy * out, true);
        }
      }
    });
    spray.update(dt, renderer, camera);

    // the ridden vehicle casts a live shadow: refresh the (static) shadow map as it moves
    const st = QUALITY.shadowStep ?? 0.5;
    if (!lastShadow || Math.hypot(v.x - lastShadow.x, v.z - lastShadow.z) > st || Math.abs(wrap(v.yaw - lastShadow.yaw)) > 0.06 || Math.abs(v.roll - lastShadow.roll) > 0.06) {
      lastShadow = { x: v.x, z: v.z, yaw: v.yaw, roll: v.roll };
      requestShadow();
    }

    audio?.vehicle?.({
      kind: e.kind, lon: v.lon, throttle: input.throttle, rpm: v.rpm, load: v.load, surface: v.surf.kind, soft: v.surf.soft,
      depth: Math.max(...v.wheelDepth), coasting: v.coasting, pedal: v.pedal, crank: v.crank, bump: v.bump, land: v.land,
    });

    hintT -= dt;
    if (offFail > 0) { offFail -= dt; showPrompt('No room to get off here'); }
    else showPrompt(offReq ? 'Stopping…' : hintT > 0 ? '<b>E</b>get off' : '');
    setTouch('off');
  }

  function applyFov() {
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
  function setTouch(mode) {
    if (mode === touchMode) return;
    const t = getTouch();
    if (!t?.setRide) return;
    touchMode = mode;
    t.setRide(mode, rider?.kind);
  }

  const api = {
    list,
    colliders,
    world,
    get riding() { return !!rider; },
    get current() { return rider?.v ?? null; },
    get near() { return near?.kind ?? null; },
    update,
    toggle,
    mount: (kind) => mount(list.find((e) => e.kind === kind)),
    dismount,
    // test hook: move the ridden (or named) vehicle to a pose, at rest
    place(x, z, yaw, kind) {
      const e = kind ? list.find((q) => q.kind === kind) : rider;
      if (!e) return false;
      Object.assign(e.v, { x, z, yaw, vx: 0, vz: 0, lon: 0, steer: 0 });
      settle(e.v, world);
      pose3(e, clock);
      return !blockedAt(e.v, x, z, yaw, world);
    },
    // test hook: hold `keys` for `seconds` of simulated time while riding; returns the path
    simulate(keys, seconds, dt = 1 / 60) {
      virtualKeys = new Set(keys);
      const log = [];
      let maxSpeed = 0, maxBump = 0;
      for (let t = 0; t < seconds; t += dt) {
        update(dt);
        const v = rider?.v;
        if (!v) break;
        maxSpeed = Math.max(maxSpeed, Math.abs(v.lon));
        maxBump = Math.max(maxBump, v.bump);
        if (log.length === 0 || t - log[log.length - 1].t >= 0.25) log.push({ t: +t.toFixed(2), x: +v.x.toFixed(2), z: +v.z.toFixed(2), y: +v.groundY.toFixed(3), v: +v.lon.toFixed(2), surf: v.surf.kind, bump: +v.bump.toFixed(2) });
      }
      virtualKeys = null;
      return { log, maxSpeed: +maxSpeed.toFixed(2), maxBump: +maxBump.toFixed(2) };
    },
    state() {
      return list.map((e) => ({ kind: e.kind, x: +e.v.x.toFixed(2), z: +e.v.z.toFixed(2), yaw: +e.v.yaw.toFixed(3), ridden: e.v.ridden, speed: +e.v.lon.toFixed(2), surf: e.v.surf.kind }));
    },
  };
  return api;
}

function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
function poisson(m) {
  let n = Math.floor(m);
  if (Math.random() < m - n) n++;
  return n;
}

