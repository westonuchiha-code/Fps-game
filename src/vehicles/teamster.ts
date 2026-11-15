import * as THREE from 'three';
import { G } from '../core/globals';
import { angleDelta, clamp, damp, DEG, dirToYaw, lerp, rand } from '../core/math';
import type { Target } from '../core/types';
import { Kit } from '../render/kit';
import { PAL } from '../render/toon';
import { signTexture } from '../render/textures';
import { toon } from '../render/toon';
import { Surf } from '../world/builder';
import { Vehicle } from './vehicle';
import { limb, tube, buildRider } from './parts';

type V3 = [number, number, number];

/** Tuning. Units: kg, m, s, N. */
export const TEAMSTER = {
  mass: 1500,
  gravity: 15,
  wheelRadius: 0.48,
  restLength: 0.55,
  spring: 40000,
  damperBump: 2300,
  damperRebound: 3400,
  antiRoll: 7000,
  /** lateral tyre stiffness, N per m/s of slip, per wheel */
  cornering: 12000,
  muFront: 1.15,
  muRear: 1.2,
  muRearHandbrake: 0.42,
  driveForce: 10500,
  brakeForce: 19000,
  topSpeed: 27, // ~90 km/h actual (the taper approaches it asymptotically)
  reverseSpeed: 10,
  rolling: 160,
  aero: 0.55,
  maxSteer: 0.6,
  maxSteerFast: 0.17,
  steerRate: 3.2,
  camSteerGain: 1.7,
  /** tyre forces are applied this fraction of the way up toward the centre of mass (anti-roll trick) */
  rollCentre: 0.25,
};

const T = TEAMSTER;
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _down = new THREE.Vector3();
const _a = new THREE.Vector3();
const _wf = new THREE.Vector3();
const _ws = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _f = new THREE.Vector3();
const _cp = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();

interface Wheel {
  anchor: THREE.Vector3;
  front: boolean;
  left: boolean;
  comp: number;
  susLen: number;
  contact: boolean;
  normal: THREE.Vector3;
  spin: number;
  slip: number;
  load: number;
  pivot: THREE.Object3D;
  mesh: THREE.Mesh;
}

// ---------------------------------------------------------------- shared geometry

let wheelGeo: THREE.BufferGeometry | null = null;
let lightMat: THREE.MeshBasicMaterial | null = null;
let decalMat: THREE.Material | null = null;

function getWheelGeo() {
  if (wheelGeo) return wheelGeo;
  const k = new Kit();
  const r = T.wheelRadius;
  const w = 0.4;
  k.cyl(r * 0.94, r * 0.94, w, 0x1d1d22, [0, 0, 0], 'x', 12, false);
  // chunky tread blocks
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const off = i % 2 ? 0.07 : -0.07;
    k.box(w * 0.42, 0.075, 0.2, 0x26262c, [off, Math.cos(a) * (r - 0.03), Math.sin(a) * (r - 0.03)], [a, 0, 0]);
  }
  // rims: dull yellow steel with a dark hub on both faces
  for (const s of [-1, 1]) {
    k.cyl(0.29, 0.29, 0.03, PAL.cYellow, [s * (w / 2 + 0.003), 0, 0], 'x', 8, false);
    k.cyl(0.12, 0.1, 0.06, PAL.steelDark, [s * (w / 2 + 0.02), 0, 0], 'x', 6, false);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      k.box(0.03, 0.16, 0.05, PAL.steelDark, [s * (w / 2 + 0.02), Math.cos(a) * 0.19, Math.sin(a) * 0.19], [a, 0, 0]);
    }
  }
  wheelGeo = k.geometry();
  return wheelGeo;
}

function getLightMat() {
  return (lightMat ??= new THREE.MeshBasicMaterial({ vertexColors: true }));
}

function getDecalMat() {
  if (decalMat) return decalMat;
  const tex = signTexture(512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#f4efe2';
    g.font = 'bold 92px Impact, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // stencil look: the bridges are gaps cut through the letters
    g.fillText('LOCAL 404', w / 2, h / 2 + 4);
    g.globalCompositeOperation = 'destination-out';
    g.fillRect(0, h * 0.47, w, 7);
    for (let x = 30; x < w; x += 47) g.fillRect(x, 0, 4, h);
    g.globalCompositeOperation = 'source-over';
  });
  decalMat = toon({ map: tex, transparent: true, alphaTest: 0.4, name: 'teamster-decal' });
  return decalMat;
}

// ---------------------------------------------------------------- turret

