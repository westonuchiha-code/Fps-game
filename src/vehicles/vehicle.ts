import * as THREE from 'three';
import { G } from '../core/globals';
import { clamp, DEG, dirToYaw } from '../core/math';
import { hostile, type Target } from '../core/types';
import { BoxCollider, newMoveResult } from '../world/collision';
import type { Interactable } from '../world/world';
import type { LoopHandle } from '../audio/audio';
import { RigidBody } from './rigidbody';
import { ChaseCam } from './chasecam';

/** Anything that can ride in a non-driver seat (AI allies). The vehicle never moves them itself. */
export interface Passenger {
  alive: boolean;
  /** Called with the seat anchor when boarding and with (null, null) when getting off. */
  setSeat(seat: THREE.Object3D | null, vehicle: Vehicle | null): void;
}

export type SeatName = 'driver' | 'gunner' | 'passenger';

export interface ChassisSphere {
  p: THREE.Vector3;
  r: number;
}

const SUB_HZ = 120;
const UPV = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _c = new THREE.Vector3();
const _feet = new THREE.Vector3();
const _push = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _vp = new THREE.Vector3();
const _t = new THREE.Vector3();
const _j = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _local = new THREE.Vector3();
const _res = newMoveResult();

/**
 * Base vehicle: rigid body + fixed-rate sub-stepping, chassis-vs-world contacts, seats, enter/exit,
 * chase camera, self-righting, run-over damage and AI noise. Subclasses add propulsion (wheels, hover)
 * in `simulate()` and visuals in `animate()`.
 */
export abstract class Vehicle {
  abstract readonly name: string;
  readonly root = new THREE.Group();
  readonly body: RigidBody;
  readonly box: BoxCollider;
  /** box centre in body space */
  protected readonly boxCenter = new THREE.Vector3();
  readonly seats: Partial<Record<SeatName, THREE.Object3D>> = {};
  private readonly riders = new Map<SeatName, Passenger>();
  protected readonly spheres: ChassisSphere[] = [];
  /** front bumper volume (body space centre + half extents) for run-overs; mirrored for reversing */
  protected readonly bumper = { center: new THREE.Vector3(), half: new THREE.Vector3() };
  readonly cam: ChaseCam;
  readonly interactable: Interactable;
  /** seated player figure, shown while the player drives */
  protected driverFig: THREE.Object3D | null = null;
  occupied = false;
  speed = 0;
  /** signed speed along the vehicle's forward axis */
  forwardSpeed = 0;
  /** number of ground contacts (wheels touching / pads in range) during the last sub-step */
  groundContacts = 0;
  dead = false;
  /** contact friction/restitution of the chassis shell */
  protected shellFriction = 0.45;
  protected shellRestitution = 0.18;
  /** turn the player's E press into nothing for a few frames after boarding */
  private enterTime = -9;
  private flipT = 0;
  private stuckT = 0;
  private righting = false;
  private contactT = 0;
  private noiseT = 0;
  private impactCooldown = 0;
  private maxImpact = 0;
  private readonly contactNormal = new THREE.Vector3();
  private readonly hitCooldown = new Map<Target, number>();
  protected readonly spawnPos = new THREE.Vector3();
  protected spawnYaw = 0;
  protected engine: LoopHandle | null = null;
  /** input, refreshed every frame from the player while occupied */
  throttle = 0;
  steerIn = 0;
  /** desired heading from the camera (rad) and how strongly to follow it (0..1) */
  protected camYaw = 0;
  protected camFollow = 0;
  /** seat height offset of the player's feet below the seat anchor (keeps AI aim on the chest) */
  protected playerSeatDrop = 0.75;
  /** HUD speed multiplier */
  private hudT = 0;

