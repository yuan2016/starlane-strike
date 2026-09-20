import * as THREE from 'three';
import {
  configurePbrAssets,
  createBakedEnergyTexture,
  createBakedEngineHeatTexture,
  createBakedEngineMaps,
  createBakedCanopyMaps,
  createBakedPlanetMaps,
  createBakedSurfaceMaps,
} from './PbrAssets';
import type { QualitySettings } from './Quality';

/**
 * 程序化贴图库：全部用 Canvas / 像素运算在运行时生成，不依赖任何外部图片资源。
 * 所有贴图全局缓存复用（机型切换、敌机复用实例都不会重复生成或重复上传显存）。
 *
 * 约定：
 *  - 颜色贴图（map / emissiveMap）标记 sRGB；
 *  - 数据贴图（roughnessMap / normalMap / alphaMap）保持线性；
 *  - 灰度贴图以"接近白色"为基准，material.color 仍然决定最终色相，避免贴图把配色写死。
 */

let anisotropy = 4;
let baseSize = 1024;

export function configureProceduralTextures(settings: QualitySettings): void {
  anisotropy = Math.max(1, settings.anisotropy);
  baseSize = settings.textureSize;
  // 烘焙 PBR 资产与程序化贴图共用同一套档位 / 各向异性设置
  configurePbrAssets(settings);
}

// ——————————————————————————————————————————————————————————
// 基础工具
// ——————————————————————————————————————————————————————————

function canvas2d(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('[ProcTextures] 无法创建 2D 上下文');
  return ctx;
}

function toTexture(
  ctx: CanvasRenderingContext2D,
  opts: { srgb?: boolean; repeat?: number; wrap?: THREE.Wrapping } = {},
): THREE.Texture {
  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.wrapS = opts.wrap ?? THREE.RepeatWrapping;
  texture.wrapT = opts.wrap ?? THREE.RepeatWrapping;
  if (opts.srgb) texture.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat && opts.repeat !== 1) texture.repeat.set(opts.repeat, opts.repeat);
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** 平滑插值（smoothstep） */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-5));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function makeLattice(gw: number, gh: number, seed: number): Float32Array {
  const lat = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) lat[y * gw + x] = hash2(x, y, seed);
  }
  return lat;
}

/** 采样 value noise：u 方向环绕（经度无缝），v 方向夹紧（极点） */
function sampleLattice(lat: Float32Array, gw: number, gh: number, u: number, v: number): number {
  const fx = u * gw;
  const fy = v * gh;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const x0w = ((x0 % gw) + gw) % gw;
  const x1w = (x0w + 1) % gw;
  const y0c = Math.min(Math.max(y0, 0), gh - 1);
  const y1c = Math.min(y0c + 1, gh - 1);
  const a = lat[y0c * gw + x0w];
  const b = lat[y0c * gw + x1w];
  const c = lat[y1c * gw + x0w];
  const d = lat[y1c * gw + x1w];
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
}

