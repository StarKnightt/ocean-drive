// Minimap, bottom left, in the HUD's art-deco manner: a 150 px circle under a thin double gold
// ring with small spaced capitals for the compass point. The map itself is drawn once from
// the layout (the drive and its cross streets, the sidewalks, the hotel row, the park and its
// promenade, the sand, the sea) into a canvas once; it is moved and turned under the disc by
// a CSS transform (the compositor's work, no per-frame drawing), with the markers: you (a gold
// chevron) and the saved car (a small ivory lozenge, pinned to the rim when off the map). Heading up by default; N hides / shows it,
// Shift+N switches heading up / north up. Never in ?shot mode.
import { HOTEL, SIDEWALK_W, SIDEWALK_E, LANES, PARKING, PARK, SAND, OCEAN, CROSS, CROSS_STREETS, TOWERS } from '../world/layout.js';
import { promenadeX } from '../world/crowd.js';

const CSS = `
#minimap { position: fixed; left: calc(env(safe-area-inset-left, 0px) + 36px); bottom: calc(env(safe-area-inset-bottom, 0px) + 32px);
  z-index: 4; width: 150px; height: 150px; pointer-events: none; opacity: 0; transition: opacity 0.6s ease; }
#minimap.show { opacity: 1; }
#minimap .disc { position: absolute; inset: 3px; border-radius: 50%; overflow: hidden; background: rgba(40, 30, 28, 0.35);
  box-shadow: 0 0 0 1px rgba(24, 14, 8, 0.7), 0 2px 14px rgba(20, 12, 8, 0.55); transform: translateZ(0); }
#minimap .map { position: absolute; left: -3px; top: -3px; transform-origin: 0 0; will-change: transform; }
#minimap .map canvas { display: block; }
#minimap .saved { position: absolute; left: -3px; top: -3px; width: 6px; height: 6px; background: rgba(255, 246, 228, 0.95); border: 1px solid rgba(120, 72, 40, 0.8); will-change: transform; }
#minimap svg { position: absolute; inset: 0; width: 150px; height: 150px; overflow: visible; }
#minimap .compass { will-change: transform; }
#minimap .compass text { font: italic 600 13px Didot, 'Bodoni 72', 'Bodoni MT', 'Playfair Display', Georgia, serif; fill: #fff4e6; }
#minimap .compass .badge { fill: rgba(36, 22, 14, 0.82); stroke: rgba(246, 214, 154, 0.95); stroke-width: 1; }
#minimap .you { inset: auto; left: 50%; top: 50%; width: 24px; height: 24px; transform: translate(-50%, -50%); filter: drop-shadow(0 0 2px rgba(20, 12, 8, 0.8)); }
html.touch #minimap { left: calc(env(safe-area-inset-left, 0px) + 12px); top: calc(env(safe-area-inset-top, 0px) + 12px); bottom: auto; scale: 0.72; transform-origin: 0 0; }
`;
const SIZE = 150, PX = 1.6;            // css px; map pixels per metre (offscreen)
const VIEW = 0.62;                     // css px per metre on the minimap (~120 m across)
const MAP = { x0: -110, x1: 125, z0: -600, z1: 600 };

