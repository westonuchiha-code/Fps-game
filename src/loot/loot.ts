import * as THREE from 'three';
import { G } from '../core/globals';
import { clamp, damp, rand, Rng } from '../core/math';
import { Kit } from '../render/kit';
import { LAYER_FX } from '../render/pipeline';
import { flat, PAL, RARITY_COLORS, RARITY_NAMES } from '../render/toon';
import { buildGun } from '../weapons/gunModels';
import { CLASS_BASE, CLASSES, levelScale, rollShield, rollWeapon, type Item, type WeaponClass } from '../weapons/items';
import type { Interactable } from '../world/world';
import { hex } from '../ui/itemCard';

type PickupKind = 'item' | 'ammo' | 'health' | 'cash' | 'mine';

const _v = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

const geoCache = new Map<string, THREE.BufferGeometry>();
function propGeo(key: string, build: (k: Kit) => void) {
  let g = geoCache.get(key);
  if (!g) {
    const k = new Kit();
    build(k);
    g = k.geometry();
    geoCache.set(key, g);
  }
  return g;
}

const AMMO_COLOR: Record<WeaponClass, number> = { pistol: 0xd9aa3a, rifle: 0x4f8f5a, shotgun: 0xc8402a, sniper: 0x3f6fb5 };

function ammoGeo(cls: WeaponClass) {
  return propGeo('ammo_' + cls, (k) => {
    const c = AMMO_COLOR[cls];
    k.box(0.26, 0.16, 0.16, c, [0, 0.08, 0]);
    k.box(0.27, 0.03, 0.17, PAL.screen, [0, 0.165, 0]);
    k.box(0.1, 0.02, 0.04, 0x9aa4b0, [0, 0.185, 0]);
    k.box(0.262, 0.05, 0.1, PAL.shell, [0, 0.08, 0]);
  });
}
const healthGeo = () =>
  propGeo('health', (k) => {
    k.box(0.22, 0.16, 0.12, PAL.shell, [0, 0.08, 0]);
    k.box(0.1, 0.035, 0.125, 0xe23b2e, [0, 0.085, 0]);
    k.box(0.035, 0.1, 0.125, 0xe23b2e, [0, 0.085, 0]);
    k.box(0.1, 0.02, 0.03, 0x9aa4b0, [0, 0.17, 0]);
  });
const cashGeo = () =>
  propGeo('cash', (k) => {
    k.box(0.18, 0.035, 0.09, 0x4fae5a, [0, 0.02, 0]);
    k.box(0.18, 0.035, 0.09, 0x61c46c, [0.01, 0.055, 0.01], [0, 0.2, 0]);
    k.box(0.04, 0.075, 0.094, PAL.shell, [0, 0.04, 0]);
  });
const mineGeo = () =>
  propGeo('minepick', (k) => {
    k.box(0.2, 0.09, 0.15, 0xc9a06a, [0, 0.045, 0]);
    k.box(0.204, 0.094, 0.035, 0xe8dcc0, [0, 0.045, 0]);
    k.cyl(0.03, 0.03, 0.03, PAL.screen, [0.055, 0.1, 0.03], 'y', 8);
    k.box(0.07, 0.006, 0.05, PAL.smile, [-0.05, 0.092, -0.035]);
  });
const shieldGeo = () =>
  propGeo('shield', (k) => {
    k.cyl(0.16, 0.16, 0.05, 0x39424e, [0, 0, 0], 'z', 6, false);
    k.cyl(0.11, 0.11, 0.06, PAL.shock, [0, 0, 0], 'z', 6, false);
    k.box(0.05, 0.1, 0.07, 0x9aa4b0, [0, -0.17, 0]);
  });

let beamGeo: THREE.BufferGeometry | null = null;

/** A thing lying in the world that the player can collect. */
export class Pickup implements Interactable {
  readonly obj = new THREE.Group();
  readonly pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private rest = false;
  private age = 0;
  private beam: THREE.Mesh | null = null;
  private model: THREE.Object3D;
  private floorY = -1e9;
  private magnet = false;
  dead = false;
  // Interactable
  range = 3.2;
  enabled = false;
  item?: Item;
  hold?: number;

