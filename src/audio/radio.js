// Generative car radio: three procedurally composed stations heard through a small cabin
// speaker (band-limited, a cabinet resonance, wind-masking lowpass). Nothing is scheduled
// until the first next()/set(); only the tuned station is scheduled, and switching plays a
// short band-passed noise sweep. Output is non-positional (env.dry).
//   Bossa at Dawn – Markov-chain bossa: Karplus-Strong nylon chords, thumb + sine bass, shaker, rim
//   Sunrise Synth – 96 bpm: detuned-saw pads over 2-bar chords, FM bell arp with echo, soft kick/hat/clap
//   Clave Café    – 3-2 son clave woodblock, tumbao congas + bongos, tumbao bass, piano montuno
import { rr, pick, clamp, mtof, bq, chain, perc, ramp, renderPluck } from './dsp.js';
import { createEngine } from './engine.js';

const NAMES = ['Bossa at Dawn', 'Sunrise Synth', 'Clave Café'];
const SWEEP = 0.35;

// Bossa harmony (compact version of music.js): chord functions -> [degree, voicing]
const BVOX = {
  maj9: [4, 11, 14, 19], '69': [4, 9, 14, 19], m9: [10, 15, 19, 26], dom13: [10, 16, 21, 26],
  '7b9': [4, 10, 13, 19], m7b5: [10, 15, 18],
};
const BCH = {
  I: [0, 'maj9'], I6: [0, '69'], ii: [2, 'm9'], iii: [4, 'm9'], IV: [5, 'maj9'], vi: [9, 'm9'],
  V: [7, 'dom13'], Valt: [7, '7b9'], II7: [2, 'dom13'], VI7: [9, '7b9'], bII7: [1, 'dom13'], vii: [11, 'm7b5'],
};
const BNEXT = {
  I: ['vi', 'ii', 'iii', 'IV', 'II7', 'I6'], I6: ['vi', 'ii', 'IV'], vi: ['ii', 'II7', 'IV', 'vii'],
  ii: ['V', 'Valt', 'bII7'], V: ['I', 'I6', 'vi'], Valt: ['I', 'vi'], bII7: ['I', 'I6'], iii: ['VI7', 'vi'],
  VI7: ['ii', 'II7'], IV: ['V', 'iii', 'ii'], II7: ['ii', 'V'], vii: ['VI7'],
};
const BKEYS = [0, 5, -2, 3, 2];
const BHITS = new Set([0, 6, 12, 20, 26]); // 16ths in a 2-bar cycle
const BRIM = new Set([0, 6, 10, 16, 22, 26]); // cross-stick

function genPhrase() {
  const p = ['I'];
  while (p.length < 6) p.push(pick(BNEXT[p[p.length - 1]]));
  p.push('ii', pick(['V', 'Valt', 'bII7']));
  return p;
}

// Synth: 4 chords x 2 bars
const SVOX = { maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], add9: [0, 4, 7, 14], sus: [0, 5, 7, 10], m9: [0, 3, 7, 14] };
const SPROGS = [
  [[0, 'maj7'], [9, 'm7'], [5, 'add9'], [7, 'sus']],
  [[9, 'm9'], [5, 'maj7'], [0, 'add9'], [7, 'sus']],
  [[0, 'add9'], [4, 'm7'], [5, 'maj7'], [5, 'm9']],
  [[5, 'maj7'], [7, 'sus'], [4, 'm7'], [9, 'm9']],
];
const SKEYS = [0, 2, -3, 5, -2];
const ARP = [0, 1, 2, 3, 4, 3, 2, 1];

