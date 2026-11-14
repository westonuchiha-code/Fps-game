import * as THREE from 'three';
import { G } from '../core/globals';
import { clamp, damp, lerp, Spring, DEG, rand } from '../core/math';
import { LAYER_VIEW } from '../render/pipeline';
import { flat, ELEMENT_COLORS } from '../render/toon';
import { setLayer } from '../render/kit';
import { Animator, type Clip } from '../weapons/anim';
import { buildGun, handQuat, type GunRig } from '../weapons/gunModels';
import { clipsFor, type ClipName, type ClipSet } from '../weapons/clips';
import type { WeaponItem } from '../weapons/items';
import { Hand } from './arms';
import { P } from './player';

type V3 = [number, number, number];

interface PoseDef {
  p: V3;
  r: V3; // degrees
}

const SPRINT_POSE: Record<string, PoseDef> = {
  pistol: { p: [0.01, -0.05, 0.03], r: [-24, 14, 6] },
  rifle: { p: [-0.05, -0.035, 0.06], r: [-10, 40, 14] },
  shotgun: { p: [-0.05, -0.035, 0.06], r: [-10, 40, 14] },
  sniper: { p: [-0.05, -0.04, 0.07], r: [-9, 42, 14] },
};
const LOWER_POSE: PoseDef = { p: [0.03, -0.2, 0.07], r: [-40, 14, 12] };

/** recoil impulses per class: [back m/s, rise rad/s, roll rad/s, yaw rad/s] */
const KICK: Record<string, [number, number, number, number]> = {
  pistol: [1.5, 5.2, 1.4, 0.8],
  rifle: [0.85, 1.9, 0.9, 0.7],
  shotgun: [3.0, 7.5, 2.0, 1.2],
  sniper: [3.4, 6.5, 1.6, 1.0],
};

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p1 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

/** First-person arms + weapon: procedural sway/bob/recoil layered under keyframed clips. */
export class ViewModel {
  readonly root = new THREE.Group();
  private swayNode = new THREE.Group();
  private kickNode = new THREE.Group();
  private poseNode = new THREE.Group();
  readonly animRoot = new THREE.Group();
  readonly left = new Hand(-1);
  readonly right = new Hand(1);
  readonly anim = new Animator();
  rig: GunRig | null = null;
  item: WeaponItem | null = null;
  clips: ClipSet = {};
  /** FOV used to draw the viewmodel this frame */
  viewFov = 56;
  baseViewFov = 56;

  // pose weights, driven by the weapon controller
  ads = 0;
  sprint = 0;
  lower = 0;
  /** true while the scope overlay replaces the model */
  scopeView = false;

  private adsPos = new THREE.Vector3();
  private kz = new Spring(240, 24);
  private kx = new Spring(230, 22);
  private kroll = new Spring(200, 18);
  private kyaw = new Spring(200, 18);
  private swX = 0;
  private swY = 0;
  private swRoll = 0;
  private velY = 0;
  private flash: THREE.Group;
  private flashT = 0;
  private flashLight: THREE.PointLight;
  private extraSockets: THREE.Object3D[] = [];
  private watchCanvas: HTMLCanvasElement;
  private watchTex: THREE.CanvasTexture;
  private watchKey = '';
  private triggerPull = 0;

