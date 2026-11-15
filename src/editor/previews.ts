// One preview object in the editor scene per level object.
// Static shapes and props are built with the game's own GeoBuilder (exact WYSIWYG); gameplay objects
// get recognisable low-poly stand-ins; logic volumes are translucent colour-coded boxes.
// Every preview is built around the origin and placed with its root transform, so moving or rotating
// an object never rebuilds geometry - only edits to size / material / colour / kind do.
import * as THREE from 'three';
import { GeoBuilder } from '../world/builder';
import { emitShape } from '../world/shapes';
import { buildProp, PROPS } from '../world/props';
import { hexToNum, type LObject, type LevelData } from '../world/leveldata';
import { Kit } from '../render/kit';
import { PAL, RARITY_COLORS, flat } from '../render/toon';
import { LAYER_FX, LAYER_WORLD } from '../render/pipeline';
import { ENEMY_KINDS, PICKUP_KINDS, SPAWN_ID, VOLUME_TYPES, displayName, enemyInfo, rotAxes } from './defs';

const noRaycast = () => {};
const lineMats = new Map<string, THREE.LineBasicMaterial>();
export function lineMat(color: number, opacity = 1, depthTest = true) {
  const k = color + '|' + opacity + '|' + depthTest;
  let m = lineMats.get(k);
  if (!m) {
    m = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest, fog: false });
    lineMats.set(k, m);
  }
  return m;
}

// ---- cached placeholder geometry ----------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: (k: Kit) => void) {
  let g = geoCache.get(key);
  if (!g) {
    const k = new Kit();
    make(k);
    g = k.geometry();
    g.userData.shared = true;
    geoCache.set(key, g);
  }
  return g;
}

function smileFace(k: Kit, y: number, z: number, w: number, color: number = PAL.smile) {
  k.box(w * 0.16, w * 0.16, 0.02, color, [-w * 0.22, y + w * 0.12, z]);
  k.box(w * 0.16, w * 0.16, 0.02, color, [w * 0.22, y + w * 0.12, z]);
  k.box(w * 0.6, w * 0.09, 0.02, color, [0, y - w * 0.14, z]);
  k.box(w * 0.12, w * 0.09, 0.02, color, [-w * 0.3, y - w * 0.08, z]);
  k.box(w * 0.12, w * 0.09, 0.02, color, [w * 0.3, y - w * 0.08, z]);
}

function humanoid(k: Kit, c: { legs: number; torso: number; arms: number; head: number; screen?: boolean; hat?: number; vest?: number; s?: number; gun?: boolean }) {
  const s = c.s ?? 1;
  k.push([0, 0, 0], [0, 0, 0], s);
  k.box(0.2, 0.85, 0.22, c.legs, [-0.14, 0.425, 0]);
  k.box(0.2, 0.85, 0.22, c.legs, [0.14, 0.425, 0]);
  k.box(0.5, 0.2, 0.3, c.legs, [0, 0.93, 0]);
  k.taper(0.6, 0.62, 0.36, 1.1, 1.05, c.torso, [0, 1.33, 0]);
  if (c.vest !== undefined) {
    k.box(0.64, 0.42, 0.04, c.vest, [0, 1.3, -0.19]);
    k.box(0.64, 0.42, 0.04, c.vest, [0, 1.3, 0.19]);
    k.box(0.66, 0.06, 0.05, 0xe8e8e8, [0, 1.36, -0.2]);
  }
  k.box(0.16, 0.6, 0.18, c.arms, [-0.42, 1.3, -0.05], [0.3, 0, 0]);
  k.box(0.16, 0.6, 0.18, c.arms, [0.42, 1.3, -0.05], [0.3, 0, 0]);
  if (c.screen) {
    k.box(0.5, 0.38, 0.36, PAL.screen, [0, 1.86, 0]);
    k.box(0.54, 0.05, 0.4, c.torso, [0, 2.06, 0]);
    smileFace(k, 1.86, -0.185, 0.36);
  } else {
    k.box(0.32, 0.36, 0.32, c.head, [0, 1.84, 0]);
    k.box(0.36, 0.06, 0.04, PAL.ink, [0, 1.88, -0.17]);
  }
  if (c.hat !== undefined) {
    k.box(0.4, 0.14, 0.4, c.hat, [0, 2.07, 0]);
    k.box(0.46, 0.03, 0.5, c.hat, [0, 2.0, -0.04]);
  }
  if (c.gun !== false) {
    k.box(0.09, 0.14, 0.72, 0x2a2c34, [0.24, 1.18, -0.42]);
    k.box(0.06, 0.16, 0.08, 0x2a2c34, [0.24, 1.06, -0.2]);
  }
  k.pop();
}

