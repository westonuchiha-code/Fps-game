import * as THREE from 'three';
import { Kit } from '../render/kit';
import { toon, flat, RAMP_CHAR, PAL } from '../render/toon';
import { damp } from '../core/math';
import type { HandPose } from '../weapons/anim';

/**
 * First-person hand + forearm.
 *
 * Hand frame: +Y = back of the hand, -Z = towards the fingertips, +Z = towards the wrist.
 * The right hand has its thumb on -X; the left hand is a mirror image.
 */

// [fingersA, fingersB, indexA, indexB, thumbCurl, thumbSplay] in radians
const POSES: Record<HandPose, number[]> = {
  grip: [1.3, 1.45, 0.55, 0.95, 0.55, 0.55],
  fore: [1.0, 1.05, 0.95, 1.0, 0.25, 0.95],
  open: [0.12, 0.18, 0.08, 0.12, 0.1, 0.6],
  pinch: [1.1, 1.25, 0.95, 1.15, 0.75, 0.3],
  fist: [1.5, 1.6, 1.5, 1.6, 0.95, 0.2],
  point: [1.5, 1.6, 0.05, 0.05, 0.85, 0.3],
  relax: [0.5, 0.6, 0.4, 0.5, 0.3, 0.5],
};

const COL = { glove: 0xb07a48, gloveDark: 0x6d4628, sleeve: 0x232a40, cuff: PAL.shirt, steel: 0x9aa4b0 };

