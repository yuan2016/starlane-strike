import * as THREE from 'three';
import { SUN_DIRECTION } from './Environment';
import { getHexTexture } from './ProcTextures';

/**
 * 视觉增强 Shader 片段。
 * 全部通过 onBeforeCompile 注入或轻量 ShaderMaterial 实现，
 * 不新增几何体、不改变模型结构，只改变"光怎么落在已有表面上"。
 */

export interface RimOptions {
  color: THREE.ColorRepresentation;
  /** Fresnel 指数：越大边缘越窄 */
  power?: number;
  /** 强度 */
  strength?: number;
}

/**
 * 给标准 / 物理材质加 Fresnel 轮廓光（边缘高光）。
 * 飞机机翼、机身、Boss 舰体在深空背景里的剪影全靠它。
 */
export function applyRimLight(material: THREE.MeshStandardMaterial, opts: RimOptions): void {
  const color = new THREE.Color(opts.color);
  const power = opts.power ?? 2.8;
  const strength = opts.strength ?? 0.55;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: color };
    shader.uniforms.uRimPower = { value: power };
    shader.uniforms.uRimStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec3 uRimColor;
uniform float uRimPower;
uniform float uRimStrength;
void main() {`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
  vec3 rimN = normalize( normal );
  vec3 rimV = normalize( vViewPosition );
  float rimF = pow( 1.0 - clamp( dot( rimN, rimV ), 0.0, 1.0 ), uRimPower );
  outgoingLight += uRimColor * rimF * uRimStrength;
}
#include <opaque_fragment>`,
      );
  };
  // 相同参数的材质共用同一个编译结果，避免每个实例都编译一次
  material.customProgramCacheKey = () => `rim-${power.toFixed(2)}-${strength.toFixed(2)}`;
}

export interface AtmosphereOptions {
  color: THREE.ColorRepresentation;
  intensity?: number;
  power?: number;
  bias?: number;
}

/**
 * 大气层：外层球（BackSide + Additive）。
 * 亮度 = (bias - dot(法线, 视线))^power，越靠近星球边缘越亮；
 * 再按太阳方向做散射加权，向阳侧更亮，做出"大气散射"的方向感。
 */
export function createAtmosphereMaterial(opts: AtmosphereOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(opts.color) },
      uSunDir: { value: SUN_DIRECTION.clone() },
      uIntensity: { value: opts.intensity ?? 1 },
      uPower: { value: opts.power ?? 3 },
      uBias: { value: opts.bias ?? 0.62 },
      uSunBoost: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldNormal;
      varying vec3 vViewNormal;
      varying vec3 vViewDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vViewNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = viewMatrix * worldPos;
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uSunDir;
      uniform float uIntensity;
      uniform float uPower;
      uniform float uBias;
      uniform float uSunBoost;
      varying vec3 vWorldNormal;
      varying vec3 vViewNormal;
      varying vec3 vViewDir;
      void main() {
        float fres = max(uBias - dot(normalize(vViewNormal), normalize(vViewDir)), 0.0);
        float glow = pow(fres, uPower);
        float sun = smoothstep(-0.55, 0.6, dot(normalize(vWorldNormal), uSunDir));
        float a = glow * (0.3 + sun * uSunBoost) * uIntensity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: true,
  });
}

export interface ShieldOptions {
  /** 罩内填充 alpha 权重：0 = 中心完全透明，能清晰看到罩内机体 */
  core?: number;
  /** 六边形能量网 alpha 权重（网格与填充一起乘 uOpacity） */
  hexAlpha?: number;
  /** 网格在正中心的保留比例：0 = 中心干净，网格只出现在靠边缘处 */
  hexCenter?: number;
  /** Fresnel 指数：越大，边缘光带越窄（避免 Bloom 扩散） */
  rimPower?: number;
  /** 边缘 alpha 权重（最外圈峰值亮度），与填充解耦，可单独调亮 */
  rimAlpha?: number;
  /** 底色亮度系数：整体压暗靠它 */
  baseGain?: number;
  /** 边缘相对底色的额外提亮：越大越"发白"，越小越"淡蓝" */
  rimGain?: number;
}

