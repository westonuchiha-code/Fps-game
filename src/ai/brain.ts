import * as THREE from 'three';
import { G } from '../core/globals';
import { angleDelta, clamp, dirToYaw, rand, yawToDir } from '../core/math';
import { hostile, type DamageInfo, type Target } from '../core/types';
import type { NoiseKind } from '../world/world';
import type { Mood } from './charModel';
import type { Npc, NpcOpts } from './npc';

export type Alert = 'idle' | 'investigate' | 'combat' | 'search';
type Tactic = 'none' | 'toCover' | 'inCover' | 'advance' | 'hold' | 'melee' | 'retreat';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _tp = new THREE.Vector3();

/**
 * Decision making for one character.
 *
 *  idle        stand post / patrol / (allies) follow the player
 *  investigate heard something: go and look
 *  combat      pick cover, peek and shoot, advance when the target hides, fall back when hurt,
 *              charge (supervisors), flee from planted charges and oncoming vehicles
 *  search      lost the target: check the last known position, then give up
 */
export class Brain {
  alert: Alert = 'idle';
  tactic: Tactic = 'none';
  target: Target | null = null;
  /** target is in view right now */
  seen = false;
  readonly lastSeenPos = new THREE.Vector3();
  lastSeenT = -99;
  awareness = 0;
  mood: Mood = 'happy';
  lastHurt = -99;
  private lastAttacker: Target | null = null;
  readonly home = new THREE.Vector3();
  private homeYaw: number;
  private patrol: THREE.Vector3[] | null;
  private patrolI = 0;
  private waitT = rand(0.5, 3);
  hold: boolean;
  readonly isAlly: boolean;
  private senseT = rand(0, 0.2);
  private decideT = rand(0, 0.5);
  private stateT = 0;
  private coverStay = 7;
  private cover: { pos: THREE.Vector3; node: number; low: boolean } | null = null;
  private peeking = false;
  private peekT = 0;
  private hiddenT = 0;
  private steppedOut = false;
  private retreated = false;
  private lostT = 0;
  /** running from a hazard (mine / vehicle) */
  avoidT = 0;
  /** routed: hands up, running away */
  panicT = 0;
  private panicTick = 0;
  private investigatePos = new THREE.Vector3();
  private lookT = 0;
  private followT = rand(0, 1);
  private chatterT = rand(25, 70);
  private pendingAlert: { t: Target; pos: THREE.Vector3; delay: number } | null = null;
  private meleeT = 0;
  private swingT = -1;
  // boss
  enraged = false;
  private stompCd = 3;
  private stompT = -1;

  constructor(
    private npc: Npc,
    o: NpcOpts,
  ) {
    this.home.copy(npc.pos);
    this.homeYaw = o.yaw ?? 0;
    this.patrol = o.patrol && o.patrol.length ? [npc.pos.clone(), ...o.patrol] : null;
    this.hold = !!o.hold;
    this.isAlly = npc.faction === 'union';
  }

  // ------------------------------------------------------------------ perception

