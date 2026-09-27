// Correctly sized, correctly coloured placeholder layout used to judge the
// lighting. Each part will be replaced by its dedicated world module later.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  WORLD_Z, CURB_HEIGHT, SIDEWALK_W, PARKING, LANES, SIDEWALK_E, PARK, SAND,
  CAR, TOWER, sandHeight, SHORE_X,
} from './layout.js';
import { noiseColorTexture, mulberry32 } from '../textures/noise.js';

// Box from explicit bounds with world-space planar UVs (u = x / tile, v = z / tile).
function slab(x0, x1, y0, y1, z0, z1, tile = 1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const pos = g.attributes.position, uv = g.attributes.uv, nrm = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nrm.getX(i)) > 0.5;
    const az = Math.abs(nrm.getZ(i)) > 0.5;
    const u = ax ? pos.getZ(i) : pos.getX(i);
    const v = ax || az ? pos.getY(i) : pos.getZ(i);
    uv.setXY(i, u / tile, v / tile);
  }
  return g;
}

function mesh(geo, mat, { cast = false, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

function buildGround(group) {
  const Z = WORLD_Z;
  const concreteTex = noiseColorTexture({
    size: 512, seed: 11, colorA: [174, 160, 150], colorB: [194, 180, 168], baseCells: 6, speckle: 0.06,
    draw(ctx, s) { // 1.5 m slab joints (texture covers 3 m)
      ctx.strokeStyle = 'rgba(90,80,70,0.55)';
      ctx.lineWidth = 3;
      for (const p of [0, s / 2]) {
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(s, p); ctx.stroke();
      }
    },
  });
  const concrete = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.88 });

  const asphaltTex = noiseColorTexture({
    size: 512, seed: 21, colorA: [114, 111, 107], colorB: [140, 136, 130], baseCells: 5, speckle: 0.18, contrast: 1.3,
  });
  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.93 });

  const grassTex = noiseColorTexture({
    size: 512, seed: 31, colorA: [104, 132, 60], colorB: [168, 180, 90], baseCells: 5, speckle: 0.22, contrast: 1.4,
  });
  const grass = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.62 });
  grass.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
      #ifdef USE_FOG
      {
        vec3 odVd = normalize(vFogOffset);
        vec3 odW = cameraPosition + vFogOffset;
        float odB = pow(max(dot(odVd, OD_SUN), 0.0), 3.0);        // looking toward the sun
        // Backlit lawn: we see the shaded sides of the blades - dark, desaturated -
        // with sun transmitted through the thin blade edges as a bright rim.
        float odBk = smoothstep(0.2, 0.85, dot(normalize(odVd.xz + 1e-5), normalize(OD_SUN.xz))) * (1.0 - abs(odVd.y));
        reflectedLight.directDiffuse = mix(reflectedLight.directDiffuse, vec3(dot(reflectedLight.directDiffuse, vec3(0.2126, 0.7152, 0.0722))), 0.5 * odBk) * mix(1.0, 0.15, odBk);
        reflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, vec3(dot(reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.95, 1.0, 1.05), 0.45 * odBk) * mix(1.0, 0.45, odBk);
        // smooth translucent rim (blade edges averaged over the pixel), only where sunlit
        reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.1, 1.15, 0.35) * directLight.color * odBk * 0.12;
        // sunlight transmitted through the blades (directLight.color carries the shadow)
        reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.1, 1.25, 0.4) * directLight.color * 0.06 * (0.25 + odB) * (1.0 - odBk);
      }
      #endif`);
  };
  grass.customProgramCacheKey = () => 'grass-translucent-v3';

  const sandTex = noiseColorTexture({
    size: 512, seed: 41, colorA: [214, 204, 188], colorB: [236, 228, 214], baseCells: 6, speckle: 0.12,
  });

  // (street, curbs and sidewalks: street.js)

  // Park lawn.
  group.add(mesh(slab(PARK.x0, PARK.wallX, -0.3, CURB_HEIGHT, -Z, Z, 7), grass));

  // Serpentine promenade.
  {
    const pts = [], idx = [], uvs = [];
    const zs = 600, n = 600, w = 2.2;
    for (let i = 0; i <= n; i++) {
      const z = -zs + (i / n) * zs * 2;
      const x = PARK.promenadeX + 2.6 * Math.sin(z / 19) + 1.2 * Math.sin(z / 7.3);
      pts.push(x - w, CURB_HEIGHT + 0.02, z, x + w, CURB_HEIGHT + 0.02, z);
      uvs.push((x - w) / 3, z / 3, (x + w) / 3, z / 3);
      if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const pave = new THREE.MeshStandardMaterial({ map: concreteTex, color: 0xf2dcc8, roughness: 0.85 });
    group.add(mesh(g, pave));
  }

  // Low coral-stone wall between park and sand.
  // (front faces into the shadow map: with the default back faces, the wall's own west
  // face sits at the grass depth and leaked a lit line along its foot)
  // (pitted coral limestone, pale: its shaded park-side face must not read as a black band)
  const coralTex = noiseColorTexture({ size: 512, seed: 61, colorA: [196, 180, 150], colorB: [236, 224, 198], baseCells: 10, speckle: 0.35, contrast: 1.5 });
  const coral = new THREE.MeshStandardMaterial({ map: coralTex, color: 0xf0e4cc, roughness: 0.95, shadowSide: THREE.FrontSide });
  coral.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
      reflectedLight.indirectDiffuse *= 3.6;`);
  };
  coral.customProgramCacheKey = () => 'coral-wall-v2';
  group.add(mesh(slab(PARK.wallX - 0.25, PARK.wallX + 0.35, 0, 0.6, -Z, Z, 0.6), coral, { cast: true }));
  group.add(mesh(slab(PARK.wallX - 0.3, PARK.wallX + 0.4, 0.6, 0.68, -Z, Z, 0.6), coral, { cast: true }));

  // Sand: height from sandHeight(x), darker and wetter toward the water.
  {
    const segX = 160, x0 = SAND.x0, x1 = 130;
    const g = new THREE.PlaneGeometry(x1 - x0, Z * 2, segX, 1);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, 0);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setY(i, sandHeight(x));
      uv.setXY(i, x / 5, pos.getZ(i) / 5);
    }
    g.computeVertexNormals();
    const sand = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.96 });
    // Wet band toward the water: darker and glossy, mirroring the golden sky and sun.
    const wet0 = (SAND.waterline - 3).toFixed(1), wet1 = (SAND.waterline + 1.5).toFixed(1);
    sand.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vOdWorldX;\nvarying float vOdWorldZ;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvOdWorldX = (modelMatrix * vec4(transformed, 1.0)).x;\nvOdWorldZ = (modelMatrix * vec4(transformed, 1.0)).z;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vOdWorldX;\nvarying float vOdWorldZ;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          // wet/dry line: sharp, slightly wavy (last swash reach)
          float odWl = ${wet0} + 0.6 * sin(vOdWorldZ * 0.21) + 0.35 * sin(vOdWorldZ * 0.83 + 1.3);
          float odWet = smoothstep(odWl - 0.15, odWl + 0.15, vOdWorldX) * (0.75 + 0.25 * smoothstep(odWl, ${wet1}, vOdWorldX));
          diffuseColor.rgb *= mix(1.0, 0.42, odWet);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.8, odWet);`)
        // grain shadowing: dry sand looking into a low sun shows mostly the shaded
        // sides of grains (dim, cool); looking down-sun it brightens (opposition hotspot)
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
          #ifdef USE_FOG
          {
            vec3 odVd = normalize(vFogOffset);
            float odG = dot(normalize(odVd.xz + 1e-5), normalize(OD_SUN.xz));
            float odGraze = 1.0 - abs(odVd.y);
            float odInto = smoothstep(-0.2, 0.9, odG) * smoothstep(0.05, 0.75, odGraze) * (1.0 - odWet);
            float odAway = smoothstep(0.2, -1.0, odG) * odGraze;
            // (rough sand under a grazing sun is strongly retro-reflective: seen down-sun the
            // lit grain faces fill the view and the beach glows warm, not sky-grey)
            reflectedLight.directDiffuse *= mix(1.0, 0.06, odInto) * (1.0 + 2.0 * odAway);
            reflectedLight.indirectDiffuse *= mix(1.0, 0.55, odInto);
            // down-sun the sand is lit grain faces: warm, the lilac sky fill is mostly hidden
            reflectedLight.indirectDiffuse *= mix(vec3(1.0), vec3(0.78, 0.66, 0.52), odAway);
            reflectedLight.directSpecular *= (1.0 - 0.95 * odInto) * (1.0 - smoothstep(0.0, 0.2, odWet));   // the wet film's sun glint is drawn below
            // backlit dry sand is lit by the sky: neutral-cool grey, warmer toward the damp shore
            float odL = dot(reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722));
            float odShore = smoothstep(${(SAND.waterline - 22).toFixed(1)}, ${(SAND.waterline - 4).toFixed(1)}, vOdWorldX);
            vec3 odCool = odL * vec3(0.80, 0.90, 1.08) * dot(diffuseColor.rgb, vec3(0.333)) / max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.02);
            reflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, odCool, 0.75 * odInto * (1.0 - odShore));
            reflectedLight.indirectSpecular *= 1.0 - 0.8 * odInto * (1.0 - odShore);
          }
          #endif`)
        // thin water film: mirror of the (uncompressed) sunrise sky from the shared model
        .replace('#include <opaque_fragment>', `
          #ifdef USE_FOG
          {
            vec3 odI = normalize(vFogOffset);
            float odNv = max(-odI.y, 0.02);
            vec3 odR = reflect(odI, vec3(0.0, 1.0, 0.0));
            float odF = 0.02 + 0.98 * pow(1.0 - odNv, 5.0);
            // swash film right at the water's edge: a mirror strip
            float odSwash = smoothstep(${(SHORE_X - 2.8).toFixed(2)}, ${(SHORE_X - 0.6).toFixed(2)}, vOdWorldX);
            // a water film mirrors the sky over the whole wet band (blurred by the film's
            // ripples), strongest at grazing angles
            float odRefl = max(odWet * (0.1 + 0.32 * odF), 0.5 * odSwash);
            // damp sand toward the shore picks up a faint sheen of the warm horizon
            float odDamp = smoothstep(${(SAND.waterline - 14).toFixed(1)}, ${wet0}, vOdWorldX);
            odRefl = max(odRefl, odDamp * odF * 0.08);
            // film ripples tilt toward the viewer: it mirrors higher, darker sky
            vec3 odRb = normalize(vec3(odR.x, odR.y + 0.15, odR.z));
            // (the film's ripples smear the sun's aureole; the sun itself is the glint below)
            // (a thin film over dark sand: the mirror is dimmer than open water)
            outgoingLight = mix(outgoingLight, (odSkyBase(odRb, 0.0) - odSunGlow(dot(odRb, OD_SUN), 0.65, 0.0)) * 0.5, odRefl);
            // sun glint on the water film: anisotropic (narrow across, long toward the
            // viewer) like a streak of reflections off wet ripples, saturated gold
            vec3 odV = -odI;
            vec3 odH = normalize(OD_SUN + odV);
            vec2 odFw = normalize(odI.xz + 1e-5);
            vec2 odRt = vec2(-odFw.y, odFw.x);
            float odSx = dot(odH.xz, odRt) / odH.y, odSz = dot(odH.xz, odFw) / odH.y;
            vec3 odWp = cameraPosition + vFogOffset;
            float odRip = 0.65 + 0.35 * sin(odWp.x * 7.0 + 2.0 * sin(odWp.z * 1.3));
            // a compact bright patch directly under the sun (film ripple slopes ~2 deg)
            float odGl = odRip * exp(-(odSx * odSx + odSz * odSz) / (2.0 * 0.03 * 0.03));
            float odFh = 0.02 + 0.98 * pow(1.0 - max(dot(odH, odV), 0.0), 5.0);
            vec3 odSp = directLight.color * vec3(1.0, 0.62, 0.26) * odFh * odGl * 14.0 * max(odWet, odSwash);
            float odSl = dot(odSp, vec3(0.2126, 0.7152, 0.0722));
            outgoingLight += odSp / (1.0 + odSl / 2.5);
          }
          #endif
          #include <opaque_fragment>`);
    };
    sand.customProgramCacheKey = () => 'sand-wet-v11';
    group.add(mesh(g, sand));
  }
}

