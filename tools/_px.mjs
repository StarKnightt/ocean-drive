// scratch: sample pixels of a PNG. Usage: node tools/_px.mjs file.png "x,y x,y ..." | "line x0,y0,x1,y1,n"
import { chromium } from 'playwright';
import fs from 'node:fs';
const [file, spec] = process.argv.slice(2);
let pts;
if (spec.startsWith('line')) {
  const [x0, y0, x1, y1, n] = spec.slice(5).split(',').map(Number);
  pts = Array.from({ length: n }, (_, i) => [Math.round(x0 + (x1 - x0) * i / (n - 1)), Math.round(y0 + (y1 - y0) * i / (n - 1))]);
} else pts = spec.split(' ').map((p) => p.split(',').map(Number));
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
const data = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
const res = await p.evaluate(async ({ data, pts }) => {
  const img = new Image(); img.src = data; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  return pts.map(([u, v]) => { const d = x.getImageData(u - 1, v - 1, 3, 3).data; let r = 0, g = 0, bb = 0; for (let i = 0; i < 9; i++) { r += d[i * 4]; g += d[i * 4 + 1]; bb += d[i * 4 + 2]; } return [u, v, Math.round(r / 9), Math.round(g / 9), Math.round(bb / 9)]; });
}, { data, pts });
for (const r of res) console.log(r.join('\t'));
await b.close();
