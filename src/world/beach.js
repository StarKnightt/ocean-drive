// Beach: pale quartz sand with footprint-churned micro relief (baked with its own
// low-sun shadows so the 7 deg light rakes across every footprint), beach-cleaner rake
// lines by the park wall, a lifeguard-truck tire track, the sargassum wrack line,
// dry -> damp -> wet sand, the swash sheet with lace foam riding the shared surf clock,
// dune grass by the wall, a walkable Miami-Beach lifeguard tower and a few props.
//
// Walking API (returned by buildBeach, also on window.__beach):
//   heightAt(x, z, currentY)  walkable surface height (deck / stairs when reachable
//                             from currentY, otherwise the ground)
//   groundAt(x, z)            ground height (sand micro-relief included)
//   colliders                 [{ min: {x,y,z}, max: {x,y,z} }] world AABBs (posts,
//                             cabin, railings, stair rails, props)
//   swashAt(x, z, t?)         { covered, depth, foam, front, fresh } of the swash sheet
//   waterDepthAt(x, z, t?)    water depth over the ground (swash or sea), 0 = dry
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  SAND, SEA_LEVEL, SHORE_X, BREAK_X, WET_LINE_X, TOWER, TOWERS, PARK, SAND_DETAIL_Z, DISTRICT,
  sandHeight, sandDetail, groundHeight, compassToDir, SUN,
} from './layout.js';
import { SKY_FULL_GLSL, FOG_FN_GLSL } from '../sky.js';
import { SURF_GLSL, FOAM_GLSL } from './surf.js';
import { mulberry32 } from '../textures/noise.js';
import { QUALITY } from '../quality.js';

const DETAIL_TILE = 6;   // m covered by one tile of the micro-relief texture
// beach access through the seawall: steps up from the lawn, over the cap, onto the sand
export const ACCESS_Z = [-30, 32];
// one more access per block of the extended district
export const MORE_ACCESS_Z = [-322, -245, -134, 134, 245, 322];
const ALL_ACCESS_Z = [...ACCESS_Z, ...MORE_ACCESS_Z];
const ACCESS_HALF = 1.2;
const WALL = { x0: PARK.wallX - 0.3, x1: PARK.wallX + 0.4, top: 0.68 };
const STEPS = [[10.8, 11.1, 0.33], [11.1, 11.4, 0.5], [11.4, 12.55, 0.7]];   // x0, x1, top
const nearAccess = (z, pad = 0) => ALL_ACCESS_Z.some((a) => Math.abs(z - a) < ACCESS_HALF + pad);
const nearOrigAccess = (z, pad = 0) => ACCESS_Z.some((a) => Math.abs(z - a) < ACCESS_HALF + pad);
const nearMoreAccess = (z, pad = 0) => MORE_ACCESS_Z.some((a) => Math.abs(z - a) < ACCESS_HALF + pad);

// ---------------------------------------------------------------------------
// churned-sand bake: R,G = slope (dh/dx, dh/dz), B = lit fraction under the fixed
// sunrise sun (self-shadowing), A = albedo variation. Footprints are procedural.

function periodicNoise(N, cells, rnd) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const fy = (j / N) * cells, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
    const r0 = y0 % cells, r1 = (y0 + 1) % cells;
    for (let i = 0; i < N; i++) {
      const fx = (i / N) * cells, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
      const c0 = x0 % cells, c1 = (x0 + 1) % cells;
      const a = g[r0 * cells + c0] + (g[r0 * cells + c1] - g[r0 * cells + c0]) * sx;
      const b = g[r1 * cells + c0] + (g[r1 * cells + c1] - g[r1 * cells + c0]) * sx;
      out[j * N + i] = a + (b - a) * sy;
    }
  }
  return out;
}

