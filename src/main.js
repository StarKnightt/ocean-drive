import * as THREE from 'three';
import { createSky } from './sky.js';
import { createPost } from './renderer/post.js';
import { buildPlaceholders } from './world/placeholders.js';
import { buildHotels } from './world/hotels.js';
import { buildPalms, PALM_TREES } from './world/palms.js';
import { buildStreet, STREET_COLLIDERS } from './world/street.js';
import { buildCars } from './world/car.js';
import { createOcean } from './world/ocean.js';
import { createSurf } from './world/surf.js';
import { buildBeach } from './world/beach.js';
import { Walker } from './player/walker.js';
import { EYE_HEIGHT, CURB_HEIGHT, SAND, WET_LINE_X, TOWERS, HOTEL, DISTRICT } from './world/layout.js';
import { updateLod } from './world/lod.js'; // DISTRICT: per-block distance culling
import { createAudio } from './audio/index.js'; // SOUND agent: synthesized spatial audio
import { createBirds } from './world/birds.js'; // BIRDS: pelicans, gulls, sanderlings, grackles
import { buildPeople } from './world/people.js'; // PEOPLE: jogger, beach walker, cafe worker, cyclist
import { QUALITY, IS_TOUCH } from './quality.js';
import { createTouchControls } from './player/touch.js';
import { createVehicles } from './vehicles/index.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') === '1';
const FROZEN_TIME = 12.0;

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false });
// render scale: the tier's base scale, stepped down / up by the dynamic resolution below.
// The base pixel ratio respects both the tier's DPR cap and its pixel budget, so a 4K or
// high-DPI screen renders about as many pixels as a 1080p one.
const baseDpr = () => Math.max(0.5, Math.min(window.devicePixelRatio, QUALITY.maxDpr,
  Math.sqrt(QUALITY.maxPixels / (window.innerWidth * window.innerHeight))));
let renderScale = QUALITY.renderScale;
// the first frames start at half resolution and ramp up, so the first (heaviest) GPU
// submissions stay small
let startScale = SHOT ? 1 : 0.5;
const pixelRatio = () => baseDpr() * renderScale * startScale;
renderer.setPixelRatio(pixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const TONE = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping };
renderer.toneMapping = TONE[params.get('tm')] ?? THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = parseFloat(params.get('exp') ?? '0.62');
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false; // static casters; set needsUpdate when something moves
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);

// A lost WebGL context (the driver reset after a GPU timeout, or memory pressure): stop
// drawing, say so, and reload once at a lighter tier. ?gpureset marks that reload, so a
// second loss shows a manual button instead of looping.
const LIGHTER = { high: 'medium', medium: 'low', low: 'low' };
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  renderer.setAnimationLoop(null);
  window.__contextLost = true;
  const again = params.has('gpureset');
  const next = new URL(location.href);
  next.searchParams.set('quality', LIGHTER[QUALITY.tier]);
  next.searchParams.set('gpureset', '1');
  next.searchParams.delete('ultra');
  const box = document.createElement('div');
  box.id = 'gpu-reset';
  box.innerHTML = again
    ? '<p>The graphics driver reset again.</p><p class="sub">This machine may need a lighter setting.</p><button type="button">Reload at low quality</button>'
    : '<p>The graphics driver reset — reloading at a lighter quality…</p>';
  document.body.appendChild(box);
  document.getElementById('loader')?.remove();
  document.body.classList.remove('loading');
  document.getElementById('overlay')?.classList.add('hidden');
  if (again) {
    next.searchParams.set('quality', 'low');
    box.querySelector('button').addEventListener('click', () => location.replace(next));
  } else if (!SHOT) setTimeout(() => location.replace(next), 1800);
}, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 30000);

// LOADER hook: report a build phase to the loading screen (index.html) and, outside ?shot mode,
// yield one painted frame so it can repaint between the synchronous build steps.
const bootTimes = window.__bootTimes = [];
const bootMark = (label) => bootTimes.push([label, Math.round(performance.now())]);
const loadStep = (fraction, label) => {
  bootMark(label);
  window.__loadProgress?.(fraction, label);
  if (SHOT) return;
  return new Promise((r) => {
    const t = setTimeout(r, 120); // hidden tab: rAF is paused, don't stall the build
    requestAnimationFrame(() => setTimeout(() => { clearTimeout(t); r(); }, 0));
  });
};

