// ad-hoc: watch every path agent for 60 s, report anyone stopped > 3 s and what blocks it
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1040,736'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
await page.goto('http://localhost:5173/?autostart');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.evaluate(() => window.__walker.teleport(-5, -60, 0, 0));
const seen = {};
for (let i = 0; i < 120; i++) {
  const r = await page.evaluate(() => window.__people.agents.filter((a) => a.path && !a.hidden && a.blockedT > 3).map((a) => {
    const o = a.blockBy || {};
    return `${a.name} x ${a.x.toFixed(2)} z ${a.z.toFixed(2)} dir ${a.dir} lat ${a.lat.toFixed(2)} half ${a.path.half} bT ${a.blockedT.toFixed(1)} by ${o.agent ? o.agent.name : o.player ? 'player' : o.vehicle ? 'vehicle' : 'static'} @ ${o.x?.toFixed(2)},${o.z?.toFixed(2)} r ${o.r}`;
  }));
  for (const s of r) { const k = s.split(' ')[0]; if (!seen[k] || i - seen[k] > 10) { console.log(i / 2, s); seen[k] = i; } }
  await page.waitForTimeout(500);
}
await browser.close();
