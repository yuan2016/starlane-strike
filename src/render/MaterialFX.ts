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

/**
 * 能量护盾：Fresnel 边缘 + 六边形能量网。
 * 取代原本"一整块半透明球"，让护盾有明显的边缘光与网格细节。
 */
export function createShieldMaterial(color: THREE.ColorRepresentation): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0.3 },
      uTime: { value: 0 },
      uHex: { value: getHexTexture() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vViewNormal;
      varying vec3 vViewDir;
      varying vec2 vUv;
      void main() {
        vUv = uv;
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
      varying vec3 vViewNormal;
      varying vec3 vViewDir;
      varying vec2 vUv;
      void main() {
        float fres = pow(1.0 - clamp(dot(normalize(vViewNormal), normalize(vViewDir)), 0.0, 1.0), 2.2);
        vec2 hexUv = vUv * 3.0 + vec2(uTime * 0.03, uTime * 0.015);
        float hex = texture2D(uHex, hexUv).r;
        float pulse = 0.92 + sin(uTime * 2.4) * 0.08;
        float a = (0.04 + fres * 0.9 + hex * 0.26) * uOpacity * pulse;
        vec3 c = uColor * (0.5 + fres * 1.8 + hex * 0.45);
        gl_FragColor = vec4(c, a);
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
