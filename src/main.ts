import { Game } from './core/Game';
import { loadSave, writeSave } from './data/SaveData';
import { BOSS_MODEL_URL, PLAYER_MODEL_URL, preloadModel } from './render/ModelAssets';

const container = document.getElementById('app');
if (!container) {
  throw new Error('缺少 #app 容器');
}

// 调试充值：?coins=100000 把存档金币直接设为该值（幂等）；?coins=+100000 表示累加
// 仅本地开发 / 预览生效，构建后的线上产物不含此逻辑
const isLocalHost =
  import.meta.env.DEV || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
if (isLocalHost) {
  const raw = new URLSearchParams(location.search).get('coins');
  if (raw) {
    const isDelta = raw.startsWith('+');
    const value = Number(isDelta ? raw.slice(1) : raw);
    if (Number.isFinite(value) && value > 0) {
      const save = loadSave();
      save.coins = Math.round(isDelta ? save.coins + value : value);
      writeSave(save);
      console.info(`[debug] 金币已${isDelta ? '充值' : '设置为'} ${save.coins}`);
    }
  }
}

/** 开屏等待模型的最长时间：网络再慢也不能把启动卡死（超时后走程序化回退） */
const MODEL_BOOT_TIMEOUT = 2500;

function withTimeout(task: Promise<unknown>, ms: number): Promise<unknown> {
  return Promise.race([task, new Promise((resolve) => window.setTimeout(resolve, ms))]);
}

/**
 * 进场前先把 GLB 拉到缓存里再启动游戏。
 *
 * 之前是"先建游戏、后台再下载模型"，于是开局那一瞬玩家看到的是程序化机体，
 * 几帧后才被 GLB 顶掉 —— 看起来就是"旧飞机闪一下才变成新模型"。
 */
async function boot(host: HTMLElement): Promise<void> {
  await Promise.all(
    [PLAYER_MODEL_URL, BOSS_MODEL_URL].map((url) =>
      withTimeout(
        preloadModel(url).catch(() => {
          console.warn('[model] 模型不可用，将使用程序化机体：', url);
        }),
        MODEL_BOOT_TIMEOUT,
      ),
    ),
  );

  const game = new Game(host);
  game.start();

  // 战机参数恢复初始：?reset=1（金币与关卡进度保留）
  if (isLocalHost && new URLSearchParams(location.search).get('reset')) {
    game.resetAircraftParams();
    console.info('[debug] 战机参数已恢复初始（机体 falcon / 武器 Lv1 / 强化 0）');
  }

  // 方便在浏览器控制台调试
  const debug = window as unknown as {
    game: Game;
    grantCoins: (amount: number) => void;
    resetAircraft: () => void;
    resetSave: () => void;
  };
  debug.game = game;
  debug.grantCoins = (amount: number): void => {
    game.progress.addCoins(amount);
    game.ui.setCoins(game.progress.coins);
    game.hangar.render();
  };
  debug.resetAircraft = (): void => {
    game.resetAircraftParams();
  };
  debug.resetSave = (): void => {
    game.progress.resetAll();
    game.ui.setCoins(game.progress.coins);
    game.hangar.render();
    game.levelSelect.render();
  };
}

void boot(container);
