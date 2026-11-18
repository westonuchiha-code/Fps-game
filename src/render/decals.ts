import * as THREE from 'three';
import { Rng } from '../core/math';
import { drawSmile } from './textures';
import { toon, RAMP_CHAR } from './toon';

/**
 * Decals: stamps (logos, name badges, stencils, dirt) drawn from small recipes into one decal atlas,
 * and placements that stick them onto models — on a bone for characters, so they move with it.
 * Both live in public/textures/decals.json and are made in the texture editor (#tex, Decals tab).
 */

export type StampShape =
  | { type: 'rect'; x: number; y: number; w: number; h: number; color: string; radius?: number; stroke?: number; strokeColor?: string }
  | { type: 'circle'; x: number; y: number; r: number; color: string; stroke?: number; strokeColor?: string }
  | { type: 'text'; x: number; y: number; text: string; size: number; color: string; font?: 'Anton' | 'Bangers' | 'Special Elite' | 'Share Tech Mono' | 'Rajdhani'; align?: 'left' | 'center' | 'right'; rot?: number; stroke?: number; strokeColor?: string }
  | { type: 'smile'; x: number; y: number; r: number; color: string }
  | { type: 'splat'; x: number; y: number; r: number; color: string; seed?: number; drops?: number }
  | { type: 'stripes'; x: number; y: number; w: number; h: number; color: string; color2: string; width: number }
  | { type: 'barcode'; x: number; y: number; w: number; h: number; color: string; seed?: number };

/** A stamp is drawn on a 256 x 256 cell; `aspect` crops it (w / h) for the quad. */
export interface Stamp {
  aspect?: number;
  shapes: StampShape[];
  note?: string;
}

/** One stamp stuck on a model. Positions are in the frame of `bone` (or the model root if -1). */
export interface Placement {
  stamp: string;
  bone: number;
  pos: [number, number, number];
  normal: [number, number, number];
  /** turn around the normal, degrees */
  rot: number;
  /** width in metres */
  size: number;
}

export interface DecalFile {
  version: 1;
  stamps: Record<string, Stamp>;
  /** model key (e.g. 'striker', 'striker99', 'assoc', 'rifle') -> placements */
  models: Record<string, Placement[]>;
}

export const STAMPS: Record<string, Stamp> = {};
export const PLACEMENTS: Record<string, Placement[]> = {};

export const SHAPE_DEFAULTS: Record<StampShape['type'], StampShape> = {
  rect: { type: 'rect', x: 28, y: 78, w: 200, h: 100, color: '#ffd21f', radius: 12, stroke: 0, strokeColor: '#0b0b12' },
  circle: { type: 'circle', x: 128, y: 128, r: 90, color: '#ffd21f', stroke: 0, strokeColor: '#0b0b12' },
  text: { type: 'text', x: 128, y: 150, text: 'TEXT', size: 64, color: '#0b0b12', font: 'Anton', align: 'center', rot: 0, stroke: 0, strokeColor: '#ffffff' },
  smile: { type: 'smile', x: 128, y: 128, r: 70, color: '#0b0b12' },
  splat: { type: 'splat', x: 128, y: 128, r: 70, color: '#3a2a18', seed: 1, drops: 6 },
  stripes: { type: 'stripes', x: 0, y: 64, w: 256, h: 128, color: '#ffd21f', color2: '#0b0b12', width: 32 },
  barcode: { type: 'barcode', x: 40, y: 60, w: 176, h: 120, color: '#0b0b12', seed: 1 },
};

const CELL = 256;
const COLS = 8;
const SLOT = new Map<string, number>();
let canvas: HTMLCanvasElement | null = null;
let tex: THREE.CanvasTexture | null = null;
let mat: THREE.MeshToonMaterial | null = null;

