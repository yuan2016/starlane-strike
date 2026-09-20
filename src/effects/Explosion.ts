import * as THREE from 'three';
import { ObjectPool } from '../core/ObjectPool';
import type { ParticleSystem } from './ParticleSystem';

export interface ExplosionOptions {
  position: THREE.Vector3;
  /** 爆炸规模：1 = 普通敌机，3+ = Boss */
  scale?: number;
  color?: THREE.ColorRepresentation;
  ringColor?: THREE.ColorRepresentation;
  particleCount?: number;
  /** 是否抛出高速火花 */
  sparks?: boolean;
}

interface Flash {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  from: number;
  to: number;
}

/** 冲击环 / 闪光球的朝向：正对固定相机 */
const RING_TILT = -0.58;

/**
 * 爆炸特效：中心闪光球 + 冲击波圆环 + 粒子火花，全部走对象池。
 */
export class ExplosionSystem {
  readonly group = new THREE.Group();

  private readonly particles: ParticleSystem;
  private readonly flashPool: ObjectPool<Flash>;
  private readonly activeFlashes: Flash[] = [];
  private readonly flashGeo = new THREE.SphereGeometry(1, 12, 10);
  private readonly ringGeo = new THREE.RingGeometry(0.62, 1, 40);

  constructor(particles: ParticleSystem) {
    this.particles = particles;
    this.group.name = 'Explosions';

    this.flashPool = new ObjectPool<Flash>(
      () => {
        const mesh = new THREE.Mesh(
          this.flashGeo,
          new THREE.MeshBasicMaterial({
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        mesh.visible = false;
        this.group.add(mesh);
        return { mesh, life: 0, maxLife: 1, from: 0, to: 1 };
      },
      (flash) => {
        flash.mesh.visible = false;
        flash.mesh.scale.setScalar(1);
      },
    );
  }

  /** 常规爆炸 */
  explode(options: ExplosionOptions): void {
    const {
      position,
      scale = 1,
      color = 0xffa445,
      ringColor = 0x9fd8ff,
      particleCount = Math.round(22 * scale),
      sparks = true,
    } = options;

    this.particles.emit({
      position,
      count: particleCount,
      color,
      speed: 7 * scale,
      size: 0.55 * scale,
      life: 0.55 + 0.18 * scale,
      drag: 2.2,
    });
    this.particles.emit({
      position,
      count: Math.round(particleCount * 0.4),
      color: 0xfff0c0,
      speed: 3.4 * scale,
      size: 0.9 * scale,
      life: 0.3 + 0.1 * scale,
      drag: 3.2,
    });

    if (sparks) {
      this.particles.emit({
        position,
        count: Math.round(8 * scale),
        color: 0xffd36b,
        speed: 16 * scale,
        size: 0.32 * scale,
        life: 0.42,
        drag: 0.6,
        gravity: -2,
      });
    }

    // 中心闪光
    this.spawnFlash(position, scale * 1.5, scale * 2.6, 0.22, 0xffd9a0);
    // 冲击环
    this.spawnRing(position, scale * 0.8, scale * 5.5, 0.5, ringColor);
  }

  /** 子弹命中的小火花 */
  hitSpark(position: THREE.Vector3, color: THREE.ColorRepresentation = 0xbfe9ff): void {
    this.particles.emit({
      position,
      count: 5,
      color,
      speed: 5.5,
      size: 0.34,
      life: 0.22,
      drag: 4,
    });
    this.spawnFlash(position, 0.22, 0.6, 0.12, color);
  }

  private spawnFlash(
    position: THREE.Vector3,
    from: number,
    to: number,
    life: number,
    color: THREE.ColorRepresentation,
  ): void {
    const flash = this.flashPool.acquire();
    flash.mesh.position.copy(position);
    flash.mesh.visible = true;
    flash.mesh.scale.setScalar(from);
    flash.life = life;
    flash.maxLife = life;
    flash.from = from;
    flash.to = to;
    const mat = flash.mesh.material as THREE.MeshBasicMaterial;
    mat.color.set(color);
    mat.opacity = 1;
    this.activeFlashes.push(flash);
  }

  private spawnRing(
    position: THREE.Vector3,
    from: number,
    to: number,
    life: number,
    color: THREE.ColorRepresentation,
  ): void {
    const flash = this.flashPool.acquire();
    // 复用同一池，仅替换几何与朝向
    flash.mesh.geometry = this.ringGeo;
    flash.mesh.rotation.set(RING_TILT, 0, 0);
    flash.mesh.position.copy(position);
    flash.mesh.visible = true;
    flash.mesh.scale.setScalar(from);
    flash.life = life;
    flash.maxLife = life;
    flash.from = from;
    flash.to = to;
    const mat = flash.mesh.material as THREE.MeshBasicMaterial;
    mat.color.set(color);
    mat.opacity = 0.9;
    this.activeFlashes.push(flash);
  }

  update(dt: number): void {
    for (let i = this.activeFlashes.length - 1; i >= 0; i--) {
      const flash = this.activeFlashes[i];
      flash.life -= dt;
      if (flash.life <= 0) {
        flash.mesh.geometry = this.flashGeo;
        flash.mesh.rotation.set(0, 0, 0);
        this.flashPool.release(flash);
        this.activeFlashes.splice(i, 1);
        continue;
      }
      const t = 1 - flash.life / flash.maxLife;
      const eased = 1 - Math.pow(1 - t, 3);
      flash.mesh.scale.setScalar(THREE.MathUtils.lerp(flash.from, flash.to, eased));
      (flash.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    }
  }

  clear(): void {
    for (const flash of this.activeFlashes) {
      flash.mesh.geometry = this.flashGeo;
      this.flashPool.release(flash);
    }
    this.activeFlashes.length = 0;
  }

  dispose(): void {
    this.clear();
    this.flashGeo.dispose();
    this.ringGeo.dispose();
    this.flashPool.forEachActive((f) => (f.mesh.material as THREE.Material).dispose());
  }
}