  constructor(mass: number, inertiaBox: [number, number, number], boxHalf: [number, number, number]) {
    this.body = new RigidBody(mass, inertiaBox[0], inertiaBox[1], inertiaBox[2]);
    this.box = new BoxCollider(boxHalf[0], boxHalf[1], boxHalf[2]);
    this.box.owner = this;
    this.box.solid = true;
    this.box.opaque = true;
    this.cam = new ChaseCam(this);
    const self = this;
    this.interactable = {
      pos: new THREE.Vector3(),
      range: 3.4,
      enabled: true,
      label() {
        return self.occupied ? `Exit ${self.name}` : `Drive ${self.name}`;
      },
      onUse() {
        if (self.occupied) {
          if (G.time - self.enterTime > 0.25) self.exit();
        } else self.enter();
      },
    };
  }

  get pos() {
    return this.body.pos;
  }
  get vel() {
    return this.body.vel;
  }
  get quat() {
    return this.body.quat;
  }

  /** Called by subclasses once the model is built. */
  protected place(pos: THREE.Vector3, yaw: number) {
    this.spawnPos.copy(pos);
    this.spawnYaw = yaw;
    this.body.pos.copy(pos);
    this.body.quat.setFromAxisAngle(UPV, yaw);
    this.body.vel.set(0, 0, 0);
    this.body.angVel.set(0, 0, 0);
    G.scene.add(this.root);
    G.col.addBox(this.box);
    G.world.interactables.push(this.interactable);
    this.syncTransforms();
  }

  /** Shots that hit the bodywork still rattle whoever is driving (the player takes reduced damage inside). */
  onShot(damage: number, by: Target | null) {
    if (!this.occupied || !G.player.alive) return;
    G.player.takeDamage({ amount: damage, element: 'none', crit: false, kind: 'bullet', source: by, point: this.body.pos.clone(), dir: new THREE.Vector3(0, -1, 0) });
  }

  // ------------------------------------------------------------------ seats

  board(p: Passenger, seat: 'gunner' | 'passenger'): boolean {
    if (this.dead || !p.alive) return false;
    const anchor = this.seats[seat];
    if (!anchor || this.riders.has(seat)) return false;
    for (const r of this.riders.values()) if (r === p) return false;
    this.riders.set(seat, p);
    p.setSeat(anchor, this);
    return true;
  }
  unboard(p: Passenger) {
    for (const [k, r] of this.riders) {
      if (r === p) {
        this.riders.delete(k);
        p.setSeat(null, null);
        return true;
      }
    }
    return false;
  }
  /** First free AI seat (gunner preferred), or null. */
  freeSeat(): 'gunner' | 'passenger' | null {
    if (this.seats.gunner && !this.riders.has('gunner')) return 'gunner';
    if (this.seats.passenger && !this.riders.has('passenger')) return 'passenger';
    return null;
  }
  rider(seat: SeatName): Passenger | null {
    return this.riders.get(seat) ?? null;
  }

  // ------------------------------------------------------------------ enter / exit

  enter() {
    const pl = G.player;
    if (this.occupied || this.dead || !pl.alive || pl.vehicle) return;
    this.occupied = true;
    this.enterTime = G.time;
    pl.vehicle = this;
    pl.vel.set(0, 0, 0);
    pl.sprinting = pl.sliding = pl.crouching = false;
    // camera starts behind the vehicle
    this.body.dirToWorld(_v.set(0, 0, -1), _fwd);
    pl.yaw = dirToYaw(_fwd.x, _fwd.z);
    pl.pitch = -12 * DEG;
    // instant: the animated holster currently crashes ViewModel.update when the clip ends (see report)
    G.weapons.setHolstered(true, true);
    this.cam.reset();
    G.cameraOwner = this.cam;
    if (this.driverFig) this.driverFig.visible = true;
    G.audio.play('vehicle_enter', { pos: this.body.pos, vol: 0.9 });
    this.onEnter();
    this.gluePlayer();
  }

