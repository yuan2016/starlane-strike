# Starlane Strike · 星链飞将

Three.js + TypeScript + Vite 的移动端竖屏弹幕射击游戏：关卡波次、Boss 阶段战、机库强化与本地存档。

## 一、快速开始

环境要求：**Node ≥ 20**（零点几依赖版本无关，烘焙脚本用到现代 `node:` API）、npm ≥ 10。

```bash
npm install       # 只装 three / vite / typescript，约 100 MB
npm run dev       # 开发服务器 http://localhost:5173
npm run typecheck # tsc --noEmit
npm run build     # 类型检查 + 打包到 dist/
npm run preview   # 预览 dist/
```

> 首次克隆后**还需要烘焙材质贴图**，否则画面会回退到程序化贴图（能玩，但质感差一档）。见下一节。

## 二、恢复 PBR 贴图（重要）

`public/textures/pbr/` 约 72 MB，是本地脚本生成的产物，因此写在 `.gitignore` 里不入库。
游戏本身**不依赖**它：缺图时 `src/render/PbrAssets.ts` 会把程序化画布回填进同一张 Texture，不会黑屏、不会报错。

### 一键恢复

```bash
npm run bake
# 等价：node tools/pbr/bake.mjs
```

- 全量 172 张，**约 5 分钟**（零第三方依赖，只用 Node 标准库）；
- 输出到 `public/textures/pbr/`（2048 / 1024 / 512 / 256 / planet + `manifest.json`）；
- 每张图同时生成低一级分辨率的真 LOD（法线从降采样后的高度重求），medium 画质档直接用半尺寸。

### 只想恢复一部分

```bash
npm run bake -- --only planet        # 只烘星球（hero / bg01 / bg02）
npm run bake -- --only player_hull   # 只烘某一套机体表面
npm run bake -- --only player        # 名字含 player 的组
node tools/pbr/bake.mjs --out /tmp/pbr  # 换输出目录（预览调参用）
```

`--only` 按名字子串匹配，只对机体 / 引擎组（`player` / `enemy` / `boss`）和 `planet` 生效。

参数与预设在 `tools/pbr/`：`bake-presets.mjs`（各机型预设）、`ship.mjs`（机体表面）、`planet.mjs`（星球）、`fx.mjs`（喷口 / 灯带 / 座舱）、`noise.mjs`、`image.mjs`、`png.mjs`。

### 怎么确认真的用上了烘焙贴图

1. 目录存在且非空：`public/textures/pbr/manifest.json`；
2. 浏览器 Network 里能看到 `textures/pbr/**/*.png` 200（dev 下 `public/` 直接映射到根路径）；
3. 运行时判断：`const maps = getSurfaceMaps('hull'); maps.aoMap !== undefined` 即为烘焙资源（程序化回退没有 AO）。

贴图不在 `dist` 里重复打包：构建时 `public/` 会被原样拷进 `dist/`，部署时记得一起上传。

## 三、操作与调试

- 键盘：方向键 / WASD 移动；也可按住鼠标（触摸）拖动，屏幕 Y 向下对应世界 +Z。
- 僚机：开局左右各一架无人机，自动索敌射击，伤害 / 射速 / 暴击继承玩家强化。
- 掉落：敌机会掉落金币、火力强化 `P`、血包 `+`（绿色）、护盾 `◈`（青色）。
- 通关缓冲：Boss 被击败 / 最后一波结束后不会立刻弹结算面板，会保留约 4.5 秒自由移动 + 拾取奖励时间。
- 调试金币（本地开发 / 预览生效，线上构建产物不含该分支）：
  - 启动参数 `?coins=100000`：把存档金币**设为**该值（幂等，重复刷新不会累加）；`?coins=+100000` 为累加；
  - 控制台 `grantCoins(100000)`：运行时加金币并刷新 HUD 与机库。
- 战机参数恢复初始（同上，仅本地生效）：
  - 启动参数 `?reset=1`：机体回到 `falcon`、已拥有武器降回 Lv1、五项强化归零（金币与关卡进度保留）；
  - 控制台 `resetAircraft()`：同上即时生效；`resetSave()` 为整份存档清档重来。
- 画质档位：`?q=medium` / `?q=high` 手动覆盖自动探测结果。

## 四、文档

| 文档 | 内容 |
| --- | --- |
| `docs/PBR-MATERIALS.md` | PBR 材质体系：资源清单、通道分工、烘焙与调参、压缩建议、Shader |
| `CHANGELOG.md` | 逐轮改动记录（玩法、视觉、音频、工具链） |

## 五、目录速览

```
src/
├─ audio/     程序化音效 + 动态 BGM
├─ boss/      Boss 与阶段管理
├─ camera/    俯视跟随 + 震动
├─ combat/    子弹、碰撞、伤害
├─ core/      Game 状态机、主循环、输入
├─ data/      关卡 / 敌机 / 武器 / 机体 / 存档
├─ effects/   爆炸与粒子
├─ enemy/     敌机与波次实例
├─ entities/  掉落物
├─ level/     关卡与波次调度
├─ player/    玩家机、成长、武器
├─ render/    后处理、画质、PBR 资源、GLB 模型、材质 Shader
├─ scene/     星空与星球
└─ ui/        HUD / 机库 / 关卡选择
public/models/player_fighter.glb  玩家机模型（已入库）
tools/pbr/    零依赖烘焙脚本
tools/blender/ Blender 程序化建模脚本
```
