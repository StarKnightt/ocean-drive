// Rideable vehicles: the beach cruiser parked by the promenade near the z = -30 seawall
// access, the lifeguard ATV by the main tower, the 1950s convertible at the west curb (the
// hero car, drawn by world/cars-glb.js) and, in the open world, every parked modern car along
// the curbs. Walk up to one: "E ride" by the bike / ATV, "E enter" at a car's door (either
// side: the passenger door slides you across; F works as E; a Ride / Enter button on touch).
// E again gets off (the vehicle brakes first if it is moving; the rider steps off beside it,
// the sidewalk side first for a car at the curb, and it stays where it was left).
//
// While riding, the walker is paused: this module reads the keys / touch stick, steps the
// physics (sim.js), poses the model, puts the camera at the rider's eye or (C, cars) behind
// the car on a chase arm (mouse / drag look stays free, relative to the vehicle), and drives
// the ride sounds, the tyre marks, sparks and spray, the speedometer and the recovery
// (R: fade to the haze, back on the nearest road; also when stranded outside the world).
// A parked car driven off is a live instance (its batched instance and its spot's collider
// are switched off); at most MAX_LIVE of them stay live, the oldest out of sight is put back.
import * as THREE from 'three';
import { EYE_HEIGHT, TOWER, CROSS, crossStreetAt } from '../world/layout.js';
import { QUALITY } from '../quality.js';
import { createVehicle, stepVehicle, blockedAt, buildGrid, settle, dismountSpots, canRestart } from './sim.js';
import { OPEN_WORLD, OPEN_SPECS } from './specs.js';
import { edgeSteer, extentBounds } from '../world/extent.js';
import { buildBike, buildAtv } from './models.js';
import { createSkids } from './skids.js';
import { createChaseCamera } from './camera.js';
import { createHud } from '../ui/hud.js';

export const PARKED = {
  bike: { x: 7.5, z: -26.5, yaw: -0.17 },
  atv: { x: TOWER.x + 1.2, z: TOWER.z + 4.8, yaw: 0.35 - Math.PI },
};
const REACH = { bike: 2.5, atv: 2.9 };   // m to the nearest collider circle centre
const DOOR_REACH = 1.45;                 // m from a car's door point
const RIDE_PITCH = { bike: -13, atv: -9, car: -3 };   // deg, the view settles to this on mounting
const CAR_LOOK = { yaw: 1.85, up: 0.5, down: -0.85 };   // rad: head turn limits in the driver's seat
const STARTER = { hero: 1.05, modern: 0.45, atv: 0.6 };   // s of cranking before the engine catches
const MAX_LIVE = 6;
const BASE_FOV = 50;
const TIER = QUALITY.tier;
const LOW = TIER === 'low';
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _v2 = new THREE.Vector2();

const CSS = `
#ride-prompt { position: fixed; left: 50%; top: 61%; transform: translate(-50%, 0); z-index: 4; pointer-events: none;
  font: 400 12px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; letter-spacing: 0.16em; color: rgba(255, 250, 242, 0.88);
  text-shadow: 0 1px 8px rgba(30, 18, 12, 0.55); opacity: 0; transition: opacity 0.35s ease; white-space: nowrap; }
#ride-prompt.show { opacity: 1; }
#ride-prompt b { display: inline-block; min-width: 1.35em; padding: 0.28em 0.3em; margin-right: 0.55em; border: 1px solid rgba(255, 250, 242, 0.55);
  border-radius: 3px; font-weight: 500; text-align: center; letter-spacing: 0; }
#ride-prompt b + b { margin-left: -0.3em; }
html.touch #ride-prompt { display: none; }
`;

// ---------------------------------------------------------------------------
// spray / roost / sparks / tyre smoke particles (one Points draw call)

