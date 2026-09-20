/**
 * 舰船 / 机体 PBR 表面烘焙器。
 *
 * 一次遍历同时产出全部通道，保证通道之间严格对齐（这点很重要：
 * AO 必须知道缝在哪，Roughness 必须知道哪块是掉漆的裸金属，Emissive 必须落在 panel 上）。
 *
 * 产出（全部单位为像素，全部 8bit / 线性工作流）：
 *  - height    Float32  [0,1]   用于派生法线与 AO，也作为 Height 贴图输出
 *  - basecolor Uint8 RGB        已转回 sRGB（Three.js 里标记 SRGBColorSpace）
 *  - normal    Uint8 RGB        OpenGL 约定切线空间法线
 *  - roughness Float32 [0,1]
 *  - metallic  Float32 [0,1]
 *  - ao        Float32 [0,1]
 *  - emissive  Uint8 RGB        线性 RGB（Three.js emissiveMap 按 sRGB 采样，
 *                               这里按 Three 的约定统一用 sRGB 编码输出）
 */

import { fbm, worleyF1, anisoFbm, ridged, hash2, valueNoise } from './noise.mjs';
import { clamp01, lerp, smoothstep, blurWrap, cavityAO, linearToSrgb, srgbToLinear, hexToLinear, remap } from './image.mjs';

/**
 * 到最近网格线的距离（UV 单位）。
 * 线位置被一层低频可平铺噪声轻微扭曲，避免出现"尺子画出来"的死板直线。
 */
function gridLineDist(coord, grid, warpAmount, warpSeed, u, v) {
  const cellCount = grid;
  const freq = Math.max(2, Math.round(grid * 0.5));
  const warp = (fbm(u, v, freq, 2, warpSeed) - 0.5) * warpAmount;
  const c = coord * cellCount + warp;
  const f = c - Math.floor(c);
  const d = f < 0.5 ? f : 1 - f; // 距离最近的整数格线
  return d / cellCount; // 回到 UV 单位
}

/** 有方向性的擦拭磨损：细节 Science 上让使用痕迹顺着某个方向，而不是各向同性糊一团 */
function directionalWear(u, v, seed) {
  return anisoFbm(u, v, 6, 64, 3, seed);
}

/** 舰船表面的默认参数表：预设只需要覆盖关心的字段 */
export const SHIP_DEFAULTS = {
  size: 1024,
  seed: 1,
  grid: 10,
  subDiv: 2.6,
  /** 面板线扭曲量（格为单位）：太小像尺子画的，太大会变成"手绘波浪线" */
  warp: 0.14,
  seamWidth: 0.0042,
  seamDepth: 0.14,
  bevel: 0.012,
  seamDarken: 0.55,
  seamAO: 0.72,
  rivets: true,
  rivetInset: 0.1,
  rivetRadius: 0.05,
  micro: 'cast',
  microGrid: 96,
  microAmount: 0.02,
  scratchGrid: 40,
  scratchDensity: 0.16,
  scratchDepth: 0.012,
  dentDepth: 0.02,
  panelTintVar: 0.16,
  accentRatio: 0.12,
  trimStrength: 0.35,
  paintGrain: 0.055,
  fineGrain: 0.05,
  paintRoughJitter: 0.12,
  wearAmount: 0.55,
  wearWidth: 0.014,
  wearReveal: 0.6,
  grimeAmount: 0.5,
  roughBase: 0.42,
  roughVar: 0.14,
  roughMicro: 0.6,
  roughGrime: 0.3,
  roughScratch: 0.22,
  roughSeam: 0.2,
  roughSeamDefault: 0.72,
  polish: 0.14,
  metalBase: 0.9,
  metalVar: 0.08,
  metalGrimeLoss: 0.45,
  paintDielectric: 0.15,
  aoStrength: 1.5,
  aoGamma: 1.3,
  palette: {
    base: 0x8f9aa8,
    panel: 0x5b6472,
    accent: 0xc8a23c,
    grain: 0x9aa3ad,
    emissive: 0x4ea8ff,
  },
  emissive: { type: 'none' },
};

/**
 * @param o 参见文件头说明的参数表
 * @returns { width, height, fields... }
 */
