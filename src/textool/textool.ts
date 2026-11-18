import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { G, setGame } from '../core/globals';
import { openAnim, openEditor, openGame } from '../core/nav';
import { CharAnim, CharModel, PALETTES, type CharKind } from '../ai/charModel';
import { RenderPipeline } from '../render/pipeline';
import { Sky, SKIES } from '../render/sky';
import { toon, RAMP_CHAR, RAMP_WORLD } from '../render/toon';
import { textures } from '../render/textures';
import { Kit } from '../render/kit';
import { BUILTINS, ENV_TEX, LAYER_DEFAULTS, SURFACES, loadSurfaces, paintSurface, repaint, setSurfaces, surfaceSlot, type Layer, type Surface, type SurfaceFile } from '../render/surfaces';

/**
 * The texture editor (#tex). Every texture in the game is a surface recipe: a stack of procedural
 * layers. Pick a surface, add / reorder / tune layers and watch it update on a flat tile and on a
 * model in 3D. Saves to public/textures/surfaces.json through the dev server.
 */

const DRAFT = 'emg-tex-draft';
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

interface Subject {
  label: string;
  make: (tool: TexTool) => THREE.Object3D;
  height: number;
}
const char = (kind: CharKind, pal: string, variant: number) => () => {
  const m = new CharModel(kind, PALETTES[pal], variant);
  const a = new CharAnim(m);
  a.aim = 0.3;
  for (let i = 0; i < 30; i++) a.update(1 / 30);
  return m.root;
};
const SUBJECTS: Subject[] = [
  { label: 'Worker (hard hat)', make: char('striker', 'striker', 0), height: 1.8 },
  { label: 'Worker (beard)', make: char('striker', 'striker', 1), height: 1.8 },
  { label: 'Worker (beanie)', make: char('striker', 'striker', 2), height: 1.8 },
  { label: 'Agent', make: char('striker', 'striker', 99), height: 1.8 },
  { label: 'Associate', make: char('assoc', 'assoc', 0), height: 1.85 },
  { label: 'Supervisor', make: char('super', 'super', 0), height: 2 },
  { label: 'Regional Manager', make: char('manager', 'manager', 0), height: 3.4 },
  {
    label: 'Test ball (this surface)',
    height: 1,
    make: (t) => {
      const k = new Kit();
      k.surf = t.name;
      const g = new THREE.SphereGeometry(0.4, 32, 20);
      k.add(g, t.tint, [0, 0.5, 0], [0, 0, 0], true);
      k.surf = t.name;
      k.box(0.6, 0.6, 0.6, t.tint, [0.8, 0.3, 0]);
      return k.mesh({ rim: 0.2 });
    },
  },
  {
    label: 'Wall and floor (this surface)',
    height: 2.2,
    make: (t) => {
      const grp = new THREE.Group();
      const tex = ENV_TEX[t.name];
      const mat = tex ? toon({ map: tex, ramp: RAMP_WORLD, color: t.tint }) : toon({ color: t.tint });
      // world UVs are metres / 4, as in the level builder
      const box = (w: number, hh: number, d: number, x: number, y: number, z: number) => {
        const g = new THREE.BoxGeometry(w, hh, d);
        const uv = g.getAttribute('uv');
        const pos = g.getAttribute('position');
        const nrm = g.getAttribute('normal');
        for (let i = 0; i < uv.count; i++) {
          const px = pos.getX(i) + x;
          const py = pos.getY(i) + y;
          const pz = pos.getZ(i) + z;
          const ax = Math.abs(nrm.getX(i));
          const ay = Math.abs(nrm.getY(i));
          uv.setXY(i, ...((ay > 0.5 ? [px / 4, pz / 4] : ax > 0.5 ? [pz / 4, py / 4] : [px / 4, py / 4]) as [number, number]));
        }
        const m = new THREE.Mesh(g, mat);
        m.position.set(x, y, z);
        m.castShadow = m.receiveShadow = true;
        grp.add(m);
      };
      box(6, 0.2, 6, 0, -0.1, 0);
      box(6, 3, 0.3, 0, 1.5, 2);
      box(1.2, 1.2, 1.2, -1.2, 0.6, 0);
      return grp;
    },
  },
];

