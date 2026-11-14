import type { GeoBuilder } from './builder';
import { hexToNum, type LObject } from './leveldata';
import { buildProp } from './props';

/** Emit one static object into a builder. Shared by the game and the level editor. */
export function emitShape(b: GeoBuilder, o: LObject) {
  switch (o.type) {
    case 'box':
      b.box({ pos: o.pos, size: o.size, rot: o.rot, mat: o.mat, color: hexToNum(o.color), uv: o.uv ?? 4, collide: o.collide !== false });
      break;
    case 'ramp':
      b.ramp({ pos: o.pos, size: o.size, rotY: o.rot?.[1] ?? 0, mat: o.mat, color: hexToNum(o.color), uv: o.uv ?? 4, collide: o.collide !== false });
      break;
    case 'stairs':
      b.stairs({ pos: o.pos, size: o.size, rotY: o.rot?.[1] ?? 0, steps: o.steps, mat: o.mat, color: hexToNum(o.color), uv: o.uv ?? 4 });
      break;
    case 'cyl':
      b.cyl({ pos: o.pos, r: o.r, h: o.h, sides: o.sides ?? 10, rot: o.rot, mat: o.mat, color: hexToNum(o.color), uv: o.uv ?? 2, collide: o.collide !== false });
      break;
    case 'prop':
      buildProp(b, o.prop, o.pos, o.rot ?? [0, 0, 0], { color: o.color ? hexToNum(o.color) : undefined, variant: o.variant, text: o.text, scale: o.scale });
      break;
  }
}

export const isShape = (o: LObject) => o.type === 'box' || o.type === 'ramp' || o.type === 'stairs' || o.type === 'cyl' || o.type === 'prop';

