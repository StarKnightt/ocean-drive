# Mixamo people for Ocean Drive: characters, animation clips and roller skates as raw GLBs
# (optimised afterwards by tools/build-people.mjs). Run headless:
#   blender -b --factory-startup --python blender/people.py -- [chars] [clips] [skate] [name ...]
# Characters: bone names unified to mixamorig:*, eyelashes dropped, clothing zones written to
# a float colour attribute (R = zone / 4: 0 skin, 1 top, 2 bottom, 3 shoes, 4 hair) so the
# runtime can tint clothes per person, hair opacity wired to alpha, spec / gloss maps dropped,
# textures downscaled to 1024, and two joined meshes on one skin: <name> (LOD0, lightly
# decimated) and <name>_L1 (far LOD, ~6k triangles).
import sys, os, math
import bpy, bmesh
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'assets', 'mixamo')
RAW = os.path.join(HERE, '_raw', 'people')
os.makedirs(os.path.join(RAW, 'clips'), exist_ok=True)
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
modes = [a for a in argv if a in ('chars', 'clips', 'skate')] or ['chars', 'clips', 'skate']
only = [a for a in argv if a not in ('chars', 'clips', 'skate')]

CHARS = {
    # name: (target height m or None, LOD0 ratio, LOD1 target triangles)
    'sophie': (None, 0.62, 6500),
    'elizabeth': (None, 0.62, 6500),
    'megan': (None, 0.62, 6500),
    'remy': (1.78, 0.8, 6500),   # (converted, not used in game: legacy rig, blank face texture)
    'bryce': (None, 0.62, 6500),
    'lewis': (None, 0.58, 6500),
}
CLIPS = [
    'walk_casual_m', 'walk_casual_f', 'walk_feminine_f', 'walk_happy_m', 'walk_holding_object', 'walk_shopping_bag_m',
    'walk_briefcase_f', 'walk_texting_f', 'walk_texting_m', 'walk_stroll_old',
    'jog', 'jog_slow', 'run_f', 'run_slow',
    'idle_breathing', 'idle_happy', 'idle_looking_around', 'idle_phone_talk_f', 'idle_phone_talk_m', 'idle_weight_shift_f',
    'idle_standing', 'idle_stretch_arms',
    'sit_idle', 'sit_idle_f', 'sit_drinking', 'sit_talking', 'sit_talking_2', 'sit_looking_around', 'sit_fidget_feet',
    'drive_car', 'drive_honk', 'wave',
]


def clean():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.materials, bpy.data.images):
        for d in list(coll):
            coll.remove(d)


def import_fbx(path):
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True, ignore_leaf_bones=False, automatic_bone_orientation=False)
    arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    for b in arm.data.bones:
        if ':' in b.name:
            b.name = 'mixamorig:' + b.name.split(':', 1)[1]   # (renames the vertex groups too)
    return arm


def zone_of(name):
    n = name.lower()
    if 'hair' in n:
        return 4
    if 'shirt' in n or 'top' in n:
        return 1
    if 'pants' in n or 'shorts' in n or 'bottom' in n:
        return 2
    if 'sneaker' in n or 'shoe' in n or 'heel' in n:
        return 3
    if 'cloth' in n:
        return -1   # top and bottom in one mesh: split by the dominant bone
    return 0


def write_zones(o, arm):
    z0 = zone_of(o.name)
    me = o.data
    attr = me.color_attributes.new('zone', 'FLOAT_COLOR', 'POINT')
    names = {g.index: g.name for g in o.vertex_groups}
    hips_z = (arm.matrix_world @ arm.data.bones['mixamorig:Hips'].head_local).z
    mw = o.matrix_world
    for v in me.vertices:
        z = z0
        if z0 == -1 or (z0 == 0 and len(o.material_slots) == 1 and False):
            best, w = None, 0
            for g in v.groups:
                if g.weight > w:
                    best, w = names.get(g.group, ''), g.weight
            legs = best and any(k in best for k in ('UpLeg', 'Leg', 'Foot'))
            z = 2 if legs or (best and best.endswith('Hips') and (mw @ v.co).z < hips_z - 0.02) else 1
        attr.data[v.index].color = (z / 4, 0, 0, 1)
    me.color_attributes.active_color = attr
    # Lewis (one mesh, two materials): the hair material's faces are hair
    if len(o.material_slots) > 1:
        for p in me.polygons:
            mat = o.material_slots[p.material_index].material
            if mat and 'hair' in mat.name.lower():
                for vi in p.vertices:
                    attr.data[vi].color = (1, 0, 0, 1)


