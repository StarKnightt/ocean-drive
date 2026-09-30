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
import { OPEN_WORLD } from '../vehicles/specs.js';
import { extentBounds } from './extent.js';
import { registerLodHook, LOD } from './lod.js';
import { QUALITY } from '../quality.js';
import { staticCull } from '../renderer/batched-cull.js';
import {
  buildCars, buildParkedProcedural, carMovers, seat, groundReflect, clampRadiance,
  CAR_MAX_RADIANCE, shared, blockedBay,
} from './car.js';

// a soft pastel seafoam (the period's greyed turquoise, not a saturated cyan)
const HERO_PAINT = 0x8fc6bf;
const HERO_PAINT2 = 0xf1eee4;   // the two-tone side sweep
// the traffic classics: body colour and the contrast panel between the chrome spears
const CLASSIC_TONES = [[0xd9788f, 0xf1eee4], [0x8fb8d8, 0xf1eee4], [0xa3312b, 0xf1eee4], [0xefe2bb, 0x3f7d6a]];
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
const PROBE_Z = OPEN_WORLD ? extentBounds(QUALITY.tier) : { z0: DISTRICT.zMin, z1: DISTRICT.zMax };
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
    // along the drive the probe follows the viewer (clamped to the modelled district, or the
    // open world's extent)
    follow(p) {
      const z = THREE.MathUtils.clamp(p.z, PROBE_Z.z0, PROBE_Z.z1);
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
// The hero's rear-view mirror while someone drives: the street behind rendered into a small
// target from the driver's eye mirrored in the glass (a virtual camera behind the mirror
// looking back through it; the near plane clips the mirror and its housing). Every fourth frame
// on high, every fifth on medium, none on low (the housing's chrome shows instead), and not
// while it is off-screen. People, birds, particles and the parked glass are left out of it.
const MIRROR = { w: 0.176, h: 0.043, r: 0.012 };
// objects left out of the mirror pass (too small or too costly to matter in it)
export const mirrorHide = [];
const _mf = new THREE.Frustum(), _mm = new THREE.Matrix4(), _mb = new THREE.Box3(), _mc = new THREE.Vector3(), _ms = new THREE.Vector3(), _msph = new THREE.Sphere();
function rearMirror(renderer, scene, inst) {
  const anchor = inst.levels[0].getObjectByName('rear_mirror');
  if (!anchor || QUALITY.tier === 'low') return null;
  const every = QUALITY.tier === 'high' ? 4 : 5;
  const rt = new THREE.WebGLRenderTarget(256, 64, { type: THREE.HalfFloatType });
  const { w, h, r } = MIRROR;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2); shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r); shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2); shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r); shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const geo = new THREE.ShapeGeometry(shape, 4);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  // (the anchor's local +y is the mirror's normal, -z its up: glTF from Blender's Z / Y)
  geo.rotateX(-Math.PI / 2).translate(0, 0.0006, 0);
  rt.texture.wrapS = THREE.RepeatWrapping;
  rt.texture.repeat.x = -1;
  rt.texture.offset.x = 1;
  const face = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: rt.texture, color: 0xcfd4d4, fog: false }));
  face.visible = false;
  face.castShadow = false;
  anchor.add(face);
  // (180 m: past that the haze leaves a 64 px mirror one flat tone)
  const cam = new THREE.PerspectiveCamera(10, w / h, 0.5, 180);
  cam.userData.noSort = true;
  const E = new THREE.Vector3(), P = new THREE.Vector3(), N = new THREE.Vector3(), up = new THREE.Vector3();
  let frame = 0;
  return {
    face,
    update(camera, on, busy) {
      face.visible = on;
      if (!on || busy || frame++ % every) return;
      camera.getWorldPosition(E);
      anchor.getWorldPosition(P);
      // (looking out of the side or back: the mirror is off-screen, keep its last image)
      _mf.setFromProjectionMatrix(_mm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const st = (globalThis.__mirrorStats ??= { runs: 0, off: 0 });
      if (!_mf.intersectsSphere(_msph.set(P, 0.12))) { st.off++; return; }
      st.runs++;
      N.set(0, 1, 0).transformDirection(anchor.matrixWorld);
      // the eye mirrored through the glass plane, looking back through the mirror
      const k = 2 * E.clone().sub(P).dot(N);
      cam.position.copy(E).addScaledVector(N, -k);
      cam.up.copy(up.set(0, 1, 0).transformDirection(inst.car.matrixWorld));
      cam.lookAt(P);
      const dist = cam.position.distanceTo(P);
      cam.near = dist + 0.03;
      cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan((h / 2 + 0.003) / dist));
      cam.updateProjectionMatrix();
      const target = renderer.getRenderTarget(), shadowUpdate = renderer.shadowMap.needsUpdate;
      renderer.shadowMap.needsUpdate = false;
      face.visible = false;
      renderer.setRenderTarget(rt);
      renderer.clear();
      // (the scene's world matrices are last frame's, which a 384 x 96 mirror can't show:
      // the main render updates them a moment later anyway)
      const auto = scene.matrixWorldAutoUpdate;
      scene.matrixWorldAutoUpdate = false;
      // compact top-level objects (traffic cars, people) out of the mirror's narrow view are
      // left out of its pass: their node trees cost more to walk than the mirror shows
      cam.updateMatrixWorld();
      _mf.setFromProjectionMatrix(_mm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      const hide = mirrorHide.filter((o) => o.visible);
      for (const o of scene.children) {
        if (!o.visible || o.isLight || o === inst.car) continue;
        // (only what reads in a 256 x 64 view back down the drive: the sky, the buildings,
        // the street, palms and sea (userData.mirror) and the cars at their simple level)
        if (!o.userData.mirror && !o.userData.levels) { hide.push(o); continue; }
        let r = o.userData.mirrorR;
        if (r === undefined) {
          // (once: the bounding radius about the object's origin; 0 = not compact, always drawn)
          _mb.setFromObject(o, false);
          const c = _mb.getCenter(_mc), rr = _mb.getSize(_ms).length() / 2 + c.distanceTo(o.position) + 0.5;
          r = o.userData.mirrorR = _mb.isEmpty() || rr > 12 || o.children.length < 2 && !o.isSkinnedMesh ? 0 : rr;
        }
        if (r > 0 && (!_mf.intersectsSphere(_msph.set(o.position, r)) || (o.userData.levels && o.position.distanceToSquared(P) > 70 * 70))) hide.push(o);
      }
      for (const o of hide) o.visible = false;
      // (the car's own cabin and tail seen behind the driver, and the traffic behind, at
      // their simple levels of detail)
      const lod0 = inst.levels[0].visible;
      if (lod0) setLevel(inst, 1);
      const swapped = [];
      for (const o of scene.children) {
        const lv = o.visible && o.userData.levels;
        if (lv && lv[0].visible && lv[1]) { lv[0].visible = false; lv[1].visible = true; swapped.push(lv); }
      }
      const c0 = renderer.info.render.calls, t0 = performance.now();
      renderer.render(scene, cam);
      st.calls = renderer.info.render.calls - c0;
      st.ms = +(performance.now() - t0).toFixed(2);
      for (const lv of swapped) { lv[0].visible = true; lv[1].visible = false; }
      if (lod0) setLevel(inst, 0);
      for (const o of hide) o.visible = true;
      scene.matrixWorldAutoUpdate = auto;
      renderer.setRenderTarget(target);
      renderer.shadowMap.needsUpdate = shadowUpdate;
      face.visible = true;
    },
  };
}

