import type { EnemyKind } from './enemies';

export type SpawnSide = 'left' | 'right' | 'center' | 'random' | 'spread';

export interface SpawnEntry {
  /** 相对本波开始的秒数 */
  time: number;
  kind: EnemyKind;
  count: number;
  /** 同组敌机之间的出场间隔 */
  interval: number;
  side: SpawnSide;
  z?: number;
  /** 侧向速度（用于 swoop 斜插） */
  vx?: number;
  hoverZ?: number;
}

export interface WaveDef {
  id: string;
  label: string;
  spawns: SpawnEntry[];
  /** 本波结束后的缓冲时间 */
  restAfter?: number;
}

/** Boss 变体：同一套舰体骨架，通过预设做出不同强度与配色 */
export interface BossPreset {
  id: string;
  name: string;
  /** 主体血量 */
  maxHp: number;
  /** 侧炮台血量 */
  turretHp: number;
  /** 弹幕间隔倍率（越小越密集） */
  intervalMul: number;
  /** 弹速倍率 */
  speedMul: number;
  /** 弹幕伤害倍率 */
  damageMul: number;
  /** 舰体配色 */
  hull: number;
  plate: number;
  core: number;
  glow: number;
  /** 三个阶段的核心色 */
  phaseColors: [number, number, number];
}

/** 关卡环境：背景 / 雾 / 星空配色与流速 */
export interface LevelEnv {
  bg: number;
  fog: number;
  star: number;
  starSpeedMul: number;
}

export interface LevelDef {
  /** 关卡编号，如 1-3 */
  id: string;
  name: string;
  /** HUD 与列表显示的完整名称 */
  label: string;
  /** 一句话简报 */
  brief: string;
  waves: WaveDef[];
  boss: BossPreset;
  env: LevelEnv;
  /** 通关分数奖励 */
  clearBonus: number;
}

// ---------------------------------------------------------------- 1-1

const LEVEL_1_1_WAVES: WaveDef[] = [
  {
    id: 'w1',
    label: '巡逻编队',
    spawns: [{ time: 1.2, kind: 'grunt', count: 3, interval: 0.7, side: 'spread' }],
    restAfter: 2.5,
  },
  {
    id: 'w2',
    label: '侧翼突袭',
    spawns: [
      { time: 0.6, kind: 'scout', count: 3, interval: 0.5, side: 'left', vx: 7, z: -26 },
      { time: 1.8, kind: 'scout', count: 3, interval: 0.5, side: 'right', vx: -7, z: -26 },
    ],
    restAfter: 2.5,
  },
  {
    id: 'w3',
    label: '重装压制',
    spawns: [
      { time: 0.8, kind: 'heavy', count: 1, interval: 0, side: 'center', hoverZ: -1 },
      { time: 2.4, kind: 'grunt', count: 4, interval: 0.7, side: 'spread' },
    ],
    restAfter: 2.8,
  },
  {
    id: 'w4',
    label: '自爆狂潮',
    spawns: [
      { time: 0.6, kind: 'kamikaze', count: 4, interval: 0.9, side: 'random' },
      { time: 3.4, kind: 'elite', count: 1, interval: 0, side: 'center', hoverZ: 0 },
    ],
    restAfter: 3,
  },
];

// ---------------------------------------------------------------- 1-2

