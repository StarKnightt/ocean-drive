// Sunrise sky, sun light, image-based skylight and aerial perspective.
// One analytic sky model (odSky*) is shared by the sky dome, the PMREM
// environment, the water reflection and the fog chunk, so distant geometry
// always dissolves into exactly the sky colour behind it.
import * as THREE from 'three';
import { SUN, compassToDir } from './world/layout.js';

export const sunDir = compassToDir(SUN.azimuthDeg, SUN.elevationDeg, new THREE.Vector3());

// Linear-light values. ~15 minutes after sunrise (7 deg): ~2700-2900 K orange direct
// light, dim and cool skylight (the sky itself is only a fraction as bright).
export const SUN_COLOR = new THREE.Color().setRGB(1.0, 0.37, 0.105, THREE.LinearSRGBColorSpace);
export const SUN_INTENSITY = 7.0;
export const ENV_INTENSITY = 1.0;
export const FOG_DENSITY = 1 / 200; // per metre at sea level

const v3 = (v) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;
const c3 = (c) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

// Base sky radiance (no clouds, no sun disc). Below the horizon it returns the horizon colour.
export const SKY_BASE_GLSL = /* glsl */ `
const vec3 OD_SUN = ${v3(sunDir)};
const vec3 OD_SUNCOL = ${c3(SUN_COLOR)};
const float OD_SUN_I = ${SUN_INTENSITY.toFixed(3)};

float odSunSide(vec3 d) {
  vec2 hd = d.xz / max(length(d.xz), 1e-4);
  vec2 hs = normalize(OD_SUN.xz);
  return clamp(dot(hd, hs) * 0.5 + 0.5, 0.0, 1.0); // 1 toward the sun, 0 opposite
}

// Sun glow: Henyey-Greenstein forward-scattering lobe (g = 0.86) for the broad warm
// hotspot, plus the photographed sun: a blown white-yellow core ~8 deg across (lens
// flare of an over-exposed sun) fading through cream into gold; the true disc sits
// hidden inside the clipped core.
vec3 odSunGlow(float mu, float lobe, float core) {
  const float g = 0.86;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.0796;
  float th = sqrt(max(2.0 * (1.0 - mu), 0.0));          // angle from the sun (rad)
  vec3 c = vec3(1.0, 0.50, 0.14) * 0.26 * hg * lobe;
  float disc = 1.0 - smoothstep(0.0095, 0.0125, th);
  c += core * (vec3(1.0, 0.80, 0.46) * 11.0 * exp(-pow(th / 0.042, 1.5))   // clipped core -> cream
             + vec3(1.0, 0.58, 0.20) * 1.6 * exp(-th / 0.09)                // cream -> gold
             + vec3(4.0, 3.0, 1.6) * disc);
  return c;
}

// The glow of a sun on the horizon is flattened: a warm band hugging the horizon,
// much wider than tall (low-level haze layering and refraction).
vec3 odSunBand(vec3 d) {
  float dA = acos(clamp(dot(normalize(d.xz + 1e-5), normalize(OD_SUN.xz)), -1.0, 1.0));
  float dE = max(d.y, 0.0) - OD_SUN.y;
  return vec3(1.0, 0.40, 0.09) * 0.5 * exp(-pow(dA / 0.32, 2.0) - pow(dE / (dE < 0.0 ? 0.06 : 0.045), 2.0));
}

vec3 odSkyBase(vec3 d, float glowScale) {
  float e = max(d.y, 0.0);
  float mu = dot(d, OD_SUN);
  float az = odSunSide(d);

  // Anti-solar side: dusty blue-grey dome, pink "belt" above a blue-grey earth-shadow band.
  vec3 away = mix(vec3(0.380, 0.460, 0.660), vec3(0.270, 0.350, 0.560), smoothstep(0.25, 0.95, e));
  away = mix(vec3(0.660, 0.490, 0.530), away, smoothstep(0.07, 0.30, e));
  away = mix(vec3(0.400, 0.420, 0.540), away, smoothstep(0.0, 0.06, e));

  // Solar side, a broad graded band: red-orange at the horizon -> deep orange (~6 deg)
  // -> orange-gold (~15 deg) -> pale yellow -> clean blue-grey.
  vec3 sun = mix(vec3(0.270, 0.420, 0.690), vec3(0.200, 0.300, 0.520), smoothstep(0.35, 0.95, e));
  sun = mix(vec3(0.780, 0.640, 0.420), sun, smoothstep(0.14, 0.50, e));
  sun = mix(vec3(1.050, 0.540, 0.160), sun, smoothstep(0.05, 0.27, e));
  sun = mix(vec3(0.950, 0.300, 0.070), sun, smoothstep(0.0, 0.11, e));

  float sw = pow(az, 1.5 + 4.0 * e);
  vec3 col = mix(away, sun, sw);
  return col + odSunGlow(mu, 0.8, glowScale) + odSunBand(d) * glowScale;
}

// Aerial-perspective colour: the sky just above the horizon in that direction.
vec3 odHaze(vec3 d) {
  vec3 hd = normalize(vec3(d.x, max(d.y, 0.0) * 0.5 + 0.004, d.z));
  // only part of the forward-scattering lobe: a 40 m slab of air toward the sun is not the whole sky
  return odSkyBase(hd, 0.0) - odSunGlow(dot(hd, OD_SUN), 0.7, 0.0);
}
`;

