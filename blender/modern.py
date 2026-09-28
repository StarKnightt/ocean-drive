# Generic parked cars for the curb rows: sedan, hatchback, SUV, pickup (modern, no make)
# and a vintage 60s-style hardtop coupe. Lofted bodies with an open cabin, a lofted
# greenhouse whose faces are classified into glass / frit / pillars / roof, lamps and
# grilles as patches raycast onto the skin, alloy wheels with spokes and brake discs,
# basic seats + dash inside. Paint is white: the runtime tints each instance.
import bpy, bmesh, math
from mathutils import Vector, Matrix
from carlib import (V, C, Part, smoothstep, lerp, clamp, sweep, lathe, box, orient,
                    cutter_box, cutter_cyl, fence, boolean, bevel, resmooth, Caster, empty, tris)
from body import Body, stations, plan_outline
from hero import cushion, rot_about_s, headlamp

KINDS = ['sedan', 'hatch', 'suv', 'pickup', 'coupe']

K = {
    'sedan': dict(L=4.80, W0=0.915, uF=1.42, uR=-1.42, R=0.335, rim=0.235, tw=0.112, track=0.80, arch=0.39,
                  belt=0.975, cowl=0.95, nose=0.74, deck=0.99, tail=0.93, zb=0.25, zbe=0.36,
                  zA=0.98, zRf=0.2, zRr=-0.72, zR=-1.46, top=1.45, Wt=0.655, pillars=[-0.1], sg=(-0.78, 0.8),
                  doors=[0.93, -0.12, -1.18], rake=0.17, trake=0.09, rim_style='five',
                  head=((0.4, 0.63, 0.74), (0.8, 0.685, 0.77)), tail_l=((0.42, 0.8), (0.87, 0.915)),
                  grille=(0.36, 0.47, 0.62), belt_chrome=True),
    'hatch': dict(L=4.20, W0=0.885, uF=1.29, uR=-1.29, R=0.315, rim=0.205, tw=0.1, track=0.76, arch=0.37,
                  belt=0.95, cowl=0.93, nose=0.74, deck=0.94, tail=0.93, zb=0.24, zbe=0.35,
                  zA=0.9, zRf=0.12, zRr=-1.3, zR=-1.9, top=1.48, Wt=0.64, pillars=[-0.3, -1.3], sg=(-1.68, 0.72),
                  doors=[0.84, -0.3, -1.25], rake=0.16, trake=0.03, rim_style='cover',
                  head=((0.38, 0.64, 0.735), (0.79, 0.69, 0.775)), tail_l=((0.55, 0.84), (0.85, 1.02)),
                  grille=(0.34, 0.46, 0.6)),
    'suv': dict(L=4.72, W0=0.955, uF=1.41, uR=-1.41, R=0.37, rim=0.24, tw=0.118, track=0.83, arch=0.43,
                belt=1.12, cowl=1.1, nose=0.99, deck=1.1, tail=1.06, zb=0.36, zbe=0.44,
                zA=1.26, zRf=0.52, zRr=-1.86, zR=-2.18, top=1.76, Wt=0.77, pillars=[0.0, -1.12], sg=(-2.02, 1.06),
                doors=[1.2, 0.0, -1.1], rake=0.12, trake=0.03, rim_style='six', clad=True, rails=True,
                head=((0.5, 0.86, 0.965), (0.87, 0.89, 0.995)), tail_l=((0.6, 0.98), (0.92, 1.12)),
                grille=(0.46, 0.62, 0.86)),
    'pickup': dict(L=5.36, W0=0.99, uF=1.7, uR=-1.62, R=0.39, rim=0.25, tw=0.125, track=0.86, arch=0.45,
                   belt=1.15, cowl=1.14, nose=1.06, deck=1.16, tail=1.14, zb=0.42, zbe=0.5,
                   zA=1.46, zRf=0.86, zRr=-0.29, zR=-0.37, top=1.88, Wt=0.79, pillars=[0.24], sg=(-0.26, 1.26),
                   doors=[1.36, 0.25, -0.33], rake=0.08, trake=0.0, rim_style='six', bed=(-2.55, -0.5, 0.8),
                   head=((0.55, 0.88, 1.01), (0.9, 0.9, 1.035)), tail_l=((0.9, 0.86), (1.0, 1.1)),
                   grille=(0.5, 0.62, 0.98)),
    'coupe': dict(L=5.05, W0=0.96, uF=1.5, uR=-1.42, R=0.34, rim=0.19, tw=0.1, track=0.79, arch=0.41,
                  belt=0.9, cowl=0.9, nose=0.84, deck=0.9, tail=0.86, zb=0.28, zbe=0.4,
                  zA=0.62, zRf=0.0, zRr=-0.95, zR=-1.5, top=1.36, Wt=0.7, pillars=[], sg=(-1.12, 0.46),
                  doors=[0.62, -0.74], rake=0.04, trake=0.02, rim_style='vintage', vintage=True, amp=0.012,
                  tail_l=((0.6, 0.66), (0.9, 0.8)), glass='glass', frit='trim'),
}


