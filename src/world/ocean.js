// Water surface to the real horizon: analytic sky reflection (same model as the
// sky dome), Fresnel, dark steel-blue body with a subtle shallow turquoise, and a
// sun-glitter column from a microfacet lobe whose roughness grows with pixel
// footprint (sparkles close by, a continuous gold column toward the horizon).
// The dedicated ocean system will add real swell geometry and swash.
import * as THREE from 'three';
import { SKY_FULL_GLSL, FOG_FN_GLSL } from '../sky.js';
import { OCEAN, SAND, SHORE_X } from './layout.js';
import { mulberry32 } from '../textures/noise.js';

function waveTable() {
  const rnd = mulberry32(4242);
  const waves = [];
  const lengths = [11, 7.3, 5.1, 3.6, 2.5, 1.75, 1.2, 0.85, 0.6, 0.42, 0.3, 0.21];
  lengths.forEach((L, i) => {
    // mostly travelling west toward the beach, short chop spreading wider
    const spread = 0.45 + i * 0.07;
    const ang = Math.PI + (rnd() - 0.5) * 2 * spread; // PI = toward -x
    const k = (2 * Math.PI) / L;
    const steep = 0.042 - i * 0.0018; // calm morning sea
    waves.push({ dx: Math.cos(ang), dz: Math.sin(ang), k, w: Math.sqrt(9.81 * k), s: steep, ph: rnd() * 6.283, L });
  });
  return waves;
}


export function createOcean(scene) {
  const waves = waveTable();
  const waveGLSL = waves.map((w) => `
    { float wg = smoothstep(fp * 2.0, fp * 6.0, ${w.L.toFixed(3)});
      float ph = dot(p, vec2(${w.dx.toFixed(4)}, ${w.dz.toFixed(4)})) * ${w.k.toFixed(4)} - t * ${w.w.toFixed(4)} + ${w.ph.toFixed(3)};
      s += vec2(${w.dx.toFixed(4)}, ${w.dz.toFixed(4)}) * (${w.s.toFixed(4)} * cos(ph) * wg);
      lost += (1.0 - wg) * ${(w.s * w.s * 0.5).toFixed(6)}; }`).join('');

  const material = new THREE.ShaderMaterial({
    name: 'Ocean',
    fog: true,
    transparent: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      #ifdef USE_FOG
        varying vec3 vFogOffset;
        uniform float fogDensity;
      #endif
      ${SKY_FULL_GLSL}
      ${FOG_FN_GLSL}

      void main() {
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        // pixel footprint (m); geometric mean of across/along-view size keeps sparkle detail
        float fp = dist * 0.0018 / sqrt(max(abs(V.y), 0.02));
        vec2 p = vWorld.xz;
        float t = uTime;
        vec2 s = vec2(0.0);
        float lost = 0.0;
        ${waveGLSL}
        vec3 n = normalize(vec3(-s.x, 1.0, -s.y));
        float nv = max(dot(n, V), 0.002);

        // Sub-pixel waves: at grazing view the visible facets are the ones tilted toward
        // the viewer (slope-weighted, back faces hidden), so the averaged reflection comes
        // from sky ~2 sigma higher - bluer and darker - with less Fresnel. Two slope samples
        // of that distribution instead of one mean direction.
        float sig = sqrt(lost + 0.0004);
        vec3 R = reflect(-V, n);
        float gz = 1.0 - smoothstep(0.02, 0.35, V.y);           // only matters near grazing
        vec3 Ra = vec3(R.x, abs(R.y) + (1.2 + 1.6 * gz) * sig + 0.004, R.z);
        vec3 Rb = vec3(R.x, abs(R.y) + (2.2 + 2.8 * gz) * sig + 0.004, R.z);
        vec3 sky = 0.5 * (odSky(normalize(Ra), 2.0) + odSky(normalize(Rb), 2.0));
        float F = 0.02 + 0.98 * pow(1.0 - clamp(nv + (1.0 + 1.2 * gz) * sig, 0.0, 1.0), 5.0);

        float shallow = 1.0 - smoothstep(${(SAND.waterline + 2).toFixed(1)}, ${(SAND.waterline + 45).toFixed(1)}, vWorld.x);
        vec3 body = mix(vec3(0.012, 0.020, 0.030), vec3(0.030, 0.055, 0.055), shallow);
        vec3 col = body * (1.0 - F) + sky * F;

        // sun glitter: Beckmann lobe, roughness = sub-pixel wave slopes
        vec3 L = OD_SUN;
        vec3 H = normalize(L + V);
        float nh = max(dot(n, H), 1e-4);
        float m2 = 2.0 * (0.0003 + 0.22 * lost + 0.003 * pow(1.0 - nv, 8.0));  // narrow path; the rest is resolved/twinkling facets
        float nh2 = nh * nh;
        float D = min(exp(-(1.0 - nh2) / (nh2 * m2)) / (3.14159 * m2 * nh2 * nh2), 3000.0);
        float Fh = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
        vec3 spec = OD_SUNCOL * OD_SUN_I * D * Fh / (4.0 * nv) * smoothstep(-0.06, 0.06, dot(n, L));
        spec *= vec3(1.0, 0.74, 0.38);           // glints read gold after tone mapping
        float sl = dot(spec, vec3(0.2126, 0.7152, 0.0722));
        // unresolved facets: the streak breaks into many tiny twinkling glints
        float gl = odNoise(p / max(fp * 1.6, 0.02) * vec2(1.0, 0.35) + vec2(t * 1.7, -t * 0.6));
        float gw = smoothstep(0.0, 0.0012, lost);
        spec *= mix(1.0, smoothstep(0.58, 0.9, gl) * 5.0, gw);
        sl = dot(spec, vec3(0.2126, 0.7152, 0.0722));
        spec /= 1.0 + sl / mix(1.8, 4.0, gw);    // soft shoulder: gold, graded, never a flat white slab
        float alpha = smoothstep(${SHORE_X.toFixed(2)}, ${(SHORE_X + 1.5).toFixed(2)}, vWorld.x);
        col += spec * alpha;

        #ifdef USE_FOG
          col = odApplyFog(col, vFogOffset, fogDensity * 0.18);  // clean marine air over the water
        #endif
        // very shallow edge fades into the sand instead of a hard line
        gl_FragColor = vec4(col, alpha);
      }`,
  });

  const g = new THREE.PlaneGeometry(22000, 44000);
  g.rotateX(-Math.PI / 2);
  g.translate(OCEAN.x0 + 11000, OCEAN.y, 0);
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'ocean';
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    mesh,
    update(time) { material.uniforms.uTime.value = time; },
  };
}