/** 双线性采样（低频场可以低分辨率生成再放大，省掉大面积逐像素噪声计算） */
function sampleField(field: Float32Array, res: number, u: number, v: number): number {
  const fx = u * res - 0.5;
  const fy = v * res - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const cx0 = ((x0 % res) + res) % res;
  const cx1 = (cx0 + 1) % res;
  const cy0 = Math.min(Math.max(y0, 0), res - 1);
  const cy1 = Math.min(cy0 + 1, res - 1);
  const a = field[cy0 * res + cx0];
  const b = field[cy0 * res + cx1];
  const c = field[cy1 * res + cx0];
  const d = field[cy1 * res + cx1];
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

interface FbmOptions {
  width: number;
  height: number;
  octaves: number;
  baseGridX: number;
  seed: number;
  gain?: number;
  /** > 1 增强对比 */
  contrast?: number;
}

function fbmField(o: FbmOptions): Float32Array {
  const gain = o.gain ?? 0.5;
  const contrast = o.contrast ?? 1;
  const out = new Float32Array(o.width * o.height);
  const layers: { lat: Float32Array; gw: number; gh: number; amp: number }[] = [];
  let amp = 1;
  let total = 0;
  for (let i = 0; i < o.octaves; i++) {
    const gw = o.baseGridX * Math.pow(2, i);
    const gh = Math.max(2, Math.round(o.baseGridX * 0.5 * Math.pow(2, i)));
    layers.push({ lat: makeLattice(gw, gh, o.seed + i * 17), gw, gh, amp });
    total += amp;
    amp *= gain;
  }
  for (let y = 0; y < o.height; y++) {
    const v = y / o.height;
    for (let x = 0; x < o.width; x++) {
      const u = x / o.width;
      let sum = 0;
      for (const layer of layers) sum += sampleLattice(layer.lat, layer.gw, layer.gh, u, v) * layer.amp;
      const value = sum / total;
      out[y * o.width + x] = contrast === 1 ? value : clamp01((value - 0.5) * contrast + 0.5);
    }
  }
  return out;
}

/** 高度场 → 切线空间法线贴图（x 方向环绕） */
function heightToNormal(height: Float32Array, w: number, h: number, strength: number): THREE.Texture {
  const ctx = canvas2d(w, h);
  const img = ctx.createImageData(w, h);
  const at = (x: number, y: number): number =>
    height[(((y % h) + h) % h) * w + (((x % w) + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const i = (y * w + x) * 4;
      img.data[i + 0] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(ctx, { wrap: THREE.RepeatWrapping });
}

function downsample(src: Float32Array, w: number, h: number): { data: Float32Array; w: number; h: number } {
  const dw = Math.max(2, w >> 1);
  const dh = Math.max(2, h >> 1);
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const x0 = Math.min(x * 2, w - 1);
      const y0 = Math.min(y * 2, h - 1);
      out[y * dw + x] =
        (src[y0 * w + x0] + src[y0 * w + Math.min(x0 + 1, w - 1)] +
          src[Math.min(y0 + 1, h - 1) * w + x0] + src[Math.min(y0 + 1, h - 1) * w + Math.min(x0 + 1, w - 1)]) *
        0.25;
    }
  }
  return { data: out, w: dw, h: dh };
}

// ——————————————————————————————————————————————————————————
// 金属 / 装甲：面板缝、铆钉、拉丝、轻微磨损
// ——————————————————————————————————————————————————————————

export interface SurfaceMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  /** 灯带 / 舷窗等发光遮罩（可选） */
  emissiveMap?: THREE.Texture;
  /** 环境遮蔽（烘焙 PBR 时提供，程序化回退时缺省） */
  aoMap?: THREE.Texture;
  /** 金属度遮罩（烘焙 PBR 时提供） */
  metalnessMap?: THREE.Texture;
}

export type SurfaceKind = 'hull' | 'armor' | 'dark' | 'bossHull' | 'bossPlate' | 'enemy';

interface PanelOptions {
  size: number;
  grid: number;
  seam: number;
  rivets: boolean;
  grime: number;
  brushed: number;
  repeat: number;
  seed: number;
  roughnessBase: number;
  roughnessVar: number;
  emissive?: 'strip' | 'window';
}

function buildPanelMaps(o: PanelOptions): SurfaceMaps {
  const size = o.size;
  const colorCtx = canvas2d(size, size);
  const roughCtx = canvas2d(size, size);
  const colorImg = colorCtx.createImageData(size, size);
  const roughImg = roughCtx.createImageData(size, size);
  const height = new Float32Array(size * size);

  // 噪声场用较低分辨率生成再双线性放大：低频细节足够，生成成本降到 1/4
  const noiseRes = Math.min(size, 512);
  const noise = fbmField({ width: noiseRes, height: noiseRes, octaves: 3, baseGridX: 8, seed: o.seed + 5 });
  const fine = fbmField({ width: noiseRes, height: noiseRes, octaves: 2, baseGridX: 32, seed: o.seed + 61 });
  const rivetR = 0.055;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;

      // 面板网格
      const px = u * o.grid;
      const py = v * o.grid;
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      const fx = px - ix;
      const fy = py - iy;
      const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
      const groove = 1 - smoothstep(0, o.seam, edge);

      // 每块面板轻微色差，避免"一整块纯色"
      const panelTone = 0.93 + (hash2(ix, iy, o.seed) - 0.5) * 0.16;

      // 铆钉：面板角上的小凸起
      let rivet = 0;
      if (o.rivets) {
        const dc = Math.min(
          Math.hypot(fx - 0.06, fy - 0.06),
          Math.hypot(fx - 0.94, fy - 0.94),
          Math.hypot(fx - 0.06, fy - 0.94),
          Math.hypot(fx - 0.94, fy - 0.06),
        );
        if (dc < rivetR) rivet = 1 - dc / rivetR;
      }

      const n = sampleField(noise, noiseRes, u, v);
      const f = sampleField(fine, noiseRes, u, v);
      const grimeV = Math.max(0, n - 0.45) * o.grime;
      // 拉丝：沿 U 方向的高频条纹（只影响粗糙度，颜色几乎不动）
      const streak = o.brushed > 0 ? (Math.sin(v * size * 0.55 + f * 8) * 0.5 + 0.5) * o.brushed : 0;

      let color = 0.86 * panelTone;
      color *= 1 - groove * 0.5;
      color *= 1 - grimeV * 0.4;
      color += rivet * 0.14 + streak * 0.05 + (f - 0.5) * 0.05;
      color = clamp01(color);

      let rough = o.roughnessBase + (n - 0.5) * o.roughnessVar + groove * 0.32 + grimeV * 0.5 + streak * 0.16;
      rough -= rivet * 0.12;
      rough = clamp01(rough);

      let h = 0.5 + (panelTone - 1) * 1.2 - groove * 1.1 + (n - 0.5) * 0.35 + rivet * 0.7 + (f - 0.5) * 0.12;
      height[i] = clamp01(h);

      const p = i * 4;
      const c = (color * 255) | 0;
      colorImg.data[p + 0] = c;
      colorImg.data[p + 1] = c;
      colorImg.data[p + 2] = c;
      colorImg.data[p + 3] = 255;
      const r = (rough * 255) | 0;
      roughImg.data[p + 0] = r;
      roughImg.data[p + 1] = r;
      roughImg.data[p + 2] = r;
      roughImg.data[p + 3] = 255;
    }
  }

  colorCtx.putImageData(colorImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);

  const maps: SurfaceMaps = {
    map: toTexture(colorCtx, { srgb: true, repeat: o.repeat }),
    roughnessMap: toTexture(roughCtx, { repeat: o.repeat }),
    normalMap: heightToNormal(height, size, size, 1.6),
  };
  maps.normalMap.repeat.set(o.repeat, o.repeat);

  if (o.emissive === 'strip') maps.emissiveMap = buildStripTexture();
  if (o.emissive === 'window') maps.emissiveMap = buildWindowTexture();
  return maps;
}

