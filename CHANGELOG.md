# 星链飞将（starlane-strike）开发记录

Three.js + TypeScript + Vite 的移动端竖屏弹幕射击游戏。本文档记录当前已实现内容，后续每次改动同步更新此处。

---

## 一、项目基础

| 项 | 内容 |
| --- | --- |
| 项目名 | `starlane-strike`（页面标题与 LOGO：Starlane Strike） |
| 技术栈 | Three.js（WebGL2）、TypeScript（strict）、Vite |
| 入口 | `index.html`（全部 HUD / 面板 DOM 与 CSS 内联）、`src/main.ts` |
| 主控 | `src/core/Game.ts`：状态机 `ready / playing / paused / failed / cleared` |
| 渲染 | `src/render/PostFX.ts` → `RenderPass（MSAA）→ UnrealBloom → OutputPass` |
| 画质 | `src/render/Quality.ts`（设备能力探测 + 运行时自适应） |
| 材质 | `src/render/PbrAssets.ts`（离线烘焙 PBR 资源层）、`ProcTextures.ts`（程序化回退）、`ModelAssets.ts`（GLB 模型加载与归一化）、`Environment.ts`（HDR 环境光）、`MaterialFX.ts`（轮廓光 / 护盾 / 高温 Shader）、`AtmosphereMaterial.ts`（大气散射） |
| 贴图烘焙 | `tools/pbr/`（零依赖 Node 脚本）→ `public/textures/pbr/`，见 `docs/PBR-MATERIALS.md` |
| 存档 | `src/data/SaveData.ts`（localStorage）：金币、机体、武器、关卡星数与最高分 |

目录结构：

```
src/
├─ audio/     AudioSystem.ts        程序化音效 + 动态 BGM
├─ boss/      Boss.ts BossManager.ts
├─ camera/    GameCamera.ts         俯视跟随 + 震动
├─ combat/    BulletSystem.ts DamageSystem.ts
├─ core/      Game.ts GameLoop.ts InputManager.ts
├─ data/      levels.ts enemies.ts weapons.ts pickups.ts aircrafts.ts SaveData.ts
├─ effects/   Explosion.ts ParticleSystem.ts
├─ enemy/     Enemy.ts EnemyManager.ts
├─ entities/  PickupSystem.ts
├─ level/     LevelManager.ts Wave.ts
├─ player/    Player.ts PlayerAircraft.ts PlayerStats.ts Weapon.ts SpecialWeapon.ts Progress.ts
├─ render/    PostFX.ts Quality.ts PbrAssets.ts ProcTextures.ts ModelAssets.ts Environment.ts MaterialFX.ts AtmosphereMaterial.ts
├─ scene/     Starfield.ts Planet.ts
└─ ui/        GameUI.ts HangarUI.ts LevelSelectUI.ts
```

---

## 二、既有玩法（本轮之前）

- 战斗：拖动操控、自动射击、护盾 → 生命双层血条、受击无敌帧闪烁、必杀技（能量条 / 空格）。
- 敌机：`grunt / scout / heavy / kamikaze / elite` 五种，支持 `straight / sine / swoop / chase / hover` 五种移动模式。
- 关卡：第一章 `1-1 ~ 1-5`，波次调度器 `WaveScheduler` + `LevelManager`（预警 → Boss → 通关）。
- Boss：多炮塔可击破结构，三阶段随血量提升火力，主炮充能激光。
- 成长：机库（机体 + 武器 + 属性强化）、金币入档、关卡星级与解锁。

---

## 三、本轮新增内容

### 1. 第二章敌机（`src/data/enemies.ts`、`src/enemy/Enemy.ts`）

| 类型 | kind | 机制 |
| --- | --- | --- |
| 激光塔 | `laser` | 新移动模式 `turret`（推进至阵位后驻留）。周期性 `充能 → 贯穿光束 → 冷却`；充能期光束缓慢追踪玩家所在列给出可躲避预告，发射期按横向距离判定持续伤害（绕过无敌帧，走护盾 → 生命结算）。 |
| 护盾舰 | `bulwark` | 新增能量护盾字段 `shield / shieldColor`，破盾前本体不掉血；护盾外壳随剩余量改变透明度与半径，破盾瞬间炸开一层能量粒子。 |

配套新增：`EnemyBeamDef` 配置、`beam` 字段、激光束网格（`BEAM_GEO`，沿 +Z 贯穿 90 单位）、`EnemyUpdateContext` 扩展 `particles / damagePlayer / onBeam`。

