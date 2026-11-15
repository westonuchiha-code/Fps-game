// Top toolbar, bottom status bar, the problems drawer and the hint box.
import type * as THREE from 'three';
import type { Editor } from './editor';
import { h } from './ui';
import { showHelp, maybeWelcome } from './help';
import type { GizmoMode } from './gizmo';

const GRIDS = [0.25, 0.5, 1, 2];
const ANGLES = [15, 45, 90];

export class Toolbar {
  readonly top: HTMLElement;
  readonly status: HTMLElement;
  readonly problemsPanel: HTMLElement;
  readonly hintBox: HTMLElement;
  private title: HTMLElement;
  private btns: Record<string, HTMLButtonElement> = {};
  private gridSel: HTMLSelectElement;
  private angSel: HTMLSelectElement;
  private sCursor: HTMLElement;
  private sSnap: HTMLElement;
  private sSel: HTMLElement;
  private sSave: HTMLElement;
  private sProblems: HTMLButtonElement;
  private sHint: HTMLElement;
  private flashTimer = 0;
  private hint = '';
  private viewMenu: HTMLElement;
  private saveNote = '';

  constructor(private ed: Editor) {
    const b = (id: string, label: string, tip: string, fn: () => void, cls = '') => {
      const el = h('button', { class: 'tb ' + cls, 'data-tip': tip, 'aria-label': tip, onclick: fn }, label) as HTMLButtonElement;
      el.dataset.id = id;
      this.btns[id] = el;
      return el;
    };
    const sep = () => h('span', { class: 'tb-sep' });
    this.title = h('div', { class: 'tb-title' });
    this.gridSel = h('select', { class: 'tb-sel', title: 'Grid step for moving and sizing' }, ...GRIDS.map((g) => h('option', { value: String(g), text: g + ' m' }))) as HTMLSelectElement;
    this.gridSel.value = String(ed.gizmo.grid);
    this.gridSel.addEventListener('change', () => {
      ed.setSnap(true, +this.gridSel.value);
      this.gridSel.blur();
    });
    this.angSel = h('select', { class: 'tb-sel', title: 'Angle step for rotating' }, ...ANGLES.map((a) => h('option', { value: String(a), text: a + '°' }))) as HTMLSelectElement;
    this.angSel.value = String(ed.gizmo.angle);
    this.angSel.addEventListener('change', () => {
      ed.setSnap(true, undefined, +this.angSel.value);
      this.angSel.blur();
    });

    const viewItem = (id: string, label: string, key: string, fn: () => void) => {
      const el = h('button', { class: 'menu-item', 'data-id': id, onclick: fn }, h('span', { class: 'mi-check' }), h('span', { class: 'mi-label', text: label }), h('kbd', { text: key }));
      this.btns[id] = el as HTMLButtonElement;
      return el;
    };
    this.viewMenu = h(
      'div',
      { class: 'menu' },
      viewItem('v-top', 'Top-down map', 'T', () => ed.setTopView(!ed.vp.topView)),
      viewItem('v-look', 'Game look (chunky pixels)', '', () => {
        ed.vp.setGameLook(!ed.vp.gameLook);
        this.updateView();
      }),
      viewItem('v-grid', 'Ground grid', 'G', () => {
        ed.vp.showGrid = !ed.vp.showGrid;
        ed.vp.request();
        this.updateView();
      }),
      viewItem('v-labels', 'Labels', 'L', () => {
        ed.vp.showLabels = !ed.vp.showLabels;
        ed.vp.request();
        this.updateView();
      }),
      viewItem('v-pad', 'Touch-pad mode (scroll pans)', '', () => {
        ed.vp.touchpad = !ed.vp.touchpad;
        try {
          localStorage.setItem('emg-editor-touchpad', ed.vp.touchpad ? '1' : '');
        } catch {
          /* ignore */
        }
        this.updateView();
      }),
      h('div', { class: 'menu-sep' }),
      h('button', { class: 'menu-item', onclick: () => ed.frame(null) }, h('span', { class: 'mi-check' }), h('span', { class: 'mi-label', text: 'Frame whole level' }), h('kbd', { text: 'F' })),
      h('button', { class: 'menu-item', onclick: () => ed.cameraToSpawn() }, h('span', { class: 'mi-check' }), h('span', { class: 'mi-label', text: 'Go to player start' }), h('kbd', { text: '' })),
      h('div', { class: 'menu-row' }, h('span', { text: 'Fly speed' }), this.speedInput()),
    );
    this.viewMenu.style.display = 'none';
    try {
      ed.vp.touchpad = !!localStorage.getItem('emg-editor-touchpad');
    } catch {
      /* ignore */
    }
    const viewBtn = b('view', 'View ▾', 'View options: map view, game look, grid, labels, touch-pad', () => {
      this.viewMenu.style.display = this.viewMenu.style.display === 'none' ? '' : 'none';
      this.updateView();
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.viewMenu.contains(e.target as Node) && e.target !== viewBtn) this.viewMenu.style.display = 'none';
    });

