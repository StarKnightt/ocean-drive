// Ride sounds for the rider's own vehicle (not spatialised: the listener sits on it).
//   bike: freewheel hub ticking while coasting, a chain tick per pedal stroke, tyre hiss
//         and rolling rumble on pavement, crunch on sand, swish on grass, splash in water
//   ATV:  small 4-stroke single: a band-limited exhaust pulse train at the firing rate
//         (rpm / 120) through a soft clipper and an rpm / load dependent lowpass, a
//         half-order lope, firing-modulated intake noise, CVT whine; starter on mount,
//         idle burble when stopped, knobby-tyre crunch and hum, splash through the swash
//   car:  a parametric engine voice per profile (state.engine): exhaust pulse train at the
//         firing rate (rpm / 60 * cylinders / 2) through a soft clipper and lowpass, a
//         half-order partial, exhaust rumble (noise gated at the firing rate, lowpassed),
//         intake roar on throttle, a dip at each gear change. 'v8classic' is the hero 1950s
//         V8 with its slow irregular lope at idle and a long starter crank; 'i4' (buzzy,
//         light exhaust), 'v6' (smooth mid growl) and 'v8mod' (deep even rumble) get a short
//         electric starter whirr. A stall sputters out in a few coughs; run-down on exit.
//         Chassis: tyre roll / roar / scrub, paver rumble, grass swish and clump ticks, sand
//         hiss and crunch, wet-sand slap, water slosh and bow wave, tyre squeal (or churn
//         off-road) on skids, a faint drum-brake squeal, a sustained metal scrape, impacts
//         (thud; clank on cars; hollow ring on posts), curb thumps, a two-tone horn, and
//         door / seat one-shots
//   all:  wind rush with speed, a thump + rattle on bumps, landings and collisions
import { bq, chain, loopSrc, rr, clamp } from './dsp.js';

function clickBuffer(ctx, f, ms = 5) {
  const sr = ctx.sampleRate, n = Math.floor((sr * ms) / 1000);
  const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const env = Math.exp(-i / (sr * 0.0011));
    d[i] = ((Math.random() * 2 - 1) * 0.5 + Math.sin((2 * Math.PI * f * i) / sr) * 0.8) * env;
  }
  return buf;
}

// exhaust pulse: strong low harmonics, a formant hump, falling off above
function exhaustWave(ctx) {
  const N = 90, re = new Float32Array(N), im = new Float32Array(N);
  for (let k = 1; k < N; k++) im[k] = (1 / Math.pow(k, 0.62)) * (1 + 0.8 * Math.exp(-(((k - 7) / 3) ** 2))) * (k % 2 ? 1 : 0.75);
  return ctx.createPeriodicWave(re, im);
}

const tanhCurve = (drive, n = 1024) => {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive); }
  return c;
};

// Engine profiles. lp: lowpass = lp0 + lpR * rpmNorm + lpL * load; sub: half-order partial
// (sub - subR * rpmNorm); rum/gate: exhaust rumble level and its firing-rate gating; fl: slow
// random detune (cents) and pulse unevenness; st*: starter whirr, compression beats, crank noise.
const PROFILES = {
  v8classic: {
    cyl: 8, idle: 620, red: 4020, drive: 1.8, lp0: 260, lpR: 900, lpL: 700, peakF: 95, peakG: 6,
    sub: 0.34, subR: 0.18, lope: 0.2, flD: 40, flA: 0.12, buzz: 0,
    rumLp: 260, rumPk: 70, rum: 0.12, rumL: 0.28, rumR: 0.1, gate: 0.1, gateL: 0.2, intakeF: 1050, intake: 0.05,
    level: 1, catchT: 0.06, stF: 150, stJ: 40, stBp: 420, strokeF: 8.5, strokeD: 0.35, stG: 0.2, crankN: 0.6, classic: true,
  },
  i4: {
    cyl: 4, idle: 800, red: 6500, drive: 2.4, lp0: 480, lpR: 1700, lpL: 900, peakF: 190, peakG: 4,
    sub: 0.06, subR: 0.03, lope: 0, flD: 10, flA: 0.03, buzz: 0.05,
    rumLp: 420, rumPk: 140, rum: 0.03, rumL: 0.08, rumR: 0.04, gate: 0.05, gateL: 0.1, intakeF: 1700, intake: 0.06,
    level: 0.72, catchT: 0.04, stF: 270, stJ: 30, stBp: 950, strokeF: 4.5, strokeD: 0.2, stG: 0.14, crankN: 0.3, classic: false,
  },
  v6: {
    cyl: 6, idle: 700, red: 6200, drive: 2.0, lp0: 360, lpR: 1300, lpL: 800, peakF: 140, peakG: 5,
    sub: 0.12, subR: 0.06, lope: 0, flD: 14, flA: 0.04, buzz: 0.015,
    rumLp: 320, rumPk: 110, rum: 0.07, rumL: 0.16, rumR: 0.06, gate: 0.07, gateL: 0.14, intakeF: 1350, intake: 0.05,
    level: 0.85, catchT: 0.04, stF: 250, stJ: 30, stBp: 900, strokeF: 4.5, strokeD: 0.2, stG: 0.14, crankN: 0.35, classic: false,
  },
  v8mod: {
    cyl: 8, idle: 650, red: 5800, drive: 1.7, lp0: 280, lpR: 1000, lpL: 700, peakF: 85, peakG: 6,
    sub: 0.2, subR: 0.1, lope: 0, flD: 12, flA: 0.04, buzz: 0,
    rumLp: 220, rumPk: 65, rum: 0.12, rumL: 0.24, rumR: 0.08, gate: 0.08, gateL: 0.18, intakeF: 950, intake: 0.05,
    level: 0.95, catchT: 0.04, stF: 240, stJ: 30, stBp: 850, strokeF: 4.5, strokeD: 0.2, stG: 0.15, crankN: 0.4, classic: false,
  },
};
const HARD = new Set(['road', 'sidewalk', 'ramp', 'promenade']);
const MAX_SHOTS = 10;

