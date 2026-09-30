// ad-hoc: while driving the convertible, find what forces three's getProgram each frame:
// materials whose version changes, and lights whose visible/castShadow flip.
import { chromium } from 'playwright';
const browser = await chromium.launch({
  channel: 'chrome', headless: false,
  args: ['--mute-audio', '--window-position=1940,120', '--window-size=1603,902', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage({ viewport: null });
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 30000 });
await page.mouse.click(700, 400);
await page.waitForTimeout(500);
const probe = () => page.evaluate(async () => {
  const mats = new Map(), lights = [];
  window.__scene.traverse((o) => {
    if (o.isLight) lights.push(o);
    for (const m of [o.material].flat()) if (m) mats.set(m, { v0: m.version, o, n: 0 });
  });
  const lstate = () => lights.map((l) => `${l.type}:${l.visible}:${l.castShadow}`).join('|');
  const l0 = lstate(); let lightFlips = 0, prev = l0;
  for (let f = 0; f < 60; f++) {
    await new Promise((r) => requestAnimationFrame(r));
    for (const [m, e] of mats) if (m.version !== e.v0) { e.n++; e.v0 = m.version; }
    const s = lstate(); if (s !== prev) { lightFlips++; prev = s; }
  }
  const changed = [...mats].filter(([, e]) => e.n > 0).map(([m, e]) => ({ mat: m.name || m.type, obj: e.o.name || e.o.type, parent: e.o.parent?.name, changes: e.n }));
  let newObjs = 0; window.__scene.traverse((o) => { for (const m of [o.material].flat()) if (m && !mats.has(m)) newObjs++; });
  return { lights: lights.length, lightFlips, changed: changed.slice(0, 30), nChanged: changed.length, newMaterials: newObjs };
});
console.log('walk', JSON.stringify(await probe()));
console.log('stacks', JSON.stringify(await page.evaluate(async () => {
  const want = ['glass_L1', 'bird-shadows', 'lewis_L1_1'], out = {};
  window.__scene.traverse((o) => {
    if (!want.includes(o.name) || out[o.name]) return;
    const m = [o.material].flat()[0]; out[o.name] = [];
    let v = m.version;
    Object.defineProperty(m, 'version', { configurable: true, get: () => v, set: (x) => { v = x; if (out[o.name].length < 2) out[o.name].push(new Error().stack.split('\n').slice(1, 7).map((s) => s.trim()).join(' <- ')); } });
  });
  for (let f = 0; f < 5; f++) await new Promise((r) => requestAnimationFrame(r));
  return out;
}), null, 1));
await page.evaluate(() => { const v = window.__vehicles.list.find((e) => e.kind === 'car').v; window.__walker.teleport(v.x - 2.4, v.z, 90, -5); });
await page.waitForTimeout(500);
await page.keyboard.press('KeyE');
await page.waitForTimeout(1800);
await page.evaluate(() => { const v = window.__vehicles.current; window.__vehicles.place(-19.75, v.z, Math.PI); });
await page.keyboard.down('KeyW');
await page.waitForTimeout(1000);
console.log('car', JSON.stringify(await probe()));
await page.keyboard.up('KeyW');
await browser.close();
