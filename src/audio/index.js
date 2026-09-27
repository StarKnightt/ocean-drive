// Ocean Drive spatial audio engine. Everything is synthesized with WebAudio at runtime.
//
//   const audio = createAudio();
//   audio.start();                     // call from a user gesture (no-op in ?shot= mode)
//   audio.update(dt, camera);          // THREE camera, or update(dt, {x,y,z}, headingRad)
//   audio.footstep('sand');            // manual step; audio.setAutoSteps(false) to disable auto steps
//   audio.onCarPass((car) => ...);     // car = { id, x, y, dir, speed, t0, duration, z (live), active }
import * as Layout from '../world/layout.js';
import { rr } from './dsp.js';
import { createEngine } from './engine.js';
import { createWaves } from './waves.js';
import { createGulls } from './gulls.js';
import { createWind } from './wind.js';
import { createCars } from './car.js';
import { createMusic } from './music.js';
import { createFootsteps } from './footsteps.js';
import { createVehicleAudio } from './vehicles.js';
import { surfaceAt } from './surface.js';
import { PALM_CLUSTERS } from '../world/palms.js';

export { surfaceAt };

const EYE = Layout.EYE_HEIGHT ?? 1.7;
const WATERLINE = Layout.SAND?.waterline ?? 90;
const TOWER = Layout.TOWER ?? { x: 45, z: 5, deckHeight: 2.7 };
const PATIO = { x: -29, y: 1.6, z: -10 };
// Palm clusters (x, z) along both sidewalks and in the park (from the placed palms).
const PALMS = PALM_CLUSTERS;
const STRIDE = 0.75;

const isShot = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('shot');

function readPose(L, cam, heading) {
  if (cam && cam.isObject3D) {
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    L.x = e[12]; L.y = e[13]; L.z = e[14];
    const fl = Math.hypot(e[8], e[9], e[10]) || 1, ul = Math.hypot(e[4], e[5], e[6]) || 1;
    L.fx = -e[8] / fl; L.fy = -e[9] / fl; L.fz = -e[10] / fl;
    L.ux = e[4] / ul; L.uy = e[5] / ul; L.uz = e[6] / ul;
  } else if (cam) {
    L.x = cam.x; L.y = cam.y; L.z = cam.z;
    const h = heading ?? 0; // compass radians: 0 = north (-z), +pi/2 = east (+x)
    L.fx = Math.sin(h); L.fy = 0; L.fz = -Math.cos(h);
    L.ux = 0; L.uy = 1; L.uz = 0;
  }
}

function applyListener(ctx, L, immediate) {
  const l = ctx.listener;
  if (l.positionX) {
    const t = ctx.currentTime;
    const set = (p, v) => (immediate ? (p.value = v) : p.setTargetAtTime(v, t, 0.015));
    set(l.positionX, L.x); set(l.positionY, L.y); set(l.positionZ, L.z);
    set(l.forwardX, L.fx); set(l.forwardY, L.fy); set(l.forwardZ, L.fz);
    set(l.upX, L.ux); set(l.upY, L.uy); set(l.upZ, L.uz);
  } else {
    l.setPosition(L.x, L.y, L.z);
    l.setOrientation(L.fx, L.fy, L.fz, L.ux, L.uy, L.uz);
  }
}

function buildScene(env, reduced) {
  return {
    waves: createWaves(env, { waterlineX: WATERLINE }),
    gulls: createGulls(env),
    // fewer simultaneous voices on small devices: every other palm-cluster rustle source
    wind: createWind(env, reduced ? PALMS.filter((_, i) => i % 2 === 0) : PALMS),
    cars: createCars(env),
    music: createMusic(env, PATIO),
    steps: createFootsteps(env),
    vehicles: createVehicleAudio(env),
  };
}