### 2. 第二章关卡（`src/data/levels.ts`）

- 新增 `2-1 深空前哨`、`2-2 破碎回廊`、`2-3 光栅矩阵`、`2-4 盾舰舰队`、`2-5 深空终局`，每关 4~5 波，混编激光塔与护盾舰。
- 新增 5 套 Boss 预设并配套阶段配色：`「哨戒」要塞舰`、`「涡旋」母舰`、`「复仇」级战舰`、`「蚀月」旗舰`、`「起源」核心`（血量 11000 → 18000 递增）。
- 导出 `CHAPTERS` 与 `chapterOf()`，任务列表按章节分组展示（新增 `.chapter-title` 样式）。

### 3. Boss 血条分段与阶段演出

- `src/boss/Boss.ts`：新增 `onPhaseChange` 事件、`lastPhase / phaseFlash`；阶段切换时核心炸出能量环 + 爆炸、舰体抖动、核心自发光增强。
- `src/boss/BossManager.ts`：转发 `onPhaseChange`。
- `src/ui/GameUI.ts`：`setBoss()` 按阶段高亮血条区间（100~70 / 70~30 / 30~0，`#boss-seg`），阶段 2/3 切换血条配色；新增 `flashBossPhase()` 播放 `PHASE N` 横幅 + 血条闪烁。
- `index.html`：新增 `#boss-seg`、`.boss-banner` 及 `banner-in / seg-pulse / phase-flash` 动画。

### 4. Bloom 后处理（`src/render/PostFX.ts`、`src/config.ts`）

- 管线：`RenderPass → UnrealBloomPass → OutputPass`，弹幕、喷焰、掉落物、爆炸发光。
- `RENDER.bloom = { strength: 0.85, radius: 0.55, threshold: 0.5 }`（材质精修一轮后调整为 `0.62 / 0.62 / 0.78`，见第四节）。
- 支持 `setEnabled()` 开关（关闭时直接 `renderer.render` 省性能）、`setStrength() / resetStrength()`（Boss 阶段切换临时增强 1.35 倍）。
- 窗口 resize 时同步 `composer.setSize`。

### 5. 音频系统（`src/audio/AudioSystem.ts`）

纯 WebAudio 程序化合成，无任何音频资源文件。

- 音效：`shoot / hit / pickup / power / damage / shield / warn / phase / clear / fail / special / ui`，另有按规模缩放的 `explode(scale)` 与持续光束 `beamStart() / beamEnd()`。同名音效内置节流避免叠加成噪音。
- 动态 BGM：按场景切换 `menu（76 BPM）/ battle（138 BPM）/ boss（154 BPM）`，16 分音符栅格排产，含贝斯、琶音、底鼓、军鼓、踩镲（菜单另加和声垫）。
- 开关：HUD 右上 🔊 按钮或 `M` 键，静音状态写入 localStorage（`starlane.audio.v1`）。
- `AudioContext` 在首次 `pointerdown / keydown` 时 `unlock()`。

事件接入（`Game.ts`）：射击、敌机爆炸、拾取金币 / 火力 / 护盾 / 修理、玩家受击、Boss 与激光塔光束起止、必杀、Boss 击破、通关、失败、Warning 预警、Boss 阶段切换。

### 6. UI / 交互

- HUD 新增音效按钮；暂停面板新增「辉光特效：开/关」开关（快捷键 `B`）。
- 快捷键：`Esc / P` 暂停、`空格` 必杀、`M` 音效、`B` 辉光、`1~5` 切换已拥有武器。
- `src/player/Weapon.ts` 新增 `onFire` 回调（每次齐射触发一次，避免音效过密）。

---

## 四、材质与视觉精修（本轮）

目标：把基础 Three.js 模型提升到商业游戏级材质，**几何、比例、位置、动画、玩法、UI 全部不动**，只改材质 / 贴图 / 光照 / Shader / 后处理。

### 1. 设备能力检测与质量档（`src/render/Quality.ts` + `RENDER` 配置）

