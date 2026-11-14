import type { MatName } from './builder';
import type { Brand, Rarity, WeaponClass } from '../weapons/items';

/**
 * The level file format (public/levels/*.json). Everything a level contains is plain data so it
 * can be made in the level editor, saved, shared and edited by hand.
 *
 * Coordinates: metres, +Y up, yaw 0 faces -Z (north on the editor's top-down map).
 * `pos` is the centre of the base for props/characters, and the centre of the volume for
 * boxes, triggers and nav areas. `rot` is Euler XYZ in radians (most things only use rot[1], yaw).
 */

export type V3 = [number, number, number];

export interface LBase {
  id: string;
  /** optional name other objects/actions refer to */
  name?: string;
  pos: V3;
  rot?: V3;
  /** editor-only organisation */
  group?: string;
  locked?: boolean;
}

export interface LShapeStyle {
  mat: MatName;
  /** #rrggbb tint */
  color: string;
  /** metres per texture repeat */
  uv?: number;
  collide?: boolean;
  /** built as its own object so actions can remove it at run time (gates, barricades) */
  dynamic?: boolean;
}

export interface LBox extends LBase, LShapeStyle {
  type: 'box';
  size: V3;
}
export interface LRamp extends LBase, LShapeStyle {
  type: 'ramp';
  /** width, rise, run. Rises towards local +Z (south before rotation). */
  size: V3;
}
export interface LStairs extends LBase, LShapeStyle {
  type: 'stairs';
  size: V3;
  steps?: number;
}
export interface LCyl extends LBase, LShapeStyle {
  type: 'cyl';
  r: number;
  h: number;
  sides?: number;
}
export interface LProp extends LBase {
  type: 'prop';
  /** key into PROPS (src/world/props.ts) */
  prop: string;
  color?: string;
  variant?: number;
  scale?: number;
  text?: string;
  dynamic?: boolean;
}

export type EnemyKind = 'assoc' | 'super' | 'drone' | 'manager';

export interface LEnemy extends LBase {
  type: 'enemy';
  kind: EnemyKind;
  /** enemies sharing a squad name fight as a team */
  squad?: string;
  /** if set, the enemy does not exist until a `spawn` action with this tag runs */
  tag?: string;
  /** walk between these points until alerted */
  patrol?: V3[];
  /** stay near the spawn point even in combat */
  hold?: boolean;
  /** overrides the level's enemy level */
  level?: number;
}
export interface LAlly extends LBase {
  type: 'ally';
  voice: 'rivet' | 'dutch' | 'hank';
  /** gets back up after being downed */
  essential?: boolean;
  tag?: string;
}
export interface LPickup extends LBase {
  type: 'pickup';
  kind: 'ammo' | 'health' | 'mine' | 'cash';
  cls?: WeaponClass;
  amount?: number;
}
export interface LWeapon extends LBase {
  type: 'weapon';
  /** leave fields out to roll them randomly */
  cls?: WeaponClass;
  brand?: Brand;
  rarity?: Rarity;
  level?: number;
  seed?: number;
  shield?: boolean;
}
export interface LLocker extends LBase {
  type: 'locker';
  /** 0 ordinary, 1 good, 2 great */
  luck?: number;
}
export interface LBarrel extends LBase {
  type: 'barrel';
}
export interface LVehicle extends LBase {
  type: 'vehicle';
  kind: 'teamster' | 'vesper';
}
/** Something that breaks and then runs actions (power couplings, generators...). */
export interface LDestructible extends LBase {
  type: 'destructible';
  prop: string;
  hp?: number;
  /** what can hurt it */
  by?: 'explosion' | 'any';
  actions?: LAction[];
}
export interface LTrigger extends LBase {
  type: 'trigger';
  size: V3;
  once?: boolean;
  /** starts switched off until an `enable` action names it */
  disabled?: boolean;
  actions: LAction[];
}
export interface LCheckpoint extends LBase {
  type: 'checkpoint';
  size: V3;
}
export interface LMarker extends LBase {
  type: 'marker';
}
export interface LNav extends LBase {
  type: 'nav';
  size: V3;
}

export type LAction =
  | { do: 'spawn'; tag: string }
  | { do: 'say'; line: string }
  | { do: 'objective'; id: string; text: string }
  | { do: 'complete'; id: string }
  | { do: 'toast'; text: string }
  | { do: 'music'; track: string | null }
  | { do: 'checkpoint' }
  | { do: 'enable'; target: string }
  | { do: 'disable'; target: string }
  | { do: 'remove'; target: string; boom?: boolean }
  | { do: 'marker'; target: string; label: string }
  | { do: 'unmark'; target: string }
  | { do: 'count'; id: string; need: number; then: LAction[] }
  | { do: 'wait'; seconds: number }
  | { do: 'script'; name: string }
  | { do: 'end' };

export type LObject = LBox | LRamp | LStairs | LCyl | LProp | LEnemy | LAlly | LPickup | LWeapon | LLocker | LBarrel | LVehicle | LDestructible | LTrigger | LCheckpoint | LMarker | LNav;
export type LType = LObject['type'];

export interface LWatcher {
  /** runs when every enemy spawned with this tag is dead */
  allDead: string;
  actions: LAction[];
}

export interface LevelData {
  format: 1;
  id: string;
  title: string;
  /** e.g. "MISSION 01" */
  number: string;
  sky: 'dawn' | 'noon' | 'dusk' | 'night';
  enemyLevel: number;
  music: string | null;
  killY: number;
  spawn: { pos: V3; yaw: number };
  objects: LObject[];
  watchers?: LWatcher[];
  /** actions run once when the level starts (after any scripted intro) */
  onStart?: LAction[];
  /** with no script and no explicit objectives, clearing every enemy ends the level */
  winOnAllDead?: boolean;
}

export function emptyLevel(id = 'custom', title = 'Untitled'): LevelData {
  return {
    format: 1,
    id,
    title,
    number: 'CUSTOM',
    sky: 'dawn',
    enemyLevel: 1,
    music: 'm01',
    killY: -40,
    spawn: { pos: [0, 0.1, 8], yaw: 0 },
    winOnAllDead: true,
    objects: [
      { id: 'floor', type: 'box', pos: [0, -0.5, 0], size: [60, 1, 60], mat: 'asphalt', color: '#4b4852', uv: 6 },
    ],
  };
}

let idCounter = 0;
export function newId(prefix = 'o') {
  idCounter++;
  return prefix + Date.now().toString(36).slice(-4) + idCounter.toString(36);
}

export const hexToNum = (s: string | undefined, fallback = 0xffffff) => {
  if (!s) return fallback;
  const n = parseInt(s.replace('#', ''), 16);
  return Number.isFinite(n) ? n : fallback;
};
export const numToHex = (n: number) => '#' + n.toString(16).padStart(6, '0');
