import * as THREE from 'three';
import { G } from '../core/globals';
import { clamp, damp, lerp, DEG } from '../core/math';
import { Kit, loftGeometry, type Ring } from '../render/kit';
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

const faceCache = new Map<string, THREE.CanvasTexture>();
/**
 * The drawn part of a human face, as ink on a transparent canvas: brows, eyes and mouth (the nose,
 * jaw and brow ridge are modelled). It is skinned over the front of the head, from just under the
 * mouth (bottom edge) to the forehead (top edge).
 */
function humanFace(style: 'plain' | 'moustache' | 'beard' | 'agent', hair: number) {
  const key = style + hair;
  let tex = faceCache.get(key);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const ink = '#15161c';
  const hairCss = '#' + hair.toString(16).padStart(6, '0');
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const EY = 96; // eye line
  if (style === 'agent') {
    // wraparound shades
    g.fillStyle = ink;
    g.beginPath();
    g.roundRect(40, EY - 20, 78, 36, 12);
    g.roundRect(138, EY - 20, 78, 36, 12);
    g.fill();
    g.fillRect(112, EY - 12, 32, 9);
    g.strokeStyle = '#59657a';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(56, EY - 10);
    g.lineTo(82, EY - 10);
    g.moveTo(154, EY - 10);
    g.lineTo(180, EY - 10);
    g.stroke();
  } else {
    for (const sx of [-1, 1]) {
      const ex = 128 + sx * 42;
      // almond eye: white, dark iris, heavy upper lid
      g.fillStyle = '#f1ece0';
      g.beginPath();
      g.ellipse(ex, EY, 19, 9.5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2b1c14';
      g.beginPath();
      g.arc(ex + sx * 1, EY - 1, 8.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f1ece0';
      g.fillRect(ex + sx * 1 - 4, EY - 6, 3, 3);
      g.strokeStyle = ink;
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(ex - 21, EY + 1);
      g.quadraticCurveTo(ex, EY - 17, ex + 21, EY + 1);
      g.stroke();
      g.strokeStyle = 'rgba(40,20,14,0.35)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(ex - 15, EY + 11);
      g.quadraticCurveTo(ex, EY + 15, ex + 15, EY + 10);
      g.stroke();
      // brow, set low and angled in: determined
      g.strokeStyle = hairCss;
      g.lineWidth = 10;
      g.beginPath();
      g.moveTo(ex + sx * 25, EY - 30);
      g.quadraticCurveTo(ex, EY - 36, ex - sx * 24, EY - 25);
      g.stroke();
    }
  }
  // mouth
  g.strokeStyle = style === 'beard' ? '#d9a48a' : '#5e2a22';
  g.lineWidth = 6;
  g.beginPath();
  if (style === 'agent') {
    g.moveTo(104, 214);
    g.quadraticCurveTo(134, 219, 158, 206); // half a smirk
  } else {
    g.moveTo(104, 214);
    g.quadraticCurveTo(128, 219, 152, 214);
  }
  g.stroke();
  if (style === 'moustache') {
    g.fillStyle = hairCss;
    g.beginPath();
    g.moveTo(128, 186);
    g.quadraticCurveTo(164, 180, 180, 210);
    g.quadraticCurveTo(152, 200, 128, 202);
    g.quadraticCurveTo(104, 200, 76, 210);
    g.quadraticCurveTo(92, 180, 128, 186);
    g.fill();
  }
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  faceCache.set(key, tex);
  return tex;
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
    const s = (this.spec = kind === 'manager' ? MECH : kind === 'striker' ? { ...HUMAN, shoulderX: 0.205, hipX: 0.09 } : { ...HUMAN, scale: kind === 'super' ? 1.12 : 1 });
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

  /**
   * A shoe: flat sole, toe box, instep rising to the ankle. Built upright at the ankle (x, 0, 0)
   * with the toe toward -Z; `sx`/`sy`/`sz` size it, `cap` paints a toe cap.
   */
  private foot(k: Kit, x: number, sx: number, sy: number, sz: number, sole: number, upper: number, cap?: number) {
    const F = (y: number, w: number, f: number, b: number): Ring => ({ y: y * sy, w: w * sx, f: f * sz, b: b * sz, x, n: 2.8 });
    k.loft(
      [F(0, 0, 0, 0), F(0.001, 0.052, 0.185, 0.068), F(0.022, 0.053, 0.187, 0.069), F(0.024, 0.048, 0.178, 0.062), F(0.06, 0.047, 0.172, 0.06), F(0.078, 0.045, 0.12, 0.058), F(0.1, 0.044, 0.07, 0.056), F(0.13, 0.046, 0.052, 0.054), F(0.135, 0, 0, 0)],
      (seg, d) => (seg <= 2 ? sole : cap !== undefined && seg <= 4 && d < 2 ? cap : upper),
      { sides: 12 },
    );
  }

  /** A hand hanging from the wrist at (x, wy): palm facing the body, four curled fingers, a thumb. */
  private hand(k: Kit, x: number, wy: number, side: number, color: number) {
    k.loft([[0.005, 0, 0, 0], [0, 0.016, 0.026, 0.026], [-0.035, 0.018, 0.043, 0.04], [-0.078, 0.016, 0.042, 0.038], [-0.088, 0, 0, 0]].map(([y, w, f, b]) => ({ y: wy + y, w, f, b, x, n: 2.6 })), color, { sides: 10 });
    const seg = (r: number, len: number, px: number, py: number, pz: number, rot: [number, number, number]) => {
      const g = new THREE.CapsuleGeometry(r, len, 2, 6);
      k.add(g, color, [px, py, pz], rot, true);
      g.dispose();
    };
    const zs = [-0.03, -0.0095, 0.011, 0.03];
    const lens = [0.036, 0.04, 0.037, 0.03];
    for (let i = 0; i < 4; i++) {
      // two joints, curling in toward the palm
      let px = x;
      let py = wy - 0.08;
      for (const [a, len] of [[0.2, lens[i]], [0.75, lens[i] * 0.8]]) {
        const dx = -side * Math.sin(a);
        const dy = -Math.cos(a);
        seg(0.0088, len, px + (dx * len) / 2, py + (dy * len) / 2, zs[i], [0, 0, -side * a]);
        px += dx * len;
        py += dy * len;
      }
    }
    let ty = wy - 0.03;
    let tz = -0.036;
    for (const [a, len, r] of [[0.75, 0.034, 0.0105], [0.35, 0.024, 0.0095]]) {
      const dy = -Math.cos(a);
      const dz = -Math.sin(a);
      seg(r, len, x - side * 0.004, ty + (dy * len) / 2, tz + (dz * len) / 2, [a, 0, 0]);
      ty += dy * len;
      tz += dz * len;
    }
  }

  private buildRobot(k: Kit, s: Spec, boss: boolean) {
    // Moulded shop-floor robots: every part is a shaped shell (a tube TV for a head, a wedge of a
    // chest, flared forearms and shins) over dark joints, with the uniform painted on.
    const P = this.pal;
    const sh = P.shell;
    const dk = P.dark;
    const shD = shade(sh, 0.84);
    const tie = 0xc0281e;
    const R = (y: number, w: number, f: number, b: number, extra: Partial<Ring> = {}): Ring => ({ y, w, f, b, n: 4, ...extra });

    // hips, with the apron's skirt
    k.curBone = B.pelvis;
    k.cyl(0.062, 0.062, 0.14, dk, [0, s.hip + 0.14, 0], 'y', 10, true);
    k.loft([R(0.8, 0, 0, 0), R(0.81, 0.07, 0.06, 0.065), R(0.87, 0.15, 0.1, 0.1), R(0.95, 0.165, 0.108, 0.105), R(1.0, 0.15, 0.1, 0.098), R(1.02, 0.09, 0.07, 0.07), R(1.025, 0, 0, 0)], (seg, d) => (seg >= 1 && seg <= 3 && d < 2 ? P.accent : sh), { sides: 16 });

    // chest: narrow waist widening to the shoulders, apron on the front, battery on the back
    k.curBone = B.chest;
    k.loft(
      [R(1.085, 0, 0, 0), R(1.095, 0.1, 0.08, 0.075), R(1.16, 0.118, 0.092, 0.084), R(1.27, 0.16, 0.115, 0.1), R(1.38, 0.2, 0.13, 0.112), R(1.45, 0.212, 0.124, 0.114), R(1.49, 0.19, 0.1, 0.1), R(1.515, 0.1, 0.06, 0.065), R(1.52, 0, 0, 0)],
      (seg, d) => {
        if (seg >= 2 && seg <= 4 && d < 2) return P.accent;
        if (seg === 1 && d < 2) return shD; // belly vent
        return sh;
      },
      { sides: 16 },
    );
    k.box(0.07, 0.035, 0.01, boss ? P.trim : PAL.shell, [0.085, 1.4, -0.131]); // name badge
    if (boss) k.loft([[1.5, 0, 0.1], [1.49, 0.02, 0.1], [1.462, 0.024, 0.118], [1.44, 0.014, 0.126], [1.33, 0.027, 0.126], [1.23, 0.033, 0.108], [1.17, 0, 0.094]].map(([y, w, z]) => ({ y, w, f: 0.009, b: 0.009, z: -z, n: 2.5 })), tie, { sides: 8 });
    k.loft([R(1.17, 0, 0, 0), R(1.18, 0.11, 0.02, 0.07), R(1.21, 0.125, 0.02, 0.1), R(1.41, 0.125, 0.02, 0.095), R(1.45, 0.1, 0.02, 0.06), R(1.46, 0, 0, 0)].map((r) => ({ ...r, z: 0.1, n: 3.4 })), (seg) => (seg === 3 ? P.accent : dk));
    k.cyl(0.055, 0.07, 0.04, dk, [0, 1.52, 0], 'y', 10, true); // collar
    k.cyl(0.036, 0.036, 0.1, dk, [0, 1.55, 0], 'y', 8, true);
    if (boss) for (const side of [-1, 1]) k.loft([R(1.5, 0, 0, 0), R(1.505, 0.075, 0.09, 0.09), R(1.53, 0.082, 0.096, 0.096), R(1.536, 0, 0, 0)].map((r) => ({ ...r, x: side * 0.25 })), P.trim, { sides: 12 });

    // head: a tube television, laid out back-to-front (`y` runs forward, `f` is down, `b` is up)
    k.curBone = B.head;
    const hy = 1.675;
    const H = (y: number, w: number, f: number, b: number): Ring => ({ y, w, f, b, n: 4.5 });
    k.loft(
      [H(-0.185, 0, 0, 0), H(-0.178, 0.07, 0.06, 0.055), H(-0.13, 0.11, 0.09, 0.09), H(-0.03, 0.15, 0.118, 0.125), H(0.06, 0.166, 0.132, 0.14), H(0.108, 0.17, 0.136, 0.144), H(0.118, 0.162, 0.128, 0.136), H(0.1185, 0.146, 0.112, 0.118), H(0.122, 0.1, 0.075, 0.08), H(0.123, 0, 0, 0)],
      (seg) => (seg >= 7 ? PAL.screen : seg >= 5 || seg <= 1 ? shD : sh),
      { sides: 20, pos: [0, hy, 0], rot: [-Math.PI / 2, 0, 0] },
    );
    k.cyl(0.046, 0.046, 0.03, dk, [-0.162, hy, 0.0], 'x', 10, true); // speaker ears
    k.cyl(0.046, 0.046, 0.03, dk, [0.162, hy, 0.0], 'x', 10, true);
    k.sphere(0.008, P.accent, [0.115, hy - 0.113, -0.119], 1, [1, 1, 1], true); // power light
    if (boss) {
      // peaked manager's cap: band, crown, visor, badge
      k.loft([R(1.795, 0, 0, 0), R(1.797, 0.15, 0.125, 0.15), R(1.835, 0.155, 0.13, 0.155), R(1.84, 0.162, 0.138, 0.16), R(1.895, 0.186, 0.168, 0.17), R(1.912, 0.168, 0.15, 0.152), R(1.916, 0, 0, 0)].map((r) => ({ ...r, z: 0.01, n: 3 })), (seg) => (seg === 1 ? P.trim : dk), { sides: 16 });
      k.sphere(0.125, dk, [0, 1.8, -0.14], 2, [1, 0.1, 0.75], true);
      k.sphere(0.024, P.trim, [0, 1.868, -0.142], 1, [1, 1, 0.4], true);
    } else {
      k.cyl(0.006, 0.006, 0.13, dk, [0.1, 1.85, 0.05], 'y', 4);
      k.sphere(0.022, P.accent, [0.1, 1.92, 0.05], 1, [1, 1, 1], true);
    }

    // arms: shoulder cap, piston, then a forearm that flares toward the wrist
    for (const side of [-1, 1]) {
      const x = side * s.shoulderX;
      const up = side < 0 ? B.armL : B.armR;
      const fo = side < 0 ? B.foreL : B.foreR;
      const sy = s.shoulderY;
      const ey = sy - s.upperArm;
      const A = (y: number, w: number, f: number, b: number, n = 3.2): Ring => ({ y, w, f, b, x, n });
      k.curBone = up;
      k.loft([A(sy + 0.085, 0, 0, 0), A(sy + 0.078, 0.04, 0.045, 0.045), A(sy + 0.045, 0.074, 0.08, 0.078), A(sy - 0.01, 0.08, 0.086, 0.084), A(sy - 0.05, 0.07, 0.076, 0.074), A(sy - 0.06, 0, 0, 0)], (seg) => (seg === 3 ? P.accent : sh), { sides: 12 });
      k.cyl(0.032, 0.032, s.upperArm - 0.04, dk, [x, (sy - 0.05 + ey) / 2, 0], 'y', 8, true);
      k.curBone = fo;
      k.sphere(0.046, dk, [x, ey, 0], 2, [1, 1, 1], true); // elbow
      if (side > 0) {
        // right forearm is the built-in blaster (a "price gun"): casing, barrel, muzzle ring
        k.loft(
          [A(ey - 0.02, 0, 0, 0), A(ey - 0.03, 0.045, 0.045, 0.045), A(ey - 0.06, 0.07, 0.075, 0.07), A(ey - 0.2, 0.074, 0.08, 0.074), A(ey - 0.235, 0.06, 0.062, 0.06), A(ey - 0.25, 0.042, 0.042, 0.042, 2), A(ey - 0.33, 0.036, 0.036, 0.036, 2), A(ey - 0.335, 0.05, 0.05, 0.05, 2), A(ey - 0.36, 0.05, 0.05, 0.05, 2), A(ey - 0.365, 0, 0, 0, 2)],
          (seg) => (seg === 1 || seg === 6 || seg === 7 ? P.accent : seg >= 4 ? dk : sh),
          { sides: 12 },
        );
      } else {
        k.loft([A(ey - 0.02, 0, 0, 0), A(ey - 0.03, 0.04, 0.04, 0.04), A(ey - 0.07, 0.05, 0.052, 0.05), A(ey - 0.2, 0.062, 0.066, 0.062), A(ey - 0.245, 0.058, 0.062, 0.058), A(ey - 0.25, 0, 0, 0)], (seg) => (seg === 3 ? P.accent : sh), { sides: 12 });
        k.loft([A(ey - 0.24, 0, 0, 0, 2.2), A(ey - 0.245, 0.024, 0.03, 0.03, 2.2), A(ey - 0.28, 0.028, 0.046, 0.042, 2.2), A(ey - 0.325, 0.026, 0.044, 0.04, 2.2), A(ey - 0.36, 0.018, 0.03, 0.026, 2.2), A(ey - 0.372, 0, 0, 0, 2.2)], dk, { sides: 10 });
        k.sphere(0.016, dk, [x, ey - 0.295, -0.048], 2, [0.9, 1.7, 0.9], true); // thumb
      }
    }

    // legs: thigh shell, knee, a shin that flares to the ankle, a shoe with a shell toe
    for (const side of [-1, 1]) {
      const x = side * s.hipX;
      const th = side < 0 ? B.thighL : B.thighR;
      const sn = side < 0 ? B.shinL : B.shinR;
      const ky = s.hip - s.thigh;
      const L = (y: number, w: number, f: number, b: number): Ring => ({ y, w, f, b, x, n: 3.4 });
      k.curBone = th;
      k.cyl(0.036, 0.036, s.thigh, dk, [x, (s.hip + ky) / 2, 0], 'y', 8, true);
      k.loft([L(0.86, 0, 0, 0), L(0.85, 0.05, 0.055, 0.055), L(0.8, 0.07, 0.076, 0.07), L(0.66, 0.064, 0.07, 0.062), L(0.56, 0.05, 0.054, 0.05), L(0.55, 0, 0, 0)], sh, { sides: 12 });
      k.curBone = sn;
      k.sphere(0.052, dk, [x, ky, 0], 2, [1, 1, 1], true); // knee
      k.sphere(0.04, P.accent, [x, ky, -0.04], 2, [1, 1.1, 0.5], true);
      k.loft([L(0.42, 0, 0, 0), L(0.41, 0.04, 0.045, 0.04), L(0.36, 0.052, 0.06, 0.056), L(0.2, 0.062, 0.066, 0.07), L(0.1, 0.072, 0.074, 0.08), L(0.085, 0.066, 0.068, 0.074), L(0.08, 0, 0, 0)], (seg) => (seg === 4 ? P.accent : sh), { sides: 12 });
      k.cyl(0.035, 0.035, 0.06, dk, [x, 0.07, 0], 'y', 8, true);
      this.foot(k, x, 1.2, 0.72, 1.08, dk, dk, sh);
    }
    this.finishRobot(s, 0.3, hy + 0.003, -0.127, 0.25, 0.185);
    this.muzzle.position.set(0, -0.375, 0);
    this.bones[B.foreR].add(this.muzzle);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), flat(PAL.smile));
    tip.position.set(0, -0.368, 0);
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
    // Sculpted from cross-sections like a PS2-era character mesh: a jaw, a brow, a nose, a
    // ribcage, calves. Regions (hair, beard, belt, vest bands) are painted onto the faces.
    // variant 99 is the player character: Agent "Clearance", tuxedo under a hi-vis vest
    const agent = variant === 99;
    const v = variant % 3;
    const skin = agent ? PAL.skin1 : variant % 2 === 0 ? PAL.skin1 : PAL.skin2;
    const shirt = agent ? PAL.tux : [PAL.denim, 0x7a3b3b, 0x4f6b4a][v];
    const cuff = agent ? PAL.shirt : shade(shirt, 1.22);
    const pants = agent ? PAL.tux : [0x2c3140, 0x3a3328, 0x2e3a4a][v];
    const hat = [0xf0c020, 0xe8e2d0, PAL.hivis][v];
    const hair = agent ? 0x2a1d14 : [0x2a1d14, 0x6b4a2a, 0x1c1c22][v];
    const leather = 0x3a2a20;
    const glove = agent ? skin : 0x6a4a36;
    const band = 0xe8e8d8;
    const ink = 0x15161c;
    const R = (y: number, w: number, f: number, b: number, extra: Partial<Ring> = {}): Ring => ({ y, w, f, b, ...extra });

    // torso: waist, ribcage, chest, shoulders sloping up into the neck
    k.curBone = B.chest;
    const torso: Ring[] = [
      R(1.06, 0, 0, 0), R(1.07, 0.13, 0.092, 0.088), R(1.15, 0.136, 0.098, 0.092), R(1.24, 0.15, 0.11, 0.099), R(1.275, 0.156, 0.115, 0.102),
      R(1.35, 0.168, 0.126, 0.108), R(1.41, 0.186, 0.118, 0.112), R(1.45, 0.2, 0.1, 0.104), R(1.48, 0.17, 0.078, 0.09), R(1.51, 0.1, 0.064, 0.074), R(1.53, 0.056, 0.05, 0.056), R(1.54, 0, 0, 0),
    ];
    k.loft(torso, (seg, d) => (agent && d < 1 && seg >= 2 && seg <= 8 ? PAL.shirt : shirt), { sides: 16 });
    // hi-vis vest worn open: the same body, a little bigger, with the front left out
    // (the workers' vest is a closed shell with the shirt painted down the middle: an edge that
    // close to the centre line would show past the chest in profile)
    const vest = (seg: number, d: number) => (!agent && d < 1 ? shirt : seg === 1 || (seg > 1 && d > 3 && d < 4) ? band : PAL.hivis);
    k.loft(torso.slice(2, 10), vest, { sides: 16, grow: 0.012, from: agent ? 2 : 0, to: agent ? 14 : 16 });
    if (agent) {
      k.sphere(0.03, ink, [-0.03, 1.495, -0.094], 2, [1.2, 0.8, 0.5], true); // bow tie
      k.sphere(0.03, ink, [0.03, 1.495, -0.094], 2, [1.2, 0.8, 0.5], true);
    } else {
      // pack and bedroll
      k.loft([R(1.16, 0, 0, 0), R(1.17, 0.1, 0.02, 0.07), R(1.2, 0.115, 0.02, 0.095), R(1.4, 0.115, 0.02, 0.09), R(1.44, 0.09, 0.02, 0.06), R(1.45, 0, 0, 0)].map((r) => ({ ...r, z: 0.1, n: 3.4 })), 0x4a4f3a);
      k.cyl(0.05, 0.05, 0.27, 0x7a6a44, [0, 1.47, 0.16], 'x', 12, true);
    }
    // shirt details: collar points, button placket, buttons, shoulder seams
    if (!agent) {
      const sd = shade(shirt, 0.7);
      const fz = (y: number) => {
        // front surface of the vest's centre strip at height y
        for (let i = 1; i < torso.length; i++) if (torso[i].y >= y) {
          const a = torso[i - 1], b = torso[i];
          const t = (y - a.y) / (b.y - a.y || 1);
          return -(a.f + (b.f - a.f) * t) - 0.012;
        }
        return -0.1;
      };
      for (const side of [-1, 1]) k.profile([[0, 0.03], [0.004, -0.015], [0.03, 0.022]].map(([z, y]): [number, number] => [z, y]), 0.006, shade(shirt, 1.12), [side * 0.034, 1.468, fz(1.468) - 0.006], 0, [0.35, side * 0.5, 0]);
      k.loft(torso.slice(2, 9), sd, { sides: 64, grow: 0.0135, from: -1, to: 1 }); // placket, on the shirt's own surface
      for (const y of [1.15, 1.23, 1.31, 1.39]) k.sphere(0.0065, 0xd8d2c0, [0, y, fz(y) - 0.006], 1, [1, 1, 0.5], true);
      for (const side of [-1, 1]) k.box(0.006, 0.006, 0.17, sd, [side * 0.17, 1.462, 0.0], [0, 0, side * -0.55]); // shoulder seam
    } else {
      for (const y of [1.29, 1.35, 1.41]) k.sphere(0.006, ink, [0, y, -(y < 1.35 ? 0.128 : 0.12)], 1, [1, 1, 0.5], true); // shirt studs
    }
    // neck, and the Local 404 red bandana round it
    k.loft([R(1.46, 0.056, 0.05, 0.056), R(1.56, 0.05, 0.046, 0.054)], skin, { sides: 12 });
    if (!agent) k.loft([R(1.485, 0.06, 0.056, 0.06), R(1.5, 0.074, 0.074, 0.07), R(1.53, 0.07, 0.066, 0.068), R(1.552, 0.054, 0.048, 0.056)], 0xb5382e, { sides: 12 });

    // head: chin, jaw, lips, nose, eye sockets, brow, skull
    k.curBone = B.head;
    const y0 = 1.535;
    const head: Ring[] = [
      R(-0.03, 0.045, 0.035, 0.05), R(0, 0.052, 0.086, 0.062, { nose: 0.004 }), R(0.028, 0.068, 0.094, 0.078), R(0.052, 0.075, 0.096, 0.088, { nose: 0.005 }),
      R(0.074, 0.079, 0.094, 0.094, { nose: 0.024, nw: 0.026 }), R(0.094, 0.081, 0.092, 0.098, { nose: 0.017, nw: 0.02 }), R(0.116, 0.081, 0.089, 0.101, { nose: 0.008, nw: 0.018, sock: 0.007 }),
      R(0.138, 0.082, 0.098, 0.103, { nose: 0.003 }), R(0.168, 0.081, 0.096, 0.104), R(0.204, 0.073, 0.083, 0.097), R(0.235, 0.05, 0.056, 0.07), R(0.252, 0, 0, 0),
    ].map((r) => ({ ...r, y: r.y + y0, n: 2.4 }));
    const bearded = v === 1 && !agent;
    k.loft(head, (seg, d) => {
      if (seg >= 8 && !(seg === 8 && d < 3)) return hair; // top of the head
      if (seg >= 6 && d > 5) return hair; // sides and back
      if (seg >= 3 && d > 6) return hair; // nape
      if (bearded && seg <= 3 && seg >= 1 && d < 6) return hair;
      return skin;
    }, { sides: 16 });
    for (const side of [-1, 1]) {
      // ears: a thin plate in the outline of an ear, joined to the head along its front edge and
      // standing off it at the back, with the hollow drawn on in a darker tone
      const ear: [number, number][] = [[0, 0.032], [0.009, 0.037], [0.023, 0.034], [0.032, 0.022], [0.034, 0.005], [0.03, -0.011], [0.02, -0.024], [0.011, -0.033], [0.003, -0.035], [0, -0.028]];
      const tilt = 0.62;
      const ex = side * 0.08;
      k.profile(ear, 0.008, skin, [ex, y0 + 0.1, 0.016], 0, [0, side * tilt, 0]);
      const hollow = ear.map(([z, y]): [number, number] => [0.007 + z * 0.6, y * 0.6 + 0.002]);
      k.profile(hollow, 0.002, shade(skin, 0.72), [ex + side * 0.0042 * Math.cos(tilt), y0 + 0.1, 0.016 - 0.0042 * Math.sin(tilt)], 0, [0, side * tilt, 0]);
    }
    if (!agent && v === 2) {
      // beanie with a turned-up cuff
      k.loft([R(0.138, 0.084, 0.1, 0.106), R(0.143, 0.098, 0.115, 0.121), R(0.183, 0.1, 0.117, 0.123), R(0.19, 0.094, 0.109, 0.116), R(0.24, 0.086, 0.098, 0.106), R(0.275, 0.064, 0.07, 0.08), R(0.297, 0.03, 0.033, 0.036), R(0.303, 0, 0, 0)].map((r) => ({ ...r, y: r.y + y0, n: 2.4 })), (seg) => (seg <= 2 ? shade(hat, 0.8) : hat), { sides: 16 });
    } else if (!agent) {
      // hard hat: brim, then the dome
      k.loft([R(0.15, 0.086, 0.1, 0.106), R(0.152, 0.116, 0.152, 0.122), R(0.162, 0.116, 0.15, 0.122), R(0.166, 0.093, 0.108, 0.113), R(0.215, 0.088, 0.1, 0.106), R(0.255, 0.068, 0.076, 0.084), R(0.278, 0.032, 0.036, 0.04), R(0.285, 0, 0, 0)].map((r) => ({ ...r, y: r.y + y0, n: 2.3 })), hat, { sides: 16 });
    }
    // the drawn part of the face (eyes, brows, mouth) is a decal skinned over the same sections
    const decal = new THREE.Mesh(loftGeometry(head.slice(2, 9), { sides: 16, grow: 0.0025, from: -3, to: 3 }), flat(0xffffff, { map: humanFace(agent ? 'agent' : bearded ? 'beard' : v === 0 ? 'moustache' : 'plain', hair), transparent: true }));
    decal.position.set(0, -s.neck, 0);
    this.bones[B.head].add(decal);

    // arms: deltoid, bicep, forearm tapering to the wrist, a mitt of a hand
    for (const side of [-1, 1]) {
      const x = side * (s.shoulderX + 0.008);
      const up = side < 0 ? B.armL : B.armR;
      const fo = side < 0 ? B.foreL : B.foreR;
      const sy = s.shoulderY;
      const ey = sy - s.upperArm;
      const A = (y: number, w: number, f: number, b: number): Ring => ({ y, w: w * 1.12, f: f * 1.12, b: b * 1.12, x, n: 2.2 });
      k.curBone = up;
      k.loft([A(sy + 0.058, 0, 0, 0), A(sy + 0.05, 0.03, 0.04, 0.04), A(sy + 0.02, 0.052, 0.062, 0.06), A(sy - 0.04, 0.054, 0.06, 0.056), A(sy - 0.14, 0.048, 0.055, 0.048), A(ey + 0.03, 0.044, 0.046, 0.046), A(ey - 0.015, 0.045, 0.046, 0.047), A(ey - 0.025, 0, 0, 0)], (seg) => (seg === 5 ? cuff : shirt), { sides: 10 });
      if (!agent) {
        k.loft([A(ey + 0.04, 0, 0, 0), A(ey + 0.038, 0.05, 0.051, 0.051), A(ey + 0.01, 0.052, 0.053, 0.053), A(ey - 0.004, 0.051, 0.052, 0.052), A(ey - 0.01, 0.047, 0.048, 0.048), A(ey - 0.012, 0, 0, 0)], (seg) => (seg === 2 ? shade(cuff, 0.85) : cuff), { sides: 10 });
      } else k.loft([A(ey - 0.19, 0, 0, 0), A(ey - 0.19, 0.032, 0.034, 0.034), A(ey - 0.215, 0.031, 0.033, 0.033), A(ey - 0.217, 0, 0, 0)].map((r) => ({ ...r, y: r.y })), PAL.shirt, { sides: 10 });
      k.curBone = fo;
      k.loft([A(ey + 0.03, 0, 0, 0), A(ey + 0.022, 0.04, 0.04, 0.04), A(ey - 0.03, 0.045, 0.047, 0.045), A(ey - 0.13, 0.041, 0.042, 0.04), A(ey - 0.23, 0.027, 0.029, 0.029), A(ey - 0.24, 0, 0, 0)], (seg) => (agent ? (seg === 3 ? PAL.shirt : shirt) : skin), { sides: 10 });
      this.hand(k, x, ey - 0.23, side, glove);
    }

    // belt: one band right round the waist
    k.curBone = B.pelvis;
    k.loft([R(1.026, 0, 0, 0), R(1.03, 0.156, 0.103, 0.102), R(1.09, 0.143, 0.101, 0.098), R(1.094, 0, 0, 0)].map((r) => ({ ...r, n: 4 })), leather, { sides: 16 });
    k.sphere(0.03, pants, [0, 0.868, 0.002], 2, [0.9, 1.15, 2.6], true); // gusset: the crotch is solid between the legs

    // buckle and belt loops
    const metal = 0x9a9488;
    if (!agent) k.box(0.05, 0.04, 0.012, metal, [0, 1.06, -0.106]);
    for (const a of [-2.2, -1.25, -0.55, 0.55, 1.25, 2.2, Math.PI]) {
      // on the belt's own (squarish) outline, standing just proud of it
      const sn = Math.sin(a);
      const cs = Math.cos(a);
      const px = Math.sign(sn) * Math.sqrt(Math.abs(sn)) * 0.162;
      const pz = -Math.sign(cs) * Math.sqrt(Math.abs(cs)) * 0.107;
      k.box(0.016, 0.072, 0.01, pants, [px, 1.06, pz], [0, -a, 0]);
    }
    // pocket seams: slanted openings at the front, patch pockets on the seat
    const seamC = shade(pants, 0.6);
    for (const sd of [-1, 1]) {
      k.box(0.008, 0.085, 0.022, seamC, [sd * 0.122, 0.985, -0.078], [0.12, sd * 0.75, sd * 0.42]);
      k.box(0.066, 0.08, 0.02, shade(pants, 1.1), [sd * 0.074, 0.955, 0.104], [-0.1, sd * 0.3, 0]);
      k.box(0.068, 0.008, 0.024, seamC, [sd * 0.074, 0.994, 0.106], [-0.1, sd * 0.3, 0]);
    }

    // legs: thigh, knee, calf, boot
    for (const side of [-1, 1]) {
      const x = side * s.hipX;
      const th = side < 0 ? B.thighL : B.thighR;
      const sn = side < 0 ? B.shinL : B.shinR;
      const L = (y: number, w: number, f: number, b: number, extra: Partial<Ring> = {}): Ring => ({ y, w, f, b, x, n: 2.3, ...extra });
      // Trousers: each leg is one piece from the belt to the knee. Up at the hips it is half the
      // body, flat against its twin along the centre seam; below the crotch it rounds into a thigh.
      const T = (y: number, c: number, wo: number, wm: number, f: number, b: number, nm: number): Ring => ({ y, x: side * c, w: wo, wm, f, b, n: 2.5, nm, nmf: y >= 0.885 ? 40 : y >= 0.855 ? 14 : nm });
      const trousers = [
        T(1.1, 0.068, 0, 0, 0, 0, 8), T(1.09, 0.068, 0.069, 0.068, 0.095, 0.092, 8), T(1.03, 0.075, 0.075, 0.075, 0.097, 0.096, 8), T(0.98, 0.082, 0.084, 0.082, 0.096, 0.102, 7),
        T(0.93, 0.086, 0.086, 0.086, 0.095, 0.11, 6), T(0.89, 0.088, 0.084, 0.088, 0.092, 0.108, 5), T(0.86, 0.09, 0.081, 0.09, 0.089, 0.098, 4.5), T(0.84, 0.09, 0.079, 0.087, 0.087, 0.092, 3.5),
        T(0.8, 0.09, 0.078, 0.078, 0.085, 0.088, 2.5), T(0.76, 0.09, 0.076, 0.076, 0.082, 0.082, 2.5), T(0.6, 0.09, 0.064, 0.064, 0.068, 0.066, 2.5), T(0.5, 0.09, 0.056, 0.056, 0.058, 0.058, 2.5), T(0.44, 0.09, 0.05, 0.05, 0.05, 0.052, 2.5), T(0.43, 0.09, 0, 0, 0, 0, 2.5),
      ];
      const split = 6; // the hips (down to the fold under the seat) stay with the pelvis; the rest swings with the thigh
      k.curBone = B.pelvis;
      k.loft(trousers, pants, { sides: 16, segs: [0, split] });
      k.sphere(0.07, pants, [side * 0.096, 0.89, 0.004], 2, [1, 0.4, 1.2], true); // closes the hips underneath
      k.curBone = th;
      k.loft(trousers, pants, { sides: 16, segs: [split, trousers.length - 1] });
      k.sphere(0.074, pants, [x, 0.89, 0], 2, [1, 1, 1], true); // fills the joint when the leg swings
      k.curBone = sn;
      k.loft([L(0.5, 0, 0, 0), L(0.49, 0.05, 0.05, 0.05), L(0.46, 0.054, 0.058, 0.054, { nose: 0.008, nw: 0.04 }), L(0.36, 0.052, 0.05, 0.064), L(0.2, 0.04, 0.04, 0.044), L(0.1, 0.036, 0.036, 0.04), L(0.09, 0, 0, 0)], (seg, d) => (!agent && seg >= 1 && seg <= 2 && d < 3 ? ink : pants), { sides: 16 });
      const boot = agent ? ink : leather;
      if (!agent) k.loft([L(0.225, 0, 0, 0), L(0.22, 0.046, 0.046, 0.05), L(0.2, 0.05, 0.05, 0.054), L(0.1, 0.05, 0.052, 0.056), L(0.09, 0, 0, 0)], boot, { sides: 10 });
      if (agent) this.foot(k, x, 0.86, 0.8, 0.95, ink, boot);
      else this.foot(k, x, 1, 1, 1, ink, boot);
    }
    if (agent) {
      this.muzzle.position.set(0, -0.3, -0.5);
      this.bones[B.foreR].add(this.muzzle);
      return;
    }
    // the rifle: carried on the chest and held with both hands (CharAnim solves the arms to it).
    // Its origin is the right hand on the pistol grip; forward is -Z.
    const r = new Kit();
    const steel = 0x2a2c30;
    const wood = [0x6b4a2a, 0x5a3e24, 0x7a5432][v];
    r.box(0.05, 0.075, 0.26, steel, [0, 0.045, -0.08]); // receiver
    r.box(0.046, 0.02, 0.2, 0x3a3d42, [0, 0.092, -0.07]); // top rail
    r.cyl(0.013, 0.013, 0.3, steel, [0, 0.055, -0.36], 'z', 8); // barrel
    r.cyl(0.02, 0.02, 0.04, steel, [0, 0.055, -0.52], 'z', 8); // muzzle brake
    r.box(0.05, 0.05, 0.2, wood, [0, 0.035, -0.29]); // handguard
    r.box(0.03, 0.09, 0.04, steel, [0, -0.03, 0.0], [0.3, 0, 0]); // pistol grip
    r.box(0.032, 0.1, 0.05, steel, [0, -0.03, -0.1], [-0.15, 0, 0]); // magazine
    r.taper(0.04, 0.07, 0.2, 1, 1.3, wood, [0, 0.03, 0.13]); // stock
    r.box(0.045, 0.09, 0.02, 0x1c1d20, [0, 0.025, 0.235]); // butt pad
    r.box(0.012, 0.03, 0.02, steel, [0, 0.112, -0.15]); // rear sight
    r.box(0.008, 0.03, 0.012, steel, [0, 0.085, -0.48]); // front sight
    const rifle = new THREE.Mesh(r.geometry(), G.mat.char);
    rifle.castShadow = true;
    this.bones[B.chest].add(rifle);
    this.held = rifle;
    this.muzzle.position.set(0, 0.055, -0.56);
    rifle.add(this.muzzle);
  }

  private buildMech(k: Kit, s: Spec) {
    // The Regional Manager: the shop-floor robots' shapes at forklift scale. Barrel chest with a
    // hazard belt, the monitor sunk between the shoulders, a cannon and a stamp.
    const P = this.pal;
    const sh = P.shell;
    const dk = P.dark;
    const R = (y: number, w: number, f: number, b: number, extra: Partial<Ring> = {}): Ring => ({ y, w, f, b, n: 4, ...extra });
    k.curBone = B.pelvis;
    k.cyl(0.3, 0.3, 0.32, dk, [0, s.hip + 0.25, 0], 'y', 12, true);
    k.loft([R(1.2, 0, 0, 0), R(1.22, 0.3, 0.25, 0.25), R(1.32, 0.52, 0.36, 0.36), R(1.5, 0.56, 0.38, 0.38), R(1.6, 0.5, 0.34, 0.34), R(1.64, 0.3, 0.22, 0.22), R(1.65, 0, 0, 0)], (seg, d) => (seg >= 1 && seg <= 2 && d < 2 ? sh : dk), { sides: 16 });
    k.curBone = B.chest;
    k.loft(
      [R(1.72, 0, 0, 0), R(1.74, 0.42, 0.36, 0.34), R(1.86, 0.56, 0.46, 0.42), R(2.0, 0.66, 0.53, 0.47), R(2.4, 0.75, 0.62, 0.54), R(2.62, 0.75, 0.58, 0.54), R(2.72, 0.66, 0.48, 0.48), R(2.78, 0.4, 0.3, 0.32), R(2.79, 0, 0, 0)],
      (seg, d, side) => {
        if (seg >= 6) return PAL.screen; // top deck
        if (seg === 2) return side % 2 ? PAL.screen : sh; // hazard belt
        if ((seg === 3 || seg === 4) && d < 3) return shade(sh, 0.85); // armour slab
        return sh;
      },
      { sides: 20 },
    );
    // cooling unit on the back: the weak point
    k.loft([R(1.86, 0, 0, 0), R(1.88, 0.4, 0.05, 0.2), R(1.95, 0.46, 0.05, 0.3), R(2.55, 0.46, 0.05, 0.28), R(2.62, 0.38, 0.05, 0.18), R(2.64, 0, 0, 0)].map((r) => ({ ...r, z: 0.5, n: 3.4 })), dk);
    for (let i = 0; i < 4; i++) k.cyl(0.025, 0.025, 0.66, 0x55585f, [0, 2.01 + i * 0.16, 0.83], 'x', 6, true);
    for (const [x, h] of [[-0.5, 0.5], [0.5, 0.36]]) {
      k.cyl(0.07, 0.07, h, dk, [x, 2.65 + h / 2, 0.4], 'y', 8, true); // exhaust stacks
      k.cyl(0.09, 0.09, 0.06, P.accent, [x, 2.65 + h, 0.4], 'y', 8, true);
    }
    // cockpit monitor (back-to-front, like the small robots' heads)
    k.curBone = B.head;
    const H = (y: number, w: number, f: number, b: number): Ring => ({ y, w, f, b, n: 4.5 });
    k.loft(
      [H(-0.34, 0, 0, 0), H(-0.32, 0.2, 0.16, 0.14), H(-0.2, 0.32, 0.24, 0.24), H(0, 0.42, 0.3, 0.31), H(0.2, 0.455, 0.32, 0.34), H(0.26, 0.46, 0.325, 0.345), H(0.285, 0.44, 0.305, 0.325), H(0.287, 0.4, 0.265, 0.28), H(0.297, 0.28, 0.18, 0.19), H(0.3, 0, 0, 0)],
      (seg) => (seg >= 7 ? PAL.screen : seg >= 5 || seg <= 1 ? shade(sh, 0.84) : sh),
      { sides: 20, pos: [0, 3.02, -0.1], rot: [-Math.PI / 2, 0, 0] },
    );
    for (const side of [-1, 1]) {
      const x = side * s.shoulderX;
      const up = side < 0 ? B.armL : B.armR;
      const fo = side < 0 ? B.foreL : B.foreR;
      const sy = s.shoulderY;
      const ey = sy - s.upperArm;
      const A = (y: number, w: number, f: number, b: number, n = 3.5): Ring => ({ y, w, f, b, x, n });
      k.curBone = up;
      k.loft([A(sy + 0.36, 0, 0, 0), A(sy + 0.34, 0.15, 0.2, 0.2), A(sy + 0.22, 0.26, 0.34, 0.32), A(sy, 0.28, 0.36, 0.34), A(sy - 0.2, 0.24, 0.3, 0.28), A(sy - 0.24, 0, 0, 0)], (seg) => (seg === 3 ? P.accent : seg === 0 ? PAL.screen : sh), { sides: 14 });
      k.cyl(0.12, 0.12, s.upperArm - 0.2, dk, [x, (sy - 0.2 + ey) / 2, 0], 'y', 10, true);
      k.curBone = fo;
      k.sphere(0.17, dk, [x, ey, 0], 2, [1, 1, 1], true);
      if (side > 0) {
        // cannon arm
        k.loft(
          [A(ey - 0.02, 0, 0, 0), A(ey - 0.05, 0.16, 0.16, 0.16), A(ey - 0.14, 0.23, 0.25, 0.23), A(ey - 0.5, 0.24, 0.26, 0.24), A(ey - 0.58, 0.19, 0.2, 0.19), A(ey - 0.6, 0.16, 0.16, 0.16, 2), A(ey - 0.96, 0.14, 0.14, 0.14, 2), A(ey - 0.97, 0.2, 0.2, 0.2, 2), A(ey - 1.04, 0.2, 0.2, 0.2, 2), A(ey - 1.05, 0, 0, 0, 2)],
          (seg) => (seg === 1 || seg === 6 || seg === 7 ? P.accent : seg >= 4 ? dk : sh),
          { sides: 14 },
        );
      } else {
        // rubber-stamp fist
        k.loft(
          [A(ey - 0.02, 0, 0, 0), A(ey - 0.05, 0.14, 0.14, 0.14), A(ey - 0.14, 0.19, 0.2, 0.19), A(ey - 0.48, 0.2, 0.21, 0.2), A(ey - 0.52, 0.14, 0.14, 0.14), A(ey - 0.53, 0.14, 0.14, 0.14, 4), A(ey - 0.56, 0.26, 0.26, 0.26, 4), A(ey - 0.82, 0.27, 0.27, 0.27, 4), A(ey - 0.83, 0.285, 0.285, 0.285, 4), A(ey - 0.89, 0.285, 0.285, 0.285, 4), A(ey - 0.9, 0, 0, 0, 4)],
          (seg) => (seg >= 7 ? 0xc0281e : seg >= 4 ? dk : seg === 1 ? P.accent : sh),
          { sides: 14 },
        );
      }
    }
    for (const side of [-1, 1]) {
      const x = side * s.hipX;
      const th = side < 0 ? B.thighL : B.thighR;
      const sn = side < 0 ? B.shinL : B.shinR;
      const ky = s.hip - s.thigh;
      const L = (y: number, w: number, f: number, b: number): Ring => ({ y, w, f, b, x, n: 3.5 });
      k.curBone = th;
      k.cyl(0.13, 0.13, s.thigh, dk, [x, (s.hip + ky) / 2, 0], 'y', 10, true);
      k.loft([L(1.4, 0, 0, 0), L(1.38, 0.14, 0.16, 0.16), L(1.28, 0.2, 0.23, 0.21), L(0.98, 0.19, 0.21, 0.19), L(0.84, 0.15, 0.16, 0.15), L(0.82, 0, 0, 0)], sh, { sides: 14 });
      k.curBone = sn;
      k.sphere(0.17, dk, [x, ky, 0], 2, [1, 1, 1], true);
      k.sphere(0.13, P.accent, [x, ky, -0.13], 2, [1, 1.1, 0.5], true);
      k.loft([L(0.68, 0, 0, 0), L(0.66, 0.13, 0.14, 0.13), L(0.56, 0.17, 0.2, 0.18), L(0.3, 0.2, 0.22, 0.23), L(0.16, 0.24, 0.25, 0.27), L(0.14, 0, 0, 0)], (seg) => (seg === 3 ? P.accent : sh), { sides: 14 });
      this.foot(k, x, 4.6, 1.85, 2.7, dk, dk, PAL.smile);
    }
    this.finishRobot(s, 0.8, 3.0275, -0.408, 0.7, 0.46);
    this.muzzle.position.set(0, -1.08, 0);
    this.bones[B.foreR].add(this.muzzle);
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.04), flat(0xff7b1c));
    vent.position.set(0, 2.25 - s.spine, 0.795);
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
const _S = new THREE.Vector3();
const _T = new THREE.Vector3();
const _D = new THREE.Vector3();
const _P = new THREE.Vector3();
const _E = new THREE.Vector3();
const _U = new THREE.Vector3();
const _DOWN = new THREE.Vector3(0, -1, 0);
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
/**
 * Two-bone arm IK in the chest's frame: point the upper arm and forearm (both hanging along -Y at
 * rest) so the hand reaches `target`, with the elbow bending toward `pole`.
 */