- `DeviceTier = 'high' | 'medium'`（`QualityTier` 保留为历史别名）；`QualitySettings` 集中管理贴图尺寸、MSAA、DPR 上限、Bloom、环境光强度、星球细分与各类特效开关。
- `detectQuality(renderer)`：**不读 UA**，只用 `maxSamples / maxTextureSize / getMaxAnisotropy()` + `hardwareConcurrency` + `(pointer: coarse)` + 实际设备像素量打分；触屏或 ≤4 核直接落 medium。返回 `source: 'auto' | 'override'`。
- 档位覆盖：`?q=high` / `?q=medium`（`readTierOverride()`），用于验收对比与低配机自救。
- 预设单一来源：high 档**直接取 `config.RENDER` 的基准值**（`msaa`、`pixelRatioCap`、`bloom`），medium 档在其基础上按比例派生（`bloomPreset(0.8, 0.8, +0.02)`、贴图 512、关云层与夜灯），改 `RENDER` 即可同时影响两档，不再两处各写一份数值。
- `AdaptiveQuality`：连续 2s < 45fps 时分级降级（DPR −0.5 → Bloom ×0.85 → 关云层），最多两级；只降渲染开销，不重建贴图与模型，避免画质断崖。

### 2. 新增模块

| 文件 | 作用 |
| --- | --- |
| `src/render/Quality.ts` | 画质档位与设备探测：`WebGL2 能力 + hardwareConcurrency + 像素量 + pointer:coarse` 打分（不读 UA）判定 `high / medium`；`AdaptiveQuality` 运行时连续 2 秒 < 45fps 时分级降级（DPR → Bloom → 云层），只降渲染成本，不降贴图与模型精度 |
| `src/render/ProcTextures.ts` | 程序化贴图库（Canvas 生成 + 全局缓存 + 统一 `dispose`）：装甲板 / 金属拉丝 / 划痕 → `map + roughnessMap + normalMap`、灯带遮罩、引擎高温渐变、能量核心遮罩、六边形护盾网、星球地表（fbm 海陆 + 粗糙度 + 法线 + 夜面城市灯）、云层 alpha |
| `src/render/Environment.ts` | `PMREMGenerator.fromScene()` 生成程序化 HDR 环境贴图（冷白主光 + 青色轮廓 + 暖橙补光 + 紫色点缀 + 渐变天空），写入 `scene.environment`；导出 `SUN_DIRECTION` 供星球昼夜分界对齐主光 |
| `src/render/MaterialFX.ts` | `applyRimLight()`（向 `MeshStandard/PhysicalMaterial` 注入 Fresnel 轮廓光，`onBeforeCompile`，不新增几何）、`createShieldMaterial()`（六边形能量网 + Fresnel 的 ShaderMaterial） |
| `src/scene/Planet.ts` | 多层星球：地表（PBR + 夜面城市灯）+ 独立云层（自转略快）+ 大气层（`BackSide` + Additive + Fresnel 散射）；支持 `hero / medium` 分级精度与按"屏幕占用面积 + 距离"的 LOD |

### 3. 玩家飞机（`src/player/PlayerAircraft.ts`）

材质由 2 个纯色 `MeshStandard` 拆分为 5 类（几何与坐标完全不变）：

- **机身**：`metalness 0.9 / roughness 0.32`，装甲板 `map` + 拉丝 `roughnessMap` + `normalMap`，灯带 `emissiveMap`（科幻蓝）。
- **装甲（机翼 / 尾翼 / 平尾）**：`metalness 0.78 / roughness 0.5`，更大更粗糙的面板纹理，与机身形成对比。
- **暗部结构件（进气口 / 翼尖挂架）**：近黑金属 `0x151b26`、`roughness 0.62`，负责暗部层次。
- **座舱玻璃**：`MeshPhysicalMaterial`，`color` 压暗 + `clearcoat 1 / clearcoatRoughness 0.03 / ior 1.5` + `transparent opacity 0.62`，靠环境反射出玻璃质感（不再是"发光的实心球"）。
- **发动机**：高温金属 + 引擎温度渐变 `emissiveMap`，`emissiveIntensity` 随推力 / 脉动实时变化。
- 五类材质统一注入 Fresnel 轮廓光（机身冷蓝、装甲偏蓝、暗部弱、喷口暖橙、座舱冷白），边缘不再与深空糊在一起。

### 4. 敌机 / Boss

