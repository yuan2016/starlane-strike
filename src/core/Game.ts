import * as THREE from 'three';
import { RENDER } from '../config';
import { AdaptiveQuality, detectQuality, type QualitySettings } from '../render/Quality';
import { createEnvironmentTexture } from '../render/Environment';
import { configureProceduralTextures } from '../render/ProcTextures';
import { GameCamera } from '../camera/GameCamera';
import { Player } from '../player/Player';
import { PlayerStats } from '../player/PlayerStats';
import { SpecialWeapon } from '../player/SpecialWeapon';
import { Weapon } from '../player/Weapon';
import { WingmanSystem } from '../player/Wingman';
import { Starfield } from '../scene/Starfield';
import { BossManager } from '../boss/BossManager';
import { BulletSystem } from '../combat/BulletSystem';
import { DamageSystem } from '../combat/DamageSystem';
import { EnemyManager } from '../enemy/EnemyManager';
import type { Enemy } from '../enemy/Enemy';
import { ExplosionSystem } from '../effects/Explosion';
import { ParticleSystem } from '../effects/ParticleSystem';
import { LevelManager } from '../level/LevelManager';
import { WaveScheduler } from '../level/Wave';
import { LEVELS, levelById, levelIndex, type LevelDef } from '../data/levels';
import { PICKUPS, PICKUP_EFFECT, type PickupKind } from '../data/pickups';
import { WEAPON_LIST } from '../data/weapons';
import { PickupSystem } from '../entities/PickupSystem';
import { Progress } from '../player/Progress';
import { GameUI } from '../ui/GameUI';
import { HangarUI } from '../ui/HangarUI';
import { LevelSelectUI } from '../ui/LevelSelectUI';
import { AudioSystem } from '../audio/AudioSystem';
import { PostFX } from '../render/PostFX';
import { GameLoop } from './GameLoop';
import { InputManager } from './InputManager';

export type GameState = 'ready' | 'playing' | 'paused' | 'failed' | 'cleared';

