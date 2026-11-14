import type * as THREE from 'three';

export type Faction = 'player' | 'union' | 'monomart' | 'neutral';
export type Element = 'none' | 'fire' | 'shock' | 'acid';
export type DamageKind = 'bullet' | 'explosion' | 'melee' | 'dot' | 'vehicle' | 'fall';

export interface DamageInfo {
  amount: number;
  element: Element;
  crit: boolean;
  kind: DamageKind;
  /** who dealt it (null = the world) */
  source: Target | null;
  point: THREE.Vector3;
  /** direction the damage travelled */
  dir: THREE.Vector3;
  /** knock-back strength in m/s */
  impulse?: number;
  /** chance 0..1 to apply the element's status effect */
  statusChance?: number;
  /** damage per second of the status effect if it procs */
  statusDps?: number;
  /** which hit zone the shot landed in */
  zone?: HitZone;
}

export type HitZone = 'head' | 'body' | 'legs' | 'weak' | 'armor' | 'shield';

/** Anything that can be seen, aimed at and hurt. */
export interface Target {
  readonly id: number;
  faction: Faction;
  alive: boolean;
  /** feet position */
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  height: number;
  /** world-space point to aim at (chest) */
  aimPoint(out: THREE.Vector3): THREE.Vector3;
  headPoint(out: THREE.Vector3): THREE.Vector3;
  takeDamage(d: DamageInfo): void;
  /** display name for kill feed / debugging */
  label: string;
}

export function hostile(a: Faction, b: Faction) {
  if (a === 'neutral' || b === 'neutral') return false;
  const good = (f: Faction) => f === 'player' || f === 'union';
  return good(a) !== good(b);
}

let nextId = 1;
export const newId = () => nextId++;
