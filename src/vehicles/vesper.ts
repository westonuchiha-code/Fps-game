import * as THREE from 'three';
import { G } from '../core/globals';
import { angleDelta, clamp, damp, DEG, dirToYaw, lerp, rand } from '../core/math';
import { hostile } from '../core/types';
import { Kit } from '../render/kit';
import { PAL, toon, flat } from '../render/toon';
import { signTexture, drawSmile } from '../render/textures';
import { Surf } from '../world/builder';
import { Vehicle } from './vehicle';
import { tube, buildRider } from './parts';

/** Tuning. Units: kg, m, s, N. */
export const VESPER = {
  mass: 260,
  gravity: 13,
  /** target ride height of the pads above the ground */
  hoverHeight: 0.45,
  rayLength: 1.9,
  spring: 2400,
  damper: 260,
  accel: 11,
  boostAccel: 22,
  topSpeed: 24, // ~80 km/h actual
  boostSpeed: 32, // ~110 km/h actual
  reverseSpeed: 7,
  /** lateral velocity decay per second (lower = driftier) */
  grip: 3.4,
  driftGrip: 1.1,
  drag: 0.4,
  turnRate: 2.7,
  turnRateFast: 1.7,
  camSteerGain: 2.2,
  boostTime: 3,
  boostRecharge: 0.55,
  blasterDamage: 12,
  blasterRate: 6,
  blasterRange: 160,
};

const V = VESPER;
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _down = new THREE.Vector3();
const _a = new THREE.Vector3();
const _f = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _camFwd = new THREE.Vector3();

interface Pad {
  p: THREE.Vector3;
  dist: number;
  contact: boolean;
}

let decalMat: THREE.Material | null = null;
let glowMat: THREE.Material | null = null;
let lampMat: THREE.Material | null = null;
let reticle: HTMLElement | null = null;

function getDecalMat() {
  if (decalMat) return decalMat;
  // left half: smile on yellow; right half: "LAST MILE" lettering
  const tex = signTexture(512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#ffd21f';
    g.fillRect(0, 0, w / 2, h);
    g.strokeStyle = '#11131a';
    g.lineWidth = 10;
    g.strokeRect(8, 8, w / 2 - 16, h - 16);
    drawSmile(g, w / 4, h / 2 + 6, 74, '#11131a', 'happy');
    g.fillStyle = '#11131a';
    g.font = 'bold 44px Impact, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('MonoMart', (w * 3) / 4, h * 0.36);
    g.font = 'bold 34px Impact, "Arial Black", sans-serif';
    g.fillStyle = '#d9a52b';
    g.fillText('LAST MILE', (w * 3) / 4, h * 0.66);
  });
  decalMat = toon({ map: tex, transparent: true, alphaTest: 0.4, name: 'vesper-decal' });
  return decalMat;
}

/** A small HTML reticle so the blasters can be aimed (the HUD hides its crosshair in vehicles). */
function getReticle() {
  if (reticle) return reticle;
  reticle = document.createElement('div');
  reticle.style.cssText =
    'position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;border:2px solid #ffd21f;border-radius:50%;' +
    'box-shadow:0 0 0 2px rgba(11,11,18,.8);pointer-events:none;display:none;z-index:5';
  const dot = document.createElement('div');
  dot.style.cssText = 'position:absolute;left:8px;top:8px;width:2px;height:2px;background:#ffd21f;box-shadow:0 0 0 1px rgba(11,11,18,.8)';
  reticle.appendChild(dot);
  (G.ui ?? document.body).appendChild(reticle);
  return reticle;
}

/** MonoMart's last-mile delivery hover scooter. Light, twitchy, drifts, banks, goes "meep". */
export class Vesper extends Vehicle {
  readonly name = 'Vesper';
  private readonly pads: Pad[] = [];
  /** visual lean group (banking is cosmetic so the physics stays planted) */
  private readonly lean = new THREE.Group();
  private readonly glow: THREE.Mesh;
  private readonly antenna: THREE.Mesh;
  private readonly muzzles = [new THREE.Vector3(-0.27, 0.02, -1.02), new THREE.Vector3(0.27, 0.02, -1.02)];
  private bank = 0;
  private pitchLean = 0;
  private flagSway = 0;
  boost = V.boostTime;
  boosting = false;
  drifting = false;
  private fireT = 0;
  private side = 0;
  private yawRateSm = 0;
  private hover: ReturnType<typeof G.audio.loop> | null = null;
  private wasBoosting = false;
  private trailT = 0;

