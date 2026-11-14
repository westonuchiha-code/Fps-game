import * as THREE from 'three';
import { G } from '../core/globals';
import { PAL } from '../render/toon';
import type { GeoBuilder } from '../world/builder';
import { Level } from '../world/level';
import { Locker } from '../loot/loot';
import { rollWeapon } from '../weapons/items';

/** Developer sandbox: a flat yard with every kind of obstacle. Open with ?level=test. */
export class TestBed extends Level {
  readonly id = 'test';
  readonly title = 'Test Yard';
  readonly number = 'SANDBOX';

  build(b: GeoBuilder) {
    this.spawn.pos.set(0, 0.2, 14);
    this.spawn.yaw = 0;
    this.nav([-60, -2, -60], [60, 12, 60]);
    b.slab(-70, -1, -70, 140, 1, 140, { mat: 'asphalt', color: PAL.asphalt, uv: 6 });
    // perimeter
    b.slab(-70, 0, -71, 140, 6, 1, { mat: 'concrete', color: PAL.concrete });
    b.slab(-70, 0, 70, 140, 6, 1, { mat: 'concrete', color: PAL.concrete });
    b.slab(-71, 0, -70, 1, 6, 140, { mat: 'concrete', color: PAL.concrete });
    b.slab(70, 0, -70, 1, 6, 140, { mat: 'concrete', color: PAL.concrete });
    // containers
    b.box({ pos: [-8, 1.3, -6], size: [2.44, 2.6, 6.1], mat: 'corrugated', color: PAL.cRed, uv: 2.44 });
    b.box({ pos: [-8, 3.9, -6], size: [2.44, 2.6, 6.1], rot: [0, 0.12, 0], mat: 'corrugated', color: PAL.cYellow, uv: 2.44 });
    b.box({ pos: [9, 1.3, -10], size: [2.44, 2.6, 12.2], rot: [0, 0.6, 0], mat: 'corrugated', color: PAL.cTeal, uv: 2.44 });
    b.box({ pos: [0, 1.3, -22], size: [12.2, 2.6, 2.44], mat: 'corrugated', color: PAL.cBlue, uv: 2.44 });
    // crates (cover) + a mantle ledge
    b.box({ pos: [3, 0.5, 4], size: [1, 1, 1], mat: 'wood', color: PAL.wood, uv: 1 });
    b.box({ pos: [4.1, 0.5, 4.2], size: [1, 1, 1], rot: [0, 0.3, 0], mat: 'wood', color: PAL.wood, uv: 1 });
    b.box({ pos: [3.5, 1.5, 4.1], size: [1, 1, 1], rot: [0, 0.7, 0], mat: 'cardboard', color: 0xc9a06a, uv: 1 });
    b.box({ pos: [-3, 0.6, 2], size: [3, 1.2, 0.5], mat: 'hazard', uv: 1 });
    b.box({ pos: [14, 1.0, 6], size: [6, 2.0, 6], mat: 'concrete', color: PAL.concrete });
    // ramp + stairs up to a deck
    b.ramp({ pos: [-16, 0, 4], size: [3, 2.6, 7], mat: 'panel', color: PAL.steel });
    b.box({ pos: [-16, 2.45, 12.5], size: [9, 0.3, 10], mat: 'grate', color: PAL.steel, uv: 2 });
    b.stairs({ pos: [-23, 0, 12], size: [3, 2.6, 6], rotY: Math.PI, mat: 'concrete', color: PAL.concrete });
    // low steps to test step-up
    for (let i = 0; i < 4; i++) b.box({ pos: [20, 0.15 + i * 0.3, -2 - i * 1.2], size: [4, 0.3 + i * 0.6, 1.2], mat: 'concrete', color: PAL.concreteDark });
    // barrels
    b.cyl({ pos: [6, 0, 9], r: 0.42, h: 1.15, mat: 'panel', color: 0xc8402a, uv: 1.4, sides: 10 });
    b.cyl({ pos: [7, 0, 9.4], r: 0.42, h: 1.15, mat: 'panel', color: PAL.cBlue, uv: 1.4, sides: 10 });
  }

  override onStart() {
    new Locker(new THREE.Vector3(-4, 0, 9), Math.PI, 2, 3);
    new Locker(new THREE.Vector3(4, 0, -18), 0, 1, 2);
    G.loot.spawn('ammo', new THREE.Vector3(1, 0.1, 9), { cls: 'pistol', amount: 24, pop: false });
    G.loot.spawn('ammo', new THREE.Vector3(2, 0.1, 9), { cls: 'rifle', amount: 60, pop: false });
    G.loot.spawn('ammo', new THREE.Vector3(3, 0.1, 9), { cls: 'shotgun', amount: 16, pop: false });
    G.loot.spawn('ammo', new THREE.Vector3(1, 0.1, 10), { cls: 'sniper', amount: 12, pop: false });
    G.loot.spawn('health', new THREE.Vector3(2, 0.1, 10), { amount: 30, pop: false });
    G.loot.spawn('mine', new THREE.Vector3(3, 0.1, 10), { amount: 3, pop: false });
    G.inv.give(rollWeapon(2, { cls: 'pistol', brand: 'valu', rarity: 1, seed: 11 }));
    G.inv.give(rollWeapon(2, { cls: 'rifle', brand: 'picket', rarity: 2, seed: 12 }));
    G.inv.give(rollWeapon(2, { cls: 'shotgun', brand: 'krona', rarity: 3, seed: 13 }));
    G.inv.give(rollWeapon(2, { cls: 'sniper', brand: 'zapp', rarity: 3, seed: 14 }));
    G.inv.ammo = { pistol: 96, rifle: 180, shotgun: 32, sniper: 20 };
    this.objective('test', 'Break things');
  }
}