// ---------------------------------------------------------------------------
// runtime materials by the Blender material name
function glassMaterial(env, { color, opacity, edge, key, edgeTint = null, under = null, ior = 1.5, envI = 1.0, rough = 0.015, inside = null, spec = 1 }) {
  const m = new THREE.MeshPhysicalMaterial({
    color, roughness: rough, metalness: 0, transparent: true, opacity, envMap: env, envMapIntensity: envI, ior, specularIntensity: spec,
    clearcoat: 1, clearcoatRoughness: Math.max(0.015, rough), depthWrite: false, side: THREE.DoubleSide,
  });
  // inside: { edge, dash } for the hero's screen seen from the driver's seat (uInside = 1):
  // a stronger edge tint, and the sunlit dash top faintly mirrored in the lower glass. From
  // outside the grazing edge stays light so the cockpit reads through the wraparound corners
  const uInside = { value: 0 };
  m.userData.uInside = uInside;
  m.userData.uBaseY = { value: 0 };
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
    const edgeExpr = inside ? `mix(${edge.toFixed(2)}, ${inside.edge.toFixed(2)}, uInside)` : edge.toFixed(2);
    if (inside) {
      // (height above the car's base: the GLB's positions are quantised, so not position.y)
      s.uniforms.uInside = uInside;
      s.uniforms.uBaseY = m.userData.uBaseY;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying float vObjY;\nuniform float uBaseY;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvObjY = (modelMatrix * vec4(transformed, 1.0)).y - uBaseY;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vObjY;\nuniform float uInside;');
    }
    const d = inside ? new THREE.Color(inside.dash) : null;
    s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>',
      `{ float fr = pow(1.0 - clamp(abs(dot(normalize(vNormal), normalize(vViewPosition))), 0.0, 1.0), 3.0);
         diffuseColor.a = mix(diffuseColor.a, 1.0, fr * ${edgeExpr});
         ${tint ? `outgoingLight = mix(outgoingLight, outgoingLight * vec3(${tint.r.toFixed(3)}, ${tint.g.toFixed(3)}, ${tint.b.toFixed(3)}), fr);` : ''}
         outgoingLight = totalDiffuse * diffuseColor.a + max(outgoingLight - totalDiffuse, vec3(0.0)) * (0.35 + 0.65 * diffuseColor.a);
         ${d ? `outgoingLight += uInside * vec3(${d.r.toFixed(3)}, ${d.g.toFixed(3)}, ${d.b.toFixed(3)}) * (1.0 - smoothstep(0.93, 1.16, vObjY));
         diffuseColor.a = max(diffuseColor.a, uInside * 0.1 * (1.0 - smoothstep(0.93, 1.16, vObjY)));` : ''} }
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
// lacquer: the hero's period paint gets a softer coat (reflections that follow the panels
// without mirroring like its chrome)
const LACQUER = { ccr: 0.1, envI: 0.62, coat: 1.25 };
function paintMaterial(env, color, key, o = null) {
  const { ccr = 0.05, envI = 1.0, coat = 2.6 } = o ?? {};
  const m = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.45, metalness: 0.0, specularIntensity: 0.18, clearcoat: 1, clearcoatRoughness: ccr,
    envMap: env, envMapIntensity: envI,
  });
  groundReflect(m, 'glb-paint-' + key, CAR_MAX_RADIANCE, 1.4, coat);
  return m;
}

// engine-turned metal: rows of overlapping swirled discs (a tile of 4 x 4)
function engineTexture() {
  const N = 256, S = N / 4;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  g.fillStyle = '#b9bdc1';
  g.fillRect(0, 0, N, N);
  for (let row = -1; row <= 4; row++) for (let col = -1; col <= 4; col++) {
    const x = (col + 0.5 + (row % 2 ? 0.5 : 0)) * S, y = (row + 0.5) * S * 0.9;
    for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) {
      const cx = x + dx, cy = y + dy;
      if (cx < -S || cx > N + S || cy < -S || cy > N + S) continue;
      const cg = g.createConicGradient(0.6, cx, cy);
      cg.addColorStop(0, '#f6f7f8'); cg.addColorStop(0.25, '#9a9ea3'); cg.addColorStop(0.5, '#eceef0');
      cg.addColorStop(0.75, '#8e9297'); cg.addColorStop(1, '#f6f7f8');
      g.fillStyle = cg;
      g.beginPath(); g.arc(cx, cy, S * 0.62, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(40,42,45,0.35)'; g.lineWidth = 1.2; g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // (the cockpit UVs are in metres: a disc every ~16 mm)
  t.repeat.set(15, 15);
  t.anisotropy = 8;
  return t;
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
  // satin chrome (horn cap, pedal and wiper arms): reflections broken up
  const brushed = std({ color: 0xe4e6e8, metalness: 1, roughness: 0.2, envMap: env, envMapIntensity: 1.0 });
  groundReflect(brushed, 'glb-brushed', CAR_MAX_RADIANCE, 1.9);
  const engine = std({ color: 0xffffff, map: engineTexture(), metalness: 0.45, roughness: 0.32, envMap: env, envMapIntensity: 1.1 });
  groundReflect(engine, 'glb-engine', CAR_MAX_RADIANCE, 1.9);
  for (const t of [vinylNor, carpetNor]) {
    if (!t) continue;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  if (carpetNor) carpetNor.repeat.set(3, 3);
  // soft upholstery vinyl: a matte grain with only a faint sheen
  const vinyl = (color) => {
    const m = new THREE.MeshPhysicalMaterial({
      color, roughness: 0.6, clearcoat: 0.1, clearcoatRoughness: 0.45, envMap: env, envMapIntensity: 0.55,
      ...(vinylNor ? { normalMap: vinylNor, normalScale: new THREE.Vector2(0.35, 0.35) } : {}),
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
    screen: glassMaterial(env, {
      color: 0xa9d2bd, opacity: 0.2, edge: 0.32, key: 'screen', edgeTint: 0x5fae8c, under: 0x5d9689, ior: 1.7, envI: 1.1,
      inside: { edge: 0.8, dash: 0x2e4a44 },
    }),
    // the dial lenses: a faint glint, the printed faces must read through them
    dial_glass: glassMaterial(env, { color: 0xf2f6f4, opacity: 0.025, edge: 0.15, key: 'dial', envI: 0.1, rough: 0.14 }),
    gauge_speedo: std({ map: dialTexture('speedo'), roughness: 0.4, envMapIntensity: 0.6 }, 'dial', true),
    gauge_fuel: std({ map: dialTexture('fuel'), roughness: 0.4, envMapIntensity: 0.6 }, 'dial', true),
    gauge_temp: std({ map: dialTexture('temp'), roughness: 0.4, envMapIntensity: 0.6 }, 'dial', true),
    needle: coat({ color: 0xd8471a, roughness: 0.3, emissive: 0x3a0e02 }, 'needle'),
    // (a faint warm emissive stands in for light scattering through skin in the shade)
    skin: std({ color: 0xdcae93, roughness: 0.55, emissive: 0x1f1009, envMap: env, envMapIntensity: 0.55 }, 'figure', true),
    cloth: std({ color: 0xe6e0d2, roughness: 0.92, emissive: 0x0d0c0a, envMap: env, envMapIntensity: 0.6 }, 'figure', true),
    cloth2: std({ color: 0xa8926a, roughness: 0.92, envMapIntensity: 0.6 }, 'figure', true),
    rubber: std({ color: 0x1e1e1e, roughness: 0.72, envMapIntensity: 0.6 }, 'figure', true),
    engine, brushed,
    enamel: coat({ color: 0x9b1a17, roughness: 0.2, clearcoatRoughness: 0.05, envMapIntensity: 0.8 }, 'enamel'),
    // padded dash top: matte grained vinyl a shade deeper than the paint
    dashtop: std({ color: 0x6b9f93, roughness: 0.75, envMapIntensity: 0.6, ...(vinylNor ? { normalMap: vinylNor, normalScale: new THREE.Vector2(0.3, 0.3) } : {}) }, 'dashtop', true),
    // the modern fleet's glass: dark tinted panels that mirror the sky and the palms (the
    // specular boost stands in for the reflection off the dark interior behind the pane);
    // the windscreen a lighter tint; light enough that the driver in the shaded cabin reads
    tint: glassMaterial(env, { color: 0x0c1215, opacity: 0.62, edge: 0.9, key: 'tint', spec: 2.6, envI: 1.25 }),
    windshield: glassMaterial(env, { color: 0x131b1f, opacity: 0.42, edge: 0.9, key: 'windshield', spec: 2.2, envI: 1.2 }),
    tyre: std({ vertexColors: true, color: 0xffffff, roughness: 0.8, envMapIntensity: 0.5 }, 'tyre', true),
    trim: std({ color: 0x141516, roughness: 0.42, envMapIntensity: 0.7 }),
    grille: coat({ color: 0x0e0f10, roughness: 0.3, clearcoatRoughness: 0.08, envMapIntensity: 0.9 }, 'grille'),
    dark: std({ color: 0x0b0b0c, roughness: 0.85, envMapIntensity: 0.3 }),
    vinyl: tuckAndRoll(vinyl(0xf3ecdc)),
    vinyl2: vinyl(0x7fc4b4),
    canvas: std({ color: 0xd8d0bb, roughness: 0.92, envMapIntensity: 0.9, ...(carpetNor ? { normalMap: carpetNor, normalScale: new THREE.Vector2(0.45, 0.45) } : {}) }),
    // (light enough to read in the shaded footwells; a little emissive for the bounce light)
    carpet: std({ color: 0x5f7a74, roughness: 1, envMap: env, envMapIntensity: 0.95, emissive: 0x08100e, ...(carpetNor ? { normalMap: carpetNor, normalScale: new THREE.Vector2(1.3, 1.3) } : {}) }, 'carpet', true),
    ivory: coat({ color: 0xf1e9d6, roughness: 0.22, clearcoat: 0.6, envMapIntensity: 1.0 }, 'ivory'),
    lens: coat({ color: 0xdfe6ea, metalness: 0.9, roughness: 0.06, envMapIntensity: 1.0 }, 'lens'),
    amber: coat({ color: 0xd98a2e, roughness: 0.18, emissive: 0x2a1200 }, 'amber'),
    tail: lampMaterial(env, 0x9a1016, 0x2a0304),
    brake3: lampMaterial(env, 0x7a0c10, 0x140102),
    // (the traffic's own lamps: its brake lights are lit per car)
    makeTail: () => lampMaterial(env, 0x9a1016, 0x2a0304),
    makeBrake3: () => lampMaterial(env, 0x7a0c10, 0x140102),
    plate: std({ color: 0xe6e2d2, roughness: 0.55 }),
    interior: std({ color: 0x3a3b3e, roughness: 0.7, envMapIntensity: 0.9 }),
    seat: std({ color: 0x2a2b2e, roughness: 0.62, envMapIntensity: 0.9 }),
  };
}

// the bench upholstery: rolls running fore-aft (across the car every 7.5 cm) with stitched
// grooves between them, inboard of the door panels. The hero's trim mesh is quantized: car x =
// object x * 2.8704 (LOD1's scale differs; the rolls are not seen at that range)
function tuckAndRoll(m) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (s) => {
    prev?.(s);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRollX;\nvarying vec3 vRollAx;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRollX = position.x * 2.8704;\nvRollAx = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRollX;\nvarying vec3 vRollAx;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float rk = 1.0 - smoothstep(0.7, 0.76, abs(vRollX));
          float rf = fract(vRollX / 0.075 + 0.5) * 2.0 - 1.0;
          vec3 rAx = normalize(vRollAx);
          rAx -= normal * dot(rAx, normal);
          normal = normalize(normal + rAx * rf * 0.75 * rk);
          diffuseColor.rgb *= mix(1.0, mix(1.0, 0.62, smoothstep(0.8, 1.0, abs(rf))), rk);
        }`);
  };
  m.customProgramCacheKey = () => 'glb-vinyl-roll';
  return m;
}