function reach(upper: THREE.Bone, fore: THREE.Bone, l1: number, l2: number, target: THREE.Vector3, pole: THREE.Vector3) {
  _S.copy(upper.position);
  _D.subVectors(target, _S);
  const d = clamp(_D.length(), 0.08, l1 + l2 - 0.002);
  _D.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _P.copy(pole).addScaledVector(_D, -pole.dot(_D)).normalize();
  _E.copy(_S).addScaledVector(_D, a).addScaledVector(_P, h);
  _U.subVectors(_E, _S).normalize();
  _q.setFromUnitVectors(_DOWN, _U);
  upper.quaternion.copy(_q);
  _T.copy(_S).addScaledVector(_D, d).sub(_E).normalize();
  _qi.copy(_q).invert();
  _T.applyQuaternion(_qi);
  fore.quaternion.setFromUnitVectors(_DOWN, _T);
}
const _grip = new THREE.Vector3();
const _fore = new THREE.Vector3();
const _poleR = new THREE.Vector3(0.6, -1, 0.4);
const _poleL = new THREE.Vector3(-0.9, -1, 0.1);

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
    const swing = lerp(0.45, 0.62, run) * moving;
    const back = this.moveZ < -0.3 ? -1 : 1;

    // ---- legs ----
    const legLen = s.hip;
    const drop = this.cCrouch * 0.36 + this.sit * 0.42;
    const bend = Math.acos(clamp((legLen - drop * (legLen / 0.9)) / legLen, 0.3, 1));
    const bob = Math.abs(Math.sin(ph)) * 0.05 * moving * (legLen / 0.9);
    for (const side of [-1, 1]) {
      const p = ph + (side > 0 ? Math.PI : 0);
      const fwd = Math.sin(p) * swing * back;
      // the knee folds as the foot comes through, hardest at a run
      const lift = Math.max(0, Math.cos(p)) * lerp(0.5, 1.5, run) * moving;
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
    pel.rotation.set(lerp(-run * 0.14 * back, -1.35 * this.deadSide, de), 0, lerp(Math.sin(ph) * 0.04 * moving, 0.25, de));

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
    } else if (this.m.held) {
      // rifle: carried at low ready, shouldered when aiming; both hands solved onto it
      const g = this.m.held;
      const sy = s.shoulderY - s.spine;
      const bounce = Math.sin(ph * 2) * 0.012 * moving * (1 - a);
      g.position.set(lerp(0.06, 0.085, a), lerp(sy - 0.17, sy - 0.03, a) + bounce, lerp(-0.2, -0.27, a) + this.kick * 0.035);
      g.rotation.set(lerp(-0.55, pitch, a) + this.kick * 0.12, lerp(0.5, 0.06, a), lerp(0.25, 0, a), 'YXZ');
      g.updateMatrix();
      _grip.set(0, 0, 0).applyMatrix4(g.matrix);
      _fore.set(0, -0.005, -0.29).applyMatrix4(g.matrix);
      const l1 = s.upperArm;
      const l2 = 0.27;
      reach(aR, fR, l1, l2, _grip, _poleR);
      reach(aL, fL, l1, l2, _fore, _poleL);
      g.visible = de < 0.4;
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
