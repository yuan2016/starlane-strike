import * as THREE from 'three';
import { BATTLE_FIELD } from '../config';
import type { BulletSystem } from '../combat/BulletSystem';
import type { ParticleSystem } from '../effects/ParticleSystem';
import type { EnemyDef, EnemyKind } from '../data/enemies';
import { applyRimLight, createShieldMaterial } from '../render/MaterialFX';
import { getEnergyTexture, getSurfaceMaps } from '../render/ProcTextures';

/** 激光状态（供音效 / UI 联动） */
export type EnemyBeamState = 'charge' | 'fire' | 'end';

export interface EnemyUpdateContext {
  playerPos: THREE.Vector3;
  bullets: BulletSystem;
  /** 是否允许开火（Boss 演出 / 暂停时关闭） */
  canFire: boolean;
  /** 激光塔破盾等表现需要的粒子系统 */
  particles: ParticleSystem;
  /** 激光持续伤害入口（绕过无敌帧，走护盾 → 生命结算） */
  damagePlayer?: (amount: number) => void;
  /** 激光状态回调 */
  onBeam?: (state: EnemyBeamState) => void;
}

/** 共享几何，避免每个敌机实例重复创建 */
const GEO = {
  coneSmall: new THREE.ConeGeometry(0.55, 1.8, 8),
  coneLong: new THREE.ConeGeometry(0.35, 2.4, 6),
  coneBig: new THREE.ConeGeometry(0.95, 3.2, 10),
  cylBody: new THREE.CylinderGeometry(0.5, 0.5, 1.4, 10),
  boxWing: new THREE.BoxGeometry(2.6, 0.13, 0.95),
  boxHull: new THREE.BoxGeometry(3.2, 0.9, 2.8),
  boxFin: new THREE.BoxGeometry(0.12, 0.75, 0.6),
  sphereCore: new THREE.SphereGeometry(0.28, 10, 8),
  sphereBig: new THREE.SphereGeometry(0.62, 14, 12),
  turret: new THREE.CylinderGeometry(0.26, 0.3, 1.5, 10),
  icosa: new THREE.IcosahedronGeometry(0.9, 0),
  torus: new THREE.TorusGeometry(1.0, 0.09, 8, 20),
  spike: new THREE.ConeGeometry(0.3, 1.3, 8),
  engine: new THREE.CylinderGeometry(0.24, 0.28, 0.7, 10),
  pylon: new THREE.CylinderGeometry(0.34, 0.62, 1.7, 8),
  ringBig: new THREE.TorusGeometry(1.25, 0.1, 8, 22),
  emitter: new THREE.ConeGeometry(0.34, 1.2, 8),
  shieldDome: new THREE.SphereGeometry(1, 18, 14),
} as const;

/** 激光束：沿 +Z 方向贯穿战场，长 90 单位，原点位于发射端 */
const BEAM_GEO = new THREE.CylinderGeometry(0.6, 0.6, 90, 10, 1, true);
BEAM_GEO.translate(0, -45, 0);
BEAM_GEO.rotateX(Math.PI / 2);

