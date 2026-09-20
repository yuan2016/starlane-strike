import type { BossPreset } from '../data/levels';
import type { BossContext, BossPhase } from './Boss';
import { Boss } from './Boss';

/**
 * Boss 管理器：负责 Boss 的出场、更新与事件分发（供关卡与 UI 使用）。
 */
export class BossManager {
  readonly boss = new Boss();

  /** Boss 战开始 */
  onSpawned: (() => void) | null = null;
  /** 死亡演出结束 */
  onDefeated: (() => void) | null = null;
  /** 阶段切换（2 / 3） */
  onPhaseChange: ((phase: BossPhase) => void) | null = null;

  private started = false;

  constructor() {
    this.boss.onPhaseChange = (phase) => this.onPhaseChange?.(phase);
  }

  get active(): boolean {
    return this.boss.active;
  }

  get isBossFight(): boolean {
    return this.started && this.boss.active;
  }

  /** 指定本关 Boss 变体 */
  setPreset(preset: BossPreset): void {
    this.boss.configure(preset);
  }

  spawn(): void {
    this.started = true;
    this.boss.spawn();
    this.onSpawned?.();
  }

  update(dt: number, ctx: BossContext): void {
    const wasActive = this.boss.active;
    this.boss.update(dt, ctx);
    if (wasActive && !this.boss.active && this.started) {
      this.started = false;
      this.onDefeated?.();
    }
  }

  reset(): void {
    this.started = false;
    this.boss.active = false;
    this.boss.state = 'idle';
    this.boss.group.visible = false;
  }
}
