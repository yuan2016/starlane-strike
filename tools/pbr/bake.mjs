/**
 * PBR 贴图烘焙入口。
 *
 * 用法：
 *   node tools/pbr/bake.mjs                  # 全部烘焙
 *   node tools/pbr/bake.mjs --only player    # 只烘焙名字含 player 的组
 *   node tools/pbr/bake.mjs --out <目录>      # 指定输出根目录
 *
 * 产出：
 *   public/textures/pbr/<size>/<name>_<map>.png        方形贴图按分辨率分目录
 *   public/textures/pbr/planet/<width>/<id>_<map>.png  星球按宽度分目录（等距圆柱）
 *   public/textures/pbr/manifest.json                  便于管线脚本读取的清单
 *
 * 每张贴图都会同时生成低一级分辨率的 LOD（如 2048 → 1024），
 * 运行时按画质档位选择，而不是让低端设备硬扛 2048 的显存。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bakeShipSurface, packSrgbRGB, packGray, packORM } from './ship.mjs';
import { bakeEngineHeat, bakeEnergyStrip, bakeCanopyDetail } from './fx.mjs';
import { bakePlanet, bakeClouds } from './planet.mjs';
import { writePng } from './png.mjs';
import { normalFromHeight, downsample2, downsample2RGB, downsampleGrayU8, clamp01 } from './image.mjs';
import { SURFACE_SETS, ENGINE_SETS, SIMPLE_SETS, PLANET_SETS } from './bake-presets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const argv = process.argv.slice(2);
const argOf = (key, fallback) => {
  const eq = argv.find((a) => a.startsWith(`--${key}=`));
  if (eq) return eq.slice(key.length + 3);
  const idx = argv.indexOf(`--${key}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) return argv[idx + 1];
  return fallback;
};
const ONLY = argOf('only', '');
const OUT = path.resolve(ROOT, argOf('out', 'public/textures/pbr'));

const report = [];
function emit(relPath, w, h, channels, pixels) {
  const file = path.join(OUT, relPath);
  const bytes = writePng(file, w, h, channels, pixels);
  report.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), kb: bytes / 1024, px: `${w}x${h}` });
  return bytes;
}


/* ——————————————————————————————————————————————
 * 输出过程
 * —————————————————————————————————————————————— */

const t0 = Date.now();
fs.mkdirSync(OUT, { recursive: true });

function writeSurfaceLevel(name, size, cur) {
  const dir = String(size);
  emit(`${dir}/${name}_basecolor.png`, size, size, 3, cur.basecolor);
  emit(`${dir}/${name}_normal.png`, size, size, 3, cur.normal);
  emit(`${dir}/${name}_roughness.png`, size, size, 1, cur.roughness);
  emit(`${dir}/${name}_metallic.png`, size, size, 1, cur.metallic);
  emit(`${dir}/${name}_ao.png`, size, size, 1, cur.ao);
  if (cur.heightU8) emit(`${dir}/${name}_height.png`, size, size, 1, cur.heightU8);
  if (cur.emissive) emit(`${dir}/${name}_emissive.png`, size, size, 3, cur.emissive);
  if (cur.orm) emit(`${dir}/${name}_orm.png`, size, size, 3, cur.orm);
}

function bakeSurfaceSet(name, def) {
  const master = def.sizes[0];
  process.stdout.write(`  · ${name}  ${master}² ...`);
  const started = Date.now();
  const s = bakeShipSurface({ ...def.preset, size: master });
  const n = master * master;
  let cur = {
    w: master,
    heightF: s.height,
    basecolor: packSrgbRGB(s.base, n),
    emissive: packSrgbRGB(s.emissive, n),
    roughness: packGray(s.roughness, n),
    metallic: packGray(s.metallic, n),
    ao: packGray(s.ao, n),
    heightU8: packGray(s.height, n),
    orm: packORM(s.ao, s.roughness, s.metallic, n),
    normal: normalFromHeight(s.height, master, master, def.preset.normalStrength ?? 2.2),
  };

  for (const size of def.sizes) {
    while (cur.w > size) cur = halveSurface(cur, def.preset.normalStrength ?? 2.2);
    writeSurfaceLevel(name, cur.w, cur);
  }
  console.log(` ${Date.now() - started}ms`);
}

function halveSurface(cur, normalStrength = 2.2) {
  const half = cur.w >> 1;
  const hCount = half * half;
  const hs = downsample2(cur.heightF, cur.w, cur.w);
  return {
    w: half,
    heightF: hs.data,
    basecolor: downsample2RGB(cur.basecolor, cur.w, cur.w).data,
    emissive: downsample2RGB(cur.emissive, cur.w, cur.w).data,
    roughness: downsampleGrayU8(cur.roughness, cur.w, cur.w).data,
    metallic: downsampleGrayU8(cur.metallic, cur.w, cur.w).data,
    ao: downsampleGrayU8(cur.ao, cur.w, cur.w).data,
    heightU8: downsampleGrayU8(cur.heightU8, cur.w, cur.w).data,
    orm: downsample2RGB(cur.orm, cur.w, cur.w).data,
    // 法线从降采样后的高度重新求，而不是直接缩放颜色（否则高频细节会变成假的）
    normal: normalFromHeight(hs.data, half, half, normalStrength),
  };
}

