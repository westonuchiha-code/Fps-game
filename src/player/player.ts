import * as THREE from 'three';
import { G } from '../core/globals';
import { clamp, damp, lerp, Spring, yawToDir, DEG, rand, smoothstep } from '../core/math';
import { newMoveResult, type MoveResult } from '../world/collision';
import { Surf } from '../world/builder';
import { newId, type DamageInfo, type Faction, type Target } from '../core/types';

export const P = {
  radius: 0.36,
  standH: 1.8,
  crouchH: 1.12,
  eyeStand: 1.64,
  eyeCrouch: 1.0,
  walk: 5.3,
  sprint: 8.0,
  crouch: 2.9,
  ads: 3.4,
  accel: 11,
  friction: 9,
  stopSpeed: 2.2,
  airAccel: 2.4,
  gravity: 21,
  jumpV: 7.6,
  coyote: 0.12,
  jumpBuffer: 0.13,
  slideBoost: 10,
  slideFriction: 1.15,
  slideMinSpeed: 6.2,
  slideTime: 0.85,
  stepHeight: 0.42,
  snap: 0.36,
  mantleMin: 0.55,
  mantleMax: 2.25,
  baseHealth: 100,
};

const _wish = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _save = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const DOWN = new THREE.Vector3(0, -1, 0);

export class Player implements Target {
  readonly id = newId();
  faction: Faction = 'player';
  alive = true;
  label = 'Clearance';
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  radius = P.radius;
  height = P.standH;
  yaw = 0;
  pitch = 0;

  grounded = false;
  crouching = false;
  sprinting = false;
  sliding = false;
  mantling = false;
  /** set by the vehicle the player is riding; movement is suspended while non-null */
  vehicle: { exit(): void } | null = null;
  /** cutscenes / menus freeze control but keep the camera */
  frozen = false;
  /** external camera override (cutscenes, death cam, vehicles) */
  cameraLocked = false;

  health = P.baseHealth;
  maxHealth = P.baseHealth;
  shield = 0;
  shieldMax = 0;
  shieldDelay = 3;
  shieldRate = 20;
  private shieldTimer = 0;
  private shieldWasFull = true;
  private shieldCharging = false;
  lastDamageTime = -99;
  godMode = false;

  eyeHeight = P.eyeStand;
  /** horizontal speed, m/s */
  speed = 0;
  /** 0..1 how "moving" the player is, for viewmodel bob */
  moveAmount = 0;
  bobPhase = 0;
  /** camera-space kick springs */
  readonly landSpring = new Spring(160, 16);
  readonly recoilPitch = new Spring(260, 26);
  readonly recoilYaw = new Spring(260, 26);
  private recoilTargetP = 0;
  private recoilTargetY = 0;
  private recoilHold = 0;
  trauma = 0;
  roll = 0;
  fov = 74;
  baseFov = 74;
  /** extra FOV requested by gameplay (sprint, slide) */
  private fovKick = 0;
  airTime = 0;
  /** stats for the mission report */
  distance = 0;

  private res: MoveResult = newMoveResult();
  private res2: MoveResult = newMoveResult();
  private coyote = 0;
  private jumpBuf = 0;
  private slideT = 0;
  private slideCooldown = 0;
  private slideDir = new THREE.Vector3();
  private stepAcc = 0;
  private mantleT = 0;
  private mantleDur = 0.4;
  private mantleFrom = new THREE.Vector3();
  private mantleTo = new THREE.Vector3();
  private lastGroundSurf: Surf = Surf.Concrete;
  private shakeSeed = Math.random() * 100;
  private deathT = 0;
  private wasGrounded = false;
  private heartbeat: ReturnType<typeof G.audio.loop> | null = null;