export function createAudio({ volume = 0.8, autoSteps = true, voices = 'full' } = {}) {
  const reduced = voices === 'reduced';
  let ctx = null, env = null, parts = null, timer = null;
  let muted = false, vol = volume, auto = autoSteps;
  let nextWave = 0, nextGull = 0, nextCar = 0, spatialAcc = 0;
  const L = { x: 0, y: EYE, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 };
  const carCbs = new Set(), waveCbs = new Set();
  const walk = { x: null, z: null, acc: 0, still: 0 };
  let gullSource = null;   // BIRDS hook: calls come from real gulls

  function tick() {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const ahead = now + (typeof document !== 'undefined' && document.hidden ? 1.5 : 0.35);
    parts.music.tick(now, ahead);
    if (nextWave < now) nextWave = now + 0.1;
    while (nextWave < ahead) {
      const w = parts.waves.breakAt(nextWave, L);
      waveCbs.forEach((cb) => cb({ ...w, now }));   // w.t is on the audio clock
      nextWave += rr(6, 10);
    }
    if (nextGull < now) nextGull = now + rr(1, 4);
    while (nextGull < ahead) { parts.gulls.callAt(nextGull, L); nextGull += reduced ? rr(10, 30) : rr(5, 20); }
    if (now >= nextCar) { parts.cars.spawn(); nextCar = now + rr(40, 70); }
  }

  function applyVolume(tc = 0.08) {
    if (!ctx) return;
    env.volume.gain.setTargetAtTime(muted ? 0 : vol, ctx.currentTime, tc);
  }

  const api = {
    // Must be called from a user gesture. Returns false in ?shot= mode.
    start() {
      if (isShot()) return false;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC({ latencyHint: 'interactive' });
        env = createEngine(ctx);
        Object.assign(env.listener, L);
        applyListener(ctx, L, true);
        parts = buildScene(env, reduced);
        parts.cars.onPass((c) => carCbs.forEach((cb) => cb(c)));
        parts.gulls.setSource(gullSource);   // BIRDS hook
        const now = ctx.currentTime;
        nextWave = now + 0.8; nextGull = now + rr(2, 6); nextCar = now + rr(10, 25);
        timer = setInterval(tick, 50);
        tick();
        applyVolume(0.6);
      }
      if (ctx.state !== 'running') ctx.resume().then(() => applyVolume(0.6));
      return true;
    },

    update(dt, cam, heading) {
      readPose(L, cam, heading);
      if (auto) autoStep(dt);
      if (!ctx || ctx.state !== 'running') return;
      Object.assign(env.listener, { x: L.x, y: L.y, z: L.z });
      applyListener(ctx, L, false);
      parts.cars.update(L);
      spatialAcc += dt;
      if (spatialAcc >= 0.05) {
        spatialAcc = 0;
        parts.waves.track(L);
        for (const s of env.spatials) s.update(L);
      }
    },

    footstep(surface = 'pavement', opts) {
      if (ctx && ctx.state === 'running') parts.steps.step(surface, opts);
    },
    // the ridden vehicle's sounds, once per frame: state = { kind: 'bike' | 'atv' | null, ... }
    // (see audio/vehicles.js); { kind: null } switches them off
    vehicle(state) {
      if (ctx && ctx.state === 'running') parts.vehicles.update(state);
    },
    surfaceAt,
    setAutoSteps(on) { auto = !!on; },
    setMuted(m) { muted = !!m; applyVolume(); },
    setVolume(v) { vol = Math.max(0, Math.min(1, v)); applyVolume(); },
    get muted() { return muted; },

    // Car hook for visuals: cb(car) fires when a car starts its pass; car.z is live.
    onCarPass(cb) { carCbs.add(cb); return () => carCbs.delete(cb); },
    // Wave hook for visuals: cb({ t, now, k, size, runup, z }) per scheduled break;
    // t - now = seconds until the wave starts (crash at t + 2.15k)
    onWave(cb) { waveCbs.add(cb); return () => waveCbs.delete(cb); },
    onCarEnd(cb) { return parts ? parts.cars.onEnd(cb) : () => {}; },
    getCars() { return parts ? parts.cars.list() : []; },
    spawnCar(opts) { return parts ? parts.cars.spawn(opts) : null; },
    // BIRDS hooks: fn(L) -> { x, y, z, vx, vy, vz } of a visible gull (or null) voices each
    // gull call; wingFlutter(p) plays the wingbeats of a gull taking off near the listener
    setGullSource(fn) { gullSource = fn; parts?.gulls.setSource(fn); },
    wingFlutter(p) { if (ctx && ctx.state === 'running') parts.gulls.flutterAt(ctx.currentTime + 0.02, p); },

    get context() { return ctx; },
    stats() {
      return { state: ctx?.state ?? 'none', spatials: env?.spatials.size ?? 0, cars: parts?.cars.list().length ?? 0, time: ctx?.currentTime ?? 0 };
    },
    dispose() { clearInterval(timer); ctx?.close(); ctx = null; },
  };

  // Step every ~0.75 m of horizontal travel while the camera is on the ground.
  function autoStep(dt) {
    if (walk.x === null) { walk.x = L.x; walk.z = L.z; return; }
    const d = Math.hypot(L.x - walk.x, L.z - walk.z);
    walk.x = L.x; walk.z = L.z;
    if (d > 4 || dt <= 0) { walk.acc = 0; return; }
    const feet = L.y - EYE;
    const ground = Layout.groundHeight ? Layout.groundHeight(L.x, L.z) : 0;
    const onTower = Math.abs(L.x - TOWER.x) < 3.5 && Math.abs(L.z - TOWER.z) < 4.5 &&
      feet > ground - 0.3 && feet < (TOWER.deckHeight ?? 2.7) + 0.5;
    const grounded = Math.abs(feet - ground) < 0.35 || onTower;
    const speed = d / dt;
    if (!grounded || speed < 0.3) {
      walk.still += dt;
      if (walk.still > 0.25) walk.acc = STRIDE * 0.6;
      return;
    }
    walk.still = 0;
    const stride = STRIDE * (speed > 3 ? 1.35 : 1);
    walk.acc += d;
    if (walk.acc >= stride) {
      walk.acc -= stride;
      api.footstep(surfaceAt(L.x, L.z, feet, WATERLINE), { gain: Math.min(1.25, 0.8 + speed * 0.08) });
    }
  }

  return api;
}

