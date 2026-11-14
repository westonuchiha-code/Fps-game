import { Rng, clamp } from '../core/math';
import type { Element } from '../core/types';

export type WeaponClass = 'pistol' | 'rifle' | 'shotgun' | 'sniper';
export type Brand = 'valu' | 'krona' | 'picket' | 'zapp';
export type Rarity = 0 | 1 | 2 | 3 | 4;
export type LegendFx = 'double' | 'ricochet' | 'explosive' | 'refund' | 'tag';

export const CLASSES: WeaponClass[] = ['pistol', 'rifle', 'shotgun', 'sniper'];
export const BRANDS: Brand[] = ['valu', 'krona', 'picket', 'zapp'];

export interface WeaponParts {
  /** 0 standard, 1 long, 2 short, 3 heavy */
  barrel: number;
  /** 0 standard, 1 extended, 2 quick */
  mag: number;
  /** 0 light, 1 standard, 2 heavy */
  stock: number;
  /** 0 irons, 1 reflex dot, 2 scope */
  sight: number;
  /** 0 none, 1 laser, 2 bayonet, 3 compensator */
  acc: number;
}

export interface WeaponItem {
  kind: 'weapon';
  uid: number;
  seed: number;
  cls: WeaponClass;
  brand: Brand;
  rarity: Rarity;
  level: number;
  element: Element;
  name: string;
  flavor: string;
  legend: LegendFx | null;
  parts: WeaponParts;
  // --- derived stats ---
  damage: number;
  pellets: number;
  /** shots per second */
  fireRate: number;
  auto: boolean;
  magSize: number;
  /** seconds for a full tactical reload (shotguns: per shell) */
  reloadTime: number;
  /** degrees of cone half-angle from the hip / aimed */
  spreadHip: number;
  spreadAds: number;
  /** per-shot view kick in degrees */
  recoil: number;
  critMult: number;
  zoom: number;
  /** seconds to aim down sights */
  adsTime: number;
  statusChance: number;
  statusDps: number;
  /** damage falloff: full damage until `rangeNear`, `rangeMin` multiplier at `rangeFar` */
  rangeNear: number;
  rangeFar: number;
  rangeMin: number;
  meleeBonus: number;
  value: number;
  // --- runtime ---
  ammo: number;
}

export interface ShieldItem {
  kind: 'shield';
  uid: number;
  seed: number;
  brand: Brand;
  rarity: Rarity;
  level: number;
  name: string;
  flavor: string;
  capacity: number;
  /** seconds without damage before recharge starts */
  delay: number;
  /** points per second */
  rate: number;
  value: number;
}

export type Item = WeaponItem | ShieldItem;

export const BRAND_INFO: Record<Brand, { name: string; tagline: string; color: number; dark: number; accent: number }> = {
  valu: { name: 'VALU-ARMS', tagline: 'Everyday low recoil.', color: 0xf2ecd9, dark: 0x8b8672, accent: 0xffd21f },
  krona: { name: 'KRONA', tagline: 'Some assembly required.', color: 0x39424e, dark: 0x1d222a, accent: 0x49c7c1 },
  picket: { name: 'PICKET', tagline: 'Union made. Union maintained.', color: 0x8e4a32, dark: 0x4a3526, accent: 0xff7a1a },
  zapp: { name: 'ZAPP!', tagline: 'Now with 30% more ouch.', color: 0xe8eef2, dark: 0x3b5b8c, accent: 0x53c7ff },
};

interface ClassBase {
  label: string;
  damage: number;
  pellets: number;
  fireRate: number;
  auto: boolean;
  mag: number;
  reload: number;
  spreadHip: number;
  spreadAds: number;
  recoil: number;
  crit: number;
  zoom: number;
  ads: number;
  rangeNear: number;
  rangeFar: number;
  rangeMin: number;
  ammoMax: number;
  ammoPickup: number;
}

