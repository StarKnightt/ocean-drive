// Ocean Drive street: cambered, weathered asphalt with worn paint, concrete curbs and
// gutter pans, pale slab sidewalks with paver sections, ADA ramps at the crosswalk,
// storm drains, manholes and the street furniture (merged, vertex-coloured).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  WORLD_Z, CURB_HEIGHT, SIDEWALK_W, PARKING, LANES, SIDEWALK_E, PARK, CAR, CROSSWALK_Z, roadHeight,
} from './layout.js';
import { PALM_TREES } from './palms.js';
import { mulberry32, fbmField } from '../textures/noise.js';

const Z = WORLD_Z;
const CURB_W = 0.15;
const GUTTER_W = 0.3;
const CW = { z0: CROSSWALK_Z - 2, z1: CROSSWALK_Z + 2 };
const RAMP = { z0: CROSSWALK_Z - 1.5, z1: CROSSWALK_Z + 1.5, run: 1.3 };
const LANE_C = [LANES.centerX - 1.75, LANES.centerX + 1.75];
const promenadeX = (z) => PARK.promenadeX + 2.6 * Math.sin(z / 19) + 1.2 * Math.sin(z / 7.3);

function canvas(w, h = w) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return [cv, cv.getContext('2d')];
}
function tex(cv, { srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}
// normal map from a height array (tileable)
function normalTex(H, S, strength) {
  const d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const l = H[y * S + ((x - 1 + S) % S)], r = H[y * S + ((x + 1) % S)];
      const u = H[((y - 1 + S) % S) * S + x], dn = H[((y + 1) % S) * S + x];
      const nx = (l - r) * strength, ny = (dn - u) * strength, len = Math.hypot(nx, ny, 1);
      const i = (y * S + x) * 4;
      d[i] = (nx / len * 0.5 + 0.5) * 255; d[i + 1] = (ny / len * 0.5 + 0.5) * 255; d[i + 2] = (1 / len * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
// random-walk crack polyline, drawn at the 9 tile offsets so it wraps
function crack(c, rnd, S, x, y, len, ang, w, col) {
  const pts = [[x, y]];
  for (let i = 0; i < len; i++) {
    ang += (rnd() - 0.5) * 0.9;
    x += Math.cos(ang) * 6; y += Math.sin(ang) * 6;
    pts.push([x, y]);
    if (rnd() < 0.04 && len > 10) crack(c, rnd, S, x, y, len * 0.3, ang + (rnd() < 0.5 ? 1.2 : -1.2), w * 0.7, col);
  }
  c.strokeStyle = col; c.lineWidth = w; c.lineJoin = 'round';
  for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
    c.beginPath();
    pts.forEach(([px, py], i) => (i ? c.lineTo(px + ox, py + oy) : c.moveTo(px + ox, py + oy)));
    c.stroke();
  }
}

// ---------------------------------------------------------------------------
// Asphalt: fine tile (8 m) with aggregate grain + hairline cracks, and a macro tile
// (48 m, linear RGB: r albedo, g roughness, b oil) with repair patches, long cracks,
// blotches and stains.
function asphaltTextures() {
  const S = 1024, rnd = mulberry32(71);
  const [cv, c] = canvas(S);
  const img = c.createImageData(S, S);
  const f = fbmField(256, { seed: 3, baseCells: 8, octaves: 4 });
  const H = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let v = 152 + (f[(y >> 2) * 256 + (x >> 2)] - 0.5) * 18;
      const r = rnd();
      let h = f[(y >> 2) * 256 + (x >> 2)] * 0.3;
      if (r < 0.05) { v += 10 + rnd() * 12; h += 0.4; }          // fine pale aggregate
      else if (r < 0.09) { v -= 12 + rnd() * 10; h -= 0.25; }    // pits / binder
      else v += (rnd() - 0.5) * 10;
      H[i] = h;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v + 2; img.data[i * 4 + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  const map = tex(cv);
  map.repeat.set(1, 1);
  const normalMap = normalTex(H, S, 1.6);

  // macro
  const M = 512, mr = mulberry32(72);
  const layer = () => { const [cv2, c2] = canvas(M); c2.fillStyle = '#808080'; c2.fillRect(0, 0, M, M); return [cv2, c2]; };
  const [cR, xR] = layer(), [cG, xG] = layer(), [cB, xB] = layer();
  xB.fillStyle = '#000'; xB.fillRect(0, 0, M, M);
  const fm = fbmField(M, { seed: 9, baseCells: 6, octaves: 5 });
  const id = xR.getImageData(0, 0, M, M);
  for (let i = 0; i < M * M; i++) { const v = 128 + (fm[i] - 0.5) * 70; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; }
  xR.putImageData(id, 0, 0);
  // repair patches (utility cuts): darker newer asphalt or lighter old, crisp sealed seams
  for (let k = 0; k < 20; k++) {
    const w = 10 + mr() * 40, h = 8 + mr() * 50, x = mr() * M, y = mr() * M;
    const v = mr() < 0.6 ? 72 + mr() * 20 : 160 + mr() * 22;
    for (const ox of [-M, 0, M]) for (const oy of [-M, 0, M]) {
      xR.fillStyle = `rgb(${v},${v},${v})`; xR.fillRect(x + ox, y + oy, w, h);
      xR.strokeStyle = 'rgb(60,60,60)'; xR.lineWidth = 1.5; xR.strokeRect(x + ox, y + oy, w, h);
      xG.fillStyle = v < 128 ? 'rgb(110,110,110)' : 'rgb(150,150,150)'; xG.fillRect(x + ox, y + oy, w, h);
    }
  }
  // long transverse / longitudinal cracks with sealant
  // glossy worn spots (catch the low sun)
  for (let k = 0; k < 60; k++) {
    const x = mr() * M, y = mr() * M, r = 4 + mr() * 14;
    const g = xG.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(40,40,40,0.8)'); g.addColorStop(1, 'rgba(40,40,40,0)');
    xG.fillStyle = g; xG.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // oil stains (used in the parking lane and down the middle of each travel lane)
  for (let k = 0; k < 300; k++) {
    const x = mr() * M, y = mr() * M, r = 2.5 + mr() * 9;
    const g = xB.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.5 + mr() * 0.5})`); g.addColorStop(0.6, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    xB.fillStyle = g; xB.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const [cm, xm] = canvas(M);
  const out = xm.createImageData(M, M);
  const dR = xR.getImageData(0, 0, M, M).data, dG = xG.getImageData(0, 0, M, M).data, dB = xB.getImageData(0, 0, M, M).data;
  for (let i = 0; i < M * M; i++) { out.data[i * 4] = dR[i * 4]; out.data[i * 4 + 1] = dG[i * 4]; out.data[i * 4 + 2] = dB[i * 4]; out.data[i * 4 + 3] = 255; }
  xm.putImageData(out, 0, 0);
  const macro = tex(cm, { srgb: false });
  return { map, normalMap, macro };
}

function roadMesh() {
  const { map, normalMap, macro } = asphaltTextures();
  const nx = 38;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nx; i++) {
    const x = PARKING.x0 + (LANES.x1 - PARKING.x0) * (i / nx), y = roadHeight(x);
    for (const z of [-Z, Z]) { pos.push(x, y, z); uv.push(x / 8, -z / 8); }
    if (i < nx) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.9 });
  const tracks = LANE_C.flatMap((c) => [c - 0.85, c + 0.85]).map((v) => v.toFixed(2));
  mat.onBeforeCompile = (s) => {
    s.uniforms.odMacro = { value: macro };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOdW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvOdW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOdW;\nuniform sampler2D odMacro;\nfloat odG(float x, float c, float w) { float t = (x - c) / w; return exp(-t * t); }')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 odM = texture2D(odMacro, vOdW.xz / 48.0).rgb;
        float odX = vOdW.x;
        float odPark = 1.0 - step(${PARKING.x1.toFixed(2)}, odX);
        // tyre-polished wheel tracks: darker, smoother
        float odTr = (odG(odX, ${tracks[0]}, 0.3) + odG(odX, ${tracks[1]}, 0.3) + odG(odX, ${tracks[2]}, 0.3) + odG(odX, ${tracks[3]}, 0.3)) * (1.0 - odPark);
        // oil: parking bays and the drip line down the middle of each lane
        float odOil = odM.b * (odPark * smoothstep(${(PARKING.x0 + 0.5).toFixed(2)}, ${(PARKING.x0 + 1.2).toFixed(2)}, odX) + 0.45 * (odG(odX, ${LANE_C[0].toFixed(2)}, 0.45) + odG(odX, ${LANE_C[1].toFixed(2)}, 0.45)));
        // gutter grime along the curbs
        float odGut = odG(odX, ${(PARKING.x0 + GUTTER_W).toFixed(2)}, 0.35) + odG(odX, ${(LANES.x1 - GUTTER_W).toFixed(2)}, 0.35);
        // a dark dirt line where the asphalt meets the gutter strip
        float odDirt = odG(odX, ${(PARKING.x0 + GUTTER_W + 0.03).toFixed(2)}, 0.06) + odG(odX, ${(LANES.x1 - GUTTER_W - 0.03).toFixed(2)}, 0.06);
        // wide glossy tar-sealed seams along the lane joints, and transverse ones now and then
        float odSeam = odG(odX + 0.04 * sin(vOdW.z * 0.9), ${(PARKING.x1 + 0.35).toFixed(2)}, 0.045) + odG(odX + 0.05 * sin(vOdW.z * 0.7 + 2.0), ${(LANES.centerX + 0.45).toFixed(2)}, 0.05)
          + odG(fract(vOdW.z / 37.0) * 37.0 + 0.1 * sin(odX * 1.3), 18.0, 0.05);
        odSeam = min(odSeam, 1.0);
        diffuseColor.rgb *= (0.7 + 0.6 * odM.r) * (1.0 - 0.14 * odTr) * (1.0 - 0.62 * odOil) * (1.0 - 0.1 * odGut) * (1.0 - 0.45 * odDirt) * (1.0 - 0.5 * odSeam);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(0.93 + (odM.g - 0.5) * 0.6 - 0.18 * odTr - 0.5 * odOil - 0.6 * odSeam, 0.25, 1.0);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        #ifdef USE_FOG
        {
          // rough asphalt under a grazing sun back-scatters strongly (Oren-Nayar): the lit
          // road is brighter than Lambert and the shadows on it read crisp and contrasty
          vec3 odVd = normalize(vFogOffset);
          float odAway = smoothstep(0.2, -1.0, dot(normalize(odVd.xz + 1e-5), normalize(OD_SUN.xz))) * (1.0 - abs(odVd.y));
          reflectedLight.directDiffuse *= 2.4 + 0.8 * odAway;
          // neutral grey skylight fill (the lilac sky on warm-lit grey read mauve)
          vec3 odI = reflectedLight.indirectDiffuse;
          reflectedLight.indirectDiffuse = mix(odI, vec3(dot(odI, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.97, 0.98, 1.0), 0.6) * 0.72;
        }
        #endif`);
  };
  mat.customProgramCacheKey = () => 'street-asphalt-v2';
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Worn road paint: one merged mesh, vertex colours, faint grime (solid lines: alpha
// chips aliased into stepped dashes at distance).
function markings() {
  const S = 256, rnd = mulberry32(81);
  const [cv, c] = canvas(S);
  const f = fbmField(S, { seed: 12, baseCells: 10, octaves: 4 });
  const img = c.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = 205 + f[i] * 45 + (rnd() - 0.5) * 12;   // worn: faint grime variation only
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v - 6;
    img.data[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  const map = tex(cv);
  const pos = [], col = [], uv = [], idx = [];
  const color = new THREE.Color();
  const quad = (x0, x1, z0, z1, hex, fade = 1, segX = 1) => {
    color.setHex(hex).multiplyScalar(fade);
    const b = pos.length / 3;
    for (let i = 0; i <= segX; i++) {
      const x = x0 + (x1 - x0) * (i / segX), y = roadHeight(x) + 0.006;
      for (const z of [z0, z1]) { pos.push(x, y, z); col.push(color.r, color.g, color.b); uv.push(x / 2, z / 2); }
      if (i < segX) { const a = b + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  };
  const YEL = 0xf2c418, WHT = 0xf0ede4;
  const cx = LANES.centerX;
  // double yellow centre line (interrupted by the crosswalk)
  for (const [z0, z1] of [[-Z, CW.z0 - 0.6], [CW.z1 + 0.6, Z]]) {
    quad(cx - 0.21, cx - 0.08, z0, z1, YEL, 1);
    quad(cx + 0.08, cx + 0.21, z0, z1, YEL, 1);
  }
  // parking lane edge line and bay ticks
  for (const [z0, z1] of [[-Z, CW.z0 - 6], [CW.z1 + 3, Z]]) quad(PARKING.x1 - 0.05, PARKING.x1 + 0.05, z0, z1, WHT, 0.9);
  // east edge line
  quad(LANES.x1 - GUTTER_W - 0.2, LANES.x1 - GUTTER_W - 0.1, -Z, Z, WHT, 0.8);
  // continental crosswalk: bars parallel to traffic, framed by two ladder rails
  for (let x = PARKING.x0 + GUTTER_W + 0.2; x < LANES.x1 - GUTTER_W - 0.5; x += 1.2) quad(x, x + 0.6, CW.z0 + 0.4, CW.z1 - 0.4, WHT, 0.95);
  quad(PARKING.x0 + GUTTER_W, LANES.x1 - GUTTER_W, CW.z0, CW.z0 + 0.3, WHT, 0.95, 16);
  quad(PARKING.x0 + GUTTER_W, LANES.x1 - GUTTER_W, CW.z1 - 0.3, CW.z1, WHT, 0.95, 16);
  // stop bars
  quad(cx + 0.2, LANES.x1 - GUTTER_W, CW.z1 + 1.6, CW.z1 + 2.0, WHT, 0.9, 6);
  quad(PARKING.x1, cx - 0.2, CW.z0 - 2.0, CW.z0 - 1.6, WHT, 0.9, 6);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  mat.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
      #ifdef USE_FOG
      { vec3 odVd = normalize(vFogOffset);
        float odAway = smoothstep(0.2, -1.0, dot(normalize(odVd.xz + 1e-5), normalize(OD_SUN.xz))) * (1.0 - abs(odVd.y));
        reflectedLight.directDiffuse *= 2.2 + 0.6 * odAway; reflectedLight.indirectDiffuse *= 0.8; }
      #endif`);
  };
  mat.customProgramCacheKey = () => 'street-paint-v2';
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Concrete: sidewalk slab texture (3 m tile, 1.5 m slabs) and a brick-paver texture.
function concreteTextures() {
  const S = 1024, rnd = mulberry32(91);
  const [cv, c] = canvas(S);
  const f = fbmField(256, { seed: 21, baseCells: 6, octaves: 5 });
  const img = c.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x, n = f[(y >> 2) * 256 + (x >> 2)];
      const broom = Math.sin(y * 1.9 + Math.sin(x * 0.05) * 3) * 2.5;
      const v = 200 + (n - 0.5) * 24 + (rnd() - 0.5) * 8 + broom;
      img.data[i * 4] = v + 14; img.data[i * 4 + 1] = v - 6; img.data[i * 4 + 2] = v - 22; img.data[i * 4 + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  // per-slab tone differences and slight height offsets (a lit lip / shaded step at joints)
  for (let sx = 0; sx < 2; sx++) for (let sy = 0; sy < 2; sy++) {
    c.fillStyle = `rgba(${rnd() < 0.5 ? '255,245,230' : '90,80,70'},${0.03 + rnd() * 0.05})`;
    c.fillRect(sx * 512, sy * 512, 512, 512);
    if (rnd() < 0.6) { c.fillStyle = 'rgba(255,250,240,0.35)'; c.fillRect(sx * 512 + 3, sy * 512 + 3, 506, 3); }
    if (rnd() < 0.6) { c.fillStyle = 'rgba(60,50,40,0.3)'; c.fillRect(sx * 512 + 3, sy * 512 + 3, 3, 506); }
  }
  // stains and gum
  for (let k = 0; k < 8; k++) {
    const x = rnd() * S, y = rnd() * S, r = 20 + rnd() * 60;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(95,80,65,${0.08 + rnd() * 0.14})`); g.addColorStop(1, 'rgba(95,80,65,0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let k = 0; k < 14; k++) {
    c.fillStyle = `rgba(${90 + rnd() * 30},${86 + rnd() * 25},${80 + rnd() * 20},0.6)`;
    c.beginPath(); c.arc(rnd() * S, rnd() * S, 1 + rnd() * 1.5, 0, 6.28); c.fill();
  }
  // expansion joints, chipped
  c.strokeStyle = 'rgba(70,58,48,0.9)'; c.lineWidth = 4;
  for (const p of [0, 512, 1024]) {
    c.beginPath(); c.moveTo(p, 0); c.lineTo(p, S); c.stroke();
    c.beginPath(); c.moveTo(0, p); c.lineTo(S, p); c.stroke();
  }
  for (let k = 0; k < 40; k++) {
    const onX = rnd() < 0.5, p = rnd() < 0.5 ? 0 : 512, q = rnd() * S;
    c.fillStyle = 'rgba(110,100,88,0.6)';
    c.beginPath(); c.arc(onX ? p : q, onX ? q : p, 2 + rnd() * 5, 0, 6.28); c.fill();
  }
  const concrete = tex(cv);

  // brick pavers (1.2 m tile): herringbone of 20 x 10 cm bricks in warm buff/terracotta
  const P = 512, [pv, pc] = canvas(P);
  pc.fillStyle = '#8a7462'; pc.fillRect(0, 0, P, P);
  const u = P / 12;   // 10 cm
  const cols = ['#c98d6a', '#b97a5a', '#d3a07c', '#c4876a', '#a8705a', '#d8b08c'];
  const brick = (x, y, w, h) => {
    for (const ox of [-P, 0, P]) for (const oy of [-P, 0, P]) {
      pc.fillStyle = cols[Math.floor(rnd() * cols.length)];
      pc.fillRect(x + ox + 1.5, y + oy + 1.5, w - 3, h - 3);
      pc.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`; pc.fillRect(x + ox + 1.5, y + oy + 1.5, w - 3, h - 3);
    }
  };
  for (let i = -12; i < 24; i++) for (let j = -12; j < 24; j++) {
    const x = (i + j) * u, y = (j - i) * u;   // herringbone: pairs of L-shaped bricks on a diagonal lattice
    brick(x, y, 2 * u, u);
    brick(x + u, y + u, u, 2 * u);
  }
  const pavers = tex(pv);
  return { concrete, pavers };
}

// Box from explicit bounds with world-space planar UVs.
function slab(x0, x1, y0, y1, z0, z1, tile = 1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const pos = g.attributes.position, uv = g.attributes.uv, nrm = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nrm.getX(i)) > 0.5, az = Math.abs(nrm.getZ(i)) > 0.5;
    uv.setXY(i, (ax ? pos.getZ(i) : pos.getX(i)) / tile, (ax || az ? pos.getY(i) : pos.getZ(i)) / tile);
  }
  return g;
}
// sloped quad (ramp top) from x0 (y0) to x1 (y1) across z0..z1
function rampTop(x0, y0, x1, y1, z0, z1, tile) {
  const g = new THREE.BufferGeometry();
  const p = [x0, y0, z0, x1, y1, z0, x0, y0, z1, x1, y1, z1];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([x0 / tile, z0 / tile, x1 / tile, z0 / tile, x0 / tile, z1 / tile, x1 / tile, z1 / tile], 2));
  g.setIndex(x1 > x0 ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 1, 3, 2]);
  g.computeVertexNormals();
  return g;
}

function sidewalks() {
  const { concrete, pavers } = concreteTextures();
  const H = CURB_HEIGHT;
  const wx = SIDEWALK_W.x1 - CURB_W, ex = SIDEWALK_E.x0 + CURB_W;
  const parts = [
    // hotel side (continues under / behind the buildings)
    slab(-400, wx, -0.3, H, -Z, RAMP.z0, 3), slab(-400, wx, -0.3, H, RAMP.z1, Z, 3),
    slab(-400, wx - RAMP.run, -0.3, H, RAMP.z0, RAMP.z1, 3),
    rampTop(wx - RAMP.run, H, SIDEWALK_W.x1, roadHeight(SIDEWALK_W.x1) + 0.005, RAMP.z0, RAMP.z1, 3),
    // park side
    slab(ex, SIDEWALK_E.x1, -0.3, H, -Z, RAMP.z0, 3), slab(ex, SIDEWALK_E.x1, -0.3, H, RAMP.z1, Z, 3),
    slab(ex + RAMP.run, SIDEWALK_E.x1, -0.3, H, RAMP.z0, RAMP.z1, 3),
    rampTop(SIDEWALK_E.x0, roadHeight(SIDEWALK_E.x0) + 0.005, ex + RAMP.run, H, RAMP.z0, RAMP.z1, 3),
  ].map((g) => (g.index ? g.toNonIndexed() : g));
  const mat = new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.88 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.odPavers = { value: pavers };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOdW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvOdW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOdW;\nuniform sampler2D odPavers;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // brick-paver bands in front of some hotels
          float zi = floor((vOdW.z + 7.0) / 23.0);
          float on = step(0.45, fract(sin(zi * 12.9898) * 43758.5453)) * step(vOdW.x, -27.4) * step(-31.0, vOdW.x) * step(${(CURB_HEIGHT - 0.01).toFixed(3)}, vOdW.y);
          vec4 pv = texture2D(odPavers, vOdW.xz / 1.2);
          float edge = step(abs(vOdW.x + 27.4), 0.08);
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(pv.rgb, vec3(0.55, 0.5, 0.45), edge), on);
        }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        #ifdef USE_FOG
        { vec3 odVd = normalize(vFogOffset);
          float odAway = smoothstep(0.2, -1.0, dot(normalize(odVd.xz + 1e-5), normalize(OD_SUN.xz))) * (1.0 - abs(odVd.y));
          // rough concrete under a grazing sun: stronger back-scatter, crisp shadow bands
          reflectedLight.directDiffuse *= 2.2 + 0.6 * odAway;
          vec3 odI = reflectedLight.indirectDiffuse;
          reflectedLight.indirectDiffuse = mix(odI, vec3(dot(odI, vec3(0.2126, 0.7152, 0.0722))), 0.2) * 0.8; }
        #endif`);
  };
  mat.customProgramCacheKey = () => 'street-sidewalk-v2';
  const m = new THREE.Mesh(mergeGeometries(parts), mat);
  m.receiveShadow = true;

  // yellow tactile warning panels (truncated domes) at the foot of each ramp
  const T = 256, [tv, tc] = canvas(T);
  tc.fillStyle = '#d9b23c'; tc.fillRect(0, 0, T, T);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const x = (i + 0.5) * 32, y = (j + 0.5) * 32;
    const g = tc.createRadialGradient(x - 3, y - 3, 1, x, y, 11);
    g.addColorStop(0, '#f6da78'); g.addColorStop(0.7, '#d4ac36'); g.addColorStop(1, '#8a6a1c');
    tc.fillStyle = g; tc.beginPath(); tc.arc(x, y, 11, 0, 6.28); tc.fill();
  }
  const tMap = tex(tv);
  const hw = SIDEWALK_W.x1, e0 = SIDEWALK_E.x0, rise = 0.61 * H / (RAMP.run + CURB_W);
  const tg = mergeGeometries([
    rampTop(hw - 0.61, roadHeight(hw) + 0.012 + rise, hw, roadHeight(hw) + 0.012, RAMP.z0 + 0.2, RAMP.z1 - 0.2, 0.6),
    rampTop(e0, roadHeight(e0) + 0.012, e0 + 0.61, roadHeight(e0) + 0.012 + rise, RAMP.z0 + 0.2, RAMP.z1 - 0.2, 0.6),
  ]);
  const tm = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: tMap, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  tm.receiveShadow = true;
  return [m, tm, concrete];
}