function bakeSandDetail(N = 1024) {
  const rnd = mulberry32(5150);
  const texel = DETAIL_TILE / N;
  const H = new Float32Array(N * N);
  // churned sand: several octaves of tileable noise
  for (const [cells, amp] of [[6, 0.014], [14, 0.007], [32, 0.0035], [80, 0.0015]]) {
    const n = periodicNoise(N, cells, rnd);
    for (let i = 0; i < H.length; i++) H[i] += (n[i] - 0.5) * 2 * amp;
  }
  // slopes
  const data = new Uint8Array(N * N * 4);
  const at = (i, j) => H[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const sx = (at(i + 1, j) - at(i - 1, j)) / (2 * texel);
    const sz = (at(i, j + 1) - at(i, j - 1)) / (2 * texel);
    const o = (j * N + i) * 4;
    data[o] = Math.round(128 + Math.max(-1, Math.min(1, sx)) * 127);
    data[o + 1] = Math.round(128 + Math.max(-1, Math.min(1, sz)) * 127);
  }
  // self-shadowing under the fixed low sun
  const L = compassToDir(SUN.azimuthDeg, SUN.elevationDeg, new THREE.Vector3());
  const lx = L.x / Math.hypot(L.x, L.z), lz = L.z / Math.hypot(L.x, L.z);
  const rise = Math.tan((SUN.elevationDeg * Math.PI) / 180) * texel * 2;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const h0 = H[j * N + i];
    let occ = 0;
    for (let s = 1; s <= 30; s++) {
      const hh = at(Math.round(i + lx * s * 2), Math.round(j + lz * s * 2));
      const d = hh - (h0 + rise * s + 0.0004);
      if (d > occ) occ = d;
    }
    data[(j * N + i) * 4 + 2] = Math.round(255 * (1 - smooth(0, 0.004, occ)));
  }
  // albedo: soft mottling, dark mineral grains, pale shell bits
  const mott = periodicNoise(N, 24, rnd);
  for (let i = 0; i < N * N; i++) data[i * 4 + 3] = Math.round(255 * (0.5 + (mott[i] - 0.5) * 0.35));
  for (let k = 0; k < 5000; k++) data[Math.floor(rnd() * N * N) * 4 + 3] = 60 + rnd() * 50;
  for (let k = 0; k < 220; k++) {
    const ci = Math.floor(rnd() * N), cj = Math.floor(rnd() * N), r = 1 + rnd() * 2.2;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
      if (di * di + dj * dj > r * r) continue;
      data[((((cj + dj) % N) + N) % N * N + (((ci + di) % N) + N) % N) * 4 + 3] = 240;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
function smooth(a, b, v) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// sand surface

function sandGeometry(zA, zB, rows, detail) {
  const xs = [];
  for (let x = SAND.x0; x < 100; x += 0.5) xs.push(x);
  for (let x = 100; x <= 132; x += 2) xs.push(x);
  const nx = xs.length, nz = rows + 1;
  const pos = new Float32Array(nx * nz * 3);
  let o = 0;
  for (let j = 0; j < nz; j++) {
    const z = zA + ((zB - zA) * j) / rows;
    for (let i = 0; i < nx; i++) {
      const x = xs[i];
      pos[o++] = x; pos[o++] = sandHeight(x) + (detail ? sandDetail(x, z) : 0); pos[o++] = z;
    }
  }
  const idx = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function sandMaterial(detailTex, surf) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xe6d8c2, roughness: 0.95 });
  const f = (v) => v.toFixed(3);
  const L = compassToDir(SUN.azimuthDeg, SUN.elevationDeg, new THREE.Vector3());
  const tanEl = Math.tan((SUN.elevationDeg * Math.PI) / 180);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detailTex };
    Object.assign(shader.uniforms, surf.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOdW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvOdW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vOdW;
        uniform sampler2D uDetail;
        ${SURF_GLSL}
        const vec3 SD_SUN = vec3(${f(L.x)}, ${f(L.y)}, ${f(L.z)});
        // Footprints: one candidate per hashed cell (random offset, heading, size, depth),
        // two scales (fresh prints, old wind-softened ones); nothing repeats.
        float sdShoe(vec2 d, float ang) {
          float c = cos(ang), s = sin(ang);
          float u = d.x * c + d.y * s, v = -d.x * s + d.y * c;
          float r = min(length(vec2((u + 0.07) / 0.06, v / 0.05)), length(vec2((u - 0.06) / 0.08, v / 0.06)));
          r *= 0.85 + 0.3 * surfN(d * 23.0 + ang);   // collapsed, ragged walls
          return -(1.0 - smoothstep(0.0, 1.7, r)) + 0.25 * exp(-pow((r - 1.7) / 0.5, 2.0)) * (u > 0.0 ? 1.3 : 0.7);
        }
        float sdPrints(vec2 p, float cell, float dens, float seed, float depthK, float scaleK) {
          vec2 g = p / cell;
          vec2 c0 = floor(g - 0.5);
          float h = 0.0;
          for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
            vec2 c = c0 + vec2(float(i), float(j));
            float r0 = surfHash(c + seed);
            if (r0 > dens) continue;
            vec2 o = vec2(surfHash(c + seed + 1.7), surfHash(c + seed + 3.1)) * 0.5 + 0.25;
            float ang = surfHash(c + seed + 5.3) * 6.2832;
            float sc = scaleK * (0.85 + 0.3 * surfHash(c + seed + 7.9));
            float dp = depthK * (0.5 + 0.5 * surfHash(c + seed + 9.4));
            h += dp * sdShoe((p - (c + o) * cell) / sc, ang);
          }
          return h;
        }
        float sdH(vec2 p, float busy) {
          return sdPrints(p, 0.85, 0.6 * busy, 11.0, 0.013, 1.35) + sdPrints(p + 0.37, 1.6, 0.5 * busy, 47.0, 0.008, 1.8);
        }
        // trodden paths: from the beach accesses to the tower and on to the water, wandering
        float odSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
        float odPaths(vec2 p) {
          vec2 q = p + vec2(0.0, (surfN(p * 0.045) - 0.5) * 9.0);
          float d = min(odSeg(q, vec2(13.0, -30.0), vec2(45.0, 5.0)), odSeg(q, vec2(13.0, 32.0), vec2(45.0, 5.0)));
          d = min(d, min(odSeg(q, vec2(45.0, 5.0), vec2(90.0, -3.0)), odSeg(q, vec2(13.0, -30.0), vec2(86.0, -48.0))));
          d = min(d, odSeg(q, vec2(13.0, 32.0), vec2(86.0, 50.0)));
          return exp(-d * d / 12.0);
        }
        // low-frequency lumps of churned sand (m)
        float odLumps(vec2 p) { return (surfN(p * 1.7) * 0.5 + surfN(p * 0.55 + 3.0) + surfN(p * 4.3 + 7.0) * 0.2) * 0.022; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float odX = vOdW.x, odZ = vOdW.z;
        // churned sand: the baked tile at two rotated scales so it never visibly repeats
        vec2 odP2 = mat2(0.8, 0.6, -0.6, 0.8) * vOdW.xz;
        vec4 odDa = texture2D(uDetail, vOdW.xz / ${f(DETAIL_TILE)});
        vec4 odDb = texture2D(uDetail, odP2 / ${f(DETAIL_TILE * 0.71)} + 0.31);
        // zones: dry -> damp band -> wet (swash reach) -> glassy strip at the water
        float odWl = ${f(WET_LINE_X)} + 0.5 * sin(odZ * 0.21) + 0.3 * sin(odZ * 0.83 + 1.3);
        float odWet = smoothstep(odWl - 0.1, odWl + 0.1, odX);
        float odDamp = smoothstep(odWl - 3.5, odWl - 0.2, odX);
        float odGlass = smoothstep(${f(SHORE_X - 2.4)}, ${f(SHORE_X - 1.0)}, odX + 0.4 * sin(odZ * 0.37));
        float odRake = smoothstep(${f(SAND.x0 + 0.5)}, ${f(SAND.x0 + 1.0)}, odX) * (1.0 - smoothstep(${f(SAND.x0 + 12)}, ${f(SAND.x0 + 14)}, odX));
        // relief strength: trodden dry sand > raked > damp > swash-smoothed wet sand
        float odBusy = smoothstep(0.2, 0.8, surfN(vOdW.xz * 0.07) * 0.7 + surfN(vOdW.xz * 0.23 + 5.0) * 0.4) * (0.3 + 0.7 * odPaths(vOdW.xz)) + 0.15;
        float odW = mix(1.0, 0.35, odRake) * (1.0 - 0.3 * odDamp) * (1.0 - 0.75 * odWet);
        float odPrintK = (0.25 + 0.75 * odBusy) * (1.0 - odRake * 0.8) * (1.0 - odWet);
        diffuseColor.rgb *= 0.8 + 0.4 * (odDa.a * 0.5 + odDb.a * 0.5);
        // sargassum wrack line: a continuous red-brown band above the swash, clumpy
        float odWx = ${f(WET_LINE_X - 0.9)} + 0.5 * sin(odZ * 0.047) + 0.25 * sin(odZ * 0.19 + 1.0);
        float odWd = abs(odX - odWx - 0.35 * (surfN(vec2(odZ * 0.5, 1.0)) - 0.5)) / (0.1 + 0.22 * surfN(vec2(odZ * 0.13, 3.0)));
        float odFib = max(smoothstep(0.6, 0.85, surfN(vec2(odX * 11.0 + odZ * 4.0, odZ * 17.0 - odX * 6.0))),
                          smoothstep(0.6, 0.85, surfN(vec2(odX * 13.0 - odZ * 5.0, odZ * 15.0 + odX * 7.0) + 4.0)));
        float odWr = (1.0 - smoothstep(0.45, 1.0, odWd)) * smoothstep(0.3, 0.55, surfN(vec2(odZ * 0.3, 7.0))) * (0.25 + 0.75 * odFib);
        vec3 odWc = mix(vec3(0.17, 0.13, 0.06), vec3(0.42, 0.32, 0.14), surfN(vec2(odZ * 5.0, odX * 5.0)));
        diffuseColor.rgb = mix(diffuseColor.rgb, odWc, odWr);
        // tire tracks of the lifeguard truck
        float odTx = 57.0 + 4.0 * sin(odZ / 37.0) + 1.5 * sin(odZ / 13.0 + 1.0);
        float odT1 = abs(odX - odTx - 0.82), odT2 = abs(odX - odTx + 0.82);
        float odTd = min(odT1, odT2);
        float odTnear = 1.0 - smoothstep(${SAND_DETAIL_Z - 30}.0, ${SAND_DETAIL_Z}.0, abs(odZ));
        float odTrack = (1.0 - smoothstep(0.1, 0.15, odTd)) * odTnear;
        // moisture: darker damp band, dark wet sand, darkest glassy strip
        diffuseColor.rgb *= mix(1.0, 0.78, odDamp);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.45, 0.4), odWet);
        diffuseColor.rgb *= mix(1.0, 0.75, odGlass);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.5, odWet);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        {
          // Relief shading under the grazing sun, done as a factor on the sun term (not
          // by bending the lighting normal): dents get a dark sun-away side and long
          // 7 deg shadows but are never brighter than the flat sand around them.
          vec2 odS = ((odDa.rg - 0.5) + mat2(0.8, -0.6, 0.6, 0.8) * (odDb.rg - 0.5)) * 0.55 * odW;
          float odAa = 1.0 - smoothstep(0.15, 0.4, fwidth(odX) / 0.09);
          float odBand = 0.6 + 0.4 * sin(odZ * 0.02 + floor(odX / 2.3) * 1.7);
          odS.x += odRake * odAa * odBand * 0.4 * cos(6.2832 * odX / 0.09 + 0.6 * sin(odZ * 0.3));
          float odTs = sign(odX - odTx - 0.82) * (1.0 - smoothstep(0.02, 0.05, abs(odT1 - 0.13))) + sign(odX - odTx + 0.82) * (1.0 - smoothstep(0.02, 0.05, abs(odT2 - 0.13)));
          float odTaa = 1.0 - smoothstep(0.2, 0.5, fwidth(odZ) / 0.11);
          odS.x += odTs * 0.5 * odTnear;
          odS.y += odTrack * odTaa * 0.45 * cos(6.2832 * (odZ + odTd * 0.8) / 0.11);
          float odLit = odDa.b * odDb.b;
          {
            float le = 0.04, l0 = odLumps(vOdW.xz);
            odS += vec2(odLumps(vOdW.xz + vec2(le, 0.0)) - l0, odLumps(vOdW.xz + vec2(0.0, le)) - l0) / le * (1.0 - 0.7 * odWet) * (1.0 - 0.5 * odRake);
          }
          float odDist = length(vOdW - cameraPosition);
          float odNear = (1.0 - smoothstep(${f(QUALITY.printFade[0])}, ${f(QUALITY.printFade[1])}, odDist)) * odPrintK;
          float odDent = 0.0;
          if (odNear > 0.01) {
            vec2 p = vOdW.xz;
            float e = 0.012;
            float h0 = sdH(p, odBusy), hx = sdH(p + vec2(e, 0.0), odBusy), hz = sdH(p + vec2(0.0, e), odBusy);
            odS += vec2(hx - h0, hz - h0) / e * odNear;
            odDent = clamp(-h0 / 0.012, -0.4, 1.0) * odNear;
            // footprint shadows: march toward the sun
            vec2 ld = normalize(SD_SUN.xz);
            float occ = 0.0;
            for (int k = 1; k <= 4; k++) {
              float s = float(k * k) * 0.022;
              occ = max(occ, sdH(p + ld * s, odBusy) - (h0 + s * ${f(tanEl)} + 0.0008));
            }
            odLit *= 1.0 - smoothstep(0.0, 0.004, occ) * odNear;
          }
          vec3 odNg = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          vec3 odNd = normalize(odNg + vec3(-odS.x, 0.0, -odS.y));
          float odFlat = max(dot(odNg, SD_SUN), 0.04);
          float odRel = clamp(max(dot(odNd, SD_SUN), 0.0) / odFlat, 0.0, 1.08);
          reflectedLight.directDiffuse *= mix(1.0, odRel * mix(1.0, odLit, 0.92), min(1.0, odW + odNear));
          float odSkyRel = clamp(0.55 + 0.45 * odRel * mix(1.0, odLit, 0.5), 0.45, 1.15);
          reflectedLight.indirectDiffuse *= mix(1.0, odSkyRel, 0.7 * min(1.0, odW + odNear));
          reflectedLight.directDiffuse *= 1.0 - 0.22 * odDent;
          reflectedLight.indirectDiffuse *= 1.0 - 0.22 * odDent;
        }
        #ifdef USE_FOG
        {
          vec3 odVd = normalize(vFogOffset);
          float odG = dot(normalize(odVd.xz + 1e-5), normalize(OD_SUN.xz));
          float odGraze = 1.0 - abs(odVd.y);
          float odAway = smoothstep(0.2, -1.0, odG) * odGraze;
          // warm grains down-sun; the lilac sky fill is kept modest against the sun term
          reflectedLight.directDiffuse *= 1.0 + 0.8 * odAway;
          reflectedLight.indirectDiffuse *= vec3(0.7, 0.66, 0.63) * mix(1.0, 0.85, odAway);
          float odToward = smoothstep(0.0, 0.85, odG) * odGraze;
          reflectedLight.directDiffuse *= mix(vec3(1.0), vec3(0.5, 0.47, 0.55), odToward);
          reflectedLight.indirectDiffuse *= mix(vec3(1.0), vec3(0.72, 0.72, 0.9), odToward);
          reflectedLight.directSpecular *= (1.0 - smoothstep(0.0, 0.2, odWet)) * (1.0 - 0.9 * odToward);
          reflectedLight.indirectSpecular *= 1.0 - 0.85 * odToward * (1.0 - smoothstep(0.0, 0.3, odWet));
        }
        #endif`)
      // wet sand: glassy film mirroring the gold sky; a soft sun glow, no hard streak
      .replace('#include <opaque_fragment>', `
        #ifdef USE_FOG
        {
          vec3 odI = normalize(vFogOffset);
          float odNv = max(-odI.y, 0.02);
          vec3 odR = reflect(odI, vec3(0.0, 1.0, 0.0));
          float odF = 0.02 + 0.98 * pow(1.0 - odNv, 5.0);
          float odRefl = (odWet * (0.08 + 0.3 * odF) + odGlass * (0.3 + 0.5 * odF)) * (1.0 - 0.55 * smoothstep(0.4, 0.95, dot(normalize(odR.xz + 1e-5), normalize(OD_SUN.xz))));
          vec3 odRb = normalize(vec3(odR.x, odR.y * 0.6 + 0.01, odR.z));   // film ripples smear it toward the gold horizon
          outgoingLight = mix(outgoingLight, (odSkyBase(odRb, 0.0) - odSunGlow(dot(odRb, OD_SUN), 0.8, 0.0)) * 0.6, min(odRefl, 0.85));
          vec3 odV = -odI;
          vec3 odH = normalize(OD_SUN + odV);
          vec2 odFw = normalize(odI.xz + 1e-5);
          vec2 odRt = vec2(-odFw.y, odFw.x);
          float odSx = dot(odH.xz, odRt) / odH.y, odSz = dot(odH.xz, odFw) / odH.y;
          // broad, soft gold glow (the wet grains scatter the sun into a patch)
          float odGl = exp(-(odSx * odSx / (2.0 * 0.03 * 0.03) + odSz * odSz / (2.0 * 0.06 * 0.06)));
          float odSpk = smoothstep(0.55, 0.8, surfN(vOdW.xz * 41.0) * surfN(vOdW.xz * 97.0 + 3.0) * 1.9);
          vec3 odSp = directLight.color * vec3(1.0, 0.7, 0.42) * odGl * 0.3 * mix(0.3, 1.0, surfN(vOdW.xz * vec2(5.0, 12.0))) * odGlass * smoothstep(0.5, 0.95, odGlass);
          outgoingLight += odSp / (1.0 + dot(odSp, vec3(0.2126, 0.7152, 0.0722)) / 1.5);
        }
        #endif
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'beach-sand-v2';
  return mat;
}

// ---------------------------------------------------------------------------
// swash sheet: thin water with lace foam sliding up the sand and back

function swashSheet(surf) {
  const x0 = SHORE_X - 5.8, x1 = SHORE_X + 1.8, nx = 90, zl = 130, nz = 130;
  const pos = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + ((x1 - x0) * i) / nx, z = -zl + (2 * zl * j) / nz;
    pos.push(x, Math.max(sandHeight(x), SEA_LEVEL - 0.05) + 0.012, z);
  }
  const idx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    name: 'Swash', fog: true, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
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
      varying vec3 vWorld;
      #ifdef USE_FOG
        varying vec3 vFogOffset;
        uniform float fogDensity;
      #endif
      ${SKY_FULL_GLSL}
      ${FOG_FN_GLSL}
      ${SURF_GLSL}
      ${FOAM_GLSL}
      void main() {
        float t = uSurfT;
        vec2 p = vWorld.xz;
        vec3 fr = surfFront(p.y, t);
        float s = p.x - fr.x;
        if (fr.x > 1e3 || s < -0.02) discard;
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        float fresh = fr.y;
        float depth = min(0.12, 0.012 + max(s, 0.0) * 0.022) * (0.35 + 0.65 * fresh);
        // flowing ripples: uprush toward the land, backwash seaward
        float dir = fresh > 0.999 ? -1.0 : 1.0;
        vec2 q = p * 1.2 + vec2(odNoise(p * 0.7 + 1.0), odNoise(p * 0.7 + 5.0)) * 1.8 + vec2(dir * t * 1.2, 0.0);
        float e = 0.05;
        float h0 = odNoise(q * 2.0), hx = odNoise((q + vec2(e, 0.0)) * 2.0), hz = odNoise((q + vec2(0.0, e)) * 2.0);
        vec3 n = normalize(vec3(-(hx - h0) / e * 0.03, 1.0, -(hz - h0) / e * 0.03));
        float nv = max(dot(n, V), 0.01);
        float F = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
        vec3 R = reflect(-V, n);
        R.y = abs(R.y) + 0.02;
        vec3 sky = odSky(normalize(R), 2.0);
        // glint of the low sun on the sheet
        vec3 H = normalize(OD_SUN + V);
        float nh = max(dot(n, H), 0.0);
        float spec = pow(nh, 400.0) * 5.0 * smoothstep(0.1, 0.5, s);
        vec3 col = sky * F * 0.8 + vec3(0.012, 0.02, 0.02) * (1.0 - F);
        float alpha = clamp(0.12 + 0.25 * smoothstep(0.0, 0.08, depth) + F * 0.6, 0.0, 0.9);
        // foam: bright lace at the leading edge, bubble trails behind, fading as it drains
        float lace = odFoam(p, t);
        float se = s + (odNoise(p * vec2(0.9, 2.3) + 3.0) - 0.5) * 0.3 + (odNoise(p * 6.0) - 0.5) * 0.08;
        float edge = exp(-max(se, 0.0) / (0.12 + 0.2 * fresh)) * smoothstep(-0.1, 0.06, se);
        // lacy leading edge, thin bubble trails behind it
        vec2 tq = p * 1.4 + vec2(odNoise(p * 0.6 + 2.0), odNoise(p * 0.6 + 6.0)) * 2.2;
        float trail = smoothstep(0.62, 0.9, odNoise(tq));
        float foam = max(edge * mix(0.3, 1.0, clamp(lace * 1.5, 0.0, 1.0)) * 0.9, max(lace, trail * 0.6) * exp(-max(s, 0.0) / 0.9) * 0.55);
        foam *= 0.35 + 0.65 * fresh;
        vec3 skyUp = odSky(vec3(0.0, 1.0, 0.0), 2.0);
        float foamL = dot(OD_SUNCOL * OD_SUN_I * 0.318 * 0.35 + skyUp * 1.1, vec3(0.2126, 0.7152, 0.0722));
        vec3 foamCol = vec3(1.0, 0.97, 0.92) * 0.85 * foamL * 1.6;
        col = mix(col, foamCol, foam);
        col += OD_SUNCOL * OD_SUN_I * vec3(1.0, 0.7, 0.4) * spec * (1.0 - foam) * 0.02;
        alpha = max(alpha * (1.0 - foam), foam);
        // a draining sheet thins out to nothing at its edge (the uprush keeps its foam line)
        alpha *= mix(smoothstep(-0.02, 0.18, s), 1.0, fresh) * smoothstep(-0.1, 0.04, se);
        // hand over to the sea past the shoreline
        alpha *= 1.0 - smoothstep(SURF_SHORE_X + 0.4, SURF_SHORE_X + 1.6, p.x);
        #ifdef USE_FOG
          col = odApplyFog(col, vFogOffset, fogDensity * 0.3);
        #endif
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  Object.assign(mat.uniforms, surf.uniforms);
  const m = new THREE.Mesh(g, mat);
  m.name = 'swash';
  m.frustumCulled = false;
  m.renderOrder = 2;
  return m;
}

// ---------------------------------------------------------------------------
// geometry helpers (vertex-coloured, merged)

function colorize(g, hex) {
  g = g.index ? g.toNonIndexed() : g;
  if (g.attributes.uv) g.deleteAttribute('uv');
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const boxAt = (x0, x1, y0, y1, z0, z1, hex) =>
  colorize(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), hex);
// a beam between two points (square section)
function beam(a, b, w, hex) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.BoxGeometry(w, len, w);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyQuaternion(q).translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return colorize(g, hex);
}

// round rail between two points
function tubeRail(a, b, r, hex) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(r, r, A.distanceTo(B), 10);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return colorize(g, hex);
}

// Painted plywood / fibreglass: board seams, salt-bleached chips showing grey wood,
// grime low down.
function paintedMaterial({ wear = 1, ...extra } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: wear ? 0.72 : 0.55, ...extra });
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPw;\nvarying vec3 vPn;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvPw = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvPn = normalize(mat3(modelMatrix) * objectNormal);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vPw;
        varying vec3 vPn;
        float pwH(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float pwN(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(pwH(i), pwH(i + vec2(1, 0)), u.x), mix(pwH(i + vec2(0, 1)), pwH(i + vec2(1, 1)), u.x), u.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 uvw = abs(vPn.x) > 0.5 ? vPw.zy : abs(vPn.z) > 0.5 ? vPw.xy : vPw.xz;
          float vert = 1.0 - abs(vPn.y);
          float seam = smoothstep(0.9, 0.97, fract(vPw.y / 0.15)) * vert * 0.22 * ${wear.toFixed(2)};
          float chip = smoothstep(0.82, 0.86, pwN(uvw * 31.0) * 0.6 + pwN(uvw * 97.0) * 0.5) * ${wear.toFixed(2)};
          float grime = (1.0 - smoothstep(0.0, 1.2, vPw.y - ${(sandHeight(TOWER.x)).toFixed(2)})) * 0.25;
          vec3 c = diffuseColor.rgb;
          c = mix(c, vec3(dot(c, vec3(0.333))), 0.08);                     // salt-bleached
          c = mix(c, vec3(0.7, 0.66, 0.6), chip * 0.2);                   // chipped to grey wood
          c *= (1.0 - seam) * (1.0 - grime) * (1.0 - ${(0.06 * wear).toFixed(3)} + ${(0.12 * wear).toFixed(3)} * pwN(uvw * 3.0));
          diffuseColor.rgb = c;
        }`)
      // sides turned away from the low sun sit in soft sky shade, not front-lit colour
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n        reflectedLight.indirectDiffuse *= 0.7;\n        reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.06, 0.052, 0.05);');
  };
  mat.customProgramCacheKey = () => 'beach-painted-v2-' + wear + (extra.side ?? '');
  return mat;
}

