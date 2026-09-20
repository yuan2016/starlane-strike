import * as THREE from 'three';
import { BATTLE_FIELD } from '../config';

interface StarLayer {
  points: THREE.Points;
  speed: number;
  baseSpeed: number;
}

const LAYER_CONFIG = [
  { count: 900, size: 0.16, speed: 14, color: 0x8fa6ff, opacity: 0.55 },
  { count: 500, size: 0.3, speed: 26, color: 0xbcd0ff, opacity: 0.8 },
  { count: 220, size: 0.52, speed: 44, color: 0xffffff, opacity: 0.95 },
] as const;

/**
 * 太空背景：多层视差星空。
 * 所有星点沿 +Z 持续移动（向玩家后方掠过）并循环复用，营造飞行速度感。
 */
export class Starfield {
  readonly group = new THREE.Group();

  private readonly layers: StarLayer[] = [];
  /** 星空分布的横向 / 纵向半幅 */
  private readonly spread = new THREE.Vector2(38, 60);

  constructor() {
    this.group.name = 'Starfield';
    for (const cfg of LAYER_CONFIG) {
      this.layers.push(this.createLayer(cfg));
    }
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

  update(dt: number): void {
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
  }

  dispose(): void {
    for (const layer of this.layers) {
      layer.points.geometry.dispose();
      (layer.points.material as THREE.Material).dispose();
    }
    this.layers.length = 0;
  }
}
