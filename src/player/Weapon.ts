import * as THREE from 'three';
import type { BulletSystem } from '../combat/BulletSystem';
import {
  WEAPONS,
  WEAPON_LEVEL_DAMAGE_STEP,
  WEAPON_LEVEL_INTERVAL_STEP,
  type WeaponDef,
  type WeaponId,
} from '../data/weapons';

const FORWARD = new THREE.Vector3(0, 0, -1);

/**
 * 武器控制器：自动射击。
 * 伤害 = 武器基础伤害 × 等级成长 ×（机体 + 强化）倍率，并支持暴击。
 */
export class Weapon {
  private id: WeaponId = 'double';
  private level = 1;
  /** 本局拾取的火力道具 P 带来的临时等级 */
  private power = 0;
  private damageMul = 1;
  private fireRateMul = 1;
  private critRate = 0;
  private cooldown = 0;
  /** 追踪武器用的取目标回调（返回目标世界坐标，随对象移动自动更新） */
  private targetProvider: (() => THREE.Vector3 | null) | null = null;

  private readonly origin = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  get def(): WeaponDef {
    return WEAPONS[this.id];
  }

  get weaponId(): WeaponId {
    return this.id;
  }

  get weaponLevel(): number {
    return this.level;
  }

  /** 本局实际生效等级：存档等级 + 关卡内火力道具 */
  get powerLevel(): number {
    return Math.min(this.def.maxLevel, this.level + this.power);
  }

  get displayName(): string {
    const extra = this.power > 0 ? ` (+${this.power})` : '';
    return `${this.def.name} Lv${this.powerLevel}${extra}`;
  }

  /** HUD 用的单发伤害估算 */
  get damagePerShot(): number {
    return this.def.damage * (1 + (this.powerLevel - 1) * WEAPON_LEVEL_DAMAGE_STEP) * this.damageMul;
  }

  /** 拾取火力道具：已满级返回 false，由调用方折算成金币 */
  addPower(count = 1): boolean {
    if (this.powerLevel >= this.def.maxLevel) return false;
    this.power = Math.min(this.def.maxLevel - this.level, this.power + count);
    return true;
  }

  resetPower(): void {
    this.power = 0;
  }

  configure(id: WeaponId, level: number): void {
    const def = WEAPONS[id] ?? WEAPONS.double;
    this.id = def.id;
    this.level = THREE.MathUtils.clamp(Math.round(level) || 1, 1, def.maxLevel);
    this.cooldown = 0;
  }

  setModifiers(damageMul: number, fireRateMul: number, critRate: number): void {
    this.damageMul = damageMul;
    this.fireRateMul = fireRateMul;
    this.critRate = critRate;
  }

  /** 供导弹锁定：返回最近目标的世界坐标 */
  setTargetProvider(fn: (() => THREE.Vector3 | null) | null): void {
    this.targetProvider = fn;
  }

  /** 每次齐射触发一次，参数为当前武器 id（用于区分射击音效） */
  onFire: ((weapon: WeaponId) => void) | null = null;

  private get interval(): number {
    const base = this.def.interval * (1 - (this.powerLevel - 1) * WEAPON_LEVEL_INTERVAL_STEP);
    return base / Math.max(this.fireRateMul, 0.2);
  }

  update(dt: number, firing: boolean, muzzles: THREE.Object3D[], system: BulletSystem): void {
    this.cooldown -= dt;
    if (!firing || this.cooldown > 0) return;

    const def = this.def;
    this.cooldown = this.interval;
    // 每次齐射回调一次（不是每发子弹），避免音效过密
    this.onFire?.(def.id);
    const homingTarget = def.id === 'missile' ? (this.targetProvider?.() ?? null) : null;
    const opts = {
      speed: def.speed,
      damage: this.rollDamage(),
      color: def.color,
      length: def.length,
      radius: def.radius,
      life: 3.2,
      trailRate: def.id === 'laser' ? 40 : 24,
      homing: homingTarget,
      homingStrength: 3.6,
    };

    // muzzles: [0] 左 [1] 右 [2] 机头中心
    const left = muzzles[0];
    const right = muzzles[1];
    const center = muzzles[2] ?? muzzles[0];
    const lv = this.powerLevel;

    switch (def.id) {
      case 'single':
        this.fire(center, FORWARD, system, opts);
        break;
      case 'double':
        this.fire(left, FORWARD, system, opts);
        this.fire(right, FORWARD, system, opts);
        if (lv >= 4) this.fire(center, FORWARD, system, this.critOpts(opts));
        break;
      case 'triple':
        this.fire(center, FORWARD, system, opts);
        this.fire(left, this.tilted(-0.1), system, opts);
        this.fire(right, this.tilted(0.1), system, opts);
        if (lv >= 3) {
          this.fire(left, this.tilted(-0.24), system, opts);
          this.fire(right, this.tilted(0.24), system, opts);
        }
        break;
      case 'spread': {
        const angles = lv >= 3 ? [-0.42, -0.28, -0.14, 0, 0.14, 0.28, 0.42] : [-0.34, -0.17, 0, 0.17, 0.34];
        for (const angle of angles) {
          this.fire(center, this.tilted(angle), system, this.critOpts(opts));
        }
        break;
      }
      case 'laser':
        this.fire(center, FORWARD, system, opts);
        if (lv >= 3) {
          this.fire(left, FORWARD, system, opts);
          this.fire(right, FORWARD, system, opts);
        }
        break;
      case 'missile':
        this.fire(left, this.tilted(-0.25), system, opts);
        this.fire(right, this.tilted(0.25), system, opts);
        if (lv >= 2) this.fire(center, FORWARD, system, opts);
        break;
    }
  }

  /** 每发独立判定暴击 */
  private critOpts(base: Parameters<BulletSystem['spawn']>[3]): Parameters<BulletSystem['spawn']>[3] {
    const crit = Math.random() < this.critRate;
    return crit ? { ...base, damage: base.damage * 1.8, color: 0xfff2a8 } : base;
  }

  private rollDamage(): number {
    const base = this.def.damage * (1 + (this.powerLevel - 1) * WEAPON_LEVEL_DAMAGE_STEP) * this.damageMul;
    return Math.random() < this.critRate ? base * 1.8 : base;
  }

  private tilted(angle: number): THREE.Vector3 {
    return this.dir.set(Math.sin(angle), 0, -Math.cos(angle));
  }

  private fire(
    muzzle: THREE.Object3D,
    direction: THREE.Vector3,
    system: BulletSystem,
    opts: Parameters<BulletSystem['spawn']>[3],
  ): void {
    muzzle.getWorldPosition(this.origin);
    system.spawn('player', this.origin, direction, opts);
  }
}
