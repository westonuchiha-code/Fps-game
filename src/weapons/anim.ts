import * as THREE from 'three';
import { clamp, Ease, type EaseName, DEG, smoothstep } from '../core/math';

/**
 * Lightweight keyframe animation for first-person weapons.
 *
 *  - A clip animates named nodes (gun parts) as OFFSETS from their rest pose, so a clip only
 *    describes what moves.
 *  - Hands are not keyframed directly: each hand is anchored to a named socket on the gun
 *    (grip, foregrip, magazine, bolt, pump...) and a clip just says when a hand moves to another
 *    socket. Because sockets ride on animated parts, the hand follows the magazine out of the
 *    gun, racks the bolt, and so on, with very little data.
 *  - Starting a clip snapshots the current pose and blends from it, so any animation can be
 *    interrupted at any moment without popping.
 */

type V3 = [number, number, number];

export interface Key {
  t: number;
  /** position offset (metres) */
  p?: V3;
  /** rotation offset (degrees, XYZ) */
  r?: V3;
  /** easing INTO this key */
  e?: EaseName;
}

export type HandPose = 'grip' | 'fore' | 'open' | 'pinch' | 'fist' | 'point' | 'relax';

export interface HandKey {
  t: number;
  /** socket name to move to */
  to: string;
  /** seconds to travel there (default 0.14) */
  blend?: number;
  pose?: HandPose;
  /** extra offset in socket space */
  p?: V3;
  r?: V3;
  /** arc height (metres) for the travel between sockets: lifts the hand mid-way so it reads as a reach */
  arc?: number;
}

export interface AnimEvent {
  t: number;
  type: string;
  arg?: string | number;
}

export interface ClipDef {
  name: string;
  dur: number;
  loop?: boolean;
  tracks?: Record<string, Key[]>;
  left?: HandKey[];
  right?: HandKey[];
  events?: AnimEvent[];
}

interface CKey {
  t: number;
  p: THREE.Vector3;
  q: THREE.Quaternion;
  e: (t: number) => number;
}

export class Clip {
  readonly name: string;
  readonly dur: number;
  readonly loop: boolean;
  readonly tracks = new Map<string, CKey[]>();
  readonly left: HandKey[];
  readonly right: HandKey[];
  readonly events: AnimEvent[];

  constructor(def: ClipDef) {
    this.name = def.name;
    this.dur = def.dur;
    this.loop = !!def.loop;
    this.left = (def.left ?? []).slice().sort((a, b) => a.t - b.t);
    this.right = (def.right ?? []).slice().sort((a, b) => a.t - b.t);
    this.events = (def.events ?? []).slice().sort((a, b) => a.t - b.t);
    const e = new THREE.Euler();
    for (const node in def.tracks) {
      const keys = def.tracks[node].slice().sort((a, b) => a.t - b.t);
      const out: CKey[] = [];
      let lastP: V3 = [0, 0, 0];
      let lastR: V3 = [0, 0, 0];
      for (const k of keys) {
        if (k.p) lastP = k.p;
        if (k.r) lastR = k.r;
        out.push({
          t: k.t,
          p: new THREE.Vector3(lastP[0], lastP[1], lastP[2]),
          q: new THREE.Quaternion().setFromEuler(e.set(lastR[0] * DEG, lastR[1] * DEG, lastR[2] * DEG, 'XYZ')),
          e: Ease[k.e ?? 'inOut'],
        });
      }
      this.tracks.set(node, out);
    }
  }

  /** Evaluate one node's offset at time t. Returns false if the clip does not animate that node. */
  sample(node: string, t: number, outP: THREE.Vector3, outQ: THREE.Quaternion) {
    const keys = this.tracks.get(node);
    if (!keys || keys.length === 0) return false;
    if (t <= keys[0].t) {
      outP.copy(keys[0].p);
      outQ.copy(keys[0].q);
      return true;
    }
    const last = keys[keys.length - 1];
    if (t >= last.t) {
      outP.copy(last.p);
      outQ.copy(last.q);
      return true;
    }
    let i = 1;
    while (keys[i].t < t) i++;
    const a = keys[i - 1];
    const b = keys[i];
    const u = b.e(clamp((t - a.t) / Math.max(1e-6, b.t - a.t), 0, 1));
    outP.lerpVectors(a.p, b.p, u);
    outQ.slerpQuaternions(a.q, b.q, u);
    return true;
  }
}