  constructor(scene: THREE.Scene) {
    this.root.add(this.swayNode);
    this.swayNode.add(this.kickNode);
    this.kickNode.add(this.poseNode);
    this.poseNode.add(this.animRoot);
    this.animRoot.add(this.left.root, this.right.root);
    this.anim.space = this.animRoot;
    this.anim.left = this.anim.makeHand(this.left.root);
    this.anim.right = this.anim.makeHand(this.right.root);
    this.left.elbow.set(-0.37, -0.48, 0.3);
    this.right.elbow.set(0.36, -0.46, 0.36);

    // view-space sockets shared by all guns (watch raise, mine throw)
    const mk = (name: string, pos: V3, fingers: V3, dorsal: V3) => {
      const o = new THREE.Object3D();
      o.name = name;
      o.position.set(pos[0], pos[1], pos[2]);
      handQuat(fingers, dorsal, o.quaternion);
      this.animRoot.add(o);
      this.extraSockets.push(o);
    };
    mk('watch', [0.02, -0.035, -0.3], [0.9, 0.42, -0.1], [0.05, 0.22, 1]);
    mk('throwBack', [-0.32, -0.16, 0.06], [0.2, 0.7, -0.7], [-0.8, 0.4, 0.3]);
    mk('throwFwd', [-0.1, -0.06, -0.44], [0.15, 0.25, -1], [-0.3, 1, 0.2]);

    // muzzle flash: three crossed cards, cel-style star
    this.flash = new THREE.Group();
    const fm = flat(0xfff2b0, { additive: true, side: THREE.DoubleSide, fog: false });
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const r = i % 2 === 0 ? 1 : 0.42;
      if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const sg = new THREE.ShapeGeometry(star);
    const front = new THREE.Mesh(sg, fm);
    this.flash.add(front);
    for (const a of [0, Math.PI / 2]) {
      const g = new THREE.PlaneGeometry(1.5, 0.7);
      g.translate(0.55, 0, 0);
      const card = new THREE.Mesh(g, fm);
      card.rotation.set(a, Math.PI / 2, 0, 'YXZ');
      this.flash.add(card);
    }
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xffd9a0, 0, 14, 1.6);
    this.flashLight.layers.enableAll();
    scene.add(this.flashLight);

    this.watchCanvas = document.createElement('canvas');
    this.watchCanvas.width = this.watchCanvas.height = 64;
    this.watchTex = new THREE.CanvasTexture(this.watchCanvas);
    this.watchTex.colorSpace = THREE.SRGBColorSpace;
    this.watchTex.magFilter = THREE.NearestFilter;
    if (this.left.watchScreen) this.left.watchScreen.material = flat(0xffffff, { map: this.watchTex });

