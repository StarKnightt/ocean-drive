// Crop a region (fractions) of an image and save it enlarged (nearest neighbour).
// Usage: node tools/crop.mjs <in> <out.png> x0 y0 x1 y1 [scale=3]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [inp, out, x0, y0, x1, y1, scale = '3'] = process.argv.slice(2);
const ext = path.extname(inp).slice(1).toLowerCase().replace('jpg', 'jpeg');
const data = `data:image/${ext};base64,` + fs.readFileSync(inp).toString('base64');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const b64 = await page.evaluate(async ({ data, r, s }) => {
  const img = new Image();
  img.src = data;
  await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const sx = r[0] * W, sy = r[1] * H, sw = (r[2] - r[0]) * W, sh = (r[3] - r[1]) * H;
  const c = document.createElement('canvas');
  c.width = Math.round(sw * s);
  c.height = Math.round(sh * s);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/png').split(',')[1];
}, { data, r: [x0, y0, x1, y1].map(Number), s: Number(scale) });
fs.writeFileSync(out, Buffer.from(b64, 'base64'));
await browser.close();
