// Seagulls: each note is a harmonically rich custom waveform, FM-roughened and
// amplitude-rasped, shaped by three vocal-tract formant bandpasses (the second one glides
// down for the "-ow" of "kyow"), plus a little breath noise. Calls come in phrases
// (long call, laughing "ha-ha-ha", short "kek") from a gull drifting across the sky.
import { rr, pick, bq, chain, clamp } from './dsp.js';
import { createSpatial } from './spatial.js';

const HARM = [1, 0.85, 0.75, 0.55, 0.42, 0.3, 0.22, 0.15, 0.1, 0.07];

export function createGulls(env) {
  const { ctx, B } = env;
  const real = new Float32Array(HARM.length + 1), imag = new Float32Array(HARM.length + 1);
  HARM.forEach((h, i) => { imag[i + 1] = h; });
  const wave = ctx.createPeriodicWave(real, imag);

  function note(t, dur, f0, contour, dest, { bright = 1, vowel = true, peak = 0.3 } = {}) {
    const osc = new OscillatorNode(ctx, { frequency: f0 });
    osc.setPeriodicWave(wave);
    const mod = new OscillatorNode(ctx, { frequency: f0 });
    const modG = new GainNode(ctx, { gain: 0 });
    mod.connect(modG).connect(osc.frequency);
    for (const p of [osc.frequency, mod.frequency]) {
      p.setValueAtTime(f0 * contour[0][1], t);
      for (let i = 1; i < contour.length; i++) p.linearRampToValueAtTime(f0 * contour[i][1], t + contour[i][0] * dur);
    }
    modG.gain.setValueAtTime(f0 * rr(0.5, 1.2) * bright, t);
    modG.gain.linearRampToValueAtTime(f0 * 0.25, t + dur);

    const rasp = new OscillatorNode(ctx, { frequency: rr(55, 95) });
    const raspG = new GainNode(ctx, { gain: rr(0.2, 0.4) });
    const am = new GainNode(ctx, { gain: 0.7 });
    rasp.connect(raspG).connect(am.gain);
    osc.connect(am);

    const env_ = new GainNode(ctx, { gain: 0 });
    const f2 = bq(ctx, 'bandpass', 2900, 5);
    if (vowel) { f2.frequency.setValueAtTime(2900, t); f2.frequency.linearRampToValueAtTime(1700, t + dur); }
    for (const [f, q, g] of [[1400 * rr(0.95, 1.05), 4, 1], [null, 0, 0.8], [3900, 5, 0.4]]) {
      const filt = f === null ? f2 : bq(ctx, 'bandpass', f, q);
      chain(am, filt, new GainNode(ctx, { gain: g }), env_);
    }
    chain(am, new GainNode(ctx, { gain: 0.12 }), env_);

    const n = new AudioBufferSourceNode(ctx, { buffer: B.white, loop: true });
    chain(n, bq(ctx, 'bandpass', f0 * 2, 3), new GainNode(ctx, { gain: 0.25 }), env_);

    env_.gain.setValueAtTime(0, t);
    env_.gain.linearRampToValueAtTime(peak, t + 0.015);
    env_.gain.linearRampToValueAtTime(peak * 0.8, t + dur * 0.6);
    env_.gain.linearRampToValueAtTime(0, t + dur);
    env_.connect(dest);

    for (const s of [osc, mod, rasp]) { s.start(t); s.stop(t + dur + 0.05); }
    n.start(t, Math.random() * 5);
    n.stop(t + dur + 0.05);
    return osc;
  }

  function phrase(t, kind, dest) {
    let tt = t, last;
    if (kind === 'kyow') {
      let f = rr(750, 950);
      last = note(tt, rr(0.4, 0.5), f, [[0, 0.8], [0.2, 1.12], [0.55, 1.05], [1, 0.7]], dest, { peak: 0.5 });
      tt += rr(0.6, 0.75);
      const n = 3 + ((Math.random() * 4) | 0);
      for (let i = 0; i < n; i++) {
        last = note(tt, rr(0.2, 0.28), f, [[0, 0.85], [0.25, 1.1], [1, 0.72]], dest, { peak: 0.45 });
        f *= rr(0.96, 1.0);
        tt += rr(0.28, 0.36);
      }
    } else if (kind === 'laugh') {
      let f = rr(900, 1100);
      const n = 5 + ((Math.random() * 5) | 0);
      for (let i = 0; i < n; i++) {
        last = note(tt, rr(0.1, 0.14), f, [[0, 0.95], [0.3, 1.12], [1, 0.8]], dest, { bright: 1.4, vowel: false, peak: 0.42 });
        f *= rr(0.95, 0.99);
        tt += rr(0.17, 0.22);
      }
    } else {
      const f = rr(1000, 1300);
      const n = 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++) {
        last = note(tt, rr(0.12, 0.18), f, [[0, 0.9], [0.3, 1.08], [1, 0.75]], dest, { bright: 1.2, peak: 0.38 });
        tt += rr(0.25, 0.4);
      }
    }
    return { end: tt, last };
  }

  // BIRDS hook: source(L) -> { x, y, z, vx, vy, vz } of a real (visible) gull, or null
  let source = null;
  function setSource(fn) { source = fn; }

  // A gull (sometimes answered by a second one) calling while gliding over the beach.
  function callAt(t, L, kind = pick(['kyow', 'kyow', 'laugh', 'kek'])) {
    const src = source?.(L);
    const x = src ? src.x : rr(15, 105), y = src ? src.y : rr(10, 28), z = src ? src.z : L.z + rr(-50, 50);
    const sp = createSpatial(env, { x, y, z, ref: 6, rolloff: 1, airScale: 30, wet: 0.12 });
    const { end, last } = phrase(t, kind, sp.input);
    const dur = end - t + 0.3;
    if (src) sp.setPosition(x + src.vx * dur, y + src.vy * dur, z + src.vz * dur, { at: t, ramp: dur });
    else sp.setPosition(clamp(x + rr(-6, 6) * dur, 10, 120), y + rr(-1, 1) * dur, z + rr(-6, 6) * dur, { at: t, ramp: dur });
    last.onended = () => setTimeout(() => sp.dispose(), 400);
    if (Math.random() < 0.3) callAt(t + rr(0.4, 1.5), L, pick(['kek', 'laugh', 'kyow']));
  }

  // BIRDS hook: soft wingbeats of a gull taking off nearby (p = { x, y, z, vx, vy, vz })
  function flutterAt(t, p) {
    const sp = createSpatial(env, { x: p.x, y: p.y, z: p.z, ref: 2, rolloff: 1.4, airScale: 30, wet: 0.04 });
    const n = new AudioBufferSourceNode(ctx, { buffer: B.white, loop: true });
    const g = new GainNode(ctx, { gain: 0 });
    chain(n, bq(ctx, 'bandpass', rr(550, 800), 0.9), bq(ctx, 'lowpass', 2200), g, sp.input);
    const beats = 6, rate = rr(4, 4.6);
    for (let i = 0; i < beats; i++) {
      const tb = t + i / rate, pk = 0.35 * (1 - i / (beats + 1));
      g.gain.setValueAtTime(0, tb);
      g.gain.linearRampToValueAtTime(pk, tb + 0.035);
      g.gain.linearRampToValueAtTime(0, tb + 0.15);
    }
    const dur = beats / rate + 0.2;
    sp.setPosition(p.x + p.vx * dur, p.y + p.vy * dur, p.z + p.vz * dur, { at: t, ramp: dur });
    n.start(t, Math.random() * 5);
    n.stop(t + dur);
    n.onended = () => setTimeout(() => sp.dispose(), 300);
  }

  return { callAt, setSource, flutterAt };
}