  constructor(pos: THREE.Vector3, yaw: number) {
    super(V.mass, [0.9, 1.0, 2.0], [0.4, 0.5, 1.0]);
    this.body.gravity = V.gravity;
    this.body.angularDamping = 1.5;
    this.body.linearDamping = 0.05;
    this.boxCenter.set(0, 0.28, 0);
    this.box.surf = Surf.Metal;
    this.cam.dist = 5.6;
    this.cam.lookHeight = 2.0;
    this.cam.fovGain = 14;
    this.cam.fovSpeed = 30;
    this.shellRestitution = 0.25;
    this.shellFriction = 0.35;
    this.impactPitch = 1.35;
    this.playerSeatDrop = 0.7;
    this.airLevel = 3;
    this.airLevelRate = 3;
    this.tiltStart = 6 * DEG;
    this.tiltRate = 5;
    this.ramMult = 0.75;
    this.ramDrag = 0.3;

    for (const [x, z] of [
      [-0.26, -0.66],
      [0.26, -0.66],
      [-0.26, 0.64],
      [0.26, 0.64],
    ]) this.pads.push({ p: new THREE.Vector3(x, -0.18, z), dist: V.hoverHeight, contact: false });

    const S = (x: number, y: number, z: number, r: number) => this.spheres.push({ p: new THREE.Vector3(x, y, z), r });
    S(0, 0.06, -0.78, 0.28);
    S(0, 0.06, 0.0, 0.28);
    S(0, 0.08, 0.7, 0.3);
    S(0, 0.62, -0.72, 0.26);
    S(0, 0.75, 0.82, 0.3);
    this.bumper.center.set(0, 0.25, -0.95);
    this.bumper.half.set(0.55, 0.7, 0.45);

    this.root.add(this.lean);
    const k = new Kit();
    this.buildModel(k);
    const main = new THREE.Mesh(k.geometry(), G.mat.prop);
    main.castShadow = true;
    main.receiveShadow = true;
    this.lean.add(main);

    // glowing hover pads + round headlamp (unlit)
    const gk = new Kit();
    for (const p of this.pads) gk.cyl(0.15, 0.15, 0.03, 0xffffff, [p.p.x, p.p.y - 0.035, p.p.z], 'y', 10, false);
    glowMat ??= flat(0x8ff1ff);
    this.glow = new THREE.Mesh(gk.geometry(), glowMat);
    this.lean.add(this.glow);
    const lk = new Kit();
    lk.cyl(0.1, 0.1, 0.03, 0xffffff, [0, 0.9, -0.83], 'z', 10, false);
    lk.box(0.14, 0.05, 0.02, 0xffffff, [0, 0.46, 0.88]);
    lampMat ??= flat(0xfff3c4);
    this.lean.add(new THREE.Mesh(lk.geometry(), lampMat));

    // decals: smile on the back of the delivery box, lettering on its sides
    const dk = new Kit();
    dk.quad(0.42, 0.37, 0xffffff, [0, 0.78, 1.082], [0, 0, 0], [0, 0, 0.5, 1]);
    dk.quad(0.42, 0.21, 0xffffff, [-0.252, 0.8, 0.86], [0, -Math.PI / 2, 0], [0.5, 0, 1, 1]);
    dk.quad(0.42, 0.21, 0xffffff, [0.252, 0.8, 0.86], [0, Math.PI / 2, 0], [0.5, 0, 1, 1]);
    // little smile on the leg shield's yellow front
    dk.quad(0.2, 0.2, 0xffffff, [0, 0.42, -0.69], [0.37, Math.PI, 0], [0.06, 0.12, 0.44, 0.88]);
    this.lean.add(new THREE.Mesh(dk.geometry(), getDecalMat()));

    // antenna with a pennant (own mesh so it can whip around)
    const ak = new Kit();
    tube(ak, [0, 0, 0], [0, 0.85, 0], 0.012, PAL.ink, 4);
    ak.profile(
      [
        [0, 0.86],
        [0.36, 0.76],
        [0, 0.64],
      ],
      0.02,
      PAL.hivis,
    );
    ak.sphere(0.035, PAL.smile, [0, 0.87, 0]);
    this.antenna = new THREE.Mesh(ak.geometry(), G.mat.prop);
    this.antenna.position.set(0.19, 1.06, 1.02);
    this.lean.add(this.antenna);

    // seat + rider
    const seat = new THREE.Object3D();
    seat.position.set(0, 0.56, 0.24);
    this.lean.add(seat);
    this.seats.driver = seat;
    const fig = new THREE.Mesh(buildRider({ hand: [0.29, 0.4, -0.86], knee: [0.15, 0.06, -0.44], foot: [0.15, -0.5, -0.52], lean: 0.14 }), G.mat.char);
    fig.visible = false;
    fig.castShadow = true;
    seat.add(fig);
    this.driverFig = fig;

    this.place(pos, yaw);
    this.body.pos.y += 0.25;
    this.hover = G.audio.loop('scooter_hover_loop', { pos: this.body.pos, vol: 0.12, ref: 5, pitch: 0.8 });
  }

