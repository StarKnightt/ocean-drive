// Composes the Open Graph / social preview card (1280x640) from a hero render.
// Hero: node tools/og-candidates.mjs og-work/hero 2 '[["d1",-16,1.5,1,212,5]]'
// Usage: node tools/og-image.mjs <hero.png> <out.png> [preview400.png]
import { chromium } from 'playwright';
import fs from 'node:fs';

const [hero, out, preview] = process.argv.slice(2);
const heroUrl = 'data:image/png;base64,' + fs.readFileSync(hero).toString('base64');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root {
    --serif: 'Bodoni MT', Didot, 'Bodoni 72', 'Times New Roman', Georgia, serif;
    --ital: Georgia, 'Times New Roman', serif;
    --sans: 'Segoe UI', 'Helvetica Neue', system-ui, sans-serif;
  }
  html, body { margin: 0; width: 1280px; height: 640px; overflow: hidden; background: #1a1936; }
  .card { position: relative; width: 1280px; height: 640px; overflow: hidden; color: #fff4e6;
    -webkit-font-smoothing: antialiased; }
  .bg { position: absolute; inset: 0; background: url(${heroUrl}) center / cover no-repeat;
    filter: saturate(1.06) contrast(1.03); }
  .shade { position: absolute; inset: 0;
    background:
      radial-gradient(ellipse 34% 26% at 17% 47%, rgba(255, 184, 150, 0.16), rgba(255, 184, 150, 0) 100%),
      linear-gradient(90deg, rgba(30, 18, 42, 0.84) 0%, rgba(40, 24, 52, 0.72) 24%, rgba(58, 34, 62, 0.4) 42%, rgba(70, 40, 66, 0.08) 58%, rgba(70, 40, 66, 0) 66%),
      linear-gradient(0deg, rgba(26, 14, 30, 0.38) 0%, rgba(26, 14, 30, 0) 24%),
      linear-gradient(180deg, rgba(26, 16, 40, 0.3) 0%, rgba(26, 16, 40, 0) 18%),
      radial-gradient(ellipse 90% 95% at 60% 50%, transparent 62%, rgba(18, 8, 24, 0.4) 100%); }
  .mark { position: absolute; left: 70px; width: 470px; top: 50%; transform: translateY(-52%); text-align: center; }
  .fan { display: block; width: 112px; margin: 0 auto 16px; color: rgba(255, 226, 186, 0.85); }
  .row { display: flex; align-items: center; justify-content: center; gap: 16px; }
  .l { width: 54px; height: 4px; border-top: 1px solid currentColor; border-bottom: 1px solid currentColor; box-sizing: border-box; opacity: 0.7; }
  .time { font: 400 14px/1 var(--sans); letter-spacing: 0.42em; color: rgba(255, 236, 214, 0.86); margin-bottom: 22px; }
  .time span { padding-left: 0.42em; }
  h1 { margin: 0; padding-left: 0.24em; font: 400 96px/0.98 var(--serif); letter-spacing: 0.24em; text-transform: uppercase;
    background: linear-gradient(to bottom, #fffaf1 30%, #f2cf9c 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
    filter: drop-shadow(0 2px 14px rgba(20, 10, 30, 0.55)); }
  .rule { margin: 24px 0 18px; color: rgba(255, 226, 186, 0.9); }
  .rule .l { width: 110px; }
  .dia { width: 9px; height: 9px; border: 1px solid currentColor; transform: rotate(45deg); box-sizing: border-box; }
  .dia::after { content: ''; display: block; margin: 2px; height: 3px; background: currentColor; }
  .sub { font: italic 400 29px/1.2 var(--ital); letter-spacing: 0.04em; color: #fff3e4; text-shadow: 0 1px 10px rgba(20, 10, 30, 0.5); }
  .tag { margin-top: 20px; padding-left: 0.3em; font: 400 13.5px/1.4 var(--sans); letter-spacing: 0.3em; text-transform: uppercase; color: rgba(255, 236, 214, 0.8); }
  .url { position: absolute; left: 70px; width: 470px; bottom: 34px; text-align: center; padding-left: 0.34em;
    font: 400 11.5px/1 var(--sans); letter-spacing: 0.34em; text-transform: uppercase; color: rgba(255, 234, 212, 0.6); }
</style></head><body><div class="card">
  <div class="bg"></div><div class="shade"></div>
  <div class="mark">
    <svg class="fan" viewBox="0 0 120 40" fill="none" stroke="currentColor" stroke-width="1.1" aria-hidden="true">
      <path d="M8 38 A52 52 0 0 1 112 38" /><path d="M26 38 A34 34 0 0 1 94 38" />
      <path d="M60 38 V4 M60 38 L38 9 M60 38 L82 9 M60 38 L20 20 M60 38 L100 20 M60 38 L10 32 M60 38 L110 32" opacity="0.8" />
      <path d="M2 38 H118" />
    </svg>
    <div class="row time"><i class="l"></i><span>6:52 AM</span><i class="l"></i></div>
    <h1 id="title">Ocean<br>Drive</h1>
    <div class="row rule"><i class="l"></i><i class="dia"></i><i class="l"></i></div>
    <div class="sub" id="sub">Miami Beach · Sunrise</div>
    <div class="tag" id="tag">A walkable procedural scene · three.js</div>
  </div>
  <div class="url">starknightt.github.io/ocean-drive</div>
</div></body></html>`;

const browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--window-position=1940,120'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);

const cdp = await page.context().newCDPSession(page);
await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
const { root } = await cdp.send('DOM.getDocument');
for (const sel of ['#title', '#sub', '#tag']) {
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  console.log(sel, fonts.map((f) => f.familyName).join(', '));
}

await page.screenshot({ path: out });
console.log('saved', out);
if (preview) {
  const png = 'data:image/png;base64,' + fs.readFileSync(out).toString('base64');
  await page.setViewportSize({ width: 400, height: 200 });
  await page.setContent(`<body style="margin:0"><img src="${png}" style="width:400px;height:200px;display:block"></body>`, { waitUntil: 'load' });
  await page.screenshot({ path: preview });
  console.log('saved', preview);
}
await browser.close();
