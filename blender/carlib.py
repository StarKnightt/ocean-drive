# Geometry helpers for the Ocean Drive car generator (run inside Blender 5.x).
# Car coordinates: s = lateral (+ = left / driver side), h = up, u = forward (m).
# Blender: front of the car points to -Y, left side to +X, so the glTF export (+Y up)
# lands with the nose on +Z and the driver side on +X, as the three.js scene expects.
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree


def V(s, h, u):
    return Vector((s, -u, h))


def C(v):
    """blender vector -> car coords (s, h, u)"""
    return (v.x, v.z, -v.y)


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def smoothstep(a, b, x):
    if a == b:
        return 1.0 if x >= b else 0.0
    t = clamp((x - a) / (b - a))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


# ---------------------------------------------------------------------------
# materials (approximate Principled values; the runtime swaps in its own shaders by name)
MAT_DEFS = {
    'paint': dict(color=(0.42, 0.78, 0.70), rough=0.25, coat=1.0),
    'paint2': dict(color=(0.93, 0.92, 0.88), rough=0.25, coat=1.0),
    'canvas': dict(color=(0.72, 0.68, 0.58), rough=0.9),
    'grille': dict(color=(0.01, 0.01, 0.012), rough=0.3),
    'seat': dict(color=(0.05, 0.05, 0.055), rough=0.65),
    'chrome': dict(color=(0.96, 0.96, 0.96), rough=0.05, metal=1.0),
    'glass': dict(color=(0.85, 0.93, 0.92), rough=0.02, alpha=0.25),
    'tint': dict(color=(0.03, 0.04, 0.045), rough=0.03, alpha=0.8),
    'tyre': dict(color=(1, 1, 1), rough=0.85, vc=True),
    'trim': dict(color=(0.02, 0.02, 0.022), rough=0.55),
    'dark': dict(color=(0.012, 0.012, 0.012), rough=0.8),
    'vinyl': dict(color=(0.93, 0.89, 0.80), rough=0.45),
    'vinyl2': dict(color=(0.55, 0.80, 0.74), rough=0.4),
    'carpet': dict(color=(0.10, 0.17, 0.16), rough=0.95),
    'ivory': dict(color=(0.93, 0.90, 0.82), rough=0.25),
    'lens': dict(color=(0.85, 0.85, 0.82), rough=0.1, metal=0.3),
    'amber': dict(color=(0.9, 0.5, 0.1), rough=0.15),
    'tail': dict(color=(0.55, 0.02, 0.02), rough=0.15),
    'plate': dict(color=(0.9, 0.9, 0.86), rough=0.4),
    'interior': dict(color=(0.08, 0.08, 0.085), rough=0.7),
    'alloy': dict(color=(0.62, 0.64, 0.66), rough=0.3, metal=1.0),
    'gauge': dict(color=(1, 1, 1), rough=0.2),
}


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    d = MAT_DEFS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*d['color'], 1)
    b.inputs['Roughness'].default_value = d.get('rough', 0.5)
    b.inputs['Metallic'].default_value = d.get('metal', 0.0)
    if d.get('coat'):
        b.inputs['Coat Weight'].default_value = d['coat']
        b.inputs['Coat Roughness'].default_value = 0.03
    if 'alpha' in d:
        b.inputs['Alpha'].default_value = d['alpha']
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    if d.get('vc'):
        a = m.node_tree.nodes.new('ShaderNodeVertexColor')
        a.layer_name = 'Col'
        m.node_tree.links.new(a.outputs['Color'], b.inputs['Base Color'])
    m.diffuse_color = (*d['color'], d.get('alpha', 1))
    return m


def image_material(name, img):
    m = bpy.data.materials.get(name) or material(name)
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    if not b.inputs['Base Color'].is_linked:
        t = m.node_tree.nodes.new('ShaderNodeTexImage')
        t.image = img
        m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    return m


