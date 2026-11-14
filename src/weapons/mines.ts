import * as THREE from 'three';
import { G } from '../core/globals';
import { rand } from '../core/math';
import { Kit } from '../render/kit';
import { flat, PAL } from '../render/toon';
import type { HitZone, Target } from '../core/types';
import type { Explodable, Shootable, WorldHit } from '../world/world';
import { raySphere } from '../world/world';
import { levelScale } from './items';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

let mineGeo: THREE.BufferGeometry | null = null;
function mineMesh() {
  if (!mineGeo) {
    // "severance package": a small taped parcel with a detonator cap
    const k = new Kit();
    k.box(0.2, 0.09, 0.15, 0xc9a06a, [0, 0.045, 0]);
    k.box(0.204, 0.094, 0.035, 0xe8dcc0, [0, 0.045, 0]);
    k.box(0.05, 0.096, 0.154, 0xe8dcc0, [0, 0.045, 0]);
    k.cyl(0.03, 0.03, 0.03, PAL.screen, [0.055, 0.1, 0.03], 'y', 8);
    k.box(0.07, 0.006, 0.05, PAL.smile, [-0.05, 0.092, -0.035]);
    k.cyl(0.004, 0.004, 0.09, 0x55585f, [-0.07, 0.13, 0.05], 'y', 4);
    mineGeo = k.geometry();
  }
  return mineGeo;
}

export class Mine implements Shootable, Explodable {
  readonly mesh = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly normal = new THREE.Vector3(0, 1, 0);
  stuck = false;
  dead = false;
  /** seconds since it stuck */
  age = 0;
  /** countdown once the detonation signal is sent (staggers multiple mines) */
  fuse = -1;
  private led: THREE.Mesh;
  private stuckTo: Target | null = null;
  private stuckOffset = new THREE.Vector3();
  private spin = new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6));
  private beepT = 0;
  // Shootable
  readonly boundPos = this.pos;
  readonly boundRadius = 0.3;
  readonly owner = null;

  constructor() {
    const m = new THREE.Mesh(mineGeo ?? mineMesh(), G.mat.prop);
    m.castShadow = true;
    this.mesh.add(m);
    this.led = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), flat(0xff2a1a));
    this.led.position.set(0.055, 0.12, 0.03);
    this.mesh.add(this.led);
    G.scene.add(this.mesh);
  }

  rayHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { zone?: HitZone; onHit?: WorldHit['onHit']; normal: THREE.Vector3 }) {
    if (!this.stuck) return -1;
    const d = raySphere(origin, dir, this.pos, 0.17);
    if (d < 0 || d > maxDist) return -1;
    out.normal.copy(this.normal);
    // a bullet sets it off, like any self-respecting remote mine
    out.onHit = () => {
      if (this.fuse < 0) this.fuse = 0.02;
    };
    return d;
  }

  onExplosion() {
    if (this.fuse < 0) this.fuse = rand(0.06, 0.16);
  }

  update(dt: number) {
    if (this.dead) return;
    if (!this.stuck) {
      this.vel.y -= 16 * dt;
      _v.copy(this.vel).multiplyScalar(dt);
      const dist = _v.length();
      if (dist > 1e-5) {
        _dir.copy(_v).multiplyScalar(1 / dist);
        const hit = G.world.hitscan(this.pos, _dir, dist + 0.08, G.player);
        if (hit) {
          this.stick(hit);
        } else this.pos.add(_v);
      }
      this.mesh.rotation.x += this.spin.x * dt;
      this.mesh.rotation.y += this.spin.y * dt;
      this.mesh.rotation.z += this.spin.z * dt;
      if (this.pos.y < G.killY) this.dead = true;
    } else {
      this.age += dt;
      if (this.stuckTo) {
        if (!this.stuckTo.alive) {
          // carrier died: fall off and re-stick wherever it lands
          this.stuckTo = null;
          this.stuck = false;
          this.vel.set(0, 1, 0);
        } else this.pos.copy(this.stuckTo.pos).add(this.stuckOffset);
      }
      // blinking LED, faster once the signal is sent
      const rate = this.fuse >= 0 ? 30 : 2.2;
      this.led.visible = Math.sin(this.age * rate * Math.PI) > 0;
      this.beepT -= dt;
      if (this.beepT <= 0) {
        this.beepT = 1.8;
        G.audio.play('mine_beep', { pos: this.pos, vol: 0.25, ref: 2.5, maxDist: 25 });
      }
    }
    if (this.fuse >= 0) {
      this.fuse -= dt;
      if (this.fuse <= 0) this.explode();
    }
    this.mesh.position.copy(this.pos);
    if (this.dead) this.dispose();
  }

  private stick(hit: WorldHit) {
    this.stuck = true;
    this.age = 0;
    this.normal.copy(hit.normal);
    this.pos.copy(hit.point).addScaledVector(hit.normal, 0.01);
    _q.setFromUnitVectors(UP, hit.normal);
    this.mesh.quaternion.copy(_q);
    this.mesh.rotateY(rand(0, 6.28));
    if (hit.target && hit.target.alive) {
      this.stuckTo = hit.target;
      this.stuckOffset.copy(this.pos).sub(hit.target.pos);
    }
    G.audio.play('mine_stick', { pos: this.pos, vol: 0.8, ref: 4 });
    G.world.noise(this.pos, 9, 'impact', G.player);
    G.events.emit('mineStuck', { mine: this });
  }

  private explode() {
    if (this.dead) return;
    this.dead = true;
    _v2.copy(this.pos).addScaledVector(this.normal, 0.25);
    const dmg = 230 * levelScale(G.enemyLevel);
    G.world.explode(_v2, 6.2, dmg, G.player);
    G.events.emit('mineExploded', { pos: _v2.clone() });
    this.dispose();
  }

  dispose() {
    this.mesh.removeFromParent();
    G.world.remove(G.world.shootables, this as Shootable);
    G.world.remove(G.world.explodables, this as Explodable);
  }
}

