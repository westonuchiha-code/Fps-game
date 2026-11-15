import * as THREE from 'three';
import { G } from '../core/globals';
import { angleDelta, clamp, damp, dirToYaw, rand, yawToDir } from '../core/math';
import { hostile, newId, type DamageInfo, type Element, type Faction, type HitZone, type Target } from '../core/types';
import { ELEMENT_COLORS, PAL } from '../render/toon';
import { levelScale } from '../weapons/items';
import type { Listener, NoiseKind, Shootable, WorldHit } from '../world/world';
import { rayCapsule, raySphere } from '../world/world';
import { B, CharAnim, CharModel, PALETTES, type CharKind } from './charModel';
import { Brain } from './brain';

export interface NpcDef {
  kind: CharKind;
  label: string;
  faction: Faction;
  hp: number;
  shield: number;
  walk: number;
  run: number;
  /** damage per bolt at level 1 */
  dmg: number;
  burst: [number, number];
  shotGap: number;
  pause: [number, number];
  boltSpeed: number;
  boltColor: number;
  range: number;
  /** aim error in degrees: when first engaging / once settled */
  err0: number;
  err1: number;
  view: number;
  turn: number;
  voice: string;
  /** loot tier: 0 grunt, 1 elite, 2 boss; -1 drops nothing */
  tier: number;
  melee: { dmg: number; range: number } | null;
  /** explosive bolt radius (0 = normal) */
  blast: number;
  /** element resistance profile */
  armor: 'soft' | 'armored';
  radius: number;
  mass: number;
}

export const NPC_DEFS: Record<string, NpcDef> = {
  assoc: {
    kind: 'assoc', label: 'Associate', faction: 'monomart', hp: 85, shield: 0, walk: 1.5, run: 4.4, dmg: 6, burst: [3, 4], shotGap: 0.15, pause: [1.0, 1.9], boltSpeed: 52, boltColor: 0xffe36a,
    range: 46, err0: 5.5, err1: 2.6, view: 55, turn: 6, voice: 'assoc', tier: 0, melee: null, blast: 0, armor: 'soft', radius: 0.38, mass: 1,
  },
  super: {
    kind: 'super', label: 'Supervisor', faction: 'monomart', hp: 130, shield: 110, walk: 1.7, run: 5.2, dmg: 10, burst: [4, 6], shotGap: 0.12, pause: [0.7, 1.3], boltSpeed: 60, boltColor: 0xff8a3c,
    range: 50, err0: 4.2, err1: 1.6, view: 62, turn: 7, voice: 'super', tier: 1, melee: { dmg: 28, range: 2.3 }, blast: 0, armor: 'soft', radius: 0.42, mass: 1.4,
  },
  manager: {
    kind: 'manager', label: 'Regional Manager', faction: 'monomart', hp: 2400, shield: 0, walk: 1.5, run: 2.5, dmg: 30, burst: [3, 3], shotGap: 0.42, pause: [2.4, 3.4], boltSpeed: 30, boltColor: 0xff7b1c,
    range: 80, err0: 3, err1: 1.4, view: 90, turn: 1.15, voice: 'manager', tier: 2, melee: { dmg: 32, range: 5.5 }, blast: 3.4, armor: 'armored', radius: 1.05, mass: 30,
  },
  striker: {
    kind: 'striker', label: 'Striker', faction: 'union', hp: 320, shield: 0, walk: 1.7, run: 5.6, dmg: 11, burst: [3, 5], shotGap: 0.13, pause: [0.5, 1.1], boltSpeed: 90, boltColor: 0xfff0a8,
    range: 55, err0: 4, err1: 1.8, view: 70, turn: 8, voice: 'hank', tier: -1, melee: null, blast: 0, armor: 'soft', radius: 0.38, mass: 1,
  },
};