export const CLASS_BASE: Record<WeaponClass, ClassBase> = {
  pistol: { label: 'Pistol', damage: 15, pellets: 1, fireRate: 5.2, auto: false, mag: 12, reload: 1.45, spreadHip: 1.5, spreadAds: 0.35, recoil: 1.5, crit: 2.0, zoom: 1.25, ads: 0.16, rangeNear: 22, rangeFar: 55, rangeMin: 0.55, ammoMax: 180, ammoPickup: 24 },
  rifle: { label: 'Auto Rifle', damage: 10, pellets: 1, fireRate: 9.2, auto: true, mag: 28, reload: 2.1, spreadHip: 2.3, spreadAds: 0.5, recoil: 0.95, crit: 2.0, zoom: 1.4, ads: 0.21, rangeNear: 32, rangeFar: 80, rangeMin: 0.6, ammoMax: 360, ammoPickup: 45 },
  shotgun: { label: 'Shotgun', damage: 8, pellets: 9, fireRate: 1.2, auto: false, mag: 6, reload: 0.52, spreadHip: 4.6, spreadAds: 3.6, recoil: 4.6, crit: 1.6, zoom: 1.15, ads: 0.2, rangeNear: 9, rangeFar: 26, rangeMin: 0.25, ammoMax: 60, ammoPickup: 10 },
  sniper: { label: 'Sniper', damage: 70, pellets: 1, fireRate: 0.95, auto: false, mag: 5, reload: 2.5, spreadHip: 4.5, spreadAds: 0.03, recoil: 5.2, crit: 2.6, zoom: 4.0, ads: 0.3, rangeNear: 200, rangeFar: 400, rangeMin: 1, ammoMax: 40, ammoPickup: 8 },
};

interface BrandMod {
  damage: number;
  fireRate: number;
  mag: number;
  reload: number;
  spread: number;
  recoil: number;
  crit: number;
  elementChance: number;
}
const BRAND_MOD: Record<Brand, BrandMod> = {
  valu: { damage: 0.88, fireRate: 1.0, mag: 1.4, reload: 0.82, spread: 1.12, recoil: 0.95, crit: 0, elementChance: 0 },
  krona: { damage: 1.08, fireRate: 0.88, mag: 1.0, reload: 1.0, spread: 0.68, recoil: 0.85, crit: 0.35, elementChance: 0 },
  picket: { damage: 1.28, fireRate: 0.86, mag: 0.85, reload: 1.1, spread: 1.0, recoil: 1.35, crit: 0, elementChance: 0 },
  zapp: { damage: 0.9, fireRate: 1.08, mag: 1.0, reload: 1.0, spread: 1.0, recoil: 0.9, crit: 0, elementChance: 1 },
};

const BASE_NAMES: Record<Brand, Record<WeaponClass, string>> = {
  valu: { pistol: 'Price Gun', rifle: 'Stock Boy', shotgun: 'Rollback', sniper: 'Rain Check' },
  krona: { pistol: 'Smäll', rifle: 'Bråk', shotgun: 'Dunder', sniper: 'Tyst' },
  picket: { pistol: 'Steward', rifle: 'Wildcat', shotgun: 'Lockout', sniper: 'Grievance' },
  zapp: { pistol: 'Zinger', rifle: 'Buzzkill', shotgun: 'Blowout', sniper: 'Flashpoint' },
};

const ELEMENT_PREFIX: Record<Element, string> = { none: '', fire: 'Incendiary', shock: 'Shock', acid: 'Corrosive' };
const RARITY_DMG = [1, 1.09, 1.18, 1.29, 1.42];
const RARITY_ELEMENT = [0.05, 0.12, 0.22, 0.34, 0.45];

interface LegendDef {
  cls: WeaponClass;
  brand: Brand;
  name: string;
  flavor: string;
  fx: LegendFx;
  element?: Element;
}
export const LEGENDS: LegendDef[] = [
  { cls: 'pistol', brand: 'valu', name: 'Loss Leader', flavor: 'Priced below cost.', fx: 'double' },
  { cls: 'rifle', brand: 'picket', name: 'Collective Bargainer', flavor: 'An injury to one is an injury to all.', fx: 'ricochet' },
  { cls: 'shotgun', brand: 'valu', name: 'Doorbuster', flavor: 'Limit one per customer.', fx: 'explosive' },
  { cls: 'sniper', brand: 'krona', name: 'Final Notice', flavor: 'This is your last reminder.', fx: 'refund' },
  { cls: 'pistol', brand: 'zapp', name: 'Price Check', flavor: 'Beep.', fx: 'tag', element: 'shock' },
];

