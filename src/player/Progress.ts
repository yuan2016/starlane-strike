import { AIRCRAFT, type AircraftDef, type AircraftId } from '../data/aircraft';
import { LEVELS } from '../data/levels';
import {
  loadSave,
  UPGRADE_MAX_LEVEL,
  writeSave,
  type SaveData,
  type UpgradeKey,
  type UpgradeLevels,
} from '../data/SaveData';
import { WEAPONS, type WeaponDef, type WeaponId } from '../data/weapons';

export interface UpgradeDef {
  key: UpgradeKey;
  name: string;
  desc: string;
  /** 每级加成幅度（用于描述） */
  step: string;
}

export const UPGRADES: UpgradeDef[] = [
  { key: 'hp', name: '装甲强化', desc: '提升生命上限', step: '+8% 生命' },
  { key: 'atk', name: '火力强化', desc: '提升所有武器伤害', step: '+10% 伤害' },
  { key: 'def', name: '防护涂层', desc: '减少受到的伤害', step: '-5% 承伤' },
  { key: 'crit', name: '瞄准系统', desc: '提升暴击几率', step: '+4% 暴击' },
  { key: 'fireRate', name: '冷却系统', desc: '提升射击速度', step: '+6% 射速' },
];

/** 强化所需金币：1 级 120，逐级递增 */
export function upgradeCost(level: number): number {
  return Math.round(120 * Math.pow(1.75, level));
}

export interface PlayerModifiers {
  maxHp: number;
  maxShield: number;
  speedMul: number;
  damageMul: number;
  fireRateMul: number;
  critRate: number;
  /** 减伤比例 0~0.4 */
  damageReduction: number;
}

/**
 * 成长系统：管理存档中的金币、机体 / 武器解锁与强化等级，
 * 并把它们换算成本局生效的属性加成。
 */
export class Progress {
  save: SaveData = loadSave();

  get coins(): number {
    return this.save.coins;
  }

  get aircraftDef(): AircraftDef {
    return AIRCRAFT[this.save.aircraft] ?? AIRCRAFT.falcon;
  }

  get weaponDef(): WeaponDef {
    return WEAPONS[this.save.weapon] ?? WEAPONS.double;
  }

  get weaponLevel(): number {
    return this.save.weaponLevels[this.save.weapon] ?? 1;
  }

  levelOf(weapon: WeaponId): number {
    return this.save.weaponLevels[weapon] ?? 0;
  }

  ownsAircraft(id: AircraftId): boolean {
    return this.save.ownedAircraft.includes(id);
  }

  ownsWeapon(id: WeaponId): boolean {
    return this.save.ownedWeapons.includes(id);
  }

  upgradeLevel(key: UpgradeKey): number {
    return this.save.upgrades[key] ?? 0;
  }

  /** 综合机体与强化后的最终属性 */
  get modifiers(): PlayerModifiers {
    const air = this.aircraftDef;
    const u: UpgradeLevels = this.save.upgrades;
    return {
      maxHp: Math.round(air.hp * (1 + u.hp * 0.08)),
      maxShield: Math.round(air.shield * (1 + u.hp * 0.05)),
      speedMul: air.speedMul,
      damageMul: air.damageMul * (1 + u.atk * 0.1),
      fireRateMul: air.fireRateMul * (1 + u.fireRate * 0.06),
      critRate: Math.min(0.6, u.crit * 0.04),
      damageReduction: Math.min(0.4, u.def * 0.05),
    };
  }

  addCoins(amount: number): void {
    this.save.coins += Math.max(0, Math.round(amount));
    this.flush();
  }

  /** 购买 / 装备战机，返回是否成功 */
  selectAircraft(id: AircraftId): boolean {
    const def = AIRCRAFT[id];
    if (!def) return false;
    if (!this.ownsAircraft(id)) {
      if (this.save.coins < def.price) return false;
      this.save.coins -= def.price;
      this.save.ownedAircraft.push(id);
    }
    this.save.aircraft = id;
    this.flush();
    return true;
  }

  /** 购买 / 装备武器 */
  selectWeapon(id: WeaponId): boolean {
    const def = WEAPONS[id];
    if (!def) return false;
    if (!this.ownsWeapon(id)) {
      if (this.save.coins < def.price) return false;
      this.save.coins -= def.price;
      this.save.ownedWeapons.push(id);
      this.save.weaponLevels[id] = 1;
    }
    this.save.weapon = id;
    this.flush();
    return true;
  }

  /** 强化当前武器一级 */
  levelUpWeapon(): boolean {
    const id = this.save.weapon;
    const level = this.weaponLevel;
    const def = this.weaponDef;
    if (level >= def.maxLevel) return false;
    const cost = upgradeCost(level);
    if (this.save.coins < cost) return false;
    this.save.coins -= cost;
    this.save.weaponLevels[id] = level + 1;
    this.flush();
    return true;
  }

  weaponUpgradeCost(): number {
    return upgradeCost(this.weaponLevel);
  }

  /** 强化通用属性一级 */
  levelUpUpgrade(key: UpgradeKey): boolean {
    const level = this.upgradeLevel(key);
    if (level >= UPGRADE_MAX_LEVEL) return false;
    const cost = upgradeCost(level);
    if (this.save.coins < cost) return false;
    this.save.coins -= cost;
    this.save.upgrades[key] = level + 1;
    this.flush();
    return true;
  }

  /** 某关的星级（0 = 未通关） */
  starsOf(levelId: string): number {
    return this.save.levelStars[levelId] ?? 0;
  }

  /** 某关的历史最高分 */
  bestOf(levelId: string): number {
    return this.save.levelBest[levelId] ?? 0;
  }

  /**
   * 关卡是否解锁：第一关始终开放，其后需要通关上一关。
   */
  isUnlocked(levelId: string, order: number): boolean {
    if (order <= 0) return true;
    if (this.starsOf(levelId) > 0) return true;
    const prev = LEVELS[order - 1];
    if (!prev) return false;
    return this.starsOf(prev.id) > 0 || this.save.clearedLevel >= order;
  }

  /** 已获得的总星数 */
  get totalStars(): number {
    return Object.values(this.save.levelStars).reduce((sum, v) => sum + v, 0);
  }

  /** 关卡结算：写入分数、金币、星级并解锁下一关 */
  commitLevel(levelId: string, order: number, score: number, coins: number, stars: number): void {
    this.save.coins += Math.round(coins);
    this.save.bestScore = Math.max(this.save.bestScore, Math.round(score));
    this.save.clearedLevel = Math.max(this.save.clearedLevel, order + 1);
    this.save.levelStars[levelId] = Math.max(this.save.levelStars[levelId] ?? 0, stars);
    this.save.levelBest[levelId] = Math.max(this.save.levelBest[levelId] ?? 0, Math.round(score));
    this.flush();
  }

  resetAll(): void {
    this.save = loadSave();
    localStorage.removeItem('starlane.save.v1');
    this.save = {
      bestScore: 0,
      coins: 0,
      clearedLevel: 0,
      aircraft: 'falcon',
      weapon: 'double',
      ownedAircraft: ['falcon'],
      ownedWeapons: ['single', 'double'],
      weaponLevels: { single: 1, double: 1 },
      upgrades: { hp: 0, atk: 0, def: 0, crit: 0, fireRate: 0 },
      levelStars: {},
      levelBest: {},
      };
    this.flush();
  }

  private flush(): void {
    writeSave(this.save);
  }
}