/**
 * 游戏主控：持有渲染器、场景、相机、输入与各子系统，并管理游戏状态机。
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly gameCamera: GameCamera;
  readonly input: InputManager;
  readonly progress = new Progress();
  /** 玩家机：必须在贴图尺寸配置之后创建（初始化顺序见构造函数） */
  readonly player: Player;
  readonly stats = new PlayerStats();
  readonly starfield: Starfield;
  readonly particles = new ParticleSystem();
  readonly explosions: ExplosionSystem;
  readonly bullets = new BulletSystem();
  readonly pickups = new PickupSystem();
  readonly weapon = new Weapon();
  readonly special = new SpecialWeapon();
  readonly enemies = new EnemyManager();
  readonly bossManager = new BossManager();
  readonly damage = new DamageSystem();
  readonly waves = new WaveScheduler();
  readonly levelManager: LevelManager;
  readonly ui: GameUI;
  readonly hangar: HangarUI;
  readonly levelSelect: LevelSelectUI;
  /** 程序化音效 + 动态 BGM */
  readonly audio = new AudioSystem();
  /** Bloom 后处理管线 */
  readonly postfx: PostFX;

  /** 设备画质档位（桌面 high / 移动端 medium），运行时可自适应下调 */
  quality: QualitySettings;
  /** 程序化 HDR 环境贴图 */
  private envTexture: THREE.Texture;
  /** 帧率自适应：只降渲染开销，不降贴图与模型精度 */
  private readonly adaptive: AdaptiveQuality;

  /** 当前选择的关卡 */
  level: LevelDef = LEVELS[0];
  state: GameState = 'ready';
  score = 0;
  kills = 0;
  coins = 0;

  readonly wingmen = new WingmanSystem();

  /** 通关后的拾取缓冲：不立刻弹结算面板 */
  private levelClearPending = false;
  private levelClearTimer = 0;
  private readonly LEVEL_CLEAR_DELAY = 4.5;

  private readonly loop: GameLoop;
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // ACES + 适度曝光：保住高光层次与色彩，不靠拉曝光把画面整体提亮
    this.renderer.toneMappingExposure = 1.12;
    container.appendChild(this.renderer.domElement);

    // 画质档位（按 WebGL 能力 / 硬件并发 / 输入方式判定，不读 UA）
    // → 程序化贴图尺寸 → 再创建依赖贴图的玩家机与星空
    this.quality = detectQuality(this.renderer);
    configureProceduralTextures(this.quality);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatioCap));
    this.player = new Player(this.progress.aircraftDef);
    this.starfield = new Starfield();

    // HDR 环境光：给金属材质提供反射内容（metalness 高的材质不再发黑）
    this.envTexture = createEnvironmentTexture(this.renderer);
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = this.quality.envIntensity;

    this.gameCamera = new GameCamera(this.aspect);
    this.postfx = new PostFX(this.renderer, this.scene, this.gameCamera.camera, {
      samples: this.quality.msaa,
      bloom: this.quality.bloom,
    });
    this.adaptive = new AdaptiveQuality(this.quality, (settings) => this.applyQuality(settings));
    this.input = new InputManager(this.renderer.domElement);
    this.explosions = new ExplosionSystem(this.particles);
    this.levelManager = new LevelManager({
      waves: this.waves,
      enemies: this.enemies,
      boss: this.bossManager,
    });
    this.ui = new GameUI({
      onStart: this.startLevel,
      onPause: this.pause,
      onResume: this.resume,
      onRestart: this.startLevel,
      onNext: this.nextLevel,
      onSpecial: this.fireSpecial,
      onHangar: this.openHangar,
      onMissions: this.openLevelSelect,
      onToggleSound: this.toggleSound,
      onToggleBloom: this.toggleBloom,
    });
    this.hangar = new HangarUI(this.progress, {
      onLaunch: () => this.startLevel(),
      onBack: this.closeHangar,
      onApply: () => this.applyProgress(),
    });
    this.levelSelect = new LevelSelectUI(this.progress, {
      onLaunch: (id) => this.startLevel(id),
      onBack: this.closeLevelSelect,
    });

    this.scene.background = new THREE.Color(0x05060f);
    this.scene.fog = new THREE.Fog(0x05060f, 90, 300);
    this.scene.add(this.starfield.group);
    this.scene.add(this.player.object);
    this.scene.add(this.wingmen.group);
    this.scene.add(this.particles.points);
    this.scene.add(this.explosions.group);
    this.scene.add(this.bullets.group);
    this.scene.add(this.pickups.group);
    this.scene.add(this.enemies.group);
    this.scene.add(this.bossManager.boss.group);

    this.setupLights();
    this.bindEvents();
    this.ui.setSoundMuted(this.audio.isMuted);
    this.ui.setBloomEnabled(this.postfx.enabled);
    // 射击 / 拾取等音效接入
    this.weapon.onFire = () => this.audio.play('shoot');

    this.particles.setViewportHeight(this.container.clientHeight || window.innerHeight);
    // 默认出击目标：已解锁的最新关卡
    this.level = this.latestUnlocked();
    this.ui.setLevel(this.level.label);
    this.ui.setStartHint(this.level.label);
    // 追踪武器锁定最近目标
    this.weapon.setTargetProvider(() => this.nearestTarget());
    this.applyProgress();
    this.applyEnvironment(this.level);
    this.ui.showScreen('start');

    this.loop = new GameLoop(this.update, this.render, RENDER.maxDelta);
    window.addEventListener('resize', this.onResize);
  }

  private get aspect(): number {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    return w / Math.max(h, 1);
  }

  /**
   * 有了 HDR 环境光之后不再靠堆灯光强度提亮：
   * 环境光压低、主光保留方向性，明暗层次交给环境反射 + 轮廓光 + 自发光。
   * 主光方向与 Environment.SUN_DIRECTION 一致，星球的昼夜分界才对得上。
   */
  private setupLights(): void {
    const ambient = new THREE.AmbientLight(0x5a6b8c, 0.35);
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(6, 14, 10);
    const rim = new THREE.DirectionalLight(0x4aa8ff, 1.4);
    rim.position.set(-8, 5, -12);
    const fill = new THREE.DirectionalLight(0xff9b5c, 0.5);
    fill.position.set(4, -6, -6);
    this.scene.add(ambient, key, rim, fill);
  }

  private bindEvents(): void {
    // AudioContext 必须等用户手势后才能启动
    const unlockAudio = (): void => {
      this.audio.unlock();
      if (this.state === 'ready' || this.state === 'cleared' || this.state === 'failed') {
        this.audio.startMusic('menu');
      }
    };
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    this.levelManager.onWarning = () => {
      this.ui.setWarning(true);
      this.gameCamera.shake(0.25);
      this.audio.play('warn');
    };
    this.levelManager.onBossStart = () => {
      this.ui.setWarning(false);
      this.ui.setBoss(true, this.bossManager.boss.name, 1, 1);
      this.audio.startMusic('boss');
    };
    this.levelManager.onCleared = () => {
      if (this.levelClearPending) return;
      this.levelClearPending = true;
      this.levelClearTimer = this.LEVEL_CLEAR_DELAY;
      this.ui.popPickup('任务完成！继续拾取奖励', 'coin');
    };

    // Boss 阶段切换演出：横幅 + 血条闪烁 + 辉光增强
    this.bossManager.onPhaseChange = (phase) => {
      const text = phase === 3 ? '核心过载 · 全弹发射' : '火力全开';
      this.ui.flashBossPhase(phase, text);
      this.audio.play('phase');
      this.postfx.setStrength(this.quality.bloom.strength * 1.35);
      window.setTimeout(() => this.postfx.resetStrength(), 900);
    };
  }

  /** 音效 / BGM 开关 */
  private readonly toggleSound = (): void => {
    const muted = this.audio.toggleMute();
    this.ui.setSoundMuted(muted);
    if (!muted) {
      this.audio.unlock();
      this.audio.startMusic(this.state === 'playing' ? this.battleMusic() : 'menu');
    }
  };

  /** 辉光后处理开关 */
  private readonly toggleBloom = (): void => {
    const on = !this.postfx.enabled;
    this.postfx.setEnabled(on);
    this.ui.setBloomEnabled(on);
  };

  private battleMusic(): 'battle' | 'boss' {
    return this.bossManager.active ? 'boss' : 'battle';
  }

  start(): void {
    this.loop.start();
  }

  private readonly startLevel = (levelId?: string): void => {
    this.hangar.hide();
    this.levelSelect.hide();
    if (levelId) this.level = levelById(levelId);

    this.score = 0;
    this.kills = 0;
    this.coins = 0;
    this.levelClearPending = false;
    this.levelClearTimer = 0;
    // 应用机库中的最新装配（机体 / 武器 / 强化）
    this.applyProgress();
    this.player.reset();
    this.player.object.visible = true;
    this.wingmen.reset(this.player.worldPosition);
    this.bullets.clear();
    this.pickups.clear();
    this.weapon.resetPower();
    this.enemies.clear();
    this.particles.clear();
    this.explosions.clear();
    this.bossManager.reset();
    this.bossManager.setPreset(this.level.boss);
    this.applyEnvironment(this.level);
    this.levelManager.start(this.level.waves, this.level.label);
    this.ui.setLevel(this.level.label);
    this.ui.setStartHint(this.level.label);
    this.ui.setBoss(false);
    this.ui.setWarning(false);
    this.ui.showScreen('none');
    this.state = 'playing';
    this.audio.unlock();
    this.audio.startMusic('battle');
  };

  /** 关卡环境：背景 / 雾 / 星空配色与流速 */
  private applyEnvironment(level: LevelDef): void {
    (this.scene.background as THREE.Color).set(level.env.bg);
    (this.scene.fog as THREE.Fog).color.set(level.env.fog);
    this.starfield.setEnv(level.env.star, level.env.starSpeedMul);
  }

  /** 已解锁的最新关卡（快速出击目标） */
  private latestUnlocked(): LevelDef {
    for (let i = LEVELS.length - 1; i >= 0; i--) {
      if (this.progress.isUnlocked(LEVELS[i].id, i)) return LEVELS[i];
    }
    return LEVELS[0];
  }

  private readonly pause = (): void => {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.showScreen('pause');
  };

  private readonly resume = (): void => {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.showScreen('none');
  };

  private readonly nextLevel = (): void => {
    const next = LEVELS[levelIndex(this.level.id) + 1];
    // 已是最后一关：回到任务列表
    if (next) this.startLevel(next.id);
    else this.openLevelSelect();
  };

  private readonly openHangar = (): void => {
    this.state = 'ready';
    this.ui.showScreen('none');
    this.hangar.show();
  };

  private readonly closeHangar = (): void => {
    this.hangar.hide();
    this.ui.showScreen('start');
  };

  private readonly openLevelSelect = (): void => {
    this.state = 'ready';
    this.ui.showScreen('none');
    this.levelSelect.show();
  };

  private readonly closeLevelSelect = (): void => {
    this.levelSelect.hide();
    this.ui.setStartHint(this.level.label);
    this.ui.showScreen('start');
  };

  /** 把成长系统的结果写入本局：机体模型、武器、属性上限 */
  private applyProgress(): void {
    const mods = this.progress.modifiers;
    this.player.setAircraft(this.progress.aircraftDef);
    this.weapon.configure(this.progress.save.weapon, this.progress.weaponLevel);
    this.weapon.setModifiers(mods.damageMul, mods.fireRateMul, mods.critRate);
    this.stats.setMax(mods.maxHp, mods.maxShield);
    this.stats.damageReduction = mods.damageReduction;
    this.wingmen.setModifiers(mods.damageMul, mods.fireRateMul, mods.critRate);
    this.ui.setWeapon(this.weapon.displayName);
    this.ui.setCoins(this.progress.coins);
  }

  /**
   * 战机参数恢复初始：机体 / 武器等级 / 属性强化回到初始值，
   * 并立刻写入本局（换回初始机体模型、初始武器与初始 HP / 护盾上限）。
   * 金币与关卡进度保留。
   */
  resetAircraftParams(): void {
    this.progress.resetAircraft();
    this.applyProgress();
    this.ui.setStats(this.stats.hpRatio, this.stats.shieldRatio, this.score);
    this.hangar.render();
    this.levelSelect.render();
  }

  /** 追踪武器的目标：优先最近的敌机，其次 Boss 核心 */
  private nearestTarget(): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestDist = Infinity;
    this.enemies.forEachActive((enemy) => {
      const dist = enemy.position.distanceToSquared(this.player.worldPosition);
      if (dist < bestDist) {
        bestDist = dist;
        best = enemy.position;
      }
    });
    if (best) return best;
    const boss = this.bossManager.boss;
    if (this.bossManager.active && boss.hitboxes[0].alive) return boss.position;
    return null;
  }

  private readonly fireSpecial = (): void => {
    if (this.state !== 'playing') return;
    const fired = this.special.fire({
      bullets: this.bullets,
      enemies: this.enemies,
      explosions: this.explosions,
      particles: this.particles,
      playerPos: this.player.worldPosition,
      onKill: (enemy) => this.killEnemy(enemy),
      shake: (intensity) => this.gameCamera.shake(intensity),
    });
    if (fired) {
      this.ui.triggerFlash();
      this.audio.play('special');
    }
  };

  /** 激光类武器（激光塔 / Boss 主炮）的状态联动：持续音效 */
  private onEnemyBeam(state: 'charge' | 'fire' | 'end'): void {
    if (state === 'end') this.audio.beamEnd();
    else this.audio.beamStart();
  }

  /** 击毁敌机的唯一入口：结算 + 回收，避免重复触发 */
  private killEnemy(enemy: Enemy): void {
    if (!enemy.active) return;
    this.onEnemyKilled(enemy);
    this.enemies.kill(enemy);
  }

  /** 只做表现与计分，不负责回收 */
  private onEnemyKilled(enemy: Enemy): void {
    const scale = enemy.def.radius * 0.75 + 0.45;
    this.explosions.explode({
      position: enemy.position,
      scale,
      color: enemy.def.glow,
    });
    this.audio.explode(scale);
    this.gameCamera.shake(0.12 + enemy.def.radius * 0.05);
    this.score += enemy.def.score;
    this.kills += 1;
    this.coins += enemy.def.coin;
    this.dropLoot(enemy);
  }

  /** 敌机掉落：金币（保底收益之外的额外收获）+ 概率掉落强化道具 */
  private dropLoot(enemy: Enemy): void {
    const def = enemy.def;
    const count = THREE.MathUtils.clamp(Math.round(def.coin / 3), 1, 6);
    const value = Math.max(1, Math.round(def.coin / count));
    for (let i = 0; i < count; i++) {
      this.pickups.spawn('coin', enemy.position, value);
    }
    if (Math.random() < def.dropPower) {
      this.pickups.spawn('power', enemy.position, 1, 0.4);
    }
    if (Math.random() < def.dropSupply) {
      // 血量吃紧时优先掉修理，否则掉护盾
      const kind: PickupKind = this.stats.hpRatio < 0.6 ? 'heal' : 'shield';
      this.pickups.spawn(kind, enemy.position, 1, 0.4);
    }
  }

  private readonly collectPickup = (kind: PickupKind, value: number, position: THREE.Vector3): void => {
    this.particles.emit({
      position,
      count: kind === 'coin' ? 6 : 16,
      color: PICKUPS[kind].color,
      speed: kind === 'coin' ? 3.2 : 5.5,
      size: 0.34,
      life: 0.45,
      drag: 4,
    });

    switch (kind) {
      case 'coin':
        this.coins += value;
        this.audio.play('pickup', 0.5);
        break;
      case 'power':
        this.audio.play('power');
        if (this.weapon.addPower()) {
          this.ui.setWeapon(this.weapon.displayName);
          this.ui.popPickup(`火力强化 Lv${this.weapon.powerLevel}`, 'power');
        } else {
          this.coins += PICKUP_EFFECT.powerToCoin;
          this.ui.popPickup(`火力已满 ◈+${PICKUP_EFFECT.powerToCoin}`, 'power');
        }
        break;
      case 'shield':
        this.stats.addShield(PICKUP_EFFECT.shield);
        this.ui.popPickup(`护盾 +${PICKUP_EFFECT.shield}`, 'shield');
        this.audio.play('shield');
        break;
      case 'heal':
        this.stats.heal(PICKUP_EFFECT.heal);
        this.ui.popPickup(`机体 +${PICKUP_EFFECT.heal}`, 'heal');
        this.audio.play('pickup');
        break;
    }
  };

  private onPlayerDead(): void {
    this.state = 'failed';
    this.player.object.visible = false;
    this.ui.triggerFlash();
    this.ui.showScreen('fail');
    this.audio.explode(2.4);
    this.audio.play('fail');
    this.audio.startMusic('menu');
  }

  private finishLevelClear(): void {
    this.levelClearPending = false;
    this.state = 'cleared';
    const stars = this.stats.hpRatio > 0.7 ? 3 : this.stats.hpRatio > 0.35 ? 2 : 1;
    const order = levelIndex(this.level.id);
    // 通关奖励 + 结算入档（同时解锁下一关）
    this.score += this.level.clearBonus;
    this.progress.commitLevel(this.level.id, order, this.score, this.coins, stars);
    this.ui.setCoins(this.progress.coins);
    const next = LEVELS[order + 1];
    this.ui.setNextLabel(next ? `下一关 ${next.id}` : '返回任务列表');
    this.ui.showClear({
      score: this.score,
      kills: this.kills,
      coins: this.coins,
      stars,
      best: this.progress.save.bestScore,
    });
    this.audio.play('clear');
    this.audio.startMusic('menu');
  }

  dispose(): void {
    this.loop.stop();
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.starfield.dispose();
    this.player.dispose();
    this.particles.dispose();
    this.explosions.dispose();
    this.bullets.dispose();
    this.pickups.dispose();
    this.wingmen.dispose();
    this.enemies.dispose();
    this.bossManager.boss.dispose();
    this.postfx.dispose();
    this.audio.dispose();
    this.scene.environment = null;
    this.envTexture.dispose();
    this.renderer.dispose();
  }

  private readonly onResize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.applyPixelRatio(w, h);
    this.gameCamera.setAspect(w / Math.max(h, 1));
    this.particles.setViewportHeight(h);
  };

  /** 按当前画质档位设置 DPR 与尺寸 */
  private applyPixelRatio(width?: number, height?: number): void {
    const w = width ?? this.container.clientWidth ?? window.innerWidth;
    const h = height ?? this.container.clientHeight ?? window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatioCap));
    this.renderer.setSize(w, h);
    this.postfx.setSize(w, h);
  }

  /** 帧率不足时的降级：DPR / 辉光 / 云层，贴图与模型精度不变 */
  private applyQuality(settings: QualitySettings): void {
    this.quality = settings;
    this.scene.environmentIntensity = settings.envIntensity;
    this.postfx.setBloomProfile(settings.bloom);
    this.applyPixelRatio();
  }

  private readonly update = (dt: number, elapsed: number): void => {
    this.handleHotkeys();
    // 帧率自适应：连续低帧时分级下调渲染开销
    this.adaptive.sample(dt);

    if (this.state === 'playing') {
      this.updateGameplay(dt);
    } else if (this.state === 'failed' || this.state === 'cleared') {
      // 结算 / 失败时保留特效与背景演出，但停止交互逻辑
      this.bullets.update(dt, this.particles);
      this.particles.update(dt);
      this.explosions.update(dt);
      this.starfield.update(dt);
    }
    // paused / ready 状态不做任何逻辑计算，仅渲染

    this.gameCamera.update(dt);
    this.updateUI(elapsed);
    this.input.endFrame();
  };

  private handleHotkeys(): void {
    if (this.input.consumePress('Escape') || this.input.consumePress('KeyP')) {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    }
    if (this.input.consumePress('Space')) this.fireSpecial();
    // M：音效开关 · B：辉光开关
    if (this.input.consumePress('KeyM')) this.toggleSound();
    if (this.input.consumePress('KeyB')) this.toggleBloom();

    // 数字键切换已拥有的武器
    for (let i = 0; i < WEAPON_LIST.length; i++) {
      if (!this.input.consumePress(`Digit${i + 1}`)) continue;
      const id = WEAPON_LIST[i].id;
      if (this.progress.ownsWeapon(id)) {
        this.progress.selectWeapon(id);
        this.applyProgress();
      }
    }
  }

  private updateGameplay(dt: number): void {
    // 屏幕像素 → 世界单位：约 26 个世界单位铺满屏幕高度，保证拖动手感一致
    const pointerScale = 26 / Math.max(this.container.clientHeight, 1);

    // 通关缓冲期：允许玩家继续移动、拾取金币 / 补给，但暂停敌机与伤害判定
    if (this.levelClearPending) {
      this.player.update(dt, this.input, pointerScale);
      this.stats.update(dt);
      this.weapon.update(dt, true, this.player.muzzles, this.bullets);
      this.wingmen.update(dt, this.player.worldPosition, this.player.object.rotation.y, () => this.nearestTarget(), this.bullets);
      this.pickups.update(dt, this.player.worldPosition, this.collectPickup);
      this.bullets.update(dt, this.particles);
      this.particles.update(dt);
      this.explosions.update(dt);
      this.starfield.update(dt);
      this.levelClearTimer -= dt;
      if (this.levelClearTimer <= 0) this.finishLevelClear();
      return;
    }

    this.player.update(dt, this.input, pointerScale);
    this.stats.update(dt);
    this.special.update(dt);

    // 自动射击
    this.weapon.update(dt, true, this.player.muzzles, this.bullets);
    this.bullets.update(dt, this.particles);

    // 关卡流程：波次 → Boss
    this.levelManager.update(dt, (kind, req) => this.enemies.spawn(kind, req));
    this.enemies.update(dt, {
      playerPos: this.player.worldPosition,
      bullets: this.bullets,
      canFire: true,
      particles: this.particles,
      damagePlayer: (amount) => this.damagePlayerByLaser(amount),
      onBeam: (state) => this.onEnemyBeam(state),
    });

    this.bossManager.update(dt, {
      playerPos: this.player.worldPosition,
      bullets: this.bullets,
      particles: this.particles,
      explosions: this.explosions,
      damagePlayer: (amount) => this.damagePlayerByLaser(amount),
      shake: (intensity) => this.gameCamera.shake(intensity),
      onBeam: (state) => this.onEnemyBeam(state),
    });

    this.damage.update({
      playerPos: this.player.worldPosition,
      playerRadius: 0.9,
      stats: this.stats,
      bullets: this.bullets,
      enemies: this.enemies,
      boss: this.bossManager,
      explosions: this.explosions,
      particles: this.particles,
      shake: (intensity) => this.gameCamera.shake(intensity),
      onKill: (enemy) => this.killEnemy(enemy),
      onPlayerDamaged: (result, position) => {
        if (result === 'hp' || result === 'dead') this.ui.triggerFlash();
        // 护盾受击：把击中坐标交给护盾 Shader，罩面上从该点扩散涟漪
        if (result === 'shield') this.player.shieldHit(position);
        if (result !== 'ignored') this.audio.play(result === 'shield' ? 'shield' : 'damage');
      },
      onPlayerDead: () => this.onPlayerDead(),
      onBossDefeated: () => {
        this.score += 5000;
        this.gameCamera.shake(0.9);
        this.audio.explode(3);
        // Boss 掉落：大量金币 + 强化 + 补给
        const pos = this.bossManager.boss.position;
        for (let i = 0; i < 16; i++) this.pickups.spawn('coin', pos, 8, 7);
        this.pickups.spawn('power', pos, 1, 2.5);
        this.pickups.spawn('heal', pos, 1, 2.5);
      },
    });

    // 受击无敌时闪烁
    this.player.object.visible = !this.stats.isInvulnerable || Math.floor(performance.now() / 70) % 2 === 0;

    this.pickups.update(dt, this.player.worldPosition, this.collectPickup);
    this.wingmen.update(dt, this.player.worldPosition, this.player.object.rotation.y, () => this.nearestTarget(), this.bullets);

    this.particles.update(dt);
    this.explosions.update(dt);
    this.starfield.update(dt);
  }

  /** 激光持续伤害：绕过无敌帧，但同样走护盾 → 生命结算 */
  private damagePlayerByLaser(amount: number): void {
    const result = this.stats.takeDamage(amount, true);
    if (result === 'ignored') return;
    if (result === 'dead') {
      this.onPlayerDead();
      return;
    }
    this.ui.triggerFlash();
  }

  private updateUI(elapsed: number): void {
    this.player.setShieldRatio(this.stats.shieldRatio);
    this.ui.setStats(this.stats.hpRatio, this.stats.shieldRatio, this.score);
    // 战斗中显示本局金币，非战斗时显示存档金币（通关缓冲期也算战斗中）
    this.ui.setCoins(this.state === 'playing' || this.levelClearPending ? this.coins : this.progress.coins);
    const boss = this.bossManager.boss;
    if (this.bossManager.active) {
      this.ui.setBoss(true, boss.name, boss.hpRatio, boss.phase);
    } else {
      this.ui.setBoss(false);
    }
    this.ui.setSpecial(this.special.cooldownRatio, this.special.ready);
    void elapsed;
  }

  private readonly render = (): void => {
    this.postfx.render();
  };
}