# ---------------------------------------------------------------------------
# mesh construction
class Part:
    """collects bmesh geometry for one object, with per-face material names"""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.col = None
        self.mats = []

    def mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def grid(self, rings, mat='paint', wrap_j=False, wrap_i=False, cap0=False, cap1=False,
             face_mat=None, uv_tile=1.0, color=None, flip=False):
        """quads between consecutive rings (lists of blender Vectors). face_mat(i, j) -> name"""
        bm = self.bm
        ni, nj = len(rings), len(rings[0])
        vs = [[bm.verts.new(p) for p in r] for r in rings]
        U = []
        for r in rings:
            acc = [0.0]
            for j in range(1, nj):
                acc.append(acc[-1] + (r[j] - r[j - 1]).length)
            acc.append(acc[-1] + (r[0] - r[-1]).length)
            U.append(acc)
        Wd = [[0.0] * nj]
        for i in range(1, ni):
            Wd.append([Wd[-1][j] + (rings[i][j] - rings[i - 1][j]).length for j in range(nj)])
        extra = (rings[0][0] - rings[-1][0]).length if wrap_i else 0
        faces = []
        irange = ni if wrap_i else ni - 1
        jrange = nj if wrap_j else nj - 1
        for i in range(irange):
            i2 = (i + 1) % ni
            for j in range(jrange):
                j2 = (j + 1) % nj
                q = [vs[i][j], vs[i2][j], vs[i2][j2], vs[i][j2]]
                if flip:
                    q.reverse()
                try:
                    f = bm.faces.new(q)
                except ValueError:
                    continue
                name = face_mat(i, j) if face_mat else mat
                f.material_index = self.mi(name)
                f.smooth = True
                idx = [(i, j), (i2, j), (i2, j2), (i, j2)]
                if flip:
                    idx.reverse()
                for loop, (a, b) in zip(f.loops, idx):
                    uu = U[a][nj] if (b == 0 and j == nj - 1 and wrap_j) else U[a][b]
                    ww = Wd[-1][b] + extra if (a == 0 and i == ni - 1 and wrap_i) else Wd[a][b]
                    loop[self.uv].uv = (uu / uv_tile, ww / uv_tile)
                faces.append(f)
        for k, do in ((0, cap0), (ni - 1, cap1)):
            if not do:
                continue
            ring = vs[k]
            c = bm.verts.new(sum((v.co for v in ring), Vector()) / len(ring))
            rng = range(nj) if wrap_j else range(nj - 1)
            for j in rng:
                j2 = (j + 1) % nj
                tri = [c, ring[j2], ring[j]] if (k == 0) != flip else [c, ring[j], ring[j2]]
                try:
                    f = bm.faces.new(tri)
                except ValueError:
                    continue
                f.material_index = self.mi(face_mat(k if k == 0 else k - 1, j) if face_mat else mat)
                f.smooth = True
                for loop in f.loops:
                    loop[self.uv].uv = (loop.vert.co.x / uv_tile, loop.vert.co.z / uv_tile)
                faces.append(f)
        if color is not None:
            self.paint_color(faces, color)
        return faces

    def paint_color(self, faces, color):
        if self.col is None:
            self.col = self.bm.loops.layers.float_color.new('Col')
            for f in self.bm.faces:
                for l in f.loops:
                    l[self.col] = (1, 1, 1, 1)
        for f in faces:
            for l in f.loops:
                l[self.col] = (*(color(l.vert.co) if callable(color) else color), 1)

    def transform(self, faces, M):
        vs = {v for f in faces for v in f.verts}
        bmesh.ops.transform(self.bm, matrix=M, verts=list(vs))

    def object(self, parent=None, merge=1e-5, sharp=40, collection=None):
        bm = self.bm
        if merge:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge)
        bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(material(m) if m in MAT_DEFS else bpy.data.materials[m])
        ob = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        if parent:
            ob.parent = parent
        me.shade_smooth()
        if sharp:
            me.set_sharp_from_angle(angle=math.radians(sharp))
        return ob


def orient(part, faces, ref):
    """flip the faces if on the whole they face towards ref(face_centre) rather than away"""
    tot = 0.0
    for f in faces:
        if not f.is_valid:
            continue
        f.normal_update()
        c = f.calc_center_median()
        tot += f.normal.dot(c - ref(c)) * f.calc_area()
    if tot < 0:
        bmesh.ops.reverse_faces(part.bm, faces=[f for f in faces if f.is_valid])


