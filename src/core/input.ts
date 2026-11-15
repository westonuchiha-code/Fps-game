import { clamp } from './math';

export type Action =
  | 'fire'
  | 'ads'
  | 'jump'
  | 'crouch'
  | 'sprint'
  | 'reload'
  | 'interact'
  | 'melee'
  | 'mine'
  | 'detonate'
  | 'next'
  | 'prev'
  | 'slot1'
  | 'slot2'
  | 'slot3'
  | 'slot4'
  | 'inventory'
  | 'pause'
  | 'horn'
  | 'inspect'
  | 'uiUp'
  | 'uiDown'
  | 'uiLeft'
  | 'uiRight'
  | 'uiAccept'
  | 'uiBack'
  | 'skip';

export type Device = 'kbm' | 'gamepad';

const KEYMAP: Record<string, Action[]> = {
  Space: ['jump', 'uiAccept', 'skip'],
  KeyC: ['crouch'],
  ControlLeft: ['crouch'],
  ShiftLeft: ['sprint'],
  ShiftRight: ['sprint'],
  KeyR: ['reload'],
  KeyE: ['interact', 'uiAccept'],
  KeyF: ['melee'],
  KeyV: ['melee'],
  KeyG: ['mine'],
  KeyQ: ['detonate'],
  KeyT: ['inspect'],
  KeyH: ['horn'],
  Digit1: ['slot1'],
  Digit2: ['slot2'],
  Digit3: ['slot3'],
  Digit4: ['slot4'],
  Tab: ['inventory'],
  KeyI: ['inventory'],
  Escape: ['pause', 'uiBack'],
  KeyP: ['pause'],
  Enter: ['uiAccept', 'skip'],
  Backspace: ['uiBack'],
  ArrowUp: ['uiUp'],
  ArrowDown: ['uiDown'],
  ArrowLeft: ['uiLeft'],
  ArrowRight: ['uiRight'],
  KeyW: ['uiUp'],
  KeyS: ['uiDown'],
  KeyA: ['uiLeft'],
  KeyD: ['uiRight'],
};

/** Human-readable prompt for an action on the device last used. */
const PROMPTS: Record<Device, Partial<Record<Action, string>>> = {
  kbm: {
    fire: 'LMB', ads: 'RMB', jump: 'SPACE', crouch: 'C', sprint: 'SHIFT', reload: 'R', interact: 'E', melee: 'F',
    mine: 'G', detonate: 'Q', inventory: 'TAB', pause: 'ESC', horn: 'H', next: 'WHEEL', skip: 'ENTER', inspect: 'T',
  },
  gamepad: {
    fire: 'RT', ads: 'LT', jump: 'A', crouch: 'B', sprint: 'L3', reload: 'X', interact: 'X', melee: 'R3',
    mine: 'LB', detonate: 'RB', inventory: 'BACK', pause: 'START', horn: 'D-PAD ↓', next: 'Y', skip: 'A', inspect: 'D-PAD ↑',
  },
};

export class Input {
  device: Device = 'kbm';
  /** strafe (x) and forward (y), each -1..1 */
  moveX = 0;
  moveY = 0;
  /** look delta for this frame, radians, already scaled by sensitivity */
  lookX = 0;
  lookY = 0;
  locked = false;
  /** mouse sensitivity in radians per pixel at 1.0 */
  sensitivity = 1;
  padSensitivity = 1;
  invertY = false;
  /** scales look speed (ADS / scope zoom) */
  lookScale = 1;
  /** true while a gamepad is driving the look stick (used for aim assist) */
  padLooking = false;
  /** analog trigger values */
  wheel = 0;
  enabled = true;

