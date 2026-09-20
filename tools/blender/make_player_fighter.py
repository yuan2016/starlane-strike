# 程序化生成玩家战机模型（参考：金色/银灰装甲 + 青色发光条的双发科幻战机）
# 用法: blender --background --factory-startup --python tools/blender/make_player_fighter.py
# 输出: public/models/player_fighter.glb（+Y up / 机头朝 -Z，符合 three.js 与本项目约定）
import bpy
import bmesh
import math
import os
from mathutils import Vector

ROOT = "c:/Users/gaoy-al/Desktop/starlane-strike"
OUT_GLB = os.path.join(ROOT, "public", "models", "player_fighter.glb")
PREVIEW = os.path.join(ROOT, "tools", "blender", "preview_fighter.png")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def make_material(name, base, metallic, roughness, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


M_HULL = make_material("Hull", (0.58, 0.60, 0.64), 0.85, 0.42)
M_GOLD = make_material("Gold", (0.85, 0.63, 0.22), 1.0, 0.28)
M_DARK = make_material("DarkMetal", (0.10, 0.11, 0.13), 0.90, 0.45)
M_GLASS = make_material("Canopy", (0.03, 0.06, 0.10), 0.60, 0.08)
M_CYAN = make_material("CyanGlow", (0.0, 0.04, 0.05), 0.0, 0.4, (0.15, 0.95, 1.0), 5.0)
M_THRUST = make_material("Thrust", (0.05, 0.10, 0.15), 0.0, 0.3, (0.35, 0.75, 1.0), 10.0)


def finish(bm, name, matl, bevel=0.0):
    if bevel > 0:
        try:
            bmesh.ops.bevel(
                bm,
                geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                offset=bevel, segments=2, affect="EDGES", clamp_overlap=True,
            )
        except Exception:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    mesh.materials.append(matl)
    return obj


def make_box(name, size, loc, matl, bevel=0.008, rot=(0.0, 0.0, 0.0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    obj = finish(bm, name, matl, bevel)
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def make_cyl(name, radius, depth, loc, matl, rot=(0.0, 0.0, 0.0), segments=24):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=depth)
    obj = finish(bm, name, matl, 0.0)
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def make_slab(name, outline, thickness, z0, matl, bevel=0.008, mirror=False):
    """顶视图轮廓 (x, y) -> 沿 Z 挤出 thickness。"""
    pts = [(-x, y) for (x, y) in reversed(outline)] if mirror else list(outline)
    bm = bmesh.new()
    verts = [bm.verts.new((p[0], p[1], 0.0)) for p in pts]
    bm.faces.new(verts)
    geom = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    ups = [e for e in geom["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=ups, vec=(0.0, 0.0, thickness))
    obj = finish(bm, name, matl, bevel)
    obj.location = (0.0, 0.0, z0)
    return obj


def make_side_slab(name, outline_yz, thickness, loc, matl, bevel=0.006, rot=(0.0, 0.0, 0.0)):
    """侧视图轮廓 (y, z) -> 沿 X 挤出 thickness，局部坐标 + loc 定位。"""
    bm = bmesh.new()
    verts = [bm.verts.new((0.0, y, z)) for (y, z) in outline_yz]
    bm.faces.new(verts)
    geom = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    ups = [e for e in geom["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=ups, vec=(thickness, 0.0, 0.0))
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=(-thickness / 2.0, 0.0, 0.0))
    obj = finish(bm, name, matl, bevel)
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def edge_strip(name, p1, p2, matl, w=0.07, t=0.03, z=0.02, mirror=False, shrink=0.9):
    """沿顶视图线段 p1->p2 放置的发光/装饰条。"""
    mx = (p1[0] + p2[0]) / 2.0
    my = (p1[1] + p2[1]) / 2.0
    length = math.dist(p1, p2)
    ang = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
    make_box(
        name, (length * shrink, w, t),
        ((-mx if mirror else mx), my, z), matl,
        bevel=0.004, rot=(0.0, 0.0, (math.pi - ang) if mirror else ang),
    )


# ---------- 机身（细长，机头朝 -Y，Blender 内 Z 朝上） ----------
def make_hull():
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=8, use_grid_fill=True)
    for v in bm.verts:
        y = (v.co.y + 0.5) * 4.4 - 2.4          # -2.4(机头) .. +2.0(尾部)
        t = (y + 2.4) / 4.4
        nose = smoothstep(0.0, 0.30, t)
        tail = 1.0 - 0.30 * smoothstep(0.70, 1.0, t)
        v.co.x *= 0.90 * nose * tail
        v.co.z *= 0.55 * (0.35 + 0.65 * nose) * (1.0 - 0.25 * smoothstep(0.70, 1.0, t))
        v.co.y = y
    return finish(bm, "Hull", M_HULL, bevel=0.02)


make_hull()

# ---------- 座舱 ----------
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1.0)
for v in bm.verts:
    v.co.x *= 0.24
    v.co.y *= 0.60
    v.co.z *= 0.24
canopy = finish(bm, "Canopy", M_GLASS)
canopy.location = (0.0, -1.15, 0.28)

# 机头金色锥
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.13, radius2=0.02, depth=0.4)
nose = finish(bm, "NoseTip", M_GOLD, 0.01)
nose.rotation_euler = (math.radians(90.0), 0.0, 0.0)
nose.location = (0.0, -2.30, 0.02)

# ---------- 主翼（后掠三角翼） ----------
WING = [(0.35, -0.55), (2.95, 1.05), (2.75, 1.55), (0.35, 1.35)]
for s, suf in ((1, "L"), (-1, "R")):
    make_slab(f"Wing{suf}", WING, 0.09, -0.06, M_HULL, bevel=0.015, mirror=(s < 0))
    # 翼前缘青色发光条
    edge_strip(f"WingGlow{suf}", WING[0], WING[1], M_CYAN, mirror=(s < 0))
    # 翼后缘金色条
    edge_strip(f"WingTrim{suf}", WING[3], WING[2], M_GOLD, w=0.06, t=0.02, z=-0.02,
               mirror=(s < 0), shrink=0.85)

# ---------- 翼尖吊舱（机炮） ----------
for s, suf in ((1, "L"), (-1, "R")):
    make_cyl(f"TipPod{suf}", 0.08, 0.9, (s * 2.80, 1.25, -0.015), M_DARK,
             rot=(math.radians(90.0), 0.0, 0.0))
    make_cyl(f"TipGlow{suf}", 0.05, 0.1, (s * 2.80, 0.84, -0.015), M_THRUST,
             rot=(math.radians(90.0), 0.0, 0.0))

# ---------- 双垂尾（外倾） ----------
FIN = [(-0.30, 0.00), (0.55, 0.95), (0.85, 0.95), (0.85, 0.15)]
for s, suf in ((1, "L"), (-1, "R")):
    make_side_slab(f"Fin{suf}", FIN, 0.06, (-s * 0.40, 1.20, 0.20), M_GOLD,
                   rot=(0.0, s * 0.25, 0.0))

# ---------- 平尾 ----------
STAB = [(0.35, 1.05), (1.55, 1.75), (1.45, 2.05), (0.35, 1.95)]
for s, suf in ((1, "L"), (-1, "R")):
    make_slab(f"Stab{suf}", STAB, 0.07, 0.0, M_HULL, bevel=0.01, mirror=(s < 0))

# ---------- 双发动机短舱 ----------
for s, suf in ((1, "L"), (-1, "R")):
    make_cyl(f"Nacelle{suf}", 0.26, 1.2, (s * 0.52, 1.45, -0.02), M_DARK,
             rot=(math.radians(90.0), 0.0, 0.0))
    make_cyl(f"NozzleRing{suf}", 0.22, 0.18, (s * 0.52, 2.02, -0.02), M_GOLD,
             rot=(math.radians(90.0), 0.0, 0.0))
    make_cyl(f"EngineGlow{suf}", 0.16, 0.08, (s * 0.52, 2.00, -0.02), M_THRUST,
             rot=(math.radians(90.0), 0.0, 0.0))

# ---------- 金色装甲细节 ----------
make_box("SpineStripe", (0.16, 1.7, 0.02), (0.0, -0.55, 0.268), M_GOLD, bevel=0.004)
for s, suf in ((1, "L"), (-1, "R")):
    make_box(f"SidePanel{suf}", (0.03, 1.1, 0.16), (s * 0.44, -0.30, 0.02), M_GOLD, bevel=0.004)
make_box("RearSpine", (0.50, 0.8, 0.04), (0.0, 1.55, 0.21), M_GOLD, bevel=0.006)

# ---------- 青色散热口 ----------
for s, suf in ((1, "L"), (-1, "R")):
    make_box(f"Vent{suf}", (0.08, 0.35, 0.03), (s * 0.18, 0.55, 0.275), M_CYAN, bevel=0.003)
    make_box(f"NoseVent{suf}", (0.03, 0.45, 0.04), (s * 0.30, -1.55, 0.10), M_CYAN, bevel=0.003)

# 天线
make_cyl("Antenna", 0.015, 0.45, (0.0, 1.60, 0.35), M_DARK)

# ---------- 预览渲染（Cycles CPU，用于核对造型） ----------
world = bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.008, 0.008, 0.015, 1.0)

sun = bpy.data.lights.new("Sun", "SUN")
sun.energy = 3.5
sun_o = bpy.data.objects.new("Sun", sun)
scene.collection.objects.link(sun_o)
sun_o.rotation_euler = (math.radians(55.0), 0.0, math.radians(30.0))

fill = bpy.data.lights.new("Fill", "AREA")
fill.energy = 1500
fill.size = 8
fill_o = bpy.data.objects.new("Fill", fill)
scene.collection.objects.link(fill_o)
fill_o.location = (-4.0, -4.0, 4.0)
fill_quat = (-Vector(fill_o.location)).to_track_quat("-Z", "Y")
fill_o.rotation_euler = fill_quat.to_euler()

cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 50
cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam)
cam.location = (4.8, -5.2, 2.8)
cam_quat = (-Vector(cam.location)).to_track_quat("-Z", "Y")
cam.rotation_euler = cam_quat.to_euler()
scene.camera = cam

scene.render.engine = "CYCLES"
scene.cycles.samples = 48
scene.render.resolution_x = 900
scene.render.resolution_y = 600
os.makedirs(os.path.dirname(PREVIEW), exist_ok=True)
scene.render.filepath = PREVIEW
bpy.ops.render.render(write_still=True)

# ---------- 导出 GLB ----------
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", export_apply=True)
size_kb = os.path.getsize(OUT_GLB) / 1024.0
print(f"DONE glb={OUT_GLB} ({size_kb:.1f} KB) preview={PREVIEW}")
