import * as THREE from 'three';
import type { AircraftDef } from '../data/aircraft';
import { applyEngineHeat, applyRimLight } from '../render/MaterialFX';
import {
  PLAYER_MODEL_URL,
  disposeModelMaterials,
  getModel,
  preparePlayerModel,
  preloadModel,
} from '../render/ModelAssets';
import {
  getCanopyMaps,
  getEngineHeatTexture,
  getEngineMaps,
  getSurfaceMaps,
} from '../render/ProcTextures';

/**
 * 玩家机外观：优先使用外部 GLB 模型（`def.model` / 默认 player_fighter.glb），
 * 模型未就绪或加载失败时先显示程序化几何体，加载完成后自动顶替。
 * 机头朝 -Z（前进方向）；外形由 AircraftDef 参数化。
 */
export class PlayerAircraft {
  readonly group = new THREE.Group();
  readonly muzzles: THREE.Object3D[] = [];
  readonly flames: THREE.Mesh[] = [];

  /** 机身：抛光金属 */
  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  /** 机翼 / 尾翼：略粗糙的装甲金属 */
  private readonly armorMaterial: THREE.MeshStandardMaterial;
  /** 进气口 / 挂架等暗部结构件 */
  private readonly darkMaterial: THREE.MeshStandardMaterial;
  /** 座舱：清漆玻璃 */
  private readonly glassMaterial: THREE.MeshPhysicalMaterial;
  /** 发动机：高温金属 + 自发光 */
  private readonly nozzleMaterial: THREE.MeshStandardMaterial;
  private readonly flameMaterial: THREE.MeshBasicMaterial;
  private readonly coreMaterial: THREE.MeshBasicMaterial;

  private readonly def: AircraftDef;
  private time = 0;
  /** 喷口温度 uniform（0.6 巡航 → 1.4 加力） */
  private readonly nozzleHeat: { value: number };

  /** 程序化机体：外部模型到位后整体隐藏（喷焰与炮口不在这里，需要继续显示） */
  private readonly shell = new THREE.Group();
  private modelRoot: THREE.Group | null = null;
  private disposed = false;

