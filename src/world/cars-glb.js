// Blender-modelled cars (public/models, built by blender/build_cars.py): the 1950s-style
// hero convertible at the west curb (separate wheel / steering-wheel pivots and a driver
// seat anchor for the ride system), its moving copies for the audio car passes, and the
// parked modern fleet. The fleet is one BatchedMesh per material across every row, with
// per-car paint colour, LOD0/LOD1 switching and distance culling. Falls back to the
// procedural cars (car.js) if a model can't load.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CAR, roadHeight, CROSS, CROSS_STREETS, crossRoadHeight, DISTRICT } from './layout.js';
import { registerLodHook, LOD } from './lod.js';
import { QUALITY } from '../quality.js';
import {
  buildCars, buildParkedProcedural, carMovers, seat, groundReflect, clampRadiance,
  CAR_MAX_RADIANCE, shared, blockedBay,
} from './car.js';

const HERO_PAINT = 0x86cfc1;
const HERO_PAINT2 = 0xf1eee4;   // the two-tone side sweep
const MOVER_PAINTS = [0xe8a4b8, 0xf2e6c4, 0x9fc8e0];
const WHEEL_R = 0.36;
// distance (m) at which the hero / parked cars drop to LOD1
const LOD1_AT = { high: { hero: 38, parked: 42 }, medium: { hero: 30, parked: 32 }, low: { hero: 25, parked: 25 } }[QUALITY.tier] ?? { hero: 38, parked: 42 };

let pending = null;
// start the downloads early (main.js calls this before the world build)
export function preloadCars() {
  if (pending) return pending;
  if (new URLSearchParams(location.search).get('cars') === 'procedural') return (pending = Promise.resolve([]));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const get = (name) => loader.loadAsync(`models/${name}.glb`).catch((e) => { console.warn(`cars: ${name}.glb failed`, e); return null; });
  const tex = new THREE.TextureLoader();
  const small = QUALITY.tier === 'low' ? '_512' : '';
  const map = (name) => tex.loadAsync(`textures/cars/${name}${small}.webp`).catch(() => null);
  // ?hero=raw: the unoptimised Blender export (dev server only), to tell export artefacts
  // from modelling ones
  const raw = new URLSearchParams(location.search).get('hero') === 'raw';
  const hero = raw ? loader.loadAsync('/blender/_raw/convertible.glb').catch(() => null) : get('convertible');
  pending = Promise.all([hero, get('parked'), map('vinyl_nor'), map('carpet_nor')]);
  return pending;
}

// ---------------------------------------------------------------------------
// Local reflection probe: the sky PMREM (scene.environment) is a dim, compressed skylight
// made for diffuse fill, so paint and chrome mirrored nothing. A low-res cube capture of the
// street itself (hotel fronts, palms, sky, the dark road) is PMREM-filtered into the cars'
// envMap: once at load, and again whenever the viewer has moved PROBE.step metres along the
// drive (then one cube face per frame, so driving past doesn't hitch). The render target is
// reused, so its texture (and every car program) stays the same.
const PROBE = { high: { size: 256, step: 50 }, medium: { size: 128, step: 50 }, low: { size: 64, step: 80 } }[QUALITY.tier] ?? { size: 128, step: 50 };
function createProbe(renderer, scene) {
  const cubeRT = new THREE.WebGLCubeRenderTarget(PROBE.size, { type: THREE.HalfFloatType });
  const cam = new THREE.CubeCamera(0.3, 2500, cubeRT);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let out = null, face = -1, pendingZ = 0;
  const place = (z) => {
    const x = CAR.x + 2.7;
    cam.position.set(x, roadHeight(x) + 0.95, z);
    cam.updateMatrixWorld(true);
  };
  // render with the cars hidden, the sun's shadow map left as it is
  const skies = () => scene.children.filter((o) => o.material?.name === 'Sky' && o.material.uniforms?.uCore);
  const hidden = (hide, fn) => {
    const vis = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const sky = skies();
    for (const o of sky) o.material.uniforms.uCore.value = 0;
    const shadowUpdate = renderer.shadowMap.needsUpdate;
    renderer.shadowMap.needsUpdate = false;
    fn();
    renderer.shadowMap.needsUpdate = shadowUpdate;
    for (const o of sky) o.material.uniforms.uCore.value = 1;
    hide.forEach((o, i) => { o.visible = vis[i]; });
  };
  const probe = {
    hide: [], z: null, captures: 0,
    get texture() { return out.texture; },
    // skyOnly: the load-time capture, before the world's shaders are compiled (asynchronously,
    // in main.js): only the sky dome, so it compiles nothing; the first frame re-captures all
    capture(z, skyOnly = false) {
      place(z);
      const hide = skyOnly ? scene.children.filter((o) => !o.isLight && o.material?.name !== 'Sky') : probe.hide;
      hidden(hide, () => cam.update(renderer, scene));
      out = pmrem.fromCubemap(cubeRT.texture, out);
      probe.z = z;
      face = -1;
      probe.captures++;
    },
    // along the drive the probe follows the viewer (clamped to the modelled district)
    follow(p) {
      const z = THREE.MathUtils.clamp(p.z, DISTRICT.zMin, DISTRICT.zMax);
      if (probe.z === null) { probe.capture(z); return; }
      if (face < 0 && Math.abs(z - probe.z) > PROBE.step) { face = 0; pendingZ = z; }
      if (face < 0) return;
      place(pendingZ);
      const target = renderer.getRenderTarget(), cf = renderer.getActiveCubeFace(), ml = renderer.getActiveMipmapLevel();
      hidden(probe.hide, () => {
        renderer.setRenderTarget(cubeRT, face);
        renderer.render(scene, cam.children[face]);
      });
      renderer.setRenderTarget(target, cf, ml);
      if (++face === 6) {
        out = pmrem.fromCubemap(cubeRT.texture, out);
        probe.z = pendingZ;
        face = -1;
        probe.captures++;
      }
    },
  };
  return probe;
}

