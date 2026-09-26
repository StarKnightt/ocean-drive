// Average sRGB of named rectangular regions in images (screenshots or reference photos).
// Usage: node tools/sample.mjs <spec.json>
//   spec: { "<image path>": { "<region name>": [x0, y0, x1, y1] } }   (fractions 0..1)
// Prints mean R G B, mean luma and the luma standard deviation per region.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

for (const [file, regions] of Object.entries(spec)) {
  const ext = path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg');
  const data = `data:image/${ext};base64,` + fs.readFileSync(file).toString('base64');
  const out = await page.evaluate(async ({ data, regions }) => {
    const img = new Image();
    img.src = data;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const res = {};
    for (const [name, [x0, y0, x1, y1]] of Object.entries(regions)) {
      const px = Math.round(x0 * c.width), py = Math.round(y0 * c.height);
      const w = Math.max(1, Math.round((x1 - x0) * c.width)), h = Math.max(1, Math.round((y1 - y0) * c.height));
      const d = ctx.getImageData(px, py, w, h).data;
      let r = 0, g = 0, b = 0, l = 0, l2 = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]; g += d[i + 1]; b += d[i + 2];
        const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        l += y; l2 += y * y;
      }
      l /= n;
      res[name] = [r / n, g / n, b / n, l, Math.sqrt(Math.max(0, l2 / n - l * l))].map((v) => Math.round(v));
    }
    return { size: [c.width, c.height], res };
  }, { data, regions });
  console.log(`\n${path.basename(file)}  (${out.size.join('x')})`);
  for (const [name, [r, g, b, l, sd]] of Object.entries(out.res)) {
    console.log(`  ${name.padEnd(24)} rgb ${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}   luma ${String(l).padStart(3)}  sd ${sd}`);
  }
}
await browser.close();