def spec_for(kind):
    k = K[kind]
    half = k['L'] / 2
    zA, zR = k['zA'], k['zR']

    def hs(u):
        if u >= zA:
            t = (u - zA) / (half - zA)
            return lerp(k['cowl'], k['nose'], t ** 1.5)
        if u <= zR:
            t = (zR - u) / (half + zR) if half + zR > 1e-3 else 1
            base = lerp(k['belt'], k['deck'], smoothstep(0, 0.3, t))
            return base - (k['deck'] - k['tail']) * smoothstep(0.55, 1.0, t)
        f = (zA - u) / (zA - zR)
        return lerp(k['cowl'], k['belt'], smoothstep(0, 0.25, f)) + 0.025 * f
    wb = (k['uF'], k['uR'])

    def width(u):
        w = 1.0
        for z in wb:
            w += (0.028 if kind == 'pickup' else 0.016) * math.exp(-((u - z) / 0.55) ** 2)
        return w

    def deform(s, h, u):
        if u > half - 0.55:
            t = smoothstep(half - 0.55, half, u)
            u -= k['rake'] * t ** 1.2 * smoothstep(k['nose'] - 0.32, k['nose'], h)
            u -= 0.05 * t * (1 - smoothstep(k['zbe'], k['zbe'] + 0.12, h))
        elif u < -(half - 0.45):
            t = smoothstep(-(half - 0.45), -half, u)
            u += k['trake'] * t * smoothstep(k['tail'] - 0.25, k['tail'], h)
            u += 0.04 * t * (1 - smoothstep(k['zbe'], k['zbe'] + 0.12, h))
        return s, h, u

    def classify(s, h, u):
        if k.get('clad'):
            for z in wb:
                if math.hypot(u - z, h - (k['R'] - 0.01)) < k['arch'] + 0.07 and abs(s) > k['W0'] - 0.2:
                    return 'trim'
            if h < k['zb'] + 0.12 and abs(s) > 0.5:
                return 'trim'
        if abs(u) > half - 0.3 and h < k['zbe'] - 0.035 and not k.get('vintage'):
            return 'trim'
        return None
    opens = [(zR, zA, 0.42 if kind != 'pickup' else 0.55)]
    if 'bed' in k:
        opens.append(k['bed'])
    return dict(
        half=half, W0=k['W0'], ruF=0.46 if not k.get('vintage') else 0.3, pF=2.6 if not k.get('vintage') else 4.5,
        ruR=0.38, pR=3.0 if not k.get('vintage') else 4.5,
        zb=lambda u: k['zb'] + (k['zbe'] - k['zb']) * smoothstep(half - 0.5, half, abs(u)),
        hs=hs, hc=lambda u: hs(u) + (0.012 if kind != 'pickup' else 0.0),
        hk=lambda u: hs(u) - (0.12 if kind != 'coupe' else 0.2),
        amp=lambda u: k.get('amp', 0.006) * (1 - smoothstep(half - 0.35, half - 0.1, abs(u))),
        sin=lambda u: 0.5, rs=0.1 if not k.get('vintage') else 0.05, rb=0.09, tumble=0.03 if not k.get('vintage') else 0.012,
        crown=0.02, opens=opens, wall_mat='interior', floor_mat='dark', width=width, deform=deform, classify=classify,
        lip=0.075,
    )