export function drawStamp(g: CanvasRenderingContext2D, st: Stamp) {
  g.clearRect(0, 0, CELL, CELL);
  for (const s of st.shapes) {
    g.save();
    switch (s.type) {
      case 'rect': {
        g.beginPath();
        g.roundRect(s.x, s.y, s.w, s.h, s.radius ?? 0);
        g.fillStyle = s.color;
        g.fill();
        if (s.stroke) {
          g.lineWidth = s.stroke;
          g.strokeStyle = s.strokeColor ?? '#0b0b12';
          g.stroke();
        }
        break;
      }
      case 'circle':
        g.beginPath();
        g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        g.fillStyle = s.color;
        g.fill();
        if (s.stroke) {
          g.lineWidth = s.stroke;
          g.strokeStyle = s.strokeColor ?? '#0b0b12';
          g.stroke();
        }
        break;
      case 'text':
        g.translate(s.x, s.y);
        g.rotate(((s.rot ?? 0) * Math.PI) / 180);
        g.font = `${s.size}px '${s.font ?? 'Anton'}', Impact, sans-serif`;
        g.textAlign = s.align ?? 'center';
        g.textBaseline = 'alphabetic';
        if (s.stroke) {
          g.lineWidth = s.stroke;
          g.lineJoin = 'round';
          g.strokeStyle = s.strokeColor ?? '#ffffff';
          g.strokeText(s.text, 0, 0);
        }
        g.fillStyle = s.color;
        g.fillText(s.text, 0, 0);
        break;
      case 'smile':
        drawSmile(g, s.x, s.y, s.r, s.color);
        break;
      case 'splat': {
        const r = new Rng((s.seed ?? 1) * 31 + 7);
        g.fillStyle = s.color;
        g.beginPath();
        const n = 18;
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          const rr = s.r * r.range(0.6, 1.05);
          const x = s.x + Math.cos(a) * rr;
          const y = s.y + Math.sin(a) * rr;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.closePath();
        g.fill();
        for (let i = 0; i < (s.drops ?? 6); i++) {
          const a = r.range(0, Math.PI * 2);
          const d = s.r * r.range(1.05, 1.6);
          g.beginPath();
          g.arc(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, s.r * r.range(0.05, 0.16), 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case 'stripes': {
        g.beginPath();
        g.rect(s.x, s.y, s.w, s.h);
        g.clip();
        g.fillStyle = s.color;
        g.fillRect(s.x, s.y, s.w, s.h);
        g.fillStyle = s.color2;
        for (let x = s.x - s.h; x < s.x + s.w + s.h; x += s.width * 2) {
          g.beginPath();
          g.moveTo(x, s.y + s.h);
          g.lineTo(x + s.width, s.y + s.h);
          g.lineTo(x + s.width + s.h, s.y);
          g.lineTo(x + s.h, s.y);
          g.fill();
        }
        break;
      }
      case 'barcode': {
        const r = new Rng((s.seed ?? 1) * 17 + 3);
        g.fillStyle = s.color;
        let x = s.x;
        while (x < s.x + s.w) {
          const w = r.int(1, 4) * 2;
          if (r.chance(0.6)) g.fillRect(x, s.y, w, s.h);
          x += w + 2;
        }
        break;
      }
    }
    g.restore();
  }
}

function ensureAtlas() {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = CELL * COLS;
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    mat = toon({ map: tex, transparent: true, alphaTest: 0.35, ramp: RAMP_CHAR, name: 'decals' });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -4;
  }
  return canvas;
}

/** Redraw one stamp in the atlas. */
export function repaintStamp(name: string) {
  const c = ensureAtlas();
  let i = SLOT.get(name);
  if (i === undefined) {
    i = SLOT.size;
    if (i >= COLS * COLS) return;
    SLOT.set(name, i);
  }
  const cell = document.createElement('canvas');
  cell.width = cell.height = CELL;
  const st = STAMPS[name];
  if (st) drawStamp(cell.getContext('2d')!, st);
  const g = c.getContext('2d')!;
  const x = (i % COLS) * CELL;
  const y = Math.floor(i / COLS) * CELL;
  g.clearRect(x, y, CELL, CELL);
  g.drawImage(cell, x, y);
  tex!.needsUpdate = true;
}

/** A quad showing one stamp, facing along +Z (place it with `placeDecal`). */
export function decalMesh(p: Placement) {
  ensureAtlas();
  if (!SLOT.has(p.stamp)) repaintStamp(p.stamp);
  const i = SLOT.get(p.stamp) ?? 0;
  const st = STAMPS[p.stamp];
  const asp = st?.aspect ?? 1;
  const w = p.size;
  const hgt = p.size / asp;
  const g = new THREE.PlaneGeometry(w, hgt);
  // crop the cell to the stamp's aspect, centred
  const cu = asp >= 1 ? 1 : asp;
  const cv = asp >= 1 ? 1 / asp : 1;
  const u0 = ((i % COLS) + (1 - cu) / 2) / COLS;
  const u1 = u0 + cu / COLS;
  const v1 = 1 - (Math.floor(i / COLS) + (1 - cv) / 2) / COLS;
  const v0 = v1 - cv / COLS;
  const uv = g.getAttribute('uv');
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) ? u1 : u0, uv.getY(k) ? v1 : v0);
  const m = new THREE.Mesh(g, mat!);
  m.userData.decal = p;
  placeDecal(m, p);
  m.renderOrder = 2;
  return m;
}

