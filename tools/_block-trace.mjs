// ad-hoc: crowd-test check 2 with a trace (hotel walker, player 5 m ahead, moves away at 5 s)
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1040,736'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
await page.goto('http://localhost:5173/?autostart');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
const name = await page.evaluate(() => window.__people.agents.find((a) => a.kind === 'walk' && a.path?.half === 0.3).name);
await page.evaluate((name) => {
  const A = window.__people.people[name], q = {};
  A.path.at(A.s + A.dir * 5, q);
  const nx = q.dx * A.dir, nz = q.dz * A.dir, x = q.x - nz * A.lat, z = q.z + nx * A.lat;
  window.__walker.teleport(x, z, Math.atan2(A.x - x, -(A.z - z)) * 180 / Math.PI, -4);
  window.__blockAt = { x, z };
}, name);
for (let i = 0; i < 24; i++) {
  if (i === 10) await page.evaluate(() => { const b = window.__blockAt; window.__walker.teleport(b.x - 6, b.z, 90, -4); });
  console.log((i / 2).toFixed(1), await page.evaluate((name) => {
    const A = window.__people.people[name], w = window.__walker.pos, o = A.blockBy || {};
    return `x ${A.x.toFixed(2)} z ${A.z.toFixed(2)} v ${A.speed.toFixed(2)} dir ${A.dir} lat ${A.lat.toFixed(2)} bT ${A.blockedT.toFixed(1)} ghost ${(A.ghost ?? 0).toFixed(1)} player ${w.x.toFixed(2)},${w.y.toFixed(2)} by ${o.agent ? o.agent.name : o.player ? 'player' : o.x != null ? 'static ' + o.x.toFixed(2) + ',' + o.z.toFixed(2) + ' r' + o.r.toFixed(2) : '-'}`;
  }, name));
  await page.waitForTimeout(500);
}
await browser.close();
