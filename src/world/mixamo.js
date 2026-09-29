// Mixamo people: the converted characters (blender/people.py -> tools/build-people.mjs ->
// public/models/people/), the shared clip library and the roller skates.
//
// Every character carries the standard Mixamo skeleton (bone names unified to mixamorig*),
// so any clip plays on any character: tracks bind by bone name, and the hips translation is
// scaled by the character's hip height against the clip's reference. Each person is a
// SkeletonUtils clone (geometry shared, own bones), with
//   - LOD0 (~30k triangles) near, LOD1 (~6k) further away (one skin, one skeleton);
//   - per-person clothing tints: a vertex zone (top / bottom / shoes) recoloured in the
//     shader against the zone's mean texture luminance, so the fabric shading survives;
//   - a projected sun shadow (people.js's material: long 7 deg shadows on curb, road,
//     terraces, facades and sand) from the merged LOD1 on the same skeleton;
//   - clip foot speeds measured from the toes (m/s at playback 1) so code can match
//     playback rate to ground speed without sliding;
//   - two-bone IK (hands on a steering wheel, skate legs) that keeps the joints' hinge plane.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { QUALITY } from '../quality.js';
import { shadowMaterial, SH_SHARED } from './people.js';
import { HOTEL } from './layout.js';

// (Remy is converted too but not used: his legacy rig's head and neck don't retarget cleanly
// and his face texture is blank)
export const CHARACTERS = {
  sophie: { fem: true }, elizabeth: { fem: true }, megan: { fem: true },
  bryce: { fem: false }, lewis: { fem: false },
};
const LOW_SET = ['sophie', 'megan', 'bryce', 'lewis'];
const TEX = QUALITY.tier === 'high' ? '' : '-512';

let pending = null;
// start the downloads early (main.js calls this before the world build)
export function preloadPeople() {
  if (pending) return pending;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const get = (f) => loader.loadAsync(`models/people/${f}.glb`).catch((e) => { console.warn(`people: ${f}.glb failed`, e); return null; });
  const names = QUALITY.tier === 'low' ? LOW_SET : Object.keys(CHARACTERS);
  pending = Promise.all([get('clips'), get('skate'), ...names.map((n) => get(n + TEX))]).then(([clips, skate, ...chars]) => {
    if (!clips) return null;
    const lib = prepClips(clips);
    const out = { lib, skate: skate?.scene ?? null, chars: {} };
    names.forEach((n, i) => { if (chars[i]) out.chars[n] = prepChar(n, chars[i], lib); });
    return Object.keys(out.chars).length ? out : null;
  });
  return pending;
}

// ---------------------------------------------------------------------------
// clip library
function prepClips(gltf) {
  const clips = new Map();
  for (const c of gltf.animations) clips.set(c.name, c);
  let refHips = 96.6;
  gltf.scene.traverse((o) => { if (o.name === 'mixamorigHips') refHips = o.position.length(); });
  return { clips, refHips };
}

// ---------------------------------------------------------------------------
// characters
const ZONES = 3;   // tinted zones: 1 top, 2 bottom, 3 shoes (0 skin, 4 hair untouched)
function zoneLuminance(geo, map, out) {
  // mean linear luminance of each zone's texels, sampled at its vertices' UVs
  const img = map?.image;
  const zone = geo.attributes.zone, uv = geo.attributes.uv;
  if (!img || !zone || !uv) return;
  const W = 256, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  try { cx.drawImage(img, 0, 0, W, H); } catch { return; }
  const px = cx.getImageData(0, 0, W, H).data;
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const step = Math.max(1, Math.floor(zone.count / 6000));
  for (let i = 0; i < zone.count; i += step) {
    const z = Math.round(zone.getX(i) * 4);
    if (z < 1 || z > ZONES) continue;
    let u = uv.getX(i), v = uv.getY(i);
    u -= Math.floor(u); v -= Math.floor(v);
    const k = (Math.min(H - 1, Math.floor(v * H)) * W + Math.min(W - 1, Math.floor(u * W))) * 4;
    out[z - 1][0] += 0.2126 * lin(px[k]) + 0.7152 * lin(px[k + 1]) + 0.0722 * lin(px[k + 2]);
    out[z - 1][1]++;
  }
}

