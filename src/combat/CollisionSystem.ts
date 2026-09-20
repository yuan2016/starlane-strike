import * as THREE from 'three';

/**
 * 碰撞检测：战场是 2.5D，统一用"水平面圆 + 高度带"判定，
 * 比完整 3D 球体更快也更容易调参。
 */
export class CollisionSystem {
  private readonly dx = new THREE.Vector2();
  private readonly dz = new THREE.Vector2();

  /** 水平圆形碰撞（忽略 Y） */
  circleHit(ax: number, az: number, ar: number, bx: number, bz: number, br: number): boolean {
    const dx = ax - bx;
    const dz = az - bz;
    const r = ar + br;
    return dx * dx + dz * dz <= r * r;
  }

  /** 带高度容差的球体碰撞 */
  sphereHit(a: THREE.Vector3, ar: number, b: THREE.Vector3, br: number, yTolerance = 2.5): boolean {
    if (Math.abs(a.y - b.y) > yTolerance) return false;
    this.dx.set(a.x, a.z);
    this.dz.set(b.x, b.z);
    const r = ar + br;
    return this.dx.distanceToSquared(this.dz) <= r * r;
  }
}
