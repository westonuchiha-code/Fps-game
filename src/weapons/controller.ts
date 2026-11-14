import * as THREE from 'three';
import { G } from '../core/globals';
import { clamp, damp, DEG, lerp, rand } from '../core/math';
import { ELEMENT_COLORS } from '../render/toon';
import type { DamageInfo } from '../core/types';
import { hostile } from '../core/types';
import { levelScale, type WeaponItem } from './items';
import type { ClipName } from './clips';
import type { Clip } from './anim';

type State = 'none' | 'draw' | 'ready' | 'reload' | 'holster' | 'melee' | 'gesture' | 'inspect';

const BLOOM: Record<string, number> = { pistol: 0.55, rifle: 0.34, shotgun: 0, sniper: 0 };
const MOVE_SCALE: Record<string, number> = { pistol: 1, rifle: 0.97, shotgun: 0.96, sniper: 0.92 };

const _origin = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Everything about using the gun in your hands: firing, reloading, swapping, aiming, melee. */
export class WeaponController {
  state: State = 'none';
  adsAmount = 0;
  /** true while firing/aiming should keep the player from sprinting */
  blocksSprint = false;
  private nextFire = 0;
  private fireBuffer = 0;
  private bloom = 0;
  private sprintLock = 0;
  private lowerT = 0;
  private pendingSlot = -1;
  private reloadStartedEmpty = false;
  private reloadReady = false; // ammo is in: the rest of the clip may be cancelled by firing
  private shellInterrupt = false;
  private autoReloadT = 0;
  private lastShotT = -9;
  /** disables all weapon input (cutscenes, vehicles, menus) */
  holstered = false;
  private wantHolster = false;

  get cur(): WeaponItem | null {
    return G.inv.current;
  }
  get zoom() {
    return this.cur ? this.cur.zoom : 1;
  }
  get moveScale() {
    return this.cur ? MOVE_SCALE[this.cur.cls] * lerp(1, 0.92, this.adsAmount) : 1;
  }
  /** current hip/aim spread in degrees (drives the crosshair) */
  get spread() {
    const w = this.cur;
    if (!w) return 1;
    const pl = G.player;
    let s = lerp(w.spreadHip, w.spreadAds, this.adsAmount);
    const hipK = 1 - this.adsAmount;
    s *= 1 + clamp(pl.speed / 8, 0, 1) * 0.55 * hipK;
    if (!pl.grounded) s *= 1 + 0.9 * hipK;
    if (pl.crouching) s *= 0.8;
    return s + this.bloom * (0.35 + 0.65 * hipK);
  }

  init() {
    const vm = G.view;
    vm.anim.onEvent = (type, arg) => this.onAnimEvent(type, arg);
    vm.anim.onEnd = (clip) => this.onAnimEnd(clip);
  }

  /** Called when a slot's contents changed (pickup, swap, drop). */
  onInventoryChanged(slot: number) {
    if (slot !== G.inv.active) return;
    this.equipActive();
  }

  /** Put away the gun (vehicles, cutscenes) or bring it back out. */
  setHolstered(on: boolean, instant = false) {
    this.holstered = on;
    if (on) {
      this.adsAmount = instant ? 0 : this.adsAmount;
      if (instant || !this.cur) {
        G.view.setGun(null);
        this.state = 'none';
      } else if (this.state !== 'none' && this.state !== 'holster') {
        this.wantHolster = true;
        this.state = 'holster';
        G.view.play('holster', 0.06, 1.3);
      }
    } else {
      this.wantHolster = false;
      if (this.cur) this.equipActive();
    }
  }

  /** Show the active slot's weapon and play its draw animation. */
  equipActive() {
    const w = this.cur;
    const vm = G.view;
    this.pendingSlot = -1;
    this.adsAmount = 0;
    this.bloom = 0;
    if (!w || this.holstered) {
      vm.setGun(null);
      this.state = 'none';
      return;
    }
    vm.setGun(w);
    this.state = 'draw';
    vm.play('draw', 0, 1.15);
    // pistols that were emptied keep their slide locked back
    this.nextFire = 0;
  }

