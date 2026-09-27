// Correctly sized, correctly coloured placeholder layout used to judge the
// lighting. Each part will be replaced by its dedicated world module later.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  WORLD_Z, CURB_HEIGHT, SIDEWALK_W, PARKING, LANES, SIDEWALK_E, PARK, SAND,
  CAR, TOWER, sandHeight, SHORE_X, CROSS, CROSS_STREETS,
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

// Park lawn: dense short blades in mixed greens and yellows (texture covers 7 m)
function bladeTexture() {
  const S = 1024, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rnd = mulberry32(3131);
  g.fillStyle = 'rgb(86,104,48)';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 60000; i++) {
    const x = rnd() * S, y = rnd() * S, l = 3 + rnd() * 7, a = -Math.PI / 2 + (rnd() - 0.5) * 1.4;
    const t = rnd();
    const r = t < 0.15 ? 150 + rnd() * 40 : 80 + rnd() * 50, gg = t < 0.15 ? 150 + rnd() * 30 : 110 + rnd() * 50, b = 40 + rnd() * 30;
    g.strokeStyle = `rgba(${r | 0},${gg | 0},${b | 0},0.9)`;
    g.lineWidth = 1 + rnd();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Coral-limestone seawall: coursed blocks with pitted fossil faces and recessed joints.
function coralStoneTexture() {
  const S = 1024, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rnd = mulberry32(6161);
  const bw = S / 4, bh = S / 8;   // 0.6 x 0.3 m blocks on a 2.4 m tile
  g.fillStyle = 'rgb(150,136,112)';
  g.fillRect(0, 0, S, S);
  for (let r = 0; r < 8; r++) {
    const off = r % 2 ? bw / 2 : 0;
    for (let k = -1; k < 5; k++) {
      const x = k * bw + off, v = 205 + rnd() * 30;
      g.fillStyle = `rgb(${v | 0},${(v - 14) | 0},${(v - 38) | 0})`;
      g.fillRect(x + 5, r * bh + 5, bw - 10, bh - 10);
    }
  }
  for (let i = 0; i < 9000; i++) {   // fossil pits and pores
    const x = rnd() * S, y = rnd() * S, rr = 0.6 + rnd() * rnd() * 5;
    g.fillStyle = `rgba(${90 + rnd() * 40},${80 + rnd() * 35},${60 + rnd() * 30},${0.35 + rnd() * 0.4})`;
    g.beginPath(); g.arc(x, y, rr, 0, 6.28); g.fill();
  }
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(250,244,230,${0.2 + rnd() * 0.3})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
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

  const grassTex = bladeTexture();
  const grass = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.75 });
  grass.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLwP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvLwP = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
      varying vec2 vLwP;
      float lwH(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float lwN(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(lwH(i), lwH(i + vec2(1, 0)), u.x), mix(lwH(i + vec2(0, 1)), lwH(i + vec2(1, 1)), u.x), u.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        // mixed St. Augustine: greener and yellower patches, sun-dried bare spots
        float lwA = lwN(vLwP * 0.12) * 0.6 + lwN(vLwP * 0.37 + 7.0) * 0.4;
        float lwDry = smoothstep(0.6, 0.78, lwA);
        diffuseColor.rgb *= mix(vec3(0.9, 1.05, 0.85), vec3(1.1, 1.0, 0.8), smoothstep(0.3, 0.6, lwA));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.55, 0.34), lwDry * 0.7);
      }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
      #ifdef USE_FOG
      {
        vec3 odVd = normalize(vFogOffset);
        vec3 odW = cameraPosition + vFogOffset;
        float odB = pow(max(dot(odVd, OD_SUN), 0.0), 3.0);        // looking toward the sun
        // Backlit lawn: we see the shaded sides of the blades - dark, desaturated -
        // with sun transmitted through the thin blade edges as a bright rim.
        float odBk = smoothstep(0.2, 0.85, dot(normalize(odVd.xz + 1e-5), normalize(OD_SUN.xz))) * (1.0 - abs(odVd.y));
        reflectedLight.directDiffuse = mix(reflectedLight.directDiffuse, vec3(dot(reflectedLight.directDiffuse, vec3(0.2126, 0.7152, 0.0722))), 0.4 * odBk) * mix(1.0, 0.45, odBk);
        reflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, vec3(dot(reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.95, 1.0, 1.05), 0.45 * odBk) * mix(1.0, 0.45, odBk) * 0.75;   // modest sky fill keeps the palm shadows legible
        // smooth translucent rim (blade edges averaged over the pixel), only where sunlit
        reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.1, 1.15, 0.35) * directLight.color * odBk * 0.12;
        // sunlight transmitted through the blades (directLight.color carries the shadow)
        reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.1, 1.25, 0.4) * directLight.color * 0.06 * (0.25 + odB) * (1.0 - odBk);
      }
      #endif`);
  };
  grass.customProgramCacheKey = () => 'grass-translucent-v4';

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
  const coralTex = coralStoneTexture();
  const coral = new THREE.MeshStandardMaterial({ map: coralTex, color: 0xf2e6cf, roughness: 0.95, shadowSide: THREE.FrontSide });
  coral.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
      reflectedLight.indirectDiffuse *= 2.2;`);
  };
  coral.customProgramCacheKey = () => 'coral-wall-v3';
  const cap = new THREE.MeshStandardMaterial({ map: coralTex, color: 0xcfc2aa, roughness: 0.9, shadowSide: THREE.FrontSide });
  // (texture covers 2.4 m: coursed blocks 0.6 x 0.3 m)
  group.add(mesh(slab(PARK.wallX - 0.25, PARK.wallX + 0.35, 0, 0.6, -Z, Z, 2.4), coral, { cast: true }));
  group.add(mesh(slab(PARK.wallX - 0.3, PARK.wallX + 0.4, 0.6, 0.68, -Z, Z, 2.4), cap, { cast: true }));

  // (sand, swash and the lifeguard tower: beach.js)
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
          vec3 glass = vec3(0.13, 0.15, 0.19) * (0.85 + 0.3 * hb);
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
            float wy = smoothstep(0.24, 0.26, f) * (1.0 - smoothstep(0.84, 0.86, f));
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
          #ifdef USE_FOG
          // sun-facing walls take the warm low sun (amber, not flat grey)
          float odSunF = max(dot(normalize(odN.xz + 1e-5), normalize(OD_SUN.xz)), 0.0) * odV;
          diffuseColor.rgb *= mix(vec3(1.0), vec3(1.12, 0.86, 0.64), odSunF);
          #endif
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.2, odGlass);`);
  };
  bgMat.customProgramCacheKey = () => 'bg-towers-v3';
  const bm = new THREE.InstancedMesh(unit, bgMat, bg.length);
  const aBg = new Float32Array(bg.length * 4);
  const bgCols = [0xf0ece4, 0xe9e3d8, 0xf2ede4, 0xe6e8e6, 0xeee6da, 0xe8ecee, 0xe4e6e2];
  const bq = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
  const off = new THREE.Vector3();
  for (const b of bg) if (b.tier && !b.above) b.parent.tierH = b.h;
  // keep the cross streets open: the back row (and near towers) standing in a roadway
  // are drawn empty (zero scale, so the random stream and every other building stay)
  const inRoad = (b) => {
    if (b.parent) return b.parent.hidden;
    const reach = b.kind === 1 && b.x1 > -64 ? Infinity : 110;
    if (b.x1 < -reach) return false;
    const slack = Math.abs(Math.sin(b.rot)) * (b.x1 - b.x0);
    return CROSS_STREETS.some((c) => (c.far ? reach === Infinity : true) && b.z0 - slack < c.z + CROSS.hw + 1 && b.z0 + b.w + slack > c.z - CROSS.hw - 1);
  };
  for (const b of bg) if (!b.parent) b.hidden = inRoad(b);
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
    if (inRoad(b)) m4.makeScale(0, 0, 0);
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
      if (b.hidden) m4.makeScale(0, 0, 0);
      cm.setMatrixAt(i, m4);
      cm.setColorAt(i, c.setHex(bgCols[bg.indexOf(b) % bgCols.length]));
      aR.set([b.kind, 3.1, 1.6, rnd()], i * 4);
    });
    cm.geometry.setAttribute('aBg', new THREE.InstancedBufferAttribute(aR, 4));
    cm.castShadow = cm.receiveShadow = true;
    group.add(cm);
  }
}

export function buildPlaceholders(scene) {
  const group = new THREE.Group();
  group.name = 'placeholders';
  buildGround(group);
  buildBackground(group);  // the deco row itself is built by hotels.js
  scene.add(group);
  return group;
}
