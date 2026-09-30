// Draw calls / triangles / fps along the extended district (hotel sidewalk, looking north
// and south). Usage: node tools/_perf-district.mjs
import { chromium } from 'playwright';

const url = process.env.SHOT_URL || 'http://localhost:5173/';
const W = 1024, H = 576;
const browser = await chromium.launch({
  headless: false,
  args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(url + (url.includes('?') ? '&' : '?') + 'shot=1');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
for (const z of [0, 150, -150, 300, -300]) {
  for (const heading of [0, 180]) {
    await page.evaluate(([z, h]) => window.__setCam(-26, window.__groundHeight(-26, z) + 1.7, z, h, 2), [z, heading]);
    await page.waitForTimeout(2500);
    const i = await page.evaluate(() => window.__renderInfo());
    console.log(`z ${z}\theading ${heading}\tcalls ${i.calls}\ttris ${(i.triangles / 1e6).toFixed(2)}M\tfps ${i.fps}`);
  }
}
await browser.close();
