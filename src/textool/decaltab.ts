import * as THREE from 'three';
import type { CharModel } from '../ai/charModel';
import { PLACEMENTS, SHAPE_DEFAULTS, STAMPS, drawStamp, repaintStamp, setDecals, type DecalFile, type Placement, type Stamp, type StampShape } from '../render/decals';
import type { TexTool } from './textool';

/**
 * The Decals tab of the texture editor: design stamps from shapes and text, and click on a model
 * to stick them on. Saves to public/textures/decals.json.
 */

const DRAFT = 'emg-decal-draft';
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const FONTS = ['Anton', 'Bangers', 'Special Elite', 'Share Tech Mono', 'Rajdhani'];
const RANGE: Record<string, [number, number, number]> = {
  x: [0, 256, 1], y: [0, 256, 1], w: [1, 256, 1], h: [1, 256, 1], r: [1, 128, 1], radius: [0, 64, 1], stroke: [0, 24, 0.5], size: [6, 200, 1],
  rot: [-180, 180, 1], seed: [1, 999, 1], drops: [0, 20, 1], width: [2, 96, 1],
};

export class DecalTab {
  stamp = '';
  shape = -1;
  placing = false;
  sel = -1;
  selKey = '';
  dirty = false;
  status = '';
  private fileJson = '{}';
  private undo: string[] = [];
  readonly left = h('div', 'tx-pane');
  readonly right = h('div', 'tx-pane');
  private ray = new THREE.Raycaster();

  constructor(private t: TexTool) {}

  async load() {
    let f: DecalFile = { version: 1, stamps: {}, models: {} };
    try {
      const r = await fetch('textures/decals.json', { cache: 'no-store' });
      if (r.ok) f = await r.json();
    } catch {
      /* start empty */
    }
    this.fileJson = JSON.stringify(f);
    setDecals(f);
    try {
      const raw = localStorage.getItem(DRAFT);
      if (raw && raw !== this.fileJson) {
        setDecals(JSON.parse(raw));
        this.dirty = true;
        this.status = 'Restored your unsaved decal changes (Revert loads the saved file).';
      }
    } catch {
      /* no storage */
    }
    this.stamp = Object.keys(STAMPS)[0] ?? '';
  }

  private data(): DecalFile {
    return { version: 1, stamps: STAMPS, models: PLACEMENTS };
  }
  private snap() {
    this.undo.push(JSON.stringify(this.data()));
    if (this.undo.length > 200) this.undo.shift();
  }
  undoStep() {
    const s = this.undo.pop();
    if (!s) return;
    setDecals(JSON.parse(s));
    this.changed(true);
  }
  private changed(rebuild = false) {
    this.dirty = true;
    try {
      localStorage.setItem(DRAFT, JSON.stringify(this.data()));
    } catch {
      /* no storage */
    }
    if (this.stamp) repaintStamp(this.stamp);
    if (rebuild) this.t.setSubject(this.t.subjectIdx);
    this.refresh();
  }

  async save() {
    const body = JSON.stringify(this.data(), null, 1);
    try {
      const r = await fetch('__decals/save', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
      if (!r.ok) throw new Error(await r.text());
      this.fileJson = JSON.stringify(this.data());
      this.dirty = false;
      try {
        localStorage.removeItem(DRAFT);
      } catch {
        /* no storage */
      }
      this.status = 'Saved to public/textures/decals.json.';
    } catch {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
      a.download = 'decals.json';
      a.click();
      this.status = 'No dev server here: downloaded decals.json (put it in public/textures/).';
    }
    this.refresh();
  }

  /** The decal set the shown model wears ('' for the test shapes). */
  key() {
    const m = this.t.subject?.userData.model as CharModel | undefined;
    return m?.decalKey ?? '';
  }

  // ------------------------------------------------------------------ view

  drawPreview() {
    const c = this.t.tile;
    const g = c.getContext('2d')!;
    const s = c.width;
    const q = s / 16;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        g.fillStyle = (x + y) % 2 ? '#6b6e78' : '#8d9099';
        g.fillRect(x * q, y * q, q, q);
      }
    const st = STAMPS[this.stamp];
    if (!st) return;
    const cell = document.createElement('canvas');
    cell.width = cell.height = 256;
    drawStamp(cell.getContext('2d')!, st);
    g.drawImage(cell, 0, 0, s, s);
    const asp = st.aspect ?? 1;
    const cw = asp >= 1 ? s : s * asp;
    const ch = asp >= 1 ? s / asp : s;
    g.strokeStyle = '#ffd21f';
    g.setLineDash([6, 4]);
    g.strokeRect((s - cw) / 2 + 1, (s - ch) / 2 + 1, cw - 2, ch - 2);
    g.setLineDash([]);
  }

