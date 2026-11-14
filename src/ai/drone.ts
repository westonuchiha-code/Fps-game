import * as THREE from 'three';
import { G } from '../core/globals';
import { clamp, damp, dirToYaw, dampAngle, rand } from '../core/math';
import { hostile, newId, type DamageInfo, type Faction, type HitZone, type Target } from '../core/types';
import { Kit } from '../render/kit';
import { flat, PAL } from '../render/toon';
import { drawSmile } from '../render/textures';
import { levelScale } from '../weapons/items';
import type { Listener, NoiseKind, Shootable, WorldHit } from '../world/world';
import { raySphere } from '../world/world';
import type { AudioSys } from '../audio/audio';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

let bodyGeo: THREE.BufferGeometry | null = null;
let rotorGeo: THREE.BufferGeometry | null = null;
let faceTex: THREE.CanvasTexture | null = null;

/** Courier drone: a fragile flying harasser that strafes in short bursts. */
export class Drone implements Target, Shootable, Listener {
  readonly id = newId();
  faction: Faction = 'monomart';
  alive = true;
  dead = false;
  removed = false;
  label = 'Courier Drone';
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  radius = 0.5;
  height = 0.5;
  health: number;
  maxHealth: number;
  tag: string;
  squad: string;
  level: number;
  readonly obj = new THREE.Group();
  private rotors: THREE.Mesh[] = [];
  private yaw = 0;
  private target: Target | null = null;
  private awake = false;
  private senseT = rand(0, 0.3);
  private seen = false;
  private orbit = rand(0, 6.28);
  private orbitDir = Math.random() < 0.5 ? 1 : -1;
  private alt = rand(3.2, 5.2);
  private burst = 0;
  private shotT = 0;
  private pauseT = rand(0.5, 1.5);
  private home = new THREE.Vector3();
  private fallT = 0;
  private wobble = 0;
  private hum: ReturnType<AudioSys['loop']> | null = null;
  private bob = rand(0, 6);
  // Shootable
  readonly boundPos = this.pos;
  readonly boundRadius = 0.75;
  readonly owner: Target = this;
  taggedUntil = 0;