  exit() {
    const pl = G.player;
    if (!this.occupied) return;
    this.occupied = false;
    this.throttle = this.steerIn = 0;
    this.camFollow = 0;
    if (pl.vehicle === this) pl.vehicle = null;
    if (G.cameraOwner === this.cam) G.cameraOwner = null;
    if (this.driverFig) this.driverFig.visible = false;
    G.hud.setVehicle(null);
    G.weapons.setHolstered(false);
    // find a free spot beside the vehicle
    const spot = this.findExitSpot(_v2);
    pl.pos.copy(spot);
    pl.vel.copy(this.body.vel).multiplyScalar(0.45);
    pl.vel.y = Math.max(0, pl.vel.y) + 1.5;
    pl.pitch = clamp(pl.pitch, -0.6, 0.4);
    pl.grounded = false;
    G.audio.play('vehicle_exit', { pos: this.body.pos, vol: 0.9 });
    this.onExit();
  }

  private findExitSpot(out: THREE.Vector3) {
    const R = G.player.radius;
    const H = 1.8;
    for (const off of this.exitOffsets()) {
      this.body.localToWorld(off, _c);
      // stand on whatever is below that spot (never put the player inside a wall)
      _p.set(_c.x, this.body.pos.y + 1.4, _c.z);
      const gy = G.col.groundY(_p.x, _p.z, _p.y, 6);
      if (gy === null) continue;
      out.set(_c.x, gy + 0.05, _c.z);
      if (G.col.capsuleFree(out, R, H) && G.col.lineOfSight(_v.copy(this.body.pos).setY(this.body.pos.y + 0.8), _p.set(out.x, out.y + 1, out.z), this.box)) return out;
    }
    // fallback: on top of the vehicle
    out.copy(this.body.pos);
    out.y += 2.4;
    return out;
  }

  /** Candidate exit points in body space, best first. */
  protected exitOffsets(): THREE.Vector3[] {
    return [new THREE.Vector3(-1.6, 0, 0), new THREE.Vector3(1.6, 0, 0), new THREE.Vector3(0, 0, 3), new THREE.Vector3(0, 0, -3)];
  }

  protected onEnter() {}
  protected onExit() {}

  private gluePlayer() {
    const pl = G.player;
    const seat = this.seats.driver;
    if (!seat) return;
    seat.getWorldPosition(pl.pos);
    pl.pos.y -= this.playerSeatDrop;
    pl.vel.copy(this.body.vel);
    // interact prompt sits at the eye so "Exit" always wins focus while seated
    pl.eyePos(this.interactable.pos);
  }

  // ------------------------------------------------------------------ frame

  update(dt: number) {
    if (this.dead) return;
    const pl = G.player;
    dt = Math.min(dt, 0.05);
    if (this.occupied) {
      if (pl.vehicle !== this) {
        // the game cleared us (respawn etc.)
        this.occupied = false;
        if (G.cameraOwner === this.cam) G.cameraOwner = null;
        if (this.driverFig) this.driverFig.visible = false;
        G.hud.setVehicle(null);
        this.onExit();
      } else {
        const inp = G.input;
        if (pl.alive && !pl.frozen) {
          pl.yaw -= inp.lookX;
          pl.pitch = clamp(pl.pitch - inp.lookY, this.cam.minPitch, this.cam.maxPitch);
          this.throttle = inp.moveY;
          this.steerIn = inp.moveX;
          this.camYaw = pl.yaw;
          this.camFollow = Math.abs(this.throttle) > 0.1 ? 1 : 0;
        } else {
          this.throttle = this.steerIn = 0;
          this.camFollow = 0;
        }
        this.driverInput(dt);
      }
    }
    for (const [k, r] of this.riders) {
      if (!r.alive) {
        this.riders.delete(k);
        r.setSeat(null, null);
      }
    }

    // fixed-size sub-steps (at most 1/120 s each)
    const n = Math.max(1, Math.ceil(dt * SUB_HZ - 1e-3));
    const h = dt / n;
    this.maxImpact = 0;
    for (let i = 0; i < n; i++) {
      this.simulate(h);
      this.assists(h);
      this.body.integrate(h);
      this.collide(h);
    }
    this.speed = this.body.vel.length();
    this.body.dirToWorld(_v.set(0, 0, -1), _fwd);
    this.forwardSpeed = this.body.vel.dot(_fwd);
    this.syncTransforms();
    this.afterStep(dt);
    this.onImpacts(dt);
    this.unstick(dt);
    this.runOver(dt);
    this.animate(dt);

    if (this.occupied) {
      this.gluePlayer();
      this.hudT -= dt;
      if (this.hudT <= 0) {
        this.hudT = 0.1;
        G.hud.setVehicle(this.name, Math.abs(this.forwardSpeed) * 3.6);
      }
      this.noiseT -= dt;
      if (this.noiseT <= 0) {
        this.noiseT = 0.6;
        G.world.noise(this.body.pos, 22 + this.speed * 1.6, 'vehicle', G.player);
      }
      // the "Exit" prompt only shows while stopped (and briefly after boarding); E always works
      this.interactable.enabled = this.speed < 2.5 || G.time - this.enterTime < 4;
      if (!this.interactable.enabled && G.input.pressed('interact') && G.time - this.enterTime > 0.25) this.exit();
    } else {
      this.interactable.enabled = true;
      // the use-point is the spot on the (slightly inflated) collider nearest the player's eye, so it is
      // never hidden inside our own opaque box and works from any side
      pl.eyePos(_v);
      this.body.worldToLocal(_v, _local).sub(this.boxCenter);
      const hb = this.box.half;
      _local.set(clamp(_local.x, -hb.x - 0.15, hb.x + 0.15), clamp(_local.y, -hb.y - 0.15, hb.y + 0.15), clamp(_local.z, -hb.z - 0.15, hb.z + 0.15));
      _local.add(this.boxCenter);
      this.body.localToWorld(_local, this.interactable.pos);
    }
    if (this.body.pos.y < G.killY) this.respawn();
  }

