# Skins a static sculpture onto an existing rig, so the asset pipeline never has to invent a skeleton.
#
#   Blender --background --factory-startup --python tools/blender/rig-from-donor.py -- \
#       <donor.glb> <static.glb> <out.glb> [--pose A_TPose] [--yaw 0] [--body skin,headsculpt] [--cull 0.05,2] \
#       [--arms 50] [--decimate 60000] [--smooth 0.5,6] [--split 3]
#
# The donor is a rigged humanoid (armature + skinned mesh). Its armature is posed to `--pose` and that pose becomes the
# rest pose, so the rest pose matches the T-pose of most sculpted sources. The statue is joined into one object, scaled
# and centred onto the donor, and gets its weights from the donor surface with a Data Transfer modifier
# (POLYINTERP_NEAREST: interpolated over the nearest donor face, not nearest vertex). Garment vertices therefore follow
# the body under them instead of the nearest bone, which is what makes a coat bend instead of hang.
# The output has a skin and a skeleton but no clips: the pipeline retargets those (rigmap `retarget`).
import sys

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
donor_path, static_path, out_path = argv[0], argv[1], argv[2]
pose_name = argv[argv.index("--pose") + 1] if "--pose" in argv else "A_TPose"
yaw = float(argv[argv.index("--yaw") + 1]) if "--yaw" in argv else 0.0
# Materials of the bare body under the clothes. The statue is aligned on those, not on its silhouette: a helmet and a
# boot sole would otherwise push the donor skeleton down inside the legs, and the feet then dig through the ground.
body_mats = set((argv[argv.index("--body") + 1] if "--body" in argv else "").split(",")) - {""}
# Delete the body faces that are permanently under a garment: "reach,margin" in metres and in rings of kept faces.
cull = [float(v) for v in argv[argv.index("--cull") + 1].split(",")] if "--cull" in argv else None
# Degrees to swing the donor's upper arms down from the T-pose before it becomes the rest pose. Most sculpted sources
# stand in an A-pose; binding those to a T-posed rest maps a hanging arm onto the torso and the shoulder tears apart.
arms = float(argv[argv.index("--arms") + 1]) if "--arms" in argv else 0.0
# Triangle budget for the statue before the weight transfer. A multi-million-triangle photogrammetry scan is reduced
# here rather than after skinning: the data transfer is O(verts) and the pipeline reduces to its LOD0 band anyway.
decimate = int(argv[argv.index("--decimate") + 1]) if "--decimate" in argv else 0
# Blur the transferred weights over neighbouring vertices: "factor,iterations" (0.5,2 is a ring or two).
smooth = [float(v) for v in argv[argv.index("--smooth") + 1].split(",")] if "--smooth" in argv else None
# Cut the shell between two parts that are fused in the source but belong to bones this many steps apart or more.
split = int(argv[argv.index("--split") + 1]) if "--split" in argv else 0


def log(*a):
    print("[rig-from-donor]", *a)


def activate(obj, others=()):
    bpy.ops.object.select_all(action="DESELECT")
    for o in others:
        o.select_set(True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def bounds(objs):
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in objs:
        for corner in o.bound_box:
            w = o.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def body_bounds(obj):
    """Bbox of the faces with a material from `--body`; the whole object when that is empty or matches nothing."""
    slots = [i for i, m in enumerate(obj.data.materials) if m and m.name.split(".")[0] in body_mats]
    if not slots:
        return bounds([obj])
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for poly in obj.data.polygons:
        if poly.material_index not in slots:
            continue
        for vi in poly.vertices:
            w = obj.matrix_world @ obj.data.vertices[vi].co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def cull_hidden(obj, reach, margin):
    """Drops body faces whose three corners all have a garment within `reach` along their normal, then grows the kept
    set by `margin` rings so wrist, neck and ankle keep their few millimetres of skin where cloth meets flesh."""
    import bmesh
    from mathutils.bvhtree import BVHTree

    mesh = obj.data
    body_slots = {i for i, m in enumerate(mesh.materials) if m and m.name.split(".")[0] in body_mats}
    if not body_slots:
        return 0
    verts = [v.co for v in mesh.vertices]
    cover = [list(p.vertices) for p in mesh.polygons if p.material_index not in body_slots]
    tree = BVHTree.FromPolygons(verts, cover, all_triangles=False, epsilon=0.0)
    normals = [v.vector for v in mesh.vertex_normals]
    covered = {}
    for p in mesh.polygons:
        if p.material_index not in body_slots:
            continue
        for vi in p.vertices:
            if vi not in covered:
                n = normals[vi]
                covered[vi] = tree.ray_cast(verts[vi] + n * 1e-4, n, reach)[0] is not None
    keep = {p.index for p in mesh.polygons if p.material_index in body_slots and not all(covered[v] for v in p.vertices)}
    for _ in range(int(margin)):
        edge = {v for i in keep for v in mesh.polygons[i].vertices}
        keep |= {p.index for p in mesh.polygons if p.material_index in body_slots and any(v in edge for v in p.vertices)}
    drop = [p.index for p in mesh.polygons if p.material_index in body_slots and p.index not in keep]
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in drop], context="FACES")
    bm.to_mesh(mesh)
    bm.free()
    return len(drop)