/** Borderlands-style exponential level scaling. */
export const levelScale = (level: number) => Math.pow(1.13, level - 1);

let uidCounter = 1;

export interface RollOpts {
  cls?: WeaponClass;
  brand?: Brand;
  rarity?: Rarity;
  element?: Element;
  /** shift the rarity roll: 0 = normal, 1 = chest, 2 = boss */
  luck?: number;
  seed?: number;
  legend?: string;
}

export function rollRarity(r: Rng, luck = 0): Rarity {
  // weights: common, uncommon, rare, epic, legendary
  const w = [
    [62, 26, 9, 2.6, 0.4],
    [30, 38, 22, 8.5, 1.5],
    [0, 18, 44, 30, 8],
    [0, 0, 20, 50, 30],
  ][clamp(Math.round(luck), 0, 3)];
  let x = r.next() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 5; i++) {
    x -= w[i];
    if (x <= 0) return i as Rarity;
  }
  return 0;
}

export function rollWeapon(level: number, o: RollOpts = {}): WeaponItem {
  const seed = o.seed ?? (Math.random() * 2 ** 31) | 0;
  const r = new Rng(seed);
  let rarity = o.rarity ?? rollRarity(r, o.luck ?? 0);
  let cls = o.cls ?? r.weighted(CLASSES, (c) => (c === 'sniper' ? 0.7 : c === 'shotgun' ? 0.9 : 1.2));
  let brand = o.brand ?? r.pick(BRANDS);
  let legendDef: LegendDef | null = null;
  if (rarity === 4) {
    const pool = LEGENDS.filter((l) => (o.legend ? l.name === o.legend : (!o.cls || l.cls === o.cls) && (!o.brand || l.brand === o.brand)));
    if (pool.length) {
      legendDef = r.pick(pool);
      cls = legendDef.cls;
      brand = legendDef.brand;
    } else rarity = 3;
  }
  const base = CLASS_BASE[cls];
  const bm = BRAND_MOD[brand];

  // --- parts: better rarity = more non-standard parts ---
  const partBudget = [0, 1, 2, 3, 4][rarity];
  const parts: WeaponParts = { barrel: 0, mag: 0, stock: 1, sight: 0, acc: 0 };
  const slots: (keyof WeaponParts)[] = ['barrel', 'mag', 'stock', 'sight', 'acc'];
  const chosen = new Set<keyof WeaponParts>();
  for (let i = 0; i < partBudget; i++) {
    const s = r.pick(slots.filter((x) => !chosen.has(x)));
    chosen.add(s);
    if (s === 'barrel') parts.barrel = r.int(1, 3);
    else if (s === 'mag') parts.mag = r.int(1, 2);
    else if (s === 'stock') parts.stock = r.pick([0, 2]);
    else if (s === 'sight') parts.sight = cls === 'pistol' || cls === 'shotgun' ? 1 : r.int(1, 2);
    else parts.acc = r.int(1, 3);
  }
  if (cls === 'sniper') parts.sight = Math.max(1, parts.sight); // snipers always carry glass
  if (rarity === 0 && r.chance(0.35)) parts.stock = 0;

  // --- element ---
  let element: Element = o.element ?? 'none';
  if (!o.element) {
    const chance = Math.max(bm.elementChance, RARITY_ELEMENT[rarity]);
    if (r.chance(chance)) element = r.pick(['fire', 'shock', 'acid'] as Element[]);
  }
  if (legendDef?.element) element = legendDef.element;

  // --- stats ---
  const ls = levelScale(level);
  let damage = base.damage * bm.damage * RARITY_DMG[rarity] * ls;
  let fireRate = base.fireRate * bm.fireRate;
  let mag = base.mag * bm.mag;
  let reload = base.reload * bm.reload;
  let spreadHip = base.spreadHip * bm.spread;
  let spreadAds = base.spreadAds * bm.spread;
  let recoil = base.recoil * bm.recoil;
  let crit = base.crit + bm.crit;
  let zoom = base.zoom;
  let ads = base.ads;
  let rangeNear = base.rangeNear;
  let rangeFar = base.rangeFar;
  let meleeBonus = 0;

  switch (parts.barrel) {
    case 1: // long
      damage *= 1.07;
      spreadHip *= 0.82;
      spreadAds *= 0.8;
      rangeNear *= 1.3;
      rangeFar *= 1.3;
      ads *= 1.12;
      break;
    case 2: // short
      fireRate *= 1.1;
      spreadHip *= 1.15;
      ads *= 0.85;
      rangeNear *= 0.85;
      break;
    case 3: // heavy
      recoil *= 0.75;
      damage *= 1.03;
      ads *= 1.08;
      break;
  }
  switch (parts.mag) {
    case 1:
      mag *= 1.38;
      reload *= 1.08;
      break;
    case 2:
      mag *= 0.9;
      reload *= 0.8;
      break;
  }
  switch (parts.stock) {
    case 0:
      ads *= 0.85;
      recoil *= 1.15;
      break;
    case 2:
      recoil *= 0.78;
      spreadHip *= 0.9;
      ads *= 1.1;
      break;
  }
  if (cls === 'sniper') zoom = parts.sight === 2 ? 6.5 : 4.0;
  else if (parts.sight === 1) zoom = Math.max(zoom, cls === 'pistol' ? 1.4 : cls === 'shotgun' ? 1.3 : 1.7);
  else if (parts.sight === 2) zoom = 2.6;
  if (parts.sight > 0) spreadAds *= 0.85;
  switch (parts.acc) {
    case 1:
      spreadHip *= 0.7;
      break;
    case 2:
      meleeBonus = 1;
      break;
    case 3:
      recoil *= 0.82;
      break;
  }
  if (element !== 'none') damage *= 0.88;

  // small per-item variance so two of the "same" gun are never identical
  damage *= r.range(0.95, 1.06);
  fireRate *= r.range(0.97, 1.04);

  let pellets = base.pellets;
  if (legendDef?.fx === 'double') {
    pellets = 2;
    damage *= 0.72;
    spreadHip *= 1.2;
  }

  const magSize = Math.max(cls === 'shotgun' ? 3 : cls === 'sniper' ? 3 : 6, Math.round(mag));
  const statusChance = element === 'none' ? 0 : clamp((cls === 'shotgun' ? 0.09 : cls === 'sniper' ? 0.65 : cls === 'pistol' ? 0.3 : 0.16) * (brand === 'zapp' ? 1.5 : 1), 0, 0.95);
  const dps = damage * pellets * fireRate;
  const statusDps = element === 'none' ? 0 : dps * (element === 'shock' ? 0.22 : 0.3);

  // --- name ---
  let name: string;
  let flavor = '';
  if (legendDef) {
    name = legendDef.name;
    flavor = legendDef.flavor;
  } else {
    const prefixes: string[] = [];
    if (element !== 'none') prefixes.push(ELEMENT_PREFIX[element]);
    else if (parts.barrel === 1) prefixes.push('Longshot');
    else if (parts.mag === 1) prefixes.push('Bulk');
    else if (parts.mag === 2) prefixes.push('Express');
    else if (parts.acc === 1) prefixes.push('Pinpoint');
    else if (parts.acc === 2) prefixes.push('Pointy');
    else if (parts.acc === 3) prefixes.push('Tamed');
    else if (parts.stock === 2) prefixes.push('Steady');
    else if (parts.barrel === 2) prefixes.push('Snub');
    else if (parts.barrel === 3) prefixes.push('Heavy');
    else if (parts.sight === 2) prefixes.push('Scoped');
    name = (prefixes.length ? prefixes[0] + ' ' : '') + BASE_NAMES[brand][cls];
  }

  const value = Math.round((14 + dps * 0.35) * [1, 1.6, 2.6, 4.5, 9][rarity] * (0.9 + r.next() * 0.2));

  return {
    kind: 'weapon',
    uid: uidCounter++,
    seed,
    cls,
    brand,
    rarity,
    level,
    element,
    name,
    flavor,
    legend: legendDef?.fx ?? null,
    parts,
    damage: Math.max(1, Math.round(damage)),
    pellets,
    fireRate: +fireRate.toFixed(2),
    auto: base.auto,
    magSize,
    reloadTime: +reload.toFixed(2),
    spreadHip,
    spreadAds,
    recoil,
    critMult: +crit.toFixed(2),
    zoom,
    adsTime: ads,
    statusChance,
    statusDps,
    rangeNear,
    rangeFar,
    rangeMin: base.rangeMin,
    meleeBonus,
    value,
    ammo: magSize,
  };
}