/** 机头朝 +Z 的敌机模型工厂 */
function buildModel(kind: EnemyKind, materials: EnemyMaterials): THREE.Group {
  const group = new THREE.Group();
  const { body, accent, glow } = materials;

  switch (kind) {
    case 'grunt': {
      const nose = new THREE.Mesh(GEO.coneSmall, body);
      nose.rotation.x = Math.PI / 2;
      nose.position.z = 0.9;
      const hull = new THREE.Mesh(GEO.cylBody, body);
      hull.rotation.x = Math.PI / 2;
      hull.position.z = -0.4;
      const wing = new THREE.Mesh(GEO.boxWing, accent);
      wing.position.z = 0.15;
      const fin = new THREE.Mesh(GEO.boxFin, accent);
      fin.position.set(0, 0.4, -1.0);
      group.add(nose, hull, wing, fin);
      for (const side of [-1, 1]) {
        const engine = new THREE.Mesh(GEO.engine, glow);
        engine.rotation.x = Math.PI / 2;
        engine.position.set(side * 0.5, 0, -1.2);
        group.add(engine);
      }
      break;
    }
    case 'scout': {
      const nose = new THREE.Mesh(GEO.coneLong, body);
      nose.rotation.x = Math.PI / 2;
      const wingL = new THREE.Mesh(GEO.boxWing, accent);
      wingL.scale.set(0.55, 1, 0.6);
      wingL.position.set(-0.85, 0, -0.5);
      wingL.rotation.y = 0.55;
      const wingR = wingL.clone();
      wingR.position.x = 0.85;
      wingR.rotation.y = -0.55;
      const core = new THREE.Mesh(GEO.sphereCore, glow);
      core.position.z = -1.1;
      core.scale.setScalar(0.8);
      group.add(nose, wingL, wingR, core);
      break;
    }
    case 'heavy': {
      const hull = new THREE.Mesh(GEO.boxHull, body);
      const bridge = new THREE.Mesh(GEO.boxHull, accent);
      bridge.scale.set(0.45, 0.5, 0.5);
      bridge.position.set(0, 0.6, -0.3);
      group.add(hull, bridge);
      for (const side of [-1, 1]) {
        const turret = new THREE.Mesh(GEO.turret, accent);
        turret.rotation.x = Math.PI / 2;
        turret.position.set(side * 1.45, -0.1, 0.9);
        group.add(turret);
        for (const zz of [-0.9, 0.2]) {
          const engine = new THREE.Mesh(GEO.engine, glow);
          engine.rotation.x = Math.PI / 2;
          engine.position.set(side * 0.9, -0.1, zz);
          group.add(engine);
        }
      }
      const core = new THREE.Mesh(GEO.sphereCore, glow);
      core.position.set(0, 0.15, 1.5);
      group.add(core);
      break;
    }
    case 'kamikaze': {
      const core = new THREE.Mesh(GEO.icosa, body);
      const ring = new THREE.Mesh(GEO.torus, accent);
      ring.rotation.x = Math.PI / 2;
      const spike = new THREE.Mesh(GEO.spike, glow);
      spike.rotation.x = Math.PI / 2;
      spike.position.z = 0.95;
      const heart = new THREE.Mesh(GEO.sphereCore, glow);
      heart.scale.setScalar(1.1);
      group.add(core, ring, spike, heart);
      break;
    }
    case 'elite': {
      const nose = new THREE.Mesh(GEO.coneBig, body);
      nose.rotation.x = Math.PI / 2;
      nose.position.z = 0.6;
      const wingL = new THREE.Mesh(GEO.boxWing, accent);
      wingL.scale.set(1.05, 1, 1.5);
      wingL.position.set(-1.6, 0, -0.5);
      wingL.rotation.y = -0.4;
      wingL.rotation.z = 0.12;
      const wingR = wingL.clone();
      wingR.position.x = 1.6;
      wingR.rotation.y = 0.4;
      wingR.rotation.z = -0.12;
      const core = new THREE.Mesh(GEO.sphereBig, glow);
      core.position.z = -0.7;
      group.add(nose, wingL, wingR, core);
      for (const side of [-1, 1]) {
        const gun = new THREE.Mesh(GEO.turret, body);
        gun.rotation.x = Math.PI / 2;
        gun.position.set(side * 0.75, -0.15, 1.3);
        group.add(gun);
        const engine = new THREE.Mesh(GEO.engine, glow);
        engine.rotation.x = Math.PI / 2;
        engine.position.set(side * 0.6, 0.05, -1.5);
        group.add(engine);
      }
      break;
    }
    case 'laser': {
      // 固定炮台：底座 + 聚焦环 + 双发射口，中心核心充能发亮
      const base = new THREE.Mesh(GEO.pylon, body);
      base.rotation.x = Math.PI / 2;
      base.position.z = -0.9;
      const neck = new THREE.Mesh(GEO.cylBody, body);
      neck.rotation.x = Math.PI / 2;
      neck.scale.set(0.7, 1, 0.7);
      const ring = new THREE.Mesh(GEO.ringBig, accent);
      ring.rotation.y = Math.PI / 2;
      ring.scale.setScalar(0.85);
      const core = new THREE.Mesh(GEO.sphereBig, glow);
      core.position.z = 0.35;
      group.add(base, neck, ring, core);
      for (const side of [-1, 1]) {
        const emitter = new THREE.Mesh(GEO.emitter, accent);
        emitter.rotation.x = Math.PI / 2;
        emitter.position.set(side * 1.05, 0, 0.6);
        group.add(emitter);
      }
      break;
    }
    case 'bulwark': {
      // 护盾舰：宽厚舰体 + 四引擎，外壳罩一层可击破的能量护盾
      const hull = new THREE.Mesh(GEO.boxHull, body);
      hull.scale.set(1.15, 1.1, 1.05);
      const bridge = new THREE.Mesh(GEO.boxHull, accent);
      bridge.scale.set(0.5, 0.55, 0.55);
      bridge.position.set(0, 0.7, -0.5);
      const prow = new THREE.Mesh(GEO.coneBig, body);
      prow.rotation.x = Math.PI / 2;
      prow.position.z = 1.9;
      group.add(hull, bridge, prow);
      for (const side of [-1, 1]) {
        const turret = new THREE.Mesh(GEO.turret, accent);
        turret.rotation.x = Math.PI / 2;
        turret.position.set(side * 1.6, 0.1, 1.1);
        group.add(turret);
        for (const zz of [-1.2, 0]) {
          const engine = new THREE.Mesh(GEO.engine, glow);
          engine.rotation.x = Math.PI / 2;
          engine.position.set(side * 1.1, -0.1, zz - 0.4);
          group.add(engine);
        }
      }
      const shield = new THREE.Mesh(GEO.shieldDome, materials.shield ?? glow);
      shield.name = 'shield';
      shield.scale.setScalar(2.75);
      group.add(shield);
      break;
    }
  }
  return group;
}

