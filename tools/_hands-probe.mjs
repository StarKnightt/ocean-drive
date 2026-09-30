// scratch: the player's hands on the convertible's wheel at held steering inputs, plus the
// look-down view -> shots/_hands-probe/. Usage: node tools/_hands-probe.mjs [info]
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = 'shots/_hands-probe';
fs.mkdirSync(out, { recursive: true });
const W = 1024, H = 576;
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[probe]')) console.log('console', m.text()); });
  await page.goto('http://localhost:5173/?autostart');
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
  await page.mouse.click(W / 2, H / 2);
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const v = window.__vehicles.list.find((e) => e.kind === 'car').v; window.__walker.teleport(v.x - 2.4, v.z, 90, -18); });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__vehicles.mount('car'));
  await page.waitForTimeout(2200);
  const shot = async (n, w = 500) => { await page.waitForTimeout(w); await page.screenshot({ path: `${out}/${n}.png` }); console.log(n); };
  if (process.argv[2] === 'info') {
    console.log(await page.evaluate(() => {
      const h = window.__cars.hero, st = h.getObjectByName('steering_wheel');
      const r = (o) => o && [o.position.x, o.position.y, o.position.z].map((x) => +x.toFixed(3));
      const gl = h.getObjectByName('grip_L'), gr = h.getObjectByName('grip_R');
      const P = window.__people?.playerDriver;
      const bones = P ? Object.keys(P.bones).filter((n) => /Hand/.test(n)) : null;
      let tg = null;
      window.__scene?.traverse((o) => { if (!tg && /_grip_L$/.test(o.name)) tg = { name: o.name, parent: o.parent.name, pos: r(o), pq: o.parent.quaternion.toArray().map((x) => +x.toFixed(3)) }; });
      return JSON.stringify({ st: r(st), stParent: st.parent.name, gl: r(gl), glParent: gl?.parent?.name, gr: r(gr), q0: st.userData.q0.toArray().map((x) => +x.toFixed(3)), bones, tg });
    }));
  }
  const cam = (yaw, pitch) => page.evaluate(([yaw, pitch]) => { const w = window.__walker; w.pitch = pitch; w.yaw += yaw; }, [yaw, pitch]);
  await cam(0, -0.28);
  const steers = (process.env.STEERS ?? '0,0.25,0.5,1,-0.5,-1').split(',').map(Number);
  for (const s of steers) {
    await page.evaluate((s) => { window.__vehicles.steerHold = s; }, s);
    await page.waitForTimeout(1500);
    const deg = await page.evaluate(() => { const v = window.__vehicles.current; return Math.round(v.steer / v.spec.steerMax * 450); });
    await shot(`steer-${s}-${deg}deg`, 0);
    if (s === 0 && process.env.ZOOM) {
      const z = (yaw, pitch, fov) => page.evaluate(([yaw, pitch, fov]) => { const w = window.__walker; w.pitch = pitch; w.yaw += yaw; w.camera.zoom = 65 / fov; w.camera.updateProjectionMatrix(); }, [yaw, pitch, fov]);
      await z(0.3, -0.36, 18); await shot('zoom-left', 300);
      await z(-0.6, -0.36, 18); await shot('zoom-right', 300);
      await z(0.3, -0.28, 65);
    }
  }
  await page.evaluate(() => { window.__vehicles.steerHold = null; });
  await page.waitForTimeout(1500);
  await cam(0, -0.62);
  await shot('look-down');
  await cam(0.35, -0.95);
  await shot('look-down-steep');
  await cam(-0.35, -0.05);
  await shot('driver-view');
  await cam(-1.1, -0.05);
  await shot('look-right');
} finally {
  await browser.close();
}