/** Rear pintle gun on a ring mount. Driven by a gunner Passenger, or by anyone through aim()/fire(). */
export class Turret {
  readonly yawObj = new THREE.Object3D();
  readonly pitchObj = new THREE.Object3D();
  readonly muzzle = new THREE.Object3D();
  readonly gunMesh: THREE.Mesh;
  yaw = 0;
  pitch = 0;
  /** stats: ~9 rps, 10 dmg, bursts of 18 then 0.7 s rest → ~65 sustained DPS */
  damage = 10;
  rate = 9;
  spread = 1.3 * DEG;
  range = 70;
  burstSize = 18;
  burstRest = 0.7;
  minPitch = -16 * DEG;
  maxPitch = 50 * DEG;
  private cooldown = 0;
  private burst = 0;
  private recoil = 0;
  private readonly aimDir = new THREE.Vector3(0, 0, -1);
  private manualT = 0;
  private searchT = 0;
  target: Target | null = null;

  constructor(private owner: Teamster, yawMesh: THREE.Mesh, gunMesh: THREE.Mesh) {
    this.yawObj.add(yawMesh);
    this.yawObj.add(this.pitchObj);
    this.pitchObj.position.set(0, 0.3, 0);
    this.pitchObj.add(gunMesh);
    this.gunMesh = gunMesh;
    this.muzzle.position.set(0, 0.02, -1.25);
    this.pitchObj.add(this.muzzle);
  }

  /** Point the gun along a world direction (slews at a finite rate). */
  aim(dir: THREE.Vector3) {
    this.aimDir.copy(dir).normalize();
    this.manualT = 0.5;
  }

  /** Fire one round if the gun is ready. Returns true when a shot went out. */
  fire(): boolean {
    if (this.cooldown > 0) return false;
    const v = this.owner;
    this.cooldown = 1 / this.rate;
    this.burst++;
    if (this.burst >= this.burstSize) {
      this.burst = 0;
      this.cooldown = this.burstRest;
    }
    this.muzzle.getWorldPosition(_m);
    this.pitchObj.getWorldQuaternion(_q);
    _dir.set(rand(-1, 1) * this.spread, rand(-1, 1) * this.spread, -1).normalize().applyQuaternion(_q);
    const shooter = this.shooter();
    const hit = v.withoutBoxPublic(() => G.world.hitscan(_m, _dir, this.range + 20, shooter));
    const end = hit ? hit.point : _v.copy(_m).addScaledVector(_dir, this.range + 20);
    G.fx.tracer(_m, end, 0xffc65a, 0.045);
    G.fx.muzzle(_m, _dir, 0xffb347, 0.7);
    G.audio.play('turret_fire', { pos: _m, vol: 0.75, pitchVar: 0.06 });
    if (hit) {
      if (hit.target) {
        const crit = hit.zone === 'head' || hit.zone === 'weak';
        hit.target.takeDamage({
          amount: this.damage * (crit ? 1.5 : 1),
          element: 'none',
          crit,
          kind: 'bullet',
          source: shooter,
          point: hit.point,
          dir: _dir.clone(),
          impulse: 1.2,
          zone: hit.zone,
        });
      } else G.fx.impact(hit.point, hit.normal, hit.surf, 'none');
      hit.onHit?.(this.damage, shooter);
    }
    this.recoil = 1;
    if (v.occupied) G.player.addTrauma(0.03);
    G.world.noise(_m, 60, 'gunshot', shooter);
    return true;
  }

  private shooter(): Target {
    const g = this.owner.rider('gunner') as unknown as Target | null;
    return g && typeof (g as Target).faction === 'string' && typeof (g as Target).takeDamage === 'function' ? g : G.player;
  }

  update(dt: number) {
    const v = this.owner;
    this.cooldown -= dt;
    this.manualT -= dt;
    const gunner = v.rider('gunner');
    let wantFire = false;
    if (gunner && this.manualT <= 0) {
      // auto-gunner: nearest hostile with line of sight
      this.searchT -= dt;
      if (this.searchT <= 0 || (this.target && !this.target.alive)) {
        this.searchT = 0.25;
        this.muzzle.getWorldPosition(_m);
        this.target = v.withoutBoxPublic(() => G.world.nearestHostile(_m, 'player', this.range, null, true));
      }
      if (this.target) {
        this.target.aimPoint(_aim);
        // a little lead
        _aim.addScaledVector(this.target.vel, 0.08);
        this.yawObj.getWorldPosition(_m);
        _m.y += 0.3;
        this.aimDir.copy(_aim).sub(_m).normalize();
        wantFire = true;
      }
    } else if (!gunner && this.manualT <= 0) {
      // idle: face forward
      v.body.dirToWorld(_v.set(0, 0.05, -1), this.aimDir);
      this.target = null;
    }
    // aim direction → ring yaw / gun pitch in vehicle space
    _q.copy(v.body.quat).invert();
    _v.copy(this.aimDir).applyQuaternion(_q);
    const wantYaw = Math.atan2(-_v.x, -_v.z);
    const wantPitch = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), this.minPitch, this.maxPitch);
    const dy = angleDelta(this.yaw, wantYaw);
    this.yaw += clamp(dy, -3.4 * dt, 3.4 * dt);
    this.pitch += clamp(wantPitch - this.pitch, -2.5 * dt, 2.5 * dt);
    this.yawObj.rotation.y = this.yaw;
    this.pitchObj.rotation.x = this.pitch;
    this.recoil = damp(this.recoil, 0, 18, dt);
    this.gunMesh.position.z = this.recoil * 0.07;
    if (wantFire && Math.abs(dy) < 5 * DEG && Math.abs(wantPitch - this.pitch) < 5 * DEG) this.fire();
  }
}

