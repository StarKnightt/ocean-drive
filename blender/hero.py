# Late-50s style convertible (generic, no make): long hood, sweeping crease, modest fins,
# wraparound screen, full chrome, whitewalls, cream pleated benches, painted dash.
import bpy, bmesh, math
from mathutils import Vector, Matrix
from carlib import (V, C, Part, smoothstep, lerp, clamp, sweep, lathe, box, disc, orient, image_material,
                    cutter_box, cutter_cyl, fence, boolean, bevel, resmooth, Caster, empty, tris)
from body import Body, stations, plan_outline

HALF = 2.70
WB_F, WB_R = 1.34, -1.62   # long front overhang, the rear wheels well back under the fins
R = 0.36
TRACK = 0.805
HUB_H = R - 0.012          # tyres sit 12 mm into the road (contact patch)
OPEN = (-1.30, 0.66)
FLOOR = 0.44
DF, DR = -0.12, -0.05      # cockpit furniture offsets (front / rear) from the first layout
LAMP_S, LAMP_H = 0.72, 0.785   # headlamp centres
GR_W, GR_H = 0.63, 0.59        # grille half width / centre height (fills the width between the lamps)


def hs(u):
    """beltline: low and level through the doors, falling a little to the nose; the rear
    fenders rise into fins"""
    if u >= OPEN[1]:
        t = (u - OPEN[1]) / (HALF - OPEN[1])
        return 0.935 - 0.05 * t ** 1.6
    base = 0.935 - 0.01 * math.sin(math.pi * clamp((u - OPEN[1]) / (-1.0 - OPEN[1])))
    return base + 0.115 * smoothstep(-0.55, -2.62, u) ** 1.25


def hc(u):
    if u >= OPEN[1]:
        # hood between the fender tops (crowned in deform)
        t = (u - OPEN[1]) / (HALF - OPEN[1])
        return hs(u) - 0.035 + 0.01 * t
    if u <= OPEN[0]:
        # deck: level behind the boot, the trunk lid curving down into the rear panel
        return 0.905 - 0.13 * smoothstep(-1.85, -2.7, u) ** 1.3
    return 0.92


def hk(u):
    """the side crease / chrome spear: above the front arch, dipping behind the door and
    kicking back up over the rear wheel; the two-tone colour sits above it on the rear half"""
    base = 0.83 + 0.012 * smoothstep(0.0, -1.5, u)
    dip = 0.17 * smoothstep(0.35, -0.5, u) * (1 - smoothstep(-0.62, -1.28, u))
    return base - dip


def deform(s, h, u):
    """nose: grille band set back under an overhanging hood lip, fender tips proud, hood
    crowned; tail: rear panel recessed between the fins, the fin tips reaching past it"""
    a = abs(s)
    if OPEN[1] < u < HALF - 0.05 and h > 0.8:
        t = smoothstep(OPEN[1], OPEN[1] + 0.35, u) * (1 - smoothstep(HALF - 0.5, HALF - 0.08, u))
        h += 0.032 * t * max(0.0, 1 - (s / 0.52) ** 2) ** 2
    if u > HALF - 0.4:
        t = smoothstep(HALF - 0.4, HALF, u)
        fs = 1 - smoothstep(0.5, 0.8, a)
        fh = smoothstep(0.38, 0.5, h) * (1 - smoothstep(0.74, 0.86, h))
        u -= 0.075 * t * fs * fh
        # hood leading edge rolls down over the lip
        u -= 0.03 * t * smoothstep(0.82, 0.88, h) * fs
    elif u < -(HALF - 0.4):
        t = smoothstep(-(HALF - 0.4), -HALF, u)
        fs = 1 - smoothstep(0.52, 0.72, a)
        fh = smoothstep(0.52, 0.6, h) * (1 - smoothstep(0.72, 0.78, h))
        u += 0.05 * t * fs * fh
        # the deck ends ahead of the fin tips: the fins sweep back past it
        t2 = smoothstep(-(HALF - 0.6), -HALF, u)
        u += 0.2 * t2 * (1 - smoothstep(0.5, 0.76, a)) * smoothstep(0.64, 0.74, h)
    return s, h, u


def classify(s, h, u):
    # two-tone: ivory above the spear on the rear half and the fins
    if u < 0.32 and abs(s) > 0.7 and h > hk(u) + 0.004 and h > 0.55:
        return 'paint2'
    return None


SPEC = dict(
    half=HALF, W0=0.995, ruF=0.28, pF=5.0, ruR=0.30, pR=4.2,
    zb=lambda u: 0.30 + 0.12 * smoothstep(HALF - 0.55, HALF, abs(u)),
    hs=hs, hc=hc, hk=hk,
    amp=lambda u: 0.02 * (1 - smoothstep(2.25, 2.6, u)) * (1 - smoothstep(-2.3, -2.6, u)),
    sin=lambda u: lerp(0.36, 0.15, smoothstep(-0.8, -1.9, u)) if u < 0 else 0.36,
    rs=0.05, rb=0.06, tumble=0.028, crown=0.012, deform=deform, classify=classify,
    opens=[(OPEN[0], OPEN[1], FLOOR)], wall_mat='vinyl2', floor_mat='dark',
)


