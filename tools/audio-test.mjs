// Offline renders of the ride + traffic audio, checked by level per segment (you can't listen
// in CI): the convertible's starter -> catch -> idle -> full-throttle pull with shifts -> brake
// squeal -> exit run-down; the bike -> car handover; traffic voices passing + a horn; then a live
// check that the running app builds those voices. Usage: node tools/audio-test.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio', '--window-position=1940,120', '--window-size=1040,736', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5173/?shot=0');
let failed = 0;
const check = (ok, msg, data) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${data ? ' ' + JSON.stringify(data) : ''}`); if (!ok) failed++; };

const res = await page.evaluate(async () => {
  const { createEngine } = await import('/src/audio/engine.js');
  const { createVehicleAudio } = await import('/src/audio/vehicles.js');
  const { createTrafficAudio } = await import('/src/audio/traffic.js');
  const sr = 48000, STEP = 1 / 60;
  const db = (v) => Math.round(20 * Math.log10(v + 1e-9) * 10) / 10;
  async function render(seconds, setup, frame) {
    const octx = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
    const env = createEngine(octx);
    env.volume.gain.value = 1;
    const l = octx.listener;
    l.positionX.value = 0; l.positionY.value = 1.3; l.positionZ.value = 0;
    l.forwardX.value = 0; l.forwardY.value = 0; l.forwardZ.value = -1;
    const ctxObj = setup(env);
    for (let t = STEP; t < seconds - STEP; t += STEP) {
      octx.suspend(Math.round(t * sr / 128) * 128 / sr).then(() => { frame(ctxObj, octx.currentTime, env); octx.resume(); }).catch(() => {});
    }
    frame(ctxObj, 0, env);
    const buf = await octx.startRendering();
    const seg = (a, b) => {
      let peak = 0, sum = 0, n = 0;
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = Math.floor(a * sr); i < Math.min(d.length, Math.floor(b * sr)); i++) { const x = Math.abs(d[i]); if (x > peak) peak = x; sum += d[i] * d[i]; n++; }
      }
      return { rms: db(Math.sqrt(sum / Math.max(1, n))), peak: db(peak) };
    };
    // loudest sample-to-sample step in 5 ms windows vs that window's RMS: a click detector
    const clicks = (a, b) => {
      const d = buf.getChannelData(0); let worst = 0, at = 0;
      const W = Math.floor(sr * 0.005);
      for (let i0 = Math.floor(a * sr); i0 + W < Math.min(d.length, b * sr); i0 += W) {
        let s = 0, mx = 0;
        for (let i = i0 + 1; i < i0 + W; i++) { s += d[i] * d[i]; mx = Math.max(mx, Math.abs(d[i] - d[i - 1])); }
        const r = Math.sqrt(s / W);
        if (r > 1e-4 && mx / r > worst) { worst = mx / r; at = i0 / sr; }
      }
      return { ratio: +worst.toFixed(1), at: +at.toFixed(2) };
    };
    let overallPeak = 0;
    for (let c = 0; c < 2; c++) for (const x of buf.getChannelData(c)) overallPeak = Math.max(overallPeak, Math.abs(x));
    return { seg, clicks, peak: db(overallPeak), clipped: overallPeak >= 0.999 };
  }

  // --- the convertible: 0-1.0 crank, catch, idle, 3.0-7.5 full throttle through 3 gears,
  // 7.5-10 braking to a stop, 10.5 exit (run-down), silent by 12
  const carState = (t) => {
    const s = { kind: 'car', lon: 0, throttle: 0, rpm: 620, load: 0, gear: 1, engineOn: t > 1.0, turn: 0, braking: 0, handbrake: false, surface: 'pavement', bump: 0, land: 0 };
    if (t > 1.0 && t < 1.4) s.rpm = 620 + 900 * Math.sin(((t - 1.0) / 0.4) * Math.PI);   // catch flare
    if (t >= 3 && t < 7.5) {
      const u = t - 3; s.throttle = 1; s.load = 1;
      s.lon = Math.min(19, u * 4.2);
      s.gear = u < 1.6 ? 1 : u < 3.4 ? 2 : 3;
      const ratio = [0, 224, 135, 89][s.gear];
      s.rpm = Math.min(4000, Math.max(1100, s.lon * ratio));
    }
    if (t >= 7.5 && t < 10.5) { s.lon = Math.max(0, 19 - (t - 7.5) * 7.5); s.braking = 1; s.gear = s.lon > 10 ? 2 : 1; s.rpm = Math.max(620, s.lon * 135); }
    if (t >= 10.5) return { kind: null };
    return s;
  };
  const car = await render(12.5, (env) => createVehicleAudio(env), (va, t) => va.update(carState(t)));
  const carR = {
    crank: car.seg(0.2, 0.95), idle: car.seg(1.8, 2.9), pull1: car.seg(3.3, 4.5), pull3: car.seg(6.6, 7.4),
    brake: car.seg(8.5, 10.3), rundown: car.seg(10.6, 11.2), silent: car.seg(11.8, 12.4),
    peak: car.peak, clipped: car.clipped, clicks: car.clicks(0.2, 11.2),
  };

  // --- handover: bike 0-2.5 s at 5 m/s, then the car (starter), then back to walking
  const hand = await render(6.5, (env) => createVehicleAudio(env), (va, t) => {
    if (t < 2.5) va.update({ kind: 'bike', lon: 5, surface: 'pavement', coasting: t > 1.2, pedal: t < 1.2 ? 1 : 0, crank: t * 6, soft: 0, depth: 0, bump: 0, land: 0 });
    else if (t < 5) va.update(carState(t - 2.5 + 0.0));
    else va.update({ kind: null });
  });
  const handR = { bike: hand.seg(0.5, 2.4), overlap: hand.seg(2.5, 2.8), car: hand.seg(3.8, 4.9), after: hand.seg(6.0, 6.4), clicks: hand.clicks(2.3, 3.2), clipped: hand.clipped };

  // --- traffic: 4 cars on the drive (x = -19.75 / -16.25), the listener on the sidewalk at
  // x = -24; voices are handed between the nearest 3; one horn at 3 s
  const cars = [
    { id: 1, x: -19.75, z0: -60, dir: 1, v: 11, classic: true },
    { id: 2, x: -19.75, z0: -95, dir: 1, v: 11, classic: false },
    { id: 3, x: -16.25, z0: 70, dir: -1, v: 11, classic: false },
    { id: 4, x: -16.25, z0: 140, dir: -1, v: 11, classic: false },
  ];
  let maxVoices = 0;
  const traffic = await render(10, (env) => ({ ta: createTrafficAudio(env, { voices: 3 }), honked: false }), (o, t, env) => {
    const L = { x: -24, y: 1.7, z: 0 };
    const list = cars.map((c) => ({ id: c.id, x: c.x, z: c.z0 + c.dir * c.v * t, v: c.v, a: 0.3, dir: c.dir, classic: c.classic, braking: false }));
    o.ta.update(list, L);
    for (const s of env.spatials) s.update(L);
    if (t > 3 && !o.honked) { o.honked = true; o.ta.horn({ x: -19.75, z: -20, classic: true }); }
    maxVoices = Math.max(maxVoices, env.spatials.size);
  });
  const trafficR = { far: traffic.seg(0.2, 1.0), pass: traffic.seg(5.2, 5.8), horn: traffic.seg(3.05, 3.45), late: traffic.seg(9.0, 9.8), peak: traffic.peak, clipped: traffic.clipped, clicks: traffic.clicks(0.2, 9.8), maxSpatials: maxVoices };
  return { car: carR, hand: handR, traffic: trafficR };
});

const { car, hand, traffic } = res;
console.log('car      ', JSON.stringify(car));
console.log('handover ', JSON.stringify(hand));
console.log('traffic  ', JSON.stringify(traffic));
check(car.crank.rms > -40 && car.crank.rms < -14, 'starter cranking audible', car.crank);
check(car.idle.rms > -36 && car.idle.rms < -12, 'V8 idle level', car.idle);
check(car.pull1.rms > car.idle.rms + 3, 'full throttle louder than idle', { idle: car.idle.rms, pull: car.pull1.rms });
check(car.pull3.rms > car.idle.rms, 'third gear pull still above idle', car.pull3);
check(car.brake.rms < car.pull3.rms, 'braking quieter than the pull', car.brake);
check(car.rundown.rms < car.idle.rms, 'exit: the V8 runs down', car.rundown);
check(car.silent.rms < -60, 'silent after exit', car.silent);
check(!car.clipped && car.peak < -0.5, 'car: no clipping', { peak: car.peak });
check(hand.bike.rms > -50 && hand.car.rms > -40, 'bike, then car audible', { bike: hand.bike.rms, car: hand.car.rms });
check(hand.overlap.peak < Math.max(hand.bike.peak, hand.car.peak) + 3, 'handover: no burst at the switch', hand.overlap);
check(hand.after.rms < -60, 'handover: silent after getting off', hand.after);
check(traffic.maxSpatials <= 3 + 1, 'traffic: at most 3 voices (+1 horn)', { spatials: traffic.maxSpatials });
check(traffic.pass.rms > traffic.far.rms + 6, 'traffic: passing car louder than distant', { far: traffic.far.rms, pass: traffic.pass.rms });
check(traffic.horn.peak > traffic.far.peak + 6, 'horn audible over traffic', traffic.horn);
check(!traffic.clipped && traffic.peak < -0.5, 'traffic: no clipping', { peak: traffic.peak });

// live: start the app muted, ride the convertible past traffic, count voices in the running graph
await page.goto('http://localhost:5173/?autostart&dynres=0&quality=low');
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
await page.mouse.click(512, 300);
await page.waitForTimeout(800);
await page.evaluate(() => { const v = window.__vehicles.list.find((e) => e.kind === 'car').v; window.__walker.teleport(v.x - 2.4, v.z, 90, -5); });
await page.waitForTimeout(600);
await page.keyboard.press('KeyE');
await page.waitForTimeout(2200);
const live = await page.evaluate(() => {
  const A = window.__audio, v = window.__vehicles.list.find((e) => e.kind === 'car').v;
  return {
    state: A.stats().state, riding: window.__vehicles.riding, engineOn: v.engineOn, stats: A.stats(),
    trafficNear: window.__traffic.cars.filter((c) => Math.hypot(c.x - v.x, c.z - v.z) < 110).length,
  };
});
console.log('live     ', JSON.stringify(live));
check(live.state === 'running', 'live audio context running', live);
check(live.stats.spatials > 0 && live.stats.cars > 0, 'live: traffic cars fed to the audio graph', live.stats);
check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
