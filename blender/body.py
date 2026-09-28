# Lofted car bodies: a closed skin swept through cross-sections along the car.
# Each section is a half profile (bottom centre -> side -> top centre) of fixed point
# count, mirrored. Open ranges (cockpit, cabin, pickup bed) drop the top into an inner
# wall and a floor, so the same skin forms the tub. Plan ends are superellipses that
# close the skin into a rounded nose and tail.
import math
from carlib import V, smoothstep, lerp, clamp, Part


def superend(e, ru, p):
    """plan width fraction for distance e into an end zone of length ru"""
    if e <= 0:
        return 1.0
    t = min(1.0, e / ru)
    return max(0.0, 1 - t ** p) ** (1 / p)


def stations(half, ruF, ruR, step, n_end, extra=()):
    us = set()
    a, b = -half + ruR, half - ruF
    n = max(2, round((b - a) / step))
    for k in range(n + 1):
        us.add(round(a + (b - a) * k / n, 5))
    for k in range(1, n_end + 1):
        th = k / n_end * math.pi / 2
        us.add(round(b + ruF * math.sin(th), 5))
        us.add(round(a - ruR * math.sin(th), 5))
    for x in extra:
        if -half < x < half:
            us.add(round(x, 5))
    return sorted(us)


def plan_outline(B, front, off, n, back=0.2):
    """smooth plan outline of the undeformed body (right flank -> nose/tail -> left flank),
    offset outwards by off. Returns (s, u) pairs as 2D vectors"""
    from mathutils import Vector
    S = B.S
    half = S['half']
    sgn = 1 if front else -1
    ru = S['ruF'] if front else S['ruR']
    half_pts = []
    for k in range(n + 1):
        th = k / n * math.pi / 2
        u = sgn * (half - ru - back + (ru + back) * math.sin(th))
        half_pts.append((S['W0'] * B.plan(u), u))
    half_pts[-1] = (0.0, sgn * half)
    pts = [(-s, u) for (s, u) in half_pts] + [(s, u) for (s, u) in reversed(half_pts[:-1])]
    out = []
    for k, (s, u) in enumerate(pts):
        a, b = pts[max(0, k - 1)], pts[min(len(pts) - 1, k + 1)]
        ts, tu = b[0] - a[0], b[1] - a[1]
        L = math.hypot(ts, tu) or 1
        out.append(Vector((s - tu / L * sgn * off, u + ts / L * sgn * off)))
    return out