const _v = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class Hand {
  readonly root = new THREE.Group();
  readonly forearm = new THREE.Group();
  private fingersA = new THREE.Group();
  private fingersB = new THREE.Group();
  private indexA = new THREE.Group();
  private indexB = new THREE.Group();
  private thumbA = new THREE.Group();
  private thumbB = new THREE.Group();
  private cur = POSES.grip.slice();
  pose: HandPose = 'grip';
  /** extra index-finger curl (trigger squeeze) */
  trigger = 0;
  /** elbow position in the hand's parent space; the forearm always points at it */
  readonly elbow = new THREE.Vector3();
  /** the wristwatch (left hand only) */
  watch: THREE.Group | null = null;
  watchScreen: THREE.Mesh | null = null;

  constructor(readonly side: 1 | -1) {
    const s = side; // +1 right hand (thumb at -X), -1 left hand (thumb at +X)
    const mat = toon({ vertexColors: true, ramp: RAMP_CHAR, rim: 0.25 });
    const part = (g: THREE.Group, build: (k: Kit) => void) => {
      const k = new Kit();
      build(k);
      g.add(new THREE.Mesh(k.geometry(), mat));
    };
    // palm + cuff
    part(this.root, (k) => {
      k.taper(0.078, 0.026, 0.09, 0.94, 0.96, COL.glove, [0, 0, 0]);
      k.box(0.058, 0.006, 0.04, COL.gloveDark, [0.004 * s, 0.015, -0.004]); // knuckle guard
      k.box(0.07, 0.036, 0.03, COL.gloveDark, [0, 0, 0.056]);
    });
    // middle, ring and little finger: one mesh per segment row, but modelled as separate fingers
    const fx = [-0.0095 * s, 0.0095 * s, 0.0275 * s];
    const fl = [0.042, 0.04, 0.032];
    this.fingersA.position.set(0, 0, -0.045);
    part(this.fingersA, (k) => fx.forEach((x, i) => k.box(0.0165, 0.021, fl[i], COL.glove, [x, 0, -fl[i] / 2])));
    this.fingersB.position.set(0, 0, -0.04);
    part(this.fingersB, (k) => fx.forEach((x, i) => k.taper(0.0155, 0.036 - i * 0.004, 0.019, 0.8, 0.8, COL.glove, [x, 0, -0.018 + i * 0.002 + (0.04 - fl[i]) * -1 * 0], [-Math.PI / 2, 0, 0])));
    this.fingersA.add(this.fingersB);
    // index finger
    this.indexA.position.set(-0.029 * s, 0, -0.045);
    part(this.indexA, (k) => k.box(0.0175, 0.021, 0.04, COL.glove, [0, 0, -0.02]));
    this.indexB.position.set(0, 0, -0.04);
    part(this.indexB, (k) => k.taper(0.0165, 0.036, 0.019, 0.8, 0.8, COL.glove, [0, 0, -0.018], [-Math.PI / 2, 0, 0]));
    this.indexA.add(this.indexB);
    // thumb
    this.thumbA.position.set(-0.036 * s, -0.006, 0.014);
    part(this.thumbA, (k) => k.box(0.021, 0.021, 0.04, COL.glove, [0, 0, -0.018]));
    this.thumbB.position.set(0, 0, -0.038);
    part(this.thumbB, (k) => k.taper(0.019, 0.032, 0.019, 0.8, 0.8, COL.glove, [0, 0, -0.016], [-Math.PI / 2, 0, 0]));
    this.thumbA.add(this.thumbB);
    this.root.add(this.fingersA, this.indexA, this.thumbA);

    // forearm: local +Z runs from the wrist to the elbow
    this.forearm.position.set(0, 0, 0.062);
    part(this.forearm, (k) => {
      k.cyl(0.034, 0.037, 0.028, COL.cuff, [0, 0, 0.012], 'z', 8, false);
      k.cyl(0.038, 0.056, 0.6, COL.sleeve, [0, 0, 0.325], 'z', 8, false);
      // jacket button
      k.box(0.008, 0.008, 0.008, 0xc9a23a, [0.04 * -s, 0.004, 0.05]);
    });
    this.root.add(this.forearm);

    if (side === -1) {
      // the detonator watch sits on the back of the left wrist
      const w = new THREE.Group();
      const k = new Kit();
      k.box(0.052, 0.014, 0.05, COL.steel, [0, 0, 0]);
      k.box(0.058, 0.008, 0.03, 0x2a2d36, [0, -0.002, 0]);
      k.cyl(0.006, 0.006, 0.008, 0xff3b30, [-0.03, 0.002, -0.01], 'x', 6); // crown / trigger stud
      k.cyl(0.0045, 0.0045, 0.006, COL.steel, [-0.029, 0.002, 0.012], 'x', 6);
      // strap wraps the wrist
      k.cyl(0.044, 0.046, 0.03, 0x2a2d36, [0, -0.042, 0.0], 'z', 8, false);
      w.add(new THREE.Mesh(k.geometry(), mat));
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.038), flat(0x9dff7a));
      screen.rotation.x = -Math.PI / 2;
      screen.position.y = 0.0075;
      w.add(screen);
      w.position.set(0, 0.044, 0.035);
      this.forearm.add(w);
      this.watch = w;
      this.watchScreen = screen;
    }
    this.elbow.set(0.3 * side, -0.38, 0.32);
  }

  update(dt: number) {
    const target = POSES[this.pose] ?? POSES.grip;
    for (let i = 0; i < 6; i++) this.cur[i] = damp(this.cur[i], target[i], 22, dt);
    const c = this.cur;
    const s = this.side;
    this.fingersA.rotation.x = -c[0];
    this.fingersB.rotation.x = -c[1];
    this.indexA.rotation.x = -(c[2] + this.trigger * 0.35);
    this.indexB.rotation.x = -(c[3] + this.trigger * 0.3);
    // thumb splays outwards around Y and curls in around its own X
    this.thumbA.rotation.set(-c[4] * 0.6, c[5] * s, -c[4] * 0.5 * s, 'YXZ');
    this.thumbB.rotation.x = -c[4];

    // aim the forearm at the elbow, keeping its "top" aligned with the back of the hand
    const parent = this.root.parent;
    if (parent) {
      this.root.updateMatrix();
      _m.copy(this.root.matrix).invert();
      _v.copy(this.elbow).applyMatrix4(_m).sub(this.forearm.position);
      if (_v.lengthSq() > 1e-6) {
        _z.copy(_v).normalize();
        _y.set(0, 1, 0).addScaledVector(_z, -_z.y);
        if (_y.lengthSq() < 1e-4) _y.set(0, 0, -1).addScaledVector(_z, _z.z);
        _y.normalize();
        _x.crossVectors(_y, _z).normalize();
        _m.makeBasis(_x, _y, _z);
        this.forearm.quaternion.setFromRotationMatrix(_m);
      }
    }
  }
}
