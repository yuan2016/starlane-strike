/** 关卡内掉落物类型 */
export type PickupKind = 'coin' | 'power' | 'shield' | 'heal';

export interface PickupDef {
  kind: PickupKind;
  name: string;
  /** 外观颜色（同时用作拾取特效） */
  color: number;
  /** 拾取半径 */
  radius: number;
}

export const PICKUPS: Record<PickupKind, PickupDef> = {
  coin: { kind: 'coin', name: '金币', color: 0xffd166, radius: 1.35 },
  power: { kind: 'power', name: '火力强化', color: 0xff6b8a, radius: 1.5 },
  shield: { kind: 'shield', name: '护盾修复', color: 0x6fd6ff, radius: 1.5 },
  heal: { kind: 'heal', name: '机体修理', color: 0x7ef2c8, radius: 1.5 },
};

/** 拾取效果数值 */
export const PICKUP_EFFECT = {
  /** 护盾修复量 */
  shield: 34,
  /** 机体修理量 */
  heal: 30,
  /** 火力已满时一枚 P 折算的金币 */
  powerToCoin: 40,
};