// ---------------------------------------------------------------------------
// Curbs with rounded top edges + gutter pans, faded painted segments, split at the ramps.
function curbs(concrete) {
  const pos = [], col = [], uv = [], idx = [];
  const color = new THREE.Color();
  const CON = new THREE.Color(0xd6cbbb), GUT = new THREE.Color(0xc9beae);
  const YEL = new THREE.Color(0xf0c21c), RED = new THREE.Color(0xc23a2c);
  const rnd = mulberry32(101);
  // profile (s = +1: hotel curb whose face looks +x; -1 park curb), [dx from face, y]
  const prof = (s, face) => {
    const gx = face + s * GUTTER_W;
    return [
      [gx, roadHeight(gx) + 0.004, 'g'], [face + s * 0.02, roadHeight(face) + 0.004, 'g'],
      [face, 0.0, 'c'], [face - s * 0.008, CURB_HEIGHT - 0.03, 'c'], [face - s * 0.02, CURB_HEIGHT - 0.008, 'c'],
      [face - s * 0.04, CURB_HEIGHT, 'c'], [face - s * CURB_W, CURB_HEIGHT, 'c'],
    ];
  };
  const run = (s, face, z0, z1, paint) => {
    const P = prof(s, face);
    const b = pos.length / 3;
    for (let i = 0; i < P.length; i++) {
      const [x, y, k] = P[i];
      color.copy(k === 'g' ? GUT : CON);
      if (k === 'c' && paint && i > 1) color.lerp(paint, rnd() < 0.12 ? 0.35 : 0.92);   // chipped here and there
      for (const z of [z0, z1]) { pos.push(x, y, z); col.push(color.r, color.g, color.b); uv.push(z / 3, i * 0.05); }
      if (i < P.length - 1) {
        const a = b + i * 2;
        if (s < 0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  };
  for (const [s, face] of [[1, SIDEWALK_W.x1], [-1, SIDEWALK_E.x0]]) {
    // split into 3 m pieces near the block (random faded paint), long runs beyond
    run(s, face, -Z, -300, null);
    run(s, face, 300, Z, null);
    for (let z = -300; z < 300; z += 3) {
      const z1 = z + 3;
      if (z1 > RAMP.z0 && z < RAMP.z1) {
        if (z < RAMP.z0) run(s, face, z, RAMP.z0, null);
        if (z1 > RAMP.z1) run(s, face, RAMP.z1, z1, null);
        continue;
      }
      const near = Math.abs(z - CROSSWALK_Z) < 12;
      const paint = near ? RED : YEL;
      run(s, face, z, z1, paint);
    }
    // gutter pan through the ramp opening
    const P = prof(s, face);
    const b = pos.length / 3;
    for (const i of [0, 1]) for (const z of [RAMP.z0, RAMP.z1]) { pos.push(P[i][0], P[i][1], z); color.copy(GUT); col.push(color.r, color.g, color.b); uv.push(z / 3, 0); }
    if (s < 0) idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); else idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: concrete, vertexColors: true, roughness: 0.85 }));
  m.receiveShadow = true;
  m.castShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Street furniture, merged into one vertex-coloured mesh.
function colored(g, hex) {
  g = g.index ? g.toNonIndexed() : g;
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const cyl = (r0, r1, h, seg, y, hex) => colored(new THREE.CylinderGeometry(r1, r0, h, seg).translate(0, y + h / 2, 0), hex);
const box = (w, h, d, x, y, z, hex) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), hex);