function prepChar(name, gltf, lib) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const L0 = [], L1 = [];
  const lum = Array.from({ length: ZONES }, () => [0, 0]);
  scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    let far = false;
    for (let p = o; p; p = p.parent) if (/_L1/.test(p.name)) far = true;
    (far ? L1 : L0).push(o);
    const g = o.geometry;
    if (g.attributes.color && !g.attributes.zone) { g.setAttribute('zone', g.attributes.color); g.deleteAttribute('color'); }
    const m = o.material;
    m.userData.hair = /hair|lash/i.test(m.name);
    if (!far) zoneLuminance(g, m.map, lum);
  });
  const avg = lum.map(([s, n]) => (n ? s / n : 0.2));
  // shadow caster: the far LOD merged to one geometry (one draw per person)
  const parts = L1.map((m) => {
    const g = new THREE.BufferGeometry();
    for (const a of ['position', 'skinIndex', 'skinWeight']) g.setAttribute(a, m.geometry.attributes[a]);
    g.setIndex(m.geometry.index);
    return g;
  });
  const shadowGeo = parts.length > 1 ? mergeGeometries(parts.map((g) => deinterleave(g))) : deinterleave(parts[0]);
  // hips: skeleton rest height (armature units) against the clip library's reference
  let hips = null;
  scene.traverse((o) => { if (o.isBone && o.name === 'mixamorigHips') hips = o; });
  const k = hips ? hips.position.length() / lib.refHips : 1;
  const wp = new THREE.Vector3();
  hips?.getWorldPosition(wp);
  const clips = new Map();
  for (const [n, c] of lib.clips) {
    const cc = c.clone();
    for (const t of cc.tracks) {
      if (t.name === 'mixamorigHips.position') { const v = t.values; for (let i = 0; i < v.length; i++) v[i] *= k; }
    }
    clips.set(n, cc);
  }
  let tris0 = 0, tris1 = 0;
  for (const m of L0) tris0 += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
  for (const m of L1) tris1 += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
  return { name, fem: CHARACTERS[name].fem, gltf, scene, avg, shadowGeo, clips, hipsY: wp.y, speeds: new Map(), tris0, tris1 };
}
function deinterleave(g) {
  const out = new THREE.BufferGeometry();
  for (const [n, a] of Object.entries(g.attributes)) {
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(i, c);
    out.setAttribute(n, new THREE.BufferAttribute(n === 'skinIndex' ? new Uint16Array(arr) : arr, a.itemSize));
  }
  if (g.index) out.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index.array), 1));
  return out;
}

