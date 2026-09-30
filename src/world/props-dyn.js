// Knockable street props (open world): the sidewalk bins and news boxes (street.js
// KNOCKABLES) and the road-closed barricades and cones at the world's ends (edges.js). One
// InstancedMesh per part of each kind; each prop has a live collider circle (the walker and
// the vehicles see it; people plan round its spot). The ridden vehicle hitting one faster
// than KNOCK_SPEED knocks it: the collider goes, it is launched off the bumper (the car's
// velocity scaled by the mass ratio, an up kick, a tumble), flies, bounces, rolls and comes
// to rest on its side, and the car loses a little speed. Slower, the prop is solid. A knocked
// prop is stood back up RESET_T s later once it is out of view. Palms, lamps, signal poles,
// pay stations and hydrants stay solid (they are not in here).
import * as THREE from 'three';

export const KNOCK_SPEED = 1.5;     // m/s
const RESET_T = 90;                 // s
const G = 9.8;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _ax = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0), _f = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();

// kinds: { [kind]: { parts: [{ geo, mat }], mass (kg), h (height m), lie (radius lying down, m) } }
// items: [{ kind, x, y, z, rot, r }]
export function createDynProps(scene, { kinds, items, groundAt, requestShadow = () => {}, shadows = true }) {
  const byKind = new Map();
  const props = [];
  for (const it of items) {
    const K = kinds[it.kind];
    if (!K) continue;
    const y = it.y ?? groundAt(it.x, it.z);
    const p = {
      ...it, y, K, state: 'rest', t: 0, i: 0,
      pos: new THREE.Vector3(it.x, y, it.z), q: new THREE.Quaternion().setFromAxisAngle(_Y, it.rot ?? 0),
      vel: new THREE.Vector3(), w: new THREE.Vector3(), downQ: null,
      home: { pos: new THREE.Vector3(it.x, y, it.z), q: new THREE.Quaternion().setFromAxisAngle(_Y, it.rot ?? 0) },
    };
    // colliders: one circle, or three along the long side (`span`: half its length less r)
    const offs = it.span ? [-it.span, 0, it.span] : [0];
    const ca = Math.cos(it.rot ?? 0), sa = Math.sin(it.rot ?? 0);
    p.cols = offs.map((o) => ({ x: it.x + o * ca, z: it.z - o * sa, r: it.r ?? 0.3, r0: it.r ?? 0.3, knock: true, prop: p }));
    p.col = p.cols[1] ?? p.cols[0];
    let list = byKind.get(it.kind);
    if (!list) byKind.set(it.kind, (list = []));
    p.i = list.length;
    list.push(p);
    props.push(p);
  }
  const meshes = [];
  for (const [kind, list] of byKind) {
    const K = kinds[kind];
    K.meshes = K.parts.map(({ geo, mat, shadow = true }) => {
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      m.name = 'prop-' + kind;
      m.castShadow = shadows && shadow;
      m.receiveShadow = true;
      m.userData.mirror = true;
      scene.add(m);
      meshes.push(m);
      return m;
    });
    for (const p of list) write(p);
    for (const m of K.meshes) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
  }
  const colliders = props.flatMap((p) => p.cols);

  function write(p) {
    _m.compose(p.pos, p.q, _s);
    for (const m of p.K.meshes) { m.setMatrixAt(p.i, _m); m.instanceMatrix.needsUpdate = true; }
  }

  // v: the ridden vehicle (sim body, with circlesWorld); returns the props knocked this step
  const knocked = [];
  function sweep(v) {
    knocked.length = 0;
    if (!v) return knocked;
    const sp = Math.hypot(v.vx, v.vz);
    if (sp < KNOCK_SPEED) return knocked;
    const reach = (v.spec.length ?? 4.5) / 2 + 1.5;
    for (const p of props) {
      if (p.state !== 'rest' || Math.abs(p.pos.x - v.x) > reach || Math.abs(p.pos.z - v.z) > reach) continue;
      let hit = null;
      for (const c of v.circlesWorld) {
        // (a step ahead: the contact would have stopped the car short of it)
        const cx = c.x + v.vx / 60, cz = c.z + v.vz / 60;
        for (const q of p.cols) if (Math.hypot(q.x - cx, q.z - cz) < c.r + q.r0 + 0.08) { hit = c; break; }
        if (hit) break;
      }
      if (!hit) continue;
      knock(p, v, hit, sp);
      knocked.push(p);
    }
    return knocked;
  }

  function knock(p, v, c, sp) {
    const M = v.spec.mass ?? 1500, m = p.K.mass;
    // off the bumper: along the car's velocity, a little along the contact normal, up
    let nx = p.pos.x - c.x, nz = p.pos.z - c.z;
    const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    const k = 1.25 + Math.random() * 0.35;
    p.vel.set(v.vx * k + nx * sp * 0.35, 1.2 + sp * (0.18 + Math.random() * 0.12) * Math.min(1, 40 / m), v.vz * k + nz * sp * 0.35);
    // tumble: about the horizontal axis across its flight, and a spin
    _ax.set(p.vel.z, 0, -p.vel.x).normalize();
    p.w.copy(_ax).multiplyScalar(sp * (1.2 + Math.random())).addScaledVector(_Y, (Math.random() - 0.5) * 6);
    p.state = 'fly'; p.t = 0; p.bounces = 0;
    for (const q of p.cols) q.r = 0;
    // the car pays the momentum (a bin is nothing, a barricade a nudge)
    const loss = Math.min(0.2, (m / M) * 1.4);
    v.vx *= 1 - loss; v.vz *= 1 - loss; v.lon *= 1 - loss;
    p.knocks = (p.knocks ?? 0) + 1;
  }

  let flying = 0;
  function update(dt, camera) {
    dt = Math.min(dt, 0.05);
    let moving = 0;
    let frustumReady = false;
    for (const p of props) {
      if (p.state === 'rest') continue;
      p.t += dt;
      if (p.state === 'fly') {
        moving++;
        p.vel.y -= G * dt;
        p.pos.addScaledVector(p.vel, dt);
        const wl = p.w.length();
        if (wl > 1e-4) { _q2.setFromAxisAngle(_ax.copy(p.w).divideScalar(wl), wl * dt); p.q.premultiply(_q2); }
        const gy = groundAt(p.pos.x, p.pos.z);
        const floor = gy + (p.bounces > 0 ? p.K.lie : 0);
        if (p.pos.y < floor && p.vel.y < 0) {
          p.pos.y = floor;
          p.bounces++;
          p.vel.y *= -0.28;
          p.vel.x *= 0.6; p.vel.z *= 0.6;
          p.w.multiplyScalar(0.55);
          // settle on its side: the up axis toward horizontal, across the way it rolls
          if (!p.downQ) {
            const up = _p.set(0, 1, 0).applyQuaternion(p.q);
            _ax.set(up.x, 0, up.z);
            if (_ax.lengthSq() < 1e-4) _ax.set(p.vel.x, 0, p.vel.z);
            if (_ax.lengthSq() < 1e-4) _ax.set(1, 0, 0);
            _ax.normalize();
            // (the rotation taking its up axis onto that horizontal direction)
            _q2.setFromUnitVectors(up.normalize(), _ax);
            p.downQ = _q2.clone().multiply(p.q);
          }
          if (Math.abs(p.vel.y) < 0.6 && Math.hypot(p.vel.x, p.vel.z) < 1.2) { p.state = 'roll'; p.vel.y = 0; }
        }
      } else if (p.state === 'roll') {
        moving++;
        const d = Math.exp(-dt * 3.2);
        p.vel.x *= d; p.vel.z *= d;
        p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt;
        p.pos.y = groundAt(p.pos.x, p.pos.z) + p.K.lie;
        if (p.downQ) p.q.slerp(p.downQ, 1 - Math.exp(-dt * 7));
        if (Math.hypot(p.vel.x, p.vel.z) < 0.05 && p.t > 0.6) { p.state = 'down'; p.t = 0; if (p.downQ) p.q.copy(p.downQ); requestShadow(); }
      } else if (p.state === 'down') {
        // stood back up out of view, a while later
        if (p.t < RESET_T || !camera) continue;
        if (!frustumReady) { _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _f.setFromProjectionMatrix(_pm); frustumReady = true; }
        const far = Math.hypot(camera.position.x - p.home.pos.x, camera.position.z - p.home.pos.z) > 40;
        if (!far) continue;
        _sph.set(p.home.pos, 1.5);
        const homeSeen = _f.intersectsSphere(_sph);
        _sph.set(p.pos, 1.5);
        if (!homeSeen && !_f.intersectsSphere(_sph)) reset(p);
        continue;
      }
      write(p);
    }
    if (moving) { requestShadow(); for (const m of meshes) m.computeBoundingSphere(); }
    flying = moving;
  }

  function reset(p) {
    p.pos.copy(p.home.pos); p.q.copy(p.home.q);
    p.vel.set(0, 0, 0); p.w.set(0, 0, 0); p.downQ = null;
    p.state = 'rest'; p.t = 0;
    for (const q of p.cols) q.r = q.r0;
    write(p);
    requestShadow();
  }

  return {
    props, colliders, meshes, sweep, update, reset,
    get moving() { return flying; },
    // test / shot hooks
    nearest(x, z, kind = null) { let b = null, bd = Infinity; for (const p of props) { if (kind && p.kind !== kind) continue; const d = Math.hypot(p.pos.x - x, p.pos.z - z); if (d < bd) { bd = d; b = p; } } return b; },
    state: () => props.filter((p) => p.state !== 'rest').map((p) => ({ kind: p.kind, state: p.state, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2) })),
  };
}
