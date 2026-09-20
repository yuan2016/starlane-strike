# 程序化生成 Boss 重型战舰（Thunder Strike 风格：深灰钛装甲 + 青色能量线 + 中央红色巨型核心 + 四联激光炮）
# 用法: blender --background --factory-startup --python tools/blender/make_boss_battleship.py
#
# 坐标系：Blender 内 +Y = 舰首（导出 glTF 后为 +Z，与 src/boss/Boss.ts 一致），+X = 右舷，+Z = 上
# 尺寸对齐现有 Boss：舰体 7.5 宽 × 8 长，翼展 ±7.75，核心居中偏上
import bpy
import bmesh
import math
import os
from mathutils import Matrix, Vector

ROOT = "c:/Users/gaoy-al/Desktop/starlane-strike"
OUT_GLB = os.path.join(ROOT, "public", "models", "boss_battleship.glb")
OUT_BLEND = os.path.join(ROOT, "public", "models", "boss_battleship.blend")
PREVIEW_3Q = os.path.join(ROOT, "tools", "blender", "preview_boss_3q.png")
PREVIEW_TOP = os.path.join(ROOT, "tools", "blender", "preview_boss_top.png")

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


M_HULL = make_material("TitaniumHull", (0.22, 0.24, 0.27), 0.92, 0.34)
M_PLATE = make_material("ArmorPlate", (0.34, 0.36, 0.40), 0.85, 0.50)
M_DARK = make_material("DarkStructure", (0.08, 0.09, 0.11), 0.90, 0.50)
M_CYAN = make_material("CyanEnergy", (0.0, 0.04, 0.05), 0.0, 0.4, (0.10, 0.90, 1.0), 6.0)
M_CORE = make_material("RedCore", (0.30, 0.02, 0.01), 0.20, 0.25, (1.0, 0.07, 0.02), 12.0)
M_MUZZLE = make_material("LaserMuzzle", (0.05, 0.15, 0.20), 0.0, 0.3, (0.45, 0.95, 1.0), 9.0)


def finish(bm, name, matl, bevel=0.0):
    if bevel > 0:
        try:
            bmesh.ops.bevel(
                bm,
                geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                offset=bevel, segments=1, affect="EDGES", clamp_overlap=True,
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


def make_box(name, size, loc, matl, bevel=0.01, rot=(0.0, 0.0, 0.0)):
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


def make_cyl(name, radius, depth, loc, matl, rot=(0.0, 0.0, 0.0), segments=20):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments,
                          radius1=radius, radius2=radius, depth=depth)
    obj = finish(bm, name, matl, 0.0)
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def make_sphere(name, radius, loc, matl, segments=24, rings=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    obj = finish(bm, name, matl, 0.0)
    obj.location = loc
    return obj


def make_torus(name, major, minor, loc, matl, rot=(0.0, 0.0, 0.0), maj_seg=40, min_seg=8):
    bpy.ops.mesh.primitive_torus_add(
        location=loc, rotation=rot, major_radius=major, minor_radius=minor,
        major_segments=maj_seg, minor_segments=min_seg,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name
    obj.data.materials.append(matl)
    return obj


def make_slab(name, outline, thickness, z0, matl, bevel=0.01, mirror=False):
    """顶视图轮廓 (x, y) -> 沿 Z 挤出。"""
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
    """侧视图轮廓 (y, z) -> 沿 X 挤出。"""
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


def strip_between(name, p1, p2, matl, w=0.12, t=0.09, shrink=0.92):
    """两点之间的能量线/装饰条。"""
    mx, my, mz = (p1[0] + p2[0]) / 2.0, (p1[1] + p2[1]) / 2.0, (p1[2] + p2[2]) / 2.0
    length = math.dist((p1[0], p1[1]), (p2[0], p2[1]))
    ang = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
    return make_box(name, (length * shrink, w, t), (mx, my, mz), matl, bevel=0.004, rot=(0.0, 0.0, ang))


# ---------- 主舰体（带收腰的加长装甲块） ----------
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=8, use_grid_fill=True)
for v in bm.verts:
    y = v.co.y * 8.0                      # -4.0(舰尾) .. +4.0(舰首)
    t = (y + 4.0) / 8.0
    w = 1.0 - 0.16 * smoothstep(0.0, 0.35, t) - 0.18 * smoothstep(0.62, 1.0, t)
    v.co.x *= 7.5 * w
    v.co.z *= 1.8 * (1.0 - 0.22 * smoothstep(0.65, 1.0, t))
    v.co.y = y
hull = finish(bm, "Hull", M_HULL, bevel=0.05)
hull.location = (0.0, 0.0, 0.1)

# 舰首四棱锥（钻石形截面）
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=2.6, radius2=0.18, depth=4.2)
prow = finish(bm, "Prow", M_HULL, 0.06)
# 先绕自身 Z 转 45° 摆正菱形截面，再绕 X 转 -90° 让锥尖指向 +Y（舰首）
prow.rotation_mode = "QUATERNION"
prow.rotation_quaternion = (
    Matrix.Rotation(math.radians(-90.0), 4, "X")
    @ Matrix.Rotation(math.radians(45.0), 4, "Z")
).to_quaternion()
prow.location = (0.0, 5.6, 0.1)

