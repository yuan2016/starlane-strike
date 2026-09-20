export type EnemyKind = 'grunt' | 'scout' | 'heavy' | 'kamikaze' | 'elite' | 'laser' | 'bulwark';

/** 敌机移动方式 */
export type EnemyPattern = 'straight' | 'sine' | 'swoop' | 'chase' | 'hover' | 'turret';

/** 激光塔的周期激光参数 */
export interface EnemyBeamDef {
  /** 开火前的充能预告时长 */
  charge: number;
  /** 持续输出时长 */
  fire: number;
  /** 一轮结束后的冷却 */
  cooldown: number;
  /** 每秒持续伤害 */
  damage: number;
  /** 命中判定半宽（世界单位） */
  width: number;
  color: number;
}

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  speed: number;
  /** 碰撞半径 */
  radius: number;
  score: number;
  coin: number;
  exp: number;
  body: number;
  accent: number;
  glow: number;
  pattern: EnemyPattern;
  /** 开火间隔（秒），0 表示不开火 */
  fireInterval: number;
  bulletSpeed: number;
  bulletDamage: number;
  bulletColor: number;
  /** 一次齐射的弹数 */
  salvo: number;
  /** 散射角（弧度） */
  spreadAngle: number;
  /** 是否发射追踪弹 */
  homing: boolean;
  /** 撞击伤害 */
  contactDamage: number;
  /** 掉落火力道具 P 的概率 */
  dropPower: number;
  /** 掉落补给（护盾 / 修理）的概率 */
  dropSupply: number;
  /** 能量护盾：大于 0 时优先扣盾，破盾前本体不掉血 */
  shield?: number;
  /** 护盾外壳颜色 */
  shieldColor?: number;
  /** 激光塔专用：周期充能后发射贯穿战场的激光束 */
  beam?: EnemyBeamDef;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  grunt: {
    kind: 'grunt',
    name: '巡逻机',
    hp: 34,
    speed: 9.5,
    radius: 1.15,
    score: 100,
    coin: 4,
    exp: 6,
    body: 0x6d7f9c,
    accent: 0xc2405a,
    glow: 0xff6b6b,
    pattern: 'straight',
    fireInterval: 1.7,
    bulletSpeed: 20,
    bulletDamage: 10,
    bulletColor: 0xff7a5c,
    salvo: 1,
    spreadAngle: 0,
    homing: false,
    contactDamage: 12,
    dropPower: 0.06,
    dropSupply: 0.03,
  },
  scout: {
    kind: 'scout',
    name: '突击机',
    hp: 24,
    speed: 17,
    radius: 0.95,
    score: 150,
    coin: 6,
    exp: 9,
    body: 0x4f8f7d,
    accent: 0x7ef2c8,
    glow: 0x7ef2c8,
    pattern: 'swoop',
    fireInterval: 0,
    bulletSpeed: 0,
    bulletDamage: 0,
    bulletColor: 0x7ef2c8,
    salvo: 0,
    spreadAngle: 0,
    homing: false,
    contactDamage: 14,
    dropPower: 0.08,
    dropSupply: 0.03,
  },
  heavy: {
    kind: 'heavy',
    name: '重装机',
    hp: 190,
    speed: 5.2,
    radius: 1.9,
    score: 320,
    coin: 14,
    exp: 22,
    body: 0x59627a,
    accent: 0xf0a13c,
    glow: 0xffb347,
    pattern: 'hover',
    fireInterval: 2.1,
    bulletSpeed: 17,
    bulletDamage: 12,
    bulletColor: 0xffb14d,
    salvo: 3,
    spreadAngle: 0.32,
    homing: false,
    contactDamage: 20,
    dropPower: 0.22,
    dropSupply: 0.16,
  },
  kamikaze: {
    kind: 'kamikaze',
    name: '自爆机',
    hp: 46,
    speed: 12,
    radius: 1.25,
    score: 220,
    coin: 9,
    exp: 14,
    body: 0x8a3b2a,
    accent: 0xff7a2f,
    glow: 0xffc045,
    pattern: 'chase',
    fireInterval: 0,
    bulletSpeed: 0,
    bulletDamage: 0,
    bulletColor: 0xff7a2f,
    salvo: 0,
    spreadAngle: 0,
    homing: false,
    contactDamage: 30,
    dropPower: 0.12,
    dropSupply: 0.05,
  },
  elite: {
    kind: 'elite',
    name: '精英机',
    hp: 320,
    speed: 7,
    radius: 1.7,
    score: 600,
    coin: 30,
    exp: 45,
    body: 0x4b3b73,
    accent: 0xb98cff,
    glow: 0xd0a8ff,
    pattern: 'hover',
    fireInterval: 1.6,
    bulletSpeed: 19,
    bulletDamage: 14,
    bulletColor: 0xc08bff,
    salvo: 2,
    spreadAngle: 0.2,
    homing: true,
    contactDamage: 22,
    dropPower: 0.6,
    dropSupply: 0.35,
  },
  laser: {
    kind: 'laser',
    name: '激光塔',
    hp: 250,
    speed: 6.5,
    radius: 1.6,
    score: 520,
    coin: 22,
    exp: 34,
    body: 0x3a5a68,
    accent: 0x7cf0ff,
    glow: 0xa8f8ff,
    pattern: 'turret',
    fireInterval: 0,
    bulletSpeed: 0,
    bulletDamage: 0,
    bulletColor: 0x7cf0ff,
    salvo: 0,
    spreadAngle: 0,
    homing: false,
    contactDamage: 18,
    dropPower: 0.3,
    dropSupply: 0.2,
    beam: { charge: 1.05, fire: 1.45, cooldown: 2.6, damage: 26, width: 1.15, color: 0x7cf0ff },
  },
  bulwark: {
    kind: 'bulwark',
    name: '护盾舰',
    hp: 380,
    speed: 4.6,
    radius: 2.05,
    score: 950,
    coin: 42,
    exp: 62,
    body: 0x46587c,
    accent: 0xffc46b,
    glow: 0x8fd0ff,
    pattern: 'hover',
    fireInterval: 1.9,
    bulletSpeed: 18,
    bulletDamage: 13,
    bulletColor: 0xffd08a,
    salvo: 4,
    spreadAngle: 0.5,
    homing: true,
    contactDamage: 24,
    dropPower: 0.85,
    dropSupply: 0.45,
    shield: 280,
    shieldColor: 0x7ee8ff,
  },
};
