import * as THREE from 'three';
import { G } from '../core/globals';
import type { Surf } from './builder';
import { hostile, type DamageInfo, type Element, type Faction, type HitZone, type Target } from '../core/types';
import type { Item } from '../weapons/items';

export interface WorldHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  surf: Surf;
  target: Target | null;
  zone?: HitZone;
  /** set by destructible scenery (barrels, couplings): called when a bullet/melee lands */
  onHit?: (damage: number, by: Target | null) => void;
}

/** Things with their own hit volumes (characters, barrels, mines...). */
export interface Shootable {
  /** quick reject sphere */
  readonly boundPos: THREE.Vector3;
  readonly boundRadius: number;
  /** owner is skipped when it is the shooter */
  readonly owner: Target | null;
  /** Return the hit distance (and fill zone/onHit) or -1. */
  rayHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { zone?: HitZone; onHit?: WorldHit['onHit']; normal: THREE.Vector3 }): number;
}

export interface Explodable {
  pos: THREE.Vector3;
  onExplosion(center: THREE.Vector3, radius: number, damage: number, by: Target | null): void;
}

export interface Interactable {
  pos: THREE.Vector3;
  range: number;
  enabled: boolean;
  /** text after the key prompt, e.g. "Open locker" */
  label(): string;
  onUse(hold: boolean): void;
  /** shown as an item card while focused */
  item?: Item;
  /** hold the key for this many seconds (default: instant) */
  hold?: number;
}

export interface Updatable {
  update(dt: number): void;
  dead?: boolean;
}

export type NoiseKind = 'gunshot' | 'explosion' | 'step' | 'impact' | 'voice' | 'vehicle';

export interface Listener {
  hear(pos: THREE.Vector3, kind: NoiseKind, source: Target | null, loud: number): void;
  pos: THREE.Vector3;
  alive: boolean;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _tmpOut = { zone: undefined as HitZone | undefined, onHit: undefined as WorldHit['onHit'], normal: new THREE.Vector3() };

/** Registry of everything alive in the level plus the spatial queries gameplay needs. */
export class World {
  readonly targets: Target[] = [];
  readonly shootables: Shootable[] = [];
  readonly explodables: Explodable[] = [];
  readonly interactables: Interactable[] = [];
  readonly listeners: Listener[] = [];
  readonly updatables: Updatable[] = [];

  clear() {
    this.targets.length = 0;
    this.shootables.length = 0;
    this.explodables.length = 0;
    this.interactables.length = 0;
    this.listeners.length = 0;
    this.updatables.length = 0;
  }

  add<T extends Updatable>(u: T): T {
    this.updatables.push(u);
    return u;
  }
  remove<T>(list: T[], item: T) {
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
  }

  update(dt: number) {
    const list = this.updatables;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (!u.dead) u.update(dt);
    }
    // compact
    let w = 0;
    for (let i = 0; i < list.length; i++) if (!list[i].dead) list[w++] = list[i];
    list.length = w;
  }

  /** Nearest thing along a ray: level geometry, dynamic boxes, or a shootable. */
  hitscan(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, shooter: Target | null): WorldHit | null {
    let best: WorldHit | null = null;
    let bestD = maxDist;
    const wh = G.col.raycast(origin, dir, maxDist, 'all');
    if (wh) {
      bestD = wh.distance;
      best = { point: wh.point, normal: wh.normal, distance: wh.distance, surf: wh.surf, target: null };
      const owner = wh.box?.owner as { onShot?: WorldHit['onHit'] } | null | undefined;
      if (owner && owner.onShot) best.onHit = (d, by) => owner.onShot!(d, by);
    }
    for (const s of this.shootables) {
      if (s.owner && s.owner === shooter) continue;
      // sphere reject
      _v.copy(s.boundPos).sub(origin);
      const t = _v.dot(dir);
      if (t < -s.boundRadius || t > bestD + s.boundRadius) continue;
      const d2 = _v.lengthSq() - t * t;
      if (d2 > s.boundRadius * s.boundRadius) continue;
      _tmpOut.zone = undefined;
      _tmpOut.onHit = undefined;
      const d = s.rayHit(origin, dir, bestD, _tmpOut);
      if (d >= 0 && d < bestD) {
        bestD = d;
        best = {
          point: origin.clone().addScaledVector(dir, d),
          normal: _tmpOut.normal.clone(),
          distance: d,
          surf: 1 as Surf,
          target: s.owner,
          zone: _tmpOut.zone,
          onHit: _tmpOut.onHit,
        };
      }
    }
    return best;
  }

  /** Is there a clear line between two points (ignores characters)? */
  los(a: THREE.Vector3, b: THREE.Vector3) {
    return G.col.lineOfSight(a, b);
  }