function lampGeo() {
  const M = 0x28332f, G = 0xf1ece0;
  return mergeGeometries([
    box(0.46, 0.14, 0.46, 0, 0, 0, M),
    cyl(0.2, 0.16, 0.55, 12, 0.14, M),             // fluted base
    cyl(0.19, 0.19, 0.04, 16, 0.69, M),
    cyl(0.075, 0.055, 3.6, 10, 0.72, M),           // pole
    cyl(0.085, 0.085, 0.05, 12, 2.2, M),
    cyl(0.09, 0.09, 0.06, 12, 4.25, M),
    cyl(0.1, 0.2, 0.12, 12, 4.3, M),               // lantern seat
    cyl(0.2, 0.23, 0.5, 16, 4.42, G),              // frosted glass (off)
    cyl(0.25, 0.25, 0.04, 16, 4.92, M),
    cyl(0.26, 0.06, 0.24, 16, 4.96, M),            // stepped Deco cap
    colored(new THREE.SphereGeometry(0.06, 8, 6).translate(0, 5.24, 0), M),
  ]);
}
function payStationGeo() {
  return mergeGeometries([
    box(0.32, 0.9, 0.24, 0, 0, 0, 0x3b4046),
    box(0.4, 0.55, 0.3, 0, 0.9, 0, 0x4a5058),
    box(0.26, 0.2, 0.02, 0, 1.18, 0.155, 0x6f8fa8),  // screen
    box(0.28, 0.08, 0.02, 0, 1.0, 0.155, 0xc9c4b0),  // keypad
    box(0.44, 0.05, 0.34, 0, 1.45, 0, 0x2f3338),
  ]);
}
function trashGeo() {
  return mergeGeometries([
    cyl(0.28, 0.3, 0.85, 20, 0, 0x2f4a3e),
    cyl(0.31, 0.31, 0.05, 20, 0.85, 0x3a3f3c),
    colored(new THREE.SphereGeometry(0.3, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1).translate(0, 0.9, 0), 0x3a3f3c),
  ]);
}
function hydrantGeo() {
  return mergeGeometries([
    cyl(0.16, 0.16, 0.06, 12, 0, 0xc9a02a),
    cyl(0.12, 0.11, 0.5, 12, 0.06, 0xd8ac2c),
    colored(new THREE.SphereGeometry(0.12, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.56, 0), 0xc23a2e),
    colored(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 8).rotateZ(Math.PI / 2).translate(0, 0.38, 0), 0xd8ac2c),
    colored(new THREE.CylinderGeometry(0.065, 0.065, 0.12, 8).rotateX(Math.PI / 2).translate(0, 0.36, 0.12), 0xd8ac2c),
  ]);
}
function bikeRackGeo() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, -0.3), new THREE.Vector3(0, 0.75, -0.28), new THREE.Vector3(0, 0.85, 0), new THREE.Vector3(0, 0.75, 0.28), new THREE.Vector3(0, 0, 0.3),
    ]);
    parts.push(colored(new THREE.TubeGeometry(path, 16, 0.025, 6).translate((i - 1) * 0.7, 0, 0), 0xa9aca8));
  }
  return mergeGeometries(parts);
}
function benchGeo() {
  // faces +x: slats seat and back, cast-iron end frames
  const W = 0x7c6a58, I = 0x3a3d3b, parts = [];
  for (let i = 0; i < 4; i++) parts.push(box(0.09, 0.035, 1.8, -0.12 + i * 0.11, 0.44, 0, W));
  for (let i = 0; i < 3; i++) parts.push(colored(new THREE.BoxGeometry(0.03, 0.09, 1.8).rotateZ(0.2).translate(-0.28 - i * 0.02, 0.6 + i * 0.12, 0), W));
  for (const z of [-0.8, 0.8]) {
    parts.push(box(0.5, 0.05, 0.05, 0, 0.4, z, I), box(0.05, 0.44, 0.05, 0.18, 0, z, I), box(0.05, 0.44, 0.05, -0.18, 0, z, I));
    parts.push(colored(new THREE.BoxGeometry(0.04, 0.5, 0.05).rotateZ(0.2).translate(-0.3, 0.65, z), I));
    parts.push(box(0.06, 0.05, 0.05, 0.22, 0.6, z, I));
  }
  return mergeGeometries(parts);
}
function drainGeo(s) {
  // gutter grate + dark curb-opening throat (s: +1 hotel curb, -1 park curb)
  const parts = [box(0.5, 0.02, 0.9, s * 0.25, -0.01, 0, 0x2a2a28)];
  for (let i = 0; i < 6; i++) parts.push(box(0.46, 0.012, 0.035, s * 0.25, 0.006, -0.38 + i * 0.152, 0x55544f));
  parts.push(box(0.012, 0.1, 1.1, s * 0.004, 0.01, 0, 0x1a1a19));
  return mergeGeometries(parts);
}
function manholeGeo() {
  const parts = [cyl(0.34, 0.34, 0.012, 24, 0, 0x4a4843)];
  for (let r = 0.08; r < 0.32; r += 0.07) parts.push(colored(new THREE.TorusGeometry(r, 0.008, 3, 24).rotateX(Math.PI / 2).translate(0, 0.013, 0), 0x5c5a54));
  return mergeGeometries(parts);
}
function newsBoxGeo(hex) {
  return mergeGeometries([
    box(0.46, 0.35, 0.4, 0, 0, 0, 0x2c2e30),
    box(0.5, 0.62, 0.44, 0, 0.35, 0, hex),
    box(0.36, 0.26, 0.02, 0, 0.62, 0.225, 0x9aa6ae),   // window
    box(0.52, 0.04, 0.46, 0, 0.97, 0, 0x2c2e30),
  ]);
}
function valetGeo() {
  return mergeGeometries([
    box(0.55, 1.0, 0.42, 0, 0, 0, 0x4a3524),
    colored(new THREE.BoxGeometry(0.62, 0.05, 0.5).rotateX(-0.25).translate(0, 1.05, 0), 0x2c2016),
    box(0.57, 0.08, 0.44, 0, 0.0, 0, 0x1e1a16),
  ]);
}
function signPostGeo(h) {
  return mergeGeometries([cyl(0.035, 0.035, h, 8, 0, 0x8d908c), cyl(0.05, 0.05, 0.05, 8, h, 0x8d908c)]);
}

