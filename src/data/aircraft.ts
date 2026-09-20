export type AircraftId = 'falcon' | 'wasp' | 'bulwark';

export interface AircraftDef {
  id: AircraftId;
  name: string;
  desc: string;
  /** 解锁价格（0 表示初始拥有） */
  price: number;
  /** 基础生命 */
  hp: number;
  /** 基础护盾 */
  shield: number;
  /** 机动性：移动速度倍率 */
  speedMul: number;
  /** 火力倍率 */
  damageMul: number;
  /** 射速倍率 */
  fireRateMul: number;

  // —— 建模参数（供 PlayerAircraft 使用）——
  bodyColor: number;
  wingColor: number;
  canopyColor: number;
  flameColor: number;
  /** 半翼展（越大机体越宽） */
  wingSpan: number;
  engineCount: 1 | 2;
  /** 整体缩放 */
  scale: number;
  /** 外部模型 URL（GLB）；缺省用 PlayerAircraft 的默认机模型 */
  model?: string;
}

export const AIRCRAFT: Record<AircraftId, AircraftDef> = {
  falcon: {
    id: 'falcon',
    name: '银隼 F-01',
    desc: '标准型星际战机，火力与生存均衡，适合熟悉战场。',
    price: 0,
    hp: 120,
    shield: 60,
    speedMul: 1,
    damageMul: 1,
    fireRateMul: 1,
    bodyColor: 0x9fb2c8,
    wingColor: 0x54627a,
    canopyColor: 0x1b2f4a,
    flameColor: 0xffa23c,
    wingSpan: 1.75,
    engineCount: 2,
    scale: 1,
  },
  wasp: {
    id: 'wasp',
    name: '黄蜂 W-07',
    desc: '轻量化高机动机体，速度更快、射速更高，但装甲薄弱。',
    price: 1200,
    hp: 92,
    shield: 48,
    speedMul: 1.28,
    damageMul: 0.92,
    fireRateMul: 1.3,
    bodyColor: 0xc8d6a0,
    wingColor: 0x6d7f45,
    canopyColor: 0x2a3a1c,
    flameColor: 0x9ef0ff,
    wingSpan: 1.5,
    engineCount: 2,
    scale: 0.9,
  },
  bulwark: {
    id: 'bulwark',
    name: '壁垒 B-13',
    desc: '重装突击机体，装甲与护盾厚重、火力强，但转向笨重。',
    price: 2600,
    hp: 180,
    shield: 96,
    speedMul: 0.84,
    damageMul: 1.22,
    fireRateMul: 0.9,
    bodyColor: 0xb0a49a,
    wingColor: 0x5d5346,
    canopyColor: 0x35281f,
    flameColor: 0xff7a3c,
    wingSpan: 2.1,
    engineCount: 2,
    scale: 1.14,
  },
};

export const AIRCRAFT_LIST: AircraftDef[] = [AIRCRAFT.falcon, AIRCRAFT.wasp, AIRCRAFT.bulwark];
