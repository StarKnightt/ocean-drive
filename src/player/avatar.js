// The player's body on foot: the character and plain tee of the seated driver (world/crowd.js
// seatPlayer), drawn in the third-person view. In first person only its long projected sun
// shadow and the contact patch under the feet show. Locomotion follows the walker's ground
// speed: idle / walk / run (Shift) crossfaded by speed, each clip's playback rate from its
// measured foot speed so the planted foot stays put, the body turning smoothly to the
// direction of travel (and stepping round on the spot when first person looks far away).
// The jump is three poses baked on this body (the rise, the tuck, the landing crouch); the
// surf adds a wading pose (arms out, leaning into the water) on top of the walk. In the
// third-person view the body walks to a car's door and slides into the seat (the driving clip
// crossfaded in) while the camera blends, and climbs back out the same way.
import * as THREE from 'three';
import { createPerson, ik2, setWorldQuat } from '../world/mixamo.js';
import { contactTexture } from '../world/crowd.js';
import { HOTEL, SEA_LEVEL } from '../world/layout.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const D2R = Math.PI / 180;
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const rot = (axis, a) => new THREE.Quaternion().setFromAxisAngle(axis, a);
const TEE = (() => { const c = new THREE.Color(0xb9d3e3); return [c.r, c.g, c.b, 0.85]; })();
const EXIT_DUR = 0.8;
const HEAD_HIDE = 0.55;     // m: the camera this close to the head hides the body

