// Master graph shared by all sound modules:
// sources -> dry bus ─┬─> glue compressor -> limiter -> volume -> soft clip -> destination
//         -> reverb ──┘ (highpassed send -> generated-IR convolver)
import { makeBuffers, makeImpulse, softClipCurve, bq } from './dsp.js';

export function createEngine(ctx) {
  const B = makeBuffers(ctx);
  const sum = new GainNode(ctx, { gain: 1 });
  const dry = new GainNode(ctx, { gain: 1 });
  const reverb = new GainNode(ctx, { gain: 1 });
  const conv = new ConvolverNode(ctx, { buffer: makeImpulse(ctx, 2.4, 2.0) });
  const revRet = new GainNode(ctx, { gain: 0.6 });
  dry.connect(sum);
  reverb.connect(bq(ctx, 'highpass', 180, 0.6)).connect(conv).connect(revRet).connect(sum);

  const comp = new DynamicsCompressorNode(ctx, { threshold: -20, knee: 12, ratio: 2.5, attack: 0.02, release: 0.35 });
  const limiter = new DynamicsCompressorNode(ctx, { threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.1 });
  const volume = new GainNode(ctx, { gain: 0 });
  const clip = new WaveShaperNode(ctx, { curve: softClipCurve(), oversample: '2x' });
  sum.connect(comp).connect(limiter).connect(volume).connect(clip).connect(ctx.destination);

  return { ctx, B, dry, reverb, sum, volume, listener: { x: 0, y: 1.7, z: 0 }, spatials: new Set() };
}
