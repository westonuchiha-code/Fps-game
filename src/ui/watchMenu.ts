import * as THREE from 'three';
import './menus.css';
import type { Game } from '../game';
import { DIFFICULTIES } from '../game';
import { Kit } from '../render/kit';
import { flat, RAMP_METAL, toon } from '../render/toon';
import { signTexture, drawSmile } from '../render/textures';
import { angleDelta, clamp, TAU } from '../core/math';
import { hasSave, loadSave, writeSave } from '../core/save';
import type { Action } from '../core/input';

// ------------------------------------------------------------------ campaign table

export interface MissionInfo {
  id: string;
  num: number;
  title: string;
  beat: string;
  available: boolean;
}

/** The ten operations from docs/GAME_DESIGN.md. Only #1 is playable for now. */
export const MISSIONS: MissionInfo[] = [
  { id: 'receiving', num: 1, title: 'Receiving', beat: 'Breach Fulfillment Center 7’s loading docks. Plant your first severance packages, take a truck, and have a word with the Regional Manager.', available: true },
  { id: 'sortation', num: 2, title: 'Sortation', beat: 'Inside FC-7: conveyors, robot arms; destroy the control uplink.', available: false },
  { id: 'last-mile', num: 3, title: 'Last Mile', beat: 'Vehicle chase across the delivery flats.', available: false },
  { id: 'price-check', num: 4, title: 'Price Check', beat: 'Firefights through a flagship Supercenter.', available: false },
  { id: 'returns', num: 5, title: 'Returns Department', beat: 'Rescue captured union members from the scrapyard.', available: false },
  { id: 'the-cloud', num: 6, title: 'The Cloud', beat: 'MonoMart’s server farm.', available: false },
  { id: 'black-friday', num: 7, title: 'Black Friday', beat: 'City uprising.', available: false },
  { id: 'hostile-takeover', num: 8, title: 'Hostile Takeover', beat: 'Assault the MonoMart Tower plaza and lobby.', available: false },
  { id: 'golden-parachute', num: 9, title: 'Golden Parachute', beat: 'Up the executive floors.', available: false },
  { id: 'exit-interview', num: 10, title: 'Exit Interview', beat: 'Max Price’s robotic CEO chassis.', available: false },
];

export interface WatchMenuCallbacks {
  onStartMission(missionId: string, difficulty: number): void;
  onResume(): void;
  onRestart(): void;
  onQuitToMenu(): void;
  onOpenBackpack(): void;
  onOpenEditor(): void;
}

interface Opt {
  id: string;
  label: string;
  desc?: string | (() => string);
  /** short value shown in the label and on the LCD */
  value?: () => string;
  /** left/right (and the label arrows) */
  adjust?: (dir: number) => void;
  accept?: () => void;
  locked?: boolean;
  danger?: boolean;
  /** big LCD line (defaults to value or label) */
  lcd?: () => string;
}

interface Page {
  id: string;
  title: string;
  opts: Opt[];
  /** hours on the dial where the options sit: full circle from 12, or an arc [from, to] */
  arc?: [number, number];
  /** HTML for the dossier panel (re-evaluated on every selection change) */
  panel?: (sel: Opt) => string;
  sel: number;
}

// ------------------------------------------------------------------ palette

const C = {
  steel: 0xc3ccd6,
  steelDark: 0x66717d,
  insert: 0x18203a,
  marker: 0xf2ecd9,
  hivis: 0xff7a1a,
  red: 0xe8322a,
  lume: 0xd9f7c4,
  glove: 0x262322,
  gloveHi: 0x3d3835,
  stitch: 0x6b5f55,
  strap: 0x232c45,
  strapEdge: 0x161b2b,
  shirt: 0xf4f1e8,
  tux: 0x1b1c26,
  tuxHi: 0x2b2d3a,
  gold: 0xd9a52b,
  lcd: 0xa4b48a,
  lcdFrame: 0x20242c,
};

const HOUR = TAU / 12;
const _v = new THREE.Vector3();
const _c = new THREE.Vector3();

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pct = (v: number) => Math.round(v * 100) + '%';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** Resolution steps. pixelScale 0 = auto integer divisor towards pipe.targetHeight. */
const RES_STEPS = [
  { name: 'PS2', pixelScale: 0, target: 540, desc: 'Chunky pixels, as nature intended' },
  { name: 'SHARP', pixelScale: 0, target: 1080, desc: 'Auto, about twice the PS2 lines' },
  { name: 'NATIVE', pixelScale: 1, target: 540, desc: 'One pixel per screen pixel' },
];