/** 机体灯带：极暗底 + 几条细亮线，只让"该亮的地方亮" */
function buildStripTexture(): THREE.Texture {
  const size = 256;
  const ctx = canvas2d(size, size);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#ffffff';
  ctx.shadowColor = '#9fd8ff';
  ctx.shadowBlur = 6;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.22);
  ctx.lineTo(size, size * 0.22);
  ctx.moveTo(0, size * 0.78);
  ctx.lineTo(size, size * 0.78);
  ctx.stroke();
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(size * 0.12, size * 0.5);
  ctx.lineTo(size * 0.44, size * 0.5);
  ctx.moveTo(size * 0.6, size * 0.5);
  ctx.lineTo(size * 0.88, size * 0.5);
  ctx.stroke();
  return toTexture(ctx, { srgb: true, repeat: 1 });
}

/** 舰体舷窗：一排排小窗，给大型舰增加体量感 */
function buildWindowTexture(): THREE.Texture {
  const size = 256;
  const ctx = canvas2d(size, size);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  ctx.shadowColor = '#8fd0ff';
  ctx.shadowBlur = 5;
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 10; col++) {
      if ((row * 7 + col * 3) % 5 === 0) continue;
      const brightness = 0.35 + hash2(row, col, 991) * 0.65;
      ctx.fillStyle = `rgba(${140 * brightness},${205 * brightness},255,${brightness})`;
      const w = 10;
      const h = 5;
      ctx.fillRect(col * 25 + 6, row * 40 + 14, w, h);
    }
  }
  return toTexture(ctx, { srgb: true, repeat: 1 });
}

