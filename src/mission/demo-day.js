// Mission: "demo day". The startup's server crashed ten minutes before demo day: get up
// Ocean Drive to the server room in the park and reboot the rack before the clock runs out.
//
// Start: a glowing ring on the hotel sidewalk a few steps from the spawn. Walk into it: a
// short intro card, then a 3:00 countdown (real time; it holds while the game is paused).
// Route: a gold arrow under the clock turns toward the server room's door (then the rack)
// with the distance in metres, and a light beam stands over the building.
// Blockers: a few people with questions wait along the way and step toward you; touching one
// (on foot or in a car) costs 10 seconds and they say their line in a bubble.
// Finish: inside the room, E at the big red button. Fail: the clock hits zero. Enter retries
// from the ring, E closes the card.
//
// Everything here is built from boxes, cylinders, capsules and spheres, plus a canvas sign;
// the walls collide for the walker and the vehicles (their boxes join the walk world before
// the vehicles build their grid). Nothing of it exists in ?shot mode.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EYE_HEIGHT } from '../world/layout.js';
import { registerLod } from '../world/lod.js';
import { findSpot, standable, headingTo } from '../player/fasttravel.js';

const TIME = 180;                // s on the clock
const PENALTY = 10;              // s per blocker touched
const INTRO = 6;                 // s the intro card holds before the clock starts by itself
const MARK = { x: -26.3, z: 33.2, r: 1.0 };
// the server room: a small pastel pavilion on the park lawn, door on the road side (west)
const ROOM = { x0: -8, x1: -2, z0: -233, z1: -226, h: 3.6, t: 0.25, door: 1.7 };
const DOOR_Z = (ROOM.z0 + ROOM.z1) / 2;
const BUTTON = { x: -3.95, z: DOOR_Z };
const REACH = 1.7;               // m from the button
const CHASE = { see: 13, speed: 1.9, leash: 14 };
// the people with questions: home spot, how far across they may wander (x range), outfit
const BLOCKERS = [
  { x: -25.6, z: 6, xr: [-29.4, -24.4], line: 'quick question about the roadmap', shirt: 0x3d4a6b, legs: 0x2a2a30, hair: 0x2b1c14, skin: 0xc99b7a, prop: 'laptop' },
  { x: -12.3, z: -52, xr: [-14.2, 9], line: 'can you add ai to it?', shirt: 0x8a9aa6, legs: 0x3b3f48, hair: 0x6b4a2e, skin: 0xe2b896, prop: 'coffee' },
  { x: -4.5, z: -118, xr: [-14.2, 9], line: 'we pivoted.', shirt: 0x1f6f6a, legs: 0xcfc3ad, hair: 0x15100c, skin: 0x8d5f43, prop: 'phone' },
  { x: -12.2, z: -176, xr: [-14.2, 9], line: 'is it web3?', shirt: 0x1d1d22, legs: 0x2d2d33, hair: 0xb8a48c, skin: 0xd8a888, prop: 'tablet' },
  { x: -11.6, z: -214, xr: [-14.2, 9], line: 'can we circle back on pricing?', shirt: 0xd88a6e, legs: 0x4a5160, hair: 0x3a2618, skin: 0xb07c5c, prop: 'coffee' },
];