  switchTo(slot: number) {
    const inv = G.inv;
    if (slot === inv.active || !inv.slots[slot] || this.holstered) return;
    if (this.state === 'gesture' || this.state === 'melee') return;
    if (!this.cur || this.state === 'none') {
      inv.active = slot;
      this.equipActive();
      return;
    }
    this.pendingSlot = slot;
    if (this.state !== 'holster') {
      this.state = 'holster';
      G.view.play('holster', 0.06, 1.25);
    }
  }

  private cycle(dir: number) {
    const inv = G.inv;
    for (let i = 1; i <= 4; i++) {
      const s = (inv.active + dir * i + 8) % 4;
      if (inv.slots[s]) {
        this.switchTo(s);
        return;
      }
    }
  }

  onLand(impact: number) {
    G.view.bump(0, -clamp(impact * 0.25, 0.4, 3));
  }
  onMantle(dur: number) {
    this.lowerT = dur + 0.08;
  }

  // ------------------------------------------------------------------ update

  update(dt: number) {
    const inp = G.input;
    const vm = G.view;
    const pl = G.player;
    const w = this.cur;
    const now = G.time;
    this.bloom = Math.max(0, this.bloom - dt * (2.2 + this.bloom * 2.5));
    this.sprintLock -= dt;
    this.lowerT -= dt;
    this.fireBuffer -= dt;

    const active = !this.holstered && pl.alive && !pl.frozen && !pl.vehicle;
    if (!w || !active) {
      this.adsAmount = damp(this.adsAmount, 0, 14, dt);
      vm.ads = this.adsAmount;
      vm.sprint = damp(vm.sprint, 0, 12, dt);
      vm.lower = damp(vm.lower, w && !active && !this.holstered ? 1 : 0, 10, dt);
      inp.lookScale = 1;
      this.blocksSprint = false;
      G.hud.setScope(false);
      return;
    }

    // ---- switching ----
    if (inp.pressed('slot1')) this.switchTo(0);
    if (inp.pressed('slot2')) this.switchTo(1);
    if (inp.pressed('slot3')) this.switchTo(2);
    if (inp.pressed('slot4')) this.switchTo(3);
    if (inp.pressed('next')) this.cycle(1);
    if (inp.pressed('prev')) this.cycle(-1);

    const busy = this.state !== 'ready';
    const reloading = this.state === 'reload';

    // ---- aim down sights ----
    const canAds = (this.state === 'ready' || this.state === 'draw' || (reloading && this.reloadReady)) && !pl.sprinting && this.lowerT <= 0;
    const wantAds = inp.isDown('ads') && canAds;
    const adsRate = 1 / Math.max(0.08, w.adsTime);
    this.adsAmount = clamp(this.adsAmount + (wantAds ? adsRate : -adsRate * 1.25) * dt, 0, 1);
    if (inp.pressed('ads') && canAds) G.audio.play('ads_in', { vol: 0.35 });
    if (inp.released('ads') && this.adsAmount > 0.3) G.audio.play('ads_out', { vol: 0.3 });
    vm.ads = this.adsAmount;
    inp.lookScale = 1 / lerp(1, Math.pow(w.zoom, 0.92), this.adsAmount);
    G.hud.setScope(vm.scopeView);

    // ---- sprint / lowered pose ----
    this.blocksSprint = this.sprintLock > 0 || this.adsAmount > 0.25;
    const sprintPose = pl.sprinting && (this.state === 'ready' || this.state === 'draw') ? 1 : 0;
    vm.sprint = damp(vm.sprint, sprintPose, sprintPose ? 9 : 14, dt);
    vm.lower = damp(vm.lower, this.lowerT > 0 ? 1 : 0, 14, dt);

    // ---- fire input ----
    const trigger = w.auto ? inp.isDown('fire') : inp.pressed('fire');
    if (inp.pressed('fire')) this.fireBuffer = 0.14;
    const wantsFire = trigger || (!w.auto && this.fireBuffer > 0);

    if (wantsFire) {
      if (this.state === 'inspect') {
        this.state = 'ready';
        vm.play('idle', 0.12);
      }
      if (reloading) {
        if (w.cls === 'shotgun' && w.ammo > 0) this.shellInterrupt = true;
        else if (this.reloadReady && w.ammo > 0) {
          this.state = 'ready';
        }
      }
      if (this.state === 'ready' && now >= this.nextFire && this.lowerT <= 0) {
        if (pl.sprinting || vm.sprint > 0.35) {
          // sprint-out: the shot comes as soon as the gun is back on target
          this.sprintLock = 0.3;
          this.fireBuffer = 0.2;
        } else if (w.ammo > 0) {
          this.fireBuffer = 0;
          this.shoot(w);
        } else if (G.inv.ammo[w.cls] > 0) {
          this.startReload();
        } else if (inp.pressed('fire')) {
          vm.play('dry', 0.03);
          G.hud.toast('NO AMMO', 0.8);
        }
      }
    }

    // ---- reload ----
    if (inp.pressed('reload') && (this.state === 'ready' || this.state === 'inspect') && w.ammo < w.magSize && G.inv.ammo[w.cls] > 0 && now >= this.nextFire - 0.05) this.startReload();
    // auto-reload shortly after running dry
    if (this.state === 'ready' && w.ammo === 0 && G.inv.ammo[w.cls] > 0 && now - this.lastShotT > 0.32 && now >= this.nextFire) {
      this.autoReloadT += dt;
      if (this.autoReloadT > 0.12) this.startReload();
    } else this.autoReloadT = 0;

    // ---- melee ----
    if (inp.pressed('melee') && (this.state === 'ready' || this.state === 'reload' || this.state === 'inspect') && this.lowerT <= 0) {
      this.state = 'melee';
      this.adsAmount = Math.min(this.adsAmount, 0.3);
      vm.play('melee', 0.05);
      this.sprintLock = 0.5;
    }

    // ---- mines ----
    if (inp.pressed('mine')) {
      if (G.inv.mines <= 0) G.hud.toast('NO CHARGES', 0.9);
      else if (this.state === 'ready' || this.state === 'inspect') {
        this.state = 'gesture';
        vm.play('throw', 0.06);
        this.sprintLock = 0.5;
      }
    }
    if (inp.pressed('detonate')) {
      if (G.mines.armedCount === 0) G.hud.toast('NO CHARGES PLANTED', 0.9);
      else if (this.state === 'ready' || this.state === 'inspect') {
        this.state = 'gesture';
        vm.play('watch', 0.06);
        this.sprintLock = 0.6;
      } else {
        // hands are busy: just squeeze
        G.audio.play('watch_beep', { vol: 0.7, bus: 'ui' });
        G.mines.detonateAll();
      }
    }

    if (inp.pressed('inspect') && this.state === 'ready' && !pl.sprinting) {
      this.state = 'inspect';
      vm.play('inspect', 0.12);
    }
    void busy;
  }