export interface RigNode {
  obj: THREE.Object3D;
  restP: THREE.Vector3;
  restQ: THREE.Quaternion;
  /** current offsets (after blending) */
  p: THREE.Vector3;
  q: THREE.Quaternion;
  /** snapshot used while blending from the previous clip */
  fromP: THREE.Vector3;
  fromQ: THREE.Quaternion;
}

export interface HandState {
  /** hand root object; its parent is the space sockets are measured in */
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  fromPos: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  pose: HandPose;
  /** true until the first evaluation (so there is nothing to blend from) */
  fresh: boolean;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _p2 = new THREE.Vector3();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const IDENT_Q = new THREE.Quaternion();
const ZERO = new THREE.Vector3();

/**
 * Plays clips on a rig: a set of named nodes + named sockets + two hands.
 */
export class Animator {
  readonly nodes = new Map<string, RigNode>();
  readonly sockets = new Map<string, THREE.Object3D>();
  left: HandState | null = null;
  right: HandState | null = null;
  clip: Clip | null = null;
  time = 0;
  speed = 1;
  /** blend-in progress 0..1 from the snapshot pose */
  private fade = 1;
  private fadeDur = 0.1;
  private fired = 0; // index of next event
  onEvent: ((type: string, arg: string | number | undefined, clip: Clip) => void) | null = null;
  onEnd: ((clip: Clip) => void) | null = null;
  /** the object in whose local space hand transforms are computed (parent of the hands) */
  space: THREE.Object3D | null = null;

  addNode(name: string, obj: THREE.Object3D) {
    this.nodes.set(name, {
      obj,
      restP: obj.position.clone(),
      restQ: obj.quaternion.clone(),
      p: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      fromP: new THREE.Vector3(),
      fromQ: new THREE.Quaternion(),
    });
  }
  addSocket(name: string, obj: THREE.Object3D) {
    this.sockets.set(name, obj);
  }
  clearRig() {
    this.nodes.clear();
    this.sockets.clear();
    this.clip = null;
  }
  makeHand(obj: THREE.Object3D): HandState {
    return {
      obj,
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      fromPos: new THREE.Vector3(),
      fromQuat: new THREE.Quaternion(),
      pose: 'grip',
      fresh: true,
    };
  }

  get playing() {
    return !!this.clip && (this.clip.loop || this.time < this.clip.dur);
  }
  get finished() {
    return !this.clip || (!this.clip.loop && this.time >= this.clip.dur);
  }
  /** 0..1 progress through the current clip */
  get progress() {
    return this.clip ? clamp(this.time / this.clip.dur, 0, 1) : 1;
  }

  play(clip: Clip, fade = 0.1, startTime = 0, speed = 1) {
    // snapshot the pose we are leaving
    for (const n of this.nodes.values()) {
      n.fromP.copy(n.p);
      n.fromQ.copy(n.q);
    }
    for (const h of [this.left, this.right]) {
      if (!h) continue;
      h.fromPos.copy(h.pos);
      h.fromQuat.copy(h.quat);
    }
    this.clip = clip;
    this.time = startTime;
    this.speed = speed;
    this.fadeDur = fade;
    this.fade = fade <= 0 ? 1 : 0;
    this.fired = 0;
    while (this.fired < clip.events.length && clip.events[this.fired].t < startTime) this.fired++;
  }