const CSS = `
#mission-hud { position: fixed; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 22px); z-index: 5; pointer-events: none; text-align: center;
  transform: translate(-50%, -6px); opacity: 0; transition: opacity 0.5s ease, transform 0.5s ease, top 0.45s ease; color: #fff4e6;
  --serif: Didot, 'Bodoni 72', 'Bodoni MT', 'Playfair Display', 'Times New Roman', Georgia, serif;
  --sans: 'Helvetica Neue', 'Segoe UI Light', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --gold: rgba(246, 214, 154, 0.92);
  filter: drop-shadow(0 1px 3px rgba(30, 18, 12, 0.75)) drop-shadow(0 0 12px rgba(30, 18, 12, 0.35)); }
#mission-hud.show { opacity: 1; transform: translate(-50%, 0); }
#mission-hud.low { top: calc(env(safe-area-inset-top, 0px) + 118px); }
#mission-hud .band { font: 500 9px/1 var(--sans); letter-spacing: 0.5em; padding-left: 0.5em; color: var(--gold); }
#mission-hud .clock { margin-top: 6px; font: 400 46px/1 var(--serif); letter-spacing: 0.04em; font-variant-numeric: lining-nums tabular-nums;
  background: linear-gradient(to bottom, #fffaf1 30%, #f2d3a4 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
#mission-hud.late .clock { background: linear-gradient(to bottom, #fff1e8 20%, #ff9a7a 100%); -webkit-background-clip: text; background-clip: text; }
#mission-hud.late.tick .clock { animation: mission-tick 1s ease-out; }
#mission-hud .way { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 7px;
  font: 400 11px/1 var(--sans); letter-spacing: 0.2em; color: rgba(255, 243, 228, 0.88); }
#mission-hud .way svg { width: 22px; height: 22px; overflow: visible; filter: drop-shadow(0 0 5px rgba(246, 214, 154, 0.8)); }
#mission-hud .way svg path { fill: #f6d69a; stroke: #fff6d8; stroke-width: 0.8; stroke-linejoin: round; }
#mission-hud .pen { position: absolute; left: 100%; top: 22px; margin-left: 10px; font: italic 400 20px/1 var(--serif); color: #ffb39a;
  opacity: 0; transform: translateY(4px); transition: opacity 0.25s ease, transform 0.25s ease; white-space: nowrap; }
#mission-hud .pen.show { opacity: 1; transform: none; }
@keyframes mission-tick { from { transform: scale(1.08); } to { transform: none; } }
#mission-card { position: fixed; left: 50%; top: 50%; z-index: 8; width: min(420px, calc(100vw - 48px)); box-sizing: border-box; padding: 22px 26px 18px;
  transform: translate(-50%, -46%); opacity: 0; pointer-events: none; transition: opacity 0.4s ease, transform 0.4s ease; text-align: center; color: #fff4e6;
  background: rgba(40, 26, 18, 0.5); border: 1px solid rgba(246, 214, 154, 0.5); border-radius: 4px; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  box-shadow: 0 8px 40px rgba(20, 12, 8, 0.35);
  --serif: Didot, 'Bodoni 72', 'Bodoni MT', 'Playfair Display', 'Times New Roman', Georgia, serif;
  --sans: 'Helvetica Neue', 'Segoe UI Light', 'Segoe UI', system-ui, -apple-system, sans-serif; --gold: rgba(246, 214, 154, 0.92); }
#mission-card.show { opacity: 1; transform: translate(-50%, -50%); pointer-events: auto; }
#mission-card .band { font: 500 9px/1 var(--sans); letter-spacing: 0.5em; padding-left: 0.5em; color: var(--gold); }
#mission-card h2 { margin: 12px 0 0; font: italic 400 25px/1.2 var(--serif); letter-spacing: 0.02em; text-wrap: balance;
  background: linear-gradient(to bottom, #fffaf1 35%, #f2d3a4 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
#mission-card p { margin: 10px 0 0; font: 400 13px/1.6 var(--sans); letter-spacing: 0.02em; color: rgba(255, 238, 222, 0.85); text-wrap: pretty; }
#mission-card p.big { font: 400 40px/1 var(--serif); font-variant-numeric: lining-nums tabular-nums; color: #fff4e6; margin-top: 14px; }
#mission-card p.big small { display: block; margin-top: 6px; font: 400 10px/1 var(--sans); letter-spacing: 0.3em; color: var(--gold); }
#mission-card .keys { display: flex; justify-content: center; gap: 18px; margin-top: 16px; }
#mission-card button { padding: 8px 14px; background: none; cursor: pointer; color: rgba(255, 244, 230, 0.92); border: 1px solid rgba(246, 214, 154, 0.45); border-radius: 3px;
  font: 400 11px/1 var(--sans); letter-spacing: 0.16em; }
#mission-card button:hover { background: rgba(255, 236, 205, 0.1); }
#mission-card button b { display: inline-block; margin-right: 0.7em; padding: 0.2em 0.35em; border: 1px solid rgba(255, 250, 242, 0.5); border-radius: 3px; font-weight: 500; letter-spacing: 0; }
#mission-card .bar { height: 1px; margin-top: 16px; background: linear-gradient(90deg, transparent, #e9b765 15%, #fff6d8 50%, #e9b765 85%, transparent); transform-origin: 50% 50%; }
#mission-prompt { position: fixed; left: 50%; top: 68%; transform: translate(-50%, 0); z-index: 5; pointer-events: none;
  font: 400 12px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; letter-spacing: 0.16em; color: rgba(255, 250, 242, 0.9);
  text-shadow: 0 1px 8px rgba(30, 18, 12, 0.55); opacity: 0; transition: opacity 0.35s ease; white-space: nowrap; }
#mission-prompt.show { opacity: 1; }
#mission-prompt.tap { pointer-events: auto; padding: 10px 14px; border: 1px solid rgba(246, 214, 154, 0.55); border-radius: 4px; background: rgba(40, 26, 18, 0.4); }
#mission-prompt b { display: inline-block; min-width: 1.35em; padding: 0.28em 0.3em; margin-right: 0.55em; border: 1px solid rgba(255, 250, 242, 0.55);
  border-radius: 3px; font-weight: 500; text-align: center; letter-spacing: 0; }
html.touch #mission-prompt b { display: none; }
.mission-bubble { position: fixed; left: 0; top: 0; z-index: 4; pointer-events: none; max-width: 220px; padding: 7px 12px 8px; border-radius: 12px;
  background: rgba(255, 249, 240, 0.94); color: #2e2018; font: 500 13px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; letter-spacing: 0.01em;
  box-shadow: 0 2px 12px rgba(30, 18, 12, 0.3); opacity: 0; transition: opacity 0.25s ease; white-space: nowrap; will-change: transform; }
.mission-bubble::after { content: ''; position: absolute; left: 50%; bottom: -6px; margin-left: -6px; border: 6px solid transparent; border-bottom: 0; border-top-color: rgba(255, 249, 240, 0.94); }
.mission-bubble.show { opacity: 1; }
.mission-bubble.small { font-weight: 400; font-size: 12px; color: #5a4436; }
html.touch #mission-hud { scale: 0.85; transform-origin: 50% 0; }
`;

