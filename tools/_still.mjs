// Still-camera flicker probe: identical camera, consecutive frames, frozen time.
import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.env.URL ?? 'http://localhost:5173/';
const q = process.argv[2] ?? '?shot=1';
const W = 960, H = 540;
const browser = await chromium.launch({
  channel: 'chrome', headless: false,
  args: ['--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(url + q);
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.evaluate(() => { for (const id of ['loader', 'overlay', 'note']) document.getElementById(id)?.remove(); });
await page.evaluate(() => window.__walker.teleport(-26.4, 30, 0, 2));
await page.waitForTimeout(1000);
const shots = [];
for (let i = 0; i < 2; i++) { shots.push((await page.screenshot()).toString('base64')); await page.waitForTimeout(150); }
// same camera, shadow box re-centred elsewhere (texel snapping => identical shadows)
const tp = async (z) => { await page.evaluate((z) => window.__walker.teleport(-26.4, z, 0, 2), z); await page.waitForTimeout(250); };
await tp(33.7); await tp(30.0);             // re-centred at 30.0 (fresh)
shots.push((await page.screenshot()).toString('base64'));
await tp(30.45);                            // no re-centre (< 0.5 m)
await tp(30.0);                             // back: box still centred for 33.7 -> 30 path? (30 vs 30.0: none)
await tp(30.9); await tp(30.45);            // re-centre at 30.9, then view from 30.45 (no re-centre)
await tp(30.0);                             // 0.9 from 30.9 -> re-centre at 30.0
await tp(30.49 + 0.9);                      // 31.39: re-centre there
await tp(30.9);                             // 0.49 away: kept at 31.39
await tp(30.9 - 0.0);
shots.push((await page.screenshot()).toString('base64'));   // camera 30.9, box at 31.39
await tp(29.5); await tp(30.9);             // fresh at 30.9
shots.push((await page.screenshot()).toString('base64'));
await tp(12.0); await tp(30.9 + 0.3);       // box at 31.2 (0.3 off after the far move? no: 18.9 m move -> 31.2)
await tp(30.9);                              // kept at 31.2
shots.push((await page.screenshot()).toString('base64'));
const res = await page.evaluate(async (list) => {
  const load = async (s) => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); return i; };
  const imgs = await Promise.all(list.map(load));
  const w = imgs[0].naturalWidth, h = imgs[0].naturalHeight;
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
  const data = imgs.map((im) => { x.drawImage(im, 0, 0); return x.getImageData(0, 0, w, h).data; });
  const out = [];
  for (let k = 1; k < data.length; k++) {
    let s = 0, n = 0; const rows = new Float64Array(9);
    for (let o = 0; o < data[0].length; o += 4) {
      const d = Math.abs(data[k][o] - data[k - 1][o]) + Math.abs(data[k][o + 1] - data[k - 1][o + 1]) + Math.abs(data[k][o + 2] - data[k - 1][o + 2]);
      s += d; n++; rows[Math.floor((o / 4 / w) / (h / 9))] += d / (w * h / 9);
    }
    out.push({ mean: +(s / n).toFixed(2), rows: [...rows].map((v) => +v.toFixed(1)) });
  }
  return out;
}, shots);
console.log(JSON.stringify(res));
fs.writeFileSync('shots/glitch/still-a.png', Buffer.from(shots[0], 'base64'));
fs.writeFileSync('shots/glitch/still-b.png', Buffer.from(shots[1], 'base64'));
await browser.close();
