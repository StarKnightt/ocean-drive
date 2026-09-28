# Late-50s style convertible (generic, no make): long hood, sweeping crease, modest fins,
# wraparound screen, full chrome, whitewalls, cream pleated benches, painted dash.
import bpy, bmesh, math
from mathutils import Vector, Matrix
from carlib import (V, C, Part, smoothstep, lerp, clamp, sweep, lathe, box, disc, orient, image_material,
                    cutter_box, cutter_cyl, fence, boolean, bevel, resmooth, Caster, empty, tris)
from body import Body, stations, plan_outline

HALF = 2.65
WB_F, WB_R = 1.58, -1.45
R = 0.36
TRACK = 0.805
HUB_H = R - 0.012          # tyres sit 12 mm into the road (contact patch)
OPEN = (-1.25, 0.78)
FLOOR = 0.44


def hs(u):
    if u >= OPEN[1]:
        t = (u - OPEN[1]) / (HALF - OPEN[1])
        return 0.955 - 0.075 * t ** 1.6
    if u >= -1.0:
        return 0.955 - 0.012 * math.sin(math.pi * (u + 1.0) / (OPEN[1] + 1.0))
    return 0.955 + 0.19 * smoothstep(-1.0, -2.62, u) ** 1.35


def hc(u):
    if u >= OPEN[1]:
        t = (u - OPEN[1]) / (HALF - OPEN[1])
        return hs(u) - 0.05 + 0.02 * t
    if u <= OPEN[0]:
        return 0.925 - 0.05 * smoothstep(-2.1, -2.65, u)
    return 0.93


def deform(s, h, u):
    """nose: grille band set back under an overhanging hood lip, fender tips proud;
    tail: rear panel recessed between the fins"""
    a = abs(s)
    if u > HALF - 0.4:
        t = smoothstep(HALF - 0.4, HALF, u)
        fs = 1 - smoothstep(0.5, 0.8, a)
        fh = smoothstep(0.38, 0.5, h) * (1 - smoothstep(0.74, 0.86, h))
        u -= 0.075 * t * fs * fh
        # hood leading edge rolls down over the lip
        u -= 0.03 * t * smoothstep(0.84, 0.9, h) * fs
    elif u < -(HALF - 0.4):
        t = smoothstep(-(HALF - 0.4), -HALF, u)
        fs = 1 - smoothstep(0.52, 0.72, a)
        fh = smoothstep(0.52, 0.62, h) * (1 - smoothstep(0.84, 0.9, h))
        u += 0.05 * t * fs * fh
        # the deck ends ahead of the fin tips: the fins sweep back past it
        t2 = smoothstep(-(HALF - 0.55), -HALF, u)
        u += 0.17 * t2 * (1 - smoothstep(0.5, 0.74, a)) * smoothstep(0.78, 0.9, h)
    return s, h, u


def hk(u):
    if u > 0:
        return 0.66 + 0.13 * smoothstep(0.1, 2.3, u)
    return 0.66 + 0.19 * smoothstep(-0.5, -2.45, u)


SPEC = dict(
    half=HALF, W0=0.995, ruF=0.28, pF=5.0, ruR=0.30, pR=4.5,
    zb=lambda u: 0.30 + 0.12 * smoothstep(HALF - 0.55, HALF, abs(u)),
    hs=hs, hc=hc, hk=hk,
    amp=lambda u: 0.011 * (1 - smoothstep(2.2, 2.55, u)) * (1 - smoothstep(-2.25, -2.55, u)),
    sin=lambda u: lerp(0.36, 0.17, smoothstep(-1.0, -1.9, u)) if u < 0 else 0.36,
    rs=0.05, rb=0.06, tumble=0.012, crown=0.01, deform=deform,
    opens=[(OPEN[0], OPEN[1], FLOOR)], wall_mat='vinyl2', floor_mat='dark',
)


