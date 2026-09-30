import * as THREE from 'three';
import { createSky } from './sky.js';
import { createPost } from './renderer/post.js';
import { buildPlaceholders } from './world/placeholders.js';
import { buildHotels } from './world/hotels.js';
import { buildPalms, PALM_TREES } from './world/palms.js';
import { buildStreet, STREET_COLLIDERS, KNOCKABLES } from './world/street.js';
import { createDynProps } from './world/props-dyn.js';
import { edgeKinds, edgeProps } from './world/edges.js';
import { buildCarsGlb, preloadCars, mirrorHide } from './world/cars-glb.js'; // Blender-modelled cars (procedural fallback)
import { createOcean } from './world/ocean.js';
import { createSurf } from './world/surf.js';
import { buildBeach } from './world/beach.js';
import { Walker } from './player/walker.js';
import { EYE_HEIGHT, CURB_HEIGHT, SAND, WET_LINE_X, TOWERS, HOTEL, DISTRICT } from './world/layout.js';
import { updateLod } from './world/lod.js'; // DISTRICT: per-block distance culling
import { createAudio } from './audio/index.js'; // SOUND agent: synthesized spatial audio
import { createBirds } from './world/birds.js'; // BIRDS: pelicans, gulls, sanderlings, grackles
import { buildPeople } from './world/people.js'; // PEOPLE fallback: the procedural figures (?people=procedural)
import { preloadPeople } from './world/mixamo.js'; // PEOPLE: Mixamo characters, clip library, skates
import { buildCrowd } from './world/crowd.js'; // PEOPLE: walkers, joggers, skaters, sitters, drivers
import { QUALITY, IS_TOUCH } from './quality.js';
import { createTouchControls } from './player/touch.js';
import { createVehicles } from './vehicles/index.js';
import { buildTraffic } from './world/traffic.js'; // TRAFFIC: cars cruising the drive, crosswalks, the 11 ST signal
import { createExitDrivers } from './world/exit-driver.js';
import { createMinimap } from './ui/minimap.js';
import { releaseGeometryAfterUpload, releaseCanvasesAfterUpload } from './renderer/memory.js';
import { OPEN_WORLD } from './vehicles/specs.js';
import { edgeDistance, softDistance, extentBounds, EDGE_SOFT } from './world/extent.js';
import { createGpuTimer } from './renderer/gpu-timer.js';

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
const nextFrame = () => {
  if (SHOT) return;
  return new Promise((r) => {
    const t = setTimeout(r, 120); // hidden tab: rAF is paused, don't stall the build
    requestAnimationFrame(() => setTimeout(() => { clearTimeout(t); r(); }, 0));
  });
};
const loadStep = (fraction, label) => {
  bootMark(label);
  window.__loadProgress?.(fraction, label);
  return nextFrame();
};

// Sun shadow re-renders redraw every caster in the shadow box, so all requests (the viewer
// moving the box, LOD changes, a ridden vehicle) are coalesced to at most 5 per second.
const SHADOW_GAP = 0.2;
let shadowWanted = true, shadowAt = -Infinity;
const requestShadow = () => { shadowWanted = true; };

