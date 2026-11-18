import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { G, setGame } from '../core/globals';
import { openEditor, openGame } from '../core/nav';
import { B, CharAnim, CharModel, PALETTES, type CharKind } from '../ai/charModel';
import { BONES, CLIPS, sampleKey, setClips, type BoneName, type CharKindName, type Clip, type ClipFile, type ClipKey } from '../anim/clips';
import { RenderPipeline, LAYER_FX } from '../render/pipeline';
import { Sky, SKIES } from '../render/sky';
import { toon, RAMP_CHAR } from '../render/toon';
import { textures } from '../render/textures';
import { loadSurfaces } from '../render/surfaces';

/**
 * The animation editor (#anim). Shows one character driven by the game's own CharAnim, with
 * sliders for its base motion (aim, run speed, crouch, aim pitch) and a clip layered on top. Pick
 * a joint (or the rifle) and turn it with the gizmo or type angles; every change writes a key at
 * the playhead. Clips save to public/anims/clips.json through the dev server.
 */

interface Cast {
  label: string;
  kind: CharKind;
  pal: string;
  variant: number;
}
const CAST: Cast[] = [
  { label: 'Associate', kind: 'assoc', pal: 'assoc', variant: 0 },
  { label: 'Supervisor', kind: 'super', pal: 'super', variant: 0 },
  { label: 'Worker (hard hat)', kind: 'striker', pal: 'striker', variant: 0 },
  { label: 'Worker (beard)', kind: 'striker', pal: 'striker', variant: 1 },
  { label: 'Worker (beanie)', kind: 'striker', pal: 'striker', variant: 2 },
  { label: 'Agent', kind: 'striker', pal: 'striker', variant: 99 },
  { label: 'Regional Manager', kind: 'manager', pal: 'manager', variant: 0 },
];

const LABEL: Record<BoneName, string> = {
  root: 'Whole body', pelvis: 'Hips', chest: 'Chest', head: 'Head', armL: 'Left upper arm', foreL: 'Left forearm', armR: 'Right upper arm',
  foreR: 'Right forearm', thighL: 'Left thigh', shinL: 'Left shin', thighR: 'Right thigh', shinR: 'Right shin',
};
const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;
const FPS = 30;
const snap = (t: number) => Math.round(t * FPS) / FPS;
const DRAFT = 'emg-anim-draft';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

type Sel = BoneName | 'rifle' | null;

