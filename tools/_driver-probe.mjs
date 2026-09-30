// Which traffic cars carry a driver, and is it shown? (reuses people-shots' traffic framing)
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1040,736', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
page.on('console', (m) => { if (m.text().startsWith('[')) console.log('HID', m.text()); });
page.on('pageerror', (e) => console.log('ERR', String(e)));
await page.goto('http://localhost:5173/?autostart');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 180000 });
await page.evaluate(() => window.__walker.set(-12.5, 1.85, 0, 270, 0));
await page.waitForTimeout(2500);
console.log(await page.evaluate(() => {
  const T = window.__traffic, cam = window.__walker.pos; T.debug.freeze = true; window.__people.debug.freeze = false;
  const c = T.cars.filter((c) => !c.hidden && Math.abs(c.z) < 200 && c.model === "wagon" && c.dir < 0).sort((a, b) => Math.hypot(a.x - cam.x, a.z - cam.y) - Math.hypot(b.x - cam.x, b.z - cam.y))[0];
  const left = c.dir > 0 ? 1 : -1;
  const x = c.x + left * 2.7, z = c.z + c.dir * 2.2, tx = c.x + left * 0.35, tz = c.z - c.dir * 0.3;
  window.__walker.set(x, 1.6, z, Math.atan2(tx - x, -(tz - z)) * 180 / Math.PI, -8);
  return JSON.stringify({ car: [c.x, c.z, c.dir, c.model], cam: [x, z] });
}));
await page.waitForTimeout(1500);
console.log(JSON.stringify(await page.evaluate(() => window.__people.drivers.map((P) => ({ vis: P.visible, att: !!P.root.parent, ...P.dbg, at: P.dbg?.at.map((v) => +v.toFixed(1)) })).filter((o) => o.at && o.d < 12))).replaceAll('},', '}\n'));
console.log(JSON.stringify(await page.evaluate(() => {
  const out = [];
  window.__scene.traverse((o) => {
    if (o.name === 'driver_pelvis' || /pelvis/i.test(o.name) && o.parent && !o.isBone) {
      const p = o.getWorldPosition(new o.position.constructor());
      out.push({ n: o.name, kids: o.children.length, kidVis: o.children.map((k) => k.visible), p: [+p.x.toFixed(1), +p.z.toFixed(1)], vis: (() => { let v = true, q = o; while (q) { v &&= q.visible; q = q.parent; } return v; })() });
    }
  });
  return out.filter((o) => Math.abs(o.p[1]) < 60);
}), null, 0));
console.log(JSON.stringify(await page.evaluate(() => window.__people.drivers.filter((P) => P.dbg?.d < 6).map((P) => {
  const V = P.root.position.constructor;
  const h = P.bones.Head.getWorldPosition(new V()), hip = P.bones.Hips.getWorldPosition(new V());
  const meshes = []; P.root.traverse((o) => { if (o.isMesh) meshes.push({ n: o.name, vis: o.visible, fc: o.frustumCulled, bs: o.boundingSphere ? [o.boundingSphere.center.toArray().map((v) => +v.toFixed(2)), +o.boundingSphere.radius.toFixed(2)] : null, lay: o.layers.mask }); });
  let chain = true; for (let q = P.root; q; q = q.parent) chain &&= q.visible;
  return { head: h.toArray().map((v) => +v.toFixed(2)), hip: hip.toArray().map((v) => +v.toFixed(2)), chain, level: P.level, meshes };
}))));
await page.screenshot({ path: 'shots/_driver-probe.png' });
// the same, with the car's own meshes hidden: is the whole body there?
await page.evaluate(() => {
  const P = window.__people.drivers.find((P) => P.dbg?.d < 6);
  let car = P.root; for (let i = 0; i < 12 && car.parent && car.parent.type !== 'Scene'; i++) car = car.parent;
  const mine = new Set(); P.root.traverse((o) => mine.add(o));
  const hid = []; car.traverse((o) => { if (o.isMesh && !mine.has(o) && (o.material.transparent || /glass|window/i.test(o.name + o.material.name))) { o.visible = false; hid.push(o.name + ":" + o.material.name + ":" + o.material.transparent + ":" + o.material.opacity); } }); console.log(JSON.stringify(hid));
});
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/_driver-probe-bare.png' });
await browser.close();