preloadCars();   // the car models download while the world builds
const peopleLoad = params.get('people') === 'procedural' ? Promise.resolve(null) : preloadPeople();   // and the people
await loadStep(0.1, 'Raising the sun…'); // LOADER
const sky = await createSky(renderer, scene, { requestShadow });
bootMark('sky');
await nextFrame();
buildPlaceholders(scene);
await loadStep(0.22, 'Painting the hotels…'); // LOADER
const hotels = await buildHotels(scene, nextFrame);
await loadStep(0.4, 'Planting palms…'); // LOADER
const palms = buildPalms(scene);
await loadStep(0.5, 'Laying Ocean Drive…'); // LOADER
buildStreet(scene);
await loadStep(0.55, 'Parking the cars…'); // LOADER
const cars = await buildCarsGlb(scene, renderer);
const traffic = buildTraffic(scene, { kit: cars.traffic, shot: SHOT });
window.__traffic = traffic;
await loadStep(0.6, 'Pouring the ocean…'); // LOADER
const surf = createSurf({ frozen: SHOT, anchorTime: FROZEN_TIME });
const beach = buildBeach(scene, surf);
await nextFrame();
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
    // (the drivable hero car collides as the vehicle's moving circles instead of its box)
    ...STREET_COLLIDERS.filter((c) => c.min), ...cars.colliders.filter((c) => !(c.hero && cars.drive && !SHOT)), ...beach.colliders,
    ...hotels.userData.footprints.map((f) => ({ min: { x: -80, y: -5, z: f.z0 }, max: { x: f.fx, y: 60, z: f.z1 } })),
  ],
  circles: [
    // (the knockable bins and news boxes collide as their live props below)
    ...STREET_COLLIDERS.filter((c) => c.r && !c.knock),
    ...PALM_TREES.filter((t) => Math.abs(t.z) < (OPEN_WORLD ? extentBounds(QUALITY.tier).z1 : DISTRICT.zMax) + 10).map((t) => ({ x: t.x, z: t.z, r: 0.26 })),
  ],
  bounds: { x0: HOTEL.patioX + 0.2, x1: 110, z0: DISTRICT.zMin, z1: DISTRICT.zMax, soft: 14 },
};
// open world: the walkable space is world/extent.js's (Ocean Drive and the beach to its open
// ends, the near cross streets back to the rear row), with a soft slow-down at the road ends
if (OPEN_WORLD) {
  const tier = QUALITY.tier;
  walkWorld.bounds = { ...extentBounds(tier), soft: EDGE_SOFT.walker };
  walkWorld.inside = (x, z) => edgeDistance(x, z, tier) >= 0;
  walkWorld.softDistance = (x, z) => softDistance(x, z, tier);
  walkWorld.softWidth = EDGE_SOFT.walker;
}
// knockable props: the sidewalk bins and news boxes, the road-closed barricades and cones at
// the world's ends (open world)
const dynProps = OPEN_WORLD && !SHOT ? (() => {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
  const kinds = { ...edgeKinds(mat) };
  const K = { bin: { mass: 9, lie: 0.3 }, 'news-blue': { mass: 30, lie: 0.24 }, 'news-red': { mass: 30, lie: 0.24 } };
  for (const it of KNOCKABLES) if (!kinds[it.kind] && K[it.kind]) kinds[it.kind] = { ...K[it.kind], parts: [{ geo: it.geo, mat }] };
  return createDynProps(scene, { kinds, items: [...KNOCKABLES, ...edgeProps(QUALITY.tier)], groundAt: (x, z) => beach.groundAt(x, z), requestShadow });
})() : null;
if (dynProps) walkWorld.circles.push(...dynProps.colliders);
window.__props = dynProps;
const controls = new Walker(camera, renderer.domElement, walkWorld);
// first frame: hotel sidewalk, looking up the row of sunlit fronts
controls.set(-26, CURB_HEIGHT + EYE_HEIGHT, 40, 342, 4);
window.__walker = controls;
window.__cars = cars;
window.__mirrorHide = mirrorHide;

// --- SOUND hook: audio starts on the click-to-start gesture; never in ?shot mode ---
const audio = createAudio({ voices: QUALITY.audioVoices });
window.__audio = audio;
audio.setGullSource?.((L) => birds.gullSource(L)); // BIRDS: gull calls come from visible gulls
birds.onFlutter = (p) => audio.wingFlutter?.(p);   // BIRDS: wingbeats of a gull taking off nearby
audio.setAutoSteps(false);   // the walker drives the footsteps

// --- PEOPLE hook: Mixamo passers-by (the procedural figures if the models don't load);
// their circle colliders move with them ---
await nextFrame();
const peopleAssets = await peopleLoad;
const people = peopleAssets
  ? buildCrowd(scene, peopleAssets, { beach, hotels, walker: controls, shot: SHOT, mode: params.get('people'), getCars: () => traffic.cars })
  : buildPeople(scene, {
    beach, hotels, walker: controls, shot: SHOT, mode: params.get('people'),
    getCars: () => traffic.cars,   // the cyclist waits for a clear road
  });
