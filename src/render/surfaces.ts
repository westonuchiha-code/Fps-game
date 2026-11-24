import * as THREE from 'three';
import { Rng } from '../core/math';

/**
 * Surfaces: every texture in the game is a recipe — a stack of procedural layers baked onto a
 * square, tileable canvas. Textures are near-white so the vertex colour underneath tints them
 * (one denim texture serves blue, black and brown jeans).
 *
 * - Environment surfaces (concrete, panel, asphalt...) are the textures level geometry uses; their
 *   hand-written originals in textures.ts are available to any recipe as a `builtin` layer.
 * - Model surfaces (denim, leather, robot shell, gun metal...) go into one atlas. Kit tags each part
 *   it builds with a surface (`kit.surf = 'denim'`) and the toon shader wraps that tile over the
 *   part in the model's own space, so it stays put as the model animates.
 *
 * Recipes live in public/textures/surfaces.json and are made in the texture editor (#tex).
 */

export type Blend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';

interface LayerBase {
  /** shown in the editor */
  type: string;
  seed?: number;
  opacity?: number;
  blend?: Blend;
  hidden?: boolean;
}
export type Layer = LayerBase &
  (
    | { type: 'builtin'; name: string }
    | { type: 'fill'; color: string }
    | { type: 'noise'; color: string; scale: number; amount: number; octaves?: number }
    | { type: 'speckle'; color: string; count: number; size: [number, number]; alpha: [number, number] }
    | { type: 'blotch'; color: string; count: number; size: [number, number]; alpha: number; stretch?: number }
    | { type: 'lines'; color: string; spacing: number; width: number; angle: number; alpha: number; wobble?: number; jitter?: number }
    | { type: 'weave'; color: string; spacing: number; width: number; alpha: number }
    | { type: 'grid'; color: string; cols: number; rows: number; width: number; alpha: number; offsetRows?: boolean; bevel?: number }
    | { type: 'stripes'; color: string; width: number; gap: number; angle: number; alpha: number }
    | { type: 'scratches'; color: string; count: number; length: [number, number]; width: number; alpha: number; angle?: number; spread?: number }
    | { type: 'cracks'; color: string; count: number; segments: number; length: [number, number]; width: number; alpha: number }
    | { type: 'stitches'; color: string; spacing: number; dash: number; width: number; angle: number; alpha: number; offset?: number; every?: number }
    | { type: 'gradient'; color: string; from: number; to: number; alphaFrom: number; alphaTo: number; vertical?: boolean }
    | { type: 'dots'; color: string; spacing: number; radius: number; alpha: number; offsetRows?: boolean }
  );

export interface Surface {
  /** 'env' textures cover level geometry; 'model' textures go in the model atlas */
  use: 'env' | 'model';
  /** model surfaces: how many times the tile repeats per metre */
  perMetre?: number;
  layers: Layer[];
  note?: string;
}
export interface SurfaceFile {
  version: 1;
  surfaces: Record<string, Surface>;
}

/** Defaults for every layer type (what the editor adds). */
export const LAYER_DEFAULTS: Record<Layer['type'], Layer> = {
  builtin: { type: 'builtin', name: 'concrete' },
  fill: { type: 'fill', color: '#ffffff' },
  noise: { type: 'noise', color: '#5a5048', scale: 8, amount: 0.15, octaves: 3 },
  speckle: { type: 'speckle', color: '#0b0b12', count: 120, size: [0.4, 1.4], alpha: [0.05, 0.2] },
  blotch: { type: 'blotch', color: '#786e64', count: 8, size: [14, 40], alpha: 0.12, stretch: 0.6 },
  lines: { type: 'lines', color: '#0b0b12', spacing: 16, width: 1, angle: 0, alpha: 0.2, wobble: 0.6, jitter: 0 },
  weave: { type: 'weave', color: '#0b0b12', spacing: 4, width: 1, alpha: 0.12 },
  grid: { type: 'grid', color: '#0b0b12', cols: 2, rows: 2, width: 2, alpha: 0.4, offsetRows: false, bevel: 0 },
  stripes: { type: 'stripes', color: '#0b0b12', width: 24, gap: 24, angle: 45, alpha: 1 },
  scratches: { type: 'scratches', color: '#ffffff', count: 30, length: [8, 30], width: 1, alpha: 0.35, angle: 0, spread: 180 },
  cracks: { type: 'cracks', color: '#0b0b12', count: 4, segments: 5, length: [12, 30], width: 0.9, alpha: 0.35 },
  stitches: { type: 'stitches', color: '#d8c890', spacing: 64, dash: 5, width: 1.2, angle: 90, alpha: 0.8, offset: 0, every: 1 },
  gradient: { type: 'gradient', color: '#2a2018', from: 0.5, to: 1, alphaFrom: 0, alphaTo: 0.3, vertical: true },
  dots: { type: 'dots', color: '#0b0b12', spacing: 16, radius: 2, alpha: 0.3, offsetRows: true },
};

