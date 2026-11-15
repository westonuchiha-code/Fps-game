import './menus.css';
import type { Game } from '../game';
import type { Action } from '../core/input';
import { clamp } from '../core/math';
import { RARITY_COLORS, ELEMENT_COLORS } from '../render/toon';
import { CLASSES, CLASS_BASE, type Item, type WeaponClass, type WeaponItem } from '../weapons/items';
import { hex, itemCardHTML } from './itemCard';

type SortMode = 'rarity' | 'type' | 'value';

/** Little side-on silhouettes, drawn fresh (viewBox 0 0 64 34). */
const ICONS: Record<WeaponClass | 'shield', string> = {
  pistol: 'M10 9h34v4h3v6H29l-3 12h-9l3-12H10z',
  rifle: 'M2 12h40l4-3h14v7H48v4H38l-2 9h-7l2-9H22l-5 7H8l5-9H2z',
  shotgun: 'M1 11h62v5H32v3H21l-7 10H5l7-11H1z',
  sniper: 'M0 15h64v3H41v3H30l-6 9h-8l5-9H6L0 19z M20 8h20v5H20z M24 13h3v2h-3z M33 13h3v2h-3z',
  shield: 'M32 2l21 6v10c0 8-9 13-21 16C20 31 11 26 11 18V8z',
};
const CLASS_SHORT: Record<WeaponClass, string> = { pistol: 'PISTOL', rifle: 'RIFLE', shotgun: 'SHOTGUN', sniper: 'SNIPER' };