function bakeEngineSet(name, def) {
  const master = def.sizes[0];
  process.stdout.write(`  · ${name}  ${master}² ...`);
  const started = Date.now();
  const s = bakeEngineHeat(master, def.seed);
  const n = master * master;
  let cur = {
    w: master,
    heightF: s.height,
    basecolor: packSrgbRGB(s.base, n),
    emissive: packSrgbRGB(s.emissive, n),
    roughness: packGray(s.roughness, n),
    metallic: packGray(s.metallic, n),
    ao: packGray(s.ao, n),
    heightU8: packGray(s.height, n),
    orm: packORM(s.ao, s.roughness, s.metallic, n),
    normal: normalFromHeight(s.height, master, master, 2.4),
  };
  for (const size of def.sizes) {
    while (cur.w > size) cur = halveSurface(cur, def.normalStrength ?? 2.4);
    writeSurfaceLevel(name, cur.w, cur);
  }
  console.log(` ${Date.now() - started}ms`);
}

function bakeSimpleSets() {
  for (const [name, def] of Object.entries(SIMPLE_SETS)) {
    if (ONLY && !name.includes(ONLY)) continue;
    const master = def.sizes[0];
    process.stdout.write(`  · ${name}  ${master}² ...`);
    const started = Date.now();

    if (name === 'energy_strip') {
      const d = bakeEnergyStrip(master, def.seed);
      let curW = master;
      let emissive = packSrgbRGB(d.rgb, master * master);
      let mask = packGray(d.mask, master * master);
      for (const size of def.sizes) {
        while (curW > size) {
          const nh = curW >> 1;
          emissive = downsample2RGB(emissive, curW, curW).data;
          mask = downsampleGrayU8(mask, curW, curW).data;
          curW = nh;
        }
        emit(`${String(curW)}/${name}_emissive.png`, curW, curW, 3, emissive);
        emit(`${String(curW)}/${name}_mask.png`, curW, curW, 1, mask);
      }
    } else {
      const d = bakeCanopyDetail(master, def.seed);
      let curW = master;
      let smudge = packGray(d.smudge, master * master);
      let detail = packGray(d.micro, master * master);
      for (const size of def.sizes) {
        while (curW > size) {
          const nh = curW >> 1;
          smudge = downsampleGrayU8(smudge, curW, curW).data;
          detail = downsampleGrayU8(detail, curW, curW).data;
          curW = nh;
        }
        emit(`${String(curW)}/${name}_roughness.png`, curW, curW, 1, smudge);
        emit(`${String(curW)}/${name}_normal.png`, curW, curW, 1, detail);
      }
    }
    console.log(` ${Date.now() - started}ms`);
  }
}

function bakePlanetSets() {
  for (const [id, def] of Object.entries(PLANET_SETS)) {
    if (ONLY && !`planet-${id}`.includes(ONLY)) continue;
    const W0 = def.widths[0];
    process.stdout.write(`  · planet/${id}  ${W0}x${W0 >> 1} ...`);
    const started = Date.now();
    const p = bakePlanet({ width: W0, seed: def.seed, palette: def.palette, nightLights: def.nightLights });
    // 云层不需要和地表同分辨率：体积感来自形状与光照，不是像素密度
    const clouds = bakeClouds(W0 >> 1, def.seed + 91, def.palette.cloud);

    let cur = { w: W0, p, clouds };
    for (const targetW of def.widths) {
      while (cur.w > targetW) cur = halvePlanet(cur);
      const dir = `planet/${String(cur.w)}`;
      const w = cur.w;
      const h = cur.w >> 1;
      emit(`${dir}/${id}_albedo.png`, w, h, 3, cur.p.albedo);
      emit(`${dir}/${id}_normal.png`, w, h, 3, cur.p.normal);
      emit(`${dir}/${id}_roughness.png`, w, h, 1, packGrayF(cur.p.roughness));
      emit(`${dir}/${id}_ao.png`, w, h, 1, packGrayF(cur.p.ao));
      if (def.fullMaps) {
        emit(`${dir}/${id}_metallic.png`, w, h, 1, packGrayF(cur.p.metallic));
        emit(`${dir}/${id}_height.png`, w, h, 1, packGrayF(cur.p.elevation));
        emit(`${dir}/${id}_night.png`, w, h, 3, cur.p.night);
      }
      emit(`${dir}/${id}_clouds.png`, w, h, 4, cur.clouds.rgba);
    }
    console.log(` ${Date.now() - started}ms`);
  }
}

function packGrayF(f) {
  const out = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = Math.round(clamp01(f[i]) * 255);
  return out;
}