export const SURFACES: Record<string, Surface> = {};

/**
 * Surface by colour for any Kit model that does not say otherwise (vehicles, props, pickups): the
 * shared palette colours each get a sensible material.
 */
export const COLOR_SURF = new Map<number, string>([
  // vehicles: the Teamster's paint, dark metal and cage; tyres; seats
  [0xb4462b, 'vehicle_paint'], [0xd0612c, 'vehicle_paint'], [0x2c2d33, 'gun_metal'], [0x3a3f47, 'gun_metal'], [0x34343c, 'gun_metal'], [0x3b3f46, 'gun_metal'],
  [0x1d1d22, 'tire'], [0x26262c, 'tire'], [0x2b2b30, 'canvas'], [0x2a2b31, 'rubber'],
  // palette: steel, container colours, MonoMart cream and yellow, wood
  [0x7d8a99, 'painted_metal'], [0x4d5663, 'painted_metal'], [0xe0a82e, 'painted_metal'], [0xb5442f, 'painted_metal'], [0x2f6f9f, 'painted_metal'],
  [0x2e9b8f, 'painted_metal'], [0x5a8f4a, 'painted_metal'], [0xe6e0d0, 'painted_metal'],
  [0xf2ecd9, 'scooter_paint'], [0xc9c2ae, 'scooter_paint'], [0xffd21f, 'scooter_paint'], [0xb07a45, 'wood_stock'],
]);

/** Built-in drawings from textures.ts: name -> painter (registered there). */
export const BUILTINS: Record<string, (g: CanvasRenderingContext2D, s: number) => void> = {};

// ------------------------------------------------------------------ painting

const rgba = (hex: string, a: number) => {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
};
const BLEND: Record<Blend, GlobalCompositeOperation> = { normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten' };

/** Call fn at the 9 wrapped offsets so shapes crossing an edge reappear on the other side. */
function wrap(s: number, fn: (ox: number, oy: number) => void) {
  for (let ox = -s; ox <= s; ox += s) for (let oy = -s; oy <= s; oy += s) fn(ox, oy);
}

/** Tileable value noise in [0,1]. */
function noiseField(s: number, cells: number, r: Rng) {
  const n = Math.max(1, Math.round(cells));
  const lat = new Float32Array(n * n);
  for (let i = 0; i < lat.length; i++) lat[i] = r.next();
  const out = new Float32Array(s * s);
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const fx = (x / s) * n;
      const fy = (y / s) * n;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const a = lat[(y0 % n) * n + (x0 % n)];
      const b = lat[(y0 % n) * n + ((x0 + 1) % n)];
      const c = lat[((y0 + 1) % n) * n + (x0 % n)];
      const d = lat[((y0 + 1) % n) * n + ((x0 + 1) % n)];
      out[y * s + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  return out;
}

function line(g: CanvasRenderingContext2D, s: number, x0: number, y0: number, x1: number, y1: number, wobble: number, seed: number) {
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8));
  wrap(s, (ox, oy) => {
    if (Math.max(x0, x1) + ox < -4 || Math.min(x0, x1) + ox > s + 4 || Math.max(y0, y1) + oy < -4 || Math.min(y0, y1) + oy > s + 4) return;
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const jx = Math.sin(t * 9.1 + seed) * wobble;
      const jy = Math.cos(t * 7.3 + seed * 1.7) * wobble;
      const x = x0 + (x1 - x0) * t + jx + ox;
      const y = y0 + (y1 - y0) * t + jy + oy;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  });
}

