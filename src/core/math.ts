import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (a === b ? 0 : (v - a) / (b - a));
export const remap = (v: number, a: number, b: number, c: number, d: number) =>
  lerp(c, d, clamp01(invLerp(a, b, v)));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential approach. `rate` is roughly 1/time-constant. */
export const damp = (a: number, b: number, rate: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-rate * dt));

export const dampAngle = (a: number, b: number, rate: number, dt: number) =>
  a + angleDelta(a, b) * (1 - Math.exp(-rate * dt));

/** Shortest signed difference b-a wrapped to [-PI, PI]. */
export const angleDelta = (a: number, b: number) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

export const approach = (a: number, b: number, maxStep: number) =>
  a < b ? Math.min(a + maxStep, b) : Math.max(a - maxStep, b);

export function dampVec3(a: THREE.Vector3, b: THREE.Vector3, rate: number, dt: number) {
  const t = 1 - Math.exp(-rate * dt);
  a.x += (b.x - a.x) * t;
  a.y += (b.y - a.y) * t;
  a.z += (b.z - a.z) * t;
  return a;
}

/** Critically damped spring (value+velocity), stable for any dt. */
export class Spring {
  x = 0;
  v = 0;
  constructor(
    public stiffness = 120,
    public damping = 14,
  ) {}
  update(target: number, dt: number) {
    // semi-implicit Euler with sub-steps for stability at low frame rates
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = (target - this.x) * this.stiffness - this.v * this.damping;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  kick(impulse: number) {
    this.v += impulse;
  }
  reset(x = 0) {
    this.x = x;
    this.v = 0;
  }
}

export class Spring3 {
  x = new Spring();
  y = new Spring();
  z = new Spring();
  constructor(stiffness = 120, damping = 14) {
    this.x = new Spring(stiffness, damping);
    this.y = new Spring(stiffness, damping);
    this.z = new Spring(stiffness, damping);
  }
  update(tx: number, ty: number, tz: number, dt: number) {
    this.x.update(tx, dt);
    this.y.update(ty, dt);
    this.z.update(tz, dt);
  }
  kick(ix: number, iy: number, iz: number) {
    this.x.kick(ix);
    this.y.kick(iy);
    this.z.kick(iz);
  }
  reset() {
    this.x.reset();
    this.y.reset();
    this.z.reset();
  }
}

/** Small fast seedable PRNG (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p: number) {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** Weighted pick: items with a numeric weight. */
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
  gauss() {
    // Box–Muller
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
}

export const grng = new Rng((Math.random() * 2 ** 32) >>> 0);
export const rand = (a = 0, b = 1) => a + (b - a) * Math.random();
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Easing curves used by the keyframe animator.
export type EaseName =
  | 'linear'
  | 'in'
  | 'out'
  | 'inOut'
  | 'outCubic'
  | 'inCubic'
  | 'outBack'
  | 'inBack'
  | 'outQuint'
  | 'snap'
  | 'hold';

export const Ease: Record<EaseName, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  inBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  snap: (t) => 1 - Math.pow(1 - t, 6),
  hold: (t) => (t >= 1 ? 1 : 0),
};

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const UP = new THREE.Vector3(0, 1, 0);

export function yawToDir(yaw: number, out = new THREE.Vector3()) {
  // yaw 0 looks down -Z, positive yaw turns left (counter-clockwise from above)
  return out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
}
export function dirToYaw(x: number, z: number) {
  return Math.atan2(-x, -z);
}

export function formatNum(n: number) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 10000) return (n / 1000).toFixed(1) + 'K';
  return Math.round(n).toString();
}
