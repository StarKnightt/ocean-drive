// Traffic on Ocean Drive: the cars of traffic-sim.js drawn with the GLB fleet models (and
// now and then a two-tone classic convertible), wheels spinning, a sprung nose dive under
// braking (and a brief dip as a car comes to rest), tail lamps lit and brake lamps glowing,
// both LODs, a contact blob and a soft sun shadow; moving collider circles for the walker and
// the ridden vehicles; the 11 ST signal lamps; positional engine / horn sounds via the audio
// hooks. None in ?shot mode (the harness frames stay comparable).
// Instances are pooled per body style (a respawn takes a free one of its model), and only
// cars within CULL of the viewer are drawn; the sim itself is cheap for all of them.
import * as THREE from 'three';
import { roadHeight } from './layout.js';
import { createTrafficSim, createPicker, crossSignalState, END_Z } from './traffic-sim.js';
import { SIGNAL_LIGHTS } from './street.js';
import { QUALITY } from '../quality.js';

// (the loop runs on past the district ends, out of sight: ~3/4 of these are in the district,
// ~23 / 14 / 6 on high / medium / low)
const COUNT = { high: 30, medium: 18, low: 8 }[QUALITY.tier] ?? 18;
const CULL = 250;             // m: cars further away are hidden
const CIRCLES = [-1.8, -0.9, 0, 0.9, 1.8];
// lamp emissive [hex, intensity]: tail lamps faintly lit while driving, brake lamps bright
// saturated red with a small halo, the high-mounted stop lamp dark until braking
// (ACES bleeds a hot pure red into orange: the brake stays under ~1.6 with a crimson bias,
// still ~15x the tail)
const TAIL = { run: [0x5a0304, 1], brake: [0xff0010, 1.55] };
const STOP3 = { run: [0x140102, 1], brake: [0xff0010, 1.55] };