def fix_material(mat):
    if not mat or not mat.use_nodes:
        return
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        return
    for sock in ('Roughness', 'Specular IOR Level', 'Metallic'):
        s = bsdf.inputs.get(sock)
        if s:
            for l in list(s.links):
                nt.links.remove(l)
    bsdf.inputs['Roughness'].default_value = 0.72
    bsdf.inputs['Metallic'].default_value = 0.0
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.4
    hair = 'hair' in mat.name.lower() or 'eyelash' in mat.name.lower()
    # the unlinked opacity image drives alpha (hair cards)
    if hair and not bsdf.inputs['Alpha'].is_linked:
        op = [n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image and not n.outputs[0].is_linked]
        if op:
            nt.links.new(op[0].outputs[0], bsdf.inputs['Alpha'])
    for n in nt.nodes:
        if n.type == 'TEX_IMAGE' and not n.outputs[0].is_linked and not n.outputs[1].is_linked:
            nt.nodes.remove(n)


def tri_count(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


def decimate(o, ratio):
    if ratio >= 0.999:
        return
    m = o.modifiers.new('dec', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = ratio
    m.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    # keep the armature modifier last: move the decimate first
    while o.modifiers.find('dec') > 0:
        bpy.ops.object.modifier_move_up(modifier='dec')
    bpy.ops.object.modifier_apply(modifier='dec')


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def build_char(name, spec):
    target_h, r0, t1 = spec
    clean()
    arm = import_fbx(os.path.join(SRC, name, name + '_tpose.fbx'))
    arm.animation_data_clear()
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in list(meshes):
        if 'eyelash' in o.name.lower():
            bpy.data.objects.remove(o)
            meshes.remove(o)
    if target_h:
        zs = [(o.matrix_world @ Vector(c)).z for o in meshes for c in o.bound_box]
        k = target_h / (max(zs) - min(zs))
        arm.scale = arm.scale * k
        bpy.context.view_layer.update()
    for o in meshes:
        write_zones(o, arm)
        for s in o.material_slots:
            fix_material(s.material)
    for img in bpy.data.images:
        if img.size[0] > 1024:
            img.scale(1024, 1024)
    # LOD1: copies decimated towards t1 triangles in total (hair a little harder)
    total = sum(tri_count(o) for o in meshes)
    lod1 = []
    for o in meshes:
        c = o.copy()
        c.data = o.data.copy()
        bpy.context.scene.collection.objects.link(c)
        k = (t1 / total) * (0.7 if 'hair' in o.name.lower() else 1.0)
        decimate(c, max(0.02, k))
        lod1.append(c)
    for o in meshes:
        decimate(o, 0.75 if 'hair' in o.name.lower() else r0)
    L0 = join(meshes, name)
    L1 = join(lod1, name + '_L1')
    print('CHAR', name, 'LOD0', tri_count(L0), 'LOD1', tri_count(L1), 'mats', [s.material.name for s in L0.material_slots])
    bpy.ops.object.select_all(action='DESELECT')
    for o in (arm, L0, L1):
        o.select_set(True)
    path = os.path.join(RAW, name + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_yup=True,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_cameras=False, export_lights=False,
        export_animations=False, export_skins=True, export_all_influences=False, export_morph=False,
        export_extras=False, export_draco_mesh_compression_enable=False, export_image_format='AUTO')
    print('exported', path, os.path.getsize(path) // 1024, 'KB')


def build_clip(clip):
    clean()
    arm = import_fbx(os.path.join(SRC, 'animations', clip + '.fbx'))
    for o in list(bpy.context.scene.objects):
        if o is not arm:
            bpy.data.objects.remove(o)
    act = arm.animation_data.action
    act.name = clip
    fr = act.frame_range
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = int(fr[0]), int(fr[1])
    bpy.context.scene.render.fps = 30
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    path = os.path.join(RAW, 'clips', clip + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_cameras=False, export_lights=False,
        export_animations=True, export_animation_mode='ACTIVE_ACTIONS', export_force_sampling=True, export_frame_step=1,
        export_optimize_animation_size=False, export_skins=True, export_materials='NONE', export_extras=False)
    print('CLIP', clip, fr[:], os.path.getsize(path) // 1024, 'KB')


# ---------------------------------------------------------------------------
# Roller skates: a generic high-top quad skate (no brand): padded boot, sole plate, two trucks,
# four wheels, a toe stop. One mesh, vertex colours on one material. Origin under the heel of
# the boot's sole (the foot's heel sits there), +y up, toe towards +y in Blender = +z in glTF.
def build_skate():
    clean()
    parts = []
    col = {
        'boot': (0.93, 0.92, 0.88, 1), 'lace': (0.95, 0.95, 0.95, 1), 'sole': (0.12, 0.12, 0.13, 1),
        'plate': (0.62, 0.64, 0.66, 1), 'wheel': (0.95, 0.52, 0.62, 1), 'hub': (0.9, 0.9, 0.9, 1),
        'stop': (0.9, 0.35, 0.45, 1), 'trim': (0.30, 0.72, 0.78, 1),
    }

    def paint(o, c):
        me = o.data
        a = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        for i in range(len(me.vertices)):
            a.data[i].color = c
        parts.append(o)
        return o

    def rounded_box(size, loc, bevel, segs=3, name='b'):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        o = bpy.context.active_object
        o.name = name
        o.scale = size
        bpy.ops.object.transform_apply(scale=True)
        m = o.modifiers.new('bev', 'BEVEL')
        m.width = bevel
        m.segments = segs
        m.limit_method = 'NONE'
        bpy.ops.object.modifier_apply(modifier='bev')
        return o

    def loft(name, rings, nv=24, cap0=True, cap1=True):
        # rings: [(cx, cy, cz, half-width, z-bottom, z-top, exponent)] along the foot, closed tubes
        bm = bmesh.new()
        loops = []
        for (cx, cy, cz0, hw, zb, zt, ex) in rings:
            ring = []
            zc, hh = (zb + zt) / 2, (zt - zb) / 2
            for j in range(nv):
                th = 2 * math.pi * j / nv
                c, sn = math.cos(th), math.sin(th)
                se = lambda q, n: math.copysign(abs(q) ** (2 / n), q)
                # flatter underneath (the sole), rounder on top
                n = 6 if sn < 0 else ex
                ring.append(bm.verts.new((cx + hw * se(c, n), cy, zc + hh * se(sn, n))))
            loops.append(ring)
        for i in range(len(loops) - 1):
            for j in range(nv):
                k = (j + 1) % nv
                bm.faces.new((loops[i][j], loops[i][k], loops[i + 1][k], loops[i + 1][j]))
        if cap0:
            bm.faces.new(list(reversed(loops[0])))
        if cap1:
            bm.faces.new(loops[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        return o

    # dimensions (m): the boot wraps a ~26 cm sneaker (y along the foot from the heel, toe +y,
    # z up); the shoe's sole sits on sole_z, the ankle ~7 cm ahead of the heel
    L = 0.315
    sole_z = 0.074
    ankle_y = 0.068
    def prof(t):
        # half-width, top above the sole along the foot (t = 0 heel .. 1 toe)
        keys = [(0.0, 0.047, 0.11), (0.08, 0.057, 0.13), (0.3, 0.061, 0.13), (0.5, 0.063, 0.112), (0.72, 0.061, 0.095), (0.9, 0.054, 0.082), (1.0, 0.034, 0.06)]
        for (t0, w0, h0), (t1, w1, h1) in zip(keys, keys[1:]):
            if t <= t1:
                u = (t - t0) / (t1 - t0)
                u = u * u * (3 - 2 * u)
                return w0 + (w1 - w0) * u, h0 + (h1 - h0) * u
        return keys[-1][1], keys[-1][2]
    rings = []
    for i in range(19):
        t = i / 18
        w, h = prof(t)
        y = -0.03 + t * L
        rings.append((0, y, 0, w, sole_z - 0.012, sole_z + h, 2.6))
    shell = loft('shell', rings)
    paint(shell, col['boot'])
    # ankle shaft: a padded tube around the ankle, leaning forward a little
    # (a vertical tube: rings stacked in z, so build it from horizontal ellipses instead)
    bm = bmesh.new()
    nv = 24
    loops = []
    for i in range(8):
        t = i / 7
        z = sole_z + 0.07 + t * 0.14
        cy = ankle_y - 0.004 + t * 0.022
        rx, ry = 0.057 + 0.004 * math.sin(t * math.pi), 0.066 + 0.004 * math.sin(t * math.pi)
        loops.append([bm.verts.new((rx * math.cos(2 * math.pi * j / nv), cy + ry * math.sin(2 * math.pi * j / nv), z)) for j in range(nv)])
    for i in range(len(loops) - 1):
        for j in range(nv):
            k = (j + 1) % nv
            bm.faces.new((loops[i][j], loops[i][k], loops[i + 1][k], loops[i + 1][j]))
    bm.faces.new(list(reversed(loops[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('shaft'); bm.to_mesh(me); bm.free()
    shaft = bpy.data.objects.new('shaft', me); bpy.context.scene.collection.objects.link(shaft)
    paint(shaft, col['boot'])
    # padded collar (trim colour) round the top of the shaft
    bpy.ops.mesh.primitive_torus_add(major_radius=0.062, minor_radius=0.011, major_segments=24, minor_segments=8, location=(0, ankle_y + 0.018, sole_z + 0.21))
    collar = bpy.context.active_object
    collar.scale = (0.95, 1.1, 1.0)
    bpy.ops.object.transform_apply(scale=True)
    paint(collar, col['trim'])
    # tongue up the front of the shaft, laces across the instep
    tongue = rounded_box((0.05, 0.018, 0.1), (0, ankle_y + 0.058, sole_z + 0.17), 0.008, 3, 'tongue')
    tongue.rotation_euler.x = -0.25
    paint(tongue, col['boot'])
    for i in range(6):
        y = 0.1 + i * 0.024
        _, h = prof((y + 0.03) / L)
        lace = rounded_box((0.064, 0.007, 0.006), (0, y, sole_z + h + 0.002 + (0.05 if i < 1 else 0)), 0.002, 1, 'lace')
        paint(lace, col['lace'])
    # heel counter stripe
    stripe = rounded_box((0.094, 0.01, 0.07), (0, -0.028, sole_z + 0.07), 0.004, 2, 'stripe')
    paint(stripe, col['trim'])
    sole = rounded_box((0.118, L + 0.004, 0.018), (0, L / 2 - 0.03, sole_z - 0.012), 0.006, 2, 'sole')
    paint(sole, col['sole'])
    plate = rounded_box((0.06, L * 0.8, 0.01), (0, L / 2 - 0.03, sole_z - 0.026), 0.004, 2, 'plate')
    paint(plate, col['plate'])
    wr, ww = 0.029, 0.034
    for y in (0.02, 0.2):
        truck = rounded_box((0.11, 0.025, 0.02), (0, y, wr + 0.012), 0.006, 2, 'truck')
        paint(truck, col['plate'])
        kp = rounded_box((0.03, 0.03, 0.022), (0, y, sole_z - 0.036), 0.008, 2, 'king')
        paint(kp, col['plate'])
        for x in (-1, 1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=wr, depth=ww, location=(x * 0.072, y, wr), rotation=(0, math.pi / 2, 0))
            w = bpy.context.active_object
            m = w.modifiers.new('bev', 'BEVEL'); m.width = 0.007; m.segments = 3
            bpy.ops.object.modifier_apply(modifier='bev')
            paint(w, col['wheel'])
            bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=wr * 0.45, depth=ww + 0.003, location=(x * 0.072, y, wr), rotation=(0, math.pi / 2, 0))
            paint(bpy.context.active_object, col['hub'])
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.022, depth=0.04, location=(0, L - 0.035, 0.03))
    paint(bpy.context.active_object, col['stop'])
    o = join(parts, 'skate')
    for p in o.data.polygons:
        p.use_smooth = True
    mat = bpy.data.materials.new('skate')
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    vc = mat.node_tree.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    mat.node_tree.links.new(vc.outputs[0], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.55
    o.data.materials.clear()
    o.data.materials.append(mat)
    o.data.color_attributes.active_color = o.data.color_attributes['Col']
    print('SKATE tris', tri_count(o))
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    path = os.path.join(RAW, 'skate.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_normals=True, export_vertex_color='ACTIVE', export_materials='EXPORT', export_cameras=False,
        export_lights=False, export_animations=False, export_extras=False)
    print('exported', path, os.path.getsize(path) // 1024, 'KB')


if 'chars' in modes:
    for n, spec in CHARS.items():
        if not only or n in only:
            build_char(n, spec)
if 'clips' in modes:
    for c in CLIPS:
        if not only or c in only:
            build_clip(c)
if 'skate' in modes:
    build_skate()
