// Fast travel: the number keys (on foot or riding; touch: the pin button top right opens the
// same list) jump to ten places along the drive through a quick fade to warm white.
// Each destination is resolved when it is used: a spot the walker could stand on (the ground
// or deck height from the walk world, inside the world extent, clear of every collider by a
// little more than the walker's radius), facing the sea and the sunrise or down the street.
// Riding, the road destinations (2 the car, 3 the hotel sidewalk, 5 the 11 ST crossing, 7 the
// convertible) bring the vehicle along, set down in a lane or curb spot facing along the road
// at rest; the others get off first and go on foot.
import { EYE_HEIGHT, SEA_LEVEL, CAR, TOWER, PARK, LANES, CROSS, WET_LINE_X, crossStreetAt, crossLegs, CROSS_STREETS } from '../world/layout.js';

const SAVE_KEY = 'ocean-drive.car';   // vehicles/index.js SAVE_KEY
const R_CLEAR = 0.38;                 // m: the walker's 0.3 m radius and a margin
const MAX_WADE = 0.5;
const FADE = 0.35;                    // s each way
export const START = { x: -26, z: 40, heading: 342, pitch: 4 };   // main.js's first frame
const Z11 = CROSS_STREETS.find((c) => c.name === '11 ST')?.z ?? -190;
// Ocean Drive's lanes: southbound by the hotels (sim yaw pi), northbound by the park (yaw 0)
export const LANE = { south: { x: LANES.centerX - 1.75, yaw: Math.PI }, north: { x: LANES.centerX + 1.75, yaw: 0 } };

export const DESTINATIONS = [
  { key: '1', id: 'beach', name: 'Lifeguard Beach', road: false },
  { key: '2', id: 'car', name: 'Your Car', road: true },
  { key: '3', id: 'hotels', name: 'Ocean Drive', road: true },
  { key: '4', id: 'promenade', name: 'The Promenade', road: false },
  { key: '5', id: 'crossing', name: '11th Street', road: true },
  { key: '6', id: 'cafe', name: 'Café Patio', road: false },
  { key: '7', id: 'hero', name: 'The Convertible', road: true },
  { key: '8', id: 'atv', name: 'Beach Patrol ATV', road: false },
  { key: '9', id: 'lookout', name: 'Tower Lookout', road: false },
  { key: '0', id: 'start', name: 'Where You Began', road: false },
];

const deg = (r) => (r * 180) / Math.PI;
// compass heading (0 north = -z, 90 east) from (x, z) toward (tx, tz)
export const headingTo = (x, z, tx, tz) => ((deg(Math.atan2(tx - x, -(tz - z))) % 360) + 360) % 360;
const promenadeX = (z) => PARK.promenadeX + 2.6 * Math.sin(z / 19) + 1.2 * Math.sin(z / 7.3);

// Whether the walker could stand at (x, z) with its feet at feetY (walker.js blocked(), with
// a margin): inside the world, not in deep water, clear of the circles and of the boxes
// between the feet and the head.
export function standable(world, x, z, feetY, r = R_CLEAR, avoid = []) {
  const b = world.bounds;
  if (world.inside ? !world.inside(x, z) : b && (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1)) return false;
  if (SEA_LEVEL - feetY > MAX_WADE * 0.5) return false;
  const head = feetY + 1.8;
  for (const c of world.circles) {
    if (c.disabled) continue;
    const dx = x - c.x, dz = z - c.z, rr = r + c.r;
    if (dx * dx + dz * dz < rr * rr) return false;
  }
  for (const c of avoid) { const rr = r + c.r; if ((x - c.x) ** 2 + (z - c.z) ** 2 < rr * rr) return false; }
  for (const q of world.boxes) {
    if (q.disabled || q.max.y < feetY + 0.05 || q.min.y > head) continue;
    const cx = Math.max(q.min.x, Math.min(x, q.max.x)), cz = Math.max(q.min.z, Math.min(z, q.max.z));
    if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return false;
  }
  return true;
}

