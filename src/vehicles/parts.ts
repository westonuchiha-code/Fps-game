import * as THREE from 'three';
import { Kit } from '../render/kit';
import { PAL } from '../render/toon';

type V3 = [number, number, number];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const DOWNV = new THREE.Vector3(0, -1, 0);

/** A box stretched between two points (limbs, struts, roll-cage tubes). */
export function limb(k: Kit, a: V3, b: V3, w: number, d: number, color: number) {
  _a.set(a[0], a[1], a[2]);
  _b.set(b[0], b[1], b[2]);
  const len = _a.distanceTo(_b);
  if (len < 1e-4) return;
  _q.setFromUnitVectors(DOWNV, _b.clone().sub(_a).normalize());
  _e.setFromQuaternion(_q, 'XYZ');
  const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  k.box(w, len, d, color, mid, [_e.x, _e.y, _e.z]);
}

/** A round tube between two points. */
export function tube(k: Kit, a: V3, b: V3, r: number, color: number, sides = 6) {
  _a.set(a[0], a[1], a[2]);
  _b.set(b[0], b[1], b[2]);
  const len = _a.distanceTo(_b);
  if (len < 1e-4) return;
  _q.setFromUnitVectors(DOWNV, _b.clone().sub(_a).normalize());
  _e.setFromQuaternion(_q, 'XYZ');
  const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  k.cyl(r, r, len, color, mid, 'y', sides, false, [_e.x, _e.y, _e.z]);
}

export interface RiderPose {
  /** hand positions relative to the hip (seat anchor), x is mirrored for the left hand */
  hand: V3;
  /** foot position relative to the hip, x mirrored */
  foot: V3;
  /** knee position relative to the hip, x mirrored */
  knee: V3;
  /** forward lean of the torso in radians */
  lean?: number;
}

/**
 * Clearance, seated: tuxedo, white shirt, bow tie, hi-vis orange vest with reflective stripes.
 * Built around the hip point (the seat anchor); forward is -Z.
 */
export function buildRider(pose: RiderPose): THREE.BufferGeometry {
  const k = new Kit();
  const lean = pose.lean ?? 0.12;
  const vest = PAL.hivis;
  const stripe = 0xe9eef0;
  // pelvis
  k.box(0.36, 0.18, 0.3, PAL.tux, [0, 0.05, 0.02]);
  k.push([0, 0.1, 0.02], [-lean, 0, 0]);
  // torso: tux jacket with vest over it
  k.taper(0.38, 0.5, 0.24, 1.12, 1.05, PAL.tux, [0, 0.25, 0]);
  k.taper(0.4, 0.36, 0.26, 1.1, 1.04, vest, [0, 0.24, 0.005]);
  k.box(0.405, 0.05, 0.265, stripe, [0, 0.16, 0.005]);
  k.box(0.415, 0.05, 0.27, stripe, [0, 0.3, 0.005]);
  // shirt + bow tie in the vest opening
  k.box(0.12, 0.2, 0.02, PAL.shirt, [0, 0.38, -0.125]);
  k.box(0.1, 0.045, 0.03, PAL.ink, [0, 0.46, -0.135]);
  // shoulders
  k.box(0.5, 0.1, 0.24, PAL.tux, [0, 0.47, 0]);
  // head
  k.box(0.1, 0.08, 0.1, PAL.skin1, [0, 0.55, 0]);
  k.box(0.21, 0.24, 0.23, PAL.skin1, [0, 0.69, -0.01]);
  k.box(0.23, 0.08, 0.25, 0x2a1d17, [0, 0.82, 0.01]); // hair
  k.box(0.22, 0.04, 0.05, 0x2a1d17, [0, 0.78, 0.115]);
  k.box(0.2, 0.045, 0.02, PAL.ink, [0, 0.72, -0.126]); // shades
  k.pop();
  // shoulders in hip space (approximately following the lean)
  const sy = 0.1 + 0.47 * Math.cos(lean);
  const sz = 0.02 - 0.47 * Math.sin(lean);
  for (const sx of [-1, 1]) {
    const sh: V3 = [sx * 0.24, sy, sz];
    const hand: V3 = [sx * pose.hand[0], pose.hand[1], pose.hand[2]];
    const elbow: V3 = [sx * (Math.abs(sh[0]) + Math.abs(hand[0])) * 0.55 + sx * 0.06, (sh[1] + hand[1]) / 2 - 0.08, (sh[2] + hand[2]) / 2 + 0.04];
    limb(k, sh, elbow, 0.12, 0.12, PAL.tux);
    limb(k, elbow, hand, 0.1, 0.1, PAL.tux);
    k.box(0.09, 0.03, 0.06, PAL.shirt, [hand[0], hand[1] + 0.005, hand[2] + 0.06]);
    k.box(0.09, 0.09, 0.1, PAL.skin1, hand);
    // legs
    const hip: V3 = [sx * 0.1, 0.02, 0];
    const knee: V3 = [sx * pose.knee[0], pose.knee[1], pose.knee[2]];
    const foot: V3 = [sx * pose.foot[0], pose.foot[1], pose.foot[2]];
    limb(k, hip, knee, 0.15, 0.16, PAL.tux);
    limb(k, knee, foot, 0.13, 0.13, PAL.tux);
    k.box(0.12, 0.08, 0.26, PAL.ink, [foot[0], foot[1] - 0.02, foot[2] - 0.06]);
  }
  return k.geometry();
}
