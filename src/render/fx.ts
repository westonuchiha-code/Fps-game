import * as THREE from 'three';
import { G } from '../core/globals';
import { clamp, lerp, rand, randSign } from '../core/math';
import { Surf } from '../world/builder';
import type { Element } from '../core/types';
import { LAYER_FX } from './pipeline';
import { flat, toon, PAL, ELEMENT_COLORS, RAMP_CHAR } from './toon';

interface Particle {
  alive: boolean;
  kind: 0 | 1; // 0 puff (lit, inked), 1 chip (unlit)
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  max: number;
  s0: number;
  s1: number;
  /** elongation along velocity for sparks */
  stretch: number;
  grav: number;
  drag: number;
  c0: THREE.Color;
  c1: THREE.Color;
  rot: number;
  spin: number;
  /** bounce on the floor (casings / debris): floor height, or NaN */
  floor: number;
  bounced: boolean;
  sound: string | null;
}

const CAP = 420;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _axis = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ZAXIS = new THREE.Vector3(0, 0, 1);

interface Tracer {
  mesh: THREE.Mesh;
  t: number;
  dur: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  width: number;
}

interface Decal {
  mesh: THREE.Mesh;
  t: number;
}

interface FlashLight {
  light: THREE.PointLight;
  t: number;
  dur: number;
  peak: number;
}

interface Ring {
  mesh: THREE.Mesh;
  t: number;
  dur: number;
  r0: number;
  r1: number;
}