// Height-attenuated haze, exact along slanted rays. Requires odHaze.
export const FOG_FN_GLSL = /* glsl */ `
vec3 odApplyFog(vec3 col, vec3 offs, float density) {
  float fDist = length(offs);
  vec3 fDir = offs / max(fDist, 1e-4);
  const float fH = 120.0;
  float fDy = offs.y / fH;
  float fK = abs(fDy) > 1e-3 ? (1.0 - exp(-fDy)) / fDy : 1.0;
  // the first ~50 m stay crisp; humid haze builds beyond that
  float fOd = density * exp(-max(cameraPosition.y, 0.0) / fH) * max(fDist - 50.0, 0.0) * fK;
  // The haze colour is the horizon sky, i.e. km of air. Toward the sun that is the
  // blazing glow, so a short slab of it would light up backlit sand as bright as the
  // sky; there the haze is thinned to keep near backlit ground dark as in photos.
  fOd *= mix(1.0, 0.3, smoothstep(0.3, 0.95, dot(fDir, OD_SUN)));
  return mix(col, odHaze(fDir), 1.0 - exp(-fOd));
}
`;

export const SKY_FULL_GLSL = /* glsl */ `
${SKY_BASE_GLSL}

float odHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float odNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(odHash(i), odHash(i + vec2(1, 0)), u.x),
             mix(odHash(i + vec2(0, 1)), odHash(i + vec2(1, 1)), u.x), u.y);
}
float odFbm(vec2 p) {
  float a = 0.5, s = 0.0;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) { s += a * odNoise(p); p = r * p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

float odWorley(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float m = 1.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 r = o + vec2(odHash(i + o), odHash(i + o + 19.7)) * 0.9 - f;
    m = min(m, dot(r, r));
  }
  return sqrt(m);
}

// Low altocumulus / small cumulus patches near the horizon: large-scale coverage
// times packed round puffs (Worley), so they read as clumps rather than smears.
float odCloudField(vec2 q) {
  vec2 w = vec2(odNoise(q * 0.9 + 3.3), odNoise(q * 0.9 + 7.9)) - 0.5;
  float cov = odFbm(q * 0.22 + 1.7);
  float pf = 1.0 - odWorley(q * 1.05 + w * 0.8);
  float pf2 = 1.0 - odWorley(q * 2.6 + w * 1.4 + 5.0);
  return cov * 0.75 + (pf * 0.6 + pf2 * 0.4) * 0.42;
}

// Cloud plane projection, less flattened toward the horizon than a true plane
// (radial/tangential ratio (y + 0.1) / 0.55) so distant puffs keep some height.
vec2 odCloudUv(vec3 d) { return d.xz / pow(max(d.y, 0.0) + 0.1, 0.55) * 1.1; }

vec4 odClouds(vec3 d, float detail) {
  if (d.y <= 0.0) return vec4(0.0);
  vec2 q = odCloudUv(d);
  float n = odCloudField(q);
  float fine = odNoise(q * 9.0) * 0.6 + odNoise(q * 19.0) * 0.4;
  vec2 toSun = normalize(odCloudUv(normalize(OD_SUN + vec3(0.0, 0.02, 0.0))) - q + 1e-4);
  float n2 = detail > 0.5 ? odCloudField(q + toSun * 0.12) : n - 0.02;
  // density just below: puffs are flat-bottomed, their undersides in shade
  float nb = detail > 0.5 ? odCloudField(odCloudUv(normalize(d - vec3(0.0, 0.012, 0.0)))) : n;

  float low = smoothstep(0.30, 0.03, d.y);
  float th = 0.53 - 0.04 * low;
  float nn = n + (fine - 0.5) * 0.07;
  float dens = smoothstep(th, th + 0.04, nn) * low;
  dens *= smoothstep(0.0, 0.02, d.y);                    // melt into horizon haze
  float thick = smoothstep(th + 0.03, th + 0.13, nn);
  float lit = clamp((n - n2) * 14.0 + 0.5, 0.0, 1.0);    // sun-facing side of the puff
  float under = clamp((n - nb) * 7.0 + 0.3, 0.0, 1.0) * thick;   // bottom of a thick puff
  float wv = 0.35 + 0.65 * odNoise(q * 3.3 + 2.0);       // rim width varies along the edge

  float mu = max(dot(d, OD_SUN), 0.0);
  float near = pow(mu, 4.0);                             // ~0.94 at 10 deg, 0.78 at 20, 0.56 at 30, 0.25 at 45
  const float g = 0.8;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.0796;
  float thin = 1.0 - thick;
  // Away from the sun: sunlit pink-peach tops over shaded lavender-grey bases.
  // Away from the sun: peach-orange sun-facing sides, lavender-grey shaded bodies and
  // darker undersides.
  vec3 cA = mix(vec3(0.36, 0.31, 0.40), vec3(1.05, 0.56, 0.34), smoothstep(0.3, 0.85, lit) * (0.6 + 0.4 * thin));
  cA *= 1.0 - 0.35 * under;
  // Backlit, near the sun: thick bodies slate-purple with soft internal gradients;
  // only the sun-facing edge forward-scatters, orange-gold, in a rim of varying width.
  vec3 edge = vec3(1.0, 0.42, 0.08) * (1.4 + 1.5 * hg);
  vec3 body = mix(vec3(0.30, 0.22, 0.27), vec3(0.17, 0.13, 0.19), thick) * (1.0 - 0.3 * under);
  float rim = smoothstep(0.4, 0.9, lit) * pow(thin, 1.1 * (1.6 - wv));
  vec3 cS = mix(body, edge, rim) + vec3(0.9, 0.35, 0.08) * 0.35 * hg * thin * (1.0 - rim);
  vec3 col = mix(cA, cS, near);

  // thin cirrus higher up: faint wisps, gold toward the sun, pink elsewhere
  vec2 cq = d.xz / (d.y + 0.12);
  float ci = odFbm(vec2(cq.x * 0.8 + cq.y * 0.3, cq.y * 4.0 - cq.x * 0.4) + 11.0);
  float ciD = smoothstep(0.6, 0.82, ci) * smoothstep(0.08, 0.2, d.y) * smoothstep(0.75, 0.3, d.y) * 0.22 * (1.0 - 0.7 * near);
  vec3 ciC = mix(vec3(0.95, 0.66, 0.58), vec3(1.0, 0.55, 0.18) * (0.9 + 0.4 * hg), near);
  float a = clamp(dens, 0.0, 1.0) * 0.97;
  col = mix(ciC, col, a / max(a + ciD * (1.0 - a), 1e-4));
  a = a + ciD * (1.0 - a);
  return vec4(col, a);
}

// mode 0: visible sky (sun disc). mode 1: skylight environment. mode 2: water reflection.
vec3 odSky(vec3 d, float mode) {
  vec3 hd = normalize(vec3(d.x, max(d.y, 0.0), d.z));
  vec3 col = odSkyBase(hd, mode < 0.5 ? 1.0 : 0.0);
  vec4 cl = odClouds(d, mode > 1.5 ? 0.0 : 1.0);
  col = mix(col, cl.rgb, cl.a);
  // water: the sun's aureole reaches it only through the glitter (spec lobe), not as a broad tint
  if (mode > 1.5) col -= odSunGlow(dot(hd, OD_SUN), 0.75, 0.0) * (1.0 - cl.a);
  // (and the gold horizon under the sun reaches the near water only in the glitter path:
  // off-path wave faces there read steel-grey rather than tinted orange)
  if (mode > 1.5) col = mix(col, dot(col, vec3(0.2126, 0.7152, 0.0722)) * vec3(0.93, 0.95, 1.02), 0.5 * pow(odSunSide(hd), 3.0));

  if (mode < 0.5) {
    // a little glare in the air in front of the clouds: only right at the sun do they burn out
    col += odSunGlow(dot(hd, OD_SUN), 0.12, 0.15) * cl.a + odSunBand(hd) * 0.4 * cl.a;
  } else if (mode < 1.5) {
    // Skylight: compress the bright solar horizon and bias cooler, so shade reads
    // blue-violet against the gold sun instead of being filled by sunrise glow.
    // The sun-side half of the dome is the bright, warm (peach) one; the anti-solar
    // half is dim and blue. Open horizontal ground sees both (warm-neutral fill,
    // fairly bright shade); faces turned away from the sun see only the dim blue half.
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float up = max(d.y, 0.0);
    float az = mix(odSunSide(d), 0.5, up * up);
    col = mix(col, l * vec3(0.74, 0.90, 1.32), 0.85 * pow(1.0 - az, 1.5));
    col = mix(col, l * vec3(1.06, 1.0, 0.92), 0.5 * up * az);   // overhead: near-neutral, the dim blue zenith offset by the peach sun-side dome
    col /= 1.0 + 1.5 * l;
    // Weighted to the open dome overhead; the low solar sky is compressed so a
    // sun-facing wall in shade gets modest, cooler fill (lit:shade ~3:1 on walls).
    col = mix(col, l * vec3(0.74, 0.90, 1.34), 0.55 * (1.0 - up) * az);   // low solar sky as fill: cooler, it is mostly the blue-grey dome around the glow
    col *= (0.3 + 3.2 * up) * (0.12 + 1.9 * az * az);
    // lower hemisphere: warm bounce from sunlit pavement, sand and walls
    float g = smoothstep(0.0, -0.2, d.y);
    // (toward the sun you see lit faces; away from it, mostly cast shadows)
    vec3 ground = mix(vec3(0.075, 0.08, 0.095), vec3(0.15, 0.115, 0.095), odSunSide(d));
    col = mix(col, ground, g);
  }
  return col;
}
`;

