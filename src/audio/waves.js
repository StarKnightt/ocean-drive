// Ocean: a continuous surf bed along the waterline (sources track the listener's z so the
// shoreline feels endless), a distant offshore roar, and discrete wave events —
// swell -> crash -> foam wash-in running up the sand -> gravelly fizz receding.
import { rr, bq, chain, ramp, loopSrc } from './dsp.js';
import { createSpatial } from './spatial.js';

const BED_OFFSETS = [-75, -28, 28, 75];

export function createWaves(env, { waterlineX = 90 } = {}) {
  const { ctx, B } = env;
  const WL = waterlineX;

  const beds = BED_OFFSETS.map((off) => {
    const sp = createSpatial(env, { x: WL - 1, y: 0.4, z: off, ref: 12, rolloff: 1, airScale: 35, wet: 0.06 });
    const mod = new GainNode(ctx, { gain: 0.45 });
    const depth = new GainNode(ctx, { gain: 0.55 });
    loopSrc(ctx, B.swell).connect(depth).connect(mod.gain);
    chain(loopSrc(ctx, B.brown), bq(ctx, 'lowpass', 380, 0.6), new GainNode(ctx, { gain: 0.5 }), mod);
    chain(loopSrc(ctx, B.pink), bq(ctx, 'bandpass', 1100, 0.45), new GainNode(ctx, { gain: 0.1 }), mod);
    mod.connect(sp.input);
    return { sp, off };
  });

  const far = createSpatial(env, { x: WL + 140, y: 2, z: 0, ref: 80, rolloff: 1, air: false, wet: 0.05 });
  chain(loopSrc(ctx, B.brown), bq(ctx, 'lowpass', 260, 0.6), new GainNode(ctx, { gain: 0.14 }), far.input);

  function track(L) {
    for (const b of beds) b.sp.setPosition(WL - 1, 0.4, L.z + b.off, { tc: 0.25 });
    far.setPosition(WL + 140, 2, L.z, { tc: 0.25 });
  }

  function noise(buf, t, dur, filters, dest, rate = 1) {
    const s = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true, playbackRate: rate });
    const g = new GainNode(ctx, { gain: 0 });
    chain(s, ...filters, g, dest);
    s.start(t, Math.random() * buf.duration);
    s.stop(t + dur);
    return { s, g };
  }

  // One breaking wave. `size` 0.5..1 scales loudness and timing.
  function breakAt(t, L, size = rr(0.55, 1)) {
    const z = L.z + rr(-40, 40);
    const crash = createSpatial(env, { x: WL - rr(2, 5), y: 0.6, z, ref: 10, rolloff: 1, airScale: 30, wet: 0.1 });
    const wash = createSpatial(env, { x: WL, y: 0.3, z: z + rr(-6, 6), ref: 7, rolloff: 1, airScale: 25, wet: 0.08 });
    const k = rr(0.85, 1.2); // tempo of this wave
    const T = (s) => s * k;
    const end = T(9.5);

    // 1. swell building, crash, settling
    const lp1 = bq(ctx, 'lowpass', 200, 0.7);
    ramp(lp1.frequency, t, [[0, 200], [T(1.6), 700], [T(2.2), 2600], [T(4), 900], [end, 400]]);
    const a = noise(B.pink, t, end, [lp1], crash.input);
    ramp(a.g.gain, t, [[0, 0], [T(1.6), 0.25 * size], [T(2.15), 0.95 * size], [T(3.2), 0.35 * size], [T(5.5), 0]]);

    // 2. low thump of the lip hitting the water
    const b = noise(B.brown, t, end, [bq(ctx, 'lowpass', 160, 0.8)], crash.input);
    ramp(b.g.gain, t, [[0, 0], [T(1.9), 0], [T(2.2), 0.9 * size], [T(3.8), 0]]);

    // 3. foam hiss rushing up the sand and dying away
    const lp3 = bq(ctx, 'lowpass', 8000, 0.5);
    ramp(lp3.frequency, t, [[0, 8000], [T(2.2), 8000], [T(7.5), 2400]]);
    const c = noise(B.white, t, end, [bq(ctx, 'highpass', 1200, 0.6), lp3], wash.input);
    ramp(c.g.gain, t, [[0, 0], [T(2.1), 0], [T(2.8), 0.4 * size], [T(4.5), 0.26 * size], [T(8.2), 0]]);
    const runup = rr(4, 8) * size;
    wash.setPosition(WL - runup, 0.3, wash.z, { at: t + T(2.2), ramp: T(2.3) });
    wash.setPosition(WL, 0.3, wash.z, { at: t + T(4.5), ramp: T(4) });

    // 4. gravelly fizz of foam and shell grit draining back
    const d = noise(B.crackle, t, end, [bq(ctx, 'bandpass', rr(2800, 3800), 0.6), bq(ctx, 'highpass', 1400, 0.6)], wash.input, rr(0.85, 1.15));
    ramp(d.g.gain, t, [[0, 0], [T(3), 0], [T(4.6), 1.6 * size], [T(6.5), 0.8 * size], [T(8.8), 0]]);

    // 5. faint high sizzle of bursting bubbles
    const e = noise(B.white, t, end, [bq(ctx, 'highpass', 6000, 0.7)], wash.input);
    ramp(e.g.gain, t, [[0, 0], [T(3.2), 0], [T(4.2), 0.07 * size], [T(8.5), 0]]);

    a.s.onended = () => { crash.dispose(); wash.dispose(); };
    return { t, k, size, runup, z };
  }

  return { track, breakAt };
}