walkWorld.circles.push(...people.colliders, ...traffic.colliders);
window.__people = people;
// a traffic car's driver getting out when the player takes the car
const exitDrivers = createExitDrivers(scene, { heightAt: (x, z) => beach.groundAt(x, z) });
walkWorld.circles.push(...exitDrivers.colliders);
window.__exitDrivers = exitDrivers;

// --- rideable beach cruiser, lifeguard ATV and the drivable convertible (E); parked colliders block the walker
await nextFrame();
const vehicles = createVehicles(scene, {
  walker: controls, camera, beach, audio, renderer, shot: SHOT && !params.has('vehicles'),   // ?shot=1&vehicles: show them for close-ups
  staticBoxes: walkWorld.boxes, staticCircles: walkWorld.circles.filter((c) => !people.colliders.includes(c) && !exitDrivers.colliders.includes(c) && !traffic.colliders.includes(c) && !c.knock),
  dynamicCircles: [...people.colliders, ...traffic.colliders, ...exitDrivers.colliders, ...(dynProps?.colliders ?? [])],
  props: dynProps,
  onDriverOut: (info, car, door, face) => exitDrivers.start(info, car, door, face),
  requestShadow,
  getTouch: () => touch,
  car: cars.drive ?? null,
  // open world: the parked fleet is drivable (enter at a door), the player's body seated in it
  fleet: cars.fleet ?? null, kit: cars.traffic ?? null, traffic,
  seatPlayer: (view) => people.seatPlayer?.(view),
});
walkWorld.circles.push(...vehicles.colliders);
window.__vehicles = vehicles;
// the art-deco minimap (N hides it, Shift+N north up): you and the saved car
const _mmDir = new THREE.Vector3();
const minimap = createMinimap({
  shot: SHOT, footprints: hotels.userData.footprints ?? [],
  getPose: () => { camera.getWorldDirection(_mmDir); return { x: camera.position.x, z: camera.position.z, heading: Math.atan2(_mmDir.x, -_mmDir.z) }; },
  getSaved: () => { const e = vehicles.saved; return e && e !== vehicles.currentEntry ? { x: e.v.x, z: e.v.z } : null; },
});
window.__minimap = minimap;
// what the hero's rear-view mirror draws besides the cars (world/cars-glb.js)
const MIRRORED = new Set(['placeholders', 'hotels', 'palms', 'street', 'ocean', 'parked-paint', 'parked-dark', 'parked-trim', 'parked-tyre']);
for (const o of scene.children) if (MIRRORED.has(o.name) || o.material?.name === 'Sky') o.userData.mirror = true;
people.setVehicles?.(vehicles);          // people step round the player's bike / ATV / car
people.attachDrivers?.(traffic, cars);   // seated drivers in the traffic, the player's body at the wheel