def split_fused(obj, armature, max_distance):
    """Cuts the mesh wherever two neighbouring vertices belong to bones that are far apart in the skeleton.

    A sculpture generated from photographs is one watertight shell: a hand resting against a thigh is welded to it.
    Skinning that shell is correct per vertex and catastrophic per triangle, because the faces bridging hand and thigh
    are stretched the full length of the arm on every frame. Splitting those edges lets the two parts move apart, at
    the price of a seam where they used to touch. Distance is measured in steps through the bone tree, so a crotch
    (LeftUpLeg to RightUpLeg, two steps via Hips) and a neck stay whole, while hand to thigh (nine steps) comes apart.
    """
    import bmesh
    from collections import deque

    bones = armature.data.bones
    neighbours = {b.name: set() for b in bones}
    for bone in bones:
        if bone.parent:
            neighbours[bone.name].add(bone.parent.name)
            neighbours[bone.parent.name].add(bone.name)
    distance = {}
    for start in neighbours:
        seen = {start: 0}
        queue = deque([start])
        while queue:
            current = queue.popleft()
            if seen[current] >= max_distance:
                continue
            for other in neighbours[current]:
                if other not in seen:
                    seen[other] = seen[current] + 1
                    queue.append(other)
        distance[start] = seen

    names = [g.name for g in obj.vertex_groups]
    dominant = []
    for vertex in obj.data.vertices:
        best = max(vertex.groups, key=lambda g: g.weight, default=None)
        dominant.append(names[best.group] if best is not None and best.weight > 0 else None)

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    far = [
        e
        for e in bm.edges
        if (a := dominant[e.verts[0].index]) is not None
        and (b := dominant[e.verts[1].index]) is not None
        and b not in distance.get(a, {})
    ]
    if far:
        bmesh.ops.split_edges(bm, edges=far)
    bm.to_mesh(obj.data)
    bm.free()
    return len(far)


bpy.ops.wm.read_factory_settings(use_empty=True)

# 1. Donor: armature plus the one mesh that the armature deforms.
bpy.ops.import_scene.gltf(filepath=donor_path)
scene = bpy.context.scene
armature = next(o for o in scene.objects if o.type == "ARMATURE")
donor_meshes = [
    o for o in scene.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)
]
for o in [o for o in scene.objects if o.type == "MESH" and o not in donor_meshes]:
    bpy.data.objects.remove(o, do_unlink=True)
if len(donor_meshes) > 1:
    activate(donor_meshes[0], donor_meshes[1:])
    bpy.ops.object.join()
    donor_meshes = [bpy.context.view_layer.objects.active]
donor = donor_meshes[0]
log(f"donor {donor.name}: {len(donor.data.vertices)} verts, {len(armature.data.bones)} bones")

# 2. Pose the armature to `pose_name`, bake that shape into the donor mesh, then make it the rest pose. Skinning is
# defined against the rest pose, so a T-pose rest is what lets a T-posed statue be bound without deforming it first.
action = bpy.data.actions.get(pose_name)
if action is None:
    raise SystemExit(f"donor has no action {pose_name!r}; has {[a.name for a in bpy.data.actions]}")
anim = armature.animation_data or armature.animation_data_create()
anim.action = action
slots = getattr(anim, "action_suitable_slots", None)
if slots:
    anim.action_slot = slots[0]
scene.frame_set(int(action.frame_range[0]))
bpy.context.view_layer.update()

if arms:
    # Swing each upper arm down around its own head, in the armature's space: +Y turns the left (+X) arm downwards,
    # -Y the right one. Forearm and hand are children in the pose tree, so they follow without being touched.
    activate(armature)
    bpy.ops.object.mode_set(mode="POSE")
    for suffix, sign in (("L", 1.0), ("R", -1.0)):
        bone = armature.pose.bones.get(f"DEF-upper_arm.{suffix}")
        if bone is None:
            raise SystemExit(f"--arms needs bone DEF-upper_arm.{suffix}; donor has {len(armature.pose.bones)} bones")
        pivot = bone.head.copy()
        rotation = Matrix.Rotation(sign * arms * 3.141592653589793 / 180.0, 4, "Y")
        bone.matrix = Matrix.Translation(pivot) @ rotation @ Matrix.Translation(-pivot) @ bone.matrix
        bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()
    log(f"arms swung {arms} deg down from {pose_name}")

