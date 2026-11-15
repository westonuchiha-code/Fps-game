// Right panel: edits every field of the selected object(s), or the level settings when nothing
// is selected. Every widget writes through an undoable document edit.
import type { LAction, LObject, LevelData, V3 } from '../world/leveldata';
import { numToHex } from '../world/leveldata';
import { PROPS, PROP_LIST } from '../world/props';
import {
  ALLY_VOICES, BRAND_LIST, CENTRE_TYPES, ENEMY_KINDS, MATS, MUSIC_TRACKS, PAL_SWATCHES, PICKUP_KINDS, RARITY_LIST, SKY_NAMES, SPAWN_ID,
  SPAWN_INFO, TEXT_PROPS, TYPE_INFO, WEAPON_CLASSES, allGroups, allSquads, allTags, displayName, r3, rotAxes, typeInfo,
} from './defs';
import { actionListEditor, summarizeList, type ActionHost } from './actions';
import type { Doc } from './state';
import type { Problem } from './validate';
import { ID_PATTERN } from './validate';
import { Widgets, check, color, h, num, row, section, select, text } from './ui';

export interface InspectorHost {
  doc: Doc;
  setSky(name: string): void;
  frame(ids: string[]): void;
  duplicate(): void;
  remove(): void;
  dropToFloor(): void;
  patrolEdit: string | null;
  setPatrolEdit(id: string | null): void;
  problems(): Problem[];
  selectProblem(p: Problem): void;
  isLocked(id: string): boolean;
  setLocked(id: string, v: boolean): void;
  saveAs(): void;
}

const DEG = 180 / Math.PI;
const rad = (d: number) => Math.round((d / DEG) * 1e5) / 1e5;
const deg = (r: number | undefined) => Math.round((r ?? 0) * DEG * 100) / 100;

export class Inspector {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private ws = new Widgets();
  private key = '';

  constructor(private host: InspectorHost) {
    this.body = h('div', { class: 'insp-body' });
    this.el = h('div', { class: 'inspector' }, this.body);
    host.doc.onSelect(() => this.render());
    host.doc.onChange(() => this.changed());
    this.render();
  }

  /** After a document change: refresh values in place while the user is typing, otherwise redraw. */
  changed() {
    const a = document.activeElement as HTMLElement | null;
    const typing = !!a && this.el.contains(a) && ((a.tagName === 'INPUT' && (a as HTMLInputElement).type !== 'checkbox') || a.tagName === 'TEXTAREA');
    const sel = this.host.doc.selection.filter((id) => id === SPAWN_ID || this.host.doc.get(id));
    const key = sel.join(',');
    if (typing && key === this.key) this.ws.refresh();
    else this.render();
  }

  private shownProblems = '';
  /** Validation finished: redraw if the problems about what is shown changed (and nobody is typing). */
  problemsChanged() {
    const ids = this.host.doc.selection.length ? this.host.doc.selection : ['__level'];
    const key = JSON.stringify(this.host.problems().filter((p) => ids.includes(p.id)));
    if (key === this.shownProblems) return;
    const a = document.activeElement as HTMLElement | null;
    if (a && this.el.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) return;
    this.render();
  }

  render() {
    {
      const ids = this.host.doc.selection.length ? this.host.doc.selection : ['__level'];
      this.shownProblems = JSON.stringify(this.host.problems().filter((p) => ids.includes(p.id)));
    }
    const scroll = this.body.scrollTop;
    const sameSel = this.key === this.host.doc.selection.join(',');
    this.ws.clear();
    this.body.textContent = '';
    const doc = this.host.doc;
    const sel = doc.selection.filter((id) => id === SPAWN_ID || doc.get(id));
    this.key = sel.join(',');
    if (!sel.length) this.levelSettings();
    else if (sel.length === 1 && sel[0] === SPAWN_ID) this.spawnPanel();
    else {
      const objs = sel.filter((id) => id !== SPAWN_ID).map((id) => doc.get(id)!);
      const types = new Set(objs.map((o) => o.type));
      if (types.size === 1 && objs.length) this.objectPanel(objs);
      else this.mixedPanel(objs, sel.includes(SPAWN_ID));
    }
    if (sameSel) this.body.scrollTop = scroll;
  }

