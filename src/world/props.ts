import * as THREE from 'three';
import { Rng } from '../core/math';
import { PAL, shade, toon, RAMP_WORLD } from '../render/toon';
import { drawSmile, signTexture } from '../render/textures';
import type { GeoBuilder, MatName } from './builder';

type V3 = [number, number, number];

export interface PropOpts {
  color: number;
  variant: number;
  text?: string;
}

export interface PropDef {
  id: string;
  label: string;
  cat: 'Cargo' | 'Cover' | 'Vehicles' | 'Structures' | 'Signs' | 'Decor';
  /** approximate bounding size (x, y, z); origin is the centre of the base */
  size: V3;
  /** default tint (hex number) */
  color: number;
  /** suggested alternative tints shown in the editor */
  colors?: number[];
  variants?: number;
  build(b: GeoBuilder, o: PropOpts): void;
}

// ---- tiny helpers -------------------------------------------------------------------------------

const box = (b: GeoBuilder, p: V3, s: V3, color: number, mat: MatName = 'plain', uv = 2, collide = true, rot?: V3) => b.box({ pos: p, size: s, color, mat, uv, collide, rot });
/** detail piece: drawn but not part of collision */
const det = (b: GeoBuilder, p: V3, s: V3, color: number, mat: MatName = 'plain', uv = 2, rot?: V3) => b.box({ pos: p, size: s, color, mat, uv, collide: false, rot });
/** wheel lying on its side (axis along X), centred at p */
const wheel = (b: GeoBuilder, p: V3, r: number, w: number) => {
  b.cyl({ pos: [p[0] + w / 2, p[1], p[2]], r, h: w, sides: 10, rot: [0, 0, Math.PI / 2], color: 0x1c1d24, mat: 'plain', collide: false });
  b.cyl({ pos: [p[0] + w / 2 + 0.01, p[1], p[2]], r: r * 0.5, h: w + 0.02, sides: 8, rot: [0, 0, Math.PI / 2], color: 0x8d949c, mat: 'plain', collide: false });
};

const SLOGANS = [
  'THE ONLY STORE™',
  'SMILING IS MANDATORY',
  'EVERYDAY LOW WAGES',
  'HAVE A COMPLIANT DAY',
  'NOW HIRING: NOBODY',
  'IF YOU SEE SOMETHING, BUY SOMETHING',
  'UNIONS: WHY SHARE?',
  'ROLL BACK YOUR EXPECTATIONS',
  'YOU ARE NOT A WORKER. YOU ARE FAMILY*',
  'DAY 4,112 WITHOUT A UNION',
];

const signCache = new Map<string, THREE.Texture>();
/** MonoMart signage: smile mark + slogan. Cached per text/style. */
export function monoSign(text: string, style: 'yellow' | 'dark' | 'union' = 'yellow', wide = true) {
  const key = style + '|' + (wide ? 'w' : 's') + '|' + text;
  let t = signCache.get(key);
  if (t) return t;
  const W = wide ? 512 : 256;
  const H = 256;
  t = signTexture(W, H, (g, w, h) => {
    const bg = style === 'yellow' ? '#ffd21f' : style === 'union' ? '#b5382e' : '#15161c';
    const fg = style === 'yellow' ? '#15161c' : style === 'union' ? '#f4f1e8' : '#ffd21f';
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = fg;
    g.lineWidth = 10;
    g.strokeRect(9, 9, w - 18, h - 18);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (style === 'union') {
      g.font = '900 86px Anton, Impact, sans-serif';
      g.fillText('LOCAL 404', w / 2, h * 0.36);
      g.font = '700 30px Rajdhani, sans-serif';
      wrap(g, text || 'WORKER NOT FOUND', w / 2, h * 0.72, w - 60, 34);
    } else {
      const logoX = wide ? 96 : w / 2;
      const logoY = wide ? h / 2 : 78;
      const r = wide ? 62 : 46;
      g.beginPath();
      g.arc(logoX, logoY, r + 12, 0, Math.PI * 2);
      g.fillStyle = fg;
      g.fill();
      drawSmile(g, logoX, logoY, r * 0.8, bg, 'happy');
      g.fillStyle = fg;
      if (wide) {
        g.textAlign = 'left';
        g.font = '900 60px Anton, Impact, sans-serif';
        g.fillText('MONOMART', 186, 84);
        g.font = '700 30px Rajdhani, sans-serif';
        g.textAlign = 'center';
        wrap(g, text, 186 + (w - 206) / 2, 168, w - 216, 34);
      } else {
        g.font = '900 40px Anton, Impact, sans-serif';
        g.fillText('MONOMART', w / 2, 160);
        g.font = '700 22px Rajdhani, sans-serif';
        wrap(g, text, w / 2, 208, w - 40, 24);
      }
    }
  });
  signCache.set(key, t);
  return t;
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  const y0 = y - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => g.fillText(l, x, y0 + i * lh));
}