  constructor(
    readonly kind: PickupKind,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    opts: { item?: Item; cls?: WeaponClass; amount?: number } = {},
    private amount = opts.amount ?? 0,
    private cls: WeaponClass = opts.cls ?? 'pistol',
  ) {
    this.pos.copy(pos);
    this.vel.copy(vel);
    if (kind === 'item') {
      const item = opts.item!;
      this.item = item;
      this.enabled = true;
      if (item.kind === 'weapon') {
        const rig = buildGun(item);
        rig.root.traverse((o) => (o.castShadow = true));
        rig.root.scale.setScalar(1.25);
        rig.root.rotation.set(0, Math.PI / 2, 0.25);
        this.model = rig.root;
      } else {
        const m = new THREE.Mesh(shieldGeo(), G.mat.prop);
        m.castShadow = true;
        m.scale.setScalar(1.2);
        this.model = m;
      }
      // rarity beam
      if (!beamGeo) {
        beamGeo = new THREE.CylinderGeometry(0.05, 0.14, 1, 6, 1, true);
        beamGeo.translate(0, 0.5, 0);
      }
      const col = RARITY_COLORS[item.rarity];
      this.beam = new THREE.Mesh(beamGeo, flat(col, { additive: true, opacity: 0.55, side: THREE.DoubleSide, fog: false }));
      this.beam.scale.set(1, [1.6, 2.4, 3.6, 5.5, 9][item.rarity], 1);
      this.beam.layers.set(LAYER_FX);
      this.beam.visible = false;
      G.scene.add(this.beam);
    } else {
      const g = kind === 'ammo' ? ammoGeo(this.cls) : kind === 'health' ? healthGeo() : kind === 'cash' ? cashGeo() : mineGeo();
      const m = new THREE.Mesh(g, G.mat.prop);
      m.castShadow = true;
      this.model = m;
    }
    this.obj.add(this.model);
    this.obj.position.copy(this.pos);
    G.scene.add(this.obj);
    G.world.add(this);
    if (kind === 'item') G.world.interactables.push(this);
  }

  label() {
    return this.item ? this.item.name : '';
  }

  /** tap = stash/auto-slot, hold = equip right now */
  onUse(hold: boolean) {
    if (!this.item || this.dead) return;
    const item = this.item;
    const res = G.inv.give(item, hold);
    if (res === 'full') {
      G.hud.toast('BACKPACK FULL', 1.2, '#ff5a3c');
      G.audio.play('ui_error', { bus: 'ui' });
      return;
    }
    G.audio.play('pickup_weapon', { bus: 'ui', vol: 0.8 });
    G.hud.feedLine(`<span style="color:${hex(RARITY_COLORS[item.rarity])}">${item.name}</span> ${res === 'equipped' ? 'equipped' : '→ backpack'}`);
    G.stats.loot++;
    G.events.emit('itemTaken', { item });
    this.remove();
  }

  private remove() {
    this.dead = true;
    this.obj.removeFromParent();
    this.beam?.removeFromParent();
    if (this.kind === 'item') G.world.remove(G.world.interactables, this as Interactable);
  }

  private useful() {
    const inv = G.inv;
    const pl = G.player;
    switch (this.kind) {
      case 'ammo':
        return inv.needsAmmo(this.cls);
      case 'health':
        return pl.health < pl.maxHealth - 0.5;
      case 'mine':
        return inv.mines < inv.maxMines;
      case 'cash':
        return true;
    }
    return false;
  }

  private collect() {
    const inv = G.inv;
    switch (this.kind) {
      case 'ammo': {
        const got = inv.addAmmo(this.cls, this.amount);
        if (got <= 0) return;
        G.audio.play('pickup_ammo', { bus: 'ui', vol: 0.6, pitchVar: 0.05 });
        G.hud.feedLine(`+${got} ${CLASS_BASE[this.cls].label} ammo`);
        break;
      }
      case 'health':
        G.player.heal(this.amount);
        G.audio.play('pickup_health', { bus: 'ui', vol: 0.7 });
        G.hud.flash(0x66ff88, 0.18);
        G.hud.feedLine(`+${Math.round(this.amount)} health`);
        break;
      case 'cash':
        inv.cash += this.amount;
        G.stats.cash += this.amount;
        G.audio.play('pickup_cash', { bus: 'ui', vol: 0.5, pitchVar: 0.08 });
        G.hud.feedLine(`<span style="color:#9dff8a">+$${this.amount}</span>`);
        break;
      case 'mine': {
        const got = inv.addMines(this.amount);
        if (got <= 0) return;
        G.audio.play('pickup_mine', { bus: 'ui', vol: 0.7 });
        G.hud.feedLine(`+${got} charge${got > 1 ? 's' : ''}`);
        break;
      }
    }
    this.remove();
  }

