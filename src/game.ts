import * as THREE from 'three';
import { setGame } from './core/globals';
import { Emitter } from './core/events';
import { Input } from './core/input';
import { clamp, damp } from './core/math';
import type { DamageInfo } from './core/types';
import { AudioSys } from './audio/audio';
import { RenderPipeline } from './render/pipeline';
import { Sky, SKY_DAWN } from './render/sky';
import { Fx } from './render/fx';
import { toon, RAMP_CHAR } from './render/toon';
import { textures } from './render/textures';
import { GeoBuilder } from './world/builder';
import { CollisionWorld } from './world/collision';
import { World, type Interactable } from './world/world';
import type { Level } from './world/level';
import { Player } from './player/player';
import { ViewModel } from './player/viewmodel';
import { WeaponController } from './weapons/controller';
import { Mines } from './weapons/mines';
import { Inventory } from './loot/inventory';
import { Loot } from './loot/loot';
import { Hud } from './ui/hud';
import { Nav } from './ai/nav';
import { Projectiles } from './ai/projectile';
import { AiDirector } from './ai/director';

export type GameState = 'boot' | 'menu' | 'playing' | 'paused' | 'inventory' | 'report';

export interface Settings {
  sensitivity: number;
  padSensitivity: number;
  invertY: boolean;
  fov: number;
  master: number;
  music: number;
  sfx: number;
  voice: number;
  /** 0 = auto (chunky PS2 pixels), 1 = native, 2+ = forced divisor */
  pixelScale: number;
  dither: boolean;
  difficulty: number;
  subtitles: boolean;
  /** internal render height the auto pixel scale aims for (540 = PS2 look, 1080 = sharp) */
  resTarget?: number;
}

const DEFAULTS: Settings = {
  sensitivity: 1,
  padSensitivity: 1,
  invertY: false,
  fov: 74,
  master: 0.9,
  music: 0.55,
  sfx: 1,
  voice: 1,
  pixelScale: 0,
  dither: true,
  difficulty: 1,
  subtitles: true,
};

export const DIFFICULTIES = [
  { name: 'Temp', blurb: 'Seasonal hire. Enemies hit softer.', damageTaken: 0.6, enemyHealth: 0.85, enemyAim: 0.8 },
  { name: 'Associate', blurb: 'The intended experience.', damageTaken: 1, enemyHealth: 1, enemyAim: 1 },
  { name: 'Shop Steward', blurb: 'For those who read the contract.', damageTaken: 1.55, enemyHealth: 1.3, enemyAim: 1.2 },
];

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();

