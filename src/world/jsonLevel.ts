import * as THREE from 'three';
import { G } from '../core/globals';
import { rand } from '../core/math';
import { SKIES } from '../render/sky';
import { Kit } from '../render/kit';
import { PAL } from '../render/toon';
import { levelScale, rollShield, rollWeapon } from '../weapons/items';
import { Locker } from '../loot/loot';
import type { Target } from '../core/types';
import { GeoBuilder } from './builder';
import { BoxCollider } from './collision';
import { Level } from './level';
import { hexToNum, type LAction, type LDestructible, type LevelData, type LObject, type LProp, type LBox, type V3 } from './leveldata';
import { buildProp, PROPS } from './props';
import { emitShape, isShape } from './shapes';
import type { Explodable } from './world';

/** Optional code attached to a level id for things data cannot express (cutscenes, boss phases). */
export interface LevelScript {
  /** return true to take over the opening (the level's `onStart` actions are then yours to run) */
  onStart?(lvl: JsonLevel): boolean | void;
  onUpdate?(lvl: JsonLevel, dt: number): void;
  hooks?: Record<string, (lvl: JsonLevel) => void>;
}

export const SCRIPTS: Record<string, LevelScript> = {};

const _v = new THREE.Vector3();
const UPQ = new THREE.Quaternion();

/** A piece of scenery that can be removed while the level runs (gates, barricades). */
class DynamicObject {
  readonly group: THREE.Group;
  readonly box: BoxCollider;
  removed = false;

  constructor(
    readonly def: LBox | LProp,
    size: V3,
  ) {
    const b = new GeoBuilder();
    emitShape(b, { ...def, dynamic: false } as LObject);
    const built = b.build();
    this.group = built.group;
    built.collision.dispose();
    G.scene.add(this.group);
    const rot = def.rot ?? [0, 0, 0];
    this.box = new BoxCollider(size[0] / 2, size[1] / 2, size[2] / 2);
    const cy = def.type === 'prop' ? def.pos[1] + size[1] / 2 : def.pos[1];
    this.box.set(_v.set(def.pos[0], cy, def.pos[2]), UPQ.setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')));
    G.col.addBox(this.box);
  }

  remove(boom: boolean) {
    if (this.removed) return;
    this.removed = true;
    this.group.removeFromParent();
    G.col.removeBox(this.box);
    if (boom) {
      const p = new THREE.Vector3(this.def.pos[0], this.def.pos[1] + 1.5, this.def.pos[2]);
      G.fx.explosion(p, 5, false, 'none');
      G.audio.play('gate_open', { pos: p, vol: 1, ref: 14 });
      G.player.shakeFrom(p, 0.6, 40);
    }
  }
  dispose() {
    this.group.removeFromParent();
  }
}

/** Breakable mission object: takes damage, then runs its actions. */
class Destructible implements Explodable {
  readonly group: THREE.Group;
  readonly box: BoxCollider;
  readonly pos = new THREE.Vector3();
  hp: number;
  dead = false;

  constructor(
    readonly def: LDestructible,
    private lvl: JsonLevel,
  ) {
    const prop = PROPS[def.prop] ?? PROPS.coupling;
    const b = new GeoBuilder();
    buildProp(b, prop.id, def.pos, def.rot ?? [0, 0, 0]);
    const built = b.build();
    built.collision.dispose();
    this.group = built.group;
    G.scene.add(this.group);
    this.hp = (def.hp ?? 60) * levelScale(G.enemyLevel);
    const s = prop.size;
    this.pos.set(def.pos[0], def.pos[1] + s[1] / 2, def.pos[2]);
    this.box = new BoxCollider(s[0] / 2, s[1] / 2, s[2] / 2);
    this.box.setYaw(this.pos.x, this.pos.y, this.pos.z, def.rot?.[1] ?? 0);
    this.box.owner = this;
    G.col.addBox(this.box);
    G.world.explodables.push(this);
  }

