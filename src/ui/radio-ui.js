// The car radio's dial card, in the HUD's art-deco manner: a transparent caption top centre
// between gold hairline rules, the station name in the Didone italic between double rules,
// "RADIO" in spaced gold capitals over it
// and three lozenges for the band (the tuned one lit gold). It shows for a few seconds on each
// change (Q, or the touch radio button) and fades; "Off" says so once, then goes.
const CSS = `
#radio-card { position: fixed; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 26px); transform: translate(-50%, -6px); z-index: 4;
  pointer-events: none; opacity: 0; transition: opacity 0.45s ease, transform 0.45s ease; text-align: center; color: #fff4e6;
  padding: 10px 30px 11px; background: none;
  --serif: Didot, 'Bodoni 72', 'Bodoni MT', 'Playfair Display', 'Times New Roman', Georgia, serif;
  --sans: 'Helvetica Neue', 'Segoe UI Light', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --gold: rgba(246, 214, 154, 0.92);
  filter: drop-shadow(0 1px 3px rgba(30, 18, 12, 0.75)) drop-shadow(0 0 12px rgba(30, 18, 12, 0.35)); }
#radio-card::before, #radio-card::after { content: ''; position: absolute; left: 0; right: 0; height: 3px; box-sizing: border-box;
  border-top: 1px solid var(--gold); border-bottom: 0.5px solid rgba(246, 214, 154, 0.55);
  -webkit-mask: linear-gradient(to right, transparent, #000 18%, #000 82%, transparent); mask: linear-gradient(to right, transparent, #000 18%, #000 82%, transparent); }
#radio-card::before { top: 0; }
#radio-card::after { bottom: 0; }
#radio-card.show { opacity: 1; transform: translate(-50%, 0); }
#radio-card .band { font: 500 9px/1 var(--sans); letter-spacing: 0.55em; padding-left: 0.55em; text-transform: uppercase; color: var(--gold); }
#radio-card .name { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 8px;
  font: italic 400 27px/1 var(--serif); letter-spacing: 0.05em; white-space: nowrap;
  background: linear-gradient(to bottom, #fffaf1 35%, #f2d3a4 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
#radio-card .name i { flex: none; width: 30px; height: 3px; border-top: 1px solid var(--gold); border-bottom: 1px solid var(--gold); box-sizing: border-box; }
#radio-card .dots { display: flex; justify-content: center; gap: 10px; margin-top: 9px; }
#radio-card .dots b { width: 5px; height: 5px; transform: rotate(45deg); border: 1px solid var(--gold); }
#radio-card .dots b.on { background: #f6d69a; border-color: #fff6d8; box-shadow: 0 0 6px rgba(246, 214, 154, 0.8); }
html.touch #radio-card { scale: 0.85; transform-origin: 50% 0; }
`;

export function createRadioUi({ shot = false } = {}) {
  if (shot || typeof document === 'undefined') return { show() {}, get text() { return ''; } };
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'radio-card';
  el.innerHTML = '<div class="band">Radio</div><div class="name"><i></i><span></span><i></i></div><div class="dots"><b></b><b></b><b></b></div>';
  document.body.appendChild(el);
  const name = el.querySelector('.name span'), dots = [...el.querySelectorAll('.dots b')];
  let timer = null;
  return {
    el,
    // i: -1 off, 0..2 the station
    show(label, i) {
      name.textContent = label;
      dots.forEach((d, k) => d.classList.toggle('on', k === i));
      el.classList.add('show');
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove('show'), i < 0 ? 1400 : 3000);
    },
    get text() { return name.textContent; },
    get visible() { return el.classList.contains('show'); },
  };
}