export class Game {
  readonly canvas: HTMLCanvasElement;
  readonly ui: HTMLElement;
  readonly pipe: RenderPipeline;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.08, 1500);
  readonly input: Input;
  readonly audio = new AudioSys();
  readonly col = new CollisionWorld();
  readonly world = new World();
  readonly events = new Emitter<Record<string, any>>();
  readonly sky: Sky;
  readonly fx: Fx;
  readonly hud: Hud;
  readonly player = new Player();
  readonly view: ViewModel;
  readonly weapons = new WeaponController();
  readonly mines = new Mines();
  readonly inv = new Inventory();
  readonly loot = new Loot();
  readonly nav = new Nav();
  readonly projectiles: Projectiles;
  readonly ai: AiDirector;
  /** shared materials */
  readonly mat: { prop: THREE.Material; char: THREE.Material };

  settings: Settings = { ...DEFAULTS };
  difficulty = DIFFICULTIES[1];
  state: GameState = 'boot';
  level: Level | null = null;
  time = 0;
  realTime = 0;
  dt = 0;
  timeScale = 1;
  killY = -40;
  enemyLevel = 1;
  ready = false;
  /** when true the loop is only advanced by step() (automated tests) */
  manual = false;
  frame = 0;
  fps = 60;
  stats = this.freshStats();
  private last = 0;
  private respawn = { pos: new THREE.Vector3(), yaw: 0 };
  private deathTimer = -1;
  private hitstop = 0;
  /** per-frame hooks registered by optional systems (AI, vehicles, cutscenes, menus) */
  readonly systems: { update(dt: number): void; lateUpdate?(dt: number): void }[] = [];
  /** when set (menus), this scene/camera is drawn instead of the game world */
  renderOverride: { scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null;
  /** set by a cutscene/vehicle to take over the camera this frame */
  cameraOwner: { updateCamera(cam: THREE.PerspectiveCamera, dt: number): void } | null = null;

  constructor() {
    setGame(this);
    this.canvas = document.getElementById('game') as HTMLCanvasElement;
    this.ui = document.getElementById('ui') as HTMLElement;
    this.loadSettings();
    this.pipe = new RenderPipeline(this.canvas);
    this.pipe.compact = true;
    this.input = new Input(this.canvas);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    textures();
    this.mat = {
      prop: toon({ vertexColors: true, ramp: RAMP_CHAR, name: 'prop' }),
      char: toon({ vertexColors: true, ramp: RAMP_CHAR, rim: 0.3, name: 'char' }),
    };
    this.sky = new Sky(this.scene, SKY_DAWN, 2048);
    this.fx = new Fx(this.scene);
    this.hud = new Hud(this.ui);
    this.view = new ViewModel(this.scene);
    this.projectiles = new Projectiles(this.scene);
    this.ai = new AiDirector();
    this.weapons.init();
    this.audio.onSubtitle = (s) => {
      if (this.settings.subtitles || !s) this.hud.subtitle(s);
    };
    this.applySettings();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.setPaused(true);
    });
  }

  freshStats() {
    return { shots: 0, hits: 0, kills: 0, crits: 0, damageTaken: 0, deaths: 0, cash: 0, loot: 0, lockers: 0, time: 0, mineKills: 0, roadkills: 0 };
  }

  // ---------------------------------------------------------------- settings

  loadSettings() {
    try {
      const raw = localStorage.getItem('emg-settings');
      if (raw) this.settings = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      /* private mode etc. */
    }
  }
  saveSettings() {
    try {
      localStorage.setItem('emg-settings', JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }
  applySettings() {
    const s = this.settings;
    this.input.sensitivity = s.sensitivity;
    this.input.padSensitivity = s.padSensitivity;
    this.input.invertY = s.invertY;
    this.player.baseFov = s.fov;
    this.audio.volumes.master = s.master;
    this.audio.volumes.music = s.music;
    this.audio.volumes.sfx = s.sfx;
    this.audio.volumes.voice = s.voice;
    this.audio.applyVolumes();
    this.pipe.forcedScale = s.pixelScale;
    this.pipe.targetHeight = s.resTarget ?? 540;
    this.pipe.post.uniforms.uPosterize.value = s.dither ? 40 : 0;
    this.difficulty = DIFFICULTIES[clamp(s.difficulty, 0, 2)];
    this.resize();
  }

  resize() {
    this.pipe.resize(window.innerWidth, window.innerHeight);
    this.camera.aspect = this.pipe.aspect;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- level flow

  async loadLevel(level: Level) {
    this.unloadLevel();
    this.level = level;
    this.killY = level.killY;
    this.enemyLevel = level.enemyLevel;
    this.sky.apply(level.sky);
    const b = new GeoBuilder();
    level.build(b);
    const built = b.build();
    level.group = built.group;
    this.scene.add(built.group);
    this.col.setStatic(built.collision);
    this.events.emit('levelBuilt', { level, builder: b });
    this.world.targets.push(this.player);
    this.world.shootables.push(this.player);
    this.player.spawn(level.spawn.pos, level.spawn.yaw);
    this.respawn.pos.copy(level.spawn.pos);
    this.respawn.yaw = level.spawn.yaw;
    this.stats = this.freshStats();
    this.time = 0;
    this.deathTimer = -1;
    this.hud.setObjectives(level.title.toUpperCase(), []);
    level.onStart();
    this.weapons.equipActive();
    this.events.emit('levelStarted', { level });
    console.info(`[level] ${level.id}: ${built.tris} tris, ${built.colTris} collision tris`);
  }

  unloadLevel() {
    if (!this.level) return;
    this.events.emit('levelUnload', { level: this.level });
    this.level.dispose();
    if (this.level.group) {
      this.level.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) m.geometry.dispose();
      });
      this.level.group.removeFromParent();
    }
    this.mines.clear();
    // everything the world tracked owns scene objects: drop them
    for (const u of this.world.updatables) {
      const any = u as any;
      any.dead = true;
      any.obj?.removeFromParent?.();
      any.mesh?.removeFromParent?.();
      any.beam?.removeFromParent?.();
      any.dispose?.();
    }
    this.world.clear();
    this.col.clear();
    this.fx.clear();
    this.hud.clearMarkers();
    this.hud.setBoss(null);
    this.cameraOwner = null;
    this.level = null;
  }

  setCheckpoint(pos: THREE.Vector3, yaw: number, silent = false) {
    this.respawn.pos.copy(pos);
    this.respawn.yaw = yaw;
    if (!silent) {
      this.hud.toast('CHECKPOINT', 1.4, '#ffd21f');
      this.audio.play('checkpoint', { bus: 'ui', vol: 0.6 });
    }
    this.events.emit('checkpoint', { pos });
  }

  onPlayerDeath(_d: DamageInfo) {
    this.stats.deaths++;
    this.deathTimer = 3.0;
    this.audio.setMuffle(500, 0.3);
    this.audio.stinger('death', 0.9);
    this.hud.toast('CLOCKED OUT', 2.4, '#ff5a3c');
    this.events.emit('playerDied', {});
    setTimeout(() => this.audio.say(['st_death_1', 'st_death_2', 'st_death_3'][Math.floor(Math.random() * 3)]), 900);
  }

  private doRespawn() {
    const fee = Math.floor(this.inv.cash * 0.07);
    this.inv.cash -= fee;
    this.player.spawn(this.respawn.pos, this.respawn.yaw);
    this.player.setShield(this.player.shieldMax, this.player.shieldDelay, this.player.shieldRate, true);
    this.audio.setMuffle(20000, 0.4);
    this.weapons.setHolstered(false);
    this.weapons.equipActive();
    void this.hud.fade(false, 0.5);
    if (fee > 0) this.hud.feedLine(`<span style="color:#ff5a3c">-$${fee} re-hiring fee</span>`);
    this.events.emit('playerRespawned', {});
  }

  setPaused(p: boolean) {
    if (p && this.state === 'playing') {
      this.state = 'paused';
      this.audio.setMuffle(700, 0.1);
      this.events.emit('paused', {});
    } else if (!p && (this.state === 'paused' || this.state === 'inventory')) {
      this.state = 'playing';
      this.audio.setMuffle(this.player.alive ? 20000 : 500, 0.15);
      this.events.emit('resumed', {});
    }
  }

  /** Freeze the simulation for a few frames to sell a big hit. */
  hitStop(seconds: number) {
    this.hitstop = Math.max(this.hitstop, seconds);
  }

  // ---------------------------------------------------------------- loop

  start() {
    this.last = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const raw = Math.min(0.05, Math.max(0.0005, (now - this.last) / 1000));
      this.last = now;
      this.fps = damp(this.fps, 1 / raw, 2, raw);
      if (!this.manual) this.tick(raw);
      this.render();
    };
    requestAnimationFrame(loop);
  }

  /** Advance the simulation by `n` frames of `dt` seconds without waiting for the browser (tests). */
  step(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i++) this.tick(dt);
    this.render();
  }

  tick(raw: number) {
    this.frame++;
    this.realTime += raw;
    this.input.update(raw);
    let dt = raw * this.timeScale;
    if (this.hitstop > 0) {
      this.hitstop -= raw;
      dt *= 0.05;
    }
    this.dt = dt;

    if (this.state === 'playing' && this.level) {
      this.time += dt;
      this.stats.time += dt;
      const pl = this.player;
      this.level.update(dt);
      for (const s of this.systems) s.update(dt);
      pl.update(dt);
      this.ai.update(dt);
      this.projectiles.update(dt);
      this.world.update(dt);
      this.mines.update(dt);
      this.weapons.update(dt);
      if (this.cameraOwner) this.cameraOwner.updateCamera(this.camera, dt);
      else pl.updateCamera(this.camera, dt);
      this.camera.updateMatrixWorld(true);
      this.view.update(dt);
      for (const s of this.systems) s.lateUpdate?.(dt);
      this.fx.update(dt);
      this.updateFocus(dt);
      this.hud.update(dt);

      if (this.deathTimer > 0) {
        this.deathTimer -= raw;
        if (this.deathTimer <= 0.6 && this.deathTimer + raw > 0.6) void this.hud.fade(true, 0.5);
        if (this.deathTimer <= 0) this.doRespawn();
      }
      if (this.input.pressed('pause') && pl.alive) this.events.emit('pauseRequested', {});
      if (this.input.pressed('inventory') && pl.alive && !pl.frozen) this.events.emit('inventoryRequested', {});
    } else {
      for (const s of this.systems) s.update(dt);
      this.camera.updateMatrixWorld(true);
      for (const s of this.systems) s.lateUpdate?.(dt);
    }
    this.audio.setListener(this.camera);
  }

  render() {
    if (this.renderOverride) {
      const o = this.renderOverride;
      o.camera.aspect = this.pipe.aspect;
      o.camera.updateProjectionMatrix();
      this.pipe.post.uniforms.uTime.value = this.realTime;
      this.pipe.render(o.scene, o.camera, { viewFov: 50, drawView: false });
      return;
    }
    this.sky.update(this.camera.position, this.realTime);
    this.pipe.post.uniforms.uTime.value = this.realTime;
    const drawView = this.state !== 'menu' && this.view.root.visible && !this.cameraOwner && this.player.alive;
    this.pipe.render(this.scene, this.camera, { viewFov: this.view.viewFov, drawView });
  }

  // ---------------------------------------------------------------- interaction

  private updateFocus(dt: number) {
    const pl = this.player;
    if (!pl.alive || pl.frozen || pl.vehicle) {
      // vehicles still need the "exit" prompt: they register a single interactable handled below
      if (!pl.vehicle) {
        this.hud.setFocus(null, dt);
        return;
      }
    }
    pl.eyePos(_eye);
    pl.lookDir(_dir);
    let best: Interactable | null = null;
    let bestScore = 0.82;
    for (const it of this.world.interactables) {
      if (!it.enabled) continue;
      _v.copy(it.pos).sub(_eye);
      const d = _v.length();
      if (d > it.range) continue;
      const dot = d < 0.6 ? 1 : _v.multiplyScalar(1 / d).dot(_dir);
      // close things are easier to target
      const score = dot + clamp(1 - d / it.range, 0, 1) * 0.08;
      if (score > bestScore) {
        // must be visible (allow the ray to stop just short of the object)
        if (d > 0.8 && !this.col.lineOfSight(_eye, _v.copy(it.pos).lerp(_eye, 0.12))) continue;
        bestScore = score;
        best = it;
      }
    }
    this.hud.setFocus(best, dt);
  }
}