  /** bullets and melee land here via the collider's owner hook */
  onShot(damage: number, _by: Target | null) {
    if (this.def.by === 'explosion') {
      G.audio.play('barrel_hit', { pos: this.pos, vol: 0.6, pitchVar: 0.1 });
      return;
    }
    this.hurt(damage);
  }
  onExplosion(_c: THREE.Vector3, _r: number, damage: number) {
    this.hurt(damage * 1.5);
  }
  private hurt(d: number) {
    if (this.dead) return;
    this.hp -= d;
    if (this.hp > 0) return;
    this.dead = true;
    G.fx.explosion(this.pos, 3.5, true, 'shock');
    G.audio.play('explosion_small', { pos: this.pos, vol: 1, ref: 12 });
    G.fx.scrap(this.pos, PAL.smile, 10);
    this.group.removeFromParent();
    G.col.removeBox(this.box);
    G.world.remove(G.world.explodables, this as Explodable);
    this.lvl.runActions(this.def.actions ?? []);
  }
  dispose() {
    this.group.removeFromParent();
  }
}

let barrelGeo: THREE.BufferGeometry | null = null;

/** The classic: shoot it and it blows up. */
class ExplosiveBarrel implements Explodable {
  readonly mesh: THREE.Mesh;
  readonly box: BoxCollider;
  readonly pos = new THREE.Vector3();
  hp = 26;
  dead = false;
  private fuse = -1;

  constructor(p: V3) {
    if (!barrelGeo) {
      const k = new Kit();
      k.cyl(0.31, 0.31, 0.92, 0xc8402a, [0, 0.46, 0], 'y', 10);
      k.cyl(0.325, 0.325, 0.05, 0x7a2418, [0, 0.3, 0], 'y', 10);
      k.cyl(0.325, 0.325, 0.05, 0x7a2418, [0, 0.64, 0], 'y', 10);
      k.box(0.3, 0.26, 0.02, PAL.smile, [0, 0.47, 0.31]);
      k.box(0.3, 0.26, 0.02, PAL.smile, [0, 0.47, -0.31]);
      k.box(0.1, 0.16, 0.025, PAL.screen, [0, 0.47, 0.31]);
      k.box(0.1, 0.16, 0.025, PAL.screen, [0, 0.47, -0.31]);
      k.cyl(0.05, 0.05, 0.04, 0x2a2c34, [0.14, 0.94, 0], 'y', 6);
      barrelGeo = k.geometry();
    }
    this.mesh = new THREE.Mesh(barrelGeo, G.mat.prop);
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.position.set(p[0], p[1], p[2]);
    G.scene.add(this.mesh);
    this.pos.set(p[0], p[1] + 0.46, p[2]);
    this.box = new BoxCollider(0.31, 0.46, 0.31);
    this.box.setYaw(this.pos.x, this.pos.y, this.pos.z, 0);
    this.box.owner = this;
    G.col.addBox(this.box);
    G.world.explodables.push(this);
    G.world.add(this);
  }
  onShot(damage: number) {
    if (this.dead) return;
    this.hp -= damage;
    G.audio.play('barrel_hit', { pos: this.pos, vol: 0.7, pitchVar: 0.1 });
    if (this.hp <= 0 && this.fuse < 0) this.fuse = 0.06;
    else if (this.fuse < 0 && this.hp < 14) {
      // punctured: a short hissing fuse
      this.fuse = 1.4;
      G.audio.play('fire_ignite', { pos: this.pos, vol: 0.7 });
    }
  }
  onExplosion() {
    if (!this.dead && this.fuse < 0) this.fuse = rand(0.08, 0.22);
  }
  update(dt: number) {
    if (this.dead || this.fuse < 0) return;
    this.fuse -= dt;
    if (Math.random() < dt * 20) G.fx.puff(_v.copy(this.pos).setY(this.pos.y + 0.5), new THREE.Vector3(rand(-0.3, 0.3), 1.6, rand(-0.3, 0.3)), 0.35, 0.06, 0.16, 0xffe06a, PAL.fire, -1, 1);
    if (this.fuse <= 0) {
      this.dead = true;
      this.mesh.removeFromParent();
      G.col.removeBox(this.box);
      G.world.remove(G.world.explodables, this as Explodable);
      // credited to the player so chain kills count and allies are spared
      G.world.explode(this.pos, 5.5, 130 * levelScale(G.enemyLevel), G.player, { element: 'fire' });
    }
  }
  dispose() {
    this.mesh.removeFromParent();
  }
}

/** A level loaded from a level file. */
export class JsonLevel extends Level {
  readonly id: string;
  readonly title: string;
  readonly number: string;
  readonly markers = new Map<string, { pos: THREE.Vector3; yaw: number }>();
  private byName = new Map<string, LObject>();
  private dynamics = new Map<string, DynamicObject>();
  private extras: { dispose(): void }[] = [];
  private counters = new Map<string, number>();
  private spawnedTags = new Set<string>();
  private pendingTags = new Set<string>();
  private firedWatchers = new Set<number>();
  private hudMarkers = new Map<string, unknown>();
  private namedTriggers = new Map<string, { enabled: boolean }>();
  private allDeadDone = false;
  private anyEnemies = false;
  ended = false;
  script: LevelScript | undefined;