  // ------------------------------------------------------------------ firing

  private shoot(w: WeaponItem) {
    const pl = G.player;
    const vm = G.view;
    const now = G.time;

    let free = false;
    if (w.legend === 'double' && Math.random() < 0.2) free = true;
    if (!free) w.ammo--;
    this.lastShotT = now;
    this.nextFire = now + 1 / w.fireRate;

    pl.eyePos(_origin);
    pl.aimDir(_aim);
    _right.crossVectors(_aim, WORLD_UP).normalize();
    _up.crossVectors(_right, _aim).normalize();
    vm.socketWorld('muzzle', _muzzle);

    const spread = this.spread * DEG;
    let killed = false;
    let anyHit = false;
    let anyCrit = false;
    const color = w.element === 'none' ? 0xfff0a8 : ELEMENT_COLORS[w.element];
    for (let i = 0; i < w.pellets; i++) {
      // uniform disc inside the spread cone; the first shotgun pellet goes dead centre
      const r = w.pellets > 2 && i === 0 ? 0 : Math.tan(spread) * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      _dir.copy(_aim).addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
      const res = this.trace(w, _origin, _dir, _muzzle, color, 1);
      anyHit ||= res.hit;
      anyCrit ||= res.crit;
      killed ||= res.killed;
    }
    G.stats.shots++;
    if (anyHit) G.stats.hits++;
    if (killed && w.legend === 'refund') w.ammo = Math.min(w.magSize, w.ammo + 1);

    // ---- feedback ----
    const ads = this.adsAmount;
    const rec = w.recoil * lerp(1, 0.72, ads) * (pl.crouching ? 0.85 : 1);
    pl.addRecoil(rec * DEG * rand(0.85, 1.1), rec * DEG * rand(-0.45, 0.45));
    vm.fireKick();
    this.bloom = Math.min(4.5, this.bloom + BLOOM[w.cls]);
    if (w.cls === 'shotgun' || w.cls === 'sniper') pl.addTrauma(0.22);
    else pl.addTrauma(0.035);

    const last = w.ammo === 0 && vm.has('fireLast');
    const clipName: ClipName = last ? 'fireLast' : 'fire';
    const clip = vm.clips[clipName];
    if (clip) vm.play(clipName, 0.02, Math.max(1, clip.dur * w.fireRate * 1.04));

    const snd = w.cls + '_fire';
    G.audio.play(snd, { vol: 0.95, pitchVar: 0.035, pitch: w.brand === 'picket' ? 0.92 : w.brand === 'krona' ? 1.06 : 1, wet: 0.35 });
    if (w.element !== 'none') G.audio.play('zap_fire', { vol: 0.45, pitchVar: 0.05 });
    G.world.noise(pl.pos, w.cls === 'pistol' ? 45 : 65, 'gunshot', pl);
    G.hud.onShot();
  }