await loadStep(0.1, 'Raising the sun…'); // LOADER
const sky = createSky(renderer, scene);
buildPlaceholders(scene);
await loadStep(0.22, 'Painting the hotels…'); // LOADER
const hotels = buildHotels(scene);
await loadStep(0.4, 'Planting palms…'); // LOADER
const palms = buildPalms(scene);
await loadStep(0.5, 'Laying Ocean Drive…'); // LOADER
buildStreet(scene);
const cars = buildCars(scene);
await loadStep(0.6, 'Pouring the ocean…'); // LOADER
const surf = createSurf({ frozen: SHOT, anchorTime: FROZEN_TIME });
const beach = buildBeach(scene, surf);
const ocean = createOcean(scene, surf);
const birds = createBirds(scene, { beach, surf, shot: SHOT }); // BIRDS
window.__birds = birds; // BIRDS
await loadStep(0.72, 'Tuning the waves…'); // LOADER
const post = createPost(renderer, scene, camera, {
  ...(params.has('bloom') ? { bloomStrength: parseFloat(params.get('bloom')) } : {}),
  samples: QUALITY.msaa, bloom: QUALITY.bloom, fxaa: QUALITY.fxaa,
});

// --- walking: the hotel terraces are raised, so the facade line stops the walker at the
// patio edge; everything else collides as boxes / circles
const walkWorld = {
  heightAt: beach.heightAt,
  boxes: [
    ...STREET_COLLIDERS.filter((c) => c.min), ...cars.colliders, ...beach.colliders,
    ...hotels.userData.footprints.map((f) => ({ min: { x: -80, y: -5, z: f.z0 }, max: { x: f.fx, y: 60, z: f.z1 } })),
  ],
  circles: [
    ...STREET_COLLIDERS.filter((c) => c.r),
    ...PALM_TREES.filter((t) => Math.abs(t.z) < DISTRICT.zMax + 10).map((t) => ({ x: t.x, z: t.z, r: 0.26 })),
  ],
  bounds: { x0: HOTEL.patioX + 0.2, x1: 110, z0: DISTRICT.zMin, z1: DISTRICT.zMax, soft: 14 },
};
const controls = new Walker(camera, renderer.domElement, walkWorld);
// first frame: hotel sidewalk, looking up the row of sunlit fronts
controls.set(-26, CURB_HEIGHT + EYE_HEIGHT, 40, 342, 4);
window.__walker = controls;
window.__cars = cars;

// --- SOUND hook: audio starts on the click-to-start gesture; never in ?shot mode ---
const audio = createAudio({ voices: QUALITY.audioVoices });
window.__audio = audio;
audio.setGullSource?.((L) => birds.gullSource(L)); // BIRDS: gull calls come from visible gulls
birds.onFlutter = (p) => audio.wingFlutter?.(p);   // BIRDS: wingbeats of a gull taking off nearby
audio.setAutoSteps(false);   // the walker drives the footsteps

// --- PEOPLE hook: a few procedural passers-by; their circle colliders move with them ---
const people = buildPeople(scene, {
  beach, hotels, walker: controls, shot: SHOT, mode: params.get('people'),
  getCars: () => (SHOT ? [] : audio.getCars()),   // the cyclist waits for a clear road
});
walkWorld.circles.push(...people.colliders);
window.__people = people;

// --- rideable beach cruiser and lifeguard ATV (E to ride); parked colliders block the walker
const vehicles = createVehicles(scene, {
  walker: controls, camera, beach, audio, renderer, shot: SHOT && !params.has('vehicles'),   // ?shot=1&vehicles: show them for close-ups
  staticBoxes: walkWorld.boxes, staticCircles: walkWorld.circles.filter((c) => !people.colliders.includes(c)),
  dynamicCircles: people.colliders,
  requestShadow: () => { renderer.shadowMap.needsUpdate = true; },
  getTouch: () => touch,
});
walkWorld.circles.push(...vehicles.colliders);
window.__vehicles = vehicles;