    setLayer(this.root, LAYER_VIEW);
    scene.add(this.root);
    this.root.visible = false;
  }

  /** Redraw the tiny LCD on the wrist (mine count / armed state). */
  setWatch(mines: number, armed: number, alert = false) {
    const key = mines + '|' + armed + '|' + alert;
    if (key === this.watchKey) return;
    this.watchKey = key;
    const g = this.watchCanvas.getContext('2d')!;
    g.fillStyle = alert ? '#ff3b30' : armed > 0 ? '#ffb020' : '#8fe36a';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#0d1a0c';
    g.font = 'bold 30px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(alert ? 'BOOM' : String(mines).padStart(2, '0'), 32, alert ? 34 : 26);
    if (!alert) {
      g.font = 'bold 13px monospace';
      g.fillText(armed > 0 ? `ARM ${armed}` : 'SAFE', 32, 52);
    }
    this.watchTex.needsUpdate = true;
  }

  /** Swap the displayed gun. Pass null to show empty hands. */
  setGun(item: WeaponItem | null) {
    if (this.rig) {
      this.animRoot.remove(this.rig.root);
      this.rig.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      this.flash.removeFromParent();
    }
    this.anim.clearRig();
    this.item = item;
    this.rig = null;
    this.clips = {};
    if (!item) {
      this.root.visible = false;
      return;
    }
    const rig = buildGun(item);
    this.rig = rig;
    this.clips = clipsFor(item.cls);
    this.animRoot.add(rig.root);
    setLayer(rig.root, LAYER_VIEW);
    for (const name in rig.nodes) this.anim.addNode(name, rig.nodes[name]);
    for (const name in rig.sockets) this.anim.addSocket(name, rig.sockets[name]);
    for (const s of this.extraSockets) this.anim.addSocket(s.name, s);
    // aim pose: put the sight on the view axis
    rig.root.updateMatrixWorld(true);
    const sight = rig.sockets.sight.getWorldPosition(_v);
    rig.root.worldToLocal(sight);
    this.adsPos.set(-sight.x, -sight.y, -rig.adsDist - sight.z);
    // muzzle flash rides on the muzzle socket
    rig.sockets.muzzle.add(this.flash);
    this.flash.position.set(0, 0, -0.03);
    this.flash.rotation.set(0, Math.PI, 0);
    setLayer(this.flash, LAYER_VIEW);
    const el = item.element === 'none' ? 0xfff2b0 : ELEMENT_COLORS[item.element];
    this.flash.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = flat(el, { additive: true, side: THREE.DoubleSide, fog: false });
    });
    this.flashLight.color.setHex(item.element === 'none' ? 0xffd9a0 : ELEMENT_COLORS[item.element]);
    this.root.visible = true;
    this.kz.reset();
    this.kx.reset();
    this.kroll.reset();
    this.kyaw.reset();
    if (this.anim.left) this.anim.left.fresh = true;
    if (this.anim.right) this.anim.right.fresh = true;
  }

  play(name: ClipName, fade = 0.08, speed = 1, startTime = 0): Clip | null {
    const c = this.clips[name];
    if (!c) return null;
    this.anim.play(c, fade, startTime, speed);
    return c;
  }
  has(name: ClipName) {
    return !!this.clips[name];
  }
  get clipName(): ClipName | null {
    return (this.anim.clip?.name as ClipName) ?? null;
  }

  /** Visual recoil + muzzle flash for one shot. */
  fireKick(scale = 1) {
    if (!this.item) return;
    const kk = KICK[this.item.cls];
    const a = lerp(1, 0.5, this.ads) * scale;
    this.kz.kick(kk[0] * a);
    this.kx.kick(kk[1] * a);
    this.kroll.kick(kk[2] * rand(-1, 1) * a);
    this.kyaw.kick(kk[3] * rand(-1, 1) * a);
    this.flashT = 0.055;
    this.flash.visible = !this.scopeView;
    const s = (this.item.cls === 'shotgun' ? 0.16 : this.item.cls === 'sniper' ? 0.15 : this.item.cls === 'pistol' ? 0.085 : 0.1) * rand(0.8, 1.2);
    this.flash.scale.setScalar(s);
    this.flash.rotation.z = rand(0, Math.PI * 2);
    this.flashLight.intensity = 26;
    this.triggerPull = 1;
  }

  /** Small bump used by landing, mantling, melee impacts. */
  bump(z: number, rise: number) {
    this.kz.kick(z);
    this.kx.kick(rise);
  }

  /** World position of a socket, corrected for the viewmodel's narrower FOV so effects line up on screen. */
  socketWorld(name: string, out: THREE.Vector3) {
    const cam = G.camera;
    const s = this.rig?.sockets[name];
    if (!s) return cam.getWorldPosition(out);
    s.getWorldPosition(out);
    out.applyMatrix4(cam.matrixWorldInverse);
    const k = Math.tan((cam.fov * DEG) / 2) / Math.tan((this.viewFov * DEG) / 2);
    out.x *= k;
    out.y *= k;
    return out.applyMatrix4(cam.matrixWorld);
  }

  /** dev tools: pin the rig in the world instead of following the camera */
  debugAnchor: THREE.Object3D | null = null;

  update(dt: number) {
    const cam = this.debugAnchor ?? G.camera;
    this.root.position.copy(cam.position);
    this.root.quaternion.copy(cam.quaternion);
    if (!this.rig || !this.item) return;
    const pl = G.player;
    const inp = G.input;
    const calm = 1 - this.ads * 0.86;

    // ---- sway: the gun trails the view a little ----
    const idt = 1 / Math.max(dt, 1e-3);
    const tx = clamp(inp.lookY * idt * 0.011, -0.07, 0.07);
    const ty = clamp(inp.lookX * idt * 0.011, -0.085, 0.085);
    this.swX = damp(this.swX, tx, 9, dt);
    this.swY = damp(this.swY, ty, 9, dt);
    // strafing rolls the gun into the turn
    const side = -(pl.vel.x * Math.cos(pl.yaw) - pl.vel.z * Math.sin(pl.yaw));
    this.swRoll = damp(this.swRoll, clamp(side / P.sprint, -1, 1) * 0.07 + ty * 0.6, 8, dt);
    this.velY = damp(this.velY, clamp(pl.vel.y, -9, 9), 9, dt);

    const move = pl.moveAmount;
    const ph = pl.bobPhase;
    const runK = pl.sprinting ? 2.1 : 1;
    const bobX = Math.cos(ph) * 0.0055 * move * runK;
    const bobY = -Math.abs(Math.sin(ph)) * 0.0075 * move * runK + move * 0.003;
    const t = G.time;
    const breathe = Math.sin(t * 1.5) * 0.0014;

    this.swayNode.position.set((bobX - this.swY * 0.03) * calm, (bobY + breathe - this.velY * 0.0032 + pl.landSpring.x * 0.012 + this.swX * 0.02) * calm, 0);
    _e.set((this.swX + this.velY * 0.006 + Math.sin(t * 1.1) * 0.003) * calm, this.swY * calm, (this.swRoll + Math.cos(ph) * 0.014 * move * runK) * calm, 'YXZ');
    this.swayNode.quaternion.setFromEuler(_e);

    // ---- recoil springs ----
    this.kz.update(0, dt);
    this.kx.update(0, dt);
    this.kroll.update(0, dt);
    this.kyaw.update(0, dt);
    this.kickNode.position.set(0, this.kx.x * 0.012, this.kz.x);
    _e.set(this.kx.x, this.kyaw.x, this.kroll.x, 'YXZ');
    this.kickNode.quaternion.setFromEuler(_e);

    // ---- pose blend: hip -> sprint -> aim -> lowered ----
    const hip = this.rig.hip;
    const sp = SPRINT_POSE[this.item.cls];
    const crouch = pl.crouching && !pl.sliding ? 1 : 0;
    _p1.set(hip.x - crouch * 0.012, hip.y + crouch * 0.01, hip.z);
    _e.set(0, 0, crouch * -5 * DEG);
    _q1.setFromEuler(_e);
    if (pl.sliding) {
      _p1.x -= 0.03;
      _e.set(4 * DEG, 6 * DEG, 16 * DEG);
      _q1.setFromEuler(_e);
    }
    if (this.sprint > 0.001) {
      _v.set(hip.x + sp.p[0], hip.y + sp.p[1], hip.z + sp.p[2]);
      _p1.lerp(_v, this.sprint);
      _q.setFromEuler(_e.set(sp.r[0] * DEG, sp.r[1] * DEG, sp.r[2] * DEG, 'XYZ'));
      _q1.slerp(_q, this.sprint);
    }
    if (this.ads > 0.001) {
      const a = this.ads * this.ads * (3 - 2 * this.ads);
      _p1.lerp(this.adsPos, a);
      _q1.slerp(_q.identity(), a);
    }
    if (this.lower > 0.001) {
      _v.set(hip.x + LOWER_POSE.p[0], hip.y + LOWER_POSE.p[1], hip.z + LOWER_POSE.p[2]);
      _p1.lerp(_v, this.lower);
      _q.setFromEuler(_e.set(LOWER_POSE.r[0] * DEG, LOWER_POSE.r[1] * DEG, LOWER_POSE.r[2] * DEG, 'XYZ'));
      _q1.slerp(_q, this.lower);
    }
    this.poseNode.position.copy(_p1);
    this.poseNode.quaternion.copy(_q1);

    // aiming pulls the sight picture in a touch
    this.viewFov = lerp(this.baseViewFov, this.baseViewFov * 0.8, this.ads);

    // ---- keyframed clip + hands ----
    this.anim.update(dt);
    const lh = this.anim.left;
    const rh = this.anim.right;
    if (lh) this.left.pose = lh.pose;
    if (rh) this.right.pose = rh.pose;
    this.triggerPull = damp(this.triggerPull, 0, 16, dt);
    this.right.trigger = this.triggerPull;
    this.left.update(dt);
    this.right.update(dt);

    // ---- flash ----
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.visible = false;
    }
    this.flashLight.intensity = damp(this.flashLight.intensity, 0, 30, dt);
    if (this.flashLight.intensity > 0.05) this.socketWorld('muzzle', this.flashLight.position);

    // scoped rifles hide the model while looking through the glass
    this.scopeView = this.rig.scoped && this.ads > 0.9;
    this.root.visible = !this.scopeView;
  }
}
