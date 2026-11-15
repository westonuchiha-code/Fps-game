import * as THREE from 'three';
import { G } from '../core/globals';
import { Ease, lerp, type EaseName } from '../core/math';

type V3 = [number, number, number];

export interface Shot {
  /** camera position at the start / end of the shot */
  from: V3;
  to?: V3;
  /** point looked at, start / end */
  look: V3;
  lookTo?: V3;
  fov?: number;
  fovTo?: number;
  dur: number;
  ease?: EaseName;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * Halo-style in-engine cutscene: a script of camera shots and voiced lines, driven by game time.
 *
 *   const cs = new Cutscene();
 *   await cs.run(async (c) => {
 *     c.shot({ from: [...], to: [...], look: [...], dur: 5 });
 *     await c.say('m01_intro_s1');
 *     await c.wait(1);
 *   });
 *
 * Pressing the skip key fast-forwards: every wait returns at once and the camera jumps to the end.
 */
export class Cutscene {
  private t = 0;
  private waits: { at: number; resolve: () => void }[] = [];
  private shotDef: Shot | null = null;
  private shotT = 0;
  skipped = false;
  active = false;
  private skipHold = 0;
  private sys: { update(dt: number): void } | null = null;
  /** the game is not advancing level time while paused; cutscenes run on their own clock */
  skippable = true;

  /** Play the script; resolves when it has finished (or was skipped). */
  async run(script: (c: Cutscene) => Promise<void>) {
    const pl = G.player;
    this.active = true;
    this.t = 0;
    pl.frozen = true;
    G.weapons.setHolstered(true, true);
    G.hud.setVisible(false);
    G.hud.letterbox(true, this.skippable);
    G.cameraOwner = this;
    this.sys = { update: (dt) => this.update(dt) };
    G.systems.push(this.sys);
    try {
      await script(this);
    } finally {
      this.finish();
    }
  }

  private finish() {
    if (!this.active) return;
    this.active = false;
    const i = this.sys ? G.systems.indexOf(this.sys) : -1;
    if (i >= 0) G.systems.splice(i, 1);
    for (const w of this.waits) w.resolve();
    this.waits.length = 0;
    G.cameraOwner = null;
    G.hud.letterbox(false);
    G.hud.clearTyped();
    G.hud.setVisible(true);
    G.player.frozen = false;
    G.weapons.setHolstered(false);
    if (this.skipped) G.audio.flushVoice();
    G.camera.fov = G.player.baseFov;
    G.camera.updateProjectionMatrix();
  }

  private update(dt: number) {
    if (!this.active || G.state !== 'playing') return;
    this.t += dt;
    this.shotT += dt;
    if (this.skippable && !this.skipped) {
      if (G.input.pressed('skip') || G.input.pressed('uiBack')) {
        this.skipped = true;
        G.audio.flushVoice();
        void G.hud.fade(true, 0.01).then(() => G.hud.fade(false, 0.5));
      }
    }
    for (let i = this.waits.length - 1; i >= 0; i--) {
      if (this.skipped || this.waits[i].at <= this.t) {
        const w = this.waits[i];
        this.waits.splice(i, 1);
        w.resolve();
      }
    }
  }

  /** Wait in game time. Returns immediately once the cutscene has been skipped. */
  wait(seconds: number): Promise<void> {
    if (this.skipped || !this.active) return Promise.resolve();
    return new Promise((resolve) => this.waits.push({ at: this.t + seconds, resolve }));
  }

  /** Start a camera move (does not wait; follow with wait/say). */
  shot(s: Shot) {
    this.shotDef = s;
    this.shotT = 0;
  }

  /** Speak a line and wait for it to finish (plus a short breath). */
  async say(id: string, extra = 0.25) {
    if (this.skipped) return;
    const info = G.audio.lineInfo(id);
    void G.audio.say(id);
    await this.wait((info?.dur ?? 2.5) + extra);
  }

  updateCamera(cam: THREE.PerspectiveCamera, _dt: number) {
    const s = this.shotDef;
    if (!s) return;
    const u = this.skipped ? 1 : Ease[s.ease ?? 'inOut'](Math.min(1, this.shotT / Math.max(0.001, s.dur)));
    _a.set(...s.from);
    if (s.to) _a.lerp(_b.set(...s.to), u);
    cam.position.copy(_a);
    _a.set(...s.look);
    if (s.lookTo) _a.lerp(_b.set(...s.lookTo), u);
    cam.up.set(0, 1, 0);
    cam.lookAt(_a);
    const fov = lerp(s.fov ?? 55, s.fovTo ?? s.fov ?? 55, u);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