- 敌机 body / accent 接入共享面板贴图 + 各自 metalness / roughness，`glow` 改用能量遮罩 `emissiveMap`（只让核心亮，不整块发白）；护盾舰外壳由 `MeshBasic` 改为六边形网纹 + Fresnel Shader，`uOpacity / uTime / 受击闪烁` 随剩余护盾量联动。
- Boss 主舰体 / 装甲板采用大块面板贴图（不同 `repeat`）+ 舷窗灯带 `emissiveMap`，主舰体偏亮金属、装甲板更深更粗糙；核心 / 灯带改用能量遮罩；舰体加冷蓝轮廓光，保证 7.5×8 大舰的剪影。
- 掉落物（`entities/PickupSystem.ts`）由 `MeshBasic` 改为带自发光与金属度的标准材质，仍是 Additive 透明，颜色沿用原有配置。

### 5. 星球（`src/scene/Starfield.ts` + `src/scene/Planet.ts`）

- 3 颗星球的半径 / 位置 / z 循环速度 / 自转速度全部沿用原定义，只是把"纯色 flatShading 球"换成 4 层：**地表（fbm 地形 albedo + 海陆 roughness 差异 + 法线）→ 夜面（背光侧城市灯，`onBeforeCompile` 注入太阳方向）→ 云层（独立球，fbm alpha，自转略快）→ 大气层（Fresnel 散射 + 朝阳侧偏移）**。
- 分级精度：`radius 9 / z -110` 的焦点星球为 hero（地表 + 云层 + 大气 + 夜面 + 高质量 Shader），另外两颗为 medium（地表 + 大气，无云层 / 无夜灯）。
- LOD：按"屏幕投影面积 + 距离"计算，每 0.25s 判定一次才允许切换，带滞回，避免抖动；背景星球以 30fps 频率更新（差帧累积），不逐帧算 Shader。

### 6. 灯光 / 后处理（`Game.ts`、`config.ts`、`PostFX.ts`）

- 有了 HDR 环境光后**下调**既有人造光：环境光 `1.4 → 0.35`、主光 `2.6 → 1.8`、蓝色 rim `2.2 → 1.4`、橙色补光 `0.9 → 0.5`，明暗层次交给环境反射 + 轮廓光 + 自发光。
- `EffectComposer` 改为自建 **MSAA 渲染目标（high 4× / medium 2×，受 `maxSamples` 限制）**，修好了"开 Bloom 后 `renderer.antialias` 失效导致边缘锯齿"的问题。
- Bloom 收敛：`strength 0.85 → 0.62`、`radius 0.55 → 0.62`、`threshold 0.5 → 0.78` —— 只有灯带 / 引擎 / 弹幕 / 爆炸发光，模型本体不糊成白光。
- 色调映射：保留 ACES（电影感），exposure `1.15 → 1.12`，`scene.environmentIntensity` 按档位 0.85 / 0.72。
- 未引入 SSAO 与实时阴影：太空场景无接触面 / 无承影面，收益≈0，改用贴图里烘焙的缝隙 AO（缝隙与铆钉直接压暗）。

### 7. 性能预算（按视觉优先级分配）

玩家飞机 > 焦点星球 > Boss > 敌机 > 背景星球 > 其他背景物体

- 贴图尺寸按档位：high 机体 1024 / 星球 1024，medium 机体 512 / 星球 512；低频噪声场以 512 生成后双线性放大，启动生成耗时约降到原来的 1/4。
- 所有贴图与几何全局共享并缓存，材质数量基本不变；仅新增云层与大气两个透明球（背景星球无云层）。
- 运行时自适应只动 DPR / Bloom / 云层可见性，不重建贴图与模型，避免画质断崖。

---

## 五、离线烘焙 PBR 材质系统（本轮）

详见 `docs/PBR-MATERIALS.md`。

### 1. 烘焙工具链（`tools/pbr/`，零第三方依赖，Node ≥ 20）

| 文件 | 内容 |
| --- | --- |
| `noise.mjs` | 可平铺 value / fbm / Worley / 各向异性噪声（整周期格点哈希，保证无缝） |
| `png.mjs` | 自写 PNG 编码器（filter 0 + zlib stored/deflate，RGB/RGBA/灰度） |
| `image.mjs` | 环绕卷积、Sobel 高度转法线、空腔 AO、盒式降采样 |
| `ship.mjs` | 机体表面烘焙器：面板（粗/细两层 + 区域抑制）、接缝、铆钉、划痕、凹坑、掉漆露底、积污，一次遍历产出全部通道 |
| `fx.mjs` | 发动机高温、能量灯带、座舱玻璃脏污 |
| `planet.mjs` | 星球地表 / 法线 / AO / 高度 / 夜面 / 云层（球面 3D 噪声，无接缝无重复） |
| `bake-presets.mjs` | 各机型预设表 |
| `bake.mjs` | 入口：`node tools/pbr/bake.mjs [--only <set>]` |

