import type * as THREE from 'three';
import { RENDER } from '../config';

/** 设备档位：桌面端 high，移动端 / 低端设备 medium */
export type DeviceTier = 'high' | 'medium';

/** {@link DeviceTier} 的历史别名 */
export type QualityTier = DeviceTier;

/** 档位来源：auto = 能力探测，override = 手动指定（URL / localStorage） */
export type QualitySource = 'auto' | 'override';

export interface BloomProfile {
  strength: number;
  radius: number;
  /** 亮度阈值：低于该值的内容不参与泛光，避免整块模型发白 */
  threshold: number;
}

export interface QualitySettings {
  tier: DeviceTier;
  /** 档位来源：探测结果还是手动覆盖 */
  source: QualitySource;
  /** 机体 / 舰体程序化贴图基准尺寸 */
  textureSize: number;
  /** 星球贴图（等距圆柱）宽度 */
  planetTextureWidth: number;
  /** MSAA 采样数（0 = 关闭） */
  msaa: number;
  pixelRatioCap: number;
  bloom: BloomProfile;
  /** 环境贴图强度（HDR 环境光，替代单纯提亮灯光） */
  envIntensity: number;
  /** PMREM 分辨率 */
  envResolution: number;
  /** 星球球面细分 */
  planetSegments: number;
  /** Fresnel 轮廓光 Shader */
  rimLight: boolean;
  /** 大气层 */
  atmosphere: boolean;
  /** 独立云层（仅焦点星球） */
  clouds: boolean;
  /** 夜面城市灯光 */
  nightLights: boolean;
  /** 各向异性过滤 */
  anisotropy: number;
}

type Preset = Omit<QualitySettings, 'anisotropy' | 'source'>;

/** 基于 RENDER 基准值派生辉光参数，避免同一份数值在两处各写一遍 */
function bloomPreset(strengthScale: number, radiusScale: number, thresholdDelta: number): BloomProfile {
  return {
    strength: RENDER.bloom.strength * strengthScale,
    radius: RENDER.bloom.radius * radiusScale,
    threshold: RENDER.bloom.threshold + thresholdDelta,
  };
}

/**
 * 档位预设：high 直接使用 config.RENDER 的基准值，
 * medium 在其基础上按比例下调（辉光更收敛、贴图减半、关闭云层与夜灯）。
 */
const PRESETS: Record<DeviceTier, Preset> = {
  high: {
    tier: 'high',
    textureSize: 1024,
    planetTextureWidth: 1024,
    msaa: RENDER.msaa,
    pixelRatioCap: RENDER.pixelRatioCap,
    bloom: bloomPreset(1, 1, 0),
    envIntensity: 0.85,
    envResolution: 256,
    planetSegments: 48,
    rimLight: true,
    atmosphere: true,
    clouds: true,
    nightLights: true,
  },
  medium: {
    tier: 'medium',
    textureSize: 512,
    planetTextureWidth: 512,
    msaa: 2,
    pixelRatioCap: 1.5,
    bloom: bloomPreset(0.8, 0.8, 0.02),
    envIntensity: 0.55,
    envResolution: 128,
    planetSegments: 32,
    rimLight: true,
    atmosphere: true,
    clouds: false,
    nightLights: false,
  },
};

/**
 * 手动档位覆盖：`?q=high` / `?q=medium`，用于验收对比与低配机自救。
 * 缺省时走能力探测。
 */
export function readTierOverride(): DeviceTier | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('q');
  return raw === 'high' || raw === 'medium' ? raw : null;
}

/**
 * 设备能力探测：不依赖 UA，只用 WebGL 能力 + 硬件并发数 + 输入方式 + 实际像素量。
 * 得分越高越倾向 high；触屏设备与低核心数设备直接落到 medium，避免画质断崖后的卡顿。
 */
export function detectQuality(renderer: THREE.WebGLRenderer): QualitySettings {
  const caps = renderer.capabilities;
  const coarse =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false;
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const screenW = typeof window !== 'undefined' ? window.screen?.width ?? 1280 : 1280;
  const screenH = typeof window !== 'undefined' ? window.screen?.height ?? 720 : 720;
  const cssPixels = Math.min(screenW, screenH);
  const devicePixels = cssPixels * dpr;

  let score = 0;
  if (cores >= 8) score += 2;
  else if (cores >= 4) score += 1;
  if (devicePixels >= 1400) score += 1;
  if (!coarse) score += 1;
  if (caps.maxSamples >= 4) score += 1;
  if (caps.maxTextureSize >= 8192) score += 1;

  const override = readTierOverride();
  const tier: DeviceTier =
    override ?? (coarse || cores <= 4 ? 'medium' : score >= 4 ? 'high' : 'medium');
  const preset = PRESETS[tier];

  return {
    ...preset,
    source: override ? 'override' : 'auto',
    bloom: { ...preset.bloom },
    msaa: Math.min(preset.msaa, Math.max(caps.maxSamples, 0)),
    anisotropy: Math.min(caps.getMaxAnisotropy(), tier === 'high' ? 8 : 4),
  };
}

/**
 * 运行时自适应：连续低帧时分级下调（DPR → Bloom → 云层），
 * 只降"渲染成本"，不降贴图与模型精度，避免出现明显画质断崖。
 */
export class AdaptiveQuality {
  private sampleTime = 0;
  private frames = 0;
  private level = 0;

  constructor(
    private current: QualitySettings,
    private readonly onChange: (settings: QualitySettings) => void,
  ) {}

  get settings(): QualitySettings {
    return this.current;
  }

  /** 每帧调用；dt 为秒 */
  sample(dt: number): void {
    if (this.level >= 2) return;
    this.frames += 1;
    this.sampleTime += dt;
    if (this.sampleTime < 2) return;
    const fps = this.frames / this.sampleTime;
    this.frames = 0;
    this.sampleTime = 0;
    if (fps >= 45) return;
    this.level += 1;
    this.apply();
  }

  private apply(): void {
    const base = this.current;
    const next: QualitySettings = {
      ...base,
      bloom: { ...base.bloom },
      pixelRatioCap: Math.max(1, base.pixelRatioCap - 0.5),
      clouds: this.level >= 2 ? false : base.clouds,
    };
    next.bloom.strength = base.bloom.strength * 0.85;
    this.current = next;
    this.onChange(next);
  }
}
