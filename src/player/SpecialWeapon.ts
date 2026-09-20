import * as THREE from 'three';
import type { BulletSystem } from '../combat/BulletSystem';
import type { EnemyManager } from '../enemy/EnemyManager';
import type { ExplosionSystem } from '../effects/Explosion';
import type { ParticleSystem } from '../effects/ParticleSystem';
import type { Enemy } from '../enemy/Enemy';

export interface SpecialContext {
  bullets: BulletSystem;
  enemies: EnemyManager;
  explosions: ExplosionSystem;
  particles: ParticleSystem;
  playerPos: THREE.Vector3;
  onKill: (enemy: Enemy) => void;
  shake: (intensity: number) => void;
}

/**
 * 特殊武器（Space / 底部按钮）：全屏脉冲，重创场上敌机并清除敌方弹幕。
 */
export class SpecialWeapon {
  /** 冷却总时长（秒） */
  readonly cooldownDuration = 9;
  private cooldown = 0;

  get ready(): boolean {
    return this.cooldown <= 0;
  }

  get cooldownRatio(): number {
    return 1 - Math.max(this.cooldown, 0) / this.cooldownDuration;
  }

  update(dt: number): void {
    if (this.cooldown > 0) this.cooldown -= dt;
  }

  fire(ctx: SpecialContext): boolean {
    if (!this.ready) return false;
    this.cooldown = this.cooldownDuration;

    // 冲击波粒子
    ctx.particles.emit({
      position: ctx.playerPos,
      count: 160,
      color: 0x9fe8ff,
      speed: 34,
      size: 0.7,
      life: 0.9,
      drag: 1.1,
    });
    ctx.explosions.explode({
      position: ctx.playerPos,
      scale: 4,
      color: 0x8ff5ff,
      ringColor: 0xffffff,
      particleCount: 60,
    });
    ctx.shake(0.55);

    // 清除敌方子弹
    const list = ctx.bullets.bullets;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].owner !== 'enemy') continue;
      ctx.particles.emit({
        position: list[i].position,
        count: 3,
        color: list[i].color,
        speed: 4,
        size: 0.35,
        life: 0.25,
        drag: 4,
      });
      ctx.bullets.recycle(i);
    }

    // 对全场敌机造成伤害
    const pending: Enemy[] = [];
    ctx.enemies.forEachActive((enemy) => {
      ctx.particles.emit({
        position: enemy.position,
        count: 10,
        color: 0xbfe9ff,
        speed: 8,
        size: 0.4,
        life: 0.3,
        drag: 3,
      });
      if (enemy.takeDamage(110)) pending.push(enemy);
    });
    for (const enemy of pending) ctx.onKill(enemy);

    return true;
  }
}
