import * as THREE from 'three';
import type { BossManager } from '../boss/BossManager';
import type { ExplosionSystem } from '../effects/Explosion';
import type { ParticleSystem } from '../effects/ParticleSystem';
import type { Enemy } from '../enemy/Enemy';
import type { EnemyManager } from '../enemy/EnemyManager';
import type { DamageResult, PlayerStats } from '../player/PlayerStats';
import { BulletSystem } from './BulletSystem';

export interface DamageContext {
  playerPos: THREE.Vector3;
  playerRadius: number;
  stats: PlayerStats;
  bullets: BulletSystem;
  enemies: EnemyManager;
  boss: BossManager;
  explosions: ExplosionSystem;
  particles: ParticleSystem;
  shake: (intensity: number) => void;
  onKill: (enemy: Enemy) => void;
  onPlayerDamaged: (result: DamageResult, position: THREE.Vector3) => void;
  onPlayerDead: () => void;
  onBossDefeated: () => void;
}

/**
 * 伤害系统：把碰撞结果转成伤害、特效与事件。
 * 集中在一处，避免 Game 变得臃肿。
 */
export class DamageSystem {
  private readonly hitPoint = new THREE.Vector3();
  private readonly boxPos = new THREE.Vector3();

  update(ctx: DamageContext): void {
    this.resolveBullets(ctx);
    this.resolveBodyCollisions(ctx);
  }

  private resolveBullets(ctx: DamageContext): void {
    const list = ctx.bullets.bullets;

    for (let i = list.length - 1; i >= 0; i--) {
      const bullet = list[i];

      if (bullet.owner === 'player') {
        this.hitPoint.copy(bullet.position);

        // 1) Boss 优先（含两侧炮台）
        if (ctx.boss.boss.isVulnerable && this.tryHitBoss(bullet.position, bullet.radius, bullet.damage, ctx)) {
          ctx.explosions.hitSpark(this.hitPoint, 0xffe0a3);
          ctx.bullets.recycle(i);
          continue;
        }

        // 2) 普通敌机
        const target = this.findHitEnemy(bullet.position.x, bullet.position.z, bullet.radius, ctx);
        if (target) {
          if (target.takeDamage(bullet.damage)) {
            ctx.onKill(target);
          } else {
            ctx.explosions.hitSpark(this.hitPoint, bullet.color);
          }
          ctx.bullets.recycle(i);
        }
      } else {
        // 3) 敌弹命中玩家
        if (
          Math.abs(bullet.position.z - ctx.playerPos.z) < ctx.playerRadius + bullet.radius &&
          Math.hypot(bullet.position.x - ctx.playerPos.x, bullet.position.z - ctx.playerPos.z) <
            ctx.playerRadius + bullet.radius
        ) {
          this.hitPoint.copy(bullet.position);
          this.damagePlayer(ctx, bullet.damage, this.hitPoint);
          ctx.bullets.recycle(i);
        }
      }
    }
  }

  private tryHitBoss(
    point: THREE.Vector3,
    radius: number,
    damage: number,
    ctx: DamageContext,
  ): boolean {
    const boss = ctx.boss.boss;
    for (let h = 0; h < boss.hitboxes.length; h++) {
      const box = boss.hitboxes[h];
      if (!box.alive) continue;
      this.boxPos.set(boss.position.x + box.offsetX, 0, boss.position.z + box.offsetZ);
      const dist = Math.hypot(point.x - this.boxPos.x, point.z - this.boxPos.z);
      if (dist > box.radius + radius) continue;

      const killed = boss.takeDamage(damage, h);
      if (h > 0 && !box.alive) {
        // 炮台被击毁
        ctx.explosions.explode({
          position: this.boxPos,
          scale: 2,
          color: 0xffc46b,
          ringColor: 0xff7a5c,
        });
        ctx.shake(0.3);
      }
      if (killed) ctx.onBossDefeated();
      return true;
    }
    return false;
  }

  private findHitEnemy(x: number, z: number, radius: number, ctx: DamageContext): Enemy | null {
    const found: { enemy: Enemy | null } = { enemy: null };
    ctx.enemies.forEachActive((enemy) => {
      if (found.enemy) return;
      const dist = Math.hypot(enemy.position.x - x, enemy.position.z - z);
      if (dist <= enemy.radius + radius) found.enemy = enemy;
    });
    return found.enemy;
  }

  /** 敌机撞击玩家（自爆机等于主动送死） */
  private resolveBodyCollisions(ctx: DamageContext): void {
    const doomed: Enemy[] = [];
    ctx.enemies.forEachActive((enemy) => {
      const dist = Math.hypot(enemy.position.x - ctx.playerPos.x, enemy.position.z - ctx.playerPos.z);
      if (dist > enemy.radius + ctx.playerRadius) return;

      this.hitPoint.copy(enemy.position);
      this.damagePlayer(ctx, enemy.def.contactDamage, this.hitPoint);
      if (enemy.takeDamage(enemy.def.kind === 'kamikaze' ? 9999 : 60)) doomed.push(enemy);
    });
    for (const enemy of doomed) ctx.onKill(enemy);
  }

  private damagePlayer(ctx: DamageContext, amount: number, position: THREE.Vector3): void {
    const result = ctx.stats.takeDamage(amount);
    if (result === 'ignored') return;

    if (result === 'dead') {
      ctx.explosions.explode({ position, scale: 2.4, color: 0xff7a5c, ringColor: 0xffd166 });
      ctx.shake(0.8);
      ctx.onPlayerDamaged(result, position);
      ctx.onPlayerDead();
      return;
    }

    ctx.explosions.hitSpark(position, result === 'shield' ? 0x6fd6ff : 0xff8a5c);
    ctx.shake(result === 'shield' ? 0.12 : 0.22);
    ctx.onPlayerDamaged(result, position);
  }
}
