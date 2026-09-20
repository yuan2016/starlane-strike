import * as THREE from 'three';
import { LEVELS, type BossPreset } from '../data/levels';
import type { BulletSystem } from '../combat/BulletSystem';
import type { ParticleSystem } from '../effects/ParticleSystem';
import type { ExplosionSystem } from '../effects/Explosion';
import { applyRimLight } from '../render/MaterialFX';
import {
  BOSS_MODEL_URL,
  disposeModelMaterials,
  getModel,
  prepareBossModel,
  preloadModel,
} from '../render/ModelAssets';
import { getCircuitTexture, getEnergyTexture, getSurfaceMaps } from '../render/ProcTextures';

export type BossPhase = 1 | 2 | 3;
export type BossState = 'idle' | 'entering' | 'fighting' | 'dying' | 'dead';

export interface BossContext {
  playerPos: THREE.Vector3;
  bullets: BulletSystem;
  particles: ParticleSystem;
  explosions: ExplosionSystem;
  /** 激光命中玩家时的伤害回调 */
  damagePlayer: (amount: number) => void;
  shake: (intensity: number) => void;
  /** 主炮激光状态（充能 / 发射 / 结束），用于音效联动 */
  onBeam?: (state: 'charge' | 'fire' | 'end') => void;
}

export interface Hitbox {
  offsetX: number;
  offsetZ: number;
  radius: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** 击毁后禁用对应武器 */
  disables: 'left' | 'right' | null;
  mesh: THREE.Object3D | null;
}

const MAX_HP = 4200;
const TURRET_HP = 520;
/** 中央核心自发光色：锁定高强度红，阶段配色改由核心光环承担 */
const CORE_EMISSIVE = 0xff1100;

/**
 * 重型主翼轮廓（Shape 平面：+X = 翼展方向，-Y = 舰首方向）。
 * 全部用直线段手工倒角，做出"斜切角 + 阶梯后缘"的硬朗机械剪影，
 * 再用 ExtrudeGeometry 挤出厚度（倒角段数 1 → 保留锐利切面）。
 */
function createWingShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, -2.75); // 翼根前缘
  s.lineTo(1.65, -2.7);
  s.lineTo(3.35, -1.85); // 前缘后掠
  s.lineTo(4.35, -1.05);
  s.lineTo(4.75, -0.55); // 翼尖前斜切
  s.lineTo(4.75, 0.15);
  s.lineTo(4.1, 0.75); // 翼尖后斜切
  s.lineTo(3.05, 1.05);
  s.lineTo(2.9, 1.75); // 后缘阶梯
  s.lineTo(1.55, 2.15);
  s.lineTo(1.4, 2.85); // 后缘第二级阶梯
  s.lineTo(0, 3.25); // 翼根后缘
  s.closePath();

  // 翼面散热槽：两道斜切长孔（平行四边形，ExtrudeGeometry 会直接挖穿）
  for (const [cx, cy, r] of [
    [1.5, -1.45, 0.55],
    [2.95, -0.5, 0.5],
  ] as Array<[number, number, number]>) {
    const w = r * 1.45;
    const h = r * 0.5;
    const k = r * 0.42; // 斜切量：两端错开，形成平行四边形
    const hole = new THREE.Path();
    hole.moveTo(cx - w + k, cy - h);
    hole.lineTo(cx + w + k, cy - h);
    hole.lineTo(cx + w - k, cy + h);
    hole.lineTo(cx - w - k, cy + h);
    hole.closePath();
    s.holes.push(hole);
  }
  return s;
}

/** 翼尖垂直安定面（Shape 平面：+X = 舰首方向，+Y = 上） */
function createFinShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.55, 0.05);
  s.lineTo(0.95, 0);
  s.lineTo(1.6, 0.15);
  s.lineTo(1.5, 1.05); // 前缘上掠
  s.lineTo(0.72, 1.4); // 顶部斜切
  s.lineTo(-0.12, 1.05);
  s.lineTo(-0.62, 0.35); // 后缘斜切
  s.closePath();
  return s;
}

