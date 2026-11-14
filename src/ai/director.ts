import * as THREE from 'three';
import { G } from '../core/globals';
import { rand } from '../core/math';
import { hostile, type Target } from '../core/types';
import { PAL } from '../render/toon';
import type { EnemyKind } from '../world/leveldata';
import { Drone } from './drone';
import { Npc, type NpcOpts } from './npc';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

type Fighter = Npc | Drone;

/** Owns every NPC: spawning, squad chatter, who is allowed to shoot, reactions to hazards, music. */
export class AiDirector {
  readonly npcs: Npc[] = [];
  readonly drones: Drone[] = [];
  private tokens = new Map<number, number>();
  private calmT = 99;
  private intensity = 0;
  private hazardT = 0;
  private boardT = 0;
  private praiseT = 0;
  private variant = 0;

  constructor() {
    G.events.on('mineStuck', (e: { mine: { pos: THREE.Vector3 } }) => this.onMine(e.mine.pos));
    G.events.on('levelBuilt', (e: { level: { navAreas: THREE.Box3[] } }) => G.nav.build(e.level.navAreas));
    G.events.on('levelUnload', () => this.clear());
    G.events.on('playerDied', () => {
      const n = this.nearestEnemy(G.player.pos, 40);
      if (n instanceof Npc) n.bark('win', 0, true);
    });
  }

  clear() {
    for (const n of this.npcs) n.dispose();
    for (const d of this.drones) d.dispose();
    this.npcs.length = 0;
    this.drones.length = 0;
    this.tokens.clear();
    this.intensity = 0;
    this.calmT = 99;
    G.nav.clearAll();
    G.projectiles.clear();
  }

  // ------------------------------------------------------------------ spawning

  /** Snap a requested position onto the walkable mesh if it is close to it. */
  private ground(pos: THREE.Vector3) {
    const n = G.nav.nearest(pos, 2.5, 3);
    if (n >= 0) return G.nav.pos(n, new THREE.Vector3());
    const y = G.col.groundY(pos.x, pos.z, pos.y + 2, 20);
    return new THREE.Vector3(pos.x, y ?? pos.y, pos.z);
  }

  spawnEnemy(kind: EnemyKind, pos: THREE.Vector3, o: NpcOpts = {}): Fighter {
    if (kind === 'drone') {
      const y = G.col.groundY(pos.x, pos.z, pos.y + 2, 30);
      const d = new Drone(new THREE.Vector3(pos.x, y ?? pos.y, pos.z), o);
      this.drones.push(d);
      return d;
    }
    const n = new Npc(kind, this.ground(pos), o);
    this.npcs.push(n);
    if (kind === 'manager') G.hud.setBoss(n.def.label, () => n.health / n.maxHealth);
    return n;
  }

  spawnAlly(voice: string, pos: THREE.Vector3, o: NpcOpts = {}): Npc {
    const n = new Npc('striker', this.ground(pos), { ...o, voice, variant: o.variant ?? this.variant++ });
    n.label = voice === 'rivet' ? 'Rivet' : voice === 'dutch' ? 'Dutch' : 'Striker';
    this.npcs.push(n);
    return n;
  }

