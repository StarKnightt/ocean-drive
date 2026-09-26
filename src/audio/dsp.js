// Procedural DSP building blocks. Every sound in the project is generated here in code:
// noise / crackle / control-signal buffers, a synthetic reverb impulse, Karplus-Strong plucks.

export const rr = (a, b) => a + Math.random() * (b - a);
export const pick = (a) => a[(Math.random() * a.length) | 0];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export const bq = (ctx, type, frequency, Q = 0.707, gain = 0) =>
  new BiquadFilterNode(ctx, { type, frequency, Q, gain });

export function chain(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

// Linear breakpoints relative to t0: [[dt, value], ...].
export function ramp(param, t0, pts) {
  param.setValueAtTime(pts[0][1], t0 + pts[0][0]);
  for (let i = 1; i < pts.length; i++) param.linearRampToValueAtTime(pts[i][1], t0 + pts[i][0]);
}

// Percussive envelope: linear attack, exponential decay (≈ -35 dB after `d` seconds).
export function perc(param, t, peak, a, d) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(0, t + a, d / 4);
}

export function loopSrc(ctx, buffer, { rate = 1, at, offset } = {}) {
  const s = new AudioBufferSourceNode(ctx, { buffer, loop: true, playbackRate: rate });
  s.start(at ?? ctx.currentTime, offset ?? Math.random() * buffer.duration);
  return s;
}

const CTRL_RATE = 8000;

// Looping buffer; the tail is crossfaded into the head so the loop point is inaudible.
function loopBuffer(ctx, seconds, fill, { rate = ctx.sampleRate, normalize = true, linear = false } = {}) {
  const len = Math.floor(seconds * rate);
  const fade = Math.floor(Math.min(0.3, seconds * 0.1) * rate);
  const tmp = new Float32Array(len + fade);
  fill(tmp, len);
  for (let i = 0; i < fade; i++) {
    const w = i / fade;
    const a = linear ? w : Math.sin(w * Math.PI * 0.5);
    const b = linear ? 1 - w : Math.cos(w * Math.PI * 0.5);
    tmp[i] = tmp[i] * a + tmp[len + i] * b;
  }
  const data = tmp.subarray(0, len);
  if (normalize) {
    let pk = 1e-9;
    for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(data[i]));
    const k = 0.95 / pk;
    for (let i = 0; i < len; i++) data[i] *= k;
  }
  const buf = ctx.createBuffer(1, len, rate);
  buf.copyToChannel(data, 0);
  return buf;
}

const white = (d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; };

function pink(d) { // Paul Kellet's refined pink filter
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
}

function brown(d) {
  let l = 0;
  for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l; }
}

// Sparse random grains (gravel, foam fizz, sand crunch).
const crackle = (density) => (d) => {
  let y = 0;
  for (let i = 0; i < d.length; i++) {
    const x = Math.random() < density ? (Math.random() * 2 - 1) * (0.15 + 0.85 * Math.random() ** 2) : 0;
    y = x + 0.45 * y;
    d[i] = y;
  }
};

// Smooth random control signal in [0,1] (periodic over the loop), `pps` = variation points/sec.
const control = (pps, octaves, pow) => (d, len) => {
  const tot = d.length;
  const acc = new Float32Array(tot);
  for (let o = 0; o < octaves; o++) {
    const n = Math.max(2, Math.round((len / CTRL_RATE) * pps * 2 ** o));
    const pts = Array.from({ length: n }, Math.random);
    const amp = 0.55 ** o;
    for (let i = 0; i < tot; i++) {
      const p = ((i % len) / len) * n;
      const k = Math.floor(p), f = p - k;
      const s = (1 - Math.cos(f * Math.PI)) / 2;
      acc[i] += (pts[k % n] * (1 - s) + pts[(k + 1) % n] * s) * amp;
    }
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < tot; i++) { lo = Math.min(lo, acc[i]); hi = Math.max(hi, acc[i]); }
  for (let i = 0; i < tot; i++) d[i] = Math.pow((acc[i] - lo) / (hi - lo || 1), pow);
};

