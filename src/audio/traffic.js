// Positional sound for the traffic cars (world/traffic.js): a few voices, given to the
// nearest cars in earshot and handed over with a short fade when the nearest set changes.
// Each voice: an engine at the firing rate - a quiet modern 4-cylinder (rpm / 30) or the
// classic's V8 (rpm / 15) with its half-order burble - revs from a simple automatic, a
// lowpass opening with load, firing-gated intake noise; tyre roar, hiss and road rumble;
// Doppler as a shared detune from the radial speed. Horn: a 1950s-style dual-tone (two
// detuned saw pairs a major third apart through a honky band-pass), once per honk.
import { bq, chain, loopSrc, clamp } from './dsp.js';
import { createSpatial } from './spatial.js';

const C_SOUND = 343;
const RANGE = 110;                 // m: beyond this a car gets no voice
const GEARS = {
  modern: { idle: 760, ratios: [0, 250, 160, 118, 92], up: [0, 4.5, 7.5, 10.5], fire: 30 },
  classic: { idle: 620, ratios: [0, 224, 135, 89], up: [0, 5.5, 10.5], fire: 15 },
};

function makeVoice(env) {
  const { ctx, B } = env;
  const sp = createSpatial(env, { x: 0, y: 0.6, z: 0, ref: 6, rolloff: 1, airScale: 28, wet: 0.14, wetFall: 50 });
  const out = new GainNode(ctx, { gain: 0 });
  out.connect(sp.input);
  const dop = new ConstantSourceNode(ctx, { offset: 0 });
  const detuned = [];
  const eng = new GainNode(ctx, { gain: 0.35 });
  eng.connect(out);
  const lp = bq(ctx, 'lowpass', 300, 0.9);
  const saw = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 25 });
  chain(saw, lp, new GainNode(ctx, { gain: 0.5 }), eng);
  const h2 = new OscillatorNode(ctx, { type: 'sine', frequency: 50 });
  const h2g = new GainNode(ctx, { gain: 0.2 });
  chain(h2, h2g, eng);
  const half = new OscillatorNode(ctx, { type: 'sine', frequency: 12 });
  const halfG = new GainNode(ctx, { gain: 0.2 });
  chain(half, halfG, eng);
  const put = new GainNode(ctx, { gain: 0.08 });
  const fire = new OscillatorNode(ctx, { frequency: 25 });
  fire.connect(new GainNode(ctx, { gain: 0.07 })).connect(put.gain);
  const putN = loopSrc(ctx, B.pink);
  chain(putN, bq(ctx, 'bandpass', 480, 1.1), put, eng);
  detuned.push(saw, h2, half, fire);
  const tyreRoar = loopSrc(ctx, B.pink);
  const roarG = new GainNode(ctx, { gain: 0 });
  chain(tyreRoar, bq(ctx, 'bandpass', 750, 0.5), roarG, out);
  const tyreHiss = loopSrc(ctx, B.white);
  const hissG = new GainNode(ctx, { gain: 0 });
  chain(tyreHiss, bq(ctx, 'bandpass', 2800, 0.8), hissG, out);
  const road = loopSrc(ctx, B.brown);
  const roadG = new GainNode(ctx, { gain: 0 });
  chain(road, bq(ctx, 'lowpass', 110, 0.7), roadG, out);
  for (const n of [...detuned, putN, tyreRoar, tyreHiss, road]) dop.connect(n.detune);
  for (const o of [dop, ...detuned]) o.start();
  return {
    sp, out, eng, lp, saw, h2, h2g, half, halfG, fire, put, roarG, hissG, roadG, dop,
    car: null, gear: 1, rpm: 700, releaseAt: 0,
  };
}