  constructor(readonly data: LevelData) {
    super();
    this.id = data.id;
    this.title = data.title;
    this.number = data.number;
    this.sky = SKIES[data.sky] ?? SKIES.dawn;
    this.killY = data.killY ?? -40;
    this.enemyLevel = data.enemyLevel ?? 1;
    this.music = data.music ?? null;
    this.spawn.pos.set(...data.spawn.pos);
    this.spawn.yaw = data.spawn.yaw;
    this.script = SCRIPTS[data.id];
    for (const o of data.objects) if (o.name) this.byName.set(o.name, o);
  }

  build(b: GeoBuilder) {
    const min = new THREE.Vector3(1e9, 1e9, 1e9);
    const max = new THREE.Vector3(-1e9, -1e9, -1e9);
    let navs = 0;
    for (const o of this.data.objects) {
      if (isShape(o) && !(o as LBox).dynamic) emitShape(b, o);
      if (o.type === 'nav') {
        const h = o.size;
        this.nav([o.pos[0] - h[0] / 2, o.pos[1] - h[1] / 2, o.pos[2] - h[2] / 2], [o.pos[0] + h[0] / 2, o.pos[1] + h[1] / 2, o.pos[2] + h[2] / 2]);
        navs++;
      }
      if (o.type === 'marker' && o.name) this.markers.set(o.name, { pos: new THREE.Vector3(...o.pos), yaw: o.rot?.[1] ?? 0 });
      // bounds of everything that characters could stand on
      const s = (o as LBox).size ?? (o.type === 'prop' ? PROPS[o.prop]?.size : undefined) ?? [1, 1, 1];
      const r = Math.max(s[0], s[2]) / 2;
      min.min(_v.set(o.pos[0] - r, o.pos[1] - s[1], o.pos[2] - r));
      max.max(_v.set(o.pos[0] + r, o.pos[1] + s[1], o.pos[2] + r));
    }
    if (navs === 0 && min.x < max.x) {
      // no nav areas authored: cover the whole level (capped so huge maps stay quick to load)
      const cx = (min.x + max.x) / 2;
      const cz = (min.z + max.z) / 2;
      const hx = Math.min(140, (max.x - min.x) / 2);
      const hz = Math.min(140, (max.z - min.z) / 2);
      this.nav([cx - hx, min.y - 1, cz - hz], [cx + hx, max.y + 3, cz + hz]);
    }
  }

  override onStart() {
    for (const o of this.data.objects) this.spawnObject(o, false);
    const handled = this.script?.onStart?.(this);
    if (!handled) this.begin();
  }