// footstep surface: audio's map, refined by the beach (deck, stairs, damp sand, swash)
function stepSurface(x, z, feetY) {
  const ground = beach.groundAt(x, z);
  if (feetY - ground > 0.25 && TOWERS.some((T) => Math.abs(x - T.x) < 9 && Math.abs(z - T.z) < 5)) return { surface: 'wood' };
  if (feetY - ground > 0.12 && x > 10.5 && x < 12.8) return { surface: 'pavement' };   // seawall steps
  let surface = audio.surfaceAt(x, z, feetY, SAND.waterline);
  if (x > SAND.x0 + 0.5) {
    const depth = beach.waterDepthAt(x, z);
    if (depth > 0.015) return { surface: 'splash', depth };
    surface = x > WET_LINE_X - 3.5 || beach.swashAt(x, z).covered ? 'wetsand' : 'sand';
  }
  return { surface };
}
const stepLog = [];
window.__stepLog = stepLog;
controls.onStep = ({ x, z, feetY, speed, land }) => {
  const { surface, depth } = stepSurface(x, z, feetY);
  stepLog.push({ x: +x.toFixed(2), z: +z.toFixed(2), y: +feetY.toFixed(2), surface, depth: depth && +depth.toFixed(3), land });
  if (stepLog.length > 400) stepLog.shift();
  const gain = land ? 1.3 : Math.min(1.25, 0.8 + speed * 0.1);   // a jump lands a little harder
  audio.footstep(surface, { gain: gain * (surface === 'splash' ? 1.1 : 1), depth });
};

// UI: a quiet caption over the first frame; no HUD while walking
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const note = document.getElementById('note');
function begin() {
  audio.start();
  controls.active = true;
}
// TOUCH: joystick + drag-look, shown on coarse-pointer devices or after the first touch
let touch = null;
const howEl = overlay.querySelector('.how');
function enableTouch() {
  if (touch || SHOT) return;
  touch = createTouchControls(controls, { audio, onRide: () => vehicles.toggle() });
  window.__touch = touch;
  if (howEl) howEl.innerHTML = '<b>Tap to walk</b> — left thumb to move, drag to look, Ride by the bike or the ATV';
  if (controls.active && !controls.locked) touch.setEnabled(true);
}
function beginTouch() {
  begin();   // inside touchend: resumes the AudioContext on iOS
  touch.setEnabled(true);
  overlay.classList.add('hidden');
  const el = document.documentElement;
  const fs = el.requestFullscreen ?? el.webkitRequestFullscreen;
  if (fs && !document.fullscreenElement && !params.has('nofs')) {
    try {
      Promise.resolve(fs.call(el, { navigationUI: 'hide' }))
        .then(() => screen.orientation?.lock?.('landscape'))
        .catch(() => {});
    } catch { /* not allowed here */ }
  }
}
if (!SHOT) {
  if (IS_TOUCH) enableTouch();
  else addEventListener('touchstart', enableTouch, { once: true, passive: true, capture: true });
  if (params.has('autostart')) {
    // testing: walk and hear without pointer lock
    begin();
    touch?.setEnabled(true);
  } else {
    overlay.classList.remove('hidden');
    // a tap: touch controls, no pointer lock (touchend is a valid gesture for audio + fullscreen)
    overlay.addEventListener('touchend', (e) => {
      e.preventDefault();   // no emulated click -> no pointer lock request
      enableTouch();
      beginTouch();
    }, { passive: false });
    // lock first, synchronously inside the click (the user gesture), then start the audio
    overlay.addEventListener('click', () => {
      if (touch?.enabled) return;
      controls.lock(); begin();
    });
    controls.onLockChange = (locked) => {
      overlay.classList.toggle('hidden', locked);
      controls.active = locked || controls.dragLook;
    };
    controls.onLockError = ({ dragLook }) => {
      overlay.classList.toggle('hidden', dragLook);
      note.textContent = dragLook ? 'Drag to look around' : 'Click again to capture the mouse';
      note.classList.add('show');
      setTimeout(() => note.classList.remove('show'), 3500);
      controls.active = dragLook;
    };
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') { audio.setMuted(!audio.muted); touch?.syncMute(); }
    if (e.code === 'Escape' && controls.dragLook) { controls.active = false; overlay.classList.remove('hidden'); }
  });
  if (params.has('hud')) hud.classList.remove('hidden');
}
// visuals follow the audio's wave schedule (audio clock -> render clock)
audio.onWave((w) => surf.pushAudioWave({ visualT0: elapsed + (w.t - w.now), k: w.k, size: w.size, runup: w.runup, z: w.z }));

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(pixelRatio());   // devicePixelRatio can change (zoom, other screen)
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setPixelRatio(renderer.getPixelRatio());
  post.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
