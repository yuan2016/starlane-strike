/**
 * 通用对象池：避免运行时频繁创建 / 销毁 Three.js 对象。
 */
export class ObjectPool<T> {
  private readonly free: T[] = [];
  private readonly active = new Set<T>();

  constructor(
    private readonly factory: () => T,
    private readonly onRelease?: (item: T) => void,
  ) {}

  acquire(): T {
    const item = this.free.pop() ?? this.factory();
    this.active.add(item);
    return item;
  }

  release(item: T): void {
    if (!this.active.delete(item)) return;
    this.onRelease?.(item);
    this.free.push(item);
  }

  releaseAll(): void {
    for (const item of this.active) {
      this.onRelease?.(item);
      this.free.push(item);
    }
    this.active.clear();
  }

  /** 遍历时允许安全地删除元素 */
  forEachActive(fn: (item: T) => void): void {
    for (const item of Array.from(this.active)) fn(item);
  }

  get activeCount(): number {
    return this.active.size;
  }

  get pooledCount(): number {
    return this.free.length;
  }
}
