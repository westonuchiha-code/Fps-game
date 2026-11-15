import './menus.css';
import type { Game } from '../game';
import type { Action } from '../core/input';

interface BtnDef {
  act: Action;
  label: string;
  /** position from the bottom-right corner (or top-right with `top`), in button-size units */
  x: number;
  y: number;
  size?: number;
  top?: boolean;
  toggle?: boolean;
  look?: boolean;
  cls?: string;
}

const BUTTONS: BtnDef[] = [
  { act: 'fire', label: 'FIRE', x: 1.3, y: 0.42, size: 1.5, look: true, cls: 'fire' },
  { act: 'jump', label: 'JUMP', x: 0.12, y: 0.2 },
  { act: 'crouch', label: 'CROUCH', x: 0.12, y: 1.35 },
  { act: 'ads', label: 'AIM', x: 3.0, y: 0.25, toggle: true },
  { act: 'reload', label: 'RELOAD', x: 1.75, y: 2.15 },
  { act: 'interact', label: 'USE', x: 0.12, y: 2.5, cls: 'use' },
  { act: 'next', label: 'SWAP', x: 3.0, y: 1.4 },
  { act: 'melee', label: 'MELEE', x: 2.9, y: 2.55 },
  { act: 'mine', label: 'MINE', x: 4.25, y: 0.25, cls: 'mine' },
  { act: 'detonate', label: 'WATCH', x: 4.25, y: 1.4, cls: 'watch' },
  { act: 'inventory', label: 'BAG', x: 1.2, y: 0.15, size: 0.94, top: true },
  { act: 'pause', label: 'II', x: 0.12, y: 0.15, size: 0.94, top: true, cls: 'pause' },
];

type Track = { kind: 'stick'; ox: number; oy: number } | { kind: 'look'; x: number; y: number } | { kind: 'btn'; def: BtnDef; el: HTMLElement; x: number; y: number };

/**
 * On-screen controls for phones/tablets. Shown automatically after the first touch, and only while playing.
 * Left side: floating move stick (push past the rim to sprint). Right side: drag to look; buttons on top.
 */
export class TouchControls {
  private readonly g: Game;
  private readonly root: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly btnEls = new Map<Action, HTMLElement>();
  private tracks = new Map<number, Track>();
  /** null = automatic (after the first touch), otherwise forced */
  private forced: boolean | null = null;
  private touchSeen = false;
  private lastTouch = 0;
  private visible = false;
  private aimOn = false;

  constructor(game: Game) {
    this.g = game;
    this.root = document.createElement('div');
    this.root.className = 'tc';
    this.stick = document.createElement('div');
    this.stick.className = 'tc-stick';
    this.knob = document.createElement('b');
    this.stick.appendChild(this.knob);
    this.root.appendChild(this.stick);
    for (const d of BUTTONS) {
      const b = document.createElement('div');
      b.className = 'tc-btn ' + (d.cls ?? '') + (d.top ? ' top' : '');
      b.textContent = d.label;
      b.style.setProperty('--x', String(d.x));
      b.style.setProperty('--y', String(d.y));
      b.style.setProperty('--k', String(d.size ?? 1));
      b.dataset.act = d.act;
      this.root.appendChild(b);
      this.btnEls.set(d.act, b);
    }
    game.ui.appendChild(this.root);

    const opt = { passive: false } as AddEventListenerOptions;
    this.root.addEventListener('touchstart', (e) => this.onStart(e), opt);
    this.root.addEventListener('touchmove', (e) => this.onMove(e), opt);
    this.root.addEventListener('touchend', (e) => this.onEnd(e), opt);
    this.root.addEventListener('touchcancel', (e) => this.onEnd(e), opt);
    window.addEventListener(
      'touchstart',
      () => {
        this.touchSeen = true;
        this.lastTouch = performance.now();
      },
      { capture: true, passive: true },
    );
    // a real mouse after touch (hybrid laptop): get out of the way again
    window.addEventListener('mousedown', () => {
      if (performance.now() - this.lastTouch > 800) this.touchSeen = false;
    });
    // iOS pinch-zoom
    document.addEventListener('gesturestart', (e) => e.preventDefault(), opt);
    game.systems.push({ update: () => this.update() });
  }

  /** Force the controls on (true) or off (false). Before this is called they appear after the first touch. */
  setEnabled(on: boolean) {
    this.forced = on;
    this.update();
  }

