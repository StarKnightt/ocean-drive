// Fixed-camera screenshot harness. Opens a real (GPU) Chrome window on the
// secondary monitor (x >= 1920) so the primary screen stays free.
// Usage: node tools/shots.mjs <label>   (dev server must be running on :5173)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const label = process.argv[2] || 'latest';
const url = process.env.SHOT_URL || 'http://localhost:5173/';
const outDir = path.resolve('shots', label);
fs.mkdirSync(outDir, { recursive: true });

// Compass heading: 0 = north (-z), 90 = east (+x, ocean), 180 = south, 270 = west (hotels).
export const SHOTS = [
  { id: 1, name: 'sidewalk-north', pos: [-25.5, 1.7, 35], heading: 345, pitch: 3 },
  { id: 2, name: 'hotel-fronts-from-park', pos: [-12, 1.7, 12], heading: 282, pitch: 7 },
  { id: 3, name: 'park-to-ocean-sun', pos: [5, 1.7, -14], heading: 102, pitch: 1, eyeAboveGround: 1.7 },
  { id: 4, name: 'tower-top-looking-back', pos: [45, 4.4, 5], heading: 262, pitch: -2 },
  { id: 5, name: 'waterline-waves', pos: [86, 1.7, -8], heading: 125, pitch: -6, eyeAboveGround: 1.7 },
];

const W = 1024, H = 576;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--mute-audio', 
    '--window-position=1940,120',
    `--window-size=${W + 16},${H + 160}`,
    '--autoplay-policy=no-user-gesture-required',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url + (url.includes('?') ? '&' : '?') + 'shot=1');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });

const report = { label, errors, shots: [] };
for (const s of SHOTS) {
  await page.evaluate((s) => {
    // eyeAboveGround: y is relative to terrain height (window.__groundHeight) when the app exposes it
    let y = s.pos[1];
    if (s.eyeAboveGround && window.__groundHeight) y = window.__groundHeight(s.pos[0], s.pos[2]) + s.eyeAboveGround;
    window.__setCam(s.pos[0], y, s.pos[2], s.heading, s.pitch);
  }, s);
  await page.waitForTimeout(1500);
  const file = path.join(outDir, `shot${s.id}-${s.name}.png`);
  await page.screenshot({ path: file });
  const info = await page.evaluate(() => (window.__renderInfo ? window.__renderInfo() : null));
  report.shots.push({ ...s, file, info });
  console.log('saved', file, info ? JSON.stringify(info) : '');
}
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'));
await browser.close();
