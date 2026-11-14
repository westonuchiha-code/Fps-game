import * as THREE from 'three';
import { G } from '../core/globals';
import { SKY_DAWN, type SkyPreset } from '../render/sky';
import { GeoBuilder } from './builder';

export interface Trigger {
  box: THREE.Box3;
  once: boolean;
  fired: boolean;
  inside: boolean;
  fn: () => void;
  enabled: boolean;
}

export interface Objective {
  id: string;
  text: string;
  done: boolean;
}

type V3 = [number, number, number];

/** Base class for missions: geometry, triggers, objectives, checkpoints and scripting hooks. */
export abstract class Level {
  abstract readonly id: string;
  abstract readonly title: string;
  abstract readonly number: string;
  sky: SkyPreset = SKY_DAWN;
  killY = -40;
  enemyLevel = 1;
  music: string | null = null;
  spawn = { pos: new THREE.Vector3(0, 0.1, 0), yaw: 0 };
  /** boxes inside which the navigation grid is generated */
  navAreas: THREE.Box3[] = [];
  triggers: Trigger[] = [];
  objectives: Objective[] = [];
  time = 0;
  group: THREE.Group | null = null;
  private timers: { t: number; fn: () => void }[] = [];
  /** objects the level added to the scene itself (removed on dispose) */
  protected owned: THREE.Object3D[] = [];
  disposed = false;

  /** Emit geometry and gameplay markers. */
  abstract build(b: GeoBuilder): void;
  /** Called once everything is built: spawn characters, start the opening cutscene. */
  onStart(): void {}
  /** Called every frame while playing. */
  onUpdate(_dt: number): void {}

  update(dt: number) {
    this.time += dt;
    const p = G.player.pos;
    for (const t of this.triggers) {
      if (!t.enabled || (t.once && t.fired)) continue;
      const inside = t.box.containsPoint(p);
      if (inside && !t.inside) {
        t.fired = true;
        t.fn();
      }
      t.inside = inside;
    }
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) {
        this.timers.splice(i, 1);
        if (!this.disposed) tm.fn();
      }
    }
    this.onUpdate(dt);
  }

  /** Game-time timer (pauses with the game, unlike setTimeout). */
  after(seconds: number, fn: () => void) {
    this.timers.push({ t: seconds, fn });
  }

  trigger(min: V3, max: V3, fn: () => void, once = true): Trigger {
    const t: Trigger = { box: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)), once, fired: false, inside: false, fn, enabled: true };
    this.triggers.push(t);
    return t;
  }

  nav(min: V3, max: V3) {
    this.navAreas.push(new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)));
  }

  objective(id: string, text: string) {
    if (this.objectives.find((o) => o.id === id)) return;
    this.objectives.push({ id, text, done: false });
    G.hud.setObjectives(this.title.toUpperCase(), this.objectives, this.objectives.length - 1);
    G.audio.play('objective_new', { bus: 'ui', vol: 0.7 });
  }

  complete(id: string) {
    const o = this.objectives.find((x) => x.id === id);
    if (!o || o.done) return;
    o.done = true;
    G.hud.setObjectives(this.title.toUpperCase(), this.objectives);
    G.audio.play('objective_done', { bus: 'ui', vol: 0.7 });
  }

  isDone(id: string) {
    return !!this.objectives.find((x) => x.id === id)?.done;
  }

  checkpoint(pos: THREE.Vector3 | V3, yaw: number, silent = false) {
    const p = Array.isArray(pos) ? new THREE.Vector3(...pos) : pos.clone();
    G.setCheckpoint(p, yaw, silent);
  }

  dispose() {
    this.disposed = true;
    for (const o of this.owned) o.removeFromParent();
    this.owned.length = 0;
    this.triggers.length = 0;
    this.timers.length = 0;
  }
}
