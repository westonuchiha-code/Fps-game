// Outliner: every object in the level as a searchable list, with show/hide and lock toggles.
import type { LObject } from '../world/leveldata';
import { SPAWN_ID, SPAWN_INFO, TYPE_INFO, displayName, typeInfo } from './defs';
import type { Doc } from './state';
import { h } from './ui';

const svg = (body: string) => `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON = {
  eye: svg('<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
  eyeOff: svg('<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" opacity=".45"/><path d="M2.5 13.5l11-11"/>'),
  lock: svg('<rect x="3" y="7" width="10" height="7" rx="1.2" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/>'),
  unlock: svg('<rect x="3" y="7" width="10" height="7" rx="1.2"/><path d="M5 7V5a3 3 0 0 1 5.8-1"/>'),
};

export interface OutlinerHost {
  doc: Doc;
  isHidden(id: string): boolean;
  setHidden(id: string, v: boolean): void;
  isLocked(id: string): boolean;
  setLocked(id: string, v: boolean): void;
  frame(ids: string[]): void;
}

export class Outliner {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private search: HTMLInputElement;
  private count: HTMLElement;
  private rows = new Map<string, HTMLElement>();
  private pending = false;
  private collapsed = new Set<string>();
  private lastClicked: string | null = null;

  constructor(private host: OutlinerHost) {
    this.search = h('input', { class: 'out-search', type: 'search', placeholder: 'Find objects by name, type, tag…', spellcheck: false }) as HTMLInputElement;
    this.search.addEventListener('input', () => this.schedule());
    this.search.addEventListener('keydown', (e) => e.stopPropagation());
    this.count = h('span', { class: 'out-count' });
    this.list = h('div', { class: 'out-list', tabindex: '-1' });
    this.el = h('div', { class: 'outliner' }, h('div', { class: 'panel-title' }, 'Objects ', this.count), this.search, this.list);
    host.doc.onChange(() => this.schedule());
    host.doc.onSelect(() => this.updateSel(true));
    this.render();
  }

  schedule() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  private match(o: LObject, q: string) {
    if (!q) return true;
    const s = [o.name, displayName(o), TYPE_INFO[o.type].label, o.type, (o as any).tag, (o as any).squad, (o as any).prop, o.group, o.id].filter(Boolean).join(' ').toLowerCase();
    return s.includes(q);
  }

  render() {
    const doc = this.host.doc;
    const q = this.search.value.trim().toLowerCase();
    this.rows.clear();
    const frag = document.createDocumentFragment();
    if (!q || 'player start spawn'.includes(q)) frag.append(this.row(SPAWN_ID, SPAWN_INFO.icon, SPAWN_INFO.color, 'Player start', 'start'));
    const groups = new Map<string, LObject[]>();
    const loose: LObject[] = [];
    let shown = 0;
    for (const o of doc.level.objects) {
      if (!this.match(o, q)) continue;
      shown++;
      if (o.group) groups.set(o.group, [...(groups.get(o.group) ?? []), o]);
      else loose.push(o);
    }
    for (const [g, objs] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
      const closed = this.collapsed.has(g) && !q;
      const head = h(
        'div',
        { class: 'out-group' + (closed ? ' closed' : ''), title: 'Click to fold. Double-click to select the whole group.' },
        h('span', { class: 'out-fold', text: closed ? '▸' : '▾' }),
        h('span', { text: g }),
        h('span', { class: 'out-gcount', text: String(objs.length) }),
      );
      head.addEventListener('click', () => {
        if (this.collapsed.has(g)) this.collapsed.delete(g);
        else this.collapsed.add(g);
        this.render();
      });
      head.addEventListener('dblclick', () => doc.select(objs.map((o) => o.id)));
      frag.append(head);
      if (!closed) for (const o of objs) frag.append(this.objRow(o, true));
    }
    for (const o of loose) frag.append(this.objRow(o, false));
    if (!shown && q) frag.append(h('div', { class: 'out-empty', text: 'No objects match “' + q + '”' }));
    this.list.textContent = '';
    this.list.append(frag);
    this.count.textContent = q ? `${shown} / ${doc.level.objects.length}` : String(doc.level.objects.length);
    this.updateSel(false);
  }

  private objRow(o: LObject, indented: boolean) {
    const ti = typeInfo(o);
    const extra = o.type === 'enemy' || o.type === 'ally' ? [(o as any).squad && 'squad ' + (o as any).squad, o.tag && 'tag ' + o.tag].filter(Boolean).join(' ') : o.type === 'prop' && o.dynamic ? 'dynamic' : '';
    const r = this.row(o.id, ti.icon, ti.color, o.name ? o.name : displayName(o), o.name ? displayName(o) : TYPE_INFO[o.type].label.toLowerCase(), extra);
    if (indented) r.classList.add('ind');
    return r;
  }

  private row(id: string, icon: string, color: string, name: string, kind: string, extra = '') {
    const host = this.host;
    const hidden = host.isHidden(id);
    const locked = host.isLocked(id);
    const eye = h('button', { class: 'out-tog' + (hidden ? ' off' : ''), html: hidden ? ICON.eyeOff : ICON.eye, title: hidden ? 'Hidden — click to show it in the view' : 'Hide in the view (editor only, not saved)' });
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      host.setHidden(id, !host.isHidden(id));
      this.render();
    });
    const lock = h('button', { class: 'out-tog' + (locked ? ' on' : ''), html: locked ? ICON.lock : ICON.unlock, title: locked ? 'Locked — click to unlock' : 'Lock (cannot be clicked or moved in the view)' });
    lock.addEventListener('click', (e) => {
      e.stopPropagation();
      host.setLocked(id, !host.isLocked(id));
      this.render();
    });
    const r = h(
      'div',
      { class: 'out-row' + (hidden ? ' hidden' : '') + (locked ? ' locked' : ''), 'data-id': id },
      h('span', { class: 'out-icon', text: icon, style: { color } }),
      h('span', { class: 'out-name', text: name }),
      h('span', { class: 'out-kind', text: extra ? kind + ' · ' + extra : kind }),
      eye,
      id === SPAWN_ID ? h('span', { class: 'out-tog blank' }) : lock,
    );
    r.addEventListener('click', (e) => {
      const doc = host.doc;
      if (e.shiftKey && this.lastClicked) {
        // range select in list order
        const ids = [...this.list.querySelectorAll('.out-row')].map((x) => (x as HTMLElement).dataset.id!);
        const a = ids.indexOf(this.lastClicked);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
          doc.select(range, 'add');
          return;
        }
      }
      if (e.ctrlKey || e.metaKey) doc.select([id], 'toggle');
      else doc.select([id]);
      this.lastClicked = id;
    });
    r.addEventListener('dblclick', () => host.frame([id]));
    this.rows.set(id, r);
    return r;
  }

  private updateSel(scroll: boolean) {
    const sel = new Set(this.host.doc.selection);
    for (const [id, r] of this.rows) r.classList.toggle('sel', sel.has(id));
    const act = this.host.doc.active;
    if (scroll && act) {
      const r = this.rows.get(act);
      if (r) r.scrollIntoView({ block: 'nearest' });
    }
  }
}