  private redraw = () => setTimeout(() => this.render(), 0);

  // ---- helpers ----

  private problemsFor(id: string) {
    const ps = this.host.problems().filter((p) => p.id === id);
    if (!ps.length) return null;
    return h(
      'div',
      { class: 'insp-problems' },
      ...ps.slice(0, 6).map((p) => h('div', { class: 'prob ' + p.sev, text: p.text })),
    );
  }

  private header(icon: string, color: string, title: string, sub: string, buttons: HTMLElement[] = []) {
    return h(
      'div',
      { class: 'insp-head' },
      h('span', { class: 'insp-icon', text: icon, style: { color } }),
      h('div', { class: 'insp-title' }, h('div', { class: 'insp-t', text: title }), h('div', { class: 'insp-sub', text: sub })),
      h('div', { class: 'insp-btns' }, ...buttons),
    );
  }

  private btn(label: string, tip: string, fn: () => void, cls = '') {
    return h('button', { class: 'btn small ' + cls, text: label, title: tip, onclick: fn });
  }

  /** Apply a change to every selected object of the type being edited. */
  private applyTo(ids: string[], label: string, key: string, fn: (o: any) => void) {
    this.host.doc.edit(
      label,
      (tx) => {
        for (const id of ids) fn(tx.touch(id));
      },
      { merge: 'insp:' + key + ':' + ids.join(',') },
    );
  }

  private v3(get: () => V3 | undefined, set: (v: V3) => void, labels = ['X', 'Y', 'Z'], o: { step?: number; min?: number } = {}) {
    const wrap = h('div', { class: 'v3' });
    for (let i = 0; i < 3; i++) {
      const w = this.ws.add(
        num(
          () => get()?.[i],
          (v) => {
            const cur = (get() ?? [0, 0, 0]).slice() as V3;
            cur[i] = r3(v ?? 0);
            set(cur);
          },
          { step: o.step ?? 0.25, min: o.min },
        ),
      );
      wrap.append(h('span', { class: 'axis a' + i, text: labels[i] }), w.el);
    }
    return wrap;
  }

  // ---- level settings ----

