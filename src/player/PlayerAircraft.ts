import * as THREE from 'three';
import type { AircraftDef } from '../data/aircraft';
import { applyEngineHeat, applyRimLight, createShieldMaterial } from '../render/MaterialFX';
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

/** 玩家护盾颜色：清透天蓝（薄膜质感，不再偏白高亮） */
const PLAYER_SHIELD_COLOR = 0x4d9fff;
/** 护盾生成动画时长（秒）：扫描展开 + 放大 */
const SHIELD_SPAWN_TIME = 0.42;
/** 护盾破裂动画时长（秒）：网格瓦解 + 淡出 */
const SHIELD_BREAK_TIME = 0.45;
/** 受击涟漪时长（秒）：强度 1→0，短促轻盈（0.15~0.25s 量级） */
const SHIELD_RIPPLE_TIME = 0.2;
/** GLB 迟迟不到位时，恢复程序化机体的兜底时间（毫秒）：宁可晚一点出飞机，也不要闪旧模型 */
const MODEL_FALLBACK_DELAY = 1200;

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

  /** 玩家护盾可视化：薄膜罩 + 受击涟漪 + 生成 / 破裂动画 */
  private readonly shieldMesh: THREE.Mesh;
  private shieldRatio = 1;
  /** 护盾状态机：生成 → 常驻 → 破裂 → 隐藏 */
  private shieldState: 'hidden' | 'spawning' | 'active' | 'breaking' = 'hidden';
  /** 生成进度 0→1（Shader 扫描展开 + 尺寸 easeOut） */
  private shieldSpawn = 0;
  /** 破裂进度 0→1（网格瓦解 + 淡出） */
  private shieldBreak = 0;
  /** 受击涟漪强度 1→0，同时驱动波纹半径 */
  private shieldHitStrength = 0;
  /** 护盾泡半径（group 局部空间，单位球缩放），按机体包围球自动贴合 */
  private shieldRadius = 3;
  private readonly shieldCenter = new THREE.Vector3();
  /** 击中点在单位球空间的局部坐标（护盾 Shader 的 uHitPosition） */
  private readonly hitLocal = new THREE.Vector3(0, 1, 0);
  private readonly invGroup = new THREE.Matrix4();

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

    // 护盾外壳：复用能量护盾 Shader，调成极薄的淡蓝薄膜——
    // 中心 alpha = 0、网格极淡、只有最外圈一条极窄的淡蓝微光
    // 几何体是单位球，尺寸 / 位置由 updateShieldFit() 按机体包围球自动贴合
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 32),
      createShieldMaterial(PLAYER_SHIELD_COLOR, {
        core: 0, // 罩内不做任何填充
        hexAlpha: 1.6, // 蜂窝网很淡
        hexCenter: 0.05, // 中心几乎不留网格
        rimPower: 3.4, // 边缘带压得极窄
        rimAlpha: 3.2, // 边缘单独给一点亮度（乘上 uOpacity 后 ≈ 0.45）
        baseGain: 0.6, // 底色压暗
        rimGain: 0.45, // 边缘不刷白，保持淡蓝微光
      }),
    );
    this.shieldMesh.name = 'player-shield';
    this.shieldMesh.visible = false;
    this.group.add(this.shieldMesh);
    this.updateShieldFit();
    // 护盾就绪后再挂模型：applyModel 会按新包围球重算护盾
    this.mountExternalModel();
  }

  /**
   * 外部 GLB：已缓存就直接挂（进场即最终外观，不会闪）；
   * 没缓存则**先不显示程序化机体**——否则会先看到旧飞机，加载完再"闪"一下换成 GLB。
   * 网络太慢时由 `MODEL_FALLBACK_DELAY` 兜底恢复程序化机体，保证玩家不会没有飞机。
   */
  private mountExternalModel(): void {
    const url = this.def.model ?? PLAYER_MODEL_URL;
    const cached = getModel(url);
    if (cached) {
      this.applyModel(cached);
      return;
    }

    this.shell.visible = false;
    let timer = 0;
    const useShell = (): void => {
      if (timer) window.clearTimeout(timer);
      // 已经挂上 GLB 就别再把程序化机体放出来
      if (!this.modelRoot) this.shell.visible = true;
    };
    timer = window.setTimeout(useShell, MODEL_FALLBACK_DELAY);

    preloadModel(url)
      .then(() => {
        if (this.disposed) return;
        const model = getModel(url);
        // 程序化机体此时仍是隐藏的，缺模型就把它放出来顶上
        if (model) this.applyModel(model);
        else useShell();
      })
      .catch(() => {
        console.warn('[model] 玩家机模型加载失败，沿用程序化机体：', url);
        useShell();
      })
      .finally(() => {
        if (timer) window.clearTimeout(timer);
      });
  }

  private applyModel(model: THREE.Group): void {
    preparePlayerModel(model, this.def);
    this.shell.visible = false;
    this.group.add(model);
    this.modelRoot = model;
    // 模型尺寸与程序化机体不同，护盾泡要按新包围球重算
    this.updateShieldFit();
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

    // 护罩状态机 + uniform 驱动（生成 / 常驻 / 受击涟漪 / 破裂）
    this.updateShield(dt);
  }

  setShieldRatio(ratio: number): void {
    this.shieldRatio = Math.max(0, Math.min(1, ratio));
    const hasShield = this.shieldRatio > 0;
    if (hasShield && (this.shieldState === 'hidden' || this.shieldState === 'breaking')) {
      // 新护盾（开局 / 补给）：从头播放生成动画
      this.shieldState = 'spawning';
      this.shieldSpawn = 0;
      this.shieldBreak = 0;
      this.shieldHitStrength = 0;
    } else if (!hasShield && (this.shieldState === 'active' || this.shieldState === 'spawning')) {
      // 护盾被打空：能量解体，而不是啪地隐藏
      this.shieldState = 'breaking';
      this.shieldBreak = 0;
    }
  }

  /** 护盾受击：worldPoint 为世界空间击中坐标，用于在罩面上定位涟漪 */
  shieldHit(worldPoint?: THREE.Vector3): void {
    this.shieldHitStrength = 1;
    if (worldPoint) {
      // 世界坐标 → group 局部 → 相对罩心 → 单位球方向
      this.group.updateWorldMatrix(true, false);
      this.invGroup.copy(this.group.matrixWorld).invert();
      this.hitLocal.copy(worldPoint).applyMatrix4(this.invGroup).sub(this.shieldCenter);
      if (this.hitLocal.lengthSq() < 1e-6) this.hitLocal.set(0, 0.4, -1);
      this.hitLocal.normalize();
    } else {
      // 没有坐标时默认打在机头上方
      this.hitLocal.set(0, 0.4, -1).normalize();
    }
    (this.shieldMesh.material as THREE.ShaderMaterial).uniforms.uHitPosition.value.copy(this.hitLocal);
  }

  /** 护盾状态推进 + Shader uniform 同步 */
  private updateShield(dt: number): void {
    const mat = this.shieldMesh.material as THREE.ShaderMaterial;
    const u = mat.uniforms;

    if (this.shieldState === 'spawning') {
      this.shieldSpawn = Math.min(1, this.shieldSpawn + dt / SHIELD_SPAWN_TIME);
      if (this.shieldSpawn >= 1) this.shieldState = 'active';
    } else if (this.shieldState === 'breaking') {
      this.shieldBreak = Math.min(1, this.shieldBreak + dt / SHIELD_BREAK_TIME);
      if (this.shieldBreak >= 1) this.shieldState = 'hidden';
    }
    if (this.shieldHitStrength > 0) {
      this.shieldHitStrength = Math.max(0, this.shieldHitStrength - dt / SHIELD_RIPPLE_TIME);
    }

    this.shieldMesh.visible = this.shieldState !== 'hidden';
    if (!this.shieldMesh.visible) return;

    u.uTime.value = this.time;
    u.uSpawn.value = this.shieldSpawn;
    u.uBreak.value = this.shieldBreak;
    u.uHitStrength.value = this.shieldHitStrength;
    // 极薄：整体 alpha 只有 0.05~0.15。受击**不**整体提亮 / 不闪烁，
    // 反馈只来自 Shader 里击中点那一小圈涟漪
    u.uOpacity.value = 0.05 + this.shieldRatio * 0.1;

    // 尺寸：生成时 easeOut 展开（Shader 同时有一条扫描线），破裂时略微膨胀再瓦解
    const spawnEase = 1 - Math.pow(1 - this.shieldSpawn, 3);
    const pulse = 1 + Math.sin(this.time * 5.5) * 0.03;
    this.shieldMesh.scale.setScalar(
      this.shieldRadius * spawnEase * pulse * (1 + this.shieldBreak * 0.14),
    );
  }

  /** 护盾泡贴合机体：按外部模型（优先）或程序化机体的包围球计算半径与中心 */
  private updateShieldFit(): void {
    if (!this.shieldMesh) return;
    const target = this.modelRoot ?? this.shell;
    this.group.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return;

    // 包围盒是世界空间的，转回 group 局部空间（护盾是 group 的子节点）
    const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    box.applyMatrix4(inv);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.shieldCenter.copy(sphere.center);
    // 留 8% 余量：脉动缩放时也不会露出机头 / 翼尖
    this.shieldRadius = sphere.radius * 1.08;
    this.shieldMesh.position.copy(this.shieldCenter);
    this.shieldMesh.scale.setScalar(this.shieldRadius);
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
    (this.shieldMesh.material as THREE.Material).dispose();
  }
}