  private buildModel(k: Kit) {
    const cream = PAL.shell;
    const creamD = PAL.shellDark;
    const yel = PAL.smile;
    const dark = 0x2a2b31;
    // step-through floorboard with rubber mat
    k.box(0.4, 0.08, 0.78, cream, [0, -0.04, -0.2]);
    k.box(0.34, 0.02, 0.64, dark, [0, 0.01, -0.22]);
    // belly pan + pad housings
    k.box(0.36, 0.1, 1.6, creamD, [0, -0.12, -0.02]);
    for (const p of this.pads) {
      k.cyl(0.19, 0.17, 0.09, PAL.steelDark, [p.p.x, p.p.y + 0.02, p.p.z], 'y', 10, false);
      k.cyl(0.07, 0.07, 0.2, PAL.steelDark, [p.p.x * 0.6, p.p.y + 0.1, p.p.z], 'x', 6, false);
    }
    // leg shield: curved side profile, cream back with a smile-yellow front panel
    k.profile([[-0.42, -0.04], [-0.58, 0.22], [-0.7, 0.52], [-0.74, 0.8], [-0.66, 0.84], [-0.62, 0.56], [-0.52, 0.26], [-0.34, -0.04]], 0.56, cream);
    k.profile([[-0.45, -0.02], [-0.61, 0.22], [-0.73, 0.52], [-0.77, 0.78], [-0.75, 0.8], [-0.71, 0.52], [-0.59, 0.22], [-0.43, -0.02]], 0.5, yel);
    k.box(0.58, 0.05, 0.12, creamD, [0, 0.83, -0.7]);
    // front fender pod (where a wheel would be)
    k.sphere(0.27, cream, [0, -0.02, -0.86], 1, [0.9, 0.6, 1.2]);
    // steering column + handlebar + headset with round lamp
    tube(k, [0, 0.2, -0.5], [0, 0.86, -0.66], 0.045, creamD, 6);
    k.sphere(0.17, cream, [0, 0.92, -0.72], 1, [1.3, 0.72, 1.15]);
    k.cyl(0.12, 0.12, 0.07, PAL.steel, [0, 0.92, -0.86], 'z', 10, false);
    k.cyl(0.02, 0.02, 0.66, PAL.steelDark, [0, 0.96, -0.64], 'x', 6, false);
    for (const s of [-1, 1]) {
      k.cyl(0.03, 0.03, 0.11, PAL.ink, [s * 0.3, 0.96, -0.64], 'x', 6, false);
      // mirrors on stalks
      tube(k, [s * 0.2, 0.97, -0.66], [s * 0.27, 1.14, -0.68], 0.012, PAL.steelDark, 4);
      k.cyl(0.05, 0.05, 0.02, PAL.steel, [s * 0.28, 1.17, -0.68], 'z', 8, false);
      // twin blasters tucked under the leg shield
      k.box(0.08, 0.08, 0.3, dark, [s * 0.27, 0.02, -0.86]);
      k.cyl(0.025, 0.025, 0.16, PAL.ink, [s * 0.27, 0.02, -1.02], 'z', 6, false);
    }
    // rear bodywork: bulbous cowl with yellow pinstripe
    k.sphere(0.36, cream, [0, 0.22, 0.5], 2, [0.85, 0.75, 1.45]);
    for (const s of [-1, 1]) k.box(0.02, 0.05, 0.4, yel, [s * 0.3, 0.22, 0.5]);
    k.box(0.22, 0.12, 0.08, creamD, [0, 0.1, 1.02]);
    // saddle
    k.taper(0.3, 0.1, 0.62, 0.9, 0.95, 0x5a3a2a, [0, 0.47, 0.32]);
    k.box(0.32, 0.03, 0.64, 0x3b261b, [0, 0.42, 0.32]);
    // rear rack + delivery box
    k.box(0.46, 0.04, 0.42, PAL.steelDark, [0, 0.55, 0.86]);
    k.box(0.5, 0.44, 0.44, yel, [0, 0.79, 0.86]);
    k.box(0.53, 0.06, 0.47, PAL.gold, [0, 1.03, 0.86]);
    k.box(0.12, 0.04, 0.03, dark, [0, 0.93, 1.085]);
    // tail lamp housing
    k.box(0.18, 0.08, 0.04, dark, [0, 0.46, 0.86]);
    // little exhaust thruster
    k.cyl(0.06, 0.08, 0.22, PAL.steel, [0.18, -0.04, 0.88], 'z', 8, false);
  }

