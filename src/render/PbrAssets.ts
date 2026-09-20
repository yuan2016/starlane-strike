import * as THREE from 'three';
import type { DeviceTier, QualitySettings } from './Quality';
import type { PlanetMaps, SurfaceKind, SurfaceMaps } from './ProcTextures';

/**
 * 烘焙 PBR 贴图的运行时加载层。
 *
 * 贴图由 `tools/pbr/bake.mjs` 离线烘焙到 `public/textures/pbr/`：
 *   <size>/<name>_<map>.png          机体 / 舰体（可平铺）
 *   planet/<width>/<id>_<map>.png    星球（等距圆柱，球面 3D 噪声生成，无接缝）
 *
 * 设计要点：
 *  - **同步返回 THREE.Texture**：TextureLoader 会立刻返回纹理对象，图片异步填充，
 *    所以调用方（ProcTextures / 各模型）不需要改成 async；
 *  - **按档位选分辨率**：high 用 2048 母版，medium 自动落到烘焙好的半尺寸 LOD，
 *    显存占用直接减半，而不是靠运行时缩放；
 *  - **失败自愈**：某张贴图 404 / 解码失败时，用 ProcTextures 的程序化贴图回填 image，
 *    游戏不会出现黑块（离线资源是"增强"，不是"依赖"）；
 *  - **色彩空间**：BaseColor / Emissive 按 sRGB 采样，Normal / Roughness / Metallic / AO / Height
 *    保持线性，这是 PBR 物理正确的读法。
 */

const BASE = `${import.meta.env.BASE_URL}textures/pbr`;

let anisotropy = 4;
let tier: DeviceTier = 'high';

export function configurePbrAssets(settings: QualitySettings): void {
  anisotropy = Math.max(1, settings.anisotropy);
  tier = settings.tier;
}

/** high 档走母版，medium 走烘焙好的半尺寸 LOD */
function pickSize(full: number): number {
  return tier === 'high' ? full : full >> 1;
}

const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');

const cache = new Map<string, THREE.Texture>();

interface LoadOpts {
  srgb?: boolean;
  wrapS?: THREE.Wrapping;
  wrapT?: THREE.Wrapping;
  /** 加载失败时用程序化贴图回填，避免黑块 */
  onFail?: (texture: THREE.Texture) => void;
}

function loadTexture(url: string, opts: LoadOpts = {}): THREE.Texture {
  const hit = cache.get(url);
  if (hit) return hit;
  const texture = loader.load(
    url,
    undefined,
    undefined,
    () => {
      // 只在真正失败时才触发程序化回退（正常路径零额外开销）
      opts.onFail?.(texture);
    },
  );
  texture.wrapS = opts.wrapS ?? THREE.RepeatWrapping;
  texture.wrapT = opts.wrapT ?? THREE.RepeatWrapping;
  texture.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  // 烘焙贴图是全局共享的（同一 URL 只加载一份），
  // 单个模型 dispose 时不要把它释放掉，否则下次要重新上传
  texture.userData.shared = true;
  cache.set(url, texture);
  return texture;
}

/** 是否全局共享贴图（共享的不应由使用方 dispose） */
export function isSharedTexture(texture: THREE.Texture): boolean {
  return texture.userData.shared === true;
}

// ——————————————————————————————————————————————————————————
// 机体 / 舰体表面
// ——————————————————————————————————————————————————————————

const SURFACE_BAKED: Record<SurfaceKind, { name: string; full: number; repeat: number }> = {
  hull: { name: 'player_hull', full: 2048, repeat: 1.6 },
  armor: { name: 'player_armor', full: 2048, repeat: 1 },
  dark: { name: 'player_dark', full: 1024, repeat: 1.2 },
  bossHull: { name: 'boss_hull', full: 2048, repeat: 3 },
  bossPlate: { name: 'boss_plate', full: 1024, repeat: 2 },
  enemy: { name: 'enemy_hull', full: 1024, repeat: 1 },
};

/**
 * 读取烘焙的机体 PBR 贴图。
 * @param buildFallback 程序化回退工厂（只在贴图缺失时才会被真正调用一次）
 */
export function createBakedSurfaceMaps(
  kind: SurfaceKind,
  buildFallback: () => SurfaceMaps,
): SurfaceMaps | null {
  const def = SURFACE_BAKED[kind];
  if (!def) return null;
  const size = pickSize(def.full);
  const dir = `${BASE}/${size}`;
  const url = (map: string) => `${dir}/${def.name}_${map}.png`;

  // 回退只构建一次；失败时把程序化画布塞进烘焙纹理，材质参数保持不变
  let fallback: SurfaceMaps | null = null;
  const heal = (texture: THREE.Texture, pick: (maps: SurfaceMaps) => THREE.Texture): void => {
    if (!fallback) fallback = buildFallback();
    const source = pick(fallback);
    if (source?.image) {
      texture.image = source.image;
      texture.needsUpdate = true;
    }
  };

  const repeat = def.repeat;
  const map = loadTexture(url('basecolor'), {
    srgb: true,
    onFail: (t) => heal(t, (m) => m.map),
  });
  map.repeat.set(repeat, repeat);

  const roughnessMap = loadTexture(url('roughness'), {
    onFail: (t) => heal(t, (m) => m.roughnessMap),
  });
  roughnessMap.repeat.set(repeat, repeat);

  const normalMap = loadTexture(url('normal'), {
    onFail: (t) => heal(t, (m) => m.normalMap),
  });
  normalMap.repeat.set(repeat, repeat);

  const maps: SurfaceMaps = { map, normalMap, roughnessMap };

  // AO / Metallic / Emissive 是可选增强：缺失不影响材质创建
  maps.aoMap = loadTexture(url('ao'), { onFail: (t) => heal(t, (m) => m.aoMap ?? m.map) });
  maps.aoMap.repeat.set(repeat, repeat);
  maps.metalnessMap = loadTexture(url('metallic'), {
    onFail: (t) => heal(t, (m) => m.metalnessMap ?? m.map),
  });
  maps.metalnessMap.repeat.set(repeat, repeat);
  maps.emissiveMap = loadTexture(url('emissive'), {
    srgb: true,
    onFail: (t) => heal(t, (m) => m.emissiveMap ?? m.map),
  });
  maps.emissiveMap.repeat.set(repeat, repeat);

  return maps;
}

