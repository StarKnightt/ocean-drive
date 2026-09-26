// Positioned source: input -> air-absorption lowpass -> HRTF panner -> dry bus,
// plus a distance-scaled reverb send (so far sources become proportionally more reverberant).
import { clamp } from './dsp.js';

export function createSpatial(env, o = {}) {
  const { ctx } = env;
  const input = new GainNode(ctx);
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 18000, Q: 0.5 });
  const panner = new PannerNode(ctx, {
    panningModel: o.model ?? 'HRTF',
    distanceModel: 'inverse',
    refDistance: o.ref ?? 5,
    rolloffFactor: o.rolloff ?? 1,
    maxDistance: 10000,
    positionX: o.x ?? 0,
    positionY: o.y ?? 0,
    positionZ: o.z ?? 0,
  });
  const wet = new GainNode(ctx, { gain: 0 });
  input.connect(lp).connect(panner).connect(env.dry);
  lp.connect(wet).connect(env.reverb);

  const s = {
    input, panner, x: o.x ?? 0, y: o.y ?? 0, z: o.z ?? 0, posFn: null,
    // opts: { at, ramp } schedules a linear glide; { tc } smooths toward the target.
    setPosition(x, y, z, { at, ramp, tc } = {}) {
      const P = [panner.positionX, panner.positionY, panner.positionZ];
      const from = [s.x, s.y, s.z], to = [x, y, z];
      const t = at ?? ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        if (ramp) { P[i].setValueAtTime(from[i], t); P[i].linearRampToValueAtTime(to[i], t + ramp); }
        else if (tc) P[i].setTargetAtTime(to[i], t, tc);
        else P[i].setValueAtTime(to[i], t);
      }
      s.x = x; s.y = y; s.z = z;
    },
    update(L, immediate = false) {
      const p = s.posFn ? s.posFn() : s;
      const d = Math.hypot(p.x - L.x, p.y - L.y, p.z - L.z);
      let f = o.air === false ? 20000 : 20000 / (1 + d / (o.airScale ?? 25));
      if (o.occl) f = Math.min(f, o.occl.f / (1 + d / o.occl.d));
      f = clamp(f, 150, 20000);
      const w = (o.wet ?? 0.12) / (1 + d / (o.wetFall ?? 60));
      if (immediate) { lp.frequency.value = f; wet.gain.value = w; }
      else {
        const t = ctx.currentTime;
        lp.frequency.setTargetAtTime(f, t, 0.12);
        wet.gain.setTargetAtTime(w, t, 0.12);
      }
    },
    dispose() {
      input.disconnect(); lp.disconnect(); panner.disconnect(); wet.disconnect();
      env.spatials.delete(s);
    },
  };
  env.spatials.add(s);
  s.update(env.listener, true);
  return s;
}