// TRAFFIC inputs: pedestrians (who have right of way on the crosswalks) and obstacles in
// the lanes (the player on foot, every ride vehicle, the cyclist)
function trafficPeds() {
  const out = [];
  if (!vehicles.riding) out.push({ x: controls.pos.x, z: controls.pos.y });
  if (people.peds) out.push(...people.peds());
  else for (const p of Object.values(people.people ?? {})) if (p.visible && p.name !== 'cyclist') out.push({ x: p.x, z: p.z });
  return out;
}
function trafficObstacles() {
  const out = [];
  // (with velocities, so the cars brake for where things will be; `player` for the startle beep)
  if (!vehicles.riding) out.push({ x: controls.pos.x, z: controls.pos.y, r: 0.35, v: 0, vx: controls.vel?.x ?? 0, vz: controls.vel?.y ?? 0, player: true });
  for (const e of vehicles.list) {
    const v = e.v, moving = v.ridden && Math.hypot(v.vx, v.vz) > 0.3;
    for (const c of v.circlesWorld) out.push({ x: c.x, z: c.z, r: c.r, v: v.ridden ? Math.max(0, v.lon) : 0, vx: moving ? v.vx : 0, vz: moving ? v.vz : 0, player: !!v.ridden });
  }
  for (const p of Object.values(people.people ?? {})) if (p.name === 'cyclist' && p.state === 'ride') out.push({ x: p.x, z: p.z, r: 0.5, v: p.speed });
  exitDrivers.obstacles(out);
  return out;
}

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
if (OPEN_WORLD && howEl) howEl.innerHTML = '<b>Click to walk</b> — WASD to move, mouse to look, Space to jump, Shift to stroll faster, E to ride the bike or the ATV or get into any parked car (C camera, Space handbrake, H horn, R back to the road), M to mute';
function enableTouch() {
  if (touch || SHOT) return;
  touch = createTouchControls(controls, { audio, onRide: () => vehicles.toggle(), onCamera: () => vehicles.toggleView() });
  window.__touch = touch;
  if (howEl) howEl.innerHTML = OPEN_WORLD
    ? '<b>Tap to walk</b> — left thumb to move, drag to look, Ride by the bike or the ATV, Enter at any parked car’s door'
    : '<b>Tap to walk</b> — left thumb to move, drag to look, Ride by the bike, the ATV or the convertible';
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
// GPU time guard: the CPU-side frame time above can't see a GPU that is falling behind
// until the driver resets it. Where the timer extension exists, a single frame over 250 ms
// or three in a row over 50 ms step the render scale and the sun shadow map down at once.
const gpuTimer = SHOT || params.get('gpuguard') === '0' ? null : createGpuTimer(renderer.getContext());
const GUARD = { n: 0, worst: 0, last: 0, slow: 0, since: 10, drops: [], fake: [] };
function gpuGuard() {
  if (!gpuTimer) return;
  const results = gpuTimer.poll();
  while (GUARD.fake.length) results.push({ ms: GUARD.fake.shift(), tag: frames });
  for (const { ms, tag } of results) {
    GUARD.n++; GUARD.last = ms; GUARD.worst = Math.max(GUARD.worst, ms);
    if (tag < GUARD.since) continue;   // the first frames, or drawn before the last step down
    GUARD.slow = ms > 50 ? GUARD.slow + 1 : 0;
    if (ms <= 250 && GUARD.slow < 3) continue;
    GUARD.slow = 0;
    GUARD.since = frames + 1;
    if (renderScale > DYN.min + 1e-3) {
      const f = DYN.failed.get(scaleKey(renderScale));
      const backoff = f ? Math.min(f.backoff * 2, 600) : 60;
      DYN.failed.set(scaleKey(renderScale), { until: DYN.clock + backoff, backoff });
      DYN.slow = DYN.fast = 0; DYN.hold = 2;
      setRenderScale(Math.max(DYN.min, renderScale - DYN.step));
    }
    sky.lowerShadow();
    GUARD.drops.push({ frame: frames, ms: Math.round(ms), scale: renderScale, shadowMap: sky.sun.shadow.mapSize.x });
  }
}
window.__gpuGuard = () => ({
  timer: !!gpuTimer, samples: GUARD.n, worstMs: +GUARD.worst.toFixed(2), lastMs: +GUARD.last.toFixed(2),
  drops: GUARD.drops, shadowMap: sky.sun.shadow.mapSize.x,
});
window.__gpuGuardFake = (...ms) => GUARD.fake.push(...ms);   // test hook: pretend slow GPU frames
window.__loseContext = () => renderer.forceContextLoss();   // test hook: context-loss recovery
window.__dynres = () => ({ scale: renderScale, pixelRatio: renderer.getPixelRatio(), on: DYN.on });

// Harness hooks
let fps = 0;
window.__groundHeight = (x, z) => beach.groundAt(x, z);
window.__beach = beach;
window.__surf = surf;
window.__scene = scene;
window.__renderer = renderer;
window.__camera = camera;
window.__setCam = (x, y, z, heading, pitch) => {
  controls.set(x, y, z, heading, pitch);
};
window.__renderInfo = () => ({
  calls: renderer.info.render.calls,
  triangles: renderer.info.render.triangles,
  geometries: renderer.info.memory.geometries,
  textures: renderer.info.memory.textures,
  programs: renderer.info.programs?.length ?? 0,
  shadowRenders,
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
        const im = v.image, [w, h] = v.userData.size ?? [im?.width ?? 0, im?.height ?? 0], d = im?.depth ?? 1;
        tex += w * h * d * 4 * (v.generateMipmaps !== false && !v.isDataTexture ? 1.33 : 1);
      }
    }
  });
  return { canvasMP: +(px / 1e6).toFixed(2), postMB: mb(post + px * 4), shadowMB: mb(shadow), texturesMB: mb(tex), totalMB: mb(post + px * 4 + shadow + tex) };
};
window.__sceneReady = false;

