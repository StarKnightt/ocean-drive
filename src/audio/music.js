// Original, procedurally generated bossa/lounge loop played on a hotel patio.
// Harmony: a Markov chain over jazz chord functions builds 8-bar phrases (always ending on
// a ii–V-type cadence), arranged A A B A and regenerated each chorus. Instruments:
// Karplus-Strong nylon guitar (syncopated pinched chords + thumb bass on 1 and 3), a soft
// sine sub-bass, a brushed shaker and brush swishes, and a sparse FM electric-piano melody
// improvised from chord tones. The patio speaker is band-limited, then distance-lowpassed
// and sent to the reverb so it drifts in softly from afar.
import { rr, pick, mtof, bq, chain, perc, renderPluck } from './dsp.js';
import { createSpatial } from './spatial.js';

const BPM = 118;
const S16 = 60 / BPM / 4;

const VOICING = {
  maj9: [4, 11, 14, 19], '69': [4, 9, 14, 19], m9: [10, 15, 19, 26], dom13: [10, 16, 21, 26],
  dom9: [4, 10, 14, 19], '7b9': [4, 10, 13, 19], '7b13': [10, 16, 20], '7s11': [10, 16, 18, 21],
  m7b5: [10, 15, 18], maj7s11: [11, 16, 18],
};
const CHORDS = {
  I: [0, 'maj9'], I6: [0, '69'], ii: [2, 'm9'], iii: [4, 'm9'], IV: [5, 'maj7s11'], iv: [5, 'm9'],
  V: [7, 'dom13'], Valt: [7, '7b9'], vi: [9, 'm9'], VI7: [9, '7b13'], II7: [2, 'dom9'],
  bII7: [1, '7s11'], bVII7: [10, 'dom13'], vii: [11, 'm7b5'], III7: [4, '7b9'],
};
const NEXT = {
  I: ['vi', 'ii', 'iii', 'IV', 'II7', 'I6'], I6: ['vi', 'ii', 'IV', 'iii'],
  vi: ['ii', 'II7', 'IV', 'vii'], ii: ['V', 'Valt', 'bII7'], V: ['I', 'I6', 'vi'], Valt: ['I', 'I6', 'vi'],
  bII7: ['I', 'I6'], iii: ['VI7', 'vi'], VI7: ['ii', 'II7'], IV: ['iv', 'V', 'iii', 'bVII7'],
  iv: ['I', 'bVII7', 'I6'], bVII7: ['I', 'I6'], II7: ['ii', 'V'], vii: ['III7'], III7: ['vi'],
};
const KEYS = [0, 5, -2, 3, -4, 2];
const GUITAR_HITS = new Set([0, 6, 12, 20, 26]); // 16th positions within a 2-bar cycle
const MOTIFS = [[0, 3, 6], [2, 4, 6, 7], [0, 2, 3, 6], [3, 4, 6], [1, 3, 4, 6, 7], [0, 1.5, 3]];
const PENTA = [0, 2, 4, 7, 9];

function genPhrase() {
  const p = ['I'];
  while (p.length < 6) p.push(pick(NEXT[p[p.length - 1]]));
  p.push('ii', pick(['V', 'Valt', 'bII7']));
  return p;
}