// mobile: the new size can settle a little after the rotation event
window.addEventListener('orientationchange', () => { onResize(); setTimeout(onResize, 350); });
window.visualViewport?.addEventListener('resize', () => {
  if (renderer.domElement.width !== Math.floor(window.innerWidth * renderer.getPixelRatio())) onResize();
});

// Dynamic resolution: if frames average over ~22 ms (under ~45 fps) for 2 s, step the
// render scale down (to 0.6 at least); step back up after a long calm stretch. A scale
// that had to be abandoned is not retried for a while (and longer each time), so it
// never oscillates. Off in ?shot mode and with ?dynres=0.
const DYN = {
  on: !SHOT && params.get('dynres') !== '0',
  min: 0.6, max: QUALITY.renderScale, step: 0.1,
  acc: 0, n: 0, slow: 0, fast: 0, hold: 3, clock: 0,
  failed: new Map(),   // scale -> { until, backoff }: scales that proved too heavy
};
const scaleKey = (s) => Math.round(s * 100);
function setRenderScale(s) {
  renderScale = Math.round(s * 100) / 100;
  onResize();
}
function dynamicResolution(rawDt) {
  if (!DYN.on || document.hidden) return;
  DYN.clock += rawDt;
  if (DYN.hold > 0) { DYN.hold -= rawDt; return; }       // settle after start / a change
  if (rawDt > 0.25) return;                              // a hitch (tab switch, GC), not load
  DYN.acc += rawDt; DYN.n++;
  if (DYN.acc < 0.5) return;
  const avg = DYN.acc / DYN.n;                           // mean frame time over ~0.5 s
  DYN.acc = 0; DYN.n = 0;
  DYN.slow = avg > 0.022 ? DYN.slow + 0.5 : 0;
  DYN.fast = avg < 0.0185 ? DYN.fast + 0.5 : 0;
  if (DYN.slow >= 2 && renderScale > DYN.min + 1e-3) {
    // the scale we just left was too heavy: don't retry it for a while (longer each time)
    const f = DYN.failed.get(scaleKey(renderScale));
    const backoff = f ? Math.min(f.backoff * 2, 300) : 15;
    DYN.failed.set(scaleKey(renderScale), { until: DYN.clock + backoff, backoff });
    DYN.slow = DYN.fast = 0; DYN.hold = 1.5;
    setRenderScale(Math.max(DYN.min, renderScale - DYN.step));
  } else if (DYN.fast >= 4 && renderScale < DYN.max - 1e-3) {
    const next = Math.min(DYN.max, renderScale + DYN.step / 2);
    if (DYN.clock > (DYN.failed.get(scaleKey(next))?.until ?? 0)) {
      DYN.slow = DYN.fast = 0; DYN.hold = 2;
      setRenderScale(next);
    }
  }
}
window.__loseContext = () => renderer.forceContextLoss();   // test hook: context-loss recovery
window.__dynres = () => ({ scale: renderScale, pixelRatio: renderer.getPixelRatio(), on: DYN.on });

// Harness hooks
let fps = 0;
window.__groundHeight = (x, z) => beach.groundAt(x, z);
window.__beach = beach;
window.__surf = surf;
window.__scene = scene;
window.__setCam = (x, y, z, heading, pitch) => {
  controls.set(x, y, z, heading, pitch);
};
window.__renderInfo = () => ({
  calls: renderer.info.render.calls,
  triangles: renderer.info.render.triangles,
  geometries: renderer.info.memory.geometries,
  textures: renderer.info.memory.textures,
  fps: Math.round(fps * 10) / 10,
});
// rough VRAM estimate (MB): framebuffer + post targets + shadow map + scene textures
window.__gpuBudget = () => {
  const px = renderer.domElement.width * renderer.domElement.height;
  const mb = (b) => +(b / 1048576).toFixed(1);
  const samples = QUALITY.msaa || 1;
  const post = px * 8 * samples + px * 8 * (samples > 1 ? 2 : 1)   // MSAA half-float + resolve + ping-pong
    + (QUALITY.bloom ? px * 8 * 0.67 : 0);                          // bloom mip chain (~2/3 of full res, x2)
  const sm = sky.sun.shadow.mapSize, shadow = sm.x * sm.y * 4;
  let tex = 0;
  const seen = new Set();
  scene.traverse((o) => {
    for (const m of [].concat(o.material ?? [])) {
      for (const v of Object.values(m)) {
        if (!v?.isTexture || seen.has(v)) continue;
        seen.add(v);
        const im = v.image, w = im?.width ?? 0, h = im?.height ?? 0, d = im?.depth ?? 1;
        tex += w * h * d * 4 * (v.generateMipmaps !== false && !v.isDataTexture ? 1.33 : 1);
      }
    }
  });
  return { canvasMP: +(px / 1e6).toFixed(2), postMB: mb(post + px * 4), shadowMB: mb(shadow), texturesMB: mb(tex), totalMB: mb(post + px * 4 + shadow + tex) };
};
window.__sceneReady = false;