const icon = (k: WeaponClass | 'shield', color: string) =>
  `<svg class="inv-ico" viewBox="0 0 64 34" aria-hidden="true"><path d="${ICONS[k]}" fill="${color}" stroke="#0b0b12" stroke-width="2.2" stroke-linejoin="round"/></svg>`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class InventoryScreen {
  private readonly g: Game;
  private readonly onClose: () => void;
  private readonly root: HTMLElement;
  private _open = false;
  private guard = 0;
  private focusKey = 'pack:0';
  /** the item whose card is showing (focus can move on to the action buttons) */
  private selKey = 'pack:0';
  /** slot the comparison is against while hovering / focusing an "equip to slot" button */
  private cmpSlot = -1;
  private sortMode: SortMode | null = null;
  private hold: Partial<Record<Action, number>> = {};
  private hudWasHidden = false;
  private flashSlot = -1;

  constructor(game: Game, onClose: () => void) {
    this.g = game;
    this.onClose = onClose;
    this.root = document.createElement('div');
    this.root.className = 'inv';
    game.ui.appendChild(this.root);

    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('pointerover', (e) => {
      const t = (e.target as HTMLElement).closest('[data-slotbtn]') as HTMLElement | null;
      const s = t ? +t.dataset.slotbtn! : -1;
      if (s !== this.cmpSlot) {
        this.cmpSlot = s;
        this.renderCard();
      }
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (!this._open) return;
      const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (n >= 0) this.equipTo(n);
      else if (e.code === 'KeyX' || e.code === 'Delete') this.dropSelected();
    });
    game.systems.push({ update: (dt) => this.update(dt) });
  }

  get isOpen() {
    return this._open;
  }

  open() {
    const g = this.g;
    if (!this._open) this.hudWasHidden = g.hud.root.classList.contains('hidden');
    this._open = true;
    this.guard = 2;
    this.hold = {};
    this.cmpSlot = -1;
    g.input.exitLock();
    g.hud.setVisible(false);
    // start on the first pack item, or the active weapon when the pack is empty
    if (g.inv.backpack.length) this.focusKey = this.selKey = 'pack:0';
    else this.focusKey = this.selKey = 'slot:' + g.inv.active;
    this.root.classList.add('on');
    g.audio.play('ui_select', { bus: 'ui' });
    this.render();
  }

  close() {
    if (!this._open) return;
    this._open = false;
    this.root.classList.remove('on');
    this.root.innerHTML = '';
    this.g.hud.setVisible(!this.hudWasHidden);
  }

  private requestClose() {
    this.g.audio.play('ui_back', { bus: 'ui' });
    this.close();
    this.onClose();
  }

  // ------------------------------------------------------------------ model helpers

  private itemFor(key: string): Item | null {
    const inv = this.g.inv;
    const [k, n] = key.split(':');
    if (k === 'pack') return inv.backpack[+n] ?? null;
    if (k === 'slot') return inv.slots[+n] ?? null;
    if (k === 'shield') return inv.shield;
    return null;
  }

  private get selItem() {
    return this.itemFor(this.selKey);
  }

  /** What the selected item is compared against. */
  private counterpart(item: Item): Item | null {
    const inv = this.g.inv;
    if (!this.selKey.startsWith('pack')) return null;
    if (item.kind === 'shield') return inv.shield;
    if (this.cmpSlot >= 0) return inv.slots[this.cmpSlot];
    return inv.slots.find((s) => s && s.cls === item.cls) ?? inv.current ?? inv.slots.find((s) => s) ?? null;
  }

  /** Best slot to suggest for a weapon: same class, else an empty one, else the active one. */
  private suggestSlot(w: WeaponItem) {
    const inv = this.g.inv;
    const same = inv.slots.findIndex((s) => s && s.cls === w.cls);
    if (same >= 0) return same;
    const empty = inv.slots.findIndex((s) => !s);
    return empty >= 0 ? empty : inv.active;
  }

  // ------------------------------------------------------------------ actions

  private equipTo(slot: number) {
    const it = this.selItem;
    if (!it || !this.selKey.startsWith('pack')) {
      this.g.audio.play('ui_error', { bus: 'ui' });
      return;
    }
    const idx = +this.selKey.split(':')[1];
    this.g.inv.equipFromBackpack(it, it.kind === 'shield' ? undefined : slot);
    this.g.audio.play('ui_equip', { bus: 'ui' });
    this.flashSlot = it.kind === 'shield' ? 4 : slot;
    this.sortMode = null;
    const n = this.g.inv.backpack.length;
    this.focusKey = this.selKey = n ? 'pack:' + clamp(idx, 0, n - 1) : it.kind === 'shield' ? 'shield:0' : 'slot:' + slot;
    this.cmpSlot = -1;
    this.render();
  }

  private dropSelected() {
    const it = this.selItem;
    if (!it) {
      this.g.audio.play('ui_error', { bus: 'ui' });
      return;
    }
    const key = this.selKey;
    this.g.inv.drop(it);
    this.g.audio.play('ui_back', { bus: 'ui' });
    if (key.startsWith('pack')) {
      const n = this.g.inv.backpack.length;
      this.focusKey = this.selKey = n ? 'pack:' + clamp(+key.split(':')[1], 0, n - 1) : 'slot:' + this.g.inv.active;
    } else this.focusKey = this.selKey = key;
    this.cmpSlot = -1;
    this.render();
  }

  private sort(mode: SortMode) {
    const order = (i: Item) => (i.kind === 'shield' ? CLASSES.length : CLASSES.indexOf(i.cls));
    const by: Record<SortMode, (a: Item, b: Item) => number> = {
      rarity: (a, b) => b.rarity - a.rarity || b.level - a.level || b.value - a.value,
      type: (a, b) => order(a) - order(b) || b.rarity - a.rarity || b.value - a.value,
      value: (a, b) => b.value - a.value,
    };
    const sel = this.selItem;
    this.g.inv.backpack.sort(by[mode]);
    this.sortMode = mode;
    if (sel && this.selKey.startsWith('pack')) {
      const i = this.g.inv.backpack.indexOf(sel);
      this.selKey = 'pack:' + Math.max(0, i);
      if (this.focusKey.startsWith('pack')) this.focusKey = this.selKey;
    }
    this.g.audio.play('ui_select', { bus: 'ui' });
    this.render();
  }

  private activate(el: HTMLElement) {
    const key = el.dataset.nav!;
    const [k, n] = key.split(':');
    if (k === 'pack' || k === 'slot' || k === 'shield') {
      const it = this.itemFor(key);
      const changed = this.selKey !== key;
      this.selKey = this.focusKey = key;
      this.cmpSlot = -1;
      if (!changed && it && k === 'pack') {
        // second press on an item: jump to its first action
        this.focusKey = it.kind === 'weapon' ? 'act:eq' + this.suggestSlot(it) : 'act:eqs';
        if (it.kind === 'weapon') this.cmpSlot = this.suggestSlot(it);
      } else if (!changed && it) this.focusKey = 'act:drop';
      this.g.audio.play(changed ? 'ui_move' : 'ui_select', { bus: 'ui' });
      this.render();
      return;
    }
    if (k === 'act') {
      if (n.startsWith('eq') && n !== 'eqs') this.equipTo(+n.slice(2));
      else if (n === 'eqs') this.equipTo(0);
      else if (n === 'drop') this.dropSelected();
      return;
    }
    if (k === 'sort') this.sort(n as SortMode);
    if (k === 'close') this.requestClose();
  }

  private onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest('[data-nav]') as HTMLElement | null;
    if (!el || !this._open) return;
    e.stopPropagation();
    this.activate(el);
  }

  // ------------------------------------------------------------------ input

  private update(dt: number) {
    if (!this._open) return;
    if (this.guard > 0) {
      this.guard--;
      return;
    }
    const inp = this.g.input;
    const rep = (a: Action) => {
      if (inp.pressed(a)) {
        this.hold[a] = 0;
        return true;
      }
      if (inp.isDown(a)) {
        const h = (this.hold[a] ?? 0) + dt;
        this.hold[a] = h;
        if (h > 0.42) {
          this.hold[a] = 0.31;
          return true;
        }
      } else delete this.hold[a];
      return false;
    };
    if (rep('uiUp')) this.move(0, -1);
    if (rep('uiDown')) this.move(0, 1);
    if (rep('uiLeft')) this.move(-1, 0);
    if (rep('uiRight')) this.move(1, 0);
    if (inp.pressed('inventory')) return this.requestClose();
    if (inp.pressed('uiAccept')) {
      const el = this.root.querySelector(`[data-nav="${this.focusKey}"]`) as HTMLElement | null;
      if (el) this.activate(el);
    } else if (inp.pressed('uiBack') || inp.pressed('pause')) {
      if (this.focusKey.startsWith('act')) {
        this.focusKey = this.selKey;
        this.cmpSlot = -1;
        this.g.audio.play('ui_back', { bus: 'ui' });
        this.render();
      } else this.requestClose();
    }
  }

  /** Spatial navigation between everything tagged data-nav. */
  private move(dx: number, dy: number) {
    const els = [...this.root.querySelectorAll('[data-nav]')] as HTMLElement[];
    const cur = els.find((e) => e.dataset.nav === this.focusKey) ?? els[0];
    if (!cur) return;
    const r0 = cur.getBoundingClientRect();
    const cx = r0.left + r0.width / 2;
    const cy = r0.top + r0.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const e of els) {
      if (e === cur) continue;
      const r = e.getBoundingClientRect();
      const ex = r.left + r.width / 2;
      const ey = r.top + r.height / 2;
      const along = (ex - cx) * dx + (ey - cy) * dy;
      if (along <= 4) continue;
      // distance between edges on the cross axis (0 when the boxes overlap on it)
      const cross = dx ? Math.max(0, Math.max(r.top, r0.top) - Math.min(r.bottom, r0.bottom)) : Math.max(0, Math.max(r.left, r0.left) - Math.min(r.right, r0.right));
      const perp = Math.abs(dx ? ey - cy : ex - cx);
      // stay inside a cone around the direction pressed
      if (cross > 0 && perp > along * 2) continue;
      const score = along + cross * 3 + perp * 0.3;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (!best) return;
    const key = best.dataset.nav!;
    this.focusKey = key;
    const k = key.split(':')[0];
    if (k === 'pack' || k === 'slot' || k === 'shield') {
      this.selKey = key;
      this.cmpSlot = -1;
    } else if (key.startsWith('act:eq') && key !== 'act:eqs') this.cmpSlot = +key.slice(6);
    else this.cmpSlot = -1;
    this.g.audio.play('ui_move', { bus: 'ui' });
    this.render();
  }

  // ------------------------------------------------------------------ DOM

  private cellHTML(it: Item | null, key: string, extra = '') {
    const cls = ['inv-cell', extra, this.focusKey === key ? 'focus' : '', this.selKey === key ? 'sel' : '', it ? 'r' + it.rarity : 'empty'].join(' ');
    if (!it) return `<button class="${cls}" data-nav="${key}"></button>`;
    const rc = hex(RARITY_COLORS[it.rarity]);
    const el = it.kind === 'weapon' && it.element !== 'none' ? `<i class="inv-el" style="background:${hex(ELEMENT_COLORS[it.element])}"></i>` : '';
    return `<button class="${cls}" data-nav="${key}" style="--rc:${rc}" title="${esc(it.name)}">${icon(it.kind === 'shield' ? 'shield' : it.cls, rc)}<span class="inv-lv">${it.level}</span>${el}</button>`;
  }

  private slotHTML(i: number) {
    const inv = this.g.inv;
    const w = inv.slots[i];
    const key = 'slot:' + i;
    const rc = w ? hex(RARITY_COLORS[w.rarity]) : '#666';
    const cls = ['inv-slot', this.focusKey === key ? 'focus' : '', this.selKey === key ? 'sel' : '', i === inv.active ? 'active' : '', this.flashSlot === i ? 'flash' : '', w ? '' : 'empty'].join(' ');
    return `<button class="${cls}" data-nav="${key}" style="--rc:${rc}"><span class="key">${i + 1}</span>${
      w ? `${icon(w.cls, rc)}<span class="inv-sn"><b>${esc(w.name)}</b><small>${CLASS_SHORT[w.cls]} · LV ${w.level}</small></span>` : '<span class="inv-sn"><small>EMPTY</small></span>'
    }</button>`;
  }

  private render() {
    if (!this._open) return;
    const g = this.g;
    const inv = g.inv;
    const sh = inv.shield;
    const shKey = 'shield:0';
    const shRc = sh ? hex(RARITY_COLORS[sh.rarity]) : '#666';
    const shCls = ['inv-slot', 'shield', this.focusKey === shKey ? 'focus' : '', this.selKey === shKey ? 'sel' : '', this.flashSlot === 4 ? 'flash' : '', sh ? '' : 'empty'].join(' ');
    const cells: string[] = [];
    for (let i = 0; i < Math.max(inv.capacity, inv.backpack.length); i++) cells.push(this.cellHTML(inv.backpack[i] ?? null, i < inv.backpack.length ? 'pack:' + i : 'emptycell', ''));
    const sortBtn = (m: SortMode, label: string) => `<button class="inv-btn small ${this.sortMode === m ? 'on' : ''} ${this.focusKey === 'sort:' + m ? 'focus' : ''}" data-nav="sort:${m}">${label}</button>`;
    const ammo = CLASSES.map((c) => {
      const v = inv.ammo[c];
      const max = inv.ammoMax(c);
      return `<div class="inv-ammo"><span>${CLASS_BASE[c].label.toUpperCase()}</span><b>${v}<small>/${max}</small></b><i><em style="width:${Math.round((v / max) * 100)}%"></em></i></div>`;
    }).join('');

    this.root.innerHTML = `
      <div class="inv-top">
        <div class="inv-title">BACKPACK</div>
        <div class="inv-cash">$${inv.cash.toLocaleString('en-US')}</div>
        <div class="inv-sort"><span>SORT</span>${sortBtn('rarity', 'RARITY')}${sortBtn('type', 'TYPE')}${sortBtn('value', 'VALUE')}</div>
        <button class="inv-btn close ${this.focusKey === 'close:0' ? 'focus' : ''}" data-nav="close:0">✕</button>
      </div>
      <div class="inv-body">
        <div class="inv-col inv-eq">
          <div class="inv-h">EQUIPPED</div>
          ${[0, 1, 2, 3].map((i) => this.slotHTML(i)).join('')}
          <button class="${shCls}" data-nav="${shKey}" style="--rc:${shRc}"><span class="key">S</span>${
            sh ? `${icon('shield', shRc)}<span class="inv-sn"><b>${esc(sh.name)}</b><small>SHIELD · ${sh.capacity}</small></span>` : '<span class="inv-sn"><small>NO SHIELD</small></span>'
          }</button>
        </div>
        <div class="inv-col inv-packcol">
          <div class="inv-h">PACK <span class="${inv.backpack.length >= inv.capacity ? 'full' : ''}">${inv.backpack.length}/${inv.capacity}</span></div>
          <div class="inv-grid">${cells.join('')}</div>
        </div>
        <div class="inv-col inv-detail"><div class="inv-cardwrap"></div><div class="inv-actions"></div></div>
      </div>
      <div class="inv-foot">${ammo}<div class="inv-ammo mines"><span>MINES</span><b>${inv.mines}<small>/${inv.maxMines}</small></b></div></div>
      <div class="inv-hints"></div>`;
    // empty cells are decoration, not navigation targets
    this.root.querySelectorAll('[data-nav="emptycell"]').forEach((e) => e.removeAttribute('data-nav'));
    this.renderCard();
    this.flashSlot = -1;
  }

  /** Scale the item card so card + actions fit the column at any screen size. */
  private fitCard(wrap: HTMLElement, acts: HTMLElement) {
    const col = wrap.parentElement as HTMLElement;
    const maxW = Math.max(230, Math.min(300, window.innerWidth * 0.36));
    // the action row needs ~250px whatever the card scale is
    col.style.width = Math.round(Math.min(maxW, 290)) + 'px';
    wrap.style.zoom = '1';
    const natural = wrap.offsetHeight || 1;
    const avail = col.clientHeight - acts.offsetHeight - 8;
    const z = clamp(Math.min(avail / natural, maxW / 290), 0.55, 1);
    wrap.style.zoom = z.toFixed(3);
    col.style.width = Math.round(Math.max(290 * z, Math.min(maxW, 250))) + 'px';
  }

  private renderCard() {
    const wrap = this.root.querySelector('.inv-cardwrap') as HTMLElement | null;
    const acts = this.root.querySelector('.inv-actions') as HTMLElement | null;
    const hints = this.root.querySelector('.inv-hints') as HTMLElement | null;
    if (!wrap || !acts || !hints) return;
    const it = this.selItem;
    const inPack = this.selKey.startsWith('pack');
    const f = (k: string) => (this.focusKey === k ? ' focus' : '');
    if (!it) {
      wrap.innerHTML = `<div class="inv-emptycard">${this.selKey.startsWith('shield') ? 'No shield equipped.' : 'Empty slot.'}<br><small>Pick something from the pack.</small></div>`;
      acts.innerHTML = '';
    } else {
      const cmp = this.counterpart(it);
      wrap.innerHTML = itemCardHTML(it, cmp) + (cmp && inPack ? `<div class="inv-vs">vs. ${esc(cmp.name)}</div>` : '');
      if (inPack && it.kind === 'weapon') {
        const best = this.suggestSlot(it);
        acts.innerHTML =
          `<span class="inv-al">EQUIP</span>` +
          [0, 1, 2, 3]
            .map((s) => {
              const o = this.g.inv.slots[s];
              return `<button class="inv-btn slotb${f('act:eq' + s)}${s === best ? ' best' : ''}" data-nav="act:eq${s}" data-slotbtn="${s}" title="${o ? esc(o.name) : 'empty'}">${s + 1}<small>${o ? CLASS_SHORT[o.cls].slice(0, 3) : '—'}</small></button>`;
            })
            .join('') +
          `<button class="inv-btn drop${f('act:drop')}" data-nav="act:drop">DROP</button>`;
      } else if (inPack) {
        acts.innerHTML = `<button class="inv-btn${f('act:eqs')}" data-nav="act:eqs">EQUIP</button><button class="inv-btn drop${f('act:drop')}" data-nav="act:drop">DROP</button>`;
      } else {
        acts.innerHTML = `<button class="inv-btn drop${f('act:drop')}" data-nav="act:drop">DROP</button>`;
      }
    }
    this.fitCard(wrap, acts);
    const dev = this.g.input.device;
    const k = (t: string) => `<span class="key">${t}</span>`;
    hints.innerHTML =
      dev === 'gamepad'
        ? `${k('D-PAD')} MOVE ${k('A')} SELECT ${k('B')} BACK`
        : `${k('↑↓◂▸')} MOVE ${k('ENTER')} SELECT ${k('1')}–${k('4')} EQUIP TO SLOT ${k('X')} DROP ${k('TAB')} CLOSE`;
  }
}
