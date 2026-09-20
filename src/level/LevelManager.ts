import type { BossManager } from '../boss/BossManager';
import type { EnemyManager } from '../enemy/EnemyManager';
import type { WaveScheduler } from './Wave';
import type { WaveDef } from '../data/levels';

export type LevelState = 'waves' | 'bossWarning' | 'boss' | 'cleared';

interface LevelDeps {
  waves: WaveScheduler;
  enemies: EnemyManager;
  boss: BossManager;
}

/**
 * 关卡流程：波次 → Boss 预警 → Boss 战 → 通关。
 */
export class LevelManager {
  state: LevelState = 'waves';
  label = '';

  onWarning: (() => void) | null = null;
  onBossStart: (() => void) | null = null;
  onCleared: (() => void) | null = null;

  private warningTimer = 0;
  private readonly warningDuration = 2.6;

  constructor(private readonly deps: LevelDeps) {}

  start(waves: WaveDef[], label: string): void {
    this.label = label;
    this.state = 'waves';
    this.warningTimer = 0;
    this.deps.waves.load(waves);
    this.deps.boss.onDefeated = () => {
      this.state = 'cleared';
      this.onCleared?.();
    };
  }

  update(dt: number, spawn: (kind: Parameters<EnemyManager['spawn']>[0], req: { x: number; z: number; vx?: number; hoverZ?: number }) => void): void {
    switch (this.state) {
      case 'waves': {
        this.deps.waves.update(dt, (req) => spawn(req.kind, req));
        if (this.deps.waves.finished && this.deps.enemies.count === 0) {
          this.state = 'bossWarning';
          this.warningTimer = this.warningDuration;
          this.onWarning?.();
        }
        break;
      }
      case 'bossWarning': {
        this.warningTimer -= dt;
        if (this.warningTimer <= 0) {
          this.state = 'boss';
          this.deps.boss.spawn();
          this.onBossStart?.();
        }
        break;
      }
      case 'boss':
      case 'cleared':
        break;
    }
  }

  reset(): void {
    this.state = 'waves';
    this.warningTimer = 0;
    this.deps.boss.reset();
  }
}