export function bakeShipSurface(options) {
  const o = {
    ...SHIP_DEFAULTS,
    ...options,
    palette: { ...SHIP_DEFAULTS.palette, ...(options.palette ?? {}) },
    emissive: { ...SHIP_DEFAULTS.emissive, ...(options.emissive ?? {}) },
  };
  const w = o.size;
  const h = o.size;
  const n = w * h;

  const height = new Float32Array(n);
  const rough = new Float32Array(n);
  const metal = new Float32Array(n);
  const wearMask = new Float32Array(n);
  const grime = new Float32Array(n);
  const seamMask = new Float32Array(n);
  const emissiveMask = new Float32Array(n);
  const baseR = new Float32Array(n);
  const baseG = new Float32Array(n);
  const baseB = new Float32Array(n);
  const emissiveR = new Float32Array(n);
  const emissiveG = new Float32Array(n);
  const emissiveB = new Float32Array(n);

  const baseLin = typeof o.palette.base === 'number' ? hexToLinear(o.palette.base) : o.palette.base;
  const panelLin = typeof o.palette.panel === 'number' ? hexToLinear(o.palette.panel) : o.palette.panel;
  const accentLin = typeof o.palette.accent === 'number' ? hexToLinear(o.palette.accent) : o.palette.accent;
  const grainLin = typeof o.palette.grain === 'number' ? hexToLinear(o.palette.grain) : o.palette.grain;
  const emissiveLin = o.palette.emissive
    ? typeof o.palette.emissive === 'number'
      ? hexToLinear(o.palette.emissive)
      : o.palette.emissive
    : [0.2, 0.6, 1];

  const em = o.emissive ?? { type: 'none' };
  const micro = o.micro ?? 'cast';
  const seed = o.seed;

  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const i = y * w + x;

      /* ——— 1. 面板几何（两级） ——— */
      const coarseGrid = o.grid;
      const fineGrid = Math.round(o.grid * o.subDiv);
      const d1 = gridLineDist(u, coarseGrid, o.warp, seed + 1, u, v);
      const dy1 = gridLineDist(v, coarseGrid, o.warp, seed + 2, u, v);
      const distCoarse = Math.min(d1, dy1);

      const d2 = gridLineDist(u, fineGrid, o.warp * 0.5, seed + 3, u, v);
      const dy2 = gridLineDist(v, fineGrid, o.warp * 0.5, seed + 4, u, v);
      const distFine = Math.min(d2, dy2);

      // 面板 ID → 每块独立的色调 / 高度微差
      const cid = (ix0, iy0, g, s) => hash2(((ix0 % g) + g) % g, ((iy0 % g) + g) % g, s);
      const cxI = Math.floor(u * coarseGrid);
      const cyI = Math.floor(v * coarseGrid);
      const panelId = cid(cxI, cyI, coarseGrid, seed + 17);
      const subId = cid(Math.floor(u * fineGrid), Math.floor(v * fineGrid), fineGrid, seed + 19);

      /* ——— 2. 缝隙凹槽形状 ——— */
      // 缝宽用 UV 单位表达：这样 2048 与 1024 观感完全一致（而不是随分辨率变细）
      const seamW = o.seamWidth;
      const groove1 = 1 - smoothstep(0, seamW, distCoarse);
      const bevel1 = 1 - smoothstep(seamW, seamW + o.bevel, distCoarse);
      // 细分缝不是处处都有：大块光滑区域（鼻锥 / 优化外形）会"吞掉"细分缝，
      // 只有结构密集区才显出细面板 —— 这是打破方格纸感的关键
      const fineSuppress = 0.18 + 0.82 * smoothstep(0.3, 0.74, fbm(u, v, 3, 3, seed + 131));
      const grooveF = (1 - smoothstep(0, seamW * 0.55, distFine)) * fineSuppress;

      let seam = Math.max(groove1, grooveF * 0.65);
      seam = clamp01(seam);

      /* ——— 3. 高度场 ——— */
      // 面板之间的极轻微台阶
      let hi = 0.5 + (panelId - 0.5) * 0.035;
      // 主缝 + 倒角
      hi -= seam * o.seamDepth;
      hi += bevel1 * 0.012;

      // 铆钉 / 螺栓（面板角）
      let rivet = 0;
      if (o.rivets) {
        const cc = u * coarseGrid;
        const cv = v * coarseGrid;
        const fx = cc - Math.floor(cc);
        const fy = cv - Math.floor(cv);
        const rx = Math.min(Math.abs(fx - o.rivetInset), Math.abs(fx - (1 - o.rivetInset)));
        const ry = Math.min(Math.abs(fy - o.rivetInset), Math.abs(fy - (1 - o.rivetInset)));
        const rd = Math.hypot(rx, ry);
        const rr = o.rivetRadius;
        if (rd < rr) {
          const k = 1 - rd / rr;
          rivet = Math.pow(k, 0.6);
        }
      }
      hi += rivet * 0.035;

      // 微表面：机加工刀路 / 铸造晶粒 / 编织纹理
      let microH = 0;
      if (micro === 'cast') {
        microH = (1 - worleyF1(u, v, o.microGrid, seed + 31)) * o.microAmount;
      } else if (micro === 'brushed') {
        microH = (anisoFbm(u, v, o.microGrid, o.microGrid * 26, 3, seed + 37) - 0.5) * o.microAmount * 2;
      } else if (micro === 'weave') {
        const pattern = Math.sin(u * Math.PI * 2 * o.microGrid) * Math.sin(v * Math.PI * 2 * o.microGrid);
        microH = pattern * o.microAmount * 0.5 + (anisoFbm(u, v, o.microGrid * 2, o.microGrid * 2, 2, seed + 41) - 0.5) * o.microAmount;
      }
      hi += microH;

      // 大尺度起伏（大板件不会完全平）
      hi += (fbm(u, v, Math.round(o.grid * 0.35), 3, seed + 53) - 0.5) * 0.02;

      // 细颗粒（喷漆雾面 / 砂纸打磨痕）：让 2048 贴图在近处不显得"塑料平滑"
      const fineGrain = (fbm(u, v, 180, 2, seed + 87) - 0.5) * o.fineGrain;
      hi += fineGrain * 0.35;

      // 划痕：细长脊状噪声，来自抛光 / 擦拭方向的随机深浅
      const scratchField = ridged(u, v, o.scratchGrid, 3, seed + 59);
      const scratch = smoothstep(1 - o.scratchDensity, 1 - o.scratchDensity + 0.12, scratchField);
      hi -= scratch * o.scratchDepth;

      // 凹坑 / 战损
      const dent = smoothstep(0.86, 1.0, worleyF1(u, v, Math.round(o.grid * 2.5), seed + 61));
      hi -= dent * o.dentDepth;

      height[i] = hi;

      /* ——— 4. 旧化 / 污渍遮罩 ——— */
      // 边缘磨损：靠近缝 & 铆钉周围最容易掉漆
      const edgeWear = 1 - smoothstep(0, o.wearWidth, Math.abs(distCoarse - seamW * 0.2));
      const wipe = directionalWear(u, v, seed + 67);
      const blotch = fbm(u, v, Math.round(o.grid * 0.8), 4, seed + 71);
      let wear = clamp01(edgeWear * 0.7 + remap(blotch, 0.54, 0.86) * 0.7 + rivet * 0.35);
      wear *= clamp01(remap(wipe, 0.35, 0.75) + 0.35);
      wear = clamp01(wear * o.wearAmount);
      // 划痕同样计入磨损度，影响掉漆露底与粗糙度
      wear = Math.max(wear, scratch * 0.55 * o.wearAmount);
      wearMask[i] = wear;

      // 污渍：凹处（低高度）更容易积灰；不是整面都脏，避免变成"脏兮兮"而不是"有使用痕迹"
      const dirtPattern = fbm(u, v, Math.round(o.grid * 0.5), 4, seed + 73);
      const gm = clamp01(remap(dirtPattern, 0.55, 0.9)) * clamp01(0.35 + seam * 0.9 + (0.5 - hi) * 1.4);
      grime[i] = clamp01(gm * o.grimeAmount);
      seamMask[i] = seam;

      /* ——— 5. BaseColor（线性空间混合后再转 sRGB） ——— */
      const toneShift = 1 + (panelId - 0.5) * o.panelTintVar;
      const subTone = 1 + (subId - 0.5) * o.panelTintVar * 0.5;
      // 大尺度色差 + 喷漆颗粒（避免"一整块纯色"）
      const grainFreq = 512;
      const paintGrain = (valueNoise(u * grainFreq, v * grainFreq, grainFreq, seed + 79) - 0.5) * o.paintGrain;
      const largeVar = (fbm(u, v, 2, 3, seed + 83) - 0.5) * 0.1;
      const midVar = (fbm(u, v, 48, 2, seed + 91) - 0.5) * o.fineGrain;

      let linR = baseLin[0] * toneShift * subTone + paintGrain + midVar * baseLin[0] * 0.5 + largeVar * baseLin[0];
      let linG = baseLin[1] * toneShift * subTone + paintGrain + midVar * baseLin[1] * 0.5 + largeVar * baseLin[1];
      let linB = baseLin[2] * toneShift * subTone + paintGrain + midVar * baseLin[2] * 0.5 + largeVar * baseLin[2];

      // 少量面板做"部件区分"（像真实军机的不同段），密度低才不会像补丁
      if (panelId > 1 - o.accentRatio) {
        const k = remap(panelId, 1 - o.accentRatio, 1) * 0.5;
        linR = lerp(linR, panelLin[0], k);
        linG = lerp(linG, panelLin[1], k);
        linB = lerp(linB, panelLin[2], k);
      }

      // 缝内：变暗（不纯黑，保留一点环境反弹）
      const seamDark = 1 - seam * o.seamDarken;
      linR *= seamDark;
      linG *= seamDark;
      linB *= seamDark;

      // 掉漆露出的裸金属：更亮、饱和度更低
      const metalFrom = [grainLin[0] * 1.35, grainLin[1] * 1.35, grainLin[2] * 1.35];
      linR = lerp(linR, metalFrom[0], wear * o.wearReveal);
      linG = lerp(linG, metalFrom[1], wear * o.wearReveal);
      linB = lerp(linB, metalFrom[2], wear * o.wearReveal);

      // 污渍：向土黄色偏移并压暗
      linR = lerp(linR, linR * 0.55 + 0.02, grimeValue(grime, i));
      linG = lerp(linG, linG * 0.52 + 0.018, grimeValue(grime, i));
      linB = lerp(linB, linB * 0.46 + 0.014, grimeValue(grime, i));

      // 强调色细线（仅在部分缝旁边，像检修口标记）
      const trim = remap(panelId, 0.97, 1) * (1 - smoothstep(seamW, seamW * 2.2, distCoarse)) * (1 - smoothstep(seamW, seamW * 2.2, dy1));
      if (o.trimStrength > 0 && trim > 0.01) {
        const k = trim * o.trimStrength;
        linR = lerp(linR, accentLin[0], k);
        linG = lerp(linG, accentLin[1], k);
        linB = lerp(linB, accentLin[2], k);
      }

      baseR[i] = clamp01(linR);
      baseG[i] = clamp01(linG);
      baseB[i] = clamp01(linB);

      /* ——— 6. Roughness ——— */
      let rgh = o.roughBase;
      rgh += (fbm(u, v, Math.round(o.grid * 1.6), 3, seed + 89) - 0.5) * o.roughVar;
      rgh += paintGrain * o.paintRoughJitter;
      rgh += microH * o.roughMicro;
      rgh += grimeValue(grime, i) * o.roughGrime;
      rgh += scratch * o.roughScratch;
      rgh += seam * o.roughSeam;
      // 磨损处被反复摩擦 → 略微抛光
      rgh -= wear * o.polish;
      rough[i] = clamp01(lerp(rgh, o.roughSeamDefault, seam * 0.35));

      /* ——— 7. Metallic ——— */
      let m = o.metalBase + (panelId - 0.5) * o.metalVar;
      m -= grimeValue(grime, i) * o.metalGrimeLoss;
      m -= 0.06 * o.paintDielectric;
      metal[i] = clamp01(m);

      /* ——— 8. Emissive（灯带 / 舷窗 / 散热格栅） ——— */
      let emi = 0;
      if (em.type === 'strips') {
        // 沿面板缝内侧的连续光带，用虚线分段避免从贴图一头亮到另一头
        const band = 1 - smoothstep(em.width ?? 0.02, (em.width ?? 0.02) * 2.1, Math.abs(distCoarse - (em.offset ?? 0.03)));
        const dashCells = em.dashCount ?? 24;
        const dash = valueNoise(u * dashCells, v * dashCells, Math.max(2, Math.round(dashCells)), seed + 97);
        emi = band * smoothstep(0.45, 0.62, dash);
      } else if (em.type === 'windows') {
        // 矩形舷窗阵列，按小块面板排布
        const gx = em.grid ?? 12;
        const fu = u * gx;
        const fv = v * gx;
        const withinU = smoothstep(0.18, 0.30, fu - Math.floor(fu)) * (1 - smoothstep(0.70, 0.82, fu - Math.floor(fu)));
        const withinV = smoothstep(0.18, 0.30, fv - Math.floor(fv)) * (1 - smoothstep(0.70, 0.82, fv - Math.floor(fv)));
        const cellHash = cid(Math.floor(fu), Math.floor(fv), gx, seed + 101);
        const lit = cellHash > (em.density ?? 0.35) ? 1 : 0;
        const flick = 0.75 + cellHash * 0.35;
        emi = withinU * withinV * lit * flick;
      } else if (em.type === 'vents') {
        // 散热格栅：横向百叶，间隔点亮
        const slat = Math.abs(Math.sin(v * Math.PI * (em.count ?? 8)));
        emi = smoothstep(0.82, 1.0, slat) * (remap(fbm(u, v, 4, 3, seed + 103), 0.45, 0.8));
      }
      emi *= em.strength ?? 1;
      emissiveMask[i] = emi;
      emissiveR[i] = emissiveLin[0] * emi;
      emissiveG[i] = emissiveLin[1] * emi;
      emissiveB[i] = emissiveLin[2] * emi;
    }
  }

  /* ——— 9. 后处理：AO / 法线 ——— */
  const ao = cavityAO(height, w, h, {
    inner: Math.max(1, Math.round(o.size / 512)),
    outer: Math.max(4, Math.round(o.size / 90)),
    strength: o.aoStrength,
    gamma: o.aoGamma,
  });
  // 缝的遮蔽比几何差异本身更重要，额外补一层手工 AO
  for (let i = 0; i < n; i++) {
    ao[i] = clamp01(Math.min(ao[i], 1 - seamMask[i] * o.seamAO));
  }

  return {
    width: w,
    height: h,
    height,
    ao,
    roughness: rough,
    metallic: metal,
    seamMask,
    wearMask,
    grime,
    emissiveMask,
    emissiveLin,
    base: [baseR, baseG, baseB],
    emissive: [emissiveR, emissiveG, emissiveB],
  };
}

function grimeValue(grime, i) {
  return grime[i];
}

/** 把线性分量场打包成 sRGB 编码的 Uint8 RGB */
export function packSrgbRGB([r, g, b], n) {
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = Math.round(clamp01(linearToSrgb(r[i])) * 255);
    out[i * 3 + 1] = Math.round(clamp01(linearToSrgb(g[i])) * 255);
    out[i * 3 + 2] = Math.round(clamp01(linearToSrgb(b[i])) * 255);
  }
  return out;
}

/** 把 [0,1] 标量场打包成 Uint8 灰度 */
export function packGray(f, n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(clamp01(f[i]) * 255);
  return out;
}

/** AO(R) + Roughness(G) + Metallic(B) 打包，glTF 标准顺序，省 2/3 采样开销 */
export function packORM(ao, rough, metal, n) {
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = Math.round(clamp01(ao[i]) * 255);
    out[i * 3 + 1] = Math.round(clamp01(rough[i]) * 255);
    out[i * 3 + 2] = Math.round(clamp01(metal[i]) * 255);
  }
  return out;
}

export { blurWrap, srgbToLinear };
