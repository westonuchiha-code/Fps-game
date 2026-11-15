import type * as THREE from 'three';
import type { Game } from '../game';
import { Vehicle } from './vehicle';
import { Teamster } from './teamster';
import { Vesper } from './vesper';

export { Vehicle, Teamster, Vesper };
export type { Passenger, SeatName } from './vehicle';

export interface VehicleSystem {
  readonly list: Vehicle[];
  spawnTeamster(pos: THREE.Vector3, yaw: number): Teamster;
  spawnVesper(pos: THREE.Vector3, yaw: number): Vesper;
  /** remove one vehicle (ejecting the player first) */
  remove(v: Vehicle): void;
  clear(): void;
  update(dt: number): void;
  lateUpdate(dt: number): void;
}

/** Register the vehicle system with the game. Safe to call more than once (returns the same system). */
export function installVehicles(game: Game): VehicleSystem {
  const existing = (game as any).vehicles as VehicleSystem | undefined;
  if (existing) return existing;
  const list: Vehicle[] = [];
  const sys: VehicleSystem = {
    list,
    spawnTeamster(pos, yaw) {
      const v = new Teamster(pos, yaw);
      list.push(v);
      return v;
    },
    spawnVesper(pos, yaw) {
      const v = new Vesper(pos, yaw);
      list.push(v);
      return v;
    },
    remove(v) {
      v.dispose();
      const i = list.indexOf(v);
      if (i >= 0) list.splice(i, 1);
    },
    clear() {
      for (const v of list) v.dispose();
      list.length = 0;
    },
    update(dt) {
      if (game.state !== 'playing' || !game.level) return;
      for (let i = 0; i < list.length; i++) list[i].update(dt);
    },
    lateUpdate(dt) {
      if (game.state !== 'playing' || !game.level) return;
      for (let i = 0; i < list.length; i++) list[i].lateUpdate(dt);
    },
  };
  game.systems.push(sys);
  game.events.on('levelUnload', () => sys.clear());
  (game as any).vehicles = sys;
  return sys;
}
