import * as THREE from 'three';
import { G } from '../core/globals';
import { LAYER_FX } from '../render/pipeline';
import { hostile, type Element, type Target } from '../core/types';

interface Bolt {
  mesh: THREE.Mesh;
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  owner: Target | null;
  damage: number;
  element: Element;
  radius: number; // > 0 = explodes
  life: number;
  speed: number;
  whizzed: boolean;
  gravity: number;
}

const _dir = new THREE.Vector3();
const _v = new THREE.Vector3();
const _end = new THREE.Vector3();

/** Visible, dodgeable energy bolts fired by NPCs and vehicles. */
export class Projectiles {
  private pool: Bolt[] = [];

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0, -0.5);
    for (let i = 0; i < 90; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.layers.set(LAYER_FX);
      scene.add(mesh);
      this.pool.push({ mesh, alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), owner: null, damage: 0, element: 'none', radius: 0, life: 0, speed: 1, whizzed: false, gravity: 0 });
    }
  }

  fire(owner: Target | null, from: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, opts: { color?: number; element?: Element; radius?: number; size?: number; gravity?: number } = {}) {
    let b = this.pool.find((x) => !x.alive);
    if (!b) {
      b = this.pool[0];
      for (const x of this.pool) if (x.life < b.life) b = x;
    }
    b.alive = true;
    b.pos.copy(from);
    b.vel.copy(dir).multiplyScalar(speed);
    b.owner = owner;
    b.damage = damage;
    b.element = opts.element ?? 'none';
    b.radius = opts.radius ?? 0;
    b.life = 4;
    b.speed = speed;
    b.whizzed = false;
    b.gravity = opts.gravity ?? 0;
    const s = opts.size ?? 0.07;
    b.mesh.scale.set(s, s, Math.max(0.5, speed * 0.028) * (opts.radius ? 0.5 : 1));
    (b.mesh.material as THREE.MeshBasicMaterial).color.setHex(opts.color ?? 0xffe36a);
    b.mesh.visible = true;
    b.mesh.position.copy(from);
    return b;
  }

  update(dt: number) {
    const pl = G.player;
    for (const b of this.pool) {
      if (!b.alive) continue;
      b.life -= dt;
      if (b.life <= 0) {
        this.kill(b);
        continue;
      }
      b.vel.y -= b.gravity * dt;
      const dist = b.vel.length() * dt;
      _dir.copy(b.vel).normalize();
      const hit = G.world.hitscan(b.pos, _dir, dist, b.owner);
      const faction = b.owner ? b.owner.faction : 'monomart';
      if (hit && hit.target && !hostile(faction, hit.target.faction)) {
        // friends are not obstacles
        b.pos.addScaledVector(_dir, dist);
      } else if (hit) {
        if (b.radius > 0) {
          G.world.explode(hit.point.clone().addScaledVector(hit.normal, 0.2), b.radius, b.damage, b.owner, { small: b.radius < 4, element: b.element, byFaction: faction });
        } else if (hit.target) {
          hit.target.takeDamage({ amount: b.damage, element: b.element, crit: false, kind: 'bullet', source: b.owner, point: hit.point, dir: _dir.clone(), impulse: 0.4, zone: hit.zone, statusChance: b.element === 'none' ? 0 : 0.2, statusDps: b.damage * 0.5 });
        } else {
          G.fx.impact(hit.point, hit.normal, hit.surf, b.element);
          hit.onHit?.(b.damage, b.owner);
        }
        this.kill(b);
        continue;
      } else b.pos.addScaledVector(_dir, dist);

      // near-miss whiz past the player's head
      if (!b.whizzed && b.owner !== pl && pl.alive) {
        pl.headPoint(_v);
        _end.copy(_v).sub(b.pos);
        const along = _end.dot(_dir);
        if (along < 0 && _end.lengthSq() < 9) {
          b.whizzed = true;
          G.audio.play('bullet_whiz', { vol: 0.5, pitchVar: 0.12 });
        }
      }
      b.mesh.position.copy(b.pos);
      _v.copy(b.pos).add(_dir);
      b.mesh.lookAt(_v);
    }
  }

  private kill(b: Bolt) {
    b.alive = false;
    b.mesh.visible = false;
  }

  clear() {
    for (const b of this.pool) this.kill(b);
  }
}
