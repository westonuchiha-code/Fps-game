import * as THREE from 'three';
import { G } from '../core/globals';
import { clamp, damp, DEG } from '../core/math';

const _pivot = new THREE.Vector3();
const _back = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

/** What the chase camera needs from the thing it follows. */
export interface ChaseTarget {
  readonly pos: THREE.Vector3;
  readonly speed: number;
}

/**
 * Third-person orbit camera for vehicles. The orbit angles are the player's own yaw/pitch, so the
 * camera's forward IS the player's look direction (Halo-style "steer toward where you look").
 */
export class ChaseCam {
  /** arm length at rest */
  dist = 7;
  /** pivot height above the chassis origin */
  lookHeight = 1.6;
  /** extra FOV at `fovSpeed` m/s */
  fovGain = 12;
  fovSpeed = 28;
  minPitch = -62 * DEG;
  maxPitch = 24 * DEG;
  private arm = 7;
  private readonly pivot = new THREE.Vector3();
  private fovKick = 0;
  private seed = Math.random() * 100;
  /** separate shake that does not depend on the player's trauma */
  private bump = 0;
  private fresh = true;

  constructor(private target: ChaseTarget) {}

  reset() {
    this.fresh = true;
  }

  /** Camera shake from impacts (0..1). */
  kick(amount: number) {
    this.bump = Math.min(1, this.bump + amount);
  }

  updateCamera(cam: THREE.PerspectiveCamera, dt: number) {
    const pl = G.player;
    const t = this.target;
    pl.pitch = clamp(pl.pitch, this.minPitch, this.maxPitch);
    _pivot.copy(t.pos);
    _pivot.y += this.lookHeight;
    if (this.fresh) {
      this.pivot.copy(_pivot);
      this.arm = this.dist;
      this.fresh = false;
    } else {
      // stiff follow (a little lag sells speed, too much makes aiming mushy)
      const r = 1 - Math.exp(-22 * dt);
      this.pivot.lerp(_pivot, r);
      // never lag more than 1.2 m (teleports, huge frame spikes)
      if (this.pivot.distanceToSquared(_pivot) > 1.44) this.pivot.sub(_pivot).setLength(1.2).add(_pivot);
    }
    // camera forward = look direction
    const cp = Math.cos(pl.pitch);
    _back.set(Math.sin(pl.yaw) * cp, -Math.sin(pl.pitch), Math.cos(pl.yaw) * cp);
    // the arm lengthens a little when looking down so the vehicle stays framed
    const want = this.dist * (1 + clamp(-pl.pitch, 0, 1) * 0.15);
    const hit = G.col.raycast(this.pivot, _back, want + 0.35, 'static');
    let target = want;
    if (hit) target = Math.max(0.9, hit.distance - 0.35);
    this.arm = target < this.arm ? damp(this.arm, target, 30, dt) : damp(this.arm, target, 3.5, dt);
    if (hit && this.arm > hit.distance - 0.2) this.arm = Math.max(0.6, hit.distance - 0.2);

    // shake: player trauma (bullets hitting the vehicle) + our own impact bumps
    this.bump = Math.max(0, this.bump - dt * 1.6);
    pl.trauma = Math.max(0, pl.trauma - dt * 0.9);
    const tr = Math.min(1, pl.trauma * pl.trauma + this.bump * this.bump);
    const s = G.time * 29 + this.seed;
    const shP = (Math.sin(s * 1.3) + Math.sin(s * 2.9 + 1.7)) * 0.5 * tr * 2.2 * DEG;
    const shY = (Math.sin(s * 1.7 + 4.1) + Math.sin(s * 3.3 + 0.3)) * 0.5 * tr * 2.2 * DEG;
    const shR = Math.sin(s * 2.1 + 2.2) * tr * 2.5 * DEG;

    cam.position.copy(this.pivot).addScaledVector(_back, this.arm);
    _e.set(pl.pitch + shP, pl.yaw + shY, shR);
    cam.quaternion.setFromEuler(_e);

    this.fovKick = damp(this.fovKick, clamp(t.speed / this.fovSpeed, 0, 1.15) * this.fovGain, 4, dt);
    const fov = pl.baseFov + this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
