// The editor itself: owns the document, the view and the panels, and implements every command
// (place, select, transform, duplicate, copy/paste, files, play-test). Also exposes window.__editor.
import * as THREE from 'three';
import { openGame, type BootNote } from '../core/nav';
import { emptyLevel, newId, type LObject, type LevelData, type V3 } from '../world/leveldata';
import { Doc } from './state';
import { Viewport } from './viewport';
import { SceneSync } from './sync';
import { Gizmo, type GizmoMode } from './gizmo';
import { Palette } from './palette';
import { Inspector } from './inspector';
import { Outliner } from './outliner';
import { Toolbar } from './toolbar';
import { validate, ID_PATTERN, type Problem } from './validate';
import { showHelp, maybeWelcome } from './help';
import { h, modal, toast } from './ui';
import * as files from './files';
import { PALETTE_ENTRIES, SPAWN_ID, VOLUME_TYPES, baseY, objHeight, r3, rotAxes, setBaseY, displayName } from './defs';
import { Preview, applyTransform, buildBody, buildSpawnPreview } from './previews';

interface Placing {
  key: string;
  ghost: Preview;
  obj: LObject | null;
  yaw: number;
}

const CLIP_KEY = 'emg-editor-clipboard';

export class Editor {
  readonly doc: Doc;
  readonly vp: Viewport;
  readonly sync: SceneSync;
  readonly gizmo: Gizmo;
  readonly palette: Palette;
  readonly inspector: Inspector;
  readonly outliner: Outliner;
  readonly toolbar: Toolbar;
  problems: Problem[] = [];
  placing: Placing | null = null;
  patrolEdit: string | null = null;
  savedTo = '';
  serverOk = false;
  private clipboard: LObject[] = [];
  private pointer = { x: 0, y: 0, inView: false, moved: false };
  private cursorWorld: THREE.Vector3 | null = null;
  private autosaveTimer = 0;
  private validateTimer = 0;
  private leaving = false;
  private dragObjNo = 0;
  /** set by tests that wipe browser storage, so the page does not write it back while unloading */
  autosaveOff = false;

  constructor(root: HTMLElement, canvas: HTMLCanvasElement) {
    const ed = this;
    this.doc = new Doc(freshLevel());

    // ---- layout ----
    const vpHost = h('div', { class: 'vp-host' });
    vpHost.append(canvas);
    const left = h('div', { class: 'left' });
    const right = h('div', { class: 'right' });
    root.append(left, vpHost, right);

    this.vp = new Viewport(canvas, vpHost);
    this.vp.typing = () => isTyping();
    this.sync = new SceneSync(this.doc, this.vp);
    this.gizmo = new Gizmo(this.vp, this.doc, this.sync);
    this.palette = new Palette((key) => this.startPlacing(key));
    left.append(this.palette.el);

    this.outliner = new Outliner({
      doc: this.doc,
      isHidden: (id) => this.sync.hidden.has(id),
      setHidden: (id, v) => {
        this.sync.setHidden(id, v);
        this.gizmo.refresh();
        this.scheduleAutosave();
      },
      isLocked: (id) => this.isLocked(id),
      setLocked: (id, v) => this.setLocked(id, v),
      frame: (ids) => this.frame(ids),
    });
    this.inspector = new Inspector({
      doc: this.doc,
      setSky: (n) => this.vp.setSky(n),
      frame: (ids) => this.frame(ids),
      duplicate: () => this.duplicate(),
      remove: () => this.deleteSelection(),
      dropToFloor: () => this.dropToFloor(),
      get patrolEdit() {
        return ed.patrolEdit;
      },
      setPatrolEdit: (id) => this.setPatrolEdit(id),
      problems: () => this.problems,
      selectProblem: (p) => this.selectProblem(p),
      isLocked: (id) => this.isLocked(id),
      setLocked: (id, v) => this.setLocked(id, v),
      saveAs: () => void this.saveAs(),
    });
    const split = h('div', { class: 'splitter', title: 'Drag to resize' });
    right.append(this.outliner.el, split, this.inspector.el);
    this.bindSplitter(split, right);

    this.toolbar = new Toolbar(this);
    root.prepend(this.toolbar.top);
    root.append(this.toolbar.status);
    vpHost.append(this.toolbar.problemsPanel, this.toolbar.hintBox);

    // ---- wiring ----
    this.doc.onChange((e) => {
      if (e.settings) this.vp.setSky(this.doc.level.sky);
      this.gizmo.refresh();
      this.scheduleValidate();
      this.scheduleAutosave();
      this.toolbar.update();
      if (this.patrolEdit && !this.doc.get(this.patrolEdit)) this.setPatrolEdit(null);
    });
    this.doc.onSelect(() => {
      this.gizmo.refresh();
      this.toolbar.update();
      if (this.patrolEdit && !this.doc.isSelected(this.patrolEdit)) this.setPatrolEdit(null);
    });
    this.gizmo.onDragEnd.push(() => this.toolbar.update());
    this.vp.onFrame.push(() => this.frameUpdate());
    this.vp.onCameraChange.push(() => {
      this.toolbar.updateView();
      this.scheduleAutosave(4000);
    });
    this.bindPointer();
    this.bindKeys();
    this.bindDrop(vpHost);
    window.addEventListener('beforeunload', () => this.flushAutosave());
    window.addEventListener('pagehide', () => this.flushAutosave());
    setInterval(() => this.flushAutosave(), 20000);

    void files.hasServer().then((ok) => {
      this.serverOk = ok;
      this.toolbar.update();
    });
    this.restore();
    this.runValidate();
    this.toolbar.update();
    maybeWelcome(() => void this.openProjectLevel('sandbox'));
  }

  // ---- startup / autosave ----------------------------------------------------------------------

  private restore() {
    const a = files.readAutosave();
    if (a) {
      this.doc.load(a.level, a.dirty);
      this.savedTo = a.savedTo ?? '';
      for (const id of a.hidden ?? []) if (id === SPAWN_ID || this.doc.get(id)) this.sync.setHidden(id, true);
      if (a.camera) this.vp.setCamera(a.camera.pos, a.camera.yaw, a.camera.pitch);
      else this.cameraToSpawn();
      this.vp.setSky(a.level.sky);
      if (a.dirty) toast('Restored your unsaved work on “' + a.level.title + '” from ' + new Date(a.at).toLocaleTimeString(), 'ok');
    } else {
      this.cameraToSpawn();
      this.vp.setSky(this.doc.level.sky);
    }
  }