const timer = new THREE.Timer();
timer.connect(document);
let elapsed = 0, frames = 0, fpsAcc = 0, fpsFrames = 0, shadowRenders = 0;

// main-thread work per frame (ms), for the perf gate: window.__frameCpu()
const cpuMs = new Float32Array(600);
let cpuN = 0;
window.__frameCpu = (reset = false) => {
  const n = Math.min(cpuN, cpuMs.length), a = Array.from(cpuMs.subarray(0, n)).sort((x, y) => x - y);
  const p = (f) => (n ? +a[Math.min(n - 1, Math.floor(n * f))].toFixed(2) : 0);
  if (reset) cpuN = 0;
  return { n, p50: p(0.5), p95: p(0.95), max: p(1) };
};
// ?prof: per-section main-thread ms (exponential averages), window.__prof()
const PROF = params.has('prof') ? {} : null;
let profT = 0;
const profFrame = {};
const prof = (k) => { if (!PROF) return; const n = performance.now(); PROF[k] = (PROF[k] ?? 0) * 0.97 + (n - profT) * 0.03; profFrame[k] = +(n - profT).toFixed(2); profT = n; };
window.__prof = () => PROF && Object.fromEntries(Object.entries(PROF).map(([k, v]) => [k, +v.toFixed(2)]));
function frame(t) {
  const cpu0 = performance.now();
  profT = cpu0;
  timer.update(t);
  const rawDt = timer.getDelta();
  const dt = Math.min(rawDt, 0.1);
  dynamicResolution(rawDt);
  gpuGuard();
  elapsed = SHOT ? FROZEN_TIME : elapsed + dt;
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) { fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }

  prof('misc');
  if (!SHOT) {
    if (!vehicles.riding) controls.update(dt);
    prof('walker');
    vehicles.update(dt);
    prof('vehicles');
  }
  if (!SHOT) audio.update(dt, camera); // SOUND: listener pose + auto footsteps
  prof('audio');
  sky.update(camera);
  if (updateLod(camera)) requestShadow(); // DISTRICT
  prof('sky+lod');
  surf.update(elapsed);
  ocean.update(elapsed, camera);
  beach.update(elapsed, camera);
  palms.update(elapsed);
  prof('sea+palms');
  birds.update(dt, camera); // BIRDS
  prof('birds');
  people.update(dt, camera); // PEOPLE
  if (!SHOT) exitDrivers.update(dt, camera);
  dynProps?.update(dt, camera);
  prof('people');
  // (the hero's mirror waits a frame when the sun shadow is about to re-render)
  cars.update(dt, null, camera, shadowWanted && t / 1000 - shadowAt >= SHADOW_GAP);
  prof('cars');
  if (!SHOT) {
    traffic.update(dt, { camera, peds: trafficPeds(), obstacles: trafficObstacles() }); // TRAFFIC
    audio.traffic(traffic.audioList());
    for (const h of traffic.honks()) audio.horn(h);
  }
  prof('traffic');
  if (!SHOT) minimap.update();

  renderer.info.reset();
  const now = t / 1000;
  if (shadowWanted && (SHOT || now - shadowAt >= SHADOW_GAP)) {
    renderer.shadowMap.needsUpdate = true;
    shadowWanted = false;
    shadowAt = now;
  }
  const shadowNow = renderer.shadowMap.needsUpdate;
  if (shadowNow) shadowRenders++;
  gpuTimer?.begin(frames);
  prof('pre-render');
  const profT0 = performance.now();
  if (params.has('nopost')) renderer.render(scene, camera);
  else post.render(elapsed);
  gpuTimer?.end();
  prof('render');
  frames++;

  if (!hud.classList.contains('hidden') && frames % 15 === 0) {
    const i = window.__renderInfo(), p = camera.position;
    hud.textContent = `${i.fps} fps · ${i.calls} calls · ${(i.triangles / 1000).toFixed(0)}k tris · ` +
      `x ${p.x.toFixed(1)} y ${p.y.toFixed(1)} z ${p.z.toFixed(1)} · ${QUALITY.tier} ×${renderer.getPixelRatio().toFixed(2)}`;
  }
  if (startScale < 1 && frames % 8 === 0) { startScale = Math.min(1, startScale + 0.125); onResize(); }
  if (frames <= 3 || frames === 10) bootMark('frame ' + frames);
  if (frames === 10) window.__sceneReady = true;
  cpuMs[cpuN++ % cpuMs.length] = performance.now() - cpu0;
  if (PROF) {
    const log = (window.__frameLog ??= []);
    log.push([+(performance.now() - cpu0).toFixed(2), shadowNow ? 1 : 0, renderer.info.render.calls, +(PROF.render ?? 0).toFixed(2), +(performance.now() - profT0).toFixed(2)]);
    if (log.length > 1200) log.shift();
    const ms = performance.now() - cpu0;
    if (ms > 9) {
      const slow = (window.__slowFrames ??= []);
      slow.push({ ms: +ms.toFixed(1), frame: frames, shadow: shadowNow, calls: renderer.info.render.calls, programs: renderer.info.programs?.length, ...profFrame });
      if (slow.length > 200) slow.shift();
    }
  }
}

