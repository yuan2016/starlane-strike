import * as THREE from 'three';
import { BATTLE_FIELD } from '../config';
import type { BulletSystem } from '../combat/BulletSystem';

export type TargetProvider = (position: THREE.Vector3) => THREE.Vector3 | null;

interface Wingman {
  mesh: THREE.Mesh;
  muzzle: THREE.Object3D;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  cooldown: number;
  side: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);
const OFFSET = new THREE.Vector3();
const DESIRED = new THREE.Vector3();
const TMP = new THREE.Vector3();
const AIM = new THREE.Vector3();

/**
 * 僚机系统：两架跟随无人机，分列玩家左右后方，自动索敌并射击。
 * 伤害 / 射速 / 暴击继承玩家当前的强化倍率。
 */
export class WingmanSystem {
  readonly group = new THREE.Group();

  private readonly wingmen: Wingman[] = [];
  private damageMul = 1;
  private fireRateMul = 1;
  private critRate = 0;

  constructor() {
    const geo = new THREE.ConeGeometry(0.34, 1.05, 8);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4a86c8,
      emissive: 0x6fe8ff,
      emissiveIntensity: 1.25,
      metalness: 0.72,
      roughness: 0.32,
      envMapIntensity: 1.2,
    });

    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `wingman:${side}`;
      this.group.add(mesh);

      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0, -0.65);
      mesh.add(muzzle);

      this.wingmen.push({
        mesh,
        muzzle,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        cooldown: 0,
        side,
      });
    }
  }

  setModifiers(damageMul: number, fireRateMul: number, critRate: number): void {
    this.damageMul = damageMul;
    this.fireRateMul = fireRateMul;
    this.critRate = critRate;
  }

  reset(playerPos?: THREE.Vector3): void {
    const base = playerPos ?? new THREE.Vector3();
    for (const w of this.wingmen) {
      w.position.set(base.x + w.side * 2.6, 0, base.z + 1.2);
      w.velocity.set(0, 0, 0);
      w.cooldown = 0;
      w.mesh.position.copy(w.position);
      w.mesh.visible = true;
    }
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    playerYaw: number,
    targetProvider: TargetProvider,
    bullets: BulletSystem,
  ): void {
    for (const w of this.wingmen) {
      // 期望位置：玩家侧后方，并随玩家偏航旋转
      OFFSET.set(w.side * 2.6, 0, 1.2);
      OFFSET.applyAxisAngle(UP, playerYaw);
      DESIRED.copy(playerPos).add(OFFSET);

      // 指数追随，带轻微滞后
      const k = 1 - Math.exp(-9 * dt);
      w.position.lerp(DESIRED, k);
      w.position.x = THREE.MathUtils.clamp(w.position.x, BATTLE_FIELD.minX + 0.8, BATTLE_FIELD.maxX - 0.8);
      w.position.z = THREE.MathUtils.clamp(w.position.z, BATTLE_FIELD.minZ + 0.8, BATTLE_FIELD.maxZ - 0.8);
      w.velocity.subVectors(DESIRED, w.position).multiplyScalar(5);
      w.mesh.position.copy(w.position);

      // 瞄准最近目标，没有目标时向前
      const target = targetProvider(w.position);
      let aim = FORWARD;
      if (target) {
        w.muzzle.getWorldPosition(TMP);
        const dx = target.x - TMP.x;
        const dz = target.z - TMP.z;
        const yaw = Math.atan2(dx, -dz);
        w.mesh.rotation.set(0, yaw, THREE.MathUtils.clamp(w.velocity.x * 0.25, -0.35, 0.35));
        aim = AIM.subVectors(target, TMP).normalize();
      } else {
        w.mesh.rotation.set(0, 0, THREE.MathUtils.clamp(w.velocity.x * 0.25, -0.35, 0.35));
      }

      // 射击
      w.cooldown -= dt;
      if (w.cooldown <= 0) {
        w.cooldown = 0.22 / Math.max(this.fireRateMul, 0.25);
        w.muzzle.getWorldPosition(TMP);
        bullets.spawn('player', TMP, aim, {
          speed: 34,
          damage: this.rollDamage(5),
          color: 0x6fe8ff,
          radius: 0.18,
          length: 0.75,
          life: 2.2,
          trailRate: 18,
        });
      }
    }
  }

  private rollDamage(base: number): number {
    const dmg = base * this.damageMul;
    return Math.random() < this.critRate ? dmg * 1.8 : dmg;
  }

  dispose(): void {
    if (this.wingmen.length > 0) {
      this.wingmen[0].mesh.geometry.dispose();
      (this.wingmen[0].mesh.material as THREE.Material).dispose();
    }
    this.group.clear();
  }
}