# ---------------------------------------------------------------------------
def build_body(lod, name):
    B = Body(SPEC, lod)
    step, n_end = (0.07, 10) if lod == 0 else (0.12, 5)
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
        # full-width grille opening and the headlamp sockets in the nose
        cut.append(cutter_box(V(0, GR_H, HALF + 0.0), (GR_W * 2 + 0.02, 0.2, 0.36), bevel=0.035))
        for s in (-1, 1):
            cut.append(cutter_cyl(V(s * LAMP_S, LAMP_H, HALF + 0.07), (0, -1, 0), 0.088, 0.30, segs=40))
        # panel gaps: doors, hood, trunk
        G = 0.0045
        d0, d1 = OPEN[1] - 0.04, -0.62
        for s in (-1, 1):
            for uz in (d0, d1):
                cut.append(fence([(s * 0.72, uz), (s * 1.3, uz)], 0.33, 1.05, G))
            cut.append(cutter_box(V(s * 1.03, 0.352, (d0 + d1) / 2), (0.16, G, d0 - d1)))
        cut.append(fence([(0.6, 0.69), (0.6, 2.57), (-0.6, 2.57), (-0.6, 0.69), (0.6, 0.69)], 0.72, 1.2, G))
        cut.append(fence([(0.56, -1.66), (0.56, -2.4), (-0.56, -2.4), (-0.56, -1.66), (0.56, -1.66)], 0.79, 1.2, G))
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


def resample(pts, step):
    L = [0.0]
    for a, b in zip(pts, pts[1:]):
        L.append(L[-1] + (b - a).length)
    n = max(2, round(L[-1] / step))
    out, j = [], 0
    for k in range(n + 1):
        d = L[-1] * k / n
        while j < len(L) - 2 and L[j + 1] < d:
            j += 1
        t = (d - L[j]) / max(1e-9, L[j + 1] - L[j])
        out.append(pts[j].lerp(pts[j + 1], t))
    return out


def bumper(part, caster, front, lod):
    """massive wraparound chrome bar; the rear one dips in the middle round a plate recess"""
    h = 0.44 if front else 0.47
    path2 = resample(plan_outline(Body(SPEC, 0), front, 0.07 if front else 0.06, 24), 0.075 if lod == 0 else 0.16)
    path = []
    for p in path2:
        hh = h
        if not front:
            hh -= 0.075 * (1 - smoothstep(0.24, 0.34, abs(p.x)))
        path.append(V(p.x, hh, p.y))
    prof = [(-0.05, -0.1), (0.0, -0.112), (0.06, -0.095), (0.088, -0.05), (0.098, 0.0), (0.09, 0.045), (0.062, 0.08),
            (0.02, 0.1), (-0.025, 0.097), (-0.058, 0.07), (-0.07, 0.0), (-0.064, -0.07)]
    if lod:
        prof = prof[::2]
    sgn = 1 if front else -1
    n = len(path)
    sc = [0.55 + 0.45 * smoothstep(0, 3, min(k, n - 1 - k)) for k in range(n)]
    f = sweep(part, path, [(a * sgn, b) for a, b in prof], mat='chrome', scales=[(1.0, s) for s in sc])
    if lod == 0:
        # bumper guards: tall chrome over-riders with bullet tips on the front bar
        for gs in ((-0.42, 0.42) if front else (-0.5, 0.5)):
            loc, nor = caster.hit((gs, h, sgn * 4), (0, 0, -sgn))
            if not loc:
                continue
            c = V(gs, h, C(loc)[2] + sgn * 0.13)
            box(part, c + V(0, 0.05 if front else 0.04, -sgn * 0.02), (0.07, 0.24 if front else 0.2, 0.07), mat='chrome', bevel=0.03)
            if front:
                lathe(part, [(0.0, -0.02), (0.05, -0.02), (0.055, 0.02), (0.046, 0.06), (0.028, 0.09), (0.0, 0.105)],
                      28, c + V(0, 0.03, 0), V(0, 0, 1), mat='chrome')
    return f


def headlamp(part, center, axis, lod, segs=None, visor=True):
    """thick chrome bezel, chrome reflector bowl with a bulb, clear domed lens, chrome
    eyebrow hood over the top"""
    segs = segs or (28 if lod == 0 else 16)
    axis = Vector(axis).normalized()
    bez = [(0.084, -0.03), (0.1, -0.02), (0.112, 0.0), (0.116, 0.016), (0.112, 0.03), (0.102, 0.038), (0.09, 0.036), (0.084, 0.026)]
    lathe(part, bez if lod == 0 else bez[::2], segs, center, axis, mat='chrome')
    if lod == 0:
        bowl = [(0.086, 0.022), (0.075, 0.004), (0.058, -0.012), (0.038, -0.022), (0.018, -0.027), (0.0, -0.028)]
        f = lathe(part, bowl, segs, center, axis, mat='chrome')
        bmesh.ops.reverse_faces(part.bm, faces=f)
        lathe(part, [(0.0, -0.028), (0.012, -0.022), (0.014, -0.01), (0.009, 0.0), (0.0, 0.003)], 12, center, axis, mat='ivory')
        dome = [(0.087, 0.024), (0.08, 0.034), (0.064, 0.044), (0.042, 0.05), (0.02, 0.053), (0.0, 0.054)]

        def flutes(r, a, th, idx):
            if 0.02 < r < 0.08:
                a += 0.0012 * math.cos(r * 520)
            return r, a
        lathe(part, dome, segs, center, axis, mat='glass', twist=flutes)
    else:
        lathe(part, [(0.086, 0.02), (0.05, 0.04), (0.0, 0.048)], segs, center, axis, mat='lens')
    if visor:
        up = Vector((0, 0, 1))
        side = axis.cross(up).normalized()
        up = side.cross(axis).normalized()
        rings = []
        n = 14 if lod == 0 else 6
        for k in range(n + 1):
            th = math.radians(8 + 164 * k / n)
            d = side * math.cos(th) + up * math.sin(th)
            e = math.sin(th) ** 0.6
            rings.append([center + d * 0.108 + axis * -0.03, center + d * 0.124 + axis * 0.0,
                          center + d * (0.124 + 0.004 * e) + axis * (0.03 + 0.05 * e), center + d * (0.114 + 0.002 * e) + axis * (0.04 + 0.055 * e),
                          center + d * 0.108 + axis * (0.03 + 0.045 * e)])
        f = part.grid(rings, mat='chrome', uv_tile=1, wrap_j=True)

        def ref(c):
            v = c - center
            r = v - axis * v.dot(axis)
            return center + r.normalized() * 0.116 + axis * 0.03
        orient(part, f, ref)