export class Mines {
  readonly list: Mine[] = [];

  get armedCount() {
    let n = 0;
    for (const m of this.list) if (!m.dead && m.fuse < 0) n++;
    return n;
  }

  /** Called from the throw animation at the moment of release. */
  throwMine() {
    const inv = G.inv;
    if (inv.mines <= 0) return;
    inv.mines--;
    const pl = G.player;
    const m = new Mine();
    const cam = G.camera;
    pl.aimDir(_dir);
    _v.set(-0.22, -0.12, -0.35).applyQuaternion(cam.quaternion);
    m.pos.copy(cam.position).add(_v);
    // never start inside a wall
    const eye = pl.eyePos(_v2);
    if (!G.col.lineOfSight(eye, m.pos)) m.pos.copy(eye);
    m.vel.copy(_dir).multiplyScalar(15).add(pl.vel);
    m.vel.y += 2.6;
    m.mesh.position.copy(m.pos);
    this.list.push(m);
    G.world.shootables.push(m);
    G.world.explodables.push(m);
  }

  /** The watch squeeze: everything planted goes off, a beat apart. */
  detonateAll() {
    let i = 0;
    for (const m of this.list) {
      if (m.dead || m.fuse >= 0) continue;
      m.fuse = 0.05 + i * 0.11;
      i++;
    }
    if (i > 0) G.view.setWatch(G.inv.mines, 0, true);
    return i;
  }

  update(dt: number) {
    for (const m of this.list) m.update(dt);
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].dead) this.list.splice(i, 1);
    G.view.setWatch(G.inv.mines, this.armedCount, this.list.some((m) => m.fuse >= 0));
  }

  /** Nearest live mine to a point (for AI that wants to run away from it). */
  nearest(pos: THREE.Vector3, maxDist: number): Mine | null {
    let best: Mine | null = null;
    let bd = maxDist * maxDist;
    for (const m of this.list) {
      if (m.dead || !m.stuck) continue;
      const d = m.pos.distanceToSquared(pos);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  clear() {
    for (const m of this.list) {
      m.dead = true;
      m.dispose();
    }
    this.list.length = 0;
  }
}