interface EnemyMaterials {
  body: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
  /** 护盾舰外壳（仅护盾舰创建） */
  shield?: THREE.ShaderMaterial;
}

/**
 * 敌机实体：3D 模型 + 移动 / 开火行为 + 受击闪白。实例由 EnemyManager 池化复用。
 */
export class Enemy {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();

  kind: EnemyKind = 'grunt';
  def: EnemyDef;
  hp = 0;
  maxHp = 1;
  radius = 1;
  active = false;
  /** 飞出屏幕（未被击杀） */
  escaped = false;

  /** 能量护盾（0 = 已破盾） */
  shield = 0;
  maxShield = 0;

  private materials: EnemyMaterials;
  private model: THREE.Group | null = null;
  private shieldMesh: THREE.Mesh | null = null;
  private beamMesh: THREE.Mesh | null = null;
  private beamState: 'idle' | 'charge' | 'fire' = 'idle';
  private beamTimer = 0;
  private beamCooldown = 0;
  private beamX = 0;
  /** 上一次更新的上下文（用于回收时静默结束激光） */
  private beamCtx: EnemyUpdateContext | null = null;
  private velocity = new THREE.Vector3();
  private age = 0;
  private fireTimer = 0;
  private baseX = 0;
  private sineAmp = 0;
  private sineFreq = 2;
  private hoverZ = -2;
  private hoverTime = 0;
  private flash = 0;
  private spin = 0;

  private readonly muzzle = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(def: EnemyDef) {
    this.def = def;
    const maps = getSurfaceMaps('enemy');
    // 烘焙 PBR 的 Roughness / Metallic 是绝对值，程序化回退是相对值
    const baked = maps.aoMap !== undefined;
    this.materials = {
      body: new THREE.MeshStandardMaterial({
        color: def.body,
        map: maps.map,
        roughnessMap: maps.roughnessMap,
        metalnessMap: maps.metalnessMap ?? null,
        normalMap: maps.normalMap,
        aoMap: maps.aoMap ?? null,
        aoMapIntensity: 1.1,
        metalness: baked ? 1 : 0.82,
        roughness: baked ? 1 : 0.36,
        envMapIntensity: 1.05,
      }),
      accent: new THREE.MeshStandardMaterial({
        color: def.accent,
        map: maps.map,
        roughnessMap: maps.roughnessMap,
        metalnessMap: maps.metalnessMap ?? null,
        normalMap: maps.normalMap,
        aoMap: maps.aoMap ?? null,
        aoMapIntensity: 1.2,
        metalness: baked ? 1 : 0.7,
        roughness: baked ? 1 : 0.52,
        envMapIntensity: 1,
      }),
      glow: new THREE.MeshStandardMaterial({
        color: def.glow,
        emissive: def.glow,
        emissiveMap: getEnergyTexture(),
        emissiveIntensity: 1.5,
        metalness: 0.25,
        roughness: 0.35,
      }),
    };
    // 边缘轮廓光用机体自身能量色，敌机在深空里有清晰剪影
    applyRimLight(this.materials.body, { color: def.glow, power: 2.4, strength: 0.45 });
    applyRimLight(this.materials.accent, { color: def.glow, power: 2.2, strength: 0.32 });
    if (def.shield) {
      this.materials.shield = createShieldMaterial(def.shieldColor ?? 0x7ee8ff);
    }
    this.group.visible = false;
  }

