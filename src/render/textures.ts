import * as THREE from 'three';
import { Rng } from '../core/math';

/**
 * Procedural "hand-inked" textures. They are near-white so vertex colours tint them:
 * one texture + one material serves any number of colours.
 */

type Draw = (g: CanvasRenderingContext2D, s: number, r: Rng) => void;

function make(size: number, seed: number, draw: Draw, opts: { repeat?: boolean; srgb?: boolean } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size, new Rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  return t;
}

const INK = 'rgba(11,11,18,';

/** Wobbly hand-drawn line. Wraps around the tile so the texture stays seamless. */
function inkLine(g: CanvasRenderingContext2D, s: number, r: Rng, x0: number, y0: number, x1: number, y1: number, w: number, a: number, wobble = 1.2) {
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 10));
  for (let ox = -s; ox <= s; ox += s) {
    for (let oy = -s; oy <= s; oy += s) {
      const minX = Math.min(x0, x1) + ox;
      const maxX = Math.max(x0, x1) + ox;
      const minY = Math.min(y0, y1) + oy;
      const maxY = Math.max(y0, y1) + oy;
      if (maxX < -4 || minX > s + 4 || maxY < -4 || minY > s + 4) continue;
      g.beginPath();
      g.strokeStyle = INK + a + ')';
      g.lineWidth = w;
      g.lineCap = 'round';
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // deterministic wobble: reuse rng stream only on the centre copy
        const jx = Math.sin(t * 9.1 + x0 * 0.37 + y0) * wobble;
        const jy = Math.cos(t * 7.3 + y0 * 0.41 + x0) * wobble;
        const x = x0 + (x1 - x0) * t + jx + ox;
        const y = y0 + (y1 - y0) * t + jy + oy;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
}

function speckle(g: CanvasRenderingContext2D, s: number, r: Rng, n: number, a0: number, a1: number, r0 = 0.5, r1 = 1.6) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = INK + r.range(a0, a1) + ')';
    g.beginPath();
    g.arc(r.range(0, s), r.range(0, s), r.range(r0, r1), 0, Math.PI * 2);
    g.fill();
  }
}

function hatch(g: CanvasRenderingContext2D, s: number, r: Rng, cx: number, cy: number, len: number, n: number, ang: number, a: number) {
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  for (let i = 0; i < n; i++) {
    const o = (i - n / 2) * 4.5;
    const l = len * r.range(0.5, 1);
    const px = cx - dy * o;
    const py = cy + dx * o;
    inkLine(g, s, r, px - (dx * l) / 2, py - (dy * l) / 2, px + (dx * l) / 2, py + (dy * l) / 2, 1.1, a, 0.6);
  }
}

function blotches(g: CanvasRenderingContext2D, s: number, r: Rng, n: number, shade: string, a: number, rad: [number, number]) {
  for (let i = 0; i < n; i++) {
    const x = r.range(0, s);
    const y = r.range(0, s);
    const rr = r.range(rad[0], rad[1]);
    for (let ox = -s; ox <= s; ox += s)
      for (let oy = -s; oy <= s; oy += s) {
        g.fillStyle = shade.replace('A', String(a));
        g.beginPath();
        g.ellipse(x + ox, y + oy, rr, rr * r.range(0.5, 1), r.range(0, 3), 0, Math.PI * 2);
        g.fill();
      }
  }
}

export interface TexSet {
  plain: THREE.Texture;
  concrete: THREE.Texture;
  panel: THREE.Texture;
  corrugated: THREE.Texture;
  asphalt: THREE.Texture;
  sand: THREE.Texture;
  rock: THREE.Texture;
  wood: THREE.Texture;
  hazard: THREE.Texture;
  tile: THREE.Texture;
  grate: THREE.Texture;
  cardboard: THREE.Texture;
}

let cached: TexSet | null = null;