// Single-pose clips baked on P from its standing idle (every bone keyed, so a pose at full
// weight leaves nothing to the bind pose): jump_up, jump_air, jump_land, and wade / pose_base
// for the additive wading layer.
function bakePoses(P) {
  const B = P.bones, r = P.root;
  const base = P.action('idle_standing') ?? P.action('idle_breathing');
  P.mixer.stopAllAction();
  base.reset().play();
  base.time = 1.0;
  P.mixer.update(0);
  const pos0 = r.position.clone(), q0 = r.quaternion.clone();
  r.position.set(0, 0, 0); r.quaternion.identity();
  r.updateMatrixWorld(true);
  const all = [];
  r.traverse((o) => { if (o.isBone) all.push(o); });
  const pose0 = all.map((b) => [b.position.clone(), b.quaternion.clone()]);
  const hips0 = B.Hips.position.clone();
  const hipsW0 = B.Hips.getWorldPosition(new THREE.Vector3());
  const s = hipsW0.y / 0.98;
  const qw = (b) => b.getWorldQuaternion(new THREE.Quaternion());
  const baseW = {};
  for (const n of ['Hips', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'RightArm', 'LeftFoot', 'RightFoot']) baseW[n] = qw(B[n]);
  const ankle0 = { Left: B.LeftFoot.getWorldPosition(new THREE.Vector3()), Right: B.RightFoot.getWorldPosition(new THREE.Vector3()) };
  const reset = () => { all.forEach((b, i) => { b.position.copy(pose0[i][0]); b.quaternion.copy(pose0[i][1]); }); r.updateMatrixWorld(true); };
  const arms = (fwd, out, bend) => {
    for (const side of ['Left', 'Right']) {
      const sx = side === 'Left' ? 1 : -1;
      // (a hanging arm swings forward for a negative angle about +x, out to its side about z)
      setWorldQuat(B[side + 'Arm'], rot(X, -fwd * D2R).multiply(rot(Z, sx * out * D2R)).multiply(baseW[side + 'Arm']));
      setWorldQuat(B[side + 'ForeArm'], rot(X, -bend * D2R).multiply(qw(B[side + 'ForeArm'])));
    }
  };
  const lean = (hips, s1, s2, head) => {
    setWorldQuat(B.Hips, rot(X, hips * D2R).multiply(baseW.Hips));
    setWorldQuat(B.Spine1, rot(X, s1 * D2R).multiply(baseW.Spine1));
    setWorldQuat(B.Spine2, rot(X, s2 * D2R).multiply(baseW.Spine2));
    setWorldQuat(B.Head, rot(X, head * D2R).multiply(baseW.Head));
  };
  const legs = (lift, fwd, flat, toes = 0) => {
    for (const side of ['Left', 'Right']) {
      const sx = side === 'Left' ? 1 : -1, i = side === 'Left' ? 0 : 1;
      const t = ankle0[side].clone().add(new THREE.Vector3(0, lift[i] * s, fwd[i] * s));
      ik2(B[side + 'UpLeg'], B[side + 'Leg'], B[side + 'Foot'], t, new THREE.Vector3(sx * 0.2, 0, 1));
      setWorldQuat(B[side + 'Foot'], rot(X, toes * D2R).multiply(flat ? baseW[side + 'Foot'] : qw(B[side + 'Foot'])));
    }
  };
  const hipsAt = (dy, dz) => {
    B.Hips.position.copy(B.Hips.parent.worldToLocal(new THREE.Vector3(hipsW0.x, hipsW0.y + dy * s, hipsW0.z + dz * s)));
    B.Hips.updateMatrixWorld(true);
  };
  const clip = (name, fn) => {
    reset();
    B.Hips.position.copy(hips0);
    fn();
    r.updateMatrixWorld(true);
    const tracks = all.map((b) => { const q = b.quaternion.toArray(); return new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', [0, 1], [...q, ...q]); });
    const hp = B.Hips.position.toArray();
    tracks.push(new THREE.VectorKeyframeTrack(B.Hips.name + '.position', [0, 1], [...hp, ...hp]));
    return new THREE.AnimationClip(name, 1, tracks);
  };
  const clips = {
    // takeoff and rise: stretched, toes pointed, the arms thrown forward and up
    jump_up: clip('jump_up', () => { lean(-3, -3, -5, -6); arms(58, 12, 22); legs([0.02, 0.05], [0, 0.03], false, 26); }),
    // the top and the fall: the knees drawn up, the arms out for balance
    jump_air: clip('jump_air', () => { lean(6, 6, 6, -8); arms(32, 34, 30); legs([0.25, 0.19], [0.05, -0.02], false, 14); }),
    // landing: hips dropped over the planted feet, leaning in, the arms forward
    jump_land: clip('jump_land', () => { hipsAt(-0.17, -0.05); lean(14, 10, 8, -16); arms(30, 14, 28); legs([0, 0], [0, 0], true); }),
    wade: clip('wade', () => { lean(0, 7, 5, -4); arms(14, 30, 34); }),
    pose_base: clip('pose_base', () => {}),
  };
  THREE.AnimationUtils.makeClipAdditive(clips.wade, 0, clips.pose_base);
  base.stop();
  reset();
  r.position.copy(pos0); r.quaternion.copy(q0);
  r.updateMatrixWorld(true);
  return clips;
}

export function createAvatar(scene, assets, { walker, groundAt, waterDepthAt = () => 0, doorsOf = null }) {
  const chars = assets.chars;
  const name = chars.megan ? 'megan' : Object.keys(chars)[0];
  const asset = chars[name];
  const P = createPerson(asset, { tints: [TEE, null, null], shadow: true });
  P.root.name = 'player-avatar';
  P.setLevel(0);
  scene.add(P.root);
  if (P.shadow) scene.add(P.shadow);
  const fem = asset.fem;
  const act = (n) => P.action(n);
  const A = {
    idle: act(fem ? 'idle_weight_shift_f' : 'idle_standing') ?? act('idle_standing'),
    walk: act(fem ? 'walk_casual_f' : 'walk_casual_m'),
    run: act(fem ? 'run_f' : 'jog'),
    drive: act('drive_car'),
  };
  const baked = bakePoses(P);
  for (const k of ['jump_up', 'jump_air', 'jump_land', 'wade']) A[k] = P.mixer.clipAction(baked[k]);
  if (A.idle.getClip().duration > 12) A.idle.setLoop(THREE.LoopPingPong);
  const speed = { walk: P.speedOf(A.walk.getClip().name), run: P.speedOf(A.run.getClip().name) };
  const dur = { walk: A.walk.getClip().duration, run: A.run.getClip().duration };
  for (const a of Object.values(A)) { a.play(); a.setEffectiveWeight(0); }
  // (the walker's step sounds and head bob on this body's strides)
  walker.strideWalk = clamp((speed.walk * dur.walk) / 2, 0.55, 0.95);
  walker.strideRun = clamp((speed.run * dur.run) / 2, 0.7, 1.3);

  // contact patch under the feet
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    color: 0x0c0806, map: contactTexture(), transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  contact.name = 'player-contact';
  contact.renderOrder = 1;
  contact.frustumCulled = false;
  scene.add(contact);

  const st = {
    x: walker.pos.x, z: walker.pos.y, y: walker.feetY, yaw: walker.yaw + Math.PI, yawV: 0,
    turning: false, air: 0, land: 0, jw: 0, wade: 0, drive: 0, prevAir: 0,
    phase: 'foot',            // 'foot' | 'enter' | 'car' | 'exit'
    tr: null,                 // enter / exit path
  };
  const W = {};               // weights this frame
  const _v = new THREE.Vector3(), _h = new THREE.Vector3(), _head = new THREE.Vector3();
  let shown = null, headHidden = false;

  function show(body, shadow) {
    const key = (body ? 1 : 0) + (shadow ? 2 : 0);
    if (key === shown) return;
    shown = key;
    P.root.visible = body;
    if (P.shadow) P.shadow.visible = shadow;
    contact.visible = shadow;
  }
  function setWeights(dt) {
    let sum = 0;
    for (const k of ['idle', 'walk', 'run', 'jump_up', 'jump_air', 'jump_land', 'drive']) sum += W[k] ?? 0;
    for (const k of ['idle', 'walk', 'run', 'jump_up', 'jump_air', 'jump_land', 'drive']) {
      const w = sum > 0 ? (W[k] ?? 0) / sum : k === 'idle' ? 1 : 0, a = A[k];
      if (!a) continue;
      a.enabled = w > 0.002;
      a.setEffectiveWeight(w);
    }
    A.wade.enabled = W.wade > 0.002;
    A.wade.setEffectiveWeight(W.wade);
    P.mixer.update(dt);
  }
  // locomotion weights for a ground speed v (m/s), playback matched to it
  function loco(v, dt) {
    const moveW = Math.max(smooth(0.08, 0.5, v), st.turning ? 0.55 : 0), runF = smooth(1.75, 2.35, v);
    W.idle = 1 - moveW;
    W.walk = moveW * (1 - runF);
    W.run = moveW * runF;
    A.walk.timeScale = st.turning && v < 0.3 ? 0.75 : clamp(v / speed.walk, 0.45, 1.7);
    A.run.timeScale = clamp(v / speed.run, 0.55, 1.6);
    // (in the walk <-> run blend both feet cycles in step)
    if (W.walk > 0.05 && W.run > 0.05) {
      if (W.walk >= W.run) A.run.time = (A.walk.time / dur.walk) * dur.run;
      else A.walk.time = (A.run.time / dur.run) * dur.walk;
    }
  }
  function jumpWeights(dt) {
    const air = walker.airY > 0.005 || walker.vy > 0;
    if (st.prevAir && !air) st.land = 1;
    st.prevAir = air;
    st.land = Math.max(0, st.land - dt * 3.6);
    st.jw += ((air ? 1 : 0) - st.jw) * (1 - Math.exp(-dt * (air ? 16 : 10)));
    const up = smooth(-0.6, 1.6, walker.vy);
    const land = Math.sin(Math.PI * Math.min(1, st.land * 1.2)) * (1 - st.jw) * 0.9;
    const k = 1 - Math.min(1, st.jw + land);
    for (const n of ['idle', 'walk', 'run']) W[n] *= k;
    W.jump_up = st.jw * up;
    W.jump_air = st.jw * (1 - up);
    W.jump_land = land;
  }
  function faceTo(target, dt, rate) {
    const d = wrap(target - st.yaw);
    const step = clamp(d * (1 - Math.exp(-dt * 10)), -rate * dt, rate * dt);
    st.yaw = wrap(st.yaw + step);
    st.yawV = step / Math.max(dt, 1e-4);
  }
  function place(x, y, z, roll = 0) {
    P.root.position.set(x, y, z);
    P.root.rotation.set(0, st.yaw, roll);
  }
  function placeShadows(x, z, ground, h) {
    if (P.per) { P.per.uBaseY.value = ground; P.per.uWallX.value = HOTEL.frontX; }
    const k = 1 / (1 + h * 2.2);
    contact.position.set(x, ground + 0.012, z);
    contact.rotation.y = st.yaw;
    contact.scale.set(0.62 * (0.6 + 0.4 * k), 1, 0.72 * (0.6 + 0.4 * k));
    contact.material.opacity = 0.5 * k;
  }
  // pelvis of a car's seat (world) or the standing point of a bike / ATV's rider
  function seatOf(e, out) {
    const pel = e.kind === 'car' ? e.drive?.rig?.pelvis : null;
    if (pel) return { car: true, p: pel.getWorldPosition(out) };
    const v = e.v;
    return { car: false, p: out.set(v.x, v.groundY + Math.max(0, (v.spec.eye?.[1] ?? 1.6) - 1.58), v.z) };
  }
  // root shifted so the hips sit on `pel` (world)
  function hipsOnto(pel, u) {
    P.root.updateMatrixWorld(true);
    P.bones.Hips.getWorldPosition(_h);
    P.root.position.addScaledVector(_v.subVectors(pel, _h), u);
  }
  function doorPoint(e, side) {
    const ds = doorsOf?.(e);
    const d = ds?.find((q) => q.side === side) ?? ds?.[0];
    return d ? { x: d.x, z: d.z } : { x: st.x, z: st.z };
  }

  return {
    P, contact,
    get phase() { return st.phase; },
    get yaw() { return st.yaw; },
    get headHidden() { return headHidden; },
    get weights() { return { ...W }; },
    // head of the body, world (after update)
    head(out) { return out.copy(_head); },
    // getting in from the third-person view: to the door, then into the seat, over the mount
    // transition (vehicles' mounting.k); from first person: hidden at once, as before
    enter(e, side, fromTp) {
      if (!fromTp) { st.phase = 'car'; st.tr = null; return; }
      st.phase = 'enter';
      st.tr = { e, x0: st.x, z0: st.z, y0: st.y, yaw0: st.yaw, door: doorPoint(e, side), k: 0 };
    },
    // out of the seat (third person): seat -> door -> the walker's spot, then on foot
    exit(e, fromTp) {
      st.x = walker.pos.x; st.z = walker.pos.y; st.y = walker.feetY;
      if (!fromTp) { st.phase = 'foot'; st.tr = null; st.yaw = walker.yaw + Math.PI; return; }
      const seat = seatOf(e, new THREE.Vector3());
      const ds = doorsOf?.(e) ?? [];
      const near = ds.sort((a, b) => Math.hypot(a.x - walker.pos.x, a.z - walker.pos.y) - Math.hypot(b.x - walker.pos.x, b.z - walker.pos.y))[0];
      st.phase = 'exit';
      st.tr = { e, t: 0, seat: seat.p, car: seat.car, door: near ? { x: near.x, z: near.z } : { x: walker.pos.x, z: walker.pos.y }, carYaw: e.v.yaw + Math.PI, groundY: e.v.groundY };
      st.yaw = st.tr.carYaw;
    },
    // mode: 'fp' | 'tp'; body: draw the body (third person, or a view blend under way);
    // mounting: vehicles.mounting ({ k }) while getting in
    update(dt, { body = false, camera = null, riding = false, mounting = null } = {}) {
      dt = Math.min(dt, 0.1);
      if (this.off) { show(false, false); return; }   // (a perf A/B switch)
      for (const k in W) W[k] = 0;
      W.wade = 0;
      if (st.phase === 'enter' && (!riding || !mounting)) st.phase = riding ? 'car' : 'foot';
      if (st.phase === 'car' && !riding) st.phase = 'foot';
      if (st.phase === 'car') { show(false, false); return; }
      let x, y, z, ground, h = 0, roll = 0;
      if (st.phase === 'enter') {
        const tr = st.tr, k = clamp(mounting.k, 0, 1);
        const seat = seatOf(tr.e, _v.set(0, 0, 0)), p = seat.p.clone();
        const a = smooth(0, 0.45, k), b = smooth(0.45, 1, k);
        const gx = tr.x0 + (tr.door.x - tr.x0) * a, gz = tr.z0 + (tr.door.z - tr.z0) * a;
        const walkV = Math.hypot(tr.door.x - tr.x0, tr.door.z - tr.z0) / Math.max(0.05, 0.45 * (mounting.dur ?? 0.9)) * (a > 0 && a < 1 ? 1 : 0);
        const carYaw = tr.e.v.yaw + Math.PI;
        if (walkV > 0.3 && a < 0.9) faceTo(Math.atan2(tr.door.x - tr.x0, tr.door.z - tr.z0), dt, 9); else faceTo(carYaw, dt, 6);
        loco(walkV * (1 - b), dt);
        W.drive = seat.car ? b : 0;
        const k2 = 1 - W.drive; W.idle *= k2; W.walk *= k2; W.run *= k2;
        ground = groundAt(gx, gz);
        x = gx; z = gz; y = ground + (seat.car ? 0 : (p.y - ground) * b);
        if (!seat.car) { x += (p.x - gx) * b; z += (p.z - gz) * b; }
        st.x = x; st.z = z; st.y = ground;
        setWeights(dt);
        place(x, y, z);
        if (seat.car && b > 0) hipsOnto(p, b);
        h = b;
      } else if (st.phase === 'exit') {
        const tr = st.tr;
        tr.t += dt / EXIT_DUR;
        const k = clamp(tr.t, 0, 1), a = smooth(0, 0.5, k), b = smooth(0.5, 1, k);
        const tx = walker.pos.x, tz = walker.pos.y;
        const gx = tr.door.x + (tx - tr.door.x) * b, gz = tr.door.z + (tz - tr.door.z) * b;
        const walkV = b > 0 && b < 1 ? Math.hypot(tx - tr.door.x, tz - tr.door.z) / (0.5 * EXIT_DUR) : 0;
        if (walkV > 0.3) faceTo(Math.atan2(tx - tr.door.x, tz - tr.door.z), dt, 9);
        else if (b >= 1) faceTo(st.yaw, dt, 1);
        loco(Math.max(walkV, walker.speed ?? 0) * a, dt);
        W.drive = tr.car ? 1 - a : 0;
        const k2 = 1 - W.drive; W.idle *= k2; W.walk *= k2; W.run *= k2;
        ground = groundAt(gx, gz);
        x = tr.car ? gx : tr.seat.x + (gx - tr.seat.x) * a;
        z = tr.car ? gz : tr.seat.z + (gz - tr.seat.z) * a;
        y = tr.car ? ground : tr.seat.y + (ground - tr.seat.y) * a;
        st.x = x; st.z = z; st.y = ground;
        setWeights(dt);
        place(x, y, z);
        if (tr.car && a < 1) hipsOnto(tr.seat, 1 - a);
        h = 1 - a;
        if (k >= 1) { st.phase = 'foot'; st.tr = null; }
      } else {
        // on foot
        x = walker.pos.x; z = walker.pos.y;
        const v = walker.speed ?? walker.vel.length();
        const vx = walker.vel.x, vz = walker.vel.y, vl = Math.hypot(vx, vz);
        const look = walker.yaw + Math.PI;
        // (put somewhere else: facing the way the view looks)
        if (Math.hypot(x - st.x, z - st.z) > 2) { st.yaw = look; st.turning = false; }
        if (vl > 0.25) { st.turning = false; faceTo(Math.atan2(vx, vz), dt, 9); }
        else if (!body) {
          // (first person, standing: the body steps round once the look has turned well away)
          const d = Math.abs(wrap(look - st.yaw));
          if (d > 0.9) st.turning = true;
          if (st.turning) { faceTo(look, dt, 3.2); if (d < 0.08) st.turning = false; } else st.yawV = 0;
        } else { st.turning = false; st.yawV = 0; }
        // (lean into a turn at speed)
        roll = clamp(-st.yawV * v * 0.018, -0.14, 0.14);
        loco(v, dt);
        jumpWeights(dt);
        // the surf: wading (arms out, leaning in) and slower
        ground = groundAt(x, z);
        const depth = Math.max(waterDepthAt(x, z), SEA_LEVEL - ground);
        st.wade += (smooth(0.06, 0.4, depth) - st.wade) * (1 - Math.exp(-dt * 4));
        W.wade = st.wade * smooth(0.1, 0.6, v) * (1 - st.jw);
        y = walker.feetY + walker.airY;
        h = walker.airY;
        st.x = x; st.z = z; st.y = walker.feetY;
        setWeights(dt);
        place(x, y, z, roll);
        ground = walker.feetY;
      }
      placeShadows(st.x, st.z, st.phase === 'foot' ? ground : groundAt(st.x, st.z), h);
      let drawn = body || st.phase !== 'foot';
      if (drawn) {
        // the whole body hidden while the camera is at the head (first person, a blend passing
        // through it, the arm pushed right in by a wall): never a headless body
        P.root.updateMatrixWorld(true);
        P.bones.Head.getWorldPosition(_head);
        headHidden = !!camera && camera.position.distanceTo(_head) < HEAD_HIDE;
        if (headHidden) drawn = false;
      }
      // (sat in the seat the car's own contact and the seated body take over)
      const inSeat = st.phase === 'enter' ? h > 0.6 : st.phase === 'exit' ? h > 0.4 : false;
      show(drawn, !inSeat);
    },
    // hide everything (the ?shot harness)
    hide() { show(false, false); st.phase = 'car'; },
    state: () => ({ phase: st.phase, x: +st.x.toFixed(2), z: +st.z.toFixed(2), yaw: +st.yaw.toFixed(3), visible: P.root.visible, shadow: !!P.shadow?.visible, head: !headHidden, w: Object.fromEntries(Object.entries(W).map(([k, v]) => [k, +v.toFixed(2)])) }),
  };
}