/** Lines across the whole tile at an angle, `spacing` apart (wrapping cleanly for 0/45/90°). */
function parallel(s: number, angle: number, spacing: number, fn: (x0: number, y0: number, x1: number, y1: number, i: number) => void) {
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const L = s * 1.5;
  const n = Math.ceil((s * 1.5) / Math.max(1, spacing));
  for (let i = -n; i <= n; i++) {
    const o = i * spacing;
    const cx = s / 2 - dy * o;
    const cy = s / 2 + dx * o;
    fn(cx - dx * L, cy - dy * L, cx + dx * L, cy + dy * L, i);
  }
}

export function paintLayer(g: CanvasRenderingContext2D, s: number, L: Layer) {
  const r = new Rng((L.seed ?? 1) * 7919 + 13);
  g.save();
  g.globalAlpha = L.opacity ?? 1;
  g.globalCompositeOperation = BLEND[L.blend ?? 'normal'];
  g.lineCap = 'round';
  switch (L.type) {
    case 'builtin': {
      const f = BUILTINS[L.name];
      if (f) {
        const c = document.createElement('canvas');
        c.width = c.height = s;
        f(c.getContext('2d')!, s);
        g.drawImage(c, 0, 0);
      }
      break;
    }
    case 'fill':
      g.fillStyle = L.color;
      g.fillRect(0, 0, s, s);
      break;
    case 'noise': {
      const img = g.createImageData(s, s);
      const c = new THREE.Color(L.color);
      const acc = new Float32Array(s * s);
      let amp = 1;
      let tot = 0;
      for (let o = 0; o < (L.octaves ?? 3); o++) {
        const f = noiseField(s, L.scale * 2 ** o, r);
        for (let i = 0; i < acc.length; i++) acc[i] += f[i] * amp;
        tot += amp;
        amp *= 0.5;
      }
      for (let i = 0; i < acc.length; i++) {
        const v = acc[i] / tot;
        img.data[i * 4] = c.r * 255;
        img.data[i * 4 + 1] = c.g * 255;
        img.data[i * 4 + 2] = c.b * 255;
        img.data[i * 4 + 3] = Math.max(0, Math.min(255, v * L.amount * 2 * 255));
      }
      const tmp = document.createElement('canvas');
      tmp.width = tmp.height = s;
      tmp.getContext('2d')!.putImageData(img, 0, 0);
      g.drawImage(tmp, 0, 0);
      break;
    }
    case 'speckle':
      for (let i = 0; i < L.count; i++) {
        const x = r.range(0, s);
        const y = r.range(0, s);
        const rad = r.range(L.size[0], L.size[1]);
        g.fillStyle = rgba(L.color, r.range(L.alpha[0], L.alpha[1]));
        wrap(s, (ox, oy) => {
          g.beginPath();
          g.arc(x + ox, y + oy, rad, 0, Math.PI * 2);
          g.fill();
        });
      }
      break;
    case 'blotch':
      g.fillStyle = rgba(L.color, L.alpha);
      for (let i = 0; i < L.count; i++) {
        const x = r.range(0, s);
        const y = r.range(0, s);
        const rr = r.range(L.size[0], L.size[1]);
        const sq = r.range(L.stretch ?? 0.5, 1);
        const rot = r.range(0, 3.14);
        wrap(s, (ox, oy) => {
          g.beginPath();
          g.ellipse(x + ox, y + oy, rr, rr * sq, rot, 0, Math.PI * 2);
          g.fill();
        });
      }
      break;
    case 'lines':
      g.strokeStyle = rgba(L.color, L.alpha);
      g.lineWidth = L.width;
      parallel(s, L.angle, L.spacing, (x0, y0, x1, y1, i) => {
        const j = (L.jitter ?? 0) * (r.next() - 0.5) * L.spacing;
        const a = (L.angle * Math.PI) / 180;
        line(g, s, x0 - Math.sin(a) * j, y0 + Math.cos(a) * j, x1 - Math.sin(a) * j, y1 + Math.cos(a) * j, L.wobble ?? 0, i * 3.1 + (L.seed ?? 1));
      });
      break;
    case 'weave': {
      // over-under fabric: short dashes alternating direction in a checker
      g.strokeStyle = rgba(L.color, L.alpha);
      g.lineWidth = L.width;
      const n = Math.max(2, Math.round(s / L.spacing));
      const st = s / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          g.beginPath();
          if ((x + y) % 2) {
            g.moveTo(x * st + 0.5, y * st + st / 2);
            g.lineTo(x * st + st - 0.5, y * st + st / 2);
          } else {
            g.moveTo(x * st + st / 2, y * st + 0.5);
            g.lineTo(x * st + st / 2, y * st + st - 0.5);
          }
          g.stroke();
        }
      break;
    }
    case 'grid': {
      const cw = s / Math.max(1, L.cols);
      const rh = s / Math.max(1, L.rows);
      g.strokeStyle = rgba(L.color, L.alpha);
      g.lineWidth = L.width;
      for (let y = 0; y < L.rows; y++) {
        const off = L.offsetRows && y % 2 ? cw / 2 : 0;
        for (let x = -1; x <= L.cols; x++) {
          const px = x * cw + off;
          wrap(s, (ox, oy) => g.strokeRect(px + ox, y * rh + oy, cw, rh));
          if (L.bevel) {
            g.save();
            g.strokeStyle = rgba('#ffffff', L.alpha * 0.8);
            g.lineWidth = L.bevel;
            g.beginPath();
            g.moveTo(px + L.width + L.bevel, y * rh + rh - L.width - L.bevel);
            g.lineTo(px + L.width + L.bevel, y * rh + L.width + L.bevel);
            g.lineTo(px + cw - L.width - L.bevel, y * rh + L.width + L.bevel);
            g.stroke();
            g.restore();
          }
        }
      }
      break;
    }
    case 'stripes': {
      g.fillStyle = rgba(L.color, L.alpha);
      const a = (L.angle * Math.PI) / 180;
      g.translate(s / 2, s / 2);
      g.rotate(a);
      const per = L.width + L.gap;
      for (let x = -s * 1.5; x < s * 1.5; x += per) g.fillRect(x, -s * 1.5, L.width, s * 3);
      break;
    }
    case 'scratches':
      g.strokeStyle = rgba(L.color, L.alpha);
      g.lineWidth = L.width;
      for (let i = 0; i < L.count; i++) {
        const x = r.range(0, s);
        const y = r.range(0, s);
        const len = r.range(L.length[0], L.length[1]);
        const a = (((L.angle ?? 0) + r.range(-1, 1) * (L.spread ?? 180)) * Math.PI) / 180;
        line(g, s, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 0.4, i);
      }
      break;
    case 'cracks':
      g.strokeStyle = rgba(L.color, L.alpha);
      g.lineWidth = L.width;
      for (let i = 0; i < L.count; i++) {
        let x = r.range(0, s);
        let y = r.range(0, s);
        let a = r.range(0, 6.28);
        for (let k = 0; k < L.segments; k++) {
          const l = r.range(L.length[0], L.length[1]);
          const nx = x + Math.cos(a) * l;
          const ny = y + Math.sin(a) * l;
          line(g, s, x, y, nx, ny, 0.3, i * 10 + k);
          x = nx;
          y = ny;
          a += r.range(-0.9, 0.9);
        }
      }
      break;
    case 'stitches':
      g.strokeStyle = rgba(L.color, L.alpha);
      g.lineWidth = L.width;
      g.setLineDash([L.dash, L.dash * 0.8]);
      parallel(s, L.angle, L.spacing, (x0, y0, x1, y1, i) => {
        if ((((i % (L.every ?? 1)) + (L.every ?? 1)) % (L.every ?? 1)) !== 0) return;
        const a = (L.angle * Math.PI) / 180;
        const o = L.offset ?? 0;
        g.beginPath();
        g.moveTo(x0 - Math.sin(a) * o, y0 + Math.cos(a) * o);
        g.lineTo(x1 - Math.sin(a) * o, y1 + Math.cos(a) * o);
        g.stroke();
      });
      g.setLineDash([]);
      break;
    case 'gradient': {
      const gr = L.vertical === false ? g.createLinearGradient(L.from * s, 0, L.to * s, 0) : g.createLinearGradient(0, L.from * s, 0, L.to * s);
      gr.addColorStop(0, rgba(L.color, L.alphaFrom));
      gr.addColorStop(1, rgba(L.color, L.alphaTo));
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
      break;
    }
    case 'dots': {
      g.fillStyle = rgba(L.color, L.alpha);
      const n = Math.max(1, Math.round(s / L.spacing));
      const st = s / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const ox = L.offsetRows && y % 2 ? st / 2 : 0;
          wrap(s, (wx, wy) => {
            g.beginPath();
            g.arc(x * st + st / 2 + ox + wx, y * st + st / 2 + wy, L.radius, 0, Math.PI * 2);
            g.fill();
          });
        }
      break;
    }
  }
  g.restore();
}