  spawn(pos: THREE.Vector3, yaw: number) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.alive = true;
    this.health = this.maxHealth;
    this.shield = this.shieldMax;
    this.crouching = this.sliding = this.mantling = this.sprinting = false;
    this.height = P.standH;
    this.eyeHeight = P.eyeStand;
    this.deathT = 0;
    this.trauma = 0;
    this.frozen = false;
    this.vehicle = null;
    this.recoilPitch.reset();
    this.recoilYaw.reset();
    this.recoilTargetP = this.recoilTargetY = 0;
  }

  aimPoint(out: THREE.Vector3) {
    return out.set(this.pos.x, this.pos.y + this.height * 0.68, this.pos.z);
  }
  headPoint(out: THREE.Vector3) {
    return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }
  eyePos(out: THREE.Vector3) {
    return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }
  /** Unit vector the player is looking along (without recoil). */
  lookDir(out: THREE.Vector3) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  // ------------------------------------------------------------ damage

  takeDamage(d: DamageInfo) {
    if (!this.alive || this.godMode) return;
    let amount = d.amount * G.difficulty.damageTaken;
    if (this.vehicle) amount *= 0.55;
    this.lastDamageTime = G.time;
    this.shieldTimer = this.shieldDelay;
    this.shieldCharging = false;
    let toHealth = amount;
    if (this.shield > 0) {
      const mult = d.element === 'shock' ? 1.6 : d.element === 'fire' ? 0.7 : 1;
      const absorbed = Math.min(this.shield, amount * mult);
      this.shield -= absorbed;
      toHealth = amount - absorbed / mult;
      if (this.shield <= 0.01) {
        this.shield = 0;
        G.audio.play('shield_break', { vol: 0.9 });
        G.hud.flash(0x66ccff, 0.35);
        G.events.emit('shieldBreak', {});
      } else G.audio.play('shield_hit', { vol: 0.7, pitchVar: 0.08 });
    }
    if (toHealth > 0.01) {
      this.health -= toHealth;
      G.audio.play('player_hurt', { vol: 0.9, pitchVar: 0.08 });
    }
    this.trauma = Math.min(1, this.trauma + clamp(amount / 45, 0.12, 0.6));
    G.hud.damageFrom(d.source ? d.source.pos : d.point, toHealth > 0.01);
    G.stats.damageTaken += amount;
    if (this.health <= 0) {
      this.health = 0;
      this.die(d);
    }
  }

  heal(n: number) {
    this.health = Math.min(this.maxHealth, this.health + n);
  }

  private die(d: DamageInfo) {
    this.alive = false;
    this.deathT = 0;
    this.sliding = this.sprinting = false;
    if (this.vehicle) this.vehicle.exit();
    G.audio.play('player_hurt', { vol: 1, pitch: 0.7 });
    G.onPlayerDeath(d);
  }

  setShield(max: number, delay: number, rate: number, refill = false) {
    this.shieldMax = max;
    this.shieldDelay = delay;
    this.shieldRate = rate;
    if (refill) this.shield = max;
    else this.shield = Math.min(this.shield, max);
  }

  addRecoil(pitch: number, yaw: number) {
    this.recoilTargetP += pitch;
    this.recoilTargetY += yaw;
    this.recoilHold = 0.09;
  }
  addTrauma(t: number) {
    this.trauma = Math.min(1, this.trauma + t);
  }
  /** Shake from an explosion at `p`. */
  shakeFrom(p: THREE.Vector3, power: number, radius: number) {
    const d = p.distanceTo(this.pos);
    if (d < radius) this.addTrauma(power * (1 - d / radius));
  }

  // ------------------------------------------------------------ update

  update(dt: number) {
    const inp = G.input;
    this.updateShield(dt);
    if (!this.alive) {
      this.deathT += dt;
      this.vel.y -= P.gravity * dt;
      this.vel.x = damp(this.vel.x, 0, 5, dt);
      this.vel.z = damp(this.vel.z, 0, 5, dt);
      _delta.copy(this.vel).multiplyScalar(dt);
      G.col.moveCapsule(this.pos, this.radius, 0.8, _delta, this.res);
      if (this.res.grounded) this.vel.y = 0;
      this.eyeHeight = damp(this.eyeHeight, 0.35, 5, dt);
      this.roll = damp(this.roll, 0.9, 4, dt);
      return;
    }
    if (this.vehicle) {
      this.speed = 0;
      this.moveAmount = 0;
      return;
    }

    // ---- look ----
    if (!this.frozen) {
      this.yaw -= inp.lookX;
      this.pitch = clamp(this.pitch - inp.lookY, -88 * DEG, 88 * DEG);
    }

    if (this.mantling) {
      this.updateMantle(dt);
      this.updateTimers(dt);
      return;
    }

    const mx = this.frozen ? 0 : inp.moveX;
    const my = this.frozen ? 0 : inp.moveY;
    yawToDir(this.yaw, _fwd);
    _right.set(-_fwd.z, 0, _fwd.x);
    _wish.set(0, 0, 0).addScaledVector(_fwd, my).addScaledVector(_right, mx);
    const wishLen = _wish.length();
    if (wishLen > 1e-4) _wish.multiplyScalar(1 / wishLen);

    const ads = G.weapons.adsAmount > 0.5;
    const wantCrouch = !this.frozen && inp.isDown('crouch');
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);

    // ---- slide ----
    this.slideCooldown -= dt;
    if (!this.frozen && inp.pressed('crouch') && this.grounded && !this.sliding && this.sprinting && hSpeed > P.slideMinSpeed && this.slideCooldown <= 0) {
      this.sliding = true;
      this.slideT = 0;
      this.slideDir.set(this.vel.x, 0, this.vel.z).normalize();
      const boost = Math.max(hSpeed, P.slideBoost);
      this.vel.x = this.slideDir.x * boost;
      this.vel.z = this.slideDir.z * boost;
      G.audio.play('slide', { vol: 0.7 });
      G.world.noise(this.pos, 9, 'step', this);
    }
    if (this.sliding) {
      this.slideT += dt;
      if (this.slideT > P.slideTime || hSpeed < 3.2 || !this.grounded || !wantCrouch) {
        if (this.grounded || this.slideT > 0.1) {
          this.sliding = false;
          this.slideCooldown = 0.35;
        }
      }
    }

    // ---- crouch / stand ----
    let crouch = wantCrouch || this.sliding;
    if (!crouch && this.crouching) {
      // only stand up if there is headroom
      if (!G.col.capsuleFree(_tmp.copy(this.pos).setY(this.pos.y + 0.05), this.radius * 0.9, P.standH)) crouch = true;
    }
    this.crouching = crouch;
    const targetH = crouch ? P.crouchH : P.standH;
    this.height = damp(this.height, targetH, 16, dt);
    this.eyeHeight = damp(this.eyeHeight, this.sliding ? P.eyeCrouch - 0.12 : crouch ? P.eyeCrouch : P.eyeStand, 13, dt);

    // ---- sprint ----
    const canSprint = !crouch && !ads && my > 0.35 && Math.abs(mx) < 0.75 && !G.weapons.blocksSprint;
    if (inp.device === 'touch') this.sprinting = canSprint && my > 0.92;
    else this.sprinting = canSprint && inp.isDown('sprint');

    let maxSpeed = this.sprinting ? P.sprint : crouch ? P.crouch : ads ? P.ads : P.walk;
    maxSpeed *= G.weapons.moveScale;
    if (my < -0.1) maxSpeed *= 0.86;

    // ---- jump ----
    this.jumpBuf -= dt;
    this.coyote -= dt;
    if (!this.frozen && inp.pressed('jump')) this.jumpBuf = P.jumpBuffer;
    if (this.grounded) this.coyote = P.coyote;

    if (this.jumpBuf > 0 && this.coyote > 0) {
      this.jumpBuf = 0;
      this.coyote = 0;
      this.vel.y = P.jumpV;
      this.grounded = false;
      if (this.sliding) {
        this.sliding = false;
        this.slideCooldown = 0.25;
      }
      G.audio.play('jump', { vol: 0.5, pitchVar: 0.05 });
      this.landSpring.kick(0.5);
    }

    // ---- horizontal velocity ----
    if (this.grounded) {
      if (this.sliding) {
        this.applyFriction(P.slideFriction, 0, dt);
        // a little steering while sliding
        if (wishLen > 0) this.accelerate(_wish, 2.5, 3, dt);
      } else {
        this.applyFriction(P.friction, P.stopSpeed, dt);
        if (wishLen > 0) this.accelerate(_wish, maxSpeed * Math.min(1, wishLen), P.accel, dt);
      }
    } else if (wishLen > 0) {
      this.accelerate(_wish, Math.min(maxSpeed, P.walk) * 0.42, P.airAccel * 6, dt);
    }

    // ---- gravity ----
    if (!this.grounded) this.vel.y = Math.max(this.vel.y - P.gravity * dt, -50);
    else if (this.vel.y < 0) this.vel.y = 0;

    // ---- integrate ----
    this.wasGrounded = this.grounded;
    const vyBefore = this.vel.y;
    _delta.copy(this.vel).multiplyScalar(dt);
    _save.copy(this.pos);
    G.col.moveCapsule(this.pos, this.radius, this.height, _delta, this.res);

    // step-up: blocked by a low obstacle while walking on the ground
    if (this.res.hitWall && this.wasGrounded && this.vel.y <= 0.01 && wishLen > 0) {
      const flat1 = Math.hypot(this.pos.x - _save.x, this.pos.z - _save.z);
      _tmp.copy(_save);
      _tmp.y += P.stepHeight;
      if (G.col.capsuleFree(_tmp, this.radius * 0.95, this.height)) {
        _tmp2.set(_delta.x, 0, _delta.z);
        G.col.moveCapsule(_tmp, this.radius, this.height, _tmp2, this.res2);
        _tmp2.set(0, -P.stepHeight - 0.05, 0);
        G.col.moveCapsule(_tmp, this.radius, this.height, _tmp2, this.res2);
        const flat2 = Math.hypot(_tmp.x - _save.x, _tmp.z - _save.z);
        if (this.res2.grounded && flat2 > flat1 * 1.15 + 0.004 && _tmp.y - _save.y > 0.02 && _tmp.y - _save.y <= P.stepHeight + 0.02) {
          this.pos.copy(_tmp);
          this.res.grounded = true;
          this.res.hitWall = false;
          this.res.groundNormal.copy(this.res2.groundNormal);
          this.res.surf = this.res2.surf;
          this.landSpring.kick(0.35);
        }
      }
    }

    // snap down slopes / small drops so walking downhill does not become hopping
    if (!this.res.grounded && this.wasGrounded && this.vel.y <= 0.01) {
      const hit = G.col.raycast(_tmp.set(this.pos.x, this.pos.y + this.radius, this.pos.z), DOWN, this.radius + P.snap, 'solid');
      if (hit && hit.normal.y > 0.68) {
        this.pos.y = hit.point.y + (this.radius / hit.normal.y - this.radius);
        this.res.grounded = true;
        this.res.groundNormal.copy(hit.normal);
        this.res.surf = hit.surf;
      }
    }

    if (this.res.hitCeiling && this.vel.y > 0) this.vel.y = 0;
    if (this.res.hitWall) {
      // lose the velocity component going into the wall
      const n = this.res.wallNormal;
      const vn = this.vel.x * n.x + this.vel.z * n.z;
      if (vn < 0) {
        this.vel.x -= n.x * vn;
        this.vel.z -= n.z * vn;
      }
    }

    this.grounded = this.res.grounded && this.vel.y <= 0.5;
    if (this.grounded) {
      this.lastGroundSurf = this.res.surf;
      if (!this.wasGrounded) this.onLand(-vyBefore);
      this.vel.y = 0;
      this.airTime = 0;
    } else this.airTime += dt;

    // ---- mantle ----
    if (!this.grounded && !this.frozen && my > 0.3 && this.vel.y > -9 && (inp.isDown('jump') || this.airTime > 0.12)) this.tryMantle();

    // ---- bookkeeping ----
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.distance += this.speed * dt;
    const moving = this.grounded && !this.sliding ? clamp(this.speed / P.walk, 0, 1.6) : 0;
    this.moveAmount = damp(this.moveAmount, moving, 10, dt);
    if (this.grounded && !this.sliding && this.speed > 0.8) {
      const stride = this.sprinting ? 2.5 : crouch ? 1.5 : 2.05;
      this.bobPhase += (this.speed / stride) * Math.PI * dt;
      this.stepAcc += (this.speed / stride) * dt;
      if (this.stepAcc >= 1) {
        this.stepAcc -= 1;
        this.footstep(this.sprinting ? 0.75 : crouch ? 0.25 : 0.5);
      }
    } else this.stepAcc = Math.min(this.stepAcc, 0.6);

    this.updateTimers(dt);
    if (this.pos.y < G.killY) this.takeDamage({ amount: 9999, element: 'none', crit: false, kind: 'fall', source: null, point: this.pos.clone(), dir: DOWN });
  }

  private updateTimers(dt: number) {
    // recoil: quick rise to the target, then the target relaxes back to zero
    this.recoilHold -= dt;
    if (this.recoilHold <= 0) {
      this.recoilTargetP = damp(this.recoilTargetP, 0, 7.5, dt);
      this.recoilTargetY = damp(this.recoilTargetY, 0, 7.5, dt);
    }
    this.recoilPitch.update(this.recoilTargetP, dt);
    this.recoilYaw.update(this.recoilTargetY, dt);
    this.landSpring.update(0, dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.35);
  }

  private updateShield(dt: number) {
    if (!this.alive) {
      this.heartbeat?.stop();
      this.heartbeat = null;
      return;
    }
    if (this.shieldMax > 0 && this.shield < this.shieldMax) {
      this.shieldTimer -= dt;
      if (this.shieldTimer <= 0) {
        if (!this.shieldCharging) {
          this.shieldCharging = true;
          G.audio.play('shield_recharge', { vol: 0.6 });
        }
        this.shield = Math.min(this.shieldMax, this.shield + this.shieldRate * dt);
      }
      this.shieldWasFull = false;
    } else if (!this.shieldWasFull) {
      this.shieldWasFull = true;
      this.shieldCharging = false;
    }
    const low = this.health < this.maxHealth * 0.3;
    if (low && !this.heartbeat) this.heartbeat = G.audio.loop('heartbeat_loop', { vol: 0.8, bus: 'ui' });
    else if (!low && this.heartbeat) {
      this.heartbeat.stop(0.4);
      this.heartbeat = null;
    }
  }

  private accelerate(dir: THREE.Vector3, wishSpeed: number, accel: number, dt: number) {
    const cur = this.vel.x * dir.x + this.vel.z * dir.z;
    const add = wishSpeed - cur;
    if (add <= 0) return;
    const a = Math.min(accel * wishSpeed * dt, add);
    this.vel.x += dir.x * a;
    this.vel.z += dir.z * a;
  }

  private applyFriction(friction: number, stopSpeed: number, dt: number) {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp < 0.02) {
      this.vel.x = this.vel.z = 0;
      return;
    }
    const drop = Math.max(sp, stopSpeed) * friction * dt;
    const k = Math.max(0, sp - drop) / sp;
    this.vel.x *= k;
    this.vel.z *= k;
  }

  private onLand(impact: number) {
    if (impact > 2.5) {
      this.landSpring.kick(-clamp(impact * 0.22, 0.4, 3.2));
      G.audio.play('land', { vol: clamp(impact / 12, 0.3, 1), pitchVar: 0.06 });
      G.weapons.onLand(impact);
      if (impact > 7) G.world.noise(this.pos, 12, 'step', this);
    }
    this.stepAcc = 0;
  }

  private footstep(vol: number) {
    const s = this.lastGroundSurf;
    const name = s === Surf.Metal ? 'footstep_metal' : s === Surf.Sand || s === Surf.Rock ? 'footstep_sand' : 'footstep_concrete';
    G.audio.play(name, { vol: vol * 0.8, pitchVar: 0.07 });
    if (this.sprinting) G.world.noise(this.pos, 11, 'step', this);
    else if (!this.crouching) G.world.noise(this.pos, 5, 'step', this);
  }

  // ------------------------------------------------------------ mantle

  private tryMantle() {
    yawToDir(this.yaw, _fwd);
    // wall in front at chest height?
    const chest = _tmp.set(this.pos.x, this.pos.y + 1.0, this.pos.z);
    const wall = G.col.raycast(chest, _fwd, this.radius + 0.55, 'solid');
    if (!wall || Math.abs(wall.normal.y) > 0.4) return;
    // find the top of the ledge
    const probe = _tmp2.copy(wall.point).addScaledVector(_fwd, 0.32);
    probe.y = this.pos.y + P.mantleMax + 0.3;
    const top = G.col.raycast(probe, DOWN, P.mantleMax + 0.3 - P.mantleMin, 'solid');
    if (!top || top.normal.y < 0.7) return;
    const h = top.point.y - this.pos.y;
    if (h < P.mantleMin || h > P.mantleMax) return;
    // room to stand (crouched) on top, and nothing between us and the space above the ledge
    const dest = new THREE.Vector3(top.point.x, top.point.y + 0.04, top.point.z);
    if (!G.col.capsuleFree(dest, this.radius * 0.9, P.crouchH)) return;
    const above = _tmp.set(this.pos.x, top.point.y + 0.3, this.pos.z);
    if (!G.col.capsuleFree(above, this.radius * 0.8, P.crouchH * 0.8)) return;
    this.mantling = true;
    this.mantleT = 0;
    this.mantleDur = lerp(0.26, 0.5, smoothstep(P.mantleMin, P.mantleMax, h));
    this.mantleFrom.copy(this.pos);
    this.mantleTo.copy(dest);
    this.vel.set(0, 0, 0);
    this.sliding = false;
    G.audio.play('mantle', { vol: 0.6 });
    G.weapons.onMantle(this.mantleDur);
  }

  private updateMantle(dt: number) {
    this.mantleT += dt / this.mantleDur;
    const t = clamp(this.mantleT, 0, 1);
    // rise first, then move over the lip
    const up = smoothstep(0, 0.7, t);
    const fw = smoothstep(0.35, 1, t);
    this.pos.x = lerp(this.mantleFrom.x, this.mantleTo.x, fw);
    this.pos.z = lerp(this.mantleFrom.z, this.mantleTo.z, fw);
    this.pos.y = lerp(this.mantleFrom.y, this.mantleTo.y, up);
    this.eyeHeight = damp(this.eyeHeight, P.eyeCrouch + 0.2, 12, dt);
    this.speed = 2;
    if (t >= 1) {
      this.mantling = false;
      this.grounded = true;
      yawToDir(this.yaw, _fwd);
      this.vel.set(_fwd.x * 3.2, 0, _fwd.z * 3.2);
      this.landSpring.kick(-0.6);
    }
  }

  // ------------------------------------------------------------ camera

  updateCamera(cam: THREE.PerspectiveCamera, dt: number) {
    if (this.cameraLocked) return;
    const w = G.weapons;
    // FOV
    const sprintKick = this.sprinting && this.speed > P.walk ? 6 : 0;
    const slideKick = this.sliding ? 5 : 0;
    this.fovKick = damp(this.fovKick, sprintKick + slideKick, 8, dt);
    const adsFov = this.baseFov / w.zoom;
    const targetFov = lerp(this.baseFov + this.fovKick, adsFov, w.adsAmount);
    this.fov = targetFov;
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }

    // bob + landing dip
    const bobScale = (1 - w.adsAmount * 0.85) * this.moveAmount;
    const bobY = Math.sin(this.bobPhase * 2) * 0.03 * bobScale;
    const bobX = Math.cos(this.bobPhase) * 0.018 * bobScale;
    const land = this.landSpring.x * 0.06;

    // strafe roll + slide tilt
    yawToDir(this.yaw, _fwd);
    _right.set(-_fwd.z, 0, _fwd.x);
    const side = this.vel.x * _right.x + this.vel.z * _right.z;
    let targetRoll = -clamp(side / P.sprint, -1, 1) * 1.6 * DEG;
    if (this.sliding) targetRoll += 4.5 * DEG;
    if (this.alive) this.roll = damp(this.roll, targetRoll, 9, dt);

    // trauma shake
    const tr = this.trauma * this.trauma;
    const t = G.time * 31 + this.shakeSeed;
    const shP = (Math.sin(t * 1.3) + Math.sin(t * 2.9 + 1.7)) * 0.5 * tr * 2.6 * DEG;
    const shY = (Math.sin(t * 1.7 + 4.1) + Math.sin(t * 3.3 + 0.3)) * 0.5 * tr * 2.6 * DEG;
    const shR = Math.sin(t * 2.1 + 2.2) * tr * 3.2 * DEG;

    cam.position.set(this.pos.x, this.pos.y + this.eyeHeight + bobY + land, this.pos.z);
    cam.position.addScaledVector(_right, bobX);
    _e.set(this.pitch + this.recoilPitch.x + shP, this.yaw + this.recoilYaw.x + shY, this.roll + shR);
    cam.quaternion.setFromEuler(_e);
  }

  /** Aim direction including recoil (what bullets follow). */
  aimDir(out: THREE.Vector3) {
    const p = this.pitch + this.recoilPitch.x;
    const y = this.yaw + this.recoilYaw.x;
    const cp = Math.cos(p);
    return out.set(-Math.sin(y) * cp, Math.sin(p), -Math.cos(y) * cp);
  }

  shakeRand() {
    return rand(-1, 1);
  }
}