// Nearest standable spot to (x, z), in rings out to maxR. level: the surface to stand on
// (a deck height: only spots on it count), else the ground.
export function findSpot(world, x, z, { level = null, maxR = 6, avoid = [], accept = null } = {}) {
  for (let r = 0; r <= maxR + 1e-6; r += 0.35) {
    const n = r === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * r) / 0.35));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const y = world.heightAt(px, pz, level ?? -Infinity);
      if (level != null && Math.abs(y - level) > 0.02) continue;
      if (accept && !accept(px, pz, y)) continue;
      if (standable(world, px, pz, y, R_CLEAR, avoid)) return { x: px, z: pz, feetY: y };
    }
  }
  return null;
}

// a car's door points (sim local -x is the driver's side), as vehicles/index.js doors()
export function doorPoints(pose, lz, width) {
  const s = Math.sin(pose.yaw), c = Math.cos(pose.yaw), out = width / 2 + 0.45;
  return [[-out, 'driver'], [out, 'passenger']].map(([lx, side]) => ({ x: pose.x + lx * c + lz * s, z: pose.z - lx * s + lz * c, side }));
}

// next to a car: at the door on the higher (sidewalk) side if it is clear, facing the car
function besideCar(world, car, avoid) {
  if (!car) return null;
  const doors = [...car.doors].sort((a, b) => world.heightAt(b.x, b.z) - world.heightAt(a.x, a.z));
  for (const maxR of [0.7, 2.5]) {
    for (const d of doors) {
      const s = findSpot(world, d.x, d.z, { maxR, avoid });
      if (s) return { ...s, heading: headingTo(s.x, s.z, car.pose.x, car.pose.z), pitch: -6 };
    }
  }
  return null;
}

// ctx: { world (heightAt, boxes, circles, bounds, inside), towers ([{ deck, deckY }]),
//   cafe ([{ x, z, r }] street-level tables and chairs), start, hero / atv / car ({ pose,
//   doors }; car: the saved car, else the nearest parked one) }
export function resolveWalk(id, ctx) {
  const W = ctx.world, cafe = ctx.cafe ?? [];
  const at = (x, z, heading, pitch = 0, opts) => { const s = findSpot(W, x, z, { avoid: cafe, ...opts }); return s && { ...s, heading, pitch }; };
  switch (id) {
    case 'beach': {
      // the dry side of the wet line, level with the main tower, looking out at the sunrise
      return at(WET_LINE_X - 0.8, TOWER.z + 2, 100, 1, { accept: (x, z, y) => y > SEA_LEVEL + 0.02 });
    }
    case 'car': return besideCar(W, ctx.car, cafe);
    case 'hotels': return at(-24.9, -118, 352, 3);
    case 'promenade': { const z = -46; return at(promenadeX(z), z, 70, 0); }
    case 'crossing': {
      // the hotel-side curb at the Ocean Drive crosswalk north of 11 ST, looking across it
      const [z0, z1] = crossLegs(Z11)[0];
      return at(-25.2, (z0 + z1) / 2, 92, 0);
    }
    case 'cafe': {
      const c = ctx.cafe?.length ? ctx.cafe : null;
      if (!c) return at(-24.3, 18.5, 250, -4);
      // the walkway beside the street-level tables nearest the start, facing into the cafe
      const near = c.filter((t) => Math.abs(t.z - 18) < 40).sort((a, b) => Math.abs(a.z - 18) - Math.abs(b.z - 18));
      const set = near.length ? near.filter((t) => Math.abs(t.z - near[0].z) < 4) : c.slice(0, 1);
      const cx = set.reduce((s, t) => s + t.x, 0) / set.length, cz = set.reduce((s, t) => s + t.z, 0) / set.length;
      const x = Math.max(...set.map((t) => t.x + t.r)) + 1.1;
      const s = findSpot(W, x, cz, { avoid: cafe, maxR: 4 });
      return s && { ...s, heading: headingTo(s.x, s.z, cx - 2, cz), pitch: -5 };
    }
    case 'hero': return besideCar(W, ctx.hero, cafe);
    case 'atv': {
      const a = ctx.atv;
      if (!a) return null;
      // on the landward side of it, facing it (and the sea beyond)
      const s = findSpot(W, a.pose.x - 1.9, a.pose.z, { maxR: 3, avoid: cafe });
      return s && { ...s, heading: headingTo(s.x, s.z, a.pose.x, a.pose.z), pitch: -8 };
    }
    case 'lookout': {
      // the main tower's deck: the corner clear of the cabin, looking past it out to sea;
      // the sand at its foot if the deck is somehow full
      const T = ctx.towers?.[0];
      if (T) {
        const s = findSpot(W, T.deck.x0 + 0.9, T.deck.z1 - 0.6, { level: T.deckY, maxR: 3 });
        if (s) return { ...s, heading: 118, pitch: -3 };
      }
      return at(TOWER.x - 4, TOWER.z + 4, 100, 0);
    }
    case 'start': { const S = ctx.start ?? START; return at(S.x, S.z, S.heading, S.pitch); }
    default: return null;
  }
}