  /**
   * One hitscan ray: damage, tracer, impact effects and legendary riders.
   * `depth` limits chained effects (ricochets).
   */
  private trace(w: WeaponItem, origin: THREE.Vector3, dir: THREE.Vector3, tracerFrom: THREE.Vector3, color: number, depth: number) {
    const hit = G.world.hitscan(origin, dir, 420, G.player);
    const out = { hit: false, crit: false, killed: false };
    const end = hit ? hit.point : _v.copy(origin).addScaledVector(dir, 200);
    G.fx.tracer(tracerFrom, end, color, w.cls === 'sniper' ? 0.06 : w.cls === 'shotgun' ? 0.022 : 0.03);
    if (!hit) return out;
    if (hit.target) {
      const t = hit.target;
      const crit = hit.zone === 'head' || hit.zone === 'weak';
      const fall = hit.distance <= w.rangeNear ? 1 : lerp(1, w.rangeMin, clamp((hit.distance - w.rangeNear) / (w.rangeFar - w.rangeNear), 0, 1));
      let dmg = w.damage * fall;
      if (crit) dmg *= w.critMult * (w.legend === 'refund' ? 1.5 : 1);
      const wasAlive = t.alive;
      const info: DamageInfo = {
        amount: dmg,
        element: w.element,
        crit,
        kind: 'bullet',
        source: G.player,
        point: hit.point,
        dir,
        impulse: w.cls === 'shotgun' ? 1.6 : w.cls === 'sniper' ? 5 : 0.6,
        statusChance: w.statusChance,
        statusDps: w.statusDps,
        zone: hit.zone,
      };
      if (w.legend === 'tag') (t as any).taggedUntil = G.time + 5;
      t.takeDamage(info);
      out.hit = hostile('player', t.faction);
      out.crit = crit;
      out.killed = wasAlive && !t.alive;
      if (w.legend === 'ricochet' && depth > 0) {
        // jump to the nearest other enemy in sight
        const next = G.world.nearestHostile(hit.point, 'player', 9, t);
        if (next) {
          next.aimPoint(_v2);
          const d2 = _v2.clone().sub(hit.point).normalize();
          const o2 = hit.point.clone().addScaledVector(d2, 0.5);
          const half = { ...w, damage: w.damage * 0.5, legend: null } as WeaponItem;
          this.trace(half, o2, d2, hit.point, color, depth - 1);
        }
      }
    } else {
      G.fx.impact(hit.point, hit.normal, hit.surf, w.element);
      hit.onHit?.(w.damage, G.player);
    }
    if (w.legend === 'explosive') G.world.explode(hit.point, 2.4, w.damage * 0.8, G.player, { small: true, element: w.element });
    return out;
  }

  // ------------------------------------------------------------------ reload

  private startReload() {
    const w = this.cur;
    if (!w || this.state === 'reload') return;
    const vm = G.view;
    this.state = 'reload';
    this.reloadReady = false;
    this.reloadStartedEmpty = w.ammo === 0;
    this.shellInterrupt = false;
    this.adsAmount = Math.min(this.adsAmount, 0.4);
    if (w.cls === 'shotgun') {
      const sp = vm.clips.reloadShell!.dur / w.reloadTime;
      vm.play('reloadStart', 0.08, sp);
    } else {
      const name: ClipName = this.reloadStartedEmpty && vm.has('reloadEmpty') ? 'reloadEmpty' : 'reload';
      const sp = vm.clips.reload!.dur / w.reloadTime;
      vm.play(name, 0.08, sp);
    }
  }