// ---------------------------------------------------------------- the truck

/** Local 404's union-made 4x4 technical. Driver + gunner + passenger. */
export class Teamster extends Vehicle {
  readonly name = 'Teamster';
  readonly wheels: Wheel[] = [];
  readonly turret: Turret;
  steer = 0;
  handbrake = false;
  private steeringWheel: THREE.Mesh;
  private skid: ReturnType<typeof G.audio.loop> | null = null;
  private maxSlip = 0;
  private dustT = 0;

  constructor(pos: THREE.Vector3, yaw: number) {
    super(T.mass, [2.6, 1.6, 4.8], [1.0, 0.5, 2.3]);
    this.body.gravity = T.gravity;
    this.body.angularDamping = 0.5;
    this.boxCenter.set(0, 0.3, 0);
    this.box.surf = Surf.Metal;
    this.impactPitch = 1;
    this.cam.dist = 7.5;
    this.cam.lookHeight = 1.9;

    // chassis shell spheres (body space, origin = centre of mass, ground ~0.86 below at rest)
    const S = (x: number, y: number, z: number, r: number) => this.spheres.push({ p: new THREE.Vector3(x, y, z), r });
    for (const sx of [-1, 1]) {
      S(sx * 0.72, -0.12, -1.9, 0.4);
      S(sx * 0.72, -0.12, 1.85, 0.4);
      S(sx * 0.72, -0.08, 0, 0.42);
      S(sx * 0.62, 1.15, 0.3, 0.32);
      S(sx * 0.6, 0.5, -1.5, 0.36);
    }
    S(0, 0.05, -2.15, 0.34);
    S(0, 0.05, 2.1, 0.34);
    S(0, 1.38, 1.05, 0.38);
    this.bumper.center.set(0, 0.1, -2.15);
    this.bumper.half.set(1.05, 0.9, 0.55);

    this.buildModel();
    const yawK = new Kit();
    const gunK = new Kit();
    this.buildTurret(yawK, gunK);
    const yawMesh = new THREE.Mesh(yawK.geometry(), G.mat.prop);
    const gunMesh = new THREE.Mesh(gunK.geometry(), G.mat.prop);
    this.turret = new Turret(this, yawMesh, gunMesh);
    this.turret.yawObj.position.set(0, 1.04, 1.15);
    this.root.add(this.turret.yawObj);

    // steering wheel (own mesh so it can turn)
    const sw = new Kit();
    sw.cyl(0.19, 0.19, 0.035, PAL.ink, [0, 0, 0], 'z', 10, false);
    sw.cyl(0.13, 0.13, 0.045, 0x34343c, [0, 0, 0], 'z', 10, false);
    sw.box(0.36, 0.04, 0.04, PAL.ink, [0, 0, 0]);
    sw.box(0.04, 0.2, 0.04, PAL.ink, [0, -0.08, 0]);
    this.steeringWheel = new THREE.Mesh(sw.geometry(), G.mat.prop);
    this.steeringWheel.position.set(-0.42, 0.8, -0.6);
    this.steeringWheel.rotation.x = -0.55;
    this.steeringWheel.rotation.order = 'XZY';
    this.root.add(this.steeringWheel);

    // wheels
    const wg = getWheelGeo();
    for (const [x, z, front] of [
      [-0.98, -1.45, true],
      [0.98, -1.45, true],
      [-0.98, 1.4, false],
      [0.98, 1.4, false],
    ] as [number, number, boolean][]) {
      const pivot = new THREE.Object3D();
      const mesh = new THREE.Mesh(wg, G.mat.prop);
      mesh.castShadow = true;
      pivot.add(mesh);
      this.root.add(pivot);
      this.wheels.push({
        anchor: new THREE.Vector3(x, 0, z),
        front,
        left: x < 0,
        comp: 0.15,
        susLen: T.restLength - 0.15,
        contact: false,
        normal: new THREE.Vector3(0, 1, 0),
        spin: 0,
        slip: 0,
        load: 0,
        pivot,
        mesh,
      });
    }

    // seats
    const seat = (name: 'driver' | 'gunner' | 'passenger', parent: THREE.Object3D, x: number, y: number, z: number) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      o.name = name;
      parent.add(o);
      this.seats[name] = o;
      return o;
    };
    const driverSeat = seat('driver', this.root, -0.42, 0.38, -0.12);
    seat('passenger', this.root, 0.42, 0.38, -0.12);
    // gunner stands in the bed behind the gun and turns with the ring (anchor = feet)
    seat('gunner', this.turret.yawObj, 0, -0.68, 0.62);