def sweep(part, path, profile, mat='chrome', closed_path=False, cap=True, up=(0, 0, 1), scales=None, ups=None, **kw):
    """profile: closed loop of (a, b) = (side, up) offsets, swept along path (blender Vectors).
    up: frame 'up' hint (or ups: one per path point); scales: per-point profile scale"""
    n = len(path)
    rings = []
    for k, p in enumerate(path):
        upk = Vector(ups[k] if ups else up)
        a = path[(k + 1) % n] if closed_path else path[min(k + 1, n - 1)]
        b = path[(k - 1) % n] if closed_path else path[max(k - 1, 0)]
        t = (a - b).normalized()
        side = t.cross(upk)
        if side.length < 1e-4:
            side = t.cross(Vector((0, 1, 0)))
        side.normalize()
        upv = side.cross(t).normalized()
        sc = scales[k] if scales else 1.0
        if isinstance(sc, (int, float)):
            sc = (sc, sc)
        rings.append([p + side * (x * sc[0]) + upv * (y * sc[1]) for x, y in profile])
    faces = part.grid(rings, mat=mat, wrap_j=True, wrap_i=closed_path, cap0=cap and not closed_path,
                      cap1=cap and not closed_path, **kw)
    pts = path

    def ref(c):
        return min(pts, key=lambda q: (q - c).length_squared)
    orient(part, faces, ref)
    return faces


def lathe(part, profile, segs, center, axis, mat='chrome', ref_out=True, twist=None, **kw):
    """surface of revolution. profile: list of (r, a) with a along axis. axis: unit Vector"""
    axis = Vector(axis).normalized()
    e1 = axis.orthogonal().normalized()
    e2 = axis.cross(e1).normalized()
    rings = []
    for k in range(segs):
        th = 2 * math.pi * k / segs
        d = e1 * math.cos(th) + e2 * math.sin(th)
        ring = []
        for idx, (r, a) in enumerate(profile):
            if twist:
                r, a = twist(r, a, th, idx)
            ring.append(center + d * r + axis * a)
        rings.append(ring)
    faces = part.grid(rings, mat=mat, wrap_i=True, **kw)

    def ref(c):
        # expected outward: away from the axis (and away from the disc centre for flat caps)
        p = center + axis * (c - center).dot(axis)
        return p if (c - p).length > 1e-4 else center - axis
    orient(part, faces, ref)
    return faces


def box(part, center, size, mat='trim', rot=None, bevel=0.0):
    """size in car axes (ds, dh, du); rot: blender-space 3x3 applied about the centre"""
    bm = part.bm
    ret = bmesh.ops.create_cube(bm, size=1.0)
    vs = ret['verts']
    M = Matrix.Diagonal((size[0], size[2], size[1], 1.0))
    if rot is not None:
        M = rot.to_4x4() @ M
    M = Matrix.Translation(center) @ M
    bmesh.ops.transform(bm, matrix=M, verts=vs)
    faces = list({f for v in vs for f in v.link_faces})
    for f in faces:
        f.material_index = part.mi(mat)
        f.smooth = False
        for l in f.loops:
            l[part.uv].uv = (l.vert.co.x + l.vert.co.y, l.vert.co.z)
    if bevel:
        edges = list({e for f in faces for e in f.edges})
        r = bmesh.ops.bevel(bm, geom=edges + vs, offset=bevel, segments=2, affect='EDGES', profile=0.5)
        for f in r['faces']:
            f.material_index = part.mi(mat)
            f.smooth = True
        faces = list({f for v in bm.verts for f in v.link_faces if f.material_index == part.mi(mat)})
    return faces