  refresh() {
    this.refreshLeft();
    this.refreshRight();
    this.drawPreview();
  }

  private refreshLeft() {
    const l = this.left;
    l.innerHTML = '';
    l.append(h('h3', '', 'Stamps'));
    const list = h('div', 'tx-list');
    for (const n of Object.keys(STAMPS).sort()) {
      const b = h('button', n === this.stamp ? 'on' : '');
      b.append(h('span', '', n));
      b.onclick = () => {
        this.stamp = n;
        this.shape = -1;
        this.refresh();
      };
      list.append(b);
    }
    l.append(list);
    const nm = h('input') as HTMLInputElement;
    nm.placeholder = 'new stamp name';
    const row = h('div', 'tx-btns');
    const btn = (label: string, fn: () => void, host: HTMLElement = row) => {
      const b = h('button', '', label);
      b.onclick = fn;
      host.append(b);
      return b;
    };
    const clean = () => nm.value.trim().replace(/[^a-z0-9_-]/gi, '_');
    btn('New', () => {
      const n = clean();
      if (!n || STAMPS[n]) return;
      this.snap();
      STAMPS[n] = { aspect: 1, shapes: [{ ...SHAPE_DEFAULTS.circle }, { ...SHAPE_DEFAULTS.text }] };
      this.stamp = n;
      this.changed();
    });
    btn('Copy', () => {
      const n = clean() || this.stamp + '_copy';
      if (!STAMPS[this.stamp] || STAMPS[n]) return;
      this.snap();
      STAMPS[n] = JSON.parse(JSON.stringify(STAMPS[this.stamp]));
      this.stamp = n;
      this.changed();
    });
    btn('Delete', () => {
      if (!STAMPS[this.stamp]) return;
      this.snap();
      delete STAMPS[this.stamp];
      for (const k of Object.keys(PLACEMENTS)) PLACEMENTS[k] = PLACEMENTS[k].filter((p) => p.stamp !== this.stamp);
      this.stamp = Object.keys(STAMPS)[0] ?? '';
      this.changed(true);
    });
    l.append(nm, row);
    l.append(h('h3', '', 'File'));
    const fr = h('div', 'tx-btns');
    btn('Save', () => void this.save(), fr);
    btn('Revert', () => {
      this.snap();
      setDecals(JSON.parse(this.fileJson));
      this.dirty = false;
      try {
        localStorage.removeItem(DRAFT);
      } catch {
        /* no storage */
      }
      this.status = 'Reverted to the saved file.';
      this.t.setSubject(this.t.subjectIdx);
      this.refresh();
    }, fr);
    l.append(fr, h('p', 'tx-status', (this.dirty ? '● Unsaved changes. ' : '') + this.status));
  }

