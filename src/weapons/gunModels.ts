import * as THREE from 'three';
import { Kit } from '../render/kit';
import { toon, flat, RAMP_METAL, RARITY_COLORS, ELEMENT_COLORS, shade, PAL } from '../render/toon';
import { BRAND_INFO, type WeaponItem, type Brand, type WeaponClass } from './items';
import { DEG } from '../core/math';

type V3 = [number, number, number];

export interface GunRig {
  root: THREE.Group;
  /** animated parts by name ('gun' is the whole-weapon node clips move around) */
  nodes: Record<string, THREE.Object3D>;
  /** attachment / hand anchor points by name */
  sockets: Record<string, THREE.Object3D>;
  cls: WeaponClass;
  /** hip-fire position of the 'gun' node in view space */
  hip: THREE.Vector3;
  /** distance from the eye to the rear sight when aiming */
  adsDist: number;
  /** true if aiming replaces the weapon with a scope overlay */
  scoped: boolean;
  /** emissive bits that pulse when firing */
  glow: THREE.Mesh[];
}

interface Style {
  body: number;
  dark: number;
  furn: number;
  metal: number;
  accent: number;
  trim: number;
  glow: number;
  brand: Brand;
}

function styleFor(item: WeaponItem): Style {
  const b = BRAND_INFO[item.brand];
  const trim = RARITY_COLORS[item.rarity];
  const glow = item.element === 'none' ? b.accent : ELEMENT_COLORS[item.element];
  switch (item.brand) {
    case 'valu':
      return { body: 0xefe8d2, dark: 0x6f6b5e, furn: 0xd9cfae, metal: 0x8f949a, accent: b.accent, trim, glow, brand: 'valu' };
    case 'krona':
      return { body: 0x3b4552, dark: 0x1d222a, furn: 0x2a313b, metal: 0x66727f, accent: b.accent, trim, glow, brand: 'krona' };
    case 'picket':
      return { body: 0x8a4630, dark: 0x3a2a20, furn: 0xa9713f, metal: 0x565a60, accent: b.accent, trim, glow, brand: 'picket' };
    default:
      return { body: 0xe6edf2, dark: 0x35527e, furn: 0x4a78b8, metal: 0xb9c4cf, accent: b.accent, trim, glow, brand: 'zapp' };
  }
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** Quaternion for a hand whose fingers point along `fingers` and whose back faces `dorsal`. */
export function handQuat(fingers: V3, dorsal: V3, out = new THREE.Quaternion()) {
  _z.set(-fingers[0], -fingers[1], -fingers[2]).normalize(); // hand +Z points back towards the wrist
  _y.set(dorsal[0], dorsal[1], dorsal[2]);
  _x.crossVectors(_y, _z).normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

class RigBuilder {
  root = new THREE.Group();
  nodes: Record<string, THREE.Object3D> = {};
  sockets: Record<string, THREE.Object3D> = {};
  private kits = new Map<string, Kit>();
  glow: THREE.Mesh[] = [];

  constructor() {
    const gun = new THREE.Group();
    gun.name = 'gun';
    this.root.add(gun);
    this.nodes.gun = gun;
  }
  node(name: string, pos: V3 = [0, 0, 0], parent = 'gun') {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(pos[0], pos[1], pos[2]);
    this.nodes[parent].add(g);
    this.nodes[name] = g;
    return g;
  }
  /** Kit whose geometry is attached to `node` (coordinates relative to that node). */
  kit(node = 'gun') {
    let k = this.kits.get(node);
    if (!k) this.kits.set(node, (k = new Kit()));
    return k;
  }
  socket(name: string, pos: V3, parent = 'gun', fingers?: V3, dorsal?: V3) {
    const o = new THREE.Object3D();
    o.name = 'sock_' + name;
    o.position.set(pos[0], pos[1], pos[2]);
    if (fingers && dorsal) handQuat(fingers, dorsal, o.quaternion);
    this.nodes[parent].add(o);
    this.sockets[name] = o;
    return o;
  }
  /** Small unlit glowing piece (sight dot, element coil, status light). */
  emissive(geo: THREE.BufferGeometry, color: number, pos: V3, parent = 'gun', rot: V3 = [0, 0, 0]) {
    const m = new THREE.Mesh(geo, flat(color));
    m.position.set(pos[0], pos[1], pos[2]);
    m.rotation.set(rot[0], rot[1], rot[2]);
    this.nodes[parent].add(m);
    this.glow.push(m);
    return m;
  }
  finish() {
    const mat = toon({ vertexColors: true, ramp: RAMP_METAL, rim: 0.35 });
    for (const [name, k] of this.kits) {
      if (k.empty) continue;
      const mesh = new THREE.Mesh(k.geometry(), mat);
      mesh.name = name + '_mesh';
      this.nodes[name].add(mesh);
    }
  }
}

/** Shared trigger + guard. Trigger pivots at its top. */
function triggerGroup(rb: RigBuilder, s: Style, z: number, y: number, guardLen = 0.058, guardDrop = 0.04) {
  const k = rb.kit();
  k.box(0.012, 0.006, guardLen, s.dark, [0, y - guardDrop, z - guardLen / 2 + 0.008]);
  k.box(0.012, guardDrop, 0.006, s.dark, [0, y - guardDrop / 2, z - guardLen + 0.011]);
  rb.node('trigger', [0, y - 0.002, z - 0.018]);
  rb.kit('trigger').box(0.007, 0.024, 0.006, s.metal, [0, -0.012, 0.002], [0.25, 0, 0]);
}

function sights(rb: RigBuilder, s: Style, item: WeaponItem, rearZ: number, frontZ: number, y: number): V3 {
  const k = rb.kit();
  const sight = item.cls === 'sniper' ? 2 : item.parts.sight;
  if (sight === 0) {
    // iron sights: two rear posts + front post
    k.box(0.005, 0.012, 0.008, s.dark, [-0.0075, y + 0.006, rearZ]);
    k.box(0.005, 0.012, 0.008, s.dark, [0.0075, y + 0.006, rearZ]);
    k.box(0.02, 0.004, 0.01, s.dark, [0, y + 0.001, rearZ]);
    k.box(0.004, 0.013, 0.006, s.dark, [0, y + 0.0055, frontZ]);
    k.box(0.0045, 0.004, 0.0065, s.trim, [0, y + 0.0125, frontZ]);
    return [0, y + 0.011, rearZ + 0.01];
  }
  if (sight === 1) {
    // reflex dot: open frame + lens + glowing dot
    const z = rearZ - 0.03;
    k.box(0.03, 0.006, 0.05, s.dark, [0, y + 0.003, z]);
    k.box(0.004, 0.034, 0.014, s.dark, [-0.015, y + 0.022, z - 0.012]);
    k.box(0.004, 0.034, 0.014, s.dark, [0.015, y + 0.022, z - 0.012]);
    k.box(0.034, 0.004, 0.014, s.dark, [0, y + 0.04, z - 0.012]);
    k.box(0.012, 0.01, 0.016, s.trim, [0, y + 0.01, z + 0.016]);
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.026, 0.03), flat(0x9fe8ff, { transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    lens.position.set(0, y + 0.022, z - 0.012);
    rb.nodes.gun.add(lens);
    rb.emissive(new THREE.CircleGeometry(0.0016, 8), s.glow === 0xffffff ? 0xff3b30 : s.glow, [0, y + 0.022, z - 0.0115]);
    return [0, y + 0.022, rearZ + 0.02];
  }
  // scope tube
  const len = item.cls === 'sniper' ? (item.parts.sight === 2 ? 0.34 : 0.27) : 0.2;
  const zc = rearZ - len / 2 + 0.03;
  const r = item.cls === 'sniper' ? 0.017 : 0.014;
  const sy = y + r + 0.018;
  k.cyl(r, r, len * 0.5, s.dark, [0, sy, zc], 'z', 10);
  k.cyl(r * 1.45, r, len * 0.26, s.dark, [0, sy, zc - len * 0.38], 'z', 10);
  k.cyl(r, r * 1.25, len * 0.24, s.dark, [0, sy, zc + len * 0.37], 'z', 10);
  k.box(0.012, 0.02, 0.016, s.metal, [0, y + 0.008, zc - len * 0.16]);
  k.box(0.012, 0.02, 0.016, s.metal, [0, y + 0.008, zc + len * 0.16]);
  k.cyl(0.008, 0.008, 0.016, s.trim, [0, sy + r + 0.006, zc], 'y', 8);
  k.cyl(0.008, 0.008, 0.016, s.metal, [r + 0.006, sy, zc], 'x', 8);
  rb.emissive(new THREE.CircleGeometry(r * 1.3, 10), 0x2a6f8a, [0, sy, zc - len * 0.51], 'gun', [0, Math.PI, 0]);
  rb.emissive(new THREE.CircleGeometry(r * 1.1, 10), 0x14323f, [0, sy, zc + len * 0.492]);
  return [0, sy, zc + len * 0.5 + 0.035];
}

function accessory(rb: RigBuilder, s: Style, item: WeaponItem, muzzleZ: number, barrelY: number, railY: number, railZ: number) {
  const k = rb.kit();
  if (item.parts.acc === 1) {
    k.box(0.016, 0.016, 0.05, s.dark, [0, railY, railZ]);
    rb.emissive(new THREE.CircleGeometry(0.004, 8), 0xff3030, [0, railY, railZ - 0.0255], 'gun', [0, Math.PI, 0]);
  } else if (item.parts.acc === 2) {
    // bayonet
    k.profile([[0, 0.004], [-0.11, 0.0], [0, -0.012]], 0.004, 0xcfd6dd, [0, barrelY - 0.02, muzzleZ + 0.03]);
    k.box(0.012, 0.014, 0.03, s.dark, [0, barrelY - 0.018, muzzleZ + 0.045]);
  } else if (item.parts.acc === 3) {
    k.cyl(0.016, 0.016, 0.045, s.dark, [0, barrelY, muzzleZ + 0.015], 'z', 8, false);
    k.box(0.034, 0.005, 0.01, s.metal, [0, barrelY, muzzleZ + 0.02]);
    k.box(0.034, 0.005, 0.01, s.metal, [0, barrelY, muzzleZ + 0.004]);
  }
}

function elementCoil(rb: RigBuilder, s: Style, item: WeaponItem, top: V3, len: number) {
  if (item.element === 'none' && item.brand !== 'zapp') return;
  // `top` is the top-centre of the receiver. The coil hangs off the left flank, below the sights:
  // on top it sat exactly in the sight line and blocked the view when aiming.
  const pos: V3 = [top[0] - 0.027, top[1] - 0.03, top[2]];
  const col = item.element === 'none' ? s.accent : ELEMENT_COLORS[item.element];
  const g = new THREE.CylinderGeometry(0.008, 0.008, len, 6);
  g.rotateX(Math.PI / 2);
  rb.emissive(g, col, pos);
  const k = rb.kit();
  for (let i = 0; i < 3; i++) k.box(0.022, 0.022, 0.006, s.dark, [pos[0], pos[1], pos[2] - len / 2 + (len * (i + 0.5)) / 3]);
}

// ---------------------------------------------------------------------------------------------- pistol

function buildPistol(item: WeaponItem, s: Style): GunRig {
  const rb = new RigBuilder();
  const k = rb.kit();
  const barrelLen = [0, 0.03, -0.022, 0.008][item.parts.barrel];
  const mz = -0.165 - barrelLen; // muzzle z
  const heavy = item.parts.barrel === 3;
  const slideW = s.brand === 'picket' ? 0.034 : 0.03;

  // frame + grip (raked back)
  k.profile([[0.03, 0.012], [-0.15 - barrelLen * 0.6, 0.012], [-0.15 - barrelLen * 0.6, -0.008], [-0.085, -0.014], [-0.03, -0.014], [-0.03, -0.004], [0.03, -0.004]], 0.027, s.body);
  k.profile([[0.032, -0.002], [-0.03, -0.002], [-0.012, -0.108], [0.062, -0.108]], 0.031, s.furn, [0, 0, 0], 0.003);
  // grip panel + backstrap detail
  k.box(0.034, 0.05, 0.03, s.dark, [0, -0.055, 0.022], [-0.22, 0, 0]);
  if (s.brand === 'valu') k.quad(0.014, 0.014, s.accent, [-0.0176, -0.05, 0.02], [0, -Math.PI / 2, 0]);
  if (s.brand === 'picket') {
    k.box(0.036, 0.008, 0.04, s.accent, [0, -0.09, 0.045], [-0.22, 0, 0]);
    for (const zz of [0.02, -0.06, -0.12]) k.cyl(0.003, 0.003, slideW + 0.006, s.metal, [0, 0.004, zz], 'x', 6);
  }
  // beavertail
  k.box(0.02, 0.008, 0.02, s.body, [0, 0.004, 0.04]);
  triggerGroup(rb, s, -0.03, -0.012, 0.055, 0.038);
  // barrel (seen through the ejection port and at the muzzle)
  k.cyl(0.0075, 0.0075, 0.15 + barrelLen, s.metal, [0, 0.03, -0.1 - barrelLen / 2], 'z', 8);
  if (heavy) k.box(0.024, 0.02, 0.05, s.dark, [0, 0.002, mz + 0.04]);

  // slide (moves back when firing)
  rb.node('slide', [0, 0.0125, 0]);
  const sk = rb.kit('slide');
  const slideLen = 0.2 + barrelLen;
  const sc = -0.065 - barrelLen / 2; // centre z
  if (s.brand === 'krona') {
    sk.profile([[0.035, 0], [-0.165 - barrelLen, 0], [-0.165 - barrelLen, 0.026], [-0.15 - barrelLen, 0.035], [0.02, 0.035], [0.035, 0.024]], slideW, s.body, [0, 0, 0], 0.004);
  } else {
    sk.box(slideW, 0.034, slideLen, s.body, [0, 0.017, sc]);
    sk.box(slideW * 0.7, 0.004, slideLen * 0.96, shade(s.body, 0.82), [0, 0.036, sc]);
  }
  // ejection port (dark inset on the right/top) + serrations
  sk.box(slideW + 0.002, 0.014, 0.036, s.dark, [0.001, 0.027, -0.062]);
  for (let i = 0; i < 5; i++) sk.box(slideW + 0.003, 0.022, 0.0035, s.dark, [0, 0.016, 0.026 - i * 0.008]);
  // rarity trim stripe along the slide
  sk.box(slideW + 0.002, 0.004, slideLen * 0.5, s.trim, [0, 0.007, sc - slideLen * 0.12]);
  if (s.brand === 'zapp') {
    sk.box(slideW + 0.006, 0.01, 0.06, s.dark, [0, 0.02, -0.11]);
    rb.emissive(new THREE.BoxGeometry(slideW + 0.008, 0.004, 0.05), s.glow, [0, 0.02, -0.11], 'slide');
  }
  // sights ride on the slide
  const sightPos = (() => {
    const tmpGunKit = rb.kit('slide');
    const y = 0.037;
    if (item.parts.sight === 0) {
      tmpGunKit.box(0.005, 0.01, 0.007, s.dark, [-0.008, y + 0.005, 0.024]);
      tmpGunKit.box(0.005, 0.01, 0.007, s.dark, [0.008, y + 0.005, 0.024]);
      tmpGunKit.box(0.004, 0.01, 0.006, s.dark, [0, y + 0.005, mz + 0.012]);
      tmpGunKit.box(0.0045, 0.0035, 0.0065, s.trim, [0, y + 0.0105, mz + 0.012]);
      return [0, 0.0125 + y + 0.0095, 0.03] as V3;
    }
    const z = 0.0;
    tmpGunKit.box(0.026, 0.005, 0.04, s.dark, [0, y + 0.0025, z]);
    tmpGunKit.box(0.004, 0.028, 0.012, s.dark, [-0.013, y + 0.019, z - 0.012]);
    tmpGunKit.box(0.004, 0.028, 0.012, s.dark, [0.013, y + 0.019, z - 0.012]);
    tmpGunKit.box(0.03, 0.004, 0.012, s.dark, [0, y + 0.034, z - 0.012]);
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.022, 0.026), flat(0x9fe8ff, { transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    lens.position.set(0, y + 0.019, z - 0.012);
    rb.nodes.slide.add(lens);
    rb.emissive(new THREE.CircleGeometry(0.0014, 8), s.glow === 0xffffff ? 0xff3b30 : s.glow, [0, y + 0.019, z - 0.0115], 'slide');
    return [0, 0.0125 + y + 0.019, 0.03] as V3;
  })();

  // magazine: slides out along the grip rake
  const rake = -0.31; // radians, matches the grip profile
  rb.node('mag', [0, -0.006, 0.006]);
  rb.nodes.mag.rotation.x = rake;
  const mk = rb.kit('mag');
  const magLen = item.parts.mag === 1 ? 0.135 : 0.108;
  mk.box(0.02, magLen, 0.034, s.metal, [0, -magLen / 2, 0]);
  mk.box(0.026, 0.01, 0.042, s.trim, [0, -magLen - 0.004, 0.001]);
  mk.box(0.012, 0.008, 0.02, 0xc9a23a, [0, -0.002, -0.004]); // top round
  rb.socket('mag', [-0.012, -magLen * 0.72, 0], 'mag', [0.25, 0.1, -1], [-1, 0, -0.2]);

  accessory(rb, s, item, mz, 0.03, -0.004, -0.11);
  elementCoil(rb, s, item, [0, 0.062, -0.09], 0.05);

  rb.socket('muzzle', [0, 0.03, mz - 0.012]);
  rb.socket('eject', [0.02, 0.045, -0.062]);
  rb.socket('sight', sightPos);
  rb.socket('grip', [0.029, -0.047, 0.008], 'gun', [0, 0.3, -1], [1, 0, 0]);
  // support hand mirrors the firing hand, a little lower and further round the front
  rb.socket('fore', [-0.031, -0.062, -0.012], 'gun', [0.08, 0.02, -1], [-1, 0, -0.1]);
  rb.socket('slide', [0, 0.03, 0.01], 'slide', [1, -0.25, 0], [0, 1, 0.1]);
  rb.socket('away', [-0.2, -0.42, 0.12], 'gun', [0.3, 0.6, -1], [-1, 0, 0]);
  rb.finish();
  return { root: rb.root, nodes: rb.nodes, sockets: rb.sockets, cls: 'pistol', hip: new THREE.Vector3(0.13, -0.125, -0.38), adsDist: 0.3, scoped: false, glow: rb.glow };
}

// ---------------------------------------------------------------------------------------------- rifle

function stock(rb: RigBuilder, s: Style, kind: number, z0: number, y: number, drop = 0) {
  const k = rb.kit();
  if (kind === 0) {
    // skeleton / wire stock
    k.box(0.01, 0.01, 0.2, s.metal, [0, y + 0.02, z0 + 0.1]);
    k.box(0.01, 0.01, 0.2, s.metal, [0, y - 0.045 - drop, z0 + 0.1], [0.16, 0, 0]);
    k.box(0.026, 0.1 + drop, 0.014, s.dark, [0, y - 0.022 - drop / 2, z0 + 0.205]);
  } else if (kind === 1) {
    k.profile([[z0, y + 0.03], [z0 + 0.22, y + 0.022], [z0 + 0.22, y - 0.085 - drop], [z0 + 0.19, y - 0.09 - drop], [z0 + 0.03, y - 0.02], [z0, y - 0.02]], 0.036, s.furn, [0, 0, 0], 0.004);
    k.box(0.04, 0.115 + drop, 0.012, s.dark, [0, y - 0.03 - drop / 2, z0 + 0.224]);
  } else {
    // braced / heavy with cheek riser
    k.profile([[z0, y + 0.032], [z0 + 0.24, y + 0.03], [z0 + 0.24, y - 0.1 - drop], [z0 + 0.06, y - 0.085 - drop], [z0, y - 0.024]], 0.042, s.furn, [0, 0, 0], 0.005);
    k.box(0.03, 0.02, 0.11, s.dark, [0, y + 0.042, z0 + 0.12]);
    k.box(0.048, 0.13 + drop, 0.016, s.dark, [0, y - 0.035 - drop / 2, z0 + 0.246]);
    k.box(0.044, 0.01, 0.2, s.trim, [0, y - 0.004, z0 + 0.12]);
  }
}

function buildRifle(item: WeaponItem, s: Style): GunRig {
  const rb = new RigBuilder();
  const k = rb.kit();
  const bl = [0.14, 0.24, 0.07, 0.15][item.parts.barrel];
  const heavy = item.parts.barrel === 3;
  const hgEnd = -0.44;
  const mz = hgEnd - bl;
  const by = 0.036; // bore height

  // receiver
  if (s.brand === 'krona') {
    k.profile([[0.11, 0.0], [-0.22, 0.0], [-0.22, 0.062], [-0.05, 0.07], [0.09, 0.07], [0.11, 0.05]], 0.044, s.body, [0, 0, 0], 0.005);
  } else if (s.brand === 'picket') {
    k.box(0.05, 0.068, 0.33, s.body, [0, 0.032, -0.055]);
    k.box(0.054, 0.012, 0.3, s.dark, [0, 0.069, -0.055]);
    for (const zz of [0.08, -0.02, -0.12, -0.2]) k.cyl(0.004, 0.004, 0.056, s.metal, [0, 0.016, zz], 'x', 6);
  } else {
    k.profile([[0.11, -0.002], [-0.22, -0.002], [-0.22, 0.066], [0.11, 0.066]], 0.046, s.body, [0, 0, 0], 0.006);
    k.box(0.036, 0.008, 0.3, shade(s.body, 0.8), [0, 0.07, -0.055]);
  }
  // rarity stripe + brand plate
  k.box(0.05, 0.007, 0.16, s.trim, [0, 0.018, -0.1]);
  k.box(0.05, 0.02, 0.05, s.dark, [0, 0.04, 0.06]);
  // ejection port on the right
  k.box(0.006, 0.02, 0.06, s.dark, [0.0235, 0.046, -0.09]);
  // handguard
  if (s.brand === 'picket') {
    k.profile([[-0.22, 0.0], [hgEnd, 0.008], [hgEnd, 0.056], [-0.22, 0.064]], 0.048, s.furn, [0, 0, 0], 0.006);
    k.box(0.052, 0.012, 0.03, s.accent, [0, 0.03, -0.3]);
  } else if (s.brand === 'krona') {
    k.profile([[-0.22, 0.004], [hgEnd, 0.012], [hgEnd - 0.012, 0.03], [hgEnd, 0.058], [-0.22, 0.062]], 0.04, s.furn, [0, 0, 0], 0.004);
    for (let i = 0; i < 4; i++) k.box(0.044, 0.01, 0.022, s.dark, [0, 0.036, -0.26 - i * 0.045]);
  } else {
    k.box(0.044, 0.056, 0.22, s.furn, [0, 0.032, -0.33]);
    for (let i = 0; i < 5; i++) k.box(0.048, 0.008, 0.014, s.dark, [0, 0.044, -0.245 - i * 0.04]);
    k.box(0.03, 0.01, 0.2, s.dark, [0, 0.064, -0.33]);
  }
  // barrel + muzzle
  k.cyl(heavy ? 0.013 : 0.0095, heavy ? 0.013 : 0.0095, bl + 0.02, s.metal, [0, by, hgEnd - bl / 2 + 0.01], 'z', 8);
  if (item.parts.acc !== 3) k.cyl(0.014, 0.012, 0.034, s.dark, [0, by, mz + 0.012], 'z', 8, false);
  // gas block
  k.box(0.02, 0.03, 0.02, s.dark, [0, by + 0.012, hgEnd - 0.03]);
  // pistol grip
  k.profile([[0.045, 0.002], [-0.012, 0.002], [0.004, -0.11], [0.068, -0.11]], 0.034, s.furn, [0, 0, 0], 0.004);
  k.box(0.036, 0.008, 0.066, s.dark, [0, -0.112, 0.036]);
  triggerGroup(rb, s, -0.012, 0.0, 0.062, 0.042);
  // mag well
  k.box(0.04, 0.03, 0.062, s.dark, [0, -0.012, -0.125]);
  stock(rb, s, item.parts.stock, 0.11, 0.032);

  // magazine
  rb.node('mag', [0, -0.012, -0.125]);
  rb.nodes.mag.rotation.x = 0.12;
  const mk = rb.kit('mag');
  const ml = item.parts.mag === 1 ? 0.2 : item.parts.mag === 2 ? 0.125 : 0.155;
  if (item.parts.mag === 1 && s.brand !== 'krona') {
    // drum-ish bulk mag
    mk.box(0.034, 0.07, 0.05, s.metal, [0, -0.035, 0]);
    mk.cyl(0.055, 0.055, 0.04, s.metal, [0, -0.1, -0.004], 'x', 10, false);
    mk.cyl(0.02, 0.02, 0.044, s.trim, [0, -0.1, -0.004], 'x', 8, false);
  } else {
    mk.profile([[0.026, 0], [-0.026, 0], [-0.04, -ml], [0.012, -ml]], 0.032, s.metal, [0, 0, 0], 0.003);
    mk.box(0.036, 0.012, 0.056, s.trim, [0, -ml - 0.004, -0.014]);
    for (let i = 1; i < 3; i++) mk.box(0.034, 0.004, 0.05, s.dark, [0, -ml * (i / 3), -0.005 * i]);
  }
  mk.box(0.014, 0.008, 0.03, 0xc9a23a, [0, 0.002, 0]);
  rb.socket('mag', [-0.014, -ml * 0.62, -0.004], 'mag', [0.2, 0.1, -1], [-1, 0, -0.15]);

  // charging handle on the left side (rides in a slot)
  k.box(0.004, 0.012, 0.11, s.dark, [-0.0235, 0.048, -0.09]);
  rb.node('bolt', [-0.027, 0.048, -0.135]);
  const bk = rb.kit('bolt');
  bk.cyl(0.006, 0.006, 0.022, s.metal, [-0.008, 0, 0], 'x', 6);
  bk.box(0.01, 0.016, 0.014, s.trim, [-0.02, 0, 0]);
  rb.socket('bolt', [-0.03, 0.004, 0.004], 'bolt', [1, -0.1, -0.15], [0.05, 1, 0.1]);

  const sightPos = sights(rb, s, item, 0.07, hgEnd + 0.02, 0.07);
  accessory(rb, s, item, mz, by, by - 0.036, hgEnd + 0.04);
  elementCoil(rb, s, item, [0, 0.092, -0.3], 0.09);
  if (s.brand === 'zapp') rb.emissive(new THREE.BoxGeometry(0.05, 0.006, 0.12), s.glow, [0, 0.05, -0.33]);
  if (s.brand === 'valu') k.quad(0.022, 0.022, s.accent, [-0.0235, 0.04, 0.0], [0, -Math.PI / 2, 0]);

  rb.socket('muzzle', [0, by, mz - 0.012]);
  rb.socket('eject', [0.03, 0.05, -0.09]);
  rb.socket('sight', sightPos);
  rb.socket('grip', [0.031, -0.052, 0.024], 'gun', [0, 0.28, -1], [1, 0, 0]);
  rb.socket('fore', [-0.016, -0.011, -0.33], 'gun', [1, 0.12, -0.2], [-0.1, -1, 0]);
  rb.socket('away', [-0.24, -0.45, 0.0], 'gun', [0.3, 0.6, -1], [-1, 0, 0]);
  rb.finish();
  return { root: rb.root, nodes: rb.nodes, sockets: rb.sockets, cls: 'rifle', hip: new THREE.Vector3(0.125, -0.152, -0.33), adsDist: 0.13, scoped: item.parts.sight === 2, glow: rb.glow };
}

// ---------------------------------------------------------------------------------------------- shotgun

function buildShotgun(item: WeaponItem, s: Style): GunRig {
  const rb = new RigBuilder();
  const k = rb.kit();
  const bl = [0.44, 0.56, 0.32, 0.46][item.parts.barrel];
  const heavy = item.parts.barrel === 3;
  const mz = -0.2 - bl;
  const by = 0.046;
  const ty = 0.016; // tube height

  // receiver
  if (s.brand === 'krona') k.profile([[0.09, -0.008], [-0.2, -0.008], [-0.2, 0.066], [0.02, 0.066], [0.09, 0.04]], 0.042, s.body, [0, 0, 0], 0.005);
  else {
    k.profile([[0.09, -0.01], [-0.2, -0.01], [-0.2, 0.066], [0.03, 0.066], [0.09, 0.046]], 0.046, s.body, [0, 0, 0], 0.006);
    k.box(0.03, 0.006, 0.2, shade(s.body, 0.8), [0, 0.069, -0.08]);
  }
  k.box(0.05, 0.008, 0.14, s.trim, [0, 0.03, -0.1]);
  k.box(0.006, 0.022, 0.07, s.dark, [0.0235, 0.046, -0.1]); // ejection port (right)
  k.box(0.03, 0.006, 0.1, s.dark, [0, -0.011, -0.11]); // loading port (underside)
  if (s.brand === 'picket') for (const zz of [0.05, -0.05, -0.15]) k.cyl(0.004, 0.004, 0.052, s.metal, [0, 0.05, zz], 'x', 6);
  // barrel + magazine tube
  k.cyl(heavy ? 0.016 : 0.0125, heavy ? 0.016 : 0.0125, bl, s.metal, [0, by, -0.2 - bl / 2], 'z', 8);
  const tubeLen = Math.min(bl - 0.06, item.parts.mag === 1 ? bl - 0.02 : 0.36);
  k.cyl(0.011, 0.011, tubeLen, s.dark, [0, ty, -0.2 - tubeLen / 2], 'z', 8);
  k.box(0.018, 0.04, 0.012, s.dark, [0, 0.03, -0.2 - tubeLen + 0.02]); // barrel band
  k.cyl(0.004, 0.004, 0.008, s.trim, [0, by + 0.016, mz + 0.012], 'y', 6); // bead
  // stock with semi-pistol grip
  if (item.parts.stock === 0) {
    k.profile([[0.09, 0.03], [0.045, 0.03], [0.04, -0.002], [0.062, -0.1], [0.115, -0.1], [0.1, -0.005]], 0.036, s.furn, [0, 0, 0], 0.004);
  } else {
    const drop = item.parts.stock === 2 ? 0.012 : 0;
    k.profile([[0.09, 0.046], [0.36, 0.02], [0.36, -0.1 - drop], [0.33, -0.105 - drop], [0.16, -0.05], [0.115, -0.075], [0.07, -0.07], [0.05, -0.01], [0.09, -0.01]], item.parts.stock === 2 ? 0.044 : 0.038, s.furn, [0, 0, 0], 0.005);
    k.box(0.046, 0.125 + drop, 0.014, s.dark, [0, -0.04 - drop / 2, 0.365]);
    if (item.parts.stock === 2) k.box(0.048, 0.012, 0.16, s.trim, [0, -0.012, 0.25], [0.12, 0, 0]);
  }
  triggerGroup(rb, s, 0.03, -0.01, 0.06, 0.04);

  // pump / forend
  rb.node('pump', [0, ty, -0.4]);
  const pk = rb.kit('pump');
  pk.box(0.046, 0.04, 0.15, s.furn, [0, -0.002, 0]);
  for (let i = 0; i < 5; i++) pk.box(0.05, 0.03, 0.01, s.dark, [0, -0.004, -0.056 + i * 0.028]);
  pk.box(0.008, 0.008, 0.2, s.metal, [0.02, 0.012, 0.09]); // action bar
  rb.socket('pump', [-0.016, -0.036, 0.0], 'pump', [1, 0.12, -0.15], [-0.1, -1, 0]);

  // loose shell used by the reload animation
  rb.node('shell', [0, -0.3, 0.0]);
  const shk = rb.kit('shell');
  shk.cyl(0.0095, 0.0095, 0.042, item.element === 'none' ? 0xc8402a : ELEMENT_COLORS[item.element], [0, 0, -0.008], 'z', 8);
  shk.cyl(0.0102, 0.0102, 0.014, 0xc9a23a, [0, 0, 0.02], 'z', 8);
  rb.socket('shell', [-0.008, -0.012, 0.012], 'shell', [0.35, 0.5, -1], [-1, 0.1, -0.2]);

  const sightPos = sights(rb, s, item, 0.02, mz + 0.012, 0.066);
  accessory(rb, s, item, mz, by, ty - 0.02, -0.2 - tubeLen + 0.06);
  elementCoil(rb, s, item, [0, 0.088, -0.12], 0.08);
  if (s.brand === 'zapp') rb.emissive(new THREE.BoxGeometry(0.05, 0.006, 0.1), s.glow, [0, 0.052, -0.1]);
  if (s.brand === 'valu') k.quad(0.022, 0.022, s.accent, [-0.0235, 0.03, 0.03], [0, -Math.PI / 2, 0]);

  rb.socket('muzzle', [0, by, mz - 0.01]);
  rb.socket('eject', [0.03, 0.05, -0.1]);
  rb.socket('sight', item.parts.sight === 0 ? [0, 0.082, 0.06] : sightPos);
  rb.socket('grip', [0.031, -0.05, 0.084], 'gun', [0, 0.5, -1], [1, 0, 0]);
  rb.socket('port', [0, -0.03, -0.12]);
  rb.socket('away', [-0.2, -0.46, 0.05], 'gun', [0.3, 0.6, -1], [-1, 0, 0]);
  rb.finish();
  return { root: rb.root, nodes: rb.nodes, sockets: rb.sockets, cls: 'shotgun', hip: new THREE.Vector3(0.125, -0.148, -0.31), adsDist: 0.17, scoped: false, glow: rb.glow };
}

// ---------------------------------------------------------------------------------------------- sniper

function buildSniper(item: WeaponItem, s: Style): GunRig {
  const rb = new RigBuilder();
  const k = rb.kit();
  const bl = [0.56, 0.68, 0.44, 0.58][item.parts.barrel];
  const heavy = item.parts.barrel === 3;
  const mz = -0.2 - bl;
  const by = 0.07;

  // chassis: forend + thumbhole grip + butt
  const drop = item.parts.stock === 2 ? 0.014 : 0;
  if (item.parts.stock === 0) {
    k.profile([[0.07, 0.04], [-0.4, 0.038], [-0.4, 0.008], [-0.06, -0.006], [0.0, -0.006], [0.02, -0.1], [0.075, -0.1], [0.06, 0.0]], 0.042, s.furn, [0, 0, 0], 0.005);
    k.box(0.012, 0.012, 0.26, s.metal, [0, 0.03, 0.2]);
    k.box(0.012, 0.012, 0.24, s.metal, [0, -0.05, 0.2], [0.18, 0, 0]);
    k.box(0.036, 0.13, 0.016, s.dark, [0, -0.02, 0.335]);
  } else {
    k.profile(
      [[0.36, 0.05], [0.36, -0.1 - drop], [0.2, -0.085 - drop], [0.13, -0.035], [0.105, -0.1], [0.055, -0.1], [0.04, -0.012], [-0.06, -0.008], [-0.4, 0.008], [-0.4, 0.04], [0.07, 0.044], [0.12, 0.05]],
      item.parts.stock === 2 ? 0.05 : 0.044,
      s.furn,
      [0, 0, 0],
      0.006,
    );
    k.box(0.05, 0.15 + drop, 0.016, s.dark, [0, -0.025 - drop / 2, 0.366]);
    k.box(0.03, 0.022, 0.12, s.dark, [0, 0.058, 0.22]); // cheek rest
  }
  k.box(0.05, 0.008, 0.2, s.trim, [0, 0.022, -0.22]);
  // receiver
  k.cyl(0.018, 0.018, 0.26, s.body, [0, by, -0.07], 'z', 8);
  k.box(0.034, 0.02, 0.24, s.body, [0, by - 0.018, -0.07]);
  k.box(0.006, 0.014, 0.07, s.dark, [0.0165, by + 0.002, -0.05]); // ejection port
  // barrel
  k.cyl(heavy ? 0.015 : 0.012, heavy ? 0.013 : 0.0095, bl, s.metal, [0, by, -0.2 - bl / 2], 'z', 8);
  if (item.parts.acc !== 3) {
    k.box(0.03, 0.022, 0.05, s.dark, [0, by, mz + 0.02]);
    k.box(0.034, 0.006, 0.012, s.metal, [0, by, mz + 0.03]);
    k.box(0.034, 0.006, 0.012, s.metal, [0, by, mz + 0.01]);
  }
  if (heavy) {
    // folded bipod
    k.box(0.008, 0.008, 0.2, s.dark, [-0.018, 0.0, -0.3]);
    k.box(0.008, 0.008, 0.2, s.dark, [0.018, 0.0, -0.3]);
  }
  if (s.brand === 'picket') for (const zz of [0.0, -0.14, -0.3]) k.cyl(0.004, 0.004, 0.05, s.metal, [0, 0.024, zz], 'x', 6);
  triggerGroup(rb, s, 0.03, -0.01, 0.06, 0.04);

  // bolt: rotates about the bore axis then slides back
  rb.node('bolt', [0, by, 0.05]);
  const bk = rb.kit('bolt');
  bk.cyl(0.0095, 0.0095, 0.12, s.metal, [0, 0, -0.02], 'z', 8);
  bk.cyl(0.012, 0.012, 0.02, s.dark, [0, 0, 0.05], 'z', 8);
  bk.box(0.05, 0.008, 0.01, s.metal, [0.03, -0.006, 0.02], [0, 0, -0.45]);
  bk.sphere(0.011, s.trim, [0.056, -0.02, 0.02], 0);
  rb.socket('handle', [0.056, -0.02, 0.02], 'bolt', [-1, 0.2, -0.2], [0.3, 1, 0.1]);

  // magazine
  rb.node('mag', [0, -0.006, -0.11]);
  const mk = rb.kit('mag');
  const ml = item.parts.mag === 1 ? 0.11 : 0.075;
  mk.box(0.032, ml, 0.075, s.metal, [0, -ml / 2, 0]);
  mk.box(0.036, 0.01, 0.08, s.trim, [0, -ml - 0.003, 0]);
  mk.box(0.012, 0.008, 0.05, 0xc9a23a, [0, 0.002, 0]);
  rb.socket('mag', [-0.014, -ml * 0.6, 0.0], 'mag', [0.2, 0.1, -1], [-1, 0, -0.15]);

  const sightPos = sights(rb, s, item, 0.08, -0.3, by + 0.018);
  accessory(rb, s, item, mz, by, 0.0, -0.36);
  elementCoil(rb, s, item, [0, by + 0.03, -0.3], 0.1);
  if (s.brand === 'zapp') rb.emissive(new THREE.BoxGeometry(0.05, 0.006, 0.16), s.glow, [0, 0.03, -0.25]);
  if (s.brand === 'valu') k.quad(0.024, 0.024, s.accent, [-0.0225, 0.0, 0.25], [0, -Math.PI / 2, 0]);

  rb.socket('muzzle', [0, by, mz - 0.012]);
  rb.socket('eject', [0.03, by + 0.01, -0.05]);
  rb.socket('sight', sightPos);
  rb.socket('grip', [0.034, -0.05, 0.08], 'gun', [0, 0.42, -1], [1, 0, 0]);
  rb.socket('fore', [-0.016, -0.007, -0.27], 'gun', [1, 0.12, -0.15], [-0.1, -1, 0]);
  rb.socket('away', [-0.24, -0.46, 0.0], 'gun', [0.3, 0.6, -1], [-1, 0, 0]);
  rb.finish();
  return { root: rb.root, nodes: rb.nodes, sockets: rb.sockets, cls: 'sniper', hip: new THREE.Vector3(0.13, -0.17, -0.3), adsDist: 0.09, scoped: true, glow: rb.glow };
}

export function buildGun(item: WeaponItem): GunRig {
  const s = styleFor(item);
  switch (item.cls) {
    case 'pistol':
      return buildPistol(item, s);
    case 'rifle':
      return buildRifle(item, s);
    case 'shotgun':
      return buildShotgun(item, s);
    default:
      return buildSniper(item, s);
  }
}

/** A simple low-detail version for world pickups and NPC hands (single mesh, no moving parts). */
export function buildWorldGun(item: WeaponItem): THREE.Group {
  const rig = buildGun(item);
  rig.root.traverse((o) => {
    o.castShadow = true;
  });
  return rig.root;
}

export const SKIN = { glove: 0x6a4a36, gloveDark: 0x3d2a1f, sleeve: 0x1b2030, cuff: PAL.shirt, vest: PAL.hivis };
export { DEG };