export class TexTool {
  private pipe: RenderPipeline;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.05, 400);
  private sky: Sky;
  private orbit: OrbitControls;
  private subject: THREE.Object3D | null = null;
  private subjectIdx = 0;
  private floor: THREE.Mesh;

  name = '';
  layer = -1;
  tint = 0xd8d2c4;
  private filter: 'all' | 'env' | 'model' = 'all';
  private undo: string[] = [];
  private redo: string[] = [];
  private dirty = false;
  private status = '';
  private fileJson = '{}';
  private ui!: Record<string, HTMLElement>;
  private tile!: HTMLCanvasElement;
  private pending = new Set<string>();

  static async create(root: HTMLElement, canvas: HTMLCanvasElement) {
    let file: SurfaceFile = { version: 1, surfaces: {} };
    try {
      const r = await fetch('textures/surfaces.json', { cache: 'no-store' });
      if (r.ok) file = await r.json();
    } catch {
      /* start empty */
    }
    const tool = new TexTool(root, canvas);
    tool.fileJson = JSON.stringify(file.surfaces ?? {});
    setSurfaces(JSON.parse(tool.fileJson));
    try {
      const raw = localStorage.getItem(DRAFT);
      if (raw && raw !== tool.fileJson) {
        setSurfaces(JSON.parse(raw));
        tool.dirty = true;
        tool.status = 'Restored your unsaved changes (Revert loads the saved file).';
      }
    } catch {
      /* no storage */
    }
    tool.name = tool.names()[0] ?? '';
    tool.refreshAll();
    tool.setSubject(tool.subjectIdx);
    return tool;
  }

  private constructor(
    readonly root: HTMLElement,
    readonly canvas: HTMLCanvasElement,
  ) {
    textures();
    if (!G) setGame({ mat: { char: toon({ vertexColors: true, ramp: RAMP_CHAR, rim: 0.3, name: 'char', surfaces: true }), prop: toon({ vertexColors: true, ramp: RAMP_CHAR, name: 'prop', surfaces: true }) } } as never);
    this.pipe = new RenderPipeline(canvas);
    this.pipe.forcedScale = 1;
    this.sky = new Sky(this.scene, SKIES.dawn, 1024);
    this.sky.shadowRange = 7;
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48).rotateX(-Math.PI / 2), toon({ color: 0x8d929a }));
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    this.buildUi();
    this.orbit = new OrbitControls(this.camera, this.ui.view);
    this.orbit.enableDamping = true;
    this.camera.position.set(1.6, 1.6, -3);
    this.orbit.target.set(0, 1, 0);
    const loop = () => {
      this.frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    new ResizeObserver(() => this.resize()).observe(this.ui.view);
    this.resize();
  }

  // ------------------------------------------------------------------ data

  get surface(): Surface | null {
    return SURFACES[this.name] ?? null;
  }
  /** Every surface name: recipes, built-in environment textures and model surfaces in use. */
  names() {
    const set = new Set([...Object.keys(SURFACES), ...Object.keys(BUILTINS)]);
    return [...set].sort((a, b) => this.kind(a).localeCompare(this.kind(b)) || a.localeCompare(b));
  }
  kind(n: string): 'env' | 'model' {
    return SURFACES[n]?.use ?? (BUILTINS[n] ? 'env' : 'model');
  }
  /** The recipe being edited, made on first edit (a built-in starts as one builtin layer). */
  private ensure(): Surface {
    let sf = SURFACES[this.name];
    if (!sf) {
      sf = BUILTINS[this.name] ? { use: 'env', layers: [{ type: 'builtin', name: this.name }] } : { use: 'model', perMetre: 4, layers: [] };
      SURFACES[this.name] = sf;
    }
    return sf;
  }

  private snapshot() {
    this.undo.push(JSON.stringify(SURFACES));
    if (this.undo.length > 200) this.undo.shift();
    this.redo.length = 0;
  }
  private changed(full = true) {
    this.dirty = true;
    this.pending.add(this.name);
    try {
      localStorage.setItem(DRAFT, JSON.stringify(SURFACES));
    } catch {
      /* no storage */
    }
    if (full) this.refreshAll();
    else this.refreshStatus();
  }
  private undoStep(redo = false) {
    const from = redo ? this.redo : this.undo;
    const to = redo ? this.undo : this.redo;
    const s = from.pop();
    if (!s) return;
    to.push(JSON.stringify(SURFACES));
    setSurfaces(JSON.parse(s));
    this.dirty = true;
    this.refreshAll();
  }

  async save() {
    const body = JSON.stringify({ version: 1, surfaces: SURFACES } satisfies SurfaceFile, null, 1);
    try {
      const r = await fetch('__tex/save', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
      if (!r.ok) throw new Error(await r.text());
      this.fileJson = JSON.stringify(SURFACES);
      this.dirty = false;
      try {
        localStorage.removeItem(DRAFT);
      } catch {
        /* no storage */
      }
      this.status = 'Saved to public/textures/surfaces.json.';
      this.refreshStatus();
      return true;
    } catch {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
      a.download = 'surfaces.json';
      a.click();
      this.status = 'No dev server here: downloaded surfaces.json (put it in public/textures/).';
      this.refreshStatus();
      return false;
    }
  }

  select(name: string) {
    this.name = name;
    this.layer = -1;
    surfaceSlot(this.kind(name) === 'model' ? name : null);
    this.refreshAll();
    if (this.subjectIdx >= SUBJECTS.length - 2) this.setSubject(this.subjectIdx);
    else if (this.kind(name) === 'env') this.setSubject(SUBJECTS.length - 1);
  }

  setSubject(i: number) {
    this.subjectIdx = i;
    if (this.subject) this.scene.remove(this.subject);
    const s = SUBJECTS[i];
    this.subject = s.make(this);
    this.scene.add(this.subject);
    this.floor.visible = i !== SUBJECTS.length - 1;
    this.orbit.target.set(0, s.height * 0.55, 0);
    const d = this.camera.position.clone().sub(this.orbit.target).normalize().multiplyScalar(s.height * 2 + 0.8);
    this.camera.position.copy(this.orbit.target).add(d);
    if (this.ui) (this.ui.subject as HTMLSelectElement).value = String(i);
  }

  // ------------------------------------------------------------------ frame

  private frame() {
    for (const n of this.pending) repaint(n);
    if (this.pending.size) {
      this.drawTile();
      // the flat-colour previews rebuild with the new tint / surface
      if (this.subjectIdx >= SUBJECTS.length - 2 && this.pendingRebuild) this.setSubject(this.subjectIdx);
      this.pendingRebuild = false;
    }
    this.pending.clear();
    this.orbit.update();
    this.sky.update(this.orbit.target, 0);
    this.sky.mesh.position.copy(this.camera.position);
    this.sky.fog.density = 0;
    this.pipe.render(this.scene, this.camera, { viewFov: 50, drawView: false });
  }
  private pendingRebuild = false;

  private resize() {
    const r = this.ui.view.getBoundingClientRect();
    const w = Math.max(2, Math.floor(r.width));
    const hh = Math.max(2, Math.floor(r.height));
    Object.assign(this.canvas.style, { left: r.left + 'px', top: r.top + 'px', width: w + 'px', height: hh + 'px' });
    this.pipe.resize(w, hh);
    this.camera.aspect = w / hh;
    this.camera.updateProjectionMatrix();
  }

  /** The flat preview: the tile repeated 3 x 3, tinted like a vertex colour would. */
  private drawTile() {
    const c = this.tile;
    const S = 256;
    const one = document.createElement('canvas');
    one.width = one.height = S;
    const g1 = one.getContext('2d')!;
    const sf = SURFACES[this.name];
    if (sf) paintSurface(g1, S, sf);
    else if (BUILTINS[this.name]) BUILTINS[this.name](g1, S);
    else {
      g1.fillStyle = '#fff';
      g1.fillRect(0, 0, S, S);
    }
    g1.globalCompositeOperation = 'multiply';
    g1.fillStyle = '#' + new THREE.Color(this.tint).getHexString();
    g1.fillRect(0, 0, S, S);
    const g = c.getContext('2d')!;
    const cell = c.width / 3;
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) g.drawImage(one, x * cell, y * cell, cell, cell);
    g.strokeStyle = 'rgba(255,210,31,0.6)';
    g.strokeRect(cell + 0.5, cell + 0.5, cell - 1, cell - 1);
  }

  // ------------------------------------------------------------------ UI

  private buildUi() {
    const r = this.root;
    r.innerHTML = '';
    const top = h('div', 'tx-top');
    top.append(h('b', 'tx-title', 'TEXTURES'));
    top.append(h('span', 'tx-help', 'Pick a surface · add and tune layers · drag in the view to orbit · Ctrl+Z undo · Ctrl+S save'));
    const nav = (label: string, fn: () => void) => {
      const b = h('button', '', label);
      b.onclick = fn;
      top.append(b);
    };
    nav('Animation', openAnim);
    nav('Level editor', openEditor);
    nav('Play the game', () => openGame());
    const left = h('div', 'tx-panel tx-left');
    const mid = h('div', 'tx-mid');
    const view = h('div', 'tx-view');
    const right = h('div', 'tx-panel tx-right');
    this.tile = h('canvas', 'tx-tile') as HTMLCanvasElement;
    this.tile.width = this.tile.height = 480;
    const tileBox = h('div', 'tx-tilebox');
    tileBox.append(this.tile);
    mid.append(tileBox);
    r.append(top, left, mid, view, right);
    this.ui = { top, left, mid, view, right };

    // left: surface list
    left.append(h('h3', '', 'Surfaces'));
    const flt = h('div', 'tx-seg');
    for (const f of ['all', 'model', 'env'] as const) {
      const b = h('button', this.filter === f ? 'on' : '', { all: 'All', model: 'Models', env: 'World' }[f]);
      b.onclick = () => {
        this.filter = f;
        this.refreshList();
        for (const x of flt.children) x.classList.toggle('on', x === b);
      };
      flt.append(b);
    }
    left.append(flt);
    const list = h('div', 'tx-list');
    left.append(list);
    this.ui.list = list;
    const nm = h('input') as HTMLInputElement;
    nm.placeholder = 'new surface name';
    const row = h('div', 'tx-btns');
    const btn = (label: string, fn: () => void, host: HTMLElement = row) => {
      const b = h('button', '', label);
      b.onclick = fn;
      host.append(b);
      return b;
    };
    btn('New', () => {
      const n = nm.value.trim().replace(/[^a-z0-9_-]/gi, '_');
      if (!n || SURFACES[n] || BUILTINS[n]) return;
      this.snapshot();
      SURFACES[n] = { use: 'model', perMetre: 4, layers: [{ ...LAYER_DEFAULTS.noise }] };
      nm.value = '';
      this.name = n;
      this.changed();
    });
    btn('Copy', () => {
      const n = nm.value.trim().replace(/[^a-z0-9_-]/gi, '_') || this.name + '_copy';
      if (SURFACES[n] || BUILTINS[n]) return;
      this.snapshot();
      SURFACES[n] = JSON.parse(JSON.stringify(this.ensure()));
      this.name = n;
      this.changed();
    });
    const del = btn('Delete', () => {
      if (!SURFACES[this.name]) return;
      if (del.dataset.sure !== '1') {
        del.dataset.sure = '1';
        del.textContent = 'Sure?';
        setTimeout(() => {
          del.dataset.sure = '';
          del.textContent = 'Delete';
        }, 2500);
        return;
      }
      this.snapshot();
      delete SURFACES[this.name];
      this.pending.add(this.name);
      del.dataset.sure = '';
      del.textContent = 'Delete';
      this.status = BUILTINS[this.name] ? 'Recipe removed: the hand-written texture is back.' : '';
      this.changed();
    });
    left.append(nm, row);
    left.append(h('h3', '', 'File'));
    const frow = h('div', 'tx-btns');
    btn('Save', () => void this.save(), frow);
    btn('Revert', () => {
      this.snapshot();
      setSurfaces(JSON.parse(this.fileJson));
      this.dirty = false;
      try {
        localStorage.removeItem(DRAFT);
      } catch {
        /* no storage */
      }
      this.status = 'Reverted to the saved file.';
      this.refreshAll();
    }, frow);
    const st = h('p', 'tx-status');
    left.append(frow, st);
    this.ui.status = st;

    // middle: preview options under the tile
    const opts = h('div', 'tx-opts');
    const sub = h('select');
    SUBJECTS.forEach((s, i) => sub.append(new Option(s.label, String(i))));
    sub.onchange = () => this.setSubject(+sub.value);
    this.ui.subject = sub;
    const tint = h('input') as HTMLInputElement;
    tint.type = 'color';
    tint.value = '#' + new THREE.Color(this.tint).getHexString();
    tint.title = 'Preview colour (the vertex colour the texture multiplies)';
    tint.oninput = () => {
      this.tint = new THREE.Color(tint.value).getHex();
      this.pending.add(this.name);
      this.pendingRebuild = true;
    };
    const tl = h('label', 'tx-inline');
    tl.append(h('span', '', 'Tint'), tint);
    const sl = h('label', 'tx-inline');
    sl.append(h('span', '', 'Show on'), sub);
    opts.append(sl, tl);
    mid.append(opts);

    // right: recipe
    const props = h('div');
    right.append(props);
    this.ui.props = props;

    addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.code === 'KeyS') {
        e.preventDefault();
        void this.save();
      } else if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      else if (ctrl && e.code === 'KeyZ') {
        e.preventDefault();
        this.undoStep(e.shiftKey);
      } else if (ctrl && e.code === 'KeyY') this.undoStep(true);
    });
    addEventListener('beforeunload', (e) => {
      if (this.dirty) e.preventDefault();
    });
  }

  private refreshAll() {
    if (!this.names().includes(this.name)) this.name = this.names()[0] ?? '';
    this.refreshList();
    this.refreshProps();
    this.refreshStatus();
    this.pending.add(this.name);
    this.pendingRebuild = true;
  }
  private refreshStatus() {
    this.ui.status.textContent = (this.dirty ? '● Unsaved changes. ' : '') + this.status;
  }

  private refreshList() {
    const l = this.ui.list;
    l.innerHTML = '';
    for (const n of this.names()) {
      const k = this.kind(n);
      if (this.filter !== 'all' && this.filter !== k) continue;
      const b = h('button', n === this.name ? 'on' : '');
      b.append(h('span', '', n), h('small', '', k === 'env' ? (SURFACES[n] ? 'world · recipe' : 'world · hand-made') : 'model'));
      b.onclick = () => this.select(n);
      l.append(b);
    }
  }

  private refreshProps() {
    const p = this.ui.props;
    p.innerHTML = '';
    if (!this.name) return;
    p.append(h('h3', '', this.name));
    const sf = SURFACES[this.name];
    if (!sf && BUILTINS[this.name]) p.append(h('p', 'tx-dim', 'Hand-made texture. Any change turns it into a recipe that starts from it.'));
    const s = sf ?? this.ensureView();
    const field = (label: string, input: HTMLElement) => {
      const row = h('label', 'tx-row');
      row.append(h('span', '', label), input);
      p.append(row);
    };
    const use = h('select') as HTMLSelectElement;
    use.append(new Option('Model (atlas)', 'model'), new Option('World (level geometry)', 'env'));
    use.value = s.use;
    use.disabled = !!BUILTINS[this.name];
    use.onchange = () => {
      this.snapshot();
      this.ensure().use = use.value as Surface['use'];
      this.changed();
    };
    field('Used on', use);
    if (s.use === 'model') {
      const pm = this.num(s.perMetre ?? 4, 0.25, (v) => (this.ensure().perMetre = v), 0.25, 40);
      field('Repeats per metre', pm);
    }
    const note = h('textarea') as HTMLTextAreaElement;
    note.value = s.note ?? '';
    note.placeholder = 'What it is, where it is used';
    note.onchange = () => {
      this.ensure().note = note.value || undefined;
      this.changed(false);
    };
    p.append(note);

    // layer stack
    p.append(h('h3', '', 'Layers (bottom to top)'));
    const stack = h('div', 'tx-layers');
    s.layers.forEach((L, i) => {
      const row = h('div', 'tx-layer' + (i === this.layer ? ' on' : '') + (L.hidden ? ' off' : ''));
      const name = h('button', 'tx-lname', `${i + 1}. ${L.type}${L.type === 'builtin' ? ' · ' + L.name : ''}`);
      name.onclick = () => {
        this.layer = this.layer === i ? -1 : i;
        this.refreshProps();
      };
      const ic = (label: string, title: string, fn: () => void) => {
        const b = h('button', 'tx-ic', label);
        b.title = title;
        b.onclick = (e) => {
          e.stopPropagation();
          this.snapshot();
          fn();
          this.changed();
        };
        row.append(b);
      };
      row.append(name);
      ic(L.hidden ? '○' : '●', 'Show / hide', () => (this.ensure().layers[i].hidden = !L.hidden || undefined));
      ic('▲', 'Move up', () => {
        const ls = this.ensure().layers;
        if (i < ls.length - 1) [ls[i], ls[i + 1]] = [ls[i + 1], ls[i]];
        this.layer = Math.min(ls.length - 1, i + 1);
      });
      ic('▼', 'Move down', () => {
        const ls = this.ensure().layers;
        if (i > 0) [ls[i], ls[i - 1]] = [ls[i - 1], ls[i]];
        this.layer = Math.max(0, i - 1);
      });
      ic('⧉', 'Duplicate', () => this.ensure().layers.splice(i + 1, 0, JSON.parse(JSON.stringify(L))));
      ic('✕', 'Delete', () => {
        this.ensure().layers.splice(i, 1);
        this.layer = -1;
      });
      stack.append(row);
      if (i === this.layer) stack.append(this.layerForm(i));
    });
    p.append(stack);
    const add = h('select') as HTMLSelectElement;
    add.append(new Option('+ Add layer…', ''));
    for (const t of Object.keys(LAYER_DEFAULTS)) add.append(new Option(t, t));
    add.onchange = () => {
      if (!add.value) return;
      this.snapshot();
      const L = JSON.parse(JSON.stringify(LAYER_DEFAULTS[add.value as Layer['type']])) as Layer;
      L.seed = Math.floor(Math.random() * 999) + 1;
      const ls = this.ensure().layers;
      ls.push(L);
      this.layer = ls.length - 1;
      this.changed();
    };
    p.append(add);
  }
  /** A read-only view of a built-in (before it has a recipe). */
  private ensureView(): Surface {
    return { use: 'env', layers: [{ type: 'builtin', name: this.name }] };
  }

  private num(v: number, step: number, set: (v: number) => void, min = -1e9, max = 1e9) {
    const i = h('input') as HTMLInputElement;
    i.type = 'number';
    i.step = String(step);
    i.value = String(v);
    i.onchange = () => {
      this.snapshot();
      set(Math.max(min, Math.min(max, +i.value)));
      this.changed();
    };
    return i;
  }

  /** The parameter form of one layer, built from its fields. */
  private layerForm(i: number) {
    const f = h('div', 'tx-form');
    const L = SURFACES[this.name]?.layers[i] ?? this.ensureView().layers[i];
    if (!L) return f;
    const live = (fn: (l: Record<string, unknown>) => void) => {
      fn(this.ensure().layers[i] as unknown as Record<string, unknown>);
      this.changed(false);
      this.pending.add(this.name);
      this.drawTile();
    };
    const RANGES: Record<string, [number, number, number]> = {
      opacity: [0, 1, 0.01], alpha: [0, 1, 0.01], amount: [0, 1, 0.01], count: [0, 600, 1], scale: [1, 64, 1], octaves: [1, 6, 1], spacing: [1, 256, 1],
      width: [0.2, 64, 0.1], angle: [-180, 180, 1], wobble: [0, 6, 0.1], jitter: [0, 1, 0.01], cols: [1, 16, 1], rows: [1, 16, 1], bevel: [0, 8, 0.5],
      gap: [0, 128, 1], segments: [1, 20, 1], dash: [1, 32, 1], offset: [-128, 128, 1], every: [1, 8, 1], from: [0, 1, 0.01], to: [0, 1, 0.01],
      alphaFrom: [0, 1, 0.01], alphaTo: [0, 1, 0.01], radius: [0.2, 32, 0.1], stretch: [0.05, 1, 0.01], spread: [0, 180, 1], seed: [1, 999, 1],
    };
    const keys = ['seed', 'opacity', 'blend', ...Object.keys(L).filter((k) => !['type', 'seed', 'opacity', 'blend', 'hidden'].includes(k))];
    for (const k of keys) {
      const v = (L as unknown as Record<string, unknown>)[k] ?? (k === 'opacity' ? 1 : k === 'seed' ? 1 : k === 'blend' ? 'normal' : undefined);
      const row = h('label', 'tx-row');
      row.append(h('span', '', k));
      if (k === 'blend') {
        const s = h('select') as HTMLSelectElement;
        for (const b of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten']) s.append(new Option(b, b));
        s.value = String(v);
        s.onchange = () => {
          this.snapshot();
          live((l) => (l.blend = s.value));
        };
        row.append(s);
      } else if (k === 'name') {
        const s = h('select') as HTMLSelectElement;
        for (const b of Object.keys(BUILTINS)) s.append(new Option(b, b));
        s.value = String(v);
        s.onchange = () => {
          this.snapshot();
          live((l) => (l.name = s.value));
          this.refreshProps();
        };
        row.append(s);
      } else if (typeof v === 'string') {
        const c = h('input') as HTMLInputElement;
        c.type = 'color';
        c.value = v;
        c.onfocus = () => this.snapshot();
        c.oninput = () => live((l) => (l[k] = c.value));
        row.append(c);
      } else if (typeof v === 'boolean' || k === 'offsetRows' || k === 'vertical') {
        const c = h('input') as HTMLInputElement;
        c.type = 'checkbox';
        c.checked = v === undefined ? k === 'vertical' : !!v;
        c.onchange = () => {
          this.snapshot();
          live((l) => (l[k] = c.checked));
        };
        row.append(c);
      } else if (Array.isArray(v)) {
        const box = h('span', 'tx-pair');
        const rg = RANGES[k === 'size' || k === 'length' ? 'width' : 'alpha'] ?? [0, 100, 0.1];
        (v as number[]).forEach((x, j) => {
          const n = h('input') as HTMLInputElement;
          n.type = 'number';
          n.step = String(k === 'alpha' ? 0.01 : 0.1);
          n.min = String(rg[0]);
          n.value = String(x);
          n.onfocus = () => this.snapshot();
          n.oninput = () => live((l) => ((l[k] as number[])[j] = +n.value));
          box.append(n);
        });
        row.append(box);
      } else if (typeof v === 'number') {
        const [mn, mx, st] = RANGES[k] ?? [0, 100, 0.1];
        const sl = h('input') as HTMLInputElement;
        sl.type = 'range';
        sl.min = String(mn);
        sl.max = String(mx);
        sl.step = String(st);
        sl.value = String(v);
        const n = h('input', 'tx-n') as HTMLInputElement;
        n.type = 'number';
        n.step = String(st);
        n.value = String(v);
        sl.onpointerdown = () => this.snapshot();
        n.onfocus = () => this.snapshot();
        sl.oninput = () => {
          n.value = sl.value;
          live((l) => (l[k] = +sl.value));
        };
        n.oninput = () => {
          sl.value = n.value;
          live((l) => (l[k] = +n.value));
        };
        row.append(sl, n);
        if (k === 'seed') {
          const d = h('button', 'tx-ic', '🎲');
          d.title = 'New random seed';
          d.onclick = (e) => {
            e.preventDefault();
            this.snapshot();
            const s = Math.floor(Math.random() * 999) + 1;
            sl.value = n.value = String(s);
            live((l) => (l.seed = s));
          };
          row.append(d);
        }
      } else continue;
      f.append(row);
    }
    return f;
  }

  // ------------------------------------------------------------------ scripting

  api() {
    const t = this;
    return {
      ready: false,
      names: () => t.names(),
      data: () => JSON.parse(JSON.stringify(SURFACES)),
      select: (n: string) => t.select(n),
      subject: (i: number) => t.setSubject(i),
      subjects: SUBJECTS.map((s) => s.label),
      tint: (c: number) => {
        t.tint = c;
        t.pending.add(t.name);
        t.pendingRebuild = true;
      },
      /** replace a surface recipe wholesale */
      set: (n: string, sf: Surface) => {
        t.snapshot();
        SURFACES[n] = JSON.parse(JSON.stringify(sf));
        t.name = n;
        t.changed();
      },
      layer: (i: number) => {
        t.layer = i;
        t.refreshProps();
      },
      cam: (yaw: number, pitch: number, dist: number) => {
        const tg = t.orbit.target;
        t.camera.position.set(tg.x + Math.sin(yaw) * Math.cos(pitch) * dist, tg.y + Math.sin(pitch) * dist, tg.z - Math.cos(yaw) * Math.cos(pitch) * dist);
        t.camera.lookAt(tg);
      },
      target: (x: number, y: number, z: number) => t.orbit.target.set(x, y, z),
      save: () => t.save(),
      state: () => ({ name: t.name, layer: t.layer, dirty: t.dirty, subject: SUBJECTS[t.subjectIdx].label }),
      /** a sheet of surface tiles (name labels), as a PNG data URL */
      tiles: (names?: string[], size = 160, cols = 6) => {
        const ns = names ?? t.names();
        const c = document.createElement('canvas');
        const rows = Math.ceil(ns.length / cols);
        c.width = cols * size;
        c.height = rows * (size + 18);
        const g = c.getContext('2d')!;
        g.fillStyle = '#121319';
        g.fillRect(0, 0, c.width, c.height);
        const one = document.createElement('canvas');
        one.width = one.height = 256;
        const g1 = one.getContext('2d')!;
        ns.forEach((n, i) => {
          const sf = SURFACES[n];
          if (sf) paintSurface(g1, 256, sf);
          else if (BUILTINS[n]) BUILTINS[n](g1, 256);
          const x = (i % cols) * size;
          const y = Math.floor(i / cols) * (size + 18);
          g.drawImage(one, x + 2, y + 18, size - 4, size - 4);
          g.fillStyle = '#e9e6dc';
          g.font = '600 12px system-ui, sans-serif';
          g.fillText(n, x + 4, y + 13);
        });
        return c.toDataURL('image/png');
      },
    };
  }
}

export { loadSurfaces };