function horn(env, x, z, classic) {
  const { ctx } = env;
  const t = ctx.currentTime + 0.02, dur = 0.42 + Math.random() * 0.12;
  const sp = createSpatial(env, { x, y: 0.8, z, ref: 8, rolloff: 1, airScale: 40, wet: 0.2, wetFall: 60 });
  const g = new GainNode(ctx, { gain: 0 });
  const bp = bq(ctx, 'bandpass', classic ? 700 : 950, 1.3);
  const shaper = new WaveShaperNode(ctx, { curve: (() => { const c = new Float32Array(512); for (let i = 0; i < 512; i++) { const v = (i / 511) * 2 - 1; c[i] = Math.tanh(v * 3); } return c; })() });
  chain(shaper, bp, g, sp.input);
  const base = classic ? 310 : 400;
  const oscs = [base, base * 1.005, base * 1.26, base * 1.26 * 0.996].map((f) => {
    const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: f });
    o.connect(new GainNode(ctx, { gain: 0.25 })).connect(shaper);
    o.start(t); o.stop(t + dur + 0.1);
    return o;
  });
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.5, t + 0.02);
  g.gain.setValueAtTime(0.5, t + dur - 0.05);
  g.gain.linearRampToValueAtTime(0, t + dur);
  oscs[0].onended = () => sp.dispose();
}

export function createTrafficAudio(env, { voices = 3 } = {}) {
  const { ctx } = env;
  const pool = [];
  return {
    // cars: [{ id, x, z, v, a, dir, classic, braking }]; L: listener
    update(cars, L) {
      const now = ctx.currentTime;
      const near = cars.map((c) => ({ c, d: Math.hypot(c.x - L.x, c.z - L.z) })).filter((q) => q.d < RANGE).sort((a, b) => a.d - b.d).slice(0, voices);
      const want = new Set(near.map((q) => q.c.id));
      // release voices whose car left the nearest set (fade, then free)
      for (const v of pool) if (v.car && !want.has(v.car.id)) { v.out.gain.setTargetAtTime(0, now, 0.12); v.car = null; v.releaseAt = now + 0.5; }
      for (const { c } of near) {
        let v = pool.find((q) => q.car?.id === c.id);
        if (!v) {
          v = pool.find((q) => !q.car && now >= q.releaseAt);
          if (!v && pool.length < voices) { v = makeVoice(env); pool.push(v); }
          if (!v) continue;
          v.car = { id: c.id };
          v.sp.setPosition(c.x, 0.6, c.z);
          v.gear = 1;
        }
        v.car = c;
        // revs from road speed through the gears, a little flare with the throttle
        const G = c.classic ? GEARS.classic : GEARS.modern, spd = c.v;
        if (v.gear < G.ratios.length - 1 && spd > G.up[v.gear]) v.gear++;
        else if (v.gear > 1 && spd < G.up[v.gear - 1] - 1.5) v.gear--;
        const load = clamp(c.a / 1.0, 0, 1);
        const rpm = Math.max(G.idle, spd * G.ratios[v.gear] + load * 350);
        v.rpm += (rpm - v.rpm) * 0.2;
        const f = v.rpm / G.fire;
        const tc = 0.05;
        v.saw.frequency.setTargetAtTime(f, now, tc);
        v.h2.frequency.setTargetAtTime(2 * f, now, tc);
        v.half.frequency.setTargetAtTime(f / 2, now, tc);
        v.fire.frequency.setTargetAtTime(f, now, tc);
        v.lp.frequency.setTargetAtTime((c.classic ? 240 : 320) + load * 700 + v.rpm * 0.12, now, 0.08);
        v.halfG.gain.setTargetAtTime(c.classic ? 0.36 : 0.12, now, 0.2);
        v.h2g.gain.setTargetAtTime(c.classic ? 0.14 : 0.22, now, 0.2);
        v.eng.gain.setTargetAtTime((c.classic ? 0.42 : 0.22) * (0.6 + 0.4 * load), now, 0.1);
        const s = Math.min(1, spd / 8);
        v.roarG.gain.setTargetAtTime(0.2 * s * s, now, 0.1);
        v.hissG.gain.setTargetAtTime(0.04 * s, now, 0.1);
        v.roadG.gain.setTargetAtTime(0.32 * s, now, 0.1);
        v.out.gain.setTargetAtTime(1, now, 0.15);
        v.sp.setPosition(c.x, 0.6, c.z, { tc: 0.04 });
        // Doppler from the radial speed
        const dx = L.x - c.x, dz = L.z - c.z, d = Math.hypot(dx, dz, L.y - 0.6) || 1;
        const vr = (c.dir * spd * dz) / d;
        v.dop.offset.setTargetAtTime(1200 * Math.log2(C_SOUND / (C_SOUND - clamp(vr, -60, 60))), now, 0.05);
      }
    },
    horn: (h) => horn(env, h.x, h.z, h.classic),
  };
}