# ---------------------------------------------------------------------------
# objects: cutters, booleans, modifier application
def cutter_box(center, size, rot=None, name='cut', bevel=0.0):
    p = Part(name)
    box(p, center, size, mat='dark', rot=rot, bevel=bevel)
    bmesh.ops.remove_doubles(p.bm, verts=p.bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(p.bm, faces=p.bm.faces)
    return p.object(sharp=0, merge=0)


def disc(part, center, normal, up, r, mat, segs=32, uv_rot=0.0):
    """flat round face (fan) facing normal; planar UVs 0..1 across the disc, v along up"""
    normal = Vector(normal).normalized()
    x = Vector(up).cross(normal).normalized()
    y = normal.cross(x).normalized()
    bm = part.bm
    c = bm.verts.new(center)
    ring = [bm.verts.new(center + (x * math.cos(2 * math.pi * k / segs) + y * math.sin(2 * math.pi * k / segs)) * r) for k in range(segs)]
    faces = []
    for k in range(segs):
        f = bm.faces.new([c, ring[k], ring[(k + 1) % segs]])
        f.material_index = part.mi(mat)
        f.smooth = False
        for l in f.loops:
            d = l.vert.co - center
            l[part.uv].uv = (0.5 + d.dot(x) / (2 * r), 0.5 + d.dot(y) / (2 * r))
        faces.append(f)
    for f in faces:
        f.normal_update()
    if faces[0].normal.dot(normal) < 0:
        bmesh.ops.reverse_faces(bm, faces=faces)
    return faces


def cutter_cyl(center, axis, r, depth, segs=48, name='cutc'):
    p = Part(name)
    axis = Vector(axis).normalized()
    prof = [(0.0, -depth / 2), (r, -depth / 2), (r, depth / 2), (0.0, depth / 2)]
    lathe(p, prof, segs, center, axis, mat='dark')
    bmesh.ops.remove_doubles(p.bm, verts=p.bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(p.bm, faces=p.bm.faces)
    return p.object(sharp=30)


def fence(pts, h0, h1, thick=0.004, name='fence'):
    """thin vertical wall along a polyline of (s, u) points -> cutter object"""
    p = Part(name)
    for (s0, u0), (s1, u1) in zip(pts[:-1], pts[1:]):
        a, b = V(s0, 0, u0), V(s1, 0, u1)
        d = b - a
        L = d.length
        ang = math.atan2(d.y, d.x)
        rot = Matrix.Rotation(ang, 3, 'Z')
        c = (a + b) / 2
        c.z = (h0 + h1) / 2
        box(p, c, (L + thick, h1 - h0, thick), mat='dark', rot=rot)
    bmesh.ops.recalc_face_normals(p.bm, faces=p.bm.faces)
    return p.object(sharp=0, merge=0)


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    me.name = old.name
    bpy.data.meshes.remove(old)


def boolean(ob, cutters, op='DIFFERENCE'):
    if not cutters:
        return
    coll = bpy.data.collections.new('cut_tmp')
    bpy.context.scene.collection.children.link(coll)
    for c in cutters:
        for uc in list(c.users_collection):
            uc.objects.unlink(c)
        coll.objects.link(c)
    m = ob.modifiers.new('bool', 'BOOLEAN')
    m.operation = op
    m.solver = 'EXACT'
    m.operand_type = 'COLLECTION'
    m.collection = coll
    m.material_mode = 'TRANSFER'
    m.use_self = True
    m.use_hole_tolerant = True
    apply_mods(ob)
    for c in cutters:
        me = c.data
        bpy.data.objects.remove(c)
        bpy.data.meshes.remove(me)
    bpy.data.collections.remove(coll)


def bevel(ob, width=0.004, angle=40, segments=2):
    m = ob.modifiers.new('bev', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.harden_normals = False
    apply_mods(ob)


def resmooth(ob, sharp=40):
    ob.data.shade_smooth()
    ob.data.set_sharp_from_angle(angle=math.radians(sharp))


class Caster:
    """raycasts against an object in car coordinates"""

    def __init__(self, ob):
        dg = bpy.context.evaluated_depsgraph_get()
        self.t = BVHTree.FromObject(ob, dg)

    def hit(self, origin, direction, dist=10.0):
        loc, nor, idx, d = self.t.ray_cast(V(*origin), V(*direction).normalized(), dist)
        if loc is None:
            return None, None
        return loc, nor


def tris(ob):
    me = ob.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def empty(name, loc, parent=None, size=0.1):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = size
    e.location = loc
    bpy.context.scene.collection.objects.link(e)
    if parent:
        e.parent = parent
    return e