  private levelSettings() {
    const doc = this.host.doc;
    const L = () => doc.level;
    const setL = (label: string, key: string, fn: (l: LevelData) => void) => doc.edit(label, (tx) => fn(tx.settings()), { merge: 'lvl:' + key });
    const counts = new Map<string, number>();
    for (const o of L().objects) counts.set(o.type, (counts.get(o.type) ?? 0) + 1);
    this.body.append(
      this.header('⚙', '#ffd21f', 'Level settings', 'Nothing selected — these apply to the whole level', [this.btn('Rename / Save as…', 'Change the level id and save a copy', () => this.host.saveAs())]),
    );
    const lp = this.problemsFor('__level');
    if (lp) this.body.append(lp);
    const s = section(
      'Level',
      true,
      row('Level id', this.ws.add(text(() => L().id, (v) => setL('Edit level id', 'id', (l) => (l.id = v)), { pattern: ID_PATTERN, title: 'File name: letters, digits, - and _ only' })).el),
      row('Title', this.ws.add(text(() => L().title, (v) => setL('Edit title', 'title', (l) => (l.title = v)), { placeholder: 'Shown on the loading screen' })).el),
      row('Mission no.', this.ws.add(text(() => L().number, (v) => setL('Edit mission number', 'number', (l) => (l.number = v)), { placeholder: 'e.g. MISSION 03' })).el),
      row(
        'Sky',
        this.ws.add(
          select(
            () => L().sky,
            (v) => {
              setL('Change sky', 'sky', (l) => (l.sky = v));
              this.host.setSky(v);
            },
            SKY_NAMES.map((n) => ({ value: n, label: n[0].toUpperCase() + n.slice(1) })),
          ),
        ).el,
      ),
      row('Enemy level', this.ws.add(num(() => L().enemyLevel, (v) => setL('Edit enemy level', 'elvl', (l) => (l.enemyLevel = v ?? 1)), { min: 1, max: 60, step: 1, integer: true, title: 'How tough enemies and loot are' })).el),
      row('Music', this.ws.add(select(() => L().music, (v) => setL('Change music', 'music', (l) => (l.music = v)), [{ value: null, label: '(silence)' }, ...MUSIC_TRACKS.map((t) => ({ value: t, label: t }))])).el),
      row('Kill height', this.ws.add(num(() => L().killY, (v) => setL('Edit kill height', 'killY', (l) => (l.killY = v ?? -40)), { step: 1, title: 'Falling below this height kills the player' })).el),
      row('', this.ws.add(check(() => L().winOnAllDead !== false, (v) => setL('Toggle win on all dead', 'win', (l) => (l.winOnAllDead = v)), 'Win when every enemy is dead', 'With no objectives of its own, clearing all enemies ends the level')).el),
    );
    this.body.append(s.el);

    // onStart
    const startHost: ActionHost = {
      root: () => doc.level.onStart,
      mutate: (label, fn, merge) =>
        doc.edit(
          label,
          (tx) => {
            const l = tx.settings();
            if (!l.onStart) l.onStart = [];
            fn(l.onStart);
            if (!l.onStart.length) delete l.onStart;
          },
          { merge: merge ? 'start:' + merge : undefined },
        ),
      level: () => doc.level,
      redraw: this.redraw,
    };
    const st = section('When the level starts', true, h('div', { class: 'hint', text: 'These actions run once, as soon as the level begins.' }), actionListEditor(startHost, this.ws, [], 'start'));
    this.body.append(st.el);

    // watchers
    const tags = allTags(doc.level);
    const wsec = section('Watchers', true, h('div', { class: 'hint', text: 'Run actions when every enemy with a tag has been killed.' }));
    (doc.level.watchers ?? []).forEach((w, i) => {
      const wHost: ActionHost = {
        root: () => doc.level.watchers?.[i]?.actions,
        mutate: (label, fn, merge) => doc.edit(label, (tx) => fn(tx.settings().watchers![i].actions), { merge: merge ? 'watch:' + i + merge : undefined }),
        level: () => doc.level,
        redraw: this.redraw,
      };
      const tagSel = this.ws.add(
        select(
          () => doc.level.watchers?.[i]?.allDead,
          (v) => doc.edit('Edit watcher', (tx) => (tx.settings().watchers![i].allDead = v ?? '__base')),
          [{ value: '__base', label: 'the enemies there from the start' }, ...tags.map((t) => ({ value: t, label: 'everyone tagged “' + t + '”' }))],
        ),
      );
      const del = this.btn('✕', 'Delete this watcher', () => {
        doc.edit('Delete watcher', (tx) => {
          const l = tx.settings();
          l.watchers!.splice(i, 1);
          if (!l.watchers!.length) delete l.watchers;
        });
      });
      wsec.body.append(h('div', { class: 'watcher' }, h('div', { class: 'watch-head' }, h('span', { text: 'When ' }), tagSel.el, h('span', { text: ' are all dead:' }), del), actionListEditor(wHost, this.ws, [], 'watch' + i)));
    });
    wsec.body.append(
      this.btn('+ Add a watcher', 'Do something when a group of enemies is wiped out', () =>
        doc.edit('Add watcher', (tx) => {
          const l = tx.settings();
          (l.watchers ??= []).push({ allDead: tags[0] ?? '__base', actions: [] });
        }),
      ),
    );
    this.body.append(wsec.el);

    const stats = section(
      'What is in this level',
      false,
      h('div', { class: 'stats' }, ...[...counts].sort((a, b) => b[1] - a[1]).map(([t, n]) => h('div', { class: 'stat' }, h('span', { text: TYPE_INFO[t as LObject['type']]?.label ?? t }), h('b', { text: String(n) })))),
    );
    this.body.append(stats.el);
  }

  // ---- player start ----