export function buildTraffic(scene, { kit, shot = false, seed = 11 } = {}) {
  const colliders = [];   // live circles, filled per slot below
  if (shot || !kit || (!kit.kinds.length && !kit.classics.length)) {
    SIGNAL_LIGHTS.set('green', 'red');
    return { colliders, cars: [], sim: null, update() {}, state: () => [], honks: () => [], audioList: () => [], attachDrivers() {} };
  }
  const classicsFree = new Set(kit.classics);
  let simCars = null, initClassics = 0;
  const onRoad = () => (simCars ? simCars.filter((c) => c.classic && !c.hidden).length : initClassics);
  const picker = createPicker({
    kinds: kit.kinds, lens: kit.lens, paints: kit.paints,
    classicFree: () => kit.classics.length - onRoad(), classicOnRoad: onRoad,
  });
  const pickModern = createPicker({ kinds: kit.kinds, lens: kit.lens, paints: kit.paints });
  const pickModel = (rnd, prev) => {
    const m = picker(rnd, prev);
    if (!simCars && m.classic) initClassics++;
    return m;
  };
  const sim = createTrafficSim({ count: COUNT, seed, pickModel });
  simCars = sim.cars;

  // driver hook (attachDrivers): make({ rig, kind, classic }) -> { body, update(rig, car) }
  let driverMaker = null;
  const attach = (I) => {
    if (!driverMaker || I.driver || !I.rig?.pelvis) return;
    const d = driverMaker({ rig: I.rig, kind: I.kind ?? 'classic', classic: !!I.classic });
    if (!d?.body) return;
    I.rig.pelvis.add(d.body);
    I.driver = d;
  };
  // free modern instances per body style
  const pools = {};
  const all = [];
  const take = (kind) => {
    let I = (pools[kind] ??= []).pop();
    if (!I) { I = kit.makeModern(kind); all.push(I); attach(I); }
    return I;
  };
  const classicInst = new Map(kit.classics.map((m) => [m, {
    root: m.car, levels: m.levels, wheels: [m.wheels.slice(0, 4), m.wheels.slice(4, 8)], wheelR: m.wheelR, sway: m.sway,
    tail: m.tail, brake3: null, rig: m.driverRig, sun: m.sun, halos: m.halos, classic: m, len: 5.76,
  }]));

  const slots = sim.cars.map((c) => ({
    car: c, inst: null, pitch: 0, pitchV: 0, spin: 0, lod: -1, lastRespawn: -1, vPrev: 0, lamp: null,
    circles: CIRCLES.map((dz) => ({ x: 0, z: 0, r: 0, dz, car: c })),
  }));
  for (const s of slots) colliders.push(...s.circles);

  function release(s) {
    const I = s.inst;
    if (!I) return;
    I.root.visible = false;
    if (I.classic) classicsFree.add(I.classic);
    else pools[I.kind].push(I);
    s.inst = null;
  }
  function bind(s) {
    const c = s.car;
    release(s);
    if (c.classic) {
      const m = [...classicsFree][0];
      if (m) {
        classicsFree.delete(m);
        s.inst = classicInst.get(m);
        attach(s.inst);
      } else {
        // (no free classic: this one comes back modern)
        Object.assign(c, { classic: false }, pickModern(() => 0.5, null));
      }
    }
    if (!s.inst) {
      s.inst = take(c.model);
      s.inst.paint.color.setHex(c.color ?? 0xb9bcbf);
    }
    s.lod = -1;
    s.lamp = null;
    s.lastRespawn = c.respawns;
    s.pitch = s.pitchV = 0;
  }

  // bind every slot now, both LODs showing, so main.js's shader warm-up compiles the traffic
  // variants (the first update() hides what isn't in view)
  for (const s of slots) {
    bind(s);
    if (!s.inst.sway) { s.inst.root.visible = true; s.inst.levels.forEach((lv) => { lv.visible = true; }); s.lod = -1; }
  }
  const honkQueue = [];
  const sunDir = { x: 0, z: 0, len: 0 };
  const setLamp = (m, [hex, k]) => { if (m) { m.emissive.setHex(hex); m.emissiveIntensity = k; } };
  // debug hooks for the by-eye harness: freeze the sim, extra (unseen) pedestrians
  const debug = { freeze: false, peds: [] };
  function update(dt, { camera, peds = [], obstacles = [] }) {
    const viewer = camera ? { x: camera.position.x, z: camera.position.z } : null;
    if (!debug.freeze) sim.update(dt, { peds: debug.peds.length ? [...peds, ...debug.peds] : peds, obstacles, viewer });
    SIGNAL_LIGHTS.set(sim.signal, crossSignalState(sim.time));
    const sun = kit.sun?.(sunDir);
    for (const s of slots) {
      const c = s.car;
      if (s.lastRespawn !== c.respawns || !s.inst) bind(s);
      const I = s.inst;
      const d = viewer ? Math.hypot(viewer.x - c.x, viewer.z - c.z) : 0;
      const vis = !c.hidden && Math.abs(c.z) < END_Z && d < CULL;
      I.root.visible = vis;
      for (const q of s.circles) { q.x = c.x; q.z = c.z + q.dz * (c.len / 4.8); q.r = c.hidden ? 0 : 0.95; }
      if (c.honk > (s.honks ?? 0)) { s.honks = c.honk; honkQueue.push({ x: c.x, z: c.z, classic: c.classic, id: c.id }); }
      if (!vis) { s.vPrev = c.v; continue; }
      // pose: lane, road camber, heading; a sprung nose dive / squat from the acceleration,
      // and a kick as the car comes to rest (the nose dips, then settles)
      // (edging round something or swinging out to pass: turned along its path)
      const yaw = Math.atan2(THREE.MathUtils.clamp(c.xRate ?? 0, -0.3 * Math.max(c.v, 1.5), 0.3 * Math.max(c.v, 1.5)), c.dir * Math.max(c.v, 1.5));
      const slope = (roadHeight(c.x + 0.9) - roadHeight(c.x - 0.9)) / 1.8;
      const pT = THREE.MathUtils.clamp(-c.a * 0.009, -0.015, 0.03);
      if (s.vPrev > 0.25 && c.v < 0.02 && dt > 0) s.pitchV += 0.07;
      s.vPrev = c.v;
      s.pitchV += (40 * (pT - s.pitch) - 2 * 0.3 * Math.sqrt(40) * s.pitchV) * dt;
      s.pitch += s.pitchV * dt;
      I.root.position.set(c.x, roadHeight(c.x), c.z);
      if (I.sway) {
        I.root.rotation.set(0, yaw, Math.atan(slope) * (c.dir > 0 ? 1 : -1), 'YXZ');
        I.sway.rotation.set(s.pitch, 0, 0);
      } else {
        I.root.rotation.set(s.pitch, yaw, Math.atan(slope) * (c.dir > 0 ? 1 : -1), 'YXZ');
        // (the modern models' LODs are ours; the classics' are world/cars-glb.js's)
        const lod = d < kit.lod1At ? 0 : d > kit.lod1At + 4 || s.lod < 0 ? 1 : s.lod;
        if (lod !== s.lod) {
          s.lod = lod;
          I.levels.forEach((lv, k) => { lv.visible = k === lod; });
        }
      }
      s.spin += (c.v * dt) / I.wheelR;
      for (const set of I.wheels) for (const w of set) w.rotation.x = s.spin;
      // lamps (stunned after a bump: the tail lamps flash as hazards)
      const lamp = c.stunT > 0 ? ((sim.time * 1.6) % 1 < 0.5 ? 'brake' : 'run') : c.braking ? 'brake' : 'run';
      if (s.lamp !== lamp) {
        s.lamp = lamp;
        setLamp(I.tail, TAIL[lamp]);
        setLamp(I.brake3, STOP3[lamp]);
        if (I.halos) I.halos.visible = lamp === 'brake';
      }
      // sun shadow: the footprint pushed away from the sun (in the car's frame)
      if (I.sun) {
        I.sun.visible = !!sun;
        if (sun) {
          const cy = Math.cos(yaw), sy = Math.sin(yaw);
          const lx = sun.x * cy - sun.z * sy, lz = sun.x * sy + sun.z * cy, L = sun.len;
          I.sun.position.set(lx * L * 0.5, 0.014, lz * L * 0.5);
          I.sun.scale.set(1.9 + Math.abs(lx) * L, 1, I.len + Math.abs(lz) * L);
        }
      }
      // (the driver sits in the near level only)
      if (I.driver?.update && I.levels[0].visible) {
        I.rig.pelvis.updateWorldMatrix(true, false);
        I.driver.update(I.rig, c);
      }
    }
  }

  return {
    sim, colliders, update, debug,
    get cars() { return sim.cars; },
    // Seat a skinned driver in every traffic car (the Mixamo drivers): make({ rig, kind,
    // classic }) returns { body, update(rig, car) }. `body` is parented to the model's
    // driver_pelvis anchor; update runs after each pose with world matrices current, to IK
    // the hands to rig.gripL / rig.gripR (empties on the wheel rim at ten and two)
    attachDrivers(make) {
      driverMaker = make;
      for (const I of all) attach(I);
      for (const s of slots) if (s.inst) attach(s.inst);
    },
    // audio: per visible car { id, x, z, v, a, dir, classic, braking }
    audioList() {
      return sim.cars.filter((c) => !c.hidden && Math.abs(c.z) < END_Z).map((c) => ({ id: c.id, x: c.x, z: c.z, v: c.v, a: c.a, dir: c.dir, classic: c.classic, braking: c.braking }));
    },
    honks() { return honkQueue.splice(0); },
    // the player bumped traffic car c: it stops with its hazards on and honks once
    bump(c, seconds = 4) {
      if (!c || c.hidden) return;
      if (!(c.stunT > 0)) c.honk++;
      c.stunT = Math.max(c.stunT ?? 0, seconds);
    },
    state() {
      return sim.cars.map((c) => ({ id: c.id, model: c.model, color: c.color, dir: c.dir, z: +c.z.toFixed(1), v: +c.v.toFixed(2), a: +c.a.toFixed(2), braking: c.braking, reason: c.reason, hidden: c.hidden, len: c.len }));
    },
    get signal() { return sim.signal; },
    get time() { return sim.time; },
  };
}
