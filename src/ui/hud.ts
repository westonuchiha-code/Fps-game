import * as THREE from 'three';
import './hud.css';
import { G } from '../core/globals';
import { clamp, damp, rand, angleDelta } from '../core/math';
import { RARITY_COLORS } from '../render/toon';
import type { Element } from '../core/types';
import type { Subtitle } from '../audio/audio';
import { hex, itemCardHTML } from './itemCard';
import type { Interactable } from '../world/world';

const el = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

interface DNum {
  el: HTMLElement;
  pos: THREE.Vector3;
  vx: number;
  vy: number;
  t: number;
  life: number;
  live: boolean;
}

interface Marker {
  el: HTMLElement;
  pos: THREE.Vector3;
  label: string;
}

const _v = new THREE.Vector3();

export class Hud {
  readonly root: HTMLElement;
  readonly layer: HTMLElement;
  private xhair: HTMLElement;
  private hitm: HTMLElement;
  private shieldBar: HTMLElement;
  private shieldGhost: HTMLElement;
  private healthBar: HTMLElement;
  private healthGhost: HTMLElement;
  private healthWrap: HTMLElement;
  private shieldWrap: HTMLElement;
  private hpNum: HTMLElement;
  private shNum: HTMLElement;
  private wname: HTMLElement;
  private count: HTMLElement;
  private slots: HTMLElement;
  private mines: HTMLElement;
  private objBox: HTMLElement;
  private toastEl: HTMLElement;
  private promptEl: HTMLElement;
  private promptKey: HTMLElement;
  private promptText: HTMLElement;
  private holdBar: HTMLElement;
  private focusCard: HTMLElement;
  private subs: HTMLElement;
  private feed: HTMLElement;
  private bossEl: HTMLElement;
  private bossBar: HTMLElement;
  private bossName: HTMLElement;
  private scope: HTMLElement;
  private letter: HTMLElement;
  private skipEl: HTMLElement;
  private titleEl: HTMLElement;
  private typedEl: HTMLElement;
  private vehEl: HTMLElement;
  private vehSpd: HTMLElement;
  private vehName: HTMLElement;
  private fadeEl: HTMLElement;
  private ammoBox: HTMLElement;
  private vitals: HTMLElement;
  private dmgDirs: { el: HTMLElement; t: number; pos: THREE.Vector3 }[] = [];
  private dnums: DNum[] = [];
  private markers: Marker[] = [];
  private toastT = 0;
  private gap = 10;
  private flashV = 0;
  private flashColor = new THREE.Color();
  private edge = 0;
  private lastKey = '';
  private focus: Interactable | null = null;
  private holdT = 0;
  private cardFor: unknown = null;
  private objKey = '';
  private boss: { name: string; get: () => number } | null = null;
  private typedTimer = 0;
  private subToken = 0;
  scoped = false;

