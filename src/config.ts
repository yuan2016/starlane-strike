/**
 * 全局可调参数：战场边界、玩家手感、渲染基准。
 * 世界坐标约定：
 *   X = 左右（右为正）
 *   Y = 高度（上为正，战斗主平面 Y≈0）
 *   Z = 前后（屏幕下方为正，敌机从 -Z 远处向 +Z 推进）
 */

export const BATTLE_FIELD = {
  minX: -11,
  maxX: 11,
  minZ: -6,
  maxZ: 9,
  /** 敌机 / 场景元素的生成线 */
  spawnZ: -46,
  /** 越过这条线的对象回收 */
  despawnZ: 18,
} as const;

export const PLAYER_TUNING = {
  /** 键盘操控速度（单位/秒） */
  keySpeed: 17,
  /** 位置追随目标点的刚度，越小越"飘"（惯性感） */
  followStiffness: 9,
  /** 最大倾角（弧度） */
  maxRoll: 0.62,
  maxPitch: 0.26,
  /** 姿态回归速度 */
  tiltStiffness: 8,
} as const;

/**
 * 渲染基准：high 档直接使用这里的数值，medium 档在其基础上按比例下调
 * （见 `src/render/Quality.ts` 的 PRESETS）。改这里即可同时影响两个档位。
 */
export const RENDER = {
  /** 单帧最大 dt，防止切后台回来后跳帧穿模 */
  maxDelta: 1 / 20,
  /** 设备像素比上限（high 档基准；medium 档为 1.5，运行时还会按帧率自适应下调） */
  pixelRatioCap: 2,
  /** MSAA 采样数（high 档基准，受 `WebGLRenderer.capabilities.maxSamples` 限制） */
  msaa: 4,
  /** UnrealBloom：只让灯带 / 引擎 / 弹幕 / 爆炸发光，阈值偏高避免整块模型糊成白光 */
  bloom: {
    strength: 0.62,
    radius: 0.62,
    /** 亮度阈值，低于该值的内容不参与泛光 */
    threshold: 0.78,
  },
} as const;
