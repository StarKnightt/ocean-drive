// Traffic on Ocean Drive: the cars of traffic-sim.js drawn with the GLB fleet models (and
// now and then a classic convertible in another colour), wheels spinning, a little nose dive
// under braking, brake lights, both LODs; moving collider circles for the walker and the
// ridden vehicles; the 11 ST signal lamps; positional engine / horn sounds via the audio
// hooks. None in ?shot mode (the harness frames stay comparable).
import * as THREE from 'three';
import { roadHeight } from './layout.js';
import { createTrafficSim, crossSignalState, END_Z } from './traffic-sim.js';
import { SIGNAL_LIGHTS } from './street.js';
import { QUALITY } from '../quality.js';

const COUNT = { high: 5, medium: 4, low: 2 }[QUALITY.tier] ?? 4;
const CULL = 300;             // m: cars further away are hidden
const CLASSIC = 0.2;          // share of respawns that come back as a classic convertible
const CIRCLES = [-1.8, -0.9, 0, 0.9, 1.8];

export function buildTraffic(scene, { kit, shot = false, seed = 11 } = {}) {
  const colliders = [];   // live circles, filled per slot below
  if (shot || !kit || (!kit.kinds.length && !kit.classics.length)) {
    SIGNAL_LIGHTS.set('green', 'red');
    return { colliders, cars: [], sim: null, update() {}, state: () => [], honks: () => [] };
  }
  const classicsFree = new Set(kit.classics);
  const pickModel = (rnd) => {
    if ((rnd() < CLASSIC && classicsFree.size) || !kit.kinds.length) return { model: 'classic', len: 5.76, classic: true };
    const kind = kit.kinds[Math.floor(rnd() * kit.kinds.length)];
    return { model: kind, len: kit.lens[kind] + 0.1, color: kit.paints[Math.floor(rnd() * kit.paints.length)] };
  };
  const sim = createTrafficSim({ count: COUNT, seed, pickModel });

  // per slot: its paint and tail materials, a lazily built instance per model, collider circles
  const slots = sim.cars.map((c) => ({
    car: c, paint: kit.paint(0xffffff), tail: kit.tail(), models: {}, inst: null, classic: null, model: null,
    pitch: 0, pitchV: 0, spin: 0, lod: 0, lastRespawn: -1,
    circles: CIRCLES.map((dz) => ({ x: 0, z: 0, r: 0, dz })),
  }));
  for (const s of slots) colliders.push(...s.circles);

  function bind(s) {
    const c = s.car;
    if (s.inst) s.inst.root.visible = false;
    if (s.classic) { s.classic.car.visible = false; classicsFree.add(s.classic); s.classic = null; }
    s.inst = null;
    if (c.classic) {
      const m = [...classicsFree][0];
      if (m) {
        classicsFree.delete(m);
        s.classic = m;
        s.inst = { root: m.car, levels: m.levels, wheels: [m.wheels.slice(0, 4), m.wheels.slice(4, 8)], wheelR: m.wheelR, sway: m.sway, tail: m.tail, classic: true };
      } else {
        // (no free classic: this one comes back modern)
        Object.assign(c, { classic: false }, pickModel(() => 0.99));
      }
    }
    if (!s.inst) {
      s.paint.color.setHex(c.color ?? 0xb9bcbf);
      s.inst = s.models[c.model] ??= kit.makeModern(c.model, s.paint, s.tail);
      s.inst.tail = s.tail;
    }
    s.model = c.model;
    s.lod = -1;
    s.lastRespawn = c.respawns;
    s.pitch = s.pitchV = 0;
  }

  // bind every slot now, both LODs showing, so main.js's shader warm-up compiles the traffic
  // variants (the first update() hides what isn't in view)
  for (const s of slots) {
    bind(s);
    if (!s.inst.sway) { s.inst.root.visible = true; s.inst.levels.forEach((lv) => { lv.visible = true; }); s.lod = -1; }
  }
  const _v = new THREE.Vector3();
  const honkQueue = [];
  function update(dt, { camera, peds, obstacles }) {
    const viewer = camera ? { x: camera.position.x, z: camera.position.z } : null;
    sim.update(dt, { peds, obstacles, viewer });
    SIGNAL_LIGHTS.set(sim.signal, crossSignalState(sim.time));
    for (const s of slots) {
      const c = s.car;
      if (s.lastRespawn !== c.respawns || !s.inst) bind(s);
      const I = s.inst;
      const d = viewer ? Math.hypot(viewer.x - c.x, viewer.z - c.z) : 0;
      const vis = !c.hidden && Math.abs(c.z) < END_Z && d < CULL;
      I.root.visible = vis;
      for (const q of s.circles) { q.x = c.x; q.z = c.z + q.dz * (c.len / 4.8); q.r = c.hidden ? 0 : 0.95; }
      if (c.honk > (s.honks ?? 0)) { s.honks = c.honk; honkQueue.push({ x: c.x, z: c.z, classic: c.classic, id: c.id }); }
      if (!vis) continue;
      // pose: lane, road camber, heading; a sprung nose dive / squat from the acceleration
      const yaw = c.dir > 0 ? 0 : Math.PI;
      const slope = (roadHeight(c.x + 0.9) - roadHeight(c.x - 0.9)) / 1.8;
      const pT = THREE.MathUtils.clamp(-c.a * 0.006, -0.012, 0.022);
      s.pitchV += (40 * (pT - s.pitch) - 2 * 0.35 * Math.sqrt(40) * s.pitchV) * dt;
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
      // brake lights
      const on = c.braking;
      if (I.tail.userData.on !== on) {
        I.tail.userData.on = on;
        I.tail.emissive.setHex(on ? 0xff2412 : 0x2a0304);
        I.tail.emissiveIntensity = on ? 1.7 : 1;
      }
    }
  }

  return {
    sim, colliders, update,
    get cars() { return sim.cars; },
    // audio: per visible car { id, x, z, v, a, dir, classic, braking }
    audioList() {
      return sim.cars.filter((c) => !c.hidden && Math.abs(c.z) < END_Z).map((c) => ({ id: c.id, x: c.x, z: c.z, v: c.v, a: c.a, dir: c.dir, classic: c.classic, braking: c.braking }));
    },
    honks() { return honkQueue.splice(0); },
    state() {
      return sim.cars.map((c) => ({ id: c.id, model: c.model, dir: c.dir, z: +c.z.toFixed(1), v: +c.v.toFixed(2), braking: c.braking, reason: c.reason, hidden: c.hidden }));
    },
    get signal() { return sim.signal; },
  };
}
