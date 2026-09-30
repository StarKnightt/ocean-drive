// Jump checks: apex, railing still blocks while jumping, curb step-up while hopping.
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1040,736'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5173/?autostart');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const w = window.__walker, st = window.__beach.surfaces, out = {};
  w.teleport(-26.4, 30, 0, 0);
  let y0 = w.camera.position.y, top = y0;
  w.virtualKeys = new Set(['Space']); w.update(1 / 60); w.virtualKeys = null;
  for (let i = 0; i < 120; i++) { w.update(1 / 60); top = Math.max(top, w.camera.position.y); }
  out.apex = +(top - y0).toFixed(3);
  out.settled = +(w.camera.position.y - y0).toFixed(3);
  // deck: jump-walk into the railing
  const zc = (st.stair.z0 + st.stair.z1) / 2;
  w.teleport(st.deck.x0 + 1.2, zc, 0, 0, st.deckY);
  out.onDeck = +(w.feetY - st.deckY).toFixed(3);
  w.yaw = -Math.PI; // heading 180 = south (+z)
  w.simulate(['KeyW', 'Space'], 4);
  out.railBlocks = w.pos.y < st.deck.z1;
  out.stillOnDeck = +(w.feetY - st.deckY).toFixed(3);
  // road -> curb while hopping
  w.teleport(-20, -10, 270, 0);
  w.simulate(['KeyW', 'Space'], 3);
  out.curb = { x: +w.pos.x.toFixed(2), feet: +w.feetY.toFixed(3), ground: +window.__beach.groundAt(w.pos.x, w.pos.y).toFixed(3) };
  w.simulate([], 1);
  out.curbRest = { x: +w.pos.x.toFixed(2), feet: +w.feetY.toFixed(3), ground: +window.__beach.groundAt(w.pos.x, w.pos.y).toFixed(3) };
  w.teleport(-20, -10, 270, 0); w.simulate(['KeyW'], 5); out.curbWalk = { x: +w.pos.x.toFixed(2), feet: +w.feetY.toFixed(3) };
  out.lands = window.__stepLog.filter((s) => s.land).length;
  return out;
});
console.log(r, errors.length ? errors : 'no errors');
await browser.close();