class Body:
    """spec keys:
    half, W0, ruF, pF, ruR, pR, zb(u), hs(u), hc(u), hk(u), amp(u), sin(u), rs, rb, tumble,
    opens [(u0, u1, floor)], wall_mat, floor_mat, bottom_mat, width(u) optional extra plan factor"""

    def __init__(self, spec, lod=0):
        self.S = spec
        self.lod = lod

    def plan(self, u):
        S = self.S
        half = S['half']
        k = superend(u - (half - S['ruF']), S['ruF'], S['pF']) if u > 0 else superend(-u - (half - S['ruR']), S['ruR'], S['pR'])
        if 'width' in S:
            k *= S['width'](u)
        return k

    def open_at(self, u):
        for (a, b, fl) in self.S.get('opens', ()):
            if a < u < b:
                return fl
        return None

    def section(self, u):
        S, lod = self.S, self.lod
        W = S['W0']
        zb, hs, hc = S['zb'](u), S['hs'](u), S['hc'](u)
        rb, rs, tum = S['rb'], S['rs'], S['tumble']
        amp = S['amp'](u)
        hk = clamp(S['hk'](u), zb + rb + 0.04, hs - rs - 0.04)
        P = []
        P += [(0.0, zb, 'bot'), (W - rb, zb, 'bot')] if lod else [(0.0, zb, 'bot'), (W * 0.5, zb, 'bot'), (W - rb, zb, 'bot')]
        for a in ((-45,) if lod else (-60, -30)):
            r = math.radians(a)
            P.append((W - rb + rb * math.cos(r), zb + rb + rb * math.sin(r), 'side'))
        P.append((W - 0.004, zb + rb, 'side'))
        n_low = 2 if lod else 4
        for k in range(1, n_low + 1):
            f = k / n_low
            P.append((W - amp * f - 0.018 * (1 - f) ** 2, lerp(zb + rb, hk - 0.008, f), 'side'))
        P.append((W, hk + 0.006, 'side'))
        n_up = 2 if lod else 3
        for k in range(1, n_up + 1):
            f = k / n_up
            P.append((W - tum * f * f, lerp(hk + 0.006, hs - rs, f), 'side'))
        for a in ((45, 90) if lod else (22.5, 45, 67.5, 90)):
            r = math.radians(a)
            P.append((W - tum - rs + rs * math.cos(r), hs - rs + rs * math.sin(r), 'side'))
        s0 = W - tum - rs
        fl = self.open_at(u)
        if fl is None:
            sIn = S['sin'](u)
            tops = [s0 - 0.03, W - 0.21, W - 0.37, 0.5 * W, 0.0] if lod else [s0 - 0.03, W - 0.15, W - 0.21, W - 0.28, W - 0.37, 0.55 * W, 0.25 * W, 0.0]
            for s in tops:
                t = smoothstep(W - sIn, s0 - 0.03, s)
                crown = S.get('crown', 0.012) * (1 - (s / W) ** 2)
                P.append((s, hc + (hs - hc) * t + crown * (1 - t), 'top'))
        else:
            lip = S.get('lip', 0.07)
            if lod:
                P += [(s0 - 0.03, hs - 0.02, 'lip'), (s0 - lip, hs - 0.1, 'wall'), (W - 0.15, lerp(hs - 0.1, fl, 0.6), 'wall'),
                      (W - 0.165, fl + 0.02, 'wall'), (0.0, fl, 'floor')]
            else:
                P += [(s0 - 0.025, hs - 0.012, 'lip'), (s0 - 0.055, hs - 0.045, 'lip'), (s0 - lip, hs - 0.10, 'wall'),
                      (W - 0.15, lerp(hs - 0.1, fl, 0.35), 'wall'), (W - 0.155, lerp(hs - 0.1, fl, 0.7), 'wall'),
                      (W - 0.165, fl + 0.02, 'wall'), (0.5 * W, fl, 'floor'), (0.0, fl, 'floor')]
        k = self.plan(u)
        return [(s * k, h, tag) for (s, h, tag) in P]

    def build(self, name, us):
        S = self.S
        rings, tags = [], []
        for u in us:
            P = self.section(u)
            full = P + [(-s, h, t) for (s, h, t) in reversed(P[1:-1])]
            dfm = S.get('deform')
            rings.append([V(*dfm(s, h, u)) if dfm else V(s, h, u) for (s, h, _t) in full])
            tags.append([t for (_s, _h, t) in full])
        wall, floor_m, bot = S.get('wall_mat', 'vinyl2'), S.get('floor_mat', 'dark'), S.get('bottom_mat', 'dark')
        n = len(rings[0])
        classify = S.get('classify')

        def fm(i, j):
            j2 = (j + 1) % n
            ts = {tags[i][j], tags[i][j2], tags[i + 1][j], tags[i + 1][j2]}
            if ts <= {'bot'}:
                return bot
            if 'floor' in ts and ts <= {'floor', 'wall'}:
                return floor_m
            if ts & {'wall', 'floor'}:
                return wall
            if 'lip' in ts and 'top' in ts:
                return wall
            if classify:
                c = (rings[i][j] + rings[i][j2] + rings[i + 1][j] + rings[i + 1][j2]) / 4
                return classify(c.x, c.z, -c.y) or 'paint'
            return 'paint'
        p = Part(name)
        faces = p.grid(rings, wrap_j=True, face_mat=fm, uv_tile=1.0)
        return p, faces
