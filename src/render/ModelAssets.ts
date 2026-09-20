import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AircraftDef } from '../data/aircraft';
import { applyRimLight } from './MaterialFX';

/**
 * 外部模型（GLB）的运行时加载层。
 *
 * 设计要点与 PbrAssets 一致：**离线资源是"增强"，不是"依赖"**——
 * 加载失败时 PlayerAircraft 继续用程序化几何体，游戏不会出现空模型。
 *
 *  - 全局只解析一次 GLB，实例通过 `clone(true)` 拿到副本（几何共享、材质逐机克隆）；
 *  - `fitModel()` 把任意来源的模型统一到"机头朝 -Z、长度归一化"的游戏约定，
 *    换模型不需要改战斗/摄像机/弹道代码；
 *  - 材质按名称做轻度着色（机体色 / 引擎焰色），保留机体之间的差异。
 */

/** 玩家机模型：机头朝 +Z，与游戏约定（-Z）相反，挂载时需要掉头 */
export const PLAYER_MODEL_URL = `${import.meta.env.BASE_URL}models/player_fighter.glb`;
/** 归一化后的机体长度（沿 Z），与程序化机体（约 5.2）保持相近的占位 */
export const PLAYER_MODEL_LENGTH = 4.8;
/** 该 GLB 机头朝 +Z → 绕 Y 转 180° 才是游戏约定的 -Z */
export const PLAYER_MODEL_YAW = Math.PI;

const loader = new GLTFLoader();
const pending = new Map<string, Promise<THREE.Group>>();
const loaded = new Map<string, THREE.Group>();

/** 预加载（可提前调用，避免开局瞬间弹出模型） */
export function preloadModel(url: string): Promise<THREE.Group> {
  const hit = pending.get(url);
  if (hit) return hit;
  const task = loader
    .loadAsync(url)
    .then((gltf) => {
      loaded.set(url, gltf.scene);
      return gltf.scene;
    })
    .catch((err: unknown) => {
      // 失败就清缓存，允许后续重试；调用方继续走程序化回退
      pending.delete(url);
      throw err;
    });
  pending.set(url, task);
  return task;
}

/** 已加载则返回一个可安全修改的克隆体，未加载返回 null */
export function getModel(url: string): THREE.Group | null {
  const source = loaded.get(url);
  return source ? source.clone(true) : null;
}

export interface FitOptions {
  /** 目标长度（沿前进轴 Z） */
  length: number;
  /** 绕 Y 的朝向修正（模型机头朝 +Z 时传 Math.PI） */
  yaw?: number;
}

/** 居中 + 等比缩放到目标长度：让不同来源的模型都能直接塞进现有逻辑 */
export function fitModel(model: THREE.Group, opts: FitOptions): void {
  model.rotation.y = opts.yaw ?? 0;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = opts.length / Math.max(size.z, 1e-3);
  model.scale.multiplyScalar(scale);
  // 先缩放再平移：包围盒中心要按缩放后的尺度抵消
  model.position.copy(center).multiplyScalar(-scale);
}

/**
 * 把 GLB 场景整理成一架"游戏里的玩家机"：
 * 归一化尺度/朝向 → 克隆材质（避免污染缓存） → 着色 + Fresnel 轮廓光。
 */
export function preparePlayerModel(model: THREE.Group, def: AircraftDef): void {
  fitModel(model, { length: PLAYER_MODEL_LENGTH, yaw: PLAYER_MODEL_YAW });

  const hullColor = new THREE.Color(def.bodyColor);
  const flameColor = new THREE.Color(def.flameColor);

  model.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const source = obj.material;
    // 材质必须逐机克隆：否则着色会写到共享材质上，换机体时互相污染
    const cloned = Array.isArray(source)
      ? source.map((m) => m.clone())
      : (source.clone() as THREE.Material);
    const list = Array.isArray(cloned) ? cloned : [cloned];
    for (const mat of list) {
      mat.userData.owned = true;
      if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
      mat.envMapIntensity = 1.35;
      if (mat.name === 'Hull') {
        // 保留 GLB 的金属/粗糙，只把基色往机体配色拉，维持三架机的辨识度
        mat.color.lerp(hullColor, 0.55);
        applyRimLight(mat, { color: 0x6fb4ff, power: 2.8, strength: 0.5 });
      } else if (mat.name === 'Thrust') {
        mat.emissive.copy(flameColor);
        mat.emissiveIntensity = 12;
      } else if (mat.name === 'CyanGlow') {
        mat.emissiveIntensity = 6;
      } else {
        applyRimLight(mat, { color: 0x5f9fe8, power: 2.4, strength: 0.42 });
      }
    }
    obj.material = cloned;
  });
}

/** 释放实例独占的材质（几何体是共享的，不能在这里 dispose） */
export function disposeModelMaterials(model: THREE.Object3D): void {
  model.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of list) {
      if (mat.userData.owned === true) mat.dispose();
    }
  });
}