function drawStatic(footprints) {
  const W = Math.ceil((MAP.x1 - MAP.x0) * PX), H = Math.ceil((MAP.z1 - MAP.z0) * PX);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!g?.fillRect) return c;
  const X = (x) => (x - MAP.x0) * PX, Z = (z) => (z - MAP.z0) * PX;
  const rect = (x0, x1, z0, z1, col) => { g.fillStyle = col; g.fillRect(X(x0), Z(z0), (x1 - x0) * PX, (z1 - z0) * PX); };
  // the town behind the hotels, the hotel row, patios
  rect(MAP.x0, HOTEL.frontX, MAP.z0, MAP.z1, 'rgba(146, 116, 108, 0.62)');
  for (const f of footprints) rect(Math.max(MAP.x0, -80), f.fx, f.z0, f.z1, 'rgba(238, 174, 156, 0.88)');
  // sidewalks, parking lanes and the drive
  rect(SIDEWALK_W.x0, SIDEWALK_W.x1, MAP.z0, MAP.z1, 'rgba(222, 204, 184, 0.88)');
  rect(SIDEWALK_E.x0, SIDEWALK_E.x1, MAP.z0, MAP.z1, 'rgba(222, 204, 184, 0.88)');
  rect(PARKING.x0, PARKING.x1, MAP.z0, MAP.z1, 'rgba(98, 88, 84, 0.85)');
  rect(LANES.x0, LANES.x1, MAP.z0, MAP.z1, 'rgba(84, 76, 74, 0.9)');
  // cross streets from the west (the near ones and the far grid)
  for (const s of CROSS_STREETS) {
    rect(MAP.x0, SIDEWALK_W.x1, s.z - CROSS.hw - 2, s.z + CROSS.hw + 2, 'rgba(222, 204, 184, 0.88)');
    rect(MAP.x0, LANES.x0, s.z - CROSS.hw, s.z + CROSS.hw, 'rgba(84, 76, 74, 0.9)');
  }
  // the centre line
  g.fillStyle = 'rgba(242, 196, 92, 0.55)';
  g.fillRect(X(LANES.centerX) - 0.5, 0, 1, H);
  // the park, its promenade, the seawall
  rect(PARK.x0, PARK.x1, MAP.z0, MAP.z1, 'rgba(92, 134, 80, 0.8)');
  g.strokeStyle = 'rgba(240, 226, 206, 0.85)';
  g.lineWidth = 2.2 * PX;
  g.beginPath();
  for (let z = MAP.z0; z <= MAP.z1; z += 4) { const x = X(promenadeX(z)); if (z === MAP.z0) g.moveTo(x, Z(z)); else g.lineTo(x, Z(z)); }
  g.stroke();
  // sand, the wet band, the sea
  rect(SAND.x0, OCEAN.x0, MAP.z0, MAP.z1, 'rgba(232, 204, 156, 0.85)');
  rect(OCEAN.x0 - 5, OCEAN.x0, MAP.z0, MAP.z1, 'rgba(210, 190, 160, 0.72)');
  const sea = g.createLinearGradient(X(OCEAN.x0), 0, X(MAP.x1), 0);
  sea.addColorStop(0, 'rgba(96, 164, 178, 0.88)');
  sea.addColorStop(1, 'rgba(44, 104, 132, 0.88)');
  g.fillStyle = sea;
  g.fillRect(X(OCEAN.x0), 0, X(MAP.x1) - X(OCEAN.x0), H);
  // the lifeguard towers: small coral squares
  for (const t of TOWERS) rect(t.x - 2, t.x + 2, t.z - 2, t.z + 2, 'rgba(232, 134, 110, 0.85)');
  return c;
}