  private spawnPanel() {
    const doc = this.host.doc;
    const S = () => doc.level.spawn;
    const setS = (label: string, key: string, fn: (s: LevelData['spawn']) => void) => doc.edit(label, (tx) => fn(tx.settings().spawn), { merge: 'spawn:' + key });
    this.body.append(this.header(SPAWN_INFO.icon, SPAWN_INFO.color, 'Player start', 'Where the player begins', [this.btn('Frame', 'Show it (F)', () => this.host.frame([SPAWN_ID]))]));
    const p = this.problemsFor(SPAWN_ID);
    if (p) this.body.append(p);
    this.body.append(
      section(
        'Transform',
        true,
        row('Position', this.v3(() => S().pos, (v) => setS('Move player start', 'pos', (s) => (s.pos = v)))),
        row('Facing (°)', this.ws.add(num(() => deg(S().yaw), (v) => setS('Turn player start', 'yaw', (s) => (s.yaw = rad(v ?? 0))), { step: 15, title: '0 = north (-Z), 90 = west, -90 = east' })).el),
        h('div', { class: 'hint', text: 'Tip: pick “Player start” in the Logic tab and click in the world to move it there.' }),
      ).el,
    );
  }

  // ---- mixed selection ----

  private mixedPanel(objs: LObject[], withSpawn: boolean) {
    const doc = this.host.doc;
    const counts = new Map<string, number>();
    for (const o of objs) counts.set(TYPE_INFO[o.type].label, (counts.get(TYPE_INFO[o.type].label) ?? 0) + 1);
    if (withSpawn) counts.set('Player start', 1);
    const ids = objs.map((o) => o.id);
    this.body.append(
      this.header('⧉', '#ffd21f', objs.length + (withSpawn ? 1 : 0) + ' objects selected', [...counts].map(([k, n]) => n + ' × ' + k).join(', '), [
        this.btn('Frame', 'Show them (F)', () => this.host.frame(doc.selection)),
        this.btn('Duplicate', 'Ctrl+D', () => this.host.duplicate()),
        this.btn('Delete', 'Del', () => this.host.remove(), 'danger'),
      ]),
    );
    this.body.append(
      section(
        'All selected',
        true,
        row('Group', this.ws.add(text(() => (objs.every((o) => o.group === objs[0].group) ? objs[0].group : ''), (v) => this.applyTo(ids, 'Set group', 'group', (o) => (v ? (o.group = v) : delete o.group)), { list: allGroups(doc.level), placeholder: 'organise in the outliner' })).el),
        row('', this.btn('Drop to floor', 'End', () => this.host.dropToFloor())),
        h('div', { class: 'hint', text: 'Drag the handles to move, rotate or scale them all together. Select objects of one type to edit their shared fields.' }),
      ).el,
    );
  }

  // ---- objects ----

