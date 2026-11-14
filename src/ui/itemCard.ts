import { RARITY_COLORS, RARITY_NAMES, ELEMENT_COLORS } from '../render/toon';
import { BRAND_INFO, CLASS_BASE, describeParts, type Item, type ShieldItem, type WeaponItem } from '../weapons/items';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

const ELEMENT_LABEL = { none: '', fire: 'INCENDIARY', shock: 'SHOCK', acid: 'CORROSIVE' } as const;
const ELEMENT_NOTE = {
  none: '',
  fire: 'Burns. Great against exposed circuitry, weak against shields.',
  shock: 'Strips shields fast.',
  acid: 'Eats armour plate.',
} as const;

function row(label: string, value: string, cmp: number, lowerIsBetter = false) {
  let arrow = '';
  if (cmp !== 0) {
    const better = lowerIsBetter ? cmp < 0 : cmp > 0;
    arrow = `<span class="cmp ${better ? 'up' : 'down'}">${better ? '▲' : '▼'}</span>`;
  }
  return `<div class="row"><span class="k">${label}</span><span class="v">${value}${arrow}</span></div>`;
}

const sign = (a: number, b: number | undefined, eps = 0.005) => (b === undefined ? 0 : Math.abs(a - b) <= Math.abs(b) * eps ? 0 : a > b ? 1 : -1);

/** Accuracy as a friendly 0-100 number derived from the aimed/hip cones. */
export function accuracyScore(w: WeaponItem) {
  const cone = w.spreadHip * 0.6 + w.spreadAds * 0.4;
  return Math.round(Math.max(1, 100 - cone * 13));
}

export function weaponCardHTML(w: WeaponItem, cmp?: WeaponItem | null, opts: { price?: boolean; hint?: string } = {}) {
  const rc = hex(RARITY_COLORS[w.rarity]);
  const brand = BRAND_INFO[w.brand];
  const c = cmp && cmp !== w ? cmp : undefined;
  const dmg = w.pellets > 1 ? `${w.damage} <small>×${w.pellets}</small>` : String(w.damage);
  const rows = [
    row('DAMAGE', dmg, sign(w.damage * w.pellets, c ? c.damage * c.pellets : undefined)),
    row('ACCURACY', String(accuracyScore(w)), sign(accuracyScore(w), c ? accuracyScore(c) : undefined, 0.01)),
    row('FIRE RATE', w.fireRate.toFixed(1), sign(w.fireRate, c?.fireRate)),
    row('RELOAD', (w.cls === 'shotgun' ? w.reloadTime * w.magSize : w.reloadTime).toFixed(1) + 's', sign(w.cls === 'shotgun' ? w.reloadTime * w.magSize : w.reloadTime, c ? (c.cls === 'shotgun' ? c.reloadTime * c.magSize : c.reloadTime) : undefined), true),
    row('MAGAZINE', String(w.magSize), sign(w.magSize, c?.magSize)),
  ].join('');
  const el =
    w.element !== 'none'
      ? `<div class="element" style="color:${hex(ELEMENT_COLORS[w.element])}">◆ ${ELEMENT_LABEL[w.element]} <small>${Math.round(w.statusChance * 100)}% · ${Math.round(w.statusDps)}/s</small><div class="note">${ELEMENT_NOTE[w.element]}</div></div>`
      : '';
  const notes = [`${w.critMult.toFixed(1)}× critical hit damage`, w.zoom >= 2 ? `${w.zoom.toFixed(1)}× zoom` : '', ...describeParts(w)]
    .filter(Boolean)
    .map((t) => `<li>${t}</li>`)
    .join('');
  return `<div class="card r${w.rarity}" style="--rc:${rc}">
    <div class="head"><div class="name">${w.name}</div><div class="lvl">LV ${w.level}</div></div>
    <div class="sub"><span>${RARITY_NAMES[w.rarity]} ${CLASS_BASE[w.cls].label}</span><span class="brand" style="color:${hex(brand.accent)}">${brand.name}</span></div>
    <div class="rows">${rows}</div>
    ${el}
    <ul class="notes">${notes}</ul>
    ${w.flavor ? `<div class="flavor">${w.flavor}</div>` : ''}
    <div class="foot"><span class="tag">“${brand.tagline}”</span><span class="price">$${w.value}</span></div>
    ${opts.hint ? `<div class="hint">${opts.hint}</div>` : ''}
  </div>`;
}

export function shieldCardHTML(s: ShieldItem, cmp?: ShieldItem | null, opts: { hint?: string } = {}) {
  const rc = hex(RARITY_COLORS[s.rarity]);
  const brand = BRAND_INFO[s.brand];
  const c = cmp && cmp !== s ? cmp : undefined;
  const rows = [
    row('CAPACITY', String(s.capacity), sign(s.capacity, c?.capacity)),
    row('RECHARGE', s.rate + '/s', sign(s.rate, c?.rate)),
    row('DELAY', s.delay.toFixed(1) + 's', sign(s.delay, c?.delay), true),
  ].join('');
  return `<div class="card r${s.rarity}" style="--rc:${rc}">
    <div class="head"><div class="name">${s.name}</div><div class="lvl">LV ${s.level}</div></div>
    <div class="sub"><span>${RARITY_NAMES[s.rarity]} Shield</span><span class="brand" style="color:${hex(brand.accent)}">${brand.name}</span></div>
    <div class="rows">${rows}</div>
    <div class="foot"><span class="tag">“${brand.tagline}”</span><span class="price">$${s.value}</span></div>
    ${opts.hint ? `<div class="hint">${opts.hint}</div>` : ''}
  </div>`;
}

export function itemCardHTML(item: Item, cmp?: Item | null, opts: { hint?: string } = {}) {
  if (item.kind === 'weapon') return weaponCardHTML(item, cmp && cmp.kind === 'weapon' ? cmp : null, opts);
  return shieldCardHTML(item, cmp && cmp.kind === 'shield' ? cmp : null, opts);
}

export { hex };