  update(dt: number) {
    if (this.dead) return;
    this.age += dt;
    const pl = G.player;
    if (!this.rest) {
      this.vel.y -= 18 * dt;
      this.pos.addScaledVector(this.vel, dt);
      if (this.floorY < -1e8 || this.age < 0.05) {
        const g = G.col.raycast(_v.set(this.pos.x, this.pos.y + 0.6, this.pos.z), DOWN, 30, 'static');
        this.floorY = g ? g.point.y : this.pos.y - 0.5;
      }
      const rest = this.floorY + (this.kind === 'item' ? 0.42 : 0.02);
      if (this.pos.y <= rest && this.vel.y < 0) {
        this.pos.y = rest;
        if (this.vel.y < -3) {
          this.vel.y *= -0.38;
          this.vel.x *= 0.5;
          this.vel.z *= 0.5;
        } else {
          this.rest = true;
          this.vel.set(0, 0, 0);
          // re-check the floor where we actually stopped (slopes, ledges)
          const g = G.col.raycast(_v.set(this.pos.x, this.pos.y + 0.6, this.pos.z), DOWN, 30, 'static');
          if (g) this.pos.y = g.point.y + (this.kind === 'item' ? 0.42 : 0.02);
          if (this.beam) this.beam.visible = true;
        }
      }
      this.model.rotation.y += dt * 9;
    } else if (this.kind === 'item') {
      this.model.rotation.y += dt * 0.9;
      this.model.position.y = Math.sin(this.age * 2.2) * 0.05;
      if (this.beam) {
        this.beam.position.set(this.pos.x, this.pos.y - 0.35, this.pos.z);
        (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(this.age * 3) * 0.12;
      }
    }

    // walk-over pickups fly to the player
    if (this.kind !== 'item' && pl.alive && this.age > 0.45) {
      _v.set(pl.pos.x, pl.pos.y + 0.9, pl.pos.z).sub(this.pos);
      const d = _v.length();
      if (!this.magnet && d < 3.6 && this.useful()) this.magnet = true;
      if (this.magnet) {
        if (!this.useful()) this.magnet = false;
        else {
          this.rest = true;
          const sp = clamp(18 - d * 2, 7, 18);
          this.pos.addScaledVector(_v, Math.min(1, (sp * dt) / Math.max(d, 0.01)));
          if (d < 0.75) this.collect();
        }
      }
    }
    this.obj.position.copy(this.pos);
    // forgotten junk eventually despawns; real loot never does
    if (this.kind !== 'item' && this.age > 150) this.remove();
  }
}

/** Parcel locker: MonoMart's smart delivery lockers double as loot chests. */
export class Locker implements Interactable {
  readonly obj = new THREE.Group();
  readonly pos = new THREE.Vector3();
  private doors: THREE.Object3D[] = [];
  private open = 0;
  private opened = false;
  private led: THREE.Mesh;
  range = 3.0;
  enabled = true;
  dead = false;

