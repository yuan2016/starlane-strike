import { CHAPTERS, LEVELS, chapterOf, type LevelDef } from '../data/levels';
import type { Progress } from '../player/Progress';

export interface LevelSelectHandlers {
  onLaunch: (levelId: string) => void;
  onBack: () => void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`UI 元素缺失: #${id}`);
  return node as T;
}

function stars(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));
}

/**
 * 关卡选择界面：列出第一章全部关卡、星级与解锁状态。
 * 列表按解锁进度渲染，点击卡片直接出击。
 */
export class LevelSelectUI {
  private readonly root = el<HTMLElement>('screen-levels');
  private readonly list = el<HTMLElement>('level-list');
  private readonly starTotal = el<HTMLElement>('levels-stars');
  private readonly onLaunch: (id: string) => void;

  constructor(
    private readonly progress: Progress,
    handlers: LevelSelectHandlers,
  ) {
    this.onLaunch = handlers.onLaunch;
    el<HTMLButtonElement>('btn-levels-back').addEventListener('click', handlers.onBack);
    this.list.addEventListener('click', (event) => {
      const card = (event.target as HTMLElement | null)?.closest('button.level-card');
      if (!card) return;
      const id = card.getAttribute('data-id');
      if (!id || card.classList.contains('locked')) return;
      this.onLaunch(id);
    });
  }

  show(): void {
    this.render();
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  private render(): void {
    this.starTotal.textContent = `★ ${this.progress.totalStars} / ${LEVELS.length * 3}`;
    this.list.innerHTML = '';

    // 按章节分组：每章一个标题 + 该章关卡卡片
    let lastChapter = -1;
    LEVELS.forEach((level, index) => {
      const chapter = chapterOf(level.id);
      if (chapter !== lastChapter) {
        lastChapter = chapter;
        this.list.appendChild(this.buildChapterHead(chapter));
      }
      this.list.appendChild(this.buildCard(level, index));
    });
  }

  private buildChapterHead(chapter: number): HTMLElement {
    const head = document.createElement('div');
    head.className = 'chapter-title';
    head.textContent = CHAPTERS.find((c) => c.id === chapter)?.name ?? `第 ${chapter} 章`;
    return head;
  }

  private buildCard(level: LevelDef, index: number): HTMLElement {
    {
      const unlocked = this.progress.isUnlocked(level.id, index);
      const starCount = this.progress.starsOf(level.id);
      const best = this.progress.bestOf(level.id);

      const card = document.createElement('button');
      card.className = unlocked ? 'level-card' : 'level-card locked';
      card.setAttribute('data-id', level.id);
      if (!unlocked) card.disabled = true;

      const id = document.createElement('span');
      id.className = 'level-id';
      id.textContent = level.id;

      const name = document.createElement('span');
      name.className = 'level-name';
      name.textContent = level.name;

      const brief = document.createElement('span');
      brief.className = 'level-brief';
      brief.textContent = unlocked ? level.brief : '通关上一关后解锁';

      const boss = document.createElement('span');
      boss.className = 'level-boss';
      boss.textContent = unlocked ? `BOSS ${level.boss.name}` : 'BOSS ???';

      const starRow = document.createElement('span');
      starRow.className = 'level-stars';
      starRow.textContent = stars(starCount);

      const meta = document.createElement('span');
      meta.className = 'level-meta';
      meta.textContent = best > 0 ? `最高 ${best}` : '未挑战';

      const head = document.createElement('div');
      head.className = 'level-head';
      head.append(id, name, starRow);

      const foot = document.createElement('div');
      foot.className = 'level-foot';
      foot.append(boss, meta);

      card.append(head, brief, foot);
      return card;
    }
  }
}
