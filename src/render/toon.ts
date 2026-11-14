import * as THREE from 'three';

/** Brand + world palette. Everything visual pulls from here so the look stays coherent. */
export const PAL = {
  ink: 0x0b0b12,
  // MonoMart
  smile: 0xffd21f,
  shell: 0xf2ecd9,
  shellDark: 0xc9c2ae,
  screen: 0x11131a,
  mgmt: 0x22232b,
  gold: 0xd9a52b,
  // Local 404
  hivis: 0xff7a1a,
  denim: 0x3d5a80,
  rust: 0xa5482e,
  skin1: 0xe2a47c,
  skin2: 0x9c6a4a,
  tux: 0x1b1c24,
  shirt: 0xf4f1e8,
  // world
  sand: 0xd9a066,
  sandDark: 0xb87a4b,
  rock: 0x9a6a55,
  rockDark: 0x6e4a41,
  asphalt: 0x4b4852,
  concrete: 0xb9b3a8,
  concreteDark: 0x8d8880,
  steel: 0x7d8a99,
  steelDark: 0x4d5663,
  wood: 0xb07a45,
  // containers
  cRed: 0xb5442f,
  cBlue: 0x2f6f9f,
  cTeal: 0x2e9b8f,
  cYellow: 0xe0a82e,
  cGreen: 0x5a8f4a,
  cWhite: 0xe6e0d0,
  // fx
  fire: 0xff7b1c,
  shock: 0x53c7ff,
  acid: 0x9be22d,
  glass: 0x9fd8e8,
} as const;

/** Loot rarity colours (index = tier). */
export const RARITY_COLORS = [0xf2f2f2, 0x3ddc5a, 0x3f9bff, 0xb14dff, 0xff9a1f] as const;
export const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'] as const;
export const ELEMENT_COLORS = { none: 0xffffff, fire: PAL.fire, shock: PAL.shock, acid: PAL.acid } as const;

function makeGradient(steps: number[]) {
  const data = new Uint8Array(steps.length);
  steps.forEach((s, i) => (data[i] = Math.round(Math.min(1, Math.max(0, s)) * 255)));
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Toon ramps. The texture is sampled with N·L*0.5+0.5, so the middle of the strip is the terminator.
 * World: two hard tones + a narrow bright band. Character: same, slightly softer mid.
 */
export const RAMP_WORLD = makeGradient([0, 0, 0, 0, 0, 0, 0, 0.62, 0.62, 0.62, 0.62, 0.62, 0.85, 0.85, 1, 1]);
export const RAMP_CHAR = makeGradient([0, 0, 0, 0, 0, 0, 0, 0.1, 0.7, 0.7, 0.7, 0.7, 0.7, 1, 1, 1]);
export const RAMP_METAL = makeGradient([0, 0, 0, 0, 0, 0, 0.25, 0.25, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 1.25, 1.25]);

export interface ToonOpts {
  color?: number;
  map?: THREE.Texture | null;
  vertexColors?: boolean;
  emissive?: number;
  emissiveIntensity?: number;
  emissiveMap?: THREE.Texture | null;
  ramp?: THREE.Texture;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  alphaTest?: number;
  /** hard rim light strength (0 = off) */
  rim?: number;
  name?: string;
}

const cache = new Map<string, THREE.MeshToonMaterial>();

/** Cached toon material factory. Same options -> same material instance (keeps draw-call state changes low). */
export function toon(o: ToonOpts = {}): THREE.MeshToonMaterial {
  const key = [
    o.color ?? 0xffffff,
    o.map ? o.map.uuid : '-',
    o.vertexColors ? 1 : 0,
    o.emissive ?? 0,
    o.emissiveIntensity ?? 1,
    o.emissiveMap ? o.emissiveMap.uuid : '-',
    (o.ramp ?? RAMP_WORLD).uuid,
    o.side ?? THREE.FrontSide,
    o.transparent ? 1 : 0,
    o.opacity ?? 1,
    o.alphaTest ?? 0,
    o.rim ?? 0,
  ].join('|');
  let m = cache.get(key);
  if (m) return m;
  m = new THREE.MeshToonMaterial({
    color: o.color ?? 0xffffff,
    map: o.map ?? null,
    vertexColors: !!o.vertexColors,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    emissiveMap: o.emissiveMap ?? null,
    gradientMap: o.ramp ?? RAMP_WORLD,
    side: o.side ?? THREE.FrontSide,
    transparent: !!o.transparent,
    opacity: o.opacity ?? 1,
    alphaTest: o.alphaTest ?? 0,
  });
  if (o.name) m.name = o.name;
  const rim = o.rim ?? 0;
  if (rim > 0) {
    // Hard-edged rim light: a classic cel-shading accent that separates characters and guns from the background.
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uRim = { value: rim };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uRim;')
        .replace(
          '#include <opaque_fragment>',
          `float rimF = 1.0 - saturate(dot(normalize(vViewPosition), normal));
           outgoingLight += diffuseColor.rgb * step(0.72, rimF) * uRim;
           #include <opaque_fragment>`,
        );
    };
    m.customProgramCacheKey = () => 'rim' + rim;
  }
  cache.set(key, m);
  return m;
}

/** Unlit flat colour (screens, glows, UI-in-world). */
const basicCache = new Map<string, THREE.MeshBasicMaterial>();
export function flat(color: number, opts: { transparent?: boolean; opacity?: number; additive?: boolean; side?: THREE.Side; map?: THREE.Texture; depthWrite?: boolean; fog?: boolean } = {}) {
  const key = [color, opts.transparent ? 1 : 0, opts.opacity ?? 1, opts.additive ? 1 : 0, opts.side ?? 0, opts.map?.uuid ?? '-', opts.depthWrite ?? 'd', opts.fog ?? 'f'].join('|');
  let m = basicCache.get(key);
  if (m) return m;
  m = new THREE.MeshBasicMaterial({
    color,
    transparent: !!opts.transparent || !!opts.additive,
    opacity: opts.opacity ?? 1,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: opts.side ?? THREE.FrontSide,
    map: opts.map ?? null,
    depthWrite: opts.depthWrite ?? !(opts.transparent || opts.additive),
    fog: opts.fog ?? true,
  });
  basicCache.set(key, m);
  return m;
}

export const tmpColor = new THREE.Color();

/** Multiply a hex colour's brightness. */
export function shade(hex: number, f: number) {
  tmpColor.setHex(hex);
  tmpColor.multiplyScalar(f);
  return tmpColor.getHex();
}

export function mixHex(a: number, b: number, t: number) {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return ca.lerp(cb, t).getHex();
}
