// Wheel spray, sand roost, grass clumps, sparks and tyre smoke: one instanced draw of soft
// camera-facing sprites stretched along their motion (a droplet flung off a tyre reads as a
// short streak, a spark as a hot line), with a gaussian falloff and no hard edge. Water
// droplets are tinted by the low sun and come with fine mist puffs that grow and fade fast.
// Plus the foam wake on the water round each wheel in the surf (createWake).
import * as THREE from 'three';
import { QUALITY } from '../quality.js';

export const P_WATER = 0, P_SAND = 1, P_SPARK = 2, P_GRASS = 3, P_SMOKE = 4, P_MIST = 5;
const LOW = QUALITY.tier === 'low';
// (the sparks are hot: over 1 in the linear target, so the bloom catches them where it runs;
// the water takes the warm low sun on one side and the sky on the other)
const COL = [[0.95, 0.85, 0.72], [0.6, 0.5, 0.38], LOW ? [1.6, 0.95, 0.45] : [6, 2.6, 0.7], [0.2, 0.22, 0.09], [0.62, 0.6, 0.57], [0.98, 0.9, 0.82]];
// per type: [life min, life spread, alpha, size min, size spread, gravity, growth, drag, stretch]
const TYPE = [
  [0.3, 0.28, 0.55, 0.02, 0.026, 0.95, 0.6, 1.4, 0.8],   // water droplets
  [0.5, 0.4, 0.55, 0.02, 0.03, 1, 1.0, 1.2, 0.6],        // sand
  [0.18, 0.3, 1, 0.006, 0.005, 1, -0.5, 0.6, 1.6],       // sparks
  [0.5, 0.4, 0.8, 0.018, 0.028, 1, 0.8, 1.2, 0.5],       // grass
  [0.9, 0.8, 0.22, 0.18, 0.12, -0.05, 3, 2.2, 0],        // smoke
  [0.35, 0.35, 0.16, 0.18, 0.16, 0.08, 3.2, 3.2, 0.15],  // mist
];

