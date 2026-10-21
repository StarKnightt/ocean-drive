// Records the demo day mission as a cinematic take: output/demo-day.mp4.
//   pnpm record                      1920x1080, 60 fps, the whole take (~35 s), H.264 crf 16 + AAC
//   pnpm record -- --width 640 --height 360 --fps 30 --seconds 3 --out output/test.mp4
// Options: --width --height --fps --seconds (stop after this much; default: the end of the
// take) --quality (the game's tier, default high) --clock (the mission clock, s) --headed
// --swiftshader (software GL, for machines without a GPU) --out
// Env: FFMPEG (path to ffmpeg, default ffmpeg on PATH), CHROMIUM (a browser to use instead of
// Playwright's).
//
// The game runs in ?capture=1: it does not run on its own clock but advances one exact frame
// per step (src/capture/stepper.js). Each step's frame is screenshotted and piped to ffmpeg,
// so the video is smooth however slowly the frames are drawn. The audio is the game's own
// synth rendered offline in step with the frames, then muxed in.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i < 0 ? def : argv[i + 1]; };
const flag = (name) => argv.includes(`--${name}`);
const W = +opt('width', 1920), H = +opt('height', 1080), FPS = +opt('fps', 60);
const LIMIT = opt('seconds', null) == null ? Infinity : +opt('seconds');
const OUT = path.resolve(opt('out', 'output/demo-day.mp4'));
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const PRIME = Math.round(FPS * 1.5);              // unrecorded frames first: the world settles
const MAX_S = 60;                                  // the take ends itself at ~35 s

if (spawnSync(FFMPEG, ['-version']).status !== 0) {
  console.error(`ffmpeg not found (${FFMPEG}). Install it (Windows: winget install Gyan.FFmpeg; macOS: brew install ffmpeg) or set FFMPEG to its path.`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-day-'));
const videoTmp = path.join(tmp, 'video.mp4'), audioTmp = path.join(tmp, 'audio.wav');

// the game, served by Vite from this checkout
const server = await createServer({ root: path.resolve('.'), logLevel: 'error', server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
const query = new URLSearchParams({ capture: '1', fps: String(FPS), quality: opt('quality', 'high'), seconds: String(MAX_S + 10), ...(opt('clock') ? { clock: opt('clock') } : {}) });

const gl = flag('swiftshader') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const browser = await chromium.launch({
  headless: !flag('headed'), ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ['--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', ...gl],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const cdp = await page.context().newCDPSession(page);
const ffmpeg = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), videoTmp], { stdio: ['pipe', 'inherit', 'inherit'] });
const ffmpegDone = new Promise((r) => ffmpeg.on('close', r));

let frames = 0;
try {
  console.log(`loading ${url} (${W}x${H} ${FPS} fps)…`);
  await page.goto(`${url}?${query}`);
  await page.waitForFunction(() => !!window.__capture, null, { timeout: 15 * 60 * 1000 });
  await page.evaluate((n) => window.__capture.prime(n), PRIME);
  await page.evaluate(() => window.__capture.begin());
  const t0 = Date.now();
  const total = Math.min(LIMIT, MAX_S) * FPS;
  while (frames < total) {
    const done = await page.evaluate(() => window.__capture.step().then(() => window.__capture.done));
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
    if (!ffmpeg.stdin.write(Buffer.from(data, 'base64'))) await new Promise((r) => ffmpeg.stdin.once('drain', r));
    frames++;
    if (frames % FPS === 0) {
      const s = (Date.now() - t0) / 1000, phase = await page.evaluate(() => window.__director?.phase);
      console.log(`${(frames / FPS).toFixed(0)} s recorded (${phase}) · ${(frames / s).toFixed(1)} frames/s`);
    }
    if (done) break;
  }
  ffmpeg.stdin.end();
  // the audio of exactly the recorded frames
  const n = await page.evaluate(() => window.__capture.finishAudio());
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(Buffer.from(await page.evaluate((i) => window.__capture.wav[i], i), 'base64'));
  fs.writeFileSync(audioTmp, Buffer.concat(parts));
} finally {
  await browser.close();
  await server.close();
}
if ((await ffmpegDone) !== 0) { console.error('ffmpeg failed encoding the frames'); process.exit(1); }
const mux = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', videoTmp, '-i', audioTmp, '-map', '0:v', '-map', '1:a',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
if (mux.status !== 0) { console.error('ffmpeg failed muxing the audio'); process.exit(1); }
fs.rmSync(tmp, { recursive: true, force: true });
if (errors.length) console.warn('page errors:\n  ' + errors.join('\n  '));
console.log(`${OUT}: ${frames} frames, ${(frames / FPS).toFixed(2)} s`);