    this.top = h(
      'div',
      { class: 'topbar' },
      h('div', { class: 'tb-brand' }, h('span', { class: 'brand-a', text: 'EVERYTHING MUST GO' }), h('span', { class: 'brand-b', text: 'LEVEL EDITOR' })),
      this.title,
      h(
        'div',
        { class: 'tb-group' },
        b('new', 'New', 'Start a new, empty level', () => void ed.newLevel()),
        b('open', 'Open', 'Open a level from the project or this browser (Ctrl+O)', () => void ed.openDialog()),
        b('save', 'Save', 'Save (Ctrl+S): to the project folder when available, and always to this browser', () => void ed.save(), 'accent'),
        b('saveas', 'Save as', 'Save under a new level id (Ctrl+Shift+S)', () => void ed.saveAs()),
        b('import', 'Import', 'Load a .json level file (or drag one onto the window)', () => void ed.importDialog()),
        b('export', 'Export', 'Download this level as a .json file', () => ed.exportJson()),
      ),
      sep(),
      h('div', { class: 'tb-group' }, b('undo', '↶', 'Undo (Ctrl+Z)', () => ed.undo(), 'icon'), b('redo', '↷', 'Redo (Ctrl+Y)', () => ed.redo(), 'icon')),
      sep(),
      h(
        'div',
        { class: 'tb-group' },
        b('translate', '✥ Move', 'Move handles (1)', () => ed.setGizmoMode('translate')),
        b('rotate', '⟳ Rotate', 'Rotate handles (2)', () => ed.setGizmoMode('rotate')),
        b('scale', '⤢ Scale', 'Scale / resize handles (3)', () => ed.setGizmoMode('scale')),
      ),
      h('div', { class: 'tb-group' }, b('snap', 'Snap', 'Snapping on/off (X)', () => ed.setSnap(!ed.gizmo.snapOn)), this.gridSel, this.angSel),
      sep(),
      h('div', { class: 'tb-group tb-viewgrp' }, b('top', 'Map', 'Top-down map view (T)', () => ed.setTopView(!ed.vp.topView)), viewBtn, this.viewMenu),
      h('div', { class: 'tb-spacer' }),
      b('help', '?', 'All controls (H)', () => showHelp(), 'icon round'),
      h(
        'div',
        { class: 'tb-play' },
        b('playhere', 'from here', 'Play starting at the spot under the cursor / view centre (Shift+F5)', () => void ed.play(true), 'play-sub'),
        b('play', '▶ PLAY', 'Play-test this level (F5)', () => void ed.play(false), 'play'),
      ),
    );

    // ---- status bar ----
    this.sHint = h('span', { class: 'st-hint' });
    this.sCursor = h('span', { class: 'st-cursor', title: 'World position under the cursor (metres)' });
    this.sSnap = h('button', { class: 'st-chip', title: 'Click to toggle snapping (X)', onclick: () => ed.setSnap(!ed.gizmo.snapOn) });
    this.sSel = h('span', { class: 'st-sel' });
    this.sSave = h('span', { class: 'st-save' });
    this.sProblems = h('button', { class: 'st-chip prob', onclick: () => this.showProblems(this.problemsPanel.style.display === 'none') }) as HTMLButtonElement;
    this.status = h('div', { class: 'statusbar' }, this.sHint, h('span', { class: 'st-spacer' }), this.sCursor, this.sSnap, this.sSel, this.sProblems, this.sSave);

