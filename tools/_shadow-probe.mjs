// Shadow pass census: which casters pass the sun's shadow-frustum test (as WebGLShadowMap
// does), their triangles and bounding radii, plus draw calls / triangles of a frame with and
// without a shadow re-render. Usage: node tools/_shadow-probe.mjs [x z]
import { chromium } from 'playwright';

const [X = -27.5, Z = 40] = process.argv.slice(2).map(Number);
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1100,700'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto('http://localhost:5173/?autostart');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.evaluate(([x, z]) => window.__walker.teleport(x, z, 0, 0), [X, Z]);
await page.waitForTimeout(1500);
const r = await page.evaluate(async () => {
  const scene = window.__scene;
  let sun;
  scene.traverse((o) => { if (o.isDirectionalLight && o.castShadow) sun = o; });
  const cam = sun.shadow.camera;
  const THREE = { Frustum: window.__THREE?.Frustum };
  // frustum from the shadow camera (same as LightShadow.updateMatrices)
  const m = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
  const F = new (Object.getPrototypeOf(sun.shadow.getFrustum()).constructor)().setFromProjectionMatrix(m);
  const rows = [];
  let casters = 0, passed = 0, triIn = 0, triAll = 0;
  const pathOf = (o) => { const p = []; for (let q = o; q && q !== scene; q = q.parent) p.push(q.name || q.type); return p.reverse().slice(0, 3).join('/'); };
  const visibleChain = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
  scene.traverse((o) => {
    if (!(o.isMesh || o.isPoints || o.isLine) || !o.castShadow || !visibleChain(o)) return;
    casters++;
    const g = o.geometry;
    const tris = ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
    triAll += tris;
    const inside = !o.frustumCulled || F.intersectsObject(o);
    if (!inside) return;
    passed++; triIn += tris;
    const bs = o.isInstancedMesh ? o.boundingSphere : g.boundingSphere;
    rows.push({ path: pathOf(o), tris: Math.round(tris), r: Math.round(bs?.radius ?? -1), c: bs && [bs.center.x, bs.center.z].map(Math.round), inst: o.isInstancedMesh ? o.count : 0, batched: !!o.isBatchedMesh, mat: o.material.type + ":" + (o.material.customProgramCacheKey?.() ?? "") + ":" + (o.material.name || ""), attrs: Object.keys(g.attributes).join(","), top: scene.children.indexOf((() => { let q = o; while (q.parent !== scene) q = q.parent; return q; })()) });
  });
  rows.sort((a, b) => b.tris - a.tris);
  // frame cost with / without a shadow re-render (info is reset each frame by main.js)
  const frameInfo = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(window.__renderInfo()))));
  const a = await frameInfo();
  return { casters, passed, triAll: Math.round(triAll), triIn: Math.round(triIn), noShadowFrame: { calls: a.calls, tris: a.triangles }, top: rows.slice(0, 14).map((r) => JSON.stringify(r)) };
});
// shadow frame: move the viewer 1 m so the box re-renders, sample that frame
const s = await page.evaluate(() => new Promise((res) => {
  const w = window.__walker; const n0 = window.__renderInfo().shadowRenders;
  w.teleport(w.pos.x, w.pos.y - 1.0);
  const poll = () => { const i = window.__renderInfo(); if (i.shadowRenders > n0) res({ calls: i.calls, tris: i.triangles }); else requestAnimationFrame(poll); };
  requestAnimationFrame(poll);
}));
console.log(JSON.stringify({ ...r, shadowFrame: s }, null, 1));
await browser.close();