// Offline render of one sound for verification: returns peak/RMS of the master output.
// names: waves, waves-street, gulls, wind, car, music, music-far, steps-<surface>
export async function renderTest(name, seconds = 6) {
  const sr = 48000;
  const octx = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
  const env = createEngine(octx);
  env.volume.gain.value = 1;
  const setL = (x, y, z) => {
    Object.assign(env.listener, { x, y, z });
    applyListener(octx, { x, y, z, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 }, true);
  };
  const L = env.listener;
  if (name === 'waves' || name === 'waves-street') {
    setL(name === 'waves' ? 82 : -26, 1.85, 0);
    const w = createWaves(env, { waterlineX: WATERLINE });
    w.track(L); w.breakAt(0.2, L, 1);
  } else if (name === 'gulls') {
    setL(40, 1.9, 0);
    const g = createGulls(env);
    g.callAt(0.2, L, 'kyow'); g.callAt(Math.min(3.5, seconds - 2), L, 'laugh');
  } else if (name === 'wind') {
    setL(-12, 1.85, -8);
    createWind(env, PALMS);
  } else if (name === 'car') {
    setL(-12, 1.85, 0);
    createCars(env).spawn({ dir: 1, zStart: -(25 / 3.6) * seconds * 0.5, speed: 25 / 3.6, at: 0 });
  } else if (name === 'music' || name === 'music-far') {
    if (name === 'music') setL(-26, 1.85, -6); else setL(-12, 1.85, 30);
    createMusic(env, PATIO).tick(0, seconds - 1);
  } else if (name.startsWith('steps-')) {
    setL(0, 1.7, 0);
    const fs = createFootsteps(env);
    for (let t = 0.1; t < seconds - 0.5; t += 0.55) fs.step(name.slice(6), { at: t });
  } else throw new Error(`unknown test ${name}`);
  for (const s of env.spatials) s.update(L, true);
  const buf = await octx.startRendering();
  let peak = 0, sum = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; }
  }
  const rms = Math.sqrt(sum / (buf.length * buf.numberOfChannels));
  const db = (v) => Math.round(20 * Math.log10(v + 1e-12) * 10) / 10;
  return { name, peak: +peak.toFixed(4), rms: +rms.toFixed(5), peakDb: db(peak), rmsDb: db(rms), clipped: peak >= 0.999 };
}
