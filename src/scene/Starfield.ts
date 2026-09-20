import * as THREE from 'three';
import { BATTLE_FIELD } from '../config';
import { Planet, type PlanetTier } from './Planet';
import type { PlanetPalette } from '../render/ProcTextures';
import type { QualitySettings } from '../render/Quality';

interface StarLayer {
  points: THREE.Points;
  speed: number;
  baseSpeed: number;
}

interface PlanetEntry {
  planet: Planet;
  radius: number;
  speed: number;
  tier: PlanetTier;
}

const LAYER_CONFIG = [
  { count: 900, size: 0.16, speed: 14, color: 0x8fa6ff, opacity: 0.55 },
  { count: 500, size: 0.3, speed: 26, color: 0xbcd0ff, opacity: 0.8 },
  { count: 220, size: 0.52, speed: 44, color: 0xffffff, opacity: 0.95 },
] as const;

/** 远景星球：半径 / 位置 / 推进速度沿用原始设定，只升级材质与层次 */
const PLANET_DEFS: {
  radius: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  tier: PlanetTier;
  seed: number;
  atmosphere: number;
  night: number;
  palette: PlanetPalette;
}[] = [
  {
    // 焦点星球：高精版（地表 + 法线 + 云层 + 大气 + 夜面城市灯）
    radius: 9,
    x: -26,
    y: 6,
    z: -110,
    speed: 1.4,
    tier: 'hero',
    seed: 3,
    atmosphere: 0x5f8fff,
    night: 0xffc27a,
    palette: {
      deep: 0x081428,
      shallow: 0x11395f,
      sand: 0x6b7a86,
      low: 0x3a5a55,
      mid: 0x46685f,
      high: 0x76888f,
      peak: 0xd8e6ef,
      night: 0xffc27a,
      cloud: 0xe8f1ff,
    },
  },
  {
    // 背景星球：中精版（地表 + 大气，无云层 / 无夜面）
    radius: 5.5,
    x: 30,
    y: -10,
    z: -150,
    speed: 1.0,
    tier: 'medium',
    seed: 17,
    atmosphere: 0xff9a5c,
    night: 0xffb066,
    palette: {
      deep: 0x240d06,
      shallow: 0x451c0c,
      sand: 0x7a3f22,
      low: 0x8c4a2f,
      mid: 0x9c5a38,
      high: 0xb07a55,
      peak: 0xd9c2ae,
      night: 0xffb066,
      cloud: 0xffe3cc,
    },
  },
  {
    radius: 3.2,
    x: 16,
    y: 14,
    z: -88,
    speed: 2.1,
    tier: 'medium',
    seed: 29,
    atmosphere: 0x9fd8ff,
    night: 0xa9e5ff,
    palette: {
      deep: 0x14202a,
      shallow: 0x2c4658,
      sand: 0x86a2b0,
      low: 0x6f8fa8,
      mid: 0x8aa6b8,
      high: 0xc3d6e0,
      peak: 0xeef6fb,
      night: 0xa9e5ff,
      cloud: 0xf2f8ff,
    },
  },
];

/**
 * 太空背景：多层视差星空 + 远景星球。
 * 所有元素沿 +Z 持续移动（向玩家后方掠过）并循环复用，营造飞行速度感。
 *
 * 星球按"屏幕占用面积 + 距离"分级：焦点星球全效果，背景星球降低更新频率与 Shader 复杂度。
 */
export class Starfield {
  readonly group = new THREE.Group();

  private readonly layers: StarLayer[] = [];
  private readonly planets: PlanetEntry[] = [];
  /** 星空分布的横向 / 纵向半幅 */
  private readonly spread = new THREE.Vector2(38, 60);
  /** LOD 计算节流（每 0.25s 一次，不做逐帧的距离 / 面积计算） */
  private lodTimer = 0;
  /** 背景星球的旋转累加器：降到 20Hz 更新，位移仍逐帧以保证运动平滑 */
  private mediumAccum = 0;

  constructor(settings: QualitySettings) {
    this.group.name = 'Starfield';
    for (const cfg of LAYER_CONFIG) {
      this.layers.push(this.createLayer(cfg));
    }
    this.createPlanets(settings);
  }

  private createLayer(cfg: (typeof LAYER_CONFIG)[number]): StarLayer {
    const positions = new Float32Array(cfg.count * 3);
    for (let i = 0; i < cfg.count; i++) {
      positions[i * 3 + 0] = (Math.random() * 2 - 1) * this.spread.x;
      positions[i * 3 + 1] = (Math.random() * 2 - 1) * this.spread.y * 0.55 - 4;
      positions[i * 3 + 2] =
        BATTLE_FIELD.spawnZ + Math.random() * (BATTLE_FIELD.despawnZ - BATTLE_FIELD.spawnZ);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      size: cfg.size,
      color: cfg.color,
      transparent: true,
      opacity: cfg.opacity,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.group.add(points);
    return { points, speed: cfg.speed, baseSpeed: cfg.speed };
  }

  /** 关卡环境：星色与流速倍率 */
  setEnv(starColor: number, speedMul: number): void {
    for (const layer of this.layers) {
      layer.speed = layer.baseSpeed * speedMul;
      (layer.points.material as THREE.PointsMaterial).color.set(starColor);
    }
  }

  private createPlanets(settings: QualitySettings): void {
    for (const def of PLANET_DEFS) {
      const planet = new Planet({
        radius: def.radius,
        palette: def.palette,
        atmosphere: def.atmosphere,
        night: def.night,
        tier: def.tier,
        seed: def.seed,
        settings,
      });
      planet.group.position.set(def.x, def.y, def.z);
      this.group.add(planet.group);
      this.planets.push({ planet, radius: def.radius, speed: def.speed, tier: def.tier });
    }
  }

  update(dt: number, camera?: THREE.PerspectiveCamera): void {
    const span = BATTLE_FIELD.despawnZ - BATTLE_FIELD.spawnZ;

    for (const layer of this.layers) {
      const attr = layer.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const delta = layer.speed * dt;
      for (let i = 2; i < arr.length; i += 3) {
        arr[i] += delta;
        if (arr[i] > BATTLE_FIELD.despawnZ) arr[i] -= span;
      }
      attr.needsUpdate = true;
    }

    this.lodTimer -= dt;
    const updateLod = this.lodTimer <= 0 && !!camera;
    if (this.lodTimer <= 0) this.lodTimer = 0.25;

    // 背景星球：20Hz 更新旋转，逐帧仍然推进位置
    this.mediumAccum += dt;
    const flushMedium = this.mediumAccum >= 0.05;
    const mediumDt = this.mediumAccum;
    if (flushMedium) this.mediumAccum = 0;

    for (const entry of this.planets) {
      const pos = entry.planet.group.position;
      pos.z += entry.speed * dt;
      if (pos.z > BATTLE_FIELD.despawnZ + 20) {
        pos.z -= span + 40;
      }

      if (entry.tier === 'hero') entry.planet.update(dt);
      else if (flushMedium) entry.planet.update(mediumDt);

      if (updateLod && camera) {
        // 屏幕占用面积 = 直径 / 距离 * 投影缩放，再结合距离本身
        const dist = Math.max(pos.distanceTo(camera.position), 1);
        const projScale = 1 / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
        const coverage = (entry.radius * projScale) / dist;
        entry.planet.setLod(coverage);
      }
    }
  }

  dispose(): void {
    for (const layer of this.layers) {
      layer.points.geometry.dispose();
      (layer.points.material as THREE.Material).dispose();
    }
    for (const entry of this.planets) {
      entry.planet.dispose();
    }
    this.planets.length = 0;
  }
}