// lamp lens: the lit emissive stays unclamped (a brake light blooms), only the lit surface
// under the sun is capped like the rest of the car
function lampMaterial(env, color, emissive) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.05, envMap: env, emissive });
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>',
      `outgoingLight = min(outgoingLight - totalEmissiveRadiance, vec3(${CAR_MAX_RADIANCE.toFixed(2)})) + totalEmissiveRadiance;
#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'car-lamp';
  return m;
}

// Transparent double-sided glass: three draws it back faces then front faces by flipping
// material.side with needsUpdate, i.e. two program lookups per mesh per frame (dozens of
// cars). Instead the mesh keeps a back-side copy and a front-side twin child (same depth, a
// later id, so it sorts right after): the same two passes, no per-frame program churn.
const sidePairs = new WeakMap();
function glassSides(m) {
  let p = sidePairs.get(m);
  if (!p) {
    p = [THREE.BackSide, THREE.FrontSide].map((side) => {
      const c = m.clone();
      c.side = side;
      c.onBeforeCompile = m.onBeforeCompile;
      c.customProgramCacheKey = m.customProgramCacheKey;
      c.userData = m.userData;
      return c;
    });
    sidePairs.set(m, p);
  }
  return p;
}
function batchedCopy(m) {
  const c = m.clone();
  c.onBeforeCompile = m.onBeforeCompile;
  c.customProgramCacheKey = m.customProgramCacheKey;
  c.userData = m.userData;
  return c;
}
function splitGlass(o) {
  const [back, front] = glassSides(o.material);
  o.material = back;
  const twin = new THREE.Mesh(o.geometry, front);
  twin.name = o.name + '_front';
  twin.castShadow = false;
  twin.receiveShadow = o.receiveShadow;
  twin.renderOrder = o.renderOrder;
  o.add(twin);
}

// The driven modern car's glass: the fleet's dark tint reads nearly black from the seat, so
// its panes get lighter copies (shared by every driven car; two extra glass programs)
let LITE = null;
const liteGlass = (M, env) => (LITE ??= new Map([
  [M.tint, glassMaterial(env, { color: 0x1a2226, opacity: 0.3, edge: 0.75, key: 'tint-lite', spec: 1.6, envI: 0.8 })],
  [M.windshield, glassMaterial(env, { color: 0x1c2428, opacity: 0.14, edge: 0.75, key: 'windshield-lite', spec: 1.2, envI: 0.7 })],
]));
function lighterGlass(root, M, env) {
  liteGlass(M, env);
  const swap = new Map();
  for (const [from, to] of LITE) {
    const a = glassSides(from), b = glassSides(to);
    swap.set(a[0], b[0]).set(a[1], b[1]);
  }
  root.traverse((o) => { if (o.isMesh && swap.has(o.material)) o.material = swap.get(o.material); });
}

function applyMaterials(root, M, paint, paint2) {
  const split = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material.name;
    if (name === 'paint') o.material = paint;
    else if (name === 'paint2') o.material = paint2;
    else if (name === 'gauge') {
      o.material.envMap = M.chrome.envMap;
      o.material.roughness = 0.35;
    } else if (M[name]) o.material = M[name];
    const clear = o.material === M.glass || o.material === M.tint || o.material === M.windshield || o.material === M.screen || o.material === M.dial_glass;
    o.castShadow = !clear;
    o.receiveShadow = true;
    if (clear) o.renderOrder = 2;
    if (o.material.transparent && o.material.side === THREE.DoubleSide) split.push(o);
  });
  for (const o of split) splitGlass(o);
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
// three's updateMatrixWorld walks hidden subtrees too, and a car is 90-190 nodes (both LODs,
// the driver's skeleton): hidden cars and their unused LOD skip it (once shown, the parent's
// pass recomputes them; getWorldPosition still updates on demand)
function skipWhenHidden(o) {
  o.updateMatrixWorld = function (force) { if (this.visible) THREE.Object3D.prototype.updateMatrixWorld.call(this, force); };
  return o;
}
let tunnelGeo = null;
function tunnelGeometry() {
  if (tunnelGeo) return tunnelGeo;
  // half-ellipse section 0.3 m wide, 0.12 m high on the floor (y 0.455), z -0.12 .. 0.78
  const s = new THREE.Shape();
  s.moveTo(-0.15, 0);
  s.absellipse(0, 0, 0.15, 0.12, Math.PI, 0, true);
  s.lineTo(-0.15, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.9, bevelEnabled: false, curveSegments: 14 });
  g.translate(0, 0.45, -0.12);
  // (the carpet's normal map needs uvs ~ metres: extrude's are already in shape units)
  return (tunnelGeo = g);
}
function heroInstance(gltf, paint, paint2, M) {
  const g = skipWhenHidden(new THREE.Group());
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
    body.add(skipWhenHidden(c));
    return c;
  });
  const wheels = [], steering = [], wheelSets = [];
  levels.forEach((lv, k) => {
    const sfx = k ? '_L1' : '';
    const set = skipWhenHidden(new THREE.Group());
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
  const blob = blobMesh(2.35, 6.1);
  g.add(blob);
  const L0 = levels[0];
  // the transmission tunnel down the middle of the front floor, carpeted, into the toe board
  const hump = new THREE.Mesh(tunnelGeometry(), M.carpet);
  hump.name = 'tunnel';
  hump.receiveShadow = true;
  L0.add(hump);
  const needle = L0.getObjectByName('speedo_needle');
  if (needle) needle.userData.q0 = needle.quaternion.clone();
  // driver body hook (attachDriver): a skinned character hangs from the pelvis anchor, its
  // hands IK'd to the rim targets on the LOD0 wheel (they turn with it). None until attached
  const driverRig = {
    pelvis: L0.getObjectByName('driver_pelvis'), eye: L0.getObjectByName('driver_eye'),
    gripL: L0.getObjectByName('grip_L'), gripR: L0.getObjectByName('grip_R'),
    wheel: steering[0], wheelAngle: 0, t: 0,
    body: null, update: null,
  };
  g.userData = {
    levels, wheels, steering,
    seatAnchor: L0.getObjectByName('driver_seat'), eyeAnchor: L0.getObjectByName('driver_eye'),
  };
  return { car: g, sway, wheels, wheelSets, steering, levels, wheelR: WHEEL_R, needle, driverRig, blob };
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
  const rig = inst.driverRig;
  if (rig?.body) {
    rig.body.visible = !!v.ridden;
    if (v.ridden && rig.update) {
      rig.wheelAngle = steerWheelAngle(v);
      rig.t = v.t;
      inst.car.updateMatrixWorld(true);
      rig.update(rig, v);
    }
  }
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
    const base = mat === 'paint' ? fleetPaint : (M[mat] ?? M.trim);
    const clear = base === M.tint || base === M.glass || base === M.windshield;
    // (the batches get their own copy of a material the hero and the traffic also use: three
    // re-resolves the program each time one material alternates between batched and plain
    // draws; the copy shares the compiled program)
    const material0 = base === fleetPaint ? base : batchedCopy(base);
    // (the blended double-sided glass as a back-side and a front-side batch, like splitGlass:
    // three's two-pass double-sided draw flags a program update on every draw)
    const sides = clear && material0.side === THREE.DoubleSide ? glassSides(material0) : [material0];
    for (const [si, material] of sides.entries()) {
      const bm = new THREE.BatchedMesh(count, verts, index, material);
      bm.name = 'parked-' + mat + (si ? '-front' : '');
      const ids = {};
      for (const [kind, list] of Object.entries(geos)) ids[kind] = list.map((g) => (g ? bm.addGeometry(g) : null));
      bm.castShadow = !clear;
      bm.receiveShadow = true;
      // (three's per-instance culling walks every instance of every batch in each pass: the
      // opaque batches are culled from precomputed spheres once the instances are placed,
      // below; the blended glass is not culled, and sorted only when the viewer has moved,
      // and not in the mirror)
      bm.perObjectFrustumCulled = false;
      bm.sortObjects = clear;
      if (clear) {
        bm.renderOrder = 2;
        mirrorHide.push(bm);
        const sortPass = bm.onBeforeRender;
        const at = new THREE.Vector3(Infinity, 0, 0), fw = new THREE.Vector3(), f0 = new THREE.Vector3();
        bm.onBeforeRender = function (renderer, scn, camera, geometry, mt) {
          camera.getWorldDirection(fw);
          if (!this._visibilityChanged && at.distanceToSquared(camera.position) < 0.25 && fw.dot(f0) > 0.985) return;
          at.copy(camera.position); f0.copy(fw);
          sortPass.call(this, renderer, scn, camera, geometry, mt);
        };
      }
      scene.add(bm);
      batches[mat + (si ? ':front' : '')] = { bm, ids };
    }
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
    const hx = s.cross ? k.L / 2 + 0.05 : 1.0, hz = s.cross ? 1.0 : k.L / 2 + 0.05;
    const box = { min: { x: s.x - hx, y: 0, z: s.z - hz }, max: { x: s.x + hx, y: k.top, z: s.z + hz }, parked: i };
    colliders.push(box);
    // (the spot, for the drivable fleet: the model origin in sim terms, yaw 0 = north, and
    // the colour; taken = driven off, its instances and collider switched off)
    const R = s.yaw;
    cars.push({
      x: s.x, z: s.z, parts, lod: 0, vis: true, blob: i, far2: s.cross ? 120 * 120 : null,
      kind: s.kind, color: s.color, index: i, col: box, taken: false, L: k.L,
      pose: { x: s.x - k.zc * Math.sin(R), z: s.z - k.zc * Math.cos(R), yaw: R - Math.PI },
    });
  });
  blobs.instanceMatrix.needsUpdate = true;
  scene.add(blobs);
  for (const { bm } of Object.values(batches)) if (!bm.sortObjects) staticCull(bm);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const blobMats = spots.map((_, i) => { const m = new THREE.Matrix4(); blobs.getMatrixAt(i, m); return m; });
  // distance LOD + culling (runs when the viewer has moved along the street)
  const far2 = LOD.cars * LOD.cars, near2 = LOD1_AT.parked * LOD1_AT.parked;
  const update = (p) => {
    let changed = false;
    for (const c of cars) {
      if (c.taken) continue;
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
  // a parked car driven off / put back: its batch instances, contact blob and collider
  const setTaken = (c, taken) => {
    c.taken = taken;
    c.col.disabled = taken;
    for (const pt of c.parts) pt.bm.setVisibleAt(pt.id, !taken && c.vis && (c.lod === 0 ? pt.g0 : pt.g1) != null);
    blobs.setMatrixAt(c.blob, taken || !c.vis ? hidden : blobMats[c.blob]);
    blobs.instanceMatrix.needsUpdate = true;
  };
  return { colliders, cars, batches, blobs, update, take: (c) => setTaken(c, true), release: (c) => setTaken(c, false) };
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
// Traffic cars (world/traffic.js): modern models cloned from the parked fleet GLB (the same
// paint, tinted glass and lamp setup as the parked batches, fed by the same reflection
// probe), each instance with its own paint, tail-lamp and stop-lamp materials, wheel pivots,
// both LODs and driver hooks, plus the two-tone classic convertibles. No shadow casting (the
// sun's shadow map is static): a contact blob under the body and tyres, and a soft sun shadow
// quad stretched away from the sun.
const WHEEL_RADII = { sedan: 0.335, hatch: 0.315, suv: 0.37, pickup: 0.39, coupe: 0.34, wagon: 0.33, crossover: 0.355 };
function softRectTexture() {
  const N = 64, px = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = Math.abs((i + 0.5) / N - 0.5), v = Math.abs((j + 0.5) / N - 0.5);
    const a = (1 - THREE.MathUtils.smoothstep(u, 0.3, 0.48)) * (1 - THREE.MathUtils.smoothstep(v, 0.34, 0.48));
    px[(j * N + i) * 4 + 3] = Math.round(255 * a);
  }
  const t = new THREE.DataTexture(px, N, N);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
// brake-lamp glow: small additive halos at the lamps (the bloom pass thresholds luminance, so a
// saturated red lamp would have to be pushed to white before it bloomed)
function haloTexture() {
  const N = 64, px = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const r = Math.min(1, Math.hypot((i + 0.5) / N - 0.5, (j + 0.5) / N - 0.5) * 2);
    const a = (1 - r) ** 2.2;
    px.set([255, 255, 255, Math.round(255 * a)], (j * N + i) * 4);
  }
  const t = new THREE.DataTexture(px, N, N);
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
let HALO = null;
function lampHalos(level, parent, tailMat, stopMat) {
  HALO ??= new THREE.SpriteMaterial({ map: haloTexture(), color: 0xe0000c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 });
  parent.updateMatrixWorld(true);
  const inv = parent.matrixWorld.clone().invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  const pts = { L: [], R: [], S: [] };
  level.traverse((o) => {
    if (!o.isMesh || (o.material !== tailMat && o.material !== stopMat)) return;
    const pos = o.geometry.attributes.position;
    m.multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      (o.material === stopMat ? pts.S : v.x > 0 ? pts.L : pts.R).push(v.clone());
    }
  });
  const g = new THREE.Group();
  for (const [k, list] of Object.entries(pts)) {
    if (!list.length) continue;
    const zMin = Math.min(...list.map((p) => p.z));
    const back = list.filter((p) => p.z < zMin + 0.06);
    const c = back.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / back.length);
    const s = new THREE.Sprite(HALO);
    s.position.set(c.x, c.y, c.z - 0.04);
    s.scale.setScalar(k === 'S' ? 0.32 : 0.5);
    s.renderOrder = 3;
    g.add(s);
  }
  g.visible = false;
  parent.add(g);
  return g;
}
// A traffic car's far level (LOD1, past ~40 m) as five draws instead of one per material
// (~28): its own paint and lamps, every other opaque part in one vertex-coloured mesh
// (metals darkened, they have nothing sharp to mirror at that size) and the glass one dark
// glossy opaque mesh. The wheels are baked in at rest. Built once per kind from the GLB
// source (the instances' own geometry arrays are released after upload).
let L1M = null;
function lod1Materials(env) {
  if (L1M) return L1M;
  const body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25, envMap: env, envMapIntensity: 0.8 });
  clampRadiance(body, 'glb-lod1');
  const glass = new THREE.MeshStandardMaterial({ color: 0x0f1518, roughness: 0.08, metalness: 0.8, envMap: env, envMapIntensity: 1.1 });
  clampRadiance(glass, 'glb-lod1-glass');
  return (L1M = { body, glass });
}
const collapsedCache = new Map();
function collapsedLod1(gltf, kind, M) {
  if (collapsedCache.has(kind)) return collapsedCache.get(kind);
  const src = gltf.scene.getObjectByName(kind + '_L1');
  const buckets = { paint: [], tail: [], brake3: [], body: [], glass: [] };
  const c = new THREE.Color();
  src?.traverse((o) => {
    if (!o.isMesh || o.parent?.isMesh) return;
    const name = o.material.name, mat = M[name];
    const glass = mat ? mat.transparent : o.material.transparent;
    const b = name === 'paint' || name === 'paint2' ? 'paint' : mat === M.tail ? 'tail' : mat === M.brake3 ? 'brake3' : glass ? 'glass' : 'body';
    const g = bake(o, src, b === 'body' ? ['position', 'normal', 'color'] : ['position', 'normal']);
    if (b === 'body') {
      const n = g.attributes.position.count, vc = g.attributes.color, out = new Float32Array(n * 3);
      c.copy(mat?.color ?? o.material.color ?? c.setRGB(0.5, 0.5, 0.5));
      if ((mat?.metalness ?? 0) > 0.5) c.multiplyScalar(0.55);
      for (let i = 0; i < n; i++) {
        const k = vc ? [vc.getX(i), vc.getY(i), vc.getZ(i)] : [1, 1, 1];
        out[i * 3] = c.r * k[0]; out[i * 3 + 1] = c.g * k[1]; out[i * 3 + 2] = c.b * k[2];
      }
      g.setAttribute('color', new THREE.BufferAttribute(out, 3));
    }
    buckets[b].push(g);
  });
  const out = {};
  for (const [b, list] of Object.entries(buckets)) if (list.length) out[b] = list.length > 1 ? mergeList(list) : list[0];
  collapsedCache.set(kind, out);
  return out;
}

function trafficKit(scene, gltf, M, env, pool, probe) {
  const kinds = gltf ? KINDS.filter((k) => gltf.scene.getObjectByName(k)) : [];
  const box = new THREE.Box3();
  gltf?.scene.updateMatrixWorld(true);
  const lens = Object.fromEntries(kinds.map((k) => [k, box.setFromObject(gltf.scene.getObjectByName(k)).max.z - box.min.z]));
  // the driver's hips along each body (model z, the nose is +z): where its doors are
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  const seatZ = Object.fromEntries(kinds.map((k) => {
    const p = gltf.scene.getObjectByName(k + '_driver_pelvis');
    return [k, p ? p.getWorldPosition(_a).z - gltf.scene.getObjectByName(k).getWorldPosition(_b).z : 0.3];
  }));
  const sunMat = new THREE.MeshBasicMaterial({ color: 0x000000, map: softRectTexture(), transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const sunGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const sunShadow = () => {
    const m = new THREE.Mesh(sunGeo, sunMat);
    m.renderOrder = 1;
    m.castShadow = false;
    return m;
  };
  let light = null;
  const _d = new THREE.Vector3();
  for (const m of pool) {
    m.sun = sunShadow();
    m.car.add(m.sun);
    const body = m.sway.children[0];
    m.halos = lampHalos(m.levels[0], body, m.tail, null);
  }
  // the driven car's lighter glass, compiled with everything else at load (a 1 cm pane of
  // each under the road, hidden after the first frames), so getting in doesn't stall
  const warm = new THREE.Group();
  warm.position.set(CAR.x, -3, CAR.z);
  for (const m of liteGlass(M, env).values()) for (const side of glassSides(m)) warm.add(new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), side));
  scene.add(warm);
  let warmFrames = 0;
  return {
    kinds, lens, seatZ, classics: pool, paints: PAINTS,
    lod1At: LOD1_AT.parked,
    // one instance of `kind` with its own paint / lamp materials (world/traffic.js pools them)
    makeModern(kind) {
      const paint = paintMaterial(env, 0xffffff, 'fleet');   // (the fleet's program: nothing new to compile)
      const tail = M.makeTail(), brake3 = M.makeBrake3();
      const root = skipWhenHidden(new THREE.Group());
      const levels = [kind, kind + '_L1'].map((n, k) => {
        let c;
        if (k === 1) {
          c = skipWhenHidden(new THREE.Group());
          c.name = n;
          const L1 = lod1Materials(env), mats = { paint, tail, brake3, body: L1.body, glass: L1.glass };
          for (const [b, g] of Object.entries(collapsedLod1(gltf, kind, M))) {
            const m = new THREE.Mesh(g, mats[b]);
            m.castShadow = false;
            m.receiveShadow = true;
            c.add(m);
          }
        } else {
          c = skipWhenHidden(gltf.scene.getObjectByName(n).clone(true));
          applyMaterials(c, M, paint, paint);
          c.traverse((o) => {
            if (!o.isMesh) return;
            o.castShadow = false;
            if (o.material === M.tail) o.material = tail;
            else if (o.material === M.brake3) o.material = brake3;
          });
        }
        c.position.set(0, 0, 0);
        c.visible = k === 0;
        root.add(c);
        return c;
      });
      // (the far level's wheels are baked into its body)
      const wheels = [['FL', 'FR', 'RL', 'RR'].map((w) => levels[0].getObjectByName(`${kind}_wheel_${w}`)).filter(Boolean)];
      const blob = blobMesh(2.25, lens[kind] + 0.6);
      const sun = sunShadow();
      root.add(blob, sun);
      const halos = lampHalos(levels[0], root, tail, brake3);
      root.visible = false;
      root.userData.levels = levels;
      scene.add(root);
      probe.hide.push(root);
      const rig = {
        pelvis: levels[0].getObjectByName(kind + '_driver_pelvis'),
        gripL: levels[0].getObjectByName(kind + '_grip_L'), gripR: levels[0].getObjectByName(kind + '_grip_R'),
      };
      return { root, levels, wheels, wheelR: WHEEL_RADII[kind] ?? 0.34, len: lens[kind], paint, tail, brake3, rig, sun, halos, kind };
    },
    // a player-drivable modern car (vehicles/index.js): an instance posed from the sim,
    // casting real sun shadows, with a turning steering wheel and speedo needle where the
    // model has them, the eye anchor, and a driver hook like the hero's (see drive below)
    makeDrivable(kind, color) {
      const I = this.makeModern(kind);
      I.paint.color.setHex(color ?? 0xb9bcbf);
      I.sun.visible = false;
      const L0 = I.levels[0];
      // (from the seat the cabin is lit only by the bounce light through the glass: a lighter
      // trim for the driven car's headliner, pillars and dash)
      M.interiorLite ??= M.interior.clone();
      M.interiorLite.color.setHex(0x6b665f);
      L0.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = !o.material.transparent;
        if (o.material === M.interior) o.material = M.interiorLite;
      });
      lighterGlass(L0, M, env);
      const steer = L0.getObjectByName(kind + '_steer');
      if (steer) steer.userData.q0 = steer.quaternion.clone();
      const needle = L0.getObjectByName(kind + '_needle');
      if (needle) needle.userData.q0 = needle.quaternion.clone();
      let eye = L0.getObjectByName(kind + '_eye');
      if (!eye && I.rig.pelvis) {
        // (models without the anchor: 0.62 m over the hips, a little back)
        eye = new THREE.Object3D();
        eye.position.copy(I.rig.pelvis.position).add(new THREE.Vector3(0, 0.62, -0.05));
        L0.add(eye);
      }
      const rig = { ...I.rig, wheel: steer, eye, wheelAngle: 0, t: 0, body: null, update: null, chase: false };
      let level = 0, lit = null;
      const lamp = (m, hex, k) => { if (m) { m.emissive.setHex(hex); m.emissiveIntensity = k; } };
      const view = {
        kind, inst: I, root: I.root, rig,
        apply(v) {
          const g = I.root;
          g.visible = true;
          g.position.set(v.x, v.bodyY, v.z);
          g.rotation.set(-v.pitch, v.yaw + Math.PI, -v.roll, 'YXZ');
          const d = v.steer, ad = Math.abs(d), S = v.spec;
          let inner = d, outer = d;
          if (ad > 1e-4) {
            const R = S.wheelbase / Math.tan(ad);
            inner = Math.sign(d) * Math.atan(S.wheelbase / Math.max(0.5, R - S.track / 2));
            outer = Math.sign(d) * Math.atan(S.wheelbase / (R + S.track / 2));
          }
          const angFL = d > 0 ? outer : inner, angFR = d > 0 ? inner : outer;
          for (const w of I.wheels) {
            w[0]?.rotation.set(v.wheelRot, -angFL, 0, 'YXZ');
            w[1]?.rotation.set(v.wheelRot, -angFR, 0, 'YXZ');
            w[2]?.rotation.set(v.wheelRot, 0, 0);
            w[3]?.rotation.set(v.wheelRot, 0, 0);
          }
          // (1.5 turns lock to lock: a modern rack)
          rig.wheelAngle = (v.steer / S.steerMax) * 0.75 * 2 * Math.PI;
          if (steer) steer.quaternion.copy(steer.userData.q0).multiply(_qs.setFromAxisAngle(_ax, rig.wheelAngle));
          if (needle) {
            // (modelled pointing at 0, the start of the sweep)
            const mph = Math.min(SPEEDO_SWEEP.max, Math.abs(v.lon) * 2.237);
            const deg = (SPEEDO_SWEEP.to - SPEEDO_SWEEP.from) * mph / SPEEDO_SWEEP.max;
            needle.quaternion.copy(needle.userData.q0).multiply(_qs.setFromAxisAngle(_ax, -THREE.MathUtils.degToRad(deg)));
          }
          // tail lamps lit with the engine running, brake lamps on the brake
          const want = !v.engineOn ? 'off' : v.braking > 0.05 ? 'brake' : 'run';
          if (want !== lit) {
            lit = want;
            lamp(I.tail, want === 'off' ? 0x2a0304 : want === 'brake' ? 0xff0010 : 0x5a0304, want === 'brake' ? 1.55 : 1);
            lamp(I.brake3, want === 'brake' ? 0xff0010 : 0x140102, want === 'brake' ? 1.55 : 1);
            I.halos.visible = want === 'brake';
          }
          if (rig.body) {
            rig.body.visible = !!v.ridden;
            if (v.ridden && rig.update) {
              rig.t = v.t;
              g.updateMatrixWorld(true);
              rig.update(rig, v);
            }
          }
        },
        // distance LOD for a car left standing (the ridden one stays at LOD0)
        lod(dist) {
          const k = dist < LOD1_AT.parked ? 0 : 1;
          if (k !== level) { level = k; I.levels.forEach((lv, i) => { lv.visible = i === k; }); }
          I.root.visible = dist < LOD.cars;
        },
        eye: (out) => (eye ? eye.getWorldPosition(out) : I.root.getWorldPosition(out).setY(I.root.position.y + 1.2)),
        eyeQuat: (out) => I.root.getWorldQuaternion(out).multiply(FLIP_Y),
        attachDriver(body, { update = null } = {}) {
          if (!rig.pelvis) return () => {};
          rig.pelvis.add(body);
          rig.body = body;
          rig.update = update;
          body.visible = false;
          return () => { rig.pelvis.remove(body); rig.body = rig.update = null; };
        },
        dispose() {
          scene.remove(I.root);
          const k = probe.hide.indexOf(I.root);
          if (k >= 0) probe.hide.splice(k, 1);
        },
      };
      return view;
    },
    // (called once a frame by buildCarsGlb's update)
    tick() { if (warm.visible && ++warmFrames > 240) warm.visible = false; },
    // where a car's shadow falls on the road (unit ground direction, away from the sun) and
    // how far it reaches for a car-height caster
    sun(out) {
      if (!light) scene.traverse((o) => { if (!light && o.isDirectionalLight && o.castShadow) light = o; });
      if (!light) return null;
      _d.subVectors(light.position, light.target.position).normalize();
      const el = Math.max(0.05, Math.asin(THREE.MathUtils.clamp(_d.y, -1, 1)));
      const g = Math.hypot(_d.x, _d.z) || 1;
      out.x = -_d.x / g; out.z = -_d.z / g;
      out.len = Math.min(4.5, 1.05 / Math.tan(el));
      return out;
    },
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
  const paint2 = paintMaterial(env, HERO_PAINT2, 'hero2', LACQUER);
  // hero: parked at the west curb, facing south (the direction of the west lane), top down
  const hero = heroInstance(heroGltf, paintMaterial(env, HERO_PAINT, 'hero', LACQUER), paint2, M);
  seat(hero.car, CAR.x, CAR.z, 0);
  scene.add(hero.car);
  const mirror = rearMirror(renderer, scene, hero);
  // (hero: the drivable car replaces this box with its own moving circles)
  const colliders = [{ min: { x: CAR.x - 1.0, y: 0, z: CAR.z - 2.9 }, max: { x: CAR.x + 1.0, y: 1.2, z: CAR.z + 2.9 }, hero: true }];
  const fleet = parkedGltf ? buildFleet(scene, parkedGltf, M) : null;
  colliders.push(...(fleet ? fleet.colliders : buildParkedProcedural(scene)));
  // classic copies for the traffic (world/traffic.js): no shadow casting (a contact blob),
  // each with its own tail-lamp material so its brake lights are its own
  const pool = CLASSIC_TONES.map(([c, c2], i) => {
    const m = heroInstance(heroGltf, paintMaterial(env, c, 'mover' + i, LACQUER), paintMaterial(env, c2, 'mover2-' + i, LACQUER), M);
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
  const kit = trafficKit(scene, parkedGltf, M, env, pool, probe);
  let heroDriven = false, heroChase = false;
  return {
    hero: hero.car, mover: pool[0].car, movers: pool.map((m) => m.car), colliders, fleet, probe, glb: true,
    traffic: kit,
    // the drivable hero (vehicles/index.js): start pose in sim terms, pose from the sim, eye
    drive: {
      pose: { x: CAR.x, z: CAR.z, yaw: Math.PI },
      apply: (v) => { heroDriven = !!v.ridden; poseHero(hero, v); },
      eye: (out) => hero.car.userData.eyeAnchor.getWorldPosition(out),
      // the eye's frame is the sprung body's (squat, dive, roll and shake move the view
      // against the horizon); the model's nose is +z, a camera looks down -z
      eyeQuat: (out) => hero.car.userData.eyeAnchor.getWorldQuaternion(out).multiply(FLIP_Y),
      root: hero.car,
      rig: hero.driverRig,
      // 'fp' (the driver's eye) or 'chase' (the third-person camera): the screen's inside look
      // and the driver's head follow it
      setView(mode) { heroChase = mode === 'chase'; hero.driverRig.chase = heroChase; },
      // Seat a skinned driver (e.g. a Mixamo character) in the hero: `body` is parented to
      // the `driver_pelvis` anchor (glTF axes: +z toward the nose, +x the car's left, +y up)
      // and shown only while someone drives. `update(rig, v)` runs after each pose with the
      // car's world matrices current: IK the hands to rig.gripL / rig.gripR (empties on the
      // rim at ten and two that turn with the wheel), aim the head at rig.eye, etc.
      // Returns a detach function.
      attachDriver(body, { update = null, forward = 0 } = {}) {
        const rig = hero.driverRig;
        if (!rig.pelvis) return () => {};
        // (a driver sat further forward: the eye moves with them)
        if (forward && rig.eye) rig.eye.position.z += forward;
        rig.pelvis.add(body);
        rig.body = body;
        rig.update = update;
        body.visible = heroDriven;
        return () => { rig.pelvis.remove(body); rig.body = rig.update = null; };
      },
    },
    update(dt, cars, camera, busy = false) {
      if (!camera) return;
      kit.tick();
      probe.follow(camera.position);
      const inside = heroDriven && !heroChase;
      M.screen.userData.uInside.value = inside ? 1 : 0;
      M.screen.userData.uBaseY.value = hero.car.position.y;
      mirror?.update(camera, inside, busy);
      for (const m of all) {
        if (!m.car.visible) continue;
        const d = m.car.getWorldPosition(tmp).distanceTo(camera.position);
        setLevel(m, d < LOD1_AT.hero ? 0 : 1);
      }
    },
  };
}