  lateUpdate(_dt: number) {}

  /** Read extra controls (horn, boost, guns). Called once per frame while the player drives. */
  protected driverInput(_dt: number) {}
  /** Accumulate forces for one sub-step. */
  protected abstract simulate(h: number): void;
  /** After all sub-steps of a frame (audio, effects). */
  protected afterStep(_dt: number) {}
  /** Visual animation (wheels, turret, banking). */
  protected abstract animate(dt: number): void;

  syncTransforms() {
    this.root.position.copy(this.body.pos);
    this.root.quaternion.copy(this.body.quat);
    this.root.updateMatrixWorld(true);
    _c.copy(this.boxCenter).applyQuaternion(this.body.quat).add(this.body.pos);
    this.box.set(_c, this.body.quat);
  }

  respawn() {
    if (this.occupied) this.exit();
    this.body.pos.copy(this.spawnPos);
    this.body.pos.y += 1;
    this.body.quat.setFromAxisAngle(UPV, this.spawnYaw);
    this.body.vel.set(0, 0, 0);
    this.body.angVel.set(0, 0, 0);
    this.syncTransforms();
  }

  // ------------------------------------------------------------------ physics helpers

  /** Keep-upright assist: always-on leveling in the air, gentle anti-tip on the ground, strong self-righting when flipped. */
  protected assists(h: number) {
    const b = this.body;
    b.dirToWorld(_v.set(0, 1, 0), _up);
    const tilt = Math.acos(clamp(_up.y, -1, 1));
    _axis.crossVectors(_up, UPV);
    const s = _axis.length();
    if (s < 0.05) {
      // (nearly) upright or exactly upside down: roll over sideways
      if (_up.y > 0) return;
      b.dirToWorld(_v.set(0, 0, -1), _axis);
    } else _axis.multiplyScalar(1 / s);
    let want = 0;
    let rate = 0;
    if (this.righting) {
      want = clamp(tilt * 3, 0.9, 3.2);
      rate = 6;
      if (_up.y > 0.9) this.righting = false;
    } else if (this.groundContacts === 0) {
      want = tilt * this.airLevel;
      rate = this.airLevelRate;
    } else if (tilt > this.tiltStart) {
      want = (tilt - this.tiltStart) * 2.5;
      rate = this.tiltRate;
    }
    if (rate <= 0) return;
    // velocity servo on the horizontal spin (mass independent, never touches yaw)
    _v.copy(_axis).multiplyScalar(want);
    _v.x -= b.angVel.x;
    _v.z -= b.angVel.z;
    _v.y = 0;
    b.angVel.addScaledVector(_v, Math.min(1, rate * h));
  }
  /** air leveling: target spin per radian of tilt, and how fast to reach it */
  protected airLevel = 1.5;
  protected airLevelRate = 1.2;
  /** ground anti-tip: starts past this tilt */
  protected tiltStart = 40 * DEG;
  protected tiltRate = 1.5;