# 上层甲板 / 舰桥
make_box("UpperDeck", (5.4, 6.0, 1.1), (0.0, -0.6, 1.2), M_PLATE, bevel=0.04)
make_box("Bridge", (2.8, 2.6, 1.0), (0.0, -2.6, 1.9), M_PLATE, bevel=0.04)
make_box("BridgeCrown", (1.9, 1.6, 0.5), (0.0, -2.6, 2.6), M_HULL, bevel=0.03)
make_box("RearBlock", (5.0, 0.7, 2.2), (0.0, -4.15, 0.9), M_PLATE, bevel=0.04)

# ---------- 中央红色巨型核心 ----------
CORE = (0.0, 0.8, 1.9)
make_sphere("Core", 1.5, CORE, M_CORE, segments=40, rings=24)
# 三道正交齿轮环
make_torus("CoreRingA", 2.35, 0.16, CORE, M_DARK, rot=(0.0, 0.0, 0.0))
make_torus("CoreRingB", 2.35, 0.16, CORE, M_DARK, rot=(math.radians(90.0), 0.0, 0.0))
make_torus("CoreRingGlow", 2.0, 0.09, CORE, M_CYAN, rot=(0.0, math.radians(90.0), 0.0))
# 四片装甲瓣（留缝透红光）
for i in range(4):
    ang = math.radians(45.0 + 90.0 * i)
    px, py = math.cos(ang) * 2.45, math.sin(ang) * 2.45
    make_box(f"CorePetal{i}", (1.15, 0.42, 2.7),
             (px, py, CORE[2]), M_PLATE, bevel=0.03, rot=(0.0, 0.0, ang))

# ---------- 主翼（沿用 Boss.ts 的翼形轮廓，映射到 Blender 坐标） ----------
WING = [(0.0, 2.75), (1.65, 2.70), (3.35, 1.85), (4.35, 1.05), (4.75, 0.55),
        (4.75, -0.15), (4.10, -0.75), (3.05, -1.05), (2.90, -1.75),
        (1.55, -2.15), (1.40, -2.85), (0.0, -3.25)]