function enemyGeo(kind: string) {
  return cached('enemy:' + kind, (k) => {
    if (kind === 'drone') {
      k.cyl(0.46, 0.4, 0.24, PAL.shell, [0, 1.85, 0], 'y', 10, false);
      k.cyl(0.3, 0.3, 0.12, PAL.smile, [0, 2.02, 0], 'y', 10, false);
      k.box(0.44, 0.3, 0.1, PAL.screen, [0, 1.8, -0.4]);
      smileFace(k, 1.8, -0.455, 0.3);
      for (const [x, z] of [[0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]]) {
        k.box(0.5, 0.05, 0.08, PAL.mgmt, [x / 2, 1.9, z / 2], [0, Math.atan2(-z, x), 0]);
        k.cyl(0.26, 0.26, 0.04, PAL.mgmt, [x, 1.95, z], 'y', 8, false);
      }
      k.box(0.08, 0.1, 0.4, 0x2a2c34, [0, 1.66, -0.2]);
    } else if (kind === 'manager') {
      k.box(0.5, 1.4, 0.6, PAL.mgmt, [-0.55, 0.7, 0]);
      k.box(0.5, 1.4, 0.6, PAL.mgmt, [0.55, 0.7, 0]);
      k.box(0.7, 0.2, 0.9, PAL.gold, [-0.55, 0.1, -0.1]);
      k.box(0.7, 0.2, 0.9, PAL.gold, [0.55, 0.1, -0.1]);
      k.taper(1.7, 1.1, 1.1, 1.08, 1, PAL.mgmt, [0, 2.0, 0]);
      k.box(1.74, 0.12, 1.14, PAL.gold, [0, 1.65, 0]);
      k.box(0.6, 0.6, 0.2, PAL.hivis, [0, 2.05, 0.6]);
      k.box(0.8, 0.52, 0.55, PAL.screen, [0, 2.86, -0.1]);
      smileFace(k, 2.86, -0.38, 0.5);
      k.cyl(0.2, 0.2, 1.5, 0x2a2c34, [1.05, 1.95, -0.45], 'z', 8, false);
      k.box(0.5, 0.5, 0.6, PAL.mgmt, [1.05, 1.95, 0.1]);
      k.box(0.4, 0.9, 0.5, PAL.mgmt, [-1.05, 1.8, 0]);
    } else if (kind === 'super') {
      humanoid(k, { legs: PAL.mgmt, torso: PAL.shell, arms: PAL.shellDark, head: 0, screen: true, s: 1.06 });
      k.box(0.32, 0.16, 0.42, PAL.gold, [-0.42, 1.58 * 1.06, 0]);
      k.box(0.32, 0.16, 0.42, PAL.gold, [0.42, 1.58 * 1.06, 0]);
      k.box(0.3, 0.26, 0.04, PAL.shock, [0, 1.42, -0.21]);
    } else {
      humanoid(k, { legs: PAL.shellDark, torso: PAL.shell, arms: PAL.shell, head: 0, screen: true });
    }
  });
}

