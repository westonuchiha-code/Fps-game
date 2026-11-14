import * as THREE from 'three';
import { G } from '../core/globals';
import { clamp, damp, lerp, DEG } from '../core/math';
import { Kit } from '../render/kit';
import { flat, PAL, shade } from '../render/toon';
import { drawSmile } from '../render/textures';
import { LAYER_FX } from '../render/pipeline';

export type CharKind = 'assoc' | 'super' | 'striker' | 'manager';
export type Mood = 'happy' | 'angry' | 'hurt' | 'dead';

export const B = { root: 0, pelvis: 1, chest: 2, head: 3, armL: 4, foreL: 5, armR: 6, foreR: 7, thighL: 8, shinL: 9, thighR: 10, shinR: 11 } as const;

interface Spec {
  hip: number; // hip joint height
  spine: number; // chest pivot height
  neck: number;
  shoulderY: number;
  shoulderX: number;
  upperArm: number;
  hipX: number;
  thigh: number; // thigh length (shin gets the rest of `hip`)
  scale: number;
}

const HUMAN: Spec = { hip: 0.9, spine: 1.1, neck: 1.5, shoulderY: 1.42, shoulderX: 0.25, upperArm: 0.28, hipX: 0.1, thigh: 0.44, scale: 1 };
const MECH: Spec = { hip: 1.45, spine: 1.75, neck: 2.7, shoulderY: 2.45, shoulderX: 0.98, upperArm: 0.62, hipX: 0.46, thigh: 0.72, scale: 1 };

let faceTex: THREE.CanvasTexture | null = null;
const MOODS: Mood[] = ['happy', 'angry', 'hurt', 'dead'];
function faceTexture() {
  if (faceTex) return faceTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0e1016';
  g.fillRect(0, 0, 256, 64);
  MOODS.forEach((m, i) => drawSmile(g, i * 64 + 32, 34, 22, m === 'angry' ? '#ff5a3c' : m === 'dead' ? '#7c8088' : '#ffd21f', m));
  faceTex = new THREE.CanvasTexture(c);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  faceTex.magFilter = THREE.NearestFilter;
  return faceTex;
}

export interface Palette {
  shell: number;
  dark: number;
  accent: number;
  trim: number;
}

export class CharModel {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[] = [];
  readonly muzzle = new THREE.Object3D();
  readonly spec: Spec;
  private face: THREE.Mesh | null = null;
  private mood: Mood = 'happy';
  /** per-bone loose geometry for the "falls to bits" death */
  private partGeos: Map<number, THREE.BufferGeometry>;
  shield: THREE.Mesh | null = null;
  /** optional hand-held prop (ally rifles) */
  held: THREE.Object3D | null = null;
  height: number;
  /** glowing bits (blaster tip, vents) */
  glow: THREE.Mesh[] = [];