/**
 * 能量护盾：极薄淡蓝薄膜 + 窄边 Fresnel 微光 + 局部受击涟漪 + 生成 / 破裂动画。
 *
 * 关键设计（按反馈调优后）：
 *  - **极薄**：`uCore = 0` + 网格权重压低，整体 alpha 落在 **0.05~0.15**，
 *    中心 alpha ≈ 0，罩内机体完全清晰；
 *  - **只有最外一圈微光**：`pow(1 - dot(N,V), uRimPower)` 归一化成 `rimF`，
 *    亮部集中在最外圈一条**极窄**的带上，颜色是淡蓝（不刷白），
 *    亮度刻意压在 Bloom 阈值（0.78）以下 → 不会泛光扩散；
 *  - **无闪烁**：受击 / 生成 / 破裂都不做任何全罩闪烁（已移除 flicker 项），
 *    破裂是「静态分块瓦解 + 淡出」，不会晃眼；
 *  - **受击涟漪**：`uHitPosition`（单位球空间击中点方向）+ `uHitStrength`（1→0，约 0.2 秒），
 *    波纹只在击中点周围**很小半径**内扩散一圈淡蓝白光环后隐去，不影响整罩亮度；
 *  - **生成**：`uSpawn` 0→1，自下而上扫描展开，前沿一条柔和扫描线（一次性，非闪烁）。
 *
 * 默认参数 = 敌机护盾的既有观感；玩家护盾传入更"清透"的参数。
 */