  private update() {
    // not during cutscenes: the buttons do nothing there and would cover the SKIP prompt
    const want = (this.forced ?? this.touchSeen) && this.g.state === 'playing' && !this.g.player.frozen;
    if (want !== this.visible) {
      this.visible = want;
      this.root.classList.toggle('on', want);
      if (!want) this.releaseAll();
    }
    if (want) {
      this.btnEls.get('interact')!.classList.toggle('hint', !!this.g.hud.root.querySelector('.prompt.show'));
      this.btnEls.get('mine')!.classList.toggle('off', this.g.inv.mines <= 0);
    }
  }

  private releaseAll() {
    const inp = this.g.input;
    for (const t of this.tracks.values()) if (t.kind === 'btn' && !t.def.toggle) inp.setVirtual(t.def.act, false);
    this.tracks.clear();
    if (this.aimOn) {
      this.aimOn = false;
      inp.setVirtual('ads', false);
      this.btnEls.get('ads')!.classList.remove('act');
    }
    inp.setVirtual('sprint', false);
    inp.setTouchMove(0, 0);
    this.stick.classList.remove('on');
    for (const b of this.btnEls.values()) b.classList.remove('down');
  }

  private onStart(e: TouchEvent) {
    if (!this.visible) return;
    e.preventDefault();
    const inp = this.g.input;
    for (const t of Array.from(e.changedTouches)) {
      const btn = (t.target as HTMLElement | null)?.closest?.('.tc-btn') as HTMLElement | null;
      if (btn) {
        const def = BUTTONS.find((d) => d.act === btn.dataset.act)!;
        if (def.toggle) {
          this.aimOn = !this.aimOn;
          inp.setVirtual(def.act, this.aimOn);
          btn.classList.toggle('act', this.aimOn);
        } else {
          inp.setVirtual(def.act, true);
          btn.classList.add('down');
        }
        this.tracks.set(t.identifier, { kind: 'btn', def, el: btn, x: t.clientX, y: t.clientY });
        continue;
      }
      const leftSide = t.clientX < window.innerWidth * 0.45;
      const hasStick = [...this.tracks.values()].some((x) => x.kind === 'stick');
      if (leftSide && !hasStick) {
        this.tracks.set(t.identifier, { kind: 'stick', ox: t.clientX, oy: t.clientY });
        this.stick.style.left = t.clientX + 'px';
        this.stick.style.top = t.clientY + 'px';
        this.knob.style.transform = 'translate(0px, 0px)';
        this.stick.classList.add('on');
      } else {
        this.tracks.set(t.identifier, { kind: 'look', x: t.clientX, y: t.clientY });
      }
    }
  }

  private onMove(e: TouchEvent) {
    if (!this.visible) return;
    e.preventDefault();
    const inp = this.g.input;
    for (const t of Array.from(e.changedTouches)) {
      const tr = this.tracks.get(t.identifier);
      if (!tr) continue;
      if (tr.kind === 'stick') {
        const R = Math.min(70, Math.max(44, window.innerHeight * 0.12));
        let dx = t.clientX - tr.ox;
        let dy = t.clientY - tr.oy;
        const len = Math.hypot(dx, dy);
        const sprint = len > R * 1.35 && dy < 0 && Math.abs(dy) > Math.abs(dx);
        if (len > R) {
          dx *= R / len;
          dy *= R / len;
        }
        this.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
        inp.setTouchMove(dx / R, -dy / R);
        inp.setVirtual('sprint', sprint);
        this.stick.classList.toggle('sprint', sprint);
      } else if (tr.kind === 'look' || (tr.kind === 'btn' && tr.def.look)) {
        inp.addTouchLook(t.clientX - tr.x, t.clientY - tr.y);
        tr.x = t.clientX;
        tr.y = t.clientY;
      }
    }
  }

  private onEnd(e: TouchEvent) {
    const inp = this.g.input;
    for (const t of Array.from(e.changedTouches)) {
      const tr = this.tracks.get(t.identifier);
      if (!tr) continue;
      this.tracks.delete(t.identifier);
      if (tr.kind === 'stick') {
        inp.setTouchMove(0, 0);
        inp.setVirtual('sprint', false);
        this.stick.classList.remove('on', 'sprint');
      } else if (tr.kind === 'btn' && !tr.def.toggle) {
        // keep the action held if another finger is still on the same button
        const still = [...this.tracks.values()].some((x) => x.kind === 'btn' && x.def === tr.def);
        if (!still) {
          inp.setVirtual(tr.def.act, false);
          tr.el.classList.remove('down');
        }
      }
    }
    if (this.visible && e.cancelable) e.preventDefault();
  }
}
