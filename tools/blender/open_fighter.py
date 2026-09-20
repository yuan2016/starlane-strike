# 用 Blender GUI 打开 public/models/player_fighter.glb（glTF 无法作为启动文件，故导入后再整理视图）
import bpy

PATH = "c:/Users/gaoy-al/Desktop/starlane-strike/public/models/player_fighter.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=PATH)

# 选中全部并适配视图 + 切到材质预览着色
for window in bpy.context.window_manager.windows:
    screen = window.screen
    for area in screen.areas:
        if area.type != "VIEW_3D":
            continue
        for space in area.spaces:
            if space.type == "VIEW_3D":
                space.shading.type = "MATERIAL"
                space.clip_end = 500.0
                space.overlay.show_overlays = False
        region = next((r for r in area.regions if r.type == "WINDOW"), None)
        if region is None:
            continue
        with bpy.context.temp_override(window=window, area=area, region=region):
            bpy.ops.object.select_all(action="SELECT")
            bpy.ops.view3d.view_selected()
            bpy.ops.view3d.view_persportho() if hasattr(bpy.ops.view3d, "view_persportho") else None

print("LOADED", PATH)