export function createShieldMaterial(
  color: THREE.ColorRepresentation,
  opts: ShieldOptions = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0.3 },
      uTime: { value: 0 },
      uHex: { value: getHexTexture() },
      uCore: { value: opts.core ?? 0.04 },
      uHexAlpha: { value: opts.hexAlpha ?? 0.26 },
      uHexCenter: { value: opts.hexCenter ?? 1 },
      uRimPower: { value: opts.rimPower ?? 2.2 },
      uRimAlpha: { value: opts.rimAlpha ?? 0.9 },
      uBaseGain: { value: opts.baseGain ?? 0.5 },
      uRimGain: { value: opts.rimGain ?? 1.8 },
      uSpawn: { value: 1 },
      uBreak: { value: 0 },
      uHitPosition: { value: new THREE.Vector3(0, 1, 0) },
      uHitStrength: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vViewNormal;
      varying vec3 vViewDir;
      varying vec2 vUv;
      varying vec3 vLocal;
      void main() {
        vUv = uv;
        vLocal = position;
        vViewNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      uniform sampler2D uHex;
      uniform float uCore;
      uniform float uHexAlpha;
      uniform float uHexCenter;
      uniform float uRimPower;
      uniform float uRimAlpha;
      uniform float uBaseGain;
      uniform float uRimGain;
      uniform float uSpawn;
      uniform float uBreak;
      uniform vec3 uHitPosition;
      uniform float uHitStrength;
      varying vec3 vViewNormal;
      varying vec3 vViewDir;
      varying vec2 vUv;
      varying vec3 vLocal;

      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
        vec3 N = normalize(vViewNormal);
        vec3 V = normalize(vViewDir);
        float edge = 1.0 - clamp(dot(N, V), 0.0, 1.0); // 0 = 正对镜头中心, 1 = 最外圈

        // 1) 菲涅尔边缘：rimF 归一化到 0..1，靠高次幂把亮部压在最外圈极窄的一条带上
        float rimF = pow(edge, uRimPower);

        // 2) 六边形能量网：随时间缓慢滚动；中心几乎不显示，避免把机体糊住
        float hex = texture2D(uHex, vUv * 3.0 + vec2(uTime * 0.03, uTime * 0.015)).r;
        hex *= mix(uHexCenter, 1.0, edge);

        // 3) 受击涟漪：只在击中点周围很小范围内扩散一圈光环，约 0.2s 内扩散完并隐去
        //    注意不做全罩提亮 / 闪烁，纯局部反馈
        float ripple = 0.0;
        float spark = 0.0;
        if (uHitStrength > 0.001) {
          vec3 hp = uHitPosition;
          float hl = length(hp);
          vec3 hd = hl > 0.0001 ? hp / hl : vec3(0.0, 1.0, 0.0);
          float d = acos(clamp(dot(normalize(vLocal), hd), -1.0, 1.0)); // 球面角距 0..π
          float wave = (1.0 - uHitStrength) * 0.9;                      // 波前最远只到 ~0.9 rad（小范围）
          // smoothstep 要求 edge0 < edge1，用 1 - smoothstep 反向得到环带
          ripple = (1.0 - smoothstep(0.0, 0.2, abs(d - wave))) * uHitStrength;
          spark = exp(-d * 6.0) * uHitStrength;                          // 接触点微光
        }

        float pulse = 0.95 + sin(uTime * 2.4) * 0.05;
        // 填充 / 网格整体极薄（uOpacity ≈ 0.05~0.15），边缘单独给一点 alpha
        float a = (uCore + hex * uHexAlpha) * uOpacity * pulse + rimF * uRimAlpha * uOpacity * pulse;
        a += ripple * 0.45 + spark * 0.2;

        // 4) 生成：自下而上扫描展开，前沿是一条很柔和的扫描线（一次性，不是闪烁）
        float sweepT = normalize(vLocal).y * 0.5 + 0.5;
        float front = uSpawn * 1.25;
        float reveal = 1.0 - smoothstep(front - 0.14, front + 0.02, sweepT);
        float sweep = exp(-abs(sweepT - front) * 14.0) * (1.0 - smoothstep(0.82, 1.0, uSpawn));
        a = a * reveal + sweep * 0.12;

        // 5) 破裂：网格按静态分块瓦解 + 整体淡出（刻意不加闪烁，避免晃眼）
        if (uBreak > 0.001) {
          float cell = hash21(floor(vUv * vec2(26.0, 16.0)));
          float alive = 1.0 - step(cell, uBreak * 1.15);
          a *= mix(1.0, alive, min(uBreak * 1.6, 1.0)) * (1.0 - uBreak * 0.9);
        }

        if (a < 0.002) discard;

        // 颜色：淡蓝底 + 边缘微光；涟漪 / 接触点混一点淡蓝白，整体压在 Bloom 阈值以下
        vec3 c = uColor * (uBaseGain + rimF * uRimGain + hex * 0.45 + sweep * 1.2);
        c = mix(c, vec3(0.78, 0.92, 1.0), clamp(ripple * 0.85 + spark * 0.5, 0.0, 0.85));
        gl_FragColor = vec4(c, min(a, 0.6));
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

/**
 * 喷口高温 Shader：把 Emissive 贴图的亮度当成"温度"，重新映射到黑体辐射色带。
 *
 * 直接用贴图颜色会出现"整块橙色发光"；按温度重映射后：
 *   冷端 = 暗红余温 → 中段橙 → 喷口喉部黄白，
 * 且温度（uHeat）可以随推力实时变化，配合 Bloom 就是真实的高温金属。
 *
 * @returns 用于每帧驱动温度的 uniform（直接改 .value 即可）
 */
export function applyEngineHeat(
  material: THREE.MeshStandardMaterial,
  opts: { heat?: number; gain?: number } = {},
): { value: number } {
  const uHeat = { value: opts.heat ?? 1 };
  const uGain = { value: opts.gain ?? 2.6 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHeat = uHeat;
    shader.uniforms.uHeatGain = uGain;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform float uHeat;\nuniform float uHeatGain;\nvoid main() {',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  // 亮度即温度：贴图已经编码了沿轴向的冷热分布
  float lum = dot(totalEmissiveRadiance, vec3(0.299, 0.587, 0.114));
  float heat = clamp(lum * uHeat * 0.8, 0.0, 1.0);
  // 黑体辐射近似色带（暗红 → 橙 → 黄白）
  vec3 ramp = mix(vec3(0.42, 0.05, 0.01), vec3(1.0, 0.34, 0.06), smoothstep(0.0, 0.35, heat));
  ramp = mix(ramp, vec3(1.0, 0.70, 0.30), smoothstep(0.35, 0.72, heat));
  ramp = mix(ramp, vec3(1.0, 0.95, 0.86), smoothstep(0.72, 1.0, heat));
  totalEmissiveRadiance = ramp * (0.18 + heat * uHeatGain);
}`,
      );
  };
  material.customProgramCacheKey = () => 'engine-heat';
  return uHeat;
}
