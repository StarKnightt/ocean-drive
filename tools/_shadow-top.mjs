// scratch: a person's projected sun shadow and contact patch seen from above -> shots/_shadow-top/
// Usage: node tools/_shadow-top.mjs [agent name, default walk-0]
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = 'shots/_shadow-top';
fs.mkdirSync(out, { recursive: true });
const who = process.argv[2] || 'walk-0';
const W = 1024, H = 576;
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto('http://localhost:5173/?autostart');
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 180000 });
  const place = () => page.evaluate((who) => {
    const A = window.__people.people[who];
    const cx = A.x + 6, g = window.__groundHeight(cx, A.z); window.__walker.set(cx, g + 1.7, A.z + 0.01, 270, -14);
    return { x: A.x, z: A.z, vis: A.visible, lvl: A.P.level, sh: A.P.shadow?.visible, shParent: A.P.shadow?.parent?.type, base: A.P.per?.uBaseY.value };
  }, who);
  console.log(JSON.stringify(await place()));
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__people.debug.freeze = true; });
  console.log(JSON.stringify(await place()));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${who}-top.png` });
  await page.evaluate((who) => { window.__people.people[who].P.per.uStrength.value = 6; }, who);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${who}-mask.png` });
} finally { await browser.close(); }
