// Minimap, bottom left, in the HUD's art-deco manner: a 150 px circle under a thin double gold
// ring with small spaced capitals for the compass point. The map itself is drawn once from
// the layout (the drive and its cross streets, the sidewalks, the hotel row, the park and its
// promenade, the sand, the sea) into an offscreen canvas; each shown frame is one rotated
// drawImage plus the markers: you (a gold chevron) and the saved car (a small ivory lozenge,
// pinned to the rim when it is off the map). Heading up by default; N hides / shows it,
// Shift+N switches heading up / north up. Never in ?shot mode.
import { HOTEL, SIDEWALK_W, SIDEWALK_E, LANES, PARKING, PARK, SAND, OCEAN, CROSS, CROSS_STREETS, TOWERS } from '../world/layout.js';
import { promenadeX } from '../world/crowd.js';

const CSS = `
#minimap { position: fixed; left: calc(env(safe-area-inset-left, 0px) + 30px); bottom: calc(env(safe-area-inset-bottom, 0px) + 26px);
  z-index: 4; width: 150px; height: 150px; pointer-events: none; opacity: 0; transition: opacity 0.6s ease;
  filter: drop-shadow(0 1px 6px rgba(30, 18, 12, 0.45)); }
#minimap.show { opacity: 1; }
#minimap canvas { position: absolute; inset: 0; width: 150px; height: 150px; }
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
  rect(PARKING.x0, PARKING.x1, MAP.z0, MAP.z1, 'rgba(66, 56, 54, 0.85)');
  rect(LANES.x0, LANES.x1, MAP.z0, MAP.z1, 'rgba(48, 40, 40, 0.88)');
  // cross streets from the west (the near ones and the far grid)
  for (const s of CROSS_STREETS) {
    rect(MAP.x0, SIDEWALK_W.x1, s.z - CROSS.hw - 2, s.z + CROSS.hw + 2, 'rgba(222, 204, 184, 0.88)');
    rect(MAP.x0, LANES.x0, s.z - CROSS.hw, s.z + CROSS.hw, 'rgba(48, 40, 40, 0.88)');
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
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  cv.width = cv.height = Math.round(SIZE * dpr);
  el.appendChild(cv);
  document.body.appendChild(el);
  const g = cv.getContext('2d');
  const map = drawStatic(footprints);
  let on = true, northUp = false, frame = 0;
  el.classList.add('show');

  addEventListener('keydown', (ev) => {
    if (ev.code !== 'KeyN' || ev.repeat) return;
    if (ev.shiftKey) northUp = !northUp;
    else { on = !on; el.classList.toggle('show', on); }
  });

  function draw() {
    const p = getPose();
    if (!p || !g?.save) return;
    const r = SIZE / 2, k = VIEW;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, SIZE, SIZE);
    // the map, clipped to the disc: heading up rotates it under the fixed chevron
    g.save();
    g.beginPath(); g.arc(r, r, r - 3, 0, Math.PI * 2); g.clip();
    g.fillStyle = 'rgba(40, 30, 28, 0.35)';
    g.fillRect(0, 0, SIZE, SIZE);
    const rot = northUp ? 0 : -p.heading;
    g.translate(r, r);
    g.rotate(rot);
    g.scale(k / PX, k / PX);
    g.drawImage(map, -(p.x - MAP.x0) * PX, -(p.z - MAP.z0) * PX);
    g.restore();
    // the saved car: a small ivory lozenge (on the rim when off the map)
    const s = getSaved();
    if (s) {
      let dx = (s.x - p.x) * k, dz = (s.z - p.z) * k;
      const c = Math.cos(rot), sn = Math.sin(rot);
      let sx = dx * c - dz * sn, sy = dx * sn + dz * c;
      const d = Math.hypot(sx, sy), lim = r - 9;
      if (d > lim) { sx *= lim / d; sy *= lim / d; }
      g.save();
      g.translate(r + sx, r + sy);
      g.rotate(Math.PI / 4);
      g.fillStyle = 'rgba(255, 246, 228, 0.95)';
      g.strokeStyle = 'rgba(120, 72, 40, 0.8)';
      g.lineWidth = 1;
      g.fillRect(-3.2, -3.2, 6.4, 6.4);
      g.strokeRect(-3.2, -3.2, 6.4, 6.4);
      g.restore();
    }
    // you: a gold chevron, pointing the way you face
    g.save();
    g.translate(r, r);
    g.rotate(northUp ? p.heading : 0);
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2.2); g.lineTo(-5, 5); g.closePath();
    const gold = g.createLinearGradient(0, -7, 0, 5);
    gold.addColorStop(0, '#fff6d8'); gold.addColorStop(1, '#e9b765');
    g.fillStyle = gold;
    g.fill();
    g.strokeStyle = 'rgba(60, 34, 20, 0.7)';
    g.lineWidth = 0.8;
    g.stroke();
    g.restore();
    // the frame: a double gold hairline ring, tick marks at the quarters, the north point
    g.strokeStyle = 'rgba(246, 214, 154, 0.85)';
    g.lineWidth = 1;
    g.beginPath(); g.arc(r, r, r - 2.5, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255, 236, 214, 0.5)';
    g.lineWidth = 0.7;
    g.beginPath(); g.arc(r, r, r - 5.5, 0, Math.PI * 2); g.stroke();
    for (let q = 0; q < 4; q++) {
      const a = rot + q * Math.PI / 2 - Math.PI / 2;
      g.strokeStyle = 'rgba(246, 214, 154, 0.9)';
      g.lineWidth = q ? 0.8 : 1.4;
      g.beginPath(); g.moveTo(r + Math.cos(a) * (r - 8), r + Math.sin(a) * (r - 8)); g.lineTo(r + Math.cos(a) * (r - 1), r + Math.sin(a) * (r - 1)); g.stroke();
    }
    const na = rot - Math.PI / 2, nx = r + Math.cos(na) * (r - 15), ny = r + Math.sin(na) * (r - 15);
    g.font = "italic 400 11px Didot, 'Bodoni 72', 'Bodoni MT', 'Playfair Display', Georgia, serif";
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(40, 24, 14, 0.55)';
    g.fillText('N', nx + 0.6, ny + 0.8);
    g.fillStyle = '#fff4e6';
    g.fillText('N', nx, ny);
  }

  return {
    el,
    // (every second frame: ~0.1 ms)
    update() { if (on && (frame++ & 1) === 0) draw(); },
    toggle(v = !on) { on = v; el.classList.toggle('show', on); },
    setNorthUp(v) { northUp = !!v; },
    get visible() { return on; },
    get northUp() { return northUp; },
  };
}
