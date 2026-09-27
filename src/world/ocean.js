// Water surface to the real horizon. A camera-centred polar grid (dense at the feet,
// rings growing geometrically to 25 km) carries Gerstner swell near the camera and the
// shore-break crests of the shared surf clock; the fragment shader adds sub-pixel chop,
// analytic sunrise-sky reflection with Fresnel, the sun-glitter path, depth-graded
// turquoise shallows over the sand, backlit wave faces, whitewater and sparse whitecaps.
import * as THREE from 'three';
import { SKY_FULL_GLSL, FOG_FN_GLSL } from '../sky.js';
import { SAND, SHORE_X, SEA_LEVEL, BREAK_X } from './layout.js';
import { SURF_GLSL } from './surf.js';
import { mulberry32 } from '../textures/noise.js';

function waveTable() {
  const rnd = mulberry32(4242);
  const waves = [];
  const lengths = [11, 7.3, 5.1, 3.6, 2.5, 1.75, 1.2, 0.85, 0.6, 0.42, 0.3, 0.21];
  lengths.forEach((L, i) => {
    // mostly travelling west toward the beach, short chop spreading wider; each band is
    // split over 2-3 crossing directions and slightly detuned lengths so no ripple train
    // lines up into regular bands
    const spread = 0.6 + i * 0.08;
    const n = i < 4 ? 2 : 3;
    for (let j = 0; j < n; j++) {
      const ang = Math.PI + (rnd() - 0.5) * 2 * spread; // PI = toward -x
      const Lj = L * (0.85 + 0.3 * rnd());
      const k = (2 * Math.PI) / Lj;
      const steep = (0.042 - i * 0.0018) * (0.75 + 0.5 * rnd()) / Math.sqrt(n * 0.6); // calm morning sea
      waves.push({ dx: Math.cos(ang), dz: Math.sin(ang), k, w: Math.sqrt(9.81 * k), s: steep, ph: rnd() * 6.283, L: Lj });
    }
  });
  return waves;
}

// long gentle swell, resolved as geometry near the camera
const SWELL = [
  { L: 17, a: 0.09, ang: Math.PI + 0.12, ph: 0.4 },
  { L: 11, a: 0.055, ang: Math.PI - 0.25, ph: 2.1 },
  { L: 7, a: 0.03, ang: Math.PI + 0.45, ph: 4.0 },
];

// beach profile in GLSL (mirror of layout.sandHeight on the beach)
const SAND_GLSL = /* glsl */ `
float odSandY(float x) {
  float x1 = ${(SAND.waterline - 4).toFixed(2)};
  if (x < x1) { float t = (x - ${SAND.x0.toFixed(2)}) / (x1 - ${SAND.x0.toFixed(2)}); return 0.55 - (0.55 - ${(SEA_LEVEL + 0.1).toFixed(3)}) * t; }
  float t = (x - x1) / 26.0;
  return ${(SEA_LEVEL + 0.1).toFixed(3)} - 1.6 * min(1.0, t) * min(1.0, t) - 0.2 * max(0.0, t - 1.0);
}`;

function swellGLSL() {
  return /* glsl */ `
  // Gerstner swell: displacement (xyz) and slope (d h / d x, d h / d z)
  vec3 odSwell(vec2 p, float t, float amp, out vec2 slope) {
    vec3 d = vec3(0.0); slope = vec2(0.0);
    ${SWELL.map((s) => {
      const k = (2 * Math.PI) / s.L, w = Math.sqrt(9.81 * k), dx = Math.cos(s.ang), dz = Math.sin(s.ang);
      return `{ float ph = dot(p, vec2(${dx.toFixed(4)}, ${dz.toFixed(4)})) * ${k.toFixed(4)} - t * ${w.toFixed(4)} + ${s.ph.toFixed(2)};
      float a = ${s.a.toFixed(3)} * amp;
      d += vec3(${dx.toFixed(4)} * -0.6 * a * sin(ph), a * cos(ph), ${dz.toFixed(4)} * -0.6 * a * sin(ph));
      slope += vec2(${dx.toFixed(4)}, ${dz.toFixed(4)}) * (-a * ${k.toFixed(4)} * sin(ph)); }`;
    }).join('\n    ')}
    return d;
  }`;
}

