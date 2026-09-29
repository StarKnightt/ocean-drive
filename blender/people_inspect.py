# Inventory of the Mixamo FBX files (meshes, materials, textures, armature scale, clip range).
#   blender -b --factory-startup --python blender/people_inspect.py -- <file.fbx> ...
import sys, bpy, json
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
for path in argv:
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    bpy.ops.import_scene.fbx(filepath=path)
    out = {'file': path, 'objects': []}
    for o in bpy.data.objects:
        d = {'name': o.name, 'type': o.type, 'loc': [round(v, 3) for v in o.location], 'rot': [round(v, 3) for v in o.rotation_euler], 'scale': [round(v, 4) for v in o.scale], 'parent': o.parent.name if o.parent else None}
        if o.type == 'MESH':
            m = o.data
            m.calc_loop_triangles()
            d['tris'] = len(m.loop_triangles)
            d['verts'] = len(m.vertices)
            d['groups'] = len(o.vertex_groups)
            d['mats'] = []
            for s in o.material_slots:
                mat = s.material
                if not mat:
                    continue
                texs = []
                if mat.use_nodes:
                    for n in mat.node_tree.nodes:
                        if n.type == 'TEX_IMAGE' and n.image:
                            links = [l.to_socket.name for l in n.outputs[0].links]
                            texs.append([n.image.name, list(n.image.size), links])
                d['mats'].append([mat.name, texs])
        if o.type == 'ARMATURE':
            d['bones'] = len(o.data.bones)
            hips = o.data.bones.get('mixamorig:Hips')
            d['hips_head'] = [round(v, 3) for v in hips.head_local] if hips else None
            d['first_bones'] = [b.name for b in o.data.bones][:8]
            ad = o.animation_data
            if ad and ad.action:
                d['action'] = ad.action.name
                d['frames'] = list(ad.action.frame_range)
        out['objects'].append(d)
    print('INSPECT', json.dumps(out))