const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// a box from bounds, vertex coloured
function box(x0, x1, y0, y1, z0, z1, color) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return paint(g, color);
}
function paint(g, color) {
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const at = (g, x, y, z, color) => paint(g.translate(x, y, z), color);

// a vertical glow: an open cylinder whose alpha fades upward (additive, unlit)
function glowTexture(mid = 0.35) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.55, `rgba(255,255,255,${mid})`);
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function signTexture(lines, { w = 512, h = 128, bg = '#2a1c22', fg = '#f6d69a', font = 'italic 64px Didot, "Bodoni 72", "Playfair Display", Georgia, serif' } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.draw = (text, color = fg) => {
    c.width = w; c.height = h;   // (main.js shrinks uploaded canvases to 1x1)
    const g = c.getContext('2d');
    if (!g) return;
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = color; g.globalAlpha = 0.6; g.lineWidth = 3; g.strokeRect(8, 8, w - 16, h - 16); g.globalAlpha = 1;
    g.fillStyle = color; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    const L = [].concat(text);
    L.forEach((s, i) => g.fillText(s, w / 2, h / 2 + (i - (L.length - 1) / 2) * (h / (L.length + 0.6))));
    t.needsUpdate = true;
  };
  t.userData.draw(lines);
  return t;
}

// ---------------------------------------------------------------------------
// the server room

