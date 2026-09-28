// Blender-modelled cars (public/models, built by blender/build_cars.py): the 1950s-style
// hero convertible at the west curb (separate wheel / steering-wheel pivots and a driver
// seat anchor for the ride system), its moving copies for the audio car passes, and the
// parked modern fleet. The fleet is one BatchedMesh per material across every row, with
// per-car paint colour, LOD0/LOD1 switching and distance culling. Falls back to the
// procedural cars (car.js) if a model can't load.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CAR, roadHeight, CROSS_STREETS, DISTRICT } from './layout.js';
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
  pending = Promise.all([get('convertible'), get('parked'), map('vinyl_nor'), map('carpet_nor')]);
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
function glassMaterial(env, { color, opacity, edge, key, edgeTint = null }) {
  const m = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.015, metalness: 0, transparent: true, opacity, envMap: env, envMapIntensity: 1.0,
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
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <envmap_physical_pars_fragment>',
      THREE.ShaderChunk.envmap_physical_pars_fragment.replace('return envMapColor.rgb * envMapIntensity;',
        'return min(envMapColor.rgb, vec3(2.2)) * envMapIntensity * mix(vec3(0.16, 0.15, 0.14), vec3(1.0), smoothstep(-0.012, 0.012, reflectVec.y));'));
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
  groundReflect(chrome, 'glb-chrome', CAR_MAX_RADIANCE, 1.2);
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
    const clear = o.material === M.glass || o.material === M.tint;
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
  g.userData = {
    levels, wheels, steering,
    seatAnchor: levels[0].getObjectByName('driver_seat'), eyeAnchor: levels[0].getObjectByName('driver_eye'),
  };
  return { car: g, sway, wheels, wheelSets, steering, levels, wheelR: WHEEL_R };
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
function poseHero(inst, v) {
  const S = v.spec, g = inst.car;
  g.position.set(v.x, v.baseT, v.z);
  g.rotation.set(-v.pitchT, v.yaw + Math.PI, -v.rollT, 'YXZ');
  inst.sway.position.y = SWAY_Y + (v.bodyY - v.baseT);
  inst.sway.rotation.set(-(v.pitch - v.pitchT), 0, -(v.roll - v.rollT));
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
    const st = inst.steering[k];
    if (st?.userData.q0) st.quaternion.copy(st.userData.q0).multiply(_qs.setFromAxisAngle(_ax, (d / S.steerMax) * 1.25 * 2 * Math.PI));
  }
}

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
    const slope = (roadHeight(s.x + 0.9) - roadHeight(s.x - 0.9)) / 1.8;
    e.set(0, s.yaw, Math.atan(slope), 'YXZ');
    q.setFromEuler(e);
    const m4 = new THREE.Matrix4().compose(new THREE.Vector3(s.x, roadHeight(s.x), s.z - k.zc), q, one);
    const parts = [];
    for (const { bm, ids } of Object.values(batches)) {
      const [g0, g1] = ids[s.kind] ?? [];
      if (g0 == null && g1 == null) continue;
      const id = bm.addInstance(g0 ?? g1);
      bm.setMatrixAt(id, m4);
      if (bm.material === fleetPaint) bm.setColorAt(id, col.setHex(s.color));
      parts.push({ bm, id, g0, g1 });
    }
    blobs.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(s.x, roadHeight(s.x) + 0.012, s.z), q, new THREE.Vector3(2.25, 1, k.L + 0.6)));
    cars.push({ x: s.x, z: s.z, parts, lod: 0, vis: true, blob: i });
    colliders.push({ min: { x: s.x - 1.0, y: 0, z: s.z - k.L / 2 - 0.05 }, max: { x: s.x + 1.0, y: k.top, z: s.z + k.L / 2 + 0.05 } });
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
      const vis = d2 < far2, lod = d2 < near2 ? 0 : 1;
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