# ---------------------------------------------------------------------------
def greenhouse(kind, B, lod, glass_part, gl_mat):
    k = K[kind]
    S = B.S
    zA, zRf, zRr, zR, top, belt = k['zA'], k['zRf'], k['zRr'], k['zR'], k['top'], k['belt']

    def roof_y(u):
        if u >= zRf:
            t = clamp((zA - u) / (zA - zRf))
            return lerp(S['hs'](u), top, 1 - (1 - t) ** 1.35)
        if u <= zRr:
            t = clamp((u - zR) / (zRr - zR))
            return lerp(S['hs'](u), top, 1 - (1 - t) ** 1.25)
        return top + 0.022 * math.sin(math.pi * (u - zRr) / (zRf - zRr))
    step = 0.05 if lod == 0 else 0.14
    us = sorted(set([zR + (zA - zR) * i / max(2, round((zA - zR) / step)) for i in range(max(2, round((zA - zR) / step)) + 1)]
                    + [zRf, zRr, zRf - 0.045, zRr + 0.045] + [p + d for p in k['pillars'] for d in (-0.05, 0.05, -0.09, 0.09)]
                    + [k['sg'][0], k['sg'][1], k['sg'][0] + 0.045, k['sg'][1] - 0.045]))
    us = [u for u in us if zR <= u <= zA]
    sfr = [0, 0.12, 0.4, 0.7, 0.9, 1.0] if lod == 0 else [0, 0.5, 1.0]
    tfr = [0.1, 0.4, 0.7, 1.0] if lod == 0 else [0.5, 1.0]
    ns, nc, nt = len(sfr) - 1, (3 if lod == 0 else 2), len(tfr)
    rings, bands = [], []
    for u in us:
        y = roof_y(u)
        hb = S['hs'](u)
        kk = clamp((y - hb) / (top - belt))
        kp = B.plan(u)
        xb = (S['W0'] - S['tumble'] - S['rs']) * kp - 0.012
        xt = lerp(xb, k['Wt'] * kp, kk)
        rr = min(0.085, (y - hb) * 0.4 + 1e-4)
        P, bd = [], []
        for f in sfr:
            P.append((lerp(xb, xt, f) + 0.02 * math.sin(math.pi * f) * kk, lerp(hb, y - rr, f)))
            bd.append('side')
        for i in range(1, nc + 1):
            a = i / nc * math.pi / 2
            P.append((xt - rr + rr * math.cos(a), y - rr + rr * math.sin(a)))
            bd.append('corner')
        for f in tfr:
            s = (xt - rr) * (1 - f)
            P.append((s, y + 0.018 * kk * (1 - (s / max(xt, 1e-3)) ** 2)))
            bd.append('top')
        full = [(-s, h) for (s, h) in reversed(P[1:])] + P
        fb = list(reversed(bd[1:])) + bd
        dfm = S['deform']
        rings.append([V(*dfm(s, h, u)) for (s, h) in full])
        bands.append(fb)
    n = len(rings[0])
    nst = len(us)
    sg0, sg1 = k['sg']
    cls = [[None] * (n - 1) for _ in range(nst - 1)]
    for i in range(nst - 1):
        uc = (us[i] + us[i + 1]) / 2
        for j in range(n - 1):
            b = {bands[i][j], bands[i][j + 1]}
            if b == {'top'} or (b == {'corner', 'top'} and False):
                if zRr + 0.02 < uc < zRf - 0.02:
                    c = 'paint'
                else:
                    c = 'glass'
            elif 'side' in b and 'corner' not in b:
                c = 'glass' if sg0 < uc < sg1 else 'paint'
                for pz in k['pillars']:
                    if abs(uc - pz) < 0.05:
                        c = 'pillar'
            else:
                c = 'paint'
            cls[i][j] = c
    # frit / chrome surround: glass faces touching sheet metal
    frit = k.get('frit', 'trim')
    out = [[c for c in row] for row in cls]
    for i in range(nst - 1):
        for j in range(n - 1):
            if cls[i][j] != 'glass':
                continue
            for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                a, b = i + di, j + dj
                if 0 <= a < nst - 1 and 0 <= b < n - 1 and cls[a][b] in ('paint',):
                    out[i][j] = frit
    names = {'glass': gl_mat, 'paint': 'paint', 'pillar': 'trim', 'trim': 'trim', 'chrome': 'chrome'}
    gh = Part(kind + '_gh')
    f = gh.grid(rings, face_mat=lambda i, j: names[out[i][j]] if out[i][j] != 'glass' else '__glass', uv_tile=1)
    orient(gh, f, lambda c: Vector((0, c.y, belt)))
    # glass faces move to the glass part (own object, own material)
    gi = gh.mats.index('__glass') if '__glass' in gh.mats else -1
    gfaces = [x for x in gh.bm.faces if x.material_index == gi]
    for x in gfaces:
        vs = [glass_part.bm.verts.new(v.co) for v in x.verts]
        nf = glass_part.bm.faces.new(vs)
        nf.material_index = glass_part.mi(gl_mat)
        nf.smooth = True
    bmesh.ops.delete(gh.bm, geom=gfaces, context='FACES_ONLY')
    if '__glass' in gh.mats:
        gh.mats[gi] = 'trim'
    return gh, roof_y, rings


def surface_patch(part, caster, fn, na, nb, front, mat, lift=0.003):
    """patch shaped by fn(a, b) -> (s, h), projected onto the body along the length"""
    sgn = 1 if front else -1
    rows = []
    for i in range(na + 1):
        row = []
        for j in range(nb + 1):
            s, h = fn(i / na, j / nb)
            loc, nor = caster.hit((s, h, sgn * 5), (0, 0, -sgn))
            if loc is None:
                return None
            row.append(loc + nor * lift)
        rows.append(row)
    f = part.grid(rows, mat=mat, uv_tile=1)
    orient(part, f, lambda c: c - V(0, 0, sgn))
    return f


def side_patch(part, caster, fn, na, nb, side, mat, lift=0.003):
    rows = []
    for i in range(na + 1):
        row = []
        for j in range(nb + 1):
            u, h = fn(i / na, j / nb)
            loc, nor = caster.hit((side * 3, h, u), (-side, 0, 0))
            if loc is None:
                return None
            row.append(loc + nor * lift)
        rows.append(row)
    f = part.grid(rows, mat=mat, uv_tile=1)
    orient(part, f, lambda c: c - Vector((side, 0, 0)))
    return f


