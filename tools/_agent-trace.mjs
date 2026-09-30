// ad-hoc: trace one agent (picked by a JS predicate on agents) every 0.5 s
// Usage: node tools/_agent-trace.mjs "a => a.path?.crossings?.length" [seconds] [x,z]
import { chromium } from 'playwright';
const pick = process.argv[2], secs = +(process.argv[3] || 30), tp = process.argv[4]?.split(',').map(Number);
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1040,736'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
await page.goto('http://localhost:5173/?autostart');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
const name = await page.evaluate((pick) => window.__people.agents.find(eval(pick)).name, pick);
if (tp) await page.evaluate(([x, z]) => window.__walker.teleport(x, z, 0, 0), tp);
for (let i = 0; i < secs * 2; i++) {
  console.log((i / 2).toFixed(1), await page.evaluate((name) => {
    const A = window.__people.people[name], o = A.blockBy || {};
    const cr = A.path.crossings.map((c) => `${c.s0.toFixed(1)}-${c.s1.toFixed(1)}`).join(' ');
    return `${name} ${A.state} s ${A.s.toFixed(1)} x ${A.x.toFixed(2)} z ${A.z.toFixed(2)} v ${A.speed.toFixed(2)} lat ${A.lat.toFixed(2)} bT ${A.blockedT.toFixed(1)} by ${o.agent ? o.agent.name : o.player ? 'player' : o.vehicle ? 'veh' : o.x != null ? 'static ' + o.x.toFixed(2) + ',' + o.z.toFixed(2) + ' r' + o.r.toFixed(2) : '-'} | cross ${cr}`;
  }, name));
  await page.waitForTimeout(500);
}
await browser.close();