  cameraToSpawn() {
    const s = this.doc.level.spawn;
    const back = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw)).multiplyScalar(14);
    this.vp.setCamera([s.pos[0] + back.x, s.pos[1] + 9, s.pos[2] + back.z], s.yaw, -0.45);
  }

  scheduleAutosave(ms = 1200) {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => this.flushAutosave(), ms);
  }

  flushAutosave() {
    clearTimeout(this.autosaveTimer);
    if (this.autosaveOff) return true;
    const v = this.vp;
    const ok = files.writeAutosave({
      level: this.doc.level,
      dirty: this.doc.dirty,
      at: Date.now(),
      savedTo: this.savedTo,
      camera: { pos: [r3(v.pos.x), r3(v.pos.y), r3(v.pos.z)], yaw: r3(v.yaw), pitch: r3(v.pitch) },
      hidden: [...this.sync.hidden],
    });
    if (!ok && !this.leaving) this.toolbar.setSaveNote('Autosave FAILED (browser storage full?) — Export your level!', true);
    return ok;
  }

  // ---- validation --------------------------------------------------------------------------------

  private scheduleValidate() {
    clearTimeout(this.validateTimer);
    this.validateTimer = window.setTimeout(() => this.runValidate(), 250);
  }

  runValidate() {
    this.problems = validate(this.doc.level, {
      groundBelow: (x, y, z) => {
        const hit = this.vp.surfaceBelow(new THREE.Vector3(x, y, z));
        return !!hit && hit.id !== null;
      },
    });
    this.toolbar.updateProblems();
    this.inspector.problemsChanged();
    return this.problems;
  }

  selectProblem(p: Problem) {
    if (p.id === '__level') this.doc.select([]);
    else {
      this.doc.select([p.id]);
      this.frame([p.id]);
    }
  }

  // ---- locking / hiding --------------------------------------------------------------------------

  isLocked(id: string) {
    return id !== SPAWN_ID && !!this.doc.get(id)?.locked;
  }
  setLocked(id: string, v: boolean) {
    if (id === SPAWN_ID || !this.doc.get(id)) return;
    this.doc.edit(v ? 'Lock' : 'Unlock', (tx) => {
      const o = tx.touch(id);
      if (v) o.locked = true;
      else delete o.locked;
    });
  }
  lockedSet() {
    const s = new Set<string>();
    for (const o of this.doc.level.objects) if (o.locked) s.add(o.id);
    this.gizmo.locked = s;
    return s;
  }

  // ---- placing -----------------------------------------------------------------------------------

  startPlacing(key: string) {
    this.stopPlacing();
    this.setPatrolEdit(null);
    const e = PALETTE_ENTRIES[key];
    if (!e) return;
    const ghost = new Preview('__ghost');
    const obj = e.make ? e.make() : null;
    if (obj) buildBody(ghost, obj);
    else buildSpawnPreview(ghost);
    ghost.root.traverse((c) => (c.userData.pid = '__ghost'));
    ghost.root.visible = false;
    this.vp.scene.add(ghost.root);
    this.placing = { key, ghost, obj, yaw: obj ? 0 : this.doc.level.spawn.yaw };
    this.palette.setActive(key);
    this.gizmo.setEnabled(false);
    this.toolbar.setHint('Placing ' + e.label + ': click in the world to drop it. Shift-click to keep placing, R turns it, Esc stops.');
    if (this.pointer.inView) this.updateGhost();
    this.vp.request();
  }

  stopPlacing() {
    if (!this.placing) return;
    this.placing.ghost.dispose();
    this.placing = null;
    this.palette.setActive(null);
    this.gizmo.setEnabled(true);
    this.toolbar.setHint('');
    this.vp.request();
  }

  /** Where a new object would land under a screen point. */
  private dropPoint(cx: number, cy: number, obj: LObject | null): THREE.Vector3 | null {
    const hit = this.vp.pick(cx, cy, { surfaces: true });
    if (!hit) return null;
    const p = hit.point.clone();
    if (hit.normal.y < 0.5) {
      // clicked a wall: step out from it so the new thing does not end up inside
      const r = obj ? footprint(obj) : 0.4;
      p.addScaledVector(new THREE.Vector3(hit.normal.x, 0, hit.normal.z).normalize(), r);
    }
    if (this.gizmo.snapOn) {
      const g = this.gizmo.grid;
      p.x = Math.round(p.x / g) * g;
      p.z = Math.round(p.z / g) * g;
    }
    p.x = r3(p.x);
    p.y = r3(p.y);
    p.z = r3(p.z);
    return p;
  }

  private updateGhost() {
    const pl = this.placing;
    if (!pl) return;
    const p = this.dropPoint(this.pointer.x, this.pointer.y, pl.obj);
    pl.ghost.root.visible = !!p && this.pointer.inView;
    if (!p) return;
    if (pl.obj) {
      const o = pl.obj;
      o.pos = [p.x, p.y, p.z];
      setBaseY(o, p.y);
      if (rotAxes(o.type) !== 'none') o.rot = [0, pl.yaw, 0];
      applyTransform(pl.ghost, o);
    } else {
      pl.ghost.root.position.copy(p);
      pl.ghost.root.rotation.set(0, pl.yaw, 0);
    }
    this.vp.request();
  }

  /** Place the current palette item (or `key`) at a world point. Returns the new id. */
  placeAt(key: string, point: THREE.Vector3 | V3, yaw = 0): string | null {
    const e = PALETTE_ENTRIES[key];
    if (!e) return null;
    const p = Array.isArray(point) ? new THREE.Vector3(...point) : point;
    if (!e.make) {
      this.doc.edit(
        'Move player start',
        (tx) => {
          const s = tx.settings().spawn;
          s.pos = [r3(p.x), r3(p.y), r3(p.z)];
          s.yaw = yaw;
        },
        { select: [SPAWN_ID] },
      );
      return SPAWN_ID;
    }
    const o = e.make();
    o.pos = [r3(p.x), r3(p.y), r3(p.z)];
    setBaseY(o, p.y);
    if (yaw && rotAxes(o.type) !== 'none') o.rot = [0, Math.round(yaw * 1e5) / 1e5, 0];
    if (o.name) o.name = this.uniqueName(o.name);
    else if (o.type === 'marker' || o.type === 'trigger' || o.type === 'destructible') o.name = this.uniqueName(o.type === 'destructible' ? 'target' : o.type);
    this.doc.edit('Place ' + e.label, (tx) => tx.add(o), { select: [o.id] });
    return o.id;
  }

  uniqueName(base: string, taken = new Set(this.doc.level.objects.map((o) => o.name).filter(Boolean) as string[])) {
    const stem = base.replace(/\d+$/, '') || base;
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(stem + i)) return stem + i;
  }

  // ---- patrol editing ----------------------------------------------------------------------------

  setPatrolEdit(id: string | null) {
    if (id === this.patrolEdit) return;
    const prev = this.patrolEdit;
    this.patrolEdit = id;
    this.sync.patrolEdit = id;
    if (prev) this.sync.refreshPatrol(prev);
    if (id) {
      this.stopPlacing();
      this.sync.refreshPatrol(id);
      this.gizmo.setEnabled(false);
      this.toolbar.setHint('Patrol: click on the ground to add points, drag a white dot to move it. Esc or Enter when done.');
    } else {
      this.gizmo.setEnabled(true);
      this.toolbar.setHint('');
    }
    this.inspector.render();
  }

  addPatrolPoint(id: string, p: V3) {
    this.doc.edit('Add patrol point', (tx) => {
      const o = tx.touch(id);
      if (o.type !== 'enemy') return;
      (o.patrol ??= []).push([r3(p[0]), r3(p[1]), r3(p[2])]);
    });
  }

  // ---- pointer -----------------------------------------------------------------------------------

  private bindPointer() {
    const c = this.vp.canvas;
    type Down = { x: number; y: number; hitId: string | null; shift: boolean; mode: 'click' | 'marquee' | 'drag' | 'patrol'; patrolIdx?: number; start?: Map<string, V3>; spawn?: V3; plane?: number; grab?: THREE.Vector3; base?: THREE.Vector3 };
    let down: Down | null = null;
    const marquee = h('div', { class: 'marquee' });
    marquee.style.display = 'none';
    this.vp.host.append(marquee);

    c.addEventListener('pointerenter', () => (this.pointer.inView = true));
    c.addEventListener('pointerleave', () => {
      this.pointer.inView = false;
      if (this.placing) this.placing.ghost.root.visible = false;
      this.sync.setHover(null);
      this.vp.request();
    });

    c.addEventListener('pointerdown', (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      if (e.button !== 0 || e.altKey || (c as any).__camDrag) return;
      if (this.gizmo.hot || this.gizmo.dragging) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (this.placing) {
        const pl = this.placing;
        const p = this.dropPoint(e.clientX, e.clientY, pl.obj);
        if (p) this.placeAt(pl.key, p, pl.yaw);
        if (!e.shiftKey) this.stopPlacing();
        else this.updateGhost();
        return;
      }
      if (this.patrolEdit) {
        const hnd = this.sync.patrolHandleAt(e.clientX, e.clientY);
        if (hnd) {
          down = { x: e.clientX, y: e.clientY, hitId: null, shift: false, mode: 'patrol', patrolIdx: hnd.index };
          this.doc.breakMerge();
          c.setPointerCapture(e.pointerId);
          return;
        }
        const hit = this.vp.pick(e.clientX, e.clientY, { surfaces: true });
        if (hit) this.addPatrolPoint(this.patrolEdit, [hit.point.x, hit.point.y, hit.point.z]);
        return;
      }
      const hit = this.vp.pick(e.clientX, e.clientY, { locked: this.lockedSet() });
      down = { x: e.clientX, y: e.clientY, hitId: hit?.id ?? null, shift: e.shiftKey || e.ctrlKey || e.metaKey, mode: 'click' };
      if (hit?.id) down.grab = hit.point;
      c.setPointerCapture(e.pointerId);
    });

    c.addEventListener('pointermove', (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.inView = true;
      this.pointer.moved = true;
      if (this.placing) this.updateGhost();
      if (!down) return;
      const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (down.mode === 'patrol') {
        const id = this.patrolEdit!;
        const hit = this.vp.pick(e.clientX, e.clientY, { surfaces: true, exclude: new Set([id]) });
        if (hit) {
          const i = down.patrolIdx!;
          this.doc.edit('Move patrol point', (tx) => {
            const o = tx.touch(id);
            if (o.type === 'enemy' && o.patrol?.[i]) o.patrol[i] = [r3(hit.point.x), r3(hit.point.y), r3(hit.point.z)];
          }, { merge: 'drag:patrol' + i });
        }
        return;
      }
      if (down.mode === 'click' && dist > 5) {
        if (down.hitId && !down.shift) {
          // start sliding the object(s) along the ground
          if (!this.doc.isSelected(down.hitId)) this.doc.select([down.hitId]);
          const ids = this.gizmo.targets();
          if (!ids.length) {
            down = null;
            return;
          }
          const act = ids.includes(down.hitId) ? down.hitId : ids[ids.length - 1];
          const base = this.gizmo.basePoint(act);
          down.mode = 'drag';
          down.base = base;
          down.plane = base.y;
          const g = this.vp.groundAt(down.x, down.y, base.y) ?? base.clone();
          down.grab = g.sub(base);
          down.start = new Map(ids.filter((id) => id !== SPAWN_ID).map((id) => [id, this.doc.get(id)!.pos.slice() as V3]));
          if (ids.includes(SPAWN_ID)) down.spawn = this.doc.level.spawn.pos.slice() as V3;
          this.dragObjNo++;
          this.doc.breakMerge();
        } else {
          down.mode = 'marquee';
          marquee.style.display = '';
        }
      }
      if (down.mode === 'drag') {
        const g = this.vp.groundAt(e.clientX, e.clientY, down.plane!);
        if (!g) return;
        const p = g.sub(down.grab!);
        if (this.gizmo.snapOn) {
          const s = this.gizmo.grid;
          p.x = Math.round(p.x / s) * s;
          p.z = Math.round(p.z / s) * s;
        }
        const dx = p.x - down.base!.x;
        const dz = p.z - down.base!.z;
        const d = down;
        this.doc.edit(
          'Move',
          (tx) => {
            for (const [id, s] of d.start!) {
              const o = tx.touch(id);
              const old = o.pos;
              o.pos = [r3(s[0] + dx), s[1], r3(s[2] + dz)];
              if (o.type === 'enemy' && o.patrol) {
                const mx = o.pos[0] - old[0];
                const mz = o.pos[2] - old[2];
                o.patrol = o.patrol.map((q) => [r3(q[0] + mx), q[1], r3(q[2] + mz)] as V3);
              }
            }
            if (d.spawn) tx.settings().spawn.pos = [r3(d.spawn[0] + dx), d.spawn[1], r3(d.spawn[2] + dz)];
          },
          { merge: 'drag:obj' + this.dragObjNo },
        );
      } else if (down.mode === 'marquee') {
        const r = this.vp.host.getBoundingClientRect();
        const x0 = Math.min(down.x, e.clientX) - r.left;
        const y0 = Math.min(down.y, e.clientY) - r.top;
        Object.assign(marquee.style, { left: x0 + 'px', top: y0 + 'px', width: Math.abs(e.clientX - down.x) + 'px', height: Math.abs(e.clientY - down.y) + 'px' });
      }
    });

    const up = (e: PointerEvent) => {
      if (!down) return;
      const d = down;
      down = null;
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      if (d.mode === 'patrol' || d.mode === 'drag') {
        this.doc.breakMerge();
        return;
      }
      if (d.mode === 'marquee') {
        marquee.style.display = 'none';
        const x0 = Math.min(d.x, e.clientX);
        const x1 = Math.max(d.x, e.clientX);
        const y0 = Math.min(d.y, e.clientY);
        const y1 = Math.max(d.y, e.clientY);
        const locked = this.lockedSet();
        const ids: string[] = [];
        for (const [id, p] of this.vp.previews) {
          if (p.hidden || locked.has(id) || !p.root.parent) continue;
          // big volumes (nav areas, floors) are only box-selected if fully inside
          const c3 = p.bbox.getCenter(new THREE.Vector3()).applyMatrix4(p.root.matrixWorld);
          const s = this.vp.toScreen(c3);
          if (s && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) ids.push(id);
        }
        this.doc.select(ids, d.shift ? 'add' : 'set');
        return;
      }
      // click
      if (d.hitId) this.doc.select([d.hitId], d.shift ? 'toggle' : 'set');
      else if (!d.shift) this.doc.select([]);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('dblclick', (e) => {
      if (this.placing || this.patrolEdit) return;
      const hit = this.vp.pick(e.clientX, e.clientY, { locked: this.lockedSet() });
      if (hit?.id) this.frame([hit.id]);
    });
  }

  /** Hover highlight + cursor read-out, once per frame at most. */
  private frameUpdate() {
    if (!this.pointer.moved) return;
    this.pointer.moved = false;
    if (!this.pointer.inView) return;
    const busy = this.gizmo.dragging || (this.vp.canvas as any).__camDrag;
    const hit = this.vp.pick(this.pointer.x, this.pointer.y, { surfaces: true });
    this.cursorWorld = hit ? hit.point : null;
    this.toolbar.setCursor(this.cursorWorld);
    if (!busy && !this.placing && !this.patrolEdit) {
      const h2 = this.vp.pick(this.pointer.x, this.pointer.y, { locked: this.lockedSet() });
      this.sync.setHover(h2?.id ?? null);
      this.vp.canvas.style.cursor = this.gizmo.hot ? 'pointer' : h2?.id ? 'pointer' : 'default';
    } else this.vp.canvas.style.cursor = this.placing || this.patrolEdit ? 'crosshair' : 'default';
  }

  private bindDrop(host: HTMLElement) {
    const c = this.vp.canvas;
    c.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('text/x-emg-palette')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    c.addEventListener('drop', (e) => {
      const key = e.dataTransfer?.getData('text/x-emg-palette');
      if (!key) return;
      e.preventDefault();
      e.stopPropagation();
      const obj = PALETTE_ENTRIES[key]?.make?.() ?? null;
      const p = this.dropPoint(e.clientX, e.clientY, obj);
      if (p) this.placeAt(key, p);
    });
    // drop a .json file anywhere to import it
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        document.body.classList.add('dropping');
      }
    });
    window.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget) document.body.classList.remove('dropping');
    });
    window.addEventListener('drop', (e) => {
      document.body.classList.remove('dropping');
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      e.preventDefault();
      void this.importFile(f);
    });
    void host;
  }

  // ---- keyboard ----------------------------------------------------------------------------------

  private bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (document.querySelector('.modal-back, .help-back')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key;
      // always-on file shortcuts, even while typing
      if (ctrl && (k === 's' || k === 'S')) {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        void (e.shiftKey ? this.saveAs() : this.save());
        return;
      }
      if (k === 'F5') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        void this.play(e.shiftKey);
        return;
      }
      if (isTyping()) return;
      if (ctrl) {
        const lk = k.toLowerCase();
        if (lk === 'z' && !e.shiftKey) this.undo();
        else if (lk === 'y' || (lk === 'z' && e.shiftKey)) this.redo();
        else if (lk === 'd') this.duplicate();
        else if (lk === 'c') this.copy();
        else if (lk === 'x') this.cut();
        else if (lk === 'v') this.paste();
        else if (lk === 'a') this.selectAll();
        else if (lk === 'o') void this.openDialog();
        else return;
        e.preventDefault();
        return;
      }
      if (e.altKey) return;
      switch (k) {
        case 'Escape':
          if (this.placing) this.stopPlacing();
          else if (this.patrolEdit) this.setPatrolEdit(null);
          else this.doc.select([]);
          break;
        case 'Enter':
          if (this.patrolEdit) this.setPatrolEdit(null);
          else return;
          break;
        case 'Delete':
        case 'Backspace':
          this.deleteSelection();
          break;
        case '1':
          this.setGizmoMode('translate');
          break;
        case '2':
          this.setGizmoMode('rotate');
          break;
        case '3':
          this.setGizmoMode('scale');
          break;
        case 'x':
        case 'X':
          this.setSnap(!this.gizmo.snapOn);
          break;
        case 'f':
        case 'F':
          this.frame(this.doc.selection.length ? this.doc.selection : null);
          break;
        case 't':
        case 'T':
          this.setTopView(!this.vp.topView);
          break;
        case 'g':
        case 'G':
          this.vp.showGrid = !this.vp.showGrid;
          this.vp.request();
          this.toolbar.updateView();
          break;
        case 'l':
        case 'L':
          this.vp.showLabels = !this.vp.showLabels;
          this.vp.request();
          this.toolbar.updateView();
          break;
        case 'h':
        case 'H':
        case '?':
          showHelp();
          break;
        case 'r':
        case 'R':
          this.rotateBy(e.shiftKey ? this.gizmo.angle : 90);
          break;
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight':
          this.nudgeArrow(k, e.shiftKey ? 4 : 1);
          break;
        case 'PageUp':
          this.nudge([0, 1, 0], e.shiftKey ? 4 : 1);
          break;
        case 'PageDown':
          this.nudge([0, -1, 0], e.shiftKey ? 4 : 1);
          break;
        case 'End':
          this.dropToFloor();
          break;
        default:
          return;
      }
      e.preventDefault();
    });
  }

  // ---- commands ----------------------------------------------------------------------------------

  undo() {
    if (this.gizmo.dragging) return;
    const label = this.doc.undoLabel;
    if (this.doc.undo()) this.toolbar.flash('Undid: ' + label);
    else this.toolbar.flash('Nothing to undo');
  }
  redo() {
    const label = this.doc.redoLabel;
    if (this.doc.redo()) this.toolbar.flash('Redid: ' + label);
    else this.toolbar.flash('Nothing to redo');
  }

  setGizmoMode(m: GizmoMode) {
    this.gizmo.setMode(m);
    this.toolbar.update();
  }
  setSnap(on: boolean, grid?: number, angle?: number) {
    this.gizmo.snapOn = on;
    if (grid) this.gizmo.grid = grid;
    if (angle) this.gizmo.angle = angle;
    this.gizmo.applySnap();
    this.toolbar.update();
  }
  setTopView(on: boolean) {
    this.vp.setTopView(on);
    this.toolbar.updateView();
  }

  selectAll() {
    const locked = this.lockedSet();
    this.doc.select(this.doc.level.objects.filter((o) => !locked.has(o.id) && !this.sync.hidden.has(o.id)).map((o) => o.id));
  }

  frame(ids: string[] | null) {
    let box: THREE.Box3;
    if (ids && ids.length) box = this.sync.bounds(ids);
    else {
      box = this.sync.bounds([...this.doc.level.objects.map((o) => o.id), SPAWN_ID]);
    }
    if (box.isEmpty()) return;
    // a huge floor should not make framing everything useless
    this.vp.frameBox(box);
  }

  deleteSelection() {
    const ids = this.doc.selection.filter((id) => id !== SPAWN_ID && !this.isLocked(id));
    if (!ids.length) {
      if (this.doc.selection.includes(SPAWN_ID)) toast('The player start cannot be deleted — move it instead', 'warn');
      else if (this.doc.selection.length) toast('Locked objects cannot be deleted — unlock them first', 'warn');
      return;
    }
    this.doc.edit('Delete ' + (ids.length === 1 ? displayName(this.doc.get(ids[0])!) : ids.length + ' objects'), (tx) => ids.forEach((id) => tx.remove(id)), { select: [] });
    this.toolbar.flash('Deleted ' + ids.length + ' object' + (ids.length === 1 ? '' : 's') + ' (Ctrl+Z to undo)');
  }

  /** Copies of objects with fresh ids and non-clashing names. */
  private cloneObjects(src: LObject[], offset: V3) {
    const taken = new Set(this.doc.level.objects.map((o) => o.name).filter(Boolean) as string[]);
    return src.map((s) => {
      const o = structuredClone(s);
      o.id = newId(o.type.slice(0, 2));
      if (o.name) {
        o.name = this.uniqueName(o.name, taken);
        taken.add(o.name);
      }
      delete o.locked;
      o.pos = [r3(o.pos[0] + offset[0]), r3(o.pos[1] + offset[1]), r3(o.pos[2] + offset[2])];
      if (o.type === 'enemy' && o.patrol) o.patrol = o.patrol.map((p) => [r3(p[0] + offset[0]), r3(p[1] + offset[1]), r3(p[2] + offset[2])] as V3);
      return o;
    });
  }

  duplicate() {
    const src = this.doc.selection.filter((id) => id !== SPAWN_ID).map((id) => this.doc.get(id)!).filter(Boolean);
    if (!src.length) return;
    const g = Math.max(1, this.gizmo.grid);
    const copies = this.cloneObjects(src, [g, 0, g]);
    this.doc.edit('Duplicate ' + copies.length, (tx) => copies.forEach((o) => tx.add(o)), { select: copies.map((o) => o.id) });
    this.toolbar.flash('Duplicated ' + copies.length + ' — the copy is selected');
  }

  copy() {
    const src = this.doc.selection.filter((id) => id !== SPAWN_ID).map((id) => this.doc.get(id)!).filter(Boolean);
    if (!src.length) return;
    this.clipboard = structuredClone(src);
    try {
      localStorage.setItem(CLIP_KEY, JSON.stringify(src));
    } catch {
      /* ignore */
    }
    this.toolbar.flash('Copied ' + src.length + ' object' + (src.length === 1 ? '' : 's'));
  }
  cut() {
    this.copy();
    this.deleteSelection();
  }
  paste(at?: V3) {
    let clip = this.clipboard;
    if (!clip.length) {
      try {
        clip = JSON.parse(localStorage.getItem(CLIP_KEY) ?? '[]');
      } catch {
        clip = [];
      }
    }
    if (!clip.length) {
      this.toolbar.flash('Nothing to paste');
      return;
    }
    // centre of the copied objects' bases
    const cx = clip.reduce((s, o) => s + o.pos[0], 0) / clip.length;
    const cz = clip.reduce((s, o) => s + o.pos[2], 0) / clip.length;
    const by = Math.min(...clip.map((o) => baseY(o)));
    let target: THREE.Vector3 | null = at ? new THREE.Vector3(...at) : null;
    if (!target && this.pointer.inView) target = this.dropPoint(this.pointer.x, this.pointer.y, clip[0]);
    let off: V3;
    if (target) {
      off = [target.x - cx, target.y - by, target.z - cz];
      if (this.gizmo.snapOn) {
        const g = this.gizmo.grid;
        off = [Math.round(off[0] / g) * g, off[1], Math.round(off[2] / g) * g];
      }
    } else off = [1, 0, 1];
    const copies = this.cloneObjects(clip, off);
    this.doc.edit('Paste ' + copies.length, (tx) => copies.forEach((o) => tx.add(o)), { select: copies.map((o) => o.id) });
    this.toolbar.flash('Pasted ' + copies.length);
  }

  /** Move the selection one grid step in the screen direction of an arrow key. */
  private nudgeArrow(k: string, mult: number) {
    let fx: number;
    let fz: number;
    if (this.vp.topView) {
      fx = 0;
      fz = -1;
    } else {
      fx = -Math.sin(this.vp.yaw);
      fz = -Math.cos(this.vp.yaw);
    }
    // snap the camera's forward to the closest world axis
    let ax: V3 = Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0, 0] : [0, 0, Math.sign(fz)];
    const right: V3 = [-ax[2], 0, ax[0]];
    if (k === 'ArrowDown') ax = [-ax[0], 0, -ax[2]];
    else if (k === 'ArrowRight') ax = right;
    else if (k === 'ArrowLeft') ax = [-right[0], 0, -right[2]];
    this.nudge(ax, mult);
  }

  nudge(dir: V3, mult = 1) {
    const ids = this.gizmo.targets();
    if (!ids.length) return;
    const s = (this.gizmo.snapOn ? this.gizmo.grid : 0.1) * mult;
    const d: V3 = [dir[0] * s, dir[1] * s, dir[2] * s];
    this.doc.edit(
      'Nudge',
      (tx) => {
        for (const id of ids) {
          if (id === SPAWN_ID) {
            const sp = tx.settings().spawn;
            sp.pos = [r3(sp.pos[0] + d[0]), r3(sp.pos[1] + d[1]), r3(sp.pos[2] + d[2])];
            continue;
          }
          const o = tx.touch(id);
          o.pos = [r3(o.pos[0] + d[0]), r3(o.pos[1] + d[1]), r3(o.pos[2] + d[2])];
          if (o.type === 'enemy' && o.patrol) o.patrol = o.patrol.map((p) => [r3(p[0] + d[0]), r3(p[1] + d[1]), r3(p[2] + d[2])] as V3);
        }
      },
      { merge: 'nudge' },
    );
  }

  rotateBy(degrees: number) {
    const a = THREE.MathUtils.degToRad(degrees);
    if (this.placing) {
      this.placing.yaw = Math.round((this.placing.yaw + a) * 1e5) / 1e5;
      this.updateGhost();
      return;
    }
    const ids = this.gizmo.targets();
    if (!ids.length) return;
    this.doc.edit(
      'Turn',
      (tx) => {
        for (const id of ids) {
          if (id === SPAWN_ID) {
            const sp = tx.settings().spawn;
            sp.yaw = Math.round((sp.yaw + a) * 1e5) / 1e5;
            continue;
          }
          const o = tx.touch(id);
          if (rotAxes(o.type) === 'none') continue;
          const r = o.rot ?? [0, 0, 0];
          let y = r[1] + a;
          // keep angles tidy: -180..180
          y = Math.atan2(Math.sin(y), Math.cos(y));
          o.rot = [r[0], Math.round(y * 1e5) / 1e5, r[2]];
          if (o.rot.every((v) => Math.abs(v) < 1e-6)) delete o.rot;
        }
      },
      { merge: 'turn' },
    );
  }

  dropToFloor() {
    const ids = this.gizmo.targets();
    if (!ids.length) return;
    const ex = new Set(ids);
    let moved = 0;
    this.doc.edit('Drop to floor', (tx) => {
      for (const id of ids) {
        if (id === SPAWN_ID) {
          const sp = tx.settings().spawn;
          const hit = this.vp.surfaceBelow(new THREE.Vector3(sp.pos[0], sp.pos[1] + 1, sp.pos[2]), ex);
          if (hit) {
            sp.pos = [sp.pos[0], r3(hit.point.y + 0.1), sp.pos[2]];
            moved++;
          }
          continue;
        }
        const o = tx.touch(id);
        const top = baseY(o) + Math.max(0.05, objHeight(o));
        const hit = this.vp.surfaceBelow(new THREE.Vector3(o.pos[0], top, o.pos[2]), ex);
        if (!hit) continue;
        const dy = hit.point.y - baseY(o);
        setBaseY(o, hit.point.y);
        if (o.type === 'enemy' && o.patrol) o.patrol = o.patrol.map((p) => [p[0], r3(p[1] + dy), p[2]] as V3);
        moved++;
      }
    });
    this.toolbar.flash(moved ? 'Dropped ' + moved + ' onto the surface below' : 'Nothing below to drop onto');
  }

  // ---- files -------------------------------------------------------------------------------------

  private needsName() {
    const id = this.doc.level.id;
    return !ID_PATTERN.test(id) || id === 'untitled' || id === 'custom';
  }

  async save(): Promise<string> {
    if (this.needsName()) return (await this.saveAs()) ?? 'cancelled';
    const level = this.doc.level;
    const where: string[] = [];
    let err = '';
    if (files.saveBrowser(level)) where.push('this browser');
    try {
      if (await files.saveProject(level)) where.unshift('the project (public/levels/' + level.id + '.json)');
    } catch (e) {
      err = String((e as Error).message ?? e);
    }
    if (!where.length) {
      toast('Could not save anywhere! Use Export to download a copy. ' + err, 'err', 8000);
      return 'failed';
    }
    this.doc.markSaved();
    this.savedTo = where.join(' and ');
    this.flushAutosave();
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msg = 'Saved “' + level.title + '” to ' + this.savedTo + ' at ' + time + (this.serverOk ? '' : ' — no project folder here, use Export to share the file');
    toast(err ? msg + ' (project save failed: ' + err + ')' : msg, err ? 'warn' : 'ok', 5000);
    this.toolbar.update();
    return this.savedTo;
  }

  /** Ask for a new id/title, then save. Resolves to where it was saved, or null when cancelled. */
  async saveAs(preset?: { id: string; title?: string }): Promise<string | null> {
    const L = this.doc.level;
    let id = preset?.id ?? (this.needsName() ? '' : L.id);
    let title = preset?.title ?? (L.title === 'Untitled' ? '' : L.title);
    if (!preset) {
      const idIn = h('input', { class: 'txt', value: id, placeholder: 'e.g. m02_docks', spellcheck: false }) as HTMLInputElement;
      const tIn = h('input', { class: 'txt', value: title, placeholder: 'e.g. Loading Docks', spellcheck: false }) as HTMLInputElement;
      const err = h('div', { class: 'field-warn' });
      const body = h(
        'div',
        { class: 'form' },
        h('label', { text: 'Level id (the file name: letters, digits, - and _)' }),
        idIn,
        h('label', { text: 'Title' }),
        tIn,
        err,
      );
      idIn.addEventListener('input', () => (err.textContent = idIn.value && !ID_PATTERN.test(idIn.value) ? 'Only letters, digits, - and _ (no spaces)' : ''));
      tIn.addEventListener('input', () => {
        if (!idIn.dataset.touched) idIn.value = tIn.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
      });
      idIn.addEventListener('input', () => (idIn.dataset.touched = '1'));
      const p = modal({ title: 'Save level as', body, buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'Save', primary: true }] });
      setTimeout(() => (title ? idIn : tIn).focus(), 30);
      for (const inp of [idIn, tIn])
        inp.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (document.querySelector('.modal .btn.primary') as HTMLElement)?.click();
        });
      if ((await p) !== 'ok') return null;
      id = idIn.value.trim();
      title = tIn.value.trim() || id;
      if (!ID_PATTERN.test(id)) {
        toast('That id is not valid — use letters, digits, - and _', 'err');
        return null;
      }
      const exists = files.listBrowser().some((l) => l.id === id) || (await files.listProject()).some((l) => l.id === id);
      if (exists && id !== L.id) {
        const r = await modal({ title: 'Replace “' + id + '”?', body: 'A level with this id already exists. Saving replaces it.', buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'Replace it', danger: true }] });
        if (r !== 'ok') return null;
      }
    }
    this.doc.edit('Rename level', (tx) => {
      const l = tx.settings();
      l.id = id;
      if (title) l.title = title;
    });
    return await this.save();
  }

  async confirmDiscard(action: string): Promise<boolean> {
    if (!this.doc.dirty) return true;
    const r = await modal({
      title: 'Unsaved changes',
      body: `“${this.doc.level.title}” has changes that are not saved. ${action} anyway? (A backup is kept: Open → Recover.)`,
      buttons: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'discard', label: 'Discard changes', danger: true },
        { id: 'save', label: 'Save first', primary: true },
      ],
    });
    if (r === 'save') return (await this.save()) !== 'cancelled' && !this.doc.dirty;
    if (r === 'discard') {
      files.writeBackup(this.doc.level);
      return true;
    }
    return false;
  }

  /** Swap in a new level (after confirming). */
  load(level: LevelData, savedTo: string, dirty = false) {
    this.stopPlacing();
    this.setPatrolEdit(null);
    this.doc.load(level, dirty);
    this.savedTo = savedTo;
    this.vp.setSky(level.sky);
    this.cameraToSpawn();
    this.runValidate();
    this.flushAutosave();
    this.toolbar.update();
  }

  async newLevel(force = false) {
    if (!force && !(await this.confirmDiscard('Start a new level'))) return;
    this.load(freshLevel(), '');
    toast('New level. Build away — Save asks for a name.', 'info');
  }

  async openProjectLevel(id: string, force = false) {
    try {
      const l = await files.loadProject(id);
      if (!force && !(await this.confirmDiscard('Open another level'))) return false;
      this.load(l, 'the project');
      toast('Opened “' + l.title + '” from the project', 'ok');
      return true;
    } catch (e) {
      toast(String((e as Error).message ?? e), 'err', 6000);
      return false;
    }
  }

  async openDialog() {
    const [proj, ok] = await Promise.all([files.listProject(), files.hasServer()]);
    const browser = files.listBrowser();
    const backup = files.readBackup();
    let choice: { where: 'project' | 'browser' | 'backup' | 'file'; id?: string } | null = null;
    const body = h('div', { class: 'open-list' });
    const item = (title: string, sub: string, fn: () => void, extra?: HTMLElement) =>
      h('div', { class: 'open-item' }, h('button', { class: 'open-main', onclick: fn }, h('b', { text: title }), h('span', { text: sub })), extra ?? null);
    const close = () => (document.querySelector('.modal-back') as any)?.__close?.('picked');
    body.append(h('h3', { text: ok ? 'In the project (public/levels)' : 'Shipped with the game' }));
    if (!proj.length) body.append(h('div', { class: 'hint', text: 'No level files found.' }));
    for (const l of proj) body.append(item(l.title || l.id, l.id + (l.number ? ' · ' + l.number : ''), () => ((choice = { where: 'project', id: l.id }), close())));
    body.append(h('h3', { text: 'Saved in this browser' }));
    if (!browser.length) body.append(h('div', { class: 'hint', text: 'Nothing yet — Save always keeps a copy here too.' }));
    for (const l of browser)
      body.append(
        item(
          l.title || l.id,
          l.id + ' · ' + new Date(l.savedAt ?? 0).toLocaleString(),
          () => ((choice = { where: 'browser', id: l.id }), close()),
          h('button', {
            class: 'icon-btn',
            text: '✕',
            title: 'Delete this browser copy',
            onclick: (e: Event) => {
              e.stopPropagation();
              files.deleteBrowser(l.id);
              (e.target as HTMLElement).closest('.open-item')?.remove();
            },
          }),
        ),
      );
    if (backup) {
      body.append(h('h3', { text: 'Recover' }));
      body.append(item('Last discarded work: ' + backup.level.title, new Date(backup.at).toLocaleString(), () => ((choice = { where: 'backup' }), close())));
    }
    body.append(h('div', { class: 'btnrow' }, h('button', { class: 'btn', text: 'Import a .json file…', onclick: () => ((choice = { where: 'file' }), close()) })));
    await modal({ title: 'Open a level', body, buttons: [{ id: 'cancel', label: 'Cancel' }], wide: true });
    const c = choice as unknown as { where: 'project' | 'browser' | 'backup' | 'file'; id?: string } | null;
    if (!c) return;
    if (c.where === 'project') await this.openProjectLevel(c.id!);
    else if (c.where === 'browser') {
      const l = files.loadBrowser(c.id!);
      if (l && (await this.confirmDiscard('Open another level'))) {
        this.load(l, 'this browser');
        toast('Opened “' + l.title + '” from this browser', 'ok');
      }
    } else if (c.where === 'backup') {
      if (await this.confirmDiscard('Recover the backup')) this.load(backup!.level, '', true);
    } else if (c.where === 'file') await this.importDialog();
  }

  exportJson() {
    files.download(this.doc.level);
    toast('Downloaded ' + this.doc.level.id + '.json', 'ok');
  }

  async importDialog() {
    const f = await files.pickFile();
    if (f) await this.importFile(f);
  }

  async importFile(f: File) {
    try {
      const text = await f.text();
      return await this.importText(text, f.name);
    } catch (e) {
      toast('Could not import ' + f.name + ': ' + String((e as Error).message ?? e), 'err', 6000);
      return false;
    }
  }

  async importText(text: string, name = 'file', force = false) {
    let level: LevelData;
    try {
      level = files.normalizeLevel(JSON.parse(text));
    } catch (e) {
      toast('Could not import ' + name + ': ' + String((e as Error).message ?? e), 'err', 6000);
      return false;
    }
    if (!force && !(await this.confirmDiscard('Import ' + name))) return false;
    this.load(level, '', true);
    toast('Imported “' + level.title + '” (' + level.objects.length + ' objects). Save to keep it.', 'ok');
    return true;
  }

  // ---- play-test ---------------------------------------------------------------------------------

  /** Spawn point for "play from here": the surface under the cursor, else under the view centre. */
  playFromHerePoint(): { pos: V3; yaw: number } | null {
    let hit = this.pointer.inView ? this.vp.pick(this.pointer.x, this.pointer.y, { surfaces: true }) : null;
    if (!hit) {
      const r = this.vp.canvas.getBoundingClientRect();
      hit = this.vp.pick(r.left + r.width / 2, r.top + r.height / 2, { surfaces: true });
    }
    if (!hit) return null;
    const yaw = this.vp.topView ? this.doc.level.spawn.yaw : this.vp.yaw;
    return { pos: [r3(hit.point.x), r3(hit.point.y + 0.1), r3(hit.point.z)], yaw: Math.round(yaw * 1e4) / 1e4 };
  }

  async play(fromHere = false, opts: { dryRun?: boolean; force?: boolean } = {}) {
    const errors = this.runValidate().filter((p) => p.sev === 'error');
    if (errors.length && !opts.force) {
      const body = h('div', {}, h('p', { text: 'The level has problems that may break the play-test:' }), h('ul', { class: 'prob-list' }, ...errors.slice(0, 8).map((p) => h('li', { text: p.text }))));
      const r = await modal({ title: errors.length + ' problem' + (errors.length === 1 ? '' : 's'), body, buttons: [{ id: 'cancel', label: 'Fix them first' }, { id: 'ok', label: 'Play anyway', primary: true }] });
      if (r !== 'ok') {
        this.toolbar.showProblems(true);
        return null;
      }
    }
    const spawn = fromHere ? this.playFromHerePoint() ?? undefined : undefined;
    if (!files.writePlaytest(this.doc.level, spawn)) {
      toast('Could not hand the level to the game (browser storage full?)', 'err', 6000);
      return null;
    }
    this.flushAutosave();
    // the game is the same page without #editor; the note tells it what to load (src/core/nav.ts)
    const note: BootNote = { level: 'custom', from: 'editor' };
    if (!opts.dryRun) {
      this.leaving = true;
      openGame(note);
    }
    return { note, spawn: spawn ?? null };
  }

  // ---- misc --------------------------------------------------------------------------------------

  private bindSplitter(split: HTMLElement, right: HTMLElement) {
    let start = 0;
    let h0 = 0;
    const out = this.outliner.el;
    try {
      const v = +(localStorage.getItem('emg-editor-split') ?? 0);
      if (v > 80) out.style.height = v + 'px';
    } catch {
      /* ignore */
    }
    split.addEventListener('pointerdown', (e) => {
      start = e.clientY;
      h0 = out.getBoundingClientRect().height;
      split.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const v = Math.max(90, Math.min(right.getBoundingClientRect().height - 160, h0 + ev.clientY - start));
        out.style.height = v + 'px';
      };
      const up = () => {
        split.removeEventListener('pointermove', move);
        split.removeEventListener('pointerup', up);
        try {
          localStorage.setItem('emg-editor-split', String(Math.round(out.getBoundingClientRect().height)));
        } catch {
          /* ignore */
        }
      };
      split.addEventListener('pointermove', move);
      split.addEventListener('pointerup', up);
    });
  }

  /** Scripting surface for automated tests and power users (window.__editor). */
  api() {
    const ed = this;
    return {
      ed,
      THREE,
      get level() {
        return ed.doc.level;
      },
      getLevel: () => structuredClone(ed.doc.level),
      json: () => files.toJson(ed.doc.level),
      setLevel: (l: LevelData, dirty = false) => ed.load(files.normalizeLevel(structuredClone(l)), '', dirty),
      newLevel: () => ed.newLevel(true),
      select: (ids: string | string[], mode: 'set' | 'add' | 'toggle' = 'set') => ed.doc.select(Array.isArray(ids) ? ids : [ids], mode),
      selection: () => ed.doc.selection.slice(),
      get: (id: string) => structuredClone(ed.doc.get(id)),
      add: (o: Partial<LObject> & { type: LObject['type'] }, key?: string) => {
        const base = key ? PALETTE_ENTRIES[key]?.make?.() : Object.values(PALETTE_ENTRIES).find((e) => e.make && e.make().type === o.type)?.make?.();
        const obj = { ...(base ?? {}), ...o, id: o.id ?? base?.id ?? newId(o.type.slice(0, 2)) } as LObject;
        ed.doc.edit('Add ' + obj.type, (tx) => tx.add(obj), { select: [obj.id] });
        return obj.id;
      },
      addMany: (list: (Partial<LObject> & { type: LObject['type'] })[]) => {
        const objs = list.map((o) => {
          const base = Object.values(PALETTE_ENTRIES).find((e) => e.make && e.make().type === o.type)?.make?.();
          return { ...(base ?? {}), ...o, id: o.id ?? newId(o.type.slice(0, 2)) } as LObject;
        });
        ed.doc.edit('Add ' + objs.length, (tx) => objs.forEach((o) => tx.add(o)));
        return objs.map((o) => o.id);
      },
      update: (id: string, patch: Record<string, unknown>) =>
        ed.doc.edit('Edit', (tx) => {
          if (id === SPAWN_ID) Object.assign(tx.settings().spawn, patch);
          else {
            const o = tx.touch(id) as any;
            for (const [k, v] of Object.entries(patch)) if (v === undefined) delete o[k];
              else o[k] = v;
          }
        }),
      settings: (patch: Partial<LevelData>) => ed.doc.edit('Edit level', (tx) => Object.assign(tx.settings(), patch)),
      remove: (ids: string | string[]) => ed.doc.edit('Delete', (tx) => (Array.isArray(ids) ? ids : [ids]).forEach((id) => tx.remove(id))),
      place: (key: string, pos: V3, yaw = 0) => ed.placeAt(key, pos, yaw),
      startPlacing: (key: string) => ed.startPlacing(key),
      stopPlacing: () => ed.stopPlacing(),
      undo: () => ed.doc.undo(),
      redo: () => ed.doc.redo(),
      canUndo: () => ed.doc.canUndo,
      history: () => ed.doc.historySize,
      dirty: () => ed.doc.dirty,
      duplicate: () => ed.duplicate(),
      copy: () => ed.copy(),
      paste: (at?: V3) => ed.paste(at),
      deleteSelection: () => ed.deleteSelection(),
      nudge: (d: V3, m = 1) => ed.nudge(d, m),
      rotateBy: (deg: number) => ed.rotateBy(deg),
      dropToFloor: () => ed.dropToFloor(),
      gizmo: (m: GizmoMode) => ed.setGizmoMode(m),
      snap: (on: boolean, grid?: number, angle?: number) => ed.setSnap(on, grid, angle),
      problems: () => ed.runValidate().map((p) => ({ ...p })),
      topView: (on: boolean) => ed.setTopView(on),
      gameLook: (on: boolean) => {
        ed.vp.setGameLook(on);
        ed.toolbar.updateView();
      },
      camera: (pos: V3, yaw: number, pitch: number) => ed.vp.setCamera(pos, yaw, pitch),
      cameraState: () => ({ pos: ed.vp.pos.toArray(), yaw: ed.vp.yaw, pitch: ed.vp.pitch, top: ed.vp.topView, topState: { ...ed.vp.top } }),
      frame: (ids?: string[]) => ed.frame(ids ?? null),
      toScreen: (p: V3) => ed.vp.toScreen(new THREE.Vector3(...p)),
      objectScreen: (id: string) => {
        const p = ed.vp.previews.get(id);
        if (!p) return null;
        const c = p.bbox.getCenter(new THREE.Vector3()).applyMatrix4(p.root.matrixWorld);
        return ed.vp.toScreen(c);
      },
      pick: (x: number, y: number) => ed.vp.pick(x, y, { locked: ed.lockedSet() })?.id ?? null,
      surfaceAt: (x: number, y: number) => ed.vp.pick(x, y, { surfaces: true })?.point.toArray() ?? null,
      gizmoScreen: () => {
        if (!ed.gizmo.tc.object) return null;
        return ed.vp.toScreen(ed.gizmo.pivot.position);
      },
      save: () => ed.save(),
      saveAs: (id: string, title?: string) => ed.saveAs({ id, title }),
      open: (id: string) => ed.openProjectLevel(id, true),
      openBrowser: (id: string) => {
        const l = files.loadBrowser(id);
        if (l) ed.load(l, 'this browser');
        return !!l;
      },
      listBrowser: () => files.listBrowser(),
      listProject: () => files.listProject(),
      exportJson: () => files.toJson(ed.doc.level),
      download: () => ed.exportJson(),
      importJson: (text: string) => ed.importText(text, 'script', true),
      flushAutosave: () => ed.flushAutosave(),
      resetStorage: () => {
        ed.autosaveOff = true;
        for (const k of Object.keys(localStorage)) if (k.startsWith('emg-editor')) localStorage.removeItem(k);
      },
      play: (fromHere = false, dryRun = true) => ed.play(fromHere, { dryRun, force: true }),
      setPatrolEdit: (id: string | null) => ed.setPatrolEdit(id),
      setHidden: (id: string, v: boolean) => ed.sync.setHidden(id, v),
      setLocked: (id: string, v: boolean) => ed.setLocked(id, v),
      render: () => ed.vp.renderNow(),
      stats: () => ({ ...ed.vp.stats(), objects: ed.doc.level.objects.length, previews: ed.vp.previews.size, ...ed.sync.bakeStats() }),
      bake: () => ed.sync.bake(),
      help: () => showHelp(),
      palette: () => Object.keys(PALETTE_ENTRIES),
      volumes: () => ed.doc.level.objects.filter((o) => VOLUME_TYPES.has(o.type)).map((o) => o.id),
    };
  }
}

/** A new level: the default floor is named and locked, so clicking the ground clears the selection. */
function freshLevel(): LevelData {
  const l = emptyLevel('untitled', 'Untitled');
  const f = l.objects.find((o) => o.id === 'floor');
  if (f) {
    f.name = 'floor';
    f.locked = true;
  }
  return l;
}

function isTyping() {
  const a = document.activeElement as HTMLElement | null;
  if (!a) return false;
  const t = a.tagName;
  if (t === 'TEXTAREA' || t === 'SELECT') return true;
  if (t === 'INPUT') {
    const ty = (a as HTMLInputElement).type;
    return ty !== 'checkbox' && ty !== 'button' && ty !== 'color';
  }
  return a.isContentEditable;
}

function footprint(o: LObject) {
  if ('size' in o) return Math.max(o.size[0], o.size[2]) / 2;
  if (o.type === 'cyl') return o.r;
  return 0.5;
}
