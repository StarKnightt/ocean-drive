// A car cruising along Ocean Drive at ~25 km/h. Engine = firing-frequency sawtooth (lowpassed)
// + harmonics + half-order rumble + firing-modulated intake noise; tyres = band-passed pink
// roar + hiss + low road rumble. The panner glides along the lane; Doppler is applied as a
// shared detune (cents) on every oscillator and noise source from the radial velocity.
import * as Layout from '../world/layout.js';
import { rr, bq, chain, ramp, loopSrc, clamp } from './dsp.js';
import { createSpatial } from './spatial.js';

const LANE_CX = Layout.LANES?.centerX ?? -18;
const C_SOUND = 343;

export function createCars(env) {
  const { ctx, B } = env;
  const cars = new Set();
  const passCbs = new Set(), endCbs = new Set();
  let ids = 0;

  // opts: dir (+1 = southbound, z -400 -> +400, the whole district), speed m/s, zStart (tests), at (start time)
  function spawn({ dir = Math.random() < 0.6 ? 1 : -1, speed = (25 / 3.6) * rr(0.9, 1.1), zStart, at } = {}) {
    const t0 = (at ?? ctx.currentTime) + 0.05;
    const x = dir > 0 ? LANE_CX - 1.75 : LANE_CX + 1.75;
    const z0 = zStart ?? -400 * dir, z1 = 400 * dir;
    const T = Math.abs(z1 - z0) / speed;
    const y = 0.6;
    const sp = createSpatial(env, { x, y, z: z0, ref: 6, rolloff: 1, airScale: 28, wet: 0.14, wetFall: 50 });
    sp.panner.positionZ.setValueAtTime(z0, t0);
    sp.panner.positionZ.linearRampToValueAtTime(z1, t0 + T);

    const car = {
      id: ++ids, x, y, dir, speed, t0, duration: T, z0, z1, active: true,
      get z() { return clamp(z0 + dir * speed * (ctx.currentTime - t0), Math.min(z0, z1), Math.max(z0, z1)); },
      get progress() { return clamp((ctx.currentTime - t0) / T, 0, 1); },
    };
    sp.posFn = () => ({ x, y, z: car.z });

    const out = new GainNode(ctx, { gain: 0 });
    const fade = Math.min(4, T / 4);
    ramp(out.gain, t0, [[0, 0], [fade, 1], [T - fade, 1], [T, 0]]);
    out.connect(sp.input);

    const dop = new ConstantSourceNode(ctx, { offset: 0 });
    const wob = new OscillatorNode(ctx, { frequency: rr(0.15, 0.35) });
    const wobG = new GainNode(ctx, { gain: 18 });
    wob.connect(wobG);
    const detuned = [];

    const f = rr(1300, 1650) / 30; // 4-stroke, 4 cylinders: firing frequency = rpm / 30
    const eng = new GainNode(ctx, { gain: 0.4 });
    eng.connect(out);
    const partials = [['sawtooth', f, 0.5, 260], ['sine', 2 * f, 0.22], ['sine', f / 2, 0.28], ['triangle', 3 * f, 0.06]];
    const oscs = partials.map(([type, freq, g, lp]) => {
      const o = new OscillatorNode(ctx, { type, frequency: freq });
      const gn = new GainNode(ctx, { gain: g });
      if (lp) chain(o, bq(ctx, 'lowpass', lp, 0.9), gn, eng); else chain(o, gn, eng);
      detuned.push(o);
      return o;
    });
    // intake/mechanical putter: noise amplitude-modulated at the firing rate
    const put = new GainNode(ctx, { gain: 0.1 });
    const fire = new OscillatorNode(ctx, { frequency: f });
    fire.connect(new GainNode(ctx, { gain: 0.09 })).connect(put.gain);
    detuned.push(fire);
    const putN = loopSrc(ctx, B.pink, { at: t0 });
    chain(putN, bq(ctx, 'bandpass', 420, 1.2), put, eng);

    // tyres on asphalt
    const tyreRoar = loopSrc(ctx, B.pink, { at: t0 });
    chain(tyreRoar, bq(ctx, 'bandpass', 750, 0.5), new GainNode(ctx, { gain: 0.22 }), out);
    const tyreHiss = loopSrc(ctx, B.white, { at: t0 });
    chain(tyreHiss, bq(ctx, 'bandpass', 2800, 0.8), new GainNode(ctx, { gain: 0.04 }), out);
    const road = loopSrc(ctx, B.brown, { at: t0 });
    chain(road, bq(ctx, 'lowpass', 110, 0.7), new GainNode(ctx, { gain: 0.35 }), out);
    const noises = [putN, tyreRoar, tyreHiss, road];

    for (const n of [...detuned, ...noises]) { dop.connect(n.detune); wobG.connect(n.detune); }
    for (const s of [dop, wob, ...detuned]) s.start(t0);
    for (const s of [dop, wob, ...detuned, ...noises]) s.stop(t0 + T + 0.1);

    car.dop = dop;
    oscs[0].onended = () => {
      sp.dispose();
      car.active = false;
      cars.delete(car);
      endCbs.forEach((cb) => cb(car));
    };
    cars.add(car);
    passCbs.forEach((cb) => cb(car));
    return car;
  }

  function update(L) {
    const now = ctx.currentTime;
    for (const c of cars) {
      if (now < c.t0) continue;
      const dx = L.x - c.x, dy = L.y - c.y, dz = L.z - c.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const vr = (c.dir * c.speed * dz) / d; // velocity component toward the listener
      const cents = 1200 * Math.log2(C_SOUND / (C_SOUND - vr));
      c.dop.offset.setTargetAtTime(cents, now, 0.05);
    }
  }

  return {
    spawn, update,
    list: () => [...cars],
    onPass: (cb) => { passCbs.add(cb); return () => passCbs.delete(cb); },
    onEnd: (cb) => { endCbs.add(cb); return () => endCbs.delete(cb); },
  };
}