function allyGeo(voice: string) {
  return cached('ally:' + voice, (k) => {
    if (voice === 'dutch') humanoid(k, { legs: PAL.denim, torso: PAL.denim, arms: PAL.skin2, head: PAL.skin2, hat: PAL.smile, vest: PAL.hivis });
    else if (voice === 'hank') humanoid(k, { legs: PAL.denim, torso: PAL.rust, arms: PAL.rust, head: PAL.skin1, hat: PAL.cWhite, vest: PAL.hivis });
    else humanoid(k, { legs: PAL.denim, torso: PAL.hivis, arms: PAL.skin1, head: PAL.skin1, hat: PAL.smile });
  });
}

const spawnGeo = () =>
  cached('spawn', (k) => {
    humanoid(k, { legs: PAL.tux, torso: PAL.tux, arms: PAL.tux, head: PAL.skin1, vest: PAL.hivis, gun: false });
    k.box(0.1, 0.24, 0.02, PAL.shirt, [0, 1.48, -0.2]);
    k.box(0.16, 0.12, 0.18, 0x1c1d24, [0.44, 1.02, -0.18]);
    k.box(0.1, 0.06, 0.12, PAL.smile, [0.44, 1.02, -0.28]);
  });

function pickupGeo(kind: string) {
  return cached('pickup:' + kind, (k) => {
    if (kind === 'health') {
      k.box(0.46, 0.3, 0.32, PAL.shirt, [0, 0.15, 0]);
      k.box(0.24, 0.07, 0.02, PAL.cRed, [0, 0.17, -0.17]);
      k.box(0.07, 0.24, 0.02, PAL.cRed, [0, 0.17, -0.17]);
      k.box(0.24, 0.02, 0.07, PAL.cRed, [0, 0.31, 0]);
      k.box(0.07, 0.02, 0.24, PAL.cRed, [0, 0.31, 0]);
    } else if (kind === 'mine') {
      k.cyl(0.2, 0.2, 0.08, 0x2a2c34, [-0.12, 0.04, 0], 'y', 8, false);
      k.cyl(0.2, 0.2, 0.08, 0x2a2c34, [0.16, 0.04, 0.05], 'y', 8, false);
      k.box(0.07, 0.04, 0.07, 0xff3020, [-0.12, 0.1, 0]);
      k.box(0.07, 0.04, 0.07, 0xff3020, [0.16, 0.1, 0.05]);
    } else if (kind === 'cash') {
      for (let i = 0; i < 3; i++) k.box(0.36, 0.08, 0.18, 0x5fae4c, [0, 0.04 + i * 0.09, 0], [0, i * 0.3, 0]);
      k.box(0.1, 0.09, 0.19, PAL.smile, [0, 0.13, 0]);
    } else {
      k.box(0.48, 0.28, 0.3, 0x6b6b3a, [0, 0.14, 0]);
      k.box(0.5, 0.06, 0.32, PAL.smile, [0, 0.2, 0]);
      k.box(0.06, 0.08, 0.04, 0x2a2c34, [0.16, 0.32, 0]);
      k.box(0.06, 0.08, 0.04, 0x2a2c34, [-0.16, 0.32, 0]);
    }
  });
}

function weaponGeo(rarity: number | undefined, shield: boolean | undefined) {
  return cached('weapon:' + (rarity ?? '-') + ':' + (shield ? 1 : 0), (k) => {
    const c = rarity === undefined ? 0xd8d8d8 : RARITY_COLORS[rarity] ?? 0xd8d8d8;
    k.box(0.5, 0.04, 0.5, 0x2a2c34, [0, 0.02, 0]);
    if (shield) {
      k.cyl(0.32, 0.32, 0.06, PAL.shock, [0, 0.42, 0], 'z', 6, false);
      k.cyl(0.22, 0.22, 0.08, c, [0, 0.42, 0], 'z', 6, false);
    } else {
      k.box(0.12, 0.16, 0.5, c, [0, 0.36, 0]);
      k.cyl(0.035, 0.035, 0.4, 0x2a2c34, [0, 0.39, -0.42], 'z', 6, false);
      k.box(0.08, 0.18, 0.1, 0x2a2c34, [0, 0.22, 0.08], [-0.3, 0, 0]);
      k.box(0.09, 0.14, 0.24, 0x2a2c34, [0, 0.33, 0.33]);
      k.box(0.06, 0.06, 0.12, PAL.smile, [0, 0.47, -0.05]);
    }
  });
}

