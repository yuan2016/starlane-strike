import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RENDER } from '../config';
import type { BloomProfile } from './Quality';

export interface PostFXOptions {
  /** MSAA 采样数：Composer 走离屏 RT，renderer.antialias 会失效，必须在这里补回来 */
  samples: number;
  bloom: BloomProfile;
}

/**
 * 后处理管线：RenderPass → UnrealBloom（辉光）→ OutputPass（色调映射 + 色彩空间）。
 * 关闭辉光时直接回落到 renderer.render，省掉一整个离屏管线。
 */
export class PostFX {
  readonly composer: EffectComposer;

  private readonly bloom: UnrealBloomPass;
  private readonly output: OutputPass;
  private bloomEnabled = true;
  private baseBloom: BloomProfile;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    options?: Partial<PostFXOptions>,
  ) {
    const profile = options?.bloom ?? RENDER.bloom;
    const samples = options?.samples ?? RENDER.msaa;
    const size = renderer.getSize(new THREE.Vector2());
    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());

    // 自建 RT：打开 MSAA（WebGL2），并保留半浮点以承载 HDR 发光
    const target = new THREE.WebGLRenderTarget(
      Math.max(1, buffer.x),
      Math.max(1, buffer.y),
      { type: THREE.HalfFloatType, samples },
    );
    target.texture.name = 'PostFX.MSAA';

    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));

    this.baseBloom = { ...profile };
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), profile.strength, profile.radius, profile.threshold);
    this.composer.addPass(this.bloom);

    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this.composer.setSize(size.x, size.y);
  }

  /** 切换画质档位时更新辉光参数 */
  setBloomProfile(profile: BloomProfile): void {
    this.baseBloom = { ...profile };
    this.bloom.strength = profile.strength;
    this.bloom.radius = profile.radius;
    this.bloom.threshold = profile.threshold;
  }

  get enabled(): boolean {
    return this.bloomEnabled;
  }

  /** 开关辉光（关闭后画面更省性能） */
  setEnabled(on: boolean): void {
    this.bloomEnabled = on;
  }

  /** 演出需要时可临时加强辉光，例如 Boss 阶段切换 */
  setStrength(strength: number): void {
    this.bloom.strength = strength;
  }

  /** 恢复关卡默认辉光强度 */
  resetStrength(): void {
    this.bloom.strength = this.baseBloom.strength;
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  render(): void {
    if (this.bloomEnabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.bloom.dispose();
    this.output.dispose();
    this.composer.dispose();
  }
}