// ——————————————————————————————————————————————————————————
// 发光 / 能量类
// ——————————————————————————————————————————————————————————

/** 能量核心：中心亮、边缘略暗（最低亮度可调，保证整体仍然发光） */
function buildEnergyTexture(minLevel: number): THREE.Texture {
  const size = 128;
  const ctx = canvas2d(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, `rgba(255,255,255,${minLevel})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(ctx, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

/** 发动机高温金属：沿轴向的冷热渐变（v=1 一侧为喷口高温端） */
function buildEngineHeatTexture(): THREE.Texture {
  const w = 64;
  const h = 128;
  const ctx = canvas2d(w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.18, '#ffb066');
  g.addColorStop(0.45, '#8c3a12');
  g.addColorStop(0.75, '#231109');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // 环向轻微不均，避免死板的纯渐变
  const img = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = 0.75 + Math.sin(x * 0.7) * 0.12 + hash2(x, y, 33) * 0.18;
      const i = (y * w + x) * 4;
      img.data[i + 0] = Math.min(255, img.data[i + 0] * n);
      img.data[i + 1] = Math.min(255, img.data[i + 1] * n);
      img.data[i + 2] = Math.min(255, img.data[i + 2] * n);
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(ctx, { srgb: true });
}

/** 六边形能量网（护盾） */
function buildHexTexture(): THREE.Texture {
  const size = 256;
  const ctx = canvas2d(size, size);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  const r = 26;
  const dx = r * 1.5;
  const dy = r * Math.sqrt(3);
  ctx.beginPath();
  for (let row = -1; row * (dy / 2) < size + dy; row++) {
    for (let col = -1; col * dx < size + dx; col++) {
      const cx = col * dx;
      const cy = row * dy + (col % 2 === 0 ? 0 : dy / 2);
      for (let k = 0; k < 6; k++) {
        const a0 = (Math.PI / 3) * k;
        const a1 = (Math.PI / 3) * (k + 1);
        ctx.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
        ctx.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
      }
    }
  }
  ctx.stroke();
  return toTexture(ctx, { wrap: THREE.RepeatWrapping });
}

/**
 * 科技回路图：黑底 + 青色发光走线（Boss 机翼的 emissiveMap）。
 *
 * 生成思路：
 *  1. 在 cells × cells 网格上做曼哈顿随机游走，得到轴对齐折线；
 *  2. 每个拐角切成 45° 双点倒角 —— PCB 走线的经典斜切，去掉"折线感"；
 *  3. 端点 / 拐角补焊盘，再按"外发光 → 主线 → 高光"三遍描边；
 *  4. 越出画布的部分按 ±size 平移重绘，保证平铺后接缝处线路能续上。
 *
 * 贴图是纯发光遮罩：底色全黑（不发光），只有线路亮，配合 emissive 色就是青蓝流光。
 */
export interface CircuitMapOptions {
  /** 贴图边长（正方形） */
  size?: number;
  /** 走线网格密度：越大线路越细密 */
  cells?: number;
  /** 走线数量 */
  traces?: number;
  /** 主线颜色（青） */
  color?: number;
  /** 焊盘 / 高光颜色（偏白青） */
  nodeColor?: number;
  /** 随机种子 */
  seed?: number;
}

/** 轴对齐折线 → 45° 倒角折线 */
function chamferPolyline(pts: number[], amount: number): number[] {
  if (pts.length < 6) return pts;
  const out: number[] = [pts[0], pts[1]];
  for (let i = 2; i < pts.length - 2; i += 2) {
    const px = pts[i - 2];
    const py = pts[i - 1];
    const cx = pts[i];
    const cy = pts[i + 1];
    const nx = pts[i + 2];
    const ny = pts[i + 3];
    const d1 = Math.hypot(cx - px, cy - py) || 1;
    const d2 = Math.hypot(nx - cx, ny - cy) || 1;
    const a = Math.min(amount, d1 * 0.45, d2 * 0.45);
    out.push(cx - ((cx - px) / d1) * a, cy - ((cy - py) / d1) * a);
    out.push(cx + ((nx - cx) / d2) * a, cy + ((ny - cy) / d2) * a);
  }
  out.push(pts[pts.length - 2], pts[pts.length - 1]);
  return out;
}

function polylineBounds(pts: number[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] < minX) minX = pts[i];
    if (pts[i] > maxX) maxX = pts[i];
    if (pts[i + 1] < minY) minY = pts[i + 1];
    if (pts[i + 1] > maxY) maxY = pts[i + 1];
  }
  return { minX, minY, maxX, maxY };
}

export function createCircuitMap(o: CircuitMapOptions = {}): THREE.Texture {
  const size = o.size ?? Math.min(baseSize, 512);
  const cells = Math.max(6, o.cells ?? 18);
  const traceCount = o.traces ?? 30;
  const seed = o.seed ?? 1337;
  const lineHex = o.color ?? 0x00e5ff;
  const nodeHex = o.nodeColor ?? 0xc8feff;
  const step = size / cells;
  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  const ctx = canvas2d(size, size);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const rgba = (hex: number, a: number): string =>
    `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;

  const strokeTrace = (pts: number[], ox: number, oy: number, glow: number): void => {
    ctx.beginPath();
    ctx.moveTo(pts[0] + ox, pts[1] + oy);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] + ox, pts[i + 1] + oy);
    // 外发光
    ctx.shadowBlur = 0;
    ctx.lineWidth = 6;
    ctx.strokeStyle = rgba(lineHex, 0.12 * glow);
    ctx.stroke();
    // 主线（带辉光）
    ctx.shadowColor = rgba(lineHex, 1);
    ctx.shadowBlur = 9;
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = rgba(lineHex, 0.85 * glow);
    ctx.stroke();
    // 芯线高光
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(nodeHex, 0.9 * glow);
    ctx.stroke();
  };

  const drawPad = (x: number, y: number, r: number): void => {
    ctx.shadowColor = rgba(lineHex, 1);
    ctx.shadowBlur = 10;
    ctx.fillStyle = rgba(nodeHex, 0.95);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  };

  let tick = 0;
  const rnd = (): number => {
    const i = tick++;
    return hash2(i % 251, Math.floor(i / 251), seed);
  };

  for (let t = 0; t < traceCount; t++) {
    let gx = Math.floor(rnd() * cells);
    let gy = Math.floor(rnd() * cells);
    const raw: number[] = [gx * step, gy * step];
    const pads: number[] = [gx * step, gy * step];
    let d = Math.floor(rnd() * 4);
    const segs = 3 + Math.floor(rnd() * 5);
    for (let s = 0; s < segs; s++) {
      const [dx, dy] = dirs[d];
      const len = 1 + Math.floor(rnd() * 4);
      gx += dx * len;
      gy += dy * len;
      raw.push(gx * step, gy * step);
      if (rnd() < 0.4) pads.push(gx * step, gy * step);
      // 只允许转 90°（不掉头），保持走线的方向感
      if (rnd() < 0.55) d = d < 2 ? 2 + Math.floor(rnd() * 2) : Math.floor(rnd() * 2);
    }
    pads.push(gx * step, gy * step);
    const pts = chamferPolyline(raw, step * 0.45);
    const b = polylineBounds(pts);
    const glow = 0.5 + rnd() * 0.5;

    // 越界部分按 ±size 平移重绘，保证 RepeatWrapping 后接缝连续
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        if (b.minX + ox > size || b.maxX + ox < 0) continue;
        if (b.minY + oy > size || b.maxY + oy < 0) continue;
        strokeTrace(pts, ox, oy, glow);
        for (let i = 0; i < pads.length; i += 2) {
          drawPad(pads[i] + ox, pads[i + 1] + oy, step * 0.18);
        }
      }
    }
  }

  return toTexture(ctx, { srgb: true, wrap: THREE.RepeatWrapping });
}

