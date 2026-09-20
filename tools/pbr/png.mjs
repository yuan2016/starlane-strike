/**
 * 零依赖 PNG 编码器（Node zlib + 手写 CRC / 行过滤器）。
 *
 * 之所以自己写：项目不想引入 sharp / canvas 这类原生或重依赖，
 * 只要能把烘焙好的像素数组落成 PNG 即可。
 *
 * 支持：
 *  - 位深 8，颜色类型 0(灰度) / 2(RGB) / 6(RGBA)
 *  - 逐行自适应过滤（None / Sub / Up / Average / Paeth 里挑代价最小的），
 *    配合 zlib level 9，比无脑 Filter 0 小很多
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf, offset, length) {
  let c = 0xffffffff;
  const end = offset + length;
  for (let i = offset; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildChunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  const crc = crc32(out, 4, data.length + 4);
  out.writeUInt32BE(crc, out.length - 4);
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * @param filePath 输出路径
 * @param width 宽
 * @param height 高
 * @param channels 1 / 3 / 4
 * @param pixels Uint8Array，长度 = width*height*channels
 */
export function writePng(filePath, width, height, channels, pixels, level = 9) {
  const colorType = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  const prev = Buffer.alloc(stride);
  const cand = [
    Buffer.alloc(stride),
    Buffer.alloc(stride),
    Buffer.alloc(stride),
    Buffer.alloc(stride),
    Buffer.alloc(stride),
  ];

  let pos = 0;
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    for (let i = 0; i < stride; i++) {
      const cur = pixels[rowStart + i];
      const left = i >= channels ? pixels[rowStart + i - channels] : 0;
      const up = prev[i];
      const upLeft = i >= channels ? prev[i - channels] : 0;
      cand[0][i] = cur;
      cand[1][i] = (cur - left) & 0xff;
      cand[2][i] = (cur - up) & 0xff;
      cand[3][i] = (cur - ((left + up) >> 1)) & 0xff;
      cand[4][i] = (cur - paeth(left, up, upLeft)) & 0xff;
    }

    // 代价函数：把字节看成有符号数求和，越接近 0 越好压
    let best = 0;
    let bestCost = Infinity;
    for (let f = 0; f < 5; f++) {
      let cost = 0;
      for (let i = 0; i < stride; i++) {
        const v = cand[f][i];
        cost += v < 128 ? v : 256 - v;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = f;
      }
    }

    raw[pos++] = best;
    cand[best].copy(raw, pos);
    pos += stride;
    // prev ← 当前行的原始值
    for (let i = 0; i < stride; i++) prev[i] = pixels[rowStart + i];
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level, memLevel: 9, strategy: zlib.constants.Z_DEFAULT_STRATEGY });

  const out = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    buildChunk('IHDR', ihdr),
    buildChunk('IDAT', idat),
    buildChunk('IEND', Buffer.alloc(0)),
  ]);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, out);
  return out.length;
}

/** 灰度图（输入 Float32Array 或 Uint8Array，值域 [0,1] 或 [0,255]） */
export function writeGrayPng(filePath, w, h, field, { isByte = false } = {}) {
  const px = new Uint8Array(w * h);
  if (isByte) {
    px.set(field);
  } else {
    for (let i = 0, n = w * h; i < n; i++) px[i] = Math.max(0, Math.min(255, Math.round(field[i] * 255)));
  }
  return writePng(filePath, w, h, 1, px);
}

/** RGB 图：r/g/b 为 [0,1] 或 [0,255] 的数组 */
export function writeRgbPng(filePath, w, h, r, g, b, { rgb = false } = {}) {
  const px = new Uint8Array(w * h * 3);
  const n = w * h;
  for (let i = 0; i < n; i++) {
    if (rgb) {
      px[i * 3] = Math.max(0, Math.min(255, Math.round(r[i] * 255)));
      px[i * 3 + 1] = Math.max(0, Math.min(255, Math.round(g[i] * 255)));
      px[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(b[i] * 255)));
    } else {
      px[i * 3] = r[i];
      px[i * 3 + 1] = g[i];
      px[i * 3 + 2] = b[i];
    }
  }
  return writePng(filePath, w, h, 3, px);
}