export function textures(): TexSet {
  if (cached) return cached;
  const S = 256;
  cached = {
    plain: make(S, 1, (g, s, r) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, s, s);
      speckle(g, s, r, 26, 0.04, 0.12);
      for (let i = 0; i < 3; i++) hatch(g, s, r, r.range(0, s), r.range(0, s), 26, 4, r.range(0.5, 1.0), 0.1);
    }),

    concrete: make(S, 2, (g, s, r) => {
      g.fillStyle = '#f4f1ea';
      g.fillRect(0, 0, s, s);
      blotches(g, s, r, 9, 'rgba(120,110,100,A)', 0.12, [18, 46]);
      blotches(g, s, r, 6, 'rgba(255,255,255,A)', 0.35, [10, 30]);
      speckle(g, s, r, 140, 0.05, 0.22, 0.4, 1.4);
      // hairline cracks
      for (let i = 0; i < 4; i++) {
        let x = r.range(0, s);
        let y = r.range(0, s);
        let a = r.range(0, 6.28);
        for (let k = 0; k < 5; k++) {
          const l = r.range(12, 30);
          const nx = x + Math.cos(a) * l;
          const ny = y + Math.sin(a) * l;
          inkLine(g, s, r, x, y, nx, ny, r.range(0.8, 1.6), 0.5, 1.4);
          x = nx;
          y = ny;
          a += r.range(-0.9, 0.9);
        }
      }
      // expansion joints
      inkLine(g, s, r, 0, 2, s, 2, 2.2, 0.55, 0.8);
      inkLine(g, s, r, 2, 0, 2, s, 2.2, 0.55, 0.8);
    }),

    panel: make(S, 3, (g, s, r) => {
      g.fillStyle = '#f6f6f6';
      g.fillRect(0, 0, s, s);
      blotches(g, s, r, 5, 'rgba(90,100,110,A)', 0.1, [20, 50]);
      const h = s / 2;
      // panel seams
      for (const p of [0, h]) {
        inkLine(g, s, r, 0, p + 2, s, p + 2, 2.6, 0.75, 0.5);
        inkLine(g, s, r, p + 2, 0, p + 2, s, 2.6, 0.75, 0.5);
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.fillRect(0, p + 5, s, 2);
        g.fillRect(p + 5, 0, 2, s);
      }
      // rivets
      for (let ix = 0; ix < 2; ix++)
        for (let iy = 0; iy < 2; iy++)
          for (const [dx, dy] of [
            [14, 14],
            [h - 12, 14],
            [14, h - 12],
            [h - 12, h - 12],
          ]) {
            g.fillStyle = INK + '0.7)';
            g.beginPath();
            g.arc(ix * h + dx, iy * h + dy, 2.6, 0, 6.3);
            g.fill();
          }
      // scratches
      for (let i = 0; i < 14; i++) {
        const x = r.range(0, s);
        const y = r.range(0, s);
        const a = r.range(-0.4, 0.4) + (r.chance(0.5) ? 0 : 1.57);
        const l = r.range(8, 34);
        inkLine(g, s, r, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 1, r.range(0.15, 0.4), 0.5);
      }
      for (let i = 0; i < 3; i++) hatch(g, s, r, r.range(20, s - 20), r.range(20, s - 20), 22, 5, 0.8, 0.22);
    }),

    corrugated: make(S, 4, (g, s, r) => {
      g.fillStyle = '#f2f2f2';
      g.fillRect(0, 0, s, s);
      const n = 8;
      const w = s / n;
      for (let i = 0; i < n; i++) {
        g.fillStyle = 'rgba(0,0,0,0.16)';
        g.fillRect(i * w + w * 0.55, 0, w * 0.45, s);
        g.fillStyle = 'rgba(255,255,255,0.55)';
        g.fillRect(i * w + 2, 0, 3, s);
        inkLine(g, s, r, i * w + w * 0.55, 0, i * w + w * 0.55, s, 1.8, 0.6, 0.4);
        inkLine(g, s, r, i * w + 0.5, 0, i * w + 0.5, s, 1.2, 0.35, 0.4);
      }
      // rust streaks + dings
      for (let i = 0; i < 9; i++) {
        const x = r.range(0, s);
        const y = r.range(0, s);
        g.fillStyle = 'rgba(90,50,30,' + r.range(0.08, 0.2) + ')';
        g.fillRect(x, y, r.range(3, 9), r.range(20, 70));
      }
      speckle(g, s, r, 40, 0.1, 0.3, 0.6, 2);
    }),

    asphalt: make(S, 5, (g, s, r) => {
      g.fillStyle = '#efefef';
      g.fillRect(0, 0, s, s);
      blotches(g, s, r, 10, 'rgba(0,0,0,A)', 0.1, [16, 44]);
      speckle(g, s, r, 420, 0.08, 0.32, 0.4, 1.3);
      for (let i = 0; i < 120; i++) {
        g.fillStyle = 'rgba(255,255,255,' + r.range(0.2, 0.6) + ')';
        g.fillRect(r.range(0, s), r.range(0, s), 1.4, 1.4);
      }
      for (let i = 0; i < 3; i++) {
        let x = r.range(0, s);
        let y = r.range(0, s);
        let a = r.range(0, 6.28);
        for (let k = 0; k < 6; k++) {
          const l = r.range(14, 30);
          const nx = x + Math.cos(a) * l;
          const ny = y + Math.sin(a) * l;
          inkLine(g, s, r, x, y, nx, ny, 1.5, 0.55, 1.6);
          x = nx;
          y = ny;
          a += r.range(-1, 1);
        }
      }
    }),

    sand: make(S, 6, (g, s, r) => {
      g.fillStyle = '#fbf7ef';
      g.fillRect(0, 0, s, s);
      blotches(g, s, r, 8, 'rgba(150,100,60,A)', 0.1, [20, 54]);
      // wind ripples: short curved dashes
      for (let i = 0; i < 46; i++) {
        const x = r.range(0, s);
        const y = r.range(0, s);
        const l = r.range(8, 26);
        inkLine(g, s, r, x, y, x + l, y + r.range(-3, 3), 1.1, r.range(0.12, 0.3), 1.5);
      }
      speckle(g, s, r, 90, 0.08, 0.25, 0.5, 1.3);
    }),

    rock: make(S, 7, (g, s, r) => {
      g.fillStyle = '#f3efe9';
      g.fillRect(0, 0, s, s);
      blotches(g, s, r, 9, 'rgba(60,40,40,A)', 0.14, [16, 50]);
      // strata lines
      for (let i = 0; i < 9; i++) {
        const y = r.range(0, s);
        let x = 0;
        while (x < s) {
          const l = r.range(20, 70);
          if (r.chance(0.75)) inkLine(g, s, r, x, y + r.range(-3, 3), x + l, y + r.range(-3, 3), r.range(1, 2.2), r.range(0.3, 0.6), 2);
          x += l + r.range(4, 20);
        }
      }
      for (let i = 0; i < 6; i++) hatch(g, s, r, r.range(0, s), r.range(0, s), 28, 6, r.range(0.6, 1.2), 0.25);
      speckle(g, s, r, 60, 0.1, 0.3);
    }),

    wood: make(S, 8, (g, s, r) => {
      g.fillStyle = '#f7f1e6';
      g.fillRect(0, 0, s, s);
      const n = 4;
      const w = s / n;
      for (let i = 0; i < n; i++) {
        g.fillStyle = 'rgba(110,70,30,' + r.range(0.02, 0.16) + ')';
        g.fillRect(i * w, 0, w, s);
        inkLine(g, s, r, i * w + 1.5, 0, i * w + 1.5, s, 2.4, 0.7, 0.6);
        for (let k = 0; k < 7; k++) {
          const x = i * w + r.range(8, w - 8);
          const y = r.range(0, s);
          inkLine(g, s, r, x, y, x + r.range(-3, 3), y + r.range(20, 80), 1, r.range(0.15, 0.35), 1.2);
        }
        // nails
        for (const y of [10, s - 10]) {
          g.fillStyle = INK + '0.65)';
          g.beginPath();
          g.arc(i * w + w / 2, y, 2.2, 0, 6.3);
          g.fill();
        }
      }
    }),

    hazard: make(S, 9, (g, s) => {
      g.fillStyle = '#ffd21f';
      g.fillRect(0, 0, s, s);
      g.fillStyle = '#15151c';
      const w = s / 4;
      for (let i = -4; i < 8; i++) {
        g.beginPath();
        g.moveTo(i * w, 0);
        g.lineTo(i * w + w / 2, 0);
        g.lineTo(i * w + w / 2 + s, s);
        g.lineTo(i * w + s, s);
        g.closePath();
        g.fill();
      }
    }),

    tile: make(S, 10, (g, s, r) => {
      g.fillStyle = '#f7f7f4';
      g.fillRect(0, 0, s, s);
      const n = 2;
      const w = s / n;
      for (let ix = 0; ix < n; ix++)
        for (let iy = 0; iy < n; iy++) {
          if ((ix + iy) % 2 === 0) {
            g.fillStyle = 'rgba(0,0,0,0.09)';
            g.fillRect(ix * w, iy * w, w, w);
          }
          inkLine(g, s, r, ix * w + 1, 0, ix * w + 1, s, 1.8, 0.5, 0.4);
          inkLine(g, s, r, 0, iy * w + 1, s, iy * w + 1, 1.8, 0.5, 0.4);
        }
      speckle(g, s, r, 50, 0.05, 0.18);
      for (let i = 0; i < 5; i++) {
        const x = r.range(0, s);
        const y = r.range(0, s);
        inkLine(g, s, r, x, y, x + r.range(-20, 20), y + r.range(-20, 20), 1, 0.2, 1);
      }
    }),

    grate: make(S, 11, (g, s, r) => {
      g.fillStyle = '#e8e8e8';
      g.fillRect(0, 0, s, s);
      const n = 8;
      const w = s / n;
      for (let ix = 0; ix < n; ix++)
        for (let iy = 0; iy < n; iy++) {
          g.fillStyle = 'rgba(11,11,18,0.72)';
          g.fillRect(ix * w + 5, iy * w + 5, w - 10, w - 10);
        }
      speckle(g, s, r, 30, 0.1, 0.3);
    }),

    cardboard: make(S, 12, (g, s, r) => {
      g.fillStyle = '#f6efe2';
      g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 6) {
        g.fillStyle = 'rgba(120,80,40,' + r.range(0.03, 0.1) + ')';
        g.fillRect(0, y, s, 2);
      }
      // tape strip + flap seam
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillRect(0, s / 2 - 14, s, 28);
      inkLine(g, s, r, 0, s / 2 - 14, s, s / 2 - 14, 1.5, 0.45, 0.5);
      inkLine(g, s, r, 0, s / 2 + 14, s, s / 2 + 14, 1.5, 0.45, 0.5);
      inkLine(g, s, r, 0, 2, s, 2, 2.2, 0.6, 0.5);
      inkLine(g, s, r, 2, 0, 2, s, 2.2, 0.6, 0.5);
      speckle(g, s, r, 40, 0.06, 0.2);
    }),
  };
  return cached;
}

