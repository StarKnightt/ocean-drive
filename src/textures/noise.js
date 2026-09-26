// Procedural, tileable canvas textures (no image files).
import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable value-noise fbm field in [0,1], size x size.
export function fbmField(size, { seed = 1, baseCells = 4, octaves = 5, gain = 0.5 } = {}) {
  const rnd = mulberry32(seed);
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells << o;
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells;
      const y0 = Math.floor(fy), ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % cells) * cells, r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const x0 = Math.floor(fx), tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % cells, c1 = (x0 + 1) % cells;
        const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * sx;
        const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function toTexture(canvas, { srgb = true, repeat = 1 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Albedo texture: base colour modulated by fbm and fine speckle.
// colorA/colorB are sRGB [r,g,b] 0-255 endpoints mixed by the noise.
export function noiseColorTexture({
  size = 512, seed = 1, colorA, colorB, baseCells = 4, speckle = 0.08, contrast = 1.0, draw,
}) {
  const field = fbmField(size, { seed, baseCells });
  const rnd = mulberry32(seed * 7 + 3);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    let t = (field[i] - 0.5) * contrast + 0.5;
    t = Math.min(1, Math.max(0, t));
    const s = 1 + (rnd() - 0.5) * speckle * 2;
    img.data[i * 4 + 0] = Math.min(255, (colorA[0] + (colorB[0] - colorA[0]) * t) * s);
    img.data[i * 4 + 1] = Math.min(255, (colorA[1] + (colorB[1] - colorA[1]) * t) * s);
    img.data[i * 4 + 2] = Math.min(255, (colorA[2] + (colorB[2] - colorA[2]) * t) * s);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (draw) draw(ctx, size);
  return toTexture(canvas);
}

// Tangent-space normal map from a tileable height field.
export function noiseNormalTexture({ size = 256, seed = 5, baseCells = 8, strength = 2.0, octaves = 4 }) {
  const h = fbmField(size, { seed, baseCells, octaves });
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
      const d = h[((y - 1 + size) % size) * size + x], u = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength * size * 0.05, ny = (d - u) * strength * size * 0.05, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