function buildRoom(scene, groundY) {
  const { x0, x1, z0, z1, h, t, door } = ROOM, y0 = groundY - 0.05, top = groundY + h;
  const dz0 = DOOR_Z - door / 2, dz1 = DOOR_Z + door / 2;
  const STUCCO = 0xb4e3d1, TRIM = 0xf4ede2, BAND = 0xe8b7a3;
  // a band round the outside of the walls, o proud of them (door: leave the doorway open)
  const ring = (ya, yb, o, c, door = false) => [
    box(x0 - o, x1 + o, ya, yb, z0 - o, z0 + t, c), box(x0 - o, x1 + o, ya, yb, z1 - t, z1 + o, c), box(x1 - t, x1 + o, ya, yb, z0, z1, c),
    ...(door ? [box(x0 - o, x0 + t, ya, yb, z0, dz0 - 0.1, c), box(x0 - o, x0 + t, ya, yb, dz1 + 0.1, z1, c)] : [box(x0 - o, x0 + t, ya, yb, z0, z1, c)]),
  ];
  const ext = [
    box(x0, x1, y0, top, z0, z0 + t, STUCCO), box(x0, x1, y0, top, z1 - t, z1, STUCCO), box(x1 - t, x1, y0, top, z0, z1, STUCCO),
    box(x0, x0 + t, y0, top, z0, dz0, STUCCO), box(x0, x0 + t, y0, top, dz1, z1, STUCCO), box(x0, x0 + t, groundY + 2.4, top, dz0, dz1, STUCCO),
    // roof slab, parapet with a stepped centre over the door, a coral band, the eyebrow over the door
    box(x0 - 0.15, x1 + 0.15, top, top + 0.22, z0 - 0.15, z1 + 0.15, TRIM),
    box(x0 - 0.1, x1 + 0.1, top + 0.22, top + 0.55, z0 - 0.1, z0 + 0.1, TRIM), box(x0 - 0.1, x1 + 0.1, top + 0.22, top + 0.55, z1 - 0.1, z1 + 0.1, TRIM),
    box(x1 - 0.1, x1 + 0.1, top + 0.22, top + 0.55, z0, z1, TRIM), box(x0 - 0.1, x0 + 0.1, top + 0.22, top + 0.55, z0, z1, TRIM),
    box(x0 - 0.16, x0 + 0.1, top + 0.22, top + 1.05, dz0 - 0.5, dz1 + 0.5, TRIM), box(x0 - 0.18, x0 + 0.1, top + 1.05, top + 1.3, dz0 - 0.1, dz1 + 0.1, TRIM),
    ...ring(top - 0.42, top - 0.3, 0.04, BAND),
    box(x0 - 0.62, x0, groundY + 2.42, groundY + 2.52, dz0 - 0.35, dz1 + 0.35, TRIM),
    // door jambs and a base course
    box(x0 - 0.06, x0 + t + 0.02, y0, groundY + 2.42, dz0 - 0.1, dz0, TRIM), box(x0 - 0.06, x0 + t + 0.02, y0, groundY + 2.42, dz1, dz1 + 0.1, TRIM),
    ...ring(y0, groundY + 0.28, 0.05, BAND, true),
  ];
  const stucco = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const outside = new THREE.Mesh(mergeGeometries(ext), stucco);
  outside.castShadow = true; outside.receiveShadow = true;

  // inside: a dim blue room lit by its own racks (no lights added: emissive surfaces only)
  const ins = x0 + t + 0.01, ine = x1 - t - 0.01, inn = z0 + t + 0.01, iss = z1 - t - 0.01;
  const IN = 0x343c4a, FLOOR = 0x101318, CEIL = 0x15181e;
  const inner = [
    box(ins, ine, top - 0.02, top - 0.01, inn, iss, CEIL),
    box(ins, ine, y0, top, inn - 0.005, inn, IN), box(ins, ine, y0, top, iss, iss + 0.005, IN), box(ine, ine + 0.005, y0, top, inn, iss, IN),
    box(ins - 0.005, ins, y0, top, inn, dz0, IN), box(ins - 0.005, ins, y0, top, dz1, iss, IN), box(ins - 0.005, ins, groundY + 2.4, top, dz0, dz1, IN),
    box(x0 + 0.02, x1 - 0.02, groundY, groundY + 0.025, z0 + 0.02, z1 - 0.02, FLOOR),
  ];
  const interior = new THREE.Mesh(mergeGeometries(inner), new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.9, metalness: 0, emissive: 0x1a2436, emissiveIntensity: 1, envMapIntensity: 0.15,   // (the sky's light doesn't reach in)
  }));
  interior.receiveShadow = true;

  // racks along the back wall, the console with the big red button in front of the middle one
  const RX0 = x1 - t - 1.05, RX1 = x1 - t - 0.05, racks = [], leds = [], rz = [DOOR_Z - 2.05, DOOR_Z, DOOR_Z + 2.05];
  for (const z of rz) {
    racks.push(box(RX0, RX1, groundY, groundY + 2.1, z - 0.4, z + 0.4, 0x1c1f24), box(RX0 - 0.02, RX0, groundY + 0.1, groundY + 2.0, z - 0.36, z + 0.36, 0x2b3038));
    for (let k = 0; k < 9; k++) {
      const y = groundY + 0.3 + k * 0.19;
      racks.push(box(RX0 - 0.035, RX0 - 0.02, y, y + 0.12, z - 0.33, z + 0.33, 0x3a4048));
      for (let j = 0; j < 3; j++) leds.push(box(RX0 - 0.05, RX0 - 0.03, y + 0.04, y + 0.08, z + 0.12 + j * 0.06, z + 0.16 + j * 0.06, 0xffffff));
    }
  }
  const { x: bx, z: bz } = BUTTON;
  racks.push(
    box(bx - 0.28, bx + 0.28, groundY, groundY + 1.0, bz - 0.36, bz + 0.36, 0x2b3038),
    box(bx - 0.3, bx + 0.3, groundY + 1.0, groundY + 1.04, bz - 0.38, bz + 0.38, 0xd9b44a),
    at(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 28), bx, groundY + 1.055, bz, 0x111111),
  );
  const rack = new THREE.Mesh(mergeGeometries(racks), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1, emissive: 0x0b0f16, envMapIntensity: 0.15 }));
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xff3b2f, fog: false, toneMapped: false });
  const led = new THREE.Mesh(mergeGeometries(leds), ledMat);
  const btnMat = new THREE.MeshStandardMaterial({ color: 0xd8231b, roughness: 0.35, emissive: 0xff1a0a, emissiveIntensity: 0.6 });
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.11, 32).translate(bx, groundY + 1.12, bz), btnMat);
  rack.receiveShadow = btn.receiveShadow = true;   // (in the room's shadow, not the low sun's)
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.02, ROOM.z1 - ROOM.z0 - 1.6).translate((x0 + x1) / 2 - 0.4, top - 0.035, DOOR_Z),
    new THREE.MeshBasicMaterial({ color: 0xc9e2ff, fog: false }));
  const screenTex = signTexture(['rack-01', 'status: down'], { w: 512, h: 256, bg: '#0d1218', fg: '#ff6a55', font: '500 54px ui-monospace, Menlo, Consolas, monospace' });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), new THREE.MeshBasicMaterial({ map: screenTex, fog: false, toneMapped: false }));
  screen.position.set(ine - 0.01, groundY + 2.75, DOOR_Z); screen.rotation.y = -Math.PI / 2;   // on the back wall, over the racks
  // the sign over the door
  const signTex = signTexture('server room');
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.58), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.35 }));
  sign.position.set(x0 - 0.17, top + 0.64, DOOR_Z); sign.rotation.y = -Math.PI / 2;

  const group = new THREE.Group();
  group.name = 'mission-room';
  // the district's distance culling: the outside like a parked-car row, the inside like block detail
  const inside = new THREE.Group();
  inside.add(interior, rack, led, btn, ceil, screen);
  group.add(outside, sign, inside);
  scene.add(group);
  registerLod(outside, z0, z1, 'cars');
  registerLod(sign, z0, z1, 'cars');
  registerLod(inside, z0, z1, 'detail');

  // colliders: the four walls (the lintel is overhead), the racks and the console
  const B = (ax0, ax1, az0, az1, ay1 = top) => ({ min: { x: ax0, y: y0, z: az0 }, max: { x: ax1, y: ay1, z: az1 } });
  const colliders = [
    B(x0, x1, z0, z0 + t), B(x0, x1, z1 - t, z1), B(x1 - t, x1, z0, z1), B(x0, x0 + t, z0, dz0), B(x0, x0 + t, dz1, z1),
    B(RX0, x1, rz[0] - 0.4, rz[2] + 0.4, groundY + 2.1), B(bx - 0.3, bx + 0.3, bz - 0.38, bz + 0.38, groundY + 1.1),
  ];
  return {
    group, colliders, ledMat, btnMat,
    setStatus(ok) {
      ledMat.color.set(ok ? 0x37f08a : 0xff3b2f);
      screenTex.userData.draw(['rack-01', ok ? 'status: ok' : 'status: down'], ok ? '#5dffa0' : '#ff6a55');
    },
  };
}

// ---------------------------------------------------------------------------
// people with questions: a stylised figure from capsules, spheres and boxes, one mesh each

