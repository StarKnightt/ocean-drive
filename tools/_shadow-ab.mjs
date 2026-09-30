// scratch: A/B of a person's projected sun shadow -> shots/_shadow-ab/
// Usage: node tools/_shadow-ab.mjs [beach|prom]
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = 'shots/_shadow-ab';
fs.mkdirSync(out, { recursive: true });
const which = process.argv[2] || 'beach';
const W = 1024, H = 576;
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto('http://localhost:5173/?autostart');
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 180000 });
  const frame = (which) => page.evaluate((which) => {
    const ag = window.__people.agents.filter((a) => !a.hidden && a.kind === 'walk');
    const A = which === 'beach' ? ag.find((a) => a.path?.half === 3) : ag[0];
    const h = A.heading + (which === 'beach' ? 60 : 25) * Math.PI / 180, d = which === 'beach' ? 9 : 10;
    const x = A.x + Math.sin(h) * d, z = A.z + Math.cos(h) * d;
    const gc = window.__groundHeight(x, z), g = window.__groundHeight(A.x, A.z);
    window.__walker.set(x, gc + 1.7, z, Math.atan2(A.x - x, -(A.z - z)) * 180 / Math.PI, Math.atan2(g + 1 - gc - 1.7, d) * 180 / Math.PI);
    window.__abA = A;
    return { name: A.name, char: A.P.asset.name, clip: A.loco?.getClip().name, sh: !!A.P.shadow, shVis: A.P.shadow?.visible, strength: A.P.per?.uStrength.value };
  }, which);
  console.log(JSON.stringify(await frame(which)));
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__people.debug.freeze = true; });
  console.log(JSON.stringify(await frame(which)));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${which}-a-default.png` });
  await page.evaluate(() => { window.__abA.P.shadow.visible = false; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${which}-b-noshadow.png` });
  await page.evaluate(() => { const s = window.__abA.P.shadow; s.visible = true; s.material.depthWrite = false; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${which}-c-nodepth.png` });
  await page.evaluate(() => { const s = window.__abA.P.shadow; s.material.depthWrite = true; window.__abA.P.per.uStrength.value = 6; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${which}-d-mask.png` });
} finally { await browser.close(); }