// Riding: where the vehicle goes for a road destination (sim pose: yaw 0 north, pi south).
// ctx.riding: 'hero' when it is the convertible being driven.
export function resolveRoad(id, ctx) {
  const S = LANE.south, N = LANE.north;
  switch (id) {
    case 'car': {
      const p = ctx.car?.pose;
      if (!p) return null;
      const c = p.x < -26 ? crossStreetAt(p.z) : null;
      if (c && !c.far) return { x: Math.min(-32, Math.max(-84, p.x + 7)), z: c.z + (p.z < c.z ? 1 : -1) * CROSS.hw * 0.45, yaw: -Math.PI / 2 };
      // just behind it in the curb lane, else (on the beach, the park) the nearest lane
      return p.x < LANES.x1 + 1 ? { x: S.x, z: p.z - 7, yaw: S.yaw } : { x: N.x, z: p.z, yaw: N.yaw };
    }
    case 'hotels': return { x: S.x, z: -124, yaw: S.yaw };
    case 'crossing': return { x: N.x, z: crossLegs(Z11)[1][1] + 9, yaw: N.yaw };
    case 'hero': return ctx.riding === 'hero' ? { x: CAR.x, z: CAR.z, yaw: Math.PI } : { x: S.x, z: CAR.z - 8, yaw: S.yaw };
    default: return null;
  }
}

// ---------------------------------------------------------------------------

