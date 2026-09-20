import { Game } from './core/Game';
import { loadSave, writeSave } from './data/SaveData';
import { PLAYER_MODEL_URL, preloadModel } from './render/ModelAssets';

const container = document.getElementById('app');
if (!container) {
  throw new Error('缺少 #app 容器');
}

// 开发调试：?coins=10000 直接给存档充金币（仅 dev，构建产物不含此分支）
if (import.meta.env.DEV) {
  const grant = Number(new URLSearchParams(location.search).get('coins') ?? '0');
  if (Number.isFinite(grant) && grant > 0) {
    const save = loadSave();
    save.coins += Math.round(grant);
    writeSave(save);
    console.info(`[dev] 已充值 ${Math.round(grant)} 金币，当前存档金币 ${save.coins}`);
  }
}

// 开局前把玩家机模型拉下来，避免进场瞬间才弹出外观
preloadModel(PLAYER_MODEL_URL).catch(() => {
  console.warn('[model] 玩家机模型不可用，将使用程序化机体');
});

const game = new Game(container);
game.start();

// 方便在浏览器控制台调试
const debug = window as unknown as { game: Game; grantCoins: (amount: number) => void };
debug.game = game;
debug.grantCoins = (amount: number): void => {
  game.progress.addCoins(amount);
  game.ui.setCoins(game.progress.coins);
  game.hangar.render();
};
