export type ScreenKind = 'none' | 'start' | 'pause' | 'fail' | 'clear';

export interface UIHandlers {
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onNext: () => void;
  onSpecial: () => void;
  onHangar: () => void;
  /** 打开任务选择界面 */
  onMissions: () => void;
  /** 音效 / BGM 开关 */
  onToggleSound: () => void;
  /** 辉光后处理开关 */
  onToggleBloom: () => void;
}

export interface ClearResult {
  score: number;
  kills: number;
  coins: number;
  stars: number;
  best: number;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`UI 元素缺失: #${id}`);
  return node as T;
}

/**
 * DOM 版 HUD：与 Three.js 渲染解耦，避免每帧重建 WebGL 资源。
 */
export class GameUI {
  private readonly hpFill = el<HTMLElement>('hp-fill');
  private readonly shieldFill = el<HTMLElement>('shield-fill');
  private readonly scoreValue = el<HTMLElement>('score-value');
  private readonly levelLabel = el<HTMLElement>('level-label');
  private readonly weaponLabel = el<HTMLElement>('weapon-label');
  private readonly bossPanel = el<HTMLElement>('boss-panel');
  private readonly bossName = el<HTMLElement>('boss-name');
  private readonly bossPhase = el<HTMLElement>('boss-phase');
  private readonly bossFill = el<HTMLElement>('boss-fill');
  private readonly bossSeg = el<HTMLElement>('boss-seg');
  private readonly bossBanner = el<HTMLElement>('boss-banner');
  private readonly bossBannerPhase = el<HTMLElement>('boss-banner-phase');
  private readonly bossBannerText = el<HTMLElement>('boss-banner-text');
  private readonly soundBtn = el<HTMLButtonElement>('btn-sound');
  private readonly bloomBtn = el<HTMLButtonElement>('btn-bloom');
  private readonly warning = el<HTMLElement>('warning');
  private bannerTimer = 0;
  private flashTimer = 0;
  private readonly specialBtn = el<HTMLButtonElement>('btn-special');
  private readonly specialCd = el<HTMLElement>('special-cd');
  private readonly flash = el<HTMLElement>('flash');
  private readonly coinValue = el<HTMLElement>('coin-badge').querySelector('b') as HTMLElement;
  private readonly pickupPop = el<HTMLElement>('pickup-pop');
  private popTimer = 0;

  private readonly screens: Record<Exclude<ScreenKind, 'none'>, HTMLElement> = {
    start: el<HTMLElement>('screen-start'),
    pause: el<HTMLElement>('screen-pause'),
    fail: el<HTMLElement>('screen-fail'),
    clear: el<HTMLElement>('screen-clear'),
  };

  private readonly startLevelLabel = el<HTMLElement>('start-level');
  private readonly nextBtn = el<HTMLButtonElement>('btn-next');
  private readonly starRow = el<HTMLElement>('stars');
  private readonly resScore = el<HTMLElement>('res-score');
  private readonly resKills = el<HTMLElement>('res-kills');
  private readonly resCoins = el<HTMLElement>('res-coins');
  private readonly resBest = el<HTMLElement>('res-best');

  constructor(handlers: UIHandlers) {
    el<HTMLButtonElement>('btn-start').addEventListener('click', handlers.onStart);
    el<HTMLButtonElement>('btn-pause').addEventListener('click', handlers.onPause);
    el<HTMLButtonElement>('btn-resume').addEventListener('click', handlers.onResume);
    el<HTMLButtonElement>('btn-restart').addEventListener('click', handlers.onRestart);
    el<HTMLButtonElement>('btn-retry').addEventListener('click', handlers.onRestart);
    el<HTMLButtonElement>('btn-next').addEventListener('click', handlers.onNext);
    this.specialBtn.addEventListener('click', handlers.onSpecial);
    el<HTMLButtonElement>('btn-missions').addEventListener('click', handlers.onMissions);
    el<HTMLButtonElement>('btn-hangar').addEventListener('click', handlers.onHangar);
    el<HTMLButtonElement>('btn-fail-hangar').addEventListener('click', handlers.onHangar);
    el<HTMLButtonElement>('btn-clear-hangar').addEventListener('click', handlers.onHangar);
    this.soundBtn.addEventListener('click', handlers.onToggleSound);
    this.bloomBtn.addEventListener('click', handlers.onToggleBloom);
  }