export function makeBuffers(ctx) {
  const ctl = { rate: CTRL_RATE, normalize: false, linear: true };
  return {
    white: loopBuffer(ctx, 6, white),
    pink: loopBuffer(ctx, 7, pink),
    brown: loopBuffer(ctx, 8, brown),
    crackle: loopBuffer(ctx, 5, crackle(0.0025)),
    crackleDense: loopBuffer(ctx, 4, crackle(0.02)),
    gust: loopBuffer(ctx, 71, control(0.09, 3, 1.6), ctl),
    flutter: loopBuffer(ctx, 23, control(9, 2, 1), ctl),
    swell: loopBuffer(ctx, 53, control(0.12, 2, 1.2), ctl),
  };
}

// Synthetic stereo room/outdoor impulse: early reflections + decaying noise that darkens over time.
export function makeImpulse(ctx, seconds = 2.4, rt60 = 2.0) {
  const sr = ctx.sampleRate, len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(0.012 * sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp((-6.91 * t) / rt60) * Math.min(1, t / 0.006);
      const a = 0.8 - 0.72 * Math.min(1, t / seconds);
      lp += a * ((Math.random() * 2 - 1) * env - lp);
      d[i] = lp;
    }
    for (let k = 0; k < 12; k++) {
      const tt = 0.006 + Math.random() * 0.07;
      const i0 = pre + Math.floor(tt * sr);
      const amp = (0.6 * (1 - tt / 0.08)) * (Math.random() < 0.5 ? -1 : 1);
      for (let j = 0; j < 24 && i0 + j < len; j++) d[i0 + j] += amp * Math.exp(-j / 5) * (Math.random() * 0.6 + 0.4);
    }
  }
  return buf;
}

// Karplus-Strong plucked string with allpass fine tuning, pluck-position comb and lowpassed excitation.
export function renderPluck(sr, freq, { seconds = 1.6, bright = 0.45, pos = 0.18, t60 = 2 } = {}) {
  const len = Math.floor(seconds * sr);
  const out = new Float32Array(len);
  const L = sr / freq - 0.5;
  const N = Math.max(2, Math.floor(L));
  const frac = L - N;
  const C = (1 - frac) / (1 + frac);
  const exc = new Float32Array(N);
  let lp = 0;
  const a = 0.12 + 0.7 * bright;
  for (let i = 0; i < N; i++) { lp += a * (Math.random() * 2 - 1 - lp); exc[i] = lp; }
  const P = Math.max(1, Math.round(pos * N));
  const buf = new Float32Array(N);
  let mean = 0;
  for (let i = 0; i < N; i++) { buf[i] = exc[i] - exc[(i - P + N) % N]; mean += buf[i]; }
  mean /= N;
  let pk = 1e-9;
  for (let i = 0; i < N; i++) { buf[i] -= mean; pk = Math.max(pk, Math.abs(buf[i])); }
  for (let i = 0; i < N; i++) buf[i] /= pk;
  const rho = Math.pow(0.001, 1 / (freq * t60));
  let idx = 0, last = 0, apx = 0, apy = 0;
  for (let i = 0; i < len; i++) {
    const s = buf[idx];
    out[i] = s;
    const avg = rho * 0.5 * (s + last);
    last = s;
    const ap = C * avg + apx - C * apy;
    apx = avg; apy = ap;
    buf[idx] = ap;
    if (++idx === N) idx = 0;
  }
  const att = Math.floor(0.0015 * sr), rel = Math.floor(0.05 * sr);
  for (let i = 0; i < att; i++) out[i] *= i / att;
  for (let i = 0; i < rel; i++) out[len - 1 - i] *= i / rel;
  return out;
}

export function softClipCurve(n = 2048, knee = 0.85) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, ax = Math.abs(x);
    c[i] = ax < knee ? x : Math.sign(x) * (knee + (1 - knee) * Math.tanh((ax - knee) / (1 - knee)));
  }
  return c;
}