  private refreshRight() {
    const r = this.right;
    r.innerHTML = '';
    // ---- placements on the model shown
    const key = this.key();
    r.append(h('h3', '', key ? `On this model (${key})` : 'Pick a character under "Show on"'));
    if (key) {
      const place = h('button', this.placing ? 'on' : '', this.placing ? `Click the model to place "${this.stamp}"…` : `Place "${this.stamp}" on the model`);
      place.onclick = () => {
        this.placing = !this.placing;
        this.refreshRight();
      };
      r.append(place);
      for (const k of [key, 'rifle']) {
        const list = PLACEMENTS[k] ?? [];
        if (k === 'rifle' && !list.length) continue;
        if (k === 'rifle') r.append(h('p', 'tx-dim', 'On the rifle'));
        list.forEach((p, i) => {
          const on = this.selKey === k && this.sel === i;
          const row = h('div', 'tx-layer' + (on ? ' on' : ''));
          const nb = h('button', 'tx-lname', `${p.stamp} · ${Math.round(p.size * 100)} cm`);
          nb.onclick = () => {
            this.sel = on ? -1 : i;
            this.selKey = k;
            this.refreshRight();
          };
          const del = h('button', 'tx-ic', '✕');
          del.title = 'Remove';
          del.onclick = () => {
            this.snap();
            list.splice(i, 1);
            this.sel = -1;
            this.changed(true);
          };
          row.append(nb, del);
          r.append(row);
          if (on) r.append(this.placementForm(p));
        });
      }
    }
    // ---- the stamp
    const st = STAMPS[this.stamp];
    r.append(h('h3', '', this.stamp ? `Stamp: ${this.stamp}` : 'No stamp'));
    if (!st) return;
    const asp = h('input') as HTMLInputElement;
    asp.type = 'number';
    asp.step = '0.05';
    asp.value = String(st.aspect ?? 1);
    asp.onchange = () => {
      this.snap();
      st.aspect = Math.max(0.2, Math.min(5, +asp.value));
      this.changed(true);
    };
    const ar = h('label', 'tx-row');
    ar.append(h('span', '', 'Width / height'), asp);
    r.append(ar);
    const stack = h('div', 'tx-layers');
    st.shapes.forEach((s, i) => {
      const row = h('div', 'tx-layer' + (i === this.shape ? ' on' : ''));
      const nb = h('button', 'tx-lname', `${i + 1}. ${s.type}${s.type === 'text' ? ' · ' + s.text : ''}`);
      nb.onclick = () => {
        this.shape = this.shape === i ? -1 : i;
        this.refreshRight();
      };
      row.append(nb);
      const ic = (label: string, fn: () => void) => {
        const b = h('button', 'tx-ic', label);
        b.onclick = () => {
          this.snap();
          fn();
          this.changed(true);
        };
        row.append(b);
      };
      ic('▲', () => i < st.shapes.length - 1 && ([st.shapes[i], st.shapes[i + 1]] = [st.shapes[i + 1], st.shapes[i]]));
      ic('▼', () => i > 0 && ([st.shapes[i], st.shapes[i - 1]] = [st.shapes[i - 1], st.shapes[i]]));
      ic('⧉', () => st.shapes.splice(i + 1, 0, JSON.parse(JSON.stringify(s))));
      ic('✕', () => {
        st.shapes.splice(i, 1);
        this.shape = -1;
      });
      stack.append(row);
      if (i === this.shape) stack.append(this.shapeForm(st, i));
    });
    r.append(stack);
    const add = h('select') as HTMLSelectElement;
    add.append(new Option('+ Add shape…', ''));
    for (const k of Object.keys(SHAPE_DEFAULTS)) add.append(new Option(k, k));
    add.onchange = () => {
      if (!add.value) return;
      this.snap();
      st.shapes.push(JSON.parse(JSON.stringify(SHAPE_DEFAULTS[add.value as StampShape['type']])));
      this.shape = st.shapes.length - 1;
      this.changed(true);
    };
    r.append(add);
  }