const LEVEL_1_2_WAVES: WaveDef[] = [
  {
    id: 'w1',
    label: '碎石巡逻',
    spawns: [
      { time: 1, kind: 'scout', count: 4, interval: 0.6, side: 'spread' },
      { time: 2.6, kind: 'grunt', count: 3, interval: 0.6, side: 'random' },
    ],
    restAfter: 2.4,
  },
  {
    id: 'w2',
    label: '陨石带伏击',
    spawns: [
      { time: 0.5, kind: 'scout', count: 4, interval: 0.45, side: 'left', vx: 8, z: -28 },
      { time: 1.6, kind: 'scout', count: 4, interval: 0.45, side: 'right', vx: -8, z: -28 },
      { time: 3, kind: 'kamikaze', count: 3, interval: 0.8, side: 'random' },
    ],
    restAfter: 2.6,
  },
  {
    id: 'w3',
    label: '重装护航',
    spawns: [
      { time: 0.8, kind: 'heavy', count: 2, interval: 1.4, side: 'spread', hoverZ: -2 },
      { time: 2.6, kind: 'grunt', count: 4, interval: 0.6, side: 'spread' },
    ],
    restAfter: 2.8,
  },
  {
    id: 'w4',
    label: '突击先锋',
    spawns: [
      { time: 0.7, kind: 'elite', count: 1, interval: 0, side: 'center', hoverZ: 0 },
      { time: 2.2, kind: 'kamikaze', count: 5, interval: 0.6, side: 'random' },
    ],
    restAfter: 3,
  },
];

// ---------------------------------------------------------------- 1-3

const LEVEL_1_3_WAVES: WaveDef[] = [
  {
    id: 'w1',
    label: '要塞前哨',
    spawns: [
      { time: 1, kind: 'heavy', count: 2, interval: 1.6, side: 'spread', hoverZ: -2 },
      { time: 2.4, kind: 'grunt', count: 4, interval: 0.6, side: 'spread' },
    ],
    restAfter: 2.4,
  },
  {
    id: 'w2',
    label: '交叉火力',
    spawns: [
      { time: 0.6, kind: 'scout', count: 4, interval: 0.4, side: 'left', vx: 8.5, z: -26 },
      { time: 1.7, kind: 'scout', count: 4, interval: 0.4, side: 'right', vx: -8.5, z: -26 },
    ],
    restAfter: 2.6,
  },
  {
    id: 'w3',
    label: '重装突击',
    spawns: [
      { time: 0.8, kind: 'elite', count: 1, interval: 0, side: 'left', hoverZ: 1 },
      { time: 1.6, kind: 'elite', count: 1, interval: 0, side: 'right', hoverZ: 1 },
      { time: 3, kind: 'heavy', count: 2, interval: 1.2, side: 'center', hoverZ: -3 },
    ],
    restAfter: 2.8,
  },
  {
    id: 'w4',
    label: '自爆清除',
    spawns: [
      { time: 0.6, kind: 'kamikaze', count: 6, interval: 0.55, side: 'random' },
      { time: 3.2, kind: 'grunt', count: 5, interval: 0.5, side: 'spread' },
    ],
    restAfter: 3,
  },
];

// ---------------------------------------------------------------- 1-4

const LEVEL_1_4_WAVES: WaveDef[] = [
  {
    id: 'w1',
    label: '风暴前锋',
    spawns: [
      { time: 0.8, kind: 'kamikaze', count: 6, interval: 0.5, side: 'random' },
    ],
    restAfter: 2.2,
  },
  {
    id: 'w2',
    label: '高速涡旋',
    spawns: [
      { time: 0.5, kind: 'scout', count: 5, interval: 0.4, side: 'left', vx: 9, z: -28 },
      { time: 1.4, kind: 'scout', count: 5, interval: 0.4, side: 'right', vx: -9, z: -28 },
      { time: 2.8, kind: 'grunt', count: 4, interval: 0.5, side: 'spread' },
    ],
    restAfter: 2.5,
  },
  {
    id: 'w3',
    label: '核心护卫',
    spawns: [
      { time: 0.7, kind: 'heavy', count: 2, interval: 1.3, side: 'spread', hoverZ: -2 },
      { time: 2, kind: 'elite', count: 1, interval: 0, side: 'center', hoverZ: 0 },
      { time: 3.6, kind: 'grunt', count: 4, interval: 0.5, side: 'spread' },
    ],
    restAfter: 2.8,
  },
  {
    id: 'w4',
    label: '双精锐',
    spawns: [
      { time: 0.6, kind: 'elite', count: 2, interval: 1.5, side: 'spread', hoverZ: 1 },
      { time: 2.4, kind: 'scout', count: 6, interval: 0.35, side: 'random' },
    ],
    restAfter: 3,
  },
];

