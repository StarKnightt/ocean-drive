import * as THREE from 'three';
import { createSky } from './sky.js';
import { createPost } from './renderer/post.js';
import { buildPlaceholders } from './world/placeholders.js';
import { buildHotels } from './world/hotels.js';
import { createOcean } from './world/ocean.js';
import { FlyCam } from './player/flycam.js';
import { EYE_HEIGHT, CURB_HEIGHT, groundHeight } from './world/layout.js';
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
buildHotels(scene);
const ocean = createOcean(scene);
const post = createPost(renderer, scene, camera,
  params.has('bloom') ? { bloomStrength: parseFloat(params.get('bloom')) } : undefined);

const controls = new FlyCam(camera, renderer.domElement);
controls.set(-25.5, CURB_HEIGHT + EYE_HEIGHT, 35, 345, 3);

// UI
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
if (!SHOT) {
  overlay.classList.remove('hidden');
  overlay.addEventListener('click', () => controls.lock());
  controls.onLockChange = (locked) => overlay.classList.toggle('hidden', locked);
  if (params.has('hud')) hud.classList.remove('hidden');
}

// --- SOUND hook: audio starts on the click-to-start gesture; never in ?shot mode ---
const audio = createAudio();
window.__audio = audio;
if (!SHOT) overlay.addEventListener('click', () => audio.start());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});

// Harness hooks
let fps = 0;
window.__groundHeight = groundHeight;
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
  ocean.update(elapsed);

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
