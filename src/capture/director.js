// Capture mode's director: an autopilot that plays the demo day mission start to finish, and
// a cinematic camera over it, in 2.35:1 letterbox with the debug UI and the cursor hidden
// (the mission HUD stays). Nothing here runs in normal play.
//
// The take (about 35 s): an aerial push-in over Ocean Drive toward the player by the start
// ring; the player walks into the ring and the camera drops to a low chase; a run to the
// convertible (set at the curb beside the ring, facing north) and a drive up the drive under
// a car chase; parked by the last of the people with questions, out, the bump (a quick side
// angle on their bubble); a faster chase for the final run; a slow push-in on the red button
// as it is pressed; a hold on "server's back. you raised the round.".
// For the shoot the northbound lane over the route is closed (its cars are parked out of sight
// and come back round at the loop's far end); the southbound traffic keeps running.
import * as THREE from 'three';

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp = THREE.MathUtils.clamp;

const SPOT = { x: -26.1, z: 38.2 };                      // where the player stands as it opens
const CAR_AT = { x: -22.75, z: 27, yaw: 0 };              // the convertible, facing north
// the drive: out of the curb lane, up the northbound lane, onto the park-side curb by the room
const ROUTE = [[-22.6, 22], [-20.8, 15], [-17.2, 6], [-16.25, -4], [-16.25, -196], [-15.7, -204], [-15.6, -210.5]];
const BLOCKER = 4;                                         // "can we circle back on pricing?"
const FINAL = [[-11.6, -221.5], [-8.9, -229.5], [-5.25, -230.25]];
const LETTERBOX = 2.35;

const CSS = `
html.capture, html.capture * { cursor: none !important; }
html.capture #minimap, html.capture #ride-prompt, html.capture #drive-hud, html.capture #radio-card, html.capture #note,
html.capture #overlay, html.capture #hud, html.capture #touch, html.capture #mission-prompt, html.capture #ft-toast, html.capture #loader { display: none !important; }
html.capture #mission-hud { top: calc(var(--lb, 0px) + 16px); }
.capture-bar { position: fixed; left: 0; right: 0; height: var(--lb, 0px); background: #000; z-index: 30; pointer-events: none; }
.capture-bar.top { top: 0; } .capture-bar.bottom { bottom: 0; }
`;

