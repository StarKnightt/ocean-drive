// Open-world phase 2 screenshots (shots/openworld-p2/). Sections (default all):
// roof (the SUV's roof from above and from the chase camera), surf (spray and the wheel wake),
// minimap, radio, traffic (exiting a traffic driver), props (knocked bins and barricades),
// dents, edge (the road-closed barricades at the world end).
// Usage: node tools/openworld-p2-shots.mjs [section,...]   (URL=http://127.0.0.1:port/)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.URL ?? 'http://localhost:5173/';
const outDir = path.resolve('shots', 'openworld-p2');
fs.mkdirSync(outDir, { recursive: true });
const ALL = ['roof', 'surf', 'minimap', 'radio', 'traffic', 'props', 'dents', 'edge'];
const want = new Set((process.argv[2] ?? ALL.join(',')).split(','));
const W = 1280, H = 720;
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url + '?autostart&dynres=0');
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 180000 });
  await page.mouse.click(W / 2, H / 2);
  const shot = async (name, wait = 600, clip = null) => {
    await page.waitForTimeout(wait);
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file, ...(clip ? { clip } : {}) });
    console.log('shot', file);
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const clearTraffic = () => ev(() => { for (const t of window.__traffic.cars) { t.hidden = true; t.v = 0; t.z = t.dir * 470; } });
  // into the nearest parked SUV (at its driver's door), chase view
  const enterSuv = async (z = 20) => {
    await ev((z) => {
      const V = window.__vehicles, s = V.parkedNear(-22, z, 'suv')[0];
      const d = V.doorsOf(s)[0];
      window.__walker.teleport(d.x + 0.3, d.z, Math.atan2(s.x - d.x, -(s.z - d.z)) * 180 / Math.PI, -8);
    }, z);
    await page.waitForTimeout(600);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(1300);
    if (await ev(() => window.__vehicles.view) !== 'chase') await page.keyboard.press('KeyC');
  };
  const chaseLook = (yawOff, pitch, secs = 0.6) => ev(([a, p, s]) => { const w = window.__walker, V = window.__vehicles, v = V.current; w.yaw = v.yaw + a; w.pitch = p; V.simulate([], s); }, [yawOff, pitch, secs]);

  if (want.has('roof') || want.has('surf')) {
    await enterSuv();
    await clearTraffic();
    if (want.has('roof')) {
      // on the drive, the chase arm swung up high over the roof
      await ev(() => { const V = window.__vehicles; V.place(-16.25, -40, 0); V.simulate([], 0.6); });
      await chaseLook(0.7, -0.6);
      await shot('1-suv-roof-from-above', 700);
      await chaseLook(2.4, -0.3);
      await shot('1b-suv-roof-chase', 500);
    }
    if (want.has('surf')) {
      // along the swash where it is ~15 cm deep, driving north, seen from the land side; the
      // surges come and go, so a few takes (the best kept by eye)
      await page.keyboard.down('KeyW');
      for (const [k, z] of [['a', -110], ['b', -150], ['c', -190], ['d', -230]]) {
        await ev((z) => {
          const B = window.__beach, V = window.__vehicles;
          let x = 86;
          for (let q = 60; q < 110; q += 0.25) if (B.waterDepthAt(q, z) > 0.08) { x = q; break; }
          V.place(x, z + 30, 0); V.simulate(['KeyW'], 3.2);
          const w = window.__walker, v = V.current; w.yaw = v.yaw - Math.PI / 2 - 0.6; w.pitch = -0.1; V.simulate(['KeyW'], 0.4);
        }, z);
        console.log('spray', k, await ev(() => { const V = window.__vehicles, v = V.current; return { alive: V.spray.alive, depth: v.wheelDepth.map((d) => +d.toFixed(2)), lon: +v.lon.toFixed(1), x: +v.x.toFixed(1) }; }));
        await shot('2-surf-spray-' + k, 150);
        await ev(() => { const w = window.__walker, V = window.__vehicles, v = V.current; w.yaw = v.yaw - Math.PI / 2 + 0.35; w.pitch = -0.34; V.simulate(['KeyW'], 0.3); });
        await shot('2b-surf-spray-close-' + k, 150);
      }
      console.log('wake', await ev(() => { const v = window.__vehicles.current, m = window.__vehicles.wake.mesh; const p = m.geometry.attributes.iPos.array, d = m.geometry.attributes.iDir.array; return { str: Array.from(window.__vehicles.wake?.strength ?? []).map((s) => +s.toFixed(2)), depth: v.wheelDepth.map((d) => +d.toFixed(2)), wheelH: v.wheelH.map((d) => +d.toFixed(2)), groundY: +v.groundY.toFixed(2), bodyY: +v.bodyY.toFixed(2), x: +v.x.toFixed(1), z: +v.z.toFixed(1), pos: Array.from(p).map((q) => +q.toFixed(2)), dir: Array.from(d).map((q) => +q.toFixed(2)), lon: +v.lon.toFixed(1), vis: m.visible, count: m.geometry.instanceCount }; }));
      await page.keyboard.up('KeyW');
    }
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(1500);
  }
  if (want.has('traffic')) {
    // stand in the southbound lane ahead of a modern traffic car until it stops (it beeps and
    // waits), then at its driver's door: E. The driver gets out, waves, walks off
    const pick = await ev(() => {
      const T = window.__traffic;
      const c = T.cars.filter((q) => !q.hidden && !q.classic && q.dir === 1 && q.z > -150 && q.z < 60).sort((a, b) => b.z - a.z)[0];
      if (!c) return null;
      window.__walker.teleport(c.x, c.z + 16, 180, -4);
      return { id: c.id, z: +c.z.toFixed(1), model: c.model };
    });
    console.log('traffic car', pick);
    if (pick) {
      await page.waitForFunction((id) => { const c = window.__traffic.cars.find((q) => q.id === id); return c && c.v < 0.05; }, pick.id, { timeout: 30000 });
      const st = await ev((id) => {
        const T = window.__traffic, c = T.cars.find((q) => q.id === id);
        T.debug.freeze = true;
        const V = window.__vehicles;
        const [d] = V.doorsOf({ pose: { x: c.x, z: c.z, yaw: Math.atan2(0, c.dir) - Math.PI }, kind: c.model }).filter((q) => q.side === 'driver');
        window.__walker.teleport(d.x + 0.35, d.z, Math.atan2(c.x - d.x - 0.35, -(c.z - d.z)) * 180 / Math.PI, -6);
        return { honk: c.honk, startles: c.startles ?? 0, v: c.v, door: [d.x, d.z] };
      }, pick.id);
      console.log('stopped', st);
      await page.waitForTimeout(500);
      console.log('near', await ev(() => ({ near: window.__vehicles.near, door: window.__vehicles.nearDoor })));
      await page.keyboard.press('KeyE');
      await ev(() => { window.__traffic.debug.freeze = false; });
      await page.waitForTimeout(150);
      if (await ev(() => window.__vehicles.view) !== 'chase') await page.keyboard.press('KeyC');
      // the chase arm swung round to the driver's side, low
      const look = () => ev(() => { const w = window.__walker, v = window.__vehicles.current; if (v) { w.yaw = v.yaw - 1.9; w.pitch = -0.12; } });
      await look();
      await shot('5-traffic-driver-gets-out', 450);
      await look();
      await shot('5b-traffic-driver-waves', 900);
      console.log('driver', await ev(() => window.__exitDrivers.state()));
      await ev(() => { const w = window.__walker, v = window.__vehicles.current; if (v) { w.yaw = v.yaw - 2.6; w.pitch = -0.1; } });
      await shot('5c-traffic-driver-walks-off', 3500);
      console.log('driver', await ev(() => window.__exitDrivers.state()), 'entry', await ev(() => window.__vehicles.currentEntry?.origin));
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(1200);
    }
  }
  console.log('errors', errors.length ? errors.slice(0, 5) : 'none');
} finally {
  await browser.close();
}