产物：172 张贴图，72 MB，落 `public/textures/pbr/`，附 `manifest.json`。

### 2. 分辨率与 LOD

- 玩家机机身 / 装甲、Boss 主舰体：2048 母版 + 1024 半尺寸；
- 敌机、Boss 装甲板、玩家机暗部 / 发动机：1024 + 512；
- 能量灯带 / 座舱细节：512 + 256；
- 焦点星球 2048×1024，背景星球 1024×512。
- 半尺寸是烘焙时生成的**真 LOD**（法线从降采样后的高度重求），不是运行时缩放；
  medium 档直接读半尺寸，显存减半且不额外加载母版。

### 3. 运行时接入（`src/render/PbrAssets.ts`）

- 按 `settings.tier` 选分辨率；BaseColor / Emissive 走 sRGB，其余线性；
- TextureLoader 同步返回纹理，调用方（模型代码）无需改成 async；
- **失败自愈**：贴图 404 / 解码失败时用 `ProcTextures` 的程序化画布回填，
  不会出现黑块，离线资源是"增强"而非"依赖"；
- `ProcTextures.getSurfaceMaps()` 增加 `dark` 种类，`getEngineMaps()` / `getCanopyMaps()` 新增。

### 4. 模型接入

- 玩家机：机身 / 装甲 / 暗部各自一套贴图，新增 AO + Metallic；座舱玻璃加擦拭痕
  roughnessMap + 极轻法线扰动；喷口改用 `player_engine` 全套并接高温 Shader。
- 敌机 / Boss：新增 AO + Metallic；Roughness / Metallic 改为"绝对值"读法
  （烘焙遮罩驱动，材质乘数设 1；程序化回退时保留原相对值）。
- 星球：地表新增 AO；云层加夜面衰减（夜里不发光）；大气换成散射 Shader。

### 5. 新增 Shader

- `AtmosphereMaterial.ts`：单次散射近似（光学厚度 + Rayleigh `(1+cos²θ)` + Mie 前向瓣 +
  昼夜过渡 + 晨昏线暖色 + 夜面微光），BackSide + 加色混合，1 个 draw call。
- `MaterialFX.applyEngineHeat()`：Emissive 亮度 → 黑体辐射色带（暗红→橙→黄白），
  `uHeat` 随推力变化，与 Bloom 联动。

---

## 六、Boss 母舰模型重做（本轮）

### 1. 程序化科技回路贴图

- `ProcTextures.createCircuitMap()`：黑底 + 青色发光回路（主线默认 `0x00e5ff`、焊盘 `0xc8feff`）。
  网格曼哈顿随机游走 → 拐角 45° 倒角 → 端点/拐点补焊盘 → "外发光 / 主线 / 芯线"三遍描边；
  越出画布的部分按 ±size 平移重绘，保证 `RepeatWrapping` 平铺后接缝处线路连续。
- `getCircuitTexture()` 走全局缓存，`disposeProceduralTextures()` 一并释放。

### 2. Boss 结构（`src/boss/Boss.ts`，纯几何体拼装，不加载外部文件）

- 中央核心：`#ff1100` 高强度自发光球体（`emissiveIntensity` 3.2 起，随阶段与受击脉动）；
  外层 4 片弧形装甲瓣（留缝透红光）+ 3 片正交齿轮环（`THREE.Shape` 梯形齿 →
  `ExtrudeGeometry` 挤出）包裹，三环反向缓转、阶段越高转得越快。
- 核心光环：BackSide 加色球壳，颜色跟随阶段配色 —— 核心本体锁定 `#ff1100`，
  变体 `preset.core` 改由光环承担，阶段反馈仍然可见。
- 机翼：`createWingShape()` 手工倒角轮廓（后掠前缘 + 阶梯后缘 + 两道斜切散热槽孔）
  → `ExtrudeGeometry`（`bevelSegments: 1`，保留硬朗的重型机械切面）；翼尖带垂直安定面，
  左右翼用同一份几何体镜像复用。
- 贴图与发光：机翼 `emissiveMap` 用回路图（clone 后独立滚动 offset 形成青蓝流光）。
- 视觉增强：机翼 / 齿轮外壳注入既有 Fresnel 边缘光（蓝灰 `0x9fb8d8` / `0x8ba4c2`）。