// ---------------------------------------------------------------- 1-5

const LEVEL_1_5_WAVES: WaveDef[] = [
  {
    id: 'w1',
    label: '终局编队',
    spawns: [
      { time: 0.8, kind: 'grunt', count: 5, interval: 0.5, side: 'spread' },
      { time: 2.4, kind: 'scout', count: 4, interval: 0.4, side: 'left', vx: 8, z: -26 },
      { time: 3.4, kind: 'scout', count: 4, interval: 0.4, side: 'right', vx: -8, z: -26 },
    ],
    restAfter: 2.2,
  },
  {
    id: 'w2',
    label: '装甲梯队',
    spawns: [
      { time: 0.7, kind: 'heavy', count: 3, interval: 1.2, side: 'spread', hoverZ: -2 },
      { time: 3, kind: 'kamikaze', count: 4, interval: 0.5, side: 'random' },
    ],
    restAfter: 2.5,
  },
  {
    id: 'w3',
    label: '自爆洪流',
    spawns: [{ time: 0.6, kind: 'kamikaze', count: 8, interval: 0.42, side: 'random' }],
    restAfter: 2.4,
  },
  {
    id: 'w4',
    label: '精锐卫队',
    spawns: [
      { time: 0.6, kind: 'elite', count: 2, interval: 1.4, side: 'spread', hoverZ: 1 },
      { time: 2.2, kind: 'heavy', count: 2, interval: 1.2, side: 'center', hoverZ: -3 },
    ],
    restAfter: 2.6,
  },
  {
    id: 'w5',
    label: '总力战',
    spawns: [
      { time: 0.6, kind: 'grunt', count: 5, interval: 0.45, side: 'spread' },
      { time: 2, kind: 'scout', count: 5, interval: 0.35, side: 'random' },
      { time: 3.4, kind: 'kamikaze', count: 5, interval: 0.45, side: 'random' },
      { time: 4.8, kind: 'elite', count: 1, interval: 0, side: 'center', hoverZ: 0 },
    ],
    restAfter: 3.2,
  },
];

// ---------------------------------------------------------------- 2-1

const LEVEL_2_1_WAVES: WaveDef[] = [
  {
    id: 'w1',
    label: '深空前哨',
    spawns: [
      { time: 0.8, kind: 'grunt', count: 5, interval: 0.5, side: 'spread' },
      { time: 2.4, kind: 'laser', count: 2, interval: 1.1, side: 'spread', hoverZ: -8 },
    ],
    restAfter: 2.4,
  },
  {
    id: 'w2',
    label: '交叉光栅',
    spawns: [
      { time: 0.6, kind: 'scout', count: 4, interval: 0.4, side: 'left', vx: 8.5, z: -28 },
      { time: 1.7, kind: 'scout', count: 4, interval: 0.4, side: 'right', vx: -8.5, z: -28 },
      { time: 3, kind: 'laser', count: 1, interval: 0, side: 'center', hoverZ: -4 },
    ],
    restAfter: 2.6,
  },
  {
    id: 'w3',
    label: '装甲推进',
    spawns: [
      { time: 0.8, kind: 'heavy', count: 2, interval: 1.3, side: 'spread', hoverZ: -2 },
      { time: 2.6, kind: 'laser', count: 2, interval: 1, side: 'spread', hoverZ: -10 },
    ],
    restAfter: 2.8,
  },
  {
    id: 'w4',
    label: '护盾先导',
    spawns: [
      { time: 0.7, kind: 'bulwark', count: 1, interval: 0, side: 'center', hoverZ: 0 },
      { time: 2.4, kind: 'grunt', count: 4, interval: 0.5, side: 'spread' },
    ],
    restAfter: 3,
  },
];

// ---------------------------------------------------------------- 2-2