    this.problemsPanel = h('div', { class: 'problems' });
    this.problemsPanel.style.display = 'none';
    this.hintBox = h('div', { class: 'hintbox' });
    this.hintBox.style.display = 'none';
    void maybeWelcome;
  }

  private speedInput() {
    const i = h('input', { type: 'range', min: '3', max: '60', step: '1', value: String(this.ed.vp.flySpeed), title: 'Metres per second' }) as HTMLInputElement;
    i.addEventListener('input', () => (this.ed.vp.flySpeed = +i.value));
    return i;
  }

  /** Refresh every button state from the editor. */
  update() {
    const ed = this.ed;
    const L = ed.doc.level;
    this.title.textContent = '';
    this.title.append(h('b', { text: L.title || 'Untitled' }), h('span', { class: 'tb-id', text: L.id }), ed.doc.dirty ? h('span', { class: 'dirty', text: '● unsaved', title: 'Changes not saved yet (they are autosaved in this browser)' }) : h('span', { class: 'clean', text: '✓ saved' }));
    this.btns.undo.disabled = !ed.doc.canUndo;
    this.btns.redo.disabled = !ed.doc.canRedo;
    this.btns.undo.dataset.tip = ed.doc.canUndo ? 'Undo: ' + ed.doc.undoLabel + ' (Ctrl+Z)' : 'Nothing to undo';
    this.btns.redo.dataset.tip = ed.doc.canRedo ? 'Redo: ' + ed.doc.redoLabel + ' (Ctrl+Y)' : 'Nothing to redo';
    for (const m of ['translate', 'rotate', 'scale'] as GizmoMode[]) this.btns[m].classList.toggle('on', ed.gizmo.mode === m);
    this.btns.snap.classList.toggle('on', ed.gizmo.snapOn);
    this.gridSel.value = String(ed.gizmo.grid);
    this.angSel.value = String(ed.gizmo.angle);
    this.gridSel.disabled = this.angSel.disabled = !ed.gizmo.snapOn;
    this.sSnap.textContent = ed.gizmo.snapOn ? `Snap ${ed.gizmo.grid} m · ${ed.gizmo.angle}°` : 'Snap off';
    this.sSnap.classList.toggle('off', !ed.gizmo.snapOn);
    const n = ed.doc.selection.length;
    this.sSel.textContent = n ? n + ' selected' : L.objects.length + ' objects';
    const where = ed.serverOk ? 'project + browser' : 'browser only (no dev server)';
    this.sSave.textContent = this.saveNote || (ed.savedTo ? (ed.doc.dirty ? 'Unsaved changes · autosaved' : 'Saved to ' + ed.savedTo) : ed.doc.dirty ? 'Not saved yet · autosaved · Save goes to ' + where : 'Save goes to ' + where);
    this.sSave.classList.toggle('bad', !!this.saveNote);
    this.updateView();
  }

  setSaveNote(s: string, bad = false) {
    this.saveNote = bad ? s : '';
    this.update();
  }

  updateView() {
    const v = this.ed.vp;
    this.btns.top.classList.toggle('on', v.topView);
    const set = (id: string, on: boolean) => this.btns[id]?.classList.toggle('checked', on);
    set('v-top', v.topView);
    set('v-look', v.gameLook);
    set('v-grid', v.showGrid);
    set('v-labels', v.showLabels);
    set('v-pad', v.touchpad);
  }

  setCursor(p: THREE.Vector3 | null) {
    this.sCursor.textContent = p ? `X ${p.x.toFixed(2)}   Y ${p.y.toFixed(2)}   Z ${p.z.toFixed(2)}` : 'X —   Y —   Z —';
  }

  setHint(s: string) {
    this.hint = s;
    this.hintBox.textContent = s;
    this.hintBox.style.display = s ? '' : 'none';
    this.sHint.textContent = s || this.idleHint();
  }

  private idleHint() {
    return 'Right-drag look · WASD fly · wheel zoom · click select · 1/2/3 move/rotate/scale · H help';
  }

  /** Short message in the status bar. */
  flash(s: string) {
    this.sHint.textContent = s;
    this.sHint.classList.add('flash');
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.sHint.classList.remove('flash');
      this.sHint.textContent = this.hint || this.idleHint();
    }, 2600);
  }

  updateProblems() {
    const ps = this.ed.problems;
    const err = ps.filter((p) => p.sev === 'error').length;
    const warn = ps.filter((p) => p.sev === 'warn').length;
    this.sProblems.textContent = ps.length ? `⚠ ${err} error${err === 1 ? '' : 's'} · ${warn} warning${warn === 1 ? '' : 's'}` : '✓ No problems';
    this.sProblems.className = 'st-chip prob' + (err ? ' err' : warn ? ' warn' : ' ok');
    this.sProblems.title = 'Click to show the problems list';
    if (this.problemsPanel.style.display !== 'none') this.renderProblems();
    if (!this.sHint.textContent) this.sHint.textContent = this.idleHint();
  }

  showProblems(on: boolean) {
    this.problemsPanel.style.display = on ? '' : 'none';
    if (on) this.renderProblems();
  }

  private renderProblems() {
    const ps = this.ed.problems;
    const order = { error: 0, warn: 1, info: 2 };
    const sorted = ps.slice().sort((a, b) => order[a.sev] - order[b.sev]);
    this.problemsPanel.textContent = '';
    this.problemsPanel.append(
      h('div', { class: 'prob-head' }, h('b', { text: 'PROBLEMS' }), h('span', { text: ps.length ? 'click one to select what it is about' : '' }), h('button', { class: 'icon-btn', text: '✕', title: 'Close', onclick: () => this.showProblems(false) })),
    );
    const list = h('div', { class: 'prob-items' });
    if (!ps.length) list.append(h('div', { class: 'prob ok', text: 'Nothing to fix. Nice!' }));
    for (const p of sorted.slice(0, 200)) {
      list.append(h('button', { class: 'prob ' + p.sev, onclick: () => this.ed.selectProblem(p) }, h('span', { class: 'prob-sev', text: p.sev === 'error' ? 'ERROR' : p.sev === 'warn' ? 'WARN' : 'NOTE' }), h('span', { text: p.text })));
    }
    this.problemsPanel.append(list);
  }
}