function buildFigure(o) {
  const parts = [];
  // g rotated (x then z), then moved to (x, y, z)
  const add = (g, x, y, z, c, rx = 0, rz = 0) => { g.rotateX(rx).rotateZ(rz); parts.push(at(g, x, y, z, c)); };
  const hold = o.prop === 'laptop' || o.prop === 'tablet';
  for (const s of [-1, 1]) {
    add(new THREE.CapsuleGeometry(0.068, 0.7, 4, 10), s * 0.095, 0.49, 0, o.legs);
    add(new THREE.BoxGeometry(0.11, 0.08, 0.27), s * 0.095, 0.04, -0.045, 0x1c1a19);
    // upper arm hangs, the forearm comes forward to hold something (both for a laptop / tablet)
    const fwd = hold || s > 0;
    add(new THREE.CapsuleGeometry(0.052, 0.24, 4, 10), s * 0.235, 1.25, 0, o.shirt, 0, s * 0.1);
    if (fwd) {
      add(new THREE.CapsuleGeometry(0.046, 0.22, 4, 10), s * (hold ? 0.2 : 0.235), 1.06, -0.12, o.shirt, -1.25);
      add(new THREE.SphereGeometry(0.045, 10, 8), s * (hold ? 0.17 : 0.235), 1.03, -0.27, o.skin);
    } else {
      add(new THREE.CapsuleGeometry(0.046, 0.24, 4, 10), s * 0.255, 0.95, 0, o.shirt, 0, s * 0.05);
      add(new THREE.SphereGeometry(0.045, 10, 8), s * 0.26, 0.79, 0, o.skin);
    }
  }
  add(new THREE.CapsuleGeometry(0.11, 0.2, 4, 10).scale(1, 1, 0.75), 0, 0.93, 0, o.legs, 0, Math.PI / 2);
  add(new THREE.CapsuleGeometry(0.17, 0.36, 6, 14).scale(1.05, 1, 0.66), 0, 1.16, 0, o.shirt);
  add(new THREE.CapsuleGeometry(0.075, 0.3, 4, 10).scale(1, 1, 0.85), 0, 1.38, 0, o.shirt, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.048, 0.055, 0.12, 10), 0, 1.5, 0, o.skin);
  add(new THREE.SphereGeometry(0.105, 18, 14).scale(0.9, 1.1, 1), 0, 1.64, 0, o.skin);
  add(new THREE.SphereGeometry(0.02, 8, 6), 0, 1.63, -0.1, o.skin);
  add(new THREE.SphereGeometry(0.113, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.94, 1.05, 1.04), 0, 1.655, 0.012, o.hair);
  // lanyard badge
  add(new THREE.BoxGeometry(0.07, 0.1, 0.01), 0.04, 1.18, -0.12, 0xf2f2ee);
  // what they hold (in front: -z is the face side)
  if (o.prop === 'laptop') { add(new THREE.BoxGeometry(0.36, 0.022, 0.25), 0, 1.03, -0.3, 0xb8bcc2); add(new THREE.BoxGeometry(0.36, 0.24, 0.015), 0, 1.15, -0.42, 0x9ea3aa, -0.25); }
  if (o.prop === 'coffee') add(new THREE.CylinderGeometry(0.042, 0.034, 0.13, 12), 0.235, 1.09, -0.29, 0xeee6d8);
  if (o.prop === 'phone') add(new THREE.BoxGeometry(0.075, 0.15, 0.012), 0.235, 1.12, -0.3, 0x151515, -0.6);
  if (o.prop === 'tablet') add(new THREE.BoxGeometry(0.22, 0.29, 0.012), 0, 1.11, -0.29, 0x222428, -0.9);
  return mergeGeometries(parts);
}

// ---------------------------------------------------------------------------