  /** Run the level's own opening actions (scripts call this when their intro is over). */
  begin() {
    if (this.music) void G.audio.playMusic(this.music);
    this.runActions(this.data.onStart ?? []);
    if (this.objectives.length === 0 && this.data.winOnAllDead !== false && !this.script && this.anyEnemies) this.objective('__clear', 'Clear out every Associate');
  }

  private spawnObject(o: LObject, fromTag: boolean) {
    const pos = new THREE.Vector3(...o.pos);
    const yaw = o.rot?.[1] ?? 0;
    switch (o.type) {
      case 'box':
      case 'prop':
        if (o.dynamic && !fromTag) {
          const size: V3 = o.type === 'box' ? o.size : ((PROPS[o.prop]?.size ?? [1, 1, 1]).map((v) => v * (o.scale ?? 1)) as V3);
          const d = new DynamicObject(o, size);
          this.dynamics.set(o.name ?? o.id, d);
          this.extras.push(d);
        }
        break;
      case 'enemy': {
        this.anyEnemies = true;
        if (o.tag && !fromTag) {
          this.pendingTags.add(o.tag);
          break;
        }
        G.ai.spawnEnemy(o.kind, pos, { yaw, squad: o.squad, patrol: o.patrol?.map((p) => new THREE.Vector3(...p)), hold: o.hold, level: o.level, tag: o.tag ?? '__base', name: o.name });
        break;
      }
      case 'ally':
        if (o.tag && !fromTag) {
          this.pendingTags.add(o.tag);
          break;
        }
        G.ai.spawnAlly(o.voice, pos, { yaw, essential: o.essential, name: o.name });
        break;
      case 'pickup':
        if (fromTag) break;
        G.loot.spawn(o.kind, pos, { cls: o.cls, amount: o.amount ?? (o.kind === 'health' ? 30 : o.kind === 'mine' ? 2 : o.kind === 'cash' ? 25 : 30), pop: false });
        break;
      case 'weapon': {
        if (fromTag) break;
        const lvl = o.level ?? this.enemyLevel;
        const item = o.shield ? rollShield(lvl, { rarity: o.rarity, brand: o.brand, seed: o.seed }) : rollWeapon(lvl, { cls: o.cls, brand: o.brand, rarity: o.rarity, seed: o.seed });
        const p = G.loot.dropItem(item, pos.clone().setY(pos.y - 0.6), false);
        (p as any).vel.set(0, 0, 0);
        break;
      }
      case 'locker':
        if (!fromTag) new Locker(pos, yaw, o.luck ?? 1, this.enemyLevel);
        break;
      case 'barrel':
        if (!fromTag) this.extras.push(new ExplosiveBarrel(o.pos));
        break;
      case 'vehicle': {
        if (fromTag) break;
        const v = (G as any).vehicles;
        if (!v) break;
        if (o.kind === 'teamster') v.spawnTeamster(pos, yaw);
        else v.spawnVesper(pos, yaw);
        break;
      }
      case 'destructible':
        if (!fromTag) this.extras.push(new Destructible(o, this));
        break;
      case 'trigger': {
        if (fromTag) break;
        const h = o.size;
        const t = this.trigger([o.pos[0] - h[0] / 2, o.pos[1] - h[1] / 2, o.pos[2] - h[2] / 2], [o.pos[0] + h[0] / 2, o.pos[1] + h[1] / 2, o.pos[2] + h[2] / 2], () => this.runActions(o.actions), o.once !== false);
        t.enabled = !o.disabled;
        if (o.name) this.namedTriggers.set(o.name, t);
        break;
      }
      case 'checkpoint': {
        if (fromTag) break;
        const h = o.size;
        this.trigger([o.pos[0] - h[0] / 2, o.pos[1] - h[1] / 2 - 1, o.pos[2] - h[2] / 2], [o.pos[0] + h[0] / 2, o.pos[1] + h[1] / 2 + 2, o.pos[2] + h[2] / 2], () => this.checkpoint(pos, yaw));
        break;
      }
    }
  }