// person material: the character's material with the clothing tint, per person
function personMaterial(src, avg, tints) {
  const m = src.clone();
  m.roughness = m.userData.hair ? 0.55 : 0.74;
  m.metalness = 0;
  m.vertexColors = false;   // (COLOR_0 is the clothing zone mask, not a colour)
  if (m.specularIntensity !== undefined) m.specularIntensity = 0.5;
  if (m.userData.hair) {
    m.alphaTest = 0.42;
    m.transparent = false;
    m.side = THREE.DoubleSide;
    m.alphaToCoverage = QUALITY.msaa > 0;
  }
  const U = {
    uTint: { value: [0, 1, 2].map((i) => new THREE.Vector4(...(tints?.[i] ?? [1, 1, 1, 0]))) },
    uAvg: { value: new THREE.Vector3(...avg) },
  };
  m.userData.tint = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 zone;\nvarying float vOdZone;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOdZone = zone.r * 4.0;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vOdZone;\nuniform vec4 uTint[3];\nuniform vec3 uAvg;')
      .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
        {
          int oz = int(vOdZone + 0.5);
          if (oz >= 1 && oz <= 3) {
            vec4 t = uTint[oz - 1];
            float avg = oz == 1 ? uAvg.x : oz == 2 ? uAvg.y : uAvg.z;
            float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            // keep the weave / folds (luminance against the zone's mean), swap the dye
            vec3 dyed = t.rgb * clamp(pow(l / max(avg, 0.02), 0.85), 0.0, 2.4);
            diffuseColor.rgb = mix(diffuseColor.rgb, dyed, t.a);
          }
        }`);
  };
  m.customProgramCacheKey = () => 'od-person-v1' + (m.userData.hair ? 'h' : '');
  return m;
}

// ---------------------------------------------------------------------------
// person instance
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
export function createPerson(asset, { tints = null, shadow = true } = {}) {
  const root = cloneSkinned(asset.scene);
  root.name = 'person-' + asset.name;
  const lod = [[], []];
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    let far = false;
    for (let p = o; p; p = p.parent) if (/_L1/.test(p.name)) far = true;
    o.material = personMaterial(o.material, asset.avg, tints);
    o.castShadow = false;
    o.receiveShadow = true;
    // (bounding sphere around the standing / seated body in the skin's bind space)
    o.frustumCulled = false;
    lod[far ? 1 : 0].push(o);
  });
  const bones = {}, rest = [];
  root.traverse((o) => { if (o.isBone) { bones[o.name.replace('mixamorig', '')] = o; rest.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]); } });
  const mixer = new THREE.AnimationMixer(root);
  let sh = null, per = null;
  if (shadow && lod[1][0]) {
    per = { uBaseY: { value: 0 }, uWallX: { value: HOTEL.frontX }, uTerraceY: { value: 0.6 }, uStrength: { value: 1.0 } };
    sh = new THREE.SkinnedMesh(asset.shadowGeo, shadowMaterial(per));
    // (skinned straight to world space: the far LOD's bind matrix carries the mesh's
    // dequantisation, no inverse after skinning, identity model matrix)
    sh.bindMode = THREE.DetachedBindMode;
    sh.bind(lod[1][0].skeleton, lod[1][0].bindMatrix.clone());
    sh.bindMatrixInverse.identity();
    sh.frustumCulled = false;
    sh.castShadow = false;
    sh.receiveShadow = true;
    sh.renderOrder = 2;
    sh.onBeforeRender = (renderer, _s, camera) => {
      SH_SHARED.uInvProj.value.copy(camera.projectionMatrixInverse);
      SH_SHARED.uProj.value.copy(camera.projectionMatrix);
      renderer.getCurrentViewport(SH_SHARED.uViewport.value);
      sh.material.uniformsNeedUpdate = true;
    };
  }
  const P = {
    asset, root, bones, mixer, lod, shadow: sh, per, actions: new Map(), level: -1, visible: true,
    // bones back to the glTF rest (bind) pose
    restPose() { for (const [o, p, q, sc] of rest) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(sc); } },
    action(name) {
      let a = this.actions.get(name);
      if (!a) {
        const clip = asset.clips.get(name);
        if (!clip) return null;
        a = mixer.clipAction(clip);
        this.actions.set(name, a);
      }
      return a;
    },
    setLevel(k) {
      if (k === this.level) return;
      this.level = k;
      for (const m of lod[0]) m.visible = k === 0;
      for (const m of lod[1]) m.visible = k === 1;
    },
    setVisible(v) {
      this.visible = v;
      root.visible = v;
      if (sh) sh.visible = v;
      // a hidden body leaves the graph: the renderer's matrix pass would still walk its ~65 bones
      if (!v && root.parent) { this.home = root.parent; root.removeFromParent(); }
      else if (v && !root.parent && this.home) this.home.add(root);
    },
    setTints(t) {
      for (const l of lod) for (const m of l) m.material.userData.tint.uTint.value.forEach((u, i) => u.set(...(t?.[i] ?? [1, 1, 1, 0])));
    },
    // foot speed of a locomotion clip at playback 1 (m/s), measured once per character
    speedOf(name) {
      if (!asset.speeds.has(name)) asset.speeds.set(name, measureSpeed(this, name));
      return asset.speeds.get(name);
    },
  };
  P.setLevel(0);
  return P;
}

// ground speed that keeps the planted foot still: toe travel backwards while it's lowest
function measureSpeed(P, name) {
  const a = P.action(name);
  if (!a) return 1.3;
  const saved = [...P.actions.values()].map((x) => [x, x.enabled, x.weight, x.isRunning()]);
  P.mixer.stopAllAction();
  a.reset().play();
  a.setEffectiveWeight(1);
  const r = P.root, pos0 = r.position.clone(), q0 = r.quaternion.clone();
  r.position.set(0, 0, 0); r.quaternion.identity();
  const L = P.bones.LeftToeBase, R = P.bones.RightToeBase;
  const D = a.getClip().duration, N = 90;
  let dist = 0, n = 0, prev = null;
  for (let i = 0; i <= N; i++) {
    a.time = (i / N) * D;
    P.mixer.update(0);
    r.updateMatrixWorld(true);
    const l = L.getWorldPosition(_v), rr = R.getWorldPosition(_v2);
    const foot = l.y < rr.y ? 'L' : 'R', z = foot === 'L' ? l.z : rr.z;
    if (prev && prev.foot === foot) { dist += prev.z - z; n++; }
    prev = { foot, z };
  }
  a.stop();
  for (const [x, en, w, run] of saved) { x.enabled = en; x.weight = w; if (run) x.play(); }
  r.position.copy(pos0); r.quaternion.copy(q0);
  return n ? Math.max(0.3, (dist / n) * N / D) : 1.3;
}

// ---------------------------------------------------------------------------
// IK
// rotate `bone` (in world terms) so the direction `from` points along `to`
function swing(bone, from, to) {
  if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return;
  _q.setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
  const wq = bone.getWorldQuaternion(new THREE.Quaternion());
  const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(pq.invert().multiply(_q.multiply(wq)));
  bone.updateMatrixWorld(true);
}
// Two-bone IK: end effector of up -> lo -> end to `target` (world), the middle joint towards
// `pole` (world direction). The upper bone is twisted so the lower joint's hinge (its current
// bend plane, or `hingeLocal` in the lower bone's frame) lies in the solved plane.
export function ik2(up, lo, end, target, pole, w = 1, hingeLocal = null) {
  if (w <= 0) return;
  const qa = up.quaternion.clone(), qb = lo.quaternion.clone();
  up.updateMatrixWorld(true);
  const S = up.getWorldPosition(new THREE.Vector3()), K = lo.getWorldPosition(new THREE.Vector3()), E = end.getWorldPosition(new THREE.Vector3());
  const a = S.distanceTo(K), b = K.distanceTo(E);
  const D = target.clone().sub(S);
  const d = THREE.MathUtils.clamp(D.length(), 1e-4, (a + b) * 0.999);
  D.normalize();
  const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
  const pp = pole.clone().addScaledVector(D, -pole.dot(D));
  if (pp.lengthSq() < 1e-8) pp.set(0, 0, 1);
  pp.normalize();
  const Kt = S.clone().addScaledVector(D, x).addScaledVector(pp, h);
  const T = S.clone().addScaledVector(D, d);
  // current hinge axis (world)
  const hinge = hingeLocal
    ? hingeLocal.clone().applyQuaternion(lo.getWorldQuaternion(new THREE.Quaternion()))
    : new THREE.Vector3().crossVectors(K.clone().sub(S), E.clone().sub(K));
  swing(up, K.clone().sub(S), Kt.clone().sub(S));
  // twist the upper bone about its axis: hinge into the plane's normal (the nearer sign)
  if (hinge.lengthSq() > 1e-10) {
    const u = Kt.clone().sub(S).normalize();
    const hw = hingeLocal ? hingeLocal.clone().applyQuaternion(lo.getWorldQuaternion(new THREE.Quaternion())) : hinge.normalize();
    const want = new THREE.Vector3().crossVectors(Kt.clone().sub(S), T.clone().sub(Kt));
    if (want.lengthSq() > 1e-10) {
      want.normalize();
      const pr = (v) => v.clone().addScaledVector(u, -v.dot(u));
      const h0 = pr(hw), w0 = pr(want);
      if (h0.dot(w0) < 0) w0.negate();
      if (h0.lengthSq() > 1e-8 && w0.lengthSq() > 1e-8) {
        h0.normalize(); w0.normalize();
        const ang = Math.atan2(new THREE.Vector3().crossVectors(h0, w0).dot(u), h0.dot(w0));
        const wq = up.getWorldQuaternion(new THREE.Quaternion());
        const pq = up.parent.getWorldQuaternion(new THREE.Quaternion());
        up.quaternion.copy(pq.invert().multiply(new THREE.Quaternion().setFromAxisAngle(u, ang).multiply(wq)));
        up.updateMatrixWorld(true);
      }
    }
  }
  const K2 = lo.getWorldPosition(new THREE.Vector3()), E2 = end.getWorldPosition(new THREE.Vector3());
  swing(lo, E2.sub(K2), T.clone().sub(K2));
  if (w < 1) {
    up.quaternion.copy(qa.slerp(up.quaternion, w));
    lo.quaternion.copy(qb.slerp(lo.quaternion, w));
    up.updateMatrixWorld(true);
  }
}
export function setWorldQuat(bone, q) {
  const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(pq.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

// ---------------------------------------------------------------------------
// roller skates on both feet (person-local, bind pose), raising the body by SKATE_LIFT
export const SKATE_LIFT = 0.078;
export function attachSkates(P, skateScene) {
  if (!skateScene) return [];
  const r = P.root, pos0 = r.position.clone(), q0 = r.quaternion.clone();
  // bones at their rest (bind) pose: the character stands at the origin facing +z
  P.mixer.stopAllAction();
  const rest = [];
  r.traverse((o) => { if (o.isBone) rest.push([o, o.position.clone(), o.quaternion.clone()]); });
  P.restPose();
  r.position.set(0, 0, 0); r.quaternion.identity();
  r.updateMatrixWorld(true);
  const out = [];
  for (const side of ['Left', 'Right']) {
    const foot = P.bones[side + 'Foot'], toe = P.bones[side + 'ToeBase'];
    const f = foot.getWorldPosition(new THREE.Vector3()), t = toe.getWorldPosition(new THREE.Vector3());
    const s = skateScene.clone(true);
    s.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.material = o.material.clone(); o.material.vertexColors = true; o.material.roughness = 0.5; } });
    // along the foot (ankle -> toe), heel ~7 cm behind the ankle, sole under the shoe
    const yaw = Math.atan2(t.x - f.x, t.z - f.z);
    const heel = new THREE.Vector3(f.x - Math.sin(yaw) * 0.075, -SKATE_LIFT + 0.004, f.z - Math.cos(yaw) * 0.075);
    // (the model's toe is its -z: Blender's +y)
    const world = new THREE.Matrix4().compose(heel, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI), new THREE.Vector3(1, 1, 1));
    const local = foot.matrixWorld.clone().invert().multiply(world);
    local.decompose(s.position, s.quaternion, s.scale);
    foot.add(s);
    out.push(s);
  }
  for (const [o, p, q] of rest) { o.position.copy(p); o.quaternion.copy(q); }
  r.position.copy(pos0); r.quaternion.copy(q0);
  r.updateMatrixWorld(true);
  return out;
}

// ---------------------------------------------------------------------------
// Skating stride, baked per character: crouched, leaning forward, alternate pushes out to
// the side and back (the pushing skate toes out), recovery under the body, hips shifting
// over the gliding skate, arms swinging across. Legs by IK from foot targets; the skates
// glide, so nothing has to stay planted. One cycle = a left and a right push.
export function bakeSkateClip(P, { period = 1.7 } = {}) {
  const B = P.bones, r = P.root;
  const base = P.action('idle_standing') ?? P.action('idle_breathing');
  P.mixer.stopAllAction();
  base.reset().play();
  base.time = 1.0;
  P.mixer.update(0);
  const pos0 = r.position.clone(), q0 = r.quaternion.clone();
  r.position.set(0, 0, 0); r.quaternion.identity();
  r.updateMatrixWorld(true);
  const all = [];
  r.traverse((o) => { if (o.isBone) all.push(o); });
  const pose0 = all.map((b) => [b.position.clone(), b.quaternion.clone()]);
  const hipsW0 = B.Hips.getWorldPosition(new THREE.Vector3());
  const s = hipsW0.y / 0.98;
  const qw = (b) => b.getWorldQuaternion(new THREE.Quaternion());
  const baseW = {};
  for (const n of ['Hips', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftFoot', 'RightFoot']) baseW[n] = qw(B[n]);
  const ankle0 = { Left: B.LeftFoot.getWorldPosition(new THREE.Vector3()), Right: B.RightFoot.getWorldPosition(new THREE.Vector3()) };
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const rot = (axis, a) => new THREE.Quaternion().setFromAxisAngle(axis, a);
  const smooth = (a, b, v) => { const t = THREE.MathUtils.clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const D2R = Math.PI / 180;
  const N = 40;
  const names = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftShoulder', 'RightShoulder'];
  const rec = Object.fromEntries(names.map((n) => [n, []]));
  const hipsPos = [];
  const times = [];
  // foot target for one leg at its phase q (0: under the body, gliding)
  const leg = (q, side) => {
    const sx = side === 'Left' ? 1 : -1;
    let x = 0.1, z = 0.06, y = 0, yaw = 7, lift = 0;
    if (q < 0.45) { const u = q / 0.45; x = 0.1; z = 0.12 - 0.14 * u; }                  // glide
    else if (q < 0.8) { const u = smooth(0.45, 0.8, q); x = 0.1 + 0.3 * u; z = -0.02 - 0.24 * u; yaw = 7 + 28 * u; }   // push
    else { const u = smooth(0.8, 1.0, q); x = 0.4 - 0.3 * u; z = -0.26 + 0.38 * u; lift = Math.sin(Math.PI * u); yaw = 35 - 28 * u; y = 0.1 * lift; }   // recover
    return { x: sx * x * s, z: z * s, y: y * s, yaw: sx * yaw * D2R, sx };
  };
  for (let f = 0; f <= N; f++) {
    const p = f / N;
    all.forEach((b, i) => { b.position.copy(pose0[i][0]); b.quaternion.copy(pose0[i][1]); });
    r.updateMatrixWorld(true);
    const qL = p, qR = (p + 0.5) % 1;
    const push = (q) => (q >= 0.45 && q < 0.8 ? Math.sin(Math.PI * (q - 0.45) / 0.35) : 0);
    // weight over the gliding skate: away from the pushing leg
    const shift = 0.07 * s * (push(qR) - push(qL));
    const bob = 0.012 * s * Math.cos(4 * Math.PI * p);
    B.Hips.position.copy(pose0[all.indexOf(B.Hips)][0]);
    r.updateMatrixWorld(true);
    // hips: lower and shifted (convert the world offset into the hips' parent frame)
    const wantHips = new THREE.Vector3(hipsW0.x + shift, hipsW0.y - 0.1 * s + bob, hipsW0.z - 0.03 * s);
    B.Hips.position.copy(B.Hips.parent.worldToLocal(wantHips));
    B.Hips.updateMatrixWorld(true);
    const yaw = 7 * D2R * (push(qL) - push(qR));
    setWorldQuat(B.Hips, rot(Y, yaw).multiply(rot(X, 16 * D2R)).multiply(baseW.Hips));
    setWorldQuat(B.Spine1, rot(Y, -yaw * 0.6).multiply(rot(X, 22 * D2R)).multiply(baseW.Spine1));
    setWorldQuat(B.Spine2, rot(Y, -yaw * 1.0).multiply(rot(X, 24 * D2R)).multiply(baseW.Spine2));
    setWorldQuat(B.Neck, rot(X, 6 * D2R).multiply(baseW.Neck));
    setWorldQuat(B.Head, rot(X, -4 * D2R).multiply(baseW.Head));
    // arms: swing across, opposite the pushing leg; the forearms a little bent
    for (const side of ['Left', 'Right']) {
      const sx = side === 'Left' ? 1 : -1;
      const own = side === 'Left' ? push(qL) : push(qR), other = side === 'Left' ? push(qR) : push(qL);
      // (a hanging bone swings forward for a negative angle about +x)
      const sw = (own - other) * 28 * D2R;
      const q = rot(X, sw - 12 * D2R).multiply(rot(Z, sx * 6 * D2R)).multiply(rot(Y, sx * (other - own) * 14 * D2R)).multiply(baseW[side + 'Arm']);
      setWorldQuat(B[side + 'Arm'], q);
      setWorldQuat(B[side + 'ForeArm'], rot(X, -(24 + 16 * other) * D2R).multiply(qw(B[side + 'ForeArm'])));
    }
    // legs
    for (const [side, q] of [['Left', qL], ['Right', qR]]) {
      const t = leg(q, side);
      const target = new THREE.Vector3(t.x, ankle0[side].y + t.y, ankle0[side].z + t.z);
      const pole = new THREE.Vector3(t.sx * 0.25, 0, 1);
      ik2(B[side + 'UpLeg'], B[side + 'Leg'], B[side + 'Foot'], target, pole);
      setWorldQuat(B[side + 'Foot'], rot(Y, t.yaw).multiply(rot(X, -0.1 * (t.y / (0.1 * s || 1)))).multiply(baseW[side + 'Foot']));
    }
    times.push(p * period);
    for (const n of names) rec[n].push(...B[n].quaternion.toArray());
    hipsPos.push(...B.Hips.position.toArray());
  }
  base.stop();
  all.forEach((b, i) => { b.position.copy(pose0[i][0]); b.quaternion.copy(pose0[i][1]); });
  r.position.copy(pos0); r.quaternion.copy(q0);
  r.updateMatrixWorld(true);
  const tracks = names.map((n) => new THREE.QuaternionKeyframeTrack(`mixamorig${n}.quaternion`, times, rec[n]));
  tracks.push(new THREE.VectorKeyframeTrack('mixamorigHips.position', times, hipsPos));
  return new THREE.AnimationClip('skate', period, tracks);
}