/** Paint a whole recipe onto a canvas context of size s. */
export function paintSurface(g: CanvasRenderingContext2D, s: number, sf: Surface) {
  g.save();
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, s, s);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, s, s);
  g.restore();
  for (const L of sf.layers) if (!L.hidden) paintLayer(g, s, L);
}

// ------------------------------------------------------------------ registry

/** Model surface name -> atlas slot. Slot 0 means "no texture". Stable for the session. */
const SLOT = new Map<string, number>();
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;
export const TILE = 256;
const MAX = ATLAS_COLS * ATLAS_ROWS;

/** Slot of a model surface (registers it if new). Kit stores this per vertex. */
export function surfaceSlot(name: string | null | undefined) {
  if (!name) return 0;
  let i = SLOT.get(name);
  if (i === undefined) {
    i = SLOT.size + 1;
    if (i >= MAX) return 0;
    SLOT.set(name, i);
    repaintSlot(name);
  }
  return i;
}

let atlasCanvas: HTMLCanvasElement | null = null;
let atlasTex: THREE.CanvasTexture | null = null;
/** tiles per metre for each slot */
export const SLOT_SCALE = new Float32Array(MAX).fill(4);

export function atlas() {
  if (!atlasTex) {
    atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = ATLAS_COLS * TILE;
    atlasCanvas.height = ATLAS_ROWS * TILE;
    const g = atlasCanvas.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height);
    atlasTex = new THREE.CanvasTexture(atlasCanvas);
    atlasTex.colorSpace = THREE.SRGBColorSpace;
    atlasTex.anisotropy = 4;
    atlasTex.generateMipmaps = true;
    atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
    for (const n of SLOT.keys()) repaintSlot(n);
  }
  return atlasTex;
}

