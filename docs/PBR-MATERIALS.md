# 星链飞将 · PBR 材质系统

离线烘焙的真实 PBR 贴图资源 + 运行时加载层 + 大气 / 高温 Shader。
所有素材由 `tools/pbr/` 下的零依赖 Node 脚本生成（不依赖 Blender / Substance），
输出 PNG 到 `public/textures/pbr/`，运行时由 `src/render/PbrAssets.ts` 加载。

---

## 一、资源清单

```
public/textures/pbr/
├─ 2048/  玩家机机身 / 装甲、Boss 主舰体            （母版）
├─ 1024/  敌机、Boss 装甲板、玩家机暗部 / 发动机      （含 2048 的半尺寸 LOD）
├─ 512/   能量灯带、座舱玻璃细节、背景资产
├─ 256/   最小 LOD
├─ planet/ hero(2048/1024)、bg01/bg02(1024/512)
└─ manifest.json  全部文件的尺寸、体积、通道说明
```

### 机体 / 舰体（可平铺，正方形）

| 集合 | 尺寸 | 用于 |
| --- | --- | --- |
| `player_hull` | 2048 → 1024 | 玩家机主机身（细密蒙皮 + 灯带 + 掉漆露底） |
| `player_armor` | 2048 → 1024 | 玩家机机翼 / 尾翼（大块装甲、铸造颗粒、重磨损） |
| `player_dark` | 1024 → 512 | 玩家机暗部结构件：进气道 / 挂架 / 喷口外壳 |
| `enemy_hull` | 1024 → 512 | 普通敌机 |
| `boss_hull` | 2048 → 1024 | Boss 主舰体（巨型装甲块 + 舷窗灯光） |
| `boss_plate` | 1024 → 512 | Boss 装甲板 |
| `player_engine` | 1024 → 512 | 发动机喷口（轴向温度梯度，V 方向 Clamp 不平铺） |
| `energy_strip` | 512 → 256 | 能量灯带 / 核心自发光 |
| `canopy_detail` | 512 → 256 | 座舱玻璃擦拭痕（只做 roughness + 极轻法线扰动） |

每个集合输出：`_basecolor` `_normal` `_roughness` `_metallic` `_ao` `_emissive` `_orm`（ORM 打包，可选）。

### 星球（等距圆柱投影 2:1，**无接缝、无重复**）

`planet/<width>/<id>_{albedo,normal,roughness,ao,metallic,height,night,clouds}.png`

| id | 母版 | 说明 |
| --- | --- | --- |
| `hero` | 2048×1024 | 近距离焦点星球：地表 + 法线 + AO + 高度 + 夜面城市灯 + 云层 |
| `bg01` / `bg02` | 1024×512 | 背景星球（无夜面 / 无高度，省显存） |

地形在**球面 3D 噪声**上求值（不是平面 2D 噪声 + 贴图），因此：
经度方向天然首尾相接、两极不打褶、整颗星球不出现重复纹理。

---

## 二、通道分工（细节不堆在 BaseColor 上）

| 通道 | 负责 |
| --- | --- |
| **BaseColor** | 涂装色 + 面板色差 + 积污。**不含**接缝阴影、不含划痕明暗 |
| **Normal** | 蒙皮接缝、铆钉、铸造颗粒、划痕、凹坑、灯带凹槽 |
| **Roughness** | 分区粗糙：抛光蒙皮 0.2x、装甲 0.5x、缝隙积污 0.8x |
| **Metallic** | 金属 0.9x；掉漆露底 / 积污区降到 0.2x 左右（电介质） |
| **AO** | 接缝、铆钉根、划痕、结构缝隙的自遮蔽 |
| **Emissive** | 灯带、舷窗、散热格栅、喷口高温 |

近看才有细节，正常游戏距离干净：微表面（拉丝 / 铸造 / 喷漆颗粒）振幅都压在
`0.01~0.04`，只有 Normal 上可见，不会把 BaseColor 弄脏。

---

## 三、运行时使用方式