const LEVEL_2_2_WAVES: WaveDef[] = [
  {
    id: 'w1',
    label: '碎石伏击',
    spawns: [
      { time: 0.6, kind: 'kamikaze', count: 6, interval: 0.5, side: 'random' },
      { time: 2.4, kind: 'laser', count: 2, interval: 1.2, side: 'spread', hoverZ: -9 },
    ],
    restAfter: 2.3,
  },
  {
    id: 'w2',
    label: '高速切割',
    spawns: [
      { time: 0.5, kind: 'scout', count: 5, interval: 0.36, side: 'left', vx: 9, z: -28 },
      { time: 1.5, kind: 'scout', count: 5, interval: 0.36, side: 'right', vx: -9, z: -28 },
    ],
    restAfter: 2.5,
  },
  {
    id: 'w3',
    label: '护盾护航',
    spawns: [
      { time: 0.7, kind: 'bulwark', count: 1, interval: 0, side: 'left', hoverZ: 1 },
      { time: 2, kind: 'heavy', count: 2, interval: 1.2, side: 'center', hoverZ: -3 },
      { time: 3.4, kind: 'laser', count: 1, interval: 0, side: 'right', hoverZ: -6 },
    ],
    restAfter: 2.8,
  },
  {
    id: 'w4',
    label: '精锐清除',
    spawns: [
      { time: 0.6, kind: 'elite', count: 2, interval: 1.4, side: 'spread', hoverZ: 1 },
      { time: 2.6, kind: 'kamikaze', count: 5, interval: 0.55, side: 'random' },
    ],
    restAfter: 3,
  },
];

// ---------------------------------------------------------------- 2-3

const LEVEL_2_3_WAVES: WaveDef[] = [
  {
    id: 'w1',
    label: '激光阵列',
    spawns: [{ time: 0.8, kind: 'laser', count: 3, interval: 0.9, side: 'spread', hoverZ: -5 }],
    restAfter: 2.4,
  },
  {
    id: 'w2',
    label: '穿光突袭',
    spawns: [
      { time: 0.6, kind: 'scout', count: 6, interval: 0.32, side: 'random' },
      { time: 2.2, kind: 'laser', count: 2, interval: 1, side: 'spread', hoverZ: -11 },
    ],
    restAfter: 2.6,
  },
  {
    id: 'w3',
    label: '双盾推进',
    spawns: [
      { time: 0.8, kind: 'bulwark', count: 2, interval: 1.6, side: 'spread', hoverZ: 0 },
      { time: 3, kind: 'grunt', count: 5, interval: 0.45, side: 'spread' },
    ],
    restAfter: 2.8,
  },
  {
    id: 'w4',
    label: '自爆洪流',
    spawns: [
      { time: 0.5, kind: 'kamikaze', count: 8, interval: 0.4, side: 'random' },
      { time: 3, kind: 'laser', count: 1, interval: 0, side: 'center', hoverZ: -7 },
    ],
    restAfter: 3,
  },
];

// ---------------------------------------------------------------- 2-4

const LEVEL_2_4_WAVES: WaveDef[] = [
  {
    id: 'w1',
    label: '盾舰旗舰',
    spawns: [
      { time: 0.7, kind: 'bulwark', count: 1, interval: 0, side: 'center', hoverZ: -1 },
      { time: 2, kind: 'heavy', count: 2, interval: 1.2, side: 'spread', hoverZ: -3 },
    ],
    restAfter: 2.4,
  },
  {
    id: 'w2',
    label: '光栅封锁',
    spawns: [
      { time: 0.6, kind: 'laser', count: 3, interval: 0.8, side: 'spread', hoverZ: -8 },
      { time: 2.4, kind: 'scout', count: 6, interval: 0.34, side: 'random' },
    ],
    restAfter: 2.6,
  },
  {
    id: 'w3',
    label: '双盾交叉',
    spawns: [
      { time: 0.7, kind: 'bulwark', count: 2, interval: 1.5, side: 'spread', hoverZ: 1 },
      { time: 2.8, kind: 'elite', count: 1, interval: 0, side: 'center', hoverZ: 0 },
    ],
    restAfter: 2.8,
  },
  {
    id: 'w4',
    label: '风暴终波',
    spawns: [
      { time: 0.5, kind: 'kamikaze', count: 7, interval: 0.45, side: 'random' },
      { time: 2.4, kind: 'grunt', count: 5, interval: 0.45, side: 'spread' },
      { time: 3.8, kind: 'laser', count: 2, interval: 1, side: 'spread', hoverZ: -10 },
    ],
    restAfter: 3.1,
  },
];

