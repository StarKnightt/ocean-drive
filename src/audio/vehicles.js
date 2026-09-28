// Ride sounds for the rider's own vehicle (not spatialised: the listener sits on it).
//   bike: freewheel hub ticking while coasting, a chain tick per pedal stroke, tyre hiss
//         and rolling rumble on pavement, crunch on sand, swish on grass, splash in water
//   ATV:  small 4-stroke single: a band-limited exhaust pulse train at the firing rate
//         (rpm / 120) through a soft clipper and an rpm / load dependent lowpass, a
//         half-order lope, firing-modulated intake noise, CVT whine; starter on mount,
//         idle burble when stopped, knobby-tyre crunch and hum, splash through the swash
//   car:  a 1950s V8: exhaust pulse train at the firing rate (rpm / 15) through a soft
//         clipper and lowpass, a half-order burble and a slow irregular lope at idle, the
//         exhaust rumble (noise gated at the firing rate, lowpassed), intake roar on throttle,
//         revs from a 3-speed automatic (a dip at each shift); starter crank until the
//         engine catches, run-down on exit; tyre roll and scrub, a faint brake squeal
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

export function createVehicleAudio(env) {
  const { ctx, B } = env;
  const out = new GainNode(ctx, { gain: 1 });
  out.connect(env.dry);
  out.connect(new GainNode(ctx, { gain: 0.06 })).connect(env.reverb);
  const G = (v = 0) => new GainNode(ctx, { gain: v });
  const set = (p, v, tc = 0.06) => p.setTargetAtTime(v, ctx.currentTime, tc);
  const noise = (buf, filters, dest, rate = 1) => { const s = loopSrc(ctx, buf, { rate }); const g = G(); chain(s, ...filters, g, dest); return { s, g }; };
  let bike = null, atv = null, car = null, common = null, kind = null;

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

  function makeCar() {
    const g = G(0);
    g.connect(out);
    const eng = G(0);
    eng.connect(g);
    const osc = new OscillatorNode(ctx, { frequency: 40 });
    osc.setPeriodicWave(exhaustWave(ctx));
    const shaper = new WaveShaperNode(ctx, { curve: (() => { const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; c[i] = Math.tanh(x * 1.8); } return c; })() });
    const lp = bq(ctx, 'lowpass', 320, 0.8), peak = bq(ctx, 'peaking', 95, 1.1, 6);
    const pulseG = G(0.5);
    chain(osc, shaper, lp, peak, pulseG, eng);
    // the cross-plane burble: a half-order partial, and a slow uneven lope on the pulses
    const sub = new OscillatorNode(ctx, { type: 'sine', frequency: 20 });
    const subG = G(0.34);
    chain(sub, subG, eng);
    const lope = new OscillatorNode(ctx, { type: 'sine', frequency: 1.6 });
    const lopeG = G(0.16);
    chain(lope, lopeG, pulseG.gain);
    const flutter = new AudioBufferSourceNode(ctx, { buffer: B.flutter, loop: true, playbackRate: 0.35 });
    const flG = G(40), flA = G(0.12);
    flutter.connect(flG); flutter.connect(flA);
    for (const o of [osc, sub]) flG.connect(o.detune);
    flA.connect(pulseG.gain);
    // exhaust rumble: brown noise gated at the firing rate, lowpassed
    const rumbleG = G(0.0);
    const gate = new OscillatorNode(ctx, { type: 'square', frequency: 40 });
    const gateG = G(0.0);
    chain(gate, gateG, rumbleG.gain);
    const rumbleN = loopSrc(ctx, B.brown);
    chain(rumbleN, bq(ctx, 'lowpass', 260, 0.7), bq(ctx, 'peaking', 70, 1, 5), rumbleG, eng);
    // intake roar under throttle
    const intake = noise(B.pink, [bq(ctx, 'bandpass', 1050, 0.8)], eng);
    // starter: geared cranking whirr with the compression strokes in it
    const starter = G(0);
    const st = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 170 });
    const stroke = new OscillatorNode(ctx, { type: 'square', frequency: 9 });
    const strokeG = G(0);
    chain(stroke, G(0.35), strokeG.gain);
    chain(st, bq(ctx, 'bandpass', 420, 1.4), strokeG, starter, g);
    const crankN = noise(B.brown, [bq(ctx, 'lowpass', 180, 0.8)], starter);
    crankN.g.gain.value = 0.6;
    // tyres: rolling rumble, roar with speed, scrub when cornering hard or on the handbrake
    const roll = noise(B.brown, [bq(ctx, 'lowpass', 160, 0.7)], g);
    const roar = noise(B.pink, [bq(ctx, 'bandpass', 650, 0.6)], g);
    const scrub = noise(B.white, [bq(ctx, 'bandpass', 1700, 1.2)], g);
    // drum brakes: a faint squeal just before stopping
    const squeal = new OscillatorNode(ctx, { type: 'sine', frequency: 2350 });
    const vib = new OscillatorNode(ctx, { type: 'sine', frequency: 5.5 });
    chain(vib, G(35), squeal.detune);
    const squealG = G(0);
    chain(squeal, squealG, g);
    for (const o of [osc, sub, lope, gate, st, stroke, squeal, vib]) o.start();
    flutter.start();
    return { g, eng, osc, sub, subG, lp, pulseG, lopeG, gate, gateG, rumbleG, intake, starter, st, stroke, strokeG, roll, roar, scrub, squeal, squealG, on: false, gear: 1, dip: 0 };
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
      // the V8 runs down: revs sag with a last shudder, then silence
      car.eng.gain.setTargetAtTime(0, now + 0.05, 0.22);
      car.osc.frequency.setTargetAtTime(14, now, 0.35);
      car.sub.frequency.setTargetAtTime(7, now, 0.35);
      car.starter.gain.setTargetAtTime(0, now, 0.03);
      car.on = false;
    }
    const mine = { bike, atv, car }[k];
    for (const p of [bike, atv, car]) if (p) p.g.gain.setTargetAtTime(k && p === mine ? 1 : 0, now + (kind === 'atv' || kind === 'car' ? 0.9 : 0), 0.15);
    if (k === 'car') { car.g.gain.cancelScheduledValues(now); car.g.gain.setTargetAtTime(1, now, 0.03); car.on = false; }
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

  function updateCar(s) {
    const c = car, now = ctx.currentTime, v = Math.abs(s.lon);
    // cranking until the sim says the engine has caught
    if (!s.engineOn) {
      set(c.starter.gain, 0.2, 0.02);
      c.st.frequency.setTargetAtTime(150 + 40 * Math.random(), now, 0.1);
      c.stroke.frequency.setTargetAtTime(8.5 + Math.random(), now, 0.1);
      set(c.strokeG.gain, 0.5, 0.02);
      set(c.eng.gain, 0, 0.05);
    } else {
      if (!c.on) {
        // catch: a cough, then the revs flare and settle (the sim's rpm)
        c.on = true;
        c.starter.gain.setTargetAtTime(0, now, 0.03);
        c.eng.gain.cancelScheduledValues(now);
        c.eng.gain.setValueAtTime(0, now);
        c.eng.gain.linearRampToValueAtTime(0.5, now + 0.06);
      }
      const fire = Math.max(8, s.rpm / 15), rn = clamp((s.rpm - 620) / 3400, 0, 1);
      c.osc.frequency.setTargetAtTime(fire, now, 0.03);
      c.sub.frequency.setTargetAtTime(fire / 2, now, 0.03);
      c.gate.frequency.setTargetAtTime(fire, now, 0.03);
      c.lp.frequency.setTargetAtTime(260 + rn * 900 + s.load * 700, now, 0.06);
      // the lope fades out as the revs rise
      set(c.lopeG.gain, 0.2 * (1 - rn) ** 2, 0.1);
      set(c.subG.gain, 0.34 - 0.18 * rn, 0.1);
      set(c.rumbleG.gain, 0.12 + 0.28 * s.load + 0.1 * rn, 0.06);
      set(c.gateG.gain, 0.1 + 0.2 * s.load, 0.06);
      set(c.intake.g.gain, 0.05 * Math.max(0, s.throttle) * (0.3 + rn), 0.08);
      // gear change: the revs drop (sim) and the pull eases for a moment
      if (s.gear !== c.gear) {
        c.dip = now;
        c.gear = s.gear;
        c.pulseG.gain.cancelScheduledValues(now);
        c.pulseG.gain.setValueAtTime(0.5, now);
        c.pulseG.gain.linearRampToValueAtTime(0.3, now + 0.07);
        c.pulseG.gain.linearRampToValueAtTime(0.5, now + 0.35);
      }
      if (now - c.dip > 0.4) set(c.eng.gain, 0.36 * (0.55 + 0.35 * s.load + 0.3 * rn), 0.05);
    }
    const sv = Math.min(1, v / 18);
    set(c.roll.g.gain, 0.3 * Math.min(1, v / 6));
    set(c.roar.g.gain, 0.09 * sv * sv);
    const lat = Math.abs(s.turn * s.lon);
    set(c.scrub.g.gain, 0.05 * clamp((lat - 3.5) / 3, 0, 1) + (s.handbrake && v > 1 ? 0.06 * Math.min(1, v / 6) : 0));
    const squeal = s.braking > 0.3 && v > 0.6 && v < 5 ? 0.008 * (1 - v / 5) : 0;
    set(c.squealG.gain, squeal, 0.05);
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
    // state: { kind: 'bike' | 'atv' | null, lon, throttle, rpm, load, surface, soft, depth,
    //          coasting, pedal, crank, bump, land }
    update(s) {
      const k = s?.kind ?? null;
      if (k === 'bike' && !bike) bike = makeBike();
      if (k === 'atv' && !atv) atv = makeAtv();
      if (k === 'car' && !car) car = makeCar();
      if (!common && k) common = makeCommon();
      if (k !== kind) switchTo(k);
      if (!k) { if (common) set(common.wind.g.gain, 0); return; }
      const v = Math.abs(s.lon);
      set(common.wind.g.gain, 0.12 * Math.min(1, (v / 12) ** 2));
      if (k === 'bike') updateBike(s); else if (k === 'car') updateCar(s); else updateAtv(s);
      const hit = Math.max(s.bump ?? 0, (s.land ?? 0) * 0.6);
      if (hit > 0.8) thump(hit / 5, k === 'bike' ? 3200 : k === 'car' ? 900 : 1800);
    },
  };
}