  constructor(
    pos: THREE.Vector3,
    readonly yaw: number,
    readonly luck = 1,
    readonly level = 1,
  ) {
    this.pos.copy(pos).setY(pos.y + 0.95);
    const body = new Kit();
    body.box(1.5, 1.9, 0.62, PAL.smile, [0, 0.95, 0]);
    body.box(1.38, 1.76, 0.5, PAL.screen, [0, 0.95, 0.07]);
    body.box(1.56, 0.1, 0.68, PAL.screen, [0, 1.95, 0]);
    body.box(1.56, 0.08, 0.68, PAL.screen, [0, 0.04, 0]);
    body.box(0.5, 0.2, 0.05, PAL.screen, [0, 1.72, 0.33]);
    const b = new THREE.Mesh(body.geometry(), G.mat.prop);
    b.castShadow = b.receiveShadow = true;
    this.obj.add(b);
    // 2x3 doors hinged on their left edge
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 2; c++) {
        const hinge = new THREE.Group();
        hinge.position.set(-0.66 + c * 0.66, 0.2 + r * 0.5, 0.32);
        const dk = new Kit();
        dk.box(0.62, 0.46, 0.04, PAL.shell, [0.32, 0.23, 0]);
        dk.box(0.08, 0.05, 0.05, PAL.screen, [0.54, 0.23, 0.02]);
        dk.quad(0.2, 0.12, PAL.smile, [0.3, 0.3, 0.021]);
        const dm = new THREE.Mesh(dk.geometry(), G.mat.prop);
        dm.castShadow = true;
        hinge.add(dm);
        this.obj.add(hinge);
        this.doors.push(hinge);
      }
    this.led = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.02), flat(0x5dff8a));
    this.led.position.set(0, 1.72, 0.36);
    this.obj.add(this.led);
    this.obj.position.copy(pos);
    this.obj.rotation.y = yaw;
    G.scene.add(this.obj);
    G.world.add(this);
    G.world.interactables.push(this);
  }

  label() {
    return 'Open parcel locker';
  }

  onUse() {
    if (this.opened) return;
    this.opened = true;
    this.enabled = false;
    G.audio.play('chest_open', { pos: this.pos, vol: 1, ref: 6 });
    (this.led.material as THREE.MeshBasicMaterial) = flat(0x333a33);
    this.led.material = flat(0x333a33);
    G.stats.lockers++;
    G.events.emit('lockerOpened', { locker: this });
    // loot fountain a beat after the doors pop
    setTimeout(() => {
      if (this.dead) return;
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const at = this.pos.clone().addScaledVector(fwd, 0.55);
      G.loot.fountain(at, fwd, this.level, this.luck);
    }, 380);
  }

  update(dt: number) {
    if (this.opened && this.open < 1) {
      this.open = Math.min(1, this.open + dt * 2.6);
      this.doors.forEach((d, i) => {
        const t = clamp(this.open * 1.8 - i * 0.12, 0, 1);
        const e = 1 - Math.pow(1 - t, 3);
        d.rotation.y = -e * (1.7 + (i % 2) * 0.25);
      });
    }
  }
}

export class Loot {
  private rng = new Rng((Math.random() * 1e9) | 0);

  dropItem(item: Item, at: THREE.Vector3, fromPlayer = false) {
    const pos = at.clone();
    pos.y += fromPlayer ? 1.2 : 0.8;
    const v = new THREE.Vector3(rand(-1.5, 1.5), rand(3, 4.5), rand(-1.5, 1.5));
    if (fromPlayer) {
      G.player.lookDir(_v);
      v.set(_v.x * 4, 3, _v.z * 4);
    }
    const p = new Pickup('item', pos, v, { item });
    if (!fromPlayer) {
      G.audio.play(item.rarity >= 4 ? 'loot_legendary' : item.rarity >= 2 ? 'loot_rare' : 'loot_drop', { pos, vol: item.rarity >= 4 ? 1 : 0.7, ref: 8 });
      if (item.rarity >= 4) {
        G.hud.toast(`${RARITY_NAMES[4].toUpperCase()}!`, 1.6, hex(RARITY_COLORS[4]));
        G.audio.say('st_legendary_1');
      }
    }
    return p;
  }

  spawn(kind: PickupKind, at: THREE.Vector3, opts: { cls?: WeaponClass; amount?: number; pop?: boolean } = {}) {
    const pos = at.clone();
    const v = new THREE.Vector3();
    if (opts.pop !== false) {
      pos.y += 0.7;
      v.set(rand(-2.2, 2.2), rand(2.5, 4.5), rand(-2.2, 2.2));
    }
    return new Pickup(kind, pos, v, { cls: opts.cls, amount: opts.amount });
  }

