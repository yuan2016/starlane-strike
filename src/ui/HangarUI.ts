import { AIRCRAFT_LIST, type AircraftId } from '../data/aircraft';
import { UPGRADE_MAX_LEVEL } from '../data/SaveData';
import { WEAPON_LIST, type WeaponId } from '../data/weapons';
import { Progress, UPGRADES, upgradeCost } from '../player/Progress';

export interface HangarHandlers {
  /** 出击：进入关卡 */
  onLaunch: () => void;
  /** 返回首页 */
  onBack: () => void;
  /** 装配 / 强化变化后应用到当前局 */
  onApply: () => void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`UI 元素缺失: #${id}`);
  return node as T;
}

/**
 * 机库界面：战机 / 武器选择、金币强化。
 * 所有列表按存档状态动态渲染，点击后即时写档。
 */
export class HangarUI {
  private readonly root = el<HTMLElement>('screen-hangar');
  private readonly coinLabel = el<HTMLElement>('hangar-coins');
  private readonly aircraftList = el<HTMLElement>('aircraft-list');
  private readonly weaponList = el<HTMLElement>('weapon-list');
  private readonly upgradeList = el<HTMLElement>('upgrade-list');
  private readonly toast = el<HTMLElement>('hangar-toast');

  constructor(
    private readonly progress: Progress,
    private readonly handlers: HangarHandlers,
  ) {
    el<HTMLButtonElement>('btn-hangar-launch').addEventListener('click', handlers.onLaunch);
    el<HTMLButtonElement>('btn-hangar-back').addEventListener('click', handlers.onBack);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
  }

  render(): void {
    this.coinLabel.textContent = String(this.progress.coins);
    this.renderAircraft();
    this.renderWeapons();
    this.renderUpgrades();
  }

  private renderAircraft(): void {
    this.aircraftList.replaceChildren(
      ...AIRCRAFT_LIST.map((def) => {
        const owned = this.progress.ownsAircraft(def.id);
        const equipped = this.progress.save.aircraft === def.id;
        const card = document.createElement('button');
        card.className = `card${equipped ? ' card-on' : ''}${owned ? '' : ' card-lock'}`;
        card.innerHTML = `
          <span class="card-title">${def.name}</span>
          <span class="card-desc">${def.desc}</span>
          <span class="card-stats">
            <i>HP ${def.hp}</i><i>盾 ${def.shield}</i><i>机动 ×${def.speedMul.toFixed(2)}</i><i>火力 ×${def.damageMul.toFixed(2)}</i>
          </span>
        `;
        const action = document.createElement('span');
        action.className = 'card-action';
        if (equipped) action.textContent = '出战中';
        else if (owned) action.textContent = '选择';
        else action.textContent = `◈ ${def.price}`;
        card.appendChild(action);

        card.addEventListener('click', () => {
          const ok = this.progress.selectAircraft(def.id as AircraftId);
          if (!ok) {
            this.flash('金币不足');
            return;
          }
          this.handlers.onApply();
          this.render();
        });
        return card;
      }),
    );
  }

  private renderWeapons(): void {
    this.weaponList.replaceChildren(
      ...WEAPON_LIST.map((def) => {
        const owned = this.progress.ownsWeapon(def.id);
        const equipped = this.progress.save.weapon === def.id;
        const level = this.progress.levelOf(def.id);
        const card = document.createElement('button');
        card.className = `card${equipped ? ' card-on' : ''}${owned ? '' : ' card-lock'}`;
        card.innerHTML = `
          <span class="card-title">${def.name}${owned ? ` <b>Lv${level}</b>` : ''}</span>
          <span class="card-desc">${def.desc}</span>
          <span class="card-stats">
            <i>伤害 ${def.damage}</i><i>间隔 ${def.interval.toFixed(2)}s</i>
          </span>
        `;
        const action = document.createElement('span');
        action.className = 'card-action';
        if (equipped) {
          const cost = this.progress.weaponUpgradeCost();
          action.textContent = level >= def.maxLevel ? '已满级' : `强化 ◈${cost}`;
        } else if (owned) {
          action.textContent = '选择';
        } else {
          action.textContent = `◈ ${def.price}`;
        }
        card.appendChild(action);

        card.addEventListener('click', () => {
          if (equipped) {
            // 已装备的武器：点击即升级
            if (level >= def.maxLevel) {
              this.flash('已达最高等级');
              return;
            }
            if (!this.progress.levelUpWeapon()) {
              this.flash('金币不足');
              return;
            }
            this.flash(`${def.name} 强化至 Lv${this.progress.weaponLevel}`);
          } else if (!this.progress.selectWeapon(def.id as WeaponId)) {
            this.flash('金币不足');
            return;
          }
          this.handlers.onApply();
          this.render();
        });
        return card;
      }),
    );
  }

  private renderUpgrades(): void {
    this.upgradeList.replaceChildren(
      ...UPGRADES.map((up) => {
        const level = this.progress.upgradeLevel(up.key);
        const maxed = level >= UPGRADE_MAX_LEVEL;
        const cost = upgradeCost(level);
        const card = document.createElement('button');
        card.className = `card card-mini${maxed ? ' card-max' : ''}`;
        card.innerHTML = `
          <span class="card-title">${up.name}</span>
          <span class="card-desc">${up.desc} · ${up.step}</span>
          <span class="dots">${'●'.repeat(level)}${'○'.repeat(UPGRADE_MAX_LEVEL - level)}</span>
        `;
        const action = document.createElement('span');
        action.className = 'card-action';
        action.textContent = maxed ? '已满级' : `◈ ${cost}`;
        card.appendChild(action);

        card.addEventListener('click', () => {
          if (maxed) {
            this.flash('已达最高等级');
            return;
          }
          if (!this.progress.levelUpUpgrade(up.key)) {
            this.flash('金币不足');
            return;
          }
          this.handlers.onApply();
          this.render();
        });
        return card;
      }),
    );
  }

  private flash(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.remove('show');
    // 触发一次重排以重启动画
    void this.toast.offsetWidth;
    this.toast.classList.add('show');
  }
}
