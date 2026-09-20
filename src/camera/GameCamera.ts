import * as THREE from 'three';

/**
 * 第三人称固定视角：从飞机后上方俯视战场，保留明显透视与立体感。
 * 附带轻微镜头震动（受击 / 爆炸时调用 shake）。
 */
export class GameCamera {
  readonly camera: THREE.PerspectiveCamera;

  private readonly basePosition = new THREE.Vector3(0, 15.5, 20);
  private readonly lookTarget = new THREE.Vector3(0, 0, -4);
  private readonly shakeOffset = new THREE.Vector3();
  private shakeIntensity = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(52, aspect, 0.1, 400);
    this.camera.position.copy(this.basePosition);
    this.camera.lookAt(this.lookTarget);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** 触发一次震动，intensity 约 0.05 ~ 0.6 */
  shake(intensity: number): void {
    this.shakeIntensity = Math.min(this.shakeIntensity + intensity, 1.2);
  }

  update(dt: number): void {
    if (this.shakeIntensity > 0.0001) {
      const i = this.shakeIntensity;
      this.shakeOffset.set(
        (Math.random() * 2 - 1) * i,
        (Math.random() * 2 - 1) * i * 0.7,
        (Math.random() * 2 - 1) * i * 0.5,
      );
      // 指数衰减，约 0.35 秒内收敛
      this.shakeIntensity *= Math.exp(-dt * 9);
    } else {
      this.shakeIntensity = 0;
      this.shakeOffset.set(0, 0, 0);
    }

    this.camera.position.copy(this.basePosition).add(this.shakeOffset);
    this.camera.lookAt(this.lookTarget);
  }
}