  constructor(pos: THREE.Vector3, o: { tag?: string; squad?: string; level?: number } = {}) {
    this.level = o.level ?? G.enemyLevel;
    this.maxHealth = this.health = Math.round(42 * levelScale(this.level) * G.difficulty.enemyHealth);
    this.tag = o.tag ?? '';
    this.squad = o.squad ?? '';
    if (!bodyGeo) {
      const k = new Kit();
      k.box(0.5, 0.2, 0.42, PAL.shell, [0, 0, 0]);
      k.box(0.36, 0.16, 0.02, PAL.screen, [0, 0, -0.215]);
      k.box(0.3, 0.2, 0.3, 0xc9a06a, [0, -0.2, 0.02]); // the parcel it will never deliver
      k.box(0.31, 0.05, 0.31, 0xe8dcc0, [0, -0.2, 0.02]);
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          k.box(0.36, 0.035, 0.05, PAL.screen, [sx * 0.36, 0.06, sz * 0.3], [0, sx * sz * 0.7, 0]);
          k.cyl(0.035, 0.035, 0.07, PAL.smile, [sx * 0.5, 0.1, sz * 0.42], 'y', 6);
        }
      k.cyl(0.025, 0.02, 0.22, PAL.screen, [0.14, -0.08, -0.26], 'z', 6);
      bodyGeo = k.geometry();
      rotorGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.012, 10);
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      g.fillStyle = '#0e1016';
      g.fillRect(0, 0, 64, 64);
      drawSmile(g, 32, 34, 24, '#ffd21f', 'happy');
      faceTex = new THREE.CanvasTexture(c);
      faceTex.colorSpace = THREE.SRGBColorSpace;
    }
    const body = new THREE.Mesh(bodyGeo, G.mat.prop);
    body.castShadow = true;
    this.obj.add(body);
    const fg = new THREE.PlaneGeometry(0.2, 0.14);
    fg.rotateY(Math.PI);
    const face = new THREE.Mesh(fg, flat(0xffffff, { map: faceTex! }));
    face.position.set(0, 0, -0.227);
    this.obj.add(face);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const r = new THREE.Mesh(rotorGeo!, flat(0x9aa4b0, { transparent: true, opacity: 0.35, depthWrite: false }));
        r.position.set(sx * 0.5, 0.145, sz * 0.42);
        r.layers.set(2);
        this.obj.add(r);
        this.rotors.push(r);
      }
    this.pos.copy(pos);
    this.pos.y += this.alt;
    this.home.copy(this.pos);
    this.obj.position.copy(this.pos);
    G.scene.add(this.obj);
    G.world.targets.push(this);
    G.world.shootables.push(this);
    G.world.listeners.push(this);
    this.hum = G.audio.loop('drone_loop', { pos: this.pos, vol: 0.5, ref: 5, maxDist: 60 });
  }

  aimPoint(out: THREE.Vector3) {
    return out.copy(this.pos);
  }
  headPoint(out: THREE.Vector3) {
    return out.copy(this.pos);
  }

  rayHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { zone?: HitZone; onHit?: WorldHit['onHit']; normal: THREE.Vector3 }) {
    if (!this.alive) return -1;
    const d = raySphere(origin, dir, this.pos, 0.46);
    if (d < 0 || d > maxDist) return -1;
    out.zone = 'body';
    out.normal.copy(dir).negate();
    return d;
  }

  hear(_pos: THREE.Vector3, kind: NoiseKind, source: Target | null) {
    if (!this.alive || this.awake) return;
    if ((kind === 'gunshot' || kind === 'explosion') && source && hostile(this.faction, source.faction)) {
      this.awake = true;
      this.target = source;
    }
  }

  /** Called by the director when squad mates spot something. */
  wake(t: Target) {
    if (this.awake) return;
    this.awake = true;
    this.target = t;
    G.audio.play('robot_alert', { pos: this.pos, vol: 0.5, pitch: 1.4, ref: 6 });
  }

  takeDamage(d: DamageInfo) {
    if (!this.alive) return;
    if (d.source && !hostile(d.source.faction, this.faction)) return;
    let amount = d.amount;
    if (this.taggedUntil > G.time) amount *= 1.3;
    if (d.element === 'shock') amount *= 1.3;
    this.health -= amount;
    const fromPlayer = d.source === G.player;
    if (fromPlayer) {
      G.hud.damageNumber(d.point, amount, d.crit, d.element);
      G.hud.hitmarker(d.crit, this.health <= 0);
    }
    G.fx.robotHit(d.point, d.dir, false, d.element);
    G.audio.play('impact_robot', { pos: d.point, vol: 0.5, pitch: 1.3, pitchVar: 0.1 });
    this.wobble = 1;
    this.vel.addScaledVector(d.dir, 2.5);
    if (d.source && d.source.alive) {
      this.awake = true;
      this.target = d.source;
    }
    if (this.health <= 0) {
      this.alive = false;
      this.fallT = 0.001;
      this.vel.y = 2;
      this.hum?.setPitch(0.6, 0.4);
      G.world.remove(G.world.targets, this as Target);
      G.world.remove(G.world.shootables, this as Shootable);
      G.world.remove(G.world.listeners, this as Listener);
      if (fromPlayer || d.source?.faction === 'union') G.stats.kills++;
      G.events.emit('npcKilled', { npc: this, by: d.source, info: d });
    }
  }

  private sense() {
    this.seen = false;
    let best: Target | null = null;
    let bd = 60 * 60;
    for (const t of G.world.targets) {
      if (!t.alive || !hostile(this.faction, t.faction)) continue;
      const d = t.pos.distanceToSquared(this.pos);
      if (d > bd) continue;
      t.aimPoint(_v);
      if (!G.col.lineOfSight(this.pos, _v)) continue;
      bd = d;
      best = t;
    }
    if (best) {
      if (!this.awake) {
        this.awake = true;
        G.audio.play('robot_alert', { pos: this.pos, vol: 0.5, pitch: 1.4, ref: 6 });
        G.ai.alertFriends(this, best, best.pos);
      }
      this.target = best;
      this.seen = true;
    } else if (this.target && !this.target.alive) this.target = null;
  }

  update(dt: number) {
    if (this.dead) return;
    for (const r of this.rotors) r.rotation.y += dt * 40;
    this.hum?.setPos(this.pos);
    if (!this.alive) {
      // spin out of the sky and pop
      this.fallT += dt;
      this.vel.y -= 14 * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.obj.rotation.z += dt * 9;
      this.obj.rotation.x += dt * 5;
      this.obj.position.copy(this.pos);
      const g = G.col.raycast(this.pos, DOWN, 0.5, 'static');
      if (g || this.fallT > 3) {
        this.dead = true;
        this.removed = true;
        this.hum?.stop(0.1);
        this.obj.removeFromParent();
        G.fx.explosion(this.pos, 2.4, true, 'none');
        G.audio.play('explosion_small', { pos: this.pos, vol: 0.8, ref: 9 });
        G.fx.scrap(this.pos, PAL.shell, 6);
        _v.copy(this.pos);
        if (g) _v.copy(g.point);
        if (Math.random() < 0.3) G.loot.spawn('ammo', _v, { cls: 'pistol', amount: 12 });
        if (Math.random() < 0.3) G.loot.spawn('cash', _v, { amount: 8 + this.level * 2 });
      }
      return;
    }
    this.senseT -= dt;
    if (this.senseT <= 0) {
      this.senseT = 0.22;
      this.sense();
    }
    this.bob += dt * 2.3;
    this.wobble = damp(this.wobble, 0, 3, dt);
    const t = this.target;
    let want = _v2.copy(this.home);
    if (this.awake && t && t.alive) {
      // circle the target at stand-off range
      this.orbit += this.orbitDir * dt * 0.55;
      if (Math.random() < dt * 0.25) this.orbitDir *= -1;
      const r = 10.5;
      want.set(t.pos.x + Math.cos(this.orbit) * r, 0, t.pos.z + Math.sin(this.orbit) * r);
      const g = G.col.raycast(_v.set(want.x, t.pos.y + 12, want.z), DOWN, 30, 'static');
      want.y = (g ? g.point.y : t.pos.y) + this.alt;
    }
    want.y += Math.sin(this.bob) * 0.25;
    // steer, but never through walls
    _dir.copy(want).sub(this.pos);
    const dist = _dir.length();
    if (dist > 0.05) {
      _dir.multiplyScalar(1 / dist);
      const hit = G.col.raycast(this.pos, _dir, Math.min(dist, 2.2), 'static');
      if (hit) {
        this.orbitDir *= -1;
        this.orbit += this.orbitDir * 0.5;
        _dir.addScaledVector(hit.normal, 1.2).normalize();
      }
      const sp = clamp(dist * 1.6, 0, this.awake ? 7.5 : 2.5);
      this.vel.x = damp(this.vel.x, _dir.x * sp, 3, dt);
      this.vel.y = damp(this.vel.y, _dir.y * sp, 3, dt);
      this.vel.z = damp(this.vel.z, _dir.z * sp, 3, dt);
    }
    this.pos.addScaledVector(this.vel, dt);
    // shooting
    if (this.awake && t && t.alive && this.seen) {
      t.aimPoint(_eye);
      this.yaw = dampAngle(this.yaw, dirToYaw(_eye.x - this.pos.x, _eye.z - this.pos.z), 6, dt);
      this.pauseT -= dt;
      if (this.burst <= 0 && this.pauseT <= 0 && G.ai.requestToken(this)) {
        this.burst = 3;
        this.shotT = 0;
      }
      if (this.burst > 0) {
        this.shotT -= dt;
        if (this.shotT <= 0) {
          this.shotT = 0.11;
          this.burst--;
          if (this.burst <= 0) {
            this.pauseT = rand(1.3, 2.4);
            G.ai.releaseToken(this);
          }
          _dir.copy(_eye).sub(this.pos);
          const d = _dir.length();
          _dir.multiplyScalar(1 / d);
          const lead = (d / 50) * 0.6;
          _dir.x += (t.vel.x * lead) / d;
          _dir.z += (t.vel.z * lead) / d;
          const err = (0.075 / G.difficulty.enemyAim) * (1 + this.wobble);
          _dir.x += rand(-err, err);
          _dir.y += rand(-err, err);
          _dir.z += rand(-err, err);
          _dir.normalize();
          _v.copy(this.pos).addScaledVector(_dir, 0.4);
          _v.y -= 0.1;
          G.projectiles.fire(this, _v, _dir, 50, 5 * levelScale(this.level), { color: 0xffe36a, size: 0.06 });
          G.audio.play('drone_shot', { pos: this.pos, vol: 0.6, pitchVar: 0.1, ref: 6 });
        }
      }
    } else if (Math.hypot(this.vel.x, this.vel.z) > 0.5) this.yaw = dampAngle(this.yaw, dirToYaw(this.vel.x, this.vel.z), 4, dt);
    this.obj.position.copy(this.pos);
    // bank into the direction of travel
    this.obj.rotation.set(clamp(-(this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw)) * -0.05, -0.4, 0.4) + Math.sin(G.time * 30) * this.wobble * 0.2, this.yaw, clamp((this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw)) * -0.06, -0.5, 0.5), 'YXZ');
    void UP;
  }

  dispose() {
    this.removed = true;
    this.alive = false;
    this.dead = true;
    this.hum?.stop(0.05);
    this.obj.removeFromParent();
  }
}