export function createMinimap({ footprints = [], shot = false, getPose, getSaved = () => null } = {}) {
  if (shot || typeof document === 'undefined') return { update() {}, toggle() {}, get visible() { return false; } };
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'minimap';
  // the map as a composited layer moved by a CSS transform (no per-frame canvas drawing), the
  // compass ticks and north point on a layer turned with it; the chevron and the rings fixed
  const r = SIZE / 2;
  const ticks = [0, 1, 2, 3].map((q) => { const a = q * Math.PI / 2 - Math.PI / 2, c = Math.cos(a), sn = Math.sin(a); return `<line x1="${(r + c * (r - 8)).toFixed(1)}" y1="${(r + sn * (r - 8)).toFixed(1)}" x2="${(r + c * (r - 1)).toFixed(1)}" y2="${(r + sn * (r - 1)).toFixed(1)}" stroke-width="${q ? 0.8 : 1.4}" />`; }).join('');
  el.innerHTML = `
    <div class="disc"><div class="map"></div><i class="saved"></i></div>
    <svg class="compass" viewBox="0 0 ${SIZE} ${SIZE}"><g stroke="rgba(246, 214, 154, 0.9)">${ticks}</g>
      <circle class="badge" cx="${r}" cy="7" r="8.5" /><text x="${r}" y="7.5" text-anchor="middle" dominant-baseline="middle">N</text></svg>
    <svg class="frame" viewBox="0 0 ${SIZE} ${SIZE}"><circle cx="${r}" cy="${r}" r="${r - 0.5}" stroke="rgba(24, 14, 8, 0.55)" stroke-width="1" fill="none" />
      <circle cx="${r}" cy="${r}" r="${r - 2.5}" stroke="rgba(246, 214, 154, 0.85)" stroke-width="1" fill="none" />
      <circle cx="${r}" cy="${r}" r="${r - 5.5}" stroke="rgba(255, 236, 214, 0.5)" stroke-width="0.7" fill="none" /></svg>
    <svg class="you" viewBox="-8 -8 16 16"><defs><linearGradient id="mm-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6d8" /><stop offset="1" stop-color="#e9b765" /></linearGradient></defs>
      <path d="M0 -7 L5.2 5.4 L0 2.4 L-5.2 5.4 Z" fill="url(#mm-gold)" stroke="rgba(36, 20, 10, 0.95)" stroke-width="1.1" stroke-linejoin="round" /></svg>`;
  document.body.appendChild(el);
  const mapEl = el.querySelector('.map'), compass = el.querySelector('.compass'), you = el.querySelector('.you'), savedEl = el.querySelector('.saved');
  const map = drawStatic(footprints);
  map.style.width = `${map.width * VIEW / PX}px`;
  map.style.height = `${map.height * VIEW / PX}px`;
  mapEl.appendChild(map);
  let on = true, northUp = false, frame = 0, last = '';
  el.classList.add('show');

  addEventListener('keydown', (ev) => {
    if (ev.code !== 'KeyN' || ev.repeat) return;
    if (ev.shiftKey) northUp = !northUp;
    else { on = !on; el.classList.toggle('show', on); }
  });

  function draw() {
    const p = getPose();
    if (!p) return;
    const rot = northUp ? 0 : -p.heading, k = VIEW;
    const deg = (rot * 180 / Math.PI).toFixed(1);
    const tx = (-(p.x - MAP.x0) * k).toFixed(1), tz = (-(p.z - MAP.z0) * k).toFixed(1);
    const key = deg + tx + tz;
    if (key !== last) {
      last = key;
      mapEl.style.transform = `translate(${r}px, ${r}px) rotate(${deg}deg) translate(${tx}px, ${tz}px)`;
      compass.style.transform = `rotate(${deg}deg)`;
      you.style.transform = `translate(-50%, -50%) rotate(${northUp ? (p.heading * 180 / Math.PI).toFixed(1) : 0}deg)`;
    }
    // the saved car: an ivory lozenge (on the rim when off the map)
    const s = getSaved();
    savedEl.style.display = s ? 'block' : 'none';
    if (s) {
      const dx = (s.x - p.x) * k, dz = (s.z - p.z) * k, c = Math.cos(rot), sn = Math.sin(rot);
      let sx = dx * c - dz * sn, sy = dx * sn + dz * c;
      const d = Math.hypot(sx, sy), lim = r - 9;
      if (d > lim) { sx *= lim / d; sy *= lim / d; }
      savedEl.style.transform = `translate(${(r + sx).toFixed(1)}px, ${(r + sy).toFixed(1)}px) translate(-50%, -50%) rotate(45deg)`;
    }
  }

  return {
    el,
    // (every second frame; a transform write, the compositor does the rest)
    update() { if (on && (frame++ & 1) === 0) draw(); },
    toggle(v = !on) { on = v; el.classList.toggle('show', on); },
    setNorthUp(v) { northUp = !!v; },
    get visible() { return on; },
    get northUp() { return northUp; },
  };
}