const tileCanvas = () => {
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  return c;
};

/** Redraw one model surface's tile in the atlas (after loading or editing its recipe). */
export function repaintSlot(name: string) {
  const i = SLOT.get(name);
  if (i === undefined || !atlasCanvas) return;
  const sf = SURFACES[name];
  const c = tileCanvas();
  const g = c.getContext('2d')!;
  if (sf) paintSurface(g, TILE, sf);
  else {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, TILE, TILE);
  }
  const ag = atlasCanvas.getContext('2d')!;
  ag.drawImage(c, (i % ATLAS_COLS) * TILE, Math.floor(i / ATLAS_COLS) * TILE);
  SLOT_SCALE[i] = sf?.perMetre ?? 4;
  if (atlasTex) atlasTex.needsUpdate = true;
}

/** Environment textures by name, repainted from recipes when those exist (see textures.ts). */
export const ENV_TEX: Record<string, THREE.CanvasTexture> = {};

/** Redraw one surface wherever it is used. */
export function repaint(name: string) {
  const sf = SURFACES[name];
  if (SLOT.has(name)) repaintSlot(name);
  const t = ENV_TEX[name];
  if (t) {
    const c = t.image as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    if (sf) paintSurface(g, c.width, sf);
    else if (BUILTINS[name]) {
      g.clearRect(0, 0, c.width, c.width);
      BUILTINS[name](g, c.width);
    }
    t.needsUpdate = true;
  }
}

