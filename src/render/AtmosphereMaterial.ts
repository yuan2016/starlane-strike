import * as THREE from 'three';
import { SUN_DIRECTION } from './Environment';

/**
 * 大气层 Shader：单次散射近似（Rayleigh + 前向 Mie），不是"一层透明蓝壳"。
 *
 * 物理思路（全部在片元里闭式计算，不做 raymarch）：
 *  1. **光学厚度**：渲染的是略大于星球的外壳背面（BackSide），
 *     视线在外壳里穿过的路程 ≈ -dot(N, V)，越靠近星球边缘越厚；
 *     星球本体靠深度测试把中间部分挡掉，只剩星球轮廓外的一圈。
 *  2. **相位函数**：Rayleigh 的 (1 + cos²θ) 让向阳侧偏亮，
 *     再叠一个窄的 Mie 前向 lobe，太阳在星球后方时会出现明显的"金边"。
 *  3. **昼夜过渡**：按世界法线与太阳方向做 smoothstep，
 *     晨昏线附近额外叠一层暖色（真实大气在日出/日落时的散射路径最长）。
 *  4. **夜面微光**：背光侧不直接变黑，保留一点点城市光晕量级的大气自发光。
 *
 * 渲染状态：加色混合 + 不写深度 + BackSide，一个 draw call，零 CPU 逐帧开销。
 */

export interface AtmosphereOptions {
  /** 大气主色（瑞利散射主导时的颜色，通常是蓝青） */
  color: THREE.ColorRepresentation;
  /** 晨昏线暖色（日出 / 日落的橙红） */
  twilightColor?: THREE.ColorRepresentation;
  /** 夜面残余辉光颜色 */
  nightColor?: THREE.ColorRepresentation;
  /** 整体强度（LOD 会调它） */
  intensity?: number;
  /** 光学厚度的衰减指数：越大越贴着星球边缘 */
  falloff?: number;
  /** 边缘锐利高光的指数与强度 */
  rimPower?: number;
  rimStrength?: number;
  /** Mie 前向散射强度（太阳在星球后方时的"金边"） */
  mie?: number;
  /** 夜面残余辉光强度 */
  nightGlow?: number;
  /** 大气密度（薄大气 vs 浓大气） */
  density?: number;
}

export interface AtmosphereMaterial extends THREE.ShaderMaterial {
  uniforms: {
    uColor: { value: THREE.Color };
    uTwilight: { value: THREE.Color };
    uNight: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
    uIntensity: { value: number };
    uFalloff: { value: number };
    uRimPower: { value: number };
    uRimStrength: { value: number };
    uMie: { value: number };
    uNightGlow: { value: number };
    uDensity: { value: number };
  };
}

export function createAtmosphereScatterMaterial(opts: AtmosphereOptions): AtmosphereMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(opts.color) },
      uTwilight: { value: new THREE.Color(opts.twilightColor ?? 0xff9a52) },
      uNight: { value: new THREE.Color(opts.nightColor ?? 0x1b3a66) },
      uSunDir: { value: SUN_DIRECTION.clone().normalize() },
      uIntensity: { value: opts.intensity ?? 1 },
      uFalloff: { value: opts.falloff ?? 2.2 },
      uRimPower: { value: opts.rimPower ?? 5 },
      uRimStrength: { value: opts.rimStrength ?? 0.55 },
      uMie: { value: opts.mie ?? 0.6 },
      uNightGlow: { value: opts.nightGlow ?? 0.12 },
      uDensity: { value: opts.density ?? 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldNormal;
      varying vec3 vViewNormal;
      varying vec3 vViewDir;
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vViewNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = viewMatrix * worldPos;
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uTwilight;
      uniform vec3 uNight;
      uniform vec3 uSunDir;
      uniform float uIntensity;
      uniform float uFalloff;
      uniform float uRimPower;
      uniform float uRimStrength;
      uniform float uMie;
      uniform float uNightGlow;
      uniform float uDensity;

      varying vec3 vWorldNormal;
      varying vec3 vViewNormal;
      varying vec3 vViewDir;
      varying vec3 vWorldPos;

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(vViewDir);
        vec3 L = normalize(uSunDir);

        // 1) 光学厚度：外壳背面渲染时 dot(N,V) <= 0，取负得到 0(外缘) → 1(星球边缘)
        float limb = clamp(-dot(normalize(vViewNormal), V), 0.0, 1.0);
        float thickness = pow(limb, uFalloff) * uDensity;

        // 2) 相位：Rayleigh (1 + cos²θ) + Mie 前向窄瓣
        vec3 worldView = normalize(vWorldPos - cameraPosition);
        float mu = dot(worldView, L);
        float rayleigh = 0.75 * (1.0 + mu * mu);
        float mie = uMie * pow(max(mu, 0.0), 8.0);
        float phase = rayleigh + mie;

        // 3) 昼夜：晨昏线附近有暖色过渡
        float sunDot = dot(N, L);
        float day = smoothstep(-0.22, 0.30, sunDot);
        float twilight = exp(-abs(sunDot) * 7.0);
        float night = 1.0 - day;

        // 4) 颜色：白天散射色 → 晨昏暖色 → 夜面残余辉光
        vec3 col = mix(uNight, uColor, day);
        col = mix(col, uTwilight, twilight * 0.6);
        col += uNight * night * uNightGlow;

        // 5) 边缘锐利高光（贴着星球轮廓的一圈亮线）
        float rim = pow(limb, uRimPower) * uRimStrength * (0.25 + 0.75 * day);

        float a = (thickness + rim) * phase * uIntensity;
        a = clamp(a, 0.0, 1.6);
        gl_FragColor = vec4(col * a, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: true,
  });
  return material as AtmosphereMaterial;
}
