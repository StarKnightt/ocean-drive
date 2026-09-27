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
import { EYE_HEIGHT, CURB_HEIGHT, SAND, WET_LINE_X, TOWER, HOTEL } from './world/layout.js';
import { createAudio } from './audio/index.js'; // SOUND agent: synthesized spatial audio

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') === '1';
const FROZEN_TIME = 12.0;

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
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

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 30000);

const sky = createSky(renderer, scene);
buildPlaceholders(scene);
const hotels = buildHotels(scene);
const palms = buildPalms(scene);
buildStreet(scene);
const cars = buildCars(scene);
const surf = createSurf({ frozen: SHOT, anchorTime: FROZEN_TIME });
const beach = buildBeach(scene, surf);
const ocean = createOcean(scene, surf);
const post = createPost(renderer, scene, camera,
  params.has('bloom') ? { bloomStrength: parseFloat(params.get('bloom')) } : undefined);

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
    ...PALM_TREES.filter((t) => Math.abs(t.z) < 110).map((t) => ({ x: t.x, z: t.z, r: 0.26 })),
  ],
  bounds: { x0: HOTEL.patioX + 0.2, x1: 110, z0: -90, z1: 90 },
};
const controls = new Walker(camera, renderer.domElement, walkWorld);
// first frame: hotel sidewalk, looking up the row of sunlit fronts
controls.set(-26, CURB_HEIGHT + EYE_HEIGHT, 40, 342, 4);
window.__walker = controls;
window.__cars = cars;

// --- SOUND hook: audio starts on the click-to-start gesture; never in ?shot mode ---
const audio = createAudio();
window.__audio = audio;
audio.setAutoSteps(false);   // the walker drives the footsteps

// footstep surface: audio's map, refined by the beach (deck, stairs, damp sand, swash)
function stepSurface(x, z, feetY) {
  const ground = beach.groundAt(x, z);
  if (feetY - ground > 0.25 && Math.abs(x - TOWER.x) < 9 && Math.abs(z - TOWER.z) < 5) return { surface: 'wood' };
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
controls.onStep = ({ x, z, feetY, speed }) => {
  const { surface, depth } = stepSurface(x, z, feetY);
  stepLog.push({ x: +x.toFixed(2), z: +z.toFixed(2), y: +feetY.toFixed(2), surface, depth: depth && +depth.toFixed(3) });
  if (stepLog.length > 400) stepLog.shift();
  audio.footstep(surface, { gain: Math.min(1.25, 0.8 + speed * 0.1) * (surface === 'splash' ? 1.1 : 1), depth });
};

// UI: a quiet caption over the first frame; no HUD while walking
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const note = document.getElementById('note');
function begin() {
  audio.start();
  controls.active = true;
}
if (!SHOT) {
  if (params.has('autostart')) {
    // testing: walk and hear without pointer lock
    begin();
  } else {
    overlay.classList.remove('hidden');
    overlay.addEventListener('click', () => { begin(); controls.lock(); });
    controls.onLockChange = (locked) => {
      overlay.classList.toggle('hidden', locked);
      controls.active = locked || controls.dragLook;
    };
    controls.onLockError = () => {
      overlay.classList.add('hidden');
      note.textContent = 'Drag to look around';
      note.classList.add('show');
      setTimeout(() => note.classList.remove('show'), 3500);
      controls.active = true;
    };
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') audio.setMuted(!audio.muted);
    if (e.code === 'Escape' && controls.dragLook) { controls.active = false; overlay.classList.remove('hidden'); }
  });
  if (params.has('hud')) hud.classList.remove('hidden');
}
// visuals follow the audio's wave schedule (audio clock -> render clock)
audio.onWave((w) => surf.pushAudioWave({ visualT0: elapsed + (w.t - w.now), k: w.k, size: w.size, runup: w.runup, z: w.z }));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});

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
window.__sceneReady = false;

const timer = new THREE.Timer();
timer.connect(document);
let elapsed = 0, frames = 0, fpsAcc = 0, fpsFrames = 0;

function frame(t) {
  timer.update(t);
  const dt = Math.min(timer.getDelta(), 0.1);
  elapsed = SHOT ? FROZEN_TIME : elapsed + dt;
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) { fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }

  if (!SHOT) controls.update(dt);
  if (!SHOT) audio.update(dt, camera); // SOUND: listener pose + auto footsteps
  sky.update(camera);
  surf.update(elapsed);
  ocean.update(elapsed, camera);
  beach.update(elapsed, camera);
  palms.update(elapsed);
  cars.update(dt, SHOT ? null : audio.getCars());

  renderer.info.reset();
  if (params.has('nopost')) renderer.render(scene, camera);
  else post.render(elapsed);
  frames++;

  if (!hud.classList.contains('hidden') && frames % 15 === 0) {
    const i = window.__renderInfo(), p = camera.position;
    hud.textContent = `${i.fps} fps · ${i.calls} calls · ${(i.triangles / 1000).toFixed(0)}k tris · ` +
      `x ${p.x.toFixed(1)} y ${p.y.toFixed(1)} z ${p.z.toFixed(1)}`;
  }
  if (frames === 10) window.__sceneReady = true;
}

renderer.shadowMap.needsUpdate = true;
await renderer.compileAsync(scene, camera);
renderer.setAnimationLoop(frame);