  /** Bring in every enemy/ally carrying this tag. */
  spawnTag(tag: string) {
    if (this.spawnedTags.has(tag)) return;
    this.spawnedTags.add(tag);
    this.pendingTags.delete(tag);
    for (const o of this.data.objects) if ((o.type === 'enemy' || o.type === 'ally') && o.tag === tag) this.spawnObject(o, true);
  }

  marker(name: string) {
    return this.markers.get(name) ?? null;
  }

  removeObject(name: string, boom = false) {
    this.dynamics.get(name)?.remove(boom);
  }

  /** Run a list of actions in order; `wait` pauses the rest of the list (in game time). */
  runActions(actions: LAction[], from = 0) {
    for (let i = from; i < actions.length; i++) {
      const a = actions[i];
      switch (a.do) {
        case 'spawn':
          this.spawnTag(a.tag);
          break;
        case 'say':
          void G.audio.say(a.line);
          break;
        case 'objective':
          this.objective(a.id, a.text);
          break;
        case 'complete':
          this.complete(a.id);
          break;
        case 'toast':
          G.hud.toast(a.text, 2.4, '#ffd21f');
          break;
        case 'music':
          void G.audio.playMusic(a.track);
          break;
        case 'checkpoint':
          this.checkpoint(G.player.pos, G.player.yaw);
          break;
        case 'enable':
        case 'disable': {
          const t = this.namedTriggers.get(a.target);
          if (t) t.enabled = a.do === 'enable';
          break;
        }
        case 'remove':
          this.removeObject(a.target, !!a.boom);
          break;
        case 'marker': {
          const o = this.byName.get(a.target);
          if (o && !this.hudMarkers.has(a.target)) this.hudMarkers.set(a.target, G.hud.addMarker(new THREE.Vector3(o.pos[0], o.pos[1] + 1.6, o.pos[2]), a.label));
          break;
        }
        case 'unmark': {
          const m = this.hudMarkers.get(a.target);
          if (m) G.hud.removeMarker(m as any);
          this.hudMarkers.delete(a.target);
          break;
        }
        case 'count': {
          const n = (this.counters.get(a.id) ?? 0) + 1;
          this.counters.set(a.id, n);
          if (n === a.need) this.runActions(a.then);
          break;
        }
        case 'wait':
          this.after(a.seconds, () => this.runActions(actions, i + 1));
          return;
        case 'script':
          this.script?.hooks?.[a.name]?.(this);
          break;
        case 'end':
          this.finish();
          break;
      }
    }
  }

  counter(id: string) {
    return this.counters.get(id) ?? 0;
  }

  finish() {
    if (this.ended) return;
    this.ended = true;
    G.events.emit('missionComplete', { level: this });
  }

  override onUpdate(dt: number) {
    this.script?.onUpdate?.(this, dt);
    const ws = this.data.watchers;
    if (ws) {
      for (let i = 0; i < ws.length; i++) {
        if (this.firedWatchers.has(i)) continue;
        const w = ws[i];
        const tag = w.allDead;
        const spawned = tag === '__base' || this.spawnedTags.has(tag);
        if (spawned && G.ai.aliveWithTag(tag) === 0) {
          this.firedWatchers.add(i);
          this.runActions(w.actions);
        }
      }
    }
    if (!this.allDeadDone && this.anyEnemies && this.data.winOnAllDead !== false && !this.script && this.time > 1 && this.pendingTags.size === 0 && G.ai.aliveEnemies() === 0) {
      this.allDeadDone = true;
      this.complete('__clear');
      if (this.objectives.every((o) => o.done)) this.after(2.5, () => this.finish());
    }
  }

  override dispose() {
    super.dispose();
    for (const e of this.extras) e.dispose();
    this.extras.length = 0;
  }
}
