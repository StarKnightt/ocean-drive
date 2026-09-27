// Quality tier, decided once at startup before anything is built.
//   high   - desktop / discrete GPU: the reference look
//   medium - integrated GPUs, laptops, tablets
//   low    - phones and software renderers
// Override with ?quality=low|medium|high. ?shot mode always uses 'high' (screenshot harness).
const params = new URLSearchParams(location.search);

function probeGpu() {
  const out = { maxTex: 4096, renderer: '' };
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return out;
    out.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    out.renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* keep defaults */ }
  return out;
}

export const IS_TOUCH = matchMedia('(pointer: coarse)').matches ||
  (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);

function detect() {
  const gpu = probeGpu();
  const r = gpu.renderer;
  const ua = navigator.userAgent;
  const cores = navigator.hardwareConcurrency ?? 8;
  const mem = navigator.deviceMemory ?? 8;
  const minSide = Math.min(screen.width, screen.height);
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const phone = !iPad && (/iPhone|iPod|Android.*Mobile|Mobile.*Firefox|IEMobile|Opera Mini/i.test(ua) || (IS_TOUCH && minSide < 600));
  const tablet = !phone && (iPad || /Android|Tablet/i.test(ua) || IS_TOUCH);
  const software = /SwiftShader|llvmpipe|softpipe|Microsoft Basic Render/i.test(r);
  const discrete = /NVIDIA|GeForce|Quadro|RTX|GTX|Radeon RX|Radeon Pro|Radeon \(TM\) RX|FirePro|Arc\(TM\) A|Intel.*Arc/i.test(r);
  const integrated = /Intel|UHD|Iris|Apple|Adreno|Mali|PowerVR|Radeon\(TM\) Graphics|Radeon Graphics|Vega \d+ Graphics/i.test(r);
  let tier;
  if (phone || software) tier = 'low';
  else if (tablet) tier = 'medium';
  else if (discrete) tier = 'high';
  else if (integrated) tier = 'medium';
  else tier = cores >= 8 && mem >= 8 && gpu.maxTex >= 16384 ? 'high' : 'medium';
  // a desktop with a strong GPU but a tiny CPU / little memory still builds fine at 'high';
  // anything that can't hold the big shadow map drops a tier
  if (tier === 'high' && gpu.maxTex < 8192) tier = 'medium';
  return { tier, gpu, why: { phone, tablet, software, discrete, integrated, cores, mem, minSide, dpr: devicePixelRatio } };
}

// maxPixels caps the rendered pixel count (not just the DPR): a 4K / high-DPI screen at the
// 'high' DPR cap was ~8 MP per frame with MSAA half-float targets, enough to push a single
// GPU frame past the Windows driver timeout. shadowFilter 'lite' = 20 blocker + 25 PCF
// samples per pixel; 'full' = 54 + 64 (?ultra only).
const TIERS = {
  high: {
    maxDpr: 1.5, maxPixels: 2.1e6, renderScale: 1, msaa: 4, fxaa: false, bloom: true,
    shadowMap: [4096, 1024], shadowTaps: 5, shadowFilter: 'lite', cloudOctaves: 5,
    oceanGrid: { rings: 400, segs: 320 }, sandRows: 440, sandDetail: 1024, printFade: [35, 60],
    wrack: 9000, farFoliage: 1, signAtlas: 1, hotelFar: Infinity, shadowStep: 0.5, audioVoices: 'full',
  },
  medium: {
    maxDpr: 1.25, maxPixels: 1.3e6, renderScale: 1, msaa: 2, fxaa: false, bloom: true,
    shadowMap: [4096, 1024], shadowTaps: 5, shadowFilter: 'lite', cloudOctaves: 4,
    oceanGrid: { rings: 300, segs: 256 }, sandRows: 360, sandDetail: 1024, printFade: [26, 45],
    wrack: 6000, farFoliage: 0.75, signAtlas: 1, hotelFar: Infinity, shadowStep: 1, audioVoices: 'full',
  },
  low: {
    maxDpr: 1, maxPixels: 0.8e6, renderScale: 0.85, msaa: 0, fxaa: true, bloom: false,
    shadowMap: [2048, 1024], shadowTaps: 4, shadowFilter: 'lite', cloudOctaves: 3,
    oceanGrid: { rings: 220, segs: 176 }, sandRows: 260, sandDetail: 512, printFade: [16, 28],
    wrack: 3000, farFoliage: 0.5, signAtlas: 0.5, hotelFar: 560, shadowStep: 2.5, audioVoices: 'reduced',
  },
};

const d = detect();
const forced = params.get('shot') === '1' ? 'high' : params.get('quality');
const tier = TIERS[forced] ? forced : d.tier;

export const QUALITY = { tier, detected: d.tier, gpu: d.gpu, why: d.why, ...TIERS[tier] };
// ?ultra: the original 'high' look (8192 sun map, full contact-hardening filter), for
// strong desktop GPUs; the pixel budget still applies
if (tier === 'high' && params.has('ultra') && !params.has('lowshadow') && d.gpu.maxTex >= 8192) {
  Object.assign(QUALITY, { shadowMap: [8192, 2048], shadowTaps: 8, shadowFilter: 'full' });
}
window.__quality = QUALITY;
