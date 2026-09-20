/**
 * 星球材质系统（等距圆柱投影 / Equirectangular）。
 *
 * 关键点：**噪声直接在球面方向上取样（3D value noise）**，而不是先在平面上做 2D 噪声再贴到球上。
 * 这样天然没有极点挤压、也没有 0°/360° 接缝，更不存在"重复纹理"。
 *
 * UV 约定与 Three.js SphereGeometry 对齐：
 *   uv.y = 1 → 北极，配合 flipY=true，图片第一行 = 北极。
 *
 * 输出通道：
 *   albedo(3) / normal(3) / roughness(1) / metalness(1) / ao(1) / height(1) / night(3)
 */

import { fbm3, ridged3, valueNoise3, hash2 } from './noise.mjs';
import {
  clamp01, lerp, smoothstep, remap, linearToSrgb, srgbToLinear, blurWrap, cavityAO, hexToLinear,
} from './image.mjs';

function dirFromUV(u, v) {
  const lon = (u - 0.5) * Math.PI * 2;
  const lat = Math.PI * 0.5 - v * Math.PI; // v=0 → 北极
  const cl = Math.cos(lat);
  return [cl * Math.cos(lon), Math.sin(lat), cl * Math.sin(lon)];
}

/** 域扭曲：让大陆边缘不规则，避免"噪声球"的经典塑料感 */
function warpDir(dx, dy, dz, seed) {
  const wx = fbm3(dx * 1.7, dy * 1.7, dz * 1.7, 3, 2, seed + 1) - 0.5;
  const wy = fbm3(dx * 1.7 + 11, dy * 1.7 - 5, dz * 1.7 + 3, 3, 2, seed + 2) - 0.5;
  const wz = fbm3(dx * 1.7 - 7, dy * 1.7 + 9, dz * 1.7 - 13, 3, 2, seed + 3) - 0.5;
  // 0.30：足以让大陆边缘不规则，但不会出现"大理石纹"
  return [dx + wx * 0.3, dy + wy * 0.3, dz + wz * 0.3];
}

/**
 * @param opts.width 贴图宽度（高度 = width/2）
 */