/** Flat textured panel facing +Z of the current frame. */
function panel(b: GeoBuilder, tex: THREE.Texture, w: number, h: number, pos: V3, rotY = 0, lit = true) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lit ? toon({ map: tex, ramp: RAMP_WORLD }) : new THREE.MeshBasicMaterial({ map: tex }));
  m.position.set(pos[0], pos[1], pos[2]);
  m.rotation.y = rotY;
  m.receiveShadow = true;
  b.extra(m);
  return m;
}

const CONTAINER_COLORS = [PAL.cRed, PAL.cBlue, PAL.cTeal, PAL.cYellow, PAL.cGreen, PAL.cWhite];
const CAR_COLORS = [0xb5442f, 0x2f6f9f, 0xe6e0d0, 0x3a3d46, 0x5a8f4a, 0xe0a82e];

// ---- the library --------------------------------------------------------------------------------

const defs: PropDef[] = [
  {
    id: 'container',
    label: 'Shipping container',
    cat: 'Cargo',
    size: [2.44, 2.6, 6.06],
    color: PAL.cRed,
    colors: CONTAINER_COLORS,
    build(b, o) {
      box(b, [0, 1.3, 0], [2.44, 2.6, 6.06], o.color, 'corrugated', 2.44);
      const dk = shade(o.color, 0.62);
      // corner posts + top rails
      for (const x of [-1.2, 1.2]) for (const z of [-3.0, 3.0]) det(b, [x, 1.3, z], [0.12, 2.64, 0.12], dk);
      det(b, [0, 2.6, 3.0], [2.5, 0.12, 0.12], dk);
      det(b, [0, 2.6, -3.0], [2.5, 0.12, 0.12], dk);
      // door end: lock rods
      for (const x of [-0.75, -0.25, 0.25, 0.75]) det(b, [x, 1.3, 3.05], [0.04, 2.3, 0.04], 0x8d949c);
      det(b, [0, 1.3, 3.045], [0.04, 2.5, 0.02], dk);
    },
  },
  {
    id: 'container_open',
    label: 'Open container (walk-in)',
    cat: 'Cargo',
    size: [2.44, 2.6, 6.06],
    color: PAL.cBlue,
    colors: CONTAINER_COLORS,
    build(b, o) {
      const dk = shade(o.color, 0.62);
      box(b, [0, 0.06, 0], [2.44, 0.12, 6.06], 0x6b5a48, 'wood', 1.2);
      box(b, [-1.17, 1.3, 0], [0.1, 2.6, 6.06], o.color, 'corrugated', 2.44);
      box(b, [1.17, 1.3, 0], [0.1, 2.6, 6.06], o.color, 'corrugated', 2.44);
      box(b, [0, 2.55, 0], [2.44, 0.1, 6.06], o.color, 'corrugated', 2.44);
      box(b, [0, 1.3, -2.98], [2.44, 2.6, 0.1], o.color, 'corrugated', 2.44);
      // doors swung wide
      box(b, [-1.75, 1.3, 3.5], [1.2, 2.5, 0.08], o.color, 'corrugated', 2.44, true, [0, 0.9, 0]);
      box(b, [1.75, 1.3, 3.5], [1.2, 2.5, 0.08], o.color, 'corrugated', 2.44, true, [0, -0.9, 0]);
      for (const x of [-1.2, 1.2]) for (const z of [-3.0, 3.0]) det(b, [x, 1.3, z], [0.12, 2.64, 0.12], dk);
    },
  },
  {
    id: 'crate',
    label: 'Wooden crate',
    cat: 'Cover',
    size: [1, 1, 1],
    color: PAL.wood,
    build(b, o) {
      box(b, [0, 0.5, 0], [1, 1, 1], o.color, 'wood', 1);
      const dk = shade(o.color, 0.7);
      for (const x of [-0.47, 0.47]) for (const z of [-0.47, 0.47]) det(b, [x, 0.5, z], [0.1, 1.02, 0.1], dk);
    },
  },
  {
    id: 'crate_big',
    label: 'Big crate',
    cat: 'Cover',
    size: [1.6, 1.6, 1.6],
    color: PAL.wood,
    build(b, o) {
      box(b, [0, 0.8, 0], [1.6, 1.6, 1.6], o.color, 'wood', 1.6);
      const dk = shade(o.color, 0.7);
      det(b, [0, 0.8, 0.81], [1.62, 0.14, 0.03], dk);
      det(b, [0, 0.8, -0.81], [1.62, 0.14, 0.03], dk);
      det(b, [0.81, 0.8, 0], [0.03, 0.14, 1.62], dk);
      det(b, [-0.81, 0.8, 0], [0.03, 0.14, 1.62], dk);
    },
  },
  {
    id: 'boxes',
    label: 'Cardboard boxes',
    cat: 'Cover',
    size: [1.3, 1.2, 1.1],
    color: 0xc9a06a,
    variants: 4,
    build(b, o) {
      const r = new Rng(31 + o.variant * 7);
      box(b, [-0.3, 0.3, 0], [0.7, 0.6, 0.7], o.color, 'cardboard', 0.7, true, [0, r.range(-0.2, 0.2), 0]);
      box(b, [0.38, 0.25, 0.1], [0.56, 0.5, 0.6], shade(o.color, 0.92), 'cardboard', 0.6, true, [0, r.range(-0.4, 0.4), 0]);
      box(b, [-0.2, 0.85, 0.02], [0.6, 0.5, 0.56], shade(o.color, 1.06), 'cardboard', 0.6, true, [0, r.range(-0.5, 0.5), 0]);
      if (o.variant % 2 === 1) box(b, [0.36, 0.7, 0.05], [0.44, 0.4, 0.44], o.color, 'cardboard', 0.5, true, [0, r.range(-0.6, 0.6), 0]);
    },
  },
  {
    id: 'pallet',
    label: 'Pallet',
    cat: 'Cargo',
    size: [1.2, 0.15, 1.0],
    color: 0xb8905a,
    build(b, o) {
      for (const z of [-0.42, 0, 0.42]) det(b, [0, 0.05, z], [1.2, 0.09, 0.1], shade(o.color, 0.8), 'wood', 1);
      for (let i = 0; i < 5; i++) det(b, [-0.5 + i * 0.25, 0.12, 0], [0.16, 0.035, 1.0], o.color, 'wood', 1);
      b.blocker([0, 0.075, 0], [1.2, 0.15, 1.0]);
    },
  },
  {
    id: 'pallet_load',
    label: 'Loaded pallet',
    cat: 'Cover',
    size: [1.2, 1.5, 1.0],
    color: 0xc9a06a,
    variants: 3,
    build(b, o) {
      for (const z of [-0.42, 0, 0.42]) det(b, [0, 0.05, z], [1.2, 0.09, 0.1], 0x8f6f45, 'wood', 1);
      det(b, [0, 0.12, 0], [1.2, 0.035, 1.0], 0xb8905a, 'wood', 1);
      const h = [1.3, 0.9, 1.1][o.variant % 3];
      box(b, [0, 0.14 + h / 2, 0], [1.14, h, 0.94], o.color, 'cardboard', 0.6);
      // shrink-wrap bands
      det(b, [0, 0.14 + h * 0.35, 0], [1.16, 0.05, 0.96], PAL.cWhite);
      det(b, [0, 0.14 + h * 0.75, 0], [1.16, 0.05, 0.96], PAL.cWhite);
      b.blocker([0, 0.07, 0], [1.2, 0.14, 1.0]);
    },
  },
  {
    id: 'barrel',
    label: 'Steel drum',
    cat: 'Cover',
    size: [0.62, 0.9, 0.62],
    color: PAL.cBlue,
    colors: [PAL.cBlue, 0x4d5663, PAL.cGreen, PAL.cWhite],
    build(b, o) {
      b.cyl({ pos: [0, 0, 0], r: 0.3, h: 0.9, sides: 10, color: o.color, mat: 'panel', uv: 1.2 });
      b.cyl({ pos: [0, 0.28, 0], r: 0.315, h: 0.04, sides: 10, color: shade(o.color, 0.7), mat: 'plain', collide: false });
      b.cyl({ pos: [0, 0.6, 0], r: 0.315, h: 0.04, sides: 10, color: shade(o.color, 0.7), mat: 'plain', collide: false });
    },
  },
  {
    id: 'barrier',
    label: 'Concrete barrier',
    cat: 'Cover',
    size: [2.4, 0.9, 0.6],
    color: PAL.concrete,
    build(b, o) {
      box(b, [0, 0.14, 0], [2.4, 0.28, 0.6], o.color, 'concrete', 2);
      box(b, [0, 0.58, 0], [2.4, 0.62, 0.28], o.color, 'concrete', 2);
      det(b, [0, 0.33, 0.2], [2.4, 0.16, 0.22], shade(o.color, 0.94), 'concrete', 2, [0.7, 0, 0]);
      det(b, [0, 0.33, -0.2], [2.4, 0.16, 0.22], shade(o.color, 0.94), 'concrete', 2, [-0.7, 0, 0]);
    },
  },
  {
    id: 'hazard_barrier',
    label: 'Striped barricade',
    cat: 'Cover',
    size: [2.0, 1.05, 0.5],
    color: 0xffffff,
    build(b) {
      box(b, [0, 0.8, 0], [2.0, 0.34, 0.08], 0xffffff, 'hazard', 0.8);
      det(b, [0, 0.4, 0], [2.0, 0.18, 0.06], 0xffffff, 'hazard', 0.8);
      for (const x of [-0.85, 0.85]) {
        det(b, [x, 0.5, 0], [0.08, 1.0, 0.08], 0x55585f);
        det(b, [x, 0.04, 0], [0.1, 0.08, 0.5], 0x55585f);
      }
      b.blocker([0, 0.3, 0], [2.0, 0.6, 0.12]);
    },
  },
  {
    id: 'sandbags',
    label: 'Sandbag wall',
    cat: 'Cover',
    size: [2.2, 0.9, 0.7],
    color: 0xb9a37c,
    build(b, o) {
      const r = new Rng(5);
      for (let row = 0; row < 3; row++)
        for (let i = 0; i < 4 - (row === 2 ? 1 : 0); i++) {
          const x = -0.82 + i * 0.55 + (row % 2) * 0.27;
          det(b, [x, 0.15 + row * 0.29, r.range(-0.03, 0.03)], [0.56, 0.28, 0.62 - row * 0.06], shade(o.color, r.range(0.86, 1.05)), 'plain', 1, [0, r.range(-0.08, 0.08), 0]);
        }
      b.blocker([0, 0.45, 0], [2.2, 0.9, 0.6]);
    },
  },
  {
    id: 'dumpster',
    label: 'Dumpster',
    cat: 'Cover',
    size: [2.0, 1.4, 1.2],
    color: 0x3f6f4a,
    colors: [0x3f6f4a, PAL.cBlue, 0x4d5663],
    build(b, o) {
      box(b, [0, 0.62, 0], [2.0, 1.1, 1.2], o.color, 'panel', 1.6);
      box(b, [0, 1.24, -0.12], [2.06, 0.1, 1.0], shade(o.color, 0.7), 'plain', 1.6, true, [0.12, 0, 0]);
      det(b, [0, 0.72, 0.62], [1.7, 0.1, 0.06], shade(o.color, 0.65));
      for (const x of [-0.8, 0.8]) for (const z of [-0.45, 0.45]) det(b, [x, 0.05, z], [0.14, 0.1, 0.14], 0x1c1d24);
    },
  },
  {
    id: 'car',
    label: 'Parked car',
    cat: 'Vehicles',
    size: [1.9, 1.45, 4.4],
    color: CAR_COLORS[0],
    colors: CAR_COLORS,
    build(b, o) {
      const dk = shade(o.color, 0.7);
      box(b, [0, 0.62, 0], [1.86, 0.62, 4.4], o.color, 'plain', 2);
      box(b, [0, 1.16, -0.2], [1.64, 0.5, 2.2], dk, 'plain', 2);
      det(b, [0, 1.17, -0.2], [1.66, 0.36, 1.9], 0x1d2a36); // side glass band
      det(b, [0, 1.17, 0.92], [1.5, 0.36, 0.03], 0x1d2a36);
      det(b, [0, 1.17, -1.32], [1.5, 0.36, 0.03], 0x1d2a36);
      det(b, [0, 0.42, 2.21], [1.9, 0.2, 0.08], 0x55585f);
      det(b, [0, 0.42, -2.21], [1.9, 0.2, 0.08], 0x55585f);
      for (const x of [-0.7, 0.7]) {
        det(b, [x, 0.7, -2.21], [0.3, 0.14, 0.03], 0xfff1b0);
        det(b, [x, 0.7, 2.21], [0.3, 0.12, 0.03], 0xc0281e);
      }
      for (const x of [-0.95, 0.75]) for (const z of [-1.4, 1.4]) wheel(b, [x, 0.34, z], 0.34, 0.2);
    },
  },
  {
    id: 'truck',
    label: 'MonoMart box truck',
    cat: 'Vehicles',
    size: [2.6, 3.4, 7.6],
    color: PAL.shell,
    variants: SLOGANS.length,
    build(b, o) {
      // cab (front is -Z)
      box(b, [0, 1.5, -2.9], [2.4, 2.0, 1.8], o.color, 'panel', 2.4);
      det(b, [0, 1.95, -3.82], [2.1, 0.8, 0.04], 0x1d2a36);
      det(b, [1.21, 1.95, -3.0], [0.03, 0.7, 1.0], 0x1d2a36);
      det(b, [-1.21, 1.95, -3.0], [0.03, 0.7, 1.0], 0x1d2a36);
      det(b, [0, 0.75, -3.86], [2.44, 0.3, 0.12], 0x55585f);
      for (const x of [-0.85, 0.85]) det(b, [x, 1.1, -3.82], [0.36, 0.2, 0.04], 0xfff1b0);
      det(b, [0, 1.12, -3.82], [0.9, 0.3, 0.03], 0x2a2c34);
      // cargo box
      box(b, [0, 2.0, 1.0], [2.6, 2.9, 5.6], o.color, 'panel', 2.6);
      det(b, [0, 0.62, 1.0], [2.5, 0.16, 5.5], PAL.smile);
      det(b, [0, 2.0, 3.82], [2.4, 2.7, 0.04], shade(o.color, 0.86), 'corrugated', 1.2);
      // chassis
      det(b, [0, 0.5, 0], [1.4, 0.3, 7.0], 0x2a2c34);
      for (const x of [-1.3, 1.02]) for (const z of [-2.7, 2.2]) wheel(b, [x, 0.5, z], 0.5, 0.28);
      for (const x of [-1.3, 1.02]) wheel(b, [x, 0.5, 3.0], 0.5, 0.28);
      const tex = monoSign(SLOGANS[o.variant % SLOGANS.length], 'yellow');
      panel(b, tex, 4.6, 2.3, [1.31, 2.1, 1.0], Math.PI / 2);
      panel(b, tex, 4.6, 2.3, [-1.31, 2.1, 1.0], -Math.PI / 2);
    },
  },
  {
    id: 'trailer',
    label: 'Semi trailer',
    cat: 'Vehicles',
    size: [2.6, 4.0, 12.2],
    color: PAL.cWhite,
    colors: [PAL.cWhite, PAL.smile, PAL.cBlue],
    variants: SLOGANS.length,
    build(b, o) {
      box(b, [0, 2.55, 0], [2.6, 2.8, 12.2], o.color, 'corrugated', 2.6);
      det(b, [0, 1.1, 0], [2.5, 0.16, 12.0], 0x2a2c34);
      box(b, [0, 0.55, -4.4], [0.3, 1.1, 0.3], 0x55585f); // landing gear
      for (const x of [-1.3, 1.02]) for (const z of [3.6, 4.9]) wheel(b, [x, 0.52, z], 0.52, 0.28);
      box(b, [0, 0.55, 4.25], [2.0, 0.5, 2.4], 0x2a2c34, 'plain', 2);
      const tex = monoSign(SLOGANS[(o.variant + 3) % SLOGANS.length], 'yellow');
      panel(b, tex, 7.6, 2.4, [1.31, 2.55, 0], Math.PI / 2);
      panel(b, tex, 7.6, 2.4, [-1.31, 2.55, 0], -Math.PI / 2);
    },
  },
  {
    id: 'forklift',
    label: 'Forklift',
    cat: 'Vehicles',
    size: [1.2, 2.2, 2.6],
    color: PAL.smile,
    build(b, o) {
      box(b, [0, 0.62, 0.3], [1.1, 0.8, 1.5], o.color, 'panel', 1.2);
      box(b, [0, 0.45, 1.1], [1.14, 0.7, 0.4], 0x2a2c34, 'plain', 1); // counterweight
      for (const x of [-0.5, 0.5]) for (const z of [-0.35, 0.95]) det(b, [x, 1.55, z], [0.06, 1.1, 0.06], 0x2a2c34);
      det(b, [0, 2.12, 0.3], [1.1, 0.06, 1.4], 0x2a2c34);
      det(b, [0, 1.0, 0.45], [0.5, 0.5, 0.12], 0x2a2c34); // seat back
      for (const x of [-0.42, 0.42]) det(b, [x, 1.3, -0.55], [0.08, 2.4, 0.12], 0x55585f); // mast
      for (const x of [-0.3, 0.3]) det(b, [x, 0.12, -1.15], [0.12, 0.05, 1.1], 0x8d949c); // forks
      for (const x of [-0.62, 0.42]) for (const z of [-0.25, 0.9]) wheel(b, [x, 0.28, z], 0.28, 0.2);
      b.blocker([0, 0.5, -0.9], [1.0, 1.0, 0.7]);
    },
  },
  {
    id: 'shelf',
    label: 'Pallet racking',
    cat: 'Structures',
    size: [2.9, 4.2, 1.2],
    color: 0xe07a1a,
    variants: 4,
    build(b, o) {
      const r = new Rng(77 + o.variant * 13);
      for (const x of [-1.4, 1.4]) for (const z of [-0.5, 0.5]) det(b, [x, 2.1, z], [0.1, 4.2, 0.1], 0x35527e);
      for (const y of [0.12, 1.5, 2.9]) {
        box(b, [0, y, 0], [2.9, 0.1, 1.1], o.color, 'plain', 2);
        // goods on each shelf
        let x = -1.2;
        while (x < 1.0) {
          const w = r.range(0.55, 0.95);
          const h = r.range(0.5, 1.1);
          if (r.chance(0.82)) det(b, [x + w / 2, y + 0.05 + h / 2, r.range(-0.08, 0.08)], [w, h, r.range(0.7, 0.95)], r.pick([0xc9a06a, 0xb8905a, PAL.shell, 0xd9b47a]), 'cardboard', 0.7);
          x += w + 0.08;
        }
      }
      b.blocker([0, 2.1, 0], [2.9, 4.2, 1.1]);
    },
  },
  {
    id: 'conveyor',
    label: 'Conveyor',
    cat: 'Structures',
    size: [1.0, 1.0, 4.0],
    color: 0x55585f,
    build(b, o) {
      box(b, [0, 0.86, 0], [1.0, 0.16, 4.0], o.color, 'grate', 1);
      det(b, [0.48, 0.98, 0], [0.06, 0.14, 4.0], PAL.smile);
      det(b, [-0.48, 0.98, 0], [0.06, 0.14, 4.0], PAL.smile);
      for (const z of [-1.7, 0, 1.7]) for (const x of [-0.4, 0.4]) det(b, [x, 0.4, z], [0.08, 0.8, 0.08], 0x2a2c34);
      b.blocker([0, 0.45, 0], [0.9, 0.9, 4.0]);
    },
  },
  {
    id: 'lamp',
    label: 'Street lamp',
    cat: 'Decor',
    size: [0.4, 7, 2.2],
    color: 0x4d5663,
    build(b, o) {
      b.cyl({ pos: [0, 0, 0], r: 0.09, r2: 0.06, h: 7, sides: 6, color: o.color, mat: 'plain' });
      det(b, [0, 6.95, -0.9], [0.1, 0.1, 1.9], o.color);
      det(b, [0, 6.85, -1.7], [0.34, 0.12, 0.6], 0x2a2c34);
      det(b, [0, 6.78, -1.7], [0.26, 0.04, 0.5], 0xfff3c2);
      det(b, [0, 0.2, 0], [0.34, 0.4, 0.34], 0x2a2c34);
    },
  },
  {
    id: 'fence',
    label: 'Chain-link fence',
    cat: 'Structures',
    size: [4.0, 2.6, 0.12],
    color: 0x8d949c,
    build(b, o) {
      box(b, [0, 1.25, 0], [4.0, 2.3, 0.04], o.color, 'grate', 0.6);
      for (const x of [-2.0, 2.0]) det(b, [x, 1.3, 0], [0.09, 2.6, 0.09], 0x55585f);
      det(b, [0, 2.44, 0], [4.0, 0.07, 0.07], 0x55585f);
      det(b, [0, 0.1, 0], [4.0, 0.07, 0.07], 0x55585f);
    },
  },
  {
    id: 'gate',
    label: 'Sliding steel gate',
    cat: 'Structures',
    size: [8.0, 4.2, 0.4],
    color: 0x55585f,
    build(b, o) {
      box(b, [0, 2.1, 0], [8.0, 4.2, 0.3], o.color, 'panel', 2);
      det(b, [0, 0.5, 0.17], [8.0, 0.6, 0.04], 0xffffff, 'hazard', 1);
      det(b, [0, 0.5, -0.17], [8.0, 0.6, 0.04], 0xffffff, 'hazard', 1);
      det(b, [0, 3.9, 0], [8.1, 0.3, 0.44], 0x2a2c34);
      panel(b, monoSign('AUTHORISED ASSOCIATES ONLY', 'dark'), 4.4, 2.2, [0, 2.4, 0.16], 0);
    },
  },
  {
    id: 'wall',
    label: 'Perimeter wall segment',
    cat: 'Structures',
    size: [6.0, 4.0, 0.5],
    color: PAL.concrete,
    build(b, o) {
      box(b, [0, 2.0, 0], [6.0, 4.0, 0.5], o.color, 'concrete', 4);
      det(b, [0, 4.05, 0], [6.1, 0.14, 0.62], shade(o.color, 0.8), 'concrete', 4);
      det(b, [0, 0.2, 0], [6.02, 0.4, 0.56], shade(o.color, 0.82), 'concrete', 4);
    },
  },
  {
    id: 'billboard',
    label: 'Billboard',
    cat: 'Signs',
    size: [9.0, 9.0, 0.8],
    color: 0x4d5663,
    variants: SLOGANS.length,
    build(b, o) {
      for (const x of [-3.2, 3.2]) box(b, [x, 2.4, 0], [0.35, 4.8, 0.35], o.color, 'panel', 2);
      box(b, [0, 6.9, 0], [9.0, 4.4, 0.3], 0x2a2c34, 'plain', 4);
      det(b, [0, 4.75, 0.3], [9.2, 0.12, 0.7], 0x55585f, 'grate', 0.6);
      const text = o.text || SLOGANS[o.variant % SLOGANS.length];
      panel(b, monoSign(text, o.variant % 3 === 2 ? 'dark' : 'yellow'), 8.6, 4.1, [0, 6.9, 0.16], 0, false);
      panel(b, monoSign(SLOGANS[(o.variant + 5) % SLOGANS.length], 'dark'), 8.6, 4.1, [0, 6.9, -0.16], Math.PI, false);
    },
  },
  {
    id: 'sign',
    label: 'Wall sign',
    cat: 'Signs',
    size: [2.4, 1.2, 0.1],
    color: 0x2a2c34,
    variants: SLOGANS.length,
    build(b, o) {
      det(b, [0, 0.6, -0.03], [2.5, 1.3, 0.06], o.color);
      panel(b, monoSign(o.text || SLOGANS[o.variant % SLOGANS.length], 'yellow'), 2.4, 1.2, [0, 0.6, 0.01], 0);
    },
  },
  {
    id: 'union_sign',
    label: 'Local 404 banner',
    cat: 'Signs',
    size: [2.4, 1.2, 0.1],
    color: 0x3a2a20,
    build(b, o) {
      det(b, [0, 0.6, -0.03], [2.5, 1.3, 0.06], o.color);
      panel(b, monoSign(o.text || 'AN INJURY TO ONE IS AN INJURY TO ALL', 'union'), 2.4, 1.2, [0, 0.6, 0.01], 0);
    },
  },
  {
    id: 'rock',
    label: 'Rock',
    cat: 'Decor',
    size: [3.2, 2.2, 3.0],
    color: PAL.rock,
    colors: [PAL.rock, PAL.rockDark, PAL.sandDark],
    variants: 5,
    build(b, o) {
      const r = new Rng(101 + o.variant * 17);
      const n = 3 + (o.variant % 2);
      for (let i = 0; i < n; i++) {
        const s: V3 = [r.range(1.2, 2.4), r.range(0.9, 2.0), r.range(1.2, 2.2)];
        box(b, [r.range(-0.7, 0.7), s[1] * 0.42, r.range(-0.6, 0.6)], s, shade(o.color, r.range(0.85, 1.08)), 'rock', 2.5, true, [r.range(-0.25, 0.25), r.range(0, 3.1), r.range(-0.25, 0.25)]);
      }
    },
  },
  {
    id: 'cactus',
    label: 'Cactus',
    cat: 'Decor',
    size: [1.2, 2.4, 0.6],
    color: 0x5a8f4a,
    variants: 3,
    build(b, o) {
      const h = [2.2, 1.6, 2.6][o.variant % 3];
      b.cyl({ pos: [0, 0, 0], r: 0.2, r2: 0.17, h, sides: 6, color: o.color, mat: 'plain' });
      det(b, [0.38, h * 0.5, 0], [0.5, 0.2, 0.2], o.color);
      det(b, [0.56, h * 0.5 + 0.3, 0], [0.18, 0.7, 0.18], o.color);
      if (o.variant % 3 !== 1) {
        det(b, [-0.36, h * 0.36, 0], [0.5, 0.2, 0.2], o.color);
        det(b, [-0.54, h * 0.36 + 0.24, 0], [0.18, 0.56, 0.18], o.color);
      }
    },
  },
  {
    id: 'cone',
    label: 'Traffic cone',
    cat: 'Decor',
    size: [0.4, 0.7, 0.4],
    color: PAL.hivis,
    build(b, o) {
      b.cyl({ pos: [0, 0.04, 0], r: 0.16, r2: 0.03, h: 0.64, sides: 6, color: o.color, mat: 'plain', collide: false });
      det(b, [0, 0.02, 0], [0.4, 0.04, 0.4], shade(o.color, 0.8));
      b.cyl({ pos: [0, 0.3, 0], r: 0.105, r2: 0.085, h: 0.1, sides: 6, color: PAL.cWhite, mat: 'plain', collide: false });
    },
  },
  {
    id: 'cart',
    label: 'Shopping cart',
    cat: 'Decor',
    size: [0.6, 1.0, 1.0],
    color: 0x8d949c,
    build(b, o) {
      det(b, [0, 0.62, 0], [0.56, 0.4, 0.86], o.color, 'grate', 0.3);
      det(b, [0, 0.4, 0], [0.5, 0.04, 0.8], 0x55585f);
      det(b, [0, 0.95, 0.46], [0.56, 0.05, 0.05], PAL.smile);
      for (const x of [-0.24, 0.24]) for (const z of [-0.36, 0.36]) det(b, [x, 0.2, z], [0.04, 0.4, 0.04], 0x55585f);
      b.blocker([0, 0.45, 0], [0.56, 0.9, 0.9]);
    },
  },
  {
    id: 'coupling',
    label: 'Power coupling',
    cat: 'Structures',
    size: [1.0, 1.5, 0.6],
    color: PAL.smile,
    build(b, o) {
      box(b, [0, 0.75, 0], [1.0, 1.5, 0.6], o.color, 'panel', 1);
      det(b, [0, 1.0, 0.31], [0.7, 0.5, 0.03], PAL.screen);
      det(b, [0, 0.3, 0.31], [0.9, 0.3, 0.03], 0xffffff, 'hazard', 0.5);
      for (const x of [-0.3, 0, 0.3]) b.cyl({ pos: [x, 1.5, 0], r: 0.06, h: 0.5, sides: 6, color: 0x2a2c34, mat: 'plain', collide: false });
      det(b, [0.2, 1.05, 0.33], [0.1, 0.1, 0.02], 0x5dff8a);
    },
  },
  {
    id: 'dish',
    label: 'Uplink dish',
    cat: 'Structures',
    size: [3.0, 4.4, 3.0],
    color: PAL.shell,
    build(b, o) {
      box(b, [0, 0.4, 0], [1.6, 0.8, 1.6], 0x55585f, 'panel', 1.6);
      b.cyl({ pos: [0, 0.8, 0], r: 0.18, h: 1.8, sides: 6, color: 0x2a2c34, mat: 'plain' });
      b.cyl({ pos: [0, 2.6, 0.2], r: 0.3, r2: 1.5, h: 0.7, sides: 10, color: o.color, mat: 'plain', rot: [-0.9, 0, 0] });
      det(b, [0, 3.2, -0.9], [0.06, 0.06, 1.4], 0x2a2c34, 'plain', 1, [-0.9, 0, 0]);
    },
  },
  {
    id: 'kiosk',
    label: 'MonoMart kiosk',
    cat: 'Decor',
    size: [1.2, 2.1, 0.8],
    color: PAL.smile,
    build(b, o) {
      box(b, [0, 1.05, 0], [1.2, 2.1, 0.8], o.color, 'panel', 1.2);
      det(b, [0, 1.3, 0.41], [0.9, 0.9, 0.03], PAL.screen);
      det(b, [0, 0.55, 0.41], [0.7, 0.3, 0.03], 0x2a2c34);
      panel(b, monoSign('NO REFUNDS. EVER.', 'dark', false), 0.84, 0.84, [0, 1.3, 0.43], 0, false);
    },
  },
  {
    id: 'tower',
    label: 'Guard tower',
    cat: 'Structures',
    size: [3.6, 7.5, 3.6],
    color: 0x4d5663,
    build(b, o) {
      for (const x of [-1.5, 1.5]) for (const z of [-1.5, 1.5]) box(b, [x, 2.4, z], [0.3, 4.8, 0.3], o.color, 'panel', 2);
      box(b, [0, 4.9, 0], [3.6, 0.25, 3.6], o.color, 'grate', 1);
      for (const [x, z, sx, sz] of [[0, -1.72, 3.6, 0.12], [0, 1.72, 3.6, 0.12], [-1.72, 0, 0.12, 3.6], [1.72, 0, 0.12, 3.6]] as const) box(b, [x, 5.55, z], [sx, 1.1, sz], PAL.smile, 'panel', 2);
      box(b, [0, 7.3, 0], [4.0, 0.2, 4.0], 0x2a2c34, 'corrugated', 2);
      for (const x of [-1.7, 1.7]) for (const z of [-1.7, 1.7]) det(b, [x, 6.6, z], [0.12, 1.4, 0.12], o.color);
    },
  },
  {
    id: 'dock_door',
    label: 'Loading dock door',
    cat: 'Structures',
    size: [3.4, 3.6, 0.3],
    color: 0x8d949c,
    variants: 9,
    build(b, o) {
      box(b, [0, 1.7, 0], [3.0, 3.4, 0.12], o.color, 'corrugated', 0.9);
      det(b, [-1.6, 1.8, 0.05], [0.24, 3.6, 0.3], PAL.smile, 'hazard', 0.6);
      det(b, [1.6, 1.8, 0.05], [0.24, 3.6, 0.3], PAL.smile, 'hazard', 0.6);
      det(b, [0, 3.55, 0.05], [3.5, 0.26, 0.3], 0x2a2c34);
      const n = (o.variant % 9) + 1;
      const tex = signCache.get('dock' + n) ?? signTexture(128, 128, (g) => {
        g.fillStyle = '#15161c';
        g.fillRect(0, 0, 128, 128);
        g.fillStyle = '#ffd21f';
        g.font = '900 100px Anton, Impact, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(n), 64, 70);
      });
      signCache.set('dock' + n, tex);
      panel(b, tex, 0.9, 0.9, [0, 4.3, 0.08], 0);
    },
  },
];

export const PROPS: Record<string, PropDef> = Object.fromEntries(defs.map((d) => [d.id, d]));
export const PROP_LIST = defs;
export { SLOGANS };

/** Build a prop at a position/yaw into a builder. */
export function buildProp(b: GeoBuilder, id: string, pos: V3, rot: V3 = [0, 0, 0], opts: Partial<PropOpts> & { scale?: number } = {}) {
  const def = PROPS[id];
  if (!def) {
    console.warn('[props] unknown prop', id);
    return;
  }
  const o: PropOpts = { color: opts.color ?? def.color, variant: opts.variant ?? 0, text: opts.text };
  b.at(pos, rot[1], () => def.build(b, o), rot[0], rot[2], opts.scale ?? 1);
}
