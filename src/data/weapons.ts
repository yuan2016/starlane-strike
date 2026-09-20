/** 武器编号（与射击模式一一对应） */
export type WeaponId = 'single' | 'double' | 'triple' | 'spread' | 'laser' | 'missile';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  desc: string;
  /** 解锁价格（0 表示初始拥有） */
  price: number;
  /** 射击间隔（秒） */
  interval: number;
  damage: number;
  speed: number;
  color: number;
  length: number;
  radius: number;
  /** 最高等级 */
  maxLevel: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  single: {
    id: 'single',
    name: '单发炮',
    desc: '机头单管速射，稳定性最好。',
    price: 0,
    interval: 0.2,
    damage: 11,
    speed: 48,
    color: 0x8ff5ff,
    length: 1.05,
    radius: 0.34,
    maxLevel: 5,
  },
  double: {
    id: 'double',
    name: '双发炮',
    desc: '两翼齐射，覆盖与伤害均衡。',
    price: 0,
    interval: 0.2,
    damage: 9,
    speed: 50,
    color: 0x9ef0ff,
    length: 1.1,
    radius: 0.32,
    maxLevel: 5,
  },
  triple: {
    id: 'triple',
    name: '三发炮',
    desc: '机头 + 两翼三向齐射。',
    price: 800,
    interval: 0.19,
    damage: 8,
    speed: 52,
    color: 0xa8ffe0,
    length: 1.15,
    radius: 0.32,
    maxLevel: 5,
  },
  spread: {
    id: 'spread',
    name: '散射炮',
    desc: '扇形弹幕，近距离清场能力强。',
    price: 1400,
    interval: 0.28,
    damage: 6,
    speed: 44,
    color: 0xffd67a,
    length: 0.85,
    radius: 0.36,
    maxLevel: 5,
  },
  laser: {
    id: 'laser',
    name: '脉冲激光',
    desc: '超高射速穿透射线，单体 DPS 最高。',
    price: 2200,
    interval: 0.09,
    damage: 4.4,
    speed: 92,
    color: 0xff7ad9,
    length: 2.4,
    radius: 0.3,
    maxLevel: 5,
  },
  missile: {
    id: 'missile',
    name: '追踪导弹',
    desc: '自动锁定目标的导弹，伤害高但射速慢。',
    price: 1800,
    interval: 0.42,
    damage: 18,
    speed: 30,
    color: 0xff9a4d,
    length: 1.2,
    radius: 0.42,
    maxLevel: 5,
  },
};

export const WEAPON_LIST: WeaponDef[] = [
  WEAPONS.single,
  WEAPONS.double,
  WEAPONS.triple,
  WEAPONS.spread,
  WEAPONS.missile,
  WEAPONS.laser,
];

/** 每级伤害成长 */
export const WEAPON_LEVEL_DAMAGE_STEP = 0.18;
/** 每级射速成长（间隔缩短） */
export const WEAPON_LEVEL_INTERVAL_STEP = 0.05;