# ---------------------------------------------------------------------------
def wheel(part, kind, lod, side, center):
    k = K[kind]
    R, rim, w = k['R'], k['rim'], k['tw']
    ax = Vector((side, 0, 0))
    segs = 28 if lod == 0 else 16
    if lod == 0:
        prof = [(rim - 0.004, -w * 0.78), (rim + 0.012, -w * 0.9), (lerp(rim, R, 0.45), -w), (lerp(rim, R, 0.85), -w * 0.97),
                (R - 0.008, -w * 0.85), (R - 0.001, -w * 0.72)]
        for g in (-0.25, 0.25):
            a = w * g
            prof += [(R, a - 0.012), (R - 0.007, a - 0.004), (R - 0.007, a + 0.004), (R, a + 0.012)]
        prof += [(R - 0.001, w * 0.72), (R - 0.008, w * 0.85), (lerp(rim, R, 0.85), w * 0.97), (lerp(rim, R, 0.45), w),
                 (rim + 0.012, w * 0.9), (rim - 0.004, w * 0.78)]
    else:
        prof = [(rim - 0.004, -w * 0.78), (lerp(rim, R, 0.5), -w), (R, -w * 0.6), (R, w * 0.6), (lerp(rim, R, 0.5), w), (rim - 0.004, w * 0.78)]
    white = k.get('vintage')

    def col(co):
        r = (co - center).yz.length if False else math.hypot(co.y - center.y, co.z - center.z)
        a = (co.x - center.x) * side
        if white and a > w * 0.9 and lerp(rim, R, 0.42) < r < lerp(rim, R, 0.62):
            return (0.9, 0.89, 0.85)
        return (0.018, 0.018, 0.019)
    f = lathe(part, prof, segs, center, ax, mat='tyre')
    part.paint_color(f, col)
    # barrel + brake disc (dark) behind the spokes
    f = lathe(part, [(0.0, -w * 0.3), (rim * 0.85, -w * 0.3), (rim * 0.85, -w * 0.1), (0.0, -w * 0.1)] if lod == 0 else [(0.0, -w * 0.2), (rim, -w * 0.2)], 24 if lod == 0 else 12, center, ax, mat='tyre')
    part.paint_color(f, (0.16, 0.16, 0.17))
    style = k['rim_style']
    face = w * 0.72
    if lod == 1:
        lathe(part, [(rim, face - 0.01), (rim * 0.9, face), (rim * 0.3, face + 0.01), (0.0, face + 0.01)], 16, center, ax,
              mat='chrome' if style == 'vintage' else 'alloy')
        return
    if style == 'vintage':
        lathe(part, [(rim, face - 0.02), (rim - 0.004, face - 0.006), (rim - 0.02, face - 0.004), (rim - 0.03, face - 0.012)], segs, center, ax, mat='chrome')
        lathe(part, [(rim - 0.03, face - 0.013), (rim * 0.62, face - 0.018)], segs, center, ax, mat='paint')
        lathe(part, [(rim * 0.62, face - 0.02), (rim * 0.6, face - 0.006), (rim * 0.45, face + 0.008), (rim * 0.2, face + 0.016), (0.0, face + 0.018)], 32, center, ax, mat='chrome')
        return
    # lip and barrel face
    lathe(part, [(rim + 0.004, face - 0.018), (rim + 0.006, face - 0.004), (rim - 0.004, face + 0.002), (rim - 0.014, face - 0.004), (rim - 0.02, face - 0.03)], segs, center, ax, mat='alloy')
    if style == 'cover':
        def slots(r, a, th, idx):
            if 0 < idx < 4:
                a -= 0.012 * max(0.0, math.cos(8 * th)) ** 6
            return r, a
        lathe(part, [(rim - 0.02, face - 0.028), (rim * 0.85, face - 0.014), (rim * 0.65, face - 0.01), (rim * 0.4, face - 0.004), (rim * 0.15, face), (0.0, face)], 48, center, ax, mat='alloy', twist=slots)
        return
    nsp = 5 if style == 'five' else 6
    e1 = Vector((0, 0, 1))
    for i in range(nsp):
        for dd in ((-0.07, 0.07) if style == 'five' else (0.0,)):
            th = 2 * math.pi * i / nsp + dd
            d = Vector((0, math.sin(th), math.cos(th)))
            path = [center + d * 0.05 + ax * (face - 0.005), center + d * (rim * 0.55) + ax * (face - 0.012), center + d * (rim - 0.016) + ax * (face - 0.026)]
            wdt = 0.018 if style == 'five' else 0.026
            sweep(part, path, [(-wdt, -0.012), (wdt, -0.012), (wdt * 0.8, 0.008), (-wdt * 0.8, 0.008)], mat='alloy', up=ax, scales=[(1.0, 1.0), (0.85, 1.0), (1.1, 1.0)])
    lathe(part, [(0.075, face - 0.02), (0.07, face - 0.005), (0.055, face + 0.002), (0.03, face + 0.004), (0.0, face + 0.004)], 24, center, ax, mat='alloy')
    # caliper peeking through the spokes
    box(part, center + Vector((-side * 0.0, 0.0, 0.0)) + ax * (w * 0.02) + Vector((0, 0.07, rim * 0.5)), (0.04, 0.09, 0.07), mat='trim')