  /** 重新投放一架敌机（复用实例） */
  spawn(x: number, z: number, params?: { vx?: number; hoverZ?: number; sineAmp?: number }): void {
    this.kind = this.def.kind;
    this.maxHp = this.def.hp;
    this.hp = this.def.hp;
    this.radius = this.def.radius;
    this.active = true;
    this.escaped = false;
    this.age = 0;
    this.hoverTime = 0;
    this.flash = 0;
    this.spin = 0;
    this.maxShield = this.def.shield ?? 0;
    this.shield = this.maxShield;
    if (this.shieldMesh) this.shieldMesh.visible = this.shield > 0;
    this.beamState = 'idle';
    this.beamCooldown = this.def.beam ? THREE.MathUtils.randFloat(0.5, 1.6) : 0;
    if (this.def.beam) this.ensureBeam(false);
    this.baseX = x;
    this.position.set(x, 0, z);
    this.group.position.copy(this.position);
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;

    this.velocity.set(params?.vx ?? 0, 0, this.def.speed);
    this.hoverZ = params?.hoverZ ?? THREE.MathUtils.randFloat(-3, 2);
    this.sineAmp = params?.sineAmp ?? 2.4;
    this.sineFreq = THREE.MathUtils.randFloat(1.1, 1.9);
    this.fireTimer = this.def.fireInterval * THREE.MathUtils.randFloat(0.3, 1);
  }

  despawn(): void {
    this.active = false;
    this.group.visible = false;
    this.endBeam(true);
    this.beamState = 'idle';
  }

  takeDamage(amount: number): boolean {
    // 护盾优先承伤，破盾前本体不掉血
    if (this.shield > 0) {
      this.shield -= amount;
      this.flash = 1;
      if (this.shield < 0) this.shield = 0;
      return false;
    }
    this.hp -= amount;
    this.flash = 1;
    return this.hp <= 0;
  }

  /** 护盾剩余比例（0 = 无盾或已破） */
  get shieldRatio(): number {
    return this.maxShield > 0 ? Math.max(this.shield, 0) / this.maxShield : 0;
  }