  private onAnimEvent(type: string, arg: string | number | undefined) {
    const w = this.cur;
    const vm = G.view;
    switch (type) {
      case 'sfx':
        G.audio.play(String(arg), { vol: 0.75, pitchVar: 0.04 });
        break;
      case 'ammo': {
        if (!w) break;
        const need = w.magSize - w.ammo;
        const take = Math.min(need, G.inv.ammo[w.cls]);
        w.ammo += take;
        G.inv.ammo[w.cls] -= take;
        this.reloadReady = true;
        break;
      }
      case 'shell': {
        if (!w) break;
        if (G.inv.ammo[w.cls] > 0 && w.ammo < w.magSize) {
          w.ammo++;
          G.inv.ammo[w.cls]--;
        }
        break;
      }
      case 'eject': {
        if (!w) break;
        vm.socketWorld('eject', _v);
        const cam = G.camera;
        _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
        _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
        _v2.copy(G.player.vel).addScaledVector(_right, rand(1.6, 2.6)).addScaledVector(_up, rand(1.4, 2.4));
        G.fx.casing(_v, _v2, w.cls === 'shotgun' ? 'shell' : 'brass');
        break;
      }
      case 'hit':
        this.meleeHit();
        break;
      case 'throw':
        G.mines.throwMine();
        break;
      case 'detonate':
        G.mines.detonateAll();
        break;
    }
  }

  private onAnimEnd(clip: Clip) {
    const vm = G.view;
    const w = this.cur;
    switch (clip.name as ClipName) {
      case 'holster':
        if (this.wantHolster || this.holstered) {
          this.wantHolster = false;
          vm.setGun(null);
          this.state = 'none';
        } else if (this.pendingSlot >= 0) {
          G.inv.active = this.pendingSlot;
          this.equipActive();
        } else {
          vm.setGun(null);
          this.state = 'none';
        }
        return;
      case 'reloadStart':
        vm.play('reloadShell', 0.02, vm.anim.speed);
        return;
      case 'reloadShell':
        if (w && w.ammo < w.magSize && G.inv.ammo[w.cls] > 0 && !this.shellInterrupt) {
          vm.play('reloadShell', 0, vm.anim.speed);
          this.reloadReady = true;
        } else {
          vm.play(this.reloadStartedEmpty ? 'reloadEndPump' : 'reloadEnd', 0.02, 1.1);
          this.reloadReady = true;
        }
        return;
      case 'fireLast':
        // keep the final pose (slide locked back) – no idle clip
        return;
      case 'fire':
      case 'dry':
        if (this.state === 'ready') vm.play('idle', 0.06);
        return;
    }
    // everything else returns to the ready stance
    this.state = 'ready';
    vm.play('idle', 0.1);
  }

  private meleeHit() {
    const pl = G.player;
    const w = this.cur;
    pl.eyePos(_origin);
    pl.aimDir(_aim);
    const base = 42 * levelScale(w ? w.level : 1) * (1 + (w ? w.meleeBonus : 0));
    const t = G.world.meleeTarget(_origin, _aim, 2.5, 'player');
    if (t) {
      t.aimPoint(_v);
      t.takeDamage({ amount: base, element: 'none', crit: false, kind: 'melee', source: pl, point: _v.clone(), dir: _aim.clone(), impulse: 5 });
      G.audio.play('melee_hit', { vol: 0.9, pitchVar: 0.06 });
      pl.addTrauma(0.3);
      G.view.bump(1.2, -1.5);
      G.hud.hitmarker(false, !t.alive);
      return;
    }
    const hit = G.world.hitscan(_origin, _aim, 2.0, pl);
    if (hit && !hit.target) {
      G.fx.impact(hit.point, hit.normal, hit.surf, 'none');
      G.audio.play('melee_hit', { vol: 0.5, pitch: 1.2 });
      pl.addTrauma(0.15);
      hit.onHit?.(base, pl);
    }
  }
}
