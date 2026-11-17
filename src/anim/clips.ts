import * as THREE from 'three';

/**
 * Animation clips: short keyed poses layered over the procedural motion in CharAnim (walk, run,
 * aim, crouch). A clip stores, at each key, per-bone rotation offsets in degrees, plus offsets for
 * the carried rifle and how far the left hand has moved from the handguard to the magazine. They
 * live in public/anims/clips.json and are made with the pose editor (#anim).
 */

/** Bone names as stored in the file (indices match `B` in src/ai/charModel.ts). */
export const BONES = ['root', 'pelvis', 'chest', 'head', 'armL', 'foreL', 'armR', 'foreR', 'thighL', 'shinL', 'thighR', 'shinR'] as const;
export type BoneName = (typeof BONES)[number];
export type CharKindName = 'assoc' | 'super' | 'striker' | 'manager';

export interface ClipKey {
  /** seconds from the start */
  t: number;
  /** rotation offset per bone, degrees [x, y, z], applied after the procedural pose */
  bones?: Partial<Record<BoneName, [number, number, number]>>;
  /** rifle offset in the chest frame: metres [x, y, z] then degrees [x, y, z] */
  rifle?: [number, number, number, number, number, number];
  /** 0 = left hand on the handguard, 1 = left hand on the magazine */
  mag?: number;
  /** easing into the next key */
  ease?: 'smooth' | 'linear' | 'step';
}

export interface Clip {
  /** which characters it is for (empty = all) */
  for?: CharKindName[];
  length: number;
  loop?: boolean;
  blendIn?: number;
  blendOut?: number;
  keys: ClipKey[];
  note?: string;
}

export interface ClipFile {
  version: 1;
  clips: Record<string, Clip>;
}

export const CLIPS: Record<string, Clip> = {};

/** Load clips.json (the game and the pose editor both call this at start). */
export async function loadClips(url = 'anims/clips.json') {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return;
    const f = (await r.json()) as ClipFile;
    setClips(f.clips ?? {});
  } catch {
    /* no clips: characters still move procedurally */
  }
}

export function setClips(c: Record<string, Clip>) {
  for (const k of Object.keys(CLIPS)) delete CLIPS[k];
  for (const [k, v] of Object.entries(c)) {
    v.keys.sort((a, b) => a.t - b.t);
    CLIPS[k] = v;
  }
}

/** A sampled pose: bone offsets as quaternions, rifle offset, left-hand blend. */
export class ClipPose {
  readonly q = BONES.map(() => new THREE.Quaternion());
  readonly has = BONES.map(() => false);
  readonly rifleP = new THREE.Vector3();
  readonly rifleR = new THREE.Euler();
  hasRifle = false;
  mag = 0;
}

const D2R = Math.PI / 180;
const _e = new THREE.Euler();
const _a = [0, 0, 0, 0, 0, 0];

const ease = (k: ClipKey, u: number) => (k.ease === 'linear' ? u : k.ease === 'step' ? 0 : u * u * (3 - 2 * u));

/** Sample `clip` at time `t` into `out` (no allocation). */
export function sampleClip(clip: Clip, t: number, out: ClipPose) {
  const keys = clip.keys;
  out.has.fill(false);
  out.hasRifle = false;
  out.mag = 0;
  if (!keys.length) return out;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const k0 = keys[i];
  const k1 = keys[Math.min(i + 1, keys.length - 1)];
  const span = k1.t - k0.t;
  const u = span > 1e-6 && t > k0.t ? ease(k0, Math.min(1, (t - k0.t) / span)) : 0;
  for (let b = 0; b < BONES.length; b++) {
    const n = BONES[b];
    const a = k0.bones?.[n];
    const c = k1.bones?.[n];
    if (!a && !c) continue;
    const x = (a?.[0] ?? 0) + ((c?.[0] ?? 0) - (a?.[0] ?? 0)) * u;
    const y = (a?.[1] ?? 0) + ((c?.[1] ?? 0) - (a?.[1] ?? 0)) * u;
    const z = (a?.[2] ?? 0) + ((c?.[2] ?? 0) - (a?.[2] ?? 0)) * u;
    out.q[b].setFromEuler(_e.set(x * D2R, y * D2R, z * D2R, 'XYZ'));
    out.has[b] = true;
  }
  if (k0.rifle || k1.rifle) {
    for (let j = 0; j < 6; j++) _a[j] = (k0.rifle?.[j] ?? 0) + ((k1.rifle?.[j] ?? 0) - (k0.rifle?.[j] ?? 0)) * u;
    out.rifleP.set(_a[0], _a[1], _a[2]);
    out.rifleR.set(_a[3] * D2R, _a[4] * D2R, _a[5] * D2R, 'XYZ');
    out.hasRifle = true;
  }
  out.mag = (k0.mag ?? 0) + ((k1.mag ?? 0) - (k0.mag ?? 0)) * u;
  return out;
}

/** Blend weight of a one-shot clip at time t (fades in and out at the ends). */
export function clipWeight(clip: Clip, t: number) {
  if (clip.loop) return Math.min(1, t / Math.max(1e-3, clip.blendIn ?? 0.15));
  const wi = Math.min(1, t / Math.max(1e-3, clip.blendIn ?? 0.12));
  const wo = Math.min(1, (clip.length - t) / Math.max(1e-3, clip.blendOut ?? 0.18));
  return Math.max(0, Math.min(wi, wo));
}

/** The clip's raw values at time t as a key (what the editor writes when it adds a key). */
export function sampleKey(clip: Clip, t: number): ClipKey {
  const keys = clip.keys;
  const out: ClipKey = { t: +t.toFixed(3) };
  if (!keys.length) return out;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const k0 = keys[i];
  const k1 = keys[Math.min(i + 1, keys.length - 1)];
  const span = k1.t - k0.t;
  const u = span > 1e-6 && t > k0.t ? ease(k0, Math.min(1, (t - k0.t) / span)) : 0;
  const mix = (a: readonly number[] | undefined, c: readonly number[] | undefined, n: number) => {
    const r: number[] = [];
    for (let j = 0; j < n; j++) r.push(+((a?.[j] ?? 0) + ((c?.[j] ?? 0) - (a?.[j] ?? 0)) * u).toFixed(3));
    return r;
  };
  const names = new Set<BoneName>();
  for (const k of keys) for (const n of Object.keys(k.bones ?? {})) names.add(n as BoneName);
  if (names.size) {
    out.bones = {};
    for (const n of names) out.bones[n] = mix(k0.bones?.[n], k1.bones?.[n], 3) as [number, number, number];
  }
  if (keys.some((k) => k.rifle)) out.rifle = mix(k0.rifle, k1.rifle, 6) as ClipKey['rifle'];
  if (keys.some((k) => k.mag !== undefined)) out.mag = +((k0.mag ?? 0) + ((k1.mag ?? 0) - (k0.mag ?? 0)) * u).toFixed(3);
  if (k0.ease && k0.ease !== 'smooth') out.ease = k0.ease;
  return out;
}