  /**
   * Radial blast. Damage falls off linearly; walls block it.
   */
  explode(center: THREE.Vector3, radius: number, damage: number, by: Target | null, opts: { small?: boolean; element?: Element; noFx?: boolean; byFaction?: Faction } = {}) {
    if (!opts.noFx) G.fx.explosion(center, radius, !!opts.small, opts.element ?? 'none');
    G.audio.play(opts.small ? 'explosion_small' : 'explosion_big', { pos: center, vol: 1, pitchVar: 0.06, ref: opts.small ? 9 : 16, wet: 0.5, maxDist: 400 });
    this.noise(center, opts.small ? 40 : 90, 'explosion', by);
    G.player.shakeFrom(center, opts.small ? 0.5 : 1, radius * 3.2);
    const faction: Faction = opts.byFaction ?? (by ? by.faction : 'neutral');
    for (const t of this.targets.slice()) {
      if (!t.alive) continue;
      t.aimPoint(_v);
      const d = _v.distanceTo(center);
      if (d > radius + t.radius) continue;
      // player-owned blasts do not hurt friends; they do hurt the player a little (self-damage teaches respect)
      if (by && t !== by && !hostile(faction, t.faction)) continue;
      _v2.copy(center);
      _v2.y += 0.25;
      if (!G.col.lineOfSight(_v2, _v)) continue;
      const f = 1 - Math.min(1, Math.max(0, d - t.radius) / radius);
      let amount = damage * (0.25 + 0.75 * f);
      if (t === by) amount *= 0.35;
      const dir = _v.clone().sub(center).normalize();
      dir.y = Math.max(dir.y, 0.35);
      t.takeDamage({
        amount,
        element: opts.element ?? 'none',
        crit: false,
        kind: 'explosion',
        source: by,
        point: _v.clone(),
        dir,
        impulse: (opts.small ? 5 : 11) * f,
        statusChance: opts.element && opts.element !== 'none' ? 0.6 : 0,
        statusDps: damage * 0.12,
      });
    }
    for (const e of this.explodables.slice()) {
      if (e.pos.distanceTo(center) <= radius + 0.6) e.onExplosion(center, radius, damage, by);
    }
  }

  noise(pos: THREE.Vector3, radius: number, kind: NoiseKind, source: Target | null) {
    const r2 = radius * radius;
    for (const l of this.listeners) {
      if (!l.alive) continue;
      const d2 = l.pos.distanceToSquared(pos);
      if (d2 <= r2) l.hear(pos, kind, source, 1 - Math.sqrt(d2) / radius);
    }
  }

  nearestHostile(pos: THREE.Vector3, faction: Faction, maxDist: number, exclude: Target | null = null, needLos = true): Target | null {
    let best: Target | null = null;
    let bd = maxDist * maxDist;
    for (const t of this.targets) {
      if (!t.alive || t === exclude || !hostile(faction, t.faction)) continue;
      const d = t.pos.distanceToSquared(pos);
      if (d >= bd) continue;
      if (needLos) {
        t.aimPoint(_v);
        if (!G.col.lineOfSight(pos, _v)) continue;
      }
      bd = d;
      best = t;
    }
    return best;
  }

  /** Target in a short cone in front of `origin` (melee, vehicle splatter checks). */
  meleeTarget(origin: THREE.Vector3, dir: THREE.Vector3, range: number, faction: Faction): Target | null {
    let best: Target | null = null;
    let bestScore = -1;
    for (const t of this.targets) {
      if (!t.alive || !hostile(faction, t.faction)) continue;
      t.aimPoint(_v);
      _v.sub(origin);
      const d = _v.length();
      if (d > range + t.radius) continue;
      const dot = _v.normalize().dot(dir);
      if (dot < 0.55) continue;
      const score = dot - d / (range * 3);
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  countAlive(faction: Faction) {
    let n = 0;
    for (const t of this.targets) if (t.alive && t.faction === faction) n++;
    return n;
  }

  /** Apply the same damage record to a target (kept as one entry point for future modifiers). */
  damage(t: Target, d: DamageInfo) {
    t.takeDamage(d);
  }
}

// ---- analytic ray helpers shared by character hit volumes ----

/** Ray vs sphere. Returns distance or -1. */
export function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number) {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t = -b - s;
  if (t >= 0) return t;
  return -b + s >= 0 ? 0 : -1;
}

const _ba = new THREE.Vector3();
const _oa = new THREE.Vector3();

/** Ray vs capsule (segment a-b, radius r). Returns distance or -1. */
export function rayCapsule(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number) {
  _ba.copy(b).sub(a);
  _oa.copy(o).sub(a);
  const baba = _ba.dot(_ba);
  const bard = _ba.dot(d);
  const baoa = _ba.dot(_oa);
  const rdoa = d.dot(_oa);
  const oaoa = _oa.dot(_oa);
  const aa = baba - bard * bard;
  let bb = baba * rdoa - baoa * bard;
  let cc = baba * oaoa - baoa * baoa - r * r * baba;
  let h = bb * bb - aa * cc;
  if (h >= 0 && aa > 1e-9) {
    const t = (-bb - Math.sqrt(h)) / aa;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 ? t : -1;
    // caps
    const oc = y <= 0 ? _oa : _oa.clone().sub(_ba);
    bb = d.dot(oc);
    cc = oc.dot(oc) - r * r;
    h = bb * bb - cc;
    if (h > 0) {
      const tc = -bb - Math.sqrt(h);
      return tc >= 0 ? tc : -1;
    }
  }
  return -1;
}