// ---------------------------------------------------------------- 2-5

const LEVEL_2_5_WAVES: WaveDef[] = [
  {
    id: 'w1',
    label: '回廊前锋',
    spawns: [
      { time: 0.6, kind: 'grunt', count: 6, interval: 0.42, side: 'spread' },
      { time: 2.2, kind: 'scout', count: 5, interval: 0.34, side: 'random' },
    ],
    restAfter: 2.2,
  },
  {
    id: 'w2',
    label: '塔阵压制',
    spawns: [
      { time: 0.7, kind: 'laser', count: 3, interval: 0.85, side: 'spread', hoverZ: -6 },
      { time: 2.6, kind: 'heavy', count: 3, interval: 1.1, side: 'spread', hoverZ: -2 },
    ],
    restAfter: 2.5,
  },
  {
    id: 'w3',
    label: '盾舰编队',
    spawns: [
      { time: 0.6, kind: 'bulwark', count: 2, interval: 1.5, side: 'spread', hoverZ: 0 },
      { time: 2.6, kind: 'kamikaze', count: 6, interval: 0.45, side: 'random' },
    ],
    restAfter: 2.6,
  },
  {
    id: 'w4',
    label: '精锐光栅',
    spawns: [
      { time: 0.6, kind: 'elite', count: 2, interval: 1.3, side: 'spread', hoverZ: 1 },
      { time: 2.2, kind: 'laser', count: 2, interval: 1, side: 'spread', hoverZ: -9 },
      { time: 3.6, kind: 'scout', count: 6, interval: 0.32, side: 'random' },
    ],
    restAfter: 2.8,
  },
  {
    id: 'w5',
    label: '深空总力战',
    spawns: [
      { time: 0.5, kind: 'bulwark', count: 1, interval: 0, side: 'center', hoverZ: -1 },
      { time: 1.8, kind: 'heavy', count: 2, interval: 1.1, side: 'spread', hoverZ: -3 },
      { time: 3.2, kind: 'grunt', count: 5, interval: 0.4, side: 'spread' },
      { time: 4.6, kind: 'kamikaze', count: 5, interval: 0.42, side: 'random' },
    ],
    restAfter: 3.2,
  },
];

/** 章节标题（任务列表按章节分组显示） */
export const CHAPTERS: { id: number; name: string }[] = [
  { id: 1, name: '第一章 · 星链战线' },
  { id: 2, name: '第二章 · 深空回廊' },
];

/** 关卡所属章节（编号首段即章节号） */
export function chapterOf(levelId: string): number {
  return Number(levelId.split('-')[0]) || 1;
}

