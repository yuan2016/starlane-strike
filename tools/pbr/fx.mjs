/**
 * 特效类 PBR 贴图：发动机高温金属 / 能量灯带 / 座舱玻璃污渍。
 *
 * 这些和"表面"不同：它们更依赖**方向性渐变 + Shader 动画**，
 * 因此有的贴图故意不可平铺（例如发动机热度沿轴线单向变化，使用 ClampToEdgeWrapping），
 * 在 `PbrAssets.ts` 里会按图分别设置 wrap 模式。
 */

import { fbm, ridged, hash2, valueNoise, anisoFbm, worleyF1 } from './noise.mjs';
import { clamp01, lerp, smoothstep, blurWrap, cavityAO, linearToSrgb, hexToLinear, remap } from './image.mjs';

/* ——————————————————————————————————————————————
 * 1. 发动机高温金属
 * 约定：贴图 **第一行（v=1）是喷口出口/最热端**，最后一行是最冷端。
 * Three.js 默认 flipY=true，图片第一行对应 v=1，正好就是 CylinderGeometry 的顶部 →
 * 本机 model 里襟翼 rotation.x=π/2 后顶部指向机尾。
 * —————————————————————————————————————————————— */

const HEAT_RAMP = [
  [0.0, [0.02, 0.02, 0.03]],
  [0.35, [0.18, 0.10, 0.06]],
  [0.6, [0.55, 0.20, 0.05]],
  [0.8, [0.95, 0.45, 0.08]],
  [0.92, [1.0, 0.80, 0.35]],
  [1.0, [1.0, 0.98, 0.85]],
];

function rampLookup(stops, t) {
  const x = clamp01(t);
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (x <= p1) {
      const k = (x - p0) / Math.max(1e-6, p1 - p0);
      return [lerp(c0[0], c1[0], k), lerp(c0[1], c1[1], k), lerp(c0[2], c1[2], k)];
    }
  }
  return stops[stops.length - 1][1];
}

export function bakeEngineHeat(size, seed = 7) {
  const w = size;
  const h = size;
  const n = w * h;
  const height = new Float32Array(n);
  const rough = new Float32Array(n);
  const metal = new Float32Array(n);
  const emissiveMask = new Float32Array(n);
  const baseR = new Float32Array(n);
  const baseG = new Float32Array(n);
  const baseB = new Float32Array(n);
  const emiR = new Float32Array(n);
  const emiG = new Float32Array(n);
  const emiB = new Float32Array(n);

  const metalHousing = hexToLinear(0x2b3038);

  for (let y = 0; y < h; y++) {
    // v=1 在第一行 → tHeat=1 最热
    const v = 1 - y / h;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const u = x / w;

      // 轴向温度：从冷端到热端非线性升温，叠加气流不均匀带来的舌状偏差
      const flow = fbm(u, 1 - v, 4, 3, seed + 3);
      const tHeat = clamp01(Math.pow(v, 1.55) * (0.82 + flow * 0.35));

      // —— 几何：环形加强筋 + 冷却槽 ——
      const ribs = Math.abs(Math.sin((1 - v) * Math.PI * 14));
      const ribH = smoothstep(0.75, 1.0, ribs) * 0.05;
      const vents = smoothstep(0.86, 1.0, Math.abs(Math.sin(u * Math.PI * 2 * 26)));
      const scale = ridged(u, 1 - v, 40, 3, seed + 11);
      let hi = 0.5 + ribH - vents * 0.03 + (scale - 0.5) * 0.02;
      hi += (fbm(u, 1 - v, 6, 3, seed + 13) - 0.5) * 0.015;
      height[i] = hi;

      // —— BaseColor：金属基体 → 沿轴线做热处理变色（蓝紫→麦黄→焦褐→炽白）——
      const tint = rampLookup(HEAT_RAMP, tHeat);
      // 未受热区域保留冷灰金属
      const base = metalHousing;
      const pow0 = clamp01((tHeat - 0.25) / 0.6);
      let lr = lerp(base[0], tint[0] * 0.55, pow0);
      let lg = lerp(base[1], tint[1] * 0.5, pow0);
      let lb = lerp(base[2], tint[2] * 0.5, pow0);
      // 积碳：冷热交界处最明显
      const soot = clamp01((0.35 - Math.abs(tHeat - 0.35)) * 2.2) * remap(fbm(u, 1 - v, 8, 3, seed + 17), 0.4, 0.8);
      lr = lerp(lr, 0.012, soot * 0.7);
      lg = lerp(lg, 0.011, soot * 0.7);
      lb = lerp(lb, 0.011, soot * 0.7);
      baseR[i] = clamp01(lr);
      baseG[i] = clamp01(lg);
      baseB[i] = clamp01(lb);

      // —— Roughness：受热端形成玻璃态釉面，反而更光滑 ——
      let rgh = lerp(0.55, 0.24, pow0);
      rgh += soot * 0.35;
      rgh += (scale - 0.5) * 0.16;
      rough[i] = clamp01(rgh);

      // —— Metallic：高温氧化层带更多电介质成分，金属度下降一点 ——
      metal[i] = clamp01(lerp(0.92, 0.62, pow0 * 0.7) - soot * 0.4);

      // —— Emissive：只有超过一定温度才真正发光，且环筋之间是主发光舌 ——
      const glowShape = clamp01((tHeat - 0.55) / 0.45);
      const streaks = 0.65 + 0.35 * Math.sin(u * Math.PI * 2 * 9 + tHeat * 6.0);
      const emi = Math.pow(glowShape, 2.2) * streaks * (1 - vents * 0.5);
      emissiveMask[i] = emi;
      const ec = rampLookup(HEAT_RAMP, clamp01(tHeat * 1.05));
      emiR[i] = clamp01(ec[0] * emi);
      emiG[i] = clamp01(ec[1] * emi);
      emiB[i] = clamp01(ec[2] * emi);
    }
  }

  const ao = cavityAO(height, w, h, { inner: Math.max(1, size >> 9), outer: Math.max(4, size >> 7), strength: 1.3 });
  return {
    width: w,
    height: h,
    height,
    ao,
    roughness: rough,
    metallic: metal,
    emissiveMask,
    base: [baseR, baseG, baseB],
    emissive: [emiR, emiG, emiB],
  };
}

