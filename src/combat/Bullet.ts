import * as THREE from 'three';

export type BulletOwner = 'player' | 'enemy';

export interface BulletSpawnOptions {
  speed: number;
  damage: number;
  color: THREE.ColorRepresentation;
  /** 碰撞半径 */
  radius?: number;
  /** 子弹长度倍率 */
  length?: number;
  life?: number;
  /** 每秒发射拖尾粒子的数量，0 关闭 */
  trailRate?: number;
  /** 追踪目标（导弹 / 追踪弹），缺省为直线 */
  homing?: THREE.Vector3 | null;
  homingStrength?: number;
}

const materialCache = new Map<number, THREE.MeshBasicMaterial>();

function getMaterial(color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
  const hex = new THREE.Color(color).getHex();
  let mat = materialCache.get(hex);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      color: hex,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    materialCache.set(hex, mat);
  }
  return mat;
}

const BULLET_GEOMETRY = (() => {
  const geo = new THREE.CapsuleGeometry(0.12, 0.9, 4, 8);
  // 让胶囊轴向与 +Z 对齐，配合 lookAt 使用
  geo.rotateX(Math.PI / 2);
  return geo;
})();

/**
 * 单发子弹。所有子弹共享几何与材质，实例只保存状态，便于池化复用。
 */
export class Bullet {
  readonly mesh: THREE.Mesh;
  readonly velocity = new THREE.Vector3();
  readonly position = new THREE.Vector3();
  readonly color = new THREE.Color();

  active = false;
  owner: BulletOwner = 'player';
  damage = 1;
  radius = 0.35;
  life = 0;
  maxLife = 3;
  trailRate = 0;
  trailTimer = 0;
  homingTarget: THREE.Vector3 | null = null;
  homingStrength = 0;

  constructor() {
    this.mesh = new THREE.Mesh(BULLET_GEOMETRY, getMaterial(0xffffff));
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  spawn(owner: BulletOwner, origin: THREE.Vector3, direction: THREE.Vector3, opts: BulletSpawnOptions): void {
    this.active = true;
    this.owner = owner;
    this.damage = opts.damage;
    this.radius = opts.radius ?? 0.35;
    this.life = opts.life ?? 4;
    this.maxLife = this.life;
    this.trailRate = opts.trailRate ?? 26;
    this.trailTimer = 0;
    this.homingTarget = opts.homing ?? null;
    this.homingStrength = opts.homingStrength ?? 0;
    this.color.set(opts.color);

    this.position.copy(origin);
    this.velocity.copy(direction).normalize().multiplyScalar(opts.speed);
    this.mesh.position.copy(origin);
    this.mesh.lookAt(origin.clone().add(direction));
    this.mesh.scale.set(1, 1, opts.length ?? 1);
    this.mesh.material = getMaterial(opts.color);
    this.mesh.visible = true;
  }

  deactivate(): void {
    this.active = false;
    this.homingTarget = null;
    this.mesh.visible = false;
  }
}

export function disposeBulletMaterials(): void {
  for (const mat of materialCache.values()) mat.dispose();
  materialCache.clear();
}