  constructor(parent: HTMLElement) {
    this.root = el('div');
    this.root.id = 'hud';
    parent.appendChild(this.root);
    this.layer = el('div', 'layer');
    this.root.appendChild(this.layer);

    this.scope = el('div', 'scope', '<div class="ring"></div><div class="tick"></div>');
    this.root.appendChild(this.scope);

    this.xhair = el('div', 'xhair', '<i class="dot"></i><i class="l"></i><i class="r"></i><i class="u"></i><i class="d"></i>');
    this.hitm = el('div', 'hitm', '<i></i><i></i><i></i><i></i>');
    this.root.append(this.xhair, this.hitm);
    for (let i = 0; i < 4; i++) {
      const d = el('div', 'dmgdir');
      this.root.appendChild(d);
      this.dmgDirs.push({ el: d, t: 0, pos: new THREE.Vector3() });
    }

    this.vitals = el(
      'div',
      'vitals outline',
      `<div class="num"><span class="hp">100</span><span class="sh">0</span></div>
       <div class="bar shield"><em></em><b></b></div>
       <div class="bar health"><em></em><b></b></div>`,
    );
    this.root.appendChild(this.vitals);
    this.hpNum = this.vitals.querySelector('.hp')!;
    this.shNum = this.vitals.querySelector('.sh')!;
    this.shieldWrap = this.vitals.querySelector('.bar.shield')!;
    this.healthWrap = this.vitals.querySelector('.bar.health')!;
    this.shieldBar = this.shieldWrap.querySelector('b')!;
    this.shieldGhost = this.shieldWrap.querySelector('em')!;
    this.healthBar = this.healthWrap.querySelector('b')!;
    this.healthGhost = this.healthWrap.querySelector('em')!;

    this.ammoBox = el('div', 'ammo outline', `<div class="wname"></div><div class="count">0<small>0</small></div><div class="mines"></div><div class="slots"><span></span><span></span><span></span><span></span></div>`);
    this.root.appendChild(this.ammoBox);
    this.wname = this.ammoBox.querySelector('.wname')!;
    this.count = this.ammoBox.querySelector('.count')!;
    this.slots = this.ammoBox.querySelector('.slots')!;
    this.mines = this.ammoBox.querySelector('.mines')!;

    this.objBox = el('div', 'objectives outline');
    this.toastEl = el('div', 'toast outline');
    this.promptEl = el('div', 'prompt outline', '<span class="key"></span><span class="txt"></span><span class="hold"><b></b></span>');
    this.promptKey = this.promptEl.querySelector('.key')!;
    this.promptText = this.promptEl.querySelector('.txt')!;
    this.holdBar = this.promptEl.querySelector('.hold')!;
    this.focusCard = el('div', 'focuscard');
    this.subs = el('div', 'subs outline');
    this.feed = el('div', 'feed outline');
    this.bossEl = el('div', 'boss outline', '<div class="bname"></div><div class="bar"><em></em><b></b></div>');
    this.bossName = this.bossEl.querySelector('.bname')!;
    this.bossBar = this.bossEl.querySelector('b')!;
    this.vehEl = el('div', 'vehhud outline', '<div class="vn"></div><div class="spd">0<small>KM/H</small></div>');
    this.vehSpd = this.vehEl.querySelector('.spd')!;
    this.vehName = this.vehEl.querySelector('.vn')!;
    this.root.append(this.objBox, this.toastEl, this.promptEl, this.focusCard, this.feed, this.bossEl, this.vehEl);

    // these live outside #hud so they survive hiding the HUD in cutscenes
    this.letter = el('div', 'letterbox');
    this.letter.style.cssText = 'position:absolute;inset:0;';
    this.skipEl = el('div', 'skip outline');
    // clickable too (the cutscene polls the 'skip' action)
    this.skipEl.addEventListener('click', () => G.input.tap('skip'));
    this.titleEl = el('div', 'titlecard', '<div class="m"></div><div class="t"></div>');
    this.typedEl = el('div', 'typed');
    this.fadeEl = el('div', 'fade');
    parent.append(this.letter, this.titleEl, this.typedEl, this.subs, this.skipEl, this.fadeEl);
  }

  setVisible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  // ------------------------------------------------------------------ feedback

  toast(text: string, seconds = 1.6, color = '#fff') {
    this.toastEl.textContent = text;
    this.toastEl.style.color = color;
    this.toastEl.classList.add('show');
    this.toastT = seconds;
  }

  flash(color: number, amount: number) {
    this.flashColor.setHex(color);
    this.flashV = Math.max(this.flashV, amount);
  }

  hitmarker(crit: boolean, kill: boolean) {
    const h = this.hitm;
    h.className = 'hitm' + (kill ? ' kill' : crit ? ' crit' : '');
    void h.offsetWidth;
    h.classList.add('show');
    G.audio.play(kill ? 'kill_confirm' : crit ? 'hitmarker_crit' : 'hitmarker', { bus: 'ui', vol: kill ? 0.7 : 0.5, pitchVar: 0.04 });
  }

  onShot() {
    this.gap += 5;
  }

  /** Red (or blue for shield) arc pointing at where damage came from. */
  damageFrom(pos: THREE.Vector3, health: boolean) {
    let d = this.dmgDirs[0];
    for (const x of this.dmgDirs) if (x.t < d.t) d = x;
    d.pos.copy(pos);
    d.t = 1.2;
    d.el.classList.toggle('shield', !health);
    this.edge = Math.max(this.edge, health ? 0.55 : 0.25);
  }

