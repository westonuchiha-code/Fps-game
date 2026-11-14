import { Game } from './game';
import { TestBed } from './levels/testbed';

const params = new URLSearchParams(location.search);
const game = new Game();
(window as any).__game = game;

async function boot() {
  const ui = game.ui;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<h1>EVERYTHING<br>MUST GO</h1><p>Loading the stockroom…</p><div class="loadbar"><b></b></div>`;
  ui.appendChild(overlay);
  const bar = overlay.querySelector('.loadbar b') as HTMLElement;
  game.audio.init();
  await Promise.all([game.audio.loadAllSfx((f) => (bar.style.width = Math.round(f * 100) + '%')), document.fonts ? document.fonts.ready : Promise.resolve()]);
  game.start();

  const begin = async () => {
    overlay.remove();
    game.audio.resume();
    await game.loadLevel(new TestBed());
    game.state = 'playing';
    if (!params.has('auto')) game.input.requestLock();
  };
  if (params.has('auto')) {
    await begin();
  } else {
    overlay.querySelector('p')!.textContent = 'A cel-shaded looter-shooter about clocking out.';
    overlay.querySelector('.loadbar')!.remove();
    const go = document.createElement('div');
    go.className = 'go';
    go.textContent = 'CLICK TO START';
    overlay.appendChild(go);
    overlay.addEventListener('click', () => void begin(), { once: true });
  }
  game.canvas.addEventListener('click', () => {
    if (game.state === 'playing') game.input.requestLock();
  });
}
if (params.has('dev') || params.has('auto')) void import('./dev/debug').then((m) => m.installDebug(game));
void boot();
