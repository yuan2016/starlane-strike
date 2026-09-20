import * as THREE from 'three';

export interface EmitOptions {
  position: THREE.Vector3;
  count: number;
  color: THREE.ColorRepresentation;
  /** 初速度大小 */
  speed?: number;
  /** 速度随机扩散比例 0~1 */
  spread?: number;
  /** 基础方向，缺省为全向 */
  direction?: THREE.Vector3;
  size?: number;
  life?: number;
  /** 每秒速度衰减比例 */
  drag?: number;
  /** 沿 Y 的加速度（负值模拟下坠） */
  gravity?: number;
}

/**
 * GPU 友好的单点粒子系统：一个 Points + 自定义 Shader，支持按粒子控制颜色 / 大小 / 透明度。
 * 内部使用 SoA 存储与 swap-remove 压缩，避免运行时分配对象。
 */
export class ParticleSystem {
  readonly points: THREE.Points;

  private readonly capacity: number;
  private aliveCount = 0;

  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly drag: Float32Array;
  private readonly gravity: Float32Array;

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly tmpColor = new THREE.Color();

  constructor(capacity = 2400) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geometry.setDrawRange(0, 0);
    // 手动包围球，避免每帧重算导致粒子被误裁剪
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: window.innerHeight * 0.6 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (uScale / max(-mv.z, 0.001));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;
          float falloff = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor, falloff * falloff * vAlpha);
        }
      `,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.name = 'ParticleSystem';
  }

  emit(options: EmitOptions): void {
    const {
      position,
      count,
      color,
      speed = 6,
      spread = 1,
      direction,
      size = 1,
      life = 0.6,
      drag = 1.6,
      gravity = 0,
    } = options;

    this.tmpColor.set(color);

    for (let i = 0; i < count; i++) {
      if (this.aliveCount >= this.capacity) return;
      const idx = this.aliveCount++;
      const i3 = idx * 3;

      this.pos[i3] = position.x;
      this.pos[i3 + 1] = position.y;
      this.pos[i3 + 2] = position.z;

      // 随机方向（可选叠加主方向）
      let dx = Math.random() * 2 - 1;
      let dy = Math.random() * 2 - 1;
      let dz = Math.random() * 2 - 1;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;
      if (direction) {
        dx = THREE.MathUtils.lerp(direction.x, dx, spread);
        dy = THREE.MathUtils.lerp(direction.y, dy, spread);
        dz = THREE.MathUtils.lerp(direction.z, dz, spread);
      }
      const s = speed * (0.55 + Math.random() * 0.75);
      this.vel[i3] = dx * s;
      this.vel[i3 + 1] = dy * s;
      this.vel[i3 + 2] = dz * s;

      const jitter = 0.75 + Math.random() * 0.5;
      this.col[i3] = this.tmpColor.r * jitter;
      this.col[i3 + 1] = this.tmpColor.g * jitter;
      this.col[i3 + 2] = this.tmpColor.b * jitter;

      this.size[idx] = size * (0.7 + Math.random() * 0.6);
      this.alpha[idx] = 1;
      this.life[idx] = life * (0.7 + Math.random() * 0.6);
      this.maxLife[idx] = this.life[idx];
      this.drag[idx] = drag;
      this.gravity[idx] = gravity;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.aliveCount; ) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.swapRemove(i);
        continue;
      }
      const i3 = i * 3;
      const damping = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= damping;
      this.vel[i3 + 1] = this.vel[i3 + 1] * damping + this.gravity[i] * dt;
      this.vel[i3 + 2] *= damping;

      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;

      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = t * t;
      this.size[i] *= 1 - dt * 0.35;
      i++;
    }

    this.geometry.setDrawRange(0, this.aliveCount);
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }

  private swapRemove(i: number): void {
    const last = --this.aliveCount;
    if (i === last) return;
    const i3 = i * 3;
    const l3 = last * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[i3 + k] = this.pos[l3 + k];
      this.col[i3 + k] = this.col[l3 + k];
      this.vel[i3 + k] = this.vel[l3 + k];
    }
    this.size[i] = this.size[last];
    this.alpha[i] = this.alpha[last];
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.drag[i] = this.drag[last];
    this.gravity[i] = this.gravity[last];
  }

  setViewportHeight(height: number): void {
    this.material.uniforms.uScale.value = height * 0.6;
  }

  clear(): void {
    this.aliveCount = 0;
    this.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