# ---------------------------------------------------------------------------
def interior(part, kind, lod):
    k = K[kind]
    zA, zR = k['zA'], k['zR']
    fl = 0.42 if kind != 'pickup' else 0.55
    belt = k['belt']
    if lod == 1:
        box(part, V(0, belt - 0.12, (zA + zR) / 2), (1.5, 0.04, zA - zR - 0.1), mat='interior')
        return
    I = Matrix.Identity(4)
    seat_top = fl + 0.22
    fu = zA - 0.95 if kind != 'coupe' else zA - 0.85
    front = [0.36, -0.36] if kind != 'coupe' else [0.0]
    for s in front:
        T = Matrix.Translation(V(s, 0, 0))
        sh = 0.26 if kind != 'coupe' else 0.72
        cushion(part, sh, fu - 0.5, fu, fl + 0.02, seat_top, 1, T, bolster=0.06, mat='seat')
        cushion(part, sh, fu - 0.62, fu - 0.5, seat_top - 0.04, seat_top + 0.55, 1, T @ rot_about_s(-0.22, (0, seat_top, fu - 0.5)), pleat_dir=(1, 0), bolster=0.06, mat='seat')
        if kind != 'coupe':
            Mh = T @ rot_about_s(-0.22, (0, seat_top, fu - 0.5))
            box(part, Mh @ V(0, seat_top + 0.66, fu - 0.57), (0.26, 0.16, 0.08), mat='seat', bevel=0.03)
            box(part, Mh @ V(0, seat_top + 0.57, fu - 0.57), (0.1, 0.04, 0.03), mat='trim')
    ru = min(fu - 0.95, zR + 0.12 + 0.58)
    if ru < fu - 0.7 and kind != 'pickup':
        cushion(part, 0.68, ru - 0.46, ru, fl + 0.02, seat_top - 0.02, 1, I, mat='seat')
        cushion(part, 0.68, ru - 0.58, ru - 0.46, seat_top - 0.06, seat_top + 0.48, 1, rot_about_s(-0.25, (0, seat_top, ru - 0.46)), pleat_dir=(1, 0), mat='seat')
    # dashboard slab under the windscreen, wheel on the driver's side
    rings = []
    prof = [(zA + 0.02, belt + 0.01), (zA - 0.2, belt + 0.03), (zA - 0.3, belt - 0.02), (zA - 0.3, belt - 0.2), (zA - 0.15, belt - 0.3), (zA + 0.02, belt - 0.3)]
    for i in range(9):
        s = -0.8 + 1.6 * i / 8
        rings.append([V(s, h, u) for (u, h) in prof])
    f = part.grid(rings, mat='interior', cap0=True, cap1=True)
    orient(part, f, lambda c: V(C(c)[0] * 0.9, belt - 0.12, zA - 0.1))
    sw_c = V(0.36 if kind != 'coupe' else 0.38, belt + 0.02, zA - 0.42)
    ring = [sw_c + V(0.18 * math.cos(2 * math.pi * i / 20), 0.18 * math.sin(2 * math.pi * i / 20) * 0.85, 0.18 * math.sin(2 * math.pi * i / 20) * 0.5) for i in range(20)]
    sweep(part, ring, [(0.014 * math.cos(a), 0.014 * math.sin(a)) for a in [2 * math.pi * i / 6 for i in range(6)]],
          mat='interior' if kind != 'coupe' else 'ivory', closed_path=True, up=(0, -0.5, 0.85))


