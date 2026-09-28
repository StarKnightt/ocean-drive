// GPU frame time at the critic poses 1 and 2, Blender cars vs the procedural ones.
// Usage: node tools/car-perf.mjs [quality]   (one muted browser at a time)
import { chromium } from 'playwright';

const quality = process.argv[2] || 'high';
// poses 1 and 2 of tools/shots.mjs
const poses = [
  { id: 1, pos: [-25.5, 1.7, 35], heading: 345, pitch: 3 },
  { id: 2, pos: [-12, 1.7, 12], heading: 282, pitch: 7 },
];
for (const cars of ['procedural', 'glb']) {
  const browser = await chromium.launch({
    channel: 'chrome', headless: false,
    args: ['--mute-audio', '--window-position=1940,120', '--window-size=1040,736', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 576 }, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:5173/?autostart&dynres=0&quality=${quality}&cars=${cars}`);
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
  for (const s of poses) {
    await page.evaluate((s) => window.__setCam(s.pos[0], s.pos[1], s.pos[2], s.heading, s.pitch), s);
    await page.waitForTimeout(2500);
    const r = await page.evaluate(async () => {
      const ms = [];
      for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 100)); ms.push(window.__gpuGuard().lastMs); }
      ms.sort((a, b) => a - b);
      return { gpuMs: ms[10], info: window.__renderInfo() };
    });
    console.log(cars.padEnd(10), `shot${s.id}`, quality, `gpu ${r.gpuMs} ms`, `calls ${r.info.calls}`, `tris ${(r.info.triangles / 1e6).toFixed(2)}M`, `fps ${r.info.fps}`);
  }
  await browser.close();
}