  constructor(
    readonly kind: CharKind,
    readonly pal: Palette,
    variant = 0,
  ) {
    const s = (this.spec = kind === 'manager' ? MECH : { ...HUMAN, scale: kind === 'super' ? 1.12 : 1 });
    const k = new Kit();
    const bind: [number, number, number, number][] = [
      // parent, x, y, z (absolute bind position)
      [-1, 0, 0, 0],
      [0, 0, s.hip + 0.02, 0],
      [1, 0, s.spine, 0],
      [2, 0, s.neck, 0],
      [2, -s.shoulderX, s.shoulderY, 0],
      [4, -s.shoulderX, s.shoulderY - s.upperArm, 0],
      [2, s.shoulderX, s.shoulderY, 0],
      [6, s.shoulderX, s.shoulderY - s.upperArm, 0],
      [1, -s.hipX, s.hip, 0],
      [8, -s.hipX, s.hip - s.thigh, 0],
      [1, s.hipX, s.hip, 0],
      [10, s.hipX, s.hip - s.thigh, 0],
    ];
    for (let i = 0; i < bind.length; i++) {
      const b = new THREE.Bone();
      const [p, x, y, z] = bind[i];
      if (p >= 0) {
        const pb = bind[p];
        b.position.set(x - pb[1], y - pb[2], z - pb[3]);
        this.bones[p].add(b);
      } else b.position.set(x, y, z);
      this.bones.push(b);
    }

    if (kind === 'manager') this.buildMech(k, s);
    else if (kind === 'striker') this.buildStriker(k, s, variant);
    else this.buildRobot(k, s, kind === 'super');

    this.partGeos = k.splitByBone();
    const geo = k.skinnedGeometry();
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, s.neck * 0.55, 0), s.neck * 1.1);
    this.mesh = new THREE.SkinnedMesh(geo, G.mat.char);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.add(this.bones[0]);
    this.bones[0].updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.root.add(this.mesh);
    this.root.scale.setScalar(s.scale);
    this.height = (kind === 'manager' ? 3.3 : 1.82) * s.scale;
  }

  // ------------------------------------------------------------------ builders

  private limb(k: Kit, bone: number, x: number, y0: number, y1: number, r: number, color: number) {
    k.curBone = bone;
    k.cyl(r, r, Math.abs(y1 - y0), color, [x, (y0 + y1) / 2, 0], 'y', 6, false);
  }

  private buildRobot(k: Kit, s: Spec, boss: boolean) {
    const P = this.pal;
    const sh = P.shell;
    const dk = P.dark;
    // pelvis
    k.curBone = B.pelvis;
    k.box(0.3, 0.16, 0.2, dk, [0, s.hip + 0.02, 0]);
    k.box(0.34, 0.07, 0.24, sh, [0, s.hip + 0.1, 0]);
    // chest (front is -Z)
    k.curBone = B.chest;
    k.taper(0.36, 0.4, 0.22, 1.18, 1.1, sh, [0, 1.3, 0]);
    k.box(0.3, 0.2, 0.02, P.accent, [0, 1.3, -0.13]); // vest panel
    k.box(0.09, 0.05, 0.022, PAL.shell, [0.08, 1.36, -0.14]); // name badge
    k.box(0.26, 0.26, 0.09, dk, [0, 1.3, 0.15]); // battery pack
    k.cyl(0.055, 0.055, 0.1, dk, [0, 1.49, 0], 'y', 6);
    if (boss) {
      k.profile([[-0.132, 1.44], [-0.132, 1.2], [-0.15, 1.16], [-0.132, 1.12]], 0.05, 0xc0281e, [0, 0, 0]); // tie
      k.box(0.16, 0.06, 0.2, P.trim, [-0.29, 1.48, 0]);
      k.box(0.16, 0.06, 0.2, P.trim, [0.29, 1.48, 0]);
    }
    // head: a little monitor
    k.curBone = B.head;
    k.box(0.3, 0.25, 0.22, sh, [0, 1.65, 0]);
    k.box(0.26, 0.2, 0.02, PAL.screen, [0, 1.65, -0.112]);
    k.cyl(0.006, 0.006, 0.12, dk, [0.1, 1.83, 0.05], 'y', 4);
    k.sphere(0.022, P.accent, [0.1, 1.9, 0.05]);
    if (boss) k.box(0.34, 0.05, 0.26, P.trim, [0, 1.79, 0]);
    // arms
    for (const side of [-1, 1]) {
      const x = side * s.shoulderX;
      const up = side < 0 ? B.armL : B.armR;
      const fo = side < 0 ? B.foreL : B.foreR;
      k.curBone = up;
      k.box(0.12, 0.12, 0.13, sh, [x, s.shoulderY + 0.01, 0]);
      this.limb(k, up, x, s.shoulderY - 0.04, s.shoulderY - s.upperArm, 0.04, dk);
      k.curBone = fo;
      const ey = s.shoulderY - s.upperArm;
      if (side > 0) {
        // right forearm is the built-in blaster ("price gun")
        k.box(0.12, 0.2, 0.12, sh, [x, ey - 0.12, 0]);
        k.cyl(0.04, 0.034, 0.16, dk, [x, ey - 0.28, 0], 'y', 6);
        k.cyl(0.05, 0.05, 0.03, P.accent, [x, ey - 0.33, 0], 'y', 6);
        k.box(0.03, 0.1, 0.05, P.accent, [x + 0.065, ey - 0.12, 0]);
      } else {
        k.box(0.09, 0.24, 0.09, sh, [x, ey - 0.13, 0]);
        k.box(0.03, 0.08, 0.07, dk, [x - 0.025, ey - 0.29, 0]);
        k.box(0.03, 0.08, 0.07, dk, [x + 0.025, ey - 0.29, 0]);
      }
    }
    // legs
    for (const side of [-1, 1]) {
      const x = side * s.hipX;
      const th = side < 0 ? B.thighL : B.thighR;
      const sn = side < 0 ? B.shinL : B.shinR;
      const ky = s.hip - s.thigh;
      this.limb(k, th, x, s.hip, ky, 0.05, dk);
      k.curBone = th;
      k.box(0.12, 0.28, 0.13, sh, [x, s.hip - 0.2, -0.01]);
      k.curBone = sn;
      k.box(0.11, 0.34, 0.12, sh, [x, ky - 0.2, 0]);
      k.cyl(0.055, 0.055, 0.13, dk, [x, ky, 0], 'x', 6);
      k.box(0.12, 0.07, 0.25, dk, [x, 0.035, -0.045]);
    }
    this.finishRobot(s, 0.3, 1.65, -0.124, 0.24, 0.18);
    this.muzzle.position.set(0, -0.36, 0);
    this.bones[B.foreR].add(this.muzzle);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 6), flat(PAL.smile));
    tip.position.set(0, -0.35, 0);
    this.bones[B.foreR].add(tip);
    this.glow.push(tip);
    if (boss) {
      const sm = new THREE.Mesh(new THREE.IcosahedronGeometry(1.08, 1), flat(PAL.shock, { additive: true, opacity: 0.0, side: THREE.DoubleSide, fog: false }).clone());
      sm.position.y = 0.95;
      sm.layers.set(LAYER_FX);
      sm.scale.set(0.75, 1, 0.75);
      this.root.add(sm);
      this.shield = sm;
    }
  }

  private finishRobot(_s: Spec, _w: number, faceY: number, faceZ: number, fw: number, fh: number) {
    const fg = new THREE.PlaneGeometry(fw, fh);
    fg.rotateY(Math.PI);
    const face = new THREE.Mesh(fg, flat(0xffffff, { map: faceTexture() }));
    // head bone bind position is (0, neck, 0)
    face.position.set(0, faceY - this.spec.neck, faceZ);
    this.bones[B.head].add(face);
    this.face = face;
    this.setMood('happy', true);
  }

  private buildStriker(k: Kit, s: Spec, variant: number) {
    const skin = variant % 2 === 0 ? PAL.skin1 : PAL.skin2;
    const shirt = [PAL.denim, 0x7a3b3b, 0x4f6b4a][variant % 3];
    const pants = [0x2c3140, 0x3a3328, 0x2e3a4a][variant % 3];
    const hat = [0xf0c020, 0xe8e2d0, PAL.hivis][variant % 3];
    k.curBone = B.pelvis;
    k.box(0.32, 0.18, 0.22, pants, [0, s.hip + 0.03, 0]);
    k.box(0.34, 0.05, 0.24, 0x3a2a20, [0, s.hip + 0.12, 0]); // belt
    k.curBone = B.chest;
    k.taper(0.36, 0.42, 0.23, 1.16, 1.08, shirt, [0, 1.3, 0]);
    // hi-vis vest with reflective bands
    k.box(0.4, 0.34, 0.245, PAL.hivis, [0, 1.3, 0]);
    k.box(0.41, 0.04, 0.25, 0xe8e8d8, [0, 1.24, 0]);
    k.box(0.1, 0.36, 0.25, shirt, [0, 1.3, -0.004]); // open front
    k.box(0.22, 0.2, 0.1, 0x4a4f3a, [0, 1.28, 0.16]); // pack
    k.cyl(0.05, 0.05, 0.1, skin, [0, 1.5, 0], 'y', 6);
    k.curBone = B.head;
    k.box(0.2, 0.23, 0.21, skin, [0, 1.65, 0]);
    k.box(0.21, 0.07, 0.04, 0x15161c, [0, 1.68, -0.1]); // safety goggles
    k.box(0.21, 0.09, 0.215, 0xb5382e, [0, 1.58, -0.004]); // bandana
    if (variant % 3 === 2) k.box(0.22, 0.09, 0.23, hat, [0, 1.775, 0]); // beanie
    else {
      k.taper(0.24, 0.1, 0.25, 0.8, 0.8, hat, [0, 1.8, 0]);
      k.box(0.26, 0.02, 0.32, hat, [0, 1.755, -0.03]);
    }
    for (const side of [-1, 1]) {
      const x = side * (s.shoulderX - 0.02);
      const up = side < 0 ? B.armL : B.armR;
      const fo = side < 0 ? B.foreL : B.foreR;
      k.curBone = up;
      k.box(0.11, 0.3, 0.12, shirt, [x, s.shoulderY - 0.13, 0]);
      k.curBone = fo;
      const ey = s.shoulderY - s.upperArm;
      k.box(0.095, 0.24, 0.1, shirt, [x, ey - 0.11, 0]);
      k.box(0.09, 0.09, 0.1, 0x6a4a36, [x, ey - 0.28, 0]); // work glove
    }
    for (const side of [-1, 1]) {
      const x = side * s.hipX;
      const th = side < 0 ? B.thighL : B.thighR;
      const sn = side < 0 ? B.shinL : B.shinR;
      const ky = s.hip - s.thigh;
      k.curBone = th;
      k.box(0.14, 0.46, 0.15, pants, [x, s.hip - 0.21, 0]);
      k.curBone = sn;
      k.box(0.125, 0.36, 0.14, pants, [x, ky - 0.19, 0]);
      k.box(0.13, 0.1, 0.27, 0x3a2a20, [x, 0.05, -0.05]); // boots
    }
    this.muzzle.position.set(0, -0.3, -0.5);
    this.bones[B.foreR].add(this.muzzle);
  }

  private buildMech(k: Kit, s: Spec) {
    const P = this.pal;
    const sh = P.shell;
    const dk = P.dark;
    k.curBone = B.pelvis;
    k.box(1.0, 0.4, 0.7, dk, [0, s.hip + 0.05, 0]);
    k.cyl(0.3, 0.3, 0.3, dk, [0, s.hip + 0.25, 0], 'y', 8, false);
    k.curBone = B.chest;
    // barrel torso with hazard chevrons
    k.taper(1.5, 1.0, 1.05, 1.12, 1.0, sh, [0, 2.2, 0]);
    k.box(1.3, 0.16, 0.04, PAL.screen, [0, 1.86, -0.54]);
    k.box(1.56, 0.12, 1.1, PAL.screen, [0, 2.72, 0]);
    for (let i = -2; i <= 2; i++) k.box(0.14, 0.3, 0.03, PAL.screen, [i * 0.26, 1.95, -0.55], [0, 0, 0.5]);
    // armour slab protecting the front
    k.box(1.2, 0.5, 0.12, shade(sh, 0.85), [0, 2.4, -0.6]);
    // cooling unit on the back: the weak point
    k.box(0.9, 0.7, 0.28, dk, [0, 2.25, 0.62]);
    for (let i = 0; i < 4; i++) k.box(0.76, 0.06, 0.06, 0x55585f, [0, 2.0 + i * 0.16, 0.77]);
    k.cyl(0.07, 0.07, 0.5, dk, [-0.5, 2.9, 0.4], 'y', 6);
    k.cyl(0.07, 0.07, 0.36, dk, [0.5, 2.85, 0.4], 'y', 6);
    k.curBone = B.head;
    // cockpit monitor
    k.box(0.9, 0.62, 0.5, sh, [0, 3.02, -0.1]);
    k.box(0.8, 0.52, 0.04, PAL.screen, [0, 3.02, -0.36]);
    k.box(0.96, 0.08, 0.56, P.trim, [0, 3.36, -0.1]);
    for (const side of [-1, 1]) {
      const x = side * s.shoulderX;
      const up = side < 0 ? B.armL : B.armR;
      const fo = side < 0 ? B.foreL : B.foreR;
      k.curBone = up;
      k.box(0.5, 0.46, 0.56, sh, [x, s.shoulderY, 0]);
      k.box(0.54, 0.1, 0.6, PAL.screen, [x, s.shoulderY + 0.24, 0]);
      this.limb(k, up, x, s.shoulderY - 0.2, s.shoulderY - s.upperArm, 0.13, dk);
      k.curBone = fo;
      const ey = s.shoulderY - s.upperArm;
      if (side > 0) {
        // cannon arm
        k.box(0.42, 0.5, 0.42, sh, [x, ey - 0.28, 0]);
        k.cyl(0.17, 0.15, 0.5, dk, [x, ey - 0.76, 0], 'y', 8);
        k.cyl(0.2, 0.2, 0.08, P.accent, [x, ey - 1.0, 0], 'y', 8);
      } else {
        // rubber-stamp fist
        k.box(0.36, 0.5, 0.36, sh, [x, ey - 0.28, 0]);
        k.box(0.5, 0.3, 0.5, dk, [x, ey - 0.68, 0]);
        k.box(0.54, 0.06, 0.54, 0xc0281e, [x, ey - 0.86, 0]);
      }
    }
    for (const side of [-1, 1]) {
      const x = side * s.hipX;
      const th = side < 0 ? B.thighL : B.thighR;
      const sn = side < 0 ? B.shinL : B.shinR;
      const ky = s.hip - s.thigh;
      this.limb(k, th, x, s.hip, ky, 0.14, dk);
      k.curBone = th;
      k.box(0.36, 0.5, 0.4, sh, [x, s.hip - 0.34, -0.02]);
      k.curBone = sn;
      k.box(0.34, 0.5, 0.36, sh, [x, ky - 0.3, 0]);
      k.box(0.46, 0.18, 0.7, dk, [x, 0.09, -0.08]);
      k.box(0.48, 0.05, 0.3, PAL.smile, [x, 0.2, -0.3]);
    }
    this.finishRobot(s, 0.8, 3.02, -0.385, 0.74, 0.46);
    this.muzzle.position.set(0, -1.08, 0);
    this.bones[B.foreR].add(this.muzzle);
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.04), flat(0xff7b1c));
    vent.position.set(0, 2.25 - s.spine, 0.74);
    this.bones[B.chest].add(vent);
    this.glow.push(vent);
  }

  // ------------------------------------------------------------------ runtime

  setMood(m: Mood, force = false) {
    if (!this.face || (m === this.mood && !force)) return;
    this.mood = m;
    const i = MOODS.indexOf(m);
    const uv = this.face.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const u0 = i / 4;
    const u1 = (i + 1) / 4;
    // PlaneGeometry uv order: (0,1) (1,1) (0,0) (1,0)
    uv.setXY(0, u0, 1);
    uv.setXY(1, u1, 1);
    uv.setXY(2, u0, 0);
    uv.setXY(3, u1, 0);
    uv.needsUpdate = true;
  }

  /** World position of a bone's origin. */
  bonePos(bone: number, out: THREE.Vector3) {
    return out.setFromMatrixPosition(this.bones[bone].matrixWorld);
  }

  /** Loose pieces for the destruction effect: [geometry, world matrix] per bone. */
  parts(): { geo: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] {
    const out: { geo: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] = [];
    this.root.updateMatrixWorld(true);
    const inv = this.mesh.skeleton.boneInverses;
    for (const [b, geo] of this.partGeos) {
      if (b === B.root) continue;
      // bind-space geometry -> current world = boneWorld * boneInverse
      const m = new THREE.Matrix4().multiplyMatrices(this.bones[b].matrixWorld, inv[b]);
      out.push({ geo, matrix: m });
    }
    return out;
  }

  dispose() {
    this.root.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.skeleton.dispose();
    for (const g of this.partGeos.values()) g.dispose();
  }
}