const SHIELD_NAMES: Record<Brand, string> = { valu: 'Loyalty Card', krona: 'Skärm', picket: 'Hard Hat', zapp: 'Surge Protector' };

export function rollShield(level: number, o: { rarity?: Rarity; brand?: Brand; luck?: number; seed?: number } = {}): ShieldItem {
  const seed = o.seed ?? (Math.random() * 2 ** 31) | 0;
  const r = new Rng(seed);
  const rarity = Math.min(3, o.rarity ?? rollRarity(r, o.luck ?? 0)) as Rarity;
  const brand = o.brand ?? r.pick(BRANDS);
  const ls = levelScale(level);
  // each brand trades capacity against recharge behaviour
  const prof = {
    valu: { cap: 1.25, delay: 1.2, rate: 0.85 },
    krona: { cap: 0.85, delay: 0.6, rate: 1.5 },
    picket: { cap: 1.5, delay: 1.5, rate: 0.7 },
    zapp: { cap: 1.0, delay: 0.85, rate: 1.15 },
  }[brand];
  const rm = [1, 1.12, 1.26, 1.42, 1.6][rarity];
  const capacity = Math.round(55 * prof.cap * rm * ls * r.range(0.94, 1.06));
  const delay = +(3.2 * prof.delay * r.range(0.92, 1.08)).toFixed(2);
  const rate = Math.round(22 * prof.rate * rm * ls * r.range(0.94, 1.06));
  const adj = ['', 'Reinforced ', 'Deluxe ', 'Executive ', 'Founder’s '][rarity];
  return {
    kind: 'shield',
    uid: uidCounter++,
    seed,
    brand,
    rarity,
    level,
    name: adj + SHIELD_NAMES[brand],
    flavor: '',
    capacity,
    delay,
    rate,
    value: Math.round((20 + capacity * 0.4) * [1, 1.6, 2.6, 4.5, 9][rarity]),
  };
}

