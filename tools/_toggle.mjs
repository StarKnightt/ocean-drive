// Screenshot a pose with named things toggled off, one variant each.
// node tools/_toggle.mjs "[x,y,z,h,p]" out-prefix variant1 variant2 ...   variants: full, noblob, noroad, nofleetblob
import { chromium } from 'playwright';
const [pose, out, ...variants] = process.argv.slice(2);
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1040,736'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto('http://localhost:5173/?shot=1');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.evaluate((p) => window.__setCam(...p), JSON.parse(pose));
for (const v of variants) {
  const r = await page.evaluate((v) => {
    const F = window.__cars.fleet;
    const out = [];
    window.__scene.traverse((o) => { if (o.userData.__hid) { o.visible = true; delete o.userData.__hid; } });
    const hide = (o) => { if (o.visible) { o.visible = false; o.userData.__hid = true; out.push(o.name || o.type); } };
    if (v === 'noblob') { hide(F.blobs); }
    if (v === 'noroad') window.__scene.traverse((o) => { if (o.isMesh && /road|street|asphalt|curb|sidewalk/i.test(o.name + (o.material?.name ?? ''))) hide(o); });
    if (v.startsWith('only:')) window.__scene.traverse((o) => { if (o.isMesh && !o.isBatchedMesh && !new RegExp(v.slice(5), 'i').test(o.name + '|' + (o.material?.name ?? ''))) hide(o); });
    return out.slice(0, 20);
  }, v);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}-${v.replace(/[^a-z0-9]/gi, '_')}.png` });
  console.log(v, JSON.stringify(r));
}
await browser.close();
