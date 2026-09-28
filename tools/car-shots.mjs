// Close-up screenshots of the cars (same window setup as shots.mjs), several poses in one
// browser session. Usage: node tools/car-shots.mjs <outDir> [query]
// Poses: hero 3/4 front, side, rear 3/4, interior from above, parked row, parked close.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] || 'shots/cars');
const query = process.argv[3] || '';
fs.mkdirSync(outDir, { recursive: true });
// NOSHOT=1: a normal session (so ?quality=... applies; ?shot forces 'high')
const url = (process.env.SHOT_URL || 'http://localhost:5173/') + (process.env.NOSHOT ? '?autostart' : '?shot=1') + (query ? '&' + query : '');
// [name, x, eyeAboveGround, z, heading, pitch, fov?]
export const POSES = [
  ['hero-34front', -19.3, 1.45, 13.6, 330, -9],
  ['hero-side', -16.2, 1.25, 8.2, 270, -4],
  ['hero-34rear', -19.6, 1.5, 1.8, 212, -9],
  ['hero-interior', -22.6, 3.1, 5.6, 172, -52],
  ['hero-wheel', -20.0, 0.62, 9.58, 270, -3],
  ['hero-dash', -22.33, 1.3, 7.75, 180, -28],
  ['parked-row', -20.4, 1.6, -8, 350, -4],
  ['parked-close', -19.6, 1.35, -19.5, 318, -8],
];
const W = 1024, H = 576;
const browser = await chromium.launch({
  channel: 'chrome', headless: false,
  args: ['--mute-audio', '--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url);
try {
  await Promise.race([
    page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 }),
    new Promise((_, rej) => page.on('pageerror', rej)),
  ]);
} catch (e) {
  console.log('NOT READY', await page.evaluate(() => JSON.stringify(window.__bootTimes?.slice(-4))), '\n' + errors.join('\n'));
  await browser.close();
  process.exit(1);
}
const only = process.env.POSES ? process.env.POSES.split(',') : null;
for (const [name, x, eye, z, h, p] of POSES) {
  if (only && !only.includes(name)) continue;
  await page.evaluate(([x, eye, z, h, p]) => window.__setCam(x, window.__groundHeight(x, z) + eye, z, h, p), [x, eye, z, h, p]);
  await page.waitForTimeout(1200);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  const info = await page.evaluate(() => window.__renderInfo());
  console.log('saved', file, JSON.stringify(info));
}
if (errors.length) console.log('CONSOLE:\n' + [...new Set(errors)].slice(0, 20).join('\n'));
await browser.close();