def build_wheel(lod, side, name, parent, loc):
    p = Part(name)
    ax = Vector((side, 0, 0))
    o = Vector((0, 0, 0))
    w = 0.098
    if lod == 0:
        prof = [(0.192, -0.078), (0.25, -0.098), (0.325, -0.091), (0.3575, -0.066)]
        cr = lambda x: R - 0.004 * (x / 0.066) ** 2
        rw = 0.124 / 3
        prof.append((cr(-0.062), -0.062))
        for k in range(1, 3):
            b = -0.062 + k * rw
            prof += [(cr(b), b - 0.003), (cr(b) - 0.006, b - 0.0012), (cr(b) - 0.006, b + 0.0012), (cr(b), b + 0.003)]
        prof.append((cr(0.062), 0.062))
        # outer sidewall: black shoulder, a raised moulding ring, then the wide whitewall
        # band standing proud with crisp steps at both edges
        prof += [(0.3575, 0.066), (0.349, 0.074), (0.333, 0.088), (0.318, 0.0955), (0.3145, 0.0995), (0.3095, 0.1),
                 (0.306, 0.0965), (0.3035, 0.0975), (0.3015, 0.1008), (0.29, 0.1015), (0.262, 0.102), (0.235, 0.1015),
                 (0.2215, 0.1008), (0.2195, 0.0985), (0.21, 0.094), (0.2, 0.087), (0.192, 0.08)]
        segs = 28
    else:
        prof = [(0.192, -0.078), (0.25, -0.098), (0.33, -0.09), (0.358, -0.06), (0.36, 0.0), (0.358, 0.06), (0.33, 0.09),
                (0.3035, 0.0985), (0.3015, 0.101), (0.2215, 0.101), (0.2195, 0.099), (0.192, 0.08)]
        segs = 24

    def col(co):
        r = math.hypot(co.y, co.z)
        a = co.x * side
        white = a > 0.1 and 0.2205 < r < 0.3025
        return (0.95, 0.94, 0.9) if white else (0.025, 0.025, 0.027)
    f = lathe(p, [(r, a) for r, a in prof], segs, o, ax, mat='tyre')
    p.paint_color(f, col)
    # brake drum behind the hubcap (hides the open tyre centre)
    f = lathe(p, [(0.0, -0.035), (0.193, -0.035), (0.193, 0.07)], 16 if lod else 24, o, ax, mat='tyre')
    p.paint_color(f, (0.03, 0.03, 0.03))
    # painted rim ring, then the full chrome wheel cover: a ribbed band, a groove and a
    # separate domed centre cap
    lathe(p, [(0.196, 0.074), (0.191, 0.083), (0.182, 0.0855), (0.173, 0.081)], segs, o, ax, mat='paint')
    if lod == 0:
        cover = [(0.1735, 0.079), (0.1715, 0.091), (0.166, 0.099), (0.156, 0.103), (0.145, 0.105), (0.134, 0.107),
                 (0.122, 0.109), (0.11, 0.111), (0.098, 0.113), (0.088, 0.115), (0.08, 0.117), (0.075, 0.116), (0.072, 0.11)]

        def ribs(r, a, th, idx):
            if 0.09 < r < 0.16:
                a += 0.0045 * math.cos(15 * th) * math.sin(math.pi * (r - 0.09) / 0.07)
            return r, a
        lathe(p, cover, 60, o, ax, mat='chrome', twist=ribs)
        lathe(p, [(0.072, 0.108), (0.066, 0.108), (0.066, 0.124), (0.061, 0.133), (0.05, 0.141), (0.034, 0.147),
                  (0.017, 0.15), (0.0, 0.151)], 24, o, ax, mat='chrome')
    else:
        lathe(p, [(0.1735, 0.079), (0.164, 0.1), (0.138, 0.1045), (0.1, 0.112), (0.07, 0.12), (0.05, 0.134), (0.0, 0.144)],
              24, o, ax, mat='chrome')
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


def cushion(part, s_half, u0, u1, h0, h1, lod, M, pleat_w=0.1, pleat_dir=(0, 1), bolster=0.13, mat='vinyl',
            mat2=None, piping=None):
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
    per = 2
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
    # two-tone: pleated inserts in mat, bolsters / sides / back in mat2
    inner = s_half - bolster
    ss = [-s_half + 2 * s_half * i / ns for i in range(ns + 1)]
    ws = [max(0.0, nu * pleat_dir[0] + nh * pleat_dir[1]) for (nu, nh) in nrm]

    def fm(i, j):
        if mat2 is None:
            return mat
        sm = (ss[i] + ss[min(i + 1, ns)]) / 2
        return mat if abs(sm) < inner and min(ws[j], ws[(j + 1) % m]) > 0.55 else mat2
    f = part.grid(rings, mat=mat, wrap_j=True, uv_tile=0.3, face_mat=fm)
    c = M @ V(0, ch, cu)
    orient(part, f, lambda x: c)
    if piping and not lod:
        # welts round the insert (both ends of the pleated field) and along the front edge
        tube = [(0.0055 * math.cos(a), 0.0055 * math.sin(a)) for a in [2 * math.pi * k / 4 for k in range(4)]]
        for i in (min(range(ns + 1), key=lambda i: abs(ss[i] + inner)), min(range(ns + 1), key=lambda i: abs(ss[i] - inner))):
            js = [j for j in range(m) if ws[j] > 0.4]
            pts = [rings[i][j] + (rings[i][j] - c).normalized() * 0.002 for j in js]
            if len(pts) > 2:
                sweep(part, pts, tube, mat=piping, up=(1, 0, 0))
        jf = max(range(m), key=lambda j: prof[j][0] * pleat_dir[1] + prof[j][1] * pleat_dir[0])
        sweep(part, [r[jf] for r in rings[1:-1:2]], tube, mat=piping, up=(0, 0, 1))
    return f