export class AnimTool {
  private pipe: RenderPipeline;
  private scene = new THREE.Scene();
  private overlay = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.05, 400);
  private sky: Sky;
  private orbit: OrbitControls;
  private gizmo: TransformControls;
  private markers: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();

  private castIdx = 2;
  private model!: CharModel;
  private anim!: CharAnim;
  base = { aim: 0, speed: 0, crouch: 0, pitch: 0 };

  clipName = '';
  t = 0;
  playing = false;
  loopPlay = true;
  speed = 1;
  showBlend = false;
  sel: Sel = null;
  selKey = -1;
  private clipboard: ClipKey | null = null;
  private undo: string[] = [];
  private redo: string[] = [];
  private dirty = false;
  private status = '';

  // DOM
  private ui!: Record<string, HTMLElement>;
  private tl!: HTMLCanvasElement;

  static async create(root: HTMLElement, canvas: HTMLCanvasElement) {
    await loadSurfaces();
    let file: ClipFile = { version: 1, clips: {} };
    try {
      const r = await fetch('anims/clips.json', { cache: 'no-store' });
      if (r.ok) file = await r.json();
    } catch {
      /* start empty */
    }
    let draft: ClipFile | null = null;
    try {
      const raw = localStorage.getItem(DRAFT);
      if (raw) draft = JSON.parse(raw);
    } catch {
      /* no storage */
    }
    const tool = new AnimTool(root, canvas);
    setClips(file.clips ?? {});
    tool.fileJson = JSON.stringify(file.clips ?? {});
    if (draft && JSON.stringify(draft.clips) !== tool.fileJson) {
      setClips(draft.clips);
      tool.dirty = true;
      tool.status = 'Restored your unsaved changes (Revert loads the saved file).';
    }
    tool.clipName = Object.keys(CLIPS)[0] ?? '';
    tool.refreshAll();
    return tool;
  }
  private fileJson = '{}';

  private constructor(
    readonly root: HTMLElement,
    readonly canvas: HTMLCanvasElement,
  ) {
    if (!G) {
      textures();
      setGame({ mat: { char: toon({ vertexColors: true, ramp: RAMP_CHAR, rim: 0.3, name: 'char', surfaces: true }), prop: toon({ vertexColors: true, ramp: RAMP_CHAR, name: 'prop', surfaces: true }) } } as never);
    }
    this.pipe = new RenderPipeline(canvas);
    this.pipe.forcedScale = 1;
    this.sky = new Sky(this.scene, SKIES.dawn, 1024);
    this.sky.shadowRange = 6;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48).rotateX(-Math.PI / 2), toon({ color: 0x8d929a }));
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(8, 16, 0x5a5f68, 0x6f747e);
    grid.position.y = 0.002;
    this.scene.add(grid);

    this.buildUi();
    this.orbit = new OrbitControls(this.camera, this.ui.view);
    this.orbit.target.set(0, 1, 0);
    this.camera.position.set(1.9, 1.5, -3.2);
    this.orbit.enableDamping = true;
    this.gizmo = new TransformControls(this.camera, this.ui.view);
    this.gizmo.setMode('rotate');
    this.gizmo.setSpace('local');
    this.gizmo.setSize(0.7);
    this.overlay.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !(e as unknown as { value: boolean }).value;
      if ((e as unknown as { value: boolean }).value) this.snapshot();
    });
    this.gizmo.addEventListener('objectChange', () => this.fromGizmo());

    const mg = new THREE.SphereGeometry(0.028, 10, 8);
    for (let i = 0; i < BONES.length; i++) {
      const m = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ color: 0x53c7ff, depthTest: false, transparent: true, opacity: 0.85 }));
      m.renderOrder = 10;
      m.userData.bone = BONES[i];
      this.markers.push(m);
      this.overlay.add(m);
    }
    this.setCast(this.castIdx);

    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    new ResizeObserver(() => this.resize()).observe(this.ui.view);
    this.resize();
  }

  // ------------------------------------------------------------------ state

  get clip(): Clip | null {
    return CLIPS[this.clipName] ?? null;
  }

  private setCast(i: number) {
    this.castIdx = i;
    if (this.model) this.scene.remove(this.model.root);
    const c = CAST[i];
    this.model = new CharModel(c.kind, PALETTES[c.pal], c.variant);
    this.anim = new CharAnim(this.model);
    this.scene.add(this.model.root);
    for (let k = 0; k < 40; k++) this.drive(1 / 30);
    const hgt = this.model.height;
    this.orbit?.target.set(0, hgt * 0.55, 0);
    if (this.orbit) {
      const d = this.camera.position.clone().sub(this.orbit.target).normalize().multiplyScalar(hgt * 2.1);
      this.camera.position.copy(this.orbit.target).add(d);
    }
    if (this.sel === 'rifle' && !this.model.held) this.select(null);
    this.attachGizmo();
  }

  /** Run the character one step: base motion from the sliders, the clip held at the playhead. */
  private drive(dt: number) {
    const a = this.anim;
    a.aim = this.base.aim;
    a.speed = this.base.speed;
    a.crouch = this.base.crouch;
    a.aimPitch = this.base.pitch;
    const c = this.clip;
    const ok = c && (!c.for?.length || c.for.includes(this.model.kind as CharKindName));
    if (ok) {
      a.clip = c;
      a.clipName = this.clipName;
      a.clipT = this.t;
      a.clipSpeed = 0;
      a.clipWeightOverride = this.showBlend ? -1 : 1;
    } else a.stop();
    a.update(dt);
    this.model.root.updateMatrixWorld(true);
  }

  private frame(dt: number) {
    const c = this.clip;
    if (this.playing && c) {
      this.t += dt * this.speed;
      if (this.t > c.length) {
        if (this.loopPlay) this.t %= Math.max(1e-3, c.length);
        else {
          this.t = c.length;
          this.playing = false;
          this.refreshTransport();
        }
      }
    }
    this.drive(dt);
    this.orbit.update();
    // joint markers
    const v = new THREE.Vector3();
    for (let i = 0; i < BONES.length; i++) {
      const m = this.markers[i];
      this.model.bones[i].getWorldPosition(v);
      m.position.copy(v);
      m.scale.setScalar(this.model.kind === 'manager' ? 2.2 : 1);
      (m.material as THREE.MeshBasicMaterial).color.setHex(this.sel === BONES[i] ? 0xffd21f : this.keyHas(BONES[i]) ? 0xff7a1a : 0x53c7ff);
    }
    this.render();
    this.drawTimeline();
    if (this.selFieldsLive) this.refreshFields(false);
  }
  private selFieldsLive = false;

  private render(markers = true) {
    this.sky.update(this.orbit.target, 0);
    this.sky.mesh.position.copy(this.camera.position);
    this.sky.fog.density = 0;
    this.pipe.render(this.scene, this.camera, { viewFov: 50, drawView: false });
    if (!markers) return;
    const r = this.pipe.renderer;
    r.setRenderTarget(null);
    r.setViewport(0, 0, r.domElement.width, r.domElement.height);
    const ac = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    r.render(this.overlay, this.camera);
    r.autoClear = ac;
  }

  private resize() {
    const r = this.ui.view.getBoundingClientRect();
    const w = Math.max(2, Math.floor(r.width));
    const hh = Math.max(2, Math.floor(r.height));
    this.canvas.style.left = r.left + 'px';
    this.canvas.style.top = r.top + 'px';
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = hh + 'px';
    this.pipe.resize(w, hh);
    this.camera.aspect = w / hh;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ editing

  private keyIndexAt(t: number) {
    const c = this.clip;
    if (!c) return -1;
    return c.keys.findIndex((k) => Math.abs(k.t - t) < 0.5 / FPS);
  }
  /** The key at the playhead, made from the current in-between pose if there is none. */
  private ensureKey(): ClipKey | null {
    const c = this.clip;
    if (!c) return null;
    const i = this.keyIndexAt(this.t);
    if (i >= 0) {
      this.selKey = i;
      return c.keys[i];
    }
    const k = sampleKey(c, snap(this.t));
    k.t = snap(this.t);
    c.keys.push(k);
    c.keys.sort((a, b) => a.t - b.t);
    this.selKey = c.keys.indexOf(k);
    return k;
  }
  private keyHas(n: BoneName) {
    const c = this.clip;
    return !!c && c.keys.some((k) => !!k.bones?.[n] && k.bones[n]!.some((x) => Math.abs(x) > 0.01));
  }

  private snapshot() {
    this.undo.push(JSON.stringify(CLIPS));
    if (this.undo.length > 200) this.undo.shift();
    this.redo.length = 0;
  }
  private changed() {
    this.dirty = true;
    try {
      localStorage.setItem(DRAFT, JSON.stringify({ version: 1, clips: CLIPS }));
    } catch {
      /* no storage */
    }
    this.refreshClipPanel();
    this.refreshFields(true);
  }
  private undoStep(redo = false) {
    const from = redo ? this.redo : this.undo;
    const to = redo ? this.undo : this.redo;
    const s = from.pop();
    if (!s) return;
    to.push(JSON.stringify(CLIPS));
    setClips(JSON.parse(s));
    if (!CLIPS[this.clipName]) this.clipName = Object.keys(CLIPS)[0] ?? '';
    this.changed();
  }

  /** The gizmo turned a joint (or moved the rifle): store it as an offset from the base pose. */
  private fromGizmo() {
    if (!this.sel || !this.clip) return;
    const k = this.ensureKey();
    if (!k) return;
    if (this.sel === 'rifle') {
      const g = this.model.held!;
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      this.anim.rifleBase.decompose(p, q, s);
      const dp = g.position.clone().sub(p);
      const dq = g.quaternion.clone().multiply(q.invert());
      const e = new THREE.Euler().setFromQuaternion(dq, 'XYZ');
      k.rifle = [+dp.x.toFixed(4), +dp.y.toFixed(4), +dp.z.toFixed(4), +(e.x * R2D).toFixed(2), +(e.y * R2D).toFixed(2), +(e.z * R2D).toFixed(2)];
    } else {
      const i = BONES.indexOf(this.sel);
      const dq = this.anim.base[i].clone().invert().multiply(this.model.bones[i].quaternion);
      const e = new THREE.Euler().setFromQuaternion(dq, 'XYZ');
      k.bones = k.bones ?? {};
      k.bones[this.sel] = [+(e.x * R2D).toFixed(2), +(e.y * R2D).toFixed(2), +(e.z * R2D).toFixed(2)];
    }
    this.changed();
  }

  select(s: Sel) {
    if (s === 'rifle' && !this.model.held) s = null;
    this.sel = s;
    this.attachGizmo();
    this.refreshFields(true);
    this.refreshBoneList();
  }
  private attachGizmo() {
    if (!this.gizmo) return;
    if (!this.sel || !this.clip) {
      this.gizmo.detach();
      return;
    }
    if (this.sel === 'rifle') {
      this.gizmo.attach(this.model.held!);
      this.gizmo.setMode(this.rifleMode);
      this.gizmo.setSpace('local');
    } else {
      this.gizmo.attach(this.model.bones[B[this.sel as keyof typeof B]]);
      this.gizmo.setMode('rotate');
    }
  }
  private rifleMode: 'rotate' | 'translate' = 'translate';

  private setTime(t: number) {
    const c = this.clip;
    this.t = Math.max(0, Math.min(c?.length ?? 0, t));
    this.selKey = this.keyIndexAt(this.t);
    this.refreshFields(true);
  }

  newClip(name?: string, from?: Clip) {
    this.snapshot();
    let n = name ?? 'clip';
    if (CLIPS[n]) {
      let i = 2;
      while (CLIPS[`${n}${i}`]) i++;
      n = `${n}${i}`;
    }
    CLIPS[n] = from ? JSON.parse(JSON.stringify(from)) : { length: 1, loop: false, for: [this.model.kind as CharKindName], keys: [{ t: 0 }] };
    this.clipName = n;
    this.t = 0;
    this.changed();
    this.attachGizmo();
    return n;
  }

  async save() {
    const file: ClipFile = { version: 1, clips: CLIPS };
    const body = JSON.stringify(file, null, 1);
    try {
      const r = await fetch('__anim/save', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
      if (!r.ok) throw new Error(await r.text());
      this.fileJson = JSON.stringify(CLIPS);
      this.dirty = false;
      try {
        localStorage.removeItem(DRAFT);
      } catch {
        /* no storage */
      }
      this.status = 'Saved to public/anims/clips.json.';
      this.refreshClipPanel();
      return true;
    } catch {
      // a static host has no save endpoint: hand over the file instead
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
      a.download = 'clips.json';
      a.click();
      this.status = 'No dev server here: downloaded clips.json (put it in public/anims/).';
      this.refreshClipPanel();
      return false;
    }
  }

  // ------------------------------------------------------------------ UI

  private buildUi() {
    const r = this.root;
    r.innerHTML = '';
    const top = h('div', 'at-top');
    top.append(h('b', 'at-title', 'ANIMATION'));
    const toGame = h('button', '', 'Play the game');
    toGame.onclick = () => openGame();
    const toEd = h('button', '', 'Level editor');
    toEd.onclick = () => openEditor();
    const help = h('span', 'at-help', 'Click a joint · drag the rings to turn it · Space play · K key · , . previous/next key · Ctrl+Z undo · R rifle move/turn');
    top.append(help, toEd, toGame);
    const left = h('div', 'at-panel at-left');
    const view = h('div', 'at-view');
    const right = h('div', 'at-panel at-right');
    const bottom = h('div', 'at-bottom');
    r.append(top, left, view, right, bottom);
    this.ui = { top, left, view, right, bottom };

    // ---- left: character, base motion, clip
    const sec = (title: string, host: HTMLElement) => {
      const s = h('section');
      s.append(h('h3', '', title));
      host.append(s);
      return s;
    };
    const cs = sec('Character', left);
    const sel = h('select');
    CAST.forEach((c, i) => sel.append(new Option(c.label, String(i))));
    sel.value = String(this.castIdx);
    sel.onchange = () => this.setCast(+sel.value);
    cs.append(sel);
    this.ui.cast = sel;

    const bs = sec('Base motion (from the game)', left);
    const slider = (label: string, key: keyof AnimTool['base'], min: number, max: number, step: number) => {
      const row = h('label', 'at-row');
      const inp = h('input') as HTMLInputElement;
      inp.type = 'range';
      inp.min = String(min);
      inp.max = String(max);
      inp.step = String(step);
      inp.value = String(this.base[key]);
      const out = h('span', 'at-val', String(this.base[key]));
      inp.oninput = () => {
        this.base[key] = +inp.value;
        out.textContent = (+inp.value).toFixed(2);
      };
      row.append(h('span', '', label), inp, out);
      bs.append(row);
      this.ui['base_' + key] = inp;
    };
    slider('Aim', 'aim', 0, 1, 0.01);
    slider('Speed m/s', 'speed', 0, 6, 0.1);
    slider('Crouch', 'crouch', 0, 1, 0.01);
    slider('Aim up/down', 'pitch', -0.8, 0.8, 0.01);

    const cl = sec('Clip', left);
    this.ui.clipSec = cl;
    const csel = h('select');
    csel.onchange = () => {
      this.clipName = csel.value;
      this.setTime(0);
      this.attachGizmo();
      this.refreshClipPanel();
    };
    this.ui.clipSel = csel;
    const name = h('input') as HTMLInputElement;
    name.placeholder = 'name';
    this.ui.clipNameIn = name;
    const btns = h('div', 'at-btns');
    const b = (label: string, fn: () => void, title = '') => {
      const e = h('button', '', label);
      e.onclick = fn;
      if (title) e.title = title;
      return e;
    };
    btns.append(
      b('New', () => this.newClip(name.value.trim() || 'clip')),
      b('Copy', () => this.clip && this.newClip(this.clipName + '_copy', this.clip)),
      b('Rename', () => {
        const n = name.value.trim().replace(/[^a-z0-9_-]/gi, '_');
        if (!n || !this.clip || CLIPS[n]) return;
        this.snapshot();
        CLIPS[n] = this.clip;
        delete CLIPS[this.clipName];
        this.clipName = n;
        this.changed();
      }),
    );
    const del = b('Delete', () => {
      if (!this.clip) return;
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
      delete CLIPS[this.clipName];
      this.clipName = Object.keys(CLIPS)[0] ?? '';
      del.dataset.sure = '';
      del.textContent = 'Delete';
      this.changed();
      this.attachGizmo();
    });
    btns.append(del);
    cl.append(csel, name, btns);
    const props = h('div', 'at-props');
    cl.append(props);
    this.ui.clipProps = props;

    const fs = sec('File', left);
    const st = h('p', 'at-status');
    this.ui.status = st;
    fs.append(
      b('Save', () => void this.save()),
      b('Revert', () => {
        this.snapshot();
        setClips(JSON.parse(this.fileJson));
        this.dirty = false;
        try {
          localStorage.removeItem(DRAFT);
        } catch {
          /* no storage */
        }
        if (!CLIPS[this.clipName]) this.clipName = Object.keys(CLIPS)[0] ?? '';
        this.status = 'Reverted to the saved file.';
        this.refreshAll();
      }),
      st,
    );

    // ---- right: selected joint
    const ss = sec('Selected', right);
    this.ui.selSec = ss;
    const fields = h('div', 'at-fields');
    ss.append(fields);
    this.ui.fields = fields;
    const ls = sec('Joints', right);
    const list = h('div', 'at-bones');
    ls.append(list);
    this.ui.bones = list;

    // ---- bottom: transport + timeline
    const tr = h('div', 'at-transport');
    this.ui.transport = tr;
    bottom.append(tr);
    this.tl = h('canvas', 'at-timeline') as HTMLCanvasElement;
    bottom.append(this.tl);
    this.timelineInput();

    view.addEventListener('pointerdown', (e) => this.pick(e));
    addEventListener('keydown', (e) => this.key(e));
    addEventListener('beforeunload', (e) => {
      if (this.dirty) e.preventDefault();
    });
  }

  private refreshAll() {
    this.refreshClipPanel();
    this.refreshTransport();
    this.refreshBoneList();
    this.refreshFields(true);
    this.attachGizmo();
  }

  private refreshClipPanel() {
    const sel = this.ui.clipSel as HTMLSelectElement;
    sel.innerHTML = '';
    for (const n of Object.keys(CLIPS)) sel.append(new Option(n, n));
    if (!this.clipName && sel.options.length) this.clipName = sel.options[0].value;
    sel.value = this.clipName;
    (this.ui.clipNameIn as HTMLInputElement).value = this.clipName;
    const p = this.ui.clipProps;
    p.innerHTML = '';
    const c = this.clip;
    if (!c) {
      p.append(h('p', 'at-dim', 'No clips yet: type a name and press New.'));
    } else {
      const num = (label: string, get: () => number, set: (v: number) => void, step = 0.05) => {
        const row = h('label', 'at-row');
        const i = h('input') as HTMLInputElement;
        i.type = 'number';
        i.step = String(step);
        i.value = String(get());
        i.onchange = () => {
          this.snapshot();
          set(+i.value);
          this.changed();
        };
        row.append(h('span', '', label), i);
        p.append(row);
      };
      num('Length s', () => c.length, (v) => (c.length = Math.max(0.1, v)));
      num('Fade in s', () => c.blendIn ?? 0.12, (v) => (c.blendIn = Math.max(0, v)));
      num('Fade out s', () => c.blendOut ?? 0.18, (v) => (c.blendOut = Math.max(0, v)));
      const chk = (label: string, get: () => boolean, set: (v: boolean) => void) => {
        const row = h('label', 'at-row at-chk');
        const i = h('input') as HTMLInputElement;
        i.type = 'checkbox';
        i.checked = get();
        i.onchange = () => {
          this.snapshot();
          set(i.checked);
          this.changed();
        };
        row.append(i, h('span', '', label));
        p.append(row);
      };
      chk('Loops', () => !!c.loop, (v) => (c.loop = v));
      p.append(h('p', 'at-dim', 'Plays on:'));
      for (const k of ['assoc', 'super', 'striker', 'manager'] as CharKindName[])
        chk(
          { assoc: 'Associates', super: 'Supervisors', striker: 'Workers', manager: 'Regional Manager' }[k],
          () => !c.for?.length || c.for.includes(k),
          (v) => {
            const all: CharKindName[] = ['assoc', 'super', 'striker', 'manager'];
            const cur = new Set(c.for?.length ? c.for : all);
            if (v) cur.add(k);
            else cur.delete(k);
            c.for = cur.size === all.length ? [] : [...cur];
          },
        );
      const note = h('textarea') as HTMLTextAreaElement;
      note.placeholder = 'Notes (what it is for, when the game plays it)';
      note.value = c.note ?? '';
      note.onchange = () => {
        c.note = note.value || undefined;
        this.changed();
      };
      p.append(note);
      if (c.for?.length && !c.for.includes(this.model.kind as CharKindName)) p.append(h('p', 'at-warn', 'This clip is not for the character shown.'));
    }
    this.ui.status.textContent = (this.dirty ? '● Unsaved changes. ' : '') + this.status;
    this.drawTimeline();
  }

  private refreshTransport() {
    const tr = this.ui.transport;
    tr.innerHTML = '';
    const b = (label: string, fn: () => void, title = '', on = false) => {
      const e = h('button', on ? 'on' : '', label);
      e.onclick = fn;
      e.title = title;
      tr.append(e);
      return e;
    };
    b('|◀', () => this.setTime(0), 'Start');
    b('◀◆', () => this.stepKey(-1), 'Previous key ( , )');
    b(this.playing ? '❚❚' : '▶', () => this.togglePlay(), 'Play / pause (Space)');
    b('◆▶', () => this.stepKey(1), 'Next key ( . )');
    b('Loop', () => {
      this.loopPlay = !this.loopPlay;
      this.refreshTransport();
    }, 'Loop playback', this.loopPlay);
    const sp = h('select');
    for (const v of [0.1, 0.25, 0.5, 1]) sp.append(new Option(v === 1 ? 'Speed 1×' : `Speed ${v}×`, String(v)));
    sp.value = String(this.speed);
    sp.onchange = () => (this.speed = +sp.value);
    tr.append(sp);
    b('Fades', () => {
      this.showBlend = !this.showBlend;
      this.refreshTransport();
    }, 'Show the fade in / out the game uses', this.showBlend);
    tr.append(h('span', 'at-sep'));
    b('+ Key', () => this.addKey(), 'Add a key at the playhead (K)');
    b('− Key', () => this.deleteKey(), 'Delete the key at the playhead (Delete)');
    b('Copy pose', () => this.copyPose(), 'Copy the pose at the playhead (Ctrl+C)');
    b('Paste pose', () => this.pastePose(), 'Paste a copied pose at the playhead (Ctrl+V)');
    b('Mirror', () => this.mirrorPose(), 'Swap left and right at the playhead');
    const ease = h('select');
    for (const v of ['smooth', 'linear', 'step']) ease.append(new Option(`Ease: ${v}`, v));
    const k = this.clip?.keys[this.keyIndexAt(this.t)];
    ease.value = k?.ease ?? 'smooth';
    ease.disabled = !k;
    ease.title = 'How this key moves into the next one';
    ease.onchange = () => {
      const kk = this.clip?.keys[this.keyIndexAt(this.t)];
      if (!kk) return;
      this.snapshot();
      kk.ease = ease.value === 'smooth' ? undefined : (ease.value as ClipKey['ease']);
      this.changed();
    };
    tr.append(ease);
    const time = h('span', 'at-time');
    this.ui.time = time;
    tr.append(time);
  }

  private refreshBoneList() {
    const l = this.ui.bones;
    l.innerHTML = '';
    const add = (s: Sel, label: string) => {
      const e = h('button', this.sel === s ? 'on' : '', label);
      e.onclick = () => this.select(s);
      l.append(e);
    };
    for (const n of BONES) add(n, LABEL[n]);
    if (this.model.held) add('rifle', 'Rifle');
  }

  private refreshFields(force: boolean) {
    const f = this.ui.fields;
    if (!force && f.contains(document.activeElement)) return;
    f.innerHTML = '';
    const c = this.clip;
    if (!c) {
      f.append(h('p', 'at-dim', 'Make a clip first.'));
      return;
    }
    const ki = this.keyIndexAt(this.t);
    const k = ki >= 0 ? c.keys[ki] : sampleKey(c, this.t);
    f.append(h('p', 'at-dim', ki >= 0 ? `Key at ${k.t.toFixed(2)} s` : `Between keys (${this.t.toFixed(2)} s): editing adds a key`));
    if (!this.sel) {
      f.append(h('p', 'at-dim', 'Click a joint in the view, or pick one below.'));
    } else {
      f.append(h('h4', '', this.sel === 'rifle' ? 'Rifle' : LABEL[this.sel]));
      const vals = this.sel === 'rifle' ? (k.rifle ?? [0, 0, 0, 0, 0, 0]) : (k.bones?.[this.sel] ?? [0, 0, 0]);
      const names = this.sel === 'rifle' ? ['Move X m', 'Move Y m', 'Move Z m', 'Turn X°', 'Turn Y°', 'Turn Z°'] : ['Turn X° (pitch)', 'Turn Y° (twist)', 'Turn Z° (roll)'];
      names.forEach((n, j) => {
        const row = h('label', 'at-row');
        const i = h('input') as HTMLInputElement;
        i.type = 'number';
        i.step = this.sel === 'rifle' && j < 3 ? '0.005' : '1';
        i.value = String(vals[j]);
        i.onchange = () => {
          this.snapshot();
          const kk = this.ensureKey()!;
          if (this.sel === 'rifle') {
            kk.rifle = (kk.rifle ?? [0, 0, 0, 0, 0, 0]).slice() as ClipKey['rifle'];
            kk.rifle![j] = +i.value;
          } else {
            kk.bones = kk.bones ?? {};
            const v = (kk.bones[this.sel as BoneName] ?? [0, 0, 0]).slice() as [number, number, number];
            v[j] = +i.value;
            kk.bones[this.sel as BoneName] = v;
          }
          this.changed();
        };
        row.append(h('span', '', n), i);
        f.append(row);
      });
      const zero = h('button', '', 'Zero this joint here');
      zero.onclick = () => {
        this.snapshot();
        const kk = this.ensureKey()!;
        if (this.sel === 'rifle') delete kk.rifle;
        else if (kk.bones) delete kk.bones[this.sel as BoneName];
        this.changed();
      };
      f.append(zero);
      if (this.sel === 'rifle') {
        const m = h('button', '', this.rifleMode === 'translate' ? 'Gizmo: move (R to turn)' : 'Gizmo: turn (R to move)');
        m.onclick = () => this.toggleRifleMode();
        f.append(m);
      }
    }
    if (this.model.held) {
      const row = h('label', 'at-row');
      const i = h('input') as HTMLInputElement;
      i.type = 'range';
      i.min = '0';
      i.max = '1';
      i.step = '0.01';
      i.value = String(k.mag ?? 0);
      i.onchange = () => {
        this.snapshot();
        this.ensureKey()!.mag = +(+i.value).toFixed(2);
        this.changed();
      };
      row.append(h('span', '', 'Left hand: grip → magazine'), i);
      f.append(row);
    }
  }

  private toggleRifleMode() {
    this.rifleMode = this.rifleMode === 'translate' ? 'rotate' : 'translate';
    this.attachGizmo();
    this.refreshFields(true);
  }

  private togglePlay() {
    if (!this.clip) return;
    this.playing = !this.playing;
    if (this.playing && this.t >= this.clip.length - 1e-3) this.t = 0;
    this.refreshTransport();
  }
  private stepKey(dir: number) {
    const c = this.clip;
    if (!c || !c.keys.length) return;
    const ts = c.keys.map((k) => k.t);
    const next = dir > 0 ? ts.find((t) => t > this.t + 1e-3) : [...ts].reverse().find((t) => t < this.t - 1e-3);
    if (next !== undefined) this.setTime(next);
  }
  addKey() {
    if (!this.clip) return;
    this.snapshot();
    this.ensureKey();
    this.changed();
    this.refreshTransport();
  }
  private deleteKey() {
    const c = this.clip;
    const i = this.keyIndexAt(this.t);
    if (!c || i < 0) return;
    this.snapshot();
    c.keys.splice(i, 1);
    this.changed();
    this.refreshTransport();
  }
  private copyPose() {
    const c = this.clip;
    if (!c) return;
    const i = this.keyIndexAt(this.t);
    this.clipboard = JSON.parse(JSON.stringify(i >= 0 ? c.keys[i] : sampleKey(c, this.t)));
    this.status = 'Pose copied.';
    this.refreshClipPanel();
  }
  private pastePose() {
    if (!this.clipboard || !this.clip) return;
    this.snapshot();
    const k = this.ensureKey()!;
    const t = k.t;
    Object.assign(k, JSON.parse(JSON.stringify(this.clipboard)), { t });
    this.changed();
  }
  /** Swap left and right limbs and flip the sideways turns, at the playhead. */
  private mirrorPose() {
    if (!this.clip) return;
    this.snapshot();
    const k = this.ensureKey()!;
    const src = k.bones ?? {};
    const out: ClipKey['bones'] = {};
    const flip = (v?: [number, number, number]) => (v ? ([v[0], -v[1], -v[2]] as [number, number, number]) : undefined);
    const pair: Partial<Record<BoneName, BoneName>> = { armL: 'armR', armR: 'armL', foreL: 'foreR', foreR: 'foreL', thighL: 'thighR', thighR: 'thighL', shinL: 'shinR', shinR: 'shinL' };
    for (const n of BONES) {
      const v = flip(src[pair[n] ?? n]);
      if (v) out[n] = v;
    }
    k.bones = out;
    this.changed();
  }

  private pick(e: PointerEvent) {
    if (e.button !== 0 || (this.gizmo as unknown as { axis: string | null }).axis) return;
    const r = this.ui.view.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(p, this.camera);
    const hit = this.raycaster.intersectObjects(this.markers, false)[0];
    if (hit) {
      this.select(hit.object.userData.bone as BoneName);
      return;
    }
    if (this.model.held && this.raycaster.intersectObject(this.model.held, false).length) this.select('rifle');
  }

  private key(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.code === 'Space') {
      e.preventDefault();
      this.togglePlay();
    } else if (e.code === 'KeyK') this.addKey();
    else if (e.code === 'Comma') this.stepKey(-1);
    else if (e.code === 'Period') this.stepKey(1);
    else if (e.code === 'Delete' || e.code === 'Backspace') this.deleteKey();
    else if (e.code === 'KeyR') this.toggleRifleMode();
    else if (e.code === 'Escape') this.select(null);
    else if (ctrl && e.code === 'KeyZ') {
      e.preventDefault();
      this.undoStep(e.shiftKey);
    } else if (ctrl && e.code === 'KeyY') this.undoStep(true);
    else if (ctrl && e.code === 'KeyC') this.copyPose();
    else if (ctrl && e.code === 'KeyV') this.pastePose();
    else if (ctrl && e.code === 'KeyS') {
      e.preventDefault();
      void this.save();
    }
  }

  // ---- timeline
  private tlX(t: number) {
    const c = this.clip;
    const w = this.tl.clientWidth;
    return 16 + (t / Math.max(0.1, c?.length ?? 1)) * (w - 32);
  }
  private tlT(x: number) {
    const c = this.clip;
    const w = this.tl.clientWidth;
    return ((x - 16) / (w - 32)) * Math.max(0.1, c?.length ?? 1);
  }
  private timelineInput() {
    let drag: { key: number } | 'head' | null = null;
    this.tl.addEventListener('pointerdown', (e) => {
      const c = this.clip;
      if (!c) return;
      this.tl.setPointerCapture(e.pointerId);
      const x = e.offsetX;
      const ki = c.keys.findIndex((k) => Math.abs(this.tlX(k.t) - x) < 7 && e.offsetY > 22);
      if (ki >= 0) {
        this.snapshot();
        drag = { key: ki };
        this.setTime(c.keys[ki].t);
      } else {
        drag = 'head';
        this.setTime(snap(this.tlT(x)));
      }
      this.refreshTransport();
    });
    this.tl.addEventListener('pointermove', (e) => {
      const c = this.clip;
      if (!drag || !c) return;
      const t = Math.max(0, Math.min(c.length, snap(this.tlT(e.offsetX))));
      if (drag === 'head') this.setTime(t);
      else {
        c.keys[drag.key].t = t;
        this.t = t;
      }
    });
    this.tl.addEventListener('pointerup', () => {
      const c = this.clip;
      if (c && drag && drag !== 'head') {
        const k = c.keys[drag.key];
        c.keys.sort((a, b) => a.t - b.t);
        this.selKey = c.keys.indexOf(k);
        this.changed();
      }
      drag = null;
      this.refreshTransport();
    });
  }
  private drawTimeline() {
    const cv = this.tl;
    if (!cv) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = cv.clientWidth;
    const hh = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(hh * dpr);
    }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#191a22';
    g.fillRect(0, 0, w, hh);
    const c = this.clip;
    if (this.ui.time) this.ui.time.textContent = c ? `${this.t.toFixed(2)} / ${c.length.toFixed(2)} s · frame ${Math.round(this.t * FPS)}` : '';
    if (!c) return;
    // ruler
    g.strokeStyle = '#3a3d4b';
    g.fillStyle = '#a3a3ad';
    g.font = '11px system-ui, sans-serif';
    for (let f = 0; f <= Math.round(c.length * FPS); f++) {
      const x = this.tlX(f / FPS);
      const major = f % FPS === 0;
      const mid = f % (FPS / 2) === 0;
      g.beginPath();
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, major ? 18 : mid ? 12 : 6);
      g.stroke();
      if (major) g.fillText(`${f / FPS}s`, x + 3, 14);
    }
    // fades
    if (!c.loop) {
      g.fillStyle = 'rgba(83,199,255,0.12)';
      g.fillRect(this.tlX(0), 22, this.tlX(c.blendIn ?? 0.12) - this.tlX(0), hh - 30);
      g.fillRect(this.tlX(c.length - (c.blendOut ?? 0.18)), 22, this.tlX(c.length) - this.tlX(c.length - (c.blendOut ?? 0.18)), hh - 30);
    }
    // track
    g.fillStyle = '#22242e';
    g.fillRect(16, 30, w - 32, hh - 44);
    // keys
    const cy = 30 + (hh - 44) / 2;
    c.keys.forEach((k) => {
      const x = this.tlX(k.t);
      const at = Math.abs(k.t - this.t) < 0.5 / FPS;
      g.fillStyle = at ? '#ffd21f' : this.sel && (this.sel === 'rifle' ? k.rifle : k.bones?.[this.sel]) ? '#ff7a1a' : '#e9e6dc';
      g.beginPath();
      g.moveTo(x, cy - 8);
      g.lineTo(x + 7, cy);
      g.lineTo(x, cy + 8);
      g.lineTo(x - 7, cy);
      g.closePath();
      g.fill();
    });
    // playhead
    const px = this.tlX(this.t);
    g.strokeStyle = '#ffd21f';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px, 0);
    g.lineTo(px, hh);
    g.stroke();
    g.lineWidth = 1;
  }

  // ------------------------------------------------------------------ scripting / contact sheets

  /** Render one picture of the current character, for contact sheets. */
  private still(yaw: number, w: number, hh: number) {
    const hgt = this.model.height;
    const tgt = new THREE.Vector3(0, hgt * 0.5, 0);
    const d = hgt * 1.75;
    this.camera.position.set(Math.sin(yaw) * d, hgt * 0.62, -Math.cos(yaw) * d);
    this.camera.lookAt(tgt);
    this.camera.aspect = w / hh;
    this.camera.updateProjectionMatrix();
    this.pipe.resize(w, hh);
    this.render(false);
    return this.pipe.renderer.domElement;
  }

  api() {
    const tool = this;
    return {
      ready: false,
      cast: CAST.map((c) => c.label),
      clips: () => Object.keys(CLIPS),
      data: () => JSON.parse(JSON.stringify(CLIPS)),
      setCast: (i: number) => {
        tool.setCast(i);
        (tool.ui.cast as HTMLSelectElement).value = String(i);
      },
      base: (o: Partial<AnimTool['base']>) => Object.assign(tool.base, o),
      clip: (n: string) => {
        tool.clipName = n;
        tool.setTime(0);
        tool.refreshAll();
      },
      newClip: (n: string) => tool.newClip(n),
      time: (t: number) => tool.setTime(t),
      select: (s: Sel) => tool.select(s),
      /** set a joint's offset (degrees) or the rifle's [x,y,z m, x,y,z deg] at the playhead */
      set: (s: BoneName | 'rifle' | 'mag', v: number[] | number) => {
        tool.snapshot();
        const k = tool.ensureKey()!;
        if (s === 'mag') k.mag = v as number;
        else if (s === 'rifle') k.rifle = v as ClipKey['rifle'];
        else (k.bones = k.bones ?? {})[s] = v as [number, number, number];
        tool.changed();
      },
      length: (len: number) => {
        if (tool.clip) tool.clip.length = len;
        tool.changed();
      },
      step: (n = 30) => {
        for (let i = 0; i < n; i++) tool.drive(1 / 30);
      },
      save: () => tool.save(),
      /** where a joint is on screen, in page pixels (for tests that click and drag) */
      screen: (n: BoneName) => {
        const v = new THREE.Vector3();
        tool.model.bones[BONES.indexOf(n)].getWorldPosition(v).project(tool.camera);
        const r = tool.ui.view.getBoundingClientRect();
        return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
      },
      state: () => ({ cast: CAST[tool.castIdx].label, clip: tool.clipName, t: tool.t, sel: tool.sel, keys: tool.clip?.keys.length ?? 0, dirty: tool.dirty }),
      /**
       * A contact sheet: rows of (character x clip), columns of (time x camera angle). Returns a
       * PNG data URL. times are fractions of the clip length; yaws are radians around the model.
       */
      sheet: (o: { cast?: number[]; clips?: string[]; times?: number[]; yaws?: number[]; cell?: [number, number]; base?: Partial<AnimTool['base']> }) => {
        const cast = o.cast ?? CAST.map((_, i) => i);
        const clips = o.clips ?? [''];
        const times = o.times ?? [0];
        const yaws = o.yaws ?? [0.5];
        const [cw, ch] = o.cell ?? [240, 300];
        const rows: [number, string][] = [];
        for (const ci of cast) for (const cl of clips) {
          const c = CLIPS[cl];
          if (cl && c?.for?.length && !c.for.includes(CAST[ci].kind as CharKindName)) continue;
          rows.push([ci, cl]);
        }
        const cols = times.length * yaws.length;
        const out = document.createElement('canvas');
        const lab = 20;
        out.width = cols * cw;
        out.height = rows.length * (ch + lab) + lab;
        const g = out.getContext('2d')!;
        g.fillStyle = '#121319';
        g.fillRect(0, 0, out.width, out.height);
        g.font = '600 13px system-ui, sans-serif';
        const keepCast = tool.castIdx;
        const keepClip = tool.clipName;
        const keepT = tool.t;
        const keepBase = { ...tool.base };
        const keepSel = tool.sel;
        tool.gizmo.detach();
        if (o.base) Object.assign(tool.base, o.base);
        let y = lab;
        times.forEach((tf, i) => yaws.forEach((yw, j) => {
          g.fillStyle = '#a3a3ad';
          g.fillText(`${clips.length > 1 || clips[0] ? `${Math.round(tf * 100)}%` : ''} ${Math.round((yw * 180) / Math.PI)}°`, (i * yaws.length + j) * cw + 6, 14);
        }));
        for (const [ci, cl] of rows) {
          tool.setCast(ci);
          tool.clipName = cl;
          g.fillStyle = '#e9e6dc';
          g.fillText(`${CAST[ci].label}${cl ? ' · ' + cl : ''}`, 6, y + 14);
          let col = 0;
          for (const tf of times) {
            const c = CLIPS[cl];
            tool.t = c ? tf * c.length : 0;
            for (let k = 0; k < 30; k++) tool.drive(1 / 30);
            for (const yw of yaws) {
              const src = tool.still(yw, cw, ch);
              g.drawImage(src, 0, 0, src.width, src.height, col * cw, y + lab, cw, ch);
              col++;
            }
          }
          y += ch + lab;
        }
        Object.assign(tool.base, keepBase);
        tool.setCast(keepCast);
        tool.clipName = keepClip;
        tool.t = keepT;
        tool.sel = keepSel;
        tool.attachGizmo();
        tool.resize();
        return out.toDataURL('image/png');
      },
    };
  }
}