// ——————————————————————————————————————————————————————————
// 能量灯带 / 发动机高温 / 座舱玻璃
// ——————————————————————————————————————————————————————————

export function createBakedEnergyTexture(): THREE.Texture {
  return loadTexture(`${BASE}/${pickSize(512)}/energy_strip_emissive.png`, { srgb: true });
}

export function createBakedEngineHeatTexture(): THREE.Texture {
  // 发动机热度沿轴向单向变化：V 方向用 Clamp，避免喷口另一端出现冷热接缝
  return loadTexture(`${BASE}/${pickSize(1024)}/player_engine_emissive.png`, {
    srgb: true,
    wrapT: THREE.ClampToEdgeWrapping,
  });
}

/** 玩家机发动机全套贴图（喷口本体，不只是自发光） */
export function createBakedEngineMaps(): {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  aoMap: THREE.Texture;
  metalnessMap: THREE.Texture;
  emissiveMap: THREE.Texture;
} | null {
  const size = pickSize(1024);
  const dir = `${BASE}/${size}`;
  const base = (m: string) => `${dir}/player_engine_${m}.png`;
  return {
    map: loadTexture(base('basecolor'), { srgb: true, wrapT: THREE.ClampToEdgeWrapping }),
    normalMap: loadTexture(base('normal'), { wrapT: THREE.ClampToEdgeWrapping }),
    roughnessMap: loadTexture(base('roughness'), { wrapT: THREE.ClampToEdgeWrapping }),
    aoMap: loadTexture(base('ao'), { wrapT: THREE.ClampToEdgeWrapping }),
    metalnessMap: loadTexture(base('metallic'), { wrapT: THREE.ClampToEdgeWrapping }),
    emissiveMap: loadTexture(base('emissive'), { srgb: true, wrapT: THREE.ClampToEdgeWrapping }),
  };
}

/** 座舱玻璃：近距离才能看到的擦拭痕 / 积尘，用作 roughnessMap 与极轻的法线扰动 */
export function createBakedCanopyMaps(): {
  roughnessMap: THREE.Texture;
  normalMap: THREE.Texture;
} {
  const size = pickSize(512);
  return {
    roughnessMap: loadTexture(`${BASE}/${size}/canopy_detail_roughness.png`),
    normalMap: loadTexture(`${BASE}/${size}/canopy_detail_normal.png`),
  };
}

// ——————————————————————————————————————————————————————————
// 星球
// ——————————————————————————————————————————————————————————

/** 与 Starfield 的三颗星球种子对应；其他 seed 继续走程序化生成 */
const PLANET_BAKED: Record<number, { id: string; full: number }> = {
  3: { id: 'hero', full: 2048 },
  17: { id: 'bg01', full: 1024 },
  29: { id: 'bg02', full: 1024 },
};

export function createBakedPlanetMaps(seed: number, hero: boolean): PlanetMaps | null {
  const def = PLANET_BAKED[seed];
  if (!def) return null;
  // 星球质量优先级：近距离（hero）> 背景星球
  const width = hero ? pickSize(def.full) : Math.min(pickSize(def.full), 1024);
  const dir = `${BASE}/planet/${width}`;
  const url = (map: string) => `${dir}/${def.id}_${map}.png`;

  const albedo = loadTexture(url('albedo'), { srgb: true });
  const maps: PlanetMaps = {
    albedo,
    roughness: loadTexture(url('roughness')),
    normal: hero ? loadTexture(url('normal')) : null,
    night: hero ? loadTexture(url('night'), { srgb: true }) : null,
    cloud: loadTexture(url('clouds'), { srgb: true }),
    ao: null,
  };
  // 地表 AO：给大气 / 边缘 Shader 采样，让晨昏线附近有真实的体积感
  if (hero) maps.ao = loadTexture(url('ao'));
  return maps;
}

/** 预加载全部烘焙贴图（可选：用于加载屏进度） */
export function preloadPbrAssets(kinds: SurfaceKind[] = ['hull', 'armor', 'dark', 'bossHull', 'bossPlate', 'enemy']): Promise<unknown> {
  const urls: string[] = [];
  for (const kind of kinds) {
    const def = SURFACE_BAKED[kind];
    if (!def) continue;
    const size = pickSize(def.full);
    for (const m of ['basecolor', 'normal', 'roughness', 'metallic', 'ao', 'emissive']) {
      urls.push(`${BASE}/${size}/${def.name}_${m}.png`);
    }
  }
  return Promise.all(urls.map((u) => loader.loadAsync(u).catch(() => null)));
}