activate(donor)
armature_mod = next(m for m in donor.modifiers if m.type == "ARMATURE")
bpy.ops.object.modifier_apply(modifier=armature_mod.name)
activate(armature)
bpy.ops.object.mode_set(mode="POSE")
bpy.ops.pose.armature_apply()
bpy.ops.object.mode_set(mode="OBJECT")
armature.animation_data_clear()
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
activate(donor)
donor.modifiers.new("Armature", "ARMATURE").object = armature
bpy.context.view_layer.update()
donor_lo, donor_hi = bounds([donor])
log(f"donor rest pose {pose_name}: bbox {tuple(round(v, 3) for v in donor_hi - donor_lo)}")

# 3. Statue: one object, all transforms applied.
before = set(scene.objects)
bpy.ops.import_scene.gltf(filepath=static_path)
new = [o for o in scene.objects if o not in before]
statue_meshes = [o for o in new if o.type == "MESH"]
activate(statue_meshes[0], statue_meshes[1:])
bpy.ops.object.join()
statue = bpy.context.view_layer.objects.active
statue.name = "body"
statue.data.name = "body"
# Out of the imported hierarchy first: transform_apply only bakes the object's own matrix, not its parents'.
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in [o for o in scene.objects if o not in (statue, donor, armature)]:
    bpy.data.objects.remove(o, do_unlink=True)
activate(statue)
log(f"statue: {len(statue.data.vertices)} verts, {len(statue.data.polygons)} faces")

if decimate and len(statue.data.polygons) > decimate:
    mod = statue.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = decimate / len(statue.data.polygons)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    log(f"decimated to {len(statue.data.polygons)} faces")

# 4. Align: yaw, then uniform scale to the donor's height, feet on the donor's feet, horizontally centred on the donor.
if yaw:
    statue.matrix_world = Matrix.Rotation(yaw * 3.141592653589793 / 180.0, 4, "Z") @ statue.matrix_world
    bpy.ops.object.transform_apply(rotation=True)
lo, hi = body_bounds(statue)
scale = (donor_hi.z - donor_lo.z) / (hi.z - lo.z)
offset = Vector(
    (
        (donor_lo.x + donor_hi.x) / 2 - (lo.x + hi.x) / 2 * scale,
        (donor_lo.y + donor_hi.y) / 2 - (lo.y + hi.y) / 2 * scale,
        donor_lo.z - lo.z * scale,
    )
)
statue.matrix_world = Matrix.Translation(offset) @ Matrix.Scale(scale, 4) @ statue.matrix_world
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
lo, hi = body_bounds(statue)
log(f"aligned: scale {scale:.5f}, body   bbox {tuple(round(v, 3) for v in lo)} .. {tuple(round(v, 3) for v in hi)}")
log(f"         donor  bbox {tuple(round(v, 3) for v in donor_lo)} .. {tuple(round(v, 3) for v in donor_hi)}")

if cull:
    dropped = cull_hidden(statue, cull[0], cull[1] if len(cull) > 1 else 2)
    log(f"culled {dropped} covered body faces, {len(statue.data.polygons)} faces left")

# 5. Weights from the donor surface onto every statue vertex.
activate(statue)
mod = statue.modifiers.new("WeightTransfer", "DATA_TRANSFER")
mod.object = donor
mod.use_vert_data = True
mod.data_types_verts = {"VGROUP_WEIGHTS"}
mod.vert_mapping = "POLYINTERP_NEAREST"
mod.layers_vgroup_select_src = "ALL"
mod.layers_vgroup_select_dst = "NAME"
bpy.ops.object.datalayout_transfer(modifier=mod.name)
bpy.ops.object.modifier_apply(modifier=mod.name)
if split:
    cut = split_fused(statue, armature, split)
    log(f"split {cut} edges whose two ends belong to bones more than {split} apart in the skeleton")
if smooth:
    # The transfer is deliberately crisp: a vertex left of the crotch gets LeftUpLeg 1.00, one 10 mm to its right gets
    # RightUpLeg 1.00. On a low-poly source whose legs are bridged by a few faces there is then no gradient to bend
    # over and that bridge rips open. Smoothing over a ring or two gives it one, without blurring whole limbs.
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.object.vertex_group_smooth(group_select_mode="ALL", factor=smooth[0], repeat=int(smooth[1]))
    bpy.ops.object.mode_set(mode="OBJECT")
    log(f"smoothed weights: factor {smooth[0]}, {int(smooth[1])} iterations")
bpy.ops.object.vertex_group_limit_total(limit=4)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
unweighted = sum(1 for v in statue.data.vertices if sum(g.weight for g in v.groups) <= 1e-6)
log(f"weights: {len(statue.vertex_groups)} groups, {unweighted} of {len(statue.data.vertices)} verts without weight")

# 6. Bind and export. The donor mesh is only a weight source; it does not ship.
statue.parent = armature
statue.matrix_parent_inverse = armature.matrix_world.inverted()
statue.modifiers.new("Armature", "ARMATURE").object = armature
bpy.data.objects.remove(donor, do_unlink=True)
bpy.ops.object.select_all(action="DESELECT")
bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format="GLB",
    export_animations=False,
    export_skins=True,
    export_image_format="AUTO",
    export_yup=True,
)
log("wrote", out_path)