const lockerGeo = () =>
  cached('locker', (k) => {
    k.box(0.9, 2.0, 0.6, PAL.steel, [0, 1.0, 0]);
    k.box(0.4, 1.86, 0.03, PAL.steelDark, [-0.21, 1.0, -0.31]);
    k.box(0.4, 1.86, 0.03, PAL.steelDark, [0.21, 1.0, -0.31]);
    k.box(0.36, 0.36, 0.03, PAL.smile, [0, 1.5, -0.33]);
    smileFace(k, 1.5, -0.35, 0.26, PAL.ink);
    for (let i = 0; i < 4; i++) k.box(0.3, 0.03, 0.02, PAL.ink, [-0.21, 0.5 + i * 0.08, -0.33]);
  });

const barrelGeo = () =>
  cached('barrel', (k) => {
    k.cyl(0.31, 0.31, 0.92, 0xc8402a, [0, 0.46, 0], 'y', 10);
    k.cyl(0.325, 0.325, 0.05, 0x7a2418, [0, 0.3, 0], 'y', 10);
    k.cyl(0.325, 0.325, 0.05, 0x7a2418, [0, 0.64, 0], 'y', 10);
    k.box(0.3, 0.26, 0.02, PAL.smile, [0, 0.47, 0.31]);
    k.box(0.3, 0.26, 0.02, PAL.smile, [0, 0.47, -0.31]);
    k.box(0.1, 0.16, 0.025, PAL.screen, [0, 0.47, 0.31]);
    k.box(0.1, 0.16, 0.025, PAL.screen, [0, 0.47, -0.31]);
    k.cyl(0.05, 0.05, 0.04, 0x2a2c34, [0.14, 0.94, 0], 'y', 6);
  });

function vehicleGeo(kind: string) {
  return cached('vehicle:' + kind, (k) => {
    if (kind === 'vesper') {
      k.box(0.6, 0.36, 1.7, PAL.cTeal, [0, 0.7, 0]);
      k.box(0.5, 0.14, 0.7, PAL.mgmt, [0, 0.95, 0.35]);
      k.box(0.4, 0.5, 0.3, PAL.cTeal, [0, 0.95, -0.6]);
      k.box(0.7, 0.06, 0.06, PAL.ink, [0, 1.25, -0.65]);
      k.box(0.24, 0.12, 0.04, PAL.smile, [0, 0.95, -0.76]);
      k.cyl(0.32, 0.32, 0.1, PAL.shock, [0, 0.45, -0.55], 'y', 8, false);
      k.cyl(0.32, 0.32, 0.1, PAL.shock, [0, 0.45, 0.55], 'y', 8, false);
    } else {
      k.box(2.0, 0.55, 4.6, PAL.rust, [0, 0.85, 0]);
      k.box(1.9, 0.85, 1.7, PAL.hivis, [0, 1.55, -0.55]);
      k.box(1.7, 0.45, 0.06, PAL.glass, [0, 1.65, -1.42]);
      k.box(2.0, 0.4, 0.08, PAL.rust, [0, 1.3, 2.26]);
      k.box(0.08, 0.4, 2.0, PAL.rust, [0.96, 1.3, 1.3]);
      k.box(0.08, 0.4, 2.0, PAL.rust, [-0.96, 1.3, 1.3]);
      k.box(1.6, 0.25, 0.1, 0x2a2c34, [0, 0.8, -2.33]);
      for (const [x, z] of [[1.0, 1.5], [-1.0, 1.5], [1.0, -1.5], [-1.0, -1.5]]) {
        k.cyl(0.46, 0.46, 0.36, 0x1c1d24, [x, 0.46, z], 'x', 10, false);
        k.cyl(0.24, 0.24, 0.38, 0x8d949c, [x, 0.46, z], 'x', 8, false);
      }
    }
  });
}