function makeSkyMaterial(mode) {
  return new THREE.ShaderMaterial({
    name: mode === 1 ? 'SkyEnv' : 'Sky',
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      ${SKY_FULL_GLSL}
      void main() {
        gl_FragColor = vec4(odSky(normalize(vDir), ${mode.toFixed(1)}), 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

// Replace three's fog with height-attenuated, view-direction-tinted haze.
function installAerialPerspective() {
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogOffset;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogOffset = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogOffset;
  uniform float fogDensity;
  ${SKY_BASE_GLSL}
  ${FOG_FN_GLSL}
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = odApplyFog(gl_FragColor.rgb, vFogOffset, fogDensity);
#endif`;
}

// Light bounced up from the sunlit ground (pavement, sand) onto every downward-facing
// surface: ledge, awning, canopy and roof undersides, which the sky probe cannot light.
function installGroundBounce() {
  THREE.ShaderChunk.aomap_fragment += /* glsl */ `
#ifdef STANDARD
  {
    vec3 odBn = inverseTransformDirection( normal, viewMatrix );
    reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3( 0.2, 0.14, 0.09 ) * max( -odBn.y, 0.0 );
  }
#endif`;
}

// Contact-hardening sun shadows (PCSS-style) on the orthographic sun map.
// Blocker distance is found by re-testing the comparison sampler at depth offsets
// of 0.5-25 m; the penumbra is the sun disc's (0.0093 x distance). A regular 8x8
// bilinear grid keeps it free of stipple.
function installSmoothShadows(shadowCam, mapSize) {
  const src = THREE.ShaderChunk.shadowmap_pars_fragment;
  const a = src.indexOf('float radius = shadowRadius * texelSize.x;');
  const b = src.indexOf(') * 0.2;', a);
  if (a < 0 || b < 0) throw new Error('smooth shadow patch: three shadowmap chunk changed');
  const f = (v) => v.toFixed(5);
  const texM = [(shadowCam.right - shadowCam.left) / mapSize.x, (shadowCam.top - shadowCam.bottom) / mapSize.y];
  const range = shadowCam.far - shadowCam.near;
  const code = /* glsl */ `
				const vec2 odTexM = vec2( ${f(texM[0])}, ${f(texM[1])} );
				const float odRange = ${f(range)};
				float zr = shadowCoord.z;
				// minimum filter: 1.5 texels, or ~1 screen pixel of ground (1 / gl_FragCoord.w
				// = view depth) so thin shadows don't alias at grazing angles
				float minM = max( 1.5 * max( odTexM.x, odTexM.y ), 1.2 * 0.0015 / gl_FragCoord.w );
				// blocker search ring no wider than thin casters, so none are skipped
				vec2 sr = max( minM, 0.08 ) / odTexM * texelSize;
				float bSum = 0.0, dSum = 0.0;
				for ( int i = -1; i <= 1; i ++ ) {
					for ( int j = -1; j <= 1; j ++ ) {
						vec2 uv = shadowCoord.xy + vec2( float( i ), float( j ) ) * sr;
						float b0 = 1.0 - texture( shadowMap, vec3( uv, zr ) );
						float b1 = 1.0 - texture( shadowMap, vec3( uv, zr - 0.5 / odRange ) );
						float b2 = 1.0 - texture( shadowMap, vec3( uv, zr - 1.5 / odRange ) );
						float b3 = 1.0 - texture( shadowMap, vec3( uv, zr - 4.0 / odRange ) );
						float b4 = 1.0 - texture( shadowMap, vec3( uv, zr - 10.0 / odRange ) );
						float b5 = 1.0 - texture( shadowMap, vec3( uv, zr - 25.0 / odRange ) );
						bSum += b0;
						// receiver-to-blocker distance (m): integral of blocker occupancy over depth offset
						dSum += 0.25 * ( b0 + b1 ) + 0.5 * ( b1 + b2 ) + 1.25 * ( b2 + b3 ) + 3.0 * ( b3 + b4 ) + 7.5 * ( b4 + b5 ) + 20.0 * b5;
					}
				}
				if ( bSum < 0.001 ) {
					shadow = 1.0;
				} else {
					// the sun's 0.53 deg disc: penumbra width 0.0093 x blocker distance -> half-width radius
					float pen = max( 0.00465 * dSum / bSum, minM );
					vec2 rT = clamp( pen / odTexM, vec2( 1.0 ), vec2( 8.0 ) );
					vec2 stp = rT * texelSize / 3.5;
					shadow = 0.0;
					for ( int i = 0; i < 8; i ++ ) {
						for ( int j = 0; j < 8; j ++ ) {
							vec2 o = ( vec2( float( i ), float( j ) ) - 3.5 ) * stp;
							shadow += texture( shadowMap, vec3( shadowCoord.xy + o, zr ) );
						}
					}
					shadow /= 64.0;
				}`;
  THREE.ShaderChunk.shadowmap_pars_fragment = src.slice(0, a) + code + src.slice(b + ') * 0.2;'.length);
}

export function createSky(renderer, scene) {
  installAerialPerspective();
  installGroundBounce();
  scene.fog = new THREE.FogExp2(0xffffff, FOG_DENSITY);

  const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 64, 32), makeSkyMaterial(0));
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);

  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), makeSkyMaterial(1)));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(envScene, 0, 0.1, 500);
  pmrem.dispose();
  scene.environment = envRT.texture;
  scene.environmentIntensity = ENV_INTENSITY;

  const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  sun.castShadow = true;
  sun.shadow.mapSize.set(8192, 2048);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 1.5;
  scene.add(sun, sun.target);

  // The shadow box follows the viewer along the street in 10 m steps
  // (re-rendered only when it moves): ~2 cm texels on the facades.
  const SPAN = 80;
  let centerZ = NaN;
  function placeShadow(z) {
    const cz = Math.round(z / 10) * 10;
    if (cz === centerZ) return;
    centerZ = cz;
    fitShadow(sun, new THREE.Box3(
      new THREE.Vector3(-62, -1.5, cz - SPAN), new THREE.Vector3(96, 22, cz + SPAN)));
    renderer.shadowMap.needsUpdate = true;
  }
  placeShadow(0);
  installSmoothShadows(sun.shadow.camera, sun.shadow.mapSize);

  return {
    dome,
    sun,
    update(camera) {
      dome.position.copy(camera.position);
      placeShadow(camera.position.z);
    },
  };
}

function fitShadow(light, box) {
  const center = box.getCenter(new THREE.Vector3());
  light.position.copy(center).addScaledVector(sunDir, 400);
  light.target.position.copy(center);
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();

  const cam = light.shadow.camera;
  cam.position.copy(light.position);
  cam.lookAt(center);
  cam.updateMatrixWorld();
  const inv = cam.matrixWorldInverse;

  const lb = new THREE.Box3();
  const p = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    lb.expandByPoint(p.applyMatrix4(inv));
  }
  cam.left = lb.min.x;
  cam.right = lb.max.x;
  cam.bottom = lb.min.y;
  cam.top = lb.max.y;
  cam.near = Math.max(0.5, -lb.max.z - 60);
  cam.far = -lb.min.z + 5;
  cam.updateProjectionMatrix();
}