function halvePlanet(cur) {
  const half = cur.w >> 1;
  return {
    w: half,
    p: {
      albedo: averageDownRGB(cur.p.albedo, cur.w, cur.w >> 1),
      normal: averageDownRGB(cur.p.normal, cur.w, cur.w >> 1),
      night: averageDownRGB(cur.p.night, cur.w, cur.w >> 1),
      roughness: averageDownGray(cur.p.roughness, cur.w, cur.w >> 1),
      metallic: cur.p.metallic ? averageDownGray(cur.p.metallic, cur.w, cur.w >> 1) : null,
      elevation: averageDownGray(cur.p.elevation, cur.w, cur.w >> 1),
      ao: averageDownGray(cur.p.ao, cur.w, cur.w >> 1),
    },
    clouds: { rgba: averageDownRGBA(cur.clouds.rgba, cur.clouds.width, cur.clouds.height), width: half, height: half >> 1 },
  };
}

function averageDownRGB(px, w, h) {
  const dw = w >> 1;
  const dh = h >> 1;
  const out = new Uint8Array(dw * dh * 3);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      for (let c = 0; c < 3; c++) {
        const a = px[((y * 2) * w + x * 2) * 3 + c];
        const b = px[((y * 2) * w + x * 2 + 1) * 3 + c];
        const e = px[((y * 2 + 1) * w + x * 2) * 3 + c];
        const f = px[((y * 2 + 1) * w + x * 2 + 1) * 3 + c];
        out[(y * dw + x) * 3 + c] = (a + b + e + f) >> 2;
      }
    }
  }
  return out;
}

function averageDownRGBA(px, w, h) {
  const dw = w >> 1;
  const dh = h >> 1;
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      for (let c = 0; c < 4; c++) {
        const a = px[((y * 2) * w + x * 2) * 4 + c];
        const b = px[((y * 2) * w + x * 2 + 1) * 4 + c];
        const e = px[((y * 2 + 1) * w + x * 2) * 4 + c];
        const f = px[((y * 2 + 1) * w + x * 2 + 1) * 4 + c];
        out[(y * dw + x) * 4 + c] = (a + b + e + f) >> 2;
      }
    }
  }
  return out;
}

function averageDownGray(f, w, h) {
  const dw = w >> 1;
  const dh = h >> 1;
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const i = y * 2 * w + x * 2;
      out[y * dw + x] = (f[i] + f[i + 1] + f[i + w] + f[i + w + 1]) * 0.25;
    }
  }
  return out;
}

/* ——————————————————————————————————————————————
 * 执行
 * —————————————————————————————————————————————— */

console.log(`PBR 贴图烘焙 → ${path.relative(ROOT, OUT).replace(/\\/g, '/')}`);

if (!ONLY || ONLY.includes('player') || ONLY.includes('enemy') || ONLY.includes('boss')) {
  for (const [name, def] of Object.entries(SURFACE_SETS)) {
    if (ONLY && !name.includes(ONLY)) continue;
    bakeSurfaceSet(name, def);
  }
  for (const [name, def] of Object.entries(ENGINE_SETS)) {
    if (ONLY && !name.includes(ONLY)) continue;
    bakeEngineSet(name, def);
  }
  bakeSimpleSets();
}

bakePlanetSets();

const total = report.reduce((acc, r) => acc + r.kb, 0);
console.log(`\n完成：${report.length} 张贴图，合计 ${(total / 1024).toFixed(2)} MB，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

for (const r of report) {
  console.log(`  ${r.px.padStart(11)}  ${r.kb.toFixed(0).padStart(6)} KB  ${r.file}`);
}

// 供管线脚本读取的清单
const manifest = {
  generatedAt: new Date().toISOString(),
  root: path.relative(ROOT, OUT).replace(/\\/g, '/'),
  sets: Object.fromEntries(
    Object.entries(SURFACE_SETS).map(([k, v]) => [
      k,
      { kind: 'surface', sizes: v.sizes, maps: ['basecolor', 'normal', 'roughness', 'metallic', 'ao', 'height', 'emissive', 'orm'] },
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(ENGINE_SETS).map(([k, v]) => [
      k,
      { kind: 'engine', sizes: v.sizes, maps: ['basecolor', 'normal', 'roughness', 'metallic', 'ao', 'height', 'emissive', 'orm'], wrapT: 'clamp' },
    ]),
  ),
  planets: Object.fromEntries(
    Object.entries(PLANET_SETS).map(([k, v]) => [
      k,
      {
        kind: 'planet',
        widths: v.widths,
        maps: v.fullMaps
          ? ['albedo', 'normal', 'roughness', 'ao', 'metallic', 'height', 'night', 'clouds']
          : ['albedo', 'normal', 'roughness', 'ao', 'clouds'],
      },
    ]),
  ),
  files: report,
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`清单：${path.join(path.relative(ROOT, OUT), 'manifest.json').replace(/\\/g, '/')}`);
