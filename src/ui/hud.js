// Driving HUD in the loading title card's art-deco manner: a thin double-ruled arc with a
// warm gold sweep for the speed, the numerals in the Didone serif, the unit and the gear in
// small spaced capitals between double rules. Bottom right, shown only while driving (and
// never in ?shot mode). Plus the haze-coloured fade the recovery and the world edge use.
const CSS = `
#drive-hud { position: fixed; right: calc(env(safe-area-inset-right, 0px) + 34px); bottom: calc(env(safe-area-inset-bottom, 0px) + 26px);
  z-index: 4; width: 168px; pointer-events: none; opacity: 0; transform: translateY(6px);
  transition: opacity 0.5s ease, transform 0.5s ease; color: #fff4e6; text-align: center;
  --serif: Didot, 'Bodoni 72', 'Bodoni MT', 'Playfair Display', 'Times New Roman', Georgia, serif;
  --sans: 'Helvetica Neue', 'Segoe UI Light', 'Segoe UI', system-ui, -apple-system, sans-serif;
  filter: drop-shadow(0 1px 6px rgba(30, 18, 12, 0.5)); }
#drive-hud.show { opacity: 1; transform: none; }
#drive-hud svg { display: block; width: 168px; height: 92px; overflow: visible; }
#drive-hud .num { margin-top: -50px; font: 400 44px/1 var(--serif); letter-spacing: 0.04em; font-variant-numeric: lining-nums tabular-nums;
  background: linear-gradient(to bottom, #fffaf1 30%, #f2d3a4 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
#drive-hud .unit { display: flex; align-items: center; justify-content: center; gap: 9px; margin-top: 7px;
  font: 400 9px/1 var(--sans); letter-spacing: 0.42em; text-transform: uppercase; color: rgba(255, 236, 214, 0.78); }
#drive-hud .unit span { padding-left: 0.42em; }
#drive-hud .unit i { width: 22px; height: 3px; border-top: 1px solid currentColor; border-bottom: 1px solid currentColor; opacity: 0.55; box-sizing: border-box; }
#drive-hud .gear { margin-top: 6px; font: italic 400 13px/1 var(--serif); letter-spacing: 0.08em; color: rgba(255, 243, 228, 0.8); }
html.touch #drive-hud { right: auto; left: 50%; bottom: calc(env(safe-area-inset-bottom, 0px) + 12px); margin-left: -84px; transform-origin: 50% 100%; scale: 0.8; }
#drive-fade { position: fixed; inset: 0; z-index: 6; pointer-events: none; opacity: 0; transition: opacity 0.4s ease;
  background: radial-gradient(ellipse at 50% 60%, #f3dcc4 0%, #d9bca6 60%, #b99d8f 100%); }
#drive-fade.on { opacity: 1; }
`;

const R = 70, CX = 84, CY = 82, FROM = -110, TO = 110;   // arc: deg from straight up
const pt = (deg, r) => [CX + r * Math.sin(deg * Math.PI / 180), CY - r * Math.cos(deg * Math.PI / 180)];
const arc = (a, b, r) => { const [x0, y0] = pt(a, r), [x1, y1] = pt(b, r); return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };

export function createHud({ units = 'mph' } = {}) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'drive-hud';
  const ticks = [];
  for (let k = 0; k <= 12; k++) {
    const d = FROM + (TO - FROM) * k / 12, [x0, y0] = pt(d, R + 4), [x1, y1] = pt(d, R + (k % 3 ? 7 : 10));
    ticks.push(`<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}" />`);
  }
  el.innerHTML = `
    <svg viewBox="0 0 168 92" aria-hidden="true">
      <defs><linearGradient id="hud-gold" x1="0" x2="1"><stop offset="0" stop-color="#e9b765" stop-opacity="0.5" /><stop offset="0.6" stop-color="#f6d69a" /><stop offset="1" stop-color="#fff6d8" /></linearGradient></defs>
      <g fill="none" stroke="rgba(255, 236, 214, 0.5)" stroke-width="0.8">
        <path d="${arc(FROM, TO, R)}" /><path d="${arc(FROM, TO, R - 4)}" />
        <g stroke="rgba(255, 236, 214, 0.55)">${ticks.join('')}</g>
      </g>
      <path class="sweep" d="" fill="none" stroke="url(#hud-gold)" stroke-width="2.4" stroke-linecap="round" />
    </svg>
    <div class="num">0</div>
    <div class="unit"><i></i><span>${units === 'kmh' ? 'km/h' : 'mph'}</span><i></i></div>
    <div class="gear"></div>`;
  document.body.appendChild(el);
  const fade = document.createElement('div');
  fade.id = 'drive-fade';
  document.body.appendChild(fade);
  const num = el.querySelector('.num'), gear = el.querySelector('.gear'), sweep = el.querySelector('.sweep');
  const k = units === 'kmh' ? 3.6 : 2.237, full = units === 'kmh' ? 200 : 120;
  let shown = false, lastN = -1, lastG = '', lastA = -1;
  return {
    el,
    // v: the ridden vehicle (null hides the HUD)
    update(v, on = true) {
      const show = !!v && on;
      if (show !== shown) { shown = show; el.classList.toggle('show', show); }
      if (!show) return;
      const n = Math.round(Math.abs(v.lon) * k);
      if (n !== lastN) { lastN = n; num.textContent = String(n); }
      const a = Math.round(Math.min(1, n / full) * 200) / 200;
      if (a !== lastA) { lastA = a; sweep.setAttribute('d', a > 0.004 ? arc(FROM, FROM + (TO - FROM) * a, R - 2) : ''); }
      const g = !v.engineOn ? (v.stalled ? 'stalled' : 'off') : v.reverse || v.lon < -0.3 ? 'R' : Math.abs(v.lon) < 0.3 && v.throttle <= 0.05 ? 'N' : v.kind === 'car' ? `D${v.gear}` : 'D';
      if (g !== lastG) { lastG = g; gear.textContent = g; }
    },
    get visible() { return shown; },
    // fade to the morning haze and back: fn runs at the full cover
    fadeThrough(fn, hold = 0.4) {
      fade.classList.add('on');
      setTimeout(() => { fn(); setTimeout(() => fade.classList.remove('on'), 120); }, hold * 1000);
    },
    get fading() { return fade.classList.contains('on'); },
  };
}