// ——————————————————————————————————————————————————————————
// 缓存
// ——————————————————————————————————————————————————————————

const surfaceCache = new Map<SurfaceKind, SurfaceMaps>();
let energyTex: THREE.Texture | null = null;
let engineHeatTex: THREE.Texture | null = null;
let hexTex: THREE.Texture | null = null;
let circuitTex: THREE.Texture | null = null;

const PANEL_PRESETS: Record<SurfaceKind, PanelOptions> = {
  // 玩家机身：细密装甲板 + 灯带
  hull: {
    size: 0, grid: 8, seam: 0.035, rivets: true, grime: 0.35, brushed: 0.35,
    repeat: 1.6, seed: 11, roughnessBase: 0.62, roughnessVar: 0.3, emissive: 'strip',
  },
  // 玩家机翼 / 尾翼：更大的板 + 更明显的拉丝与磨损
  armor: {
    size: 0, grid: 5, seam: 0.05, rivets: true, grime: 0.5, brushed: 0.55,
    repeat: 1, seed: 27, roughnessBase: 0.7, roughnessVar: 0.34,
  },
  // 玩家机暗部结构件：进气道 / 挂架 / 喷口外壳
  dark: {
    size: 0, grid: 5, seam: 0.06, rivets: true, grime: 0.7, brushed: 0.2,
    repeat: 1.2, seed: 33, roughnessBase: 0.78, roughnessVar: 0.3,
  },
  // Boss 主舰体：巨型装甲块 + 舷窗
  bossHull: {
    size: 0, grid: 4, seam: 0.045, rivets: true, grime: 0.6, brushed: 0.2,
    repeat: 3, seed: 43, roughnessBase: 0.58, roughnessVar: 0.4, emissive: 'window',
  },
  // Boss 装甲板：深色、粗糙、带散热格栅感
  bossPlate: {
    size: 0, grid: 3, seam: 0.07, rivets: true, grime: 0.75, brushed: 0.15,
    repeat: 2, seed: 59, roughnessBase: 0.74, roughnessVar: 0.36,
  },
  // 敌机：小尺寸面板，够用即可
  enemy: {
    size: 0, grid: 6, seam: 0.05, rivets: false, grime: 0.45, brushed: 0.4,
    repeat: 1, seed: 71, roughnessBase: 0.66, roughnessVar: 0.3,
  },
};