PIVOT_X, PIVOT_Y, PIVOT_Z = 3.0, -0.4, 0.1
for s, suf in ((1, "R"), (-1, "L")):
    wing = make_slab(f"Wing{suf}", WING, 0.78, -0.39, M_PLATE, bevel=0.12, mirror=(s < 0))
    wing.location = (s * PIVOT_X, PIVOT_Y, PIVOT_Z)
    wing.rotation_euler = (0.0, 0.0, s * 0.06)

    # 翼面能量线（前缘 / 后缘阶梯）
    w = lambda p: (s * (PIVOT_X + p[0]), PIVOT_Y + p[1])
    strip_between(f"WingLine1{suf}", (*w((0.2, 2.55)), 0.50), (*w((4.55, 0.72)), 0.50), M_CYAN, w=0.13)
    strip_between(f"WingLine2{suf}", (*w((0.2, -3.05)), 0.50), (*w((2.85, -1.72)), 0.50), M_CYAN, w=0.11)
    strip_between(f"WingLine3{suf}", (*w((1.62, 2.62)), 0.50), (*w((3.30, 1.80)), 0.50), M_CYAN, w=0.09)

    # 翼尖垂直安定面
    make_side_slab(f"Fin{suf}", [(-1.00, 0.0), (0.60, 0.15), (0.50, 1.35), (-0.15, 1.00), (-0.55, 0.10)],
                   0.22, (s * 4.3, -0.9, 0.5), M_PLATE, bevel=0.05)

    # 四联激光炮（翼载炮组：2×2 炮管）
    pod = (s * 5.6, 2.4, -0.1)
    make_box(f"QuadPod{suf}", (1.5, 1.1, 0.9), pod, M_DARK, bevel=0.05)
    for j, (dx, dz) in enumerate(((-0.38, 0.30), (0.38, 0.30), (-0.38, -0.30), (0.38, -0.30))):
        make_cyl(f"QuadBarrel{suf}{j}", 0.28, 2.6,
                 (pod[0] + dx, pod[1] + 1.45, pod[2] + dz), M_HULL,
                 rot=(math.radians(-90.0), 0.0, 0.0), segments=14)
        make_sphere(f"QuadMuzzle{suf}{j}", 0.30,
                    (pod[0] + dx, pod[1] + 2.75, pod[2] + dz), M_MUZZLE, segments=14, rings=10)

    # 翼尖炮塔（可击毁部件位置与 Boss.ts 一致）
    tx, ty, tz = s * 6.4, 1.2, 0.7
    make_cyl(f"TurretBase{suf}", 1.1, 0.9, (tx, ty, tz), M_PLATE)
    make_cyl(f"TurretRing{suf}", 1.28, 0.22, (tx, ty, tz - 0.34), M_DARK)
    make_cyl(f"TurretBarrel{suf}", 0.28, 3.2, (tx, ty + 1.7, tz), M_HULL,
             rot=(math.radians(-90.0), 0.0, 0.0), segments=14)
    make_sphere(f"TurretGlow{suf}", 0.34, (tx, ty + 3.3, tz), M_MUZZLE, segments=16, rings=12)

# ---------- 舰尾推进器 ----------
for s, suf in ((1, "R"), (-1, "L")):
    for k, (ex, ez) in enumerate(((1.3, -0.1), (2.7, 0.35))):
        make_cyl(f"Engine{suf}{k}", 0.62, 1.6, (s * ex, -4.25, ez), M_DARK,
                 rot=(math.radians(-90.0), 0.0, 0.0), segments=18)
        make_cyl(f"EngineRing{suf}{k}", 0.72, 0.2, (s * ex, -4.95, ez), M_PLATE,
                 rot=(math.radians(-90.0), 0.0, 0.0), segments=18)
        make_cyl(f"EngineGlow{suf}{k}", 0.48, 0.16, (s * ex, -5.05, ez), M_MUZZLE,
                 rot=(math.radians(-90.0), 0.0, 0.0), segments=18)

# ---------- 青色能量线（舰体 / 甲板 / 舰首） ----------
for s, suf in ((1, "R"), (-1, "L")):
    make_box(f"HullLine{suf}", (0.08, 4.6, 0.15), (s * 3.62, 0.0, 0.55), M_CYAN, bevel=0.004)
    make_box(f"DeckLine{suf}", (0.08, 5.9, 0.08), (s * 2.70, -0.6, 1.78), M_CYAN, bevel=0.003)
    strip_between(f"ProwLine{suf}", (s * 1.55, 4.1, 0.55), (s * 0.42, 6.9, 0.18), M_CYAN, w=0.10)