/** Rough single-number score used for "is this better?" arrows and AI-free auto-equip. */
export function weaponScore(w: WeaponItem) {
  const dps = w.damage * w.pellets * w.fireRate;
  const sustain = (w.magSize / w.fireRate) / (w.magSize / w.fireRate + (w.cls === 'shotgun' ? w.reloadTime * w.magSize : w.reloadTime));
  return dps * (0.55 + 0.45 * sustain) * (1 + (w.element !== 'none' ? 0.12 : 0)) * (1 + (w.critMult - 2) * 0.1);
}

export function describeParts(w: WeaponItem): string[] {
  const out: string[] = [];
  const p = w.parts;
  if (p.barrel === 1) out.push('Long barrel: +range, +accuracy');
  if (p.barrel === 2) out.push('Snub barrel: +fire rate, quick aim');
  if (p.barrel === 3) out.push('Heavy barrel: -recoil');
  if (p.mag === 1) out.push('Bulk magazine: +38% capacity');
  if (p.mag === 2) out.push('Express magazine: -20% reload time');
  if (p.stock === 0) out.push('No stock: quick aim, +recoil');
  if (p.stock === 2) out.push('Braced stock: -recoil');
  if (p.acc === 1) out.push('Laser: tighter hip fire');
  if (p.acc === 2) out.push('Bayonet: +100% melee damage');
  if (p.acc === 3) out.push('Compensator: -recoil');
  if (w.legend === 'double') out.push('Fires two rounds per shot. Sometimes they are free.');
  if (w.legend === 'ricochet') out.push('Rounds jump to a second target.');
  if (w.legend === 'explosive') out.push('Pellets explode on impact.');
  if (w.legend === 'refund') out.push('Kills refund the round. Critical hits hurt more.');
  if (w.legend === 'tag') out.push('Tagged targets take +30% damage from everything.');
  return out;
}