  private keys = new Set<string>();
  private down = new Set<Action>();
  private prev = new Set<Action>();
  private tapped = new Set<Action>(); // pressed at any point since last frame (never miss a quick tap)
  private lockedAt = 0;
  private mouseDX = 0;
  private mouseDY = 0;
  private mouseButtons = 0;
  private wheelAcc = 0;
  private padPrev: boolean[] = [];
  private padLookVel = 0;
  /** scripted input for automated play-tests */
  readonly simDown = new Set<Action>();
  readonly simMove = { x: 0, y: 0 };
  readonly simLook = { x: 0, y: 0 };
  private padsAllowed = true;
  onAnyInput: (() => void) | null = null;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.device = 'kbm';
      const acts = KEYMAP[e.code];
      if (acts) for (const a of acts) this.tapped.add(a);
      this.onAnyInput?.();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons = 0;
    });
    canvas.addEventListener('mousedown', (e) => {
      this.mouseButtons |= 1 << e.button;
      this.device = 'kbm';
      if (e.button === 0) this.tapped.add('fire');
      if (e.button === 2) this.tapped.add('ads');
      if (e.button === 1) {
        this.tapped.add('melee');
        e.preventDefault();
      }
      this.onAnyInput?.();
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseButtons &= ~(1 << e.button);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Browsers report a huge spurious delta when the lock engages (the cursor being warped to the
      // centre) and occasionally afterwards: ignore the first moments and drop implausible jumps.
      if (performance.now() - this.lockedAt < 150) return;
      const mx = e.movementX || 0;
      const my = e.movementY || 0;
      if (Math.abs(mx) > 300 || Math.abs(my) > 300) return;
      this.mouseDX += mx;
      this.mouseDY += my;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        this.wheelAcc += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.lockedAt = performance.now();
      if (!this.locked) {
        this.mouseButtons = 0;
        this.keys.clear();
      }
      this.onLockChange?.(this.locked);
    });
  }

  requestLock() {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* not allowed outside a user gesture */
    }
  }
  exitLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** Inject a tap from UI code (e.g. clicking a HUD button). */
  tap(a: Action) {
    this.tapped.add(a);
  }

  isDown(a: Action) {
    return this.enabled && this.down.has(a);
  }
  pressed(a: Action) {
    return this.enabled && this.down.has(a) && !this.prev.has(a);
  }
  released(a: Action) {
    return this.enabled && !this.down.has(a) && this.prev.has(a);
  }
  /** Swallow an action so nothing else reacts to it this frame. */
  consume(a: Action) {
    this.prev.add(a);
  }
  prompt(a: Action) {
    return PROMPTS[this.device][a] ?? a.toUpperCase();
  }

  update(dt: number) {
    const prev = this.prev;
    this.prev = this.down;
    const down = prev;
    down.clear();
    this.down = down;

    // keyboard
    for (const code of this.keys) {
      const acts = KEYMAP[code];
      if (acts) for (const a of acts) down.add(a);
    }
    if (this.mouseButtons & 1) down.add('fire');
    if (this.mouseButtons & 4) down.add('ads');
    if (this.mouseButtons & 2) down.add('melee');
    for (const a of this.simDown) down.add(a);

    let mx = 0;
    let my = 0;
    if (this.keys.has('KeyW')) my += 1;
    if (this.keys.has('KeyS')) my -= 1;
    if (this.keys.has('KeyD')) mx += 1;
    if (this.keys.has('KeyA')) mx -= 1;

    let lx = this.mouseDX * 0.0022 * this.sensitivity * this.lookScale;
    let ly = this.mouseDY * 0.0022 * this.sensitivity * this.lookScale;
    this.mouseDX = this.mouseDY = 0;

    mx += this.simMove.x;
    my += this.simMove.y;
    lx += this.simLook.x;
    ly += this.simLook.y;
    this.simLook.x = this.simLook.y = 0;

    // wheel -> next/prev taps
    if (this.wheelAcc > 0) this.tapped.add('next');
    else if (this.wheelAcc < 0) this.tapped.add('prev');
    this.wheel = this.wheelAcc;
    this.wheelAcc = 0;

    // gamepad
    this.padLooking = false;
    let pads: readonly (Gamepad | null)[] = [];
    if (this.padsAllowed) {
      try {
        pads = navigator.getGamepads ? navigator.getGamepads() : [];
      } catch {
        // a page that embeds the game can forbid controllers; keyboard and mouse still work
        this.padsAllowed = false;
      }
    }
    for (const pad of pads) {
      if (!pad || !pad.connected || pad.mapping !== 'standard') continue;
      const dz = (v: number, d = 0.16) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
      const ax = dz(pad.axes[0] ?? 0);
      const ay = dz(pad.axes[1] ?? 0);
      const rx = dz(pad.axes[2] ?? 0, 0.12);
      const ry = dz(pad.axes[3] ?? 0, 0.12);
      const b = (i: number) => !!pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.35);
      const any = ax || ay || rx || ry || pad.buttons.some((x) => x.pressed);
      if (any) {
        this.device = 'gamepad';
        this.onAnyInput?.();
      }
      mx += ax;
      my -= ay;
      // response curve + turn acceleration when the stick is pinned
      const mag = Math.hypot(rx, ry);
      if (mag > 0) {
        this.padLooking = true;
        const curve = mag * mag;
        this.padLookVel = mag > 0.92 ? Math.min(1, this.padLookVel + dt * 1.6) : 0;
        const speed = (2.6 + 2.2 * this.padLookVel) * this.padSensitivity * this.lookScale;
        lx += (rx / mag) * curve * speed * dt;
        ly += (ry / mag) * curve * speed * 0.72 * dt;
      } else this.padLookVel = 0;

      const map: [number, Action[]][] = [
        [0, ['jump', 'uiAccept', 'skip']],
        [1, ['crouch', 'uiBack']],
        [2, ['reload', 'interact']],
        [3, ['next']],
        [4, ['mine']],
        [5, ['detonate']],
        [6, ['ads']],
        [7, ['fire']],
        [8, ['inventory']],
        [9, ['pause']],
        [10, ['sprint']],
        [11, ['melee']],
        [12, ['uiUp', 'inspect']],
        [13, ['uiDown', 'horn']],
        [14, ['uiLeft', 'prev']],
        [15, ['uiRight', 'next']],
      ];
      for (const [i, acts] of map) {
        const isDown = b(i);
        if (isDown) for (const a of acts) down.add(a);
        if (isDown && !this.padPrev[i]) for (const a of acts) this.tapped.add(a);
        this.padPrev[i] = isDown;
      }
      // left stick doubles as menu navigation
      if (ay < -0.6) down.add('uiUp');
      if (ay > 0.6) down.add('uiDown');
      if (ax < -0.6) down.add('uiLeft');
      if (ax > 0.6) down.add('uiRight');
      break;
    }

    // Quick taps that started and ended between two frames still register as pressed.
    for (const a of this.tapped) if (!down.has(a)) down.add(a);
    this.tapped.clear();

    const m = Math.hypot(mx, my);
    if (m > 1) {
      mx /= m;
      my /= m;
    }
    this.moveX = mx;
    this.moveY = my;
    this.lookX = lx;
    this.lookY = this.invertY ? -ly : ly;
  }
}
