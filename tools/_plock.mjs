// Pointer-lock check: click the start overlay, confirm document.pointerLockElement, Esc,
// quick re-click (Chrome refuses < ~1 s after exit), then a later click re-locks.
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://localhost:5173/';
const W = 1024, H = 576;
const browser = await chromium.launch({
  channel: 'chrome', headless: false,
  args: ['--window-position=1940,120', `--window-size=${W + 16},${H + 160}`, '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push('pageerror: ' + e));
await page.addInitScript(() => {
  window.__rpl = [];
  const orig = Element.prototype.requestPointerLock;
  Element.prototype.requestPointerLock = function (...a) {
    const p = orig.apply(this, a);
    window.__rpl.push('call ' + JSON.stringify(a) + ' act=' + navigator.userActivation?.isActive);
    p?.then?.(() => window.__rpl.push('ok'), (e) => window.__rpl.push('rej ' + e.name + ': ' + e.message));
    return p;
  };
});
await page.goto(url);
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.evaluate(() => {
  window.__plog = [];
  document.addEventListener('pointerlockchange', () => window.__plog.push('change:' + (document.pointerLockElement?.tagName ?? 'none')));
  document.addEventListener('pointerlockerror', () => window.__plog.push('error'));
});
const state = () => page.evaluate(() => ({
  lock: document.pointerLockElement?.tagName ?? null,
  overlayHidden: document.getElementById('overlay')?.classList.contains('hidden'),
  active: window.__walker.active, dragLook: window.__walker.dragLook, plog: window.__plog.slice(), rpl: window.__rpl.slice(),
  top: document.elementFromPoint(512, 288)?.id || document.elementFromPoint(512, 288)?.tagName,
  dom: { connected: window.__walker.dom.isConnected, same: window.__walker.dom === document.querySelector('canvas'), canvases: document.querySelectorAll('canvas').length, hasFocus: document.hasFocus() },
}));
await page.waitForTimeout(1500);
await page.bringToFront();
console.log('before click', await state());
await page.mouse.click(512, 288);
await page.waitForTimeout(600);
console.log('after click', await state());
await page.mouse.move(600, 300);
await page.evaluate(() => document.exitPointerLock());   // stands in for the user's Esc
await page.waitForTimeout(300);
console.log('after exit', await state());
await page.mouse.click(512, 288);          // too soon: Chrome rejects, walker retries at ~1.15 s
await page.waitForTimeout(250);
console.log('quick re-click', await state());
await page.waitForTimeout(1500);
console.log('after auto-retry', await state());
await page.evaluate(() => document.exitPointerLock());
await page.waitForTimeout(1500);
await page.mouse.click(512, 288);
await page.waitForTimeout(600);
console.log('later re-click', await state());
// Chrome's post-Esc refusal can't be produced by synthetic input: stub one rejection
await page.evaluate(() => {
  const w = window.__walker, el = w.dom, orig = el.requestPointerLock.bind(el);
  let n = 0;
  el.requestPointerLock = (o) => (n++ === 0 ? Promise.reject(new DOMException('exited recently', 'SecurityError')) : orig(o));
  document.exitPointerLock();
});
await page.waitForTimeout(200);
await page.evaluate(() => { window.__walker.unlockedAt = performance.now() - 300; });   // "Esc" 0.3 s ago
await page.mouse.click(512, 288);
await page.waitForTimeout(300);
console.log('stubbed refusal', await state());
await page.waitForTimeout(1200);
console.log('after cooldown retry', await state());
// jump: Space while locked
const j = await page.evaluate(async () => {
  const w = window.__walker, y0 = w.camera.position.y; let top = y0;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
  const t0 = performance.now();
  while (performance.now() - t0 < 1200) { await new Promise((r) => requestAnimationFrame(r)); top = Math.max(top, w.camera.position.y); }
  return { y0: +y0.toFixed(3), apex: +(top - y0).toFixed(3), end: +(w.camera.position.y - y0).toFixed(3), land: window.__stepLog.filter((s) => s.land).length };
});
console.log('jump', j);
console.log(logs.filter((l) => !l.startsWith('debug')).slice(0, 20).join('\n'));
await browser.close();