export interface NpcOpts {
  yaw?: number;
  squad?: string;
  patrol?: THREE.Vector3[];
  hold?: boolean;
  level?: number;
  tag?: string;
  name?: string;
  voice?: string;
  essential?: boolean;
  variant?: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muz = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

interface Chunk {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  floor: number;
  dead?: boolean;
  update(dt: number): void;
}
const chunks: Chunk[] = [];

/** Robot falls to bits: every body part becomes a bouncing piece of scrap. */
function shatter(model: CharModel, origin: THREE.Vector3, impulse: THREE.Vector3, floor: number) {
  for (const part of model.parts()) {
    const mesh = new THREE.Mesh(part.geo, G.mat.prop);
    mesh.matrix.copy(part.matrix);
    mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.castShadow = true;
    G.scene.add(mesh);
    const c: Chunk = {
      mesh,
      vel: new THREE.Vector3(rand(-3, 3), rand(2, 6.5), rand(-3, 3)).add(impulse),
      spin: new THREE.Vector3(rand(-7, 7), rand(-7, 7), rand(-7, 7)),
      life: rand(5, 8),
      floor,
      update(dt: number) {
        this.life -= dt;
        if (this.life <= 0) {
          this.dead = true;
          this.mesh.removeFromParent();
          return;
        }
        if (this.life < 0.6) this.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 3));
        this.vel.y -= 18 * dt;
        this.mesh.position.addScaledVector(this.vel, dt);
        // pieces rest roughly where their bone was above the floor
        const rest = this.floor + 0.12;
        if (this.mesh.position.y < rest) {
          this.mesh.position.y = rest;
          if (this.vel.y < -2) {
            this.vel.y *= -0.32;
            this.vel.x *= 0.55;
            this.vel.z *= 0.55;
            this.spin.multiplyScalar(0.5);
          } else {
            this.vel.set(0, 0, 0);
            this.spin.set(0, 0, 0);
          }
        }
        this.mesh.rotation.x += this.spin.x * dt;
        this.mesh.rotation.y += this.spin.y * dt;
        this.mesh.rotation.z += this.spin.z * dt;
      },
    };
    G.world.add(c);
    chunks.push(c);
  }
  // keep the scrap heap bounded
  while (chunks.length > 110) {
    const old = chunks.shift()!;
    old.dead = true;
    old.mesh.removeFromParent();
  }
  void origin;
}

/** A walking character: enemy robot or allied Striker. */
export class Npc implements Target, Shootable, Listener {
  readonly id = newId();
  readonly def: NpcDef;
  readonly model: CharModel;
  readonly anim: CharAnim;
  readonly brain: Brain;
  faction: Faction;
  alive = true;
  dead = false;
  label: string;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  radius: number;
  height: number;
  yaw = 0;
  health: number;
  maxHealth: number;
  shield: number;
  shieldMax: number;
  private shieldTimer = 0;
  level: number;
  dmgScale: number;
  tag: string;
  squad: string;
  name: string;
  voice: string;
  voicePitch = 1;
  essential: boolean;
  /** seconds left lying down before an essential ally gets back up */
  downed = 0;
  taggedUntil = 0;

  // ---- movement ----
  path: THREE.Vector3[] | null = null;
  private pathI = 0;
  moveSpeed = 0;
  arrived = true;
  private stuckT = 0;
  private repathT = 0;
  /** where the body should face; brain sets one of these */
  faceYaw: number | null = null;
  // ---- combat ----
  wantFire = false;
  aimPoint3 = new THREE.Vector3();
  private burstLeft = 0;
  private shotT = 0;
  private pauseT = rand(0.2, 1);
  focus = 0;
  crouching = false;
  private flinchT = 0;
  private dotT = 0;
  private dotDps = 0;
  private dotEl: Element = 'none';
  private dotTick = 0;
  private dotSrc: Target | null = null;
  stunT = 0;
  private deathT = 0;
  private corpseT = 0;
  private stepAcc = 0;
  /** vehicle seat this character is riding in */
  seat: THREE.Object3D | null = null;
  private lastBarkHurt = 0;
  // Shootable
  readonly boundPos = new THREE.Vector3();
  boundRadius: number;
  readonly owner: Target = this;

