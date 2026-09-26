// Wind: a soft non-spatial stereo breeze plus positioned frond-rustle sources at palm clusters.
// All layers share one slow gust control signal; each palm reads it with a time offset
// proportional to its x, so gusts roll in from the ocean and sweep west across the palms.
import { rr, bq, chain, loopSrc } from './dsp.js';
import { createSpatial } from './spatial.js';

export function createWind(env, palms) {
  const { ctx, B } = env;
  const t0 = ctx.currentTime + 0.02;
  const gustAt = (x) => loopSrc(ctx, B.gust, { at: t0, offset: (((20 + x * 0.09) % 71) + 71) % 71 });

  // General breeze (decorrelated L/R).
  const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  for (let ch = 0; ch < 2; ch++) {
    const g = new GainNode(ctx, { gain: 0.25 });
    gustAt(-20 + ch * 3).connect(new GainNode(ctx, { gain: 0.75 })).connect(g.gain);
    chain(loopSrc(ctx, B.pink), bq(ctx, 'lowpass', 520, 0.5), new GainNode(ctx, { gain: 0.5 }), g);
    chain(loopSrc(ctx, B.white), bq(ctx, 'bandpass', 1600, 0.5), new GainNode(ctx, { gain: 0.05 }), g);
    g.connect(merger, 0, ch);
  }
  merger.connect(new GainNode(ctx, { gain: 0.16 })).connect(env.dry);

  const cube = new WaveShaperNode(ctx, { curve: Float32Array.from({ length: 256 }, (_, i) => (i / 255 * 2 - 1) ** 3) });

  for (const [x, z] of palms) {
    const sp = createSpatial(env, { x, y: rr(6, 9), z, ref: 4, rolloff: 1.2, airScale: 25, wet: 0.1, wetFall: 40 });
    const gustSrc = gustAt(x);

    const gust = new GainNode(ctx, { gain: 0.08 });
    gustSrc.connect(new GainNode(ctx, { gain: 0.92 })).connect(gust.gain);
    gust.connect(sp.input);

    // leaf rustle: bright band-passed noise with fast random flutter
    const flut = new GainNode(ctx, { gain: 0.35 });
    loopSrc(ctx, B.flutter).connect(new GainNode(ctx, { gain: 0.65 })).connect(flut.gain);
    chain(loopSrc(ctx, B.white), bq(ctx, 'highpass', 900, 0.6), bq(ctx, 'bandpass', rr(2600, 4200), 0.55),
      new GainNode(ctx, { gain: 0.5 }), flut, gust);
    // frond body whoosh
    chain(loopSrc(ctx, B.pink), bq(ctx, 'bandpass', rr(600, 800), 0.6), new GainNode(ctx, { gain: 0.22 }), gust);

    // dry frond clatter, only in strong gusts (gust^3)
    const clat = new GainNode(ctx, { gain: 0 });
    const shaper = new WaveShaperNode(ctx, { curve: cube.curve });
    gustSrc.connect(shaper).connect(new GainNode(ctx, { gain: 0.9 })).connect(clat.gain);
    chain(loopSrc(ctx, B.crackleDense), bq(ctx, 'bandpass', rr(1400, 2200), 1.1), clat, sp.input);
  }
}
