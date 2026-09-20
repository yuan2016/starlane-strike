/**
 * 标量场（Float32Array，值域一般 [0,1]）处理工具。
 *
 * 所有卷积都使用 **环绕（wrap）** 边界，保证卷积结果依旧可平铺 —— 这是
 * 法线与 AO 能跟着贴图一起无缝重复的前提。
 */

export function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** 创建场 */
export function field(n) {
  return new Float32Array(n);
}

/** 可分离式环绕盒式模糊（半径以像素为单位） */
export function blurWrap(src, w, h, radius) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const r = Math.max(1, radius | 0);
  const invW = 1 / (r * 2 + 1);

  // 横向
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + (((k % w) + w) % w)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum * invW;
      const add = (x + r + 1) % w;
      const sub = (((x - r) % w) + w) % w;
      sum += src[row + add] - src[row + sub];
    }
  }
  // 纵向
  const invH = 1 / (r * 2 + 1);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[(((k % h) + h) % h) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum * invH;
      const add = ((y + r + 1) % h) * w + x;
      const sub = ((((y - r) % h) + h) % h) * w + x;
      sum += tmp[add] - tmp[sub];
    }
  }
  return out;
}

/**
 * AO（空腔）近似：局的均值之差。
 *
 * AO ≈ 1 - clamp( (大半径模糊 - 小半径模糊) ), JB: 凹处低于周围平均水平 → 变暗。
 * 再叠加整体 × seam 的指数曲线，让面板缝比"平缓颜色变化"暗更多。
 */
export function cavityAO(height, w, h, { inner = 2, outer = 14, strength = 1.6, gamma = 1.35 } = {}) {
  const n = w * h;
  const narrow = blurWrap(height, w, h, inner);
  const wide = blurWrap(height, w, h, outer);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const delta = wide[i] - narrow[i]; // 凹为正
    let ao = 1 - clamp01(delta * strength);
    ao = Math.pow(clamp01(ao), gamma);
    out[i] = clamp01(ao);
  }
  return out;
}

/**
 * 高度场 → 切线空间法线贴图（OpenGL 约定：+Y 向上）。
 * 用 Sobel 算子，环绕取样保证无缝。
 */
export function normalFromHeight(height, w, h, strength = 2.0, outRGB = null) {
  const rgb = outRGB ?? new Uint8Array(w * h * 3);
  const at = (x, y) => height[(((y % h) + h) % h) * w + (((x % w) + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel
      const tl = at(x - 1, y - 1);
      const t = at(x, y - 1);
      const tr = at(x + 1, y - 1);
      const l = at(x - 1, y);
      const r = at(x + 1, y);
      const bl = at(x - 1, y + 1);
      const b = at(x, y + 1);
      const br = at(x + 1, y + 1);

      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;

      const i = (y * w + x) * 3;
      rgb[i] = Math.round((nx * 0.5 + 0.5) * 255);
      rgb[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      rgb[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  return rgb;
}

/** 2 倍降采样（均值），用于生成半尺寸 LOD 贴图 */
export function downsample2(src, w, h) {
  const dw = w >> 1;
  const dh = h >> 1;
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const i = (y * 2) * w + x * 2;
      out[y * dw + x] = (src[i] + src[i + 1] + src[i + w] + src[i + w + 1]) * 0.25;
    }
  }
  return { data: out, width: dw, height: dh };
}

/** RGB Uint8 缓冲降采样（给已经合成好的颜色 / 法线贴图用） */
export function downsample2RGB(rgb, w, h) {
  const dw = w >> 1;
  const dh = h >> 1;
  const out = new Uint8Array(dw * dh * 3);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      for (let c = 0; c < 3; c++) {
        const i00 = ((y * 2) * w + x * 2) * 3 + c;
        const i10 = ((y * 2) * w + x * 2 + 1) * 3 + c;
        const i01 = ((y * 2 + 1) * w + x * 2) * 3 + c;
        const i11 = ((y * 2 + 1) * w + x * 2 + 1) * 3 + c;
        out[(y * dw + x) * 3 + c] = (rgb[i00] + rgb[i10] + rgb[i01] + rgb[i11]) >> 2;
      }
    }
  }
  return { data: out, width: dw, height: dh };
}

/** Uint8 灰度图降采样，用于生成低一级的贴图 LOD */
export function downsampleGrayU8(px, w, h) {
  const dw = w >> 1;
  const dh = h >> 1;
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const i = y * 2 * w + x * 2;
      out[y * dw + x] = (px[i] + px[i + 1] + px[i + w] + px[i + w + 1]) >> 2;
    }
  }
  return { data: out, width: dw, height: dh };
}

/** Uint8 RGBA 降采样（云层这类） */
export function downsample2RGBA(rgba, w, h) {
  const dw = w >> 1;
  const dh = h >> 1;
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let a = 0;
      for (let c = 0; c < 4; c++) {
        const i00 = ((y * 2) * w + x * 2) * 4 + c;
        const i10 = ((y * 2) * w + x * 2 + 1) * 4 + c;
        const i01 = ((y * 2 + 1) * w + x * 2) * 4 + c;
        const i11 = ((y * 2 + 1) * w + x * 2 + 1) * 4 + c;
        out[(y * dw + x) * 4 + c] = (rgba[i00] + rgba[i10] + rgba[i01] + rgba[i11]) >> 2;
        if (c === 3) a = 0;
      }
    }
  }
  return { data: out, width: dw, height: dh };
}

/**
 * 把两个场按 mask 混合。
 * out = a * (1-m) + b * m
 */
export function mixField(a, b, mask) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * mask[i];
  return out;
}

/** sRGB → 线性（用于按物理方式混合颜色） */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** 线性 → sRGB（写回 BaseColor 贴图前必须做） */
export function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function hexToLinear(hex) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

/** 给 Emissive 贴图用的色调过渡（沿 0..1 渐变在若干色标之间插值） */
export function rampColor(stops, t) {
  const x = clamp01(t);
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (x >= p0 && x <= p1) {
      const k = (x - p0) / Math.max(1e-6, p1 - p0);
      return [lerp(c0[0], c1[0], k), lerp(c0[1], c1[1], k), lerp(c0[2], c1[2], k)];
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * 给 fbm 等返回值做重映射，突出某个区间，避免出现"整张图一个亮度"。
 */
export function remap(v, inMin, inMax) {
  return clamp01((v - inMin) / (inMax - inMin));
}