export function bakePlanet(opts) {
  const W = opts.width;
  const H = opts.width >> 1;
  const n = W * H;
  const seed = opts.seed ?? 1;
  const sea = opts.seaLevel ?? 0.5;

  const pal = opts.palette;
  const cDeep = hexToLinear(pal.deep);
  const cShallow = hexToLinear(pal.shallow);
  const cSand = hexToLinear(pal.sand);
  const cLow = hexToLinear(pal.low);
  const cMid = hexToLinear(pal.mid);
  const cHigh = hexToLinear(pal.high);
  const cPeak = hexToLinear(pal.peak);
  const cNight = hexToLinear(pal.night);

  const elevation = new Float32Array(n); // 陆面高度（含海面以下）
  const slope = new Float32Array(n);
  const albedo = new Uint8Array(n * 3);
  const rough = new Float32Array(n);
  const metal = new Float32Array(n);
  const night = new Uint8Array(n * 3);

  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const lat = Math.PI * 0.5 - v * Math.PI;
    const latAbs = Math.abs(Math.sin(lat)); // 0 赤道 → 1 极
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = x / W;
      const [dx, dy, dz] = dirFromUV(u === 1 ? 0 : u, v);
      const [wx, wy, wz] = warpDir(dx, dy, dz, seed);

      /* —— 大尺度：大陆 —— */
      let cont = fbm3(wx * 1.05, wy * 1.05, wz * 1.05, 3, 5, seed + 11, 0.52);
      // 抬升对比：造成更明确的海洋/陆地边界
      cont = clamp01(remap(cont, 0.32, 0.72));

      /* —— 中尺度：山脉带 —— */
      const belt = smoothstep(sea + 0.02, sea + 0.30, cont);
      const mountains = ridged3(wx * 2.6, wy * 2.6, wz * 2.6, 5, 5, seed + 23, 0.55);
      const mnt = Math.pow(clamp01(mountains), 1.6) * belt * 0.55;

      /* —— 小尺度：地表碎裂 —— */
      const detail = fbm3(wx * 9.5, wy * 9.5, wz * 9.5, 10, 3, seed + 37, 0.55) - 0.5;
      const fine = fbm3(wx * 26, wy * 26, wz * 26, 20, 2, seed + 41, 0.6) - 0.5;

      let h = cont + mnt * 0.55 + detail * 0.035 + fine * 0.012;
      // 极地冰盖：用噪声把冰盖边缘打散，避免出现"上下两条整齐白带"
      const capNoise = detail * 0.6 + fine * 0.4;
      const polar = smoothstep(0.82, 0.95, latAbs + capNoise * 0.12);
      h = lerp(h, Math.max(h, sea + 0.06), polar * 0.85);
      elevation[i] = h;

      const above = h - sea; // >0 为陆地

      /* —— BaseColor —— */
      let lr; let lg; let lb;
      // 雪线与冰盖在后面 Roughness 还要用，必须先于分支声明
      // 雪只在"高海拔 × 高纬度"同时成立时出现，避免热带出现大块白斑
      const cold = smoothstep(0.28, 0.7, latAbs);
      const snow = above > 0 ? smoothstep(0.46, 0.58, above) * smoothstep(0.24, 0.52, mnt) * (0.2 + 0.8 * cold) : 0;
      const ice = smoothstep(0.86, 0.97, latAbs + capNoise * 0.08);
      if (above <= 0) {
        // 海洋：近岸浅 → 远洋深，叠一点洋流色差
        const depth = clamp01(-above / 0.32);
        const current = 0.5 + detail * 0.8;
        lr = lerp(cShallow[0], cDeep[0], depth) * (0.94 + current * 0.12);
        lg = lerp(cShallow[1], cDeep[1], depth) * (0.94 + current * 0.12);
        lb = lerp(cShallow[2], cDeep[2], depth) * (0.94 + current * 0.12);
      } else {
        const beach = 1 - smoothstep(0.0, 0.045, above);
        const lowK = smoothstep(0.0, 0.16, above);
        const highK = smoothstep(0.16, 0.34, above);
        const peakK = smoothstep(0.32, 0.44, above);
        // 纬度植被带：赤道偏暖、极地偏冷
        const aridity = clamp01(Math.abs(latAbs - 0.35) * 1.7) * 0.55;
        const biome = clamp01(detail * 1.6 + 0.5);
        const dryness = clamp01(aridity + (1 - biome) * 0.35);

        lr = lerp(cSand[0], cLow[0], lowK);
        lg = lerp(cSand[1], cLow[1], lowK);
        lb = lerp(cSand[2], cLow[2], lowK);
        lr = lerp(lr, lerp(cLow[0], cSand[0], dryness), 0.65);
        lg = lerp(lg, lerp(cLow[1], cSand[1], dryness), 0.65);
        lb = lerp(lb, lerp(cLow[2], cSand[2], dryness), 0.65);

        lr = lerp(lr, cMid[0], highK);
        lg = lerp(lg, cMid[1], highK);
        lb = lerp(lb, cMid[2], highK);

        // 高处裸岩 + 雪线
        lr = lerp(lr, cHigh[0], peakK);
        lg = lerp(lg, cHigh[1], peakK);
        lb = lerp(lb, cHigh[2], peakK);
        lr = lerp(lr, cPeak[0], snow);
        lg = lerp(lg, cPeak[1], snow);
        lb = lerp(lb, cPeak[2], snow);
        // 海岸线沙带
        lr = lerp(cSand[0], lr, 1 - beach * 0.75);
        lg = lerp(cSand[1], lg, 1 - beach * 0.75);
        lb = lerp(cSand[2], lb, 1 - beach * 0.75);
        // 岩层纹理：不参与高度，只做颜色颗粒变化
        const strat = 0.94 + fine * 0.35 + detail * 0.18;
        lr *= strat; lg *= strat; lb *= strat;
      }

      // 冰盖
      lr = lerp(lr, 0.86, ice * 0.92);
      lg = lerp(lg, 0.90, ice * 0.92);
      lb = lerp(lb, 0.95, ice * 0.92);

      albedo[i * 3] = Math.round(clamp01(linearToSrgb(clamp01(lr))) * 255);
      albedo[i * 3 + 1] = Math.round(clamp01(linearToSrgb(clamp01(lg))) * 255);
      albedo[i * 3 + 2] = Math.round(clamp01(linearToSrgb(clamp01(lb))) * 255);

      /* —— Roughness —— */
      if (above <= 0) {
        // 海面：镜面 + 一点点风浪造成的粗糙
        rough[i] = clamp01(0.06 + clamp01(-above) * 0.06 + detail * 0.05);
      } else {
        let r = lerp(0.82, 0.95, clamp01(above * 2.2));
        r -= Math.max(0, detail) * 0.12;
        r = lerp(r, 0.42, snow * 0.6);
        r = lerp(r, 0.30, ice * 0.9);
        rough[i] = clamp01(r);
      }

      /* —— Metallic：星球是电介质，这里只给极稀薄的金属矿脉 —— */
      const vein = smoothstep(0.86, 0.965, ridged3(wx * 5.5, wy * 5.5, wz * 5.5, 4, 3, seed + 53));
      metal[i] = clamp01(vein * (above > 0 ? 0.22 : 0));

      /* —— 夜面城市灯 —— */
      if (opts.nightLights) {
        // 宜居度：靠海、海拔适中、坡度平缓、不太极地
        const habit =
          (above > 0.002 && above < 0.26 ? 1 : 0) *
          (1 - smoothstep(0.10, 0.22, Math.abs(above - 0.10))) *
          (1 - smoothstep(0.55, 0.85, latAbs));
        if (habit > 0) {
          // 城市群：中频聚拢
          const clusterV = fbm3(wx * 4.5, wy * 4.5, wz * 4.5, 6, 3, seed + 61, 0.6);
          const cluster = smoothstep(0.54, 0.80, clusterV);
          // 单个像素当作一个街区：用像素哈希做稀疏点亮
          const grid = Math.max(2, Math.round(W / 512) * 2);
          const rnd = hash2(Math.floor(u * W / grid), Math.floor(v * H / grid), seed + 71);
          const lights = smoothstep(0.985 - cluster * 0.35, 1.0, rnd * (0.6 + cluster * 0.8));
          const bright = lights * habit * cluster * (0.55 + rnd * 0.45);
          // 一点点郊区弥散光
          const halo = cluster * habit * 0.10;
          const k = clamp01(bright + halo);
          night[i * 3] = Math.round(clamp01(linearToSrgb(clamp01(cNight[0] * k * 1.6))) * 255);
          night[i * 3 + 1] = Math.round(clamp01(linearToSrgb(clamp01(cNight[1] * k * 1.6))) * 255);
          night[i * 3 + 2] = Math.round(clamp01(linearToSrgb(clamp01(cNight[2] * k * 1.6))) * 255);
        }
      }
    }
  }

  /* —— 坡度 / 法线 —— */
  const unitU = (Math.PI * 2) / W;
  const unitV = Math.PI / H;
  const normal = new Uint8Array(n * 3);
  const strength = opts.normalStrength ?? 2.6;
  const relief = opts.reliefScale ?? 90; // 高度差换算到球面上的"陡峭度"
  const at = (xx, yy) => {
    const col = ((xx % W) + W) % W;
    const row = Math.max(0, Math.min(H - 1, yy));
    return elevation[row * W + col];
  };

  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const lat = Math.PI * 0.5 - v * Math.PI;
    const cosLat = Math.max(0.08, Math.cos(lat));
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const hL = at(x - 1, y);
      const hR = at(x + 1, y);
      const hD = at(x, y + 1);
      const hU = at(x, y - 1);
      // 洋面保持平整的海平面切线
      const center = elevation[i];
      const mask = smoothstep(sea - 0.004, sea + 0.004, center);
      const dhdx = ((hR - hL) / (2 * unitU * cosLat)) * relief * mask;
      const dhdy = ((hD - hU) / (2 * unitV)) * relief * mask;
      let nx = -dhdx * strength * 0.01;
      let ny = -dhdy * strength * 0.01;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len;
      const zi = nz / len;
      normal[i * 3] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[i * 3 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[i * 3 + 2] = Math.round((zi * 0.5 + 0.5) * 255);
      slope[i] = clamp01(Math.hypot(dhdx, dhdy) * 0.02);
    }
  }

  /* —— AO：山脊、峡谷的自遮蔽（大尺度，给星球真实的体积与洼陷感）—— */
  const landHeight = new Float32Array(n);
  for (let i = 0; i < n; i++) landHeight[i] = elevation[i] > sea ? elevation[i] - sea : 0;
  const ao = cavityAO(landHeight, W, H, { inner: 1, outer: Math.max(3, W >> 7), strength: 6.5, gamma: 0.85 });
  for (let i = 0; i < n; i++) ao[i] = clamp01(lerp(1, ao[i], 0.55) - slope[i] * 0.12);

  return {
    width: W,
    height: H,
    elevation,
    albedo,
    normal,
    roughness: rough,
    metallic: metal,
    ao,
    night,
  };
}