/** All transient visual effects. Pooled: nothing here allocates during play. */
export class Fx {
  private parts: Particle[] = [];
  private puffs: THREE.InstancedMesh;
  private chips: THREE.InstancedMesh;
  private tracers: Tracer[] = [];
  private decals: Decal[] = [];
  private decalNext = 0;
  private lights: FlashLight[] = [];
  private rings: Ring[] = [];
  private cursor = 0;
  private popups: { el: HTMLElement; t: number; pos: THREE.Vector3 }[] = [];

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < CAP; i++) {
      this.parts.push({
        alive: false, kind: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 1, s1: 1, stretch: 0, grav: 0, drag: 0,
        c0: new THREE.Color(), c1: new THREE.Color(), rot: 0, spin: 0, floor: NaN, bounced: false, sound: null,
      });
    }
    const puffGeo = new THREE.IcosahedronGeometry(1, 1);
    this.puffs = new THREE.InstancedMesh(puffGeo, toon({ color: 0xffffff, ramp: RAMP_CHAR }), CAP);
    this.puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffs.frustumCulled = false;
    this.puffs.count = 0;
    this.puffs.setColorAt(0, _c.set(1, 1, 1));
    this.puffs.receiveShadow = false;
    scene.add(this.puffs);

    const chipGeo = new THREE.BoxGeometry(1, 1, 1);
    this.chips = new THREE.InstancedMesh(chipGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }), CAP);
    this.chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chips.frustumCulled = false;
    this.chips.count = 0;
    this.chips.setColorAt(0, _c.set(1, 1, 1));
    this.chips.layers.set(LAYER_FX);
    scene.add(this.chips);

    // tracers: unit boxes stretched along +Z
    const tg = new THREE.BoxGeometry(1, 1, 1);
    tg.translate(0, 0, 0.5);
    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      mesh.visible = false;
      mesh.layers.set(LAYER_FX);
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, t: 0, dur: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), width: 0.03 });
    }

    // bullet-hole decals: an inky splat
    const splat = makeSplatTexture();
    const dg = new THREE.PlaneGeometry(1, 1);
    const dm = new THREE.MeshBasicMaterial({ map: splat, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true });
    for (let i = 0; i < 90; i++) {
      const mesh = new THREE.Mesh(dg, dm);
      mesh.visible = false;
      mesh.layers.set(LAYER_FX);
      scene.add(mesh);
      this.decals.push({ mesh, t: 0 });
    }

    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight(0xffb060, 0, 30, 1.4);
      light.layers.enableAll();
      scene.add(light);
      this.lights.push({ light, t: 1, dur: 1, peak: 0 });
    }

    const rg = new THREE.RingGeometry(0.82, 1, 28);
    rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      mesh.visible = false;
      mesh.layers.set(LAYER_FX);
      scene.add(mesh);
      this.rings.push({ mesh, t: 1, dur: 1, r0: 0, r1: 1 });
    }
  }

  private spawn(): Particle {
    // ring allocator: reuse the oldest slot when full
    for (let i = 0; i < CAP; i++) {
      const p = this.parts[(this.cursor + i) % CAP];
      if (!p.alive) {
        this.cursor = (this.cursor + i + 1) % CAP;
        p.alive = true;
        p.bounced = false;
        p.floor = NaN;
        p.sound = null;
        p.stretch = 0;
        p.rot = rand(0, 6.28);
        p.spin = 0;
        return p;
      }
    }
    const p = this.parts[this.cursor];
    this.cursor = (this.cursor + 1) % CAP;
    p.bounced = false;
    p.floor = NaN;
    p.sound = null;
    p.stretch = 0;
    return p;
  }

  /** Lit, ink-outlined ball that swells and shrinks: smoke, dust, fireballs. */
  puff(pos: THREE.Vector3, vel: THREE.Vector3, life: number, s0: number, s1: number, c0: number, c1: number, grav = 0, drag = 2) {
    const p = this.spawn();
    p.kind = 0;
    p.x = pos.x; p.y = pos.y; p.z = pos.z;
    p.vx = vel.x; p.vy = vel.y; p.vz = vel.z;
    p.life = p.max = life;
    p.s0 = s0; p.s1 = s1;
    p.grav = grav; p.drag = drag;
    p.c0.setHex(c0); p.c1.setHex(c1);
    p.spin = rand(-2, 2);
    return p;
  }

  /** Unlit bright fleck: sparks, debris, casings. */
  chip(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, c0: number, c1: number, grav = 14, drag = 0.4, stretch = 0) {
    const p = this.spawn();
    p.kind = 1;
    p.x = pos.x; p.y = pos.y; p.z = pos.z;
    p.vx = vel.x; p.vy = vel.y; p.vz = vel.z;
    p.life = p.max = life;
    p.s0 = size; p.s1 = size * 0.4;
    p.grav = grav; p.drag = drag;
    p.c0.setHex(c0); p.c1.setHex(c1);
    p.stretch = stretch;
    p.spin = rand(-14, 14);
    return p;
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number, width = 0.03) {
    let best = this.tracers[0];
    for (const t of this.tracers) {
      if (!t.mesh.visible) {
        best = t;
        break;
      }
      if (t.t / t.dur > best.t / best.dur) best = t;
    }
    best.from.copy(from);
    best.to.copy(to);
    best.t = 0;
    const len = from.distanceTo(to);
    best.dur = clamp(len / 260, 0.05, 0.16);
    best.width = width;
    (best.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    best.mesh.visible = true;
  }

  decal(point: THREE.Vector3, normal: THREE.Vector3, size = 0.16) {
    const d = this.decals[this.decalNext];
    this.decalNext = (this.decalNext + 1) % this.decals.length;
    d.mesh.position.copy(point).addScaledVector(normal, 0.012);
    d.mesh.quaternion.setFromUnitVectors(ZAXIS, normal);
    d.mesh.rotateZ(rand(0, 6.28));
    d.mesh.scale.setScalar(size * rand(0.8, 1.25));
    d.mesh.visible = true;
    d.t = 0;
  }

  flash(pos: THREE.Vector3, color: number, peak: number, dur: number, dist = 30) {
    let best = this.lights[0];
    for (const l of this.lights) if (l.t / l.dur > best.t / best.dur) best = l;
    best.light.position.copy(pos);
    best.light.color.setHex(color);
    best.light.distance = dist;
    best.t = 0;
    best.dur = dur;
    best.peak = peak;
  }

  ring(pos: THREE.Vector3, r0: number, r1: number, dur: number, color: number) {
    let best = this.rings[0];
    for (const r of this.rings) if (r.t / r.dur > best.t / best.dur) best = r;
    best.mesh.position.copy(pos);
    (best.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    best.t = 0;
    best.dur = dur;
    best.r0 = r0;
    best.r1 = r1;
    best.mesh.visible = true;
  }

  /** Bullet strike on level geometry. */
  impact(point: THREE.Vector3, normal: THREE.Vector3, surf: Surf, element: Element) {
    const cam = G.camera.position;
    const near = point.distanceToSquared(cam) < 70 * 70;
    const snd = surf === Surf.Metal ? 'impact_metal' : surf === Surf.Sand ? 'impact_sand' : surf === Surf.Wood ? 'impact_wood' : 'impact_concrete';
    G.audio.play(snd, { pos: point, vol: 0.7, pitchVar: 0.1, ref: 4 });
    if (surf === Surf.Metal && Math.random() < 0.22) G.audio.play('ricochet', { pos: point, vol: 0.5, pitchVar: 0.1, ref: 5 });
    if (!near) return;
    this.decal(point, normal, surf === Surf.Sand ? 0.2 : 0.15);
    const dust = surf === Surf.Sand ? PAL.sand : surf === Surf.Wood ? PAL.wood : surf === Surf.Metal ? 0x9aa4b0 : PAL.concrete;
    const n = surf === Surf.Metal ? 5 : 3;
    for (let i = 0; i < n; i++) {
      _v.copy(normal).multiplyScalar(rand(2, 5)).add(_v2.set(rand(-2, 2), rand(0, 2.5), rand(-2, 2)));
      if (surf === Surf.Metal) this.chip(point, _v, rand(0.12, 0.3), 0.02, 0xfff1b0, 0xff8a1f, 9, 0.5, 0.05);
      else this.chip(point, _v, rand(0.25, 0.5), rand(0.02, 0.04), dust, dust, 12, 0.6);
    }
    _v.copy(normal).multiplyScalar(0.8);
    this.puff(_p.copy(point).addScaledVector(normal, 0.05), _v, rand(0.22, 0.34), 0.05, 0.2, dust, dust, -0.4, 3);
    if (element !== 'none') this.elementBurst(point, element, 0.5);
  }

  /** Sparks + oil when a robot is hit. */
  robotHit(point: THREE.Vector3, dir: THREE.Vector3, crit: boolean, element: Element) {
    const n = crit ? 8 : 4;
    for (let i = 0; i < n; i++) {
      _v.copy(dir).multiplyScalar(-rand(1, 4)).add(_v2.set(rand(-3, 3), rand(0.5, 4), rand(-3, 3)));
      this.chip(point, _v, rand(0.15, 0.4), crit ? 0.035 : 0.025, crit ? 0xffffff : 0xfff1b0, 0xffa020, 11, 0.4, 0.06);
    }
    if (crit) this.puff(point, _v.set(0, 0.6, 0), 0.25, 0.08, 0.26, 0xfff1b0, 0xff8a1f, 0, 3);
    if (element !== 'none') this.elementBurst(point, element, 0.7);
  }

  shieldHit(point: THREE.Vector3) {
    for (let i = 0; i < 5; i++) {
      _v.set(rand(-3, 3), rand(-1, 3), rand(-3, 3));
      this.chip(point, _v, rand(0.12, 0.25), 0.03, 0xd8f4ff, PAL.shock, 2, 1, 0.05);
    }
    this.ring(point, 0.1, 0.55, 0.16, 0x9fe8ff);
  }

  elementBurst(point: THREE.Vector3, element: Element, scale = 1) {
    const col = ELEMENT_COLORS[element];
    if (element === 'fire') {
      for (let i = 0; i < 3; i++) this.puff(_p.copy(point).add(_v.set(rand(-0.1, 0.1), rand(0, 0.1), rand(-0.1, 0.1))), _v2.set(rand(-0.4, 0.4), rand(0.8, 1.8), rand(-0.4, 0.4)), rand(0.25, 0.45), 0.1 * scale, 0.02, 0xffe06a, col, -1.5, 1);
    } else if (element === 'shock') {
      for (let i = 0; i < 6; i++) this.chip(point, _v.set(rand(-5, 5), rand(-2, 5), rand(-5, 5)), rand(0.08, 0.2), 0.03 * scale, 0xffffff, col, 0, 2, 0.12);
    } else if (element === 'acid') {
      for (let i = 0; i < 5; i++) this.chip(point, _v.set(rand(-2, 2), rand(1, 3.5), rand(-2, 2)), rand(0.3, 0.6), 0.04 * scale, 0xd9ff6a, col, 12, 0.5);
    }
  }

  /** Ejected casing: bounces once with a tinkle. */
  casing(pos: THREE.Vector3, vel: THREE.Vector3, kind: 'brass' | 'shell') {
    const p = this.chip(pos, vel, 1.6, kind === 'shell' ? 0.03 : 0.018, kind === 'shell' ? 0xc8402a : 0xd9aa3a, kind === 'shell' ? 0xc8402a : 0xd9aa3a, 15, 0.2, kind === 'shell' ? 0.03 : 0.02);
    p.s1 = p.s0;
    const g = G.col.groundY(pos.x, pos.z, pos.y + 0.2, 4);
    p.floor = g ?? pos.y - 1.5;
    p.sound = kind === 'shell' ? 'shell_shotgun' : 'shell_casing';
  }

  /** Small star flash at an NPC's muzzle. */
  muzzle(pos: THREE.Vector3, dir: THREE.Vector3, color: number, size = 0.5) {
    this.chip(pos, _v.copy(dir).multiplyScalar(2), 0.06, size * 0.5, 0xffffff, color, 0, 0, 0);
    this.flash(pos, color, 9, 0.07, 12);
  }

  /** Cel-style explosion: a few hard-edged fireballs, a flash ring, sparks and smoke. */
  explosion(center: THREE.Vector3, radius: number, small: boolean, element: Element) {
    const k = small ? 0.5 : 1;
    const hot = element === 'none' ? 0xfff3a8 : 0xffffff;
    const mid = element === 'none' ? PAL.fire : ELEMENT_COLORS[element];
    // core fireballs
    const n = small ? 4 : 8;
    for (let i = 0; i < n; i++) {
      _v.set(rand(-1, 1), rand(0.1, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(1, 5) * k);
      _p.copy(center).addScaledVector(_v, 0.08);
      this.puff(_p, _v, rand(0.35, 0.6), radius * 0.2 * k, radius * rand(0.42, 0.6) * k, hot, mid, -1, 3.2);
    }
    // smoke that lingers
    for (let i = 0; i < (small ? 3 : 7); i++) {
      _v.set(rand(-1, 1), rand(0.5, 1.6), rand(-1, 1)).multiplyScalar(rand(1, 3) * k);
      _p.copy(center).add(_v2.set(rand(-0.4, 0.4), rand(0, 0.5), rand(-0.4, 0.4)));
      const p = this.puff(_p, _v, rand(0.9, 1.6), radius * 0.22 * k, radius * rand(0.3, 0.5) * k, 0x5a5560, 0x2c2a33, -1.2, 1.8);
      p.life = p.max * 0.999;
    }
    // sparks / debris
    for (let i = 0; i < (small ? 8 : 20); i++) {
      _v.set(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(6, 17) * (small ? 0.6 : 1));
      this.chip(center, _v, rand(0.35, 0.9), rand(0.03, 0.07), hot, mid, 16, 0.6, 0.1);
    }
    this.ring(_p.copy(center).setY(center.y + 0.1), radius * 0.15, radius * 1.25, 0.28, hot);
    this.flash(center, mid, small ? 40 : 110, 0.3, radius * 6);
    // scorch
    const g = G.col.raycast(_p.copy(center).setY(center.y + 0.3), _v.set(0, -1, 0), 2.5, 'static');
    if (g) this.decal(g.point, g.normal, radius * (small ? 0.7 : 1.1));
    if (!small) this.comic(center, element === 'none' ? 'BOOM!' : element === 'shock' ? 'ZZAP!' : element === 'fire' ? 'FWOOSH!' : 'HISSS!');
  }

  /** Burst of parts when a robot is destroyed. */
  scrap(center: THREE.Vector3, color: number, count = 8) {
    for (let i = 0; i < count; i++) {
      _v.set(rand(-1, 1), rand(0.4, 1.5), rand(-1, 1)).normalize().multiplyScalar(rand(2, 8));
      const p = this.chip(center, _v, rand(0.8, 1.6), rand(0.05, 0.12), i % 3 === 0 ? PAL.screen : color, color, 16, 0.3);
      p.s1 = p.s0;
      p.floor = center.y - 0.9;
    }
    for (let i = 0; i < 6; i++) {
      _v.set(rand(-4, 4), rand(1, 6), rand(-4, 4));
      this.chip(center, _v, rand(0.2, 0.5), 0.03, 0xfff1b0, 0xffa020, 12, 0.5, 0.08);
    }
    this.puff(center, _v.set(0, 1, 0), 0.5, 0.2, 0.7, 0x4a4650, 0x2c2a33, -1, 2);
  }

  /** Comic-book onomatopoeia that pops at a world position. */
  comic(pos: THREE.Vector3, text: string) {
    const el = document.createElement('div');
    el.className = 'comic';
    el.textContent = text;
    el.style.setProperty('--rot', rand(-14, 14).toFixed(1) + 'deg');
    G.hud.layer.appendChild(el);
    this.popups.push({ el, t: 0, pos: pos.clone() });
  }

  update(dt: number) {
    // ---- particles ----
    let np = 0;
    let nc = 0;
    const cam = G.camera;
    for (const p of this.parts) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.vy -= p.grav * dt;
      const dr = Math.max(0, 1 - p.drag * dt);
      p.vx *= dr; p.vy *= dr; p.vz *= dr;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (!Number.isNaN(p.floor) && p.y < p.floor + 0.02) {
        p.y = p.floor + 0.02;
        if (Math.abs(p.vy) > 1.2) {
          p.vy = -p.vy * 0.35;
          p.vx *= 0.6; p.vz *= 0.6;
          if (!p.bounced && p.sound) G.audio.play(p.sound, { pos: _p.set(p.x, p.y, p.z), vol: 0.35, pitchVar: 0.12, ref: 2.5 });
          p.bounced = true;
        } else {
          p.vx = p.vy = p.vz = 0;
          p.spin = 0;
        }
      }
      const u = 1 - p.life / p.max;
      p.rot += p.spin * dt;
      _c.copy(p.c0).lerp(p.c1, u);
      if (p.kind === 0) {
        // swell fast, then shrink away
        const grow = u < 0.25 ? lerp(p.s0, p.s1, u / 0.25) : p.s1 * (1 - Math.pow((u - 0.25) / 0.75, 2.2));
        _s.setScalar(Math.max(0.001, grow));
        _q.setFromAxisAngle(UP, p.rot);
        _m.compose(_p.set(p.x, p.y, p.z), _q, _s);
        this.puffs.setMatrixAt(np, _m);
        this.puffs.setColorAt(np, _c);
        np++;
      } else {
        const sz = lerp(p.s0, p.s1, u);
        const sp = Math.hypot(p.vx, p.vy, p.vz);
        if (p.stretch > 0 && sp > 0.5) {
          _axis.set(p.vx / sp, p.vy / sp, p.vz / sp);
          _q.setFromUnitVectors(ZAXIS, _axis);
          _s.set(sz, sz, sz + p.stretch * Math.min(sp, 12) * 0.12);
        } else {
          _q.setFromAxisAngle(_axis.set(0.3, 0.8, 0.5).normalize(), p.rot);
          _s.set(sz, sz, sz * (p.stretch > 0 ? 2.2 : 1));
        }
        _m.compose(_p.set(p.x, p.y, p.z), _q, _s);
        this.chips.setMatrixAt(nc, _m);
        this.chips.setColorAt(nc, _c);
        nc++;
      }
    }
    this.puffs.count = np;
    this.chips.count = nc;
    this.puffs.instanceMatrix.needsUpdate = true;
    this.chips.instanceMatrix.needsUpdate = true;
    if (this.puffs.instanceColor) this.puffs.instanceColor.needsUpdate = true;
    if (this.chips.instanceColor) this.chips.instanceColor.needsUpdate = true;

    // ---- tracers: a bright streak that races to the hit point ----
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.t += dt;
      const u = t.t / t.dur;
      if (u >= 1) {
        t.mesh.visible = false;
        continue;
      }
      const len = t.from.distanceTo(t.to);
      const head = Math.min(1, u * 1.6);
      const tail = Math.max(0, u * 1.6 - 0.55);
      _v.lerpVectors(t.from, t.to, tail);
      _v2.lerpVectors(t.from, t.to, head);
      t.mesh.position.copy(_v);
      t.mesh.lookAt(_v2);
      t.mesh.scale.set(t.width, t.width, Math.max(0.01, len * (head - tail)));
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - u * 0.6;
    }

    // ---- lights ----
    for (const l of this.lights) {
      if (l.t >= l.dur) {
        if (l.light.intensity !== 0) l.light.intensity = 0;
        continue;
      }
      l.t += dt;
      const u = clamp(l.t / l.dur, 0, 1);
      l.light.intensity = l.peak * (1 - u) * (1 - u);
    }

    // ---- shock rings ----
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const u = r.t / r.dur;
      if (u >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - u, 3);
      r.mesh.scale.setScalar(lerp(r.r0, r.r1, e));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - u;
    }

    // ---- decals fade out after a while ----
    for (const d of this.decals) {
      if (!d.mesh.visible) continue;
      d.t += dt;
      if (d.t > 40) d.mesh.visible = false;
    }

    // ---- comic text ----
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t += dt;
      if (p.t > 0.7) {
        p.el.remove();
        this.popups.splice(i, 1);
        continue;
      }
      _v.copy(p.pos);
      _v.y += 1.2 + p.t * 0.6;
      _v.project(cam);
      if (_v.z > 1) {
        p.el.style.display = 'none';
        continue;
      }
      const dist = p.pos.distanceTo(cam.position);
      const sc = clamp(26 / dist, 0.45, 2.2) * (p.t < 0.1 ? 0.5 + p.t * 5 : 1);
      p.el.style.display = '';
      p.el.style.opacity = String(p.t > 0.5 ? 1 - (p.t - 0.5) / 0.2 : 1);
      p.el.style.transform = `translate(-50%,-50%) translate(${((_v.x + 1) / 2) * 100}vw, ${((1 - _v.y) / 2) * 100}vh) scale(${sc.toFixed(2)}) rotate(var(--rot))`;
    }
  }

  clear() {
    for (const p of this.parts) p.alive = false;
    for (const t of this.tracers) t.mesh.visible = false;
    for (const d of this.decals) d.mesh.visible = false;
    for (const r of this.rings) r.mesh.visible = false;
    for (const p of this.popups) p.el.remove();
    this.popups.length = 0;
  }
}

function makeSplatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(11,11,18,0.9)';
  g.beginPath();
  const n = 11;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 12 + ((i * 7) % 5) * 2.4;
    const x = 32 + Math.cos(a) * r;
    const y = 32 + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.fill();
  g.strokeStyle = 'rgba(11,11,18,0.75)';
  g.lineWidth = 1.6;
  for (let i = 0; i < 6; i++) {
    const a = i * 1.13 + 0.4;
    g.beginPath();
    g.moveTo(32 + Math.cos(a) * 12, 32 + Math.sin(a) * 12);
    g.lineTo(32 + Math.cos(a + 0.12) * (22 + (i % 3) * 4), 32 + Math.sin(a + 0.12) * (22 + (i % 3) * 4));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export { flat, randSign };
