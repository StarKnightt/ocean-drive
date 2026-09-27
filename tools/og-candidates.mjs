// Renders candidate hero frames for the OG image at 1280x640.
// Usage: node tools/og-candidates.mjs <outDir> <dsf> '<json [[name,x,eye,z,heading,pitch],...]>' [extraQuery]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [outDir, dsf = '1', json, extra = ''] = process.argv.slice(2);
const cams = JSON.parse(json);
fs.mkdirSync(outDir, { recursive: true });
const W = 1280, H = 640;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: Number(dsf) });
await page.goto('http://localhost:5173/?shot=1&vehicles' + extra);
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 180000 });
for (const [name, x, eye, z, h, p] of cams) {
  await page.evaluate(([x, eye, z, h, p]) => {
    window.__setCam(x, window.__groundHeight(x, z) + eye, z, h, p);
  }, [x, eye, z, h, p]);
  await page.waitForTimeout(2000);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('saved', file);
}
await browser.close();
