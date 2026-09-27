// Pixel diff of two shot folders (in a headless page): mean abs difference per channel,
// share of pixels differing by > 8 / > 24 levels, and a diff image per shot.
// Usage: node tools/_diff.mjs <labelA> <labelB>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [A, B] = process.argv.slice(2);
const files = fs.readdirSync(path.resolve('shots', A)).filter((f) => f.endsWith('.png'));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const out = path.resolve('shots', `diff-${A}-vs-${B}`);
fs.mkdirSync(out, { recursive: true });
for (const f of files) {
  const a = fs.readFileSync(path.resolve('shots', A, f)).toString('base64');
  const b = fs.readFileSync(path.resolve('shots', B, f)).toString('base64');
  const r = await page.evaluate(async ([a, b]) => {
    const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + s; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const W = ia.width, H = ia.height;
    const cv = (i) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, W, H).data; };
    const da = cv(ia), db = cv(ib);
    const dc = document.createElement('canvas'); dc.width = W; dc.height = H;
    const dg = dc.getContext('2d'); const di = dg.createImageData(W, H);
    let sum = 0, n8 = 0, n24 = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      sum += (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3;
      if (d > 8) n8++;
      if (d > 24) n24++;
      const v = Math.min(255, d * 4);
      di.data[i] = v; di.data[i + 1] = v; di.data[i + 2] = v; di.data[i + 3] = 255;
    }
    dg.putImageData(di, 0, 0);
    const px = W * H;
    return { mean: +(sum / px).toFixed(2), over8: +(100 * n8 / px).toFixed(2) + '%', over24: +(100 * n24 / px).toFixed(2) + '%', img: dc.toDataURL('image/png').split(',')[1] };
  }, [a, b]);
  fs.writeFileSync(path.join(out, f), Buffer.from(r.img, 'base64'));
  console.log(f.padEnd(36), JSON.stringify({ mean: r.mean, over8: r.over8, over24: r.over24 }));
}
await browser.close();
