import * as THREE from 'three';
import { BATTLE_FIELD } from '../config';
import { PICKUPS, type PickupKind } from '../data/pickups';

export type PickupHandler = (kind: PickupKind, value: number, position: THREE.Vector3) => void;

/** 被吸走的距离 */
const MAGNET_RADIUS = 8.5;
/** 基础漂移速度（与战场节奏一致，玩家在 +Z 方向） */
const DRIFT_SPEED = 4.2;
const PULL_ACCEL = 34;

interface Pickup {
  kind: PickupKind;
  value: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  mesh: THREE.Mesh;
  age: number;
  /** 摆动相位，避免所有道具同步晃动 */
  phase: number;
  active: boolean;
}

/** 各类道具共享的几何与材质： additive 自发光，在深色太空背景中更醒目 */
const GEOMETRY: Record<PickupKind, THREE.BufferGeometry> = {
  coin: new THREE.OctahedronGeometry(0.46, 0),
  power: new THREE.BoxGeometry(0.72, 0.72, 0.72),
  shield: new THREE.TorusGeometry(0.44, 0.17, 8, 14),
  heal: new THREE.SphereGeometry(0.48, 12, 10),
};

/** 掉落物：金属 + 自发光 + 环境反射，不再是纯色无光照的"贴图片" */
const MATERIAL: Record<PickupKind, THREE.MeshStandardMaterial> = (() => {
  const make = (kind: PickupKind) => {
    const color = PICKUPS[kind].color;
    return new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.35,
      metalness: 0.55,
      roughness: 0.28,
      envMapIntensity: 1.1,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  };
  return {
    coin: make('coin'),
    power: make('power'),
    shield: make('shield'),
    heal: make('heal'),
  };
})();

/**
 * 掉落物系统：敌机 / Boss 掉落的金币与强化道具。
 * 道具向玩家方向漂移，进入磁吸范围后加速飞向玩家，玩家靠近即拾取。
 * 全部实例池化复用，避免战斗中频繁创建对象。
 */
export class PickupSystem {
  readonly group = new THREE.Group();

  private readonly free: Pickup[] = [];
  private readonly active: Pickup[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(perKind = 32) {
    for (let i = 0; i < perKind * 4; i++) {
      this.free.push(this.create('coin'));
    }
  }

  private create(kind: PickupKind): Pickup {
    const mesh = new THREE.Mesh(GEOMETRY[kind], MATERIAL[kind]);
    mesh.visible = false;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return {
      kind,
      value: 1,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      mesh,
      age: 0,
      phase: 0,
      active: false,
    };
  }

  /** value：金币面额；对其它类型无意义 */
  spawn(kind: PickupKind, position: THREE.Vector3, value = 1, spread = 1.4): void {
    const item = this.free.pop();
    if (!item) return;

    item.kind = kind;
    item.value = value;
    item.age = 0;
    item.phase = Math.random() * Math.PI * 2;
    item.active = true;
    item.position.set(
      position.x + THREE.MathUtils.randFloatSpread(spread),
      0,
      position.z + THREE.MathUtils.randFloatSpread(spread * 0.8),
    );
    // 继承一点敌机的速度，落点更自然
    item.velocity.set(THREE.MathUtils.randFloatSpread(1.6), 0, DRIFT_SPEED);
    item.mesh.geometry = GEOMETRY[kind];
    item.mesh.material = MATERIAL[kind];
    item.mesh.position.copy(item.position);
    item.mesh.rotation.set(0, 0, 0);
    item.mesh.scale.setScalar(1);
    item.mesh.visible = true;
    this.active.push(item);
  }

  update(dt: number, playerPos: THREE.Vector3, onCollect: PickupHandler): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const item = this.active[i];
      item.age += dt;

      // 磁吸：靠近玩家后加速飞向玩家
      const dx = playerPos.x - item.position.x;
      const dz = playerPos.z - item.position.z;
      const dist = Math.hypot(dx, dz) || 1;
      if (dist < MAGNET_RADIUS) {
        const pull = 1 - dist / MAGNET_RADIUS;
        item.velocity.x += (dx / dist) * pull * PULL_ACCEL * dt;
        item.velocity.z += (dz / dist) * pull * PULL_ACCEL * dt;
      } else {
        // 远离玩家时缓慢回归基础漂移
        item.velocity.x *= 1 - Math.min(1, dt * 2);
        item.velocity.z += (DRIFT_SPEED - item.velocity.z) * Math.min(1, dt * 1.5);
      }

      item.position.addScaledVector(item.velocity, dt);
      item.position.x += Math.sin(item.age * 2.4 + item.phase) * 0.9 * dt;
      item.mesh.position.copy(item.position);

      // 旋转表现：金币翻滚，其余自转
      if (item.kind === 'coin') {
        item.mesh.rotation.y += dt * 5;
        item.mesh.rotation.z = Math.PI / 2;
      } else {
        item.mesh.rotation.y += dt * 2.2;
        item.mesh.rotation.x += dt * 1.1;
        item.mesh.scale.setScalar(1 + Math.sin(item.age * 5 + item.phase) * 0.08);
      }

      // 拾取
      if (dist < PICKUPS[item.kind].radius + 1) {
        onCollect(item.kind, item.value, this.tmp.copy(item.position));
        this.recycle(i);
        continue;
      }

      // 飞出战场
      if (item.position.z > BATTLE_FIELD.despawnZ) this.recycle(i);
    }
  }

  private recycle(index: number): void {
    const item = this.active[index];
    item.active = false;
    item.mesh.visible = false;
    this.active.splice(index, 1);
    this.free.push(item);
  }

  clear(): void {
    for (let i = this.active.length - 1; i >= 0; i--) this.recycle(i);
  }

  dispose(): void {
    this.clear();
    for (const geo of Object.values(GEOMETRY)) geo.dispose();
    for (const mat of Object.values(MATERIAL)) mat.dispose();
  }
}