const markerGeo = () =>
  cached('marker', (k) => {
    k.cyl(0.04, 0.04, 2.0, PAL.ink, [0, 1.0, 0], 'y', 6, false);
    k.sphere(0.22, 0xff4fd8, [0, 2.1, 0], 1);
    k.cyl(0.0, 0.16, 0.3, 0xff4fd8, [0, 0.15, 0], 'y', 6, false);
  });

const unknownGeo = () =>
  cached('unknown', (k) => {
    k.box(1, 1, 1, 0xff00ff, [0, 0.5, 0]);
  });

function placeholder(geo: THREE.BufferGeometry) {
  const m = new THREE.Mesh(geo, toonVC());
  m.castShadow = m.receiveShadow = true;
  return m;
}
let _toonVC: THREE.Material | null = null;
function toonVC() {
  if (!_toonVC) _toonVC = new Kit().mesh().material as THREE.Material;
  return _toonVC;
}

// ---- helper shapes (FX layer: never inked) ------------------------------------------------------

function ring(r: number, color: number, dashed = false) {
  const pts: THREE.Vector3[] = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0.04, Math.sin(a) * r));
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const l = dashed ? new THREE.LineSegments(g, lineMat(color)) : new THREE.Line(g, lineMat(color));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 32).rotateX(-Math.PI / 2).translate(0, 0.03, 0), flat(color, { transparent: true, opacity: 0.18, depthWrite: false, fog: false }));
  const grp = new THREE.Group();
  grp.add(disc, l);
  return grp;
}

function arrow(len: number, width: number, color: number) {
  const s = new THREE.Shape();
  const hw = width / 2;
  s.moveTo(-hw * 0.4, 0);
  s.lineTo(hw * 0.4, 0);
  s.lineTo(hw * 0.4, -len * 0.6);
  s.lineTo(hw, -len * 0.6);
  s.lineTo(0, -len);
  s.lineTo(-hw, -len * 0.6);
  s.lineTo(-hw * 0.4, -len * 0.6);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  // shape is in XY with -Y forward; lay it on the ground pointing -Z
  g.rotateX(Math.PI / 2);
  g.translate(0, 0.06, 0);
  return new THREE.Mesh(g, flat(color, { transparent: true, opacity: 0.85, depthWrite: false, fog: false, side: THREE.DoubleSide }));
}

const VOLUME_COLORS: Record<string, number> = { trigger: 0xffd21f, checkpoint: 0x3ddc5a, nav: 0x53c7ff };

// ---- preview ------------------------------------------------------------------------------------

export class Preview {
  readonly root = new THREE.Group();
  body: THREE.Object3D = new THREE.Group();
  helpers = new THREE.Group();
  key = '';
  /** local bounds of the body */
  readonly bbox = new THREE.Box3();
  label = '';
  sub = '';
  labelColor = '#ffffff';
  labelY = 2;
  isVolume = false;
  solid = false;
  hidden = false;

  constructor(readonly id: string) {
    this.root.add(this.body, this.helpers);
    this.root.userData.pid = id;
  }

  dispose() {
    disposeTree(this.body);
    disposeTree(this.helpers);
    this.root.removeFromParent();
  }
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const g = (c as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (g && !g.userData.shared) g.dispose();
  });
}

/** What, besides the transform, decides how an object looks. Changes here mean a rebuild. */
export function shapeKey(o: LObject): string {
  const { pos, rot, name, group, locked, ...rest } = o as any;
  if (o.type === 'prop') delete rest.scale;
  if (o.type === 'enemy') delete rest.patrol;
  if (o.type === 'trigger' || o.type === 'destructible') delete rest.actions;
  return JSON.stringify(rest);
}