const CSS = `
#ft-fade { position: fixed; inset: 0; z-index: 6; pointer-events: none; opacity: 0; transition: opacity ${FADE}s ease;
  background: radial-gradient(ellipse at 50% 55%, #fffaf2 0%, #fbeedd 60%, #f1dcc4 100%); }
#ft-fade.on { opacity: 1; }
#ft-toast { position: fixed; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 104px); transform: translate(-50%, -6px); z-index: 7;
  pointer-events: none; opacity: 0; transition: opacity 0.5s ease, transform 0.5s ease; text-align: center; color: #fff4e6; padding: 8px 26px 9px;
  --serif: Didot, 'Bodoni 72', 'Bodoni MT', 'Playfair Display', 'Times New Roman', Georgia, serif;
  --sans: 'Helvetica Neue', 'Segoe UI Light', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --gold: rgba(246, 214, 154, 0.92);
  filter: drop-shadow(0 1px 3px rgba(30, 18, 12, 0.75)) drop-shadow(0 0 12px rgba(30, 18, 12, 0.35)); }
#ft-toast::before, #ft-toast::after { content: ''; position: absolute; left: 0; right: 0; height: 3px; box-sizing: border-box;
  border-top: 1px solid var(--gold); border-bottom: 0.5px solid rgba(246, 214, 154, 0.55);
  -webkit-mask: linear-gradient(to right, transparent, #000 18%, #000 82%, transparent); mask: linear-gradient(to right, transparent, #000 18%, #000 82%, transparent); }
#ft-toast::before { top: 0; }
#ft-toast::after { bottom: 0; }
#ft-toast.show { opacity: 1; transform: translate(-50%, 0); }
#ft-toast .band { font: 500 8.5px/1 var(--sans); letter-spacing: 0.5em; padding-left: 0.5em; text-transform: uppercase; color: var(--gold); }
#ft-toast .name { margin-top: 7px; font: italic 400 21px/1 var(--serif); letter-spacing: 0.05em; white-space: nowrap;
  background: linear-gradient(to bottom, #fffaf1 35%, #f2d3a4 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
html.touch #ft-toast { scale: 0.85; transform-origin: 50% 0; }
#touch .ft-btn { width: 40px; height: 40px; right: calc(env(safe-area-inset-right, 0px) + 22px); top: calc(env(safe-area-inset-top, 0px) + 20px); }
#touch .ft-btn.open { background: rgba(255, 250, 242, 0.16); }
#touch .ft-list { position: absolute; right: calc(env(safe-area-inset-right, 0px) + 22px); top: calc(env(safe-area-inset-top, 0px) + 70px);
  display: none; grid-template-columns: 1fr 1fr; gap: 4px 6px; padding: 9px 10px; pointer-events: auto; border-radius: 4px;
  background: rgba(40, 26, 18, 0.42); border: 1px solid rgba(246, 214, 154, 0.5); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
#touch .ft-list.open { display: grid; }
#touch .ft-list button { position: relative; width: auto; height: auto; border-radius: 3px; border: 0; background: none; display: flex; gap: 7px;
  align-items: baseline; justify-content: flex-start; padding: 6px 8px; color: rgba(255, 244, 230, 0.9); white-space: nowrap;
  font: italic 400 13px/1 Didot, 'Bodoni 72', 'Playfair Display', Georgia, serif; letter-spacing: 0.03em; }
#touch .ft-list button b { font: 500 9px/1 system-ui, -apple-system, sans-serif; font-style: normal; color: rgba(246, 214, 154, 0.95); letter-spacing: 0; }
@media (max-height: 420px) { #touch .ft-list { top: calc(env(safe-area-inset-top, 0px) + 64px); padding: 5px 8px; } #touch .ft-list button { padding: 4px 6px; } }
`;

const byCode = {};
for (const d of DESTINATIONS) { byCode['Digit' + d.key] = d; byCode['Numpad' + d.key] = d; }
const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''));