  setStats(hpRatio: number, shieldRatio: number, score: number): void {
    this.hpFill.style.transform = `scaleX(${Math.max(0, Math.min(1, hpRatio))})`;
    this.shieldFill.style.transform = `scaleX(${Math.max(0, Math.min(1, shieldRatio))})`;
    this.scoreValue.textContent = String(Math.floor(score));
  }

  setLevel(label: string): void {
    this.levelLabel.textContent = label;
  }

  setWeapon(name: string): void {
    this.weaponLabel.textContent = name;
  }

  /** 开始界面上的"出击目标" */
  setStartHint(label: string): void {
    this.startLevelLabel.textContent = label;
  }

  /** 通关界面按钮：有下一关时显示"下一关 X-X" */
  setNextLabel(text: string): void {
    this.nextBtn.textContent = text;
  }

  setCoins(coins: number): void {
    this.coinValue.textContent = String(coins);
  }

  /** 拾取道具的飘字提示 */
  popPickup(text: string, tone: 'coin' | 'power' | 'shield' | 'heal'): void {
    this.pickupPop.textContent = text;
    this.pickupPop.className = `pop show pop-${tone}`;
    window.clearTimeout(this.popTimer);
    this.popTimer = window.setTimeout(() => this.pickupPop.classList.remove('show'), 900);
  }

  setBoss(visible: boolean, name = '', ratio = 1, phase = 1): void {
    this.bossPanel.hidden = !visible;
    if (!visible) return;
    const p = phase === 3 ? 3 : phase === 2 ? 2 : 1;
    this.bossName.textContent = name;
    this.bossPhase.textContent = `阶段 ${p}`;
    this.bossFill.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;

    // 血条分段：高亮当前阶段对应的区间（100~70 / 70~30 / 30~0）
    const segs: Record<number, [left: number, width: number]> = { 1: [70, 30], 2: [30, 40], 3: [0, 30] };
    const [left, width] = segs[p];
    this.bossSeg.style.left = `${left}%`;
    this.bossSeg.style.width = `${width}%`;
    this.bossPanel.classList.remove('phase-1', 'phase-2', 'phase-3');
    this.bossPanel.classList.add(`phase-${p}`);
  }

  /** 阶段切换演出：横幅 + 血条闪烁 */
  flashBossPhase(phase: number, text: string): void {
    this.bossBannerPhase.textContent = `PHASE ${phase}`;
    this.bossBannerText.textContent = text;
    this.bossBanner.hidden = true;
    void this.bossBanner.offsetWidth; // 重启动画
    this.bossBanner.hidden = false;
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.bossBanner.hidden = true;
    }, 1200);

    this.bossPanel.classList.remove('phase-flash');
    void this.bossPanel.offsetWidth;
    this.bossPanel.classList.add('phase-flash');
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => this.bossPanel.classList.remove('phase-flash'), 1300);
  }

  /** 音效按钮状态 */
  setSoundMuted(muted: boolean): void {
    this.soundBtn.textContent = muted ? '🔇' : '🔊';
    this.soundBtn.classList.toggle('off', muted);
  }

  /** 辉光按钮状态 */
  setBloomEnabled(on: boolean): void {
    this.bloomBtn.textContent = `辉光特效：${on ? '开' : '关'}`;
    this.bloomBtn.classList.toggle('off', !on);
  }

  setWarning(visible: boolean): void {
    this.warning.hidden = !visible;
  }

  setSpecial(ratio: number, ready: boolean): void {
    this.specialCd.style.transform = `scaleX(${1 - Math.max(0, Math.min(1, ratio))})`;
    this.specialBtn.classList.toggle('ready', ready);
  }

  showScreen(kind: ScreenKind): void {
    for (const key of Object.keys(this.screens) as (keyof typeof this.screens)[]) {
      this.screens[key].hidden = key !== kind;
    }
  }

  showClear(result: ClearResult): void {
    this.starRow.textContent = '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars);
    this.resScore.textContent = String(Math.floor(result.score));
    this.resKills.textContent = String(result.kills);
    this.resCoins.textContent = String(result.coins);
    this.resBest.textContent = String(Math.floor(result.best));
    this.showScreen('clear');
  }

  /** 屏幕闪白（受击 / 必杀） */
  triggerFlash(): void {
    this.flash.classList.add('on');
    window.setTimeout(() => this.flash.classList.remove('on'), 60);
  }
}