def rot_about_s(angle, pivot):
    """car-space rotation about the lateral axis through pivot (s,h,u); +angle tips the top back"""
    P = V(*pivot)
    return Matrix.Translation(P) @ Matrix.Rotation(angle, 4, 'X') @ Matrix.Translation(-P)


def shift_from(part, n0, M):
    part.bm.faces.ensure_lookup_table()
    part.transform([part.bm.faces[i] for i in range(n0, len(part.bm.faces))], M)


def build_interior(part, lod):
    I = Matrix.Identity(4)
    Bd = Body(SPEC, 0)
    # carpet floor with transmission tunnel and a raised toe board
    rings = []
    ns, nu = (24, 20) if lod == 0 else (6, 5)
    u0f, u1f = OPEN[0] + 0.07, OPEN[1] + 0.11
    for i in range(nu + 1):
        u = u0f + (u1f - u0f) * i / nu
        ring = []
        for j in range(ns + 1):
            s = 0.86 - 1.72 * j / ns
            h = FLOOR + 0.015 + 0.1 * math.exp(-(s / 0.2) ** 2) * smoothstep(-1.25, -0.5, u) + 0.22 * smoothstep(0.23, 0.63, u)
            ring.append(V(s, h, u))
        rings.append(ring)
    f = part.grid(rings, mat='carpet', uv_tile=0.5)
    orient(part, f, lambda c: c - Vector((0, 0, 1)))
    # benches: front (driver's) and rear; ivory pleats, seafoam bolsters and welts
    for (u0, u1, top, bu0, bu1, bh1, tilt) in ((-0.33 + DF, 0.2 + DF, 0.62, -0.47 + DF, -0.33 + DF, 1.06, 0.2),
                                               (-1.13, -0.70, 0.6, -1.27, -1.13, 1.0, 0.17)):
        cushion(part, 0.8, u0, u1, FLOOR + 0.02, top, lod, I, pleat_dir=(0, 1), mat='vinyl', mat2='vinyl2', piping='vinyl2')
        Mb = rot_about_s(-tilt, (0, top, bu1))
        cushion(part, 0.8, bu0, bu1, top - 0.03, bh1, lod, Mb, pleat_dir=(1, 0), mat='vinyl', mat2='vinyl2', piping='vinyl2')
        # plinth under the cushion
        box(part, V(0, FLOOR + 0.08, (u0 + u1) / 2), (1.5, 0.12, u1 - u0 - 0.1), mat='dark')
        if lod == 0 and u0 > -1:
            # chrome capping along the top of the front seat back
            pts = [Mb @ V(-0.74 + 1.48 * k / 16, bh1 - 0.012, bu0 + 0.01) for k in range(17)]
            sweep(part, pts, [(-0.012, 0), (0, 0.005), (0.012, 0), (0, -0.003)], mat='chrome', up=(0, 0, 1))
    # canvas boot over the folded top, behind the rear seat: a tapered, lumpy fabric cover
    rings = []
    nb = 32 if lod == 0 else 8
    nk = 14 if lod == 0 else 6
    for i in range(nb + 1):
        s = -0.86 + 1.72 * i / nb
        e = clamp((0.86 - abs(s)) / 0.16)
        kk = math.sqrt(max(0.0, 1 - (1 - e) ** 2))
        ring = []
        for k in range(nk + 1):
            a = math.pi * k / nk
            u = -1.55 + 0.25 * math.cos(a)
            fold = 0.006 * math.sin(s * 11.0 + 0.7) * math.sin(a) if lod == 0 else 0.0
            h = hc(u) + 0.012 + (0.085 * kk + 0.008) * math.sin(a) ** 0.7 + fold * kk
            ring.append(V(s, h, u))
        rings.append(ring)
    f = part.grid(rings, mat='canvas', uv_tile=0.25)
    orient(part, f, lambda c: V(C(c)[0], 0.8, -1.55))
    if lod == 0:
        # welted hem round the boot where it snaps to the body
        tube6 = [(0.006 * math.cos(a), 0.006 * math.sin(a)) for a in [2 * math.pi * k / 6 for k in range(6)]]
        sweep(part, [V(s, hc(-1.30) + 0.014, -1.30) for s in [-0.84 + 1.68 * k / 20 for k in range(21)]], tube6, mat='canvas', up=(0, 0, 1))
        for sg in (-1, 1):
            sweep(part, [V(sg * 0.86, hc(u) + 0.014, u) for u in [-1.32 - 0.45 * k / 8 for k in range(9)]], tube6, mat='canvas', up=(0, 0, 1))
    # dashboard: painted steel across the cowl, chrome strip, gauges, radio (laid out at the
    # first cowl position, then moved forward by DF)
    n0 = len(part.bm.faces)
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
    # column and shifter (the wheel itself is its own node)
    top = V(0.42, 0.965, 0.37)
    d = V(0, -math.sin(math.radians(30)), math.cos(math.radians(30)))
    col = [top + d * (0.05 + 0.3 * k / 6) for k in range(7)]
    sweep(part, col, [(0.02 * math.cos(a), 0.02 * math.sin(a)) for a in [2 * math.pi * k / 12 for k in range(12)]], mat='paint', up=(1, 0, 0))
    if lod == 0:
        sh = [top + d * 0.1 + V(0, 0, 0), top + d * 0.1 + V(-0.08, 0.02, -0.03), top + d * 0.1 + V(-0.2, 0.05, -0.08)]
        sweep(part, sh, [(0.006 * math.cos(a), 0.006 * math.sin(a)) for a in [2 * math.pi * k / 8 for k in range(8)]], mat='chrome', up=(0, 0, 1))
        lathe(part, [(0.0, -0.02), (0.016, -0.012), (0.016, 0.012), (0.0, 0.02)], 12, sh[-1], (sh[-1] - sh[-2]).normalized(), mat='ivory')
    shift_from(part, n0, Matrix.Translation(V(0, 0, DF)))
    # doors: pleated ivory insert panel, chrome strip, armrest, lever handle, window crank;
    # chrome capping along the door tops and rear quarters
    tube = lambda r, n=8: [(r * math.cos(a), r * math.sin(a)) for a in [2 * math.pi * k / n for k in range(n)]]
    wall = lambda u: Bd.S['W0'] * Bd.plan(u) - 0.162
    for sg in (-1, 1):
        if lod == 0:
            rings = []
            for i in range(29):
                u = 0.5 - 1.02 * i / 28
                inset = 0.012 + (0.004 + 0.004 * (i % 2) if 0 < i < 28 else 0.0)
                x = sg * (wall(u) - inset)
                rings.append([V(x, h, u) for h in (0.645, 0.66, 0.74, 0.82, 0.835)])
            f = part.grid(rings, mat='vinyl', uv_tile=0.3)
            orient(part, f, lambda c, sg=sg: c + Vector((sg, 0, 0)))
            sweep(part, [V(sg * (wall(u) - 0.02), 0.632, u) for u in [0.52 - 1.06 * k / 12 for k in range(13)]],
                  [(-0.004, -0.007), (0.004, -0.007), (0.005, 0.007), (-0.005, 0.007)], mat='chrome', up=(sg, 0, 0))
            box(part, V(sg * (wall(-0.1) - 0.045), 0.705, -0.12), (0.075, 0.05, 0.42), mat='vinyl2', bevel=0.022)
            box(part, V(sg * (wall(-0.1) - 0.03), 0.672, -0.12), (0.05, 0.012, 0.36), mat='chrome', bevel=0.004)
            # lever handle
            hc0 = V(sg * (wall(0.3) - 0.02), 0.77, 0.34)
            sweep(part, [hc0, hc0 + V(-sg * 0.018, 0.0, -0.03), hc0 + V(-sg * 0.022, -0.004, -0.11)], tube(0.0065), mat='chrome', up=(0, 0, 1))
            lathe(part, [(0.0, 0.0), (0.02, 0.0), (0.017, 0.01), (0.0, 0.012)], 16, hc0, V(-sg, 0, 0), mat='chrome')
            # window crank: escutcheon, arm, ivory knob
            cc = V(sg * (wall(0.05) - 0.02), 0.6, 0.05)
            lathe(part, [(0.0, 0.0), (0.024, 0.0), (0.02, 0.012), (0.009, 0.02), (0.0, 0.022)], 16, cc, V(-sg, 0, 0), mat='chrome')
            arm_end = cc + V(-sg * 0.03, 0.035, -0.07)
            sweep(part, [cc + V(-sg * 0.02, 0, 0), cc + V(-sg * 0.028, 0.02, -0.035), arm_end],
                  [(-0.009, -0.003), (0.009, -0.003), (0.007, 0.003), (-0.007, 0.003)], mat='chrome', up=(sg, 0, 0))
            lathe(part, [(0.0, 0.0), (0.011, 0.004), (0.012, 0.03), (0.008, 0.042), (0.0, 0.044)], 12, arm_end, V(-sg, 0, 0), mat='ivory')
            # rear quarter armrest
            box(part, V(sg * (wall(-0.95) - 0.04), 0.71, -0.95), (0.07, 0.05, 0.38), mat='vinyl2', bevel=0.02)
        # door-top capping from the screen pillar to the tail of the cockpit
        nseg = 24 if lod == 0 else 6
        pts = []
        for k in range(nseg + 1):
            u = 0.3 - (0.3 - OPEN[0] - 0.04) * k / nseg
            x = (Bd.S['W0'] - Bd.S['tumble'] - Bd.S['rs']) * Bd.plan(u) - 0.035
            pts.append(V(sg * x, hs(u) - 0.004, u))
        sweep(part, pts, [(-0.03, -0.004), (-0.026, 0.004), (0.0, 0.007), (0.026, 0.004), (0.03, -0.004)], mat='chrome', up=(0, 0, 1))


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
    """wraparound screen: the glass curls round the corners into near-vertical dogleg
    pillars (kinked forward just above the belt, then raked back to the header)"""
    def wrap(width, u0, rw, back, n):
        # plan path left end (back) -> across -> right end
        L1 = max(0.0, back - rw)
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
    n = 44 if lod == 0 else 14
    base = wrap(0.905, OPEN[1] + 0.02, 0.30, 0.36, n)
    top = wrap(0.85, 0.40, 0.20, 0.20, n)
    bh = []
    for (s, u) in base:
        loc, nor = caster.hit((s, 2.0, u), (0, -1, 0))
        bh.append(C(loc)[1] + 0.008 if loc else 0.95)
    B = [V(s, h, u) for (s, u), h in zip(base, bh)]
    T = [V(s, 1.375 - 0.03 * (s / 0.85) ** 2, u) for (s, u) in top]
    wk = [smoothstep(0.62, 0.95, abs(2 * k / n - 1)) for k in range(n + 1)]

    def pos(k, t):
        knee = t / 0.25 if t < 0.25 else (1 - t) / 0.75
        return B[k].lerp(T[k], t) + V(0, 0, 0.04 * wk[k] * knee)
    ts = [0, 0.25, 0.5, 0.75, 1.0] if lod == 0 else [0, 0.25, 1.0]
    rings = [[pos(k, t) for t in ts] for k in range(len(B))]
    part_glass.grid(rings, mat='glass', uv_tile=1)
    # chrome surround: header, dogleg posts, base channel
    tp = [(0.007 * math.cos(a), 0.012 * math.sin(a)) for a in [2 * math.pi * k / 10 for k in range(10)]]
    sweep(part_chrome, [t + Vector((0, 0, 0.004)) for t in T], tp, mat='chrome', up=(0, 0, 1))
    for k in (0, len(B) - 1):
        path = [pos(k, t) for t in (0, 0.12, 0.25, 0.4, 0.55, 0.7, 0.85, 1.0)]
        path = [path[0] - (path[1] - path[0]).normalized() * 0.06] + path + [path[-1] + (path[-1] - path[-2]).normalized() * 0.012]
        sweep(part_chrome, path, [(0.015 * math.cos(a), 0.011 * math.sin(a)) for a in [2 * math.pi * k / 10 for k in range(10)]], mat='chrome', up=(0, -1, 0))
    sweep(part_chrome, [b + Vector((0, 0, 0.004)) for b in B], [(0.009 * math.cos(a), 0.006 * math.sin(a)) for a in [2 * math.pi * k / 8 for k in range(8)]], mat='chrome', up=(0, 0, 1))
    if lod == 0:
        # vent wings behind the posts
        for k, sg in ((0, 1), (len(B) - 1, -1)):
            b, t = pos(k, 0.25), T[k]
            s_ = C(b)[0]
            rear_u = C(B[k])[2] - 0.3
            loc, _n = caster.hit((s_, 2.0, rear_u), (0, -1, 0))
            rb = V(s_ - sg * 0.004, C(loc)[1] + 0.01, rear_u)
            rt = V(s_ - sg * 0.02, 1.19, rear_u)
            quad = [[B[k].lerp(t, j / 3) for j in range(4)], [rb.lerp(rt, j / 3) for j in range(4)]]
            part_glass.grid(quad, mat='glass', uv_tile=1)
            sweep(part_chrome, [t, rt, rb], [(0.006 * math.cos(a), 0.006 * math.sin(a)) for a in [2 * math.pi * k / 8 for k in range(8)]], mat='chrome', up=(sg, 0, 0))
        # chrome rear-view mirror hanging from the header
        tm = T[n // 2]
        c = tm + V(0, -0.085, -0.07)
        sweep(part_chrome, [tm + V(0, -0.004, -0.012), tm + V(0, -0.04, -0.04), c + V(0, 0.02, 0.0)],
              [(0.0055 * math.cos(a), 0.0055 * math.sin(a)) for a in [2 * math.pi * k / 8 for k in range(8)]], mat='chrome', up=(1, 0, 0))
        # aimed at the driver's eye (0.42 m to the left, level with it): shows the road behind
        tilt = Matrix.Rotation(0.35, 3, 'Y') @ Matrix.Rotation(-0.03, 3, 'X')
        box(part_chrome, c, (0.23, 0.068, 0.03), mat='chrome', bevel=0.012, rot=tilt)
        box(part_chrome, c + tilt @ V(0, 0, -0.016), (0.205, 0.05, 0.004), mat='chrome', rot=tilt)


def trims(part, caster, lod):
    Bd = Body(SPEC, 0)
    prof_spear = [(-0.009, 0), (-0.007, 0.005), (0, 0.0075), (0.007, 0.005), (0.009, 0), (0, -0.001)]
    for sg in (-1, 1):
        # the full-length spear on the crease line (it dips behind the door and divides
        # the two-tone), tapering to points at both ends
        pts, sc = [], []
        n = 36 if lod == 0 else 16
        u0, u1 = HALF - 0.16, -HALF + 0.12
        for k in range(n + 1):
            u = u0 + (u1 - u0) * k / n
            loc, nor = caster.hit((sg * 2, hk(u) + 0.004, u), (-sg, 0, 0))
            if loc:
                pts.append(loc + nor * 0.002)
                t = k / n
                sc.append(max(0.25, min(1.0, t * 10, (1 - t) * 6)))
        sweep(part, pts, prof_spear, mat='chrome', up=(sg, 0, 0), scales=[(s, 1.0) for s in sc])
        # rocker strip between the arches
        pts = []
        for k in range(n // 2 + 1):
            u = (WB_F - 0.47) - (WB_F - 0.47 - WB_R - 0.47) * k / (n // 2)
            loc, nor = caster.hit((sg * 2, 0.385, u), (-sg, 0, 0))
            if loc:
                pts.append(loc + nor * 0.001)
        sweep(part, pts, [(-0.016, 0), (-0.012, 0.005), (0.012, 0.005), (0.016, 0), (0, -0.001)], mat='chrome', up=(sg, 0, 0))
        # chrome along the fin crests
        pts = []
        for k in range(21 if lod == 0 else 6):
            u = -0.7 - (HALF - 0.72) * k / (20 if lod == 0 else 5)
            x = (Bd.S['W0'] - Bd.S['tumble'] - Bd.S['rs'] * 0.4) * Bd.plan(u)
            loc, nor = caster.hit((sg * x, 2.5, u), (0, -1, 0))
            if loc:
                pts.append(loc + nor * 0.002)
        if len(pts) > 2:
            sweep(part, pts, [(-0.006, 0), (0, 0.005), (0.006, 0), (0, -0.001)], mat='chrome', up=(0, 0, 1))
        # pronounced wheel-arch lips: a painted bead standing proud round each opening
        for wz, ar in ((WB_F, 0.445), (WB_R, 0.435)):
            pts = []
            na = 28 if lod == 0 else 10
            for k in range(na + 1):
                th = math.radians(-8 + 196 * k / na)
                h = HUB_H + 0.01 + (ar + 0.016) * math.sin(th)
                u = wz + (ar + 0.016) * math.cos(th)
                if h < 0.31:
                    continue
                loc, nor = caster.hit((sg * 2, h, u), (-sg, 0, 0))
                if loc:
                    pts.append(loc + nor * 0.001)
            if len(pts) > 2:
                sweep(part, pts, [(-0.014, 0), (-0.009, 0.008), (0, 0.012), (0.009, 0.008), (0.014, 0), (0, -0.002)],
                      mat='paint', up=(sg, 0, 0))
        if lod == 0:
            # push-button door handle
            loc, nor = caster.hit((sg * 2, 0.895, -0.5), (-sg, 0, 0))
            if loc:
                box(part, loc + nor * 0.008, (0.018, 0.026, 0.16), mat='chrome', bevel=0.007)
    # hood: two chrome spears on the crown and a generic jet-shaped ornament (no emblem)
    if lod == 0:
        for sg in (-1, 1):
            pts, sc = [], []
            for k in range(25):
                u = OPEN[1] + 0.12 + (HALF - 0.5 - OPEN[1] - 0.12) * k / 24
                loc, nor = caster.hit((sg * 0.27, 2.5, u), (0, -1, 0))
                if loc:
                    pts.append(loc + nor * 0.002)
                    sc.append(max(0.3, min(1.0, k / 3, (24 - k) / 5)))
            sweep(part, pts, [(-0.007, 0), (-0.005, 0.004), (0, 0.006), (0.005, 0.004), (0.007, 0), (0, -0.001)],
                  mat='chrome', up=(0, 0, 1), scales=[(s, 1.0) for s in sc])
        loc, nor = caster.hit((0, 2.5, HALF - 0.3), (0, -1, 0))
        if loc:
            base = loc + nor * 0.004
            path, sc = [], []
            for k in range(13):
                t = k / 12
                path.append(base + V(0, 0.018 + 0.03 * math.sin(math.pi * t * 0.8), -0.2 + 0.26 * t))
                sc.append(max(0.08, math.sin(math.pi * (0.1 + 0.9 * t)) ** 0.7 * (1 - 0.5 * t)))
            ring = [(0.02 * math.cos(a), 0.012 * math.sin(a)) for a in [2 * math.pi * k / 12 for k in range(12)]]
            sweep(part, path, ring, mat='chrome', up=(0, 0, 1), scales=sc)
            # swept-back tail fin blade and the stem
            box(part, base + V(0, 0.05, -0.15), (0.006, 0.05, 0.08), mat='chrome', bevel=0.0025, rot=Matrix.Rotation(0.5, 3, 'X'))
            box(part, base + V(0, 0.012, -0.08), (0.03, 0.02, 0.14), mat='chrome', bevel=0.008)
    # grille: chrome surround, horizontal bars, a fine vertical egg-crate behind, gloss black back
    loc, nor = caster.hit((0, GR_H + 0.14, 4), (0, 0, -1))
    us = C(loc)[2] if loc else HALF - 0.1
    if lod == 0:
        loop = []
        W2, H0, H1, rr = GR_W - 0.005, GR_H - 0.1, GR_H + 0.1, 0.035
        cs = [(W2 - rr, H1 - rr, 0, 90), (-W2 + rr, H1 - rr, 90, 180), (-W2 + rr, H0 + rr, 180, 270), (W2 - rr, H0 + rr, 270, 360)]
        for (cx, cy, a0, a1) in cs:
            for k in range(6):
                a = math.radians(a0 + (a1 - a0) * k / 5)
                loop.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        path = []
        for (s, h) in loop:
            l2, n2 = caster.hit((s * 1.03, h + (0.012 if h > GR_H else -0.012), 4), (0, 0, -1))
            path.append((l2 if l2 else V(s, h, us)) + Vector((0, -0.004, 0)))
        sweep(part, path, [(0.015 * math.cos(a), 0.011 * math.sin(a)) for a in [2 * math.pi * k / 10 for k in range(10)]],
              mat='chrome', closed_path=True, up=(0, -1, 0), cap=False)
        for h in (GR_H - 0.06, GR_H - 0.02, GR_H + 0.02, GR_H + 0.06):
            bar = [V(-GR_W + 0.03 + (2 * GR_W - 0.06) * j / 16, h, us - 0.05 - 0.02 * (j / 8 - 1) ** 2) for j in range(17)]
            sweep(part, bar, [(0.012 * math.cos(a), 0.007 * math.sin(a)) for a in [2 * math.pi * k / 6 for k in range(6)]], mat='chrome', up=(0, -1, 0))
        for j in range(15):
            s = -GR_W + 0.06 + (2 * GR_W - 0.12) * j / 14
            box(part, V(s, GR_H, us - 0.07 - 0.02 * (s / GR_W) ** 2), (0.006, 0.17, 0.03), mat='chrome')
        box(part, V(0, GR_H, us - 0.1), (2 * GR_W, 0.2, 0.012), mat='grille')
    else:
        box(part, V(0, GR_H, us - 0.06), (2 * GR_W, 0.2, 0.02), mat='grille')
        for h in (GR_H - 0.09, GR_H - 0.03, GR_H + 0.03, GR_H + 0.09):
            box(part, V(0, h, us - 0.04), (2 * GR_W - 0.02, 0.014, 0.014), mat='chrome')
    # headlamps in the fender tips, parking lamps below
    for sg in (-1, 1):
        uu = []
        for (ds, dh) in ((0, 0.13), (0.13, 0), (-0.13, 0), (0, -0.13)):
            l2, n2 = caster.hit((sg * (LAMP_S + ds), LAMP_H + dh, 4), (0, 0, -1))
            if l2:
                uu.append(C(l2)[2])
        uc = (max(uu) if uu else HALF - 0.05) - 0.03
        headlamp(part, V(sg * LAMP_S, LAMP_H, uc), V(sg * 0.1, 0, 1), lod)
        l2, n2 = caster.hit((sg * 0.75, 0.6, 4), (0, 0, -1))
        if l2 and lod == 0:
            lathe(part, [(0.0, -0.005), (0.032, -0.005), (0.034, 0.004), (0.026, 0.012), (0.0, 0.016)], 20, l2, n2, mat='amber')
            lathe(part, [(0.031, -0.004), (0.042, 0.002), (0.04, 0.01), (0.034, 0.012)], 20, l2, n2, mat='chrome')
    # tail: lamps in chrome housings at the fin ends, backup lamps, plate in a recess
    for sg in (-1, 1):
        loc, nor = caster.hit((sg * 0.87, 0.94, -4), (0, 0, 1))
        if loc:
            ax = nor
            c0 = loc - ax * 0.02
            f1 = lathe(part, [(0.05, -0.08), (0.062, -0.05), (0.067, -0.01), (0.066, 0.012), (0.06, 0.022), (0.05, 0.022)],
                       28 if lod == 0 else 12, c0, ax, mat='chrome')
            f2 = lathe(part, [(0.0, 0.036), (0.034, 0.03), (0.05, 0.02), (0.052, 0.012)], 28 if lod == 0 else 12, c0, ax, mat='tail')
            f3 = lathe(part, [(0.0, 0.042), (0.013, 0.038), (0.016, 0.03)], 16 if lod == 0 else 8, c0, ax, mat='chrome')
            Mz = Matrix.Translation(c0) @ Matrix.Diagonal((0.9, 1.0, 1.7, 1.0)) @ Matrix.Translation(-c0)
            part.transform(f1 + f2 + f3, Mz)
        if lod == 0:
            loc, nor = caster.hit((sg * 0.6, 0.66, -4), (0, 0, 1))
            if loc:
                lathe(part, [(0.0, 0.012), (0.03, 0.008), (0.035, 0.0)], 20, loc, nor, mat='lens')
                lathe(part, [(0.034, -0.004), (0.044, 0.004), (0.041, 0.012), (0.035, 0.011)], 20, loc, nor, mat='chrome')
    loc, nor = caster.hit((0, 0.53, -4), (0, 0, 1))
    if loc:
        box(part, loc - nor * 0.002, (0.37, 0.2, 0.03), mat='dark')
        box(part, loc + nor * 0.008, (0.31, 0.155, 0.008), mat='plate', bevel=0.004)
        if lod == 0:
            for (ds, dh, w, hgt) in ((0, 0.084, 0.33, 0.012), (0, -0.084, 0.33, 0.012), (0.162, 0, 0.012, 0.18), (-0.162, 0, 0.012, 0.18)):
                box(part, loc + nor * 0.012 + V(ds, dh, 0), (w, hgt, 0.012), mat='chrome', bevel=0.004)
    if lod == 0:
        # trunk lock, exhaust
        loc, nor = caster.hit((0, 1.5, -2.44), (0, -1, 0))
        if loc:
            lathe(part, [(0.0, 0.0), (0.028, 0.0), (0.026, 0.012), (0.0, 0.016)], 16, loc, nor, mat='chrome')
        lathe(part, [(0.028, -0.2), (0.03, 0.0), (0.024, 0.006), (0.022, -0.1)], 16, V(-0.55, 0.26, -HALF - 0.05), V(0, 0, -1), mat='chrome')
        # driver's side mirror on the door top
        loc, nor = caster.hit((0.95, 2, 0.48), (0, -1, 0))
        if loc:
            sweep(part, [loc - Vector((0, 0, 0.01)), loc + Vector((0.01, 0, 0.1))], [(0.006 * math.cos(a), 0.006 * math.sin(a)) for a in [2 * math.pi * k / 8 for k in range(8)]], up=(1, 0, 0))
            lathe(part, [(0.0, -0.03), (0.045, -0.02), (0.05, 0.0), (0.0, 0.004)], 20, loc + Vector((0.012, 0, 0.13)), V(0, 0.1, -1).normalized(), mat='chrome')


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
    # dark chassis core between the wheels only (nothing shows under the overhangs)
    box(extra, V(0, 0.31, (WB_F + WB_R) / 2), (1.2, 0.06, WB_F - WB_R - 1.0), mat='dark')
    ex = extra.object(sharp=40)
    gl = glass.object(sharp=0)
    for o in (body, ex, gl):
        o.parent = root
    wheels = []
    for nm, s, u in (('FL', 1, WB_F), ('FR', -1, WB_F), ('RL', 1, WB_R), ('RR', -1, WB_R)):
        wheels.append(build_wheel(lod, s, 'wheel_' + nm + tag, root, V(s * TRACK, HUB_H, u)))
    sw = build_steering(lod, root)
    if lod == 0:
        empty('driver_seat', V(0.42, 0.62, -0.1 + DF), root)
        empty('driver_eye', V(0.42, 1.24, -0.12 + DF), root)
    objs = [root] + list(root.children_recursive)
    for o in objs:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
    n = sum(tris(o) for o in objs if o.type == 'MESH')
    return root, n
