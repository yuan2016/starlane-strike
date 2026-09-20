import * as THREE from 'three';
import { ObjectPool } from '../core/ObjectPool';
import { ENEMY_DEFS, type EnemyKind } from '../data/enemies';
import { Enemy, type EnemyUpdateContext } from './Enemy';

export interface EnemySpawnParams {
  x: number;
  z: number;
  vx?: number;
  hoverZ?: number;
}

/**
 * 敌机管理器：按类型分池复用，负责生成、更新、回收与死亡回调。
 */
export class EnemyManager {
  readonly group = new THREE.Group();

  /** 被击毁（用于加分 / 爆炸 / 掉落） */
  onDestroyed: ((enemy: Enemy) => void) | null = null;
  /** 飞出屏幕（未被击杀） */
  onEscaped: ((enemy: Enemy) => void) | null = null;

  private readonly pools = new Map<EnemyKind, ObjectPool<Enemy>>();
  private readonly activeList: Enemy[] = [];

  constructor() {
    this.group.name = 'Enemies';
  }

  private poolOf(kind: EnemyKind): ObjectPool<Enemy> {
    let pool = this.pools.get(kind);
    if (!pool) {
      pool = new ObjectPool<Enemy>(
        () => {
          const enemy = new Enemy(ENEMY_DEFS[kind]);
          enemy.ensureModel();
          this.group.add(enemy.group);
          return enemy;
        },
        (enemy) => enemy.despawn(),
      );
      this.pools.set(kind, pool);
    }
    return pool;
  }

  spawn(kind: EnemyKind, params: EnemySpawnParams): Enemy | null {
    const pool = this.poolOf(kind);
    const enemy = pool.acquire();
    enemy.spawn(params.x, params.z, params);
    this.activeList.push(enemy);
    return enemy;
  }

  /** 击毁并回收（由伤害系统 / 特殊武器调用） */
  kill(enemy: Enemy): void {
    if (!enemy.active) return;
    enemy.active = false;
    enemy.escaped = false;
    this.onDestroyed?.(enemy);
    this.release(enemy);
  }

  private release(enemy: Enemy): void {
    this.poolOf(enemy.kind).release(enemy);
    const idx = this.activeList.indexOf(enemy);
    if (idx >= 0) this.activeList.splice(idx, 1);
  }

  update(dt: number, ctx: EnemyUpdateContext): void {
    for (let i = this.activeList.length - 1; i >= 0; i--) {
      const enemy = this.activeList[i];
      enemy.update(dt, ctx);
      if (!enemy.active) {
        if (enemy.escaped) this.onEscaped?.(enemy);
        this.poolOf(enemy.kind).release(enemy);
        this.activeList.splice(i, 1);
      }
    }
  }

  forEachActive(fn: (enemy: Enemy) => void): void {
    for (let i = 0; i < this.activeList.length; i++) fn(this.activeList[i]);
  }

  get active(): readonly Enemy[] {
    return this.activeList;
  }

  get count(): number {
    return this.activeList.length;
  }

  clear(): void {
    for (const pool of this.pools.values()) pool.releaseAll();
    this.activeList.length = 0;
  }

  dispose(): void {
    this.clear();
    for (const pool of this.pools.values()) {
      pool.forEachActive((e) => e.dispose());
    }
  }
}

export type { EnemyUpdateContext };
export type EnemyPosition = THREE.Vector3;