/** Text / logo sign painted to a canvas. Returns a non-repeating sRGB texture. */
export function signTexture(
  w: number,
  h: number,
  paint: (g: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  paint(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

/** The MonoMart smile mark: a wide grin with a price-tag notch. Drawn fresh, not a copy of any real logo. */
export function drawSmile(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color = '#ffd21f', mood: 'happy' | 'angry' | 'hurt' | 'dead' | 'blank' = 'happy') {
  g.save();
  g.translate(cx, cy);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = r * 0.2;
  const ex = r * 0.42;
  const ey = -r * 0.28;
  const er = r * 0.13;
  if (mood === 'dead') {
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(sx * ex - er, ey - er);
      g.lineTo(sx * ex + er, ey + er);
      g.moveTo(sx * ex + er, ey - er);
      g.lineTo(sx * ex - er, ey + er);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(-r * 0.45, r * 0.4);
    g.lineTo(r * 0.45, r * 0.4);
    g.stroke();
  } else if (mood === 'blank') {
    g.beginPath();
    g.moveTo(-r * 0.5, 0);
    g.lineTo(r * 0.5, 0);
    g.stroke();
  } else {
    // eyes
    for (const sx of [-1, 1]) {
      g.beginPath();
      if (mood === 'angry') {
        g.moveTo(sx * (ex - er * 1.6), ey - er * 1.5);
        g.lineTo(sx * (ex + er * 1.4), ey + er * 0.2);
        g.stroke();
        g.beginPath();
        g.arc(sx * ex, ey + er * 0.9, er * 0.9, 0, Math.PI * 2);
        g.fill();
      } else if (mood === 'hurt') {
        g.moveTo(sx * (ex - er * 1.3), ey - er);
        g.lineTo(sx * (ex + er * 0.4), ey);
        g.lineTo(sx * (ex - er * 1.3), ey + er);
        g.stroke();
      } else {
        g.arc(sx * ex, ey, er, 0, Math.PI * 2);
        g.fill();
      }
    }
    // mouth
    g.beginPath();
    if (mood === 'happy') {
      g.arc(0, -r * 0.05, r * 0.62, Math.PI * 0.14, Math.PI * 0.86);
    } else if (mood === 'angry') {
      g.arc(0, r * 0.95, r * 0.6, Math.PI * 1.22, Math.PI * 1.78);
    } else {
      // hurt: wobbly
      g.moveTo(-r * 0.5, r * 0.42);
      g.lineTo(-r * 0.25, r * 0.3);
      g.lineTo(0, r * 0.45);
      g.lineTo(r * 0.25, r * 0.3);
      g.lineTo(r * 0.5, r * 0.42);
    }
    g.stroke();
  }
  g.restore();
}
