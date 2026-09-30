// scratch: sit in the convertible, then evaluate a JS snippet file (argv[2]) in the page
import { chromium } from 'playwright';
import fs from 'node:fs';
const code = fs.readFileSync(process.argv[2], 'utf8');
const browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1040,736', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto('http://localhost:5173/?autostart');
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
  await page.mouse.click(512, 288);
  if (!process.env.NOCAR) {
    await page.evaluate(() => window.__vehicles.mount('car'));
    await page.waitForTimeout(2500);
  } else await page.waitForTimeout(1500);
  console.log(await page.evaluate(code));
} finally { await browser.close(); }