function polarGrid(rings = 240, segs = 320, r0 = 0.25, r1 = 25000) {
  const q = Math.pow(r1 / r0, 1 / (rings - 1));
  const pos = new Float32Array((rings * segs + 1) * 3);
  let o = 3; // vertex 0 = centre
  for (let i = 0; i < rings; i++) {
    const r = r0 * Math.pow(q, i);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos[o++] = Math.cos(a) * r; pos[o++] = 0; pos[o++] = Math.sin(a) * r;
    }
  }
  const idx = [];
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = 1 + i * segs + j, b = 1 + i * segs + ((j + 1) % segs);
      const c = a + segs, d = b + segs;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export function createOcean(scene, surf) {
  const waves = waveTable();
  const waveGLSL = waves.map((w) => `
    { float wg = smoothstep(fp * 2.0, fp * 6.0, ${w.L.toFixed(3)});
      float ph = dot(p, vec2(${w.dx.toFixed(4)}, ${w.dz.toFixed(4)})) * ${w.k.toFixed(4)} - t * ${w.w.toFixed(4)} + ${w.ph.toFixed(3)};
      s += vec2(${w.dx.toFixed(4)}, ${w.dz.toFixed(4)}) * (${w.s.toFixed(4)} * cos(ph) * wg * chopAmp);
      lost += (1.0 - wg) * ${(w.s * w.s * 0.5).toFixed(6)} * chopAmp; }`).join('');

  const material = new THREE.ShaderMaterial({
    name: 'Ocean',
    fog: true,
    transparent: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uCam: { value: new THREE.Vector2() } }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform float uTime;
      uniform vec2 uCam;
      varying vec3 vWorld;
      varying vec2 vBase;
      varying float vCrest;
      varying float vWhite;
      ${SURF_GLSL}
      ${swellGLSL()}
      void main() {
        vec2 p = position.xz + uCam;
        float r = length(position.xz);
        float shore = smoothstep(${(SHORE_X - 1.0).toFixed(2)}, ${(SHORE_X + 12.0).toFixed(2)}, p.x);
        float amp = shore * (1.0 - smoothstep(120.0, 500.0, r));
        vec2 sl;
        vec3 d = amp > 0.0 ? odSwell(p, uTime, amp, sl) : vec3(0.0);
        float white = 0.0;
        float crest = 0.0;
        if (r < 400.0 && p.x > ${(SHORE_X - 2.0).toFixed(2)} && p.x < ${(BREAK_X + 40.0).toFixed(2)})
          crest = surfCrest(p.x, p.y, uTime, white) * smoothstep(${(SHORE_X - 0.5).toFixed(2)}, ${(SHORE_X + 2.0).toFixed(2)}, p.x);
        vec3 wp = vec3(p.x + d.x, ${SEA_LEVEL.toFixed(3)} + d.y + crest, p.y + d.z);
        vWorld = wp;
        vBase = p;
        vCrest = crest;
        vWhite = white;
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      varying vec2 vBase;
      varying float vCrest;
      varying float vWhite;
      #ifdef USE_FOG
        varying vec3 vFogOffset;
        uniform float fogDensity;
      #endif
      ${SKY_FULL_GLSL}
      ${FOG_FN_GLSL}
      ${SURF_GLSL}
      ${SAND_GLSL}
      ${swellGLSL()}

      // foam lace: white bubble filaments around dark holes, drifting
      float odFoam(vec2 p, float t) {
        // domain-warped cells so the bubble holes are ragged, a fine bubble grain for close
        // views (faded out once it would alias), and foam gathered in patches with clear water
        vec2 w = vec2(odNoise(p * 1.1 + 2.3), odNoise(p * 1.1 + 7.9)) - 0.5;
        vec2 pw = p + w * 0.6;
        float a = sqrt(odWorley(pw * 3.0 + vec2(t * 0.15, 0.0)));
        float b = sqrt(odWorley(pw * 8.0 + w * 0.9 - vec2(0.0, t * 0.1) + 3.1));
        float fine = 1.0 - smoothstep(0.015, 0.04, fwidth(p.x) + fwidth(p.y));
        float c = fine > 0.0 ? sqrt(odWorley(p * 21.0 + w * 2.0 + 1.7)) : 0.0;
        float dens = odNoise(p * 0.6 + t * 0.05);
        float lace = smoothstep(0.7 - 0.08 * dens, 0.8, a) * 0.75 + smoothstep(0.68 - 0.08 * dens, 0.78, b) * 0.45
          + smoothstep(0.6, 0.8, c) * 0.25 * fine;
        float fPatch = smoothstep(0.35, 0.75, odNoise(pw * vec2(0.45, 0.2) + vec2(0.0, t * 0.03)));
        return clamp(lace * (0.2 + 0.8 * fPatch) + 0.18 * fPatch * smoothstep(0.55, 0.7, a), 0.0, 1.0);
      }

      void main() {
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        float fp = dist * 0.0018 / sqrt(max(abs(V.y), 0.02));
        vec2 p = vBase;
        float t = uTime;
        if (p.x < ${(SHORE_X - 1.5).toFixed(2)}) discard;

        float groundY = odSandY(p.x);
        float depth = vWorld.y - groundY;
        if (depth < -0.02) discard;
        float shore = smoothstep(${(SHORE_X - 1.0).toFixed(2)}, ${(SHORE_X + 12.0).toFixed(2)}, p.x);
        float chopAmp = mix(0.45, 1.0, smoothstep(0.0, 1.5, depth));

        // normal: swell (analytic) + crest (finite difference) + sub-pixel chop
        vec2 swSl;
        float swAmp = shore * (1.0 - smoothstep(120.0, 500.0, length(p - cameraPosition.xz)));
        if (swAmp > 0.0) odSwell(p, t, swAmp, swSl); else swSl = vec2(0.0);
        vec2 crSl = vec2(0.0);
        if (p.x < ${(BREAK_X + 40.0).toFixed(2)} && dist < 400.0) {
          float w1, w2;
          float e = max(0.15, fp);
          float hx = surfCrest(p.x + e, p.y, t, w1), hz = surfCrest(p.x, p.y + e, t, w2);
          crSl = vec2(hx - vCrest, hz - vCrest) / e;
        }
        vec2 s = vec2(0.0);
        float lost = 0.0;
        ${waveGLSL}
        s += swSl + crSl;
        vec3 n = normalize(vec3(-s.x, 1.0, -s.y));
        float nv = max(dot(n, V), 0.002);

        float sig = sqrt(lost + 0.0004);
        vec3 R = reflect(-V, n);
        float gz = 1.0 - smoothstep(0.02, 0.35, V.y);
        vec3 Ra = vec3(R.x, abs(R.y) + (1.2 + 1.6 * gz) * sig + 0.004, R.z);
        vec3 Rb = vec3(R.x, abs(R.y) + (2.2 + 2.8 * gz) * sig + 0.004, R.z);
        vec3 sky = 0.5 * (odSky(normalize(Ra), 2.0) + odSky(normalize(Rb), 2.0));
        float F = 0.02 + 0.98 * pow(1.0 - clamp(nv + (1.0 + 1.2 * gz) * sig, 0.0, 1.0), 5.0);

        // water body: turquoise over the pale sand shallows, steel-blue offshore
        // body: a hint of turquoise only in the very shallow water, silver-blue beyond
        vec3 turq = vec3(0.042, 0.058, 0.056);
        vec3 deep = vec3(0.016, 0.024, 0.034);
        vec3 body = mix(turq, deep, smoothstep(0.15, 1.2, depth));
        vec3 col = body * (1.0 - F) + sky * F;

        // backlit wave faces: sun through the thin crest, green-turquoise
        float toSun = max(dot(-V, OD_SUN), 0.0);
        float face = clamp(dot(normalize(n.xz + 1e-5), normalize(V.xz + 1e-5)), 0.0, 1.0) * length(n.xz) * 3.0;
        float thick = clamp(vCrest / 0.35, 0.0, 1.0);
        // grey-silver / gold through the crest, only the thinnest lip a faint green
        vec3 thru = mix(vec3(0.34, 0.33, 0.29), vec3(0.24, 0.36, 0.30), smoothstep(0.6, 0.15, thick));
        col += OD_SUNCOL * OD_SUN_I * thru * 0.03 * thick * clamp(face, 0.0, 1.0) * (0.25 + toSun * toSun);

        // sun glitter: Beckmann lobe, roughness = sub-pixel wave slopes
        vec3 L = OD_SUN;
        vec3 H = normalize(L + V);
        float nh = max(dot(n, H), 1e-4);
        // wide glitter field far out (unresolved chop tilts facets toward the sun)
        float m2 = 2.0 * (0.0034 + 0.6 * lost + 0.003 * pow(1.0 - nv, 8.0) + 0.009 * smoothstep(10.0, 500.0, dist));
        float nh2 = nh * nh;
        float D = min(exp(-(1.0 - nh2) / (nh2 * m2)) / (3.14159 * m2 * nh2 * nh2), 3000.0);
        float Fh = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
        vec3 spec = OD_SUNCOL * OD_SUN_I * D * Fh / (4.0 * nv) * smoothstep(-0.06, 0.06, dot(n, L));
        spec *= vec3(1.0, 0.74, 0.38);
        float gl = odNoise(p / max(fp * 1.6, 0.02) * vec2(1.0, 0.35) + vec2(t * 1.7, -t * 0.6));
        float gw = smoothstep(0.0, 0.0012, lost);
        // always broken into sparkles: resolved facets near by, twinkling glints far out
        float gl2 = odNoise(p * 31.0 + vec2(t * 2.3, t * 0.7)) * odNoise(p * 73.0 - vec2(t * 1.1, 0.0));
        spec *= mix(smoothstep(0.3, 0.55, gl2) * 6.0, smoothstep(0.6, 0.9, gl) * 5.5, gw);
        float sl = dot(spec, vec3(0.2126, 0.7152, 0.0722));
        spec /= 1.0 + sl / mix(1.8, 4.0, gw);

        // ---- foam ----
        float foamAmt = 0.0;
        float lace = fp < 0.25 ? odFoam(p, t) : 0.35;
        // whitewater bore running in ahead of the swash, and dissolving patches behind
        vec3 fr = surfFront(p.y, t);
        if (fr.x < 1e3) {
          float behind = p.x - fr.x;
          float roller = fr.y * exp(-max(behind, 0.0) / 0.35) * step(-0.05, behind);
          float bore = fr.y * exp(-max(behind, 0.0) / (0.8 + 1.0 * fr.z)) * step(-0.05, behind);
          foamAmt = max(foamAmt, max(roller * 0.95, bore * lace));
          foamAmt = max(foamAmt, 0.5 * (1.0 - fr.y) * lace * step(0.0, behind) * exp(-behind / 4.0));
        }
        // lingering foam streaks over the surf zone
        float zone = smoothstep(${(SHORE_X - 0.5).toFixed(2)}, ${(SHORE_X + 1.0).toFixed(2)}, p.x) * (1.0 - smoothstep(${(BREAK_X + 2.0).toFixed(2)}, ${(BREAK_X + 9.0).toFixed(2)}, p.x));
        vec2 sw = p * 0.32 + vec2(odNoise(p * 0.21 + 4.0), odNoise(p * 0.21 + 9.0)) * 2.4;
        float streak = smoothstep(0.55, 0.8, odNoise(sw + vec2(0.0, t * 0.03)));
        foamAmt = max(foamAmt, zone * streak * lace * 0.55);
        // crest lip / roller whitewater
        foamAmt = max(foamAmt, vWhite * mix(0.7, 1.0, lace));
        // thin intersection line where the water meets the sand
        foamAmt = max(foamAmt, (1.0 - smoothstep(0.0, 0.04, depth)) * lace * 0.8);
        // sparse whitecaps far out
        float far = smoothstep(${(SHORE_X + 60.0).toFixed(1)}, ${(SHORE_X + 120.0).toFixed(1)}, p.x);
        float cap = smoothstep(0.86, 0.93, odNoise(p * 0.045 + vec2(t * 0.02, 0.0))) * smoothstep(0.5, 0.75, odNoise(p * 0.5 - t * 0.1));
        foamAmt = max(foamAmt, far * cap * 0.8 * (1.0 - smoothstep(200.0, 1500.0, dist)));

        // lit foam: sun on bubbly (all-facing) foam + sky fill; very shallow sun, so modest
        vec3 skyUp = odSky(vec3(0.0, 1.0, 0.0), 2.0);
        // white foam (albedo ~0.8): its light is taken as luminance so it stays cream-white
        float foamL = dot(OD_SUNCOL * OD_SUN_I * 0.318 * (0.3 + 0.35 * toSun) + skyUp * 1.1, vec3(0.2126, 0.7152, 0.0722));
        vec3 foamCol = vec3(1.0, 0.97, 0.92) * 0.85 * foamL * 1.6;
        col = mix(col, foamCol, foamAmt);
        spec *= 1.0 - foamAmt;

        // shallow water is clear: the wet sand shows through the last few centimetres
        float alpha = smoothstep(-0.02, 0.03, depth) * mix(0.38, 1.0, smoothstep(0.05, 0.9, depth));
        alpha = mix(alpha, 1.0, F);
        alpha = max(alpha, foamAmt * smoothstep(-0.02, 0.02, depth));
        col += spec;

        // warm marine haze toward the horizon: the far sea melts into the glowing sky
        vec3 hzd = normalize(vec3(-V.x, 0.012, -V.z));
        vec3 hzc = odSky(hzd, 2.0) * vec3(1.0, 0.94, 0.86);
        col = mix(col, hzc, smoothstep(700.0, 9000.0, dist) * 0.85);
        #ifdef USE_FOG
          col = odApplyFog(col, vFogOffset, fogDensity * 0.18);
        #endif
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  Object.assign(material.uniforms, surf.uniforms);

  const mesh = new THREE.Mesh(polarGrid(), material);
  mesh.name = 'ocean';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  scene.add(mesh);

  return {
    mesh,
    update(time, camera) {
      material.uniforms.uTime.value = time;
      if (camera) material.uniforms.uCam.value.set(camera.position.x, camera.position.z);
    },
  };
}