export function setSurfaces(s: Record<string, Surface>) {
  const names = new Set([...Object.keys(SURFACES), ...Object.keys(s)]);
  for (const k of Object.keys(SURFACES)) delete SURFACES[k];
  Object.assign(SURFACES, s);
  for (const n of names) repaint(n);
}

/** Load public/textures/surfaces.json (game and editors call this at start). */
export async function loadSurfaces(url = 'textures/surfaces.json') {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return;
    const f = (await r.json()) as SurfaceFile;
    setSurfaces(f.surfaces ?? {});
  } catch {
    /* hand-written textures only */
  }
}

/** GLSL for the toon shader: triplanar sample of the model atlas (see toon.ts). */
export const SURF_GLSL_VERT_HEAD = `
attribute float surf;
attribute float edge;
varying float vEdge;
varying float vSurf;
varying vec3 vSurfP;
varying vec3 vSurfN;
`;
export const SURF_GLSL_VERT = `
vSurf = surf;
vEdge = edge;
vSurfP = position;
vSurfN = normal;
`;
export const SURF_GLSL_FRAG_HEAD = `
uniform sampler2D uAtlas;
varying float vEdge;
uniform float uSurfScale[${MAX}];
varying float vSurf;
varying vec3 vSurfP;
varying vec3 vSurfN;
vec3 surfTap(vec2 uv, vec2 tile) {
  vec2 inv = vec2(${(1 / ATLAS_COLS).toFixed(6)}, ${(1 / ATLAS_ROWS).toFixed(6)});
  vec2 pad = vec2(0.01);
  vec2 f = fract(uv);
  vec2 auv = (tile + pad + f * (1.0 - 2.0 * pad)) * inv;
  vec2 dx = dFdx(uv) * inv * (1.0 - 2.0 * pad);
  vec2 dy = dFdy(uv) * inv * (1.0 - 2.0 * pad);
  return textureGrad(uAtlas, auv, dx, dy).rgb;
}
`;
export const SURF_GLSL_FRAG = `
{
  int sid = int(vSurf + 0.5);
  if (sid > 0) {
    // canvas rows count down from the top, texture rows up from the bottom
    vec2 tile = vec2(mod(float(sid), ${ATLAS_COLS}.0), ${ATLAS_ROWS - 1}.0 - floor(float(sid) / ${ATLAS_COLS}.0));
    vec3 p = vSurfP * uSurfScale[sid];
    // one tap, projected along the axis the surface faces most (cheap, and crisp for cel shading)
    vec3 an = abs(vSurfN);
    vec2 uv = an.x > an.y && an.x > an.z ? p.zy : (an.y > an.z ? p.xz : p.xy);
    diffuseColor.rgb *= surfTap(uv, tile);
  }
}
`;

/**
 * Cel bands on rounded edges: an edge strip facing up catches the light as a crisp bright stripe,
 * one facing down drops into a dark one, the way painted edge-wear reads in a comic.
 */
export const EDGE_GLSL_FRAG = `
if (vEdge > 0.5) {
  vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float u = dot(normal, upV);
  outgoingLight *= u > 0.25 ? 1.32 : (u < -0.35 ? 0.62 : 1.0);
}
`;