// Clave: 8th grid at 176 bpm, 16 units = one 3-2 clave cycle, one chord per bar
const CVOX = { maj: [0, 4, 7], min: [0, 3, 7], dom: [0, 4, 7, 10] };
const CPROGS = [
  [[0, 'maj'], [5, 'maj'], [7, 'dom'], [5, 'maj']],
  [[0, 'min'], [5, 'min'], [7, 'dom'], [0, 'min']],
  [[2, 'min'], [7, 'dom'], [0, 'maj'], [0, 'maj']],
  [[0, 'min'], [8, 'maj'], [7, 'dom'], [7, 'dom']],
];
const CKEYS = [0, 2, 5, 7, -3];
const CLAVE = new Set([0, 3, 6, 10, 12]);
const CONGA = ['h', 't', 's', 't', 'h', 't', 'o', 'O'];
const BONGO = [0.12, 0.05, 0.07, 0.05, 0.1, 0.05, 0.08, 0.05];
const MONT = [1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1];
const MSEQ = [0, 1, 2, 1, 2, 3, 2, 1];

const pcOf = (n) => ((n % 12) + 12) % 12;

// dest: where the radio gain feeds (default the non-spatial dry bus -> comp -> limiter -> volume)
export function createRadio(env, { reduced = false, dest = env.dry } = {}) {
  const { ctx, B } = env;
  let level = 0.35, inside = true, wind = 0, outAt = 0, open = false, speed = 0;
  let tuned = -1, disposed = false;

  const cabIn = new GainNode(ctx, { gain: 1 });
  const windLp = bq(ctx, 'lowpass', 6500, 0.5);
  const out = new GainNode(ctx, { gain: level });
  chain(cabIn, bq(ctx, 'highpass', 120, 0.6), bq(ctx, 'lowpass', 6000, 0.5),
    bq(ctx, 'peaking', 190, 1.2, 2), bq(ctx, 'peaking', 1150, 1.8, 3), windLp, out);
  out.connect(dest);

  function station(mix) {
    const fade = new GainNode(ctx, { gain: 0 });
    const bus = new GainNode(ctx, { gain: mix });
    bus.connect(fade).connect(cabIn);
    return { bus, fade };
  }

  // Pitched percussive voice gliding f0 -> f1.
  function tone(to, t, f0, f1, peak, d, type = 'sine', glide = 0.03) {
    const o = new OscillatorNode(ctx, { type, frequency: f0 });
    const g = new GainNode(ctx, { gain: 0 });
    o.connect(g).connect(to);
    if (f1 !== f0) { o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + glide); }
    perc(g.gain, t, peak, 0.002, d);
    o.start(t);
    o.stop(t + d * 1.6 + 0.02);
  }

  function noise(to, t, filters, peak, a, d, buf = B.white) {
    const s = new AudioBufferSourceNode(ctx, { buffer: buf });
    const g = new GainNode(ctx, { gain: 0 });
    chain(s, ...filters, g, to);
    perc(g.gain, t, peak, a, d);
    s.start(t, Math.random() * (buf.duration - 1));
    s.stop(t + a + d * 1.5);
  }

  function bossa() {
    const S = 60 / 124 / 4, { bus, fade } = station(0.8);
    const gtr = new GainNode(ctx, { gain: 1 });
    chain(gtr, bq(ctx, 'peaking', 110, 1.2, 3), bq(ctx, 'lowpass', 3800, 0.6), bus);
    const plucks = new Map();
    let key = pick(BKEYS), form = [], cur = null, nxt = null, anticip = false;

    function pluckBuf(midi) {
      const k = `${midi}:${(Math.random() * 2) | 0}`;
      let b = plucks.get(k);
      if (!b) {
        const low = midi < 52, f = mtof(midi);
        const data = renderPluck(ctx.sampleRate, f, {
          seconds: low ? 2 : 1.4, bright: low ? 0.25 : rr(0.35, 0.5), pos: rr(0.1, 0.2),
          t60: (low ? 3 : 2) * Math.pow(196 / f, 0.3),
        });
        b = ctx.createBuffer(1, data.length, ctx.sampleRate);
        b.copyToChannel(data, 0);
        plucks.set(k, b);
      }
      return b;
    }
    function pluck(midi, t, vel, hold, tc = 0.07) {
      const src = new AudioBufferSourceNode(ctx, { buffer: pluckBuf(midi) });
      const g = new GainNode(ctx, { gain: vel });
      src.connect(g).connect(gtr);
      g.gain.setValueAtTime(vel, t);
      g.gain.setTargetAtTime(0, t + hold, tc);
      src.start(t);
      src.stop(t + hold + tc * 8);
    }
    function voicing(name) {
      const [deg, q] = BCH[name];
      const root = 40 + pcOf(pcOf(deg + key) - 4); // E2..Eb3
      let up = BVOX[q].map((i) => root + i);
      if (reduced) up = up.slice(0, 3);
      const mean = () => up.reduce((a, b) => a + b, 0) / up.length;
      while (mean() < 57) up = up.map((m) => m + 12);
      while (mean() > 68) up = up.map((m) => m - 12);
      return { root, up };
    }
    function strum(ch, t, vel) {
      const hold = rr(0.26, 0.4);
      let tt = t;
      for (const m of ch.up) { pluck(m, tt, vel * rr(0.8, 1) * 0.2, hold); tt += rr(0.004, 0.012); }
    }
    function bass(midi, t, vel, hold) {
      pluck(midi, t, vel * 0.3, hold, 0.12);
      tone(bus, t, mtof(midi), mtof(midi), vel * 0.09, hold + 0.25);
    }
    function newForm() {
      const A = genPhrase(), Bp = genPhrase();
      form = [...A, ...A, ...Bp, ...A];
      if (Math.random() < 0.4) key = pick(BKEYS);
    }
    function play(st, t) {
      const bs = st % 16, bar = Math.floor(st / 16), h = t + rr(-0.004, 0.006);
      if (bs === 0) {
        if (!form.length || bar % form.length === 0) newForm();
        cur = voicing(form[bar % form.length]);
        nxt = voicing(form[(bar + 1) % form.length]);
      }
      const cyc = (bar % 2) * 16 + bs;
      if (bs === 0) { if (!anticip) strum(cur, h, rr(0.6, 0.75)); anticip = false; }
      else if (bs === 14 && Math.random() < 0.28) { strum(nxt, h, rr(0.5, 0.65)); anticip = true; }
      else if (BHITS.has(cyc) && Math.random() > 0.08) strum(cur, h, rr(0.45, 0.65));
      if (bs === 0) bass(cur.root, h, 0.95, 0.9);
      if (bs === 8) { let f5 = cur.root + 7; if (f5 > 52) f5 -= 12; bass(f5, h, 0.8, 0.8); }
      noise(bus, h, [bq(ctx, 'highpass', 5000, 0.7), bq(ctx, 'bandpass', 9000, 0.7)],
        [0.55, 0.22, 0.8, 0.3][bs % 4] * rr(0.8, 1.1) * 0.06, rr(0.008, 0.02), 0.06);
      if (!reduced && BRIM.has(cyc) && bar > 1) {
        tone(bus, h, 1250, 900, 0.05, 0.03);
        noise(bus, h, [bq(ctx, 'bandpass', 2200, 2)], 0.08, 0.001, 0.02);
      }
    }
    return { S, cycle: 32, bus, fade, play, init() { form = []; anticip = false; } };
  }

  function synth() {
    const S = 60 / 96 / 4, { bus, fade } = station(0.6);
    const pads = new GainNode(ctx, { gain: 1 });
    pads.connect(bus);
    const arp = new GainNode(ctx, { gain: 1 });
    chain(arp, bq(ctx, 'lowpass', 3200, 0.6), bus);
    if (!reduced) { // dotted-8th echo on the arp
      const dl = new DelayNode(ctx, { delayTime: S * 3 }), fb = new GainNode(ctx, { gain: 0.32 });
      const wet = new GainNode(ctx, { gain: 0.45 });
      chain(arp, dl, bq(ctx, 'lowpass', 2200, 0.6), fb, dl);
      fb.connect(wet).connect(bus);
    }
    const low = new GainNode(ctx, { gain: 1 });
    chain(low, bq(ctx, 'lowpass', 520, 0.7), bus);
    let key = 0, prog = null, ch = null, cycles = 0;

    function chordAt(i) {
      const [deg, q] = prog[i];
      const root = 45 + pcOf(deg + key); // A2..G#3
      const up = SVOX[q].map((x) => root + 12 + x);
      return { bass: root - 12, up, arp: [...up.map((m) => m + 12), up[0] + 24] };
    }
    function pad(c, t, dur) {
      const lp = bq(ctx, 'lowpass', 500, 0.8);
      const vca = new GainNode(ctx, { gain: 0 });
      chain(lp, vca, pads);
      ramp(lp.frequency, t, [[0, 500], [dur * 0.5, 1700], [dur, 800]]);
      vca.gain.setValueAtTime(0, t);
      vca.gain.linearRampToValueAtTime(reduced ? 0.07 : 0.04, t + 1.2);
      vca.gain.setTargetAtTime(0, t + dur, 0.5);
      for (const m of c.up) {
        for (const det of reduced ? [0] : [-8, 8]) {
          const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: mtof(m), detune: det + rr(-2, 2) });
          o.connect(lp);
          o.start(t);
          o.stop(t + dur + 3);
        }
      }
    }
    function bell(t, m, vel) {
      const f = mtof(m);
      const car = new OscillatorNode(ctx, { frequency: f }), mod = new OscillatorNode(ctx, { frequency: f * 2 });
      const mg = new GainNode(ctx, { gain: 0 }), g = new GainNode(ctx, { gain: 0 });
      mod.connect(mg).connect(car.frequency);
      mg.gain.setValueAtTime(f * 1.2, t);
      mg.gain.setTargetAtTime(f * 0.1, t, 0.12);
      car.connect(g).connect(arp);
      perc(g.gain, t, vel * 0.05, 0.004, 0.4);
      for (const o of [car, mod]) { o.start(t); o.stop(t + 0.65); }
    }
    function play(st, t) {
      const bs = st % 16, bar = Math.floor(st / 16);
      if (st % 32 === 0) {
        const i = (bar / 2) % 4;
        if (i === 0 && (!prog || cycles++ % 2 === 1)) { prog = pick(SPROGS); if (Math.random() < 0.5) key = pick(SKEYS); }
        ch = chordAt(i);
        pad(ch, t, 32 * S);
      }
      if (!reduced || bs % 2 === 0) bell(t, ch.arp[ARP[st % 8] % ch.arp.length], bs % 4 === 0 ? 1 : 0.6);
      if (bs % 4 === 0) tone(bus, t, 120, 45, 0.45, 0.28, 'sine', 0.07);
      if (bs % 4 === 2) noise(bus, t, [bq(ctx, 'highpass', 7500, 0.7)], 0.05, 0.002, 0.035);
      else if (!reduced && bs % 2 === 1) noise(bus, t, [bq(ctx, 'highpass', 9000, 0.7)], 0.015, 0.002, 0.02);
      if ((bs === 4 || bs === 12) && bar > 1) noise(bus, t, [bq(ctx, 'bandpass', 1400, 0.8)], 0.09, 0.004, 0.12, B.pink);
      if (bs % 4 === 0) tone(low, t, mtof(ch.bass), mtof(ch.bass), 0.2, 0.3, 'triangle');
      else if (bs % 4 === 2) tone(low, t, mtof(ch.bass + 12), mtof(ch.bass + 12), 0.1, 0.18, 'triangle');
    }
    return { S, cycle: 32, bus, fade, play, init() { prog = null; cycles = 0; } };
  }

  function clave() {
    const S = 60 / 176 / 2, { bus, fade } = station(0.65);
    const low = new GainNode(ctx, { gain: 1 });
    chain(low, bq(ctx, 'lowpass', 650, 0.7), bus);
    const keys = new GainNode(ctx, { gain: 1 });
    chain(keys, bq(ctx, 'lowpass', 4200, 0.6), bus);
    const wave = ctx.createPeriodicWave(new Float32Array(6), new Float32Array([0, 1, 0.45, 0.28, 0.12, 0.06]));
    let key = 0, prog = null, cur = null, nxt = null, hit = 0;

    function chordAt(i) {
      const [deg, q] = prog[i], pc = pcOf(deg + key);
      const pcs = new Set(CVOX[q].map((x) => pcOf(pc + x)));
      const tones = [];
      for (let m = 60; m <= 76; m++) if (pcs.has(m % 12)) tones.push(m);
      return { root: 36 + pc, tones };
    }
    function piano(t, m, vel) {
      const o = new OscillatorNode(ctx, { frequency: mtof(m) });
      o.setPeriodicWave(wave);
      const g = new GainNode(ctx, { gain: 0 });
      o.connect(g).connect(keys);
      perc(g.gain, t, vel, 0.003, 0.8);
      o.start(t);
      o.stop(t + 1.3);
    }
    function conga(t, k) {
      const f = k === 'O' ? 150 : 205;
      if (k === 'o' || k === 'O') {
        tone(bus, t, f * 1.25, f, 0.3, 0.32, 'sine', 0.025);
        noise(bus, t, [bq(ctx, 'bandpass', 900, 1)], 0.05, 0.001, 0.02);
      } else if (k === 's') {
        tone(bus, t, f * 1.6, f * 1.3, 0.12, 0.05);
        noise(bus, t, [bq(ctx, 'bandpass', 1800, 1.2)], 0.18, 0.001, 0.06);
      } else tone(bus, t, f * 0.95, f * 0.85, k === 'h' ? 0.08 : 0.06, 0.06);
    }
    function play(u, t) {
      const bu = u % 8, bar = Math.floor(u / 8), cyc = u % 16, h = t + rr(-0.004, 0.006);
      if (bu === 0) {
        if (!prog || bar % 16 === 0) { prog = pick(CPROGS); if (Math.random() < 0.4) key = pick(CKEYS); }
        cur = chordAt(bar % 4);
        nxt = chordAt((bar + 1) % 4);
      }
      if (CLAVE.has(cyc)) {
        tone(bus, t, 1850, 1800, 0.2, 0.045);
        noise(bus, t, [bq(ctx, 'bandpass', 2500, 3)], 0.06, 0.001, 0.015);
      }
      conga(h, CONGA[bu]);
      if (!reduced) tone(bus, h, bu === 4 ? 360 : 480, bu === 4 ? 340 : 460, BONGO[bu] * rr(0.8, 1.1), 0.07);
      if (u === 0) tone(low, t, mtof(cur.root), mtof(cur.root), 0.28, 0.6, 'triangle');
      if (bu === 3) { let f5 = cur.root + 7; if (f5 > 47) f5 -= 12; tone(low, h, mtof(f5), mtof(f5), 0.26, 3 * S * 1.4, 'triangle'); }
      if (bu === 6) tone(low, h, mtof(nxt.root), mtof(nxt.root), 0.28, 5 * S * 1.4, 'triangle');
      if (u >= 16 && MONT[cyc]) {
        const m = cur.tones[MSEQ[hit++ % MSEQ.length] % cur.tones.length];
        const v = (bu % 2 ? 0.05 : 0.06) * rr(0.85, 1.05);
        piano(h, m, v);
        if (!reduced) piano(h + 0.004, m - 12, v * 0.8);
      }
    }
    return { S, cycle: 16, bus, fade, play, init() { prog = null; hit = 0; } };
  }

  const MAKE = [bossa, synth, clave];
  const S = [null, null, null];

  function sweep(t) {
    const up = Math.random() < 0.5, f0 = up ? 350 : 3800, f1 = up ? 3800 : 350;
    const bp = bq(ctx, 'bandpass', f0, 5);
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + SWEEP);
    const s = new AudioBufferSourceNode(ctx, { buffer: B.white }), g = new GainNode(ctx, { gain: 0 });
    chain(s, bp, g, cabIn);
    ramp(g.gain, t, [[0, 0], [0.04, 0.5], [SWEEP - 0.08, 0.35], [SWEEP, 0]]);
    s.start(t, rr(0, 4));
    s.stop(t + SWEEP + 0.05);
    const o = new OscillatorNode(ctx, { frequency: rr(700, 1400) }), og = new GainNode(ctx, { gain: 0 });
    o.frequency.setValueAtTime(o.frequency.value, t);
    o.frequency.exponentialRampToValueAtTime(rr(1800, 3000), t + SWEEP);
    o.connect(og).connect(cabIn);
    ramp(og.gain, t, [[0, 0], [0.05, 0.02], [SWEEP, 0]]);
    o.start(t);
    o.stop(t + SWEEP + 0.05);
  }

  function fadeTo(p, v, t, tc) {
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.setTargetAtTime(v, t, tc);
  }

  function applyOut(tc) {
    const t = ctx.currentTime;
    out.gain.setTargetAtTime(inside ? level * (1 - 0.3 * wind) : 0, t, tc);
    windLp.frequency.setTargetAtTime(6500 - 4000 * wind, t, 0.25);
  }

  function set(i) {
    i = i >= 0 && i < 3 ? i | 0 : -1;
    if (disposed || i === tuned) return tuned;
    const t = ctx.currentTime;
    if (tuned >= 0) fadeTo(S[tuned].fade.gain, 0, t, 0.04);
    tuned = i;
    if (i >= 0) {
      const st = (S[i] ??= MAKE[i]());
      st.init();
      st.step = 0;
      st.next = t + SWEEP - 0.05;
      sweep(t);
      st.fade.gain.cancelScheduledValues(t);
      st.fade.gain.setValueAtTime(0, t);
      st.fade.gain.setTargetAtTime(1, t + SWEEP - 0.1, 0.05);
    }
    return tuned;
  }

  // Schedule the tuned station's notes that start before `until` (ctx seconds).
  function tick(now, until) {
    if (disposed || tuned < 0) return;
    const st = S[tuned];
    if (!inside && now - outAt > 2) { st.next = -1; return; } // silent: stop scheduling
    if (st.next < 0) { st.next = now + 0.1; st.step = 0; st.init(); }
    if (st.next < now - 0.05) { st.next = now + 0.05; st.step = Math.ceil(st.step / st.cycle) * st.cycle; }
    while (st.next < until) { st.play(st.step, st.next); st.step++; st.next += st.S; }
  }

  return {
    tick,
    set,
    next() { return set(tuned >= 2 ? -1 : tuned + 1); },
    get station() { return tuned; },
    get name() { return tuned < 0 ? 'Off' : NAMES[tuned]; },
    get names() { return NAMES.slice(); },
    // true while a station is tuned and audible in the cabin (duck the patio music on this)
    get on() { return tuned >= 0 && inside; },
    // open: convertible roof down / on foot; speed m/s; inside: listener in the car
    setCabin({ open: o = open, speed: v = speed, inside: ins = inside } = {}) {
      open = !!o; speed = v || 0;
      const w = clamp((speed - 5) / 30, 0, 1) * (open ? 1 : 0.3);
      if (!!ins !== inside) {
        inside = !!ins; wind = w;
        if (!inside) outAt = ctx.currentTime;
        applyOut(inside ? 0.2 : 0.45); // ~1.5 s fade out
      } else if (Math.abs(w - wind) > 0.02) { wind = w; applyOut(0.3); }
    },
    setLevel(v) { level = clamp(v, 0, 1); applyOut(0.05); },
    dispose() {
      if (disposed) return;
      disposed = true;
      fadeTo(out.gain, 0, ctx.currentTime, 0.02);
      const done = () => out.disconnect();
      if (typeof setTimeout === 'function') setTimeout(done, 200); else done();
    },
  };
}

// Offline render of one station (0..2); measures the radio gain output itself (pre-master).
export async function renderRadioTest(station = 0, seconds = 8, { reduced = false } = {}) {
  const sr = 48000;
  const octx = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
  const env = createEngine(octx);
  const radio = createRadio(env, { reduced, dest: octx.destination });
  radio.set(station);
  radio.tick(0, seconds);
  const buf = await octx.startRendering();
  let peak = 0, sum = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; }
  }
  const rms = Math.sqrt(sum / (buf.length * buf.numberOfChannels));
  const db = (v) => Math.round(20 * Math.log10(v + 1e-12) * 10) / 10;
  return { station: NAMES[station], peak: +peak.toFixed(4), rms: +rms.toFixed(5), peakDb: db(peak), rmsDb: db(rms), clipped: peak >= 0.999 };
}