  /** Floating Borderlands-style damage number at a world position. */
  damageNumber(pos: THREE.Vector3, amount: number, crit: boolean, element: Element, shield = false) {
    let d = this.dnums.find((x) => !x.live);
    if (!d) {
      if (this.dnums.length >= 28) {
        d = this.dnums[0];
        for (const x of this.dnums) if (x.t / x.life > d.t / d.life) d = x;
      } else {
        d = { el: el('div', 'dnum outline'), pos: new THREE.Vector3(), vx: 0, vy: 0, t: 0, life: 1, live: false };
        this.layer.appendChild(d.el);
        this.dnums.push(d);
      }
    }
    d.live = true;
    d.pos.copy(pos);
    d.vx = rand(-60, 60);
    d.vy = rand(-150, -90);
    d.t = 0;
    d.life = crit ? 0.95 : 0.75;
    d.el.textContent = String(Math.max(1, Math.round(amount))) + (crit ? '!' : '');
    d.el.className = 'dnum outline' + (crit ? ' crit' : '') + (shield ? ' shield' : element !== 'none' ? ' ' + element : '');
    d.el.style.display = '';
  }

  feedLine(html: string) {
    const d = el('div', '', html);
    this.feed.appendChild(d);
    while (this.feed.children.length > 6) this.feed.firstElementChild!.remove();
    setTimeout(() => d.remove(), 3300);
  }

  // ------------------------------------------------------------------ state setters

  setScope(on: boolean) {
    if (on === this.scoped) return;
    this.scoped = on;
    this.scope.classList.toggle('show', on);
  }

  setObjectives(title: string, list: { text: string; done: boolean }[], fresh = -1) {
    const key = title + '|' + list.map((o) => o.text + (o.done ? '1' : '0')).join('|');
    if (key === this.objKey) return;
    this.objKey = key;
    this.objBox.innerHTML = `<div class="title">${title}</div>` + list.map((o, i) => `<div class="obj${o.done ? ' done' : ''}${i === fresh ? ' new' : ''}">${o.text}</div>`).join('');
  }

  setBoss(name: string | null, get?: () => number) {
    this.boss = name && get ? { name, get } : null;
    this.bossEl.classList.toggle('show', !!this.boss);
    if (this.boss) this.bossName.textContent = name!.toUpperCase();
  }

  subtitle(s: Subtitle | null) {
    const token = ++this.subToken;
    if (!s) {
      this.subs.classList.remove('show');
      return;
    }
    this.subs.innerHTML = `<span class="who" style="color:${s.color}">${s.name.toUpperCase()}</span><span class="line">${s.text}</span>`;
    this.subs.classList.add('show');
    // barks have no explicit "end" callback: hide after their duration
    setTimeout(() => {
      if (this.subToken === token) this.subs.classList.remove('show');
    }, s.dur * 1000 + 400);
  }

  letterbox(on: boolean, skippable = false) {
    this.letter.classList.toggle('on', on);
    this.skipEl.classList.toggle('show', on && skippable);
    if (on && skippable) this.skipEl.innerHTML = `<span class="key">${G.input.prompt('skip')}</span> SKIP`;
  }

  titleCard(mission: string, title: string, seconds = 3.5) {
    this.titleEl.querySelector('.m')!.textContent = mission;
    this.titleEl.querySelector('.t')!.textContent = title;
    this.titleEl.classList.add('show');
    setTimeout(() => this.titleEl.classList.remove('show'), seconds * 1000);
  }

  /** Typewriter caption (location / time stamp). */
  typed(text: string, hold = 2.5) {
    clearInterval(this.typedTimer);
    this.typedEl.textContent = '';
    let i = 0;
    this.typedTimer = window.setInterval(() => {
      i++;
      this.typedEl.textContent = text.slice(0, i);
      if (text[i - 1] && text[i - 1] !== ' ' && text[i - 1] !== '\n') G.audio.play('typewriter', { bus: 'ui', vol: 0.3, pitchVar: 0.08 });
      if (i >= text.length) {
        clearInterval(this.typedTimer);
        this.typedTimer = window.setTimeout(() => (this.typedEl.textContent = ''), hold * 1000);
      }
    }, 38);
  }
  clearTyped() {
    clearInterval(this.typedTimer);
    clearTimeout(this.typedTimer);
    this.typedEl.textContent = '';
    this.titleEl.classList.remove('show');
  }

  fade(on: boolean, seconds = 0.6) {
    this.fadeEl.style.transitionDuration = seconds + 's';
    this.fadeEl.classList.toggle('on', on);
    return new Promise<void>((r) => setTimeout(r, seconds * 1000));
  }

  setVehicle(name: string | null, kmh = 0) {
    this.vehEl.classList.toggle('show', !!name);
    if (name) {
      if (this.vehName.textContent !== name) this.vehName.textContent = name;
      this.vehSpd.firstChild!.textContent = String(Math.round(kmh));
    }
  }