/* ——————————————————————————————————————————————
 * 2. 能量灯带（Emissive 遮罩，可平铺）
 * 输出单通道强度 + RGB；运行时把它作为 emissiveMap，配合 Bloom 使用。
 * —————————————————————————————————————————————— */

export function bakeEnergyStrip(size, seed = 21) {
  const n = size * size;
  const mask = new Float32Array(n);
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  const c = [0.32, 0.78, 1.0]; // 偏青的能量蓝

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size;

      // 主体：沿 U 方向的一条连续光带，位于 V 中间
      const band = Math.exp(-Math.pow((v - 0.5) / 0.085, 2));
      // 端点：做成梯形收口，看起来像被加工的导光条
      const caps = smoothstep(0.03, 0.1, u) * (1 - smoothstep(0.9, 0.97, u));
      // 内部能量流动：沿 U 推进的亮脉冲
      const flow = anisoFbm(u, v, 12, 3, 3, seed + 5);
      const pulse = 0.55 + 0.45 * Math.sin(u * Math.PI * 2 * 3.0 + flow * 4.0);
      // 边缘渗出（bloom 让这里自然发亮，不需要额外几何）
      const bleed = Math.exp(-Math.pow((v - 0.5) / 0.16, 2)) * 0.35;

      const m = clamp01(band * caps * pulse + bleed * caps);
      mask[i] = m;
      r[i] = clamp01(c[0] * m);
      g[i] = clamp01(c[1] * m);
      b[i] = clamp01(c[2] * m);
    }
  }
  return { width: size, height: size, mask, rgb: [r, g, b] };
}

/* ——————————————————————————————————————————————
 * 3. 座舱玻璃脏污：不改变玻璃本身的颜色，只在近距离提供真实感
 * 输出：
 *  - smudge  灰度：擦拭痕迹与积尘，用作 glass 的 roughnessMap
 *  - micro   灰度：更细微的虹彩-磨损混合层，用作极轻微的法线扰动
 * —————————————————————————————————————————————— */

export function bakeCanopyDetail(size, seed = 33) {
  const n = size * size;
  const smudge = new Float32Array(n);
  const micro = new Float32Array(n);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size;

      // 擦拭痕迹：沿一个方向的手擦 / 雨蚀痕迹
      const wipe = anisoFbm(u, v, 5, 42, 4, seed + 3);
      // 细尘点：高频均匀颗粒，只在很近才看得到
      const dustV = worleyF1(u, v, Math.round(size * 0.35), seed + 7);
      const dust = smoothstep(0.72, 0.95, 1 - dustV * 2.2);

      smudge[i] = clamp01(remap(wipe, 0.32, 0.78) * 0.85 + dust * 0.25);
      micro[i] = clamp01(remap(wipe, 0.2, 0.9));
    }
  }
  return { width: size, height: size, smudge, micro };
}

export { blurWrap };