const _n = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
/** Put a decal mesh at its placement (in its parent's frame). */
export function placeDecal(m: THREE.Mesh, p: Placement) {
  _n.set(p.normal[0], p.normal[1], p.normal[2]).normalize();
  m.position.set(p.pos[0], p.pos[1], p.pos[2]).addScaledVector(_n, 0.004);
  _q.setFromUnitVectors(_z, _n);
  // keep the stamp's "up" as close to world-up (in the parent frame) as the normal allows
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(_q);
  const want = new THREE.Vector3(0, 1, 0).addScaledVector(_n, -_n.y);
  if (want.lengthSq() > 1e-4) {
    want.normalize();
    let a = Math.acos(Math.max(-1, Math.min(1, up.dot(want))));
    if (new THREE.Vector3().crossVectors(up, want).dot(_n) < 0) a = -a;
    _qr.setFromAxisAngle(_n, a);
    _q.premultiply(_qr);
  }
  _qr.setFromAxisAngle(_n, (p.rot * Math.PI) / 180);
  m.quaternion.copy(_q).premultiply(_qr);
}

/** Stick a model's decals on: bones[i] for bone-relative placements, else `root`. */
export function attachDecals(key: string, root: THREE.Object3D, bones?: THREE.Bone[]) {
  const list = PLACEMENTS[key];
  const made: THREE.Mesh[] = [];
  if (!list) return made;
  for (const p of list) {
    if (!STAMPS[p.stamp]) continue;
    const m = decalMesh(p);
    const parent = p.bone >= 0 && bones ? bones[p.bone] : root;
    if (!parent) continue;
    parent.add(m);
    made.push(m);
  }
  return made;
}

export function setDecals(f: Partial<DecalFile>) {
  for (const k of Object.keys(STAMPS)) delete STAMPS[k];
  for (const k of Object.keys(PLACEMENTS)) delete PLACEMENTS[k];
  Object.assign(STAMPS, f.stamps ?? {});
  Object.assign(PLACEMENTS, f.models ?? {});
  for (const n of Object.keys(STAMPS)) repaintStamp(n);
}

export async function loadDecals(url = 'textures/decals.json') {
  try {
    // stamps use the game's fonts; make sure they are ready before drawing
    await Promise.all(['Anton', 'Bangers', 'Special Elite', 'Share Tech Mono', 'Rajdhani'].map((f) => document.fonts?.load(`32px '${f}'`).catch(() => null)));
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return;
    setDecals((await r.json()) as DecalFile);
  } catch {
    /* no decals */
  }
}