const P_WATER = 0, P_SAND = 1, P_SPARK = 2, P_GRASS = 3, P_SMOKE = 4;
function createSpray(scene) {
  const N = QUALITY.tier === 'high' ? 260 : QUALITY.tier === 'medium' ? 160 : 70;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), al = new Float32Array(N), sz = new Float32Array(N);
  const P = Array.from({ length: N }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, a: 0, s: 0, g: 1, grow: 1.5, drag: 1.2 }));
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
  // (the sparks are hot: over 1 in the linear target, so the bloom catches them where it runs)
  const COL = [[0.95, 0.95, 0.93], [0.6, 0.5, 0.38], LOW ? [1.6, 0.95, 0.45] : [6, 2.6, 0.7], [0.2, 0.22, 0.09], [0.62, 0.6, 0.57]];
  return {
    emit(x, y, z, vx, vy, vz, type = P_WATER) {
      const i = head; head = (head + 1) % N;
      const p = P[i];
      p.life = 0;
      if (type === P_SPARK) { p.max = 0.18 + Math.random() * 0.3; p.a = 1; p.s = 0.012 + Math.random() * 0.01; p.g = 1; p.grow = -0.6; p.drag = 0.6; }
      else if (type === P_SMOKE) { p.max = 0.9 + Math.random() * 0.8; p.a = 0.22; p.s = 0.18 + Math.random() * 0.12; p.g = -0.05; p.grow = 3; p.drag = 2.2; }
      else if (type === P_WATER) { p.max = 0.45 + Math.random() * 0.5; p.a = 0.8; p.s = 0.04 + Math.random() * 0.05; p.g = 0.9; p.grow = 1.5; p.drag = 1.2; }
      else { p.max = 0.5 + Math.random() * 0.4; p.a = type === P_GRASS ? 0.8 : 0.55; p.s = (type === P_GRASS ? 0.03 : 0.035) + Math.random() * 0.05; p.g = 1; p.grow = 1.2; p.drag = 1.2; }
      p.vx = vx; p.vy = vy; p.vz = vz;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      col.set(COL[type], i * 3);
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
        const d = Math.exp(-dt * p.drag);
        p.vx *= d; p.vz *= d;
        pos[i * 3] += p.vx * dt; pos[i * 3 + 1] += p.vy * dt; pos[i * 3 + 2] += p.vz * dt;
        const f = p.life / p.max;
        al[i] = p.a * (1 - f) * Math.min(1, p.life * 20);
        sz[i] = Math.max(0.004, p.s * (1 + f * p.grow));
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

export function createVehicles(scene, {
  walker, camera, beach, staticBoxes, staticCircles, dynamicCircles = [], audio, shot = false, renderer,
  requestShadow = () => {}, getTouch = () => null, car = null, movers = [],
  fleet = null, kit = null, seatPlayer = null, traffic = null,
}) {
  const dyn = [];
  const world = {
    groundAt: beach.groundAt,
    waterDepthAt: beach.waterDepthAt,
    swashAt: beach.swashAt,
    bounds: walker.world.bounds,
    grid: buildGrid(staticBoxes, staticCircles),
    dynamic: () => dyn,
    tier: TIER,
    ...(LOW ? { maxSubsteps: 8 } : {}),
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
    const e = { kind, body: kind, origin: 'fixed', v, m, kick: 1, startT: 0 };
    list.push(e);
    pose3(e, 0);
    if (shot) { m.root.visible = false; m.shadow.visible = false; }
  }
  let hbT = 0;
  // the convertible (not in ?shot mode: the harness frames it exactly where it is parked)
  if (car && !shot) {
    const v = createVehicle('car', car.pose, world);
    v.parked = true;
    list.push({ kind: 'car', body: 'hero', origin: 'hero', v, m: null, drive: car, kick: 1, startT: 0, door: 0.1 });
  }
  const colliders = list.flatMap((e) => e.v.circlesWorld);
  // the passing traffic car(s) as moving colliders: circles along the lane
  const moverCircles = movers.map(() => [-1.9, -0.95, 0, 0.95, 1.9].map((dz) => ({ x: 0, z: 0, r: 0.95, dz, owner: null })));
  const spray = createSpray(scene);
  const skids = shot ? null : createSkids(scene);
  const chase = createChaseCamera();
  const hud = shot ? null : createHud({ units: new URLSearchParams(globalThis.location?.search ?? '').get('units') === 'kmh' ? 'kmh' : 'mph' });
  // parked modern cars that can be driven: the fleet's spots, and each kind's door (the
  // driver's hips along the body, sim local z) and half width
  const drivable = OPEN_WORLD && !shot && fleet?.take && kit?.makeDrivable ? fleet.cars : [];
  const doorZ = (body) => (body === 'hero' ? 0.1 : -(kit?.seatZ?.[body] ?? 0.3) + 0.05);

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
  let near = null;             // mountable entry in reach: an entry, or { spot, door } for a parked car
  let trans = null;            // mount camera transition
  let offReq = false, offFail = 0;
  let rel = 0, lastYaw = 0, lookIdle = 0;
  let lastShadow = null;
  let virtualKeys = null;
  let fov = BASE_FOV;
  let view = 'fp';             // 'fp' | 'chase' (cars)
  let shake = 0, scrape = 0, lastRecover = -1e9, pendingEvent = null;
  let clock = 0;

  function key(...codes) { const k = virtualKeys ?? walker.keys; return codes.some((c) => k.has(c)); }

  function pose3(e, t) {
    const { v, m } = e;
    if (e.kind === 'car') { e.drive.apply(v); return; }
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
    if (e.kind === 'car') { e.drive.eye(out); out.y += bob.y; return out; }
    _e.set(v.pitch, v.yaw, v.roll, 'YXZ');
    _q.setFromEuler(_e);
    out.set(S.eye[0] + bob.x, S.eye[1] + bob.y, S.eye[2]).applyQuaternion(_q);
    out.x += v.x; out.y += v.bodyY + v.airY; out.z += v.z;
    return out;
  }
  function headQuat(e, out) {
    const { v } = e;
    if (e.kind === 'car' && e.drive.eyeQuat) {
      e.drive.eyeQuat(out);
      _e.set(walker.pitch, rel, 0, 'YXZ');
      return out.multiply(_q2.setFromEuler(_e));
    }
    const k = e.kind === 'bike' ? 0.55 : 0.8;
    // (in the car the head rides the sprung body: its pitch and roll are the body's)
    _e.set(v.pitch * (e.kind === 'car' ? 1 : 0.85), v.yaw, v.roll * (e.kind === 'car' ? 1 : k), 'YXZ');
    out.setFromEuler(_e);
    _e.set(walker.pitch, rel, 0, 'YXZ');
    return out.multiply(_q2.setFromEuler(_e));
  }
  function setView(mode) {
    view = mode;
    const chaseOn = mode === 'chase' && rider?.kind === 'car';
    for (const e of list) {
      if (e.kind !== 'car') continue;
      const on = chaseOn && e === rider;
      if (e.drive.setView) e.drive.setView(on ? 'chase' : 'fp');
      else if (e.drive.rig) e.drive.rig.chase = on;
    }
    chase.reset();
    chase.snap();
  }

  // --- the drivable fleet ---------------------------------------------------------------
  // a parked car becomes a live one: its own instance at the spot, a sim body, the spot's
  // batched instance and collider off
  function materialise(spot) {
    const view = kit.makeDrivable(spot.kind, spot.color);
    const v = createVehicle(OPEN_SPECS[spot.kind], spot.pose, world);
    v.parked = true;
    v.engineOn = false;
    fleet.take(spot);
    const e = { kind: 'car', body: spot.kind, origin: 'parked', spot, v, m: null, drive: view, kick: 1, startT: 0, door: doorZ(spot.kind), used: clock };
    list.push(e);
    walker.world.circles?.push(...v.circlesWorld);
    view.apply(v);
    retire();
    return e;
  }
  // over MAX_LIVE: the longest-unused one out of sight goes back to its spot
  function retire() {
    const live = list.filter((e) => e.origin === 'parked');
    while (live.length > MAX_LIVE) {
      live.sort((a, b) => a.used - b.used);
      const e = live.find((q) => q !== rider && Math.hypot(camera.position.x - q.v.x, camera.position.z - q.v.z) > 60);
      if (!e) return;
      live.splice(live.indexOf(e), 1);
      list.splice(list.indexOf(e), 1);
      const wc = walker.world.circles;
      if (wc) for (const c of e.v.circlesWorld) { const i = wc.indexOf(c); if (i >= 0) wc.splice(i, 1); }
      e.detach?.();
      e.drive.dispose();
      fleet.release(e.spot);
    }
  }

  // a car's door points (sim local: -x is the driver's side), world coordinates
  function doors(pose, body, width) {
    const s = Math.sin(pose.yaw), c = Math.cos(pose.yaw), lz = doorZ(body), out = width / 2 + 0.45;
    return [[-out, 'driver'], [out, 'passenger']].map(([lx, side]) => ({ x: pose.x + lx * c + lz * s, z: pose.z - lx * s + lz * c, side }));
  }

  function mount(e, door = 'driver') {
    if (rider || !e) return false;
    if (e.spot && !e.v) return false;
    rider = e;
    const v = e.v;
    v.parked = false; v.ridden = true;
    e.used = clock;
    rel = wrap(walker.yaw - v.yaw);
    lastYaw = walker.yaw;
    const slide = e.kind === 'car' && door === 'passenger';
    trans = { t: 0, dur: e.kind === 'car' ? (slide ? 1.1 : 0.6) : 0.4, dip: e.kind === 'car' ? 0.25 : 0, pos: camera.position.clone(), quat: camera.quaternion.clone(), rel0: rel, pitch0: walker.pitch };
    walker.vel.set(0, 0);
    walker.jumpReq = false;
    hintT = 3.5;
    offReq = false;
    if (e.kind === 'car') {
      v.engineOn = false; v.rpm = 0;
      e.startT = e.origin === 'hero' ? STARTER.hero : STARTER.modern;
      if (e.origin === 'parked' && !e.detach) e.detach = seatPlayer?.(e.drive) ?? null;
      pendingEvent = 'door';
    }
    setView(view);
    return true;
  }
  function dismount() {
    if (!rider) return false;
    const e = rider, v = e.v;
    let spots = dismountSpots(v);
    if (e.kind === 'car') {
      // wider bodies: the door spots a little further out
      const extra = Math.max(0, ((v.spec.width ?? 2) - 2) / 2);
      if (extra > 0) {
        const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
        spots = spots.map(([x, z], i) => { if (i >= 8) return [x, z]; const lx = (x - v.x) * c - (z - v.z) * s, sg = Math.sign(lx); return [x + sg * extra * c, z - sg * extra * s]; });
      }
      // the sidewalk side (the higher ground by the doors) first, else the road side
      const h = (p) => walker.world.heightAt(p[0], p[1], v.groundY + 0.3);
      if (h(spots[1]) > h(spots[0]) + 0.05) spots = spots.map((p, i) => (i < 8 ? spots[i ^ 1] : p));
    }
    for (const [x, z] of spots) {
      const feet = walker.world.heightAt(x, z, v.groundY + 0.3);
      if (Math.abs(feet - v.groundY) > 0.5) continue;
      walker.feetY = feet;
      if (walker.blocked(x, z)) continue;
      camera.getWorldDirection(_v);
      const heading = THREE.MathUtils.radToDeg(Math.atan2(_v.x, -_v.z));
      const pitch = view === 'chase' && e.kind === 'car' ? -4 : THREE.MathUtils.radToDeg(walker.pitch);
      walker.set(x, feet + EYE_HEIGHT, z, heading, pitch);
      v.ridden = false; v.parked = true;
      v.vx = v.vz = 0; v.lon = 0; v.steer *= 0.3; v.airY = 0; v.vyAir = 0;
      if (v.yawV) v.yawV = 0;
      if (e.kind === 'car') { v.engineOn = false; v.rpm = 0; v.gear = 1; pose3(e, clock); e.drive.setView?.('fp'); if (e.drive.rig && !e.drive.setView) e.drive.rig.chase = false; }
      rider = null; trans = null; offReq = false;
      audio?.vehicle?.({ kind: null, event: e.kind === 'car' ? 'door' : undefined });
      hud?.update(null);
      requestShadow();
      return true;
    }
    offFail = 2;
    return false;
  }
  function toggle() {
    if (rider) { if (Math.abs(rider.v.lon) > 1.2) offReq = true; else dismount(); return; }
    if (!near) return;
    if (near.spot) { const e = materialise(near.spot); mount(e, near.door); return; }
    mount(near.e ?? near, near.door);
  }

  // back on the nearest road, at rest, engine running (R, or stranded outside the world)
  function roadPoint(x, z) {
    const c = x < -26 ? crossStreetAt(z) : null;
    if (c && !c.far) return { x: THREE.MathUtils.clamp(x, -84, -32), z: c.z + CROSS.hw * 0.45, yaw: -Math.PI / 2 };
    const b = extentBounds(TIER);
    const zc = THREE.MathUtils.clamp(z, b.z0 + 30, b.z1 - 30);
    return x < -18 ? { x: -19.75, z: zc, yaw: Math.PI } : { x: -16.25, z: zc, yaw: 0 };
  }
  function recover(force = false, immediate = false) {
    if (!rider || (!force && clock - lastRecover < 5)) return false;
    lastRecover = clock;
    const go = () => {
      const e = rider;
      if (!e) return;
      const p = roadPoint(e.v.x, e.v.z);
      api.place(p.x, p.z, p.yaw);
      const v = e.v;
      if (v.sink) v.sink.fill(0);
      v.bogged = false; v.stalled = false; v.outsideT = 0; v.yawV = 0;
      if (e.kind === 'car' || e.kind === 'atv') { v.engineOn = true; v.rpm = v.spec.idle ?? 800; e.startT = 0; }
      chase.reset(); chase.snap();
      lastShadow = null;
    };
    if (hud && !immediate) hud.fadeThrough(go, 0.4); else go();
    return true;
  }

  addEventListener('keydown', (ev) => {
    if (shot || ev.repeat) return;
    if (!walker.active && !rider) return;
    if (ev.code === 'KeyE' || ev.code === 'KeyF') toggle();
    else if ((ev.code === 'KeyC' || ev.code === 'KeyV') && rider?.kind === 'car') setView(view === 'chase' ? 'fp' : 'chase');
    else if (ev.code === 'KeyR' || ev.code === 'Backspace') recover();
  });

  function findNear() {
    if (!walker.active || walker.airY > 0) return null;
    camera.getWorldDirection(_v);
    const fl = Math.hypot(_v.x, _v.z) || 1, fx = _v.x / fl, fz = _v.z / fl;
    const wx = walker.pos.x, wz = walker.pos.y;
    let best = null, bd = Infinity;
    const facing = (tx, tz) => { const dx = tx - wx, dz = tz - wz, dl = Math.hypot(dx, dz) || 1; return (dx * fx + dz * fz) / dl; };
    // a car: the nearer door point; looking roughly at the car unless right at the door
    const tryCar = (cand, pose, body, width, groundY) => {
      if (Math.abs(pose.x - wx) > 7 || Math.abs(pose.z - wz) > 7 || Math.abs(walker.feetY - groundY) > 0.8) return;
      for (const d of doors(pose, body, width)) {
        const dd = Math.hypot(d.x - wx, d.z - wz);
        if (dd > DOOR_REACH || dd >= bd) continue;
        if (dd > 0.8 && facing(pose.x, pose.z) < 0.3) continue;
        bd = dd; best = { ...cand, door: d.side };
      }
    };
    for (const e of list) {
      const v = e.v;
      if (e.kind === 'car') { tryCar({ e, kind: 'car' }, v, e.body, v.spec.width ?? 2, v.groundY); continue; }
      let d = Infinity;
      for (const c of v.circlesWorld) d = Math.min(d, Math.hypot(wx - c.x, wz - c.z));
      if (d > REACH[e.kind] || Math.abs(walker.feetY - v.groundY) > 0.8) continue;
      if (d > 1.1 && facing(v.x, v.z) < 0.62) continue;
      if (d < bd) { bd = d; best = { e, kind: e.kind }; }
    }
    for (const s of drivable) {
      if (s.taken || Math.abs(s.x - wx) > 7 || Math.abs(s.z - wz) > 7) continue;
      tryCar({ spot: s, kind: 'car' }, s.pose, s.kind, OPEN_SPECS[s.kind]?.width ?? 1.9, world.groundAt(s.pose.x, s.pose.z));
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
    // car: Space held = handbrake (the touch Brake button while held; a tap pulls it for a moment)
    let handbrake = false;
    if (e.kind === 'car') {
      if (hop) hbT = 0.6;
      handbrake = (active && key('Space')) || !!walker.brakeHeld || hbT > 0;
      hop = false;
    }
    if (api.steerHold != null) r = api.steerHold;
    // the soft band at a world edge turns the car back toward the interior
    if (e.v.spec.open && e.kind !== 'bike') r += edgeSteer(e.v.x, e.v.z, e.v.yaw, TIER) * Math.min(1, Math.abs(e.v.lon) / 4);
    if (offReq) {
      const lon = e.v.lon;
      f = Math.abs(lon) > 0.3 ? -Math.sign(lon) : 0; r = 0; hard = false; hop = false;
    }
    return { throttle: THREE.MathUtils.clamp(f, -1, 1), steer: THREE.MathUtils.clamp(r, -1, 1), hard, hop, handbrake, horn: active && key('KeyH') };
  }

  // wheel contact point i (world)
  function wheelAt(v, i, out) {
    const [lx, lz] = v.spec.wheels[i];
    const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
    out.x = v.x + lx * c + lz * s; out.z = v.z - lx * s + lz * c; out.y = v.wheelH[i];
    return out;
  }
  const _w = { x: 0, y: 0, z: 0 };

  function effects(e, input, dt) {
    const v = e.v, sy = Math.sin(v.yaw), cy = Math.cos(v.yaw), al = Math.abs(v.lon);
    const car = e.kind === 'car';
    // spray from the wheels in the swash, roost from soft sand, grass clumps
    v.spec.wheels.forEach(([lx], i) => {
      const dep = v.wheelDepth[i];
      wheelAt(v, i, _w);
      const wx = _w.x, wz = _w.z, gy = _w.y;
      const side = lx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(lx);
      if (dep > 0.015 && al > 1.2) {
        const rate = (e.kind === 'atv' ? 45 : car ? 60 : 16) * Math.min(1, al / 7) * Math.min(1, dep / 0.07) * (LOW ? 0.5 : 1);
        for (let n = poisson(rate * dt); n > 0; n--) {
          const up = (1.2 + Math.random() * 2.2) * Math.min(1.3, al / 6);
          const back = -v.lon * (0.25 + Math.random() * 0.3), out = side * (0.6 + Math.random() * 1.4);
          spray.emit(wx + side * 0.1, gy + 0.05, wz, -sy * back + cy * out, up, -cy * back - sy * out, P_WATER);
        }
      }
      const rear = i >= 2 || v.spec.wheels.length === 2;
      const soft = v.surf.kind === 'sand' ? v.surf.soft : 0, grass = v.surf.kind === 'grass';
      const dig = (e.kind === 'atv' && soft > 0.3 && input.throttle > 0.4 && al > 1.5) || (car && rear && (soft > 0.3 || grass) && input.throttle > 0.5 && (al < 6 || v.skid > 0.3));
      if (dig && rear) {
        const rate = (car ? 26 : 22) * (grass ? 0.7 : soft) * (LOW ? 0.5 : 1);
        for (let n = poisson(rate * dt); n > 0; n--) {
          const back = 1.5 + Math.random() * 2.5, out = side * Math.random() * 0.7;
          spray.emit(wx, gy + 0.04, wz, sy * back + cy * out, 0.8 + Math.random() * 1.4, cy * back - sy * out, grass ? P_GRASS : P_SAND);
        }
      }
      // tyre marks: the rear tyres while sliding, all four on the handbrake-free hard stop,
      // ruts in the soft sand
      if (skids && car) {
        const hardStop = input.throttle < -0.5 && v.lon > 6;
        let k = rear || hardStop ? v.skid : 0;
        if (rear && soft > 0.45 && al > 0.8) k = Math.max(k, 0.3 * soft);
        const kind = v.surf.kind === 'pavement' ? 'pavement' : v.surf.kind;
        skids.mark((v._skidKeys ??= v.spec.wheels.map(() => ({})))[i], wx, gy, wz, cy, -sy, k, kind);
        // tyre smoke off a hard slide on the road
        if (!LOW && rear && v.skid > 0.55 && kind === 'pavement' && al > 4 && Math.random() < dt * 14) spray.emit(wx, gy + 0.15, wz, (Math.random() - 0.5) * 0.6, 0.35, (Math.random() - 0.5) * 0.6, P_SMOKE);
      }
    });
    // contacts: sparks off metal / stone at speed, the camera jolts, a bumped traffic car stops
    const hit = v.hit;
    if (hit) {
      if (hit.speed > 1.2) shake = Math.max(shake, Math.min(1, hit.speed / 9));
      if (car && hit.tangent + hit.speed * 0.5 > 3 && hit.material !== 'person') {
        const n = Math.min(LOW ? 8 : 26, Math.round((hit.tangent + hit.speed) * (LOW ? 1 : 2.2)));
        const tx = -hit.nz, tz = hit.nx, dir = Math.sign(v.vx * tx + v.vz * tz) || 1;
        for (let k = 0; k < n; k++) {
          const sp = 2 + Math.random() * 5;
          spray.emit(hit.px, v.groundY + 0.25 + Math.random() * 0.35, hit.pz,
            tx * dir * sp + hit.nx * Math.random() * 2, 0.5 + Math.random() * 2.2, tz * dir * sp + hit.nz * Math.random() * 2, P_SPARK);
        }
      }
      if (hit.obj?.car && hit.speed > 0.8) traffic?.bump?.(hit.obj.car);
    }
    scrape = Math.max(scrape * Math.exp(-dt * 8), hit && hit.tangent > 1 ? Math.min(1, hit.tangent / 8) : 0);
    shake *= Math.exp(-dt * 7);
  }

  function update(dt) {
    dt = Math.min(dt, 0.05);
    clock += dt;
    dyn.length = 0;
    hbT = Math.max(0, hbT - dt);
    for (const c of dynamicCircles) dyn.push(c);
    movers.forEach((m, i) => {
      if (!m.visible) return;
      const s = Math.cos(m.rotation.y) >= 0 ? 1 : -1;
      for (const c of moverCircles[i]) { c.x = m.position.x; c.z = m.position.z + c.dz * s; dyn.push(c); }
    });
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
      } else if (Math.abs(v.bodyY - v.baseT) > 0.002 || Math.abs(v.bodyV) > 0.01 || Math.abs(v.pitchV) + Math.abs(v.rollV) > 0.01) {
        stepVehicle(v, { throttle: 0, steer: 0, hard: false, hop: false }, dt, world);
        pose3(e, clock);
      }
      if (e.kind === 'car') {
        // (world/cars-glb.js does the hero's LOD; the live modern ones here)
        e.drive.lod?.(Math.hypot(camera.position.x - v.x, camera.position.z - v.z));
        continue;
      }
      const far = Math.hypot(camera.position.x - v.x, camera.position.z - v.z) > 240;
      e.m.root.visible = e.m.shadow.visible = !far;
    }
    skids?.update(clock);

    if (!rider) {
      near = findNear();
      showPrompt(near ? (near.kind === 'car' ? '<b>E</b>enter' : '<b>E</b>ride') : '');
      setTouch(near ? (near.kind === 'car' ? 'enter' : 'ride') : null);
      fov += (BASE_FOV - fov) * (1 - Math.exp(-dt * 6));
      applyFov();
      spray.update(dt, renderer, camera);
      if (pendingEvent) { audio?.vehicle?.({ kind: null, event: pendingEvent }); pendingEvent = null; }
      return;
    }

    const e = rider, v = e.v;
    near = null;
    e.used = clock;
    if (e.kind === 'bike') e.kick = Math.max(0, e.kick - dt * 4);
    let input = { throttle: 0, steer: 0, hard: false, hop: false };
    if (trans) {
      trans.t += dt / trans.dur;
      walker.jumpReq = false;
    } else input = readInput(e);
    // the starter: cranks, then the engine catches. After a stall in the water it cranks
    // again on the throttle once the intake is clear
    if ((e.kind === 'car' || e.kind === 'atv') && !v.engineOn && e.startT <= 0 && !trans && input.throttle > 0.3 && (!v.stalled || canRestart(v))) {
      e.startT = e.kind === 'atv' ? STARTER.atv : e.origin === 'hero' ? STARTER.hero : STARTER.modern;
    }
    if (e.startT > 0) {
      e.startT -= dt;
      if (e.startT <= 0) {
        if (!v.stalled || canRestart(v)) { v.engineOn = true; v.stalled = false; v.rpm = e.kind === 'atv' ? 1800 : 1250; }
      }
    }
    stepVehicle(v, input, dt, world);
    if (offReq && Math.abs(v.lon) < 1.0) dismount();
    if (!rider) { spray.update(dt, renderer, camera); return; }
    // stranded outside the world (pushed, a glitch): fade and back to the road
    if (v.outsideT > 3) recover(true);
    pose3(e, clock);
    effects(e, input, dt);

    // look: mouse / drag deltas since the last frame move the head relative to the vehicle
    const chaseOn = view === 'chase' && e.kind === 'car';
    const d = wrap(walker.yaw - lastYaw);
    if (Math.abs(d) > 1e-5) { rel = wrap(rel + d); lookIdle = 0; } else lookIdle += dt;
    if (e.kind === 'car') {
      if (!chaseOn) rel = THREE.MathUtils.clamp(rel, -CAR_LOOK.yaw, CAR_LOOK.yaw);
      walker.pitch = THREE.MathUtils.clamp(walker.pitch, chaseOn ? -0.6 : CAR_LOOK.down, CAR_LOOK.up);
    }
    if (lookIdle > 1.4 && Math.abs(v.lon) > 1.5 && !trans) {
      rel *= Math.exp(-dt * 1.3);
      if (chaseOn) walker.pitch *= Math.exp(-dt * 1.3);
    }
    if (trans) {
      const k = Math.min(1, trans.t), s = k * k * (3 - 2 * k);
      rel = trans.rel0 * (1 - s);
      walker.pitch = THREE.MathUtils.lerp(trans.pitch0, THREE.MathUtils.degToRad(chaseOn ? -4 : RIDE_PITCH[e.kind]), s);
    }
    walker.yaw = v.yaw + rel;
    lastYaw = walker.yaw;

    // camera: rider's eye (pedalling bob / engine shake) or the chase arm
    const bob = { x: 0, y: 0 };
    if (e.kind === 'bike') {
      const a = Math.min(1, Math.abs(v.lon) / 3) * v.pedal;
      bob.y = 0.012 * a * Math.sin(v.crank * 2);
      bob.x = 0.008 * a * Math.sin(v.crank);
    } else if (e.kind === 'car') {
      // (the engine and road shake live in the sprung body the eye is anchored to)
    } else {
      const j = 0.0006 + 0.0012 * (v.rpm - 1400) / 6000;
      bob.y = j * Math.sin(clock * 83) + j * 0.6 * Math.sin(clock * 131);
      bob.x = j * 0.5 * Math.sin(clock * 97);
    }
    let fov0;
    if (chaseOn) {
      fov0 = chase.update(v, dt, { rel, lookPitch: walker.pitch, grid: world.grid, camera: _cam, groundAt: world.groundAt });
      _v.copy(_cam.position);
      _q.copy(_cam.quaternion);
    } else {
      eyeWorld(e, bob, _v);
      headQuat(e, _q);
      fov0 = e.kind === 'car' ? 58 + Math.min(1, Math.abs(v.lon) / 19) * 4 : 56 + Math.min(1, Math.abs(v.lon) / 12) * 5;
    }
    if (trans && trans.t < 1) {
      const k = trans.t, s = k * k * (3 - 2 * k);
      camera.position.lerpVectors(trans.pos, _v, s);
      camera.position.y -= trans.dip * Math.sin(Math.PI * Math.min(1, k * 1.4)) * (1 - s * 0.5);
      camera.quaternion.slerpQuaternions(trans.quat, _q, s);
    } else {
      trans = null;
      camera.position.copy(_v);
      camera.quaternion.copy(_q);
    }
    // impact jolt
    if (shake > 0.01) {
      const a = shake * (chaseOn ? 0.09 : 0.035);
      camera.position.x += (Math.random() - 0.5) * a; camera.position.y += (Math.random() - 0.5) * a; camera.position.z += (Math.random() - 0.5) * a;
      camera.quaternion.multiply(_q2.setFromEuler(_e.set((Math.random() - 0.5) * shake * 0.03, 0, (Math.random() - 0.5) * shake * 0.03)));
    }
    walker.pos.set(v.x, v.z);
    walker.feetY = v.groundY;
    fov += (fov0 - fov) * (1 - Math.exp(-dt * 3));
    applyFov();
    spray.update(dt, renderer, camera);

    // the ridden vehicle casts a live shadow: refresh the (static) shadow map as it moves
    const st = QUALITY.shadowStep ?? 0.5;
    if (!lastShadow || Math.hypot(v.x - lastShadow.x, v.z - lastShadow.z) > st || Math.abs(wrap(v.yaw - lastShadow.yaw)) > 0.06 || Math.abs(v.roll - lastShadow.roll) > 0.06) {
      lastShadow = { x: v.x, z: v.z, yaw: v.yaw, roll: v.roll };
      requestShadow();
    }

    audio?.vehicle?.({
      // (the hero's voice keeps its own rev mapping: no idle / redline for it)
      kind: e.kind, engine: v.spec.engine ?? (e.kind === 'car' ? 'v8classic' : undefined),
      idle: e.origin === 'hero' ? undefined : v.spec.idle, redline: e.origin === 'hero' ? undefined : v.spec.redline,
      lon: v.lon, throttle: input.throttle, rpm: v.rpm, load: v.load, surface: v.surf.kind, detail: v.surf.detail, soft: v.surf.soft,
      depth: Math.max(...v.wheelDepth), coasting: v.coasting, pedal: v.pedal, crank: v.crank, bump: v.curb > 0 ? 0 : v.bump, land: v.curb > 0 ? 0 : v.land,
      gear: v.gear, braking: v.braking, engineOn: v.engineOn, stalled: !!v.stalled, turn: v.turn ?? 0, handbrake: input.handbrake,
      hit: v.hit && v.hit.speed > 0.3 ? { speed: v.hit.speed, tangent: v.hit.tangent, material: v.hit.material } : null,
      scrape, curb: v.curb ?? 0, skid: v.skid ?? 0, horn: !!input.horn, event: pendingEvent ?? undefined,
    });
    pendingEvent = null;
    hud?.update(v, chaseOn || e.origin !== 'hero');

    hintT -= dt;
    if (offFail > 0) { offFail -= dt; showPrompt('No room to get out here'); }
    else if (v.stalled && !v.engineOn && e.startT <= 0) showPrompt(canRestart(v) ? '<b>W</b>restart' : 'Stalled — the water is too deep');
    else if (v.bogged) showPrompt('<b>S</b><b>W</b>rock it free &nbsp; <b>R</b>recover');
    else showPrompt(offReq ? 'Stopping…' : hintT > 0 ? (e.kind === 'car' ? '<b>E</b>get out &nbsp; <b>Space</b>handbrake &nbsp; <b>C</b>camera' : '<b>E</b>get off') : '');
    setTouch('off');
  }
  const _cam = new THREE.PerspectiveCamera();

  function applyFov() {
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
  function setTouch(mode) {
    const kind = rider?.kind ?? near?.kind;
    const key = mode + '|' + kind;
    if (key === touchMode) return;
    const t = getTouch();
    if (!t?.setRide) return;
    touchMode = key;
    t.setRide(mode, kind);
  }

  const api = {
    list,
    colliders,
    world,
    hud,
    skids,
    get riding() { return !!rider; },
    get current() { return rider?.v ?? null; },
    get currentEntry() { return rider; },
    get near() { return near?.kind ?? null; },
    get nearDoor() { return near?.door ?? null; },
    get view() { return view; },
    // test hook: a held steering input (-1..1), null for the keys
    steerHold: null,
    update,
    toggle,
    recover,
    setView: (mode) => setView(mode),
    toggleView: () => { if (rider?.kind === 'car') setView(view === 'chase' ? 'fp' : 'chase'); },
    mount: (kind) => mount(list.find((e) => e.kind === kind)),
    dismount,
    // the parked fleet: spots that can be driven off (not taken), nearest first
    parkedNear(x, z, body = null) {
      return drivable.filter((s) => !s.taken && (!body || s.kind === body)).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    },
    // test hook: the door points of a spot or entry
    doorsOf(q) { return q.v ? doors(q.v, q.body, q.v.spec.width ?? 2) : doors(q.pose, q.kind, OPEN_SPECS[q.kind]?.width ?? 1.9); },
    // test hook: move the ridden (or named) vehicle to a pose, at rest
    // (the car never lands inside something solid: a blocked spot slides to the nearest
    // clear one along its heading, e.g. the next gap in a parked row; returns where it ended up)
    place(x, z, yaw, kind) {
      const e = kind ? list.find((q) => q.kind === kind && (kind !== 'car' || q.origin === 'hero')) : rider;
      if (!e) return null;
      const put = (px, pz) => { Object.assign(e.v, { x: px, z: pz, yaw, vx: 0, vz: 0, lon: 0, steer: 0 }); if (e.v.yawV !== undefined) e.v.yawV = 0; settle(e.v, world); return !blockedAt(e.v, px, pz, yaw, world); };
      let ok = put(x, z);
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      for (let k = 1; !ok && e.kind === 'car' && k <= 120; k++) {
        const d = Math.ceil(k / 2) * 0.25 * (k % 2 ? 1 : -1);
        ok = put(x + fx * d, z + fz * d);
      }
      if (!ok) put(x, z);
      pose3(e, clock);
      chase.snap();
      return { x: e.v.x, z: e.v.z, ok };
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
      return list.map((e) => ({ kind: e.kind, body: e.body, origin: e.origin, x: +e.v.x.toFixed(2), z: +e.v.z.toFixed(2), yaw: +e.v.yaw.toFixed(3), ridden: e.v.ridden, speed: +e.v.lon.toFixed(2), surf: e.v.surf.kind, engineOn: e.v.engineOn }));
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