  // ------------------------------------------------------------ control

  protected override onEnter() {
    this.boost = Math.max(this.boost, 0.5);
    getReticle().style.display = 'block';
  }
  protected override onExit() {
    this.boosting = this.drifting = false;
    if (reticle) reticle.style.display = 'none';
  }
  protected override onDispose() {
    this.hover?.stop(0.1);
    this.hover = null;
    if (reticle) reticle.style.display = 'none';
  }

  protected override driverInput(dt: number) {
    const inp = G.input;
    this.drifting = inp.isDown('jump');
    const wantBoost = inp.isDown('sprint') && this.throttle > 0.2;
    if (wantBoost && !this.boosting && this.boost > 0.4) {
      this.boosting = true;
      G.audio.play('scooter_boost', { pos: this.body.pos, vol: 0.9 });
      this.cam.kick(0.15);
    }
    if (!wantBoost || this.boost <= 0) this.boosting = false;
    if (inp.pressed('horn')) G.audio.play('scooter_horn', { pos: this.body.pos, vol: 1, pitchVar: 0.04 });
    this.fireT -= dt;
    if (inp.isDown('fire') && this.fireT <= 0) {
      this.fireT = 1 / V.blasterRate;
      this.fireBlaster();
    }
  }

  /** One blaster bolt from alternating muzzles toward whatever the camera is looking at. */
  fireBlaster() {
    const cam = G.camera;
    _camFwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    // what is under the crosshair?
    const aimHit = this.withoutBox(() => G.world.hitscan(cam.position, _camFwd, V.blasterRange, G.player));
    if (aimHit) _aim.copy(aimHit.point);
    else _aim.copy(cam.position).addScaledVector(_camFwd, V.blasterRange);
    this.side = 1 - this.side;
    this.lean.updateMatrixWorld(true);
    _m.copy(this.muzzles[this.side]).applyMatrix4(this.lean.matrixWorld);
    _dir.copy(_aim).sub(_m);
    const len = _dir.length();
    if (len < 0.5) _dir.copy(_camFwd);
    else _dir.multiplyScalar(1 / len);
    // the guns are fixed-forward-ish: cap how far they can swivel
    this.body.dirToWorld(_v.set(0, 0, -1), _fwd);
    if (_dir.dot(_fwd) < 0.2) _dir.copy(_camFwd);
    _dir.x += rand(-0.008, 0.008);
    _dir.y += rand(-0.008, 0.008);
    _dir.normalize();
    const hit = this.withoutBox(() => G.world.hitscan(_m, _dir, V.blasterRange, G.player));
    const end = hit ? hit.point : _v.copy(_m).addScaledVector(_dir, V.blasterRange);
    G.fx.tracer(_m, end, 0x8ff1ff, 0.05);
    G.fx.muzzle(_m, _dir, 0x8ff1ff, 0.45);
    G.audio.play('scooter_blaster', { pos: _m, vol: 0.7, pitchVar: 0.07 });
    G.stats.shots++;
    G.hud.onShot();
    G.world.noise(_m, 50, 'gunshot', G.player);
    if (!hit) return;
    if (hit.target) {
      const t = hit.target;
      const crit = hit.zone === 'head' || hit.zone === 'weak';
      const wasAlive = t.alive;
      t.takeDamage({
        amount: V.blasterDamage * (crit ? 1.6 : 1),
        element: 'none',
        crit,
        kind: 'bullet',
        source: G.player,
        point: hit.point,
        dir: _dir.clone(),
        impulse: 0.8,
        zone: hit.zone,
      });
      if (hostile('player', t.faction)) {
        G.stats.hits++;
        if (crit) G.stats.crits++;
        G.hud.hitmarker(crit, wasAlive && !t.alive);
      }
    } else G.fx.impact(hit.point, hit.normal, hit.surf, 'shock');
    hit.onHit?.(V.blasterDamage, G.player);
  }