// ---------------------------------------------------------------------------
// runtime materials by the Blender material name
function glassMaterial(env, { color, opacity, edge, key, edgeTint = null, under = null, ior = 1.5, envI = 1.0 }) {
  const m = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.015, metalness: 0, transparent: true, opacity, envMap: env, envMapIntensity: envI, ior,
    clearcoat: 1, clearcoatRoughness: 0.015, depthWrite: false, side: THREE.DoubleSide,
  });
  // premultiplied output: the tint (diffuse) is weighted by the opacity, the reflections are
  // not, so even clear glass carries the sky and the facades like real glass does
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  // Fresnel: glass seen edge-on turns into a mirror of the sky (and, for the hero's
  // screen, the greenish tint of the glass thickness)
  const tint = edgeTint ? new THREE.Color(edgeTint) : null;
  // under: what a downward reflection picks up. The probe only knows the dark road; from the
  // driver's seat the lower windscreen mirrors the sunlit painted dash top instead
  const low = under ? new THREE.Color(under) : null;
  const lowGlsl = low ? `vec3(${low.r.toFixed(3)}, ${low.g.toFixed(3)}, ${low.b.toFixed(3)})` : null;
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <envmap_physical_pars_fragment>',
      THREE.ShaderChunk.envmap_physical_pars_fragment.replace('return envMapColor.rgb * envMapIntensity;',
        low
          ? `return mix(${lowGlsl}, min(envMapColor.rgb, vec3(2.2)), smoothstep(-0.03, 0.03, reflectVec.y)) * envMapIntensity;`
          : 'return min(envMapColor.rgb, vec3(2.2)) * envMapIntensity * mix(vec3(0.16, 0.15, 0.14), vec3(1.0), smoothstep(-0.012, 0.012, reflectVec.y));'));
    s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>',
      `{ float fr = pow(1.0 - clamp(abs(dot(normalize(vNormal), normalize(vViewPosition))), 0.0, 1.0), 3.0);
         diffuseColor.a = mix(diffuseColor.a, 1.0, fr * ${edge.toFixed(2)});
         ${tint ? `outgoingLight = mix(outgoingLight, outgoingLight * vec3(${tint.r.toFixed(3)}, ${tint.g.toFixed(3)}, ${tint.b.toFixed(3)}), fr);` : ''}
         outgoingLight = totalDiffuse * diffuseColor.a + max(outgoingLight - totalDiffuse, vec3(0.0)) * (0.35 + 0.65 * diffuseColor.a); }
       outgoingLight = min(outgoingLight, vec3(${CAR_MAX_RADIANCE.toFixed(2)}));
#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'car-glass-' + key;
  return m;
}

// Printed dial faces for the hero's cluster (no brand): the speedometer 0-120 over 270 deg
// (the needle's sweep in poseHero), fuel E-F and temperature C-H over 120 deg
export const SPEEDO_SWEEP = { from: -135, to: 135, max: 120 };
function dialTexture(kind) {
  const N = kind === 'speedo' ? 512 : 256, c = N / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const face = g.createRadialGradient(c, c * 0.8, N * 0.05, c, c, c);
  face.addColorStop(0, '#f4ecd8'); face.addColorStop(0.75, '#e6dcc2'); face.addColorStop(1, '#b9ad92');
  g.fillStyle = face; g.fillRect(0, 0, N, N);
  const at = (deg, r) => [c + r * Math.sin(deg * Math.PI / 180), c - r * Math.cos(deg * Math.PI / 180)];
  const ink = '#1d1c1a';
  g.strokeStyle = ink; g.fillStyle = ink; g.lineCap = 'butt';
  const tick = (deg, r0, r1, w) => { const [x0, y0] = at(deg, r0), [x1, y1] = at(deg, r1); g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (kind === 'speedo') {
    const { from, to, max } = SPEEDO_SWEEP, deg = (v) => from + (to - from) * v / max;
    g.lineWidth = N * 0.006;
    g.beginPath(); g.arc(c, c, c * 0.9, (from - 90) * Math.PI / 180, (to - 90) * Math.PI / 180); g.stroke();
    for (let v = 0; v <= max; v += 5) tick(deg(v), c * 0.9, v % 10 ? c * 0.84 : c * 0.78, v % 10 ? N * 0.005 : N * 0.009);
    g.font = `600 ${Math.round(N * 0.085)}px "Futura", "Century Gothic", "Trebuchet MS", sans-serif`;
    for (let v = 0; v <= max; v += 20) { const [x, y] = at(deg(v), c * 0.62); g.fillText(String(v), x, y); }
    // a red band past 90
    g.strokeStyle = '#a3261c'; g.lineWidth = N * 0.022;
    g.beginPath(); g.arc(c, c, c * 0.93, (deg(90) - 90) * Math.PI / 180, (to - 90) * Math.PI / 180); g.stroke();
    g.fillStyle = ink;
    g.font = `500 ${Math.round(N * 0.05)}px "Futura", "Century Gothic", sans-serif`;
    g.fillText('MPH', c, c + c * 0.36);
    // odometer window
    g.fillStyle = '#23211e'; g.fillRect(c - N * 0.13, c + c * 0.5, N * 0.26, N * 0.07);
    g.fillStyle = '#e9e1cc'; g.font = `500 ${Math.round(N * 0.05)}px monospace`;
    g.fillText('4 7 1 5 3', c, c + c * 0.5 + N * 0.037);
  } else {
    const lo = kind === 'fuel' ? 'E' : 'C', hi = kind === 'fuel' ? 'F' : 'H';
    for (let k = 0; k <= 4; k++) tick(-60 + 30 * k, c * 0.86, k % 2 ? c * 0.72 : c * 0.62, N * (k % 2 ? 0.014 : 0.024));
    g.font = `700 ${Math.round(N * 0.2)}px "Futura", "Century Gothic", sans-serif`;
    g.fillText(lo, ...at(-60, c * 0.4)); g.fillText(hi, ...at(60, c * 0.4));
    if (kind === 'temp') { g.strokeStyle = '#a3261c'; g.lineWidth = N * 0.05; g.beginPath(); g.arc(c, c, c * 0.8, (40 - 90) * Math.PI / 180, (60 - 90) * Math.PI / 180); g.stroke(); }
    g.font = `500 ${Math.round(N * 0.11)}px "Futura", "Century Gothic", sans-serif`;
    g.fillText(kind === 'fuel' ? 'FUEL' : 'TEMP', c, c + c * 0.45);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.anisotropy = 8;
  return t;
}

// clearcoat over a rougher base: the base's specular is kept low so the sun's highlight is
// the coat's small hard spot, and the output is capped under the bloom threshold
function paintMaterial(env, color, key) {
  const m = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.45, metalness: 0.0, specularIntensity: 0.18, clearcoat: 1, clearcoatRoughness: 0.05,
    envMap: env, envMapIntensity: 1.0,
  });
  groundReflect(m, 'glb-paint-' + key, CAR_MAX_RADIANCE, 1.4, 2.6);
  return m;
}

function makeMaterials(env, sky, vinylNor, carpetNor) {
  const std = (o, key, clamp = false) => {
    const m = new THREE.MeshStandardMaterial({ envMap: sky, ...o });
    if (clamp) clampRadiance(m, 'glb-' + key);
    return m;
  };
  const chrome = std({ color: 0xffffff, metalness: 1, roughness: 0.035, envMap: env, envMapIntensity: 1.0 });
  // (downward reflections lifted: thin posts seen from the seat mirror mostly the road and
  // otherwise read as dark matte rods)
  groundReflect(chrome, 'glb-chrome', CAR_MAX_RADIANCE, 2.1);
  const alloy = std({ color: 0xb9bdc1, metalness: 1, roughness: 0.24, envMap: env, envMapIntensity: 1.0 });
  groundReflect(alloy, 'glb-alloy', CAR_MAX_RADIANCE, 1.6);
  for (const t of [vinylNor, carpetNor]) {
    if (!t) continue;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  if (carpetNor) carpetNor.repeat.set(3, 3);
  const vinyl = (color) => {
    const m = new THREE.MeshPhysicalMaterial({
      color, roughness: 0.36, clearcoat: 0.35, clearcoatRoughness: 0.25, envMap: env, envMapIntensity: 0.8,
      ...(vinylNor ? { normalMap: vinylNor, normalScale: new THREE.Vector2(0.5, 0.5) } : {}),
    });
    clampRadiance(m, 'glb-vinyl');
    return m;
  };
  const coat = (o, key) => {
    const m = new THREE.MeshPhysicalMaterial({ clearcoat: 1, envMap: env, ...o });
    clampRadiance(m, 'glb-' + key);
    return m;
  };
  return {
    chrome, alloy,
    glass: glassMaterial(env, { color: 0xe4f2ec, opacity: 0.12, edge: 0.95, key: 'clear', edgeTint: 0x9fd8bf }),
    // the hero's wraparound screen: a green-tinted pane that carries the sky, the facades
    // and (from the seat) the painted dash top, going to a green mirror at grazing angles
    screen: glassMaterial(env, { color: 0xa9d2bd, opacity: 0.24, edge: 0.65, key: 'screen', edgeTint: 0x5fae8c, under: 0x5d9689, ior: 1.95, envI: 1.3 }),
    // the dial lenses: a faint glint, the printed faces must read through them
    dial_glass: glassMaterial(env, { color: 0xf2f6f4, opacity: 0.04, edge: 0.3, key: 'dial', envI: 0.35 }),
    gauge_speedo: std({ map: dialTexture('speedo'), roughness: 0.4, envMapIntensity: 0.6 }, 'dial', true),
    gauge_fuel: std({ map: dialTexture('fuel'), roughness: 0.4, envMapIntensity: 0.6 }, 'dial', true),
    gauge_temp: std({ map: dialTexture('temp'), roughness: 0.4, envMapIntensity: 0.6 }, 'dial', true),
    needle: coat({ color: 0xd8471a, roughness: 0.3, emissive: 0x3a0e02 }, 'needle'),
    // (a faint warm emissive stands in for light scattering through skin in the shade)
    skin: std({ color: 0xe8b797, roughness: 0.5, emissive: 0x3a1c10, envMapIntensity: 0.7 }, 'figure', true),
    cloth: std({ color: 0x9dbdd6, roughness: 0.9, envMapIntensity: 0.6 }, 'figure', true),
    cloth2: std({ color: 0xa8926a, roughness: 0.92, envMapIntensity: 0.6 }, 'figure', true),
    rubber: std({ color: 0x141414, roughness: 0.7, envMapIntensity: 0.5 }, 'figure', true),
    tint: glassMaterial(env, { color: 0x1c2428, opacity: 0.42, edge: 0.97, key: 'tint' }),
    tyre: std({ vertexColors: true, color: 0xffffff, roughness: 0.8, envMapIntensity: 0.5 }, 'tyre', true),
    trim: std({ color: 0x141516, roughness: 0.42, envMapIntensity: 0.7 }),
    grille: coat({ color: 0x0e0f10, roughness: 0.3, clearcoatRoughness: 0.08, envMapIntensity: 0.9 }, 'grille'),
    dark: std({ color: 0x0b0b0c, roughness: 0.85, envMapIntensity: 0.3 }),
    vinyl: vinyl(0xf3ecdc),
    vinyl2: vinyl(0x7fc4b4),
    canvas: std({ color: 0xd8d0bb, roughness: 0.92, envMapIntensity: 0.9, ...(carpetNor ? { normalMap: carpetNor, normalScale: new THREE.Vector2(0.45, 0.45) } : {}) }),
    carpet: std({ color: 0x35504c, roughness: 1, envMapIntensity: 1.0, ...(carpetNor ? { normalMap: carpetNor, normalScale: new THREE.Vector2(1.4, 1.4) } : {}) }),
    ivory: coat({ color: 0xf1e9d6, roughness: 0.22, clearcoat: 0.6, envMapIntensity: 1.0 }, 'ivory'),
    lens: coat({ color: 0xdfe6ea, metalness: 0.9, roughness: 0.06, envMapIntensity: 1.0 }, 'lens'),
    amber: coat({ color: 0xd98a2e, roughness: 0.18, emissive: 0x2a1200 }, 'amber'),
    tail: coat({ color: 0x9a1016, roughness: 0.16, emissive: 0x2a0304 }, 'tail'),
    makeTail: () => coat({ color: 0x9a1016, roughness: 0.16, emissive: 0x2a0304 }, 'tail'),
    plate: std({ color: 0xe6e2d2, roughness: 0.55 }),
    interior: std({ color: 0x3a3b3e, roughness: 0.7, envMapIntensity: 0.9 }),
    seat: std({ color: 0x2a2b2e, roughness: 0.62, envMapIntensity: 0.9 }),
  };
}

function applyMaterials(root, M, paint, paint2) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material.name;
    if (name === 'paint') o.material = paint;
    else if (name === 'paint2') o.material = paint2;
    else if (name === 'gauge') {
      o.material.envMap = M.chrome.envMap;
      o.material.roughness = 0.35;
    } else if (M[name]) o.material = M[name];
    const clear = o.material === M.glass || o.material === M.tint || o.material === M.screen || o.material === M.dial_glass;
    o.castShadow = !clear;
    o.receiveShadow = true;
    if (clear) o.renderOrder = 2;
  });
}

function blobMesh(w, l) {
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2), shared().blob);
  blob.position.y = 0.012;
  blob.renderOrder = 1;
  blob.castShadow = false;
  return blob;
}

// hero / mover instance: both LODs under one group, wheels found by name. The bodywork
// hangs in a sway group (pitch / roll / bounce on its springs, pivoting at mid height);
// the wheels are lifted out of it into per-LOD sets so they stay on the road.
const SWAY_Y = 0.55;
function heroInstance(gltf, paint, paint2, M) {
  const g = new THREE.Group();
  const sway = new THREE.Group(), body = new THREE.Group();
  sway.position.y = SWAY_Y;
  body.position.y = -SWAY_Y;
  sway.add(body);
  g.add(sway);
  const levels = ['convertible', 'convertible_L1'].map((n) => {
    const src = gltf.scene.getObjectByName(n);
    const c = src.clone(true);
    c.position.set(0, 0, 0);
    applyMaterials(c, M, paint, paint2);
    body.add(c);
    return c;
  });
  const wheels = [], steering = [], wheelSets = [];
  levels.forEach((lv, k) => {
    const sfx = k ? '_L1' : '';
    const set = new THREE.Group();
    set.visible = k === 0;
    g.add(set);
    wheelSets.push(set);
    for (const n of ['FL', 'FR', 'RL', 'RR']) {
      const w = lv.getObjectByName(`wheel_${n}${sfx}`);
      set.add(w);
      wheels.push(w);
    }
    const st = lv.getObjectByName(`steering_wheel${sfx}`);
    if (st) st.userData.q0 = st.quaternion.clone();
    steering.push(st);
  });
  levels[1].visible = false;
  g.add(blobMesh(2.35, 6.1));
  const L0 = levels[0];
  const needle = L0.getObjectByName('speedo_needle'), hands = L0.getObjectByName('driver_hands');
  for (const o of [needle, hands]) if (o) o.userData.q0 = o.quaternion.clone();
  // arms: shoulder fixed by the seat back, wrist anchor on the hands (which turn with the
  // rim), the elbow solved between them (two-bone IK, bending outward and down). Upper arm
  // in a short shirt sleeve, a shaped forearm (muscle near the elbow, flat oval wrist).
  // Both built along +z over a unit length and stretched to the bone each frame
  const arms = [];
  if (hands && M.skin) {
    const fore = limbGeo([[-0.04, 0.012, 0.011], [-0.022, 0.031, 0.028], [0, 0.038, 0.034], [0.14, 0.043, 0.037], [0.34, 0.041, 0.033],
      [0.58, 0.036, 0.027], [0.82, 0.032, 0.023], [1.0, 0.03, 0.021], [1.04, 0.022, 0.015]]);
    const upper = limbGeo([[0, 0.044, 0.044], [0.5, 0.042, 0.04], [1.0, 0.038, 0.036], [1.06, 0.02, 0.02]]);
    const sleeve = limbGeo([[-0.12, 0.0, 0.0], [-0.09, 0.045, 0.045], [-0.04, 0.06, 0.058], [0.3, 0.059, 0.055], [0.6, 0.061, 0.056],
      [0.62, 0.063, 0.058], [0.635, 0.056, 0.052], [0.64, 0.043, 0.041]]);
    for (const [side, sx, out] of [['L', 0.63, 1], ['R', 0.21, -1]]) {
      const wrist = hands.getObjectByName('driver_wrist_' + side);
      if (!wrist) continue;
      const up = new THREE.Group(), fa = new THREE.Group();
      up.add(new THREE.Mesh(upper, M.skin), new THREE.Mesh(sleeve, M.cloth));
      fa.add(new THREE.Mesh(fore, M.skin));
      for (const o of [up, fa]) o.matrixAutoUpdate = false;
      const th = out * Math.PI / 3;
      const arm = new THREE.Group();
      arm.add(up, fa);
      // (the hands' rim tangent at the grip, glTF axes: the wrist's wide side)
      arm.userData = { wrist, up, fa, shoulder: new THREE.Vector3(sx, 0.98, -0.33), pole: new THREE.Vector3(out * 0.7, -1, -0.1).normalize(), tan: new THREE.Vector3(Math.cos(th), 0, Math.sin(th)) };
      L0.add(arm);
      arms.push(arm);
    }
  }
  // the driver (hands on the wheel, forearms, legs) only while someone drives
  const driver = [hands, L0.getObjectByName('driver_legs'), ...arms].filter(Boolean);
  for (const o of driver) o.visible = false;
  g.userData = {
    levels, wheels, steering,
    seatAnchor: L0.getObjectByName('driver_seat'), eyeAnchor: L0.getObjectByName('driver_eye'),
  };
  return { car: g, sway, wheels, wheelSets, steering, levels, wheelR: WHEEL_R, needle, hands, driver, arms };
}

function setLevel(inst, k) {
  const [a, b] = inst.levels;
  if (a.visible === (k === 0)) return false;
  a.visible = k === 0;
  b.visible = k === 1;
  inst.wheelSets[0].visible = k === 0;
  inst.wheelSets[1].visible = k === 1;
  return true;
}

// Pose the hero from the vehicle sim state (vehicles/sim.js: yaw 0 = north, forward -z;
// the model's nose is +z, so it turns by yaw + pi and the sim's pitch / roll flip sign).
// Front wheels steer with Ackermann geometry; the steering wheel turns 2.5 turns lock to lock.
const _qs = new THREE.Quaternion(), _ax = new THREE.Vector3(0, 1, 0);
const FLIP_Y = new THREE.Quaternion().setFromAxisAngle(_ax, Math.PI);
const HANDS_MAX = 1.15;   // rad the hands follow the rim before they slide round it
function poseHero(inst, v) {
  const S = v.spec, g = inst.car;
  g.position.set(v.x, v.baseT, v.z);
  g.rotation.set(-v.pitchT, v.yaw + Math.PI, -v.rollT, 'YXZ');
  // the sprung body: pitch / roll / heave from the sim plus a fine shake the driver's eye
  // (anchored in the body) shares: V8 lope at idle, road texture and seams growing with speed
  const t = v.t, sp = Math.min(1, Math.abs(v.lon) / 14);
  const eng = v.engineOn ? 1 : 0, idle = eng * Math.max(0, 1 - Math.abs(v.lon) / 3);
  const road = sp * (v.ridden || Math.abs(v.lon) > 0.5 ? 1 : 0);
  const vib = (a, f1, f2, p) => a * (Math.sin(t * f1 + p) + 0.6 * Math.sin(t * f2 + 2 * p));
  const seam = road * 0.0025 * Math.max(0, Math.sin(v.z * 0.7 + v.x * 0.3)) ** 24;
  inst.sway.position.y = SWAY_Y + (v.bodyY - v.baseT) + vib(0.0009 * idle + 0.0012 * road, 41, 67, 0.3) + seam;
  inst.sway.rotation.set(
    -(v.pitch - v.pitchT) + vib(0.0007 * idle + 0.0011 * road, 23, 37, 1.1) - seam * 0.6,
    0,
    -(v.roll - v.rollT) + vib(0.0005 * idle + 0.0009 * road, 29, 53, 2.3));
  for (const o of inst.driver) o.visible = !!v.ridden;
  // speedometer: the needle sweeps SPEEDO_SWEEP clockwise from 0 mph
  if (inst.needle) {
    const mph = Math.min(SPEEDO_SWEEP.max, Math.abs(v.lon) * 2.237);
    const deg = SPEEDO_SWEEP.from + (SPEEDO_SWEEP.to - SPEEDO_SWEEP.from) * mph / SPEEDO_SWEEP.max;
    inst.needle.quaternion.copy(inst.needle.userData.q0).multiply(_qs.setFromAxisAngle(_ax, -THREE.MathUtils.degToRad(deg)));
  }
  const d = v.steer, ad = Math.abs(d);
  let inner = d, outer = d;
  if (ad > 1e-4) {
    const R = S.wheelbase / Math.tan(ad);
    inner = Math.sign(d) * Math.atan(S.wheelbase / Math.max(0.5, R - S.track / 2));
    outer = Math.sign(d) * Math.atan(S.wheelbase / (R + S.track / 2));
  }
  // model FL / FR = the car's left / right; a right turn (d > 0) has the right wheel inside
  const angFL = d > 0 ? outer : inner, angFR = d > 0 ? inner : outer;
  for (let k = 0; k < 2; k++) {
    const w = inst.wheels.slice(k * 4, k * 4 + 4);
    w[0].rotation.set(v.wheelRot, -angFL, 0, 'YXZ');
    w[1].rotation.set(v.wheelRot, -angFR, 0, 'YXZ');
    w[2].rotation.set(v.wheelRot, 0, 0);
    w[3].rotation.set(v.wheelRot, 0, 0);
    // (the pivot's local +y is the column axis, pointing down it: + turns the rim clockwise
    // as the driver sees it, for a right turn)
    const st = inst.steering[k];
    if (st?.userData.q0) st.quaternion.copy(st.userData.q0).multiply(_qs.setFromAxisAngle(_ax, steerWheelAngle(v)));
  }
  if (inst.hands) {
    const a = THREE.MathUtils.clamp(steerWheelAngle(v), -HANDS_MAX, HANDS_MAX);
    inst.hands.quaternion.copy(inst.hands.userData.q0).multiply(_qs.setFromAxisAngle(_ax, a));
    if (v.ridden) {
      inst.hands.updateMatrix();
      for (const arm of inst.arms) {
        const { wrist, up, fa, shoulder, pole, tan } = arm.userData;
        _w.copy(wrist.position).applyMatrix4(inst.hands.matrix);
        // two-bone IK: the elbow on the circle of solutions, toward the pole
        _d.subVectors(_w, shoulder);
        const d = Math.min(_d.length(), ARM_U + ARM_F - 1e-4);
        _d.normalize();
        const a = (ARM_U * ARM_U - ARM_F * ARM_F + d * d) / (2 * d), hgt = Math.sqrt(Math.max(0, ARM_U * ARM_U - a * a));
        _p.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
        _e.copy(shoulder).addScaledVector(_d, a).addScaledVector(_p, hgt);
        bone(up.matrix, shoulder, _e, _y.set(0, 1, 0));
        // (the forearm's wide side turns into the rim tangent at the wrist)
        bone(fa.matrix, _e, _w, _y.copy(tan).transformDirection(inst.hands.matrix).cross(_d.subVectors(_w, _e).normalize()));
      }
    }
  }
}
const ARM_U = 0.3, ARM_F = 0.27;
const _w = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Vector3(), _y = new THREE.Vector3();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
// a limb built along +z over a unit length, from a to b; its local +y turned toward upHint
function bone(m, a, b, upHint) {
  _bz.subVectors(b, a);
  const len = _bz.length();
  _bz.divideScalar(len);
  _bx.crossVectors(upHint, _bz);
  if (_bx.lengthSq() < 1e-8) _bx.set(1, 0, 0);
  _bx.normalize();
  _by.crossVectors(_bz, _bx);
  m.makeBasis(_bx, _by, _bz.multiplyScalar(len)).setPosition(a);
}
// tube along +z: prof = [[z, rx, ry], ...] rings of elliptical section (rx across, ry up)
function limbGeo(prof, n = 18) {
  const pos = [], idx = [];
  for (const [z, rx, ry] of prof) for (let j = 0; j < n; j++) { const a = (j / n) * Math.PI * 2; pos.push(Math.cos(a) * rx, Math.sin(a) * ry, z); }
  for (let i = 0; i < prof.length - 1; i++) for (let j = 0; j < n; j++) {
    const a = i * n + j, b = i * n + (j + 1) % n;
    idx.push(a, b, a + n, b, b + n, a + n);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// 2.5 turns lock to lock: +-450 deg at the full steering lock
export const steerWheelAngle = (v) => (v.steer / v.spec.steerMax) * 1.25 * 2 * Math.PI;

// ---------------------------------------------------------------------------
// parked fleet
const KINDS = ['sedan', 'hatch', 'suv', 'pickup', 'coupe', 'wagon', 'crossover'];
// silver, white, black, navy, gunmetal, red, champagne, pearl white, dark green, light blue,
// burgundy, graphite, sand beige, teal grey, metallic blue, cream, olive, steel blue, copper,
// sky blue
const PAINTS = [0xb9bcbf, 0xe4e4e0, 0x1c1d1f, 0x1f2c44, 0x4a4d52, 0x8a1e1e, 0xc9b78f, 0xf2efe6, 0x1f3a2c,
  0x9dbad3, 0x5a1622, 0x3a3d42, 0xb5a488, 0x51686b, 0x2f5d8c, 0xdcd3bd, 0x5f6b3a, 0x6f8799, 0x8f4a2a, 0x7fb3c9];

// float copy of the attributes a batch needs, in the car's space
function bake(mesh, root, keep) {
  const g = mesh.geometry, out = new THREE.BufferGeometry();
  for (const name of keep) {
    const a = g.attributes[name];
    if (!a) continue;
    const n = a.itemSize, arr = new Float32Array(a.count * n);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) arr[i * n + c] = a.getComponent(i, c);
    out.setAttribute(name, new THREE.BufferAttribute(arr, n));
  }
  out.setIndex(g.index ? Array.from(g.index.array) : null);
  root.updateWorldMatrix(true, true);
  const m = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
  out.applyMatrix4(m);
  return out;
}

function collectKinds(gltf) {
  const kinds = {};
  for (const kind of KINDS) {
    const lods = [];
    for (const sfx of ['', '_L1']) {
      const root = gltf.scene.getObjectByName(kind + sfx);
      if (!root) continue;
      const byMat = {};
      root.traverse((o) => {
        if (!o.isMesh) return;
        const name = o.material.name;
        const keep = name === 'tyre' ? ['position', 'normal', 'color'] : ['position', 'normal'];
        (byMat[name] ??= []).push(bake(o, root, keep));
      });
      lods.push(byMat);
    }
    if (!lods.length) continue;
    const box = new THREE.Box3();
    for (const list of Object.values(lods[0])) for (const g of list) { g.computeBoundingBox(); box.union(g.boundingBox); }
    kinds[kind] = { lods, L: box.max.z - box.min.z, top: box.max.y, zc: (box.max.z + box.min.z) / 2 };
  }
  return kinds;
}

// the curbside layout: the authored spots and rows of car.js, with the modelled kinds
function parkedLayout(kinds) {
  const spots = [];
  const kindOf = (k) => kinds[k] ? k : Object.keys(kinds)[0];
  for (const [z, col, k] of [[-1.5, 0xb9bcbf, 'sedan'], [-24, 0x1f2c44, 'suv'], [-31.5, 0x8a1e1e, 'hatch'], [58, 0xe4e4e0, 'pickup']]) {
    spots.push({ kind: kindOf(k), x: CAR.x + 0.05, z, yaw: 0, color: col, fixed: true });
  }
  const taken = [-1.5, -24, -31.5, 58];
  const row = (z0, z1, seed, clip, avoid) => {
    const rnd = (() => { let a = seed; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    const types = ['sedan', 'sedan', 'hatch', 'suv', 'crossover', 'crossover', 'wagon', 'pickup', 'coupe'].map(kindOf);
    let prev = null;
    for (let z = z0; z < z1;) {
      // never the same model twice in a row
      let kind = types[Math.floor(rnd() * types.length)];
      for (let t = 0; t < 6 && kind === prev; t++) kind = types[Math.floor(rnd() * types.length)];
      prev = kind;
      const L = kinds[kind].L;
      const zc = z + L / 2;
      z += L + 0.7 + rnd() * 1.6;
      if (clip && zc + L / 2 > z1) break;
      const skip = rnd() < 0.2;
      if (avoid && (Math.abs(zc - CAR.z) < 6.5 || Math.abs(zc - (-10)) < 6.5 || (zc > 22 && zc < 44) || taken.some((t) => Math.abs(zc - t) < 5.6))) continue;
      if (skip) continue;
      const x = CAR.x + 0.05 + (rnd() - 0.5) * 0.3;
      const yaw = (rnd() - 0.5) * 0.09;
      const color = PAINTS[Math.floor(rnd() * PAINTS.length)];
      if (blockedBay(zc, L / 2)) continue;
      spots.push({ kind, x, z: zc, yaw, color });
    }
  };
  row(-88, 90, 7331, false, true);
  const stops = [DISTRICT.zMin - 4, ...CROSS_STREETS.filter((c) => !c.far && Math.abs(c.z) > 100).map((c) => c.z), -79, 79, DISTRICT.zMax + 4].sort((a, b) => a - b);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (a === -79 && b === 79) continue;
    const za = a <= DISTRICT.zMin - 4 ? a : a + 17, zb = b >= DISTRICT.zMax + 4 ? b : b - 16;
    if (zb - za < 8) continue;
    row(za, zb, 9100 + i * 77, true, false);
  }
  // colours: none shared with the two nearest cars on either side, and a different model
  // from the neighbour (the authored spots are fitted in among the rows)
  spots.sort((a, b) => a.z - b.z);
  const rc = (() => { let a = 4242; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  // colours are dealt from a shuffled deck (every paint once before any repeats), so a
  // stretch of the row shows the whole range rather than a few colours rotating
  let deck = [];
  const deal = () => {
    if (!deck.length) {
      deck = PAINTS.slice();
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rc() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    }
    return deck.pop();
  };
  // cross streets: a parked row along each curb out past the hotels, facing the way the
  // near lane runs (westbound on the north side)
  {
    const rx = (() => { let a = 5151; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    const types = ['sedan', 'hatch', 'suv', 'crossover', 'wagon', 'pickup', 'coupe', 'sedan'].map(kindOf);
    for (const c of CROSS_STREETS.filter((q) => !q.far)) for (const sd of [-1, 1]) {
      let prev = null;
      for (let x = -60 - rx() * 4; x > -175;) {
        let kind = types[Math.floor(rx() * types.length)];
        if (kind === prev) kind = types[(types.indexOf(kind) + 1) % types.length];
        prev = kind;
        const L = kinds[kind].L, xc = x - L / 2;
        x -= L + 0.9 + rx() * 1.8;
        if (rx() < 0.18) continue;
        spots.push({ kind, x: xc, z: c.z + sd * (CROSS.hw - 1.15 + (rx() - 0.5) * 0.2), yaw: sd * Math.PI / 2 + (rx() - 0.5) * 0.06, cross: true });
      }
    }
  }
  spots.forEach((s, i) => {
    if (!s.fixed) s.color = deal();
    const near = [spots[i - 1], spots[i - 2]].filter((n) => n && s.z - n.z < 14);
    if (!s.fixed && near[0] && near[0].kind === s.kind) {
      const alt = KINDS.find((k) => kinds[k] && k !== s.kind && Math.abs(kinds[k].L - kinds[s.kind].L) < 0.35 && k !== spots[i + 1]?.kind);
      if (alt) s.kind = alt;
    }
    for (let t = 0; t < 20 && near.some((n) => n.color === s.color); t++) s.color = PAINTS[Math.floor(rc() * PAINTS.length)];
  });
  return spots;
}

function buildFleet(scene, gltf, M) {
  const kinds = collectKinds(gltf);
  if (!Object.keys(kinds).length) return null;
  const spots = parkedLayout(kinds);
  // one BatchedMesh per material holding every kind's LOD0 + LOD1 geometry
  const mats = new Set();
  for (const k of Object.values(kinds)) for (const lv of k.lods) for (const m of Object.keys(lv)) mats.add(m);
  const fleetPaint = paintMaterial(M.chrome.envMap, 0xffffff, 'fleet');
  const batches = {};
  for (const mat of mats) {
    const geos = {};
    let verts = 0, index = 0;
    for (const [kind, k] of Object.entries(kinds)) {
      geos[kind] = k.lods.map((lv) => {
        const list = lv[mat];
        if (!list) return null;
        const g = list.length > 1 ? mergeList(list) : list[0];
        verts += g.attributes.position.count;
        index += g.index ? g.index.count : 0;
        return g;
      });
    }
    const count = spots.filter((s) => geos[s.kind]?.[0] || geos[s.kind]?.[1]).length;
    if (!count) continue;
    const material = mat === 'paint' ? fleetPaint : (M[mat] ?? M.trim);
    const bm = new THREE.BatchedMesh(count, verts, index, material);
    bm.name = 'parked-' + mat;
    const ids = {};
    for (const [kind, list] of Object.entries(geos)) ids[kind] = list.map((g) => (g ? bm.addGeometry(g) : null));
    const clear = material === M.tint || material === M.glass;
    bm.castShadow = !clear;
    bm.receiveShadow = true;
    if (clear) bm.renderOrder = 2;
    scene.add(bm);
    batches[mat] = { bm, ids };
  }
  // instances
  const q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
  const cars = [], colliders = [];
  const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const blobs = new THREE.InstancedMesh(blobGeo, shared().blob, spots.length);
  blobs.renderOrder = 1;
  blobs.castShadow = false;
  const col = new THREE.Color();
  spots.forEach((s, i) => {
    const k = kinds[s.kind];
    const slope = s.cross ? 0 : (roadHeight(s.x + 0.9) - roadHeight(s.x - 0.9)) / 1.8;
    e.set(0, s.yaw, Math.atan(slope), 'YXZ');
    q.setFromEuler(e);
    const y = s.cross ? crossRoadHeight(s.x, CROSS.hw - 1.15) : roadHeight(s.x);
    const m4 = new THREE.Matrix4().compose(new THREE.Vector3(s.x - k.zc * Math.sin(s.yaw), y, s.z - k.zc * Math.cos(s.yaw)), q, one);
    const parts = [];
    for (const { bm, ids } of Object.values(batches)) {
      const [g0, g1] = ids[s.kind] ?? [];
      if (g0 == null && g1 == null) continue;
      const id = bm.addInstance(g0 ?? g1);
      bm.setMatrixAt(id, m4);
      if (bm.material === fleetPaint) bm.setColorAt(id, col.setHex(s.color));
      parts.push({ bm, id, g0, g1 });
    }
    blobs.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(s.x, y + 0.012, s.z), q, new THREE.Vector3(2.25, 1, k.L + 0.6)));
    // (the cross-street rows only within ~120 m: they sit behind the hotels from Ocean Drive)
    cars.push({ x: s.x, z: s.z, parts, lod: 0, vis: true, blob: i, far2: s.cross ? 120 * 120 : null });
    const hx = s.cross ? k.L / 2 + 0.05 : 1.0, hz = s.cross ? 1.0 : k.L / 2 + 0.05;
    colliders.push({ min: { x: s.x - hx, y: 0, z: s.z - hz }, max: { x: s.x + hx, y: k.top, z: s.z + hz } });
  });
  blobs.instanceMatrix.needsUpdate = true;
  scene.add(blobs);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const blobMats = spots.map((_, i) => { const m = new THREE.Matrix4(); blobs.getMatrixAt(i, m); return m; });
  // distance LOD + culling (runs when the viewer has moved along the street)
  const far2 = LOD.cars * LOD.cars, near2 = LOD1_AT.parked * LOD1_AT.parked;
  const update = (p) => {
    let changed = false;
    for (const c of cars) {
      const d2 = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
      const vis = d2 < (c.far2 ?? far2), lod = d2 < near2 ? 0 : 1;
      if (vis === c.vis && lod === c.lod) continue;
      for (const pt of c.parts) {
        const g = lod === 0 ? pt.g0 : pt.g1;
        pt.bm.setVisibleAt(pt.id, vis && g != null);
        if (g != null) pt.bm.setGeometryIdAt(pt.id, g);
      }
      if (vis !== c.vis) { blobs.setMatrixAt(c.blob, vis ? blobMats[c.blob] : hidden); blobs.instanceMatrix.needsUpdate = true; }
      c.vis = vis; c.lod = lod;
      changed = true;
    }
    return changed;
  };
  registerLodHook(update);
  return { colliders, cars, batches, blobs, update };
}

function mergeList(list) {
  // indexed merge of same-attribute geometries
  const attrs = Object.keys(list[0].attributes);
  const out = new THREE.BufferGeometry();
  let vtx = 0;
  const idx = [];
  const bufs = Object.fromEntries(attrs.map((a) => [a, []]));
  for (const g of list) {
    for (const a of attrs) bufs[a].push(g.attributes[a].array);
    const n = g.attributes.position.count;
    if (g.index) for (const i of g.index.array) idx.push(i + vtx); else for (let i = 0; i < n; i++) idx.push(i + vtx);
    vtx += n;
  }
  for (const a of attrs) {
    const size = list[0].attributes[a].itemSize, total = bufs[a].reduce((t, b) => t + b.length, 0);
    const arr = new Float32Array(total);
    let o = 0;
    for (const b of bufs[a]) { arr.set(b, o); o += b.length; }
    out.setAttribute(a, new THREE.BufferAttribute(arr, size));
  }
  out.setIndex(idx);
  return out;
}

// ---------------------------------------------------------------------------
// Traffic cars (world/traffic.js): modern models cloned from the parked fleet GLB, each with
// its wheel pivots, both LODs, its own paint and tail-lamp materials, plus the classic
// convertible copies. Geometry is shared with the GLB; no shadow casting (a contact blob).
const WHEEL_RADII = { sedan: 0.335, hatch: 0.315, suv: 0.37, pickup: 0.39, coupe: 0.34, wagon: 0.33, crossover: 0.355 };
function trafficKit(scene, gltf, M, env, pool, probe) {
  const kinds = gltf ? KINDS.filter((k) => gltf.scene.getObjectByName(k)) : [];
  const box = new THREE.Box3();
  gltf?.scene.updateMatrixWorld(true);
  const lens = Object.fromEntries(kinds.map((k) => [k, box.setFromObject(gltf.scene.getObjectByName(k)).max.z - box.min.z]));
  return {
    kinds, lens, classics: pool, paints: PAINTS, heroPaints: MOVER_PAINTS,
    lod1At: LOD1_AT.parked,
    // one instance of `kind` for a traffic slot (paint and tail are the slot's materials)
    makeModern(kind, paint, tail) {
      const root = new THREE.Group();
      const levels = [kind, kind + '_L1'].map((n, k) => {
        const c = gltf.scene.getObjectByName(n).clone(true);
        c.position.set(0, 0, 0);
        applyMaterials(c, M, paint, paint);
        c.traverse((o) => { if (o.isMesh) { o.castShadow = false; if (o.material === M.tail) o.material = tail; } });
        c.visible = k === 0;
        root.add(c);
        return c;
      });
      const wheels = levels.map((lv, k) => ['FL', 'FR', 'RL', 'RR'].map((w) => lv.getObjectByName(`${kind}_wheel_${w}${k ? '_L1' : ''}`)).filter(Boolean));
      root.add(blobMesh(2.2, lens[kind] + 0.5));
      root.visible = false;
      scene.add(root);
      probe.hide.push(root);
      return { root, levels, wheels, wheelR: WHEEL_RADII[kind] ?? 0.34, len: lens[kind] };
    },
    paint: (color) => paintMaterial(env, color, 'hero'),   // (the hero's program: nothing new to compile)
    tail: () => M.makeTail(),
    setLevel,
  };
}

export async function buildCarsGlb(scene, renderer) {
  // ?cars=procedural: the old procedural set (comparison / fallback check)
  if (new URLSearchParams(location.search).get('cars') === 'procedural') return buildCars(scene);
  const [heroGltf, parkedGltf, vinylNor, carpetNor] = await preloadCars();
  if (!heroGltf) return buildCars(scene);
  const probe = createProbe(renderer, scene);
  probe.capture(CAR.z, true);
  probe.z = null;
  const env = probe.texture;
  const M = makeMaterials(env, scene.environment, vinylNor, carpetNor);
  const paint2 = paintMaterial(env, HERO_PAINT2, 'hero2');
  // hero: parked at the west curb, facing south (the direction of the west lane), top down
  const hero = heroInstance(heroGltf, paintMaterial(env, HERO_PAINT, 'hero'), paint2, M);
  seat(hero.car, CAR.x, CAR.z, 0);
  scene.add(hero.car);
  // (hero: the drivable car replaces this box with its own moving circles)
  const colliders = [{ min: { x: CAR.x - 1.0, y: 0, z: CAR.z - 2.9 }, max: { x: CAR.x + 1.0, y: 1.2, z: CAR.z + 2.9 }, hero: true }];
  const fleet = parkedGltf ? buildFleet(scene, parkedGltf, M) : null;
  colliders.push(...(fleet ? fleet.colliders : buildParkedProcedural(scene)));
  // classic copies for the traffic (world/traffic.js): no shadow casting (a contact blob),
  // each with its own tail-lamp material so its brake lights are its own
  const pool = MOVER_PAINTS.map((c, i) => {
    const m = heroInstance(heroGltf, paintMaterial(env, c, 'mover' + i), paint2, M);
    const tail = M.makeTail();
    m.car.traverse((o) => { if (o.isMesh) { o.castShadow = false; if (o.material === M.tail) o.material = tail; } });
    m.car.visible = false;
    scene.add(m.car);
    return { ...m, tail, id: null, spin: 0 };
  });
  const all = [hero, ...pool];
  probe.hide.push(hero.car, ...pool.map((m) => m.car));
  if (fleet) probe.hide.push(...Object.values(fleet.batches).map((b) => b.bm), fleet.blobs);
  const tmp = new THREE.Vector3();
  return {
    hero: hero.car, mover: pool[0].car, movers: pool.map((m) => m.car), colliders, fleet, probe, glb: true,
    traffic: trafficKit(scene, parkedGltf, M, env, pool, probe),
    // the drivable hero (vehicles/index.js): start pose in sim terms, pose from the sim, eye
    drive: {
      pose: { x: CAR.x, z: CAR.z, yaw: Math.PI },
      apply: (v) => poseHero(hero, v),
      eye: (out) => hero.car.userData.eyeAnchor.getWorldPosition(out),
      // the eye's frame is the sprung body's (squat, dive, roll and shake move the view
      // against the horizon); the model's nose is +z, a camera looks down -z
      eyeQuat: (out) => hero.car.userData.eyeAnchor.getWorldQuaternion(out).multiply(FLIP_Y),
      root: hero.car,
    },
    update(dt, cars, camera) {
      if (!camera) return;
      probe.follow(camera.position);
      for (const m of all) {
        if (!m.car.visible) continue;
        const d = m.car.getWorldPosition(tmp).distanceTo(camera.position);
        setLevel(m, d < LOD1_AT.hero ? 0 : 1);
      }
    },
  };
}