  constructor(kind: string, pos: THREE.Vector3, o: NpcOpts = {}) {
    const def = (this.def = NPC_DEFS[kind]);
    this.faction = def.faction;
    this.label = def.label;
    this.level = o.level ?? G.enemyLevel;
    const ls = levelScale(this.level);
    const hpK = def.faction === 'monomart' ? G.difficulty.enemyHealth : 1;
    this.maxHealth = this.health = Math.round(def.hp * ls * hpK);
    this.shieldMax = this.shield = Math.round(def.shield * ls * hpK);
    this.dmgScale = ls;
    this.radius = def.radius;
    this.tag = o.tag ?? '';
    this.squad = o.squad ?? '';
    this.name = o.name ?? '';
    this.voice = o.voice ?? def.voice;
    this.voicePitch = def.kind === 'assoc' ? rand(0.9, 1.14) : 1;
    this.essential = !!o.essential;
    this.model = new CharModel(def.kind, PALETTES[def.kind], o.variant ?? (this.id % 3));
    this.anim = new CharAnim(this.model);
    this.height = this.model.height;
    this.boundRadius = this.height * 0.75;
    this.pos.copy(pos);
    this.yaw = o.yaw ?? 0;
    this.model.root.position.copy(pos);
    this.model.root.rotation.y = this.yaw;
    G.scene.add(this.model.root);
    this.brain = new Brain(this, o);
    G.world.targets.push(this);
    G.world.shootables.push(this);
    G.world.listeners.push(this);
  }

  // ------------------------------------------------------------------ Target

  aimPoint(out: THREE.Vector3) {
    return out.set(this.pos.x, this.pos.y + this.height * (this.crouching ? 0.42 : 0.66), this.pos.z);
  }
  headPoint(out: THREE.Vector3) {
    return this.model.bonePos(B.head, out).setY(out.y + 0.14 * this.model.spec.scale);
  }
  eyePos(out: THREE.Vector3) {
    return out.set(this.pos.x, this.pos.y + this.height * (this.crouching ? 0.55 : 0.9), this.pos.z);
  }

  // ------------------------------------------------------------------ Shootable

  rayHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { zone?: HitZone; onHit?: WorldHit['onHit']; normal: THREE.Vector3 }) {
    if (!this.alive) return -1;
    const sc = this.model.spec.scale;
    const mech = this.def.kind === 'manager';
    let best = -1;
    let zone: HitZone = 'body';
    // head
    this.headPoint(_v);
    const hr = (mech ? 0.5 : 0.19) * sc;
    const dh = raySphere(origin, dir, _v, hr);
    if (dh >= 0 && dh <= maxDist) {
      best = dh;
      zone = mech ? 'body' : 'head';
    }
    // body capsule
    const top = this.model.bonePos(B.head, _b);
    top.y -= mech ? 0.5 : 0.12;
    _a.set(this.pos.x, this.pos.y + this.radius * 0.9, this.pos.z);
    if (top.y < _a.y + 0.1) top.y = _a.y + 0.1;
    top.x = this.pos.x;
    top.z = this.pos.z;
    const db = rayCapsule(origin, dir, _a, top, this.radius * (mech ? 0.95 : 0.82));
    if (db >= 0 && db <= maxDist && (best < 0 || db < best)) {
      best = db;
      const hy = origin.y + dir.y * db;
      zone = hy < this.pos.y + this.height * 0.42 ? 'legs' : 'body';
      if (mech) {
        // armoured from the front, soft cooling unit on the back
        yawToDir(this.yaw, _v2);
        const fromFront = dir.x * _v2.x + dir.z * _v2.z; // >0: shot travels the way the mech faces = hit in the back
        zone = fromFront > 0.35 && hy > this.pos.y + 1.6 ? 'weak' : fromFront < -0.1 && hy > this.pos.y + 1.4 ? 'armor' : 'body';
      }
    }
    if (best < 0) return -1;
    out.zone = zone;
    out.normal.copy(dir).negate();
    return best;
  }

  // ------------------------------------------------------------------ Listener

  hear(pos: THREE.Vector3, kind: NoiseKind, source: Target | null, loud: number) {
    if (!this.alive) return;
    this.brain.onNoise(pos, kind, source, loud);
  }

  // ------------------------------------------------------------------ damage

  takeDamage(d: DamageInfo) {
    if (!this.alive) return;
    const src = d.source;
    if (src && src !== this && !hostile(src.faction, this.faction)) return;
    let amount = d.amount;
    const zone = d.zone ?? 'body';
    if (zone === 'legs') amount *= 0.85;
    if (zone === 'armor') amount *= d.element === 'acid' ? 0.6 : 0.28;
    if (this.taggedUntil > G.time) amount *= 1.3;
    const fromPlayer = src === G.player;
    let shieldBroke = false;
    if (this.shield > 0 && d.kind !== 'dot') {
      const mult = d.element === 'shock' ? 1.7 : d.element === 'fire' ? 0.65 : 1;
      const absorbed = Math.min(this.shield, amount * mult);
      this.shield -= absorbed;
      amount -= absorbed / mult;
      this.shieldTimer = 4.2;
      if (fromPlayer) G.hud.damageNumber(d.point, absorbed, false, 'shock', true);
      G.fx.shieldHit(d.point);
      G.audio.play('impact_shield', { pos: d.point, vol: 0.6, pitchVar: 0.1 });
      if (this.shield <= 0.5) {
        this.shield = 0;
        shieldBroke = true;
        G.audio.play('enemy_shield_break', { pos: this.pos, vol: 0.9 });
        this.stunT = Math.max(this.stunT, 0.7);
        this.bark('shield', 9);
      }
      if (this.model.shield) (this.model.shield.material as THREE.MeshBasicMaterial).opacity = 0.55;
    }
    if (amount > 0.01) {
      // elemental match-ups
      if (d.element === 'fire') amount *= this.def.armor === 'soft' ? 1.25 : 0.75;
      else if (d.element === 'acid') amount *= this.def.armor === 'armored' ? 1.45 : 0.9;
      else if (d.element === 'shock') amount *= 0.85;
      this.health -= amount;
      if (fromPlayer) {
        G.hud.damageNumber(d.point, amount, d.crit, d.element);
        if (d.crit) G.stats.crits++;
      }
      if (d.kind !== 'dot') {
        if (this.def.faction === 'monomart') G.fx.robotHit(d.point, d.dir, d.crit, d.element);
        else G.audio.play('impact_flesh', { pos: d.point, vol: 0.5, pitchVar: 0.1 });
        if (this.def.faction === 'monomart') G.audio.play('impact_robot', { pos: d.point, vol: d.crit ? 0.8 : 0.5, pitchVar: 0.12 });
      }
      // stagger
      if (d.kind !== 'dot' && this.def.kind !== 'manager') {
        this.anim.flinch = Math.min(1, this.anim.flinch + clamp(amount / (this.maxHealth * 0.25), 0.25, 1));
        this.anim.flinchSide = rand(-1, 1);
        this.flinchT = 0.35;
        if (amount > this.maxHealth * 0.3 || d.kind === 'melee') this.stunT = Math.max(this.stunT, 0.45);
        if (d.impulse) {
          this.vel.x += d.dir.x * d.impulse / this.def.mass;
          this.vel.z += d.dir.z * d.impulse / this.def.mass;
        }
      }
      if (d.statusChance && d.element !== 'none' && Math.random() < d.statusChance) {
        this.dotT = d.element === 'acid' ? 5 : 3;
        this.dotDps = Math.max(this.dotDps, d.statusDps ?? amount * 0.4);
        this.dotEl = d.element;
        this.dotSrc = src;
        if (d.element === 'shock') this.stunT = Math.max(this.stunT, 0.5);
      }
    }
    if (fromPlayer && d.kind !== 'dot') G.hud.hitmarker(d.crit, this.health <= 0);
    if (this.health <= 0) {
      this.die(d);
      return;
    }
    if (d.kind !== 'dot') {
      this.model.setMood('hurt');
      if (G.time - this.lastBarkHurt > 3 && Math.random() < 0.35) {
        this.lastBarkHurt = G.time;
        this.bark(zone === 'weak' ? 'back' : 'hurt', 5);
      }
      this.brain.onDamaged(d, shieldBroke);
    }
  }

  private die(d: DamageInfo) {
    const byPlayer = d.source === G.player;
    if (this.essential) {
      // named allies go down, catch their breath, and get back up
      this.alive = false;
      this.downed = 11;
      this.health = 0;
      this.path = null;
      this.bark('hurt', 2, true);
      return;
    }
    this.alive = false;
    this.dead = true;
    this.model.setMood('dead');
    this.path = null;
    G.nav.release(this.id);
    G.world.remove(G.world.targets, this as Target);
    G.world.remove(G.world.shootables, this as Shootable);
    G.world.remove(G.world.listeners, this as Listener);
    const robot = this.faction === 'monomart';
    if (byPlayer || (d.source && d.source.faction === 'union')) {
      if (robot) {
        G.stats.kills++;
        if (d.kind === 'explosion') G.stats.mineKills++;
        if (d.kind === 'vehicle') G.stats.roadkills++;
      }
    }
    if (robot && this.def.tier >= 0) G.loot.enemyDrop(this.pos, this.level, this.def.tier);
    if (Math.random() < 0.55) this.bark('death', 0, true);
    G.audio.play(robot ? 'robot_death' : 'player_hurt', { pos: this.pos, vol: 0.8, pitchVar: 0.1, ref: 6 });
    const overkill = d.kind === 'explosion' || d.kind === 'vehicle' || d.crit || d.amount > this.maxHealth * 0.45 || Math.random() < 0.3;
    if (robot && (overkill || this.def.kind === 'manager')) {
      const imp = _v.copy(d.dir).multiplyScalar(d.kind === 'explosion' ? 5 : 2.5);
      imp.y += d.kind === 'explosion' ? 4 : 1;
      this.model.root.updateMatrixWorld(true);
      shatter(this.model, this.pos, imp, this.pos.y);
      G.fx.scrap(this.aimPoint(_v2), this.model.pal.shell, this.def.kind === 'manager' ? 22 : 7);
      G.audio.play('robot_explode', { pos: this.pos, vol: 0.9, pitchVar: 0.1, ref: 7 });
      if (this.def.kind === 'manager') {
        G.fx.explosion(this.aimPoint(_v2), 7, false, 'fire');
        G.audio.play('explosion_big', { pos: this.pos, vol: 1, ref: 20 });
        G.player.shakeFrom(this.pos, 0.9, 60);
      }
      this.model.root.visible = false;
      this.corpseT = 0.1;
    } else {
      this.anim.deadSide = Math.random() < 0.5 ? 1 : -1;
      this.corpseT = 9;
    }
    this.brain.onDeath(d);
    G.events.emit('npcKilled', { npc: this, by: d.source, info: d });
  }

  /** Speak a line from this character's bark set (rate limited by the audio system). */
  bark(group: string, cooldown = 6, force = false) {
    const voice = this.def.kind === 'striker' ? this.voice : this.def.voice;
    return G.audio.bark(voice, group, this.headPoint(_v), { pitch: this.voicePitch, cooldown, force });
  }

  // ------------------------------------------------------------------ movement

  /** Walk/run to a point along the nav mesh. Returns false if there is no route. */
  goTo(target: THREE.Vector3, speed: number): boolean {
    const p = G.nav.findPath(this.pos, target);
    if (!p || p.length === 0) {
      this.path = null;
      this.arrived = true;
      return false;
    }
    this.path = p;
    this.pathI = 0;
    this.moveSpeed = speed;
    this.arrived = false;
    this.stuckT = 0;
    return true;
  }
  stop() {
    this.path = null;
    this.arrived = true;
  }
  get moving() {
    return !!this.path;
  }

  private move(dt: number) {
    let dvx = 0;
    let dvz = 0;
    if (this.path && this.stunT <= 0) {
      const wp = this.path[this.pathI];
      let dx = wp.x - this.pos.x;
      let dz = wp.z - this.pos.z;
      let d = Math.hypot(dx, dz);
      const last = this.pathI === this.path.length - 1;
      if (d < (last ? 0.22 : 0.5)) {
        this.pathI++;
        if (this.pathI >= this.path.length) {
          this.path = null;
          this.arrived = true;
        } else {
          const n = this.path[this.pathI];
          dx = n.x - this.pos.x;
          dz = n.z - this.pos.z;
          d = Math.hypot(dx, dz);
        }
      }
      if (this.path && d > 1e-3) {
        const sp = last ? Math.min(this.moveSpeed, 1.5 + d * 4) : this.moveSpeed;
        dvx = (dx / d) * sp;
        dvz = (dz / d) * sp;
      }
    }
    // keep a little personal space
    for (const o of G.ai.npcs) {
      if (o === this || !o.alive) continue;
      const ox = this.pos.x - o.pos.x;
      const oz = this.pos.z - o.pos.z;
      const d2 = ox * ox + oz * oz;
      const min = this.radius + o.radius + 0.25;
      if (d2 < min * min && d2 > 1e-4 && Math.abs(this.pos.y - o.pos.y) < 1.5) {
        const d = Math.sqrt(d2);
        const push = ((min - d) / min) * 2.2;
        dvx += (ox / d) * push;
        dvz += (oz / d) * push;
      }
    }
    this.vel.x = damp(this.vel.x, dvx, 9, dt);
    this.vel.z = damp(this.vel.z, dvz, 9, dt);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp < 0.02) return;
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    const nav = G.nav;
    let h = nav.heightAt(nx, this.pos.y, nz);
    let px = nx;
    let pz = nz;
    if (h === null) {
      // slide along the edge of the walkable area
      h = nav.heightAt(nx, this.pos.y, this.pos.z);
      if (h !== null) pz = this.pos.z;
      else {
        h = nav.heightAt(this.pos.x, this.pos.y, nz);
        if (h !== null) px = this.pos.x;
      }
    }
    if (h === null) {
      this.vel.x = this.vel.z = 0;
      this.stuckT += dt;
    } else {
      const moved = Math.hypot(px - this.pos.x, pz - this.pos.z);
      this.pos.x = px;
      this.pos.z = pz;
      this.pos.y = damp(this.pos.y, h, 16, dt);
      if (this.path && moved < this.moveSpeed * dt * 0.25) this.stuckT += dt;
      else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    }
    if (this.stuckT > 1.2 && this.path) {
      // blocked: try a fresh route to the same place, give up if that fails too
      const goal = this.path[this.path.length - 1];
      this.stuckT = 0;
      this.repathT += 1;
      if (this.repathT > 2 || !this.goTo(goal, this.moveSpeed)) {
        this.stop();
        this.repathT = 0;
      }
    }
  }

  // ------------------------------------------------------------------ firing

  private fire(dt: number) {
    const def = this.def;
    if (!this.wantFire || this.stunT > 0) {
      this.burstLeft = 0;
      this.pauseT = Math.max(this.pauseT, 0.15);
      return;
    }
    this.pauseT -= dt;
    if (this.burstLeft <= 0) {
      if (this.pauseT > 0) return;
      // need a firing slot before opening up on the player
      if (!G.ai.requestToken(this)) {
        this.pauseT = 0.3;
        return;
      }
      this.burstLeft = Math.round(rand(def.burst[0], def.burst[1]));
      this.shotT = def.kind === 'manager' ? 0.9 : 0;
      if (def.kind === 'manager') G.audio.play('enemy_charge', { pos: this.pos, vol: 1, ref: 16 });
      if (Math.random() < 0.25) this.bark('attack', 9);
    }
    this.shotT -= dt;
    if (this.shotT > 0) return;
    this.shotT = def.shotGap;
    this.burstLeft--;
    if (this.burstLeft <= 0) {
      this.pauseT = rand(def.pause[0], def.pause[1]);
      G.ai.releaseToken(this);
    }
    // muzzle + aim with error
    this.model.root.updateMatrixWorld(true);
    this.model.muzzle.getWorldPosition(_muz);
    const aimK = this.faction === 'monomart' ? 1 / G.difficulty.enemyAim : 1;
    const moving = Math.hypot(this.vel.x, this.vel.z) > 1 ? 1.5 : 1;
    const err = (def.err0 + (def.err1 - def.err0) * this.focus) * aimK * moving * (Math.PI / 180);
    _dir.copy(this.aimPoint3).sub(_muz);
    const dist = _dir.length();
    _dir.multiplyScalar(1 / Math.max(dist, 1e-3));
    // random offset inside the error cone
    const a = Math.random() * Math.PI * 2;
    const r = Math.tan(err) * Math.sqrt(Math.random());
    _v.crossVectors(_dir, UP).normalize();
    _v2.crossVectors(_v, _dir);
    _dir.addScaledVector(_v, Math.cos(a) * r).addScaledVector(_v2, Math.sin(a) * r).normalize();
    const dmg = def.dmg * this.dmgScale;
    G.projectiles.fire(this, _muz, _dir, def.boltSpeed, dmg, { color: def.boltColor, radius: def.blast, size: def.blast ? 0.26 : def.kind === 'striker' ? 0.05 : 0.08 });
    G.fx.muzzle(_muz, _dir, def.boltColor, def.blast ? 1.2 : 0.4);
    G.audio.play(def.blast ? 'enemy_heavy_cannon' : def.kind === 'striker' ? 'rifle_fire' : 'enemy_blaster', { pos: _muz, vol: def.kind === 'striker' ? 0.55 : 0.75, pitchVar: 0.08, ref: 7, wet: 0.25, pitch: def.kind === 'super' ? 0.85 : 1 });
    this.anim.kick = 1;
    G.world.noise(this.pos, 40, 'gunshot', this);
  }

  // ------------------------------------------------------------------ vehicles (Passenger)

  private seatStanding = false;
  setSeat(seat: THREE.Object3D | null, vehicle?: { seats?: { gunner?: THREE.Object3D } } | null) {
    this.seat = seat;
    this.seatStanding = !!seat && !!vehicle?.seats && vehicle.seats.gunner === seat;
    if (!seat) this.anim.sit = 0;
  }

  // ------------------------------------------------------------------ update

  update(dt: number) {
    const m = this.model;
    if (this.dead) {
      this.deathT += dt;
      this.anim.dead = Math.min(1, this.deathT / 0.55);
      this.anim.speed = 0;
      this.anim.update(dt);
      this.corpseT -= dt;
      if (this.corpseT < 1.2 && m.root.visible) m.root.position.y -= dt * 0.9;
      if (this.corpseT <= 0) {
        this.removed = true;
        m.dispose();
      }
      return;
    }
    if (this.downed > 0) {
      // essential ally taking a knee
      this.downed -= dt;
      this.anim.dead = damp(this.anim.dead, 0.75, 6, dt);
      this.anim.speed = 0;
      this.anim.aim = 0;
      this.anim.update(dt);
      if (this.downed <= 0) {
        this.alive = true;
        this.health = this.maxHealth * 0.6;
        this.anim.dead = 0;
        this.bark('follow', 0, true);
      }
      return;
    }

    // status effects
    if (this.dotT > 0) {
      this.dotT -= dt;
      this.dotTick -= dt;
      if (this.dotTick <= 0) {
        this.dotTick = 0.25;
        this.aimPoint(_v);
        _v.x += rand(-0.2, 0.2);
        _v.y += rand(-0.3, 0.3);
        G.fx.elementBurst(_v, this.dotEl, 0.8);
        this.takeDamage({ amount: this.dotDps * 0.25, element: this.dotEl, crit: false, kind: 'dot', source: this.dotSrc, point: _v.clone(), dir: UP });
        if (!this.alive) return;
      }
    }
    if (this.shieldMax > 0 && this.shield < this.shieldMax) {
      this.shieldTimer -= dt;
      if (this.shieldTimer <= 0) this.shield = Math.min(this.shieldMax, this.shield + this.shieldMax * 0.3 * dt);
    }
    if (m.shield) {
      const mat = m.shield.material as THREE.MeshBasicMaterial;
      mat.opacity = damp(mat.opacity, this.shield > 0 ? 0.025 : 0, 6, dt);
      m.shield.visible = mat.opacity > 0.01;
    }
    if (this.faction === 'union' && this.health < this.maxHealth && G.time - this.brain.lastHurt > 6) this.health = Math.min(this.maxHealth, this.health + 20 * dt);
    this.stunT -= dt;
    this.flinchT -= dt;

    if (this.seat) {
      // riding: glued to the seat, brain only picks targets
      this.seat.getWorldPosition(this.pos);
      this.vel.set(0, 0, 0);
      this.anim.sit = this.seatStanding ? 0 : 1;
      this.anim.aim = this.seatStanding ? 1 : 0;
      this.crouching = false;
      this.brain.updateSeated(dt);
      m.root.position.copy(this.pos);
      // seat anchors for sitting riders are at hip height
      if (!this.seatStanding) m.root.position.y -= 0.5;
      this.seat.getWorldQuaternion(m.root.quaternion);
      this.anim.speed = 0;
      this.anim.update(dt);
      this.boundPos.copy(this.pos).setY(this.pos.y + 0.6);
      return;
    }

    if (G.ai.hold) {
      // cutscene: stand easy
      this.wantFire = false;
      this.vel.x = damp(this.vel.x, 0, 10, dt);
      this.vel.z = damp(this.vel.z, 0, 10, dt);
      this.anim.aim = 0;
      this.crouching = false;
    } else {
      this.brain.update(dt);
      this.move(dt);
    }

    // facing
    const sp = Math.hypot(this.vel.x, this.vel.z);
    let want = this.faceYaw;
    if (want === null && sp > 0.4) want = dirToYaw(this.vel.x, this.vel.z);
    if (want !== null && this.stunT <= 0) {
      const d = angleDelta(this.yaw, want);
      const step = this.def.turn * dt;
      this.yaw += clamp(d, -step, step);
    }
    this.fire(dt);

    // animation inputs
    const a = this.anim;
    a.speed = sp;
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    // velocity in the character's frame (forward = -Z)
    const fwd = sp > 0.05 ? (-this.vel.x * s - this.vel.z * c) / sp : 1;
    const side = sp > 0.05 ? (this.vel.x * c - this.vel.z * s) / sp : 0;
    a.moveZ = fwd;
    a.moveX = side;
    a.crouch = this.crouching ? 1 : 0;
    if (this.flinchT <= 0 && this.alive) this.model.setMood(this.brain.mood);
    a.update(dt);
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    this.boundPos.copy(this.pos).setY(this.pos.y + this.height * 0.5);

    // footsteps for the big guy, light servo patter for the rest
    if (sp > 0.5) {
      this.stepAcc += dt * sp;
      const stride = this.def.kind === 'manager' ? 2.4 : 1.6;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        if (this.def.kind === 'manager') {
          G.audio.play('heavy_step', { pos: this.pos, vol: 1, pitchVar: 0.06, ref: 12 });
          G.player.shakeFrom(this.pos, 0.18, 22);
        } else if (this.faction === 'monomart') G.audio.play('robot_step', { pos: this.pos, vol: 0.3, pitchVar: 0.1, ref: 4, maxDist: 30 });
      }
    }
  }

  removed = false;

  dispose() {
    this.removed = true;
    this.alive = false;
    this.model.dispose();
  }
}

export { ELEMENT_COLORS, PAL };