  addMarker(pos: THREE.Vector3, label: string, cls = '') {
    const m: Marker = { el: el('div', 'marker outline ' + cls, `<i></i>${label}`), pos, label };
    this.layer.appendChild(m.el);
    this.markers.push(m);
    return m;
  }
  removeMarker(m: Marker | null) {
    if (!m) return;
    m.el.remove();
    const i = this.markers.indexOf(m);
    if (i >= 0) this.markers.splice(i, 1);
  }
  clearMarkers() {
    for (const m of this.markers) m.el.remove();
    this.markers.length = 0;
  }

  // ------------------------------------------------------------------ interaction focus

  /** Set by the game each frame: the interactable under the crosshair (or null). */
  setFocus(f: Interactable | null, dt: number) {
    const inp = G.input;
    if (f !== this.focus) {
      this.focus = f;
      this.holdT = 0;
    }
    if (!f) {
      this.promptEl.classList.remove('show');
      this.focusCard.classList.remove('show');
      this.cardFor = null;
      return;
    }
    this.promptEl.classList.add('show');
    this.promptKey.textContent = inp.prompt('interact');
    const label = f.label();
    if (this.promptText.textContent !== label) this.promptText.textContent = label;
    if (f.item) {
      if (this.cardFor !== f.item) {
        this.cardFor = f.item;
        const cmp = f.item.kind === 'weapon' ? G.inv.current : G.inv.shield;
        this.focusCard.innerHTML = itemCardHTML(f.item, cmp, { hint: `TAP <b>${inp.prompt('interact')}</b> TAKE · HOLD <b>${inp.prompt('interact')}</b> EQUIP` });
      }
      this.focusCard.classList.add('show');
    } else {
      this.focusCard.classList.remove('show');
      this.cardFor = null;
    }
    // tap vs hold
    const holdTime = f.hold ?? (f.item ? 0.32 : 0);
    this.holdBar.style.display = holdTime > 0 && this.holdT > 0.08 ? 'block' : 'none';
    if (inp.isDown('interact')) {
      this.holdT += dt;
      if (holdTime > 0) {
        (this.holdBar.firstElementChild as HTMLElement).style.width = clamp(this.holdT / holdTime, 0, 1) * 100 + '%';
        if (this.holdT >= holdTime && this.holdT - dt < holdTime) {
          f.onUse(true);
          this.holdT = 99;
        }
      } else if (inp.pressed('interact')) f.onUse(false);
    } else {
      if (holdTime > 0 && this.holdT > 0 && this.holdT < holdTime) {
        if (f.item) f.onUse(false); // tap = take
      }
      this.holdT = 0;
    }
  }

  // ------------------------------------------------------------------ per-frame

