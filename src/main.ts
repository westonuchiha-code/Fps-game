import { Game } from './game';
import { TestBed } from './levels/testbed';
import './levels/m01';
import { installVehicles } from './vehicles';
import { JsonLevel } from './world/jsonLevel';
import type { LevelData } from './world/leveldata';
import type { Level } from './world/level';

const params = new URLSearchParams(location.search);
const game = new Game();
(window as any).__game = game;
installVehicles(game);

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

  /** ?level=test (sandbox yard), ?level=custom (from the level editor), ?level=<id> (public/levels/<id>.json) */
  const makeLevel = async (): Promise<Level> => {
    const id = params.get('level') ?? 'test';
    if (id === 'test') return new TestBed();
    let data: LevelData | null = null;
    if (id === 'custom') {
      try {
        data = JSON.parse(localStorage.getItem('emg-editor-level') ?? 'null');
        const sp = JSON.parse(localStorage.getItem('emg-editor-spawn') ?? 'null');
        if (data && sp && Array.isArray(sp.pos)) data.spawn = { pos: sp.pos, yaw: sp.yaw ?? 0 };
        localStorage.removeItem('emg-editor-spawn');
      } catch {
        data = null;
      }
    } else {
      const res = await fetch(`${import.meta.env.BASE_URL}levels/${id}.json`);
      if (res.ok) data = await res.json();
    }
    if (!data) {
      console.warn('[level] could not load', id, '- falling back to the test yard');
      return new TestBed();
    }
    return new JsonLevel(data);
  };

  const begin = async () => {
    overlay.remove();
    game.audio.resume();
    await game.loadLevel(await makeLevel());
    game.state = 'playing';
    game.ready = true;
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
    game.ready = true;
  }
  game.canvas.addEventListener('click', () => {
    if (game.state === 'playing') game.input.requestLock();
  });
}
if (params.has('dev') || params.has('auto')) void import('./dev/debug').then((m) => m.installDebug(game));
void boot();