  update(dt: number, ctx: EnemyUpdateContext): void {
    this.age += dt;

    switch (this.def.pattern) {
      case 'straight':
        this.position.z += this.def.speed * dt;
        this.position.x = this.baseX + Math.sin(this.age * 0.8) * 0.6;
        break;
      case 'sine':
        this.position.z += this.def.speed * 0.85 * dt;
        this.position.x = this.baseX + Math.sin(this.age * this.sineFreq) * this.sineAmp;
        break;
      case 'swoop':
        this.position.x += this.velocity.x * dt;
        this.position.z += this.def.speed * dt;
        break;
      case 'chase': {
        this.tmp.copy(ctx.playerPos).sub(this.position);
        if (this.tmp.lengthSq() > 0.0001) this.tmp.normalize();
        // 自爆机持续加速追击
        this.velocity.lerp(this.tmp.multiplyScalar(this.def.speed * 1.15), 1 - Math.exp(-1.8 * dt));
        this.position.addScaledVector(this.velocity, dt);
        break;
      }
      case 'hover': {
        if (this.position.z < this.hoverZ) {
          this.position.z += this.def.speed * dt;
        } else {
          this.hoverTime += dt;
          this.position.x = this.baseX + Math.sin(this.age * 0.9) * 1.6;
          // 悬停一段时间后离场
          if (this.hoverTime > 9) this.position.z += this.def.speed * 1.4 * dt;
        }
        break;
      }
      case 'turret': {
        // 激光塔：推进到阵位后驻留开火，超时才撤退
        if (this.position.z < this.hoverZ) {
          this.position.z += this.def.speed * dt;
        } else {
          this.hoverTime += dt;
          if (this.hoverTime > 13) this.position.z += this.def.speed * 1.2 * dt;
        }
        break;
      }
    }

    // 姿态：轻微滚转摆动 + 转向提示
    this.spin += dt;
    if (this.def.pattern === 'chase') {
      this.group.rotation.y = Math.atan2(this.velocity.x, this.velocity.z);
      this.group.rotation.z = Math.sin(this.spin * 6) * 0.25;
    } else if (this.def.pattern === 'swoop') {
      this.group.rotation.y = THREE.MathUtils.clamp(this.velocity.x * 0.06, -0.5, 0.5);
      this.group.rotation.z = -this.velocity.x * 0.05;
    } else if (this.def.pattern === 'turret') {
      // 激光塔：舰体不转向，仅炮塔缓慢自转，保证光束方向恒定朝 +Z
      this.group.rotation.set(0, 0, 0);
      if (this.model) this.model.rotation.y += dt * 0.55;
    } else {
      this.group.rotation.z = Math.sin(this.spin * 1.6) * 0.08;
      this.group.rotation.y = Math.PI + Math.sin(this.spin * 0.9) * 0.06;
    }

    this.group.position.copy(this.position);

    // 受击闪白
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 5);
      const boost = 1.4 + this.flash * 6;
      this.materials.body.emissive.setRGB(this.flash, this.flash, this.flash);
      this.materials.accent.emissive.setRGB(this.flash * 0.8, this.flash * 0.8, this.flash * 0.8);
      this.materials.glow.emissiveIntensity = boost + 1.4;
    }

    // 护盾：破盾瞬间炸开一层能量壳
    if (this.shieldMesh) {
      const shieldMat = this.shieldMesh.material as THREE.ShaderMaterial;
      if (this.shield > 0) {
        this.shieldMesh.visible = true;
        this.shieldMesh.scale.setScalar(2.6 + Math.sin(this.age * 3.4) * 0.08 + this.shieldRatio * 0.2);
        shieldMat.uniforms.uOpacity.value = 0.16 + this.shieldRatio * 0.3;
        shieldMat.uniforms.uTime.value = this.age;
      } else if (this.shieldMesh.visible) {
        this.shieldMesh.visible = false;
        ctx.particles.emit({
          position: this.position,
          count: 22,
          color: this.def.shieldColor ?? 0x7ee8ff,
          speed: 12,
          size: 0.42,
          life: 0.5,
          drag: 2.4,
        });
      }
    }

    // 激光塔：充能 → 贯穿光束 → 冷却
    if (this.def.beam) {
      if (ctx.canFire) this.updateBeam(dt, ctx);
      else this.endBeam(false);
    }

    // 开火
    if (this.def.fireInterval > 0 && ctx.canFire) {
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && this.position.z > BATTLE_FIELD.spawnZ + 8) {
        this.fireTimer = this.def.fireInterval;
        this.fire(ctx);
      }
    }

    // 出界
    if (this.position.z > BATTLE_FIELD.despawnZ) {
      this.escaped = true;
      this.active = false;
    }
  }

  /** 激光束网格：挂在敌机组下（炮台自身不转向，光束恒朝 +Z） */
  private ensureBeam(visible: boolean): THREE.Mesh {
    if (!this.beamMesh) {
      const mesh = new THREE.Mesh(
        BEAM_GEO,
        new THREE.MeshBasicMaterial({
          color: this.def.beam?.color ?? 0x7cf0ff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.visible = visible;
      this.group.add(mesh);
      this.beamMesh = mesh;
    }
    return this.beamMesh;
  }

  /** 结束激光（silent = 不触发音效回调，用于回收） */
  private endBeam(silent: boolean): void {
    if (this.beamState === 'idle') return;
    this.beamState = 'idle';
    this.beamCooldown = this.def.beam?.cooldown ?? 2;
    if (this.beamMesh) this.beamMesh.visible = false;
    if (!silent) this.beamCtx?.onBeam?.('end');
  }

  private updateBeam(dt: number, ctx: EnemyUpdateContext): void {
    const def = this.def.beam;
    if (!def) return;
    this.beamCtx = ctx;

    if (this.beamState === 'idle') {
      this.beamCooldown -= dt;
      if (this.beamCooldown > 0 || this.position.z < this.hoverZ - 0.5) return;
      this.beamState = 'charge';
      this.beamTimer = def.charge;
      this.beamX = this.position.x;
      const mesh = this.ensureBeam(true);
      mesh.visible = true;
      mesh.scale.set(0.25, 1, 0.25);
      ctx.onBeam?.('charge');
      return;
    }

    const mesh = this.ensureBeam(true);
    const mat = mesh.material as THREE.MeshBasicMaterial;
    this.beamTimer -= dt;

    if (this.beamState === 'charge') {
      const t = 1 - Math.max(this.beamTimer, 0) / def.charge;
      // 充能期缓慢追踪玩家所在列，给出可躲避的预告
      this.beamX += (ctx.playerPos.x - this.beamX) * (1 - Math.exp(-1.5 * dt));
      mesh.scale.set(0.25 + t * 0.35, 1, 0.25 + t * 0.35);
      mat.opacity = 0.16 + t * 0.34;
      ctx.particles.emit({
        position: this.tmp.set(this.beamX, 0, this.position.z + 3),
        count: 2,
        color: def.color,
        speed: 2.6,
        size: 0.42,
        life: 0.28,
        drag: 3,
      });
      if (this.beamTimer <= 0) {
        this.beamState = 'fire';
        this.beamTimer = def.fire;
        ctx.onBeam?.('fire');
      }
      return;
    }

    // 发射：粗光束持续输出，命中判定只看横向距离
    const t = 1 - Math.max(this.beamTimer, 0) / def.fire;
    const wobble = 1 + Math.sin(this.age * 46) * 0.1;
    mesh.scale.set(wobble, 1, wobble);
    mat.opacity = 0.82 * (1 - t * 0.25);
    ctx.particles.emit({
      position: this.tmp.set(this.beamX, 0, this.position.z + 6),
      count: 3,
      color: def.color,
      speed: 7,
      size: 0.44,
      life: 0.24,
      drag: 4,
    });
    if (Math.abs(ctx.playerPos.x - this.beamX) < def.width) {
      ctx.damagePlayer?.(def.damage * dt);
    }
    if (this.beamTimer <= 0) this.endBeam(false);
  }

  private fire(ctx: EnemyUpdateContext): void {
    const def = this.def;
    this.muzzle.set(this.position.x, 0, this.position.z + 1.6 * (def.radius * 0.6 + 0.6));
    const baseDir = this.tmp.copy(ctx.playerPos).sub(this.position);
    if (baseDir.lengthSq() < 0.0001) baseDir.set(0, 0, 1);
    baseDir.normalize();

    for (let i = 0; i < def.salvo; i++) {
      const offset = def.salvo > 1 ? (i / (def.salvo - 1) - 0.5) * def.spreadAngle * 2 : 0;
      const dir = new THREE.Vector3(
        Math.sin(Math.atan2(baseDir.x, baseDir.z) + offset),
        0,
        Math.cos(Math.atan2(baseDir.x, baseDir.z) + offset),
      );
      ctx.bullets.spawn('enemy', this.muzzle, dir, {
        speed: def.bulletSpeed,
        damage: def.bulletDamage,
        color: def.bulletColor,
        radius: 0.42,
        length: 1,
        life: 6,
        trailRate: 14,
        homing: def.homing ? ctx.playerPos : null,
        homingStrength: def.homing ? 1.1 : 0,
      });
    }
  }

  /** 首次使用时构建模型（同类型共享结构，材质独立以便闪白） */
  ensureModel(): void {
    if (this.model) return;
    this.model = buildModel(this.def.kind, this.materials);
    this.group.add(this.model);
    this.shieldMesh = (this.model.getObjectByName('shield') as THREE.Mesh | undefined) ?? null;
    if (this.shieldMesh) this.shieldMesh.visible = this.shield > 0;
  }

  dispose(): void {
    this.materials.body.dispose();
    this.materials.accent.dispose();
    this.materials.glow.dispose();
    this.materials.shield?.dispose();
    if (this.beamMesh) (this.beamMesh.material as THREE.Material).dispose();
    if (this.model) {
      this.model.traverse((obj) => {
        if (obj instanceof THREE.Mesh && !Object.values(GEO).includes(obj.geometry as never)) {
          obj.geometry.dispose();
        }
      });
    }
  }
}