const _e = new THREE.Euler();

/** Inputs the brain sets each frame; the animator turns them into bone rotations. */
export class CharAnim {
  /** horizontal speed and local movement direction (x = right, z = forward) */
  speed = 0;
  moveX = 0;
  moveZ = 1;
  /** 0 relaxed .. 1 weapon up */
  aim = 0;
  aimPitch = 0;
  /** torso twist relative to the feet */
  twist = 0;
  crouch = 0;
  /** head look relative to torso */
  headYaw = 0;
  headPitch = 0;
  /** recoil pulse, flinch pulse (decay automatically) */
  kick = 0;
  flinch = 0;
  flinchSide = 0;
  /** 0 alive .. 1 fully collapsed */
  dead = 0;
  deadSide = 1;
  /** seated pose (vehicles) */
  sit = 0;
  /** arms-up panic run */
  panic = 0;
  /** melee swing progress 0..1 (0 = none) */
  swing = 0;
  /** stomp wind-up for the mech */
  stomp = 0;
  phase = Math.random() * 6;
  private cCrouch = 0;
  private cAim = 0;
  private cTwist = 0;
  private cPitch = 0;
  private cSpeed = 0;
  private t = Math.random() * 10;
  twoHanded = false;

  constructor(private m: CharModel) {}

  update(dt: number) {
    const b = this.m.bones;
    const s = this.m.spec;
    this.t += dt;
    this.cCrouch = damp(this.cCrouch, this.crouch, 9, dt);
    this.cAim = damp(this.cAim, this.aim, 10, dt);
    this.cTwist = damp(this.cTwist, this.twist, 10, dt);
    this.cPitch = damp(this.cPitch, this.aimPitch, 10, dt);
    this.cSpeed = damp(this.cSpeed, this.speed, 8, dt);
    this.kick = damp(this.kick, 0, 14, dt);
    this.flinch = damp(this.flinch, 0, 7, dt);

    const sp = this.cSpeed;
    const run = clamp(sp / 4.5, 0, 1);
    const stride = lerp(1.5, 2.6, run) * (this.m.kind === 'manager' ? 1.9 : 1);
    this.phase += (sp / stride) * Math.PI * 2 * dt;
    const ph = this.phase;
    const moving = clamp(sp / 0.6, 0, 1);
    const swing = lerp(0.45, 0.95, run) * moving;
    const back = this.moveZ < -0.3 ? -1 : 1;

    // ---- legs ----
    const legLen = s.hip;
    const drop = this.cCrouch * 0.36 + this.sit * 0.42;
    const bend = Math.acos(clamp((legLen - drop * (legLen / 0.9)) / legLen, 0.3, 1));
    const bob = Math.abs(Math.sin(ph)) * 0.05 * moving * (legLen / 0.9);
    for (const side of [-1, 1]) {
      const p = ph + (side > 0 ? Math.PI : 0);
      const fwd = Math.sin(p) * swing * back;
      const lift = Math.max(0, Math.cos(p)) * lerp(0.5, 1.1, run) * moving;
      const th = b[side < 0 ? B.thighL : B.thighR];
      const sn = b[side < 0 ? B.shinL : B.shinR];
      if (this.sit > 0.5) {
        th.rotation.set(1.45, 0, side * 0.12);
        sn.rotation.set(-1.4, 0, 0);
      } else {
        th.rotation.set(fwd + bend + lift * 0.35, 0, side * 0.03 + this.moveX * 0.12 * moving);
        sn.rotation.set(-(bend * 2 + lift), 0, 0);
      }
    }

    // ---- pelvis / root pose ----
    const dead = this.dead;
    const de = dead * dead * (3 - 2 * dead);
    const pel = b[B.pelvis];
    const hipY = s.hip + 0.02 - drop * (legLen / 0.9) + bob;
    pel.position.set(0, lerp(hipY, 0.32 * (legLen / 0.9), de), lerp(0, 0.25, de) + this.sit * 0.0);
    pel.rotation.set(lerp(run * 0.12 * back, -1.35 * this.deadSide, de), 0, lerp(Math.sin(ph) * 0.04 * moving, 0.25, de));

    // ---- torso ----
    const ch = b[B.chest];
    const breathe = Math.sin(this.t * 1.7) * 0.012;
    _e.set(breathe + this.cPitch * 0.45 * this.cAim - this.flinch * 0.35 + this.cCrouch * 0.25 + this.stomp * 0.4 - de * 0.3, this.cTwist + this.flinchSide * this.flinch * 0.4, Math.sin(ph) * -0.05 * moving, 'YXZ');
    ch.rotation.copy(_e);
    b[B.head].rotation.set(clamp(this.headPitch, -0.6, 0.6) - this.flinch * 0.3 + de * 0.5, clamp(this.headYaw, -1.1, 1.1), de * 0.4 * this.deadSide, 'YXZ');

    // ---- arms ----
    const a = this.cAim;
    const armSwing = Math.sin(ph) * swing * 0.7 * (1 - a);
    const pitch = this.cPitch * 0.55;
    const aL = b[B.armL];
    const fL = b[B.foreL];
    const aR = b[B.armR];
    const fR = b[B.foreR];
    if (this.panic > 0.5) {
      // hands in the air, flailing
      aL.rotation.set(2.9 + Math.sin(this.t * 14) * 0.3, 0, -0.3);
      aR.rotation.set(2.9 + Math.cos(this.t * 13) * 0.3, 0, 0.3);
      fL.rotation.set(0.3, 0, 0);
      fR.rotation.set(0.3, 0, 0);
    } else if (this.m.kind === 'striker') {
      // two-handed rifle: relaxed low-ready -> shouldered
      aR.rotation.set(lerp(0.55, 1.15 + pitch, a) + armSwing * 0.3, 0, lerp(-0.1, -0.35, a));
      fR.rotation.set(lerp(0.9, 0.42, a) - this.kick * 0.2, 0, lerp(-0.5, -0.1, a));
      aL.rotation.set(lerp(0.75, 1.35 + pitch, a) - armSwing * 0.3, 0, lerp(0.35, 0.62, a));
      fL.rotation.set(lerp(0.75, 0.25, a), 0, lerp(0.7, 0.3, a));
    } else {
      // blaster arm points at the target; off-hand balances
      const sw = this.swing > 0 ? Math.sin(this.swing * Math.PI) : 0;
      aR.rotation.set(lerp(0.12 - armSwing, 1.48 + pitch - this.kick * 0.25, a) + this.stomp * 0.5, 0, lerp(0.08, 0.02, a));
      fR.rotation.set(lerp(0.25, 0.08, a) + this.kick * 0.2, 0, 0);
      aL.rotation.set(lerp(0.1 + armSwing, 0.35, a) + sw * 2.4 + this.stomp * 2.2, 0, lerp(-0.1, -0.22, a) - sw * 0.3);
      fL.rotation.set(lerp(0.3, 0.9, a) + sw * 0.4, 0, 0);
    }
    if (de > 0) {
      aL.rotation.x = lerp(aL.rotation.x, -0.6, de);
      aR.rotation.x = lerp(aR.rotation.x, -0.9, de);
      aL.rotation.z = lerp(aL.rotation.z, -1.0, de);
      aR.rotation.z = lerp(aR.rotation.z, 1.1, de);
    }
  }
}

export const PALETTES: Record<string, Palette> = {
  assoc: { shell: PAL.shell, dark: PAL.screen, accent: PAL.smile, trim: PAL.smile },
  super: { shell: PAL.mgmt, dark: 0x0e0f14, accent: PAL.gold, trim: PAL.gold },
  manager: { shell: PAL.smile, dark: 0x2a2c34, accent: 0xff7b1c, trim: PAL.screen },
  striker: { shell: PAL.hivis, dark: PAL.denim, accent: PAL.hivis, trim: PAL.rust },
};

export { DEG };
