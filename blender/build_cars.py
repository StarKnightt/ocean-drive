# Builds the Ocean Drive cars and exports raw GLBs (optimised afterwards by
# tools/optimize-cars.mjs). Run headless:
#   blender -b --factory-startup --python blender/build_cars.py -- [hero] [parked] [--noexport]
import sys, os, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy
for m in ('carlib', 'body', 'hero', 'modern'):
    if m in sys.modules:
        del sys.modules[m]
import carlib, hero

ROOT = os.path.dirname(HERE)
RAW = os.path.join(HERE, '_raw')
os.makedirs(RAW, exist_ok=True)
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
targets = [a for a in argv if not a.startswith('--')] or ['hero', 'parked']

# clean scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
for c in list(bpy.data.collections):
    bpy.data.collections.remove(c)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'cars.blend'))


def export(coll, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in coll.all_objects:
        o.hide_set(False)
        o.select_set(True)
    path = os.path.join(RAW, name + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_yup=True,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_cameras=False, export_lights=False,
        export_animations=False, export_extras=False, export_draco_mesh_compression_enable=False)
    print('exported', path, os.path.getsize(path) // 1024, 'KB')


report = {}
t0 = time.time()
if 'textures' in targets:
    # Poly Haven CC0 maps (blender/_src) -> webp for the runtime, 1024 and 512
    out = os.path.join(ROOT, 'public', 'textures', 'cars')
    os.makedirs(out, exist_ok=True)
    for src, dst in (('leather_white_nor_gl_1k.jpg', 'vinyl_nor'), ('dirty_carpet_nor_gl_1k.jpg', 'carpet_nor')):
        for size in (1024, 512):
            img = bpy.data.images.load(os.path.join(HERE, '_src', src))
            img.colorspace_settings.name = 'sRGB'   # sRGB in + Standard view out = byte-exact round trip
            if size != img.size[0]:
                img.scale(size, size)
            sc = bpy.context.scene
            sc.view_settings.view_transform = 'Standard'
            sc.view_settings.look = 'None'
            sc.view_settings.exposure = 0
            sc.view_settings.gamma = 1
            sc.render.image_settings.file_format = 'WEBP'
            sc.render.image_settings.quality = 88
            sc.render.image_settings.color_mode = 'RGB'
            path = os.path.join(out, f'{dst}{"" if size == 1024 else "_512"}.webp')
            img.save_render(path, scene=sc)
            print('texture', path, os.path.getsize(path) // 1024, 'KB')
            bpy.data.images.remove(img)
if 'hero' in targets:
    coll = bpy.data.collections.new('convertible')
    bpy.context.scene.collection.children.link(coll)
    for lod in (0, 1):
        root, n = hero.build(lod, coll)
        report[root.name] = n
        print('built', root.name, n, 'tris', round(time.time() - t0, 1), 's')
    if '--noexport' not in argv:
        export(coll, 'convertible')
if 'parked' in targets:
    import modern
    coll = bpy.data.collections.new('parked')
    bpy.context.scene.collection.children.link(coll)
    for kind in modern.KINDS:
        for lod in (0, 1):
            root, n = modern.build(kind, lod, coll)
            report[root.name] = n
            print('built', root.name, n, 'tris', round(time.time() - t0, 1), 's')
    if '--noexport' not in argv:
        export(coll, 'parked')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'cars.blend'))
print('TRIS', report)