export function createMusic(env, { x = -29, y = 1.6, z = -10 } = {}) {
  const { ctx, B } = env;
  const sp = createSpatial(env, {
    x, y, z, ref: 3.5, rolloff: 1.1, airScale: 25, occl: { f: 14000, d: 7 }, wet: 0.45, wetFall: 25,
  });
  const bus = new GainNode(ctx, { gain: 0.5 });
  chain(bus, bq(ctx, 'highpass', 75, 0.7), bq(ctx, 'lowpass', 9000, 0.7), sp.input);
  const gtr = new GainNode(ctx, { gain: 1 });
  chain(gtr, bq(ctx, 'peaking', 105, 1.2, 4), bq(ctx, 'peaking', 230, 1.5, 2.5), bq(ctx, 'lowpass', 4200, 0.6), bus);
  const ep = new GainNode(ctx, { gain: 0.11 });
  chain(ep, bq(ctx, 'lowpass', 2800, 0.6), bus);

  const plucks = new Map();
  function pluckBuf(midi) {
    const key = `${midi}:${(Math.random() * 3) | 0}`;
    let b = plucks.get(key);
    if (!b) {
      const low = midi < 52, f = mtof(midi);
      const data = renderPluck(ctx.sampleRate, f, {
        seconds: low ? 2.2 : 1.6, bright: low ? 0.25 : rr(0.35, 0.5), pos: rr(0.1, 0.2),
        t60: (low ? 3.2 : 2.2) * Math.pow(196 / f, 0.3),
      });
      b = ctx.createBuffer(1, data.length, ctx.sampleRate);
      b.copyToChannel(data, 0);
      plucks.set(key, b);
    }
    return b;
  }

  let key = pick(KEYS), form = [], step = 0, nextTime = -1, anticip = false, prevMel = 72;
  let cur = null, nxt = null;

  function newForm() {
    const A = genPhrase(), Bp = genPhrase();
    form = [...A, ...A, ...Bp, ...A];
    if (Math.random() < 0.35) key = pick(KEYS);
  }

  function voicing(name) {
    const [deg, q] = CHORDS[name];
    const pc = (((deg + key) % 12) + 12) % 12;
    const root = 40 + ((pc - 4 + 12) % 12); // E2..Eb3
    let up = VOICING[q].map((i) => root + i);
    const mean = () => up.reduce((a, b) => a + b, 0) / up.length;
    while (mean() < 57) up = up.map((m) => m + 12);
    while (mean() > 68) up = up.map((m) => m - 12);
    return { root, up, tones: new Set([root, ...up].map((m) => m % 12)) };
  }

  function pluck(midi, t, vel, hold, dest = gtr, tc = 0.07) {
    const src = new AudioBufferSourceNode(ctx, { buffer: pluckBuf(midi) });
    const g = new GainNode(ctx, { gain: vel });
    src.connect(g).connect(dest);
    g.gain.setValueAtTime(vel, t);
    g.gain.setTargetAtTime(0, t + hold, tc);
    src.start(t);
    src.stop(t + hold + tc * 8);
  }

  function strum(ch, t, vel) {
    const hold = rr(0.26, 0.4);
    let tt = t;
    for (const m of ch.up) { pluck(m, tt, vel * rr(0.8, 1) * 0.2, hold); tt += rr(0.004, 0.012); }
  }

  function bass(midi, t, vel, hold) {
    pluck(midi, t, vel * 0.3, hold, gtr, 0.12);
    const o = new OscillatorNode(ctx, { frequency: mtof(midi) });
    const g = new GainNode(ctx, { gain: 0 });
    o.connect(g).connect(bus);
    perc(g.gain, t, vel * 0.1, 0.01, hold + 0.25);
    o.start(t);
    o.stop(t + hold + 0.4);
  }

  function noiseHit(buf, t, filters, peak, a, d) {
    const s = new AudioBufferSourceNode(ctx, { buffer: buf });
    const g = new GainNode(ctx, { gain: 0 });
    chain(s, ...filters, g, bus);
    perc(g.gain, t, peak, a, d);
    s.start(t, Math.random() * (buf.duration - 1));
    s.stop(t + a + d * 1.5);
  }
  const shaker = (t, a) => noiseHit(B.white, t,
    [bq(ctx, 'highpass', 5000, 0.7), bq(ctx, 'bandpass', 9000, 0.7)], a * 0.07, rr(0.008, 0.02), 0.06);
  const brush = (t, a) => noiseHit(B.pink, t, [bq(ctx, 'bandpass', 2500, 0.5)], a * 0.06, 0.03, 0.22);

  function epiano(t, midi, dur, vel) {
    const f = mtof(midi);
    const car = new OscillatorNode(ctx, { frequency: f });
    const mod = new OscillatorNode(ctx, { frequency: f });
    const mg = new GainNode(ctx, { gain: 0 });
    mod.connect(mg).connect(car.frequency);
    mg.gain.setValueAtTime(f * 1.6, t);
    mg.gain.setTargetAtTime(f * 0.25, t, 0.25);
    const tine = new OscillatorNode(ctx, { frequency: f * 7 });
    const tg = new GainNode(ctx, { gain: 0 });
    tine.connect(tg).connect(car.frequency);
    tg.gain.setValueAtTime(f * 0.8, t);
    tg.gain.setTargetAtTime(0, t, 0.02);
    const g = new GainNode(ctx, { gain: 0 });
    car.connect(g).connect(ep);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.003);
    g.gain.setTargetAtTime(vel * 0.3, t + 0.003, 0.6);
    g.gain.setTargetAtTime(0, t + dur, 0.15);
    for (const o of [car, mod, tine]) { o.start(t); o.stop(t + dur + 1); }
  }

  function melody(t, ch) {
    const pool = [];
    for (let m = 65; m <= 81; m++) {
      const pc = m % 12;
      if (ch.tones.has(pc) || (PENTA.includes((((pc - key) % 12) + 12) % 12) && Math.random() < 0.3)) pool.push(m);
    }
    if (!pool.length) return;
    const motif = pick(MOTIFS);
    const times = motif.map((p) => t + p * 2 * S16);
    let m = prevMel;
    times.forEach((tt, i) => {
      const near = pool.filter((n) => n !== m && Math.abs(n - m) <= 4);
      m = near.length ? pick(near) : pool.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));
      const dur = i < times.length - 1 ? times[i + 1] - tt : rr(0.6, 1.0);
      epiano(tt + rr(-0.006, 0.01), m, dur, rr(0.5, 0.8));
    });
    prevMel = m;
  }

  function play(st, t) {
    const bs = st % 16, bar = Math.floor(st / 16);
    if (bs === 0) {
      if (!form.length || bar % form.length === 0) newForm();
      cur = voicing(form[bar % form.length]);
      nxt = voicing(form[(bar + 1) % form.length]);
      if (bar % form.length > 1 && Math.random() < 0.35) melody(t, cur);
    }
    const h = t + rr(-0.004, 0.006);
    const cyc = (bar % 2) * 16 + bs;
    if (bs === 0) {
      const skip = anticip;
      anticip = false;
      if (!skip) strum(cur, h, rr(0.6, 0.75));
    } else if (bs === 14 && Math.random() < 0.28) {
      strum(nxt, h, rr(0.5, 0.65));
      anticip = true;
    } else if (GUITAR_HITS.has(cyc) && Math.random() > 0.08) {
      strum(cur, h, rr(0.45, 0.65));
    }
    if (bs === 0) bass(cur.root, h, 0.95, 0.9);
    if (bs === 8) { let f5 = cur.root + 7; if (f5 > 52) f5 -= 12; bass(f5, h, 0.8, 0.8); }
    if (bs === 6 && Math.random() < 0.25) bass(cur.root, h, 0.35, 0.2);
    shaker(h, [0.55, 0.22, 0.8, 0.3][bs % 4] * rr(0.8, 1.1));
    if (bs === 4 || bs === 12) brush(h, rr(0.7, 1));
  }

  // Schedule everything that starts before `until` (seconds of ctx time).
  function tick(now, until) {
    if (nextTime < 0) { nextTime = now + 0.1; step = 0; }
    if (nextTime < now - 0.05) { nextTime = now + 0.05; step = Math.ceil(step / 16) * 16; }
    while (nextTime < until) { play(step, nextTime); step++; nextTime += S16; }
  }

  return { tick, spatial: sp };
}