  // ------------------------------------------------------------ physics

  protected simulate(h: number) {
    const b = this.body;
    b.dirToWorld(_a.set(0, 1, 0), _up);
    b.dirToWorld(_a.set(0, 0, -1), _fwd);
    _down.copy(_up).negate();
    // hover springs
    let contacts = 0;
    const rest = V.hoverHeight + (V.mass * V.gravity) / 4 / V.spring;
    for (const p of this.pads) {
      b.localToWorld(p.p, _a);
      const hit = G.col.raycast(_a, _down, V.rayLength, 'solid', this.box);
      if (!hit) {
        p.contact = false;
        p.dist = V.rayLength;
        continue;
      }
      contacts++;
      p.contact = true;
      p.dist = hit.distance;
      b.pointVelocity(_a, _pv);
      const vUp = _pv.dot(_up);
      let fs = V.spring * (rest - hit.distance) - V.damper * vUp;
      // hard cushion close to the ground
      if (hit.distance < 0.2) fs += V.spring * 4 * (0.2 - hit.distance);
      fs = clamp(fs, 0, V.mass * V.gravity * 3);
      // lift is applied straight up so a slight tilt never turns into a sideways push (no creeping)
      b.applyForceAt(_f.set(0, fs, 0), _a);
    }
    this.groundContacts = contacts;
    const hovering = contacts > 0;

    // flatten the heading
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) return;
    _fwd.normalize();
    _right.set(-_fwd.z, 0, _fwd.x);
    const vF = b.vel.dot(_fwd);
    const vR = b.vel.dot(_right);
    const ctl = hovering ? 1 : 0.25;

    // thrust
    const thr = this.occupied ? this.throttle : 0;
    const top = this.boosting ? V.boostSpeed : V.topSpeed;
    let acc = 0;
    if (thr > 0.05) {
      const a = this.boosting ? V.boostAccel : V.accel;
      acc = vF < -0.5 ? thr * 16 : thr * a * clamp((top - vF) / (top * 0.35), 0, 1);
      if (vF > top) acc = -(vF - top) * 1.5; // bleed off boost speed smoothly
    } else if (thr < -0.05) {
      acc = vF > 0.5 ? thr * 16 : thr * V.accel * 0.6 * clamp((V.reverseSpeed + vF) / (V.reverseSpeed * 0.4), 0, 1);
    } else if (hovering) {
      // glide when coasting, but settle instead of creeping when slow
      acc = -vF * (this.occupied && Math.abs(vF) > 3 ? 0.6 : 2.5);
    }
    acc -= V.drag * vF * Math.abs(vF) * 0.02;
    b.applyForce(_f.copy(_fwd).multiplyScalar(acc * V.mass * ctl));
    // lateral grip (low = drift)
    const grip = (this.drifting ? V.driftGrip : V.grip) * ctl;
    b.applyForce(_f.copy(_right).multiplyScalar(-vR * grip * V.mass));

