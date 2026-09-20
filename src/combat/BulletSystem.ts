import * as THREE from 'three';
import { BATTLE_FIELD } from '../config';
import type { ParticleSystem } from '../effects/ParticleSystem';
import { Bullet, disposeBulletMaterials, type BulletOwner, type BulletSpawnOptions } from './Bullet';

const BOUND_X = 34;
const BOUND_Z_MIN = BATTLE_FIELD.spawnZ - 10;
const BOUND_Z_MAX = BATTLE_FIELD.despawnZ + 8;

/**
 * 子弹系统：内部维护 free / active 双数组实现池化，
 * 玩家与敌方子弹共用一套更新与回收逻辑。
 */
export class BulletSystem {
  readonly group = new THREE.Group();

  private readonly free: Bullet[] = [];
  private readonly active: Bullet[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(capacity = 320) {
    this.group.name = 'Bullets';
    for (let i = 0; i < capacity; i++) {
      const bullet = new Bullet();
      this.group.add(bullet.mesh);
      this.free.push(bullet);
    }
  }

  get activeCount(): number {
    return this.active.length;
  }

  spawn(
    owner: BulletOwner,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    opts: BulletSpawnOptions,
  ): Bullet | null {
    const bullet = this.free.pop();
    if (!bullet) return null;
    bullet.spawn(owner, origin, direction, opts);
    this.active.push(bullet);
    return bullet;
  }

  update(dt: number, particles: ParticleSystem): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const bullet = this.active[i];

      if (bullet.homingTarget) {
        // 追踪弹：朝目标缓慢转向
        this.tmp.copy(bullet.homingTarget).sub(bullet.position).normalize();
        const speed = bullet.velocity.length();
        bullet.velocity.lerp(this.tmp.multiplyScalar(speed), 1 - Math.exp(-bullet.homingStrength * dt));
        bullet.mesh.lookAt(bullet.position.clone().add(bullet.velocity));
      }

      bullet.position.addScaledVector(bullet.velocity, dt);
      bullet.mesh.position.copy(bullet.position);
      bullet.life -= dt;

      if (bullet.trailRate > 0) {
        bullet.trailTimer += dt;
        const interval = 1 / bullet.trailRate;
        while (bullet.trailTimer >= interval) {
          bullet.trailTimer -= interval;
          particles.emit({
            position: bullet.position,
            count: 1,
            color: bullet.color,
            speed: 0.6,
            size: 0.32,
            life: 0.22,
            drag: 5,
          });
        }
      }

      const p = bullet.position;
      const dead =
        bullet.life <= 0 ||
        p.x < -BOUND_X ||
        p.x > BOUND_X ||
        p.z < BOUND_Z_MIN ||
        p.z > BOUND_Z_MAX;
      if (dead) this.recycle(i);
    }
  }

  recycle(index: number): void {
    const bullet = this.active[index];
    bullet.deactivate();
    const last = this.active.pop();
    if (index < this.active.length) this.active[index] = last as Bullet;
    this.free.push(bullet);
  }

  /** 遍历活跃子弹（回调内不要增删） */
  forEachActive(fn: (bullet: Bullet) => void): void {
    for (let i = 0; i < this.active.length; i++) fn(this.active[i]);
  }

  get bullets(): readonly Bullet[] {
    return this.active;
  }

  clear(): void {
    for (const bullet of this.active) {
      bullet.deactivate();
      this.free.push(bullet);
    }
    this.active.length = 0;
  }

  dispose(): void {
    this.clear();
    disposeBulletMaterials();
  }
}
