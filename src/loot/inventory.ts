import { G } from '../core/globals';
import { CLASS_BASE, type Item, type ShieldItem, type WeaponClass, type WeaponItem } from '../weapons/items';

export class Inventory {
  slots: (WeaponItem | null)[] = [null, null, null, null];
  active = 0;
  backpack: Item[] = [];
  capacity = 18;
  shield: ShieldItem | null = null;
  ammo: Record<WeaponClass, number> = { pistol: 48, rifle: 0, shotgun: 0, sniper: 0 };
  mines = 3;
  maxMines = 6;
  cash = 0;

  get current(): WeaponItem | null {
    return this.slots[this.active];
  }

  reset() {
    this.slots = [null, null, null, null];
    this.active = 0;
    this.backpack = [];
    this.shield = null;
    this.ammo = { pistol: 48, rifle: 0, shotgun: 0, sniper: 0 };
    this.mines = 3;
    this.cash = 0;
  }

  ammoMax(cls: WeaponClass) {
    return CLASS_BASE[cls].ammoMax;
  }

  /** Returns how many rounds were actually taken. */
  addAmmo(cls: WeaponClass, n: number) {
    const max = this.ammoMax(cls);
    const before = this.ammo[cls];
    this.ammo[cls] = Math.min(max, before + n);
    return this.ammo[cls] - before;
  }

  needsAmmo(cls: WeaponClass) {
    return this.ammo[cls] < this.ammoMax(cls);
  }

  addMines(n: number) {
    const before = this.mines;
    this.mines = Math.min(this.maxMines, this.mines + n);
    return this.mines - before;
  }

  hasRoom() {
    return this.backpack.length < this.capacity;
  }

  /**
   * Take an item. Weapons go into the first empty quick slot, otherwise into the backpack.
   * `equipNow` swaps it into the active slot and returns the weapon that was displaced into the pack.
   */
  give(item: Item, equipNow = false): 'equipped' | 'stored' | 'full' {
    if (item.kind === 'shield') {
      if (!this.shield || equipNow) {
        const old = this.shield;
        this.equipShield(item);
        if (old) {
          if (this.hasRoom()) this.backpack.push(old);
          else G.loot.dropItem(old, G.player.pos, true);
        }
        return 'equipped';
      }
      if (!this.hasRoom()) return 'full';
      this.backpack.push(item);
      return 'stored';
    }
    const empty = this.slots.findIndex((s) => s === null);
    if (empty >= 0 && !equipNow) {
      this.slots[empty] = item;
      if (!this.current) this.active = empty;
      G.weapons.onInventoryChanged(empty);
      return 'equipped';
    }
    if (equipNow) {
      const old = this.slots[this.active];
      this.slots[this.active] = item;
      if (old) {
        if (this.hasRoom()) this.backpack.push(old);
        else G.loot.dropItem(old, G.player.pos, true);
      }
      G.weapons.onInventoryChanged(this.active);
      return 'equipped';
    }
    if (!this.hasRoom()) return 'full';
    this.backpack.push(item);
    return 'stored';
  }

  equipShield(item: ShieldItem) {
    this.shield = item;
    G.player.setShield(item.capacity, item.delay, item.rate, false);
  }

  /** Move a backpack item into a weapon slot (or the shield slot); whatever was there goes to the pack. */
  equipFromBackpack(item: Item, slot = this.active) {
    const i = this.backpack.indexOf(item);
    if (i < 0) return;
    this.backpack.splice(i, 1);
    if (item.kind === 'shield') {
      if (this.shield) this.backpack.push(this.shield);
      this.equipShield(item);
      return;
    }
    const old = this.slots[slot];
    this.slots[slot] = item;
    if (old) this.backpack.push(old);
    G.weapons.onInventoryChanged(slot);
  }

  /** Move an equipped weapon (or the shield) back into the pack. Returns false if the pack is full. */
  unequip(item: Item) {
    if (!this.hasRoom()) return false;
    if (item.kind === 'shield') {
      if (this.shield !== item) return false;
      this.shield = null;
      G.player.setShield(0, 3, 0);
      this.backpack.push(item);
      return true;
    }
    const s = this.slots.indexOf(item);
    if (s < 0) return false;
    this.slots[s] = null;
    this.backpack.push(item);
    G.weapons.onInventoryChanged(s);
    return true;
  }

  /** Throw an item out of the pack / a slot onto the ground. */
  drop(item: Item) {
    const i = this.backpack.indexOf(item);
    if (i >= 0) this.backpack.splice(i, 1);
    else if (item.kind === 'weapon') {
      const s = this.slots.indexOf(item);
      if (s < 0) return;
      this.slots[s] = null;
      G.weapons.onInventoryChanged(s);
    } else if (this.shield === item) {
      this.shield = null;
      G.player.setShield(0, 3, 0);
    } else return;
    G.loot.dropItem(item, G.player.pos, true);
  }

  sell(item: Item) {
    const i = this.backpack.indexOf(item);
    if (i < 0) return;
    this.backpack.splice(i, 1);
    this.cash += item.value;
  }
}
