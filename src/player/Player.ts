import * as THREE from 'three';
import { BATTLE_FIELD, PLAYER_TUNING } from '../config';
import type { InputManager } from '../core/InputManager';
import { AIRCRAFT, type AircraftDef } from '../data/aircraft';
import { PlayerAircraft } from './PlayerAircraft';

/**
 * 玩家战机：位置驱动（键盘 + 指针拖动）、惯性追随、姿态倾斜与边界限制。
 * object 是固定容器，切换机体时只替换内部模型，避免重建场景节点。
 */
export class Player {
  readonly object = new THREE.Group();

  private aircraft: PlayerAircraft;
  private speedMul = 1;

  /** 输入目标点（飞机追随它，产生惯性） */
  private readonly target = new THREE.Vector3(0, 0, 6);
  private readonly position = new THREE.Vector3(0, 0, 6);
  private readonly velocity = new THREE.Vector3();

  private roll = 0;
  private pitch = 0;
  private yaw = 0;
  private bobTime = 0;

  constructor(def: AircraftDef = AIRCRAFT.falcon) {
    this.aircraft = new PlayerAircraft(def);
    this.object.add(this.aircraft.group);
    this.speedMul = def.speedMul;
    this.object.position.copy(this.position);
  }

  get muzzles(): THREE.Object3D[] {
    return this.aircraft.muzzles;
  }

  get worldPosition(): THREE.Vector3 {
    return this.position;
  }

  /** 键盘操控速度（受机体机动性影响） */
  private get keySpeed(): number {
    return PLAYER_TUNING.keySpeed * this.speedMul;
  }

  /** 单位速度方向（用于射击/朝向计算） */
  get normalizedSpeed(): number {
    return Math.min(this.velocity.length() / this.keySpeed, 1);
  }

  /** 换机体：销毁旧模型并挂载新模型 */
  setAircraft(def: AircraftDef): void {
    this.object.remove(this.aircraft.group);
    this.aircraft.dispose();
    this.aircraft = new PlayerAircraft(def);
    this.object.add(this.aircraft.group);
    this.speedMul = def.speedMul;
  }

  update(dt: number, input: InputManager, pointerScale: number): void {
    // 1. 键盘推进目标点
    const axis = input.axis;
    const speed = this.keySpeed;
    if (axis.x !== 0 || axis.z !== 0) {
      this.target.x += axis.x * speed * dt;
      this.target.z += axis.z * speed * dt;
    }

    // 2. 指针 / 触摸拖动：相对位移，屏幕 Y 向下对应世界 +Z
    const delta = input.consumePointerDelta();
    if (delta.x !== 0 || delta.y !== 0) {
      this.target.x += delta.x * pointerScale;
      this.target.z += delta.y * pointerScale;
    }

    // 3. 边界收敛
    this.target.x = THREE.MathUtils.clamp(this.target.x, BATTLE_FIELD.minX, BATTLE_FIELD.maxX);
    this.target.z = THREE.MathUtils.clamp(this.target.z, BATTLE_FIELD.minZ, BATTLE_FIELD.maxZ);

    // 4. 指数追随：产生平滑的启动 / 刹车惯性
    const k = 1 - Math.exp(-PLAYER_TUNING.followStiffness * dt);
    const prevX = this.position.x;
    const prevZ = this.position.z;
    this.position.x += (this.target.x - this.position.x) * k;
    this.position.z += (this.target.z - this.position.z) * k;
    if (dt > 0) {
      this.velocity.set((this.position.x - prevX) / dt, 0, (this.position.z - prevZ) / dt);
    }

    // 5. 姿态：横滚 / 俯仰 / 偏航，停止后自动回正
    const vx = THREE.MathUtils.clamp(this.velocity.x / speed, -1, 1);
    const vz = THREE.MathUtils.clamp(this.velocity.z / speed, -1, 1);
    const tk = 1 - Math.exp(-PLAYER_TUNING.tiltStiffness * dt);
    this.roll += (-vx * PLAYER_TUNING.maxRoll - this.roll) * tk;
    this.pitch += (vz * PLAYER_TUNING.maxPitch - this.pitch) * tk;
    this.yaw += (-vx * 0.14 - this.yaw) * tk;

    // 6. 应用到模型（叠加轻微浮动，避免完全僵硬）
    this.bobTime += dt;
    this.object.position.set(
      this.position.x,
      Math.sin(this.bobTime * 1.7) * 0.07,
      this.position.z,
    );
    this.object.rotation.set(this.pitch, this.yaw, this.roll);

    this.aircraft.update(dt, 1 + Math.abs(vz) * 0.4);
  }

  /** 受击 / 复活时的位置重置 */
  reset(): void {
    this.target.set(0, 0, 6);
    this.position.set(0, 0, 6);
    this.velocity.set(0, 0, 0);
    this.roll = 0;
    this.pitch = 0;
    this.yaw = 0;
  }

  dispose(): void {
    this.aircraft.dispose();
  }
}
