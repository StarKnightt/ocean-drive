// Where does the JS heap / VRAM go? Sums geometry attribute bytes, texture sources and
// instance buffers per top-level scene object, and lists the biggest textures.
// Usage: node tools/_heap.mjs [query]
import { chromium } from 'playwright';

const query = process.argv[2] || '';
const browser = await chromium.launch({
  channel: 'chrome', headless: false,
  args: ['--mute-audio', '--window-position=1940,120', '--window-size=1100,700', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
await page.goto('http://localhost:5173/?autostart' + (query ? '&' + query : ''));
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const MB = (b) => +(b / 1048576).toFixed(1);
  const pre = performance.memory.usedJSHeapSize; window.gc?.(); window.gc?.();
  const geos = new Set(), texs = new Map();
  const byRoot = {};
  let geoBytes = 0, tris = 0;
  const attrBytes = (g) => {
    let b = 0;
    for (const a of Object.values(g.attributes)) b += a.array?.byteLength ?? a.data?.array?.byteLength ?? 0;
    if (g.index) b += g.index.array.byteLength;
    return b;
  };
  for (const root of window.__scene.children) {
    let b = 0;
    root.traverse((o) => {
      if (o.geometry && !geos.has(o.geometry)) { geos.add(o.geometry); const x = attrBytes(o.geometry); b += x; geoBytes += x; }
      if (o.isInstancedMesh) b += o.instanceMatrix.array.byteLength + (o.instanceColor?.array.byteLength ?? 0);
      for (const m of [].concat(o.material ?? [])) for (const [k, v] of Object.entries(m)) {
        if (!v?.isTexture) continue;
        const im = v.image;
        const w = im?.width ?? 0, h = im?.height ?? 0;
        if (!texs.has(v)) texs.set(v, { name: `${root.name || root.type}/${o.name || o.type}.${k}`, w, h, kind: im?.constructor?.name, data: im?.data?.byteLength ?? 0, users: 0 });
        texs.get(v).users++;
      }
      for (const m of [].concat(o.material ?? [])) for (const u of Object.values(m.uniforms ?? {})) {
        const v = u?.value;
        if (!v?.isTexture || texs.has(v)) continue;
        const im = v.image;
        texs.set(v, { name: `${root.name || root.type}/${o.name || o.type}.uniform`, w: im?.width ?? 0, h: im?.height ?? 0, kind: im?.constructor?.name, data: im?.data?.byteLength ?? 0, users: 1 });
      }
    });
    const key = (root.name || root.type) + '#' + window.__scene.children.indexOf(root);
    byRoot[key] = MB(b);
  }
  const tl = [...texs.values()].map((t) => ({ ...t, mb: MB(t.w * t.h * 4 * 1.33) })).sort((a, b) => b.mb - a.mb);
  // duplicate textures: same size + same source kind created separately
  const sig = new Map();
  for (const [t, v] of texs) { const s = t.image?.src ?? null; if (s) sig.set(s, (sig.get(s) ?? 0) + 1); }
  return {
    heapPreGcMB: MB(pre), heapMB: MB(performance.memory.usedJSHeapSize), geoMB: MB(geoBytes), geometries: geos.size,
    texCount: tl.length, texMB: +tl.reduce((a, t) => a + t.mb, 0).toFixed(1), texDataMB: MB(tl.reduce((a, t) => a + t.data, 0)),
    byRoot: Object.fromEntries(Object.entries(byRoot).sort((a, b) => b[1] - a[1]).slice(0, 25)),
    topTextures: tl.slice(0, 30).map((t) => `${t.mb}MB ${t.w}x${t.h} ${t.kind} data=${MB(t.data)} users=${t.users} ${t.name}`),
  };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