  private sense(tick: number) {
    const npc = this.npc;
    const def = npc.def;
    npc.eyePos(_eye);
    const unaware = this.alert === 'idle' || this.alert === 'investigate';
    const range = def.view * (unaware ? 1 : 1.35);
    yawToDir(npc.yaw, _v2);
    let best: Target | null = null;
    let bestScore = -1;
    let bestD = 0;
    for (const t of G.world.targets) {
      if (!t.alive || t === npc || !hostile(npc.faction, t.faction)) continue;
      const dx = t.pos.x - npc.pos.x;
      const dz = t.pos.z - npc.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range) continue;
      if (unaware && d > 3.5) {
        // 130 degree cone while relaxed
        const dot = (dx * _v2.x + dz * _v2.z) / (d || 1);
        if (dot < 0.42) continue;
      }
      t.aimPoint(_tp);
      if (!G.col.lineOfSight(_eye, _tp)) {
        t.headPoint(_tp);
        if (!G.col.lineOfSight(_eye, _tp)) continue;
      }
      let score = 1 / (d + 2);
      if (t === this.lastAttacker) score *= 1.8;
      if (t === this.target) score *= 1.25;
      if (score > bestScore) {
        bestScore = score;
        best = t;
        bestD = d;
      }
    }
    if (best) {
      if (this.alert !== 'combat') {
        // spotting takes a moment at range, and longer if the player is sneaking
        let gain = bestD < 8 ? 7 : bestD < 22 ? 3.2 : 1.5;
        if (best === G.player && G.player.crouching) gain *= 0.55;
        this.awareness += gain * tick;
        if (this.isAlly || this.alert === 'search' || this.awareness >= 1) this.enterCombat(best, best.pos);
      } else {
        if (best !== this.target && (!this.seen || best === this.lastAttacker || !this.target || !this.target.alive)) this.target = best;
        if (best === this.target) {
          this.seen = true;
          this.lastSeenPos.copy(best.pos);
          this.lastSeenT = G.time;
        } else if (this.target) {
          // keep checking the one we are fighting
          this.target.aimPoint(_tp);
          this.seen = this.target.alive && G.col.lineOfSight(_eye, _tp);
          if (this.seen) {
            this.lastSeenPos.copy(this.target.pos);
            this.lastSeenT = G.time;
          }
        }
      }
    } else {
      this.seen = false;
      if (this.alert !== 'combat') this.awareness = Math.max(0, this.awareness - tick * 0.45);
    }
  }

  enterCombat(t: Target, where: THREE.Vector3) {
    const npc = this.npc;
    const fresh = this.alert !== 'combat';
    this.alert = 'combat';
    this.target = t;
    this.lastSeenPos.copy(where);
    this.lastSeenT = G.time;
    this.awareness = 1;
    this.mood = 'angry';
    if (fresh) {
      this.tactic = 'none';
      this.decideT = rand(0.05, 0.35);
      this.lostT = 0;
      if (npc.faction === 'monomart') {
        G.audio.play('robot_alert', { pos: npc.pos, vol: 0.6, pitchVar: 0.1, ref: 7 });
        npc.bark('alert', 7);
      } else npc.bark('see', 8);
      G.ai.alertFriends(npc, t, where);
    }
  }

  /** A friend spotted something: join in after a short reaction delay. */
  alertTo(t: Target, where: THREE.Vector3, delay: number) {
    if (this.alert === 'combat' || this.panicT > 0) return;
    this.pendingAlert = { t, pos: where.clone(), delay };
  }

  onNoise(pos: THREE.Vector3, kind: NoiseKind, source: Target | null, loud: number) {
    const npc = this.npc;
    if (source === npc) return;
    const friendly = source ? !hostile(source.faction, npc.faction) : false;
    if (this.alert === 'combat') {
      if (!this.seen && source && !friendly && source === this.target) {
        this.lastSeenPos.copy(pos);
        this.lastSeenT = Math.max(this.lastSeenT, G.time - 2);
      }
      return;
    }
    if (this.isAlly) return; // allies rely on their eyes and the player
    if (kind === 'gunshot' || kind === 'explosion') {
      if (source && !friendly && source.alive) this.enterCombat(source, pos);
      else if (this.alert === 'idle') this.investigate(pos);
    } else if (!friendly) {
      this.awareness += loud * 0.5;
      if (this.alert === 'idle' && loud > 0.25) this.investigate(pos);
    }
  }

  private investigate(pos: THREE.Vector3) {
    this.alert = 'investigate';
    this.investigatePos.copy(pos);
    this.stateT = 0;
    this.lookT = 0;
    this.npc.stop();
    this.npc.bark('search', 12);
  }

  onDamaged(d: DamageInfo, _shieldBroke: boolean) {
    this.lastHurt = G.time;
    const src = d.source;
    if (src && src.alive && hostile(src.faction, this.npc.faction)) {
      this.lastAttacker = src;
      if (this.alert !== 'combat' || !this.seen) this.enterCombat(src, src.pos);
      // hit while supposedly safe: this cover is no good
      if (this.tactic === 'inCover' && !this.peeking) this.stateT += 4;
    }
  }

  onDeath(_d: DamageInfo) {
    G.ai.onNpcDeath(this.npc);
  }

  /** Run from a hazard for a few seconds. */
  avoid(from: THREE.Vector3, seconds: number, bark: string | null) {
    const npc = this.npc;
    if (npc.def.kind === 'manager' || this.avoidT > 0) return;
    _v.copy(npc.pos).sub(from).setY(0);
    if (_v.lengthSq() < 0.01) _v.set(rand(-1, 1), 0, rand(-1, 1));
    _v.normalize().multiplyScalar(9).add(npc.pos);
    const n = G.nav.nearest(_v, 5);
    if (n < 0) return;
    if (npc.goTo(G.nav.pos(n, _v2), npc.def.run * 1.15)) {
      this.avoidT = seconds;
      npc.wantFire = false;
      npc.crouching = false;
      if (bark) npc.bark(bark, 6);
      if (this.cover) G.nav.release(npc.id);
      this.cover = null;
      this.tactic = 'none';
    }
  }

  /** Lose heart (leader died): run around with hands up for a while. */
  panic(seconds: number) {
    if (this.npc.def.kind !== 'assoc') return;
    this.panicT = seconds;
    this.panicTick = 0;
    this.npc.bark('flee', 4);
    this.mood = 'hurt';
    G.nav.release(this.npc.id);
    this.cover = null;
  }

  // ------------------------------------------------------------------ update

  update(dt: number) {
    const npc = this.npc;
    this.senseT -= dt;
    if (this.senseT <= 0) {
      const tick = 0.15 + rand(0, 0.06);
      this.senseT = tick;
      this.sense(tick);
    }
    if (this.pendingAlert) {
      this.pendingAlert.delay -= dt;
      if (this.pendingAlert.delay <= 0) {
        const p = this.pendingAlert;
        this.pendingAlert = null;
        if (this.alert !== 'combat' && p.t.alive) this.enterCombat(p.t, p.pos);
      }
    }
    npc.anim.panic = this.panicT > 0 ? 1 : 0;
    if (npc.stunT > 0) {
      npc.wantFire = false;
      return;
    }
    if (this.panicT > 0) {
      this.updatePanic(dt);
      return;
    }
    if (this.avoidT > 0) {
      this.avoidT -= dt;
      npc.wantFire = false;
      npc.faceYaw = null;
      if (npc.arrived) this.avoidT = 0;
      return;
    }
    switch (this.alert) {
      case 'idle':
        this.updateIdle(dt);
        break;
      case 'investigate':
        this.updateInvestigate(dt);
        break;
      case 'combat':
        if (npc.def.kind === 'manager') this.updateBoss(dt);
        else this.updateCombat(dt);
        break;
      case 'search':
        this.updateSearch(dt);
        break;
    }
  }

  updateSeated(dt: number) {
    this.senseT -= dt;
    if (this.senseT <= 0) {
      this.senseT = 0.25;
      this.sense(0.25);
    }
    this.npc.wantFire = false;
  }

  private relax() {
    const npc = this.npc;
    npc.wantFire = false;
    npc.crouching = false;
    npc.anim.aim = 0;
    npc.anim.aimPitch = 0;
    npc.focus = 0;
  }

  private updateIdle(dt: number) {
    const npc = this.npc;
    this.relax();
    this.mood = 'happy';
    if (this.isAlly) {
      this.followLeader(dt);
      return;
    }
    if (this.patrol) {
      npc.faceYaw = null;
      if (npc.arrived) {
        this.waitT -= dt;
        if (this.waitT <= 0) {
          this.patrolI = (this.patrolI + 1) % this.patrol.length;
          npc.goTo(this.patrol[this.patrolI], npc.def.walk);
          this.waitT = rand(1.5, 4.5);
        }
      }
      return;
    }
    // at post: glance around
    const dHome = Math.hypot(npc.pos.x - this.home.x, npc.pos.z - this.home.z);
    if (dHome > 1.6) {
      if (npc.arrived) npc.goTo(this.home, npc.def.walk);
      npc.faceYaw = null;
    } else {
      npc.faceYaw = this.homeYaw + Math.sin(G.time * 0.33 + npc.id) * 0.7;
      npc.anim.headYaw = Math.sin(G.time * 0.7 + npc.id * 1.7) * 0.5;
    }
  }

  private followLeader(dt: number) {
    const npc = this.npc;
    const pl = G.player;
    const d = Math.hypot(pl.pos.x - npc.pos.x, pl.pos.z - npc.pos.z);
    this.followT -= dt;
    // boarding / leaving vehicles is arranged by the director
    if (d > 70) {
      // hopelessly left behind: catch up out of sight
      const n = G.nav.randomNear(pl.pos, 7, 12);
      if (n >= 0) {
        G.nav.pos(n, _v);
        pl.eyePos(_eye);
        _v2.copy(_v).setY(_v.y + 1.2);
        if (!G.col.lineOfSight(_eye, _v2)) {
          npc.pos.copy(_v);
          npc.stop();
        }
      }
    } else if (d > 7.5 && this.followT <= 0) {
      this.followT = 1.1;
      const n = G.nav.randomNear(pl.pos, 2.6, 5.2);
      if (n >= 0) {
        npc.goTo(G.nav.pos(n, _v), d > 15 ? npc.def.run : npc.def.walk * 1.9);
        if (d > 18) npc.bark('follow', 25);
      }
    } else if (d < 3.2 && npc.moving) npc.stop();
    npc.faceYaw = npc.moving ? null : pl.yaw;
    this.chatterT -= dt;
    if (this.chatterT <= 0) {
      this.chatterT = rand(45, 90);
      if (!G.audio.speaking) npc.bark('idle', 60);
    }
  }

  private updateInvestigate(dt: number) {
    const npc = this.npc;
    this.relax();
    this.stateT += dt;
    this.mood = 'happy';
    const p = this.investigatePos;
    if (this.stateT < 0.7) {
      npc.faceYaw = dirToYaw(p.x - npc.pos.x, p.z - npc.pos.z);
      return;
    }
    if (this.lookT === 0) {
      const n = G.nav.nearest(p, 4);
      if (n < 0 || !npc.goTo(G.nav.pos(n, _v), npc.def.walk * 1.7)) this.lookT = 0.01;
      else this.lookT = -1;
      return;
    }
    if (this.lookT < 0) {
      npc.faceYaw = null;
      if (npc.arrived || this.stateT > 12) this.lookT = 0.01;
      return;
    }
    // look around
    this.lookT += dt;
    npc.faceYaw = npc.yaw + Math.sin(this.lookT * 1.6) * 0.9 * dt * 4;
    npc.anim.headYaw = Math.sin(this.lookT * 2.2) * 0.8;
    if (this.lookT > 3.2) {
      this.alert = 'idle';
      this.awareness = 0;
      npc.bark('lost', 14);
    }
  }

  private updateSearch(dt: number) {
    const npc = this.npc;
    this.relax();
    npc.anim.aim = 0.6;
    this.stateT += dt;
    npc.faceYaw = null;
    if (npc.arrived) {
      this.waitT -= dt;
      npc.anim.headYaw = Math.sin(G.time * 2.4 + npc.id) * 0.8;
      if (this.waitT <= 0) {
        this.waitT = rand(1.2, 2.4);
        const n = G.nav.randomNear(this.lastSeenPos, 2, 10);
        if (n >= 0) npc.goTo(G.nav.pos(n, _v), npc.def.walk * 1.8);
      }
    }
    if (this.stateT > 13) {
      this.alert = 'idle';
      this.awareness = 0;
      this.target = null;
      this.mood = 'happy';
      npc.bark('lost', 14);
    }
  }

  private updatePanic(dt: number) {
    const npc = this.npc;
    this.panicT -= dt;
    npc.wantFire = false;
    npc.crouching = false;
    npc.faceYaw = null;
    npc.anim.aim = 0;
    this.panicTick -= dt;
    if (this.panicTick <= 0 || npc.arrived) {
      this.panicTick = 1.2;
      const from = this.target ? this.target.pos : G.player.pos;
      _v.copy(npc.pos).sub(from).setY(0).normalize().multiplyScalar(11).add(npc.pos);
      _v.x += rand(-5, 5);
      _v.z += rand(-5, 5);
      const n = G.nav.nearest(_v, 6);
      if (n >= 0) npc.goTo(G.nav.pos(n, _v2), npc.def.run * 1.15);
    }
    if (this.panicT <= 0) {
      this.mood = 'angry';
      this.tactic = 'none';
      this.decideT = 0;
    }
  }

  // ------------------------------------------------------------------ combat

  /** Point the gun: lead the target a little, look at where it was if we cannot see it. */
  private aimAt(t: Target) {
    const npc = this.npc;
    const a = npc.aimPoint3;
    if (this.seen) {
      t.aimPoint(a);
      const d = a.distanceTo(npc.pos);
      const lead = (d / npc.def.boltSpeed) * 0.75;
      a.x += t.vel.x * lead;
      a.z += t.vel.z * lead;
    } else a.set(this.lastSeenPos.x, this.lastSeenPos.y + 1.1, this.lastSeenPos.z);
    npc.faceYaw = dirToYaw(a.x - npc.pos.x, a.z - npc.pos.z);
    const flat = Math.hypot(a.x - npc.pos.x, a.z - npc.pos.z);
    npc.anim.aim = 1;
    npc.anim.aimPitch = clamp(Math.atan2(a.y - (npc.pos.y + npc.height * 0.72), Math.max(flat, 0.5)), -0.9, 0.9);
    npc.anim.headYaw = 0;
  }

  private pickAnyTarget(): Target | null {
    return G.world.nearestHostile(this.npc.pos, this.npc.faction, this.npc.def.view * 1.3, null, false);
  }

  private updateCombat(dt: number) {
    const npc = this.npc;
    const def = npc.def;
    let t = this.target;
    if (!t || !t.alive) {
      this.target = t = this.pickAnyTarget();
      if (!t) {
        this.lostT += dt;
        npc.wantFire = false;
        if (this.lostT > 1.4) {
          // fight is over
          this.alert = this.isAlly ? 'idle' : 'search';
          this.stateT = 0;
          this.waitT = 0.5;
          this.tactic = 'none';
          G.nav.release(npc.id);
          this.cover = null;
          npc.crouching = false;
        }
        return;
      }
      this.lastSeenPos.copy(t.pos);
      this.lastSeenT = G.time - 1;
    }
    this.lostT = 0;
    const sinceSeen = G.time - this.lastSeenT;
    const dist = Math.hypot(t.pos.x - npc.pos.x, t.pos.z - npc.pos.z);
    this.aimAt(t);
    npc.focus = clamp(npc.focus + (this.seen ? dt * 0.42 : -dt * 0.7), 0, 1);
    this.stateT += dt;
    this.decideT -= dt;
    if (this.decideT <= 0) {
      this.decideT = rand(0.4, 0.85);
      this.decide(t, dist, sinceSeen);
    }
    const canShoot = this.seen && dist < def.range && Math.abs(angleDelta(npc.yaw, npc.faceYaw ?? npc.yaw)) < 0.5;

    switch (this.tactic) {
      case 'toCover':
      case 'retreat':
        npc.crouching = false;
        npc.wantFire = this.tactic === 'toCover' && canShoot;
        if (npc.arrived) {
          this.tactic = 'inCover';
          this.stateT = 0;
          this.peeking = false;
          this.hiddenT = rand(0.4, 1.1);
        }
        break;
      case 'inCover': {
        const c = this.cover;
        if (!c) {
          this.tactic = 'none';
          break;
        }
        if (this.peeking) {
          npc.crouching = false;
          npc.wantFire = canShoot;
          this.peekT -= dt;
          if (this.peekT <= 0) {
            this.peeking = false;
            this.hiddenT = rand(0.8, 2.1);
            if (this.steppedOut) {
              this.steppedOut = false;
              npc.goTo(c.pos, def.run);
            }
          }
        } else {
          npc.crouching = c.low && npc.arrived;
          npc.wantFire = false;
          this.hiddenT -= dt;
          if (this.hiddenT <= 0 && npc.arrived) {
            this.peeking = true;
            this.peekT = rand(1.3, 2.5);
            if (!c.low) {
              // tall cover: lean out to a spot that can see the target
              for (let i = 0; i < 4; i++) {
                const n = G.nav.randomNear(c.pos, 1.0, 2.4, 4);
                if (n < 0) continue;
                G.nav.pos(n, _v);
                _v2.copy(_v).setY(_v.y + 1.5);
                t.aimPoint(_tp);
                if (G.col.lineOfSight(_v2, _tp)) {
                  npc.goTo(_v, def.run);
                  this.steppedOut = true;
                  break;
                }
              }
            }
          }
        }
        break;
      }
      case 'melee':
        this.updateMelee(dt, t, dist);
        break;
      default:
        // advance / hold / none
        npc.crouching = false;
        npc.wantFire = canShoot;
    }
  }

  private decide(t: Target, dist: number, sinceSeen: number) {
    const npc = this.npc;
    const def = npc.def;
    const nav = G.nav;

    if (this.tactic === 'melee') {
      if (dist > 10 || sinceSeen > 2) this.tactic = 'none';
      else return;
    }
    if (def.melee && def.kind === 'super' && this.seen && dist < 5.2 && npc.shield > 0) {
      this.tactic = 'melee';
      this.meleeT = 0;
      this.leaveCover();
      return;
    }
    // allies never stray far from the player
    if (this.isAlly) {
      const pl = G.player;
      const dl = Math.hypot(pl.pos.x - npc.pos.x, pl.pos.z - npc.pos.z);
      if (dl > 28) {
        const n = nav.randomNear(pl.pos, 3, 7);
        if (n >= 0 && npc.goTo(nav.pos(n, _v), def.run)) {
          this.leaveCover();
          this.tactic = 'advance';
          this.stateT = 0;
          return;
        }
      }
    }
    // badly hurt grunts fall back once
    if (!this.retreated && def.kind === 'assoc' && npc.health < npc.maxHealth * 0.36) {
      this.retreated = true;
      const c = nav.findCover(npc.pos, t.pos, 24, 12, 70, npc.id, true);
      if (c) {
        this.takeCover(c, 'retreat');
        npc.bark('cover', 8);
        return;
      }
    }
    if (this.tactic === 'inCover') {
      if (sinceSeen > 3.6 || this.stateT > this.coverStay) this.leaveCover();
      else return;
    }
    if ((this.tactic === 'toCover' || this.tactic === 'retreat' || this.tactic === 'advance') && !npc.arrived && this.stateT < 7) return;

    if (sinceSeen > 2.4) {
      // they went to ground: push up on where they were
      if (sinceSeen > 15 && !this.isAlly) {
        this.alert = 'search';
        this.stateT = 0;
        this.waitT = 0.5;
        this.leaveCover();
        npc.goTo(this.lastSeenPos, def.run * 0.8);
        npc.bark('search', 12);
        return;
      }
      if (this.hold) {
        this.tactic = 'hold';
        return;
      }
      const n = nav.randomNear(this.lastSeenPos, 2.5, 9);
      if (n >= 0 && npc.goTo(nav.pos(n, _v), def.run * 0.85)) {
        this.tactic = 'advance';
        this.stateT = 0;
      }
      return;
    }
    if (this.hold) {
      this.tactic = 'hold';
      return;
    }
    // in view: get behind something
    const band = this.isAlly ? [7, 42] : def.kind === 'super' ? [6, 26] : [9, 38];
    if (dist > 4.5) {
      const c = nav.findCover(npc.pos, t.pos, 17, band[0], band[1], npc.id);
      if (c && (c.pos.distanceToSquared(npc.pos) > 0.6 || this.tactic !== 'hold')) {
        this.takeCover(c, 'toCover');
        if (Math.random() < 0.25) npc.bark('cover', 10);
        return;
      }
    }
    // nothing to hide behind: keep shifting so we are not a statue
    if (this.tactic !== 'hold' || this.stateT > 2.6) {
      const n = nav.randomNear(npc.pos, 2, 5.5);
      if (n >= 0) npc.goTo(nav.pos(n, _v), def.walk * 1.7);
      this.tactic = 'hold';
      this.stateT = 0;
    }
  }

  private takeCover(c: { pos: THREE.Vector3; node: number; low: boolean }, tactic: Tactic) {
    const npc = this.npc;
    G.nav.release(npc.id);
    if (!npc.goTo(c.pos, npc.def.run)) return;
    G.nav.claim(c.node, npc.id);
    this.cover = c;
    this.tactic = tactic;
    this.stateT = 0;
    this.coverStay = rand(5, 10);
    this.steppedOut = false;
  }

  private leaveCover() {
    G.nav.release(this.npc.id);
    this.cover = null;
    this.npc.crouching = false;
    this.peeking = false;
    this.steppedOut = false;
    if (this.tactic === 'inCover') this.tactic = 'none';
  }

  private updateMelee(dt: number, t: Target, dist: number) {
    const npc = this.npc;
    const m = npc.def.melee!;
    npc.crouching = false;
    npc.wantFire = false;
    if (this.swingT >= 0) {
      this.swingT += dt / 0.45;
      npc.anim.swing = Math.min(1, this.swingT);
      if (this.swingT >= 0.45 && this.swingT - dt / 0.45 < 0.45 && dist < m.range + 0.5 && t.alive) {
        t.aimPoint(_tp);
        _v.copy(t.pos).sub(npc.pos).setY(0).normalize();
        t.takeDamage({ amount: m.dmg * npc.dmgScale, element: 'none', crit: false, kind: 'melee', source: npc, point: _tp.clone(), dir: _v.clone(), impulse: 4 });
        G.audio.play('melee_hit', { pos: npc.pos, vol: 0.9 });
        npc.bark('attack', 6);
      }
      if (this.swingT >= 1) {
        this.swingT = -1;
        npc.anim.swing = 0;
        this.meleeT = 0.5;
      }
      return;
    }
    this.meleeT -= dt;
    if (dist < m.range) {
      npc.stop();
      if (this.meleeT <= 0) {
        this.swingT = 0;
        G.audio.play('melee_swing', { pos: npc.pos, vol: 0.8 });
      }
    } else if (this.meleeT <= 0) {
      this.meleeT = 0.3;
      npc.goTo(t.pos, npc.def.run * 1.15);
    }
  }

  // ------------------------------------------------------------------ boss

  private updateBoss(dt: number) {
    const npc = this.npc;
    const def = npc.def;
    let t = this.target;
    if (!t || !t.alive) {
      this.target = t = this.pickAnyTarget() ?? (G.player.alive ? G.player : null);
      if (!t) {
        npc.wantFire = false;
        return;
      }
    }
    // it always knows roughly where you are
    if (!this.seen) this.lastSeenPos.lerp(t.pos, dt * 0.6);
    const dist = Math.hypot(t.pos.x - npc.pos.x, t.pos.z - npc.pos.z);
    this.aimAt(t);
    npc.focus = clamp(npc.focus + (this.seen ? dt * 0.3 : -dt * 0.5), 0, 1);
    this.mood = npc.health < npc.maxHealth * 0.5 ? 'hurt' : 'angry';
    if (!this.enraged && npc.health < npc.maxHealth * 0.5) {
      this.enraged = true;
      G.events.emit('managerHalf', { npc });
    }
    const facing = Math.abs(angleDelta(npc.yaw, npc.faceYaw ?? npc.yaw));

    // stomp when someone gets close
    this.stompCd -= dt;
    if (this.stompT >= 0) {
      this.stompT += dt;
      npc.anim.stomp = Math.min(1, this.stompT / 0.75);
      npc.wantFire = false;
      npc.stop();
      if (this.stompT >= 0.8) {
        this.stompT = -1;
        npc.anim.stomp = 0;
        this.stompCd = this.enraged ? 3.4 : 5;
        G.ai.shockwave(npc, 7, def.melee!.dmg * npc.dmgScale);
        npc.bark('attack', 5, true);
      }
      return;
    }
    if (dist < def.melee!.range && this.stompCd <= 0) {
      this.stompT = 0;
      G.audio.play('enemy_charge', { pos: npc.pos, vol: 0.9, pitch: 1.5, ref: 14 });
      return;
    }
    npc.wantFire = this.seen && facing < 0.4 && dist > 4;

    this.decideT -= dt;
    if (this.decideT <= 0) {
      this.decideT = rand(1.4, 2.4);
      if (dist > 22 || !this.seen) {
        const n = G.nav.randomNear(t.pos, 9, 15);
        if (n >= 0) npc.goTo(G.nav.pos(n, _v), this.enraged ? def.run : def.walk);
      } else if (dist < 9 && npc.moving) npc.stop();
    }
  }
}