// Walk colliders for street furniture: { x, z, r } circles or { min, max } boxes.
export const STREET_COLLIDERS = [];

// col: a radius (m) for a post-like circle, 'box' for the footprint of the piece
function place(list, g, x, y, z, rotY = 0, col) {
  const c = g.clone().rotateY(rotY).translate(x, y, z);
  list.push(c);
  if (typeof col === 'number') STREET_COLLIDERS.push({ x, z, r: col });
  else if (col === 'box') {
    c.computeBoundingBox();
    const b = c.boundingBox;
    STREET_COLLIDERS.push({ min: { x: b.min.x, y: b.min.y, z: b.min.z }, max: { x: b.max.x, y: b.max.y, z: b.max.z } });
  }
}

function furniture() {
  const rnd = mulberry32(111);
  const palmNear = (x, z, d) => PALM_TREES.some((t) => Math.hypot(t.x - x, t.z - z) < d);
  const L = [];
  const lamp = lampGeo(), pay = payStationGeo(), trash = trashGeo(), hyd = hydrantGeo(), rack = bikeRackGeo(), bench = benchGeo();
  const drainW = drainGeo(1), drainE = drainGeo(-1), manhole = manholeGeo();
  const newsB = newsBoxGeo(0x2f64a8), newsR = newsBoxGeo(0xb3372e), valet = valetGeo();
  const H = CURB_HEIGHT;
  const hx = SIDEWALK_W.x1 - 0.55, px = SIDEWALK_E.x0 + 0.55;
  for (let z = -290; z <= 290; z += 32) {
    for (const [x, zz] of [[px, z], [hx, z + 16]]) {
      let q = zz;
      while (palmNear(x, q, 3.2)) q += 1.2;
      if (Math.abs(q - CROSSWALK_Z) < 3) q += 4;
      place(L, lamp, x, H, q, 0, 0.14);
      if (rnd() < 0.55) place(L, trash, x, H, q + 1.6 * (rnd() < 0.5 ? 1 : -1), 0, 0.3);
    }
  }
  // parking pay stations on the hotel side, bike racks near hotel entrances
  for (let z = -270; z <= 270; z += 42 + rnd() * 10) {
    let q = z;
    while (palmNear(hx, q, 1.4) || Math.abs(q - CAR.z) < 3) q += 1.5;
    place(L, pay, hx + 0.05, H, q, -Math.PI / 2, 'box');
  }
  for (const z of [-58, -19, 27, 61]) place(L, rack, SIDEWALK_W.x1 - 1.1, H, z, 0, 'box');
  // hotel-side bins, a valet stand at an entrance, news boxes, an extra pay kiosk
  for (const z of [16, 4, -21, -47]) { let q = z; while (palmNear(hx, q, 1.2)) q += 1; place(L, trash, hx - 0.1, H, q, 0, 0.3); }
  place(L, valet, -26.9, H, 25.5, Math.PI / 2, 'box');
  place(L, newsB, SIDEWALK_W.x1 - 1.3, H, 13.2, -Math.PI / 2, 'box');
  place(L, newsR, SIDEWALK_W.x1 - 1.3, H, 13.8, -Math.PI / 2, 'box');
  place(L, pay, hx + 0.05, H, 20.5, -Math.PI / 2, 'box');
  // hydrants
  for (const [x, z] of [[hx + 0.15, -33], [hx + 0.15, 22], [px - 0.15, -8], [px - 0.15, 46], [hx + 0.15, -110], [px - 0.15, 120]]) place(L, hyd, x, H, z, 0, 0.2);
  // benches in the park facing the sea, just east of the promenade
  for (let z = -150; z <= 150; z += 9 + rnd() * 22) {
    const x = promenadeX(z) + 2.8 + rnd() * 1.4;
    if (palmNear(x, z, 1.8) || x > PARK.x1 - 1 || rnd() < 0.2) continue;
    place(L, bench, x, H, z, (rnd() - 0.5) * 0.2, 'box');
  }
  // storm drains at both curbs, manholes in the lanes
  for (let z = -280; z <= 280; z += 45) {
    if (Math.abs(z - CAR.z) > 3.5 && Math.abs(z - CROSSWALK_Z) > 3) place(L, drainW, SIDEWALK_W.x1, 0, z + 5);
    if (Math.abs(z + 20 - CROSSWALK_Z) > 3) place(L, drainE, SIDEWALK_E.x0, 0, z + 20);
  }
  for (let z = -270; z <= 270; z += 55 + rnd() * 20) {
    const x = LANE_C[rnd() < 0.5 ? 0 : 1] + (rnd() - 0.5) * 1.2;
    place(L, manhole, x, roadHeight(x) + 0.002, z);
  }
  // sign posts at the crosswalk corners, regulation signs along the parking lane
  const posts = [[SIDEWALK_W.x1 - 0.35, CW.z0 - 0.6], [SIDEWALK_E.x0 + 0.35, CW.z1 + 0.6]];
  for (const [x, z] of posts) place(L, signPostGeo(3.2), x, H, z, 0, 0.08);
  const regs = [[SIDEWALK_W.x1 - 0.35, -12], [SIDEWALK_W.x1 - 0.35, 36], [SIDEWALK_W.x1 - 0.35, 74]];
  for (const [x, z] of regs) place(L, signPostGeo(2.4), x, H, z, 0, 0.08);

  const m = new THREE.Mesh(mergeGeometries(L), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 }));
  m.castShadow = m.receiveShadow = true;
  return [m, signs(posts, regs)];
}