  update(dt: number) {
    const clip = this.clip;
    if (!clip) return;
    const prev = this.time;
    this.time += dt * this.speed;
    if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / Math.max(1e-4, this.fadeDur));
    // events
    while (this.fired < clip.events.length && clip.events[this.fired].t <= this.time) {
      const ev = clip.events[this.fired++];
      this.onEvent?.(ev.type, ev.arg, clip);
      if (this.clip !== clip) return; // event handler started another clip
    }
    if (clip.loop) {
      if (this.time >= clip.dur) {
        this.time -= clip.dur;
        this.fired = 0;
      }
    } else if (prev < clip.dur && this.time >= clip.dur) {
      this.time = clip.dur;
      this.apply();
      this.onEnd?.(clip);
      return;
    }
    this.apply();
  }

  /** Force-evaluate the pose at the current time (also used by debug tools to scrub). */
  apply() {
    const clip = this.clip;
    const w = smoothstep(0, 1, this.fade);
    for (const [name, n] of this.nodes) {
      if (clip && clip.sample(name, this.time, _p, _q)) {
        /* sampled */
      } else {
        _p.copy(ZERO);
        _q.copy(IDENT_Q);
      }
      if (w < 1) {
        n.p.lerpVectors(n.fromP, _p, w);
        n.q.slerpQuaternions(n.fromQ, _q, w);
      } else {
        n.p.copy(_p);
        n.q.copy(_q);
      }
      n.obj.position.copy(n.restP).add(n.p);
      n.obj.quaternion.copy(n.restQ).multiply(n.q);
    }
    if (clip && this.space) {
      this.space.updateMatrixWorld(true);
      _m2.copy(this.space.matrixWorld).invert();
      if (this.left) this.applyHand(this.left, clip.left, w);
      if (this.right) this.applyHand(this.right, clip.right, w);
    }
  }

  private socketPose(key: HandKey, outP: THREE.Vector3, outQ: THREE.Quaternion) {
    const s = this.sockets.get(key.to);
    if (!s) {
      outP.set(0, -0.5, 0);
      outQ.identity();
      return;
    }
    _m.multiplyMatrices(_m2, s.matrixWorld);
    _m.decompose(outP, outQ, _s);
    if (key.p) outP.add(_p2.set(key.p[0], key.p[1], key.p[2]).applyQuaternion(outQ));
    if (key.r) outQ.multiply(_q2.setFromEuler(_e.set(key.r[0] * DEG, key.r[1] * DEG, key.r[2] * DEG, 'XYZ')));
  }

  private applyHand(h: HandState, keys: HandKey[], w: number) {
    if (keys.length === 0) return;
    let i = 0;
    while (i + 1 < keys.length && keys[i + 1].t <= this.time) i++;
    const cur = keys[i];
    this.socketPose(cur, _p, _q);
    const blend = cur.blend ?? 0.14;
    if (i > 0 && this.time < cur.t + blend) {
      const prevKey = keys[i - 1];
      const u = Ease.inOut(clamp((this.time - cur.t) / blend, 0, 1));
      const tp = new THREE.Vector3();
      const tq = new THREE.Quaternion();
      this.socketPose(prevKey, tp, tq);
      _p.lerpVectors(tp, _p, u);
      _q.copy(tq.slerp(_q, u));
      if (cur.arc) _p.y += Math.sin(u * Math.PI) * cur.arc;
      h.pose = u > 0.5 ? (cur.pose ?? 'grip') : (prevKey.pose ?? 'grip');
    } else h.pose = cur.pose ?? 'grip';

    if (w < 1 && !h.fresh) {
      h.pos.lerpVectors(h.fromPos, _p, w);
      h.quat.slerpQuaternions(h.fromQuat, _q, w);
    } else {
      h.pos.copy(_p);
      h.quat.copy(_q);
    }
    h.fresh = false;
    h.obj.position.copy(h.pos);
    h.obj.quaternion.copy(h.quat);
  }
}

/** Shorthand used by clip tables. */
export const k = (t: number, p?: V3, r?: V3, e?: EaseName): Key => ({ t, p, r, e });
export const ev = (t: number, type: string, arg?: string | number): AnimEvent => ({ t, type, arg });
export const hand = (t: number, to: string, o: Partial<HandKey> = {}): HandKey => ({ t, to, ...o });