// scene; walker: the Walker (its world: the walk world, whose boxes the room joins);
// beach: ground heights; camera; getVehicles(): the vehicles module (built after this);
// paused(): true while the game waits behind its start overlay; radioVisible(): the radio
// card is up (the clock steps down out of its way)
// onTeleport(): after a retry puts the walker back at the ring (main.js snaps the camera / body)
export function createDemoDay(scene, { walker, beach, camera, getVehicles, paused = () => false, radioVisible = () => false, onTeleport = null }) {
  const world = walker.world;
  const groundY = beach.groundAt(BUTTON.x, BUTTON.z);
  const room = buildRoom(scene, groundY);
  world.boxes.push(...room.colliders);

  const glow = glowTexture(), glowFlat = glowTexture(0.8);
  const glowMat = (color, opacity, map = glow) => new THREE.MeshBasicMaterial({ color, map, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  // the start ring
  const startSpot = findSpot(world, MARK.x, MARK.z, { maxR: 3 }) ?? { x: MARK.x, z: MARK.z, feetY: beach.groundAt(MARK.x, MARK.z) };
  const marker = new THREE.Group();
  marker.name = 'mission-marker';
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd58a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(MARK.r * 0.82, MARK.r, 48).rotateX(-Math.PI / 2), ringMat);
  const beamMat = glowMat(0xffc56e, 0.55);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(MARK.r * 0.95, MARK.r, 2.6, 40, 1, true).translate(0, 1.3, 0), beamMat);
  ring.position.y = 0.03;
  marker.add(ring, beam);
  marker.position.set(startSpot.x, startSpot.feetY, startSpot.z);
  scene.add(marker);
  // the beacon over the server room (while the clock runs)
  // (normal blending: an additive glow vanishes against the bright morning sky)
  const beaconMat = glowMat(0xff8a2a, 0.5, glowFlat);
  beaconMat.blending = THREE.NormalBlending;
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 70, 24, 1, true).translate(0, 35, 0), beaconMat);
  beacon.position.set((ROOM.x0 + ROOM.x1) / 2, groundY + ROOM.h + 1.3, DOOR_Z);
  beacon.name = 'mission-beacon';
  scene.add(beacon);

  // the blockers (visible through the first frames so their program compiles with the rest)
  const figMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });
  const blobGeo = new THREE.CircleGeometry(0.42, 20).rotateX(-Math.PI / 2);
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x1a1210, transparent: true, opacity: 0.28, depthWrite: false, fog: false });
  const blockers = BLOCKERS.map((o, i) => {
    const home = findSpot(world, o.x, o.z, { maxR: 4 }) ?? { x: o.x, z: o.z };
    const mesh = new THREE.Mesh(buildFigure(o), figMat);
    mesh.name = 'mission-blocker';
    const blob = new THREE.Mesh(blobGeo, blobMat);
    scene.add(mesh, blob);
    return { ...o, i, home, x: home.x, z: home.z, yaw: 0, state: 'idle', mesh, blob, hit: false, t: Math.random() * 6, bubble: null, bubbleT: 0, aside: null };
  });

  // UI
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const hud = document.createElement('div');
  hud.id = 'mission-hud';
  hud.innerHTML = '<div class="band">demo day</div><div class="clock">3:00</div><div class="way"><svg viewBox="-11 -11 22 22" aria-hidden="true"><path d="M0 -9 L7.5 6.5 L0 2.8 L-7.5 6.5 Z" /></svg><span class="dist"></span></div><div class="pen">−10s</div>';
  const card = document.createElement('div');
  card.id = 'mission-card';
  const prompt = document.createElement('div');
  prompt.id = 'mission-prompt';
  document.body.append(hud, card, prompt);
  const clockEl = hud.querySelector('.clock'), distEl = hud.querySelector('.dist'), arrowEl = hud.querySelector('.way svg'), penEl = hud.querySelector('.pen');

  let state = 'idle';          // idle | intro | run | won | lost
  let left = TIME, introT = 0, armed = true, penT = 0, lastClock = '', lastDist = '', lastArrow = 999, pulse = 0, promptHtml = '';
  const _v = new THREE.Vector3();

  function player() {
    const v = getVehicles?.()?.current;
    return v ? { x: v.x, z: v.z, v } : { x: walker.pos.x, z: walker.pos.y, v: null };
  }
  const inRoom = (x, z) => x > ROOM.x0 + ROOM.t && x < ROOM.x1 - ROOM.t && z > ROOM.z0 + ROOM.t && z < ROOM.z1 - ROOM.t;
  const canReboot = () => {
    if (state !== 'run' || getVehicles?.()?.riding) return false;
    const p = player();
    return inRoom(p.x, p.z) && Math.hypot(p.x - BUTTON.x, p.z - BUTTON.z) < REACH;
  };

  function showCard(html, { cls = '' } = {}) {
    card.className = 'show ' + cls;
    card.innerHTML = html;
    for (const b of card.querySelectorAll('button[data-act]')) {
      const go = (e) => { e.preventDefault(); e.stopPropagation(); act(b.dataset.act); };
      b.addEventListener('click', go);
      b.addEventListener('touchend', go, { passive: false });
    }
  }
  const hideCard = () => { card.className = ''; };
  function setPrompt(html, tap = false) {
    if (html !== promptHtml) { promptHtml = html; if (html) prompt.innerHTML = html; }
    prompt.classList.toggle('show', !!html);
    prompt.classList.toggle('tap', !!html && tap && document.documentElement.classList.contains('touch'));
  }
  prompt.addEventListener('click', () => { if (canReboot()) reboot(); });
  prompt.addEventListener('touchend', (e) => { if (canReboot()) { e.preventDefault(); reboot(); } }, { passive: false });

  function resetBlockers() {
    for (const b of blockers) {
      b.x = b.home.x; b.z = b.home.z; b.state = 'idle'; b.hit = false; b.aside = null;
      setBubble(b, null);
    }
  }
  function setBubble(b, text, secs = 0, small = false) {
    if (!text) { b.bubbleT = 0; b.bubble?.classList.remove('show'); return; }
    if (!b.bubble) { b.bubble = document.createElement('div'); b.bubble.className = 'mission-bubble'; document.body.appendChild(b.bubble); }
    b.bubble.textContent = text;
    b.bubble.classList.toggle('small', small);
    b.bubble.classList.add('show');
    b.bubbleT = secs;
  }

  function intro() {
    state = 'intro'; introT = INTRO; left = TIME; armed = false;
    resetBlockers();
    room.setStatus(false);
    showCard(`<div class="band">demo day</div><h2>the server just crashed.</h2>
      <p>demo day starts in ten minutes and your startup's server is down. get across ocean drive to the server room in the park and reboot the rack before the clock hits zero.</p>
      <p>shift to run, e to grab a car. watch out for people with questions.</p>
      <div class="keys"><button type="button" data-act="go"><b>enter</b>start now</button></div><div class="bar"></div>`);
  }
  function go() {
    state = 'run'; left = TIME; hideCard(); lastClock = '';
    hud.classList.remove('late');
  }
  function reboot() {
    state = 'won';
    room.setStatus(true);
    for (const b of blockers) setBubble(b, null);
    setPrompt('');
    showCard(`<div class="band">demo day</div><h2>server's back. you raised the round.</h2>
      <p class="big">${fmt(left)}<small>left on the clock</small></p>
      <div class="keys"><button type="button" data-act="retry"><b>enter</b>run it again</button><button type="button" data-act="close"><b>e</b>close</button></div>`, { cls: 'won' });
  }
  function fail() {
    state = 'lost'; left = 0;
    for (const b of blockers) setBubble(b, null);
    setPrompt('');
    showCard(`<div class="band">demo day</div><h2>the demo crashed. the vcs left.</h2>
      <p>the rack is still down.</p>
      <div class="keys"><button type="button" data-act="retry"><b>enter</b>retry</button><button type="button" data-act="close"><b>e</b>close</button></div>`, { cls: 'lost' });
  }
  function close() {
    state = 'idle'; hideCard(); resetBlockers(); room.setStatus(false);
    const p = player();
    armed = Math.hypot(p.x - startSpot.x, p.z - startSpot.z) > MARK.r + 0.5;
  }
  // back to the ring, facing up the drive, and the clock straight away
  function retry() {
    const vehicles = getVehicles?.();
    const heading = headingTo(startSpot.x, startSpot.z, ROOM.x0 - 1, DOOR_Z);
    if (vehicles?.riding && !vehicles.dismount()) vehicles.place(-16.25, startSpot.z, 0);
    if (!vehicles?.riding) {
      walker.set(startSpot.x, startSpot.feetY + EYE_HEIGHT, startSpot.z, heading, 0);
      walker.vel.set(0, 0);
      onTeleport?.();
    }
    resetBlockers();
    room.setStatus(false);
    go();
  }
  function act(a) {
    if (a === 'go' && state === 'intro') go();
    else if (a === 'retry' && (state === 'won' || state === 'lost')) retry();
    else if (a === 'close' && (state === 'won' || state === 'lost')) close();
  }
  // capture phase: E here is the mission's, not the car door's
  addEventListener('keydown', (ev) => {
    if (ev.repeat) return;
    const k = ev.code;
    let used = false;
    if (state === 'intro' && (k === 'Enter' || k === 'NumpadEnter' || k === 'KeyE')) { go(); used = true; }
    else if (state === 'run' && k === 'KeyE' && canReboot()) { reboot(); used = true; }
    else if (state === 'run' && /^(Digit|Numpad)\d$/.test(k)) used = true;   // no fast travel on demo day
    else if (state === 'won' || state === 'lost') {
      if (k === 'Enter' || k === 'NumpadEnter') { retry(); used = true; }
      else if (k === 'KeyE') { close(); used = true; }
    }
    if (used) { ev.preventDefault(); ev.stopImmediatePropagation(); }
  }, true);

  function penalty(b) {
    left = Math.max(0, left - PENALTY);
    penT = 1.6;
    penEl.classList.add('show');
    b.hit = true; b.state = 'done';
    setBubble(b, b.line, 3.2);
    // they step aside, out of the way
    const p = player(), dx = b.x - p.x, dz = b.z - p.z, l = Math.hypot(dx, dz) || 1;
    b.aside = { x: b.x + (dx / l) * 1.2 - (dz / l) * 0.9, z: b.z + (dz / l) * 1.2 + (dx / l) * 0.9 };
  }
  function touching(b, p) {
    if (!p.v) return Math.hypot(b.x - p.x, b.z - p.z) < 0.72;
    for (const c of p.v.circlesWorld ?? []) if (Math.hypot(b.x - c.x, b.z - c.z) < c.r + 0.3) return true;
    return Math.hypot(b.x - p.x, b.z - p.z) < 1.2;
  }
  // a step that keeps them on their side of the street and out of walls, palms and tables
  function stepTo(b, tx, tz, dist) {
    const dx = tx - b.x, dz = tz - b.z, l = Math.hypot(dx, dz);
    if (l < 0.05) return;
    const s = Math.min(dist, l), nx = b.x + (dx / l) * s, nz = b.z + (dz / l) * s;
    const ok = (x, z) => x > b.xr[0] && x < b.xr[1] && Math.abs(z - b.home.z) < CHASE.leash && standable(world, x, z, beach.groundAt(x, z), 0.28);
    if (ok(nx, nz)) { b.x = nx; b.z = nz; } else if (ok(nx, b.z)) b.x = nx; else if (ok(b.x, nz)) b.z = nz;
  }

  function updateBlockers(dt, p, live) {
    for (const b of blockers) {
      const show = state !== 'idle';
      b.mesh.visible = b.blob.visible = show;
      if (!show) continue;
      b.t += dt;
      const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz);
      let speed = 0;
      if (live && !b.hit) {
        if (d < CHASE.see) {
          if (b.state !== 'chase') setBubble(b, 'hey! got a sec?', 2.2, true);
          b.state = 'chase';
          const x0 = b.x, z0 = b.z;
          stepTo(b, p.x, p.z, CHASE.speed * dt);
          speed = Math.hypot(b.x - x0, b.z - z0) / dt;
        } else if (b.state === 'chase' || Math.hypot(b.x - b.home.x, b.z - b.home.z) > 0.2) {
          b.state = 'idle';
          const x0 = b.x, z0 = b.z;
          stepTo(b, b.home.x, b.home.z, 1.2 * dt);
          speed = Math.hypot(b.x - x0, b.z - z0) / dt;
        }
        if (touching(b, p)) penalty(b);
      } else if (b.aside) {
        const x0 = b.x, z0 = b.z;
        b.x += (b.aside.x - b.x) * Math.min(1, dt * 4); b.z += (b.aside.z - b.z) * Math.min(1, dt * 4);
        speed = Math.hypot(b.x - x0, b.z - z0) / dt;
        if (speed < 0.05) b.aside = null;
      }
      // face the player when near, else the way they were facing; a little idle sway, a walk bob
      if (d < 25) { const want = Math.atan2(-dx, -dz); b.yaw += Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw)) * Math.min(1, dt * 6); }
      const y = beach.groundAt(b.x, b.z), walk = Math.min(1, speed / 1.5);
      b.mesh.position.set(b.x, y + walk * 0.03 * Math.abs(Math.sin(b.t * 9)), b.z);
      b.mesh.rotation.set(0, b.yaw, (1 - walk) * 0.025 * Math.sin(b.t * 1.3) + walk * 0.04 * Math.sin(b.t * 4.5));
      b.blob.position.set(b.x, y + 0.03, b.z);
      // the bubble over their head
      if (b.bubbleT > 0) {
        b.bubbleT -= dt;
        if (b.bubbleT <= 0) setBubble(b, null);
        else {
          _v.set(b.x, y + 2.05, b.z).project(camera);
          const on = _v.z < 1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2 && d < 45;
          b.bubble.style.visibility = on ? 'visible' : 'hidden';
          if (on) b.bubble.style.transform = `translate(${((_v.x + 1) / 2 * innerWidth).toFixed(1)}px, ${((1 - _v.y) / 2 * innerHeight).toFixed(1)}px) translate(-50%, -100%)`;
        }
      }
    }
  }

  function updateHud(dt, p) {
    const show = state === 'run' || state === 'intro';
    hud.classList.toggle('show', show);
    hud.classList.toggle('low', show && radioVisible());
    if (!show) return;
    const text = fmt(left);
    if (text !== lastClock) {
      lastClock = text; clockEl.textContent = text;
      const late = state === 'run' && left <= 30;
      hud.classList.toggle('late', late);
      if (late) { hud.classList.remove('tick'); void hud.offsetWidth; hud.classList.add('tick'); }
    }
    // the way: to the door, then (inside) to the button
    const inside = inRoom(p.x, p.z) || Math.hypot(p.x - (ROOM.x0 - 0.8), p.z - DOOR_Z) < 1.5, tx = inside ? BUTTON.x : ROOM.x0 - 0.8, tz = inside ? BUTTON.z : DOOR_Z;
    camera.getWorldDirection(_v);
    const heading = Math.atan2(_v.x, -_v.z), bearing = Math.atan2(tx - p.x, -(tz - p.z));
    const rel = Math.round(THREE.MathUtils.radToDeg(Math.atan2(Math.sin(bearing - heading), Math.cos(bearing - heading))));
    if (rel !== lastArrow) { lastArrow = rel; arrowEl.style.transform = `rotate(${rel}deg)`; }
    const dist = inside ? 'reboot the rack' : `${Math.round(Math.hypot(tx - p.x, tz - p.z))} m`;
    if (dist !== lastDist) { lastDist = dist; distEl.textContent = dist; }
    if (penT > 0 && (penT -= dt) <= 0) penEl.classList.remove('show');
  }

  return {
    get state() { return state; },
    get timeLeft() { return left; },
    blockers,
    room,
    start: { x: startSpot.x, z: startSpot.z },
    button: { ...BUTTON },
    door: { x: ROOM.x0 - 0.8, z: DOOR_Z },
    // test hooks
    intro, go, reboot: () => canReboot() && (reboot(), true), retry, close, fail,
    setTime(s) { left = s; },
    update(dt) {
      const p = player();
      const hold = paused();
      pulse += dt;
      // the ring: shown while idle, a slow breath
      marker.visible = state === 'idle';
      if (marker.visible) {
        const k = 0.5 + 0.5 * Math.sin(pulse * 2.2);
        ringMat.opacity = 0.6 + 0.35 * k; beamMat.opacity = 0.22 + 0.16 * k;
        ring.scale.setScalar(1 + 0.04 * k);
        const d = Math.hypot(p.x - startSpot.x, p.z - startSpot.z);
        if (d > MARK.r + 0.5) armed = true;
        if (armed && d < MARK.r && !p.v && !hold) intro();
      }
      beacon.visible = state === 'run' || state === 'intro';
      if (beacon.visible) {
        // faint up close, strong from down the drive
        const d = Math.hypot(camera.position.x - beacon.position.x, camera.position.z - beacon.position.z);
        beaconMat.opacity = THREE.MathUtils.clamp(0.2 + d / 250, 0.2, 0.85) * (0.9 + 0.1 * Math.sin(pulse * 3));
        const w = Math.max(1, d / 70);   // about the same width on screen from far off
        beacon.scale.set(w, 1, w);
      }
      if (state === 'intro' && !hold) {
        introT -= dt;
        const bar = card.querySelector('.bar');
        if (bar) bar.style.transform = `scaleX(${Math.max(0, introT / INTRO).toFixed(3)})`;
        if (introT <= 0) go();
      }
      if (state === 'run' && !hold) {
        left -= dt;
        if (left <= 0) fail();
      }
      // the racks blink while down; the button breathes
      if (state !== 'won') room.ledMat.color.setHex(Math.sin(pulse * 7) > 0 ? 0xff3b2f : 0x5a1410);
      room.btnMat.emissiveIntensity = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(pulse * 4));
      updateBlockers(dt, p, state === 'run' && !hold);
      updateHud(dt, p);
      // prompts: the ring nearby (idle), the button in reach (running)
      if (state === 'idle' && !p.v && Math.hypot(p.x - startSpot.x, p.z - startSpot.z) < 9) setPrompt('demo day · step into the light');
      else if (canReboot()) setPrompt('<b>E</b>reboot the rack', true);
      else setPrompt('');
    },
  };
}