renderer.shadowMap.needsUpdate = true;
releaseGeometryAfterUpload(scene);
await loadStep(0.8, 'Mixing the morning light…'); // LOADER: shader compile phase
// compile the variants the frame actually uses: the scene renders into the composer's
// linear half-float target (no tone mapping), not the canvas
const direct = params.has('nopost');
const target = direct ? null : post.composer.readBuffer;
// Compile in small batches with a painted frame between them, so no single task blocks
// for long and the loader keeps animating. One representative object per program variant
// (material x instancing / batching / shadow receiving); compileAsync lets
// KHR_parallel_shader_compile link them off the main thread.
{
  const reps = new Map();
  scene.traverse((o) => {
    for (const m of [].concat(o.material ?? [])) {
      const key = `${m.id}|${o.isInstancedMesh ? 'i' : ''}${o.isBatchedMesh ? 'b' : ''}${o.isSkinnedMesh ? 's' : ''}${o.receiveShadow ? 'r' : ''}${o.instanceColor ? 'c' : ''}`;
      if (!reps.has(key)) reps.set(key, o);
    }
  });
  const objs = [...new Set(reps.values())];
  bootMark(`compile ${objs.length} variants${renderer.extensions.has('KHR_parallel_shader_compile') ? ' (parallel)' : ''}`);
  const BATCH = 6;
  for (let i = 0; i < objs.length; i += BATCH) {
    renderer.setRenderTarget(target);
    const jobs = objs.slice(i, i + BATCH).map((o) => renderer.compileAsync(o, camera, scene));
    renderer.setRenderTarget(null);
    await Promise.all(jobs);
    await loadStep(0.8 + 0.05 * (i + BATCH) / objs.length, 'Mixing the morning light…');
  }
}
bootMark('compiled');
// Warm-up in small steps so no single task (or GPU submission) runs for seconds:
// upload the textures a few at a time, then tiny-resolution renders of a few objects at a
// time (culling off) that build their shadow-depth programs and upload their geometry,
// then one of the whole frame for the post-processing passes.
{
  const textures = new Set();
  scene.traverse((o) => {
    for (const m of [].concat(o.material ?? [])) for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
  });
  releaseCanvasesAfterUpload(textures);
  // The uploads run in the GPU process and the driver finishes them (storage, mipmaps) at
  // first use, so each texture is also sampled once by a 1x1 draw, and the work is paced by
  // size (a painted frame per ~24 MB), not by main-thread time.
  const probe = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
  const probeScene = new THREE.Scene().add(probe);
  const probeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  probeCam.position.z = 1;
  const probeRT = new THREE.WebGLRenderTarget(1, 1);
  let t = performance.now(), bytes = 0;
  const px = new Uint8Array(4);
  const settle = async () => {
    renderer.readRenderTargetPixels(probeRT, 0, 0, 1, 1, px);   // wait for this chunk's GPU work
    await loadStep(0.86, 'Almost there…');
    t = performance.now(); bytes = 0;
  };
  for (const tex of textures) {
    const w = tex.image?.width ?? 0, h = tex.image?.height ?? 0;
    renderer.initTexture(tex);
    if (!tex.isCubeTexture && !tex.isData3DTexture && !tex.isDataArrayTexture && !tex.isRenderTargetTexture) {
      probe.material.map = tex;
      renderer.setRenderTarget(probeRT);
      renderer.render(probeScene, probeCam);
      renderer.setRenderTarget(null);
    }
    bytes += w * h * 4;
    if (!SHOT && (bytes > 24e6 || performance.now() - t > 40)) await settle();
  }
  if (!SHOT) await settle();
  probeRT.dispose();
  probe.geometry.dispose();
  probe.material.dispose();
  bootMark('textures');
  await loadStep(0.9, 'Almost there…');
  const pr = renderer.getPixelRatio();
  const tiny = Math.min(pr, 160 / window.innerWidth);
  renderer.setPixelRatio(tiny);
  post.setPixelRatio(tiny);
  // units: top-level objects, with big groups (hotels, street) split into their children
  const units = [];
  for (const o of scene.children) {
    if (o.isLight) continue;
    if (o.isGroup && o.children.length > 4) units.push(...o.children); else units.push(o);
  }
  const shown = units.map((u) => u.visible);
  const trisOf = (u) => {
    let n = 0;
    u.traverse((o) => {
      const g = o.geometry;
      if (g?.attributes?.position) n += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
    });
    return n;
  };
  let batch = [], tris = 0, n = 0;
  const flush = async () => {
    if (!batch.length) return;
    const culled = [];
    units.forEach((u) => { u.visible = false; });
    for (const u of batch) {
      u.visible = shown[units.indexOf(u)];
      u.traverse((o) => { if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
    }
    renderer.shadowMap.needsUpdate = true;
    const t0 = performance.now();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    const d = performance.now() - t0;
    if (d > 100) bootMark(`warm batch ${n} ${Math.round(d)} ms: ${batch.map((u) => u.name || u.type).join(' ')}`);
    for (const o of culled) o.frustumCulled = true;
    batch = []; tris = 0; n++;
    await nextFrame();
  };
  for (const u of units) {
    batch.push(u);
    tris += trisOf(u);
    if (tris > 250e3 || batch.length >= 10) await flush();
  }
  await flush();
  units.forEach((u, i) => { u.visible = shown[i]; });
  bootMark(`warm ${n} batches`);
  await loadStep(0.92, 'Almost there…');
  if (direct) renderer.render(scene, camera); else post.render(elapsed);
  renderer.setPixelRatio(pr);
  post.setPixelRatio(pr);
  renderer.shadowMap.needsUpdate = true;
  bootMark('warm render');
}
window.__loadProgress?.(0.94, 'Almost there…'); // LOADER
renderer.setAnimationLoop(frame);