  update(dt: number) {
    const pl = G.player;
    const w = G.weapons;
    const inv = G.inv;
    const cam = G.camera;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // crosshair gap follows the real spread cone
    const pxPerDeg = vh / cam.fov;
    const target = clamp(w.spread * pxPerDeg + 4, 5, 90);
    this.gap = damp(this.gap, target, 16, dt);
    this.xhair.style.setProperty('--gap', this.gap.toFixed(1) + 'px');
    const cur = w.cur;
    const hideX = !pl.alive || pl.frozen || !!pl.vehicle || !cur || w.adsAmount > 0.55 || w.state === 'none';
    this.xhair.style.opacity = hideX ? '0' : pl.sprinting ? '0.35' : '1';

    // vitals
    const hp = clamp(pl.health / pl.maxHealth, 0, 1);
    const sh = pl.shieldMax > 0 ? clamp(pl.shield / pl.shieldMax, 0, 1) : 0;
    this.healthBar.style.transform = `scaleX(${hp})`;
    this.healthGhost.style.transform = `scaleX(${hp})`;
    this.shieldBar.style.transform = `scaleX(${sh})`;
    this.shieldGhost.style.transform = `scaleX(${sh})`;
    this.healthWrap.classList.toggle('low', hp < 0.3);
    this.shieldWrap.style.visibility = pl.shieldMax > 0 ? 'visible' : 'hidden';
    const key = `${Math.ceil(pl.health)}|${Math.ceil(pl.shield)}|${cur?.uid}|${cur?.ammo}|${cur ? inv.ammo[cur.cls] : 0}|${inv.mines}|${G.mines.armedCount}|${inv.active}|${inv.slots.map((s) => s?.uid ?? 0).join(',')}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.hpNum.textContent = String(Math.ceil(pl.health));
      this.shNum.textContent = pl.shieldMax > 0 ? '⛨ ' + Math.ceil(pl.shield) : '';
      if (cur) {
        this.wname.textContent = cur.name;
        this.wname.style.color = hex(RARITY_COLORS[cur.rarity]);
        this.count.innerHTML = `${cur.ammo}<small>${inv.ammo[cur.cls]}</small>`;
        this.count.classList.toggle('low', cur.ammo <= Math.max(1, Math.floor(cur.magSize * 0.25)));
      } else {
        this.wname.textContent = '';
        this.count.innerHTML = '';
      }
      const armed = G.mines.armedCount;
      this.mines.innerHTML = `CHARGES <b>${inv.mines}</b>${armed ? `<span class="armed">● ${armed} PLANTED</span>` : ''}`;
      const spans = this.slots.children;
      for (let i = 0; i < 4; i++) {
        const s = spans[i] as HTMLElement;
        const it = inv.slots[i];
        s.className = (it ? 'has' : '') + (i === inv.active && it ? ' on' : '');
        if (it) s.style.setProperty('--c', hex(RARITY_COLORS[it.rarity]));
      }
    }
    this.ammoBox.style.visibility = pl.vehicle ? 'hidden' : 'visible';

    // toast
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastEl.classList.remove('show');
    }

    // damage direction arcs
    for (const d of this.dmgDirs) {
      if (d.t <= 0) continue;
      d.t -= dt;
      const ang = Math.atan2(-(d.pos.x - pl.pos.x), -(d.pos.z - pl.pos.z));
      const rel = angleDelta(pl.yaw, ang);
      d.el.style.opacity = String(clamp(d.t, 0, 1));
      d.el.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
      if (d.t <= 0) d.el.style.opacity = '0';
    }

    // damage numbers
    for (const d of this.dnums) {
      if (!d.live) continue;
      d.t += dt;
      if (d.t >= d.life) {
        d.live = false;
        d.el.style.display = 'none';
        continue;
      }
      _v.copy(d.pos).project(cam);
      if (_v.z > 1) {
        d.el.style.display = 'none';
        continue;
      }
      d.el.style.display = '';
      const u = d.t / d.life;
      d.vy += 420 * dt;
      const x = ((_v.x + 1) / 2) * vw + d.vx * d.t;
      const y = ((1 - _v.y) / 2) * vh + d.vy * d.t * 0.5 - 20;
      const sc = u < 0.12 ? 0.6 + (u / 0.12) * 0.7 : 1.3 - Math.min(0.3, (u - 0.12) * 0.6);
      d.el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(0)}px,${y.toFixed(0)}px) scale(${sc.toFixed(2)})`;
      d.el.style.opacity = String(u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1);
    }

    // objective markers
    for (const m of this.markers) {
      _v.copy(m.pos).project(cam);
      const behind = _v.z > 1;
      let x = ((_v.x + 1) / 2) * vw;
      let y = ((1 - _v.y) / 2) * vh;
      if (behind) {
        x = vw - x;
        y = vh - 40;
      }
      x = clamp(x, 40, vw - 40);
      y = clamp(y, 60, vh - 110);
      const dist = Math.round(m.pos.distanceTo(pl.pos));
      const txt = `${m.label} ${dist}m`;
      if (m.el.lastChild && m.el.lastChild.nodeType === 3 && m.el.lastChild.textContent !== txt) m.el.lastChild.textContent = txt;
      m.el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(0)}px,${y.toFixed(0)}px)`;
    }

    if (this.boss) this.bossBar.style.transform = `scaleX(${clamp(this.boss.get(), 0, 1)})`;

    // post-process overlays
    const u = G.pipe.post.uniforms;
    this.flashV = Math.max(0, this.flashV - dt * 2.2);
    u.uFlash.value = this.flashV;
    (u.uFlashColor.value as THREE.Color).copy(this.flashColor);
    this.edge = Math.max(0, this.edge - dt * 1.4);
    const low = pl.alive && hp < 0.3 ? 0.22 + Math.sin(G.time * 6) * 0.07 : 0;
    u.uEdge.value = Math.max(this.edge, low);
    u.uDesat.value = damp(u.uDesat.value, !pl.alive ? 0.85 : hp < 0.3 ? 0.45 : 0, 4, dt);
    this.gap = Math.min(this.gap, 120);
  }
}