// camera: the game's; walker, vehicles, mission, traffic: the game's modules; groundAt(x, z)
export function createDirector({ camera, walker, vehicles, mission, traffic, groundAt }) {
  // the frame: letterbox bars, the debug UI and the cursor away
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  document.documentElement.classList.add('capture');
  const fit = () => document.documentElement.style.setProperty('--lb', `${Math.max(0, Math.round((innerHeight - innerWidth / LETTERBOX) / 2))}px`);
  fit();
  addEventListener('resize', fit);
  for (const side of ['top', 'bottom']) { const b = document.createElement('div'); b.className = `capture-bar ${side}`; document.body.appendChild(b); }

  // the set: the player by the ring facing it, the convertible at the curb facing north
  vehicles.place(CAR_AT.x, CAR_AT.z, CAR_AT.yaw, 'car');
  const heroEntry = vehicles.list.find((e) => e.origin === 'hero');
  walker.teleport(SPOT.x, SPOT.z, 0, 0);
  closeLane();

  const keys = walker.keys;
  const hold = (...k) => { keys.clear(); for (const c of k) keys.add(c); };
  let t = 0, running = false, phase = 'aerial', phaseT = 0, done = false, hitT = -1, wonT = -1, wp = 0;
  const go = (p) => { phase = p; phaseT = 0; wp = 0; };

  // the northbound lane over the route: its cars parked out of sight (they respawn at the far end)
  function closeLane() {
    for (const c of traffic.cars) if (c.dir === -1 && !c.hidden && c.z > -300 && c.z < 160) Object.assign(c, { hidden: true, holdT: 0, v: 0, a: 0, active: false });
  }

  // --- the autopilot on foot: aim at a point, run (Shift), sidestep when stuck
  let stuckT = 0, sideT = 0, lastX = 0, lastZ = 0;
  function runTo(x, z, run = true, arrive = 0.45) {
    const dx = x - walker.pos.x, dz = z - walker.pos.y, d = Math.hypot(dx, dz);
    if (d < arrive) { hold(); return true; }
    walker.yaw = Math.atan2(-dx, -dz);
    const moved = Math.hypot(walker.pos.x - lastX, walker.pos.y - lastZ);
    lastX = walker.pos.x; lastZ = walker.pos.y;
    stuckT = moved < 0.004 ? stuckT + 1 / 60 : 0;
    if (stuckT > 0.4) { sideT = 0.45; stuckT = 0; }
    if (sideT > 0) { sideT -= 1 / 60; hold('KeyW', 'KeyD', ...(run ? ['ShiftLeft'] : [])); return false; }
    hold('KeyW', ...(run ? ['ShiftLeft'] : []));
    return false;
  }

  // --- the autopilot at the wheel: pure pursuit along ROUTE, speed from the distance left,
  // braking for anything standing in the lane ahead (pedestrians on the crosswalks, cars)
  function nearestOnRoute(x, z) {
    let best = { d: Infinity, i: 0, u: 0 };
    for (let i = 0; i < ROUTE.length - 1; i++) {
      const [ax, az] = ROUTE[i], [bx, bz] = ROUTE[i + 1], ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
      const u = clamp(((x - ax) * ex + (z - az) * ez) / l2, 0, 1), d = Math.hypot(ax + ex * u - x, az + ez * u - z);
      if (d < best.d) best = { d, i, u };
    }
    return best;
  }
  function alongRoute(i, u, dist) {
    let [ax, az] = ROUTE[i];
    const [bx, bz] = ROUTE[i + 1];
    ax += (bx - ax) * u; az += (bz - az) * u;
    for (let j = i + 1; j < ROUTE.length; j++) {
      const [cx, cz] = ROUTE[j], l = Math.hypot(cx - ax, cz - az);
      if (l >= dist) return [ax + ((cx - ax) * dist) / l, az + ((cz - az) * dist) / l];
      dist -= l; ax = cx; az = cz;
    }
    return [ax, az];
  }
  function leftOnRoute(i, u) {
    let d = Math.hypot(ROUTE[i + 1][0] - ROUTE[i][0], ROUTE[i + 1][1] - ROUTE[i][1]) * (1 - u);
    for (let j = i + 1; j < ROUTE.length - 1; j++) d += Math.hypot(ROUTE[j + 1][0] - ROUTE[j][0], ROUTE[j + 1][1] - ROUTE[j][1]);
    return d;
  }
  function blockedAhead(v, fx, fz, rx, rz) {
    let ahead = Infinity;
    const test = (x, z, r) => {
      const dx = x - v.x, dz = z - v.z, a = dx * fx + dz * fz, s = Math.abs(dx * rx + dz * rz);
      if (a > 0 && a < 30 && s < 1.2 + r) ahead = Math.min(ahead, a);
    };
    for (const c of traffic.cars) if (!c.hidden) test(c.x, c.z, 1);
    for (const c of walker.world.circles) if (c.r > 0.15 && c.r < 0.6 && !c.disabled && Math.abs(c.z - v.z) < 30) test(c.x, c.z, c.r);
    return ahead;
  }
  function drive() {
    const v = vehicles.current;
    if (!v) return 'gone';
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
    const n = nearestOnRoute(v.x, v.z), left = leftOnRoute(n.i, n.u), speed = Math.abs(v.lon);
    const [tx, tz] = alongRoute(n.i, n.u, Math.min(left, 4 + speed * 0.45));
    const dx = tx - v.x, dz = tz - v.z;
    vehicles.steerHold = clamp(2.2 * Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz), -1, 1);
    // a tight turn out of the curb, cruising up the drive, easing down to stop at the end
    const turn = Math.abs(vehicles.steerHold);
    let want = Math.min(17, Math.sqrt(2 * 2.6 * Math.max(0, left - 0.6)), 4 + (1 - turn) * 13);
    const ahead = blockedAhead(v, fx, fz, rx, rz);
    if (ahead < 30) want = Math.min(want, Math.max(0, (ahead - 7) * 0.6));
    // (oncoming cars near the crossing out of the curb lane: wait for them)
    if (n.i < 2) for (const c of traffic.cars) if (!c.hidden && c.dir === 1 && c.z > v.z - 32 && c.z < v.z + 4) want = 0;
    if (left < 0.8 || (want < 0.3 && speed < 1.5)) { hold('Space'); return left < 0.8 && speed < 0.35 ? 'stopped' : 'drive'; }
    if (!v.engineOn) { hold(); return 'drive'; }
    if (v.lon < want - 0.4) hold('KeyW', ...(want - v.lon > 6 ? ['ShiftLeft'] : []));
    else if (v.lon > want + 1.2) hold(speed > 1.5 ? 'KeyS' : 'Space');
    else hold();
    return 'drive';
  }

  // --- the camera: shots are live functions of time; a cut blends the old shot into the new
  // one with an ease, and the subjects are followed through critically damped springs
  const pose = (p, q, fov) => ({ p, q, fov });
  const subj = { p: new THREE.Vector3(), v: new THREE.Vector3(), h: 0, init: false };
  function follow(dt, x, y, z, heading, w = 7) {
    if (!subj.init) { subj.p.set(x, y, z); subj.v.set(0, 0, 0); subj.h = heading; subj.init = true; }
    // spring on the position (no overshoot), a slower exponential follow on the heading
    const k = w * w, c = 2 * w;
    subj.v.x += (k * (x - subj.p.x) - c * subj.v.x) * dt; subj.v.y += (k * (y - subj.p.y) - c * subj.v.y) * dt; subj.v.z += (k * (z - subj.p.z) - c * subj.v.z) * dt;
    subj.p.addScaledVector(subj.v, dt);
    const dh = Math.atan2(Math.sin(heading - subj.h), Math.cos(heading - subj.h));
    subj.h += dh * (1 - Math.exp(-dt * 2.2));
  }
  const fwd = () => [-Math.sin(subj.h), -Math.cos(subj.h)];
  // the shots
  const P = (x, y, z) => new THREE.Vector3(x, y, z);
  const g0 = groundAt(SPOT.x, SPOT.z);
  const AER = [P(34, g0 + 52, 112), P(2, g0 + 20, 76), P(SPOT.x + 1.1, g0 + 2.7, SPOT.z + 5.4)];
  const aerial = (s) => {
    const u = ease(s / 3), a = AER[0].clone().lerp(AER[1], u), b = AER[1].clone().lerp(AER[2], u);
    const target = P(-30, g0 + 6, 0).lerp(P(SPOT.x, g0 + 1.25, SPOT.z - 4), smooth(s / 3));
    return pose(a.lerp(b, u), target, 52 - 4 * u);
  };
  const chase = ({ back, up, side = 0.35, look = 3, lookUp = 1.15, fov = 50 }) => () => {
    const [fx, fz] = fwd(), q = subj.p;
    return pose(P(q.x - fx * back - fz * side, q.y + up, q.z - fz * back + fx * side), P(q.x + fx * look, q.y + lookUp, q.z + fz * look), fov);
  };
  const footChase = chase({ back: 3.4, up: 1.4 });
  const fastChase = chase({ back: 2.8, up: 1.05, side: 0.3, look: 4.5, lookUp: 1.1, fov: 56 });
  const carChase = () => {
    const speed = Math.abs(vehicles.current?.lon ?? 0);
    return chase({ back: 6.3 + speed * 0.07, up: 1.75, side: 0, look: 7, lookUp: 0.95, fov: 50 + Math.min(7, speed * 0.4) })();
  };
  let sideShot = null;
  function makeSide(b) {
    const px = walker.pos.x, pz = walker.pos.y, gy = groundAt(b.x, b.z);
    const mx = (px + b.x) / 2, mz = (pz + b.z) / 2, dx = b.x - px, dz = b.z - pz, l = Math.hypot(dx, dz) || 1;
    let sx = -dz / l, sz = dx / l;
    if (sx < 0) { sx = -sx; sz = -sz; }          // the open lawn side, away from the road
    return (s) => pose(P(mx + sx * 3.1 - (dx / l) * 0.6 * s, gy + 1.6, mz + sz * 3.1 - (dz / l) * 0.6 * s), P(b.x, gy + 1.72, b.z), 40);
  }
  const btn = mission.button, gb = groundAt(btn.x, btn.z);
  const push = (s) => {
    const u = ease(s / 2.6);
    return pose(P(-7.3, gb + 2.15, -227.3).lerp(P(-5.55, gb + 1.62, -228.25), u), P(btn.x, gb + 1.12, btn.z), 47 - 7 * u);
  };

  let shot = { fn: aerial, t0: 0 }, prevShot = null, blend = null;
  function cut(fn, dur = 0.9) { prevShot = shot; shot = { fn, t0: t }; blend = { t0: t, dur }; }
  const evalShot = (s) => s.fn(t - s.t0);
  const _p = new THREE.Vector3(), _q = new THREE.Vector3();
  function applyCamera() {
    let c = evalShot(shot);
    if (blend) {
      const w = ease((t - blend.t0) / blend.dur);
      if (w >= 1) blend = null;
      else { const a = evalShot(prevShot); c = pose(_p.copy(a.p).lerp(c.p, w).clone(), _q.copy(a.q).lerp(c.q, w).clone(), a.fov + (c.fov - a.fov) * w); }
    }
    camera.position.copy(c.p);
    camera.up.set(0, 1, 0);
    camera.lookAt(c.q);
    if (Math.abs(camera.fov - c.fov) > 1e-3) { camera.fov = c.fov; camera.updateProjectionMatrix(); }
  }

  return {
    get done() { return done; },
    get phase() { return phase; },
    get time() { return t; },
    start() { running = true; t = 0; },
    // after the game's own update of the frame: the autopilot's keys for the next one, the camera now
    update(dt) {
      if (!running) { hold(); applyCamera(); return; }
      t += dt; phaseT += dt;
      const riding = vehicles.riding, v = vehicles.current;
      if (riding && v) follow(dt, v.x, (v.groundY ?? groundAt(v.x, v.z)) + 0.15, v.z, v.yaw, 6);
      else {
        const sp = Math.hypot(walker.vel.x, walker.vel.y);
        follow(dt, walker.pos.x, walker.feetY, walker.pos.y, sp > 0.4 ? Math.atan2(-walker.vel.x, -walker.vel.y) : subj.h, 8);
      }
      const b = mission.blockers[BLOCKER];
      switch (phase) {
        case 'aerial':
          if (t > 0.9 && mission.state === 'idle') runTo(mission.start.x, mission.start.z + 0.25, false, 0.3); else hold();
          if (t >= 3) { cut(footChase, 1.3); go('intro'); }
          break;
        case 'intro':
          if (mission.state === 'idle') runTo(mission.start.x, mission.start.z + 0.25, false, 0.3); else hold();
          if (mission.state === 'run') go('toCar');
          break;
        case 'toCar': {
          const door = vehicles.doorsOf(heroEntry).find((d) => d.side === 'driver');
          if (runTo(door.x, door.z, true, 0.6) || phaseT > 6) { hold(); vehicles.mount('car'); vehicles.setView('chase'); go('mount'); }
          break;
        }
        case 'mount':
          hold();
          if (riding && !vehicles.mounting && phaseT > 0.3) { cut(carChase, 1.2); go('drive'); }
          break;
        case 'drive':
          if (drive() === 'stopped' || phaseT > 40) { hold(); vehicles.steerHold = null; go('out'); }
          break;
        case 'out':
          hold('Space');
          if (phaseT > 0.25 && vehicles.riding) { hold(); vehicles.toggle(); }
          if (!vehicles.riding) { hold(); cut(footChase, 1.0); go('bump'); }
          break;
        case 'bump':
          if (!b.hit) runTo(b.x, b.z, true, 0.2);
          else hold();
          if (b.hit || phaseT > 3) go('final');
          break;
        case 'final': {
          if (wp < FINAL.length && runTo(FINAL[wp][0], FINAL[wp][1], true, wp === FINAL.length - 1 ? 0.25 : 0.7)) wp++;
          if (wp === 1 && shot.fn !== push && Math.hypot(walker.pos.x - FINAL[1][0], walker.pos.y - FINAL[1][1]) < 4.5) cut(push, 1.1);
          if (wp >= FINAL.length) { hold(); go('press'); }
          break;
        }
        case 'press':
          hold();
          walker.yaw = Math.atan2(-(btn.x - walker.pos.x), -(btn.z - walker.pos.y));
          if (phaseT > 0.7 && mission.reboot()) { wonT = t; go('won'); }
          else if (phaseT > 3) { mission.reboot(); wonT = t; go('won'); }
          break;
        case 'won':
          hold();
          if (t - wonT > 2.2) done = true;
          break;
      }
      // the bump: a quick side angle on the bubble, then the faster chase for the final run
      if (b.hit && hitT < 0) { hitT = t; sideShot = makeSide(b); cut(sideShot, 0.35); }
      if (hitT >= 0 && shot.fn === sideShot && t - hitT > 1.7) cut(fastChase, 0.7);
      applyCamera();
    },
  };
}