    // yaw: rate servo toward a target turn rate (Halo-style camera steering + direct A/D)
    const vehYaw = dirToYaw(_fwd.x, _fwd.z);
    const yawRate = b.angVel.y;
    let cmd = -this.steerIn;
    if (this.camFollow > 0) {
      const err = angleDelta(vehYaw, this.camYaw);
      const rev = vF < -0.5 && thr < 0 ? -1 : 1;
      cmd += clamp(err * V.camSteerGain, -1, 1) * rev;
    }
    cmd = clamp(cmd, -1, 1);
    const sp = Math.abs(vF);
    let rate = lerp(V.turnRate, V.turnRateFast, clamp(sp / V.boostSpeed, 0, 1));
    if (this.drifting) rate *= 1.35;
    // a hover scooter can pivot on the spot, just slower
    const moving = clamp(0.35 + sp / 6, 0, 1);
    const wantRate = cmd * rate * moving;
    const iy = b.inertia.y;
    b.applyTorque(_f.set(0, (wantRate - yawRate) * iy * 10 * (hovering ? 1 : 0.3), 0));
    // turning while moving swings the momentum around a bit (keeps it fun, not icy)
    void h;
  }

  protected override afterStep(dt: number) {
    // boost meter
    if (this.boosting) {
      this.boost -= dt;
      if (this.boost <= 0) {
        this.boost = 0;
        this.boosting = false;
      }
    } else this.boost = Math.min(V.boostTime, this.boost + dt * V.boostRecharge);
    if (this.hover) {
      const sp = clamp(this.speed / V.boostSpeed, 0, 1);
      const on = this.occupied ? 1 : 0.35;
      this.hover.setPitch(0.8 + sp * 0.75 + (this.boosting ? 0.15 : 0));
      this.hover.setVolume((0.16 + sp * 0.4) * on + (this.occupied ? 0.2 : 0));
      this.hover.setPos(this.body.pos);
    }
    // boost / hover sparkle
    this.trailT -= dt;
    if (this.trailT <= 0 && this.groundContacts > 0 && (this.boosting || this.speed > 6)) {
      this.trailT = this.boosting ? 0.045 : 0.12;
      this.body.localToWorld(_v.set(0.18, -0.04, 1.0), _m);
      _v2.copy(this.body.vel).multiplyScalar(0.2);
      _v2.y += 0.3;
      if (this.boosting) G.fx.puff(_m, _v2, 0.22, 0.05, 0.16, 0x8ff1ff, 0x3f9bff, -0.4, 3);
      else G.fx.puff(_m, _v2, 0.3, 0.05, 0.18, 0xd9d3c4, 0xa59e92, -0.2, 2);
    }
    this.wasBoosting = this.boosting;
  }

  protected override onCrash(f: number) {
    if (this.occupied) G.player.addTrauma(0.08 + f * 0.3);
  }

  protected animate(dt: number) {
    const b = this.body;
    // bank into turns, lean back under thrust (purely visual)
    const yawRate = b.angVel.y;
    this.yawRateSm = damp(this.yawRateSm, yawRate, 8, dt);
    const sp = clamp(Math.abs(this.forwardSpeed) / V.topSpeed, 0, 1.4);
    const wantBank = clamp(this.yawRateSm * (0.12 + sp * 0.28), -0.5, 0.5) * (this.drifting ? 1.3 : 1);
    this.bank = damp(this.bank, wantBank, 7, dt);
    const accel = this.occupied ? this.throttle : 0;
    this.pitchLean = damp(this.pitchLean, accel * (this.boosting ? 0.1 : 0.05), 5, dt);
    this.lean.rotation.set(this.pitchLean, 0, this.bank, 'YXZ');
    // hover bob when parked
    this.lean.position.y = Math.sin(G.time * 2.4 + this.spawnYaw) * 0.025;
    // pads pulse, brighter with boost
    const pulse = 1 + Math.sin(G.time * 18) * 0.06 + (this.boosting ? 0.25 : 0);
    this.glow.scale.set(pulse, 1, pulse);
    this.glow.visible = this.groundContacts > 0 || this.occupied;
    // antenna whips back with speed and wobbles
    this.flagSway = damp(this.flagSway, sp * 0.7, 3, dt);
    this.antenna.rotation.x = this.flagSway + Math.sin(G.time * (6 + sp * 10)) * (0.04 + sp * 0.05);
    this.antenna.rotation.y = Math.sin(G.time * 3.1) * 0.6;
    // aim reticle follows the camera centre; it is hidden when parked
    if (reticle && this.occupied) reticle.style.borderColor = this.boosting ? '#8ff1ff' : '#ffd21f';
  }
}