  private ammoClass(): WeaponClass {
    // favour ammo for guns the player actually carries and is short on
    const inv = G.inv;
    const carried = inv.slots.filter((s) => s).map((s) => s!.cls);
    const pool = carried.length ? carried : (['pistol'] as WeaponClass[]);
    const need = pool.filter((c) => inv.needsAmmo(c));
    if (need.length && this.rng.chance(0.8)) return this.rng.weighted(need, (c) => 1.2 - inv.ammo[c] / inv.ammoMax(c));
    return this.rng.pick(CLASSES);
  }

  /**
   * Drops for a dead enemy. `tier`: 0 grunt, 1 elite, 2 boss.
   */
  enemyDrop(at: THREE.Vector3, level: number, tier: number) {
    const r = this.rng;
    const pl = G.player;
    const cashBase = Math.round((6 + level * 3) * (1 + tier * 2.5) * r.range(0.7, 1.4));
    if (r.chance(tier > 0 ? 1 : 0.55)) this.spawn('cash', at, { amount: cashBase });
    if (tier >= 2) for (let i = 0; i < 4; i++) this.spawn('cash', at, { amount: cashBase });
    if (r.chance(tier > 0 ? 0.8 : 0.36)) {
      const cls = this.ammoClass();
      this.spawn('ammo', at, { cls, amount: Math.round(CLASS_BASE[cls].ammoPickup * r.range(0.6, 1.1)) });
    }
    const hurt = 1 - pl.health / pl.maxHealth;
    if (r.chance(0.07 + hurt * 0.3 + tier * 0.25)) this.spawn('health', at, { amount: 25 + tier * 15 });
    if (r.chance(tier > 0 ? 0.3 : 0.05)) this.spawn('mine', at, { amount: 1 });
    const itemChance = [0.085, 0.34, 1][Math.min(2, tier)];
    const n = tier >= 2 ? 3 : 1;
    for (let i = 0; i < n; i++) {
      if (!r.chance(itemChance)) continue;
      const luck = tier >= 2 ? (i === 0 ? 3 : 2) : tier;
      if (r.chance(0.2)) this.dropItem(rollShield(level, { luck: Math.min(2, luck) }), at);
      else this.dropItem(rollWeapon(level + (r.chance(0.25) ? 1 : 0), { luck }), at);
    }
  }

  /** Locker contents spraying out in an arc. */
  fountain(at: THREE.Vector3, fwd: THREE.Vector3, level: number, luck: number) {
    const r = this.rng;
    const toss = (delay: number, fn: () => Pickup) =>
      setTimeout(() => {
        const p = fn();
        const side = rand(-1.4, 1.4);
        (p as any).vel.set(fwd.x * rand(2.2, 3.6) + fwd.z * side, rand(3.6, 5.2), fwd.z * rand(2.2, 3.6) - fwd.x * side);
        G.audio.play('loot_drop', { pos: at, vol: 0.6, pitchVar: 0.1, ref: 6 });
      }, delay);
    let d = 0;
    const items = luck >= 2 ? 3 : 2;
    for (let i = 0; i < items; i++) {
      toss((d += 130), () => {
        const item: Item = i === items - 1 && r.chance(0.5) ? rollShield(level, { luck: Math.min(2, luck) }) : rollWeapon(level, { luck: i === 0 ? luck : Math.max(0, luck - 1) });
        return this.dropItem(item, at.clone().setY(at.y - 0.6));
      });
    }
    for (let i = 0; i < 2; i++) toss((d += 110), () => this.spawn('ammo', at, { cls: this.ammoClass(), amount: Math.round(CLASS_BASE[this.ammoClass()].ammoPickup * 0.9), pop: false }));
    toss((d += 110), () => this.spawn('cash', at, { amount: Math.round((25 + level * 8) * r.range(0.8, 1.5)), pop: false }));
    if (r.chance(0.6)) toss((d += 110), () => this.spawn('mine', at, { amount: 1, pop: false }));
    if (r.chance(0.5)) toss((d += 110), () => this.spawn('health', at, { amount: 30, pop: false }));
  }

  /** Scale helper for scripted rewards. */
  static damageScale = levelScale;
}

export { damp };