export function createSpray(scene) {
  const N = QUALITY.tier === 'high' ? 360 : QUALITY.tier === 'medium' ? 220 : 90;
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), col = new Float32Array(N * 3), al = new Float32Array(N), sz = new Float32Array(N * 2);
  const P = Array.from({ length: N }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, a: 0, s: 0, g: 1, grow: 1, drag: 1, k: 1 }));
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const inst = (arr, n) => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iPos', inst(pos, 3));
  g.setAttribute('iVel', inst(vel, 3));
  g.setAttribute('iCol', inst(col, 3));
  g.setAttribute('iA', inst(al, 1));
  g.setAttribute('iS', inst(sz, 2));
  g.instanceCount = N;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec3 iPos; attribute vec3 iVel; attribute vec3 iCol; attribute float iA; attribute vec2 iS;
      varying vec3 vCol; varying float vA; varying vec2 vUv;
      void main() {
        vCol = iCol; vA = iA; vUv = position.xy;
        if (iA < 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
        // stretched along the on-screen motion (about 1/40 s of it), never shorter than wide
        vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
        vec2 d = vv.xy + vv.z * mv.xy / max(-mv.z, 0.1);
        float ls = length(d);
        vec2 ax = ls > 1e-4 ? d / ls : vec2(1.0, 0.0);
        float len = iS.x + ls * 0.025 * iS.y;
        mv.xy += ax * position.x * len + vec2(-ax.y, ax.x) * position.y * iS.x;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol; varying float vA; varying vec2 vUv;
      void main() {
        float r2 = dot(vUv, vUv);
        float a = vA * exp(-3.2 * r2) * (1.0 - smoothstep(0.7, 1.0, r2));
        if (a < 0.004) discard;
        gl_FragColor = vec4(vCol, a);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.name = 'spray';
  scene.add(mesh);
  let head = 0, live = 0;
  return {
    mesh,
    get alive() { let n = 0; for (let i = 0; i < N; i++) if (al[i] > 0.001) n++; return n; },
    emit(x, y, z, vx, vy, vz, type = P_WATER) {
      const i = head; head = (head + 1) % N;
      const p = P[i], T = TYPE[type];
      p.life = 0;
      p.max = T[0] + Math.random() * T[1];
      p.a = T[2]; p.s = T[3] + Math.random() * T[4]; p.g = T[5]; p.grow = T[6]; p.drag = T[7]; p.k = T[8];
      p.vx = vx; p.vy = vy; p.vz = vz;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      // (a little variation in the tint: some droplets catch more of the sun)
      const c = COL[type], w = type === P_WATER || type === P_MIST ? 0.9 + Math.random() * 0.15 : 1;
      col[i * 3] = c[0] * w; col[i * 3 + 1] = c[1] * w; col[i * 3 + 2] = c[2] * (type === P_WATER ? 0.95 + Math.random() * 0.1 : w);
      live = N;
    },
    update(dt) {
      if (!live) return;
      let any = false;
      for (let i = 0; i < N; i++) {
        const p = P[i];
        if (p.life >= p.max) { al[i] = 0; continue; }
        any = true;
        p.life += dt;
        p.vy -= 9.8 * p.g * dt;
        const d = Math.exp(-dt * p.drag);
        p.vx *= d; p.vz *= d;
        pos[i * 3] += p.vx * dt; pos[i * 3 + 1] += p.vy * dt; pos[i * 3 + 2] += p.vz * dt;
        vel[i * 3] = p.vx; vel[i * 3 + 1] = p.vy; vel[i * 3 + 2] = p.vz;
        const f = p.life / p.max;
        // (fades in over a few frames, out along its life: droplets and mist go fast at the end)
        al[i] = p.a * (1 - f * f) * Math.min(1, p.life * 25);
        sz[i * 2] = Math.max(0.003, p.s * (1 + f * p.grow));
        sz[i * 2 + 1] = p.k;
      }
      if (!any) live = 0;
      for (const k of ['iPos', 'iVel', 'iCol', 'iA', 'iS']) g.attributes[k].needsUpdate = true;
    },
  };
}

// Foam on the water round the wheels of the ridden vehicle in the surf: a flat quad per
// wheel on the water surface, a broken ring of foam round the tyre that trails back into a
// short wake with speed (procedural noise, scrolling with the water).
export function createWake(scene, maxWheels = 4) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  const pos = new Float32Array(maxWheels * 4), dir = new Float32Array(maxWheels * 4);
  const iPos = new THREE.InstancedBufferAttribute(pos, 4).setUsage(THREE.DynamicDrawUsage);   // x, y, z, strength
  const iDir = new THREE.InstancedBufferAttribute(dir, 4).setUsage(THREE.DynamicDrawUsage);   // fwd x, fwd z, radius, trail
  g.setAttribute('iPos', iPos);
  g.setAttribute('iDir', iDir);
  g.instanceCount = maxWheels;
  const uTime = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
    uniforms: { uTime },
    vertexShader: /* glsl */ `
      attribute vec4 iPos; attribute vec4 iDir;
      varying vec2 vL; varying vec2 vQ; varying float vS; varying float vTrail; varying float vR;
      void main() {
        vS = iPos.w; vTrail = iDir.w; vQ = position.xz;
        if (iPos.w < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec2 f = normalize(iDir.xy), r = vec2(-f.y, f.x);
        float R = iDir.z, back = R + iDir.w;
        // local frame: x across the wheel, y along the travel (+ ahead); the quad reaches back
        // along the wake
        vec2 l = vec2(position.x * (R + 0.25 * iDir.w), mix(-back, R, position.z * 0.5 + 0.5));
        vL = l / R; vR = R;
        vec2 w = iPos.xz + r * l.x + f * l.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(w.x, iPos.y, w.y, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vL; varying vec2 vQ; varying float vS; varying float vTrail; varying float vR;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float d = length(vL);
        // a thin broken ring round the tyre, a little further out ahead where the bow wave
        // piles up, and two lines spreading back from its sides with speed
        float ring = exp(-pow((d - 0.7 - 0.1 * max(vL.y, 0.0)) * 7.0, 2.0));
        float t = clamp(-vL.y / max(1.0 + vTrail, 1.0), 0.0, 1.0);
        float lines = vL.y < 0.0 ? exp(-pow((abs(vL.x) - 0.6 - t * 0.8) * 6.0, 2.0)) * (1.0 - t) * smoothstep(0.0, 0.5, vTrail) : 0.0;
        float foam = max(ring, lines * 0.75);
        // lacy: noise in the wheel's frame (metres), drifting back along the wake
        vec2 p = vL * vR + vec2(0.0, uTime * (0.3 + vTrail * 0.4));
        float k = n(p * 9.0) * 0.6 + n(p * 23.0 + 4.1) * 0.4;
        float edge = 1.0 - smoothstep(0.75, 1.0, max(abs(vQ.x), abs(vQ.y)));
        float a = vS * foam * edge * smoothstep(0.42, 0.78, k);
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(0.96, 0.93, 0.87), min(0.5, a * 0.8));
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.name = 'wheel-wake';
  scene.add(mesh);
  const str = new Float32Array(maxWheels);
  return {
    mesh,
    strength: str,
    // wheels: [{ x, y (water surface), z, depth, fx, fz (travel), speed, R }], dt
    update(wheels, dt, time) {
      uTime.value = time;
      for (let i = 0; i < maxWheels; i++) {
        const w = wheels?.[i];
        const want = w && w.depth > 0.03 ? Math.min(1, (w.depth - 0.03) / 0.08) * (0.35 + 0.65 * Math.min(1, w.speed / 3)) : 0;
        str[i] += (want - str[i]) * (1 - Math.exp(-dt * (want > str[i] ? 6 : 2.5)));
        pos[i * 4 + 3] = str[i] > 0.01 ? str[i] : 0;
        if (!w) continue;
        // (a little over the modelled level: the drawn swell rides a few cm above it)
        pos[i * 4] = w.x; pos[i * 4 + 1] = w.y + 0.05; pos[i * 4 + 2] = w.z;
        // (the ring ~0.2 m out from the tyre's sides, so it shows past the body)
        dir[i * 4] = w.fx; dir[i * 4 + 1] = w.fz; dir[i * 4 + 2] = w.R * 2.1; dir[i * 4 + 3] = Math.min(2.6, w.speed * 0.32);
      }
      iPos.needsUpdate = iDir.needsUpdate = true;
    },
  };
}
