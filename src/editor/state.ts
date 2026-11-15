// The editor's document: a LevelData object plus an undo/redo history and the selection.
// Every change goes through `doc.edit(label, tx => ...)`, which records before/after snapshots of
// exactly the objects (and level settings) it touched, so undo is exact and cheap even for big levels.
import type { LObject, LevelData } from '../world/leveldata';
import { SPAWN_ID } from './defs';

type Snap = { idx: number; obj: LObject } | null;

interface Entry {
  uid: number;
  label: string;
  objs: Map<string, { before: Snap; after: Snap }>;
  settingsBefore?: string;
  settingsAfter?: string;
  mergeKey?: string;
  time: number;
  selBefore: string[];
  selAfter: string[];
}

export interface ChangeEvent {
  /** ids of objects whose data changed (added, removed or edited) */
  ids: Set<string>;
  /** the level settings (including the player start) changed */
  settings: boolean;
  /** objects were added, removed or reordered */
  structure: boolean;
  source: 'edit' | 'undo' | 'redo' | 'load';
  label: string;
}

const clone = <T>(v: T): T => structuredClone(v);

let uidCounter = 1;

export class Tx {
  readonly objs = new Map<string, { before: Snap }>();
  settingsBefore?: string;
  constructor(private doc: Doc) {}

  /** Snapshot an object before changing it; returns the live object to mutate. */
  touch(id: string): LObject {
    if (id === SPAWN_ID) {
      this.settings();
      return null as unknown as LObject;
    }
    const o = this.doc.byId.get(id);
    if (!o) throw new Error('no object ' + id);
    if (!this.objs.has(id)) this.objs.set(id, { before: { idx: this.doc.level.objects.indexOf(o), obj: clone(o) } });
    return o;
  }

  /** Add a new object (at the end, or at `index`). */
  add(o: LObject, index?: number) {
    if (this.doc.byId.has(o.id)) throw new Error('duplicate id ' + o.id);
    if (!this.objs.has(o.id)) this.objs.set(o.id, { before: null });
    const list = this.doc.level.objects;
    if (index === undefined || index < 0 || index > list.length) list.push(o);
    else list.splice(index, 0, o);
    this.doc.byId.set(o.id, o);
    return o;
  }

  remove(id: string) {
    if (id === SPAWN_ID) return;
    const o = this.doc.byId.get(id);
    if (!o) return;
    this.touch(id);
    const list = this.doc.level.objects;
    list.splice(list.indexOf(o), 1);
    this.doc.byId.delete(id);
  }

  /** Snapshot the level settings (title, sky, spawn, onStart, watchers...) before changing them. */
  settings(): LevelData {
    if (this.settingsBefore === undefined) this.settingsBefore = settingsSnap(this.doc.level);
    return this.doc.level;
  }
}

/** JSON of everything but the objects, keeping key order (objects marked by a placeholder). */
function settingsSnap(level: LevelData) {
  const keys = Object.keys(level);
  const vals: Record<string, unknown> = {};
  for (const k of keys) vals[k] = k === 'objects' ? null : (level as any)[k];
  return JSON.stringify({ keys, vals });
}
function restoreSettings(level: LevelData, snap: string) {
  const { keys, vals } = JSON.parse(snap) as { keys: string[]; vals: Record<string, unknown> };
  const objects = level.objects;
  for (const k of Object.keys(level)) delete (level as any)[k];
  for (const k of keys) (level as any)[k] = k === 'objects' ? objects : vals[k];
  if (!keys.includes('objects')) (level as any).objects = objects;
}

type Listener = (e: ChangeEvent) => void;

export class Doc {
  level: LevelData;
  readonly byId = new Map<string, LObject>();
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private listeners: Listener[] = [];
  private selListeners: (() => void)[] = [];
  private baseUid = uidCounter++;
  /** stack position that matches what was last saved (-1 = never matches) */
  savedState = this.baseUid;
  maxUndo = 300;

  /** selected object ids (SPAWN_ID for the player start); last one is the "active" object */
  selection: string[] = [];

  constructor(level: LevelData) {
    this.level = level;
    this.reindex();
  }

  private reindex() {
    this.byId.clear();
    for (const o of this.level.objects) this.byId.set(o.id, o);
  }