  private objectPanel(objs: LObject[]) {
    const doc = this.host.doc;
    const ids = objs.map((o) => o.id);
    const single = objs.length === 1;
    const first = objs[objs.length - 1];
    const id = first.id;
    const O = () => (doc.get(id) ?? first) as any;
    const set = (label: string, key: string, fn: (o: any) => void) => this.applyTo(ids, label, key, fn);
    const setField = (k: string, label = 'Edit ' + k) => (v: any) => set(label, k, (o) => (v === undefined || v === '' ? delete o[k] : (o[k] = v)));
    const ti = typeInfo(first);
    const t = first.type;

    this.body.append(
      this.header(ti.icon, ti.color, single ? displayName(first) : objs.length + ' × ' + TYPE_INFO[t].label, single ? TYPE_INFO[t].label + ' · id ' + id : 'edits apply to all of them', [
        this.btn('Frame', 'Show it (F)', () => this.host.frame(ids)),
        this.btn('Duplicate', 'Ctrl+D', () => this.host.duplicate()),
        this.btn('Delete', 'Del', () => this.host.remove(), 'danger'),
      ]),
    );
    if (single) {
      const p = this.problemsFor(id);
      if (p) this.body.append(p);
    }

    // identity
    const ident = section('Object', true);
    if (single) {
      const names = new Set(doc.level.objects.filter((o) => o.id !== id && o.name).map((o) => o.name!));
      const nameW = this.ws.add(text(() => O().name, (v) => set('Rename', 'name', (o) => (v ? (o.name = v) : delete o.name)), { placeholder: t === 'marker' || t === 'trigger' ? 'needed so actions can find it' : 'optional — actions refer to names' }));
      const dup = h('div', { class: 'field-warn' });
      this.ws.add({ el: dup, refresh: () => (dup.textContent = O().name && names.has(O().name) ? 'Another object already has this name' : '') }).refresh();
      ident.body.append(row('Name', nameW.el, dup));
    }
    ident.body.append(
      row('Group', this.ws.add(text(() => O().group, (v) => set('Set group', 'group', (o) => (v ? (o.group = v) : delete o.group)), { list: allGroups(doc.level), placeholder: 'optional folder in the outliner' })).el),
      row('', this.ws.add(check(() => this.host.isLocked(id), (v) => ids.forEach((i) => this.host.setLocked(i, v)), 'Locked', 'Locked objects cannot be clicked or moved in the view')).el),
    );
    this.body.append(ident.el);

    // transform
    const tr = section('Transform', true);
    if (single) {
      tr.body.append(row(CENTRE_TYPES.has(t) ? 'Centre' : 'Position', this.v3(() => O().pos, (v) => set('Move', 'pos', (o) => (o.pos = v)))));
      const axes = rotAxes(t);
      if (axes === 'xyz')
        tr.body.append(
          row(
            'Rotation (°)',
            this.v3(
              () => (O().rot ?? [0, 0, 0]).map(deg) as V3,
              (v) => set('Rotate', 'rot', (o) => {
                const r = v.map(rad) as V3;
                if (r.every((x) => x === 0)) delete o.rot;
                else o.rot = r;
              }),
              ['X', 'Y', 'Z'],
              { step: 15 },
            ),
          ),
        );
      else if (axes === 'y')
        tr.body.append(
          row(
            'Facing (°)',
            this.ws.add(
              num(() => deg(O().rot?.[1]), (v) => set('Rotate', 'rot', (o) => {
                const y = rad(v ?? 0);
                if (!y) delete o.rot;
                else o.rot = [0, y, 0];
              }), { step: 15, title: '0 = facing north (-Z)' }),
            ).el,
          ),
        );
    }
    if ('size' in first) {
      const lab = t === 'ramp' || t === 'stairs' ? ['W', 'Rise', 'Run'] : ['W', 'H', 'D'];
      tr.body.append(
        row(
          'Size (m)',
          this.v3(
            () => O().size,
            (v) =>
              set('Resize', 'size', (o) => {
                const base = CENTRE_TYPES.has(o.type) ? o.pos[1] - o.size[1] / 2 : 0;
                o.size = v.map((x) => Math.max(0.05, x)) as V3;
                if (CENTRE_TYPES.has(o.type)) o.pos = [o.pos[0], r3(base + o.size[1] / 2), o.pos[2]];
              }),
            lab,
            { min: 0.05 },
          ),
        ),
      );
      if (CENTRE_TYPES.has(t)) tr.body.append(h('div', { class: 'hint', text: 'Resizing keeps the bottom where it is.' }));
    }
    if (t === 'cyl') {
      tr.body.append(
        row('Radius', this.ws.add(num(() => O().r, setField('r', 'Resize'), { min: 0.05, step: 0.25 })).el),
        row('Height', this.ws.add(num(() => O().h, setField('h', 'Resize'), { min: 0.05, step: 0.25 })).el),
        row('Sides', this.ws.add(num(() => O().sides, setField('sides', 'Edit sides'), { min: 3, max: 48, step: 1, integer: true, optional: true, placeholder: '10' })).el),
      );
    }
    if (t === 'prop') tr.body.append(row('Scale', this.ws.add(num(() => O().scale, (v) => setField('scale', 'Scale')(v === 1 ? undefined : v), { min: 0.1, max: 20, step: 0.1, optional: true, placeholder: '1' })).el));
    if (tr.body.childNodes.length) this.body.append(tr.el);

    // look (static shapes)
    if (t === 'box' || t === 'ramp' || t === 'stairs' || t === 'cyl') {
      const look = section(
        'Look',
        true,
        row('Material', this.ws.add(select(() => O().mat, setField('mat', 'Change material'), MATS.map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) })))).el),
        row('Colour', this.ws.add(color(() => O().color, (v) => setField('color', 'Change colour')(v ?? '#ffffff'), PAL_SWATCHES)).el),
        row('Texture size', this.ws.add(num(() => O().uv, setField('uv', 'Edit texture size'), { min: 0.1, step: 0.5, optional: true, placeholder: t === 'cyl' ? '2' : '4', title: 'Metres per texture repeat' })).el),
        t === 'stairs' ? row('Steps', this.ws.add(num(() => O().steps, setField('steps', 'Edit steps'), { min: 2, max: 60, step: 1, integer: true, optional: true, placeholder: 'auto' })).el) : null,
        row('', this.ws.add(check(() => O().collide !== false, (v) => setField('collide', 'Toggle collision')(v ? undefined : false), 'Solid (blocks the player)')).el),
        t === 'box' ? row('', this.ws.add(check(() => !!O().dynamic, (v) => setField('dynamic', 'Toggle dynamic')(v ? true : undefined), 'Dynamic (an action can remove it)', 'Needs a name. Use for gates and barricades.')).el) : null,
      );
      this.body.append(look.el);
    }

    if (t === 'prop') {
      const def = () => PROPS[O().prop];
      const propOpts = PROP_LIST.map((p) => ({ value: p.id, label: p.label, group: p.cat }));
      const sw = [...new Set([...(def()?.colors ?? []).map(numToHex), ...(def() ? [numToHex(def()!.color)] : []), ...PAL_SWATCHES])];
      const s = section(
        'Prop',
        true,
        row('Prop', this.ws.add(select(() => O().prop, setField('prop', 'Change prop'), propOpts)).el),
        def()?.variants ? row('Variant', this.ws.add(num(() => O().variant ?? 0, (v) => setField('variant', 'Change variant')(v ? v : undefined), { min: 0, max: (def()!.variants ?? 1) - 1, step: 1, integer: true, title: `0 – ${(def()!.variants ?? 1) - 1}` })).el, h('span', { class: 'hint inline', text: 'of ' + def()!.variants })) : null,
        TEXT_PROPS.has(first.type === 'prop' ? first.prop : '') ? row('Sign text', this.ws.add(text(() => O().text, setField('text', 'Edit sign text'), { placeholder: 'leave empty for a random slogan' })).el) : null,
        row('Colour', this.ws.add(color(() => O().color, setField('color', 'Change colour'), sw, { resettable: true, fallback: def() ? numToHex(def()!.color) : '#ffffff' })).el),
        row('', this.ws.add(check(() => !!O().dynamic, (v) => setField('dynamic', 'Toggle dynamic')(v ? true : undefined), 'Dynamic (an action can remove it)', 'Needs a name')).el),
      );
      this.body.append(s.el);
    }

    if (t === 'enemy') {
      const lvl = doc.level.enemyLevel;
      const s = section(
        'Enemy',
        true,
        row('Kind', this.ws.add(select(() => O().kind, setField('kind', 'Change enemy kind'), ENEMY_KINDS.map((k) => ({ value: k.id, label: k.label })))).el),
        row('Squad', this.ws.add(text(() => O().squad, setField('squad', 'Set squad'), { list: allSquads(doc.level), placeholder: 'same squad = fight as a team' })).el),
        row('Arrives on', this.ws.add(text(() => O().tag, setField('tag', 'Set tag'), { list: allTags(doc.level), placeholder: 'empty = there from the start', title: 'If set, this enemy only appears when a “Spawn” action with this tag runs' })).el),
        row('', this.ws.add(check(() => !!O().hold, (v) => setField('hold', 'Toggle hold')(v ? true : undefined), 'Hold position', 'Stays near its spawn point even in combat')).el),
        row('Level', this.ws.add(num(() => O().level, setField('level', 'Set enemy level'), { min: 1, max: 60, step: 1, integer: true, optional: true, placeholder: 'level default (' + lvl + ')' })).el),
      );
      this.body.append(s.el);
      if (single) this.patrolSection(id);
    }

    if (t === 'ally') {
      this.body.append(
        section(
          'Ally',
          true,
          row('Who', this.ws.add(select(() => O().voice, setField('voice', 'Change ally'), ALLY_VOICES.map((v) => ({ value: v.id, label: v.label })))).el),
          row('', this.ws.add(check(() => !!O().essential, (v) => setField('essential', 'Toggle essential')(v ? true : undefined), 'Essential (gets back up when downed)')).el),
          row('Arrives on', this.ws.add(text(() => O().tag, setField('tag', 'Set tag'), { list: allTags(doc.level), placeholder: 'empty = there from the start' })).el),
        ).el,
      );
    }

    if (t === 'pickup') {
      const kd = () => PICKUP_KINDS.find((k) => k.id === O().kind);
      this.body.append(
        section(
          'Pickup',
          true,
          row('Kind', this.ws.add(select(() => O().kind, (v) => { setField('kind', 'Change pickup')(v); this.redraw(); }, PICKUP_KINDS.map((k) => ({ value: k.id, label: k.label })))).el),
          O().kind === 'ammo' ? row('Ammo for', this.ws.add(select(() => O().cls, setField('cls', 'Set ammo type'), [{ value: undefined, label: '(any gun)' }, ...WEAPON_CLASSES.map((c) => ({ value: c.id, label: c.label }))])).el) : null,
          row('Amount', this.ws.add(num(() => O().amount, setField('amount', 'Set amount'), { min: 1, step: 5, integer: true, optional: true, placeholder: 'default (' + (kd()?.def ?? 30) + ')' })).el),
        ).el,
      );
    }

    if (t === 'weapon') {
      const shield = !!O().shield;
      this.body.append(
        section(
          'Weapon',
          true,
          row('', this.ws.add(check(() => !!O().shield, (v) => { setField('shield', 'Toggle shield')(v ? true : undefined); this.redraw(); }, 'Shield instead of a gun')).el),
          !shield ? row('Class', this.ws.add(select(() => O().cls, setField('cls', 'Set weapon class'), [{ value: undefined, label: '(random)' }, ...WEAPON_CLASSES.map((c) => ({ value: c.id, label: c.label }))])).el) : null,
          row('Brand', this.ws.add(select(() => O().brand, setField('brand', 'Set brand'), [{ value: undefined, label: '(random)' }, ...BRAND_LIST.map((c) => ({ value: c.id, label: c.label }))])).el),
          row('Rarity', this.ws.add(select(() => O().rarity, setField('rarity', 'Set rarity'), [{ value: undefined, label: '(random)' }, ...RARITY_LIST.map((c) => ({ value: c.id, label: c.label }))])).el),
          row('Level', this.ws.add(num(() => O().level, setField('level', 'Set item level'), { min: 1, max: 60, step: 1, integer: true, optional: true, placeholder: 'level default' })).el),
          row('Seed', this.ws.add(num(() => O().seed, setField('seed', 'Set seed'), { min: 0, step: 1, integer: true, optional: true, placeholder: 'random each time', title: 'Same seed = same gun every time' })).el),
        ).el,
      );
    }

    if (t === 'locker') {
      this.body.append(section('Locker', true, row('Luck', this.ws.add(select(() => O().luck ?? 1, (v) => setField('luck', 'Set luck')(v), [{ value: 0, label: 'Ordinary' }, { value: 1, label: 'Good' }, { value: 2, label: 'Great' }])).el)).el);
    }
    if (t === 'vehicle') {
      this.body.append(section('Vehicle', true, row('Kind', this.ws.add(select(() => O().kind, setField('kind', 'Change vehicle'), [{ value: 'teamster', label: 'Teamster 4x4' }, { value: 'vesper', label: 'Vesper scooter' }])).el)).el);
    }

    if (t === 'trigger') {
      this.body.append(
        section(
          'Trigger',
          true,
          row('', this.ws.add(check(() => O().once !== false, (v) => setField('once', 'Toggle once')(v ? undefined : false), 'Only fire once', 'Untick to fire every time the player enters')).el),
          row('', this.ws.add(check(() => !!O().disabled, (v) => setField('disabled', 'Toggle disabled')(v ? true : undefined), 'Starts switched OFF', 'Needs a name; a “Switch trigger ON” action turns it on')).el),
        ).el,
      );
    }
    if (t === 'destructible') {
      this.body.append(
        section(
          'Destructible',
          true,
          row('Looks like', this.ws.add(select(() => O().prop, setField('prop', 'Change prop'), PROP_LIST.map((p) => ({ value: p.id, label: p.label, group: p.cat })))).el),
          row('Health', this.ws.add(num(() => O().hp, setField('hp', 'Set health'), { min: 1, step: 10, optional: true, placeholder: '60' })).el),
          row('Hurt by', this.ws.add(select(() => O().by, setField('by', 'Set damage type'), [{ value: undefined, label: 'Anything' }, { value: 'any', label: 'Anything (explicit)' }, { value: 'explosion', label: 'Explosions only' }])).el),
        ).el,
      );
    }

    if (single && (t === 'trigger' || t === 'destructible')) {
      const aHost: ActionHost = {
        root: () => (doc.get(id) as any)?.actions,
        mutate: (label, fn, merge) =>
          doc.edit(
            label,
            (tx) => {
              const o = tx.touch(id) as any;
              if (!o.actions) o.actions = [];
              fn(o.actions);
              if (o.type === 'destructible' && !o.actions.length) delete o.actions;
            },
            { merge: merge ? 'act:' + id + merge : undefined },
          ),
        level: () => doc.level,
        redraw: this.redraw,
      };
      const sum = h('div', { class: 'act-overview' });
      this.ws.add({ el: sum, refresh: () => (sum.textContent = (t === 'trigger' ? 'When the player walks in: ' : 'When it breaks: ') + summarizeList((doc.get(id) as any)?.actions as LAction[], doc.level)) }).refresh();
      this.body.append(section(t === 'trigger' ? 'Actions (when the player walks in)' : 'Actions (when it breaks)', true, sum, actionListEditor(aHost, this.ws, [], 'act')).el);
    }
    if (t === 'marker') this.body.append(h('div', { class: 'hint pad', text: 'Markers are named points. Waypoint actions and level scripts refer to them by name.' }));
    if (t === 'nav') this.body.append(h('div', { class: 'hint pad', text: 'Enemies may only walk inside nav areas. Leave them out and the whole level is walkable.' }));
    if (t === 'checkpoint') this.body.append(h('div', { class: 'hint pad', text: 'Walking into this box saves progress; the player respawns at its centre facing its direction.' }));
  }

  private patrolSection(id: string) {
    const doc = this.host.doc;
    const O = () => doc.get(id) as any;
    const editing = this.host.patrolEdit === id;
    const s = section('Patrol route', true);
    const pts: V3[] = O()?.patrol ?? [];
    if (!pts.length) s.body.append(h('div', { class: 'hint', text: 'No route: the enemy stands still until it spots the player.' }));
    pts.forEach((_, i) => {
      const del = this.btn('✕', 'Delete this point', () =>
        doc.edit('Delete patrol point', (tx) => {
          const o = tx.touch(id) as any;
          o.patrol.splice(i, 1);
          if (!o.patrol.length) delete o.patrol;
        }),
      );
      s.body.append(
        row(
          'Point ' + (i + 1),
          this.v3(() => O()?.patrol?.[i], (v) => doc.edit('Move patrol point', (tx) => ((tx.touch(id) as any).patrol[i] = v), { merge: 'patrol:' + id + ':' + i })),
          del,
        ),
      );
    });
    s.body.append(
      h(
        'div',
        { class: 'btnrow' },
        this.btn(editing ? '✓ Done adding points' : '✚ Add points by clicking', editing ? 'Stop adding points (Esc)' : 'Click in the world to add points; drag a point to move it', () => this.host.setPatrolEdit(editing ? null : id), editing ? 'primary' : ''),
        pts.length ? this.btn('Clear route', 'Remove every point', () => doc.edit('Clear patrol', (tx) => delete (tx.touch(id) as any).patrol)) : null!,
      ),
    );
    if (editing) s.body.append(h('div', { class: 'hint hot', text: 'Click on the ground to add points. Drag the white dots to move them.' }));
    this.body.append(s.el);
  }
}