/** 齿轮环轮廓：梯形齿 + 中心圆孔（孔要反向绘制，ExtrudeGeometry 才会挖空） */
function createGearShape(o: { outer: number; root: number; inner: number; teeth: number }): THREE.Shape {
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / o.teeth;
  let first = true;
  for (let i = 0; i < o.teeth; i++) {
    const a0 = i * step;
    const seq: Array<[number, number]> = [
      [a0, o.root],
      [a0 + step * 0.14, o.outer],
      [a0 + step * 0.36, o.outer],
      [a0 + step * 0.5, o.root],
      [a0 + step * 0.86, o.root],
    ];
    for (const [a, r] of seq) {
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (first) {
        shape.moveTo(x, y);
        first = false;
      } else {
        shape.lineTo(x, y);
      }
    }
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, o.inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return shape;
}

/**
 * 章节 Boss：大型母舰，具备入场、三阶段弹幕（扇形 / 环形 / 追踪导弹 / 激光扫射）与死亡演出。
 * 主体与两侧炮台是三个独立可击破的受击部位。
 */
export class Boss {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  readonly hitboxes: Hitbox[] = [];

  name = '「深渊」级母舰';
  hp = MAX_HP;
  maxHp = MAX_HP;
  state: BossState = 'idle';
  active = false;

  /** 阶段切换事件（1 → 2 → 3），供 UI 演出与音效使用 */
  onPhaseChange: ((phase: BossPhase) => void) | null = null;

  /** 当前 Boss 变体（由关卡指定） */
  private preset: BossPreset = LEVELS[0].boss;

  /** 主体判定半径 */
  radius = 3.6;

  private age = 0;
  /**
   * 战斗阶段的横移时钟（秒）。入场结束切入战斗时**从 0 开始**，
   * 保证 `sin(0) = 0` → 舰体从入场时的正中央（x=0 / z=-16）连续过渡到左右巡航，
   * 不会在第一帧跳到 `sin(age * 0.42)` 的当前相位上。
   */
  private swayTime = 0;
  private attackTimer = 2;
  private patternStep = 0;
  private dyingTimer = 0;
  private deathBurstTimer = 0;

  private beam: THREE.Mesh;
  private beamState: 'idle' | 'charge' | 'fire' = 'idle';
  private beamTimer = 0;
  private beamX = 0;

  /** 上一次记录的阶段，用于检测切换 */
  private lastPhase: BossPhase = 1;
  /** 阶段切换演出剩余时间 */
  private phaseFlash = 0;
  /** 最近一次更新上下文（用于击毁时收尾激光音效） */
  private lastCtx: BossContext | null = null;

  private readonly core: THREE.Mesh;
  private readonly coreMaterial: THREE.MeshStandardMaterial;
  private readonly coreAura: THREE.Mesh;
  private readonly coreAuraMaterial: THREE.MeshBasicMaterial;
  private readonly hullMaterial: THREE.MeshStandardMaterial;
  private readonly plateMaterial: THREE.MeshStandardMaterial;
  /** 机翼：程序化回路流光 + Fresnel 蓝灰边缘光 */
  private readonly wingMaterial: THREE.MeshStandardMaterial;
  /** 齿轮 / 装甲外壳：粗糙深色金属 */
  private readonly gearMaterial: THREE.MeshStandardMaterial;
  private readonly glowMaterial: THREE.MeshStandardMaterial;
  private readonly turretMeshes: THREE.Object3D[] = [];
  /** 包裹核心的齿轮环（三个正交平面，反向缓转） */
  private readonly gears: THREE.Mesh[] = [];
  private readonly gearSpin: number[] = [];
  /** 机翼回路贴图（独立 clone，便于单独滚动 offset 做流光） */
  private readonly circuitMap: THREE.Texture;

  /** 程序化舰体（GLB 到位后隐藏） */
  private readonly shell = new THREE.Group();
  /** 外部 GLB 实例 */
  private modelRoot: THREE.Group | null = null;
  /** GLB 克隆材质（按名称在 spawn 时同步变体配色） */
  private readonly modelMats: THREE.MeshStandardMaterial[] = [];

  private readonly tmp = new THREE.Vector3();
  private readonly muzzle = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();

  constructor() {
    this.group.name = 'Boss';
    this.group.visible = false;

    const hullMaps = getSurfaceMaps('bossHull');
    const plateMaps = getSurfaceMaps('bossPlate');
    const energyMap = getEnergyTexture();
    // 烘焙 PBR 的 Roughness / Metallic 是绝对值，程序化回退是相对值
    const baked = hullMaps.aoMap !== undefined;

    // 主舰体：巨型装甲块 + 舷窗灯光
    this.hullMaterial = new THREE.MeshStandardMaterial({
      color: 0x39415c,
      map: hullMaps.map,
      roughnessMap: hullMaps.roughnessMap,
      normalMap: hullMaps.normalMap,
      metalnessMap: hullMaps.metalnessMap ?? null,
      aoMap: hullMaps.aoMap ?? null,
      aoMapIntensity: 1.15,
      emissiveMap: hullMaps.emissiveMap ?? null,
      emissive: new THREE.Color(0x6fc4ff),
      emissiveIntensity: 1.2,
      metalness: baked ? 1 : 0.88,
      roughness: baked ? 1 : 0.32,
      envMapIntensity: 1.2,
    });
    // 装甲板：更深、更粗糙，与主舰体形成材质层次
    this.plateMaterial = new THREE.MeshStandardMaterial({
      color: 0x1d2233,
      map: plateMaps.map,
      roughnessMap: plateMaps.roughnessMap,
      metalnessMap: plateMaps.metalnessMap ?? null,
      normalMap: plateMaps.normalMap,
      aoMap: plateMaps.aoMap ?? null,
      aoMapIntensity: 1.25,
      metalness: baked ? 1 : 0.82,
      roughness: baked ? 1 : 0.52,
      envMapIntensity: 1.1,
    });
    // 机翼：深色装甲底 + 青色回路流光（emissiveMap 用程序化科技回路图）
    this.circuitMap = getCircuitTexture().clone();
    this.circuitMap.wrapS = THREE.RepeatWrapping;
    this.circuitMap.wrapT = THREE.RepeatWrapping;
    this.circuitMap.repeat.set(0.34, 0.34);
    this.circuitMap.needsUpdate = true;

    this.wingMaterial = new THREE.MeshStandardMaterial({
      color: 0x2b3348,
      map: plateMaps.map,
      roughnessMap: plateMaps.roughnessMap,
      metalnessMap: plateMaps.metalnessMap ?? null,
      normalMap: plateMaps.normalMap,
      aoMap: plateMaps.aoMap ?? null,
      aoMapIntensity: 1.1,
      emissive: new THREE.Color(0x18d7ff),
      emissiveMap: this.circuitMap,
      emissiveIntensity: 1.75,
      metalness: baked ? 1 : 0.9,
      roughness: baked ? 1 : 0.38,
      envMapIntensity: 1.35,
    });
    // 齿轮 / 外壳：粗糙、低反射的深色金属，flatShading 保留硬朗切面
    this.gearMaterial = new THREE.MeshStandardMaterial({
      color: 0x232a3a,
      map: plateMaps.map,
      roughnessMap: plateMaps.roughnessMap,
      metalnessMap: plateMaps.metalnessMap ?? null,
      normalMap: plateMaps.normalMap,
      metalness: baked ? 1 : 0.92,
      roughness: baked ? 1 : 0.86,
      flatShading: true,
      envMapIntensity: 0.85,
    });
    this.coreMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a0703,
      emissive: CORE_EMISSIVE,
      emissiveMap: energyMap,
      emissiveIntensity: 3.2,
      metalness: 0.2,
      roughness: 0.35,
    });
    // 核心外光环：BackSide 加色球壳，颜色跟随阶段（核心本体锁定 #ff1100）
    this.coreAuraMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4d6a,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.glowMaterial = new THREE.MeshStandardMaterial({
      color: 0x59d0ff,
      emissive: 0x2aa9ff,
      emissiveMap: energyMap,
      emissiveIntensity: 1.6,
      metalness: 0.3,
      roughness: 0.4,
    });

    // 大型舰的剪影：冷蓝轮廓光，主舰体强于装甲板
    applyRimLight(this.hullMaterial, { color: 0x5aa8ff, power: 2.6, strength: 0.38 });
    applyRimLight(this.plateMaterial, { color: 0x3f7fd0, power: 2.4, strength: 0.26 });
    // 机翼 / 齿轮外壳：蓝灰色 Fresnel 边缘光，把深空里的重装机翼轮廓勾出来
    applyRimLight(this.wingMaterial, { color: 0x9fb8d8, power: 2.4, strength: 0.55 });
    applyRimLight(this.gearMaterial, { color: 0x8ba4c2, power: 2.2, strength: 0.34 });
    const hullMat = this.hullMaterial;
    const plateMat = this.plateMaterial;
    const wingMat = this.wingMaterial;
    const gearMat = this.gearMaterial;
    const glowMat = this.glowMaterial;

    // 主舰体
    const hull = new THREE.Mesh(new THREE.BoxGeometry(7.5, 1.8, 8), hullMat);
    hull.position.y = 0.2;
    const upper = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.1, 6), plateMat);
    upper.position.set(0, 1.2, -0.6);
    const prow = new THREE.Mesh(new THREE.ConeGeometry(2.6, 4.2, 4), hullMat);
    prow.rotation.x = Math.PI / 2;
    prow.rotation.z = Math.PI / 4;
    prow.position.set(0, 0.2, 5.6);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.0, 2.6), plateMat);
    bridge.position.set(0, 1.9, -1.4);
    this.shell.add(hull, upper, prow, bridge);
    this.group.add(this.shell);

    // 侧翼：Shape 轮廓 → ExtrudeGeometry 挤出厚度（倒角 1 段，保留硬切面）
    const wingGeo = new THREE.ExtrudeGeometry(createWingShape(), {
      depth: 0.78,
      bevelEnabled: true,
      bevelThickness: 0.16,
      bevelSize: 0.15,
      bevelOffset: 0,
      bevelSegments: 1,
      curveSegments: 1,
    });
    wingGeo.translate(0, 0, -0.39); // 厚度居中
    const finGeo = new THREE.ExtrudeGeometry(createFinShape(), {
      depth: 0.22,
      bevelEnabled: true,
      bevelThickness: 0.06,
      bevelSize: 0.07,
      bevelOffset: 0,
      bevelSegments: 1,
      curveSegments: 1,
    });
    finGeo.translate(0, 0, -0.11);

    for (const side of [-1, 1]) {
      // 翼根枢轴：给主翼一点上反角，避免整艘舰太平
      const pivot = new THREE.Group();
      pivot.position.set(side * 3.0, 0.1, -0.4);
      pivot.rotation.z = side * 0.06;

      const wing = new THREE.Mesh(wingGeo, wingMat);
      wing.scale.x = side; // 左翼镜像（负缩放会自动翻转背面剔除）
      wing.rotation.x = -Math.PI / 2; // 形状平面转到水平：-Y 指向舰首
      pivot.add(wing);

      const fin = new THREE.Mesh(finGeo, wingMat);
      fin.position.set(side * 4.3, 0.5, -0.9);
      fin.rotation.y = -Math.PI / 2; // 安定面立起来，法线朝舷侧
      pivot.add(fin);
      this.shell.add(pivot);

      // 炮台整体作为一个可击毁部件
      const turret = new THREE.Group();
      turret.position.set(side * 6.4, 0.7, 1.2);
      const turretBase = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.9, 12), plateMat);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 3.2, 10), hullMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = 1.7;
      const muzzleGlow = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), glowMat);
      muzzleGlow.position.z = 3.3;
      turret.add(turretBase, barrel, muzzleGlow);
      this.shell.add(turret);
      this.turretMeshes.push(turret);

      for (const zz of [-2.4, 0.6]) {
        const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.68, 1.4, 12), plateMat);
        engine.rotation.x = Math.PI / 2;
        engine.position.set(side * 3.6, -0.2, -3.4 + zz);
        const flame = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), glowMat);
        flame.position.set(side * 3.6, -0.2, -4.4 + zz);
        flame.scale.z = 1.6;
        this.shell.add(engine, flame);
      }
    }

    // 主炮
    for (const side of [-1, 1]) {
      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 4.4, 12), hullMat);
      gun.rotation.x = Math.PI / 2;
      gun.position.set(side * 1.6, -0.2, 4.6);
      this.shell.add(gun);
    }

    // 中央核心：#ff1100 高强度自发光球体 + 粗糙外壳齿轮包裹
    const coreGroup = new THREE.Group();
    coreGroup.position.set(0, 0.5, 2.6);

    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 3), this.coreMaterial);
    coreGroup.add(this.core);

    // 粗糙外壳：4 片弧形装甲瓣，留缝让红光从缝里透出来
    for (let i = 0; i < 4; i++) {
      const petal = new THREE.Mesh(
        new THREE.SphereGeometry(
          1.92,
          14,
          8,
          (i * Math.PI) / 2 + 0.26,
          Math.PI / 2 - 0.52,
          Math.PI * 0.16,
          Math.PI * 0.68,
        ),
        gearMat,
      );
      coreGroup.add(petal);
    }

    // 齿轮环：三片正交齿轮反向缓转，把核心"咬"在中间
    const gearGeo = new THREE.ExtrudeGeometry(
      createGearShape({ outer: 2.42, root: 2.08, inner: 1.88, teeth: 14 }),
      {
        depth: 0.38,
        bevelEnabled: true,
        bevelThickness: 0.08,
        bevelSize: 0.08,
        bevelOffset: 0,
        bevelSegments: 1,
        curveSegments: 1,
      },
    );
    gearGeo.translate(0, 0, -0.19);
    for (const def of [
      { rx: 0, ry: 0, spin: 0.55 },
      { rx: Math.PI / 2, ry: 0, spin: -0.42 },
      { rx: Math.PI / 2, ry: Math.PI / 2, spin: 0.34 },
    ]) {
      const gear = new THREE.Mesh(gearGeo, gearMat);
      gear.rotation.x = def.rx;
      gear.rotation.y = def.ry;
      coreGroup.add(gear);
      this.gears.push(gear);
      this.gearSpin.push(def.spin);
    }

    this.coreAura = new THREE.Mesh(new THREE.SphereGeometry(3.05, 20, 14), this.coreAuraMaterial);
    coreGroup.add(this.coreAura);
    this.group.add(coreGroup);

    // 激光束
    const beamGeo = new THREE.CylinderGeometry(0.34, 0.34, 90, 12, 1, true);
    beamGeo.translate(0, -45, 0);
    // 光束朝向 +Z（玩家方向）
    beamGeo.rotateX(Math.PI / 2);
    this.beam = new THREE.Mesh(
      beamGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff5c7a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.beam.visible = false;
    this.group.add(this.beam);

    this.hitboxes.push({
      offsetX: 0,
      offsetZ: 0,
      radius: this.radius,
      hp: MAX_HP,
      maxHp: MAX_HP,
      alive: true,
      disables: null,
      mesh: null,
    });
    for (const side of [-1, 1]) {
      this.hitboxes.push({
        offsetX: side * 6.4,
        offsetZ: 1.2,
        radius: 1.5,
        hp: TURRET_HP,
        maxHp: TURRET_HP,
        alive: true,
        disables: side < 0 ? 'left' : 'right',
        mesh: side < 0 ? this.turretMeshes[0] : this.turretMeshes[1],
      });
    }

    this.mountExternalModel();
  }

  /** 外部 GLB：已缓存就直接挂，否则后台加载完再顶替程序化舰体 */
  private mountExternalModel(): void {
    const cached = getModel(BOSS_MODEL_URL);
    if (cached) {
      this.applyModel(cached);
      return;
    }
    preloadModel(BOSS_MODEL_URL)
      .then(() => {
        const model = getModel(BOSS_MODEL_URL);
        if (model) this.applyModel(model);
        this.syncModelTint();
      })
      .catch(() => {
        // 程序化舰体已在场，缺模型不影响可玩性
      });
  }

  /** 挂载 GLB：归一化后顶掉程序化舰体，并记录材质用于变体配色同步 */
  private applyModel(model: THREE.Group): void {
    if (this.modelRoot) {
      this.group.remove(this.modelRoot);
      disposeModelMaterials(this.modelRoot);
    }
    prepareBossModel(model, this.preset);
    this.modelMats.length = 0;
    model.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mat = obj.material;
      if (mat instanceof THREE.MeshStandardMaterial) this.modelMats.push(mat);
    });
    this.shell.visible = false;
    this.group.add(model);
    this.modelRoot = model;
  }

  /** 变体配色：GLB 材质按名称向 preset 配色靠拢 */
  private syncModelTint(): void {
    const hull = new THREE.Color(this.preset.hull);
    const plate = new THREE.Color(this.preset.plate);
    for (const mat of this.modelMats) {
      if (mat.name === 'TitaniumHull') mat.color.lerp(hull, 0.5);
      else if (mat.name === 'ArmorPlate') mat.color.lerp(plate, 0.5);
    }
  }

  get phase(): BossPhase {
    const r = this.hp / this.maxHp;
    if (r > 0.7) return 1;
    if (r > 0.3) return 2;
    return 3;
  }

  get hpRatio(): number {
    return Math.max(this.hp, 0) / this.maxHp;
  }

  get isVulnerable(): boolean {
    return this.state === 'fighting';
  }

  /** 切换 Boss 变体（关卡开始时调用，下次 spawn 生效） */
  configure(preset: BossPreset): void {
    this.preset = preset;
    this.name = preset.name;
    this.maxHp = preset.maxHp;
  }

  spawn(): void {
    const preset = this.preset;
    this.name = preset.name;
    this.maxHp = preset.maxHp;
    this.hp = preset.maxHp;
    this.hullMaterial.color.set(preset.hull);
    this.plateMaterial.color.set(preset.plate);
    this.glowMaterial.color.set(preset.glow);
    this.glowMaterial.emissive.set(preset.glow);
    this.syncModelTint();
    // 核心本体固定 #ff1100，变体配色走核心光环
    this.coreAuraMaterial.color.set(preset.core);
    this.hitboxes[0].maxHp = preset.maxHp;
    for (let i = 1; i < this.hitboxes.length; i++) {
      this.hitboxes[i].maxHp = preset.turretHp;
    }
    this.active = true;
    this.state = 'entering';
    this.age = 0;
    this.swayTime = 0;
    this.attackTimer = 2.4;
    this.patternStep = 0;
    this.dyingTimer = 0;
    this.lastPhase = 1;
    this.phaseFlash = 0;
    this.position.set(0, 0, -52);
    this.group.position.copy(this.position);
    this.group.visible = true;
    this.group.rotation.set(0, 0, 0);
    for (const box of this.hitboxes) {
      box.hp = box.maxHp;
      box.alive = true;
      if (box.mesh) box.mesh.visible = true;
    }
  }

  /** 返回 true 表示 Boss 被击毁 */
  takeDamage(amount: number, hitboxIndex: number): boolean {
    if (!this.isVulnerable) return false;
    const box = this.hitboxes[hitboxIndex];
    if (!box || !box.alive) return false;

    if (hitboxIndex === 0) {
      this.hp -= amount;
      if (this.hp <= 0) {
        this.hp = 0;
        this.beginDeath();
        return true;
      }
    } else {
      box.hp -= amount;
      if (box.hp <= 0) {
        box.hp = 0;
        box.alive = false;
        if (box.mesh) box.mesh.visible = false;
      }
    }
    return false;
  }

  private beginDeath(): void {
    this.state = 'dying';
    this.dyingTimer = 0;
    this.deathBurstTimer = 0;
    this.beamState = 'idle';
    this.beam.visible = false;
    this.lastCtx?.onBeam?.('end');
  }

  update(dt: number, ctx: BossContext): void {
    if (!this.active) return;
    this.lastCtx = ctx;
    this.age += dt;

    switch (this.state) {
      case 'entering': {
        this.position.z += 14 * dt;
        if (this.position.z >= -16) {
          this.position.z = -16;
          this.state = 'fighting';
          // 从 0 起算：横移 / 前后浮动 / 侧倾都从"入场终态"开始，避免切状态瞬间弹一下
          this.swayTime = 0;
        }
        break;
      }
      case 'fighting': {
        this.swayTime += dt;
        this.position.x = Math.sin(this.swayTime * 0.42) * 5.6;
        this.position.z = -16 + Math.sin(this.swayTime * 0.6) * 1.4;
        this.group.rotation.z = Math.sin(this.swayTime * 0.42) * 0.05;
        this.updateAttacks(dt, ctx);
        break;
      }
      case 'dying': {
        this.dyingTimer += dt;
        this.position.z += 1.2 * dt;
        this.group.rotation.z += dt * 0.35;
        this.deathBurstTimer -= dt;
        if (this.deathBurstTimer <= 0) {
          this.deathBurstTimer = 0.16;
          const p = this.tmp
            .set(
              this.position.x + (Math.random() * 2 - 1) * 7,
              (Math.random() * 2 - 1) * 1.5,
              this.position.z + (Math.random() * 2 - 1) * 5,
            )
            .clone();
          ctx.explosions.explode({
            position: p,
            scale: 1.4 + Math.random(),
            color: 0xffb14d,
            ringColor: 0xff5c7a,
          });
          ctx.shake(0.18);
        }
        if (this.dyingTimer > 2.2) {
          this.state = 'dead';
          this.active = false;
          this.group.visible = false;
        }
        break;
      }
      default:
        break;
    }

    this.group.position.copy(this.position);

    // 阶段配色 + 核心脉动
    const phase = this.phase;
    if (this.state === 'fighting' && phase !== this.lastPhase) {
      this.lastPhase = phase;
      this.phaseFlash = 1.1;
      this.onPhaseChange?.(phase);
      ctx.shake(0.5);
      // 阶段切换：核心炸出一圈能量环
      ctx.particles.emit({
        position: this.tmp.set(this.position.x, 0.5, this.position.z + 2.6),
        count: 46,
        color: this.preset.phaseColors[phase - 1],
        speed: 16,
        size: 0.6,
        life: 0.7,
        drag: 2,
      });
      ctx.explosions.explode({
        position: this.tmp,
        scale: 2.2,
        color: this.preset.phaseColors[phase - 1],
        ringColor: 0xffffff,
        particleCount: 30,
      });
    }

    let flashBoost = 0;
    if (this.phaseFlash > 0) {
      this.phaseFlash = Math.max(0, this.phaseFlash - dt);
      flashBoost = this.phaseFlash * 3.2;
      // 演出期间舰体抖动，强化"进入下一阶段"的压迫感
      this.group.rotation.z += Math.sin(this.age * 60) * 0.02 * this.phaseFlash;
    }

    const targetColor = this.preset.phaseColors[phase - 1];
    this.tmpColor.set(targetColor);
    // 阶段配色体现在核心光环上；核心本体锁定 #ff1100，只做强度脉动
    this.coreAuraMaterial.color.lerp(this.tmpColor, 1 - Math.exp(-2 * dt));
    this.coreMaterial.emissiveIntensity =
      3.2 + flashBoost + Math.sin(this.age * (phase === 3 ? 14 : 6)) * 0.7;
    this.coreAuraMaterial.opacity =
      0.2 + Math.sin(this.age * 4.5) * 0.05 + this.phaseFlash * 0.35;
    this.coreAura.scale.setScalar(1 + Math.sin(this.age * 4.5) * 0.05 + this.phaseFlash * 0.22);
    this.core.rotation.y += dt * (0.6 + phase * 0.4);
    this.core.scale.setScalar(1 + Math.sin(this.age * 5) * 0.04 + this.phaseFlash * 0.18);

    // 机翼回路流光：贴图沿 v 方向缓慢滚动
    this.circuitMap.offset.y = (this.circuitMap.offset.y + dt * 0.045) % 1;
    // 齿轮外壳：三环反向缓转，阶段越高转得越快
    const spinBoost = 1 + (phase - 1) * 0.35;
    for (let i = 0; i < this.gears.length; i++) {
      this.gears[i].rotation.z += dt * this.gearSpin[i] * spinBoost;
    }
  }

  private updateAttacks(dt: number, ctx: BossContext): void {
    this.updateBeam(dt, ctx);

    this.attackTimer -= dt;
    if (this.attackTimer > 0) return;

    const phase = this.phase;

    const mul = this.preset.intervalMul;
    if (phase === 1) {
      const seq = ['fan3', 'ring12', 'aimed'];
      this.runAttack(seq[this.patternStep % seq.length], ctx);
      this.attackTimer = 1.9 * mul;
    } else if (phase === 2) {
      const seq = ['fan5', 'ring16', 'missile', 'side'];
      this.runAttack(seq[this.patternStep % seq.length], ctx);
      this.attackTimer = 1.45 * mul;
    } else {
      const seq = ['laser', 'ring22', 'fan7', 'missile', 'ring18'];
      this.runAttack(seq[this.patternStep % seq.length], ctx);
      this.attackTimer = 1.05 * mul;
    }
    this.patternStep++;
  }

  private runAttack(kind: string, ctx: BossContext): void {
    switch (kind) {
      case 'fan3':
        this.fanShot(3, 0.34, 20, ctx);
        break;
      case 'fan5':
        this.fanShot(5, 0.5, 21, ctx);
        break;
      case 'fan7':
        this.fanShot(7, 0.62, 23, ctx);
        break;
      case 'ring12':
        this.ringShot(12, 15, ctx);
        break;
      case 'ring16':
        this.ringShot(16, 17, ctx);
        break;
      case 'ring18':
        this.ringShot(18, 19, ctx);
        break;
      case 'ring22':
        this.ringShot(22, 20, ctx);
        break;
      case 'aimed':
        this.aimedShot(3, 26, ctx);
        break;
      case 'missile':
        this.missileVolley(this.phase === 3 ? 3 : 2, ctx);
        break;
      case 'side':
        this.sideBurst(ctx);
        break;
      case 'laser':
        this.startBeam(ctx);
        break;
      default:
        break;
    }
  }

  /** 朝玩家方向的扇形弹幕 */
  private fanShot(count: number, spread: number, speed: number, ctx: BossContext): void {
    this.muzzle.set(this.position.x, 0, this.position.z + 3.4);
    const base = Math.atan2(ctx.playerPos.x - this.position.x, ctx.playerPos.z - this.position.z);
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) - 0.5 : 0;
      const angle = base + t * spread * 2;
      ctx.bullets.spawn('enemy', this.muzzle, this.tmp.set(Math.sin(angle), 0, Math.cos(angle)), {
        speed: speed * this.preset.speedMul,
        damage: 14 * this.preset.damageMul,
        color: 0xff6b8a,
        radius: 0.45,
        length: 1.1,
        life: 7,
        trailRate: 16,
      });
    }
    ctx.particles.emit({
      position: this.muzzle,
      count: 8,
      color: 0xff9bb0,
      speed: 6,
      size: 0.4,
      life: 0.25,
      drag: 4,
    });
  }

  /** 环形弹幕 */
  private ringShot(count: number, speed: number, ctx: BossContext): void {
    this.muzzle.copy(this.position);
    const offset = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const angle = offset + (i / count) * Math.PI * 2;
      ctx.bullets.spawn('enemy', this.muzzle, this.tmp.set(Math.sin(angle), 0, Math.cos(angle)), {
        speed: speed * this.preset.speedMul,
        damage: 12 * this.preset.damageMul,
        color: 0xffa2c4,
        radius: 0.42,
        length: 1,
        life: 8,
        trailRate: 12,
      });
    }
    ctx.shake(0.05);
  }

  private aimedShot(count: number, speed: number, ctx: BossContext): void {
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) - 0.5 : 0;
      this.muzzle.set(this.position.x + t * 3.2, 0, this.position.z + 4.2);
      const dir = this.tmp.copy(ctx.playerPos).sub(this.position).normalize();
      ctx.bullets.spawn('enemy', this.muzzle, dir, {
        speed: speed * this.preset.speedMul,
        damage: 15 * this.preset.damageMul,
        color: 0xffd166,
        radius: 0.4,
        length: 1.3,
        life: 6,
        trailRate: 18,
      });
    }
  }

  private missileVolley(count: number, ctx: BossContext): void {
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const box = side < 0 ? this.hitboxes[1] : this.hitboxes[2];
      if (!box.alive) continue;
      this.muzzle.set(this.position.x + box.offsetX, 0.7, this.position.z + box.offsetZ + 2);
      const dir = this.tmp.set(side * 0.4, 0, 1).normalize();
      ctx.bullets.spawn('enemy', this.muzzle, dir, {
        speed: 18 * this.preset.speedMul,
        damage: 18 * this.preset.damageMul,
        color: 0x9be7ff,
        radius: 0.5,
        length: 1.4,
        life: 6.5,
        trailRate: 26,
        homing: ctx.playerPos,
        homingStrength: 1.6,
      });
    }
  }

  private sideBurst(ctx: BossContext): void {
    for (const idx of [1, 2]) {
      const box = this.hitboxes[idx];
      if (!box.alive) continue;
      this.muzzle.set(this.position.x + box.offsetX, 0.7, this.position.z + box.offsetZ + 2);
      const towardPlayer = ctx.playerPos.x > this.position.x ? 0.35 : -0.35;
      for (let i = -1; i <= 1; i++) {
        const angle = towardPlayer + i * 0.22;
        ctx.bullets.spawn('enemy', this.muzzle, this.tmp.set(Math.sin(angle), 0, Math.cos(angle)), {
          speed: 22 * this.preset.speedMul,
          damage: 13 * this.preset.damageMul,
          color: 0xc0a8ff,
          radius: 0.42,
          length: 1.1,
          life: 6,
          trailRate: 16,
        });
      }
    }
  }

  private startBeam(ctx: BossContext): void {
    if (this.beamState !== 'idle') return;
    this.beamState = 'charge';
    this.beamTimer = 0.9;
    this.beamX = ctx.playerPos.x;
    this.beam.visible = true;
    this.beam.position.set(0, 0, 4);
    ctx.onBeam?.('charge');
  }

  private updateBeam(dt: number, ctx: BossContext): void {
    if (this.beamState === 'idle') return;
    const mat = this.beam.material as THREE.MeshBasicMaterial;
    this.beamTimer -= dt;

    if (this.beamState === 'charge') {
      // 充能：细光束 + 追踪玩家当前 X
      this.beamX += (ctx.playerPos.x - this.beamX) * (1 - Math.exp(-2.5 * dt));
      this.beam.position.x = this.beamX - this.position.x;
      const t = 1 - Math.max(this.beamTimer, 0) / 0.9;
      this.beam.scale.set(0.35 + t * 0.4, 1, 0.35 + t * 0.4);
      mat.opacity = 0.25 + t * 0.35;
      ctx.particles.emit({
        position: this.tmp.set(this.beamX, 0, this.position.z + 4),
        count: 2,
        color: 0xff8fa8,
        speed: 3,
        size: 0.5,
        life: 0.3,
        drag: 3,
      });
      if (this.beamTimer <= 0) {
        this.beamState = 'fire';
        this.beamTimer = 1.25;
        ctx.shake(0.25);
        ctx.onBeam?.('fire');
      }
      return;
    }

    // 发射：粗光束持续伤害
    const t = 1 - Math.max(this.beamTimer, 0) / 1.25;
    this.beam.scale.set(1.25 + Math.sin(this.age * 40) * 0.12, 1, 1.25 + Math.sin(this.age * 40) * 0.12);
    mat.opacity = 0.75 * (1 - t * 0.35);
    ctx.particles.emit({
      position: this.tmp.set(this.beamX, 0, this.position.z + 6),
      count: 3,
      color: 0xffd0dc,
      speed: 8,
      size: 0.45,
      life: 0.25,
      drag: 4,
    });

    // 命中判定：玩家位于光束横向范围内
    if (Math.abs(ctx.playerPos.x - this.beamX) < 1.1) {
      ctx.damagePlayer(28 * this.preset.damageMul * dt);
    }

    if (this.beamTimer <= 0) {
      this.beamState = 'idle';
      this.beam.visible = false;
      mat.opacity = 0;
      ctx.onBeam?.('end');
    }
  }

  dispose(): void {
    // 先摘掉 GLB：几何体是全局共享的，不能随 Boss 一起 dispose
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
    this.circuitMap.dispose();
    this.hullMaterial.dispose();
    this.plateMaterial.dispose();
    this.wingMaterial.dispose();
    this.gearMaterial.dispose();
    this.coreMaterial.dispose();
    this.coreAuraMaterial.dispose();
    this.glowMaterial.dispose();
  }
}
