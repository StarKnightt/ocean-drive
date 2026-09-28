// scratch: which term makes the fender highlight blob (hero-wheel pose)
import { chromium } from 'playwright';
const W = 1024, H = 576;
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto('http://localhost:5173/?shot=1&nopost');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.evaluate(() => window.__setCam(-20.0, window.__groundHeight(-20, 9.58) + 0.62, 9.58, 270, -3));
const variants = [
  ['base', {}],
  ['nocoat', { clearcoat: 0 }],
  ['nospec', { specularIntensity: 0 }],
  ['noenv', { envMapIntensity: 0 }],
  ['coatrough', { clearcoatRoughness: 0.2 }],
  ['nosun', { __sun: 0 }],
];
const out = [];
for (const [name, set] of variants) {
  const r = await page.evaluate((set) => {
    let m = window.__pm ?? null;
    if (!m) window.__cars.hero.traverse((o) => { if (o.isMesh && o.material?.clearcoat === 1 && o.material.specularIntensity < 0.3 && o.material.color.g > o.material.color.r * 2) m = o.material; });
    if (!m) return 'no paint';
    window.__pm = m;
    m.userData.save ??= { clearcoat: m.clearcoat, specularIntensity: m.specularIntensity, envMapIntensity: m.envMapIntensity, clearcoatRoughness: m.clearcoatRoughness };
    Object.assign(m, m.userData.save, set);
    let sun = null; window.__scene.traverse((o) => { if (o.isDirectionalLight) sun = o; });
    sun.userData.i ??= sun.intensity; sun.intensity = set.__sun === 0 ? 0 : sun.userData.i; delete m.__sun;
    m.needsUpdate = true;
    return m.name + ' ' + JSON.stringify(m.userData.save);
  }, set);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `shots/_paint-${name}.png`, clip: { x: 300, y: 170, width: 220, height: 140 } });
  out.push([name, r]);
}
console.log(JSON.stringify(out));
await browser.close();
