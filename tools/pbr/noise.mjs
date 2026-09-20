/**
 * 可平铺（tileable）程序化噪声工具箱。
 *
 * 设计约束：
 *  - 所有 2D 函数在 u,v ∈ [0,1) 上首尾相接，因此烘焙出来的贴图可以直接 RepeatWrapping 无缝重复；
 *  - 每个倍频的去相关靠「随机偏移 + 90° 旋转 / 镜像」实现（这些变换保持格点，所以仍然可平铺），
 *    而不是任意角度旋转（任意角度会破坏周期性）；
 *  - 3D 版本用于星球球面：直接在球面方向上取噪声，天然无极点扭曲、无接缝。
 */

/* eslint-disable no-bitwise */

/** 整数格点哈希 → [0,1) */
export function hash2(ix, iy, seed) {
  let h = (ix | 0) * 374761393 + (iy | 0) * 668265263 + (seed | 0) * 1013904223;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 3D 整数格点哈希 → [0,1) */
export function hash3(ix, iy, iz, seed) {
  let h = (ix | 0) * 374761393 + (iy | 0) * 668265263 + (iz | 0) * 2147483647 + (seed | 0) * 668265263;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 五次平滑插值曲线 */
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function wrap(i, period) {
  return ((i % period) + period) % period;
}

/**
 * 周期性 value noise。
 * @param x 连续坐标（单位：格）
 * @param period 该方向的格点周期，必须是整数
 */
export function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fade(fx);
  const v = fade(fy);

  const x0 = wrap(xi, period);
  const y0 = wrap(yi, period);
  const x1 = wrap(xi + 1, period);
  const y1 = wrap(yi + 1, period);

  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);

  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return top + (bottom - top) * v;
}

/**
 * 周期性 Worley（cellular）噪声，返回最近特征点距离，范围约 [0, ~1.2]。
 * 用途：铸造金属的晶粒、装甲的凸包、星球表面的岩层裂纹。
 */
export function worley(x, y, period, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = 1e9;
  let f2 = 1e9;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = ix + ox;
      const cy = iy + oy;
      const wx = wrap(cx, period);
      const wy = wrap(cy, period);
      const px = cx + 0.15 + hash2(wx, wy, seed) * 0.7;
      const py = cy + 0.15 + hash2(wx, wy, seed + 7919) * 0.7;
      const dx = px - x;
      const dy = py - y;
      const d = dx * dx + dy * dy;
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1: Math.sqrt(f1), f2: Math.sqrt(f2), edge: Math.sqrt(f2) - Math.sqrt(f1) };
}

/** 周期性 Worley F1（单值版本，热路径开销更小） */
export function worleyF1(x, y, period, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = 1e9;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = ix + ox;
      const cy = iy + oy;
      const wx = wrap(cx, period);
      const wy = wrap(cy, period);
      const px = cx + 0.15 + hash2(wx, wy, seed) * 0.7;
      const py = cy + 0.15 + hash2(wx, wy, seed + 7919) * 0.7;
      const dx = px - x;
      const dy = py - y;
      const d = dx * dx + dy * dy;
      if (d < f1) f1 = d;
    }
  }
  return Math.sqrt(f1);
}

/**
 * 可平铺 FBM。
 * @param u,v ∈ [0,1)
 * @param grid 基础格数（整数）
 */
export function fbm(u, v, grid, octaves, seed, gain = 0.5, lacunarity = 2) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let cells = grid;
  let s = seed;
  for (let o = 0; o < octaves; o++) {
    const c = Math.max(1, Math.round(cells));
    // 每个倍频：随机偏移 + 90° 旋转/镜像（保持周期性，去掉轴对齐感）
    const mode = (hash2(o, 3, seed) * 4) | 0;
    const ox = hash2(o, 11, seed) * c;
    const oy = hash2(o, 23, seed) * c;
    let x = u * c + ox;
    let y = v * c + oy;
    if (mode === 1) {
      const t = x;
      x = y;
      y = c - t;
    } else if (mode === 2) {
      x = c - x;
    } else if (mode === 3) {
      y = c - y;
    }
    sum += amp * valueNoise(x, y, c, s);
    norm += amp;
    amp *= gain;
    cells *= lacunarity;
    s += 131;
  }
  return sum / norm;
}

/** 脊状 FBM：山脊、刮痕、铸造翻砂纹都用它 */
export function ridged(u, v, grid, octaves, seed, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let cells = grid;
  let s = seed;
  for (let o = 0; o < octaves; o++) {
    const c = Math.max(1, Math.round(cells));
    const ox = hash2(o, 41, seed) * c;
    const oy = hash2(o, 57, seed) * c;
    const n = 1 - Math.abs(valueNoise(u * c + ox, v * c + oy, c, s) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    cells *= 2;
    s += 271;
  }
  return sum / norm;
}

/**
 * 各向异性拉伸的 FBM：拉丝金属 / 机加工刀路。
 * stretch > 1 表示沿 V 方向拉长。
 */
export function anisoFbm(u, v, gridX, gridY, octaves, seed) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let cx = gridX;
  let cy = gridY;
  let s = seed;
  for (let o = 0; o < octaves; o++) {
    const a = Math.max(1, Math.round(cx));
    const b = Math.max(1, Math.round(cy));
    const ox = hash2(o, 13, seed) * a;
    const oy = hash2(o, 29, seed) * b;
    sum += amp * valueNoise(u * a + ox, v * b + oy, Math.max(a, b), s);
    norm += amp;
    amp *= 0.55;
    cx *= 2;
    cy *= 2;
    s += 97;
  }
  return sum / norm;
}

/* ——————————————————————————————————————————————
 * 3D 噪声：星球专用（球面采样，无极点扭曲 / 无接缝）
 * —————————————————————————————————————————————— */

export function valueNoise3(x, y, z, period, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);

  const x0 = wrap(ix, period);
  const y0 = wrap(iy, period);
  const z0 = wrap(iz, period);
  const x1 = wrap(ix + 1, period);
  const y1 = wrap(iy + 1, period);
  const z1 = wrap(iz + 1, period);

  const c000 = hash3(x0, y0, z0, seed);
  const c100 = hash3(x1, y0, z0, seed);
  const c010 = hash3(x0, y1, z0, seed);
  const c110 = hash3(x1, y1, z0, seed);
  const c001 = hash3(x0, y0, z1, seed);
  const c101 = hash3(x1, y0, z1, seed);
  const c011 = hash3(x0, y1, z1, seed);
  const c111 = hash3(x1, y1, z1, seed);

  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0v = x00 + (x10 - x00) * fy;
  const y1v = x01 + (x11 - x01) * fy;
  return y0v + (y1v - y0v) * fz;
}

/** 3D 脊状 FBM：大陆山脉走向 */
export function ridged3(x, y, z, grid, octaves, seed, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let cells = grid;
  let s = seed;
  for (let o = 0; o < octaves; o++) {
    const c = Math.max(1, Math.round(cells));
    const n = 1 - Math.abs(valueNoise3(x * c, y * c, z * c, c, s) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    cells *= 2;
    s += 331;
  }
  return sum / norm;
}

/** 3D FBM */
export function fbm3(x, y, z, grid, octaves, seed, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let cells = grid;
  let s = seed;
  for (let o = 0; o < octaves; o++) {
    const c = Math.max(1, Math.round(cells));
    sum += amp * valueNoise3(x * c, y * c, z * c, c, s);
    norm += amp;
    amp *= gain;
    cells *= 2;
    s += 197;
  }
  return sum / norm;
}