export function applyTransform(p: Preview, o: LObject) {
  p.root.position.set(o.pos[0], o.pos[1], o.pos[2]);
  const r = o.rot ?? [0, 0, 0];
  const axes = rotAxes(o.type);
  if (axes === 'xyz') p.root.rotation.set(r[0], r[1], r[2], 'YXZ');
  else if (axes === 'y') p.root.rotation.set(0, r[1], 0, 'YXZ');
  else p.root.rotation.set(0, 0, 0, 'YXZ');
  const s = o.type === 'prop' ? o.scale ?? 1 : 1;
  p.root.scale.setScalar(s);
  p.root.updateMatrixWorld(true);
}

/** Fill the label fields (cheap; done on every change). */
export function applyLabel(p: Preview, o: LObject, level: LevelData) {
  p.sub = '';
  p.label = '';
  switch (o.type) {
    case 'enemy': {
      const k = enemyInfo(o.kind);
      p.label = (o.name ? o.name + ' · ' : '') + k.label + (o.level ? ' L' + o.level : '');
      const bits = [];
      if (o.squad) bits.push('squad ' + o.squad);
      if (o.tag) bits.push('arrives on “' + o.tag + '”');
      if (o.hold) bits.push('holds');
      if (o.patrol?.length) bits.push('patrols');
      p.sub = bits.join(' · ');
      p.labelColor = k.color;
      p.labelY = o.kind === 'manager' ? 3.5 : 2.5;
      break;
    }
    case 'ally':
      p.label = displayName(o) + (o.essential ? ' (essential)' : '');
      p.sub = o.tag ? 'arrives on “' + o.tag + '”' : 'ally';
      p.labelColor = '#3ddc5a';
      p.labelY = 2.5;
      break;
    case 'pickup':
      p.label = displayName(o) + (o.amount ? ' x' + o.amount : '') + (o.cls ? ' (' + o.cls + ')' : '');
      p.labelColor = PICKUP_KINDS.find((k) => k.id === o.kind)?.color ?? '#fff';
      p.labelY = 0.8;
      break;
    case 'weapon':
      p.label = displayName(o);
      p.sub = [o.brand, o.rarity !== undefined ? ['common', 'uncommon', 'rare', 'epic', 'legendary'][o.rarity] : '', o.level ? 'L' + o.level : ''].filter(Boolean).join(' ') || 'random roll';
      p.labelColor = '#3f9bff';
      p.labelY = 0.9;
      break;
    case 'locker':
      p.label = 'Loot locker';
      p.sub = ['ordinary', 'good', 'great'][o.luck ?? 1] + ' luck';
      p.labelColor = '#53c7ff';
      p.labelY = 2.4;
      break;
    case 'barrel':
      p.label = 'BOOM barrel';
      p.labelColor = '#ff7b1c';
      p.labelY = 1.3;
      break;
    case 'vehicle':
      p.label = displayName(o);
      p.labelColor = '#e0a82e';
      p.labelY = 2.6;
      break;
    case 'destructible':
      p.label = (o.name ? o.name + ' · ' : '') + 'Destructible';
      p.sub = (PROPS[o.prop]?.label ?? o.prop) + ' · ' + (o.actions?.length ?? 0) + ' action(s)';
      p.labelColor = '#ff7b1c';
      p.labelY = (PROPS[o.prop]?.size[1] ?? 1) + 0.5;
      break;
    case 'trigger':
      p.label = 'Trigger' + (o.name ? ' “' + o.name + '”' : '');
      p.sub = (o.actions.length ? o.actions.length + ' action(s)' : 'no actions yet') + (o.disabled ? ' · starts OFF' : '') + (o.once === false ? ' · repeats' : '');
      p.labelColor = '#ffd21f';
      p.labelY = o.size[1] / 2 + 0.3;
      break;
    case 'checkpoint':
      p.label = 'Checkpoint' + (o.name ? ' “' + o.name + '”' : '');
      p.labelColor = '#3ddc5a';
      p.labelY = o.size[1] / 2 + 0.3;
      break;
    case 'nav':
      p.label = 'Nav area' + (o.name ? ' “' + o.name + '”' : '');
      p.labelColor = '#53c7ff';
      p.labelY = o.size[1] / 2 + 0.3;
      break;
    case 'marker':
      p.label = o.name ? '⌖ ' + o.name : 'Marker (needs a name)';
      p.labelColor = '#ff4fd8';
      p.labelY = 2.6;
      break;
    default:
      // static geometry is labelled only when named (and not locked-away scenery like the floor)
      if (o.name && !o.locked) {
        p.label = o.name;
        p.sub = o.type === 'box' || o.type === 'prop' ? (o.dynamic ? 'dynamic' : '') : '';
        p.labelColor = '#e8e4d8';
        p.labelY = p.bbox.isEmpty() ? 1 : p.bbox.max.y + 0.3;
      }
  }
  void level;
}