  /** Spheres vs level + other boxes; position correction and impulse response. */
  private collide(h: number) {
    const b = this.body;
    let touched = false;
    for (const s of this.spheres) {
      b.localToWorld(s.p, _c);
      _feet.set(_c.x, _c.y - s.r, _c.z);
      _push.copy(_feet);
      _res.grounded = _res.hitWall = _res.hitCeiling = false;
      G.col.resolveCapsule(_push, s.r, s.r * 2, _res, this.box);
      _push.sub(_feet);
      const d2 = _push.lengthSq();
      if (d2 < 1e-10) continue;
      touched = true;
      const d = Math.sqrt(d2);
      _n.copy(_push).multiplyScalar(1 / d);
      this.contactNormal.lerp(_n, 0.3);
      // positional correction (slightly soft so stacked contacts do not jitter)
      b.pos.addScaledVector(_push, d > 0.02 ? 1 : 0.8);
      // contact point on the sphere surface
      _p.copy(_c).add(_push).addScaledVector(_n, -s.r);
      b.pointVelocity(_p, _vp);
      const vn = _vp.dot(_n);
      if (vn < 0) {
        if (-vn > this.maxImpact) this.maxImpact = -vn;
        const e = -vn > 2 ? this.shellRestitution : 0;
        const jn = (-(1 + e) * vn) / b.invMassAt(_p, _n);
        _j.copy(_n).multiplyScalar(jn);
        b.applyImpulseAt(_j, _p);
        // friction
        b.pointVelocity(_p, _vp);
        _t.copy(_vp).addScaledVector(_n, -_vp.dot(_n));
        const vt = _t.length();
        if (vt > 1e-4) {
          _t.multiplyScalar(1 / vt);
          const jt = Math.min(vt / b.invMassAt(_p, _t), this.shellFriction * jn);
          _j.copy(_t).multiplyScalar(-jt);
          b.applyImpulseAt(_j, _p);
        }
      }
    }
    if (touched) this.contactT = 0.25;
    else this.contactT = Math.max(0, this.contactT - h);
  }

  private onImpacts(dt: number) {
    this.impactCooldown -= dt;
    const imp = this.maxImpact;
    if (imp > 4 && this.impactCooldown <= 0) {
      this.impactCooldown = 0.25;
      const f = clamp((imp - 4) / 12, 0, 1);
      G.audio.play('truck_impact', { pos: this.body.pos, vol: 0.35 + f * 0.65, pitchVar: 0.08, pitch: this.impactPitch });
      G.world.noise(this.body.pos, 18 + f * 20, 'impact', this.occupied ? G.player : null);
      if (this.occupied) {
        this.cam.kick(0.25 + f * 0.6);
      }
      this.onCrash(f);
    }
  }
  protected impactPitch = 1;
  protected onCrash(_strength: number) {}