// Soft blob contact shadows (baked AO stand-in): transparent black gradient decals.
function blobTexture(kind) {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  if (kind === 'round') {
    const gr = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0.85)');
    gr.addColorStop(0.35, 'rgba(0,0,0,0.45)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, s, s);
  } else if (kind === 'rect') {
    ctx.filter = 'blur(14px)';
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.fillRect(s * 0.22, s * 0.16, s * 0.56, s * 0.68);
  } else { // edge: dark at v=0 fading to v=1
    const gr = ctx.createLinearGradient(0, 0, 0, s);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, s, s);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function blobMaterial(kind) {
  return new THREE.MeshBasicMaterial({
    map: blobTexture(kind), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

// Instanced flat decals: items = [{ x, y, z, sx, sz, rotY }]
function blobs(group, kind, items) {
  const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const im = new THREE.InstancedMesh(g, blobMaterial(kind), items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  items.forEach((b, i) => {
    q.setFromAxisAngle(up, b.rotY || 0);
    m.compose(new THREE.Vector3(b.x, b.y + 0.01, b.z), q, new THREE.Vector3(b.sx, 1, b.sz));
    im.setMatrixAt(i, m);
  });
  im.renderOrder = 1;
  group.add(im);
  return im;
}

// Taller background buildings behind the deco row (seen from the beach): condo towers
// of three kinds (balcony slabs with glass railings, punched window grids, glass curtain
// walls), a lower row along the next street, rooftop mechanical boxes.
function buildBackground(group) {
  const rnd = mulberry32(1234);
  const unit = new THREE.BoxGeometry(1, 1, 1);
  unit.translate(0.5, 0.5, 0.5);
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  const bg = [];
  for (let i = 0; i < 90; i++) {
    const x1 = -62 - rnd() * 140;
    const w = 14 + rnd() * 30;
    const h = 14 + rnd() * rnd() * 55;
    const t = { x0: x1 - (12 + rnd() * 25), x1, z0: -1000 + rnd() * 2000, w, h, rot: (rnd() - 0.5) * 0.9 };
    t.kind = h > 24 ? (rnd() < 0.75 ? 0 : 2) : 1;
    bg.push(t);
    // stepped crowns: a narrower upper tier or two; rounded ends on some slabs
    if (h > 30 && rnd() < 0.55) {
      bg.push({ parent: t, lx: 0.12, lz: 0.15, sx: 0.76, sz: 0.7, h: 3 + rnd() * 6, kind: t.kind, tier: true });
      if (rnd() < 0.5) bg.push({ parent: t, lx: 0.25, lz: 0.3, sx: 0.5, sz: 0.4, h: 3 + rnd() * 3, kind: t.kind, tier: true, above: 1 });
    }
    if (h > 26 && rnd() < 0.35) t.round = true;
    for (let k = 0; k < (h > 20 ? 1 + Math.floor(rnd() * 2) : 0); k++) {
      bg.push({ parent: t, lx: 0.2 + rnd() * 0.5, lz: 0.2 + rnd() * 0.5, sx: 0.15 + rnd() * 0.2, sz: 0.15 + rnd() * 0.25, h: 2 + rnd() * 3.5, kind: 3 });
    }
  }
  // the next street back: a continuous row of 2-6 storey buildings behind the hotels
  for (let z = -1000; z < 1000;) {
    const w = 12 + rnd() * 22;
    const x1 = -58 - rnd() * 4;
    bg.push({ x0: x1 - (14 + rnd() * 16), x1, z0: z, w, h: 7 + rnd() * rnd() * 16, rot: 0, kind: 1 });
    z += w + 1 + rnd() * 5;
  }
  const bgMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  bgMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aBg;\nvarying vec4 vBg;\nvarying vec3 vOdP;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vBg = aBg;
        vec4 odP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          odP = instanceMatrix * odP;
        #endif
        vOdP = (modelMatrix * odP).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vBg;\nvarying vec3 vOdP;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float odGlass = 0.0;
        {
          vec3 odN = normalize(cross(dFdx(vOdP), dFdy(vOdP)));
          float odV = 1.0 - abs(odN.y);
          float kind = vBg.x, fh = vBg.y, bay = vBg.z, sd = vBg.w;
          float along = abs(odN.x) > abs(odN.z) ? vOdP.z : vOdP.x;
          float f = fract(vOdP.y / fh), fl = floor(vOdP.y / fh);
          float bx = fract(along / bay + sd * 7.0), bi = floor(along / bay + sd * 7.0);
          float hb = fract(sin(dot(vec2(bi, fl), vec2(12.9898, 78.233)) + sd * 91.0) * 43758.5);
          vec3 glass = vec3(0.24, 0.27, 0.32) * (0.85 + 0.3 * hb);
          vec3 col = diffuseColor.rgb;
          float ground = step(4.0, vOdP.y);
          if (kind < 0.5) {
            // balconies: bright slab edge, glass railing, recessed dark glazing, a deep
            // shadowed recess every few bays
            float slab = 1.0 - smoothstep(0.07, 0.1, f);
            float rail = smoothstep(0.1, 0.12, f) * (1.0 - smoothstep(0.4, 0.42, f));
            float recess = step(0.93, fract(along / (bay * 4.0) + sd));
            col = mix(glass * 0.8, col, slab);
            col = mix(col, mix(glass * 1.6, vec3(0.45, 0.5, 0.55), 0.35), rail * (1.0 - slab));
            col = mix(col, glass * 0.45, recess * (1.0 - slab));
            odGlass = (1.0 - slab) * (1.0 - recess);
          } else if (kind < 1.5) {
            // punched windows, a few curtained
            float wx = step(0.18, bx) * (1.0 - step(0.82, bx));
            float wy = smoothstep(0.3, 0.32, f) * (1.0 - smoothstep(0.84, 0.86, f));
            float win = wx * wy * ground;
            col = mix(col, glass * (hb > 0.85 ? 2.8 : 1.0), win);
            odGlass = win;
          } else {
            // curtain wall: reflective glass, thin mullions, slightly lighter spandrels
            float mull = 1.0 - step(0.05, bx) * (1.0 - step(0.95, bx));
            float span = 1.0 - smoothstep(0.1, 0.13, f);
            col = mix(vec3(0.36, 0.42, 0.50) * (0.9 + 0.2 * hb), col * 0.85, max(mull, span * 0.8));
            odGlass = (1.0 - mull) * (1.0 - span);
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, col, odV * step(kind, 2.5));
          odGlass *= odV * step(kind, 2.5);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.2, odGlass);`);
  };
  bgMat.customProgramCacheKey = () => 'bg-towers-v2';
  const bm = new THREE.InstancedMesh(unit, bgMat, bg.length);
  const aBg = new Float32Array(bg.length * 4);
  const bgCols = [0xf0ece4, 0xe9e3d8, 0xf2ede4, 0xe6e8e6, 0xeee6da, 0xe8ecee, 0xe4e6e2];
  const bq = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
  const off = new THREE.Vector3();
  for (const b of bg) if (b.tier && !b.above) b.parent.tierH = b.h;
  bg.forEach((b, i) => {
    if (b.parent) {
      const p = b.parent, d = p.x1 - p.x0;
      bq.setFromAxisAngle(yAxis, p.rot);
      off.set(d * b.lx, p.h + (b.above ? p.tierH : 0), p.w * b.lz).applyQuaternion(bq);
      m4.compose(new THREE.Vector3(p.x0, 0, p.z0).add(off), bq, new THREE.Vector3(d * b.sx, b.h, p.w * b.sz));
      bm.setColorAt(i, c.setHex(b.tier ? bgCols[bg.indexOf(p) % bgCols.length] : 0xc9c8c2));
    } else {
      bq.setFromAxisAngle(yAxis, b.rot);
      m4.compose(new THREE.Vector3(b.x0, 0, b.z0), bq, new THREE.Vector3(b.x1 - b.x0, b.h, b.w));
      bm.setColorAt(i, c.setHex(bgCols[i % bgCols.length]));
    }
    bm.setMatrixAt(i, m4);
    aBg.set([b.kind, 2.9 + rnd() * 0.5, 1.4 + rnd() * 1.4, rnd()], i * 4);
  });
  bm.geometry = unit.clone();
  bm.geometry.setAttribute('aBg', new THREE.InstancedBufferAttribute(aBg, 4));
  // (not receiving: at a 7 deg sun the hotels' 180 m shadows would leave every building
  // behind them slate-dark; the fronts seen over and between the hotels read sunlit)
  bm.castShadow = true;
  bm.receiveShadow = false;
  group.add(bm);

  // rounded ends on some slab towers (a half-cylinder bulging past the box end)
  const rounds = bg.filter((b) => b.round);
  if (rounds.length) {
    const cylG = new THREE.CylinderGeometry(0.5, 0.5, 1, 24).translate(0, 0.5, 0);
    const cm = new THREE.InstancedMesh(cylG, bgMat, rounds.length);
    const aR = new Float32Array(rounds.length * 4);
    rounds.forEach((b, i) => {
      const d = b.x1 - b.x0;
      bq.setFromAxisAngle(yAxis, b.rot);
      off.set(d / 2, 0, 0).applyQuaternion(bq);
      m4.compose(new THREE.Vector3(b.x0, 0, b.z0).add(off), bq, new THREE.Vector3(d, b.h, d));
      cm.setMatrixAt(i, m4);
      cm.setColorAt(i, c.setHex(bgCols[bg.indexOf(b) % bgCols.length]));
      aR.set([b.kind, 3.1, 1.6, rnd()], i * 4);
    });
    cm.geometry.setAttribute('aBg', new THREE.InstancedBufferAttribute(aR, 4));
    cm.castShadow = cm.receiveShadow = true;
    group.add(cm);
  }
}

function buildTower(group) {
  const t = new THREE.Group();
  const base = sandHeight(TOWER.x);
  const wood = new THREE.MeshStandardMaterial({ color: 0xece6da, roughness: 0.85 });
  const pink = new THREE.MeshStandardMaterial({ color: 0xe8aab8, roughness: 0.7 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x3fb8b0, roughness: 0.7 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf5d547, roughness: 0.7 });
  const d = TOWER.deckHeight;
  const shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, d, 0.22), wood);
    leg.position.set(x, d / 2, z);
    leg.userData.noCast = true;
    t.add(leg);
    // shadow-only proxy: a 22 cm post is under a shadow texel wide at grazing sun and
    // its shadow aliased into dashes; cast from a slightly fatter invisible post
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.36, d, 0.36), shadowOnly);
    proxy.position.copy(leg.position);
    proxy.userData.shadowOnly = true;
    t.add(proxy);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.2, 4.0), teal);
  deck.position.y = d - 0.1;
  const cabin = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.3, 24), pink);
  cabin.position.set(0.5, d + 1.15, 0);
  // canopy underside: painted tongue-and-groove slats, lit by the sand below
  const slatTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    for (let i = 0; i < 16; i++) {
      const v = 214 + ((i * 37) % 11) - 5;
      g.fillStyle = `rgb(${v},${v - 6},${v - 16})`;
      g.fillRect(0, i * 16, 256, 16);
      g.fillStyle = 'rgba(60,45,30,0.55)';
      g.fillRect(0, i * 16 + 14, 256, 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  })();
  const under = new THREE.MeshStandardMaterial({ map: slatTex, color: 0xf2ece0, roughness: 0.8, side: THREE.DoubleSide });
  under.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
      reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.55, 0.40, 0.28);`);
  };
  under.customProgramCacheKey = () => 'tower-under-v1';
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.8, 0.45, 24), [yellow, yellow, under]);
  roof.position.set(0.5, d + 2.5, 0);
  // ramp on the west side
  const len = 6.5;
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 1.2), wood);
  const ang = Math.atan2(d, len);
  ramp.position.set(-2.3 - Math.cos(ang) * len / 2, d / 2, -1.2);
  ramp.rotation.z = ang;
  t.add(deck, cabin, roof, ramp);
  t.traverse((o) => {
    if (o.isMesh) { o.castShadow = !o.userData.noCast; o.receiveShadow = !o.userData.shadowOnly; }
  });
  t.position.set(TOWER.x, base, TOWER.z);
  group.add(t);
  // (no contact blobs: the sun shadow already grounds the thin legs)
}

export function buildPlaceholders(scene) {
  const group = new THREE.Group();
  group.name = 'placeholders';
  buildGround(group);
  buildBackground(group);  // the deco row itself is built by hotels.js
  buildTower(group);
  scene.add(group);
  return group;
}
