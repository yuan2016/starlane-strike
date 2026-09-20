import * as THREE from 'three';
import { SUN_DIRECTION } from '../render/Environment';
import { createAtmosphereScatterMaterial, type AtmosphereMaterial } from '../render/AtmosphereMaterial';
import { createPlanetMaps, type PlanetPalette } from '../render/ProcTextures';
import { isSharedTexture } from '../render/PbrAssets';
import type { QualitySettings } from '../render/Quality';

/**
 * 星球精度分级：
 *  - hero  ：地表 + 法线 + 云层 + 大气 + 夜面城市灯（焦点星球）
 *  - medium：地表 + 大气 + 基础光照（背景星球，不生成云层与夜面）
 */
export type PlanetTier = 'hero' | 'medium';

export interface PlanetOptions {
  radius: number;
  palette: PlanetPalette;
  /** 大气层颜色 */
  atmosphere: number;
  /** 夜面城市灯颜色 */
  night: number;
  tier: PlanetTier;
  seed: number;
  settings: QualitySettings;
}

const SPIN_SPEED = 0.05;

/**
 * 多层星球：地表 → 云层 → 大气层。
 * 贴图一次生成、几何与材质全部复用；夜面与大气的方向性由 Shader 里的太阳方向决定，
 * 每帧只更新旋转与（低频的）LOD，不做重复计算。
 */
export class Planet {
  readonly group = new THREE.Group();
  readonly radius: number;

  private readonly spin = new THREE.Group();
  private readonly surface: THREE.Mesh;
  private readonly surfaceMaterial: THREE.MeshStandardMaterial;
  private readonly cloud: THREE.Mesh | null = null;
  private readonly atmosphere: THREE.Mesh | null = null;
  private readonly atmosphereMaterial: AtmosphereMaterial | null = null;
  private readonly baseAtmosphereIntensity: number;
  private readonly allowClouds: boolean;
  private readonly maps: ReturnType<typeof createPlanetMaps>;

  constructor(options: PlanetOptions) {
    this.radius = options.radius;
    const hero = options.tier === 'hero' && options.settings.nightLights;
    const wantClouds = options.tier === 'hero' && options.settings.clouds;
    const segments = options.tier === 'hero' ? options.settings.planetSegments : Math.min(options.settings.planetSegments, 32);

    this.maps = createPlanetMaps({
      width: options.settings.planetTextureWidth,
      palette: options.palette,
      seed: options.seed,
      hero,
    });

    // —— 地表 ——
    const surfaceGeo = new THREE.SphereGeometry(options.radius, segments, Math.max(12, segments >> 1));
    this.surfaceMaterial = new THREE.MeshStandardMaterial({
      map: this.maps.albedo,
      roughnessMap: this.maps.roughness,
      metalness: 0.06,
      roughness: 1,
      envMapIntensity: 0.85,
    });
    if (this.maps.normal) this.surfaceMaterial.normalMap = this.maps.normal;
    if (this.maps.ao) {
      this.surfaceMaterial.aoMap = this.maps.ao;
      this.surfaceMaterial.aoMapIntensity = 0.9;
    }
    if (this.maps.night) {
      this.surfaceMaterial.emissiveMap = this.maps.night;
      this.surfaceMaterial.emissive = new THREE.Color(options.night);
      this.surfaceMaterial.emissiveIntensity = 1.35;
      this.applyNightSide();
    }
    this.surface = new THREE.Mesh(surfaceGeo, this.surfaceMaterial);
    this.spin.add(this.surface);
    this.baseAtmosphereIntensity = options.tier === 'hero' ? 1.15 : 0.8;

    // —— 云层（仅 hero）——
    this.allowClouds = wantClouds && !!this.maps.cloud;
    if (this.allowClouds && this.maps.cloud) {
      const cloudGeo = new THREE.SphereGeometry(options.radius * 1.018, segments, Math.max(12, segments >> 1));
      const cloudMat = new THREE.MeshStandardMaterial({
        map: this.maps.cloud,
        transparent: true,
        depthWrite: false,
        roughness: 0.92,
        metalness: 0,
        opacity: 0.85,
        // 云层也吃环境反射一点点，避免"贴纸"感
        envMapIntensity: 0.6,
      });
      this.applyCloudNightFade(cloudMat);
      this.cloud = new THREE.Mesh(cloudGeo, cloudMat);
      this.cloud.renderOrder = 1;
      this.spin.add(this.cloud);
    }

    // —— 大气层（Fresnel + 太阳散射）——
    if (options.settings.atmosphere) {
      const atmoGeo = new THREE.SphereGeometry(
        options.radius * (options.tier === 'hero' ? 1.14 : 1.09),
        Math.max(16, segments >> 1),
        Math.max(10, segments >> 2),
      );
      this.atmosphereMaterial = createAtmosphereScatterMaterial({
        color: options.atmosphere,
        intensity: this.baseAtmosphereIntensity,
        // 焦点星球：厚大气 + 明显晨昏线 + 强前向散射；背景星球弱化，省带宽也不抢镜
        density: options.tier === 'hero' ? 1 : 0.7,
        falloff: options.tier === 'hero' ? 2.2 : 2.6,
        rimPower: options.tier === 'hero' ? 5 : 4,
        rimStrength: options.tier === 'hero' ? 0.55 : 0.35,
        mie: options.tier === 'hero' ? 0.65 : 0.35,
        nightGlow: options.tier === 'hero' ? 0.14 : 0.08,
      });
      this.atmosphere = new THREE.Mesh(atmoGeo, this.atmosphereMaterial);
      this.atmosphere.renderOrder = 2;
      this.group.add(this.atmosphere);
    }

    this.group.add(this.spin);
  }

