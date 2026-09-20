# 把 public/models/player_fighter.glb 转成可直接双击打开的 .blend（含相机 / 灯光 / 渲染设置）
# 用法: blender --background --factory-startup --python tools/blender/glb_to_blend.py
import os
from mathutils import Vector

import bpy

ROOT = "c:/Users/gaoy-al/Desktop/starlane-strike"
GLB = os.path.join(ROOT, "public", "models", "player_fighter.glb")
OUT = os.path.join(ROOT, "public", "models", "player_fighter.blend")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

bpy.ops.import_scene.gltf(filepath=GLB)

# 世界背景（深空）
world = bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.008, 0.008, 0.015, 1.0)

# 主光 + 补光
sun = bpy.data.lights.new("Sun", "SUN")
sun.energy = 3.5
sun_o = bpy.data.objects.new("Sun", sun)
scene.collection.objects.link(sun_o)
sun_o.rotation_euler = (0.96, 0.0, 0.52)

fill = bpy.data.lights.new("Fill", "AREA")
fill.energy = 1500
fill.size = 8
fill_o = bpy.data.objects.new("Fill", fill)
scene.collection.objects.link(fill_o)
fill_o.location = (-4.0, -4.0, 4.0)
fill_o.rotation_euler = (-Vector(fill_o.location)).to_track_quat("-Z", "Y").to_euler()

# 相机：3/4 前侧俯视角
cam_data = bpy.data.cameras.new("Camera")
cam_data.lens = 50
cam = bpy.data.objects.new("Camera", cam_data)
scene.collection.objects.link(cam)
cam.location = (4.8, -5.2, 2.8)
cam.rotation_euler = (-Vector(cam.location)).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam

# 渲染设置：Cycles CPU
scene.render.engine = "CYCLES"
scene.cycles.samples = 48
scene.render.resolution_x = 900
scene.render.resolution_y = 600
scene.render.film_transparent = False

# 场景命名，打开即见战机
scene.name = "FighterPreview"

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print(f"DONE blend={OUT} ({os.path.getsize(OUT) / 1024.0:.1f} KB)")