function panelSizeFor(kind: SurfaceKind): number {
  if (kind === 'enemy') return Math.min(256, baseSize);
  if (kind === 'hull' || kind === 'armor') return Math.min(baseSize, 1024);
  return Math.min(baseSize, 512);
}

export function getSurfaceMaps(kind: SurfaceKind): SurfaceMaps {
  const cached = surfaceCache.get(kind);
  if (cached) return cached;
  const preset = PANEL_PRESETS[kind];
  const buildFallback = () => buildPanelMaps({ ...preset, size: panelSizeFor(kind) });
  // 优先使用离线烘焙的 PBR 贴图（tools/pbr/bake.mjs 产物），缺失时回退到程序化生成
  const maps = createBakedSurfaceMaps(kind, buildFallback) ?? buildFallback();
  surfaceCache.set(kind, maps);
  return maps;
}

export function getEnergyTexture(): THREE.Texture {
  if (!energyTex) energyTex = createBakedEnergyTexture() ?? buildEnergyTexture(0.55);
  return energyTex;
}

export function getEngineHeatTexture(): THREE.Texture {
  if (!engineHeatTex) engineHeatTex = createBakedEngineHeatTexture() ?? buildEngineHeatTexture();
  return engineHeatTex;
}

/** 发动机喷口全套 PBR（仅烘焙资产存在时可用） */
export function getEngineMaps() {
  return createBakedEngineMaps();
}

/** 座舱玻璃近看时的擦拭痕 / 积尘（仅烘焙资产存在时可用） */
export function getCanopyMaps() {
  return createBakedCanopyMaps();
}

export function getHexTexture(): THREE.Texture {
  if (!hexTex) hexTex = buildHexTexture();
  return hexTex;
}

/**
 * 科技回路图（缓存版）：黑底 + 青色发光走线。
 * 需要独立控制 offset / repeat 的调用方请自行 clone（Boss 机翼流光就是这么做的）。
 */
export function getCircuitTexture(): THREE.Texture {
  if (!circuitTex) circuitTex = createCircuitMap();
  return circuitTex;
}

// ——————————————————————————————————————————————————————————
// 星球：地表 / 粗糙度 / 法线 / 夜面灯光 / 云层
// ——————————————————————————————————————————————————————————

export interface PlanetPalette {
  deep: number;
  shallow: number;
  sand: number;
  low: number;
  mid: number;
  high: number;
  peak: number;
  night: number;
  cloud: number;
}