// walker, vehicles: the game's; beach: world/beach.js (towers); hotels: its group (the
// street-level cafe furniture); onArrive({ riding }): after each jump (camera snaps, shadow)
export function createFastTravel({ walker, vehicles, beach = null, hotels = null, start = START, shot = false, onArrive = null } = {}) {
  const none = { travel: () => false, attachTouch() {}, destinations: DESTINATIONS, resolve: () => null };
  if (shot || typeof document === 'undefined') return none;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const fade = document.createElement('div');
  fade.id = 'ft-fade';
  const toast = document.createElement('div');
  toast.id = 'ft-toast';
  toast.innerHTML = '<div class="band">Fast travel</div><div class="name"></div>';
  document.body.append(fade, toast);
  const toastName = toast.querySelector('.name'), toastBand = toast.querySelector('.band');
  let toastT = 0, busy = false, list = null, btn = null;
  const cafe = [
    ...(hotels?.userData?.tables ?? []).filter((t) => t.y < 0.3).map((t) => ({ x: t.x, z: t.z, r: 0.42 })),
    ...(hotels?.userData?.chairs ?? []).filter((c) => c.y < 0.3).map((c) => ({ x: c.x, z: c.z, r: 0.27 })),
  ];

  function show(name, band = 'Fast travel') {
    toastBand.textContent = band;
    toastName.textContent = name;
    toast.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toast.classList.remove('show'), 2000);
  }
  const carOf = (e) => e && { pose: { x: e.v.x, z: e.v.z, yaw: e.v.yaw }, doors: vehicles.doorsOf(e), entry: e };
  function context() {
    const L = vehicles.list;
    let car = carOf(vehicles.saved);
    if (!car) {
      let rec = null;
      try { rec = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null'); } catch { rec = null; }
      if (rec && Number.isFinite(rec.x) && Number.isFinite(rec.z)) {
        const pose = { x: rec.x, z: rec.z, yaw: rec.yaw ?? 0 };
        car = { pose, doors: doorPoints(pose, rec.body === 'hero' ? 0.1 : -0.25, rec.body === 'hero' ? 2 : 1.9) };
      } else {
        const spot = vehicles.parkedNear?.(walker.pos.x, walker.pos.y)?.[0];
        if (spot) car = { pose: spot.pose, doors: vehicles.doorsOf(spot) };
      }
    }
    return {
      world: walker.world, towers: beach?.towers, cafe, start, car,
      hero: carOf(L.find((e) => e.origin === 'hero')), atv: carOf(L.find((e) => e.kind === 'atv')),
      riding: vehicles.currentEntry?.origin ?? null,
    };
  }
  const settle = () => {
    walker.keys.clear();
    walker.vel.set(0, 0);
    walker.jumpReq = false;
    walker.brakeHeld = false;
  };

  function jump(d) {
    const ctx = context(), e = vehicles.currentEntry;
    if (e && d.road) {
      settle();
      if (d.id === 'car' && ctx.car?.entry === e) return true;   // already in it
      const p = resolveRoad(d.id, ctx);
      if (!p) return false;
      vehicles.place(p.x, p.z, p.yaw);
      onArrive?.({ riding: true });
      return true;
    }
    if (e && !vehicles.dismount()) { show('No room to get out here', 'Fast travel'); return null; }
    const s = resolveWalk(d.id, context());
    if (!s) return false;
    const pitch = Math.max(walker.pitchMin, Math.min(walker.pitchMax, s.pitch * Math.PI / 180)) * 180 / Math.PI;
    walker.set(s.x, s.feetY + EYE_HEIGHT, s.z, s.heading, pitch);
    settle();
    onArrive?.({ riding: false });
    return true;
  }

  function travel(key) {
    const d = DESTINATIONS.find((q) => q.key === String(key));
    if (!d || busy || vehicles.mounting) return false;
    busy = true;
    closeList();
    fade.classList.add('on');
    setTimeout(() => {
      let ok = false;
      try { ok = jump(d); } catch (err) { console.error('fast travel', err); }
      if (ok) show(d.name, `Fast travel · ${d.key}`);
      else if (ok === false) show('Nowhere clear to stand', d.name);
      requestAnimationFrame(() => fade.classList.remove('on'));
      setTimeout(() => { busy = false; }, FADE * 1000);
    }, FADE * 1000);
    return true;
  }

  addEventListener('keydown', (ev) => {
    const d = byCode[ev.code];
    if (!d || ev.repeat || ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return;
    if (typing(ev.target) || typing(document.activeElement)) return;
    if (!walker.active && !vehicles.riding) return;
    ev.preventDefault();
    travel(d.key);
  });

  function closeList() { list?.classList.remove('open'); btn?.classList.remove('open'); }
  function attachTouch(touch) {
    const root = touch?.root;
    if (!root || btn) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ft-btn';
    btn.setAttribute('aria-label', 'Fast travel');
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18"><path d="M9 16 C5 11 4 9 4 7 A5 5 0 0 1 14 7 C14 9 13 11 9 16 Z" /><circle cx="9" cy="7" r="1.7" /></svg>';
    list = document.createElement('div');
    list.className = 'ft-list';
    for (const d of DESTINATIONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<b>${d.key}</b>${d.name}`;
      const go = (e) => { e.preventDefault(); e.stopPropagation(); travel(d.key); };
      b.addEventListener('touchend', go, { passive: false });
      b.addEventListener('click', go);
      list.append(b);
    }
    // (touches on the panel neither steer nor look)
    list.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    const toggle = (e) => { e.preventDefault(); e.stopPropagation(); const open = !list.classList.contains('open'); list.classList.toggle('open', open); btn.classList.toggle('open', open); };
    btn.addEventListener('touchstart', toggle, { passive: false });
    btn.addEventListener('click', toggle);
    root.append(btn, list);
  }

  return { travel, attachTouch, destinations: DESTINATIONS, resolve: (id) => resolveWalk(id, context()), resolveRoad: (id) => resolveRoad(id, context()), get busy() { return busy; } };
}