make_box("DeckLineF", (5.3, 0.08, 0.08), (0.0, 2.42, 1.78), M_CYAN, bevel=0.003)
make_box("DeckLineB", (5.3, 0.08, 0.08), (0.0, -3.62, 1.78), M_CYAN, bevel=0.003)
make_box("BridgeLine", (2.7, 0.09, 0.09), (0.0, -1.32, 2.42), M_CYAN, bevel=0.003)

# ---------- 机械细节（散热肋 / 装甲板 / 传感器桅杆） ----------
for i in range(7):
    y = -3.0 + i * 1.0
    for s, suf in ((1, "R"), (-1, "L")):
        make_box(f"Rib{suf}{i}", (0.10, 0.45, 1.25), (s * 3.70, y, 0.25), M_DARK, bevel=0.004)
for s, suf in ((1, "R"), (-1, "L")):
    make_box(f"DeckPlate{suf}", (1.7, 2.3, 0.07), (s * 1.35, 1.5, 1.79), M_HULL, bevel=0.004)
    make_box(f"Shoulder{suf}", (1.3, 0.9, 1.5), (s * 2.25, -3.35, 1.05), M_PLATE, bevel=0.04)
    make_cyl(f"Mast{suf}", 0.09, 1.7, (s * 0.95, -3.0, 3.2), M_DARK, segments=10)
    make_sphere(f"MastTip{suf}", 0.16, (s * 0.95, -3.0, 4.05), M_CYAN, segments=12, rings=8)
make_box("DeckPlateC", (2.3, 1.0, 0.07), (0.0, -0.4, 1.79), M_HULL, bevel=0.004)

# ---------- 预览渲染（正交，模拟等距俯视） ----------
world = bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.0, 0.0, 0.0, 1.0)

sun = bpy.data.lights.new("Sun", "SUN")
sun.energy = 4.0
sun_o = bpy.data.objects.new("Sun", sun)
scene.collection.objects.link(sun_o)
sun_o.rotation_euler = (0.95, 0.0, 0.45)

fill = bpy.data.lights.new("Fill", "AREA")
fill.energy = 2500
fill.size = 12
fill_o = bpy.data.objects.new("Fill", fill)
scene.collection.objects.link(fill_o)
fill_o.location = (-9.0, -8.0, 9.0)
fill_o.rotation_euler = (-Vector(fill_o.location)).to_track_quat("-Z", "Y").to_euler()

rim = bpy.data.lights.new("Rim", "AREA")
rim.energy = 900
rim.size = 10
rim_o = bpy.data.objects.new("Rim", rim)
scene.collection.objects.link(rim_o)
rim_o.location = (8.0, 9.0, -4.0)
rim_o.rotation_euler = (-Vector(rim_o.location)).to_track_quat("-Z", "Y").to_euler()


def add_camera(name, loc, target, ortho_scale):
    from mathutils import Vector as V
    cam_data = bpy.data.cameras.new(name)
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho_scale
    cam = bpy.data.objects.new(name, cam_data)
    scene.collection.objects.link(cam)
    cam.location = loc
    cam.rotation_euler = (V(target) - V(loc)).to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_end = 200.0
    return cam


cam_3q = add_camera("Cam3Q", (13.0, -10.0, 10.0), (0.0, 0.2, 0.6), 23.0)
cam_top = add_camera("CamTop", (0.0, -1.0, 22.0), (0.0, 0.0, 0.0), 21.0)

scene.render.engine = "CYCLES"
scene.cycles.samples = 48
scene.render.resolution_x = 1000
scene.render.resolution_y = 700
os.makedirs(os.path.dirname(PREVIEW_3Q), exist_ok=True)
for cam, path in ((cam_3q, PREVIEW_3Q), (cam_top, PREVIEW_TOP)):
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

# ---------- 导出 ----------
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", export_apply=True,
                          export_cameras=False, export_lights=False)
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
print(f"DONE glb={OUT_GLB} ({os.path.getsize(OUT_GLB) / 1024.0:.1f} KB) "
      f"blend={OUT_BLEND} ({os.path.getsize(OUT_BLEND) / 1024.0:.1f} KB)")
