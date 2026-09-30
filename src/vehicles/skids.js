// Skid marks: one Mesh holding a ring buffer of quads (one draw call). Each tyre that is
// sliding lays a strip of short segments along its path: dark rubber on the road, torn
// darker turf on the lawn, churned ruts in the sand. Marks fade out over FADE seconds in
// the shader (a birth time per vertex), so a frame only uploads the segments it added.
import * as THREE from 'three';
import { QUALITY } from '../quality.js';

const SEGMENTS = { high: 2000, medium: 800, low: 300 }[QUALITY.tier] ?? 800;
const FADE = 60;
const STEP = 0.05;            // m of height change between points that breaks a strip (a curb)
// colour (linear), opacity, tyre half width and m between strip points per surface: soft
// grey-brown rubber on the asphalt, ruts pressed into the sand, flattened grass; nothing on
// the sidewalk, the promenade or the ramp (the strip breaks there)
const LOOK = {
  pavement: [0.03, 0.026, 0.022, 0.35, 0.1, 0.22],
  grass: [0.05, 0.062, 0.022, 0.42, 0.12, 0.4],
  sand: [0.2, 0.155, 0.105, 0.5, 0.13, 0.4],
  wetsand: [0.12, 0.095, 0.065, 0.5, 0.12, 0.4],
  curbside: null,
  water: null,
};
// patchy rubber: a slow two-octave variation along the ground (0.45..1)
const patch = (x, z) => 0.725 + 0.275 * Math.sin(x * 1.9 + z * 0.7) * Math.sin(x * 0.53 - z * 2.3 + 1.7);

export function createSkids(scene) {
  const N = SEGMENTS;
  const pos = new Float32Array(N * 4 * 3), col = new Float32Array(N * 4 * 4), born = new Float32Array(N * 4);
  born.fill(-1e6);
  const idx = new Uint32Array(N * 6);
  for (let i = 0; i < N; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
  const g = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
  const aBorn = new THREE.BufferAttribute(born, 1).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', aPos);
  g.setAttribute('aCol', aCol);
  g.setAttribute('aBorn', aBorn);
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const uTime = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    uniforms: { uTime, uFade: { value: FADE } },
    vertexShader: /* glsl */ `
      attribute vec4 aCol; attribute float aBorn;
      uniform float uTime, uFade;
      varying vec4 vCol; varying float vEdge;
      void main() {
        float age = uTime - aBorn;
        vCol = vec4(aCol.rgb, aCol.a * clamp(1.0 - age / uFade, 0.0, 1.0) * clamp(age * 8.0 + 0.4, 0.0, 1.0));
        vEdge = float(gl_VertexID % 2) * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec4 vCol; varying float vEdge;
      void main() {
        // soft tyre edges
        float a = vCol.a * (1.0 - smoothstep(0.55, 1.0, abs(vEdge)));
        if (a < 0.004) discard;
        gl_FragColor = vec4(vCol.rgb * a, a);
      }`,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.name = 'skid-marks';
  scene.add(mesh);

  let head = 0, lo = Infinity, hi = -1, count = 0;
  const tracks = new Map();   // key -> { x, z, y, rx, rz }
  function add(a, b, surf, k) {
    const look = LOOK[surf] ?? LOOK.pavement;
    if (!look) return;
    const i = head;
    head = (head + 1) % N;
    count = Math.min(N, count + 1);
    const put = (j, x, y, z) => pos.set([x, y, z], (i * 4 + j) * 3);
    const hw = look[4];
    put(0, a.x - a.rx * hw, a.y, a.z - a.rz * hw);
    put(1, a.x + a.rx * hw, a.y, a.z + a.rz * hw);
    put(2, b.x - b.rx * hw, b.y, b.z - b.rz * hw);
    put(3, b.x + b.rx * hw, b.y, b.z + b.rz * hw);
    const al = look[3] * Math.min(1, 0.35 + k), rubber = surf === 'pavement';
    for (let j = 0; j < 4; j++) {
      const p = j < 2 ? a : b;
      col.set([look[0], look[1], look[2], al * (rubber ? patch(p.x, p.z) : 1)], (i * 4 + j) * 4);
      born[i * 4 + j] = uTime.value;
    }
    lo = Math.min(lo, i); hi = Math.max(hi, i);
  }
  return {
    mesh,
    get count() { return count; },
    // the centre of the last n segments laid (for tests / shots)
    recent(n = 40) {
      const m = Math.min(n, count), c = { x: 0, z: 0, n: m };
      for (let k = 1; k <= m; k++) { const i = (head - k + N) % N; c.x += pos[i * 12] / m; c.z += pos[i * 12 + 2] / m; }
      return c;
    },
    // one tyre's contact this frame: key (vehicle + wheel), ground point, the car's right
    // vector, skid strength 0..1 (0 ends the strip), surface kind
    mark(key, x, y, z, rx, rz, k, surf) {
      let t = tracks.get(key);
      const look = LOOK[surf];
      if (!(k > 0.05) || !look) { if (t) tracks.delete(key); return; }
      const p = { x, y: y + 0.012, z, rx, rz, surf };
      if (!t) { tracks.set(key, p); return; }
      const d = Math.hypot(x - t.x, z - t.z);
      if (d < look[5]) return;
      // a jump (recovery, a new car), a curb step or another surface: restart
      if (d > 2.5 || Math.abs(p.y - t.y) > STEP || t.surf !== surf) { tracks.set(key, p); return; }
      add(t, p, surf, k);
      tracks.set(key, p);
    },
    update(time) {
      uTime.value = time;
      if (hi < 0) return;
      // (ranges pile up until the next upload, which clears them: several steps can run
      // between two frames)
      for (const [a, n] of [[aPos, 12], [aCol, 16], [aBorn, 4]]) {
        a.addUpdateRange(lo * n, (hi - lo + 1) * n);
        a.needsUpdate = true;
      }
      lo = Infinity; hi = -1;
    },
  };
}