export class WatchMenu {
  private readonly g: Game;
  private readonly cb: WatchMenuCallbacks;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 80);
  private readonly rig = new THREE.Group();
  private readonly watch = new THREE.Group();
  private readonly bezel = new THREE.Group();
  private readonly hourHand = new THREE.Group();
  private readonly secondHand = new THREE.Group();
  private readonly stud = new THREE.Group();
  private readonly pips = new THREE.Group();
  private pipMat = flat(0xf2ecd9);
  private pipOn = flat(0xffd21f);
  private pipLocked = flat(0x59606b);
  private pipGeo = new THREE.BoxGeometry(0.075, 0.17, 0.03);
  private dialTex: THREE.CanvasTexture | null = null;

  // DOM
  private readonly root: HTMLElement;
  private readonly head: HTMLElement;
  private readonly labels: HTMLElement;
  private readonly lcd: HTMLElement;
  private readonly lcdBig: HTMLElement;
  private readonly lcdSmall: HTMLElement;
  private readonly lcdTop: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly hints: HTMLElement;
  private labelEls: HTMLElement[] = [];

  private stack: Page[] = [];
  private mode: 'main' | 'pause' = 'main';
  private _open = false;
  private guard = 0;
  private openT = 0;
  private t = 0;
  private lastReal = 0;
  private lastSec = -1;
  private hand = 0;
  private handVel = 0;
  private handTarget = 0;
  private bez = 0;
  private bezVel = 0;
  private bezTarget = 0;
  private sec = 0;
  private studPress = 0;
  private flashT = 0;
  private flashText = '';
  private hold: Partial<Record<Action, number>> = {};
  private pointer = { x: 0, y: 0 };
  private prevOverride: Game['renderOverride'] = null;
  private hudWasHidden = false;
  private lastDevice = '';
  private lcdFitKey = '';

  constructor(game: Game, callbacks: WatchMenuCallbacks) {
    this.g = game;
    this.cb = callbacks;
    this.buildScene();

    this.root = el('div', 'wm');
    this.head = el('div', 'wm-head');
    this.labels = el('div', 'wm-labels');
    this.lcd = el('div', 'wm-lcd');
    this.lcdTop = el('div', 'wm-lcd-top');
    this.lcdBig = el('div', 'wm-lcd-big');
    this.lcdSmall = el('div', 'wm-lcd-small');
    this.lcd.append(this.lcdTop, this.lcdBig, this.lcdSmall);
    this.panel = el('div', 'wm-panel');
    this.hints = el('div', 'wm-hints');
    this.root.append(this.head, this.labels, this.lcd, this.panel, this.hints);
    game.ui.appendChild(this.root);

    this.root.addEventListener(
      'wheel',
      (e) => {
        if (!this._open) return;
        e.preventDefault();
        this.step(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false },
    );
    this.root.addEventListener('pointermove', (e) => {
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.lcd.addEventListener('click', () => this.accept());
    this.hints.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!b) return;
      if (b.dataset.act === 'back') this.back();
      else if (b.dataset.act === 'accept') this.accept();
    });

    // the "Sharp" resolution step lives in pipe.targetHeight, which Game.applySettings does not own
    const rt = (game.settings as unknown as { resTarget?: number }).resTarget;
    if (rt && rt !== game.pipe.targetHeight) {
      game.pipe.targetHeight = rt;
      game.resize();
    }

    game.systems.push({ update: () => this.update() });
    // the dial is painted with the HUD fonts: repaint once they are all in
    document.fonts?.ready.then(() => this.paintDial()).catch(() => {});
  }

  get isOpen() {
    return this._open;
  }

  openMain() {
    this.mode = 'main';
    this.stack = [this.pageMain()];
    this.show();
    void this.g.audio.playMusic('menu');
  }

  openPause() {
    this.mode = 'pause';
    this.stack = [this.pagePause()];
    this.show();
  }

  close() {
    if (!this._open) return;
    this._open = false;
    this.root.classList.remove('on');
    if (this.g.renderOverride && this.g.renderOverride.scene === this.scene) this.g.renderOverride = this.prevOverride;
    this.prevOverride = null;
    this.g.hud.setVisible(!this.hudWasHidden);
    this.hold = {};
  }

  // ================================================================== scene

  private buildScene() {
    const s = this.scene;
    s.add(this.rig);
    this.rig.add(this.watch);

    // lights: warm key from upper left, cool rim from behind right, low fill
    const key = new THREE.DirectionalLight(0xfff1dc, 2.6);
    key.position.set(-4, 5, 6);
    const rim = new THREE.DirectionalLight(0x7fc4ff, 2.4);
    rim.position.set(5, 2.5, -4);
    const rim2 = new THREE.DirectionalLight(0xff9a5a, 1.1);
    rim2.position.set(-6, -3, -3);
    const hemi = new THREE.HemisphereLight(0x9aa6c8, 0x1a1420, 0.9);
    s.add(key, rim, rim2, hemi);

    // backdrop: dark blueprint board with a soft spotlight behind the watch
    const bgTex = signTexture(512, 288, (g, w, h) => {
      const gr = g.createRadialGradient(w * 0.5, h * 0.5, 10, w * 0.5, h * 0.5, w * 0.62);
      gr.addColorStop(0, '#26304a');
      gr.addColorStop(0.55, '#141a2a');
      gr.addColorStop(1, '#07080d');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(140,170,255,0.07)';
      g.lineWidth = 1;
      for (let x = 0; x < w; x += 16) {
        g.beginPath();
        g.moveTo(x + 0.5, 0);
        g.lineTo(x + 0.5, h);
        g.stroke();
      }
      for (let y = 0; y < h; y += 16) {
        g.beginPath();
        g.moveTo(0, y + 0.5);
        g.lineTo(w, y + 0.5);
        g.stroke();
      }
      g.globalAlpha = 0.06;
      drawSmile(g, w * 0.84, h * 0.24, 40, '#ffd21f', 'happy');
      g.globalAlpha = 1;
    });
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(64, 36), flat(0xffffff, { map: bgTex, fog: false }));
    bg.position.z = -14;
    s.add(bg);

    this.buildArm();
    this.buildCase();
    this.buildBezel();
    this.buildDial();
    this.buildHands();
    this.watch.add(this.pips);
  }

  private buildArm() {
    const k = new Kit();
    const Ry = 1.42;
    const Rz = 0.98;
    const top = -0.66;
    const zc = top - Rz;

    // gloved wrist and forearm (elliptical, faceted)
    k.push([0.1, 0, zc], [0, 0, 0], [1, Ry, Rz]);
    k.cyl(1.05, 0.97, 4.6, C.glove, [0, 0, 0], 'x', 14, false);
    // gauntlet flare + stitched hem
    k.cyl(1.1, 1.1, 0.34, C.gloveHi, [-2.15, 0, 0], 'x', 14, false);
    k.cyl(1.115, 1.115, 0.05, C.stitch, [-2.0, 0, 0], 'x', 14, false);
    // shirt cuff
    k.cyl(1.15, 1.15, 0.7, C.shirt, [-2.65, 0, 0], 'x', 14, false);
    // tuxedo sleeve with hi-vis edge band
    k.cyl(1.3, 1.26, 0.28, C.hivis, [-3.1, 0, 0], 'x', 14, false);
    k.cyl(1.265, 1.265, 0.05, 0xfff3c0, [-3.12, 0, 0], 'x', 14, false);
    k.cyl(1.4, 1.27, 8, C.tux, [-7.2, 0, 0], 'x', 14, false);
    k.pop();
    // cufflink (gold, with a tiny 404 face)
    k.box(0.32, 0.32, 0.12, C.gold, [-2.62, -Ry * 0.62, zc + Rz * 0.82], [0.6, 0, 0.785]);
    k.box(0.12, 0.12, 0.13, C.hivis, [-2.62, -Ry * 0.62, zc + Rz * 0.84], [0.6, 0, 0.785]);
    // tux sleeve buttons
    for (let i = 0; i < 3; i++) k.box(0.18, 0.18, 0.1, 0x0d0d12, [-3.55 - i * 0.3, -Ry * 0.86, zc + Rz * 0.62], [0.8, 0, 0]);
    // glove seam lines along the wrist
    for (const sy of [-1, 1]) k.box(3.6, 0.04, 0.04, C.stitch, [0.5, sy * Ry * 0.72, zc + Rz * 0.72], [sy * -0.75, 0, 0]);
    // velcro wrist strap on the glove, near the hand
    k.push([2.25, 0, zc], [0, 0, 0], [1, Ry * 1.04, Rz * 1.06]);
    k.cyl(1.0, 1.0, 0.55, C.gloveHi, [0, 0, 0], 'x', 14, false);
    k.pop();
    k.box(0.5, 0.5, 0.08, C.hivis, [2.25, 0.25, top + 0.06]);

    // hand (back of a gloved fist) beyond the wrist; fingers curl away from the camera
    const hz = top - 0.12;
    k.taper(2.5, 1.7, 1.25, 0.92, 1.0, C.glove, [3.3, 0, hz - 0.62], [0, 0, -Math.PI / 2]);
    k.box(1.15, 1.9, 0.2, C.gloveHi, [3.25, 0, hz + 0.02]);
    k.box(0.9, 0.08, 0.06, C.stitch, [3.25, 0.62, hz + 0.13]);
    k.box(0.9, 0.08, 0.06, C.stitch, [3.25, -0.62, hz + 0.13]);
    for (let i = 0; i < 4; i++) {
      const y = -0.84 + i * 0.56;
      k.box(0.5, 0.5, 0.5, C.glove, [4.25, y, hz - 0.22]);
      k.box(0.3, 0.18, 0.06, C.hivis, [4.25, y, hz + 0.05]);
      k.box(0.48, 0.48, 1.0, C.glove, [4.48, y, hz - 0.9], [0, 0.25, 0]);
    }
    k.taper(0.55, 1.2, 0.55, 0.8, 0.8, C.glove, [3.6, -1.32, hz - 0.62], [0, 0, 1.0]);

    // strap (NATO style: navy with a hi-vis stripe) wrapping the wrist
    const segs = 9;
    for (const sy of [1, -1]) {
      const phi0 = Math.PI * 0.42;
      let prev: [number, number] = [sy * 1.6, -0.5];
      for (let i = 0; i <= segs; i++) {
        const phi = phi0 + (i / segs) * (Math.PI - phi0);
        const p: [number, number] = [sy * (Ry + 0.07) * Math.sin(phi), zc + (Rz + 0.07) * Math.cos(phi)];
        const dy = p[0] - prev[0];
        const dz = p[1] - prev[1];
        const len = Math.hypot(dy, dz) + 0.03;
        const ang = Math.atan2(dz, dy);
        const mid: [number, number, number] = [0, (p[0] + prev[0]) / 2, (p[1] + prev[1]) / 2];
        k.push(mid, [ang, 0, 0]);
        k.box(1.02, len, 0.1, C.strap, [0, 0, 0], [0, 0, 0]);
        k.box(0.16, len + 0.005, 0.11, C.hivis, [0, 0, 0.004]);
        k.box(1.04, len + 0.005, 0.02, C.strapEdge, [0, 0, -0.05]);
        k.pop();
        prev = p;
      }
    }
    // buckle peeking out under the 6 o'clock side
    k.box(1.2, 0.08, 0.5, C.steel, [0, -Ry - 0.12, zc - 0.2]);

    const arm = k.mesh({ rim: 0.35 });
    this.watch.add(arm);
  }

  private buildCase() {
    const k = new Kit();
    // case body: chunky 24-sided drum
    k.cyl(1.22, 1.24, 0.56, C.steel, [0, 0, -0.33], 'z', 24, false);
    k.cyl(1.05, 1.15, 0.14, C.steelDark, [0, 0, -0.66], 'z', 24, false);
    // lugs
    for (const sy of [1, -1]) {
      for (const sx of [1, -1]) {
        k.taper(0.32, 0.62, 0.36, 0.9, 0.7, C.steel, [sx * 0.6, sy * 1.36, -0.42], [sy * 0.35 + (sy < 0 ? Math.PI : 0), 0, 0]);
      }
      // spring bar
      k.cyl(0.05, 0.05, 1.0, C.steelDark, [0, sy * 1.58, -0.5], 'x', 6);
    }
    // crown guards + crown at 3 o'clock
    k.box(0.26, 0.16, 0.34, C.steel, [1.32, 0.33, -0.3]);
    k.box(0.26, 0.16, 0.34, C.steel, [1.32, -0.33, -0.3]);
    k.cyl(0.19, 0.19, 0.3, C.steelDark, [1.43, 0, -0.3], 'x', 12, false);
    k.cyl(0.17, 0.17, 0.06, C.steel, [1.6, 0, -0.3], 'x', 12, false);
    // pusher at 2 o'clock
    const a2 = Math.PI / 2 - 2 * HOUR;
    k.push([Math.cos(a2) * 1.3, Math.sin(a2) * 1.3, -0.3], [0, 0, a2]);
    k.cyl(0.1, 0.1, 0.22, C.steelDark, [0.05, 0, 0], 'x', 10, false);
    k.cyl(0.12, 0.12, 0.06, C.steel, [0.18, 0, 0], 'x', 10, false);
    k.pop();
    // detonator stud guard at 4 o'clock
    const a4 = Math.PI / 2 - 4 * HOUR;
    k.push([Math.cos(a4) * 1.27, Math.sin(a4) * 1.27, -0.3], [0, 0, a4]);
    k.cyl(0.17, 0.17, 0.12, C.steelDark, [0.02, 0, 0], 'x', 12, false);
    k.pop();
    const m = k.mesh({ ramp: RAMP_METAL, rim: 0.45 });
    this.watch.add(m);

    // red detonator stud (animated when you press "accept")
    const sk = new Kit();
    sk.cyl(0.13, 0.12, 0.2, C.red, [0.1, 0, 0], 'x', 10, false);
    sk.cyl(0.15, 0.15, 0.04, C.hivis, [0.02, 0, 0], 'x', 10, false);
    this.stud.add(sk.mesh({ rim: 0.5 }));
    this.stud.position.set(Math.cos(a4) * 1.32, Math.sin(a4) * 1.32, -0.3);
    this.stud.rotation.z = a4;
    this.watch.add(this.stud);
  }

  private buildBezel() {
    const k = new Kit();
    const prof = [
      new THREE.Vector2(1.0, 0.04),
      new THREE.Vector2(1.03, 0.14),
      new THREE.Vector2(1.39, 0.14),
      new THREE.Vector2(1.47, 0.08),
      new THREE.Vector2(1.48, -0.04),
      new THREE.Vector2(1.3, -0.07),
    ];
    const lathe = new THREE.LatheGeometry(prof, 36);
    lathe.rotateX(Math.PI / 2);
    k.add(lathe, C.steel);
    lathe.dispose();
    // coin-edge grip
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      k.box(0.05, 0.07, 0.1, C.steelDark, [Math.cos(a) * 1.475, Math.sin(a) * 1.475, 0.02], [0, 0, a]);
    }
    const metal = k.mesh({ ramp: RAMP_METAL, rim: 0.4, side: THREE.DoubleSide });
    this.bezel.add(metal);

    const ik = new Kit();
    const ring = new THREE.RingGeometry(1.05, 1.38, 36, 1);
    ik.add(ring, C.insert, [0, 0, 0.145]);
    ring.dispose();
    for (let i = 0; i < 12; i++) {
      const th = i * HOUR;
      const x = Math.sin(th) * 1.215;
      const y = Math.cos(th) * 1.215;
      if (i === 0) {
        // hi-vis triangle at 12, pointing in
        const tri = new THREE.CylinderGeometry(0.13, 0.13, 0.03, 3);
        tri.rotateX(Math.PI / 2);
        tri.rotateZ(-Math.PI / 2);
        ik.add(tri, C.hivis, [x, y, 0.16]);
        tri.dispose();
      } else if (i % 3 === 0) ik.box(0.07, 0.22, 0.03, C.marker, [x, y, 0.16], [0, 0, -th]);
      else ik.box(0.08, 0.08, 0.03, C.marker, [x, y, 0.16], [0, 0, -th]);
    }
    const insert = ik.mesh({ rim: 0.3 });
    this.bezel.add(insert);
    this.watch.add(this.bezel);
  }

  private buildDial() {
    this.dialTex = signTexture(512, 512, () => {});
    this.paintDial();
    const dial = new THREE.Mesh(new THREE.CircleGeometry(1.01, 48), toon({ map: this.dialTex, rim: 0 }));
    dial.position.z = -0.03;
    this.watch.add(dial);

    // LCD complication on the lower half
    const k = new Kit();
    k.box(1.6, 0.52, 0.04, C.lcdFrame, [0, -0.4, -0.02]);
    k.box(1.66, 0.04, 0.05, C.steelDark, [0, -0.13, -0.015]);
    k.box(1.66, 0.04, 0.05, C.steelDark, [0, -0.67, -0.015]);
    this.watch.add(k.mesh({ rim: 0 }));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.43), flat(C.lcd));
    screen.position.set(0, -0.4, 0.002);
    this.watch.add(screen);
  }

  /** Painted dial face: minute track, union mark, maker text. Repainted once fonts have loaded. */
  private paintDial() {
    const tex = this.dialTex!;
    const c = tex.image as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    const w = c.width;
    const R = w / 2;
    g.clearRect(0, 0, w, w);
    const gr = g.createRadialGradient(R, R * 0.8, 10, R, R, R);
    gr.addColorStop(0, '#24304a');
    gr.addColorStop(1, '#0d111b');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, w);
    g.save();
    g.translate(R, R);
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU;
      const big = i % 5 === 0;
      g.strokeStyle = big ? '#f2ecd9' : 'rgba(242,236,217,0.55)';
      g.lineWidth = big ? 6 : 3;
      g.beginPath();
      g.moveTo(Math.sin(a) * R * (big ? 0.88 : 0.92), -Math.cos(a) * R * (big ? 0.88 : 0.92));
      g.lineTo(Math.sin(a) * R * 0.985, -Math.cos(a) * R * 0.985);
      g.stroke();
    }
    g.textAlign = 'center';
    g.fillStyle = '#f2ecd9';
    g.font = `400 ${Math.round(R * 0.17)}px Anton, Impact, sans-serif`;
    g.fillText('LOCAL 404', 0, -R * 0.42);
    g.fillStyle = '#ff7a1a';
    g.font = `700 ${Math.round(R * 0.09)}px Rajdhani, sans-serif`;
    g.fillText('C L E A R A N C E', 0, -R * 0.29);
    g.fillStyle = 'rgba(242,236,217,0.7)';
    g.font = `700 ${Math.round(R * 0.065)}px Rajdhani, sans-serif`;
    g.fillText('DETONATOR · 404 M', 0, R * 0.8);
    g.restore();
    tex.needsUpdate = true;
  }

  private buildHands() {
    // hour hand: broad arrow with a lume insert and hi-vis tip
    const hk = new Kit();
    hk.box(0.13, 0.5, 0.03, C.marker, [0, 0.3, 0]);
    hk.box(0.07, 0.4, 0.035, C.lume, [0, 0.32, 0.002]);
    const tip = new THREE.CylinderGeometry(0.15, 0.15, 0.03, 3);
    tip.rotateX(Math.PI / 2);
    tip.rotateZ(Math.PI / 2);
    hk.add(tip, C.hivis, [0, 0.62, 0]);
    tip.dispose();
    hk.box(0.09, 0.16, 0.03, C.marker, [0, -0.06, 0]);
    const hm = hk.mesh({ rim: 0.3 });
    hm.position.z = 0.02;
    this.hourHand.add(hm);
    this.watch.add(this.hourHand);

    const sk = new Kit();
    sk.box(0.025, 1.08, 0.02, C.red, [0, 0.32, 0]);
    sk.cyl(0.07, 0.07, 0.02, C.red, [0, -0.17, 0], 'z', 10);
    sk.cyl(0.05, 0.05, 0.022, C.lume, [0, 0.66, 0.001], 'z', 8);
    sk.cyl(0.075, 0.075, 0.06, C.steel, [0, 0, 0.02], 'z', 10);
    const sm = sk.mesh({ rim: 0.2 });
    sm.position.z = 0.06;
    this.secondHand.add(sm);
    this.watch.add(this.secondHand);
  }

  private rebuildPips() {
    for (const c of [...this.pips.children]) c.removeFromParent();
    const p = this.page;
    p.opts.forEach((o, i) => {
      const th = this.optAngle(i);
      const m = new THREE.Mesh(this.pipGeo, o.locked ? this.pipLocked : i === p.sel ? this.pipOn : this.pipMat);
      m.position.set(Math.sin(th) * 0.84, Math.cos(th) * 0.84, -0.01);
      m.rotation.z = -th;
      if (i === p.sel) m.scale.set(1.4, 1.25, 1);
      this.pips.add(m);
    });
  }

  // ================================================================== pages

  private get page() {
    return this.stack[this.stack.length - 1];
  }

  private optAngle(i: number) {
    const p = this.page;
    const n = p.opts.length;
    if (!p.arc) return (i / n) * TAU;
    const [a, b] = p.arc;
    const h = n === 1 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1);
    return h * HOUR;
  }

  private settingsChanged() {
    this.g.applySettings();
    this.g.saveSettings();
  }

  private pageMain(): Page {
    const save = loadSave();
    const opts: Opt[] = [
      { id: 'new', label: 'NEW GAME', desc: 'Start the campaign from Mission 01.', lcd: () => 'NEW HIRE', accept: () => this.push(this.pageDifficulty(MISSIONS[0].id, true)) },
    ];
    if (save && hasSave()) {
      const m = MISSIONS.find((x) => x.id === save.lastMission);
      const label = m ? `${String(m.num).padStart(2, '0')} ${m.title}` : save.lastMission;
      opts.push({
        id: 'continue',
        label: 'CONTINUE',
        desc: `${label} · ${DIFFICULTIES[save.difficulty]?.name ?? ''}`,
        lcd: () => 'RESUME',
        accept: () => this.startMission(save.lastMission, save.difficulty),
      });
    }
    opts.push(
      { id: 'missions', label: 'MISSIONS', desc: 'Operation dossiers. Most are above your pay grade.', lcd: () => 'DOSSIERS', accept: () => this.push(this.pageMissions()) },
      {
        id: 'editor',
        label: 'LEVEL EDITOR',
        desc: 'Build your own fulfillment centre. Then burn it down.',
        lcd: () => 'EDITOR',
        accept: () => {
          this.close();
          this.cb.onOpenEditor();
        },
      },
      { id: 'options', label: 'OPTIONS', desc: 'Controls, picture and sound.', lcd: () => 'SETUP', accept: () => this.push(this.pageOptions()) },
      { id: 'credits', label: 'CREDITS', desc: 'Who to blame.', lcd: () => 'CREDITS', accept: () => this.push(this.pageCredits()) },
    );
    return { id: 'main', title: 'MAIN MENU', opts, sel: 0 };
  }

  private pagePause(): Page {
    const lv = this.g.level;
    const opts: Opt[] = [
      {
        id: 'resume',
        label: 'RESUME',
        desc: 'Back to work.',
        lcd: () => 'RESUME',
        accept: () => {
          this.close();
          this.g.input.requestLock();
          this.cb.onResume();
        },
      },
      {
        id: 'objectives',
        label: 'OBJECTIVES',
        desc: () => {
          const o = this.g.level?.objectives ?? [];
          return o.length ? `${o.filter((x) => x.done).length}/${o.length} complete.` : 'No standing orders.';
        },
        lcd: () => 'ORDERS',
        accept: () => this.push(this.pageObjectives()),
      },
      {
        id: 'backpack',
        label: 'BACKPACK',
        desc: 'Gear, loot and severance packages.',
        lcd: () => 'GEAR',
        accept: () => {
          this.close();
          this.cb.onOpenBackpack();
        },
      },
      { id: 'options', label: 'OPTIONS', desc: 'Controls, picture and sound.', lcd: () => 'SETUP', accept: () => this.push(this.pageOptions()) },
      {
        id: 'restart',
        label: 'RESTART MISSION',
        desc: 'From the top. Progress since the start is lost.',
        lcd: () => 'RESTART',
        danger: true,
        accept: () =>
          this.push(
            this.pageConfirm('RESTART MISSION?', 'Start this mission over from the beginning.', () => {
              this.close();
              this.cb.onRestart();
            }),
          ),
      },
      {
        id: 'quit',
        label: 'QUIT TO MENU',
        desc: 'Clock out. Unsaved progress is forfeit.',
        lcd: () => 'CLOCK OUT',
        danger: true,
        accept: () =>
          this.push(
            this.pageConfirm('QUIT TO MENU?', 'Progress in this mission will be lost.', () => {
              this.close();
              this.cb.onQuitToMenu();
            }),
          ),
      },
    ];
    return { id: 'pause', title: lv ? `PAUSED · ${lv.number} ${lv.title}`.toUpperCase() : 'PAUSED', opts, sel: 0 };
  }

  private backOpt(): Opt {
    return { id: 'back', label: '◂ BACK', desc: 'Previous page.', lcd: () => 'BACK', accept: () => this.back() };
  }

  private pageDifficulty(missionId: string, fresh: boolean): Page {
    const m = MISSIONS.find((x) => x.id === missionId) ?? MISSIONS[0];
    const opts: Opt[] = DIFFICULTIES.map((d, i) => ({
      id: 'd' + i,
      label: d.name.toUpperCase(),
      desc: d.blurb,
      lcd: () => ['EASY', 'NORMAL', 'HARD'][i],
      accept: () => {
        if (fresh) writeSave({ completed: [] });
        this.startMission(m.id, i);
      },
    }));
    opts.push(this.backOpt());
    return {
      id: 'difficulty',
      title: `${String(m.num).padStart(2, '0')} ${m.title.toUpperCase()} · CONTRACT TYPE`,
      opts,
      sel: clamp(this.g.settings.difficulty, 0, 2),
    };
  }

  private startMission(id: string, difficulty: number) {
    const s = this.g.settings;
    s.difficulty = difficulty;
    this.settingsChanged();
    writeSave({ lastMission: id, difficulty });
    this.close();
    this.cb.onStartMission(id, difficulty);
  }

  private pageMissions(): Page {
    const save = loadSave();
    const opts: Opt[] = MISSIONS.map((m) => ({
      id: m.id,
      label: m.available ? `${String(m.num).padStart(2, '0')} ${m.title.toUpperCase()}` : String(m.num).padStart(2, '0'),
      desc: m.available ? (save?.completed.includes(m.id) ? 'Completed. Replay?' : 'Active operation.') : 'Above your clearance.',
      lcd: () => (m.available ? `OP ${String(m.num).padStart(2, '0')}` : 'LOCKED'),
      locked: !m.available,
      accept: () => this.push(this.pageDifficulty(m.id, false)),
    }));
    opts.push(this.backOpt());
    return {
      id: 'missions',
      title: 'MISSION DOSSIERS',
      opts,
      sel: 0,
      panel: (o) => {
        const m = MISSIONS.find((x) => x.id === o.id);
        if (!m) return '';
        const num = String(m.num).padStart(2, '0');
        if (!m.available)
          return `<div class="wm-dos locked"><div class="wm-dos-tab">FILE ${num}</div><h3>OPERATION ${num}</h3>
            <p><span class="redact">████████ ███</span> <span class="redact">██████████</span><br><span class="redact">███ ██████ ████████</span> <span class="redact">█████</span></p>
            <div class="wm-dos-meta">CLEARANCE REQUIRED: LEVEL ${m.num}</div><div class="wm-stamp red">CLASSIFIED</div></div>`;
        const done = save?.completed.includes(m.id);
        return `<div class="wm-dos"><div class="wm-dos-tab">FILE ${num}</div><h3>${esc(m.title.toUpperCase())}</h3>
          <p>${esc(m.beat)}</p>
          <div class="wm-dos-meta">LOCATION: FULFILLMENT CENTER 7<br>HANDLER: STEWARD</div>
          <div class="wm-stamp ${done ? 'green' : ''}">${done ? 'COMPLETED' : 'ACTIVE'}</div></div>`;
      },
    };
  }

  private pageObjectives(): Page {
    const lv = this.g.level;
    return {
      id: 'objectives',
      title: 'STANDING ORDERS',
      opts: [this.backOpt()],
      arc: [9, 9],
      sel: 0,
      panel: () => {
        const list = lv?.objectives ?? [];
        const items = list.length
          ? list.map((o) => `<li class="${o.done ? 'done' : ''}">${esc(o.text)}</li>`).join('')
          : '<li class="none">No standing orders. Improvise.</li>';
        return `<div class="wm-dos"><div class="wm-dos-tab">ORDERS</div><h3>${esc(lv ? `${lv.number} · ${lv.title}`.toUpperCase() : 'NO ACTIVE MISSION')}</h3><ul class="wm-obj">${items}</ul></div>`;
      },
    };
  }

  private pageCredits(): Page {
    const sections: { id: string; label: string; lcd: string; desc: string; html: string }[] = [
      { id: 'design', label: 'DESIGN', lcd: 'DESIGN', desc: 'Design and code.', html: '<b>Design &amp; code</b>The EVERYTHING MUST GO team. TypeScript + Three.js; every model is built in code.' },
      { id: 'audio', label: 'AUDIO', lcd: 'AUDIO', desc: 'Music, voice and sound.', html: '<b>Music, voice &amp; sound</b>Generated in-house with FluidSynth + FluidR3_GM (MIT), SVOX Pico, RHVoice, eSpeak NG and flite.' },
      { id: 'type', label: 'FONTS', lcd: 'FONTS', desc: 'Typefaces.', html: '<b>Fonts</b>Anton, Rajdhani, Share Tech Mono, Special Elite and Bangers, via Fontsource (SIL Open Font License).' },
    ];
    const opts: Opt[] = sections.map((s) => ({ id: s.id, label: s.label, desc: s.desc, lcd: () => s.lcd }));
    opts.push(this.backOpt());
    return {
      id: 'credits',
      title: 'CREDITS',
      opts,
      arc: [7.5, 10.5],
      sel: 0,
      panel: (o) =>
        `<div class="wm-dos"><div class="wm-dos-tab">CREDITS</div><h3>EVERYTHING MUST GO</h3>${sections
          .map((s) => `<p class="wm-cred ${s.id === o.id ? 'on' : ''}">${s.html}</p>`)
          .join('')}<p class="wm-small">No Associates were harmed. Several were returned for store credit.</p></div>`,
    };
  }

  private pageConfirm(title: string, text: string, yes: () => void): Page {
    return {
      id: 'confirm',
      title,
      arc: [9, 15],
      opts: [
        { id: 'no', label: 'CANCEL', desc: 'Never mind.', lcd: () => 'CANCEL', accept: () => this.back() },
        { id: 'yes', label: 'CONFIRM', desc: text, lcd: () => 'CONFIRM', danger: true, accept: yes },
      ],
      sel: 0,
    };
  }

  private pageOptions(): Page {
    const g = this.g;
    const s = g.settings;
    const slider = (id: keyof typeof s, label: string, desc: string, min: number, max: number, stepv: number, fmt: (v: number) => string): Opt => ({
      id,
      label,
      desc,
      value: () => fmt(s[id] as number),
      adjust: (d) => {
        const v = clamp(Math.round(((s[id] as number) + d * stepv) / stepv) * stepv, min, max);
        (s as unknown as Record<string, number>)[id] = +v.toFixed(3);
        this.settingsChanged();
      },
    });
    const toggle = (id: keyof typeof s, label: string, desc: string, on = 'ON', off = 'OFF'): Opt => {
      const o: Opt = {
        id,
        label,
        desc,
        value: () => ((s[id] as boolean) ? on : off),
        adjust: () => {
          (s as unknown as Record<string, boolean>)[id] = !(s[id] as boolean);
          this.settingsChanged();
        },
      };
      o.accept = () => o.adjust!(1);
      return o;
    };
    const resIdx = () => {
      if (s.pixelScale === 1) return 2;
      if (s.pixelScale === 0) return g.pipe.targetHeight >= 1000 ? 1 : 0;
      return 0;
    };
    const res: Opt = {
      id: 'res',
      label: 'RESOLUTION',
      desc: () => `${RES_STEPS[resIdx()].desc}. Now ${g.pipe.width}×${g.pipe.height}.`,
      value: () => RES_STEPS[resIdx()].name,
      adjust: (d) => {
        const r = RES_STEPS[(resIdx() + (d > 0 ? 1 : RES_STEPS.length - 1)) % RES_STEPS.length];
        s.pixelScale = r.pixelScale;
        g.pipe.targetHeight = r.target;
        (s as unknown as { resTarget?: number }).resTarget = r.target;
        this.settingsChanged();
      },
    };
    res.accept = () => res.adjust!(1);
    const opts: Opt[] = [
      slider('sensitivity', 'LOOK SENSITIVITY', 'Mouse look speed.', 0.2, 3, 0.1, (v) => v.toFixed(1) + '×'),
      slider('padSensitivity', 'PAD SENSITIVITY', 'Gamepad stick look speed.', 0.2, 3, 0.1, (v) => v.toFixed(1) + '×'),
      toggle('invertY', 'INVERT Y', 'Flight-sim look.'),
      slider('fov', 'FIELD OF VIEW', 'Vertical field of view in degrees.', 60, 100, 2, (v) => Math.round(v) + '°'),
      slider('master', 'MASTER VOLUME', 'Everything.', 0, 1, 0.1, pct),
      slider('music', 'MUSIC', 'The score.', 0, 1, 0.1, pct),
      slider('sfx', 'EFFECTS', 'Guns, explosions, footsteps.', 0, 1, 0.1, pct),
      slider('voice', 'VOICE', 'Steward, Strikers and the Associates.', 0, 1, 0.1, pct),
      res,
      toggle('dither', 'DITHER', 'PS2-style ordered dither and colour banding.'),
      toggle('subtitles', 'SUBTITLES', 'Show spoken lines on screen.'),
      this.backOpt(),
    ];
    return { id: 'options', title: 'OPTIONS', opts, sel: 0 };
  }

  // ================================================================== navigation

  private push(p: Page) {
    this.stack.push(p);
    this.onPageChange(1);
  }

  private back() {
    if (!this._open) return;
    if (this.stack.length > 1) {
      this.stack.pop();
      this.g.audio.play('ui_back', { bus: 'ui' });
      this.onPageChange(-1);
      return;
    }
    if (this.mode === 'pause') {
      this.g.audio.play('ui_back', { bus: 'ui' });
      this.close();
      this.g.input.requestLock();
      this.cb.onResume();
    }
  }

  private step(d: number) {
    const p = this.page;
    const n = p.opts.length;
    if (n < 2) return;
    p.sel = (p.sel + d + n) % n;
    this.g.audio.play('ui_move', { bus: 'ui' });
    this.onSelect();
  }

  private select(i: number) {
    const p = this.page;
    if (i === p.sel || i < 0 || i >= p.opts.length) return;
    p.sel = i;
    this.g.audio.play('ui_move', { bus: 'ui', vol: 0.7 });
    this.onSelect();
  }

  private adjust(d: number) {
    const o = this.page.opts[this.page.sel];
    if (!o?.adjust) return;
    o.adjust(d);
    this.g.audio.play('ui_move', { bus: 'ui', pitch: d > 0 ? 1.12 : 0.9 });
    this.renderLabels(false);
    this.refresh();
  }

  private accept() {
    if (!this._open) return;
    const o = this.page.opts[this.page.sel];
    if (!o) return;
    if (o.locked) {
      this.g.audio.play('ui_error', { bus: 'ui' });
      this.flashText = 'ACCESS DENIED';
      this.flashT = 1.1;
      this.refresh();
      return;
    }
    if (!o.accept) {
      if (o.adjust) this.adjust(1);
      return;
    }
    this.studPress = 1;
    this.g.audio.play(o.id === 'back' ? 'ui_back' : 'ui_select', { bus: 'ui' });
    const before = this.stack.length;
    o.accept();
    // stayed on the same page (e.g. a toggle): redraw values
    if (this._open && this.stack.length === before) {
      this.renderLabels(false);
      this.refresh();
    }
  }

  private onPageChange(dir: number) {
    this.bezTarget += dir * HOUR * 2;
    this.g.audio.play('watch_open', { bus: 'ui', vol: 0.8 });
    this.renderLabels(true);
    this.onSelect(true);
  }

  private onSelect(snap = false) {
    const target = this.optAngle(this.page.sel);
    // unwrapped target so the hand always takes the short way round
    const cur = this.handTarget;
    this.handTarget = cur + angleDelta(cur, target);
    if (snap && !this._open) this.hand = this.handTarget;
    this.flashT = 0;
    this.labelEls.forEach((e, i) => e.classList.toggle('sel', i === this.page.sel));
    this.rebuildPips();
    this.refresh();
  }

  // ================================================================== DOM

  private show() {
    const g = this.g;
    if (!this._open) {
      this.prevOverride = g.renderOverride && g.renderOverride.scene !== this.scene ? g.renderOverride : null;
      this.hudWasHidden = g.hud.root.classList.contains('hidden');
      this.openT = 0;
      this.hand = this.handTarget = this.optAngle(this.page.sel) - HOUR * 3;
    }
    this._open = true;
    this.guard = 2;
    this.hold = {};
    g.renderOverride = { scene: this.scene, camera: this.camera };
    g.hud.setVisible(false);
    g.input.exitLock();
    this.root.classList.add('on');
    this.root.classList.toggle('pause', this.mode === 'pause');
    g.audio.play('watch_open', { bus: 'ui' });
    this.renderLabels(true);
    this.onSelect();
    this.lastReal = g.realTime;
    this.update();
  }

  private renderLabels(anim: boolean) {
    const p = this.page;
    this.labels.innerHTML = '';
    this.labelEls = p.opts.map((o, i) => {
      const b = el('div', 'wm-label' + (o.locked ? ' locked' : '') + (o.danger ? ' danger' : '') + (o.id === 'back' ? ' back' : '') + (i === p.sel ? ' sel' : ''));
      b.dataset.i = String(i);
      const val = o.value ? o.value() : '';
      b.innerHTML =
        `<span class="wm-k">${o.locked ? '<i class="wm-lock"></i>' : ''}${esc(o.label)}</span>` +
        (o.value
          ? `<span class="wm-v">${o.adjust ? '<b class="wm-arr" data-d="-1">◂</b>' : ''}<span>${esc(val)}</span>${o.adjust ? '<b class="wm-arr" data-d="1">▸</b>' : ''}</span>`
          : '');
      // Hover selects, but only when the mouse itself moves over the label. Browsers also report
      // "the pointer entered" when an element appears or slides under a pointer that is not moving
      // (new labels start life stacked in the corner, and a phone's phantom mouse sits there), and
      // that must not steal the selection.
      b.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'mouse' && this.page.sel !== i) this.select(i);
      });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const arr = (e.target as HTMLElement).closest('.wm-arr') as HTMLElement | null;
        if (this.page.sel !== i) this.select(i);
        if (arr) this.adjust(+arr.dataset.d!);
        else this.accept();
      });
      if (anim) b.style.animationDelay = `${i * 22}ms`;
      this.labels.appendChild(b);
      return b;
    });
    this.labels.classList.toggle('anim', anim);
    if (anim) {
      // restart the CSS animation
      void this.labels.offsetWidth;
    }
    const crumbs = this.stack.map((s) => s.title.split(' · ')[0]);
    const logo = this.mode === 'main' && this.stack.length === 1 ? '<div class="wm-logo">EVERYTHING<br>MUST GO</div>' : '';
    this.head.innerHTML = `${logo}<div class="wm-crumb">${esc(crumbs.slice(0, -1).join(' ▸ '))}${crumbs.length > 1 ? ' ▸' : ''}</div><div class="wm-title">${esc(p.title)}</div>`;
    this.renderHints();
  }

  private renderHints() {
    const dev = this.g.input.device;
    this.lastDevice = dev;
    const canBack = this.stack.length > 1 || this.mode === 'pause';
    const k = (t: string) => `<span class="key">${t}</span>`;
    let nav = '';
    if (dev === 'gamepad') nav = `${k('D-PAD')} SELECT ${k('A')} OK ${canBack ? k('B') + ' BACK' : ''}`;
    else nav = `${k('↑')}${k('↓')} SELECT ${this.page.opts.some((o) => o.adjust) ? k('◂') + k('▸') + ' ADJUST ' : ''}${k('ENTER')} OK ${canBack ? k('ESC') + ' BACK' : ''}`;
    if (dev === 'gamepad' && this.page.opts.some((o) => o.adjust)) nav = nav.replace(' SELECT ', ' SELECT / ADJUST ');
    this.hints.innerHTML = `<span class="wm-nav">${nav}</span>${canBack ? '<button class="wm-btn" data-act="back">◂ BACK</button>' : ''}`;
  }

  /** LCD + dossier panel for the current selection. */
  private refresh() {
    const p = this.page;
    const o = p.opts[p.sel];
    if (!o) return;
    const desc = typeof o.desc === 'function' ? o.desc() : o.desc ?? '';
    const big = this.flashT > 0 ? this.flashText : o.lcd ? o.lcd() : o.value ? o.value() : o.label;
    this.lcdTop.textContent = `${p.id.toUpperCase().slice(0, 9)} ${String(p.sel + 1).padStart(2, '0')}/${String(p.opts.length).padStart(2, '0')}`;
    this.lcdBig.textContent = o.value && this.flashT <= 0 ? `${o.value()}` : big;
    this.lcdSmall.textContent = this.flashT > 0 ? 'Above your clearance.' : desc;
    this.lcd.classList.toggle('alarm', this.flashT > 0);
    if (p.panel) {
      this.panel.innerHTML = p.panel(o);
      this.panel.classList.add('on');
    } else {
      this.panel.classList.remove('on');
      this.panel.innerHTML = '';
    }
    this.root.classList.toggle('with-panel', !!p.panel);
  }

  // ================================================================== frame

  private update() {
    if (!this._open) return;
    const g = this.g;
    const dt = clamp(g.realTime - this.lastReal, 0, 0.1);
    this.lastReal = g.realTime;
    this.t += dt;
    this.openT = Math.min(1, this.openT + dt / 0.45);

    if (this.guard > 0) this.guard--;
    else this.handleInput(dt);
    if (!this._open) return;
    if (g.input.device !== this.lastDevice) this.renderHints();

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.refresh();
    }

    // ---- animation
    const k = 170;
    const c = 17;
    this.handVel += ((this.handTarget - this.hand) * k - this.handVel * c) * dt;
    this.hand += this.handVel * dt;
    this.hourHand.rotation.z = -this.hand;
    this.bezVel += ((this.bezTarget - this.bez) * 90 - this.bezVel * 13) * dt;
    this.bez += this.bezVel * dt;
    this.bezel.rotation.z = -this.bez;
    const secNow = Math.floor(g.realTime);
    if (secNow !== this.lastSec) {
      if (this.lastSec >= 0) g.audio.play('watch_tick', { bus: 'ui', vol: 0.35 });
      this.lastSec = secNow;
    }
    const secTarget = (secNow % 60) * (TAU / 60);
    this.sec += angleDelta(this.sec, secTarget) * (1 - Math.exp(-40 * dt));
    this.secondHand.rotation.z = -this.sec;
    this.studPress = Math.max(0, this.studPress - dt * 5);
    const a4 = Math.PI / 2 - 4 * HOUR;
    const sp = 1.32 - Math.sin(this.studPress * Math.PI) * 0.08;
    this.stud.position.set(Math.cos(a4) * sp, Math.sin(a4) * sp, -0.3);

    const e = 1 - Math.pow(1 - this.openT, 3);
    const tt = this.t;
    this.rig.position.set(0, -3.2 * (1 - e) + Math.sin(tt * 0.9) * 0.025, 0);
    this.rig.rotation.set(
      -0.16 + Math.sin(tt * 0.7) * 0.012 + this.pointer.y * 0.03 + (1 - e) * 0.5,
      0.1 + Math.sin(tt * 0.53) * 0.016 + this.pointer.x * 0.04,
      -0.07 + Math.sin(tt * 0.41) * 0.008,
    );

    this.layout();
  }

  private handleInput(dt: number) {
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
          this.hold[a] = 0.42 - 0.11;
          return true;
        }
      } else delete this.hold[a];
      return false;
    };
    const o = this.page.opts[this.page.sel];
    if (rep('uiUp')) this.step(-1);
    if (rep('uiDown')) this.step(1);
    if (rep('uiLeft')) {
      if (o?.adjust) this.adjust(-1);
      else this.step(-1);
    }
    if (rep('uiRight')) {
      if (o?.adjust) this.adjust(1);
      else this.step(1);
    }
    if (inp.pressed('uiAccept')) this.accept();
    else if (inp.pressed('uiBack') || inp.pressed('pause')) this.back();
  }

  /** Shrink the LCD description until it fits its two lines. */
  private fitLcd(w: number, h: number) {
    const el = this.lcdSmall;
    let fs = Math.max(9, Math.min(w * 0.064, h * 0.17));
    el.style.fontSize = fs + 'px';
    while (fs > 7 && el.scrollHeight > el.clientHeight + 1) {
      fs -= 0.5;
      el.style.fontSize = fs + 'px';
    }
  }

  /** Fit the watch to the viewport and pin the DOM labels / LCD to their 3D anchors. */
  private layout() {
    const g = this.g;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cam = this.camera;
    cam.aspect = g.pipe.aspect || W / H;
    const panel = !!this.page.panel;
    const tanH = Math.tan((cam.fov * Math.PI) / 360);
    // watch radius on screen (px), leaving room for the labels around it
    const rPx = panel ? Math.min(H * 0.27, W * 0.16) : Math.min(H * 0.3, W * 0.19);
    const d = (1.5 * (H / 2)) / (rPx * tanH);
    const cx = panel ? W * 0.29 : W * 0.5;
    const cy = H * 0.53;
    const ndcX = (cx / W) * 2 - 1;
    const ndcY = 1 - (cy / H) * 2;
    cam.position.set(-ndcX * d * tanH * cam.aspect, -ndcY * d * tanH, d);
    cam.rotation.set(0, 0, 0);
    cam.updateProjectionMatrix();
    this.scene.updateMatrixWorld(true);
    cam.updateMatrixWorld(true);

    const proj = (x: number, y: number, z: number) => {
      _v.set(x, y, z);
      this.watch.localToWorld(_v);
      _v.project(cam);
      return [(_v.x + 1) * 0.5 * W, (1 - _v.y) * 0.5 * H] as const;
    };
    const [ox, oy] = proj(0, 0, 0.1);
    _c.set(ox, oy, 0);
    const p = this.page;
    const fadeIn = this.openT;
    this.root.style.setProperty('--wm-open', String(fadeIn));
    for (let i = 0; i < this.labelEls.length; i++) {
      const th = this.optAngle(i);
      const [px, py] = proj(Math.sin(th) * 1.62, Math.cos(th) * 1.62, 0.12);
      let dx = px - ox;
      let dy = py - oy;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const sx = clamp(dx * 2.4, -1, 1);
      const sy = clamp(dy * 2.4, -1, 1);
      const e = this.labelEls[i];
      e.style.transform = `translate(${(px + dx * 8).toFixed(1)}px, ${(py + dy * 8).toFixed(1)}px) translate(${(-50 + 50 * sx).toFixed(1)}%, ${(-50 + 50 * sy).toFixed(1)}%)`;
      e.classList.toggle('left', sx < -0.35);
      e.classList.toggle('right', sx > 0.35);
      if (i === p.sel) e.classList.add('sel');
    }
    // LCD rectangle
    const [l, t] = proj(-0.75, -0.185, 0);
    const [r, b] = proj(0.75, -0.615, 0);
    const w = Math.max(10, r - l);
    const h = Math.max(6, b - t);
    const ls = this.lcd.style;
    ls.left = l.toFixed(1) + 'px';
    ls.top = t.toFixed(1) + 'px';
    ls.width = w.toFixed(1) + 'px';
    ls.height = h.toFixed(1) + 'px';
    ls.setProperty('--lw', w.toFixed(1) + 'px');
    ls.setProperty('--lh', h.toFixed(1) + 'px');
    const key = `${Math.round(w)}|${this.lcdSmall.textContent}`;
    if (key !== this.lcdFitKey) {
      this.lcdFitKey = key;
      this.fitLcd(w, h);
    }
  }
}