# ---------------------------------------------------------------------------
def build(kind, lod, coll):
    k = K[kind]
    tag = '' if lod == 0 else '_L1'
    S = spec_for(kind)
    B = Body(S, lod)
    half = S['half']
    step, n_end = (0.078, 9) if lod == 0 else (0.16, 4)
    ex = []
    for (a, b, _f) in S['opens']:
        ex += [a - 0.0015, a + 0.0015, b - 0.0015, b + 0.0015]
    us = stations(half, S['ruF'], S['ruR'], step, n_end, extra=ex)
    p, faces = B.build(kind + '_body' + tag, us)
    bmesh.ops.remove_doubles(p.bm, verts=p.bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(p.bm, faces=p.bm.faces)
    body = p.object(sharp=45)
    cut = []
    hub_h = k['R'] - 0.012
    for wz in (k['uF'], k['uR']):
        for s in (-1, 1):
            cut.append(cutter_cyl(V(s * 1.05, hub_h + 0.012, wz), (1, 0, 0), k['arch'], 0.8, segs=48 if lod == 0 else 24))
    if lod == 0:
        G = 0.004
        for s in (-1, 1):
            for uz in k['doors']:
                cut.append(fence([(s * 0.62, uz), (s * 1.3, uz)], k['zb'] + 0.06, k['belt'] + 0.03, G))
        if not k.get('vintage'):
            gw, g0, g1 = k['grille']
            cut.append(cutter_box(V(0, (g0 + g1) / 2, half), (gw * 2, g1 - g0, 0.34), bevel=0.02))
            # bumper covers: a horizontal seam across each end, split from the fenders at the arches
            for sgn, wz in ((1, k['uF']), (-1, k['uR'])):
                hb = k['zbe'] + 0.1
                cut.append(cutter_box(V(0, hb, sgn * (half - 0.1)), (2.4, G, 0.5)))
                ua = wz + sgn * (k['arch'] + 0.04)
                for s_ in (-1, 1):
                    cut.append(fence([(s_ * 0.55, ua), (s_ * 1.3, ua)], k['zb'] + 0.05, hb, G))
        if 'bed' not in k:
            hood_u = k['zA'] + 0.06
            cut.append(fence([(-0.9, hood_u), (0.9, hood_u)], k['cowl'] - 0.1, k['cowl'] + 0.2, G))
    boolean(body, cut)
    resmooth(body, 45)
    caster = Caster(body)
    ext = Part(kind + '_trim' + tag)
    glass = Part(kind + '_glass' + tag)
    gl_mat = k.get('glass', 'tint')
    gh, roof_y, gh_rings = greenhouse(kind, B, lod, glass, gl_mat)
    na = 8 if lod == 0 else 3
    vint = k.get('vintage')
    # lamps and grilles
    if not vint:
        (s0, h0, h1), (s1, h2, h3) = k['head']
        for sg in (-1, 1):
            shape = lambda a, b, sg=sg: (sg * lerp(s0, s1, a), lerp(lerp(h0, h2, a ** 1.5), lerp(h1, h3, a), b))
            surface_patch(ext, caster, shape, na, 2, True, 'trim', lift=0.002)
            if lod == 0:
                surface_patch(ext, caster, lambda a, b: shape(a, 0.1 + 0.8 * b), na, 2, True, 'glass', lift=0.016)
                for fa in (0.28, 0.62):
                    ps, ph = shape(fa, 0.55)
                    l2, n2 = caster.hit((ps, ph, 5), (0, 0, -1))
                    if l2:
                        rr = min(0.034, (lerp(h1, h3, fa) - lerp(h0, h2, fa ** 1.5)) * 0.36)
                        c = l2 + n2 * 0.002
                        f = lathe(ext, [(rr * 1.25, 0.0), (rr * 1.1, 0.004), (rr * 0.8, -0.002), (rr * 0.4, -0.008), (0.0, -0.01)], 20, c, n2, mat='chrome')
                        bmesh.ops.reverse_faces(ext.bm, faces=f)
                        lathe(ext, [(rr * 0.72, 0.0), (rr * 0.6, 0.006), (rr * 0.35, 0.01), (0.0, 0.0115)], 16, c, n2, mat='lens')
                pts = []
                for i in range(9):
                    ps, ph = shape(0.05 + 0.9 * i / 8, 0.12)
                    l2, n2 = caster.hit((ps, ph, 5), (0, 0, -1))
                    if l2:
                        pts.append(l2 + n2 * 0.006)
                if len(pts) > 2:
                    sweep(ext, pts, [(-0.004, -0.002), (0.004, -0.002), (0.004, 0.002), (-0.004, 0.002)], mat='ivory', up=(0, -1, 0))
            else:
                surface_patch(ext, caster, shape, na, 2, True, 'lens', lift=0.004)
        gw, g0, g1 = k['grille']
        if lod == 0:
            for sg in (-1, 1):
                pass
            # slats inside the recess cut in build(); a gloss-black surround ring
            loc, nor = caster.hit((0, g1 + 0.02, 5), (0, 0, -1))
            u0 = C(loc)[2] - 0.035
            box(ext, V(0, (g0 + g1) / 2, u0 - 0.03), (gw * 2, g1 - g0, 0.01), mat='trim')
            nr = max(3, int((g1 - g0) / 0.04))
            for i in range(nr):
                h = lerp(g0 + 0.02, g1 - 0.02, (i + 0.5) / nr)
                nc = int(gw * 2 / 0.06)
                for j in range(nc):
                    sx = lerp(-gw + 0.03, gw - 0.03, (j + 0.5 * (i % 2)) / max(1, nc - 0.5))
                    if abs(sx) > gw - 0.025:
                        continue
                    box(ext, V(sx, h, u0 - 0.008), (0.044, 0.026, 0.012), mat='grille', rot=Matrix.Rotation(math.radians(45), 3, 'Y'))
            pts = []
            for i in range(21):
                a = 2 * math.pi * i / 20
                ps, ph = gw * 1.0 * math.cos(a), (g0 + g1) / 2 + (g1 - g0) * 0.5 * math.sin(a)
                ps = max(-gw, min(gw, ps * 1.15))
                ph = max(g0, min(g1, (ph - (g0 + g1) / 2) * 1.15 + (g0 + g1) / 2))
                l2, n2 = caster.hit((ps, ph + (0.012 if ph > (g0 + g1) / 2 else -0.012), 5), (0, 0, -1))
                if l2:
                    pts.append(l2 + n2 * 0.003)
            if len(pts) > 4:
                sweep(ext, pts, [(-0.006, 0), (0, 0.006), (0.006, 0), (0, -0.002)], mat='chrome' if k.get('belt_chrome') else 'alloy', up=(0, -1, 0))
            if k.get('belt_chrome'):
                pts = []
                for i in range(13):
                    s_ = lerp(-gw - 0.01, gw + 0.01, i / 12)
                    l2, n2 = caster.hit((s_, g1 + 0.012, 5), (0, 0, -1))
                    if l2:
                        pts.append(l2 + n2 * 0.004)
                if len(pts) > 2:
                    sweep(ext, pts, [(-0.006, 0), (0, 0.006), (0.006, 0), (0, -0.002)], mat='chrome', up=(0, -1, 0))
        else:
            surface_patch(ext, caster, lambda a, b: (lerp(-gw, gw, a), lerp(g0, g1, b)), na, 2, True, 'trim', lift=0.002)
        surface_patch(ext, caster, lambda a, b: (lerp(-gw * 0.9, gw * 0.9, a), lerp(k['zbe'] + 0.005, k['zbe'] + 0.045, b)), na, 1, True, 'grille', lift=0.002)
    else:
        # vintage: round headlamps, chrome grille bars, chrome bumpers
        for sg in (-1, 1):
            for ds in (0.57, 0.76):
                loc, nor = caster.hit((sg * ds, 0.66, 5), (0, 0, -1))
                if loc:
                    f = len(ext.bm.faces)
                    headlamp(ext, loc - Vector((0, 0.004, 0)), V(0, 0, 1), lod, segs=22 if lod == 0 else 10, visor=False)
                    ext.transform(list(ext.bm.faces)[f:], Matrix.Translation(loc) @ Matrix.Scale(0.78, 4) @ Matrix.Translation(-loc))
        # full-width grille carrying the quad lamps, chrome surround
        pts = []
        for i in range(17):
            s_ = lerp(-0.9, 0.9, i / 16)
            l2, n2 = caster.hit((s_, 0.66, 5), (0, 0, -1))
            pts.append(l2)
        for i in range(16):
            a, b = pts[i], pts[i + 1]
            c = (a + b) / 2
            d = b - a
            box(ext, c + Vector((0, 0.004, 0)), (d.length + 0.002, 0.2, 0.012), mat='trim', rot=Matrix.Rotation(math.atan2(d.y, d.x), 3, 'Z'))
        for h in (0.575, 0.745):
            sweep(ext, [p + Vector((0, -0.01, h - 0.66)) for p in pts], [(0.008 * math.cos(t), 0.006 * math.sin(t)) for t in [2 * math.pi * i / 8 for i in range(8)]], mat='chrome', up=(0, -1, 0))
        for h in (0.62, 0.66, 0.70):
            sweep(ext, [p + Vector((0, -0.006, h - 0.66)) for p in pts[4:13]], [(0.004 * math.cos(t), 0.003 * math.sin(t)) for t in [2 * math.pi * i / 6 for i in range(6)]], mat='chrome', up=(0, -1, 0))
        for front in (True, False):
            h = 0.42 if front else 0.44
            path = [V(q.x, h, q.y) for q in plan_outline(B, front, 0.045, 9 if lod == 0 else 4, back=0.12)]
            prof = [(-0.03, -0.06), (0.0, -0.068), (0.035, -0.05), (0.05, -0.01), (0.05, 0.02), (0.035, 0.05), (0.0, 0.058), (-0.03, 0.05)]
            sweep(ext, path, [(a * (1 if front else -1), b) for a, b in prof], mat='chrome')
        # side trim strip
        for sg in (-1, 1):
            pts = []
            for i in range(21):
                u = 2.2 - 4.35 * i / 20
                loc, nor = caster.hit((sg * 3, 0.66, u), (-sg, 0, 0))
                if loc:
                    pts.append(loc + nor * 0.002)
            if len(pts) > 2:
                sweep(ext, pts, [(-0.006, 0), (0, 0.005), (0.006, 0), (0, -0.001)], mat='chrome', up=(sg, 0, 0))
    (t0s, t0h), (t1s, t1h) = k['tail_l']
    for sg in (-1, 1):
        if vint:
            loc, nor = caster.hit((sg * 0.75, 0.74, -5), (0, 0, 1))
            if loc:
                lathe(ext, [(0.0, 0.0), (0.055, 0.0), (0.057, 0.012), (0.045, 0.02), (0.0, 0.024)], 20, loc - nor * 0.004, nor, mat='tail')
                lathe(ext, [(0.055, 0.0), (0.066, 0.008), (0.062, 0.016), (0.056, 0.016)], 20, loc - nor * 0.004, nor, mat='chrome')
        else:
            surface_patch(ext, caster, lambda a, b, sg=sg: (sg * lerp(t0s, t1s, a), lerp(t0h, t1h, b)), na, 3, False, 'tail')
    # rear plate
    ph = (k['zbe'] + k['tail']) / 2 - 0.04 if not vint else 0.6
    surface_patch(ext, caster, lambda a, b: (lerp(-0.155, 0.155, a), lerp(ph - 0.075, ph + 0.075, b)), 3, 2, False, 'plate', lift=0.006)
    if lod == 0:
        # door handles, mirrors, wipers
        for sg in (-1, 1):
            for dz in k['doors'][:-1]:
                u = dz - 0.18 if not vint else dz - 0.25
                loc, nor = caster.hit((sg * 3, k['belt'] - 0.075, u), (-sg, 0, 0))
                if loc:
                    box(ext, loc + nor * 0.006, (0.02, 0.022, 0.14), mat='paint' if not vint else 'chrome', bevel=0.006)
                    box(ext, loc + nor * 0.001, (0.01, 0.034, 0.17), mat='trim')
            mz = k['zA'] - 0.14
            xb = (S['W0'] - S['tumble'] - S['rs']) * B.plan(mz)
            mc = V(sg * (xb + 0.16), k['belt'] + 0.1, mz)
            box(ext, mc, (0.19, 0.11, 0.085), mat='paint' if not vint else 'chrome', bevel=0.04)
            box(ext, mc + V(0, 0, -0.044), (0.16, 0.085, 0.006), mat='chrome', bevel=0.002)
            box(ext, V(sg * (xb + 0.05), k['belt'] + 0.05, mz + 0.01), (0.1, 0.028, 0.04), mat='trim', bevel=0.01)
            if vint:
                continue
        wy = k['cowl'] + 0.03
        for s0 in (-0.1, 0.55):
            path = [V(s0 - 0.5 + 0.5 * i / 4, wy + 0.006 * i, k['zA'] - 0.03 - 0.01 * i) for i in range(5)]
            sweep(ext, path, [(-0.006, 0), (0.006, 0), (0.004, 0.012), (-0.004, 0.012)], mat='trim', up=(0, 0, 1))
        if k.get('rails'):
            for sg in (-1, 1):
                path = [V(sg * (k['Wt'] - 0.1), roof_y(u) + 0.03, u) for u in [k['zRr'] + 0.05 + (k['zRf'] - k['zRr'] - 0.1) * i / 12 for i in range(13)]]
                sweep(ext, path, [(-0.012, -0.03), (0.012, -0.03), (0.012, 0.01), (-0.012, 0.01)], mat='trim', up=(0, 0, 1))
        if k.get('belt_chrome'):
            for sg in (-1, 1):
                pts = []
                for i in range(25):
                    u = k['sg'][0] - 0.05 + (k['sg'][1] + 0.02 - k['sg'][0]) * i / 24
                    kp = B.plan(u)
                    xb = (S['W0'] - S['tumble'] - S['rs']) * kp - 0.008
                    pts.append(V(*S['deform'](sg * xb, S['hs'](u) + 0.004, u)))
                sweep(ext, pts, [(-0.004, 0), (0.0, 0.004), (0.006, 0.0), (0, -0.004)], mat='chrome', up=(sg, 0, 0))
        if 'bed' in k:
            a, b, fl = k['bed']
            for sg in (-1, 1):
                box(ext, V(sg * (S['W0'] - 0.06), k['deck'] + 0.012, (a + b) / 2), (0.1, 0.02, b - a), mat='trim')
            box(ext, V(0, fl + 0.005, (a + b) / 2), (1.6, 0.01, b - a), mat='trim')
    interior(ext, kind, lod)
    # underbody and exhaust
    box(ext, V(0, k['zb'] - 0.03, 0), (1.5, 0.08, k['L'] - 1.1), mat='dark')
    if lod == 0:
        lathe(ext, [(0.035, -0.15), (0.037, 0.0), (0.03, 0.005), (0.028, -0.1)], 14, V(-0.55, k['zb'] - 0.02, -half + 0.12), V(0, 0, -1), mat='chrome' if vint else 'trim')
    # headliner under the roof
    if lod == 0:
        rr = []
        for u in [k['zRr'] + (k['zRf'] - k['zRr']) * i / 8 for i in range(9)]:
            y = roof_y(u) - 0.035
            rr.append([V(s, y - 0.02 * (s / 0.6) ** 2, u) for s in [0.6 - 1.2 * j / 6 for j in range(7)]])
        f = ext.grid(rr, mat='interior')
        orient(ext, f, lambda c: c + Vector((0, 0, 1)))
    for sg, u, nm in ((1, k['uF'], 'FL'), (-1, k['uF'], 'FR'), (1, k['uR'], 'RL'), (-1, k['uR'], 'RR')):
        wheel(ext, kind, lod, sg, V(sg * k['track'], hub_h, u))
    root = empty(kind + tag, (0, 0, 0), size=0.3)
    ghob = gh.object(sharp=40)
    exob = ext.object(sharp=40)
    glob = glass.object(sharp=30)
    for o in (body, ghob, exob, glob):
        o.parent = root
    objs = [root] + list(root.children_recursive)
    for o in objs:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
    n = sum(tris(o) for o in objs if o.type == 'MESH')
    return root, n
