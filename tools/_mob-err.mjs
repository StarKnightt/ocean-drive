// One mobile device's page errors with stacks. Usage: URL=... node tools/_mob-err.mjs "Pixel 7"
import { chromium, devices } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120'] });
try {
  const ctx = await browser.newContext({ ...devices[process.argv[2] ?? 'Pixel 7'] });
  const page = await ctx.newPage();
  const seen = new Set();
  page.on('pageerror', (e) => { const s = String(e.stack ?? e); if (!seen.has(s)) { seen.add(s); console.log('pageerror', s.slice(0, 900)); } });
  page.on('console', (m) => { if (m.type() === 'error' && !seen.has(m.text())) { seen.add(m.text()); console.log('console', m.text().slice(0, 600), JSON.stringify(m.location())); } });
  await page.goto((process.env.URL ?? 'http://localhost:5233/') + '?hud');
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 180000 });
  await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 60000 }).catch(() => {});
  await page.touchscreen.tap(200, 300);
  await page.waitForTimeout(4000);
} finally { await browser.close(); }
