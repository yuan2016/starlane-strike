/**
 * 固定 requestAnimationFrame 主循环，统一提供 deltaTime。
 * 暂停时不再驱动 update，仅停止逻辑计算（渲染交由外部决定是否继续）。
 */
export class GameLoop {
  private rafId = 0;
  private lastTime = 0;
  private running = false;
  private paused = false;

  constructor(
    private readonly update: (dt: number, elapsed: number) => void,
    private readonly render: () => void,
    private readonly maxDelta = 1 / 20,
  ) {}

  get isPaused(): boolean {
    return this.paused;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused) this.lastTime = performance.now();
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    const raw = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (this.paused) return;

    const dt = Math.min(raw, this.maxDelta);
    const elapsed = now / 1000;
    this.update(dt, elapsed);
    this.render();
  };
}