  aliveWithTag(tag: string) {
    let c = 0;
    for (const n of this.npcs) if (n.alive && n.faction === 'monomart' && (n.tag || '__base') === tag) c++;
    for (const d of this.drones) if (d.alive && (d.tag || '__base') === tag) c++;
    return c;
  }
  aliveEnemies() {
    let c = 0;
    for (const n of this.npcs) if (n.alive && n.faction === 'monomart') c++;
    for (const d of this.drones) if (d.alive) c++;
    return c;
  }
  get allies() {
    return this.npcs.filter((n) => n.faction === 'union' && !n.dead);
  }
  byName(name: string) {
    return this.npcs.find((n) => n.name === name) ?? null;
  }
  nearestEnemy(pos: THREE.Vector3, range: number): Fighter | null {
    let best: Fighter | null = null;
    let bd = range * range;
    for (const n of this.npcs) {
      if (!n.alive || n.faction !== 'monomart') continue;
      const d = n.pos.distanceToSquared(pos);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ fire discipline

  /** Only a few enemies may fire at the player at once; everyone else repositions. */
  requestToken(f: Fighter): boolean {
    if (f.faction !== 'monomart') return true;
    if (f instanceof Npc && f.brain.target !== G.player) return true;
    const now = G.time;
    const cur = this.tokens.get(f.id);
    if (cur !== undefined && cur > now) {
      this.tokens.set(f.id, now + 2.5);
      return true;
    }
    let active = 0;
    for (const [id, exp] of this.tokens) {
      if (exp <= now) this.tokens.delete(id);
      else active++;
    }
    const max = [2, 3, 4][Math.max(0, Math.min(2, G.settings.difficulty))] + (G.player.vehicle ? 1 : 0);
    if (active >= max) return false;
    this.tokens.set(f.id, now + 2.5);
    return true;
  }
  releaseToken(f: Fighter) {
    // hold the slot briefly so fire is spread across the squad instead of ping-ponging
    const cur = this.tokens.get(f.id);
    if (cur !== undefined) this.tokens.set(f.id, Math.min(cur, G.time + 0.35));
  }

  // ------------------------------------------------------------------ squad reactions

  alertFriends(from: Fighter, target: Target, where: THREE.Vector3) {
    for (const n of this.npcs) {
      if (n === from || !n.alive || n.faction !== from.faction) continue;
      const d = n.pos.distanceTo(from.pos);
      const sameSquad = from.squad !== '' && n.squad === from.squad;
      if (d < 24 || (sameSquad && d < 70)) n.brain.alertTo(target, where, rand(0.25, 0.95) + d * 0.02);
    }
    if (from.faction === 'monomart') for (const d of this.drones) if (d.alive && d.pos.distanceTo(from.pos) < 45) d.wake(target);
  }

  onNpcDeath(dead: Npc) {
    const robot = dead.faction === 'monomart';
    let leaderDown = false;
    if (robot && dead.def.kind === 'super') leaderDown = true;
    let barked = false;
    for (const n of this.npcs) {
      if (n === dead || !n.alive) continue;
      const d = n.pos.distanceTo(dead.pos);
      if (n.faction === dead.faction) {
        if (robot && d < 30) {
          if (leaderDown && n.def.kind === 'assoc' && (n.squad === dead.squad || d < 18) && Math.random() < 0.6) n.brain.panic(rand(5, 9));
          else if (!barked && d < 16 && Math.random() < 0.5) barked = n.bark('allydown', 9);
        }
      } else if (robot && d < 35 && !barked && this.praiseT <= 0) {
        // allies celebrate
        barked = n.bark(Math.random() < 0.5 ? 'kill' : 'praise', 10);
        this.praiseT = 6;
      }
    }
    if (!robot && this.allies.filter((a) => a.alive).length === 0) void G.audio.say('st_allies_down');
  }

  private onMine(pos: THREE.Vector3) {
    for (const n of this.npcs) {
      if (!n.alive || n.faction !== 'monomart') continue;
      const d = n.pos.distanceTo(pos);
      if (d > 7.5) continue;
      n.eyePos(_v);
      if (d < 3 || G.col.lineOfSight(_v, pos)) n.brain.avoid(pos, 2.6, 'mine');
    }
  }

  /** Ground-pound: hurts and launches everything hostile nearby. */
  shockwave(src: Npc, radius: number, damage: number) {
    const c = src.pos;
    G.fx.ring(_v.copy(c).setY(c.y + 0.15), 1, radius, 0.4, 0xffe36a);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      _v.set(c.x + Math.cos(a) * 2, c.y + 0.3, c.z + Math.sin(a) * 2);
      G.fx.puff(_v, _v2.set(Math.cos(a) * 5, 1.5, Math.sin(a) * 5), 0.6, 0.3, 0.9, PAL.sand, PAL.sandDark, -1, 3);
    }
    G.audio.play('heavy_step', { pos: c, vol: 1, pitch: 0.7, ref: 16 });
    G.audio.play('explosion_small', { pos: c, vol: 0.7, pitch: 0.8, ref: 14 });
    G.player.shakeFrom(c, 0.9, radius * 3);
    for (const t of G.world.targets.slice()) {
      if (!t.alive || !hostile(src.faction, t.faction)) continue;
      const d = Math.hypot(t.pos.x - c.x, t.pos.z - c.z);
      if (d > radius || Math.abs(t.pos.y - c.y) > 2.5) continue;
      const f = 1 - d / radius;
      _v2.set(t.pos.x - c.x, 0, t.pos.z - c.z).normalize();
      t.aimPoint(_v);
      t.takeDamage({ amount: damage * (0.4 + 0.6 * f), element: 'none', crit: false, kind: 'melee', source: src, point: _v.clone(), dir: _v2.clone(), impulse: 6 * f });
      if (t === G.player && !G.player.vehicle) {
        G.player.vel.x += _v2.x * 9 * (0.4 + f);
        G.player.vel.z += _v2.z * 9 * (0.4 + f);
        G.player.vel.y = 6.5;
        G.player.grounded = false;
      }
    }
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number) {
    for (const n of this.npcs) if (!n.removed) n.update(dt);
    for (const d of this.drones) if (!d.removed) d.update(dt);
    let w = 0;
    for (const n of this.npcs) if (!n.removed) this.npcs[w++] = n;
    this.npcs.length = w;
    w = 0;
    for (const d of this.drones) if (!d.removed) this.drones[w++] = d;
    this.drones.length = w;
    this.praiseT -= dt;

    // hazards: fast vehicles scatter anyone in their path
    this.hazardT -= dt;
    const vehicles = (G as any).vehicles?.list as { pos: THREE.Vector3; vel: THREE.Vector3; speed: number }[] | undefined;
    if (this.hazardT <= 0 && vehicles) {
      this.hazardT = 0.2;
      for (const v of vehicles) {
        if (!v.vel || v.speed < 6) continue;
        for (const n of this.npcs) {
          if (!n.alive || n.seat) continue;
          _v.copy(n.pos).sub(v.pos);
          const along = (_v.x * v.vel.x + _v.z * v.vel.z) / v.speed;
          if (along < 0 || along > v.speed * 1.1) continue;
          const side = Math.abs(_v.x * v.vel.z - _v.z * v.vel.x) / v.speed;
          if (side < 2.6) {
            // jump clear, straight away from its path
            const sgn = Math.sign(_v.x * v.vel.z - _v.z * v.vel.x) || 1;
            const px = (v.vel.z / v.speed) * sgn;
            const pz = (-v.vel.x / v.speed) * sgn;
            _v2.set(n.pos.x - px * 3, n.pos.y, n.pos.z - pz * 3);
            n.brain.avoid(_v2, 1.2, n.faction === 'monomart' ? 'vehicle' : null);
          }
        }
      }
    }
    this.updateBoarding(dt);

    // music follows the fight
    let hot = false;
    for (const n of this.npcs) {
      if (n.alive && n.faction === 'monomart' && n.brain.alert === 'combat' && G.time - n.brain.lastSeenT < 5 && n.pos.distanceToSquared(G.player.pos) < 90 * 90) {
        hot = true;
        break;
      }
    }
    if (!hot) for (const d of this.drones) if (d.alive && (d as any).awake && d.pos.distanceToSquared(G.player.pos) < 70 * 70) hot = true;
    this.calmT = hot ? 0 : this.calmT + dt;
    const want = hot ? 1 : this.calmT > 4.5 ? 0 : 1;
    if (want !== this.intensity) {
      this.intensity = want;
      G.audio.setMusicIntensity(want, want ? 0.6 : 3);
      G.events.emit('combatState', { hot: want === 1 });
    }
  }

  get inCombat() {
    return this.intensity > 0;
  }

  /** Allies pile into whatever the player is driving, and hop out when the player does. */
  private updateBoarding(dt: number) {
    this.boardT -= dt;
    if (this.boardT > 0) return;
    this.boardT = 0.4;
    const veh = G.player.vehicle as any;
    const canCarry = veh && typeof veh.board === 'function';
    for (const n of this.npcs) {
      if (n.faction !== 'union' || n.dead) continue;
      if (n.seat) {
        if (!canCarry || (n as any).ride !== veh) {
          const old = (n as any).ride;
          old?.unboard?.(n);
          n.setSeat(null);
          (n as any).ride = null;
          // step out next to wherever we stopped
          const node = G.nav.nearest(n.pos, 6, 6);
          if (node >= 0) G.nav.pos(node, n.pos);
          n.model.root.quaternion.identity();
        }
        continue;
      }
      if (!canCarry || !n.alive) continue;
      const free = veh.freeSeat?.();
      if (!free) continue;
      const d = n.pos.distanceTo(veh.pos ?? G.player.pos);
      if (d < 3.6) {
        if (veh.board(n, free)) {
          (n as any).ride = veh;
          n.stop();
          n.bark('ride', 12);
        }
      } else if (d < 22 && n.brain.alert !== 'combat') {
        const node = G.nav.nearest(veh.pos ?? G.player.pos, 4, 4);
        if (node >= 0) n.goTo(G.nav.pos(node, _v), n.def.run);
      }
    }
  }
}