const timer = new THREE.Timer();
timer.connect(document);
let elapsed = 0, frames = 0, fpsAcc = 0, fpsFrames = 0;

function frame(t) {
  timer.update(t);
  const rawDt = timer.getDelta();
  const dt = Math.min(rawDt, 0.1);
  dynamicResolution(rawDt);
  elapsed = SHOT ? FROZEN_TIME : elapsed + dt;
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) { fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }

  if (!SHOT) {
    if (!vehicles.riding) controls.update(dt);
    vehicles.update(dt);
  }
  if (!SHOT) audio.update(dt, camera); // SOUND: listener pose + auto footsteps
  sky.update(camera);
  if (updateLod(camera)) renderer.shadowMap.needsUpdate = true; // DISTRICT
  surf.update(elapsed);
  ocean.update(elapsed, camera);
  beach.update(elapsed, camera);
  palms.update(elapsed);
  birds.update(dt, camera); // BIRDS
  people.update(dt, camera); // PEOPLE
  cars.update(dt, SHOT ? null : audio.getCars());

  renderer.info.reset();
  if (params.has('nopost')) renderer.render(scene, camera);
  else post.render(elapsed);
  frames++;

  if (!hud.classList.contains('hidden') && frames % 15 === 0) {
    const i = window.__renderInfo(), p = camera.position;
    hud.textContent = `${i.fps} fps · ${i.calls} calls · ${(i.triangles / 1000).toFixed(0)}k tris · ` +
      `x ${p.x.toFixed(1)} y ${p.y.toFixed(1)} z ${p.z.toFixed(1)} · ${QUALITY.tier} ×${renderer.getPixelRatio().toFixed(2)}`;
  }
  if (startScale < 1 && frames % 8 === 0) { startScale = Math.min(1, startScale + 0.125); onResize(); }
  if (frames <= 3 || frames === 10) bootMark('frame ' + frames);
  if (frames === 10) window.__sceneReady = true;
}

renderer.shadowMap.needsUpdate = true;
await loadStep(0.8, 'Mixing the morning light…'); // LOADER: shader compile phase
// compile the variants the frame actually uses: the scene renders into the composer's
// linear half-float target (no tone mapping), not the canvas
const direct = params.has('nopost');
renderer.setRenderTarget(direct ? null : post.composer.readBuffer);
await renderer.compileAsync(scene, camera);
renderer.setRenderTarget(null);
bootMark('compiled');
// Warm-up in small steps so no single task (or GPU submission) runs for seconds:
// upload the textures a few at a time, then one tiny-resolution render that builds
// the shadow-depth programs, uploads the geometry and fills the shadow map.
{
  const textures = new Set();
  scene.traverse((o) => {
    for (const m of [].concat(o.material ?? [])) for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
  });
  let t = performance.now();
  for (const tex of textures) {
    renderer.initTexture(tex);
    if (!SHOT && performance.now() - t > 40) { await loadStep(0.86, 'Almost there…'); t = performance.now(); }
  }
  bootMark('textures');
  await loadStep(0.9, 'Almost there…');
  const pr = renderer.getPixelRatio();
  const tiny = Math.min(pr, 160 / window.innerWidth);
  renderer.setPixelRatio(tiny);
  post.setPixelRatio(tiny);
  if (direct) renderer.render(scene, camera); else post.render(elapsed);
  renderer.setPixelRatio(pr);
  post.setPixelRatio(pr);
  renderer.shadowMap.needsUpdate = true;
  bootMark('warm render');
}
window.__loadProgress?.(0.94, 'Almost there…'); // LOADER
renderer.setAnimationLoop(frame);