/** 全部关卡 */
export const LEVELS: LevelDef[] = [
  {
    id: '1-1',
    name: '太空战场',
    label: '1-1 太空战场',
    brief: '常规巡逻遭遇战，适合熟悉操作',
    waves: LEVEL_1_1_WAVES,
    boss: {
      id: 'abyss',
      name: '「深渊」级母舰',
      maxHp: 4200,
      turretHp: 520,
      intervalMul: 1,
      speedMul: 1,
      damageMul: 1,
      hull: 0x39415c,
      plate: 0x1d2233,
      core: 0xff4d6a,
      glow: 0x59d0ff,
      phaseColors: [0xff4d6a, 0xff8a3d, 0xff2d2d],
    },
    env: { bg: 0x05060f, fog: 0x05060f, star: 0xbcd0ff, starSpeedMul: 1 },
    clearBonus: 3000,
  },
  {
    id: '1-2',
    name: '小行星带',
    label: '1-2 小行星带',
    brief: '高速侦察机在碎石间穿梭突袭',
    waves: LEVEL_1_2_WAVES,
    boss: {
      id: 'blade',
      name: '「赤刃」突击舰',
      maxHp: 5400,
      turretHp: 620,
      intervalMul: 0.86,
      speedMul: 1.12,
      damageMul: 1.05,
      hull: 0x5c3a34,
      plate: 0x2b1a18,
      core: 0xffb14d,
      glow: 0xffd166,
      phaseColors: [0xffb14d, 0xff7a3d, 0xff2d2d],
    },
    env: { bg: 0x0d0710, fog: 0x130a10, star: 0xffd9b0, starSpeedMul: 1.25 },
    clearBonus: 4500,
  },
  {
    id: '1-3',
    name: '要塞防线',
    label: '1-3 要塞防线',
    brief: '重装甲编队与双精锐拦截',
    waves: LEVEL_1_3_WAVES,
    boss: {
      id: 'bulwark',
      name: '「铁壁」要塞舰',
      maxHp: 6600,
      turretHp: 760,
      intervalMul: 0.9,
      speedMul: 1.05,
      damageMul: 1.15,
      hull: 0x33455c,
      plate: 0x18222e,
      core: 0x6fd6ff,
      glow: 0x9be7ff,
      phaseColors: [0x6fd6ff, 0x4aa8ff, 0x2a7bff],
    },
    env: { bg: 0x061019, fog: 0x081520, star: 0xcfe6ff, starSpeedMul: 1.1 },
    clearBonus: 6000,
  },
  {
    id: '1-4',
    name: '陨石风暴',
    label: '1-4 陨石风暴',
    brief: '自爆机群与高速涡旋夹击',
    waves: LEVEL_1_4_WAVES,
    boss: {
      id: 'phantom',
      name: '「幽影」隐形舰',
      maxHp: 7400,
      turretHp: 820,
      intervalMul: 0.78,
      speedMul: 1.18,
      damageMul: 1.2,
      hull: 0x41356b,
      plate: 0x201a38,
      core: 0xc0a8ff,
      glow: 0xd7c4ff,
      phaseColors: [0xc0a8ff, 0xa06bff, 0xff5cf0],
    },
    env: { bg: 0x0a0718, fog: 0x100a22, star: 0xe0d0ff, starSpeedMul: 1.4 },
    clearBonus: 7500,
  },
  {
    id: '1-5',
    name: '旗舰终局',
    label: '1-5 旗舰终局',
    brief: '全类型混编总力战，敌方旗舰坐镇',
    waves: LEVEL_1_5_WAVES,
    boss: {
      id: 'omega',
      name: '「终焉」旗舰',
      maxHp: 9200,
      turretHp: 980,
      intervalMul: 0.7,
      speedMul: 1.22,
      damageMul: 1.28,
      hull: 0x4a3550,
      plate: 0x241a2c,
      core: 0xff4d6a,
      glow: 0xff9bb0,
      phaseColors: [0xff4d6a, 0xff8a3d, 0xff2020],
    },
    env: { bg: 0x0b0408, fog: 0x140610, star: 0xffc0d0, starSpeedMul: 1.55 },
    clearBonus: 10000,
  },
  {
    id: '2-1',
    name: '深空前哨',
    label: '2-1 深空前哨',
    brief: '激光塔登场：光束充能时横向躲避',
    waves: LEVEL_2_1_WAVES,
    boss: {
      id: 'sentinel',
      name: '「哨戒」要塞舰',
      maxHp: 11000,
      turretHp: 1150,
      intervalMul: 0.66,
      speedMul: 1.24,
      damageMul: 1.32,
      hull: 0x2f4a5c,
      plate: 0x16232e,
      core: 0x7cf0ff,
      glow: 0x9be7ff,
      phaseColors: [0x7cf0ff, 0x4ad8ff, 0x2a7bff],
    },
    env: { bg: 0x04101a, fog: 0x061626, star: 0xb0f0ff, starSpeedMul: 1.6 },
    clearBonus: 13000,
  },
  {
    id: '2-2',
    name: '破碎回廊',
    label: '2-2 破碎回廊',
    brief: '自爆机群与高速侦察机夹击',
    waves: LEVEL_2_2_WAVES,
    boss: {
      id: 'vortex',
      name: '「涡旋」母舰',
      maxHp: 12500,
      turretHp: 1250,
      intervalMul: 0.63,
      speedMul: 1.28,
      damageMul: 1.36,
      hull: 0x3a3350,
      plate: 0x1c1830,
      core: 0xb0ff9b,
      glow: 0x9bf0c8,
      phaseColors: [0xb0ff9b, 0x5ce0a0, 0x2ad0ff],
    },
    env: { bg: 0x08100c, fog: 0x0c1a12, star: 0xd0ffd8, starSpeedMul: 1.7 },
    clearBonus: 15000,
  },
  {
    id: '2-3',
    name: '光栅矩阵',
    label: '2-3 光栅矩阵',
    brief: '密集激光阵列封锁航道',
    waves: LEVEL_2_3_WAVES,
    boss: {
      id: 'nemesis',
      name: '「复仇」级战舰',
      maxHp: 14000,
      turretHp: 1350,
      intervalMul: 0.6,
      speedMul: 1.3,
      damageMul: 1.4,
      hull: 0x54304a,
      plate: 0x2a1626,
      core: 0xff7ac0,
      glow: 0xff9bd6,
      phaseColors: [0xff7ac0, 0xff4d8a, 0xff2d2d],
    },
    env: { bg: 0x120414, fog: 0x1a0820, star: 0xffc8f0, starSpeedMul: 1.8 },
    clearBonus: 17500,
  },
  {
    id: '2-4',
    name: '盾舰舰队',
    label: '2-4 盾舰舰队',
    brief: '护盾舰成群，先破盾再输出',
    waves: LEVEL_2_4_WAVES,
    boss: {
      id: 'eclipse',
      name: '「蚀月」旗舰',
      maxHp: 15500,
      turretHp: 1450,
      intervalMul: 0.57,
      speedMul: 1.34,
      damageMul: 1.45,
      hull: 0x2c3450,
      plate: 0x141a2c,
      core: 0xc0d8ff,
      glow: 0x8fb6ff,
      phaseColors: [0xc0d8ff, 0x7ea8ff, 0xa06bff],
    },
    env: { bg: 0x050a18, fog: 0x081026, star: 0xc8dcff, starSpeedMul: 1.9 },
    clearBonus: 20000,
  },
  {
    id: '2-5',
    name: '深空终局',
    label: '2-5 深空终局',
    brief: '全类型混编总力战，敌方核心坐镇',
    waves: LEVEL_2_5_WAVES,
    boss: {
      id: 'genesis',
      name: '「起源」核心',
      maxHp: 18000,
      turretHp: 1550,
      intervalMul: 0.52,
      speedMul: 1.38,
      damageMul: 1.5,
      hull: 0x4a2f3c,
      plate: 0x241620,
      core: 0xffd166,
      glow: 0xffb14d,
      phaseColors: [0xffd166, 0xff8a3d, 0xff2d2d],
    },
    env: { bg: 0x0d0508, fog: 0x160812, star: 0xffd8b0, starSpeedMul: 2.1 },
    clearBonus: 25000,
  },
];

/** 按编号取关卡（找不到时回退到 1-1） */
export function levelById(id: string): LevelDef {
  return LEVELS.find((level) => level.id === id) ?? LEVELS[0];
}

/** 关卡在列表中的序号（0 起） */
export function levelIndex(id: string): number {
  return Math.max(0, LEVELS.findIndex((level) => level.id === id));
}