    const fig = new THREE.Mesh(buildRider({ hand: [0.15, 0.4, -0.42], knee: [0.13, 0.1, -0.44], foot: [0.14, -0.3, -0.62], lean: 0.1 }), G.mat.char);
    fig.visible = false;
    fig.castShadow = true;
    driverSeat.add(fig);
    this.driverFig = fig;

    this.place(pos, yaw);
    this.body.pos.y += 0.86 - 0.2;
  }

  // ------------------------------------------------------------ model

  private buildModel() {
    const k = new Kit();
    const body = 0xb4462b; // rust red
    const body2 = 0xd0612c; // sun-faded orange
    const dark = 0x2c2d33;
    const steel = PAL.steel;
    const sd = PAL.steelDark;
    const cage = 0x3a3f47;

    // frame + belly
    k.box(1.3, 0.18, 4.3, sd, [0, -0.24, 0]);
    k.box(0.12, 0.12, 2.8, sd, [0, -0.36, 0]);
    // axles
    k.cyl(0.07, 0.07, 1.8, sd, [0, -0.38, -1.45], 'x', 6, false);
    k.cyl(0.07, 0.07, 1.8, sd, [0, -0.38, 1.4], 'x', 6, false);
    k.box(0.32, 0.26, 0.3, sd, [0, -0.36, 1.4]);
    // slab-sided tub
    k.box(1.66, 0.52, 4.1, body, [0, 0.1, 0.05]);
    // top rail of the tub (slightly lighter)
    for (const s of [-1, 1]) k.box(0.1, 0.07, 3.0, body2, [s * 0.8, 0.39, 0.55]);
    // hood (raised, slightly sloped)
    k.box(1.62, 0.26, 1.3, body2, [0, 0.47, -1.48], [0.05, 0, 0]);
    k.box(1.0, 0.06, 1.0, body, [0, 0.62, -1.5], [0.05, 0, 0]);
    // fender flares over the big tyres
    for (const sx of [-1, 1]) {
      for (const z of [-1.45, 1.4]) {
        k.box(0.46, 0.08, 1.2, dark, [sx * 0.96, 0.53, z]);
        k.box(0.46, 0.08, 0.36, dark, [sx * 0.96, 0.4, z - 0.72], [-0.7, 0, 0]);
        k.box(0.46, 0.08, 0.36, dark, [sx * 0.96, 0.4, z + 0.72], [0.7, 0, 0]);
      }
      // side exhaust pipe
      tube(k, [sx * 0.86, -0.02, -1.0], [sx * 0.86, -0.02, 0.6], 0.06, steel);
      k.cyl(0.075, 0.075, 0.12, PAL.ink, [sx * 0.86, -0.02, 0.66], 'z', 6, false);
      // mirrors
      tube(k, [sx * 0.8, 0.62, -0.78], [sx * 1.0, 0.82, -0.8], 0.02, cage);
      k.box(0.06, 0.16, 0.12, dark, [sx * 1.02, 0.86, -0.8]);
      // tail lights housings
      k.box(0.16, 0.12, 0.05, dark, [sx * 0.68, 0.24, 2.11]);
    }
    // grille + bull bar + hi-vis bumper
    k.box(1.34, 0.36, 0.06, dark, [0, 0.28, -2.14]);
    for (let i = 0; i < 4; i++) k.box(1.2, 0.035, 0.03, steel, [0, 0.16 + i * 0.08, -2.18]);
    for (const sx of [-1, 1]) {
      k.cyl(0.13, 0.13, 0.1, steel, [sx * 0.6, 0.42, -2.15], 'z', 8, false);
      tube(k, [sx * 0.42, -0.02, -2.32], [sx * 0.42, 0.52, -2.24], 0.035, cage);
    }
    tube(k, [-0.42, 0.52, -2.24], [0.42, 0.52, -2.24], 0.035, cage);
    k.box(2.08, 0.26, 0.28, PAL.hivis, [0, -0.06, -2.26]);
    for (let i = -3; i <= 3; i++) k.box(0.1, 0.27, 0.02, PAL.ink, [i * 0.28, -0.06, -2.41], [0, 0, 0.6]);
    // rear bumper + tailgate + spare tyre
    k.box(1.9, 0.2, 0.2, PAL.hivis, [0, -0.08, 2.18]);
    k.box(1.5, 0.4, 0.06, body2, [0, 0.16, 2.1]);
    k.cyl(0.36, 0.36, 0.24, 0x1d1d22, [0.0, 0.18, 2.3], 'z', 10, false);
    k.cyl(0.2, 0.2, 0.26, PAL.cYellow, [0.0, 0.18, 2.3], 'z', 8, false);
    // exposed engine: blower, intake stacks, rocker covers
    k.box(0.52, 0.2, 0.62, steel, [0, 0.72, -1.5]);
    k.box(0.4, 0.1, 0.5, PAL.ink, [0, 0.84, -1.5]);
    for (const sx of [-1, 1]) {
      k.cyl(0.07, 0.09, 0.24, 0xc9ced6, [sx * 0.12, 0.98, -1.55], 'y', 8, false);
      k.box(0.12, 0.1, 0.7, PAL.cRed, [sx * 0.42, 0.66, -1.48]);
    }
    k.box(0.5, 0.14, 0.18, sd, [0, 0.66, -1.05]);
    // cab interior: floor, dash, seats
    k.box(1.5, 0.05, 1.5, dark, [0, 0.0, -0.1]);
    k.box(1.52, 0.24, 0.26, dark, [0, 0.62, -0.78]);
    for (const sx of [-1, 1]) {
      k.box(0.5, 0.14, 0.5, 0x2b2b30, [sx * 0.42, 0.3, -0.08]);
      k.box(0.5, 0.6, 0.12, 0x2b2b30, [sx * 0.42, 0.62, 0.2], [-0.12, 0, 0]);
      k.box(0.5, 0.07, 0.12, PAL.hivis, [sx * 0.42, 0.9, 0.23], [-0.12, 0, 0]);
    }
    // windshield frame (no glass)
    tube(k, [-0.76, 0.62, -0.84], [-0.72, 1.2, -0.72], 0.035, cage);
    tube(k, [0.76, 0.62, -0.84], [0.72, 1.2, -0.72], 0.035, cage);
    tube(k, [-0.72, 1.2, -0.72], [0.72, 1.2, -0.72], 0.035, cage);
    tube(k, [-0.76, 0.66, -0.84], [0.76, 0.66, -0.84], 0.03, cage);
    // roll cage
    for (const sx of [-1, 1]) {
      tube(k, [sx * 0.78, 0.42, 0.42], [sx * 0.7, 1.38, 0.36], 0.05, cage);
      tube(k, [sx * 0.72, 1.2, -0.72], [sx * 0.7, 1.38, 0.36], 0.045, cage);
      tube(k, [sx * 0.7, 1.38, 0.36], [sx * 0.76, 0.44, 1.95], 0.045, cage);
    }
    tube(k, [-0.7, 1.38, 0.36], [0.7, 1.38, 0.36], 0.05, cage);
    tube(k, [-0.7, 1.38, 0.36], [0.7, 0.5, 0.42], 0.035, cage);
    // light bar on the cage
    k.box(0.9, 0.1, 0.12, dark, [0, 1.47, 0.34]);
    // bed floor, pedestal, ring, ammo crates
    k.box(1.5, 0.06, 1.6, dark, [0, 0.31, 1.25]);
    k.cyl(0.11, 0.14, 0.7, steel, [0, 0.66, 1.15], 'y', 8, false);
    k.cyl(0.34, 0.34, 0.08, sd, [0, 1.0, 1.15], 'y', 12, false);
    k.box(0.34, 0.26, 0.5, PAL.cGreen, [0.52, 0.47, 1.65]);
    k.box(0.36, 0.05, 0.52, 0x46703a, [0.52, 0.61, 1.65]);
    k.box(0.3, 0.3, 0.3, 0xc9a06a, [-0.52, 0.49, 1.7], [0, 0.3, 0]);
    // mud flaps
    for (const sx of [-1, 1]) k.box(0.36, 0.3, 0.03, PAL.ink, [sx * 0.96, -0.2, 2.0]);

    const main = new THREE.Mesh(k.geometry(), G.mat.prop);
    main.castShadow = true;
    main.receiveShadow = true;
    this.root.add(main);

    // lights (unlit)
    const L = new Kit();
    for (const sx of [-1, 1]) {
      L.cyl(0.1, 0.1, 0.04, 0xfff3c4, [sx * 0.6, 0.42, -2.21], 'z', 8, false);
      L.box(0.12, 0.08, 0.02, 0xff3a22, [sx * 0.68, 0.24, 2.14]);
    }
    for (let i = 0; i < 4; i++) L.box(0.16, 0.06, 0.02, 0xfff3c4, [-0.3 + i * 0.2, 1.47, 0.27]);
    const lights = new THREE.Mesh(L.geometry(), getLightMat());
    this.root.add(lights);

    // "LOCAL 404" stencils on the doors
    const D = new Kit();
    D.quad(1.15, 0.29, 0xffffff, [-0.834, 0.15, -0.25], [0, -Math.PI / 2, 0]);
    D.quad(1.15, 0.29, 0xffffff, [0.834, 0.15, -0.25], [0, Math.PI / 2, 0]);
    const decal = new THREE.Mesh(D.geometry(), getDecalMat());
    this.root.add(decal);
  }

  private buildTurret(yk: Kit, gk: Kit) {
    const sd = PAL.steelDark;
    // ring carriage + yoke
    yk.cyl(0.3, 0.3, 0.06, PAL.steel, [0, 0.03, 0], 'y', 12, false);
    yk.box(0.14, 0.3, 0.14, sd, [0, 0.16, 0]);
    limb(yk, [-0.14, 0.18, 0], [-0.14, 0.34, 0], 0.05, 0.1, sd);
    limb(yk, [0.14, 0.18, 0], [0.14, 0.34, 0], 0.05, 0.1, sd);
    yk.box(0.34, 0.05, 0.12, sd, [0, 0.18, 0]);
    // gun (origin at the trunnion)
    gk.box(0.2, 0.22, 0.6, 0x3b3f46, [0, 0, 0.02]);
    gk.box(0.16, 0.06, 0.5, PAL.ink, [0, 0.13, 0.02]);
    gk.cyl(0.055, 0.055, 0.25, sd, [0, 0.02, -0.38], 'z', 8, false);
    gk.cyl(0.035, 0.035, 0.8, PAL.ink, [0, 0.02, -0.82], 'z', 6, false);
    gk.cyl(0.06, 0.06, 0.12, sd, [0, 0.02, -1.2], 'z', 6, false);
    // spade grips
    for (const sx of [-1, 1]) gk.box(0.04, 0.16, 0.04, PAL.ink, [sx * 0.08, -0.04, 0.38]);
    gk.box(0.2, 0.04, 0.04, PAL.ink, [0, -0.1, 0.38]);
    // ammo can
    gk.box(0.16, 0.2, 0.3, PAL.cGreen, [0.2, -0.03, 0.02]);
    // shield plate with a sight slit, hi-vis edge
    gk.box(0.84, 0.52, 0.04, 0xb4462b, [0, 0.06, -0.3]);
    gk.box(0.86, 0.06, 0.05, PAL.hivis, [0, 0.33, -0.3]);
    gk.box(0.24, 0.05, 0.05, PAL.ink, [0.22, 0.18, -0.31]);
    gk.box(0.28, 0.2, 0.04, 0xb4462b, [-0.5, 0.0, -0.24], [0, 0.45, 0]);
    gk.box(0.28, 0.2, 0.04, 0xb4462b, [0.5, 0.0, -0.24], [0, -0.45, 0]);
  }

  // ------------------------------------------------------------ control

  protected override onEnter() {
    this.engine?.stop(0.05);
    this.engine = G.audio.loop('truck_engine_loop', { pos: this.body.pos, vol: 0.55, ref: 8 });
    this.skid = G.audio.loop('tire_skid_loop', { pos: this.body.pos, vol: 0, ref: 8 });
  }
  protected override onExit() {
    this.engine?.stop(0.6);
    this.engine = null;
    this.skid?.stop(0.2);
    this.skid = null;
    this.handbrake = false;
  }
  protected override onDispose() {
    this.skid?.stop(0.1);
    this.skid = null;
  }

  protected override driverInput() {
    const inp = G.input;
    this.handbrake = inp.isDown('jump');
    if (inp.pressed('horn')) G.audio.play('scooter_horn', { pos: this.body.pos, vol: 1, pitch: 0.52 });
  }

  // ------------------------------------------------------------ physics

  protected simulate(h: number) {
    const b = this.body;
    b.dirToWorld(_a.set(0, 1, 0), _up);
    b.dirToWorld(_a.set(0, 0, -1), _fwd);
    _down.copy(_up).negate();

    // steering: Halo-style toward the camera heading, plus direct A/D
    const vehYaw = dirToYaw(_fwd.x, _fwd.z);
    const yawRate = b.angVel.dot(_up);
    let cmd = -this.steerIn;
    if (this.camFollow > 0) {
      const err = angleDelta(vehYaw, this.camYaw) - yawRate * 0.22;
      const rev = this.forwardSpeed < -0.5 && this.throttle < 0 ? -1 : 1;
      cmd += clamp(err * T.camSteerGain, -1, 1) * rev * this.camFollow;
    }
    cmd = clamp(cmd, -1, 1);
    const sp = Math.abs(this.forwardSpeed);
    const maxSteer = lerp(T.maxSteer, T.maxSteerFast, clamp(sp / T.topSpeed, 0, 1));
    const target = cmd * maxSteer;
    this.steer += clamp(target - this.steer, -T.steerRate * h, T.steerRate * h);

    // throttle / brake decision
    const thr = this.occupied ? this.throttle : 0;
    let drive = 0;
    let brake = 0;
    if (thr > 0.05) {
      if (this.forwardSpeed < -1) brake = thr;
      else drive = thr * this.taper(this.forwardSpeed, T.topSpeed);
    } else if (thr < -0.05) {
      if (this.forwardSpeed > 1) brake = -thr;
      else drive = thr * this.taper(-this.forwardSpeed, T.reverseSpeed);
    }
    // parking brake when stopped; an empty truck brakes to a halt instead of rolling on forever
    const parking = (Math.abs(thr) < 0.05 && sp < 1.5) || !this.occupied;

    let contacts = 0;
    let maxSlip = 0;
    // first pass: suspension (need compressions for the anti-roll bars)
    for (const w of this.wheels) {
      b.localToWorld(w.anchor, _a);
      const hit = G.col.raycast(_a, _down, T.restLength + T.wheelRadius, 'solid', this.box);
      if (!hit) {
        w.contact = false;
        w.susLen = Math.min(T.restLength, w.susLen + h * 3);
        w.comp = T.restLength - w.susLen;
        continue;
      }
      contacts++;
      const sus = clamp(hit.distance - T.wheelRadius, 0, T.restLength);
      const comp = T.restLength - sus;
      const compVel = w.contact ? (comp - w.comp) / h : 0;
      w.comp = comp;
      w.susLen = sus;
      w.contact = true;
      w.normal.copy(hit.normal);
      let fs = T.spring * comp + (compVel > 0 ? T.damperBump : T.damperRebound) * compVel;
      // bump stop when the tyre is squashed past the travel
      if (hit.distance < T.wheelRadius) fs += T.spring * 6 * (T.wheelRadius - hit.distance);
      fs = clamp(fs, 0, T.mass * T.gravity * 2.5);
      w.load = fs;
      _f.copy(_up).multiplyScalar(fs);
      b.applyForceAt(_f, _a);
    }
    // anti-roll bars
    for (let i = 0; i < 4; i += 2) {
      const l = this.wheels[i];
      const r = this.wheels[i + 1];
      if (!l.contact && !r.contact) continue;
      const d = (l.comp - r.comp) * T.antiRoll;
      if (l.contact) {
        b.localToWorld(l.anchor, _a);
        b.applyForceAt(_f.copy(_up).multiplyScalar(d), _a);
      }
      if (r.contact) {
        b.localToWorld(r.anchor, _a);
        b.applyForceAt(_f.copy(_up).multiplyScalar(-d), _a);
      }
    }
    // tyres
    const m4 = T.mass / 4;
    for (const w of this.wheels) {
      if (!w.contact) continue;
      const load = w.load;
      if (load <= 0) continue;
      const n = w.normal;
      // wheel heading
      if (w.front && Math.abs(this.steer) > 1e-4) {
        _q.setFromAxisAngle(_up, this.steer);
        _wf.copy(_fwd).applyQuaternion(_q);
      } else _wf.copy(_fwd);
      _wf.addScaledVector(n, -_wf.dot(n)).normalize();
      _ws.crossVectors(n, _wf);
      // contact point, lifted toward the COM to tame body roll
      b.localToWorld(w.anchor, _a);
      _cp.copy(_a).addScaledVector(_down, w.susLen + T.wheelRadius);
      b.pointVelocity(_cp, _pv);
      const vLong = _pv.dot(_wf);
      const vLat = _pv.dot(_ws);
      const rear = !w.front;
      const hb = this.handbrake && rear;
      const mu = hb ? T.muRearHandbrake : rear ? T.muRear : T.muFront;
      const maxF = mu * load;
      let fLat = -vLat * T.cornering * (hb ? 0.35 : 1);
      let fLong = 0;
      if (drive !== 0) fLong += (drive * T.driveForce) / 4;
      const stopF = (Math.abs(vLong) * m4) / h * 0.5;
      if (brake > 0 || hb || parking) {
        const bf = hb ? T.brakeForce * 0.6 : parking ? T.brakeForce * 0.5 : brake * T.brakeForce;
        fLong -= Math.sign(vLong) * Math.min(bf / 4, stopF);
      }
      fLong -= Math.sign(vLong) * Math.min(T.rolling / 4 + T.aero * vLong * vLong * 0.25, stopF);
      const mag = Math.hypot(fLat, fLong);
      if (mag > maxF) {
        const s = maxF / mag;
        fLat *= s;
        fLong *= s;
      }
      const slip = Math.abs(vLat) + (hb ? Math.abs(vLong) * 0.5 : 0);
      w.slip = slip;
      if (slip > maxSlip) maxSlip = slip;
      _f.copy(_wf).multiplyScalar(fLong).addScaledVector(_ws, fLat);
      // apply at the contact's along/side position, raised toward the COM
      _v2.copy(_a).addScaledVector(_down, w.susLen + T.wheelRadius);
      _v2.addScaledVector(_up, (w.susLen + T.wheelRadius) * T.rollCentre);
      b.applyForceAt(_f, _v2);
    }
    this.groundContacts = contacts;
    this.maxSlip = maxSlip;
  }

  /** 1 below 60% of the top speed, fading to 0 at the top speed. */
  private taper(v: number, top: number) {
    return clamp((top - v) / (top * 0.4), 0, 1);
  }

  protected override afterStep(dt: number) {
    if (this.engine) {
      // fake 4-speed gearbox
      const f = clamp(Math.abs(this.forwardSpeed) / T.topSpeed, 0, 1.1) * 4;
      const gear = Math.min(3, Math.floor(f));
      const rpm = gear === 0 ? f : f - gear;
      const load = Math.abs(this.throttle);
      this.engine.setPitch(0.62 + rpm * 0.55 + gear * 0.06 + load * 0.08);
      this.engine.setVolume(0.42 + load * 0.3);
      this.engine.setPos(this.body.pos);
    }
    if (this.skid) {
      const grounded = this.groundContacts >= 2;
      const s = grounded ? clamp((this.maxSlip - 2.5) / 6, 0, 1) : 0;
      this.skid.setVolume(s * 0.7, 0.05);
      this.skid.setPitch(0.9 + s * 0.2);
      this.skid.setPos(this.body.pos);
    }
    // tyre smoke when sliding
    this.dustT -= dt;
    if (this.dustT <= 0 && this.maxSlip > 4 && this.groundContacts >= 2) {
      this.dustT = 0.05;
      for (const w of this.wheels) {
        if (!w.contact || w.slip < 4) continue;
        w.pivot.getWorldPosition(_v);
        _v.y -= T.wheelRadius * 0.8;
        _v2.set(rand(-0.5, 0.5), rand(0.4, 1.2), rand(-0.5, 0.5));
        G.fx.puff(_v, _v2, rand(0.4, 0.7), 0.12, 0.5, 0xcfc8bb, 0xa59e92, -0.5, 1.5);
      }
    }
  }

  protected override onCrash(f: number) {
    if (this.occupied) G.player.addTrauma(0.1 + f * 0.3);
    G.fx.puff(this.body.pos, _v.set(0, 1, 0), 0.5, 0.2, 0.7, 0xb9b3a8, 0x8d8880, -0.3, 2);
  }

  protected animate(dt: number) {
    for (const w of this.wheels) {
      w.pivot.position.set(w.anchor.x, w.anchor.y - w.susLen, w.anchor.z);
      w.pivot.rotation.y = w.front ? this.steer : 0;
      // roll with the ground (or spin freely with the throttle when airborne)
      if (w.contact) w.spin -= (this.forwardSpeed / T.wheelRadius) * dt;
      else w.spin -= this.throttle * 18 * dt;
      w.mesh.rotation.x = w.spin;
      w.mesh.rotation.y = w.left ? Math.PI : 0;
    }
    this.steeringWheel.rotation.z = -this.steer * 2.6;
    this.turret.update(dt);
  }

  /** public wrapper so the turret can trace without hitting its own truck */
  withoutBoxPublic<T2>(fn: () => T2): T2 {
    return this.withoutBox(fn);
  }
}

