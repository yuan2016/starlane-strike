import type { AircraftId } from './aircraft';
import type { WeaponId } from './weapons';

const KEY = 'starlane.save.v1';

export type UpgradeKey = 'hp' | 'atk' | 'def' | 'crit' | 'fireRate';

export type UpgradeLevels = Record<UpgradeKey, number>;

export interface SaveData {
  bestScore: number;
  coins: number;
  /** 已通关的最高关卡序号（1 = 1-1） */
  clearedLevel: number;
  /** 当前出战机与武器 */
  aircraft: AircraftId;
  weapon: WeaponId;
  ownedAircraft: AircraftId[];
  ownedWeapons: WeaponId[];
  /** 每种武器各自的等级 */
  weaponLevels: Partial<Record<WeaponId, number>>;
  upgrades: UpgradeLevels;
  /** 每关星级（1~3） */
  levelStars: Record<string, number>;
  /** 每关最高分 */
  levelBest: Record<string, number>;
}

export const UPGRADE_MAX_LEVEL = 5;

function defaultSave(): SaveData {
  return {
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
}

/** 本地存档（localStorage）。第二阶段起保存金币、机体、武器与强化等级。 */
export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    const base = defaultSave();
    return {
      ...base,
      ...parsed,
      upgrades: { ...base.upgrades, ...(parsed.upgrades ?? {}) },
      weaponLevels: { ...(parsed.weaponLevels ?? {}) },
      levelStars: { ...(parsed.levelStars ?? {}) },
      levelBest: { ...(parsed.levelBest ?? {}) },
      ownedAircraft: parsed.ownedAircraft?.length ? parsed.ownedAircraft : base.ownedAircraft,
      ownedWeapons: parsed.ownedWeapons?.length ? parsed.ownedWeapons : base.ownedWeapons,
    };
  } catch {
    return defaultSave();
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 隐私模式下忽略写入失败
  }
}