---

## 七、验证

- `npx tsc --noEmit -p tsconfig.json` 通过（strict）。
- `npx vite build` 通过：`dist/index.html` 25.8 kB、`assets/index-*.js` 648.9 kB（gzip 170.6 kB），
  `dist/textures/pbr` 72 MB 静态资源随构建拷贝。
- 冒烟：本地 `vite preview` + Chromium（SwiftShader）分别以默认档、`?q=medium`、`?q=high` 加载首页并进入关卡，控制台 0 error / 0 warning，无 Shader 编译报错。

### 开发调试入口

- `?coins=N`：启动时给 localStorage 存档直接加 N 金币（`import.meta.env.DEV`，构建产物不含该分支）。
- 控制台 `grantCoins(N)` / `game.progress.addCoins(N)`：运行时加金币并刷新 HUD 与机库显示。

---

## 八、Blender 程序化战机模型（本轮）

用本机 Blender 5.2.2 LTS（无头模式 `--background --python`）程序化生成玩家战机 GLB 资产：

| 产物 | 说明 |
| --- | --- |
| `tools/blender/make_player_fighter.py` | 建模脚本：bmesh 程序化拼装（细长机身 + 座舱 + 后掠三角翼 + 外倾双垂尾 + 平尾 + 双发短舱 + 翼尖机炮吊舱），6 类 PBR 材质（银灰装甲 / 金色装饰 / 暗部金属 / 座舱玻璃 / 青色发光条 / 引擎喷口），附带 Cycles 预览渲染 |
| `public/models/player_fighter.glb` | 导出产物（约 403 KB），朝向符合 three.js 约定：+Y up、机头朝 -Z；发光条带 `KHR_materials_emissive_strength`，可与现有 Bloom 联动 |
| `tools/blender/preview_fighter.png` | 预览渲染图（造型核对用） |
| `tools/blender/open_fighter.py` | 启动 Blender GUI 并自动导入 GLB（glTF 不能作为启动文件），自动切材质预览并框选居中 |
| `tools/blender/glb_to_blend.py` | GLB → `.blend`：`public/models/player_fighter.blend`（334 KB），含深空世界、主光/补光、3/4 视角相机与 Cycles 渲染设置，双击即打开 |

复跑方式：`"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/blender/make_player_fighter.py`

注意：Blender 脚本导出时把机头放在 **+Z**（引擎喷口在 -Z），与游戏约定的机头 -Z 相反，运行时由 `PLAYER_MODEL_YAW = Math.PI` 掉头。

### 运行时接入（`src/render/ModelAssets.ts` + `src/player/PlayerAircraft.ts`）

| 项 | 说明 |
| --- | --- |
| `ModelAssets.ts` | GLTFLoader 全局缓存：`preloadModel(url)` 只解析一次，`getModel(url)` 每次返回 `clone(true)`（几何共享、材质逐机克隆）；`fitModel()` 按包围盒居中并等比缩放到 `PLAYER_MODEL_LENGTH = 4.8`，换模型不改战斗/弹道逻辑 |
| `preparePlayerModel()` | 材质按名称处理：`Hull` 基色按 `def.bodyColor` 混合 0.55（保留三架机辨识度）、`Thrust` 自发光改成 `def.flameColor`、`CyanGlow` 提亮，非发光材质注入 Fresnel 轮廓光 |
| `PlayerAircraft` | 程序化机体收进 `shell` 子节点（喷焰与炮口仍在 group 上），GLB 到位后 `shell.visible = false` 自动顶替；加载失败静默沿用程序化机体 |
| `AircraftDef.model` | 可选字段，缺省用 `PLAYER_MODEL_URL`（`public/models/player_fighter.glb`）；后续可给单机体指定专属模型 |
| `main.ts` | 开局前 `preloadModel()`，避免进场瞬间弹出外观 |

资源释放：模型几何体全局共享不 dispose，`dispose()` 只释放实例克隆的材质（`disposeModelMaterials`）。

---

## 九、后续可选项

- 第三章及对应敌机（如分裂机、隐身机）。
- 关卡内连击 / 无伤评价、结算页更多统计。
- 音频：BGM 段落过渡淡入淡出、低血量紧张变奏。
- 性能：Bloom 低配自动降级、对象池扩展至敌机模型。
- 给 `wasp` / `bulwark` 各做一份专属 GLB（`AircraftDef.model` 已预留字段）。
