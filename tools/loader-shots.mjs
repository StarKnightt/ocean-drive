// Loader screenshots: node tools/loader-shots.mjs [width height]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [w = 1280, h = 720] = process.argv.slice(2).map(Number);
const tag = process.argv[2] ? `-${w}x${h}` : '';
mkdirSync('shots/loader', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const t0 = Date.now();
const log = async (what) => {
  const s = await page.evaluate(() => ({
    p: document.getElementById('loader')?.style.getPropertyValue('--p'),
    label: document.querySelector('#loader .ld-label')?.textContent,
    ready: window.__sceneReady,
  })).catch(() => ({}));
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${what}`, JSON.stringify(s));
};

await page.goto('http://localhost:5173/', { waitUntil: 'commit' });
await page.waitForSelector('#loader');
await page.waitForTimeout(250);
await page.screenshot({ path: `shots/loader/1-early${tag}.png` });
await log('early');

await page.waitForFunction(() => parseFloat(document.getElementById('loader')?.style.getPropertyValue('--p') || 0) > 0.3
  || window.__sceneReady, null, { timeout: 60000, polling: 50 });
await page.waitForTimeout(400);
await page.screenshot({ path: `shots/loader/2-mid${tag}.png` });
await log('mid');

await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 90000 });
await log('ready');
await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 10000 });
await page.waitForTimeout(700);
await page.screenshot({ path: `shots/loader/3-after${tag}.png` });
await log('after');
const overlay = await page.evaluate(() => {
  const o = document.getElementById('overlay');
  return { hidden: o.classList.contains('hidden'), opacity: getComputedStyle(o).opacity, bodyLoading: document.body.classList.contains('loading') };
});
console.log('overlay', JSON.stringify(overlay));

// ?shot mode: loader must never render
const shot = await browser.newPage({ viewport: { width: w, height: h } });
shot.on('pageerror', (e) => errors.push('shot pageerror: ' + e));
await shot.goto('http://localhost:5173/?shot=1', { waitUntil: 'commit' });
await shot.waitForSelector('#overlay', { state: 'attached' });
const shotState = await shot.evaluate(() => {
  const l = document.getElementById('loader');
  return { exists: !!l, display: l ? getComputedStyle(l).display : null };
});
console.log('shot mode loader', JSON.stringify(shotState));
await shot.waitForFunction(() => window.__sceneReady === true, null, { timeout: 90000 });
await shot.screenshot({ path: `shots/loader/4-shotmode${tag}.png` });

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