  /** Self-right when upside down, hop free when wedged. */
  private unstick(dt: number) {
    const b = this.body;
    b.dirToWorld(_v.set(0, 1, 0), _up);
    const tipped = _up.y < 0.35;
    if (tipped && this.speed < 5) this.flipT += dt;
    else this.flipT = Math.max(0, this.flipT - dt * 2);
    if (this.flipT > 1.2 && !this.righting) {
      this.righting = true;
      this.flipT = 0;
      // hop so the roof/side lifts off and there is room to roll over
      if (this.contactT > 0 || this.groundContacts > 0) b.vel.y = Math.max(b.vel.y, 4.2);
    }
    // wedged: holding throttle, touching something, not moving
    const trying = this.occupied && Math.abs(this.throttle) > 0.5;
    // (on all wheels against a wall is not stuck: just reverse)
    const wedged = this.contactT > 0 && (this.groundContacts < 3 || _up.y < 0.8);
    if (trying && this.speed < 0.6 && wedged) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 2) {
      this.stuckT = 0;
      b.vel.y = Math.max(b.vel.y, 3.5);
      // nudge away from whatever we are hung on, and the way the driver wants to go
      b.vel.addScaledVector(this.contactNormal.setY(0).normalize(), 1.5);
      b.dirToWorld(_v.set(0, 0, -1), _fwd);
      _fwd.y = 0;
      b.vel.addScaledVector(_fwd.normalize(), 3.2 * Math.sign(this.throttle));
      b.pos.y += 0.25;
      this.righting = _up.y < 0.9;
    }
  }

  private runOver(dt: number) {
    if (this.hitCooldown.size) for (const [t, until] of this.hitCooldown) if (G.time > until) this.hitCooldown.delete(t);
    const sp = Math.abs(this.forwardSpeed);
    if (sp < 4.5) return;
    if (!this.occupied) return;
    const dirSign = this.forwardSpeed >= 0 ? 1 : -1;
    const bc = this.bumper.center;
    const bh = this.bumper.half;
    for (const t of G.world.targets) {
      if (t === (G.player as Target) || !t.alive || !hostile('player', t.faction)) continue;
      if (this.hitCooldown.has(t)) continue;
      // quick reject
      if (t.pos.distanceToSquared(this.body.pos) > 49) continue;
      this.body.worldToLocal(_v.set(t.pos.x, t.pos.y + t.height * 0.4, t.pos.z), _local);
      const lz = _local.z * dirSign;
      if (Math.abs(_local.x - bc.x) > bh.x + t.radius) continue;
      if (Math.abs(_local.y - bc.y) > bh.y + t.height * 0.4) continue;
      if (Math.abs(lz - bc.z) > bh.z + t.radius) continue;
      const amount = clamp((sp - 3) * (sp - 3) * 0.6 + sp * 4, 20, 600) * this.ramMult;
      _v.copy(this.body.vel).normalize();
      _v.y = Math.max(_v.y, 0.35);
      _v.normalize();
      const wasAlive = t.alive;
      t.takeDamage({
        amount,
        element: 'none',
        crit: false,
        kind: 'vehicle',
        source: G.player,
        point: t.pos.clone().setY(t.pos.y + t.height * 0.5),
        dir: _v.clone(),
        impulse: 6 + sp * 0.6,
      });
      this.hitCooldown.set(t, G.time + 0.6);
      if (wasAlive && !t.alive) G.stats.roadkills++;
      G.hud.hitmarker(false, wasAlive && !t.alive);
      G.audio.play('truck_impact', { pos: t.pos, vol: 0.6, pitch: 1.25, pitchVar: 0.1 });
      this.cam.kick(0.25);
      // the hit costs a little speed
      this.body.vel.multiplyScalar(1 - clamp(0.6 * this.ramDrag, 0, 0.3));
    }
    void dt;
  }
  protected ramMult = 1;
  protected ramDrag = 0.1;

  /** Body-space up vector of the chassis in world space. */
  protected upVec(out: THREE.Vector3) {
    return this.body.dirToWorld(_v.set(0, 1, 0), out);
  }

  /** Disable the own collider while tracing our own guns (muzzles sit inside/near it). */
  protected withoutBox<T>(fn: () => T): T {
    const en = this.box.enabled;
    this.box.enabled = false;
    try {
      return fn();
    } finally {
      this.box.enabled = en;
    }
  }

  dispose() {
    if (this.dead) return;
    if (this.occupied) this.exit();
    for (const r of [...this.riders.values()]) this.unboard(r);
    this.dead = true;
    this.engine?.stop(0.1);
    this.engine = null;
    this.onDispose();
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    G.col.removeBox(this.box);
    G.world.remove(G.world.interactables, this.interactable);
  }
  protected onDispose() {}
}