export function createVehicleAudio(env) {
  const { ctx, B } = env;
  const out = new GainNode(ctx, { gain: 1 });
  out.connect(env.dry);
  out.connect(new GainNode(ctx, { gain: 0.06 })).connect(env.reverb);
  const G = (v = 0) => new GainNode(ctx, { gain: v });
  const set = (p, v, tc = 0.06) => p.setTargetAtTime(v, ctx.currentTime, tc);
  const hold = (p, t) => {
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
    else { const v = p.value; p.cancelScheduledValues(t); p.setValueAtTime(v, t); }
  };
  const noise = (buf, filters, dest, rate = 1) => { const s = loopSrc(ctx, buf, { rate }); const g = G(); chain(s, ...filters, g, dest); return { s, g }; };
  let bike = null, atv = null, car = null, common = null, kind = null, wave = null, live = 0;

  function makeCommon() {
    const wind = noise(B.pink, [bq(ctx, 'lowpass', 520, 0.6)], out);
    const thumpBus = G(1);
    thumpBus.connect(out);
    return { wind, thumpBus };
  }
  function thump(strength, rattle) {
    const t = ctx.currentTime + 0.005, v = clamp(strength, 0, 1.4);
    const s = new AudioBufferSourceNode(ctx, { buffer: B.brown }), g = G();
    chain(s, bq(ctx, 'lowpass', 220, 0.8), g, common.thumpBus);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9 * v, t + 0.006); g.gain.setTargetAtTime(0, t + 0.006, 0.05);
    s.start(t, Math.random() * 5); s.stop(t + 0.4);
    if (rattle) {
      const r = new AudioBufferSourceNode(ctx, { buffer: B.crackleDense, playbackRate: rr(0.9, 1.2) }), rg = G();
      chain(r, bq(ctx, 'bandpass', rattle, 1.4), rg, common.thumpBus);
      rg.gain.setValueAtTime(0, t); rg.gain.linearRampToValueAtTime(0.5 * v, t + 0.01); rg.gain.setTargetAtTime(0, t + 0.02, 0.07);
      r.start(t, Math.random() * 3); r.stop(t + 0.5);
    }
  }
  // short noise one-shot (capped): attack a, then exponential decay tc, cut at dur
  function burst(buf, filters, peak, a, tc, dur, { rate = 1, at = 0 } = {}) {
    if (live >= MAX_SHOTS) return;
    live++;
    const t = ctx.currentTime + 0.005 + at;
    const s = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: rate }), g = G();
    chain(s, ...filters, g, common.thumpBus);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(0, t + a, tc);
    s.start(t, Math.max(0, Math.random() * (buf.duration - dur * rate))); s.stop(t + dur);
    s.onended = () => { live--; g.disconnect(); };
  }
  // struck metal: a few inharmonic partials under one decaying envelope (capped)
  function partials(freqs, amps, peak, tc) {
    if (live >= MAX_SHOTS) return;
    live++;
    const t = ctx.currentTime + 0.005, g = G();
    g.connect(common.thumpBus);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.003); g.gain.setTargetAtTime(0, t + 0.003, tc);
    const oscs = freqs.map((f, i) => {
      const o = new OscillatorNode(ctx, { type: 'sine', frequency: f * rr(0.96, 1.04) });
      o.connect(G(amps[i])).connect(g);
      o.start(t); o.stop(t + tc * 7);
      return o;
    });
    oscs[0].onended = () => { live--; g.disconnect(); };
  }

  function makeBike() {
    const g = G(0);
    g.connect(out);
    const hiss = noise(B.white, [bq(ctx, 'bandpass', 3400, 0.6)], g);
    const rumble = noise(B.brown, [bq(ctx, 'lowpass', 150, 0.7)], g);
    const crunch = noise(B.crackleDense, [bq(ctx, 'bandpass', 1500, 0.9)], g);
    const crunchLow = noise(B.brown, [bq(ctx, 'lowpass', 320, 0.7)], g);
    const swish = noise(B.pink, [bq(ctx, 'bandpass', 2600, 0.6)], g);
    const water = noise(B.pink, [bq(ctx, 'bandpass', 700, 1)], g);
    const spray = noise(B.white, [bq(ctx, 'bandpass', 2300, 0.8)], g);
    const chainN = noise(B.crackle, [bq(ctx, 'bandpass', 4300, 2.5)], g);
    const clickG = G(0.5);
    clickG.connect(g);
    const clicks = [clickBuffer(ctx, 4200), clickBuffer(ctx, 3900), clickBuffer(ctx, 4500)];
    const tick = clickBuffer(ctx, 1900, 9);
    return { g, hiss, rumble, crunch, crunchLow, swish, water, spray, chainN, clickG, clicks, tick, next: 0, half: 0 };
  }

  function makeAtv() {
    const g = G(0);
    g.connect(out);
    const eng = G(0);
    eng.connect(g);
    const osc = new OscillatorNode(ctx, { frequency: 12 });
    osc.setPeriodicWave(exhaustWave(ctx));
    const shaper = new WaveShaperNode(ctx, { curve: (() => { const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; c[i] = Math.tanh(x * 2.2); } return c; })() });
    const lp = bq(ctx, 'lowpass', 700, 0.9), peak = bq(ctx, 'peaking', 170, 1.2, 5);
    const pulseG = G(0.55);
    chain(osc, shaper, lp, peak, pulseG, eng);
    const sub = new OscillatorNode(ctx, { type: 'sine', frequency: 6 });
    chain(sub, G(0.3), eng);
    // intake / mechanical: noise gated at the firing rate
    const put = G(0.08);
    const am = new OscillatorNode(ctx, { type: 'square', frequency: 12 });
    chain(am, G(0.07), put.gain);
    const putN = loopSrc(ctx, B.pink);
    chain(putN, bq(ctx, 'bandpass', 1300, 1.1), put, eng);
    const valve = noise(B.white, [bq(ctx, 'highpass', 5200, 0.7)], eng);
    // unsteady idle: slow random detune on the firing oscillators
    const flutter = new AudioBufferSourceNode(ctx, { buffer: B.flutter, loop: true, playbackRate: 0.6 });
    const flG = G(55);
    flutter.connect(flG);
    for (const o of [osc, sub, am]) flG.connect(o.detune);
    const whine = new OscillatorNode(ctx, { type: 'triangle', frequency: 200 });
    const whineG = G(0);
    chain(whine, bq(ctx, 'bandpass', 900, 3), whineG, g);
    const starter = G(0);
    const st = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 38 });
    chain(st, bq(ctx, 'bandpass', 320, 1.5), starter, g);
    const crunch = noise(B.crackleDense, [bq(ctx, 'bandpass', 950, 0.8)], g);
    const rumble = noise(B.brown, [bq(ctx, 'lowpass', 130, 0.7)], g);
    const hum = new OscillatorNode(ctx, { type: 'triangle', frequency: 60 });
    const humG = G(0);
    chain(hum, bq(ctx, 'lowpass', 400, 0.8), humG, g);
    const water = noise(B.pink, [bq(ctx, 'bandpass', 620, 0.9)], g);
    const spray = noise(B.white, [bq(ctx, 'bandpass', 2100, 0.7)], g);
    for (const o of [osc, sub, am, whine, st, hum]) o.start();
    flutter.start();
    return { g, eng, osc, sub, am, lp, pulseG, put, valve, whine, whineG, starter, st, crunch, rumble, hum, humG, water, spray, on: false };
  }

  // The car body: tyres, surfaces, contacts. Noise is tapped from a few shared looping
  // sources; layers whose grain rate follows speed get their own source.
  function makeCar() {
    const g = G(0);
    g.connect(out);
    const W = loopSrc(ctx, B.white), P = loopSrc(ctx, B.pink), Br = loopSrc(ctx, B.brown), CD = loopSrc(ctx, B.crackleDense);
    const ctl = loopSrc(ctx, B.flutter, { rate: 1.3 });
    const tap = (src, filters, dest = g) => { const t = G(); chain(src, ...filters, t, dest); return t; };
    const own = (buf, filters) => { const s = loopSrc(ctx, buf); return { s, g: tap(s, filters) }; };
    // tyres: rolling rumble, roar with speed, scrub when cornering hard or on the handbrake
    const roll = tap(Br, [bq(ctx, 'lowpass', 160, 0.7)]);
    const roar = tap(P, [bq(ctx, 'bandpass', 650, 0.6)]);
    const scrub = tap(W, [bq(ctx, 'bandpass', 1700, 1.2)]);
    // surfaces
    const paver = own(B.crackleDense, [bq(ctx, 'lowpass', 380, 0.8)]);
    const swish = tap(W, [bq(ctx, 'bandpass', 3000, 0.8)]);
    const clumps = own(B.crackle, [bq(ctx, 'bandpass', 700, 1)]);
    const sandHiss = tap(Br, [bq(ctx, 'lowpass', 450, 0.7)]);
    const crunch = own(B.crackleDense, [bq(ctx, 'bandpass', 1200, 0.9)]);
    const slap = own(B.crackle, [bq(ctx, 'lowpass', 650, 1)]);
    const wetHiss = tap(W, [bq(ctx, 'bandpass', 3800, 0.9)]);
    const slosh = tap(P, [bq(ctx, 'bandpass', 480, 0.9)]);
    const sloshAm = G(0);
    ctl.connect(sloshAm).connect(slosh.gain);
    const bow = tap(P, [bq(ctx, 'bandpass', 1100, 0.5)]);
    const spray = tap(W, [bq(ctx, 'bandpass', 2600, 0.8)]);
    // skids: a narrow-band screech on hard ground, churn and roost off-road
    const skidG = G(0);
    skidG.connect(g);
    const skBp = [bq(ctx, 'bandpass', 1100, 10), bq(ctx, 'bandpass', 2200, 8)];
    for (const f of skBp) chain(W, f, skidG);
    const skTone = new OscillatorNode(ctx, { type: 'sine', frequency: 1150 });
    const skToneG = G(0);
    chain(skTone, skToneG, g);
    const wob = G(90);
    ctl.connect(wob);
    for (const p of [skTone.detune, ...skBp.map((f) => f.detune)]) wob.connect(p);
    const churn = tap(Br, [bq(ctx, 'lowpass', 500, 0.8)]);
    const roost = tap(CD, [bq(ctx, 'bandpass', 800, 0.9)]);
    // metal scrape: resonant bands with a wandering centre and gritty amplitude
    const scrapeG = G(0);
    scrapeG.connect(g);
    const scBp = [bq(ctx, 'bandpass', 1800, 6), bq(ctx, 'bandpass', 2900, 5), bq(ctx, 'bandpass', 4000, 7)];
    for (const f of scBp) chain(W, f, scrapeG);
    const scWander = G(300);
    ctl.connect(scWander);
    for (const f of scBp) scWander.connect(f.detune);
    const grit = G(0);
    const gritN = loopSrc(ctx, B.crackleDense, { rate: 0.8 });
    chain(gritN, grit, scrapeG.gain);
    // drum brakes: a faint squeal just before stopping
    const squeal = new OscillatorNode(ctx, { type: 'sine', frequency: 2350 });
    const vib = new OscillatorNode(ctx, { type: 'sine', frequency: 5.5 });
    chain(vib, G(35), squeal.detune);
    const squealG = G(0);
    chain(squeal, squealG, g);
    for (const o of [skTone, squeal, vib]) o.start();
    const latch = clickBuffer(ctx, 2600, 6);
    return {
      g, P, Br, roll, roar, scrub, paver, swish, clumps, sandHiss, crunch, slap, wetHiss, slosh, sloshAm, bow, spray,
      skidG, skBp, skToneG, churn, roost, scrapeG, grit, squealG, latch, voice: null, horn: null, lastHit: -1,
    };
  }

  // One engine voice (see PROFILES); the car keeps at most one live voice plus any still
  // running down, which are stopped and disconnected shortly after.
  function makeEngine(name) {
    const P = PROFILES[name], c = car, srcs = [], taps = [];
    const eng = G(0);
    eng.connect(c.g);
    const osc = new OscillatorNode(ctx, { frequency: 40 });
    osc.setPeriodicWave((wave ??= exhaustWave(ctx)));
    const shaper = new WaveShaperNode(ctx, { curve: tanhCurve(P.drive) });
    const lp = bq(ctx, 'lowpass', P.lp0, 0.8), peak = bq(ctx, 'peaking', P.peakF, 1.1, P.peakG);
    const pulseG = G(0.5);
    chain(osc, shaper, lp, peak, pulseG, eng);
    // the half-order partial (the V8's cross-plane burble), and on the classic a slow uneven lope
    const sub = new OscillatorNode(ctx, { type: 'sine', frequency: 20 });
    const subG = G(P.sub);
    chain(sub, subG, eng);
    srcs.push(osc, sub);
    let lopeG = null;
    if (P.lope) {
      const lope = new OscillatorNode(ctx, { type: 'sine', frequency: 1.6 });
      lopeG = G(0.16);
      chain(lope, lopeG, pulseG.gain);
      srcs.push(lope);
    }
    const flutter = new AudioBufferSourceNode(ctx, { buffer: B.flutter, loop: true, playbackRate: 0.35 });
    const flG = G(P.flD), flA = G(P.flA);
    flutter.connect(flG); flutter.connect(flA);
    for (const o of [osc, sub]) flG.connect(o.detune);
    flA.connect(pulseG.gain);
    // four-cylinder buzz: a bright partial at the firing rate
    let buzz = null, buzzBp = null, buzzG = null;
    if (P.buzz) {
      buzz = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 40 });
      buzzBp = bq(ctx, 'bandpass', 900, 1.5);
      buzzG = G(0);
      chain(buzz, buzzBp, buzzG, eng);
      flG.connect(buzz.detune);
      srcs.push(buzz);
    }
    // exhaust rumble: brown noise gated at the firing rate, lowpassed
    const rumbleG = G(0);
    const gate = new OscillatorNode(ctx, { type: 'square', frequency: 40 });
    const gateG = G(0);
    chain(gate, gateG, rumbleG.gain);
    const rlp = bq(ctx, 'lowpass', P.rumLp, 0.7);
    chain(c.Br, rlp, bq(ctx, 'peaking', P.rumPk, 1, 5), rumbleG, eng);
    // intake roar under throttle
    const ibp = bq(ctx, 'bandpass', P.intakeF, 0.8), intake = G(0);
    chain(c.P, ibp, intake, eng);
    // starter: geared whirr with the compression strokes in it
    const starter = G(0);
    starter.connect(c.g);
    const st = new OscillatorNode(ctx, { type: 'sawtooth', frequency: P.stF + 20 });
    const stroke = new OscillatorNode(ctx, { type: 'square', frequency: P.strokeF + 0.5 });
    const strokeG = G(0);
    chain(stroke, G(P.strokeD), strokeG.gain);
    chain(st, bq(ctx, 'bandpass', P.stBp, 1.4), strokeG, starter);
    const clp = bq(ctx, 'lowpass', 180, 0.8);
    chain(c.Br, clp, G(P.crankN), starter);
    taps.push([c.Br, rlp], [c.P, ibp], [c.Br, clp]);
    srcs.push(gate, st, stroke);
    for (const o of srcs) o.start();
    flutter.start();
    srcs.push(flutter);
    return {
      name, P, srcs, taps, eng, osc, sub, subG, lp, pulseG, lopeG, buzz, buzzBp, buzzG, gate, gateG, rumbleG, intake,
      starter, st, stroke, strokeG, on: false, stalled: false, gear: 1, dip: 0, fire: 20,
    };
  }

  function runDown(e) {
    // the engine runs down: revs sag with a last shudder, then silence
    const now = ctx.currentTime;
    hold(e.eng.gain, now);
    e.eng.gain.setTargetAtTime(0, now + 0.05, 0.22);
    for (const o of [e.osc, e.buzz]) if (o) o.frequency.setTargetAtTime(14, now, 0.35);
    e.sub.frequency.setTargetAtTime(7, now, 0.35);
    e.starter.gain.setTargetAtTime(0, now, 0.03);
    e.on = false;
  }
  function retire(e, delay) {
    const t = ctx.currentTime + delay;
    for (const s of e.srcs) s.stop(t);
    e.srcs[0].onended = () => {
      e.eng.disconnect(); e.starter.disconnect();
      for (const [src, n] of e.taps) src.disconnect(n);
    };
  }
  // drowned: the revs sag through two or three irregular coughs, then silence
  function sputter(e) {
    const t = ctx.currentTime, p = e.eng.gain, L = e.P.level;
    e.on = false;
    hold(p, t);
    let tt = t + 0.08, amp = 0.4 * L;
    p.linearRampToValueAtTime(0.05 * L, tt);
    for (let i = 0, n = Math.random() < 0.5 ? 2 : 3; i < n; i++) {
      tt += rr(0.1, 0.26);
      p.linearRampToValueAtTime(0.03 * L, tt);
      p.linearRampToValueAtTime(amp, tt + 0.025);
      tt += rr(0.09, 0.16);
      p.linearRampToValueAtTime(0.04 * L, tt);
      amp *= rr(0.5, 0.75);
    }
    p.linearRampToValueAtTime(0, tt + 0.12);
    for (const [q, k] of [[e.osc.frequency, 0.3], [e.gate.frequency, 0.3], [e.sub.frequency, 0.15], [e.buzz?.frequency, 0.3]]) {
      if (!q) continue;
      hold(q, t);
      q.setTargetAtTime(Math.max(4, e.fire * k), t, 0.3);
    }
    e.starter.gain.setTargetAtTime(0, t, 0.03);
  }

  function hornOn(classic) {
    const t = ctx.currentTime + 0.005, g = G(0);
    const shaper = new WaveShaperNode(ctx, { curve: tanhCurve(3, 512) });
    chain(shaper, bq(ctx, 'bandpass', classic ? 700 : 950, 1.3), g, car.g);
    const [lo, hi] = classic ? [310, 390] : [420, 520];
    const oscs = [lo, lo * 1.005, hi, hi * 0.996].map((f) => {
      const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: f });
      o.connect(G(0.25)).connect(shaper);
      o.start(t);
      return o;
    });
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.025);
    car.horn = { g, oscs };
  }
  function hornOff() {
    const h = car?.horn;
    if (!h) return;
    const t = ctx.currentTime;
    hold(h.g.gain, t);
    h.g.gain.setTargetAtTime(0, t, 0.025);
    for (const o of h.oscs) o.stop(t + 0.2);
    h.oscs[0].onended = () => h.g.disconnect();
    car.horn = null;
  }

  function switchTo(k) {
    const now = ctx.currentTime;
    if (kind === 'atv' && atv) {
      // engine off: revs sag, then silence
      atv.eng.gain.setTargetAtTime(0, now, 0.18);
      atv.osc.frequency.setTargetAtTime(6, now, 0.3);
      atv.on = false;
    }
    if (kind === 'car' && car) {
      if (car.voice) { runDown(car.voice); retire(car.voice, 2); car.voice = null; }
      hornOff();
      for (const p of [car.skidG.gain, car.skToneG.gain, car.scrapeG.gain, car.grit.gain, car.churn.gain, car.roost.gain]) set(p, 0, 0.04);
    }
    const mine = { bike, atv, car }[k];
    for (const p of [bike, atv, car]) if (p) p.g.gain.setTargetAtTime(k && p === mine ? 1 : 0, now + (kind === 'atv' || kind === 'car' ? 0.9 : 0), 0.15);
    if (k === 'car') { car.g.gain.cancelScheduledValues(now); car.g.gain.setTargetAtTime(1, now, 0.03); }
    if (k === 'atv') {
      atv.g.gain.cancelScheduledValues(now);
      atv.g.gain.setTargetAtTime(1, now, 0.03);
      atv.starter.gain.cancelScheduledValues(now);
      atv.starter.gain.setValueAtTime(0, now);
      atv.starter.gain.linearRampToValueAtTime(0.22, now + 0.05);
      atv.starter.gain.setValueAtTime(0.22, now + 0.5);
      atv.starter.gain.linearRampToValueAtTime(0, now + 0.62);
      atv.st.frequency.setValueAtTime(30, now);
      atv.st.frequency.linearRampToValueAtTime(52, now + 0.55);
      atv.startAt = now + 0.55;
    }
    kind = k;
  }

  function updateBike(s) {
    const b = bike, now = ctx.currentTime, v = Math.abs(s.lon);
    const sv = Math.min(1, v / 6);
    const onSand = s.surface === 'sand' || s.surface === 'wetsand';
    const pave = s.surface === 'pavement' ? 1 : 0, grass = s.surface === 'grass' ? 1 : 0, water = s.surface === 'water' ? 1 : 0;
    set(b.hiss.g.gain, pave * 0.05 * sv * sv);
    set(b.rumble.g.gain, (pave * 0.25 + grass * 0.15) * sv);
    set(b.crunch.g.gain, onSand ? (0.12 + 0.18 * s.soft) * Math.min(1, v / 3) : 0);
    b.crunch.s.playbackRate.setTargetAtTime(0.7 + 0.2 * Math.min(1, v / 4), now, 0.1);
    set(b.crunchLow.g.gain, onSand ? 0.25 * s.soft * Math.min(1, v / 3) : 0);
    set(b.swish.g.gain, grass * 0.04 * sv);
    const wd = Math.min(1, s.depth / 0.12);
    set(b.water.g.gain, (water || s.depth > 0.01 ? 1 : 0) * 0.35 * wd * Math.min(1, v / 2.5));
    set(b.spray.g.gain, (water ? 1 : 0) * 0.08 * wd * Math.min(1, v / 3));
    set(b.chainN.g.gain, s.pedal * 0.35 * Math.min(1, v / 2));
    // freewheel pawls: 18 clicks per wheel turn, only while coasting
    const rate = s.coasting ? (v / (2 * Math.PI * 0.335)) * 18 : 0;
    if (rate > 1.5) {
      if (b.next < now) b.next = now + 0.01;
      while (b.next < now + 0.08) {
        const src = new AudioBufferSourceNode(ctx, { buffer: b.clicks[(Math.random() * 3) | 0], playbackRate: rr(0.94, 1.06) });
        const cg = G(0.16 + 0.06 * Math.random());
        chain(src, cg, b.clickG);
        src.start(b.next);
        b.next += (1 / rate) * rr(0.9, 1.1);
      }
    } else b.next = 0;
    // a light chain tick on each pedal stroke
    const half = Math.floor(s.crank / Math.PI);
    if (half !== b.half && s.pedal > 0.5) {
      const src = new AudioBufferSourceNode(ctx, { buffer: b.tick, playbackRate: rr(0.9, 1.1) });
      chain(src, G(0.12), b.g);
      src.start(now + 0.005);
    }
    b.half = half;
  }

  function updateEngine(e, s) {
    const P = e.P, now = ctx.currentTime;
    if (s.stalled) {
      if (!e.stalled) { e.stalled = true; if (e.on) sputter(e); else set(e.eng.gain, 0, 0.05); }
      set(e.starter.gain, 0, 0.03);
      return;
    }
    if (e.stalled) {
      e.stalled = false;
      for (const q of [e.eng.gain, e.osc.frequency, e.sub.frequency, e.gate.frequency, e.buzz?.frequency]) if (q) hold(q, now);
    }
    // cranking until the sim says the engine has caught
    if (!s.engineOn) {
      set(e.starter.gain, P.stG, 0.02);
      e.st.frequency.setTargetAtTime(P.stF + P.stJ * Math.random(), now, 0.1);
      e.stroke.frequency.setTargetAtTime(P.strokeF + Math.random(), now, 0.1);
      set(e.strokeG.gain, 0.5, 0.02);
      set(e.eng.gain, 0, 0.05);
      return;
    }
    if (!e.on) {
      // catch: a cough, then the revs flare and settle (the sim's rpm)
      e.on = true;
      e.starter.gain.setTargetAtTime(0, now, 0.03);
      e.eng.gain.cancelScheduledValues(now);
      e.eng.gain.setValueAtTime(0, now);
      e.eng.gain.linearRampToValueAtTime(0.5 * P.level, now + P.catchT);
    }
    const idle = s.idle ?? P.idle, red = s.redline ?? P.red;
    const rpm = s.rpm ?? idle, load = s.load ?? 0;
    const fire = Math.max(8, (rpm / 60) * (P.cyl / 2)), rn = clamp((rpm - idle) / Math.max(400, red - idle), 0, 1);
    e.fire = fire;
    e.osc.frequency.setTargetAtTime(fire, now, 0.03);
    e.sub.frequency.setTargetAtTime(fire / 2, now, 0.03);
    e.gate.frequency.setTargetAtTime(fire, now, 0.03);
    e.lp.frequency.setTargetAtTime(P.lp0 + rn * P.lpR + load * P.lpL, now, 0.06);
    if (e.buzz) {
      e.buzz.frequency.setTargetAtTime(fire, now, 0.03);
      e.buzzBp.frequency.setTargetAtTime(900 + 1500 * rn, now, 0.06);
      set(e.buzzG.gain, P.buzz * (0.4 + 0.6 * rn + 0.4 * load), 0.08);
    }
    // the lope fades out as the revs rise
    if (e.lopeG) set(e.lopeG.gain, P.lope * (1 - rn) ** 2, 0.1);
    set(e.subG.gain, P.sub - P.subR * rn, 0.1);
    set(e.rumbleG.gain, P.rum + P.rumL * load + P.rumR * rn, 0.06);
    set(e.gateG.gain, P.gate + P.gateL * load, 0.06);
    set(e.intake.gain, P.intake * Math.max(0, s.throttle ?? 0) * (0.3 + rn), 0.08);
    // gear change: the revs drop (sim) and the pull eases for a moment
    if (s.gear !== undefined && s.gear !== e.gear) {
      e.dip = now;
      e.gear = s.gear;
      e.pulseG.gain.cancelScheduledValues(now);
      e.pulseG.gain.setValueAtTime(0.5, now);
      e.pulseG.gain.linearRampToValueAtTime(0.3, now + 0.07);
      e.pulseG.gain.linearRampToValueAtTime(0.5, now + 0.35);
    }
    if (now - e.dip > 0.4) set(e.eng.gain, 0.36 * P.level * (0.55 + 0.35 * load + 0.3 * rn), 0.05);
  }

  function updateCar(s) {
    const c = car, now = ctx.currentTime, v = Math.abs(s.lon ?? 0);
    const want = PROFILES[s.engine] ? s.engine : 'v8classic';
    if (c.voice && c.voice.name !== want) {
      runDown(c.voice); retire(c.voice, 2); c.voice = null;
      hornOff();
    }
    if (!c.voice) c.voice = makeEngine(want);
    updateEngine(c.voice, s);

    // surfaces
    const d = s.detail ?? (s.surface === 'pavement' || !s.surface ? 'road' : s.surface);
    const depth = s.depth ?? 0, soft = s.soft ?? 0, hard = HARD.has(d);
    const wet = d === 'water' || depth > 0.02;
    const m = (x) => Math.min(1, x), sv = m(v / 18);
    const rollK = hard ? 1 : d === 'grass' ? 0.6 : d === 'sand' ? 0.45 : d === 'wetsand' ? 0.5 : 0.25;
    set(c.roll.gain, 0.3 * rollK * m(v / 6));
    set(c.roar.gain, 0.09 * sv * sv * (hard ? (d === 'promenade' ? 0.7 : 1) : 0.25));
    const prom = d === 'promenade' ? 1 : 0;
    set(c.paver.g.gain, prom * 0.18 * m(v / 8));
    c.paver.s.playbackRate.setTargetAtTime(0.4 + 0.8 * m(v / 15), now, 0.1);
    const grass = d === 'grass' ? 1 : 0;
    set(c.swish.gain, grass * 0.05 * m(v / 8));
    set(c.clumps.g.gain, grass * 0.25 * m(v / 4));
    c.clumps.s.playbackRate.setTargetAtTime(0.15 + 0.3 * m(v / 10), now, 0.1);
    const sand = d === 'sand' ? 1 : 0;
    set(c.sandHiss.gain, sand * (0.15 + 0.2 * soft) * m(v / 5));
    set(c.crunch.g.gain, sand * (0.08 + 0.16 * soft) * m(v / 4));
    c.crunch.s.playbackRate.setTargetAtTime(0.6 + 0.4 * m(v / 8), now, 0.1);
    const ws = d === 'wetsand' ? 1 : 0;
    set(c.slap.g.gain, ws * 0.35 * m(v / 5));
    c.slap.s.playbackRate.setTargetAtTime(0.3 + 0.5 * m(v / 10), now, 0.1);
    set(c.wetHiss.gain, ws * 0.03 * m(v / 8));
    const wd = wet ? m(depth / 0.3) : 0;
    set(c.slosh.gain, 0.12 * wd * (0.3 + 0.7 * m(v / 3)));
    set(c.sloshAm.gain, 0.14 * wd * (0.3 + 0.7 * m(v / 3)));
    set(c.bow.gain, 0.16 * wd * m(v / 7) ** 2);
    set(c.spray.gain, 0.05 * wd * m(v / 8) ** 2);

    // tyres: skids dominate the scrub; screech on hard ground, churn off it
    const skid = clamp(s.skid ?? 0, 0, 1);
    const sq = hard ? skid * m(v / 2) : 0, ch = !hard && !wet ? skid * m(v / 2) : 0;
    set(c.skidG.gain, 0.5 * sq, 0.04);
    set(c.skToneG.gain, 0.015 * sq, 0.04);
    for (const [i, f] of c.skBp.entries()) f.frequency.setTargetAtTime((i ? 2000 : 950) + 400 * skid, now, 0.08);
    set(c.churn.gain, 0.25 * ch, 0.05);
    set(c.roost.gain, 0.2 * ch * (0.5 + soft), 0.05);
    const lat = Math.abs((s.turn ?? 0) * (s.lon ?? 0));
    const scrub = 0.05 * clamp((lat - 3.5) / 3, 0, 1) + (s.handbrake && v > 1 ? 0.06 * Math.min(1, v / 6) : 0);
    set(c.scrub.gain, scrub * (hard ? 1 : 0.4) * (1 - skid));
    const squeal = (s.braking ?? 0) > 0.3 && v > 0.6 && v < 5 ? 0.008 * (1 - v / 5) : 0;
    set(c.squealG.gain, squeal, 0.05);

    // contacts
    const sc = clamp(s.scrape ?? 0, 0, 1);
    set(c.scrapeG.gain, 0.35 * sc, 0.04);
    set(c.grit.gain, 0.45 * sc, 0.04);
    const h = s.hit;
    if (h && (h.speed ?? 0) > 2 && now - c.lastHit > 0.08) {
      c.lastHit = now;
      const st = clamp((h.speed - 2) / 12, 0, 1), k = 0.3 + 0.7 * st;
      thump(0.3 + 0.9 * st, 900);
      if (h.material === 'car') partials([420, 1130, 1790, 2710], [1, 0.6, 0.45, 0.3], 0.1 * k, 0.07);
      else if (h.material === 'post') {
        partials([235, 640, 1210], [1, 0.5, 0.3], 0.08 * k, 0.2);
        burst(B.pink, [bq(ctx, 'bandpass', 520, 3)], 0.12 * k, 0.004, 0.08, 0.5);
      } else burst(B.crackleDense, [bq(ctx, 'bandpass', 1400, 0.9)], 0.3 * k, 0.004, 0.05, 0.35);
      if ((h.tangent ?? 0) > 3) burst(B.white, [bq(ctx, 'bandpass', 2600, 3)], 0.05 * m(h.tangent / 10), 0.01, 0.08, 0.4);
    }
    if ((s.curb ?? 0) > 0) thump(clamp(s.curb / 0.15, 0.25, 1) * 0.6, 1100);

    // horn, held
    if (!!s.horn !== !!c.horn) { if (s.horn) hornOn(c.voice.P.classic); else hornOff(); }
  }

  function cabinEvent(ev) {
    if (ev === 'door') {
      // a door clunk: a low thud with some body, then the latch catching
      burst(B.brown, [bq(ctx, 'lowpass', 170, 0.9)], 0.4, 0.004, 0.06, 0.4);
      burst(B.brown, [bq(ctx, 'bandpass', 380, 2)], 0.12, 0.003, 0.03, 0.2);
      const latch = car?.latch ?? clickBuffer(ctx, 2600, 6);
      burst(latch, [bq(ctx, 'highpass', 900, 0.7)], 0.25, 0.001, 0.01, 0.05, { rate: rr(0.9, 1.1), at: 0.025 });
      burst(latch, [bq(ctx, 'highpass', 900, 0.7)], 0.12, 0.001, 0.01, 0.05, { rate: rr(0.8, 0.95), at: 0.06 });
    } else if (ev === 'seat') {
      // a soft creak of springs and leather as the driver settles
      burst(B.crackleDense, [bq(ctx, 'bandpass', 1000, 5)], 0.07, 0.08, 0.1, 0.5, { rate: 0.35 });
      burst(B.brown, [bq(ctx, 'lowpass', 250, 0.8)], 0.12, 0.02, 0.06, 0.3);
    }
  }

  function updateAtv(s) {
    const a = atv, now = ctx.currentTime, v = Math.abs(s.lon);
    const running = now >= (a.startAt ?? 0);
    if (running && !a.on) { a.on = true; a.eng.gain.cancelScheduledValues(now); }
    const fire = s.rpm / 120, rn = clamp((s.rpm - 1400) / 6200, 0, 1);
    if (a.on) {
      a.osc.frequency.setTargetAtTime(fire, now, 0.03);
      a.sub.frequency.setTargetAtTime(fire / 2, now, 0.03);
      a.am.frequency.setTargetAtTime(fire, now, 0.03);
      a.lp.frequency.setTargetAtTime(420 + rn * 1500 + s.load * 900, now, 0.05);
      set(a.eng.gain, 0.34 * (0.5 + 0.35 * s.load + 0.35 * rn), 0.05);
      set(a.valve.g.gain, 0.012 + 0.02 * rn);
      a.whine.frequency.setTargetAtTime((s.rpm / 60) * 3.1, now, 0.05);
      set(a.whineG.gain, 0.02 * Math.min(1, v / 8));
    }
    const onSand = s.surface === 'sand' || s.surface === 'wetsand';
    set(a.crunch.g.gain, (onSand ? 0.14 + 0.16 * s.soft : 0.05) * Math.min(1, v / 5));
    set(a.rumble.g.gain, 0.3 * Math.min(1, v / 8));
    a.hum.frequency.setTargetAtTime(Math.max(20, (v / (2 * Math.PI * 0.31)) * 20), now, 0.05);
    set(a.humG.gain, (onSand ? 1 - 0.6 * s.soft : 0.6) * 0.05 * Math.min(1, v / 6));
    const wd = Math.min(1, s.depth / 0.15);
    set(a.water.g.gain, 0.45 * wd * Math.min(1, v / 3));
    set(a.spray.g.gain, 0.14 * wd * Math.min(1, v / 5));
  }

  return {
    // state: { kind: 'bike' | 'atv' | 'car' | null, lon, throttle, rpm, load, surface, soft, depth,
    //          coasting, pedal, crank, bump, land,
    //          car only: engine ('i4' | 'v6' | 'v8mod' | 'v8classic'), idle, redline, gear, braking,
    //          engineOn, stalled, turn, handbrake, detail, skid, scrape, curb, horn,
    //          hit: { speed, tangent, material: 'wall' | 'post' | 'car' } | null,
    //          event: 'door' | 'seat' (fired on whatever frame carries it, any kind) }
    update(s) {
      const k = s?.kind ?? null;
      if (k === 'bike' && !bike) bike = makeBike();
      if (k === 'atv' && !atv) atv = makeAtv();
      if (k === 'car' && !car) car = makeCar();
      if (!common && (k || s?.event)) common = makeCommon();
      if (k !== kind) switchTo(k);
      if (s?.event) cabinEvent(s.event);
      if (!k) { if (common) set(common.wind.g.gain, 0); return; }
      const v = Math.abs(s.lon);
      set(common.wind.g.gain, 0.12 * Math.min(1, (v / 12) ** 2));
      if (k === 'bike') updateBike(s); else if (k === 'car') updateCar(s); else updateAtv(s);
      const hit = Math.max(s.bump ?? 0, (s.land ?? 0) * 0.6);
      if (hit > 0.8) thump(hit / 5, k === 'bike' ? 3200 : k === 'car' ? 900 : 1800);
    },
  };
}