  get stateId() {
    return this.undoStack.length ? this.undoStack[this.undoStack.length - 1].uid : this.baseUid;
  }
  get dirty() {
    return this.stateId !== this.savedState;
  }
  markSaved() {
    this.savedState = this.stateId;
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get undoLabel() {
    return this.undoStack[this.undoStack.length - 1]?.label ?? '';
  }
  get redoLabel() {
    return this.redoStack[this.redoStack.length - 1]?.label ?? '';
  }
  get historySize() {
    return this.undoStack.length;
  }

  onChange(fn: Listener) {
    this.listeners.push(fn);
  }
  onSelect(fn: () => void) {
    this.selListeners.push(fn);
  }

  /** Replace the whole level (New / Open / Import). Clears the history. */
  load(level: LevelData, dirty = false) {
    this.level = level;
    this.reindex();
    this.undoStack = [];
    this.redoStack = [];
    this.baseUid = uidCounter++;
    this.savedState = dirty ? -1 : this.baseUid;
    this.selection = [];
    this.emit({ ids: new Set(level.objects.map((o) => o.id)), settings: true, structure: true, source: 'load', label: 'Load' });
    this.emitSel();
  }

  get(id: string) {
    return this.byId.get(id);
  }

  /**
   * Make a change. `merge`: consecutive edits with the same key (within 2 s, or always when
   * `force`) fold into one undo step - used for typing in fields and dragging handles.
   */
  edit(label: string, fn: (tx: Tx) => void, opts: { merge?: string; select?: string[] } = {}) {
    const tx = new Tx(this);
    const selBefore = this.selection.slice();
    try {
      fn(tx);
    } catch (e) {
      // roll back whatever was done so the document never ends up half-edited
      this.rollback(tx);
      throw e;
    }
    if (opts.select) this.selection = opts.select.filter((id) => id === SPAWN_ID || this.byId.has(id));
    const objs = new Map<string, { before: Snap; after: Snap }>();
    for (const [id, { before }] of tx.objs) {
      const o = this.byId.get(id);
      const after: Snap = o ? { idx: this.level.objects.indexOf(o), obj: clone(o) } : null;
      if (before === null && after === null) continue;
      if (before && after && before.idx === after.idx && JSON.stringify(before.obj) === JSON.stringify(after.obj)) continue;
      objs.set(id, { before, after });
    }
    let settingsAfter: string | undefined;
    if (tx.settingsBefore !== undefined) {
      settingsAfter = settingsSnap(this.level);
      if (settingsAfter === tx.settingsBefore) settingsAfter = undefined;
    }
    if (objs.size === 0 && settingsAfter === undefined) {
      if (opts.select) this.emitSel();
      return false;
    }
    const now = performance.now();
    const top = this.undoStack[this.undoStack.length - 1];
    const structure = [...objs.values()].some((c) => !c.before || !c.after || c.before.idx !== c.after.idx);
    if (opts.merge && top && top.mergeKey === opts.merge && (now - top.time < 2000 || opts.merge.startsWith('drag:')) && this.redoStack.length === 0 && top.uid !== this.savedState) {
      for (const [id, c] of objs) {
        const prev = top.objs.get(id);
        if (prev) prev.after = c.after;
        else top.objs.set(id, c);
      }
      if (settingsAfter !== undefined) {
        if (top.settingsBefore === undefined) top.settingsBefore = tx.settingsBefore;
        top.settingsAfter = settingsAfter;
      }
      top.time = now;
      top.selAfter = this.selection.slice();
    } else {
      this.undoStack.push({
        uid: uidCounter++,
        label,
        objs,
        settingsBefore: settingsAfter !== undefined ? tx.settingsBefore : undefined,
        settingsAfter,
        mergeKey: opts.merge,
        time: now,
        selBefore,
        selAfter: this.selection.slice(),
      });
      if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
    }
    this.redoStack = [];
    this.emit({ ids: new Set(objs.keys()), settings: settingsAfter !== undefined, structure, source: 'edit', label });
    if (opts.select) this.emitSel();
    return true;
  }

  /** End the current merge run so the next edit starts a new undo step. */
  breakMerge() {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top) top.mergeKey = undefined;
  }

  private rollback(tx: Tx) {
    const fake: Entry = { uid: 0, label: '', objs: new Map(), time: 0, selBefore: [], selAfter: [] };
    for (const [id, { before }] of tx.objs) {
      const o = this.byId.get(id);
      fake.objs.set(id, { before, after: o ? { idx: this.level.objects.indexOf(o), obj: o } : null });
    }
    this.apply(fake, 'before');
    if (tx.settingsBefore !== undefined) restoreSettings(this.level, tx.settingsBefore);
  }

  private apply(e: Entry, side: 'before' | 'after') {
    const list = this.level.objects;
    // remove every touched object, then re-insert the wanted side in ascending index order
    for (const id of e.objs.keys()) {
      const o = this.byId.get(id);
      if (o) {
        list.splice(list.indexOf(o), 1);
        this.byId.delete(id);
      }
    }
    const ins = [...e.objs.values()].map((c) => c[side]).filter((s): s is NonNullable<Snap> => !!s);
    ins.sort((a, b) => a.idx - b.idx);
    for (const s of ins) {
      const o = clone(s.obj);
      list.splice(Math.min(s.idx, list.length), 0, o);
      this.byId.set(o.id, o);
    }
    const st = side === 'before' ? e.settingsBefore : e.settingsAfter;
    if (st !== undefined) restoreSettings(this.level, st);
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.apply(e, 'before');
    this.redoStack.push(e);
    this.selection = e.selBefore.filter((id) => id === SPAWN_ID || this.byId.has(id));
    this.emit({ ids: new Set(e.objs.keys()), settings: e.settingsAfter !== undefined, structure: true, source: 'undo', label: e.label });
    this.emitSel();
    return true;
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.apply(e, 'after');
    this.undoStack.push(e);
    e.mergeKey = undefined;
    this.selection = e.selAfter.filter((id) => id === SPAWN_ID || this.byId.has(id));
    this.emit({ ids: new Set(e.objs.keys()), settings: e.settingsAfter !== undefined, structure: true, source: 'redo', label: e.label });
    this.emitSel();
    return true;
  }

  // ---- selection ----

  select(ids: string[], mode: 'set' | 'add' | 'toggle' = 'set') {
    ids = ids.filter((id) => id === SPAWN_ID || this.byId.has(id));
    let next: string[];
    if (mode === 'set') next = ids;
    else if (mode === 'add') next = [...this.selection.filter((s) => !ids.includes(s)), ...ids];
    else {
      next = this.selection.slice();
      for (const id of ids) {
        const i = next.indexOf(id);
        if (i >= 0) next.splice(i, 1);
        else next.push(id);
      }
    }
    if (next.length === this.selection.length && next.every((v, i) => v === this.selection[i])) return;
    this.selection = next;
    this.emitSel();
  }

  get active(): string | undefined {
    return this.selection[this.selection.length - 1];
  }
  isSelected(id: string) {
    return this.selection.includes(id);
  }

  private emit(e: ChangeEvent) {
    for (const l of this.listeners) l(e);
  }
  private emitSel() {
    for (const l of this.selListeners) l();
  }
}