  /** 夜面：城市灯只在背光面出现（Shader 内按世界法线与太阳方向计算，无逐帧 CPU 开销） */
  private applyNightSide(): void {
    this.surfaceMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uSunDir = { value: SUN_DIRECTION.clone() };
      shader.uniforms.uNightStrength = { value: 1 };
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying vec3 vPlanetWorldNormal;\nvoid main() {')
        .replace(
          '#include <begin_vertex>',
          'vPlanetWorldNormal = normalize(mat3(modelMatrix) * objectNormal);\n#include <begin_vertex>',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          'varying vec3 vPlanetWorldNormal;\nuniform vec3 uSunDir;\nuniform float uNightStrength;\nvoid main() {',
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
{
  float sunDot = dot(normalize(vPlanetWorldNormal), uSunDir);
  float nightMask = smoothstep(0.14, -0.28, sunDot);
  totalEmissiveRadiance *= nightMask * uNightStrength;
}`,
        );
    };
    this.surfaceMaterial.customProgramCacheKey = () => 'planet-night';
  }

  /** 云层在夜面不该继续被照亮：按世界法线与太阳方向压暗并减薄 */
  private applyCloudNightFade(material: THREE.MeshStandardMaterial): void {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uSunDir = { value: SUN_DIRECTION.clone() };
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying vec3 vPlanetWorldNormal;\nvoid main() {')
        .replace(
          '#include <begin_vertex>',
          'vPlanetWorldNormal = normalize(mat3(modelMatrix) * objectNormal);\n#include <begin_vertex>',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          'varying vec3 vPlanetWorldNormal;\nuniform vec3 uSunDir;\nvoid main() {',
        )
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
{
  float sunDot = dot(normalize(vPlanetWorldNormal), uSunDir);
  float dayMask = smoothstep(-0.30, 0.12, sunDot);
  gl_FragColor.rgb *= 0.16 + 0.84 * dayMask;
  gl_FragColor.a *= 0.30 + 0.70 * dayMask;
}`,
        );
    };
    material.customProgramCacheKey = () => 'planet-cloud-night';
  }

  /**
   * LOD：按"屏幕占用面积 + 距离"调节，而不是只看距离。
   * coverage ≈ 星球直径占屏幕高度的比例，远处的小星球关掉云层、压低大气强度。
   */
  setLod(coverage: number): void {
    const t = THREE.MathUtils.clamp(coverage * 6, 0.3, 1);
    if (this.atmosphereMaterial) {
      this.atmosphereMaterial.uniforms.uIntensity.value = this.baseAtmosphereIntensity * (0.45 + t * 0.55);
    }
    if (this.cloud) this.cloud.visible = coverage > 0.04;
  }

  update(dt: number): void {
    this.spin.rotation.y += dt * SPIN_SPEED;
    if (this.cloud) this.cloud.rotation.y += dt * SPIN_SPEED * 0.35;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose();
    });
    this.surfaceMaterial.dispose();
    if (this.cloud) (this.cloud.material as THREE.Material).dispose();
    this.atmosphereMaterial?.dispose();
    // 烘焙贴图是全局共享的，只释放程序化生成的那些
    const drop = (t: THREE.Texture | null) => {
      if (t && !isSharedTexture(t)) t.dispose();
    };
    drop(this.maps.albedo);
    drop(this.maps.roughness);
    drop(this.maps.normal);
    drop(this.maps.night);
    drop(this.maps.cloud);
    drop(this.maps.ao);
  }
}