### 1. 已经接入，开箱即用

`PlayerAircraft` / `Enemy` / `Boss` / `Planet` 已全部改走烘焙资源，
入口是 `src/render/ProcTextures.ts` 里原本就有的 `getSurfaceMaps()`：

```ts
import { getSurfaceMaps, getEngineMaps, getCanopyMaps } from './render/ProcTextures';

const maps = getSurfaceMaps('hull');   // hull | armor | dark | bossHull | bossPlate | enemy
const mat = new THREE.MeshStandardMaterial({
  color: 0x9fb2c8,                    // 涂装色，贴图是"中性灰度"，由 color 上色
  map: maps.map,
  normalMap: maps.normalMap,
  roughnessMap: maps.roughnessMap,
  metalnessMap: maps.metalnessMap ?? null,
  aoMap: maps.aoMap ?? null,
  aoMapIntensity: 1.1,
  emissiveMap: maps.emissiveMap ?? null,
  // 烘焙的 Roughness / Metallic 是绝对值 → 乘数设为 1
  roughness: 1,
  metalness: 1,
});
```

### 2. 档位与分辨率

`configureProceduralTextures(settings)` 会同步调用 `configurePbrAssets(settings)`，
按 `settings.tier` 自动选分辨率：

| 资产 | high | medium |
| --- | --- | --- |
| 玩家机 / Boss 主舰体 | 2048 | 1024 |
| 敌机 / 装甲板 / 发动机 | 1024 | 512 |
| 焦点星球 | 2048×1024 | 1024×512 |
| 背景星球 | 1024×512 | 512×256 |

半尺寸是**烘焙时就生成的真 LOD**（法线从降采样后的高度重新求），
不是运行时缩放，也不会多加载一份母版。

### 3. 失败自愈

任何一张贴图 404 / 解码失败时，`PbrAssets` 会把 `ProcTextures` 的程序化画布
回填进同一张 Texture，画面不会变黑。也就是说：**离线资源是增强，不是依赖**。
运行时判断是否真的用上了烘焙资源：`maps.aoMap !== undefined`。

### 4. 预加载（可选）

```ts
import { preloadPbrAssets } from './render/PbrAssets';
await preloadPbrAssets();   // 用于加载屏进度
```

---

## 四、推荐的颜色空间设置

| 项 | 值 |
| --- | --- |
| `renderer.outputColorSpace` | `THREE.SRGBColorSpace`（默认，保持） |
| `renderer.toneMapping` | `ACESFilmicToneMapping`（项目已在用） |
| BaseColor / Emissive / 夜面 / 云层 | `THREE.SRGBColorSpace` |
| Normal / Roughness / Metallic / AO / Height | `THREE.NoColorSpace`（线性，**不要**标 sRGB） |

`PbrAssets.ts` 已按上表逐张设置，新增贴图时照抄即可。
把 Roughness / AO 误标成 sRGB 会让缝隙黑成"描边"，是最常见的事故。

---

## 五、推荐的纹理压缩方式

当前是 PNG（源资产，便于二次修改）。上生产建议转 **KTX2 / Basis Universal**：

```bash
# 安装：https://github.com/KhronosGroup/KTX-Software
# 数据贴图（法线/粗糙度/金属度/AO）：线性 + UASTC，画质优先
toktx --t2 --encode uastc --assign_oetf linear --genmipmap \
  out/normal.ktx2      2048/player_hull_normal.png

# 颜色贴图：sRGB
toktx --t2 --encode uastc --assign_oetf srgb --genmipmap \
  out/basecolor.ktx2   2048/player_hull_basecolor.png

# 远端/低带宽：换 ETC1S（体积小一半，法线会有块效应，别用在 2048 法线上）
toktx --t2 --encode etc1s --assign_oetf linear --genmipmap out/ao.ktx2 2048/player_hull_ao.png
```

运行时：

```ts
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
const ktx2 = new KTX2Loader().setTranscoderPath('basis/').detectSupport(renderer);
```