  constructor(def: AircraftDef) {
    this.def = def;
    this.group.name = `PlayerAircraft:${def.id}`;
    this.group.scale.setScalar(def.scale);

    const hullMaps = getSurfaceMaps('hull');
    const armorMaps = getSurfaceMaps('armor');
    const darkMaps = getSurfaceMaps('dark');
    const canopyMaps = getCanopyMaps();
    // 烘焙 PBR 的 Roughness / Metallic 是"绝对值"，程序化回退是"相对值"：
    // 用 aoMap 是否存在来区分两种来源，避免一套乘数把另一种压暗
    const bakedHull = hullMaps.aoMap !== undefined;
    const hullRough = bakedHull ? 1 : 0.32;
    const hullMetal = bakedHull ? 1 : 0.9;
    const armorRough = bakedHull ? 1 : 0.5;
    const armorMetal = bakedHull ? 1 : 0.78;
    const darkRough = bakedHull ? 1 : 0.62;
    const darkMetal = bakedHull ? 1 : 0.7;

    // 机身：细密装甲板 + 灯带，Roughness / Metallic 全部由烘焙遮罩驱动
    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: def.bodyColor,
      map: hullMaps.map,
      roughnessMap: hullMaps.roughnessMap,
      metalnessMap: hullMaps.metalnessMap ?? null,
      normalMap: hullMaps.normalMap,
      aoMap: hullMaps.aoMap ?? null,
      aoMapIntensity: 1.1,
      emissiveMap: hullMaps.emissiveMap ?? null,
      emissive: new THREE.Color(0x4ea8ff),
      emissiveIntensity: 1.4,
      metalness: hullMetal,
      roughness: hullRough,
      envMapIntensity: 1.35,
    });
    // 装甲：更粗糙、磨损更明显的金属
    this.armorMaterial = new THREE.MeshStandardMaterial({
      color: def.wingColor,
      map: armorMaps.map,
      roughnessMap: armorMaps.roughnessMap,
      metalnessMap: armorMaps.metalnessMap ?? null,
      normalMap: armorMaps.normalMap,
      aoMap: armorMaps.aoMap ?? null,
      aoMapIntensity: 1.25,
      metalness: armorMetal,
      roughness: armorRough,
      envMapIntensity: 1.2,
    });
    // 暗部：进气口、挂架、喷口外壳，负责画面的"暗部层次"
    this.darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x151b26,
      map: darkMaps.map,
      roughnessMap: darkMaps.roughnessMap,
      metalnessMap: darkMaps.metalnessMap ?? null,
      normalMap: darkMaps.normalMap,
      aoMap: darkMaps.aoMap ?? null,
      aoMapIntensity: 1.3,
      metalness: darkMetal,
      roughness: darkRough,
      envMapIntensity: 1,
    });
    // 座舱玻璃：高光 + 环境反射 + 清漆，不再是一个"发光的实心球"
    this.glassMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(def.canopyColor).multiplyScalar(0.55),
      metalness: 0,
      roughness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      ior: 1.5,
      reflectivity: 0.6,
      envMapIntensity: 2,
      emissive: new THREE.Color(def.canopyColor),
      emissiveIntensity: 0.25,
      transparent: true,
      opacity: 0.62,
    });
    // 座舱玻璃近看才有意义：擦拭痕 / 积尘只影响粗糙度与极轻微的法线扰动
    if (canopyMaps) {
      this.glassMaterial.roughnessMap = canopyMaps.roughnessMap;
      this.glassMaterial.normalMap = canopyMaps.normalMap;
      this.glassMaterial.normalScale.set(0.12, 0.12);
      this.glassMaterial.roughness = 0.14;
    }
    // 发动机：高温金属，喷口端自发光（沿轴向的冷热渐变）
    const engineMaps = getEngineMaps();
    this.nozzleMaterial = new THREE.MeshStandardMaterial({
      color: 0x2b3038,
      map: engineMaps ? engineMaps.map : hullMaps.map,
      roughnessMap: engineMaps ? engineMaps.roughnessMap : hullMaps.roughnessMap,
      metalnessMap: engineMaps ? engineMaps.metalnessMap : null,
      normalMap: engineMaps ? engineMaps.normalMap : hullMaps.normalMap,
      aoMap: engineMaps ? engineMaps.aoMap : hullMaps.aoMap ?? null,
      aoMapIntensity: 1.2,
      emissiveMap: engineMaps ? engineMaps.emissiveMap : getEngineHeatTexture(),
      emissive: new THREE.Color(def.flameColor),
      emissiveIntensity: 1.6,
      metalness: engineMaps ? 1 : 0.85,
      roughness: engineMaps ? 1 : 0.38,
      envMapIntensity: 1.25,
    });

    // 边缘轮廓光：机身 / 机翼 / 发动机分别在冷蓝与暖橙上分层
    applyRimLight(this.bodyMaterial, { color: 0x6fb4ff, power: 2.8, strength: 0.5 });
    applyRimLight(this.armorMaterial, { color: 0x5f9fe8, power: 2.4, strength: 0.42 });
    applyRimLight(this.darkMaterial, { color: 0x4a86c8, power: 2.2, strength: 0.3 });
    applyRimLight(this.nozzleMaterial, { color: 0xff8844, power: 2.2, strength: 0.5 });
    // 喷口：Emissive 贴图按黑体辐射色带重映射，温度随推力变化
    this.nozzleHeat = applyEngineHeat(this.nozzleMaterial, { heat: 0.85, gain: 2.6 });
    applyRimLight(this.glassMaterial, { color: 0x9fd8ff, power: 2, strength: 0.9 });

    this.flameMaterial = new THREE.MeshBasicMaterial({
      color: def.flameColor,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xbfe9ff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.buildFuselage();
    this.buildWings();
    this.buildTail();
    this.buildEngines();
    this.buildMuzzles();
    this.group.add(this.shell);
    this.mountExternalModel();
  }

  /** 外部 GLB：已缓存就直接挂，否则后台加载完再顶掉程序化机体 */
  private mountExternalModel(): void {
    const url = this.def.model ?? PLAYER_MODEL_URL;
    const cached = getModel(url);
    if (cached) {
      this.applyModel(cached);
      return;
    }
    preloadModel(url)
      .then(() => {
        if (this.disposed) return;
        const model = getModel(url);
        if (model) this.applyModel(model);
      })
      .catch(() => {
        // 程序化机体已在场，缺模型不影响可玩性
        console.warn('[model] 玩家机模型加载失败，沿用程序化机体：', url);
      });
  }

  private applyModel(model: THREE.Group): void {
    preparePlayerModel(model, this.def);
    this.shell.visible = false;
    this.group.add(model);
    this.modelRoot = model;
  }

  private buildFuselage(): void {
    // 主机身：圆锥机头 + 圆柱机身，尖端朝 -Z
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.52, 2.0, 12), this.bodyMaterial);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -1.7;
    this.shell.add(nose);

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.6, 2.6, 12), this.bodyMaterial);
    body.rotation.x = Math.PI / 2;
    body.position.z = 0.6;
    this.shell.add(body);

    // 座舱盖
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), this.glassMaterial);
    canopy.scale.set(1, 0.72, 1.7);
    canopy.position.set(0, 0.34, -0.35);
    this.shell.add(canopy);
  }

  private buildWings(): void {
    const span = this.def.wingSpan;
    const wingShape = new THREE.BoxGeometry(span * 1.77, 0.14, 1.25);
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(wingShape, this.armorMaterial);
      wing.position.set(side * span, -0.02, 0.35);
      // 后掠 + 上反角
      wing.rotation.y = side * -0.22;
      wing.rotation.z = side * 0.14;
      this.shell.add(wing);

      // 翼尖挂架，增加细节层次
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.7, 4, 8), this.darkMaterial);
      pod.rotation.x = Math.PI / 2;
      pod.position.set(side * span * 1.77, 0.02, 0.6);
      this.shell.add(pod);

      // 翼根进气口
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 1.1), this.darkMaterial);
      intake.position.set(side * 0.72, -0.16, 0.1);
      this.shell.add(intake);
    }
  }

  private buildTail(): void {
    const span = this.def.wingSpan;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.95), this.armorMaterial);
    fin.position.set(0, 0.55, 1.72);
    fin.rotation.x = -0.22;
    this.shell.add(fin);

    const stabilizer = new THREE.Mesh(new THREE.BoxGeometry(span * 1.14, 0.12, 0.62), this.armorMaterial);
    stabilizer.position.set(0, 0.1, 1.78);
    this.shell.add(stabilizer);
  }

  private buildEngines(): void {
    const offsets = this.def.engineCount === 1 ? [0] : [-0.62, 0.62];
    for (const x of offsets) {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.9, 14), this.nozzleMaterial);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(x, -0.02, 1.55);
      this.shell.add(nozzle);

      // 喷焰：外层橙焰 + 内层亮核
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.5, 12), this.flameMaterial);
      flame.rotation.x = Math.PI / 2;
      flame.position.set(x, -0.02, 2.5);
      this.group.add(flame);
      this.flames.push(flame);

      const core = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.9, 10), this.coreMaterial);
      core.rotation.x = Math.PI / 2;
      core.position.set(x, -0.02, 2.25);
      this.group.add(core);
      this.flames.push(core);
    }
  }

  private buildMuzzles(): void {
    const span = this.def.wingSpan;
    for (const side of [-1, 1]) {
      const muzzle = new THREE.Object3D();
      muzzle.position.set(side * span * 0.86, -0.05, -0.9);
      this.group.add(muzzle);
      this.muzzles.push(muzzle);
    }
    const center = new THREE.Object3D();
    center.position.set(0, -0.1, -2.1);
    this.group.add(center);
    this.muzzles.push(center);
  }

  /** 喷焰脉动；thrust 用于加速时拉长火焰 */
  update(dt: number, thrust = 1): void {
    this.time += dt;
    const pulse = 0.82 + Math.sin(this.time * 38) * 0.1 + Math.random() * 0.08;
    // 喷口高温金属随推力/脉动变化：温度色带 + 强度一起推，加力时才有"烧红了"的感觉
    this.nozzleMaterial.emissiveIntensity = 1.35 + (pulse - 0.85) * 1.1 + (thrust - 1) * 0.6;
    this.nozzleHeat.value = 0.62 + (thrust - 1) * 0.55 + (pulse - 0.85) * 0.5;
    for (let i = 0; i < this.flames.length; i++) {
      const isCore = i % 2 === 1;
      const base = isCore ? 0.9 : 1.0;
      this.flames[i].scale.set(base, base * thrust, base * pulse * thrust);
      const mat = this.flames[i].material as THREE.MeshBasicMaterial;
      mat.opacity = isCore ? 0.85 : 0.62 + pulse * 0.3;
    }
  }

  dispose(): void {
    this.disposed = true;
    // 模型的几何体是全局共享的，这里只释放实例独占的材质克隆
    if (this.modelRoot) {
      this.group.remove(this.modelRoot);
      disposeModelMaterials(this.modelRoot);
      this.modelRoot = null;
    }
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      }
    });
    this.bodyMaterial.dispose();
    this.armorMaterial.dispose();
    this.darkMaterial.dispose();
    this.glassMaterial.dispose();
    this.nozzleMaterial.dispose();
    this.flameMaterial.dispose();
    this.coreMaterial.dispose();
  }
}