export interface PlanetMapsOptions {
  width: number;
  palette: PlanetPalette;
  seed: number;
  /** 高精版：额外生成法线 / 夜面 / 云层 */
  hero: boolean;
}

export interface PlanetMaps {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  normal: THREE.Texture | null;
  night: THREE.Texture | null;
  cloud: THREE.Texture | null;
  /** 地表环境遮蔽（烘焙 PBR 时提供，供大气 / 边缘 Shader 采样） */
  ao: THREE.Texture | null;
}

function rgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

const SEA_LEVEL = 0.5;

export function createPlanetMaps(o: PlanetMapsOptions): PlanetMaps {
  // 已烘焙的星球（Starfield 三颗）直接读离线 PBR；其余继续程序化生成
  const baked = createBakedPlanetMaps(o.seed, o.hero);
  if (baked) return baked;
  return buildPlanetMapsProcedural(o);
}

function buildPlanetMapsProcedural(o: PlanetMapsOptions): PlanetMaps {
  const width = o.width;
  const height = Math.max(64, width >> 1);
  const palette = {
    deep: rgb(o.palette.deep),
    shallow: rgb(o.palette.shallow),
    sand: rgb(o.palette.sand),
    low: rgb(o.palette.low),
    mid: rgb(o.palette.mid),
    high: rgb(o.palette.high),
    peak: rgb(o.palette.peak),
    night: rgb(o.palette.night),
    cloud: rgb(o.palette.cloud),
  };

  const continents = fbmField({
    width,
    height,
    octaves: o.hero ? 5 : 4,
    baseGridX: 5,
    seed: o.seed,
    contrast: 1.45,
  });
  const detail = fbmField({
    width,
    height,
    octaves: o.hero ? 4 : 3,
    baseGridX: 13,
    seed: o.seed + 101,
    contrast: 1.2,
  });

  const albedoCtx = canvas2d(width, height);
  const roughCtx = canvas2d(width, height);
  const nightCtx = o.hero ? canvas2d(width, height) : null;
  const albedoImg = albedoCtx.createImageData(width, height);
  const roughImg = roughCtx.createImageData(width, height);
  const nightImg = nightCtx ? nightCtx.createImageData(width, height) : null;

  for (let y = 0; y < height; y++) {
    const v = y / height;
    const lat = Math.abs(v * 2 - 1);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const h = continents[i];
      const d = detail[i];
      // 极地冰盖：高纬度 + 噪声扰动，边缘不规则
      const polar = smoothstep(0.62 + d * 0.22, 0.95, lat);

      let r: number;
      let g: number;
      let b: number;
      let rough: number;

      if (h < SEA_LEVEL) {
        const t = smoothstep(SEA_LEVEL * 0.35, SEA_LEVEL, h);
        r = lerp(palette.deep[0], palette.shallow[0], t);
        g = lerp(palette.deep[1], palette.shallow[1], t);
        b = lerp(palette.deep[2], palette.shallow[2], t);
        rough = lerp(0.14, 0.3, 1 - t) + (d - 0.5) * 0.06;
      } else {
        const e = (h - SEA_LEVEL) / (1 - SEA_LEVEL);
        if (e < 0.08) {
          const t = e / 0.08;
          r = lerp(palette.sand[0], palette.low[0], t);
          g = lerp(palette.sand[1], palette.low[1], t);
          b = lerp(palette.sand[2], palette.low[2], t);
        } else if (e < 0.42) {
          const t = (e - 0.08) / 0.34;
          r = lerp(palette.low[0], palette.mid[0], t);
          g = lerp(palette.low[1], palette.mid[1], t);
          b = lerp(palette.low[2], palette.mid[2], t);
        } else if (e < 0.72) {
          const t = (e - 0.42) / 0.3;
          r = lerp(palette.mid[0], palette.high[0], t);
          g = lerp(palette.mid[1], palette.high[1], t);
          b = lerp(palette.mid[2], palette.high[2], t);
        } else {
          const t = (e - 0.72) / 0.28;
          r = lerp(palette.high[0], palette.peak[0], t);
          g = lerp(palette.high[1], palette.peak[1], t);
          b = lerp(palette.high[2], palette.peak[2], t);
        }
        // 地形起伏造成的明暗与粗糙度变化
        const shade = 0.86 + d * 0.28;
        r *= shade;
        g *= shade;
        b *= shade;
        rough = 0.55 + d * 0.35 + (1 - e) * 0.1;
      }

      if (polar > 0) {
        const ice = polar * (0.6 + d * 0.5);
        r = lerp(r, 232, ice);
        g = lerp(g, 240, ice);
        b = lerp(b, 248, ice);
        rough = lerp(rough, 0.32, ice);
      }

      const p = i * 4;
      albedoImg.data[p + 0] = r;
      albedoImg.data[p + 1] = g;
      albedoImg.data[p + 2] = b;
      albedoImg.data[p + 3] = 255;
      const rv = clamp01(rough) * 255;
      roughImg.data[p + 0] = rv;
      roughImg.data[p + 1] = rv;
      roughImg.data[p + 2] = rv;
      roughImg.data[p + 3] = 255;

      if (nightImg) {
        // 城市灯光：集中在中低海拔陆地、避开极地，用噪声成团分布
        const cluster = smoothstep(0.52, 0.86, d) * smoothstep(SEA_LEVEL + 0.01, SEA_LEVEL + 0.09, h);
        const coastal = 1 - smoothstep(0.3, 0.62, (h - SEA_LEVEL) / (1 - SEA_LEVEL));
        const flicker = hash2(x, y, o.seed) > 0.82 ? 0.35 : 1;
        const lights = cluster * (0.35 + coastal * 0.65) * (1 - polar) * flicker;
        nightImg.data[p + 0] = palette.night[0] * lights;
        nightImg.data[p + 1] = palette.night[1] * lights;
        nightImg.data[p + 2] = palette.night[2] * lights;
        nightImg.data[p + 3] = 255;
      }
    }
  }

  albedoCtx.putImageData(albedoImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);
  if (nightCtx && nightImg) nightCtx.putImageData(nightImg, 0, 0);

  let normal: THREE.Texture | null = null;
  if (o.hero) {
    const ds = downsample(continents, width, height);
    normal = heightToNormal(ds.data, ds.w, ds.h, 1.6);
  }

  let cloud: THREE.Texture | null = null;
  if (o.hero) {
    const cw = Math.max(256, width >> 1);
    const ch = Math.max(128, height >> 1);
    const cf = fbmField({ width: cw, height: ch, octaves: 4, baseGridX: 6, seed: o.seed + 7, contrast: 1.3 });
    const ctx = canvas2d(cw, ch);
    const img = ctx.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) {
      const v = y / ch;
      const lat = Math.abs(v * 2 - 1);
      for (let x = 0; x < cw; x++) {
        const i = y * cw + x;
        const n = cf[i];
        const banded = 0.5 + Math.sin(v * Math.PI * 6 + n * 4) * 0.16;
        const alpha = smoothstep(0.5, 0.72, n * banded * 1.35) * (1 - smoothstep(0.75, 1, lat) * 0.7);
        const p = i * 4;
        img.data[p + 0] = palette.cloud[0];
        img.data[p + 1] = palette.cloud[1];
        img.data[p + 2] = palette.cloud[2];
        img.data[p + 3] = clamp01(alpha) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    cloud = toTexture(ctx, { srgb: true });
  }

  return {
    albedo: toTexture(albedoCtx, { srgb: true }),
    roughness: toTexture(roughCtx, {}),
    normal,
    night: nightCtx ? toTexture(nightCtx, { srgb: true }) : null,
    cloud,
    ao: null,
  };
}

/** 释放所有缓存贴图（页面卸载时用） */
export function disposeProceduralTextures(): void {
  for (const maps of surfaceCache.values()) {
    maps.map.dispose();
    maps.normalMap.dispose();
    maps.roughnessMap.dispose();
    maps.emissiveMap?.dispose();
  }
  surfaceCache.clear();
  energyTex?.dispose();
  engineHeatTex?.dispose();
  hexTex?.dispose();
  circuitTex?.dispose();
  energyTex = null;
  engineHeatTex = null;
  hexTex = null;
  circuitTex = null;
}