优化顺序（性价比从高到低）：

1. **ORM 打包**：AO / Roughness / Metallic 合成一张 RGB（已输出 `_orm.png`），省 2 次采样、省 2/3 体积；
2. **KTX2**：显存占用降到约 1/4（PNG 是解码后全 RGBA8 上传）；
3. **半尺寸 LOD**：medium 档直接用（已内置）；
4. 法线可只保留 2 通道（BC5 / RG），Z 在 Shader 里重建。

预估显存（PNG，含 mipmap）：

| 档位 | 机体 2048 全套 | 机体 1024 全套 | 星球 |
| --- | --- | --- | --- |
| high | 2048⁵通道 ≈ 21 MB/套 | ≈ 5.3 MB/套 | hero ≈ 21 MB |
| medium | 1024 ≈ 5.3 MB/套 | ≈ 1.3 MB/套 | hero ≈ 5.3 MB |

---

## 六、重新烘焙

```bash
node tools/pbr/bake.mjs              # 全量（约 5 分钟，172 张）
node tools/pbr/bake.mjs --only planet        # 只烘星球
node tools/pbr/bake.mjs --only player_hull   # 只烘某一套机体
```

改参数的位置：

| 文件 | 内容 |
| --- | --- |
| `tools/pbr/noise.mjs` | 可平铺 value / fbm / Worley / 各向异性噪声 |
| `tools/pbr/ship.mjs` | 机体表面烘焙器（面板、接缝、铆钉、划痕、磨损、污渍、各通道输出）+ `SHIP_DEFAULTS` |
| `tools/pbr/fx.mjs` | 发动机高温 / 能量灯带 / 座舱玻璃 |
| `tools/pbr/planet.mjs` | 星球地表 / 法线 / 夜面 / 云层（球面 3D 噪声） |
| `tools/pbr/bake-presets.mjs` | **各机型预设**（面板密度、缝宽、磨损强度、配色） |
| `tools/pbr/image.mjs` | 环绕卷积、高度转法线、空腔 AO、降采样 |

常用调参直觉：

- 面板太密 → 调小 `grid`；太"方格纸" → `subDiv` 细分缝会被 `fineSuppress` 按区域抑制；
- 缝太粗 → `seamWidth`（UV 单位，不随分辨率变化）；起伏太夸张 → `normalStrength`；
- 太脏 → 降 `grimeAmount` / `wearAmount`；太干净 → 升 `wearAmount` / `scratchDensity`。

---

## 七、Shader

| Shader | 文件 | 作用 |
| --- | --- | --- |
| 大气散射 | `src/render/AtmosphereMaterial.ts` | 单次散射近似：光学厚度 + Rayleigh `(1+cos²θ)` + Mie 前向瓣 + 昼夜过渡 + 晨昏线暖色 + 夜面微光。BackSide + 加色混合，1 个 draw call |
| 喷口高温 | `MaterialFX.applyEngineHeat()` | 把 Emissive 亮度当"温度"重映射到黑体辐射色带（暗红→橙→黄白），`uHeat` 随推力变化 |
| 夜面城市灯 | `Planet.applyNightSide()` | 按世界法线 × 太阳方向在 Shader 内遮罩，无逐帧 CPU 开销 |
| 云层昼夜 | `Planet.applyCloudNightFade()` | 夜面压暗并减薄，避免"云在夜里发光" |

---

## 八、材质预览

直接用看图工具打开 `public/textures/pbr/` 下的 PNG 即可；
`manifest.json` 记录每张图的尺寸、体积与通道数，便于核对。

想在 Blender / glTF Viewer 里快速验证光照反应，可用现成目录拼一个临时材质：

```bash
# 例：把玩家机整套贴图丢进临时目录，在 Blender 里按第四节的通道分工连一遍
mkdir -p /tmp/prev && cp public/textures/pbr/2048/player_hull_*.png /tmp/prev/
```

调参时若想只看一套贴图的效果，用 `--only` 单独烘焙，几秒就能出结果。
