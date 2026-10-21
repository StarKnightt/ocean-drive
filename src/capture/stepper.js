// Capture mode (?capture=1): the game advances one exact frame per call instead of on its own
// animation loop, so a recorder can screenshot every frame however long each takes to draw.
// Three clocks are stepped together:
//   - the game: frame(t) with t a fixed 1/fps apart (THREE.Timer turns it into the dt)
//   - CSS transitions and keyframes: every page animation is paused and moved on by 1/fps
//   - the audio: the synth renders into an OfflineAudioContext that is suspended at each
//     frame boundary, so a sound the frame starts is scheduled at exactly that frame's time
// tools/record-demo-day.mjs drives it through window.__capture.
const SR = 48000, QUANTUM = 128;

// frame(t): main.js's frame; audio: createAudio's api (its .offline is the render context);
// director: { start(), update?, done }; fps: frames per second
export function createStepper({ frame, audio, director, fps = 60 }) {
  const ms = 1000 / fps;
  const t0 = performance.now();
  let k = 0, startK = 0, rendering = null;
  const anims = new WeakMap();

  // every animation on the page: a new one starts paused at its first frame, the rest move on
  function stepAnimations() {
    for (const a of document.getAnimations()) {
      if (!anims.has(a)) { a.pause(); a.currentTime = 0; anims.set(a, 0); continue; }
      const t = anims.get(a) + ms;
      anims.set(a, t);
      const end = a.effect?.getComputedTiming?.().endTime ?? 0;
      if (Number.isFinite(end) && t >= end) a.finish(); else a.currentTime = t;
    }
  }
  // the audio render pauses at frame k's time (on a render-quantum boundary)
  const at = (i) => (Math.floor((i * SR) / fps / QUANTUM) * QUANTUM) / SR;

  async function step() {
    k++;
    const off = audio.offline;
    if (off) {
      const reached = off.ctx.suspend(at(k));
      if (!rendering) rendering = off.ctx.startRendering(); else off.ctx.resume();
      await reached;
    }
    frame(t0 + k * ms);
    off?.tick();
    stepAnimations();
    return k;
  }

  return {
    get frame() { return k; },
    get done() { return !!director?.done; },
    step,
    // n frames that are not recorded (the world settles: shadows, level of detail, the crowd)
    async prime(n) { for (let i = 0; i < n; i++) await step(); },
    // the recording starts here: the director's clock starts and the audio is kept from here on
    begin() { startK = k; director?.start(); },
    // after the last recorded frame: finish the render, return the recorded span as a 16-bit
    // stereo WAV in base64 chunks (fetched one by one: a whole file is too big for one message)
    async finishAudio(chunkBytes = 4 << 20) {
      const off = audio.offline;
      if (!off) return null;
      off.ctx.resume();
      const buf = await rendering;
      const s0 = Math.round((startK * SR) / fps), s1 = Math.min(buf.length, Math.round((k * SR) / fps));
      const n = Math.max(0, s1 - s0), L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
      const bytes = new Uint8Array(44 + n * 4), dv = new DataView(bytes.buffer);
      const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
      str(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, SR, true);
      dv.setUint32(28, SR * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * 4, true);
      const q = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
      for (let i = 0; i < n; i++) { dv.setInt16(44 + i * 4, q(L[s0 + i]), true); dv.setInt16(46 + i * 4, q(R[s0 + i]), true); }
      const chunks = [];
      for (let o = 0; o < bytes.length; o += chunkBytes) {
        let s = '';
        const part = bytes.subarray(o, o + chunkBytes);
        for (let i = 0; i < part.length; i += 0x8000) s += String.fromCharCode(...part.subarray(i, i + 0x8000));
        chunks.push(btoa(s));
      }
      this.wav = chunks;
      return chunks.length;
    },
    wav: null,
  };
}
