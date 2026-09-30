// In-game isolation of one parked car's batch instances (everything else hidden).
// node tools/_fleet-iso.mjs <z of the car> [out prefix]
import { chromium } from 'playwright';
const Z = Number(process.argv[2] ?? -24), out = process.argv[3] || 'shots/car-debug/iso';
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1040,736'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto('http://localhost:5173/?shot=1');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
const info = await page.evaluate((Z) => {
  const F = window.__cars.fleet;
  const car = F.cars.reduce((a, c) => (Math.abs(c.z - Z) < Math.abs(a.z - Z) ? c : a));
  const keep = new Set(F.cars.indexOf(car) >= 0 ? car.parts.map((p) => p.bm) : []);
  window.__scene.traverse((o) => { if (o.isMesh && !o.isBatchedMesh && o.material?.name !== 'Sky') o.visible = false; });
  for (const { bm } of Object.values(F.batches)) {
    const mine = car.parts.find((p) => p.bm === bm);
    for (const c of F.cars) for (const p of c.parts) if (p.bm === bm) p.bm.setVisibleAt(p.id, c === car);
    if (!mine) bm.visible = false;
  }
  F.blobs.visible = false;
  return { x: car.x, z: car.z, lod: car.lod, parts: car.parts.map((p) => ({ m: p.bm.name, id: p.id, g0: p.g0, g1: p.g1, geo: p.bm.getGeometryIdAt(p.id) })) };
}, Z);
console.log(JSON.stringify(info));
const poses = process.argv[4] ? [['pose', ...JSON.parse(process.argv[4])]] : [['front', info.x + 4, 1.6, info.z + 6, 150, -12], ['side', info.x + 6, 1.6, info.z, 270, -12], ['rear', info.x + 4, 1.6, info.z - 6, 30, -12]];
for (const [n, x, y, z, h, p] of poses) {
  await page.evaluate(([x, y, z, h, p]) => window.__setCam(x, y, z, h, p), [x, y, z, h, p]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}-${n}.png` });
}
await browser.close();