# ---------------------------------------------------------------------------
def build_body(lod, name):
    B = Body(SPEC, lod)
    step, n_end = (0.05, 10) if lod == 0 else (0.11, 5)
    us = stations(HALF, SPEC['ruF'], SPEC['ruR'], step, n_end, extra=(OPEN[0] - 0.0015, OPEN[0] + 0.0015, OPEN[1] - 0.0015, OPEN[1] + 0.0015))
    p, faces = B.build(name, us)
    bmesh.ops.remove_doubles(p.bm, verts=p.bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(p.bm, faces=p.bm.faces)
    ob = p.object(sharp=45)
    cut = []
    for wz, ar in ((WB_F, 0.445), (WB_R, 0.435)):
        for s in (-1, 1):
            cut.append(cutter_cyl(V(s * 1.05, HUB_H + 0.01, wz), (1, 0, 0), ar, 0.9, segs=64 if lod == 0 else 32))
    if lod == 0:
        # grille opening and headlight hoods in the nose
        cut.append(cutter_box(V(0, 0.598, HALF + 0.0), (1.14, 0.205, 0.36), bevel=0.035))
        for s in (-1, 1):
            cut.append(cutter_cyl(V(s * 0.70, 0.748, HALF + 0.07), (0, -1, 0), 0.098, 0.30, segs=40))
        # panel gaps: doors, hood, trunk
        G = 0.0045
        for s in (-1, 1):
            for uz in (0.745, -0.55):
                cut.append(fence([(s * 0.72, uz), (s * 1.3, uz)], 0.33, 1.05, G))
            cut.append(cutter_box(V(s * 1.03, 0.352, (0.745 - 0.55) / 2), (0.16, G, 0.745 + 0.55)))
        cut.append(fence([(0.62, 0.81), (0.62, 2.52), (-0.62, 2.52), (-0.62, 0.81), (0.62, 0.81)], 0.72, 1.2, G))
        cut.append(fence([(0.58, -1.82), (0.58, -2.36), (-0.58, -2.36), (-0.58, -1.82), (0.58, -1.82)], 0.75, 1.2, G))
    boolean(ob, cut)
    if lod == 0:
        bevel(ob, width=0.0022, angle=35, segments=1)
    resmooth(ob, 45)
    return ob


# ---------------------------------------------------------------------------
def outline_path(caster, h, u_from_side, front=True, off=0.05, n=24, wrap=0.45, width=1.0):
    """bumper path: follows the nose / tail outline at height h, offset outwards, wrapping
    round the corners to u_from_side along the flanks"""
    sgn = 1 if front else -1
    pts = []
    for k in range(n + 1):
        s = -0.93 + 1.86 * k / n
        loc, nor = caster.hit((s * width, h, sgn * 4), (0, 0, -sgn))
        c = C(loc)
        pts.append(Vector((c[0], c[2] + sgn * off)))
    side = []
    for k in range(4):
        uu = sgn * (HALF - wrap + 0.1 * k)
        loc, nor = caster.hit((3, h, uu), (-1, 0, 0))
        side.append(Vector((C(loc)[0] + off * 0.8, uu)))
    return [Vector((-p.x, p.y)) for p in side] + pts + list(reversed(side))


def bumper(part, caster, front, lod):
    h = 0.44 if front else 0.46
    path2 = plan_outline(Body(SPEC, 0), front, 0.06 if front else 0.05, 16 if lod == 0 else 7)
    path = [V(p.x, h, p.y) for p in path2]
    prof = [(-0.045, -0.085), (0.0, -0.095), (0.05, -0.08), (0.07, -0.04), (0.078, 0.0), (0.072, 0.04), (0.05, 0.07),
            (0.015, 0.088), (-0.02, 0.085), (-0.05, 0.06), (-0.06, 0.0), (-0.055, -0.06)]
    if lod:
        prof = prof[::2]
    sgn = 1 if front else -1
    # profile frame: side = t x up; make the 'a' axis point outwards from the car
    ups = []
    for k, p in enumerate(path):
        ups.append((0, 0, 1))
    n = len(path)
    sc = [0.55 + 0.45 * smoothstep(0, 3, min(k, n - 1 - k)) for k in range(n)]
    f = sweep(part, path, [(a * sgn, b) for a, b in prof], mat='chrome', scales=[(1.0, s) for s in sc])
    return f


def headlamp(part, center, axis, lod, segs=None):
    segs = segs or (36 if lod == 0 else 16)
    bez = [(0.0985, -0.02), (0.104, 0.0), (0.106, 0.012), (0.102, 0.022), (0.094, 0.028), (0.086, 0.026), (0.082, 0.018)]
    lathe(part, bez, segs, center, axis, mat='chrome')
    dome = [(0.082, 0.012), (0.07, 0.022), (0.05, 0.029), (0.025, 0.033), (0.0, 0.034)]
    lathe(part, dome, segs, center, axis, mat='lens')


def build_wheel(lod, side, name, parent, loc):
    p = Part(name)
    ax = Vector((side, 0, 0))
    o = Vector((0, 0, 0))
    w = 0.098
    if lod == 0:
        prof = [(0.192, -0.078), (0.205, -0.088), (0.235, -0.096), (0.27, -0.099), (0.305, -0.097), (0.333, -0.088), (0.349, -0.074), (0.3575, -0.066)]
        cr = lambda x: R - 0.004 * (x / 0.066) ** 2
        rw = 0.124 / 5
        prof.append((cr(-0.062), -0.062))
        for k in range(1, 5):
            b = -0.062 + k * rw
            prof += [(cr(b), b - 0.003), (cr(b) - 0.006, b - 0.0012), (cr(b) - 0.006, b + 0.0012), (cr(b), b + 0.003)]
        prof.append((cr(0.062), 0.062))
        prof += [(0.3575, 0.066), (0.349, 0.074), (0.333, 0.088), (0.305, 0.097), (0.2955, 0.0985), (0.2935, 0.1008),
                 (0.289, 0.1012), (0.262, 0.1016), (0.238, 0.1012), (0.2345, 0.1005), (0.2325, 0.099), (0.215, 0.093), (0.2, 0.087), (0.192, 0.08)]
        segs = 36
    else:
        prof = [(0.192, -0.078), (0.25, -0.098), (0.33, -0.09), (0.358, -0.06), (0.36, 0.0), (0.358, 0.06), (0.33, 0.09),
                (0.2955, 0.099), (0.2935, 0.101), (0.2345, 0.101), (0.2325, 0.099), (0.192, 0.08)]
        segs = 24

    def col(co):
        r = math.hypot(co.y, co.z)
        a = co.x * side
        white = a > 0.0975 and 0.2338 < r < 0.2945
        return (0.86, 0.85, 0.81) if white else (0.03, 0.03, 0.03)
    f = lathe(p, [(r, a) for r, a in prof], segs, o, ax, mat='tyre')
    p.paint_color(f, col)
    # brake drum behind the hubcap (hides the open tyre centre)
    f = lathe(p, [(0.0, -0.035), (0.193, -0.035), (0.193, 0.07)], 16 if lod else 24, o, ax, mat='tyre')
    p.paint_color(f, (0.03, 0.03, 0.03))
    # painted rim ring, then the full chrome hubcap with a fluted band
    lathe(p, [(0.196, 0.074), (0.191, 0.083), (0.182, 0.0855), (0.173, 0.081)], segs, o, ax, mat='paint')
    hub = [(0.1735, 0.079), (0.1715, 0.091), (0.164, 0.1), (0.152, 0.1035), (0.138, 0.1045), (0.124, 0.106),
           (0.112, 0.109), (0.1, 0.112), (0.088, 0.115), (0.078, 0.117), (0.07, 0.12), (0.064, 0.126), (0.05, 0.134),
           (0.032, 0.14), (0.014, 0.1435), (0.0, 0.144)]
    if lod:
        hub = [(0.1735, 0.079), (0.164, 0.1), (0.138, 0.1045), (0.1, 0.112), (0.07, 0.12), (0.05, 0.134), (0.0, 0.144)]

    def flute(r, a, th, idx):
        if 0.08 < r < 0.126 and lod == 0:
            a += 0.0035 * math.cos(16 * th) * math.sin(math.pi * (r - 0.08) / 0.046)
        return r, a
    lathe(p, hub, segs if lod else 24, o, ax, mat='chrome', twist=flute)
    ob = p.object(sharp=50)
    ob.name = name + '_mesh'
    piv = empty(name, loc, parent, size=0.2)
    ob.parent = piv
    return piv


# ---------------------------------------------------------------------------
def gauge_image():
    img = bpy.data.images.get('gauge_face')
    if img:
        return img
    import numpy as np
    N = 256
    y, x = np.mgrid[0:N, 0:N]
    cx = (x - N / 2 + 0.5) / (N / 2)
    cy = (y - N / 2 + 0.5) / (N / 2)
    r = np.hypot(cx, cy)
    ang = np.degrees(np.arctan2(cx, cy))            # 0 = up, clockwise positive
    face = np.stack([0.86 - 0.18 * r, 0.83 - 0.18 * r, 0.74 - 0.2 * r], -1)
    ticks = (np.abs(ang) < 135) & (r > 0.72) & (r < 0.86)
    major = ticks & ((np.abs((ang + 135) % 27) < 1.6) | (np.abs((ang + 135) % 27) > 25.4))
    minor = ticks & (r > 0.78) & ((np.abs((ang + 135) % 6.75) < 0.7))
    band = (np.abs(ang) < 135) & (r > 0.88) & (r < 0.9)
    ring = (r > 0.25) & (r < 0.27)
    ink = major | minor | band | ring
    face[ink] = [0.08, 0.08, 0.09]
    red = (ang > 100) & (ang < 135) & (r > 0.86) & (r < 0.9)
    face[red] = [0.6, 0.08, 0.06]
    face[r > 0.97] = [0.35, 0.35, 0.36]
    rgba = np.concatenate([face, np.ones((N, N, 1))], -1).astype(np.float32)
    img = bpy.data.images.new('gauge_face', N, N)
    img.pixels.foreach_set(rgba[::-1].ravel())
    img.file_format = 'PNG'
    import os
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_src', 'gauge_face.png')
    img.filepath_raw = path
    img.save()
    return img


def cushion(part, s_half, u0, u1, h0, h1, lod, M, pleat_w=0.085, pleat_dir=(0, 1), bolster=0.13, mat='vinyl'):
    """pleated seat block: rounded (u, h) profile lofted across s, ends rounded. M: car-space transform
    applied after (for backrests). pleat_dir: profile normal (du, dh) that gets pleats"""
    du, dh = u1 - u0, h1 - h0
    rt, rbm = min(0.07, dh * 0.45), 0.02
    prof = []
    # rounded rectangle in (u, h), counter-clockwise from bottom-back
    def arc(cu, ch, r, a0, a1, n):
        for k in range(n):
            a = math.radians(a0 + (a1 - a0) * k / (n - 1))
            prof.append((cu + r * math.cos(a), ch + r * math.sin(a)))
    n = 2 if lod else 4
    arc(u1 - rbm, h0 + rbm, rbm, -90, 0, 2)
    arc(u1 - rt, h1 - rt, rt, 0, 90, n + 1)
    if not lod:
        for k in range(1, 4):
            prof.append((u1 - rt - (du - rt - 0.045) * k / 4, h1 + 0.004 * math.sin(math.pi * k / 4)))
    arc(u0 + 0.045, h1 - 0.045, 0.045, 90, 180, n)
    arc(u0 + rbm, h0 + rbm, rbm, 180, 270, 2)
    cu, ch = u0 + du / 2, h0 + dh / 2
    # outward normals of the profile (for the pleat displacement)
    m = len(prof)
    nrm = []
    for k in range(m):
        a, b = prof[(k - 1) % m], prof[(k + 1) % m]
        tx, ty = b[0] - a[0], b[1] - a[1]
        L = math.hypot(tx, ty) or 1
        nrm.append((ty / L, -tx / L))
    per = 2 if lod else 3
    ns = max(8, int(2 * s_half / pleat_w * per)) if not lod else 12
    rings = []
    for i in range(ns + 1):
        s = -s_half + 2 * s_half * i / ns
        e = clamp((s_half - abs(s)) / 0.06)
        k_end = math.sqrt(max(0.0, 1 - (1 - e) ** 2))
        inner = s_half - bolster
        if abs(s) < inner and not lod:
            fr = ((s + inner) / pleat_w) % 1.0
            pl = math.sin(math.pi * fr) ** 0.45
        else:
            pl = 1.0 if not lod else 0.0
        ring = []
        for (pu, ph), (nu, nh) in zip(prof, nrm):
            w = max(0.0, nu * pleat_dir[0] + nh * pleat_dir[1])
            d = (0.011 * pl - 0.004) * w * (1 if abs(s) < inner else 0.6)
            qu, qh = pu + nu * d, ph + nh * d
            qu, qh = cu + (qu - cu) * k_end, ch + (qh - ch) * k_end
            ring.append(M @ V(s, qh, qu))
        rings.append(ring)
    f = part.grid(rings, mat=mat, wrap_j=True, uv_tile=0.3)
    c = M @ V(0, ch, cu)
    orient(part, f, lambda x: c)
    return f


def rot_about_s(angle, pivot):
    """car-space rotation about the lateral axis through pivot (s,h,u); +angle tips the top back"""
    P = V(*pivot)
    return Matrix.Translation(P) @ Matrix.Rotation(angle, 4, 'X') @ Matrix.Translation(-P)


def build_interior(part, lod):
    I = Matrix.Identity(4)
    # carpet floor with transmission tunnel and a raised toe board
    rings = []
    ns, nu = (24, 20) if lod == 0 else (6, 5)
    for i in range(nu + 1):
        u = -1.23 + (0.77 + 1.23) * i / nu
        ring = []
        for j in range(ns + 1):
            s = 0.86 - 1.72 * j / ns
            h = FLOOR + 0.015 + 0.1 * math.exp(-(s / 0.2) ** 2) * smoothstep(-1.2, -0.4, u) + 0.22 * smoothstep(0.35, 0.75, u)
            ring.append(V(s, h, u))
        rings.append(ring)
    f = part.grid(rings, mat='carpet', uv_tile=0.5)
    orient(part, f, lambda c: c - Vector((0, 0, 1)))
    # benches: front (driver's) and rear
    for (u0, u1, top, bu0, bu1, bh1, tilt) in ((-0.33, 0.2, 0.62, -0.47, -0.33, 1.06, 0.2), (-1.08, -0.6, 0.6, -1.22, -1.08, 1.0, 0.17)):
        cushion(part, 0.8, u0, u1, FLOOR + 0.02, top, lod, I, pleat_dir=(0, 1))
        cushion(part, 0.8, bu0, bu1, top - 0.03, bh1, lod, rot_about_s(-tilt, (0, top, bu1)), pleat_dir=(1, 0))
        # plinth under the cushion
        box(part, V(0, FLOOR + 0.08, (u0 + u1) / 2), (1.5, 0.12, u1 - u0 - 0.1), mat='dark')
    # soft-top boot over the folded top, behind the rear seat
    rings = []
    nb = 28 if lod == 0 else 8
    for i in range(nb + 1):
        s = -0.8 + 1.6 * i / nb
        e = clamp((0.8 - abs(s)) / 0.12)
        kk = math.sqrt(max(0.0, 1 - (1 - e) ** 2))
        ring = []
        for k in range(13 if lod == 0 else 7):
            a = math.pi * k / (12 if lod == 0 else 6)
            u = -1.47 + 0.22 * math.cos(a)
            h = 0.915 + (0.06 * kk + 0.01) * math.sin(a) ** 0.8
            ring.append(V(s, h, u))
        rings.append(ring)
    f = part.grid(rings, mat='vinyl', uv_tile=0.3)
    orient(part, f, lambda c: V(C(c)[0], 0.85, -1.49))
    # dashboard: painted steel across the cowl, chrome strip, gauges, radio
    rings = []
    prof = [(0.8, 0.93), (0.72, 0.962), (0.64, 0.968), (0.595, 0.952), (0.572, 0.915), (0.565, 0.86), (0.572, 0.78), (0.6, 0.72), (0.66, 0.69), (0.78, 0.68)]
    nd = 36 if lod == 0 else 8
    for i in range(nd + 1):
        s = -0.87 + 1.74 * i / nd
        rings.append([V(s, h, u) for (u, h) in prof])
    f = part.grid(rings, mat='paint', cap0=True, cap1=True)
    orient(part, f, lambda c: V(C(c)[0] * 0.9, 0.83, 0.74))
    if lod == 0:
        strip = [V(-0.85 + 1.7 * i / 20, 0.858, 0.5645 - 0.0) for i in range(21)]
        sweep(part, strip, [(0, -0.009), (0.004, -0.006), (0.005, 0), (0.004, 0.006), (0, 0.009)], up=(0, -1, 0))
        # gauge pod before the driver
        image_material('gauge', gauge_image())
        nrm = V(0, 0.34, -1).normalized()
        upv = V(0, 1, 0.34).normalized()
        for (s, h, r) in ((0.42, 0.893, 0.072), (0.265, 0.9, 0.034), (0.575, 0.9, 0.034)):
            c = V(s, h, 0.575)
            disc(part, c - nrm * 0.004, nrm, upv, r, 'gauge', segs=32)
            lathe(part, [(r + 0.002, -0.004), (r + 0.012, 0.004), (r + 0.01, 0.013), (r + 0.002, 0.012)], 32, c, nrm, mat='chrome')
            nd_ = (upv * math.cos(0.9) + upv.cross(nrm) * math.sin(0.9)).normalized()
            sweep(part, [c + nrm * 0.003, c + nrm * 0.003 + nd_ * r * 0.78], [(0.0022, 0.0006), (0, 0.0012), (-0.0022, 0.0006), (0, 0)], mat='tail', up=nrm)
        lathe(part, [(0.0, 0.0), (0.02, 0.0), (0.02, 0.02), (0.0, 0.02)], 24, V(0.42, 0.893, 0.575) - nrm * 0.004, nrm, mat='chrome')
        # radio face and knobs, glovebox
        box(part, V(0, 0.905, 0.575), (0.24, 0.07, 0.012), mat='chrome', bevel=0.004)
        for k in range(5):
            box(part, V(0, 0.885 + k * 0.01, 0.567), (0.19, 0.0035, 0.004), mat='dark')
        for s in (-0.16, 0.16):
            lathe(part, [(0.0, 0.0), (0.016, 0.0), (0.015, 0.018), (0.0, 0.02)], 16, V(s, 0.905, 0.568), V(0, 0, -1), mat='chrome')
        box(part, V(-0.42, 0.84, 0.574), (0.3, 0.1, 0.008), mat='chrome', bevel=0.003)
        box(part, V(-0.42, 0.84, 0.570), (0.28, 0.085, 0.006), mat='paint', bevel=0.002)
        # door furniture: armrests, window cranks and handles
        for s in (-1, 1):
            box(part, V(s * 0.815, 0.735, -0.08), (0.06, 0.055, 0.46), mat='vinyl', bevel=0.02)
            box(part, V(s * 0.812, 0.8, 0.28), (0.03, 0.015, 0.12), mat='chrome', bevel=0.005)
            lathe(part, [(0.0, 0.0), (0.02, 0.0), (0.018, 0.015), (0.0, 0.02)], 16, V(s * 0.83, 0.62, 0.05), V(-s, 0, 0), mat='chrome')
            box(part, V(s * 0.8, 0.62, 0.11), (0.012, 0.012, 0.1), mat='chrome')
            # rear quarter trim
            box(part, V(s * 0.8, 0.75, -0.95), (0.06, 0.06, 0.4), mat='vinyl', bevel=0.02)
    # column and shifter (the wheel itself is its own node)
    top = V(0.42, 0.965, 0.37)
    d = V(0, -math.sin(math.radians(30)), math.cos(math.radians(30)))
    col = [top + d * (0.05 + 0.3 * k / 6) for k in range(7)]
    sweep(part, col, [(0.022 * math.cos(a), 0.022 * math.sin(a)) for a in [2 * math.pi * k / 12 for k in range(12)]], mat='paint', up=(1, 0, 0))
    if lod == 0:
        sh = [top + d * 0.1 + V(0, 0, 0), top + d * 0.1 + V(-0.08, 0.02, -0.03), top + d * 0.1 + V(-0.2, 0.05, -0.08)]
        sweep(part, sh, [(0.006 * math.cos(a), 0.006 * math.sin(a)) for a in [2 * math.pi * k / 8 for k in range(8)]], mat='chrome', up=(0, 0, 1))
        lathe(part, [(0.0, -0.02), (0.016, -0.012), (0.016, 0.012), (0.0, 0.02)], 12, sh[-1], (sh[-1] - sh[-2]).normalized(), mat='ivory')


def build_steering(lod, parent):
    """wheel in its own frame: rim in local XZ, axis local +Y pointing down the column"""
    p = Part('steering_wheel' if lod == 0 else 'steering_wheel_L1')
    o = Vector((0, 0, 0))
    Y = Vector((0, 1, 0))
    rim_r, tube = 0.205, 0.0115
    segs = 48 if lod == 0 else 24
    rim = [Vector((rim_r * math.cos(2 * math.pi * k / segs), 0, rim_r * math.sin(2 * math.pi * k / segs))) for k in range(segs)]
    tube_prof = [(tube * math.cos(a), tube * 1.15 * math.sin(a)) for a in [2 * math.pi * k / (12 if lod == 0 else 6) for k in range(12 if lod == 0 else 6)]]
    sweep(p, rim, tube_prof, mat='ivory', closed_path=True, up=(0, 1, 0))
    for ang in (-12, 192):
        a = math.radians(ang)
        d = Vector((math.cos(a), 0, math.sin(a)))
        path = [d * 0.03 + Y * 0.035, d * 0.1 + Y * 0.02, d * (rim_r - 0.004)]
        sweep(p, path, [(0.012 * math.cos(t), 0.005 * math.sin(t)) for t in [2 * math.pi * k / 8 for k in range(8)]], mat='ivory', up=(0, 1, 0))
    if lod == 0:
        ring = [Vector((0.14 * math.cos(math.radians(a)), 0.02, 0.14 * math.sin(math.radians(a)))) for a in range(-10, 191, 10)]
        sweep(p, ring, [(0.004 * math.cos(t), 0.004 * math.sin(t)) for t in [2 * math.pi * k / 8 for k in range(8)]], mat='chrome', up=(0, 1, 0))
    lathe(p, [(0.0, 0.0), (0.03, 0.005), (0.042, 0.02), (0.045, 0.04), (0.04, 0.05)], 24 if lod == 0 else 10, o, -Y, mat='chrome')
    ob = p.object(sharp=50)
    ob.name = p.name + '_mesh'
    top = V(0.42, 0.965, 0.37)
    d = V(0, -math.sin(math.radians(30)), math.cos(math.radians(30)))
    X = Vector((1, 0, 0))
    Z = X.cross(d).normalized()
    M = Matrix((X, d, Z)).transposed().to_4x4()
    M.translation = top
    piv = empty(p.name, (0, 0, 0), parent, size=0.1)
    piv.matrix_world = M
    ob.parent = piv
    return piv


def windscreen(part_chrome, part_glass, caster, lod):
    def wrap(width, u0, rw, back, n):
        # plan path left end (back) -> across -> right end
        segs = []
        L1 = back - rw
        La = math.pi / 2 * rw
        L2 = 2 * (width - rw)
        total = 2 * L1 + 2 * La + L2
        out = []
        for k in range(n + 1):
            d = total * k / n
            if d < L1:
                out.append((width, u0 - back + d))
            elif d < L1 + La:
                a = (d - L1) / rw
                out.append((width - rw + rw * math.cos(a), u0 - rw + rw * math.sin(a)))
            elif d < L1 + La + L2:
                out.append((width - rw - (d - L1 - La), u0))
            elif d < L1 + 2 * La + L2:
                a = math.pi / 2 + (d - L1 - La - L2) / rw
                out.append((-width + rw + rw * math.cos(a), u0 - rw + rw * math.sin(a)))
            else:
                out.append((-width, u0 - rw - (d - L1 - 2 * La - L2)))
        return out
    n = 40 if lod == 0 else 14
    base = wrap(0.905, 0.80, 0.30, 0.36, n)
    top = wrap(0.845, 0.53, 0.25, 0.14, n)
    bh = []
    for (s, u) in base:
        loc, nor = caster.hit((s, 2.0, u), (0, -1, 0))
        bh.append(C(loc)[1] + 0.008 if loc else 0.96)
    B = [V(s, h, u) for (s, u), h in zip(base, bh)]
    T = [V(s, 1.375 - 0.03 * (s / 0.845) ** 2, u) for (s, u) in top]
    rows = 4 if lod == 0 else 2
    rings = [[B[k].lerp(T[k], j / rows) for j in range(rows + 1)] for k in range(len(B))]
    part_glass.grid(rings, mat='glass', uv_tile=1)
    # chrome surround: header, posts, base channel
    tp = [(0.007 * math.cos(a), 0.012 * math.sin(a)) for a in [2 * math.pi * k / 10 for k in range(10)]]
    sweep(part_chrome, [t + Vector((0, 0, 0.004)) for t in T], tp, mat='chrome', up=(0, 0, 1))
    for k in (0, len(B) - 1):
        path = [B[k].lerp(T[k], j / 6) for j in range(7)]
        path = [B[k] - (T[k] - B[k]).normalized() * 0.05] + path + [T[k] + (T[k] - B[k]).normalized() * 0.01]
        sweep(part_chrome, path, [(0.014 * math.cos(a), 0.01 * math.sin(a)) for a in [2 * math.pi * k / 10 for k in range(10)]], mat='chrome', up=(0, -1, 0))
    sweep(part_chrome, [b + Vector((0, 0, 0.004)) for b in B], [(0.008 * math.cos(a), 0.006 * math.sin(a)) for a in [2 * math.pi * k / 8 for k in range(8)]], mat='chrome', up=(0, 0, 1))
    if lod == 0:
        # vent wings behind the posts
        for k, sg in ((0, 1), (len(B) - 1, -1)):
            b, t = B[k], T[k]
            s_ = C(b)[0]
            rear_u = 0.14
            loc, _n = caster.hit((s_, 2.0, rear_u), (0, -1, 0))
            rb = V(s_ - sg * 0.004, C(loc)[1] + 0.01, rear_u)
            rt = V(s_ - sg * 0.02, 1.19, rear_u)
            quad = [[b.lerp(t, j / 3) for j in range(4)], [rb.lerp(rt, j / 3) for j in range(4)]]
            part_glass.grid(quad, mat='glass', uv_tile=1)
            fr = [t, rt, rb]
            sweep(part_chrome, fr, [(0.006 * math.cos(a), 0.006 * math.sin(a)) for a in [2 * math.pi * k / 8 for k in range(8)]], mat='chrome', up=(sg, 0, 0))
        # rear-view mirror on the header
        c = V(0, 1.335, 0.5)
        sweep(part_chrome, [V(0, 1.385, 0.52), c], [(0.005 * math.cos(a), 0.005 * math.sin(a)) for a in [2 * math.pi * k / 8 for k in range(8)]], mat='chrome', up=(1, 0, 0))
        box(part_chrome, c, (0.21, 0.06, 0.018), mat='chrome', bevel=0.008, rot=Matrix.Rotation(0.25, 3, 'X'))


def trims(part, caster, lod):
    # side spears along the crease, rocker strips
    for sg in (-1, 1):
        pts, sc = [], []
        n = 36 if lod == 0 else 10
        u0, u1 = 2.38, -0.42
        for k in range(n + 1):
            u = u0 + (u1 - u0) * k / n
            loc, nor = caster.hit((sg * 2, hk(u) + 0.011, u), (-sg, 0, 0))
            if loc:
                pts.append(loc + nor * 0.002)
                t = k / n
                sc.append(max(0.25, min(1.0, t * 6, (1 - t) * 3)))
        sweep(part, pts, [(-0.008, 0), (-0.006, 0.004), (0, 0.0065), (0.006, 0.004), (0.008, 0), (0, -0.001)],
              mat='chrome', up=(sg, 0, 0), scales=[(s, 1.0) for s in sc])
        pts = []
        for k in range(n + 1):
            u = 1.1 - 2.1 * k / n
            loc, nor = caster.hit((sg * 2, 0.385, u), (-sg, 0, 0))
            if loc:
                pts.append(loc + nor * 0.001)
        sweep(part, pts, [(-0.014, 0), (-0.01, 0.004), (0.01, 0.004), (0.014, 0), (0, -0.001)], mat='chrome', up=(sg, 0, 0))
        if lod == 0:
            # push-button door handle
            loc, nor = caster.hit((sg * 2, 0.905, -0.42), (-sg, 0, 0))
            box(part, loc + nor * 0.008, (0.018, 0.026, 0.16), mat='chrome', bevel=0.007)
    # grille surround and bars
    if lod == 0:
        loop = []
        W2, H0, H1, rr = 0.565, 0.498, 0.698, 0.035
        cs = [(W2 - rr, H1 - rr, 0, 90), (-W2 + rr, H1 - rr, 90, 180), (-W2 + rr, H0 + rr, 180, 270), (W2 - rr, H0 + rr, 270, 360)]
        for (cx, cy, a0, a1) in cs:
            for k in range(6):
                a = math.radians(a0 + (a1 - a0) * k / 5)
                loop.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        path = []
        for (s, h) in loop:
            loc, nor = caster.hit((s * 1.03, h + (0.012 if h > 0.6 else -0.012), 4), (0, 0, -1))
            path.append(loc + Vector((0, -0.004, 0)))
        sweep(part, path, [(0.013 * math.cos(a), 0.009 * math.sin(a)) for a in [2 * math.pi * k / 10 for k in range(10)]],
              mat='chrome', closed_path=True, up=(0, -1, 0), cap=False)
        for k, h in enumerate((0.54, 0.58, 0.62, 0.66)):
            bar = []
            for j in range(15):
                s = -0.54 + 1.08 * j / 14
                loc, nor = caster.hit((s * 1.1, 0.75, 4), (0, 0, -1))
                bar.append(V(s, h, C(loc)[2] - 0.085))
            sweep(part, bar, [(0.011 * math.cos(a), 0.0075 * math.sin(a)) for a in [2 * math.pi * k / 10 for k in range(10)]], mat='chrome', up=(0, -1, 0))
        for s in (-0.18, 0.18):
            box(part, V(s, 0.6, HALF - 0.075), (0.016, 0.17, 0.03), mat='chrome', bevel=0.005)
    else:
        loc, nor = caster.hit((0, 0.6, 4), (0, 0, -1))
        u = C(loc)[2]
        box(part, V(0, 0.598, u - 0.004), (1.12, 0.2, 0.02), mat='dark')
        for h in (0.5, 0.54, 0.58, 0.62, 0.66, 0.698):
            box(part, V(0, h, u + 0.004), (1.12 if h in (0.5, 0.698) else 1.06, 0.012, 0.014), mat='chrome')
    if True:
        # headlamps, parking lamps
        for sg in (-1, 1):
            c = V(sg * 0.70, 0.748, HALF - 0.035)
            loc, nor = caster.hit((sg * 0.70, 0.748, 4), (0, 0, -1))
            headlamp(part, V(sg * 0.70, 0.748, C(loc)[2] - 0.01) if loc else c, V(0, 0, 1), lod)
            loc, nor = caster.hit((sg * 0.74, 0.585, 4), (0, 0, -1))
            if loc and lod == 0:
                lathe(part, [(0.036, -0.005), (0.038, 0.004), (0.03, 0.01), (0.0, 0.014)], 20, loc, nor, mat='amber')
                lathe(part, [(0.035, -0.004), (0.043, 0.002), (0.041, 0.008), (0.037, 0.009)], 20, loc, nor, mat='chrome')
        # tail lamps in the fin ends
        for sg in (-1, 1):
            loc, nor = caster.hit((sg * 0.83, 1.0, -4), (0, 0, 1))
            if loc:
                ax = nor
                c0 = loc - ax * 0.01
                f1 = lathe(part, [(0.0, 0.0), (0.05, 0.0), (0.052, 0.02), (0.046, 0.042), (0.03, 0.052), (0.0, 0.056)], 24, c0, ax, mat='tail')
                f2 = lathe(part, [(0.05, 0.0), (0.06, 0.012), (0.058, 0.024), (0.052, 0.026)], 24, c0, ax, mat='chrome')
                Mz = Matrix.Translation(c0) @ Matrix.Diagonal((0.85, 1.0, 2.1, 1.0)) @ Matrix.Translation(-c0)
                part.transform(f1 + f2, Mz)
            loc, nor = caster.hit((sg * 0.80, 0.84, -4), (0, 0, 1))
            if loc:
                box(part, loc + nor * 0.006, (0.12, 0.04, 0.02), mat='tail', bevel=0.008)
    if lod == 0:
        # trunk lock, exhaust
        loc, nor = caster.hit((0, 1.5, -2.42), (0, -1, 0))
        if loc:
            lathe(part, [(0.0, 0.0), (0.028, 0.0), (0.026, 0.012), (0.0, 0.016)], 16, loc, nor, mat='chrome')
        lathe(part, [(0.028, -0.2), (0.03, 0.0), (0.024, 0.006), (0.022, -0.1)], 16, V(-0.55, 0.26, -2.7), V(0, 0, -1), mat='chrome')
        # driver's side mirror on the door top
        loc, nor = caster.hit((0.95, 2, 0.6), (0, -1, 0))
        if loc:
            sweep(part, [loc - Vector((0, 0, 0.01)), loc + Vector((0.01, 0, 0.1))], [(0.006 * math.cos(a), 0.006 * math.sin(a)) for a in [2 * math.pi * k / 8 for k in range(8)]], up=(1, 0, 0))
            lathe(part, [(0.0, -0.03), (0.045, -0.02), (0.05, 0.0), (0.0, 0.004)], 20, loc + Vector((0.012, 0, 0.13)), V(0, 0.1, -1).normalized(), mat='chrome')
    # rear plate on the bumper
    box(part, V(0, 0.46, -HALF - 0.12), (0.31, 0.155, 0.008), mat='plate', bevel=0.004)


def build(lod, coll):
    tag = '' if lod == 0 else '_L1'
    root = empty('convertible' + tag, (0, 0, 0), size=0.3)
    body = build_body(lod, 'body' + tag)
    caster = Caster(body)
    extra = Part('trim' + tag)
    bumper(extra, caster, True, lod)
    bumper(extra, caster, False, lod)
    trims(extra, caster, lod)
    glass = Part('glass' + tag)
    windscreen(extra, glass, caster, lod)
    build_interior(extra, lod)
    # dark chassis core under the body
    box(extra, V(0, 0.28, 0), (1.6, 0.1, 4.4), mat='dark')
    ex = extra.object(sharp=40)
    gl = glass.object(sharp=0)
    for o in (body, ex, gl):
        o.parent = root
    wheels = []
    for nm, s, u in (('FL', 1, WB_F), ('FR', -1, WB_F), ('RL', 1, WB_R), ('RR', -1, WB_R)):
        wheels.append(build_wheel(lod, s, 'wheel_' + nm + tag, root, V(s * TRACK, HUB_H, u)))
    sw = build_steering(lod, root)
    if lod == 0:
        empty('driver_seat', V(0.42, 0.62, -0.1), root)
        empty('driver_eye', V(0.42, 1.24, -0.12), root)
    objs = [root] + list(root.children_recursive)
    for o in objs:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
    n = sum(tris(o) for o in objs if o.type == 'MESH')
    return root, n
