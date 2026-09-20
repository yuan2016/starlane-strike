import { BATTLE_FIELD } from '../config';
import type { WaveDef, SpawnSide } from '../data/levels';
import type { EnemyKind } from '../data/enemies';

export interface QueuedSpawn {
  time: number;
  kind: EnemyKind;
  x: number;
  z: number;
  vx?: number;
  hoverZ?: number;
}

function sideToX(side: SpawnSide, index: number, total: number): number {
  switch (side) {
    case 'left':
      return -10;
    case 'right':
      return 10;
    case 'center':
      return 0;
    case 'spread': {
      const span = total > 1 ? index / (total - 1) : 0.5;
      return -7.5 + span * 15;
    }
    case 'random':
    default:
      return (Math.random() * 2 - 1) * 8.5;
  }
}

/**
 * 波次调度：把关卡数据展开成带时间戳的生成队列，按 deltaTime 推进。
 * 敌机不是随机刷，而是按设计好的波次出场。
 */
export class WaveScheduler {
  private queue: QueuedSpawn[] = [];
  private time = 0;
  private index = 0;
  private waves: WaveDef[] = [];
  private waveIndex = -1;
  private restTimer = 0;

  get currentWaveIndex(): number {
    return this.waveIndex;
  }

  get totalWaves(): number {
    return this.waves.length;
  }

  /** 是否已释放完所有波次（不代表场上敌人清空） */
  get finished(): boolean {
    return this.waveIndex >= this.waves.length;
  }

  load(waves: WaveDef[]): void {
    this.waves = waves;
    this.queue = [];
    this.time = 0;
    this.index = 0;
    this.waveIndex = 0;
    this.restTimer = 0;
    this.enqueueWave(waves[0]);
  }

  private enqueueWave(wave: WaveDef | undefined): void {
    if (!wave) return;
    for (const entry of wave.spawns) {
      for (let i = 0; i < entry.count; i++) {
        this.queue.push({
          time: entry.time + i * entry.interval,
          kind: entry.kind,
          x: sideToX(entry.side, i, entry.count),
          z: entry.z ?? BATTLE_FIELD.spawnZ,
          vx: entry.vx,
          hoverZ: entry.hoverZ,
        });
      }
    }
    this.queue.sort((a, b) => a.time - b.time);
  }

  /** 推进调度，到点的敌人通过 spawn 回调产出 */
  update(dt: number, spawn: (req: QueuedSpawn) => void): void {
    if (this.finished) return;

    this.time += dt;
    while (this.index < this.queue.length && this.queue[this.index].time <= this.time) {
      spawn(this.queue[this.index]);
      this.index++;
    }

    if (this.index >= this.queue.length) {
      // 本波全部出场，等待缓冲后进入下一波
      this.restTimer += dt;
      const rest = this.waves[this.waveIndex]?.restAfter ?? 2;
      if (this.restTimer >= rest) {
        this.waveIndex++;
        this.restTimer = 0;
        this.time = 0;
        this.index = 0;
        this.queue = [];
        this.enqueueWave(this.waves[this.waveIndex]);
      }
    }
  }
}
