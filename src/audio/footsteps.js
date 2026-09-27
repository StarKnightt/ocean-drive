// Footsteps: heel strike + toe roll-off built from filtered noise bursts, grains and short
// tonal thumps. Every parameter is randomized per step; steps alternate slightly L/R.
import { rr, bq, chain, perc } from './dsp.js';

export function createFootsteps(env) {
  const { ctx, B } = env;
  const out = new GainNode(ctx, { gain: 0.9 });
  out.connect(env.dry);
  out.connect(new GainNode(ctx, { gain: 0.07 })).connect(env.reverb);
  const f = (type, freq, Q = 0.707) => bq(ctx, type, freq, Q);
  let side = 1;

  function burst(t, buf, filters, peak, a, d, rate, dest) {
    const s = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: rate });
    const g = new GainNode(ctx, { gain: 0 });
    chain(s, ...filters, g, dest);
    perc(g.gain, t, peak, a, d);
    s.start(t, Math.random() * (buf.duration - 1));
    s.stop(t + a + d * 1.5);
  }

  function tone(t, f0, f1, peak, a, d, type, dest) {
    const o = new OscillatorNode(ctx, { type, frequency: f0 });
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    const g = new GainNode(ctx, { gain: 0 });
    o.connect(g).connect(dest);
    perc(g.gain, t, peak, a, d);
    o.start(t);
    o.stop(t + a + d * 1.5);
  }

  const S = {
    pavement(t, v, d) {
      burst(t, B.white, [f('bandpass', rr(2200, 3800), 1.3)], 0.35 * v * rr(0.8, 1.2), 0.0008, 0.02, 1, d);
      tone(t, rr(95, 130), rr(60, 75), 0.4 * v, 0.002, 0.05, 'sine', d);
      burst(t, B.pink, [f('bandpass', rr(700, 1100), 1.1)], 0.35 * v, 0.001, 0.035, 1, d);
      burst(t + 0.002, B.crackleDense, [f('highpass', rr(2200, 3200), 0.7)], 0.35 * v, 0.004, rr(0.05, 0.09), rr(0.8, 1.3), d);
      const tt = t + rr(0.06, 0.1);
      burst(tt, B.white, [f('bandpass', rr(3000, 5200), 1.5)], 0.28 * v * rr(0.7, 1.2), 0.0008, 0.014, 1, d);
      burst(tt, B.pink, [f('bandpass', rr(1100, 1600), 1.2)], 0.18 * v, 0.001, 0.025, 1, d);
      burst(tt, B.crackleDense, [f('highpass', 2800, 0.7)], 0.2 * v, 0.003, 0.05, rr(0.9, 1.4), d);
    },
    sand(t, v, d) {
      const a = rr(0.02, 0.04), dd = rr(0.13, 0.2);
      burst(t, B.crackleDense, [f('bandpass', rr(1300, 2300), 0.9)], 0.9 * v, a, dd, rr(0.7, 1.1), d);
      burst(t, B.white, [f('bandpass', rr(3500, 5500), 0.8)], 0.08 * v, a, dd * 0.8, 1, d);
      burst(t, B.brown, [f('lowpass', 260, 0.7)], 0.45 * v, 0.012, 0.09, 1, d);
      if (Math.random() < 0.35) { const s = rr(650, 1000); tone(t + a * 0.6, s, s * rr(1.05, 1.2), 0.02 * v, 0.02, 0.06, 'triangle', d); }
      const tt = t + rr(0.07, 0.11);
      burst(tt, B.crackleDense, [f('bandpass', rr(1800, 2800), 1)], 0.45 * v, 0.015, rr(0.08, 0.12), rr(0.9, 1.2), d);
    },
    wetsand(t, v, d) {
      burst(t, B.brown, [f('lowpass', rr(320, 440), 0.8)], 0.65 * v, 0.006, 0.11, 1, d);
      const sq = f('bandpass', rr(260, 380), rr(5, 8));
      sq.frequency.setValueAtTime(sq.frequency.value, t);
      sq.frequency.exponentialRampToValueAtTime(rr(750, 1100), t + rr(0.07, 0.11));
      burst(t, B.pink, [sq], 0.9 * v, 0.012, 0.12, 1, d);
      burst(t + 0.004, B.white, [f('highpass', rr(2200, 3000), 0.7)], 0.08 * v, 0.004, 0.07, 1, d);
      const n = 1 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) { const b = rr(1200, 2600); tone(t + rr(0.02, 0.12), b, b * 1.4, 0.03 * v, 0.002, 0.018, 'sine', d); }
      const su = f('bandpass', rr(800, 1000), 6);
      su.frequency.setValueAtTime(su.frequency.value, t + 0.14);
      su.frequency.exponentialRampToValueAtTime(350, t + 0.24);
      burst(t + 0.14, B.pink, [su], 0.35 * v, 0.02, 0.08, 1, d);
    },
    // foot in shallow swash: a wet slap, water sloshing off, fizzing foam
    splash(t, v, d, depth = 0.05) {
      const k = Math.min(1, 0.4 + depth * 6);
      burst(t, B.brown, [f('lowpass', rr(260, 360), 0.8)], 0.45 * v, 0.004, 0.08, 1, d);
      burst(t, B.pink, [f('bandpass', rr(500, 800), 1.2)], 0.7 * v * k, 0.006, rr(0.12, 0.2), 1, d);
      const sl = f('bandpass', rr(900, 1300), 2.5);
      sl.frequency.setValueAtTime(sl.frequency.value, t + 0.03);
      sl.frequency.exponentialRampToValueAtTime(rr(400, 600), t + 0.3);
      burst(t + 0.03, B.white, [sl], 0.35 * v * k, 0.03, rr(0.2, 0.3), 1, d);
      burst(t + 0.05, B.crackleDense, [f('highpass', rr(2500, 3500), 0.7)], 0.5 * v * k, 0.03, rr(0.25, 0.4), rr(0.9, 1.2), d);
      for (let i = 0; i < 3; i++) { const b = rr(700, 1600); tone(t + rr(0.04, 0.2), b, b * 1.6, 0.04 * v * k, 0.002, 0.03, 'sine', d); }
    },
    wood(t, v, d) {
      const hollow = new GainNode(ctx, { gain: 1 });
      hollow.connect(d);
      hollow.connect(new DelayNode(ctx, { delayTime: rr(0.009, 0.014) })).connect(new GainNode(ctx, { gain: 0.35 })).connect(d);
      const knock = (tt, scale) => {
        const f1 = rr(130, 175);
        [[1, 14, 1.5, 0.18], [2.32, 11, 0.9, 0.12], [3.87, 8, 0.55, 0.08]].forEach(([m, q, g, dec]) =>
          burst(tt, B.pink, [f('bandpass', f1 * m * rr(0.97, 1.03), q)], g * v * scale, 0.001, dec, 1, hollow));
        tone(tt, rr(95, 120), rr(70, 85), 0.3 * v * scale, 0.002, 0.1, 'sine', hollow);
        burst(tt, B.white, [f('bandpass', 2800, 1.2)], 0.3 * v * scale, 0.0008, 0.012, 1, d);
      };
      knock(t, 1);
      knock(t + rr(0.06, 0.09), 0.45);
    },
    grass(t, v, d) {
      burst(t, B.white, [f('bandpass', rr(3000, 5000), 0.6)], 0.16 * v, rr(0.025, 0.04), rr(0.1, 0.15), 1, d);
      burst(t, B.crackleDense, [f('highpass', rr(2000, 3000), 0.7)], 0.35 * v, 0.02, 0.1, rr(0.8, 1.2), d);
      burst(t, B.brown, [f('lowpass', 200, 0.7)], 0.4 * v, 0.01, 0.07, 1, d);
      burst(t + rr(0.07, 0.1), B.white, [f('bandpass', rr(3500, 6000), 0.7)], 0.08 * v, 0.02, 0.08, 1, d);
    },
  };

  // opts.depth: water depth (m) for 'splash'
  function step(surface = 'pavement', { gain = 1, at, depth } = {}) {
    const t = (at ?? ctx.currentTime) + 0.005;
    side = -side;
    const pan = new StereoPannerNode(ctx, { pan: side * rr(0.06, 0.14) });
    pan.connect(out);
    (S[surface] ?? S.pavement)(t, gain * rr(0.8, 1.1), pan, depth);
  }

  return { step };
}