/**
 * 云层：域扭曲的分带湍流。
 * 输出 RGBA（A = 覆盖率），alpha 边缘柔和，可直接作为 map + transparent 使用。
 */
export function bakeClouds(width, seed = 5, tint = 0xffffff) {
  const W = width;
  const H = width >> 1;
  const n = W * H;
  const rgba = new Uint8Array(n * 4);
  const c = hexToLinear(tint);

  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const lat = Math.PI * 0.5 - v * Math.PI;
    const latAbs = Math.abs(Math.sin(lat));
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = x / W;
      const [dx, dy, dz] = dirFromUV(u === 1 ? 0 : u, v);
      const [wx, wy, wz] = warpDir(dx, dy, dz, seed + 91);

      let base = fbm3(wx * 2.1, wy * 2.1, wz * 2.1, 4, 5, seed + 3, 0.55);
      // 纬向环流：赤道辐合带 + 中纬风暴带，做出真实的条带状分布
      const band = 0.5 + 0.5 * Math.cos(latAbs * Math.PI * 3.1);
      base = clamp01(base * (0.62 + band * 0.62));
      const wisp = ridged3(wx * 7.0, wy * 7.0, wz * 7.0, 8, 4, seed + 13, 0.6);
      const d = fbm3(wx * 14, wy * 14, wz * 14, 12, 2, seed + 17, 0.6);

      // 覆盖率阈值 → 软边（不是硬 clear-cut）
      let a = smoothstep(0.50, 0.72, base) * (0.65 + wisp * 0.5);
      a *= 0.85 + d * 0.35;
      a = clamp01(a * 0.95);

      // 云顶亮 / 云底暗（用双层视差近似，比纯 alpha 有体积感）
      const lit = clamp01(0.72 + wisp * 0.35 + d * 0.12);
      rgba[i * 4] = Math.round(clamp01(linearToSrgb(clamp01(c[0] * lit))) * 255);
      rgba[i * 4 + 1] = Math.round(clamp01(linearToSrgb(clamp01(c[1] * lit))) * 255);
      rgba[i * 4 + 2] = Math.round(clamp01(linearToSrgb(clamp01(c[2] * lit))) * 255);
      rgba[i * 4 + 3] = Math.round(a * 255);
    }
  }
  return { width: W, height: H, rgba };
}

export { blurWrap, srgbToLinear };