  private shapeForm(st: Stamp, i: number) {
    const f = h('div', 'tx-form');
    const s = st.shapes[i] as unknown as Record<string, unknown>;
    let timer = 0;
    const live = () => {
      this.dirty = true;
      repaintStamp(this.stamp);
      this.drawPreview();
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        try {
          localStorage.setItem(DRAFT, JSON.stringify(this.data()));
        } catch {
          /* no storage */
        }
      }, 400);
    };
    for (const k of Object.keys(s)) {
      if (k === 'type') continue;
      const v = s[k];
      const row = h('label', 'tx-row');
      row.append(h('span', '', k));
      if (k === 'font') {
        const sel = h('select') as HTMLSelectElement;
        for (const fnt of FONTS) sel.append(new Option(fnt, fnt));
        sel.value = String(v);
        sel.onchange = () => {
          this.snap();
          s[k] = sel.value;
          live();
        };
        row.append(sel);
      } else if (k === 'align') {
        const sel = h('select') as HTMLSelectElement;
        for (const a of ['left', 'center', 'right']) sel.append(new Option(a, a));
        sel.value = String(v);
        sel.onchange = () => {
          this.snap();
          s[k] = sel.value;
          live();
        };
        row.append(sel);
      } else if (k === 'text') {
        const ti = h('input') as HTMLInputElement;
        ti.value = String(v);
        ti.onfocus = () => this.snap();
        ti.oninput = () => {
          s[k] = ti.value;
          live();
        };
        row.append(ti);
      } else if (typeof v === 'string') {
        const c = h('input') as HTMLInputElement;
        c.type = 'color';
        c.value = v;
        c.onfocus = () => this.snap();
        c.oninput = () => {
          s[k] = c.value;
          live();
        };
        row.append(c);
      } else if (typeof v === 'number') {
        const [mn, mx, stp] = RANGE[k] ?? [0, 256, 1];
        const sl = h('input') as HTMLInputElement;
        sl.type = 'range';
        sl.min = String(mn);
        sl.max = String(mx);
        sl.step = String(stp);
        sl.value = String(v);
        const n = h('input', 'tx-n') as HTMLInputElement;
        n.type = 'number';
        n.step = String(stp);
        n.value = String(v);
        sl.onpointerdown = () => this.snap();
        n.onfocus = () => this.snap();
        sl.oninput = () => {
          n.value = sl.value;
          s[k] = +sl.value;
          live();
        };
        n.oninput = () => {
          sl.value = n.value;
          s[k] = +n.value;
          live();
        };
        row.append(sl, n);
      } else continue;
      f.append(row);
    }
    return f;
  }

  private placementForm(p: Placement) {
    const f = h('div', 'tx-form');
    const slider = (label: string, get: () => number, set: (v: number) => void, mn: number, mx: number, st: number) => {
      const row = h('label', 'tx-row');
      const sl = h('input') as HTMLInputElement;
      sl.type = 'range';
      sl.min = String(mn);
      sl.max = String(mx);
      sl.step = String(st);
      sl.value = String(get());
      sl.onpointerdown = () => this.snap();
      sl.oninput = () => {
        set(+sl.value);
        this.dirty = true;
        this.t.setSubject(this.t.subjectIdx);
      };
      sl.onchange = () => this.changed();
      row.append(h('span', '', label), sl);
      f.append(row);
    };
    slider('Size (m)', () => p.size, (v) => (p.size = v), 0.02, 0.6, 0.005);
    slider('Turn °', () => p.rot, (v) => (p.rot = v), -180, 180, 1);
    const sel = h('select') as HTMLSelectElement;
    for (const n of Object.keys(STAMPS)) sel.append(new Option(n, n));
    sel.value = p.stamp;
    sel.onchange = () => {
      this.snap();
      p.stamp = sel.value;
      this.changed(true);
    };
    const row = h('label', 'tx-row');
    row.append(h('span', '', 'Stamp'), sel);
    f.append(row);
    return f;
  }

  // ------------------------------------------------------------------ placing

  /** Place the current stamp where a ray from the camera hits the model. Returns true if it did. */
  placeAt(ndcX: number, ndcY: number, size = 0.12, rot = 0) {
    const subj = this.t.subject;
    const model = subj?.userData.model as CharModel | undefined;
    if (!subj || !model || !STAMPS[this.stamp]) return false;
    subj.updateMatrixWorld(true);
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.t.camera);
    const targets: THREE.Object3D[] = [model.mesh];
    if (model.held) targets.push(model.held);
    const hit = this.ray.intersectObjects(targets, false)[0];
    if (!hit || !hit.face) return false;
    const nW = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    let key = model.decalKey;
    let bone = -1;
    let frame: THREE.Object3D = hit.object;
    if (hit.object === model.held) key = 'rifle';
    else {
      const si = (hit.object as THREE.SkinnedMesh).geometry.getAttribute('skinIndex');
      bone = si ? si.getX(hit.face.a) : 0;
      frame = model.bones[bone];
    }
    const pos = frame.worldToLocal(hit.point.clone());
    const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert();
    const n = nW.clone().transformDirection(inv);
    this.snap();
    (PLACEMENTS[key] = PLACEMENTS[key] ?? []).push({
      stamp: this.stamp,
      bone,
      pos: [+pos.x.toFixed(4), +pos.y.toFixed(4), +pos.z.toFixed(4)],
      normal: [+n.x.toFixed(4), +n.y.toFixed(4), +n.z.toFixed(4)],
      rot,
      size,
    });
    this.selKey = key;
    this.sel = PLACEMENTS[key].length - 1;
    this.changed(true);
    return true;
  }

  /** A click in the 3D view while placing. */
  click(e: PointerEvent, rect: DOMRect) {
    if (!this.placing) return false;
    const ok = this.placeAt(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    if (ok) {
      this.placing = false;
      this.refreshRight();
    }
    return ok;
  }
}
