// GPU frame time via EXT_disjoint_timer_query_webgl2: one TIME_ELAPSED query around each
// frame's draw calls, read back a few frames later without stalling. Returns null when
// the extension is missing (the CPU-time dynamic resolution still applies).
export function createGpuTimer(gl) {
  const ext = gl.getExtension?.('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;
  const free = [], pending = [];
  let active = null;
  return {
    // tag: caller's frame number, handed back with the result
    begin(tag) {
      if (active || pending.length > 6) return;   // results lagging: skip this frame
      const q = free.pop() ?? gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      active = { q, tag };
    },
    end() {
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    // finished timings, oldest first: [{ ms, tag }]; a disjoint event (clock change,
    // context switch) invalidates everything in flight
    poll() {
      const out = [];
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      while (pending.length) {
        const p = pending[0];
        if (!disjoint && !gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break;
        pending.shift();
        if (!disjoint) out.push({ ms: gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6, tag: p.tag });
        free.push(p.q);
      }
      return out;
    },
  };
}