// ---------------------------------------------------------------------------
// lifeguard tower (local coords: origin on the sand at TOWER.x/z, +x = ocean)

const T = {
  deck: { x0: -2.0, x1: 3.4, z0: -2.0, z1: 2.0 },
  cabin: { x0: 0.7, x1: 3.2, z0: -1.25, z1: 1.25, h: 2.35 },
  roof: { x0: -1.5, x1: 4.3, z0: -2.55, z1: 2.55 },
  stair: { z0: -1.85, z1: -0.75, run: 0.28 },
};

// colour schemes: the original pink / teal, a lime / violet one and an orange / blue one
const TOWER_PALETTES = {
  classic: { PINK: 0xf0a0b4, TEAL: 0x2fb5a8, YEL: 0xf6d24a, NAVY: 0x2b3f8c, ORANGE: 0xf08a3c, skirt: 0.3, skirt3: false },
  lime: { PINK: 0xb9d84c, TEAL: 0x7a55b4, YEL: 0xf3eed8, NAVY: 0x3d2c72, ORANGE: 0xf4c23a, skirt: 0.26, skirt3: true },
  sunset: { PINK: 0xf2893e, TEAL: 0x2f7fcf, YEL: 0xf6de4e, NAVY: 0xcf3a5c, ORANGE: 0x3aa96a, skirt: 0.55, skirt3: false },
};
function buildTower(scene, colliders, TW = TOWER) {
  const bx = TW.x, bz = TW.z;
  const base = sandHeight(bx) + sandDetail(bx, bz);
  const D = TW.deckHeight;
  const PAL = TOWER_PALETTES[TW.palette ?? 'classic'];
  const { PINK, TEAL, YEL, NAVY, ORANGE } = PAL, WHITE = 0xf3efe6, DECK = 0xd9cdb6;
  const parts = [], glass = [], rails = [];
  const add = (g) => parts.push(g);
  const addR = (g) => rails.push(g);
  const col = (x0, x1, y0, y1, z0, z1) => colliders.push({ min: { x: bx + x0, y: base + y0, z: bz + z0 }, max: { x: bx + x1, y: base + y1, z: bz + z1 } });

  // skids on the sand, posts, cross bracing
  // wide skid beams on the sand, cross sleepers
  for (const x of [-1.8, 3.2]) add(boxAt(x - 0.26, x + 0.26, -0.12, 0.2, -2.6, 2.6, ORANGE));
  for (const z of [-2.35, 2.35]) add(boxAt(-2.2, 3.6, 0.2, 0.36, z - 0.2, z + 0.2, ORANGE));
  const posts = [];
  for (const x of [-1.8, 0.7, 3.2]) for (const z of [-1.8, 1.8]) posts.push([x, z]);
  for (const [x, z] of posts) {
    add(boxAt(x - 0.1, x + 0.1, 0.1, D - 0.2, z - 0.1, z + 0.1, TEAL));
    col(x - 0.12, x + 0.12, 0, D - 0.2, z - 0.12, z + 0.12);
  }
  // bold X bracing (above the skirt panel)
  const yb0 = 0.95;
  for (const z of [-1.86, 1.86]) {
    add(beam([-1.8, yb0, z], [0.7, D - 0.35, z], 0.15, NAVY));
    add(beam([0.7, yb0, z], [-1.8, D - 0.35, z], 0.15, NAVY));
    add(beam([0.7, yb0, z], [3.2, D - 0.35, z], 0.15, NAVY));
    add(beam([3.2, yb0, z], [0.7, D - 0.35, z], 0.15, NAVY));
  }
  for (const x of [-1.86, 3.26]) { add(beam([x, yb0, -1.8], [x, D - 0.35, 1.8], 0.15, NAVY)); add(beam([x, yb0, 1.8], [x, D - 0.35, -1.8], 0.15, NAVY)); }
  // solid painted skirt panel around the stilts: vertical pink / white stripes, teal trim
  const skY0 = 0.3, skY1 = 0.85, sw0 = PAL.skirt;
  const skirtCol = (i) => (PAL.skirt3 ? [PINK, WHITE, TEAL][i % 3] : i % 2 ? WHITE : PINK);
  for (const z of [-1.92, 1.92]) {
    for (let x = -1.9, i = 0; x < 3.3; x += sw0, i++) add(boxAt(x, Math.min(x + sw0, 3.3), skY0, skY1, z - 0.03, z + 0.03, skirtCol(i)));
    add(boxAt(-1.95, 3.35, skY1, skY1 + 0.08, z - 0.05, z + 0.05, TEAL));
    add(boxAt(-1.95, 3.35, skY0 - 0.08, skY0, z - 0.05, z + 0.05, TEAL));
  }
  for (const x of [-1.92, 3.32]) {
    for (let z = -1.9, i = 0; z < 1.9; z += sw0, i++) add(boxAt(x - 0.03, x + 0.03, skY0, skY1, z, Math.min(z + sw0, 1.9), skirtCol(i)));
    add(boxAt(x - 0.05, x + 0.05, skY1, skY1 + 0.08, -1.95, 1.95, TEAL));
    add(boxAt(x - 0.05, x + 0.05, skY0 - 0.08, skY0, -1.95, 1.95, TEAL));
  }
  col(-1.96, 3.36, skY0, skY1, -1.96, 1.96);

  // deck: joists, planks, a pink fascia band
  const dk = T.deck;
  add(boxAt(dk.x0, dk.x1, D - 0.28, D - 0.05, dk.z0, dk.z1, DECK));
  for (let x = dk.x0 + 0.07; x < dk.x1; x += 0.145) add(boxAt(x - 0.065, x + 0.065, D - 0.05, D, dk.z0, dk.z1, 0xe4d9c2));
  for (const z of [dk.z0, dk.z1]) add(boxAt(dk.x0 - 0.03, dk.x1 + 0.03, D - 0.42, D - 0.02, z - 0.04, z + 0.04, PINK));
  for (const x of [dk.x0, dk.x1]) add(boxAt(x - 0.04, x + 0.04, D - 0.42, D - 0.02, dk.z0 - 0.03, dk.z1 + 0.03, PINK));

  // cabin: rounded ocean front, horizontal colour blocks, vertical stripes in the middle
  const cb = T.cabin, rr = 0.9;
  const foot = [];
  const seg = (ax, az, bx2, bz2, n) => { for (let i = 0; i < n; i++) foot.push([ax + ((bx2 - ax) * i) / n, az + ((bz2 - az) * i) / n]); };
  const arc = (cx, cz, a0, a1, n) => { for (let i = 0; i < n; i++) { const a = a0 + ((a1 - a0) * i) / n; foot.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]); } };
  // counter-clockwise seen from above (x right, z down): west wall, south, SE arc, east, NE arc, north
  seg(cb.x0, cb.z0, cb.x0, cb.z1, 8);
  seg(cb.x0, cb.z1, cb.x1 - rr, cb.z1, 8);
  arc(cb.x1 - rr, cb.z1 - rr, Math.PI / 2, 0, 8);
  seg(cb.x1, cb.z1 - rr, cb.x1, cb.z0 + rr, 4);
  arc(cb.x1 - rr, cb.z0 + rr, 0, -Math.PI / 2, 8);
  seg(cb.x1 - rr, cb.z0, cb.x0, cb.z0, 8);
  const wallBand = (y0, y1, colorFn, skip) => {
    for (let i = 0; i < foot.length; i++) {
      const a = foot[i], b = foot[(i + 1) % foot.length];
      const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
      if (skip && skip(cx, cz, i)) continue;
      const g = new THREE.BufferGeometry();
      const p = [a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y0, a[1], b[0], y1, b[1], a[0], y1, a[1]];
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.computeVertexNormals();
      // outward normal check (footprint winding)
      const nx = b[1] - a[1], nz = -(b[0] - a[0]);
      const mx = (cb.x0 + cb.x1) / 2, mz = 0;
      if (nx * (cx - mx) + nz * (cz - mz) > 0) { const q = g.attributes.position.array; for (let k = 0; k < 18; k += 9) { for (let c = 0; c < 3; c++) { const tmp = q[k + 3 + c]; q[k + 3 + c] = q[k + 6 + c]; q[k + 6 + c] = tmp; } } g.computeVertexNormals(); }
      parts.push(colorize(g, colorFn(i, cx, cz)));
    }
  };
  const y0 = D, yA = D + 0.85, yB = D + 1.95, yC = D + cb.h;
  const eastWin = (cx) => cx > cb.x1 - rr - 0.05;
  // the landward (west) wall carries big, bold blocks that read even against the light
  const westW = (cx) => cx < cb.x0 + 0.05;
  wallBand(y0, yA, (i, cx) => (westW(cx) ? ORANGE : PINK));
  wallBand(yA, yB, (i, cx, cz) => (westW(cx) ? (cz < 0 ? TEAL : PINK) : i % 2 ? WHITE : TEAL), (cx) => eastWin(cx));
  wallBand(yB, yC, (i, cx) => (westW(cx) ? (Math.floor(i / 2) % 2 ? WHITE : NAVY) : YEL));
  // curved window band on the ocean front (glass), with a white sill and head
  wallBand(yA, yA + 0.12, () => WHITE, (cx) => !eastWin(cx));
  for (let i = 0; i < foot.length; i++) {
    const a = foot[i], b = foot[(i + 1) % foot.length];
    if (!eastWin((a[0] + b[0]) / 2)) continue;
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute([a[0], yA + 0.12, a[1], b[0], yA + 0.12, b[1], b[0], yB, b[1], a[0], yA + 0.12, a[1], b[0], yB, b[1], a[0], yB, a[1]], 3));
    glass.push(gg);
  }
  // floor + ceiling of the cabin (seen through the glass)
  add(boxAt(cb.x0, cb.x1, yC - 0.02, yC, cb.z0, cb.z1, 0xe9e2d4));
  // door on the west wall, portholes on the sides
  add(boxAt(cb.x0 - 0.03, cb.x0, D + 0.02, D + 2.0, -0.45, 0.45, NAVY));
  add(colorize(new THREE.CylinderGeometry(0.14, 0.14, 0.02, 20).rotateZ(Math.PI / 2).translate(cb.x0 - 0.04, D + 1.45, 0), 0x9fb6c4));
  for (const z of [cb.z0, cb.z1]) {
    const s = Math.sign(z);
    add(colorize(new THREE.TorusGeometry(0.24, 0.05, 8, 24).translate(1.35, D + 1.4, z + s * 0.03), WHITE));
    add(colorize(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 24).rotateX(Math.PI / 2).translate(1.35, D + 1.4, z + s * 0.015), 0x6f8fa3));
    // side window with a top-hinged shutter propped open
    add(boxAt(0.95, 1.05, D + 1.0, D + 1.8, z + s * 0.005, z + s * 0.03, WHITE));
    const sh = colorize(new THREE.BoxGeometry(0.9, 0.04, 0.7), TEAL);
    sh.translate(0, 0, s * 0.35).rotateX(s * -0.5).translate(2.05, D + 1.95, z + s * 0.02);
    add(sh);
    add(beam([1.65, D + 1.55, z + s * 0.03], [1.65, D + 1.8, z + s * 0.6], 0.025, WHITE));
    add(beam([2.45, D + 1.55, z + s * 0.03], [2.45, D + 1.8, z + s * 0.6], 0.025, WHITE));
    const gg = new THREE.PlaneGeometry(0.8, 0.5).translate(2.05, D + 1.45, 0).translate(0, 0, z + s * 0.012);
    if (s < 0) gg.rotateY(0);
    glass.push(gg);
  }
  col(cb.x0, cb.x1, D, yC, cb.z0, cb.z1);

  // roof: overhanging slab, teal fascia; soffit is its own material (painted boards)
  const rf = T.roof, ry = yC;
  add(boxAt(rf.x0, rf.x1, ry + 0.14, ry + 0.3, rf.z0, rf.z1, WHITE));
  for (const z of [rf.z0, rf.z1]) add(boxAt(rf.x0 - 0.02, rf.x1 + 0.02, ry + 0.04, ry + 0.3, z - 0.03, z + 0.03, TEAL));
  for (const x of [rf.x0, rf.x1]) add(boxAt(x - 0.03, x + 0.03, ry + 0.04, ry + 0.3, rf.z0, rf.z1, TEAL));
  // porch posts holding the west overhang
  for (const z of [-1.93, 1.93]) { add(boxAt(-1.25, -1.13, D, ry + 0.05, z - 0.06, z + 0.06, WHITE)); col(-1.26, -1.12, D, ry, z - 0.07, z + 0.07); }

  // railings around the deck (open at the stair head on the west side)
  const RAIL = NAVY, rh = 1.0;
  const railRun = (ax, az, bx2, bz2) => {
    const len = Math.hypot(bx2 - ax, bz2 - az), n = Math.max(1, Math.round(len / 0.9));
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx2 - ax) * i) / n, z = az + ((bz2 - az) * i) / n;
      addR(colorize(new THREE.CylinderGeometry(0.035, 0.035, rh, 10).translate(x, D + rh / 2, z), RAIL));
    }
    for (const y of [rh, rh * 0.5]) addR(tubeRail([ax, D + y, az], [bx2, D + y, bz2], y === rh ? 0.035 : 0.022, RAIL));
    for (let i = 0; i < n * 4; i++) {   // balusters
      const f2 = (i + 0.5) / (n * 4), x = ax + (bx2 - ax) * f2, z = az + (bz2 - az) * f2;
      addR(colorize(new THREE.CylinderGeometry(0.012, 0.012, rh * 0.5 - 0.05, 6).translate(x, D + 0.05 + (rh * 0.5 - 0.05) / 2, z), WHITE));
    }
    col(Math.min(ax, bx2) - 0.05, Math.max(ax, bx2) + 0.05, D, D + rh, Math.min(az, bz2) - 0.05, Math.max(az, bz2) + 0.05);
  };
  const st = T.stair;
  railRun(dk.x0, dk.z1, dk.x1, dk.z1);          // south
  railRun(dk.x0, dk.z0, dk.x1, dk.z0);          // north
  railRun(dk.x1, dk.z0, dk.x1, dk.z1);          // east (ocean)
  railRun(dk.x0, st.z1, dk.x0, dk.z1);          // west, south of the stair head
  // (the north end of the west side is the stair opening, st.z0..st.z1 hugging the rail)

  // stairs down the west side: 18 cm class risers to the sand
  const gyEnd = sandHeight(bx + dk.x0 - 4) + sandDetail(bx + dk.x0 - 4, bz + (st.z0 + st.z1) / 2) - base;
  const nR = Math.max(2, Math.round((D - gyEnd) / 0.18));
  const rise = (D - gyEnd) / nR, run = st.run, nT = nR - 1;
  const stairX1 = dk.x0, stairX0 = dk.x0 - nT * run;
  for (let i = 0; i < nT; i++) {
    const top = D - (i + 1) * rise, xa = stairX1 - (i + 1) * run, xb = stairX1 - i * run;
    add(boxAt(xa, xb + 0.02, top - 0.05, top, st.z0 + 0.04, st.z1 - 0.04, 0xe4d9c2));
    add(boxAt(xb - 0.015, xb + 0.01, top, top + rise - 0.05, st.z0 + 0.06, st.z1 - 0.06, WHITE));   // riser board
  }
  for (const z of [st.z0, st.z1]) {
    add(beam([stairX1, D - 0.15, z], [stairX0, gyEnd + 0.05, z], 0.07, TEAL));                // stringer
    addR(tubeRail([stairX1, D + rh, z], [stairX0 + 0.1, gyEnd + rh, z], 0.03, RAIL));        // handrail
    add(boxAt(stairX0 + 0.06, stairX0 + 0.14, gyEnd - 0.05, gyEnd + rh, z - 0.04, z + 0.04, RAIL));
    for (let i = 1; i < nT; i += 2) {
      const x = stairX1 - i * run, y = D - i * rise;
      add(boxAt(x - 0.02, x + 0.02, y, y + rh, z - 0.02, z + 0.02, RAIL));
    }
    col(stairX0, stairX1, gyEnd, D + rh, z - 0.05, z + 0.05);
  }

  // flags on a pole at the north-east corner (plain yellow and purple)
  add(colorize(new THREE.CylinderGeometry(0.045, 0.06, 6.2, 8).translate(dk.x1 - 0.08, D + 3.1, dk.z0 + 0.08), WHITE));
  col(dk.x1 - 0.14, dk.x1 - 0.02, D, D + 6.2, dk.z0 + 0.02, dk.z0 + 0.14);

  const mat = paintedMaterial();
  const mesh = new THREE.Mesh(mergeGeometries(parts), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const railMesh = new THREE.Mesh(mergeGeometries(rails), paintedMaterial({ wear: 0 }));
  railMesh.castShadow = true;
  railMesh.receiveShadow = true;

  // soffit: painted tongue-and-groove, bounce-lit warm from the sunlit sand below
  const soffitTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 512;
    const g = c.getContext('2d');
    const r2 = mulberry32(88);
    for (let i = 0; i < 32; i++) {
      const v = 226 + Math.floor((r2() - 0.5) * 12);
      g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
      g.fillRect(0, i * 16, 64, 16);
      g.fillStyle = 'rgba(70,56,40,0.5)';
      g.fillRect(0, i * 16 + 14, 64, 2);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(0, i * 16, 64, 1);
    }
    for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(120,100,80,${0.08 + r2() * 0.1})`; g.fillRect(r2() * 64, r2() * 512, 2 + r2() * 10, 1 + r2() * 3); }
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.anisotropy = 8;
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    return tx;
  })();
  const sw = rf.x1 - rf.x0, sd = rf.z1 - rf.z0;
  const sg = new THREE.PlaneGeometry(sw, sd).rotateX(Math.PI / 2);
  const uv = sg.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sw, uv.getY(i) * sd / 3.2);
  sg.translate((rf.x0 + rf.x1) / 2, ry + 0.14, 0);
  const soffit = new THREE.MeshStandardMaterial({ map: soffitTex, color: 0xfffaf2, roughness: 0.8 });
  soffit.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
      // light bounced off the sunlit sand and the deck, warm
      reflectedLight.indirectDiffuse = reflectedLight.indirectDiffuse * 0.6 + diffuseColor.rgb * vec3(0.62, 0.46, 0.32) * 0.75;`);
  };
  soffit.customProgramCacheKey = () => 'tower-soffit-v2';
  const soffitMesh = new THREE.Mesh(sg, soffit);
  soffitMesh.receiveShadow = false;

  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x3c5058, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
  const glassMesh = new THREE.Mesh(mergeGeometries(glass.map((g) => { g = g.index ? g.toNonIndexed() : g; if (g.attributes.uv) g.deleteAttribute('uv'); if (!g.attributes.normal) g.computeVertexNormals(); return g; })), glassMat);

  // flags: waving cloth
  const flagMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  const flagU = { value: 0 };
  flagMat.onBeforeCompile = (s) => {
    s.uniforms.uFlagT = flagU;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uFlagT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float fu = clamp(position.x / 1.7, 0.0, 1.0);
        transformed.z += fu * (0.18 * sin(position.x * 3.2 - uFlagT * 5.0) + 0.06 * sin(position.x * 8.0 - uFlagT * 8.0 + position.y * 3.0));
        transformed.y -= fu * fu * 0.12;`);
  };
  flagMat.customProgramCacheKey = () => 'tower-flag';
  const flags = mergeGeometries([
    colorize(new THREE.PlaneGeometry(1.7, 1.05, 16, 6).translate(0.85, 0, 0).translate(0, D + 5.6, 0), 0x2f9a52),
    colorize(new THREE.PlaneGeometry(1.6, 1.0, 16, 6).translate(0.8, 0, 0).translate(0, D + 4.45, 0), 0xf2c21f),
    colorize(new THREE.PlaneGeometry(1.5, 0.95, 16, 6).translate(0.75, 0, 0).translate(0, D + 3.35, 0), 0x6b3fa0),
  ]);
  const flagMesh = new THREE.Mesh(flags, flagMat);
  // blow toward the west-south-west (sea breeze), from the pole
  flagMesh.position.set(dk.x1 - 0.08, 0, dk.z0 + 0.08);
  flagMesh.rotation.y = Math.PI * 0.92;
  flagMesh.castShadow = true;

  const tower = new THREE.Group();
  tower.add(mesh, railMesh, soffitMesh, glassMesh, flagMesh);
  tower.position.set(bx, base, bz);
  scene.add(tower);

  // walk surfaces
  const surfaces = {
    base, deckY: base + D,
    stair: { x0: bx + stairX0, x1: bx + stairX1, z0: bz + st.z0, z1: bz + st.z1, run, rise, n: nT },
    deck: { x0: bx + dk.x0, x1: bx + dk.x1, z0: bz + dk.z0, z1: bz + dk.z1 },
  };
  return { tower, surfaces, flagU };
}

// ---------------------------------------------------------------------------
// dune grass, wrack clumps, props

function prep(g) {
  g = g.index ? g.toNonIndexed() : g;
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

// sea grape: a dome of big round leaves, green with the odd bronze-red one
function seaGrapeGeometry(rnd) {
  const leaves = [];
  const cols = [0x55782f, 0x668a37, 0x4a6b2a, 0x76963f, 0x8a5a2c];
  for (let i = 0; i < 170; i++) {
    const u = rnd(), a = rnd() * Math.PI * 2, el = Math.acos(1 - u * 0.95);
    const n = new THREE.Vector3(Math.sin(el) * Math.cos(a), Math.cos(el), Math.sin(el) * Math.sin(a));
    const r = 0.5 + rnd() * 0.12;
    const g = new THREE.CircleGeometry(0.05 + rnd() * 0.035, 8);
    const tilt = n.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.8, 0.5, (rnd() - 0.5) * 0.8)).normalize();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tilt));
    g.translate(n.x * r, n.y * r * 0.85 + 0.05, n.z * r);
    leaves.push(colorize(g, cols[rnd() < 0.07 ? 4 : Math.floor(rnd() * 4)]));
  }
  for (let i = 0; i < 5; i++) {
    const a = rnd() * 6.28;
    leaves.push(beam([0, 0, 0], [Math.cos(a) * 0.35, 0.45, Math.sin(a) * 0.35], 0.03, 0x6b5a48));
  }
  return mergeGeometries(leaves.map(prep));
}

// sea oats: an irregular tuft of arching blades and a few drooping seed heads
function seaOatGeometry(rnd) {
  const parts = [];
  const green = new THREE.Color(0x7c8a44), straw = new THREE.Color(0xd6c07a), dry = new THREE.Color(0xb59a58);
  for (let b = 0; b < 30; b++) {
    const a = rnd() * Math.PI * 2, lean = 0.3 + rnd() * 0.8, h = 0.35 + rnd() * 0.5, w = 0.01 + rnd() * 0.008;
    const pos = [], colr = [];
    for (let s = 0; s <= 4; s++) {
      const f = s / 4, y = h * f, off = lean * f * f * h;
      const cx = Math.cos(a) * off, cz = Math.sin(a) * off, ww = w * (1 - f * 0.9);
      pos.push(cx - Math.sin(a) * ww, y, cz + Math.cos(a) * ww, cx + Math.sin(a) * ww, y, cz - Math.cos(a) * ww);
      const c = green.clone().lerp(rnd() < 0.3 ? dry : straw, f * 0.9);
      colr.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const idx = [];
    for (let s = 0; s < 4; s++) { const i = s * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    g.setIndex(idx);
    parts.push(g);
  }
  for (let k = 0; k < 3; k++) {
    const a = rnd() * 6.28, h = 0.9 + rnd() * 0.4, tip = [Math.cos(a) * 0.18, h, Math.sin(a) * 0.18];
    parts.push(beam([0, 0, 0], tip, 0.008, 0xc9b378));
    for (let s = 0; s < 7; s++) {
      const e = new THREE.SphereGeometry(0.02, 5, 3).scale(0.6, 1.5, 0.6)
        .translate(tip[0] + Math.cos(a + s) * 0.04, h - 0.06 - s * 0.045, tip[2] + Math.sin(a + s) * 0.04);
      parts.push(colorize(e, 0xbfa261));
    }
  }
  return mergeGeometries(parts.map(prep));
}

// saw palmetto: stiff fans of narrow leaflets on short stalks
function palmettoGeometry(rnd) {
  const parts = [];
  for (let f = 0; f < 8; f++) {
    const a = (f / 8) * Math.PI * 2 + rnd() * 0.5, tilt = 0.5 + rnd() * 0.6, len = 0.45 + rnd() * 0.3;
    const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
    const base = dir.clone().multiplyScalar(0.35);
    parts.push(beam([0, 0, 0], base.toArray(), 0.02, 0x7a6a3c));
    const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    for (let k = 0; k < 13; k++) {
      const t = (k / 12 - 0.5) * 2.2;
      const d = dir.clone().multiplyScalar(Math.cos(t * 0.6)).addScaledVector(side, Math.sin(t)).normalize();
      const tipP = base.clone().addScaledVector(d, len);
      const w = side.clone().multiplyScalar(0.018);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...base.clone().add(w).toArray(), ...base.clone().sub(w).toArray(), ...tipP.toArray()], 3));
      parts.push(colorize(g, rnd() < 0.15 ? 0x9a9a52 : 0x5d7a3a));
    }
  }
  return mergeGeometries(parts.map(prep));
}

// One InstancedMesh along the whole beach has a single bounding sphere hundreds of metres
// wide, so neither the view nor the sun's shadow box could skip any of it: add it as
// blocks along z instead (same instances, same order within a block).
function addInBlocks(scene, im, block = 60) {
  const byBlock = new Map();
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < im.count; i++) {
    im.getMatrixAt(i, m4);
    if (m4.determinant() === 0) continue;   // an empty placeholder (gap), invisible anyway
    const k = Math.floor(p.setFromMatrixPosition(m4).z / block);
    if (!byBlock.has(k)) byBlock.set(k, []);
    byBlock.get(k).push(i);
  }
  for (const k of [...byBlock.keys()].sort((a, b) => a - b)) {
    const idx = byBlock.get(k);
    const part = new THREE.InstancedMesh(im.geometry, im.material, idx.length);
    idx.forEach((src, j) => {
      im.getMatrixAt(src, m4);
      part.setMatrixAt(j, m4);
      if (im.instanceColor) { im.getColorAt(src, c); part.setColorAt(j, c); }
    });
    part.castShadow = im.castShadow;
    part.receiveShadow = im.receiveShadow;
    part.computeBoundingSphere();
    scene.add(part);
  }
  im.dispose();
}

// ranges: z spans to plant; path: the gaps that steer the random stream (the original
// accesses for the original span), gap: extra gaps left empty without touching the stream
function duneVegetation(scene, rnd, colliders, ranges = [[-220, 220]], path = (z) => nearOrigAccess(z, 1.3), gap = (z) => nearMoreAccess(z, 1.3)) {
  const ground = (x, z) => sandHeight(x) + sandDetail(x, z);
  const fenceX = SAND.x0 + 4.6;
  const grape = [], oats = [], palms = [];
  // irregular clumps: dense where the along-shore noise is high, gaps elsewhere
  for (const [zA, zB] of ranges) for (let z = zA; z < zB; z += 0.5 + rnd() * 1.0) {
    if (path(z)) continue;
    const dens = 0.5 + 0.5 * Math.sin(z * 0.043 + 1.3) * Math.sin(z * 0.11 + 0.4);
    if (rnd() > 0.5 + 0.5 * dens) continue;
    const x = SAND.x0 + 1.0 + Math.pow(rnd(), 0.8) * (fenceX - SAND.x0 - 1.6);
    const r = rnd();
    const big = 0.55 + 1.5 * rnd() * rnd() + 0.5 * dens;
    if (r < 0.35) grape.push([x, z, big]);
    else if (r < 0.5) palms.push([x, z, 0.6 + rnd() * 0.9]);
    for (let k = 0, n = 1 + Math.floor(rnd() * rnd() * 9); k < n; k++) oats.push([x + (rnd() - 0.5) * 2.6, z + (rnd() - 0.5) * 2.6, 0.45 + rnd() * 0.85]);
  }
  const place = (geo, mat, all, sy = 1) => {
    // lower tiers thin the clumps beyond the walkable block
    const keep = QUALITY.farFoliage, step = keep < 1 ? Math.round(1 / keep) : 1;
    const items = step > 1 ? all.filter(([, z], i) => Math.abs(z) < 100 || i % step === 0) : all;
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    items.forEach(([x, z, s], i) => {
      e.set((rnd() - 0.5) * 0.15, rnd() * 6.28, (rnd() - 0.5) * 0.15);
      m4.compose(new THREE.Vector3(x, ground(x, z) - 0.03, z), q.setFromEuler(e), new THREE.Vector3(s * (0.8 + rnd() * 0.5), s * sy * (0.7 + rnd() * 0.4), s * (0.8 + rnd() * 0.5)));
      if (gap(z)) m4.makeScale(0, 0, 0);   // (drawn empty: the random stream stays the same)
      im.setMatrixAt(i, m4);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    addInBlocks(scene, im);
  };
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
  const oatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  // three shape variants of each plant so neighbouring clumps never match
  const split = (items, k) => items.filter((_, i) => i % 3 === k);
  for (let k = 0; k < 3; k++) {
    place(seaGrapeGeometry(rnd), leafMat, split(grape, k));
    place(palmettoGeometry(rnd), leafMat, split(palms, k));
    place(seaOatGeometry(rnd), oatMat, split(oats, k));
  }

  // rope-and-post dune fence
  const fence = [];
  for (const [zA, zB] of ranges) {
  let prev = null, drawn = null;
  for (let z = zA; z <= zB; z += 1.9 + rnd() * 1.1) {
    if (path(z)) { prev = drawn = null; continue; }
    const open = gap(z);
    const x = fenceX + 0.15 * Math.sin(z * 0.07) + (rnd() - 0.5) * 0.25, y = ground(x, z);
    const ph = 0.9 + rnd() * 0.22, lx = (rnd() - 0.5) * 0.16, lz = (rnd() - 0.5) * 0.16;
    const post = colorize(new THREE.CylinderGeometry(0.045 + rnd() * 0.015, 0.055, ph, 7).translate(0, ph / 2 - 0.08, 0).rotateX(lz).rotateZ(lx).translate(x, y, z), new THREE.Color(0x8d8478).multiplyScalar(0.8 + rnd() * 0.35).getHex());
    if (!open) fence.push(post);
    const top = [x - Math.sin(lx) * (ph - 0.2), y + ph - 0.2, z + Math.sin(lz) * (ph - 0.2)];
    if (prev) {
      const pts = [], sag = 0.05 + rnd() * 0.2;
      for (let i = 0; i <= 8; i++) {
        const f = i / 8;
        pts.push(new THREE.Vector3(prev[3][0] + (top[0] - prev[3][0]) * f, prev[3][1] + (top[1] - prev[3][1]) * f - sag * Math.sin(f * Math.PI), prev[3][2] + (top[2] - prev[3][2]) * f));
      }
      if (drawn && !open) fence.push(colorize(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.012, 4), 0xd6c6a0));
    }
    if (drawn && !open && Math.abs(z) < DISTRICT.zMax + 5) colliders.push({ min: { x: Math.min(x, drawn[0]) - 0.08, y, z: drawn[2] }, max: { x: Math.max(x, drawn[0]) + 0.08, y: y + 0.9, z } });
    prev = [x, y, z, top];
    drawn = open ? null : prev;
  }
  }
  const fm = new THREE.Mesh(mergeGeometries(fence.map(prep)), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  fm.castShadow = true;
  fm.receiveShadow = true;
  scene.add(fm);
}

function wrackClumps(scene, rnd, zAt = (r) => (r - 0.5) * 400, N = 9000, keep = 1) {
  const g = new THREE.CylinderGeometry(0.007, 0.007, 1, 4, 4).rotateZ(Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i), p.getY(i) * 0.6 + Math.sin(p.getX(i) * 9.0) * 0.012, p.getZ(i) + Math.sin(p.getX(i) * 6.0 + 1.0) * 0.03);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const im = new THREE.InstancedMesh(g, mat, N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    // strands tangled in clusters along the line, with bare gaps between clusters
    let z;
    do z = zAt(rnd()); while (Math.sin(z * 0.09) + 0.6 * Math.sin(z * 0.23 + 2.0) < -0.5);
    const wx = WET_LINE_X - 0.9 + 0.5 * Math.sin(z * 0.047) + 0.25 * Math.sin(z * 0.19 + 1);
    const x = wx + (rnd() - 0.5) * (0.25 + 0.35 * rnd());
    const len = 0.06 + rnd() * rnd() * 0.24;
    q.setFromEuler(new THREE.Euler(0, rnd() * 6.28, (rnd() - 0.5) * 0.2));
    m4.compose(new THREE.Vector3(x, sandHeight(x) + sandDetail(x, z) + 0.004, z), q, new THREE.Vector3(len, 0.6 + rnd() * 0.8, 1));
    im.setMatrixAt(i, m4);
    const gold = rnd();
    im.setColorAt(i, c.setRGB(0.4 + gold * 0.25, 0.3 + gold * 0.16, 0.13 + gold * 0.06, THREE.SRGBColorSpace));
  }
  im.count = Math.min(N, Math.round(QUALITY.wrack * keep));   // strands are in random order: any prefix is a uniform thinning
  im.receiveShadow = true;
  im.castShadow = true;
  addInBlocks(scene, im);
}

// steps over the seawall at the access points, and the wall itself as a collider
function seawallAccess(scene, colliders) {
  const parts = [];
  for (const az of ALL_ACCESS_Z) {
    for (const [x0, x1, top] of STEPS) parts.push(boxAt(x0, x1, 0, top, az - ACCESS_HALF, az + ACCESS_HALF, 0xd8cbb2));
    for (const s of [-1, 1]) parts.push(boxAt(10.75, 12.6, 0, 0.78, az + s * (ACCESS_HALF + 0.1) - 0.1, az + s * (ACCESS_HALF + 0.1) + 0.1, 0xcbbd9f));   // cheek walls
  }
  const m = new THREE.Mesh(mergeGeometries(parts), paintedMaterial({ wear: 0 }));
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  const cuts = [DISTRICT.zMin - 10, ...[...ALL_ACCESS_Z].sort((a, b) => a - b).flatMap((a) => [a - ACCESS_HALF, a + ACCESS_HALF]), DISTRICT.zMax + 10];
  for (let i = 0; i < cuts.length; i += 2) colliders.push({ min: { x: WALL.x0, y: 0, z: cuts[i] }, max: { x: WALL.x1, y: WALL.top, z: cuts[i + 1] } });
  for (const az of ALL_ACCESS_Z) for (const s of [-1, 1]) {
    const zc = az + s * (ACCESS_HALF + 0.1);
    colliders.push({ min: { x: 10.75, y: 0, z: zc - 0.1 }, max: { x: 12.6, y: 0.78, z: zc + 0.1 } });
  }
}

function props(scene, colliders) {
  const parts = [];
  const ground = (x, z) => sandHeight(x) + sandDetail(x, z);
  const addCol = (x0, x1, y0, y1, z0, z1) => colliders.push({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });
  // slatted trash barrel by the tower stairs
  {
    const x = TOWER.x - 6.9, z = TOWER.z + 2.6, y = ground(x, z);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      parts.push(boxAt(-0.04, 0.04, 0, 0.95, -0.03, 0.03, i % 2 ? 0x2f6e8e : 0x2a6282).rotateY(-a).translate(Math.cos(a) * 0.3 + x, y, Math.sin(a) * 0.3 + z));
    }
    for (const h of [0.12, 0.85]) parts.push(colorize(new THREE.TorusGeometry(0.31, 0.02, 6, 20).rotateX(Math.PI / 2).translate(x, y + h, z), 0x3a3d40));
    parts.push(colorize(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 16).translate(x, y + 0.6, z), 0x1e2022));
    addCol(x - 0.33, x + 0.33, y, y + 0.95, z - 0.33, z + 0.33);
  }
  // (the lifeguard ATV parked south of the tower is rideable: vehicles/)
  // volleyball court far north: posts, net
  const netX = 34, netZ = -58;
  const yN = ground(netX, netZ);
  for (const dz of [-4.8, 4.8]) {
    parts.push(colorize(new THREE.CylinderGeometry(0.05, 0.05, 2.55, 8).translate(netX, yN + 1.27, netZ + dz), 0xe8e4da));
    addCol(netX - 0.06, netX + 0.06, yN, yN + 2.55, netZ + dz - 0.06, netZ + dz + 0.06);
  }
  parts.push(boxAt(netX - 0.01, netX + 0.01, yN + 2.34, yN + 2.43, netZ - 4.8, netZ + 4.8, 0xf4f2ec));
  const mesh = new THREE.Mesh(mergeGeometries(parts), paintedMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  // net mesh
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g2 = c.getContext('2d');
  g2.fillStyle = '#000'; g2.fillRect(0, 0, 64, 64);
  g2.strokeStyle = '#fff'; g2.lineWidth = 3;
  for (let i = 0; i <= 64; i += 16) { g2.beginPath(); g2.moveTo(i, 0); g2.lineTo(i, 64); g2.stroke(); g2.beginPath(); g2.moveTo(0, i); g2.lineTo(64, i); g2.stroke(); }
  const nt = new THREE.CanvasTexture(c);
  nt.wrapS = nt.wrapT = THREE.RepeatWrapping;
  nt.repeat.set(96, 8);
  const net = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 0.85).rotateY(Math.PI / 2).translate(netX, yN + 1.9, netZ),
    new THREE.MeshStandardMaterial({ alphaMap: nt, color: 0x222222, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.9 }));
  scene.add(net);
}

// ---------------------------------------------------------------------------

export function buildBeach(scene, surf) {
  const rnd = mulberry32(2024);
  const colliders = [];
  const detail = bakeSandDetail(QUALITY.sandDetail);
  const mat = sandMaterial(detail, surf);
  const addSand = (g) => { const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m); };
  // detailed sand through the district (the original +-220 m sheet, then the extensions
  // at the same row spacing), flat low-res sand beyond
  addSand(sandGeometry(-220, 220, QUALITY.sandRows, true));
  const extRows = Math.round(QUALITY.sandRows * (SAND_DETAIL_Z + 5 - 220) / 440);
  addSand(sandGeometry(220, SAND_DETAIL_Z + 5, extRows, true));
  addSand(sandGeometry(-SAND_DETAIL_Z - 5, -220, extRows, true));
  addSand(sandGeometry(SAND_DETAIL_Z + 5, 2500, 1, false));
  addSand(sandGeometry(-2500, -SAND_DETAIL_Z - 5, 1, false));

  const sheet = swashSheet(surf);
  scene.add(sheet);
  wrackClumps(scene, rnd);
  duneVegetation(scene, rnd, colliders);
  seawallAccess(scene, colliders);
  const { surfaces, flagU } = buildTower(scene, colliders);
  props(scene, colliders);
  // the extended beach (own random streams): wrack, dune plants and fence, two more towers
  const span = DISTRICT.zMax + 5 - 200;
  wrackClumps(scene, mulberry32(2026), (r) => (r < 0.5 ? -200 - span + r * 2 * span : 200 + (r - 0.5) * 2 * span), 6600, span / 400);
  duneVegetation(scene, mulberry32(2025), colliders, [[-DISTRICT.zMax - 5, -221], [221, DISTRICT.zMax + 5]], (z) => nearAccess(z, 1.3), () => false);
  const towers = [{ surfaces, flagU }, ...TOWERS.slice(1).map((tw) => buildTower(scene, colliders, tw))];

  const groundAt = (x, z) => groundHeight(x, z);
  function heightAt(x, z, currentY = -Infinity) {
    const g = groundAt(x, z);
    const reach = (y) => currentY >= y - 0.45;   // a step up of up to 45 cm is walkable
    if (x >= STEPS[0][0] && x < STEPS[2][1] && nearAccess(z)) {
      const st = STEPS.find((q) => x < q[1]);
      if (reach(st[2])) return st[2];
    }
    for (const { surfaces: T } of towers) {
      const d = T.deck, s = T.stair;
      if (Math.abs(z - (d.z0 + d.z1) / 2) > 8) continue;
      if (x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1 && reach(T.deckY)) return T.deckY;
      if (x >= s.x0 && x < s.x1 && z >= s.z0 && z <= s.z1) {
        const i = Math.floor((s.x1 - x) / s.run);
        const y = T.deckY - (i + 1) * s.rise;
        if (y > g && reach(y)) return y;
      }
    }
    return g;
  }

  const api = {
    heightAt,
    groundAt,
    colliders,
    surfaces,
    towers: towers.map((t) => t.surfaces),
    swashAt: (x, z, t) => surf.swashAt(x, z, t),
    waterDepthAt: (x, z, t) => surf.waterDepthAt(x, z, t),
    update(t, camera) {
      for (const tw of towers) tw.flagU.value = t;
      if (camera) sheet.position.z = Math.round(camera.position.z / 2) * 2;
    },
  };
  window.__beach = api;
  return api;
}