// Sign blades (text on a canvas atlas): street names at the crosswalk, parking rules.
function signs(posts, regs) {
  const [cv, c] = canvas(1024, 512);
  const blade = (y, text) => {
    c.fillStyle = '#1f6b45'; c.fillRect(0, y, 1024, 128);
    c.strokeStyle = '#f2f2ea'; c.lineWidth = 6; c.strokeRect(8, y + 8, 1008, 112);
    c.fillStyle = '#f4f4ee'; c.font = 'bold 84px Arial, Helvetica, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 512, y + 66);
  };
  blade(0, 'OCEAN DR');
  blade(128, '9 ST');
  // regulation sign (white): 256 wide x 256 tall at the bottom left
  c.fillStyle = '#f2f1ea'; c.fillRect(0, 256, 256, 256);
  c.strokeStyle = '#b02a26'; c.lineWidth = 8; c.strokeRect(10, 266, 236, 236);
  c.fillStyle = '#b02a26'; c.font = 'bold 44px Arial, sans-serif'; c.textAlign = 'center';
  c.fillText('2 HOUR', 128, 318); c.fillText('PARKING', 128, 366);
  c.fillStyle = '#222'; c.font = 'bold 30px Arial, sans-serif';
  c.fillText('9AM - 6PM', 128, 420); c.fillText('PAY AT METER', 128, 462);
  // pedestrian crossing (yellow-green diamond) at 256..512
  c.fillStyle = '#c8d63a';
  c.beginPath(); c.moveTo(384, 262); c.lineTo(506, 384); c.lineTo(384, 506); c.lineTo(262, 384); c.closePath(); c.fill();
  c.strokeStyle = '#222'; c.lineWidth = 6; c.stroke();
  c.fillStyle = '#222'; c.beginPath(); c.arc(384, 330, 14, 0, 6.28); c.fill();
  c.lineWidth = 12; c.beginPath(); c.moveTo(384, 346); c.lineTo(380, 400); c.lineTo(360, 450); c.moveTo(380, 400); c.lineTo(404, 448); c.moveTo(356, 372); c.lineTo(408, 380); c.stroke();
  // valet sign (512..768 x 256..512)
  c.fillStyle = '#20302a'; c.fillRect(512, 256, 256, 256);
  c.strokeStyle = '#d9c28a'; c.lineWidth = 6; c.strokeRect(522, 266, 236, 236);
  c.fillStyle = '#efe6cc'; c.font = 'bold 58px Georgia, serif'; c.textAlign = 'center';
  c.fillText('VALET', 640, 360); c.font = 'bold 34px Georgia, serif'; c.fillText('PARKING', 640, 420);
  const map = tex(cv);
  const quad = (w, h, u0, v0, u1, v1) => {
    // double-sided with readable text on both faces
    const g = new THREE.BufferGeometry();
    const p = [-w / 2, -h / 2, 0.012, w / 2, -h / 2, 0.012, -w / 2, h / 2, 0.012, w / 2, h / 2, 0.012,
      w / 2, -h / 2, -0.012, -w / 2, -h / 2, -0.012, w / 2, h / 2, -0.012, -w / 2, h / 2, -0.012];
    const uv = [u0, v0, u1, v0, u0, v1, u1, v1, u0, v0, u1, v0, u0, v1, u1, v1];
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex([0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6]);
    g.computeVertexNormals();
    return g;
  };
  const L = [];
  const H = CURB_HEIGHT;
  for (const [x, z] of posts) {
    L.push(quad(0.9, 0.18, 0, 1, 1, 0.75).rotateY(Math.PI / 2).translate(x, H + 3.05, z));       // OCEAN DR, along the street
    L.push(quad(0.6, 0.18, 0.2, 0.75, 0.8, 0.5).translate(x, H + 2.84, z));                      // 9 ST, across it
    L.push(quad(0.6, 0.6, 0.25, 0.5, 0.5, 0).rotateY(x < LANES.centerX ? Math.PI / 2 : -Math.PI / 2).translate(x, H + 2.2, z));
  }
  for (const [x, z] of regs) L.push(quad(0.45, 0.45, 0, 0.5, 0.25, 0).rotateY(Math.PI / 2).translate(x, H + 2.1, z));
  // valet A-frame sign on the sidewalk
  for (const s of [-1, 1]) L.push(quad(0.55, 0.8, 0.5, 0.5, 0.75, 0).rotateX(s * 0.18).rotateY(Math.PI / 2 * (s > 0 ? 1 : -1)).translate(-25.4 + s * 0.07, H + 0.4, 24.3));
  const m = new THREE.Mesh(mergeGeometries(L), new THREE.MeshStandardMaterial({ map, roughness: 0.5, metalness: 0.1 }));
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function buildStreet(scene) {
  const group = new THREE.Group();
  group.name = 'street';
  const [walks, tactile, concrete] = sidewalks();
  group.add(roadMesh(), markings(), walks, tactile, curbs(concrete), ...furniture());
  scene.add(group);
  return group;
}
