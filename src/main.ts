import { Game } from './game';
import { TestBed } from './levels/testbed';
import './levels/m01';
import { installVehicles } from './vehicles';
import { JsonLevel } from './world/jsonLevel';
import type { LevelData } from './world/leveldata';
import type { Level } from './world/level';
import { WatchMenu } from './ui/watchMenu';
import { InventoryScreen } from './ui/inventoryScreen';
import { MissionReport } from './ui/missionReport';
import { markCompleted, writeSave } from './core/save';
import { openEditor, takeBootNote } from './core/nav';
import { loadClips } from './anim/clips';
import { loadSurfaces } from './render/surfaces';

/**
 * Boot + top-level flow:
 *   loading -> click to start -> watch menu -> mission -> (pause | backpack) -> mission report -> menu
 *
 * URL switches (mostly for the level editor and automated tests):
 *   ?level=<id>     skip the menu and load public/levels/<id>.json ('test' = sandbox yard,
 *                   'custom' = the level being edited, handed over through localStorage)
 *   ?auto=1         no click-to-start, no pointer lock (headless tests)
 *   ?nointro=1      skip mission intro cutscenes
 *   ?dev=1          expose game.debug
 */

const params = new URLSearchParams(location.search);
const note = takeBootNote();
const game = new Game();
(window as any).__game = game;
installVehicles(game);

/** watch-menu mission id -> level file id */
const LEVEL_FOR: Record<string, string> = { receiving: 'm01' };
const fromEditor = params.get('from') === 'editor' || note?.from === 'editor';
let currentLevelId = 'm01';
let currentMission = 'receiving';

async function makeLevel(id: string): Promise<Level> {
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
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}levels/${id}.json`);
      if (res.ok) data = await res.json();
    } catch {
      data = null;
    }
  }
  if (!data) {
    console.warn('[level] could not load', id, '- falling back to the test yard');
    return new TestBed();
  }
  return new JsonLevel(data);
}

async function boot() {
  await Promise.all([loadClips(), loadSurfaces()]);
  const ui = game.ui;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<h1>EVERYTHING<br>MUST GO</h1><p>Loading the stockroom…</p><div class="loadbar"><b></b></div>`;
  ui.appendChild(overlay);
  const bar = overlay.querySelector('.loadbar b') as HTMLElement;
  game.audio.init();
  await Promise.all([game.audio.loadAllSfx((f) => (bar.style.width = Math.round(f * 100) + '%')), document.fonts ? document.fonts.ready : Promise.resolve()]);
  game.start();

  const auto = params.has('auto');
  const lock = () => {
    if (!auto) game.input.requestLock();
  };

  // ---------------------------------------------------------------- screens
  const loading = document.createElement('div');
  loading.className = 'overlay';
  loading.style.display = 'none';
  loading.innerHTML = `<h1 style="font-size:clamp(28px,5vw,64px)">CLOCKING IN…</h1>`;
  ui.appendChild(loading);

  const startLevel = async (levelId: string) => {
    currentLevelId = levelId;
    loading.style.display = 'flex';
    game.state = 'boot';
    menu.close();
    // let the "loading" card paint before the (synchronous) level build
    await new Promise((r) => setTimeout(r, 30));
    await game.loadLevel(await makeLevel(levelId));
    loading.style.display = 'none';
    game.state = 'playing';
    game.ready = true;
    lock();
  };

  const toMenu = () => {
    game.unloadLevel();
    game.state = 'menu';
    game.audio.setMuffle(20000);
    void game.audio.playMusic('menu');
    game.audio.setMusicIntensity(0);
    menu.openMain();
  };

  const resume = () => {
    menu.close();
    bag.close();
    game.setPaused(false);
    lock();
  };

  const pause = () => {
    if (game.state !== 'playing' || !game.player.alive) return;
    game.setPaused(true);
    game.input.exitLock();
    menu.openPause();
  };

  const openBag = () => {
    if (game.state !== 'playing' && game.state !== 'paused') return;
    if (!game.player.alive) return;
    menu.close();
    game.state = 'inventory';
    game.audio.setMuffle(900, 0.1);
    game.input.exitLock();
    bag.open();
  };

  const menu = new WatchMenu(game, {
    onStartMission: (missionId, difficulty) => {
      currentMission = missionId;
      game.settings.difficulty = difficulty;
      game.applySettings();
      game.saveSettings();
      writeSave({ lastMission: missionId, difficulty });
      void startLevel(LEVEL_FOR[missionId] ?? missionId);
    },
    onResume: resume,
    onRestart: () => void startLevel(currentLevelId),
    onQuitToMenu: () => {
      if (fromEditor) openEditor();
      else toMenu();
    },
    onOpenBackpack: openBag,
    onOpenEditor: openEditor,
  });
  const bag = new InventoryScreen(game, resume);
  const report = new MissionReport(game, () => {
    report.hide();
    if (fromEditor) openEditor();
    else toMenu();
  });

  game.events.on('pauseRequested', pause);
  game.events.on('inventoryRequested', openBag);
  game.events.on('missionComplete', () => {
    if (game.state === 'report') return;
    game.state = 'report';
    game.input.exitLock();
    game.audio.setMusicIntensity(0);
    if (!fromEditor && currentLevelId !== 'test' && currentLevelId !== 'custom') markCompleted(currentMission);
    const lvl = game.level;
    report.show(lvl?.number ?? '', lvl?.title ?? '');
    void game.hud.fade(false, 0.4);
  });
  // losing pointer lock (Esc, alt-tab) while playing brings up the watch
  game.input.onLockChange = (locked) => {
    if (!locked && game.state === 'playing' && game.input.device === 'kbm' && !auto) pause();
  };
  game.canvas.addEventListener('click', () => {
    if (game.state === 'playing') lock();
  });

  if (fromEditor) {
    const back = document.createElement('div');
    back.className = 'interactive outline';
    back.style.cssText = 'position:absolute;right:14px;top:10px;font:700 15px var(--ui);cursor:pointer;opacity:.85;z-index:5';
    back.innerHTML = '<span class="key">F4</span> BACK TO EDITOR';
    back.onclick = openEditor;
    ui.appendChild(back);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F4') openEditor();
    });
  }

  // ---------------------------------------------------------------- first screen
  const direct = params.get('level') ?? note?.level ?? null;
  const begin = async () => {
    overlay.remove();
    game.audio.resume();
    if (direct) await startLevel(direct);
    else {
      toMenu();
      game.ready = true;
    }
  };
  if (auto) {
    await begin();
  } else {
    overlay.querySelector('p')!.textContent = 'A cel-shaded looter-shooter about clocking out.';
    overlay.querySelector('.loadbar')!.remove();
    const go = document.createElement('div');
    go.className = 'go';
    go.textContent = 'PRESS ANY BUTTON TO START';
    overlay.appendChild(go);
    // a click, a key or a controller button all start the game
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      game.input.onAnyInput = null;
      void begin();
    };
    overlay.addEventListener('click', start);
    game.input.onAnyInput = start;
    game.ready = true;
  }
}

if (params.has('dev') || params.has('auto')) void import('./dev/debug').then((m) => m.installDebug(game));
void boot();