/** (Re)build the body of a preview. */
export function buildBody(p: Preview, o: LObject) {
  disposeTree(p.body);
  disposeTree(p.helpers);
  p.root.remove(p.body, p.helpers);
  const body = new THREE.Group();
  const helpers = new THREE.Group();
  p.isVolume = VOLUME_TYPES.has(o.type);
  p.solid = false;

  const addPh = (geo: THREE.BufferGeometry) => body.add(placeholder(geo));
  const facing = (len: number, color: number) => helpers.add(arrow(len, len * 0.55, color));

  switch (o.type) {
    case 'box':
    case 'ramp':
    case 'stairs':
    case 'cyl':
    case 'prop': {
      p.solid = true;
      if (o.type === 'prop' && !PROPS[o.prop]) {
        addPh(unknownGeo());
        break;
      }
      const b = new GeoBuilder();
      const local = { ...o, pos: [0, 0, 0], rot: [0, 0, 0] } as LObject;
      if (local.type === 'prop') delete local.scale;
      emitShape(b, local);
      const built = b.build();
      built.collision.dispose();
      for (const c of [...built.group.children]) {
        c.matrixAutoUpdate = true;
        body.add(c);
      }
      break;
    }
    case 'destructible': {
      p.solid = true;
      const b = new GeoBuilder();
      buildProp(b, PROPS[o.prop] ? o.prop : 'coupling', [0, 0, 0]);
      const built = b.build();
      built.collision.dispose();
      for (const c of [...built.group.children]) {
        c.matrixAutoUpdate = true;
        body.add(c);
      }
      const s = PROPS[o.prop]?.size ?? [1, 1, 1];
      helpers.add(ring(Math.max(s[0], s[2]) * 0.75, 0xff7b1c, true));
      break;
    }
    case 'enemy': {
      const info = ENEMY_KINDS.find((k) => k.id === o.kind) ?? ENEMY_KINDS[0];
      const col = hexToNum(info.color);
      addPh(enemyGeo(o.kind));
      const r = o.kind === 'manager' ? 1.4 : 0.6;
      helpers.add(ring(r, col, !!o.tag));
      facing(o.kind === 'manager' ? 2.6 : 1.4, col);
      if (o.kind === 'drone') {
        const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, 1.7, 0)]);
        helpers.add(new THREE.Line(g, lineMat(col, 0.7)));
      }
      break;
    }
    case 'ally':
      addPh(allyGeo(o.voice));
      helpers.add(ring(0.6, 0x3ddc5a, !!o.tag));
      facing(1.4, 0x3ddc5a);
      break;
    case 'pickup':
      addPh(pickupGeo(o.kind));
      helpers.add(ring(0.4, hexToNum(PICKUP_KINDS.find((k) => k.id === o.kind)?.color ?? '#53c7ff')));
      break;
    case 'weapon':
      addPh(weaponGeo(o.rarity, o.shield));
      helpers.add(ring(0.45, 0x3f9bff));
      break;
    case 'locker':
      p.solid = true;
      addPh(lockerGeo());
      facing(1.2, 0x53c7ff);
      break;
    case 'barrel':
      addPh(barrelGeo());
      helpers.add(ring(0.5, 0xff7b1c, true));
      break;
    case 'vehicle':
      p.solid = true;
      addPh(vehicleGeo(o.kind));
      facing(o.kind === 'teamster' ? 3.4 : 2, 0xe0a82e);
      break;
    case 'marker':
      addPh(markerGeo());
      facing(1.2, 0xff4fd8);
      break;
    case 'trigger':
    case 'checkpoint':
    case 'nav': {
      const col = o.type === 'trigger' && o.disabled ? 0x9a8f60 : VOLUME_COLORS[o.type];
      const op = o.type === 'nav' ? 0.06 : 0.16;
      const geo = new THREE.BoxGeometry(o.size[0], o.size[1], o.size[2]);
      const vol = new THREE.Mesh(geo, flat(col, { transparent: true, opacity: op, depthWrite: false, fog: false, side: THREE.DoubleSide }));
      vol.renderOrder = 2;
      body.add(vol);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat(col, o.type === 'nav' ? 0.6 : 1));
      edges.raycast = noRaycast;
      helpers.add(edges);
      if (o.type === 'checkpoint') {
        const k = new Kit();
        k.cyl(0.04, 0.04, 2.2, PAL.ink, [0, 1.1, 0], 'y', 6, false);
        k.box(0.8, 0.5, 0.03, 0x3ddc5a, [0.42, 1.9, 0]);
        const flag = placeholder(k.geometry());
        flag.position.y = -o.size[1] / 2;
        body.add(flag);
      }
      break;
    }
  }

  // layers: bodies are inked like the game, volumes and helpers are not
  body.traverse((c) => c.layers.set(p.isVolume ? LAYER_FX : LAYER_WORLD));
  helpers.traverse((c) => {
    c.layers.set(LAYER_FX);
    (c as THREE.Mesh).raycast = noRaycast;
  });
  p.body = body;
  p.helpers = helpers;
  p.root.add(body, helpers);
  p.root.traverse((c) => (c.userData.pid = p.id));

  // local bounds
  const save = { pos: p.root.position.clone(), q: p.root.quaternion.clone(), s: p.root.scale.clone() };
  p.root.position.set(0, 0, 0);
  p.root.quaternion.identity();
  p.root.scale.set(1, 1, 1);
  p.root.updateMatrixWorld(true);
  p.bbox.makeEmpty();
  p.bbox.setFromObject(body);
  if (p.bbox.isEmpty()) p.bbox.set(new THREE.Vector3(-0.3, 0, -0.3), new THREE.Vector3(0.3, 0.6, 0.3));
  p.root.position.copy(save.pos);
  p.root.quaternion.copy(save.q);
  p.root.scale.copy(save.s);
  p.root.updateMatrixWorld(true);
  p.key = shapeKey(o);
}

/** The player start is not an object in the file but gets a preview like one. */
export function buildSpawnPreview(p: Preview) {
  disposeTree(p.body);
  disposeTree(p.helpers);
  p.root.remove(p.body, p.helpers);
  p.body = new THREE.Group();
  p.helpers = new THREE.Group();
  p.body.add(placeholder(spawnGeo()));
  p.helpers.add(ring(0.7, 0xffd21f), arrow(2.4, 1.3, 0xffd21f));
  p.body.traverse((c) => c.layers.set(LAYER_WORLD));
  p.helpers.traverse((c) => {
    c.layers.set(LAYER_FX);
    (c as THREE.Mesh).raycast = noRaycast;
  });
  p.root.add(p.body, p.helpers);
  p.root.traverse((c) => (c.userData.pid = SPAWN_ID));
  p.bbox.set(new THREE.Vector3(-0.45, 0, -0.3), new THREE.Vector3(0.45, 2.1, 0.3));
  p.label = 'PLAYER START';
  p.labelColor = '#ffd21f';
  p.labelY = 2.5;
  p.key = 'spawn';
}
