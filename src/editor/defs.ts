// Static knowledge the editor has about every object type: labels, icons, colours, defaults,
// which transform handles make sense, and the palette of things you can place.
import type { MatName } from '../world/builder';
import type { EnemyKind, LObject, LType, LevelData, V3 } from '../world/leveldata';
import { newId, numToHex } from '../world/leveldata';
import { PROP_LIST, PROPS } from '../world/props';
import { PAL, RARITY_NAMES } from '../render/toon';
import { BRAND_INFO, BRANDS, CLASSES } from '../weapons/items';
import dialogue from '../data/dialogue.json';
import music from '../data/music-manifest.json';

export const SPAWN_ID = '__spawn';

export interface TypeInfo {
  label: string;
  /** single glyph used in lists */
  icon: string;
  /** css colour of the icon badge */
  color: string;
}

export const TYPE_INFO: Record<LType, TypeInfo> = {
  box: { label: 'Box', icon: '■', color: '#9aa3ad' },
  ramp: { label: 'Ramp', icon: '◢', color: '#9aa3ad' },
  stairs: { label: 'Stairs', icon: '≡', color: '#9aa3ad' },
  cyl: { label: 'Cylinder', icon: '●', color: '#9aa3ad' },
  prop: { label: 'Prop', icon: '◆', color: '#c99a5b' },
  enemy: { label: 'Enemy', icon: '☗', color: '#ff5a3c' },
  ally: { label: 'Ally', icon: '☗', color: '#3ddc5a' },
  pickup: { label: 'Pickup', icon: '+', color: '#53c7ff' },
  weapon: { label: 'Weapon', icon: '⌐', color: '#3f9bff' },
  locker: { label: 'Locker', icon: '▯', color: '#53c7ff' },
  barrel: { label: 'Explosive barrel', icon: '◉', color: '#ff7b1c' },
  vehicle: { label: 'Vehicle', icon: '⛟', color: '#e0a82e' },
  destructible: { label: 'Destructible', icon: '✸', color: '#ff7b1c' },
  trigger: { label: 'Trigger', icon: '⬚', color: '#ffd21f' },
  checkpoint: { label: 'Checkpoint', icon: '⚑', color: '#3ddc5a' },
  marker: { label: 'Marker', icon: '⌖', color: '#ff4fd8' },
  nav: { label: 'Nav area', icon: '▦', color: '#53c7ff' },
};
export const SPAWN_INFO: TypeInfo = { label: 'Player start', icon: '★', color: '#ffd21f' };

export const ENEMY_KINDS: { id: EnemyKind; label: string; color: string; hint: string }[] = [
  { id: 'assoc', label: 'Associate', color: '#ff5a3c', hint: 'Rank-and-file rifle robot. Fights in squads.' },
  { id: 'super', label: 'Supervisor', color: '#ffb300', hint: 'Shielded elite. Rallies Associates.' },
  { id: 'drone', label: 'Courier drone', color: '#c46bff', hint: 'Fragile flying harasser.' },
  { id: 'manager', label: 'Regional Manager', color: '#ff2d6f', hint: 'Heavy mech mini-boss. Weak point on its back.' },
];
export const enemyInfo = (k: string) => ENEMY_KINDS.find((e) => e.id === k) ?? ENEMY_KINDS[0];

export const ALLY_VOICES: { id: 'rivet' | 'dutch' | 'hank'; label: string }[] = [
  { id: 'rivet', label: 'Rivet' },
  { id: 'dutch', label: 'Dutch' },
  { id: 'hank', label: 'Hank (Striker)' },
];

export const PICKUP_KINDS: { id: 'ammo' | 'health' | 'mine' | 'cash'; label: string; color: string; def: number }[] = [
  { id: 'ammo', label: 'Ammo', color: '#c8b45a', def: 30 },
  { id: 'health', label: 'Health', color: '#ff5a3c', def: 30 },
  { id: 'mine', label: 'Remote mines', color: '#ff7b1c', def: 2 },
  { id: 'cash', label: 'Cash', color: '#3ddc5a', def: 25 },
];

export const WEAPON_CLASSES = CLASSES.map((c) => ({ id: c, label: { pistol: 'Pistol', rifle: 'Auto rifle', shotgun: 'Shotgun', sniper: 'Sniper' }[c] }));
export const BRAND_LIST = BRANDS.map((b) => ({ id: b, label: BRAND_INFO[b].name }));
export const RARITY_LIST = RARITY_NAMES.map((n, i) => ({ id: i, label: n }));
export const RARITY_CSS = ['#f2f2f2', '#3ddc5a', '#3f9bff', '#b14dff', '#ff9a1f'];

export const MATS: MatName[] = ['plain', 'concrete', 'panel', 'corrugated', 'asphalt', 'sand', 'rock', 'wood', 'hazard', 'tile', 'grate', 'cardboard'];
export const SKY_NAMES: LevelData['sky'][] = ['dawn', 'noon', 'dusk', 'night'];

/** props whose `text` field is shown on a sign */
export const TEXT_PROPS = new Set(['billboard', 'sign', 'union_sign']);

/** Swatches offered for any colour field. */
export const PAL_SWATCHES = [
  PAL.concrete, PAL.concreteDark, PAL.asphalt, PAL.sand, PAL.sandDark, PAL.rock, PAL.rockDark, PAL.wood,
  PAL.steel, PAL.steelDark, PAL.shell, PAL.mgmt, PAL.smile, PAL.hivis, PAL.denim, PAL.rust,
  PAL.cRed, PAL.cBlue, PAL.cTeal, PAL.cYellow, PAL.cGreen, PAL.cWhite,
].map(numToHex);

export const VOICE_LINES: { id: string; who: string; text: string }[] = (dialogue as any).lines ?? [];
export const SPEAKERS: Record<string, { name: string }> = (dialogue as any).speakers ?? {};
export const MUSIC_TRACKS: string[] = Object.keys((music as any).tracks ?? {});
export const lineText = (id: string) => VOICE_LINES.find((l) => l.id === id);

// ---- geometry helpers -------------------------------------------------------------------------

export const VOLUME_TYPES = new Set<LType>(['trigger', 'checkpoint', 'nav']);
/** types whose `pos` is the centre of a volume rather than the centre of the base */
export const CENTRE_TYPES = new Set<LType>(['box', 'trigger', 'checkpoint', 'nav']);
/** types with a `size` the scale handle edits */
export const SIZE_TYPES = new Set<LType>(['box', 'ramp', 'stairs', 'trigger', 'checkpoint', 'nav']);
/** things other objects can be dropped onto */
export const SOLID_TYPES = new Set<LType>(['box', 'ramp', 'stairs', 'cyl', 'prop', 'destructible', 'locker', 'vehicle']);

/** Which rotation axes the game honours for this type. */
export function rotAxes(t: LType | typeof SPAWN_ID): 'xyz' | 'y' | 'none' {
  if (t === 'box' || t === 'cyl' || t === 'prop') return 'xyz';
  if (t === 'trigger' || t === 'checkpoint' || t === 'nav' || t === 'barrel' || t === 'pickup') return 'none';
  return 'y';
}
export const canScale = (t: LType | typeof SPAWN_ID) => t !== SPAWN_ID && (SIZE_TYPES.has(t) || t === 'prop' || t === 'cyl');

/** Height of an object (for working out its base). */
export function objHeight(o: LObject): number {
  switch (o.type) {
    case 'box':
    case 'ramp':
    case 'stairs':
    case 'trigger':
    case 'checkpoint':
    case 'nav':
      return o.size[1];
    case 'cyl':
      return o.h;
    case 'prop':
      return (PROPS[o.prop]?.size[1] ?? 1) * (o.scale ?? 1);
    case 'destructible':
      return PROPS[o.prop]?.size[1] ?? 1;
    case 'enemy':
      return o.kind === 'manager' ? 3.2 : o.kind === 'drone' ? 2.2 : 1.85;
    case 'ally':
      return 1.8;
    case 'locker':
      return 2;
    case 'vehicle':
      return o.kind === 'teamster' ? 2 : 1.2;
    case 'barrel':
      return 0.95;
    default:
      return 0.5;
  }
}

/** Y of the bottom of an object (ignores X/Z tilt). */
export const baseY = (o: LObject) => (CENTRE_TYPES.has(o.type) ? o.pos[1] - objHeight(o) / 2 : o.pos[1]);
/** Set the object's position so its base sits at y. */
export function setBaseY(o: LObject, y: number) {
  o.pos[1] = r3(CENTRE_TYPES.has(o.type) ? y + objHeight(o) / 2 : y);
}

export const r3 = (v: number) => Math.round(v * 1000) / 1000;
export const r3v = (v: V3): V3 => [r3(v[0]), r3(v[1]), r3(v[2])];

export function displayName(o: LObject): string {
  if (o.name) return o.name;
  switch (o.type) {
    case 'prop':
    case 'destructible':
      return PROPS[o.prop]?.label ?? o.prop;
    case 'enemy':
      return enemyInfo(o.kind).label;
    case 'ally':
      return ALLY_VOICES.find((v) => v.id === o.voice)?.label ?? o.voice;
    case 'pickup':
      return PICKUP_KINDS.find((p) => p.id === o.kind)?.label ?? o.kind;
    case 'vehicle':
      return o.kind === 'teamster' ? 'Teamster 4x4' : 'Vesper scooter';
    case 'weapon':
      return o.shield ? 'Shield' : WEAPON_CLASSES.find((c) => c.id === o.cls)?.label ?? 'Random weapon';
    default:
      return TYPE_INFO[o.type].label;
  }
}

export function typeInfo(o: LObject): TypeInfo {
  if (o.type === 'enemy') return { ...TYPE_INFO.enemy, color: enemyInfo(o.kind).color };
  if (o.type === 'pickup') return { ...TYPE_INFO.pickup, color: PICKUP_KINDS.find((p) => p.id === o.kind)?.color ?? '#53c7ff' };
  return TYPE_INFO[o.type];
}

// ---- palette ------------------------------------------------------------------------------------

export interface PaletteEntry {
  key: string;
  label: string;
  hint?: string;
  /** builds a new object (position filled in later). Absent for the player start. */
  make?: () => LObject;
}
export interface PaletteGroup {
  title: string;
  entries: PaletteEntry[];
}
export interface PaletteTab {
  id: string;
  label: string;
  groups: PaletteGroup[];
}

const P0: V3 = [0, 0, 0];
const shape = (key: string, label: string, hint: string, make: () => LObject): PaletteEntry => ({ key, label, hint, make });

export const PALETTE: PaletteTab[] = [
  {
    id: 'shapes',
    label: 'Shapes',
    groups: [
      {
        title: 'Building blocks',
        entries: [
          shape('box', 'Box', '2 m concrete block', () => ({ id: newId('box'), type: 'box', pos: [...P0], size: [2, 2, 2], mat: 'concrete', color: '#b9b3a8', uv: 4 })),
          shape('wall', 'Wall', '8 m long, 3 m tall', () => ({ id: newId('wall'), type: 'box', pos: [...P0], size: [8, 3, 0.4], mat: 'concrete', color: '#b9b3a8', uv: 4 })),
          shape('floor', 'Floor slab', '10 x 10 m, 0.5 m thick', () => ({ id: newId('floor'), type: 'box', pos: [...P0], size: [10, 0.5, 10], mat: 'asphalt', color: '#4b4852', uv: 6 })),
          shape('deck', 'Raised deck', '6 x 6 m platform, 3 m up', () => ({ id: newId('deck'), type: 'box', pos: [...P0], size: [6, 3, 6], mat: 'panel', color: '#7d8a99', uv: 3 })),
          shape('ramp', 'Ramp', 'Climbs 2 m over 6 m', () => ({ id: newId('ramp'), type: 'ramp', pos: [...P0], size: [3, 2, 6], mat: 'concrete', color: '#b9b3a8', uv: 4 })),
          shape('stairs', 'Stairs', 'Climbs 3 m', () => ({ id: newId('stairs'), type: 'stairs', pos: [...P0], size: [2, 3, 4], mat: 'grate', color: '#7d8a99', uv: 2 })),
          shape('pillar', 'Pillar', 'Round column', () => ({ id: newId('cyl'), type: 'cyl', pos: [...P0], r: 0.5, h: 4, mat: 'concrete', color: '#b9b3a8', uv: 2 })),
          shape('tank', 'Tank', 'Big round tank', () => ({ id: newId('cyl'), type: 'cyl', pos: [...P0], r: 2.5, h: 5, sides: 16, mat: 'panel', color: '#e6e0d0', uv: 2 })),
          shape('gatebox', 'Removable gate', 'Dynamic box an action can remove', () => ({ id: newId('gate'), type: 'box', name: 'gate', pos: [...P0], size: [6, 4, 0.5], mat: 'hazard', color: '#e0a82e', uv: 2, dynamic: true })),
        ],
      },
    ],
  },
  {
    id: 'props',
    label: 'Props',
    groups: (['Cargo', 'Cover', 'Vehicles', 'Structures', 'Signs', 'Decor'] as const).map((cat) => ({
      title: cat,
      entries: PROP_LIST.filter((p) => p.cat === cat).map((p) => ({
        key: 'prop:' + p.id,
        label: p.label,
        hint: `${p.size[0]} x ${p.size[1]} x ${p.size[2]} m`,
        make: (): LObject => ({ id: newId('p'), type: 'prop', prop: p.id, pos: [...P0] }),
      })),
    })),
  },
  {
    id: 'enemies',
    label: 'Enemies',
    groups: [
      {
        title: 'MonoMart',
        entries: ENEMY_KINDS.map((k) => ({ key: 'enemy:' + k.id, label: k.label, hint: k.hint, make: (): LObject => ({ id: newId('en'), type: 'enemy', kind: k.id, pos: [...P0] }) })),
      },
    ],
  },
  {
    id: 'allies',
    label: 'Allies',
    groups: [
      {
        title: 'Local 404',
        entries: ALLY_VOICES.map((v) => ({ key: 'ally:' + v.id, label: v.label, hint: 'Friendly squadmate', make: (): LObject => ({ id: newId('al'), type: 'ally', voice: v.id, pos: [...P0] }) })),
      },
    ],
  },
  {
    id: 'loot',
    label: 'Loot',
    groups: [
      {
        title: 'Pickups',
        entries: PICKUP_KINDS.map((k) => ({ key: 'pickup:' + k.id, label: k.label, hint: `${k.def} by default`, make: (): LObject => ({ id: newId('pk'), type: 'pickup', kind: k.id, pos: [...P0] }) })),
      },
      {
        title: 'Gear',
        entries: [
          { key: 'weapon', label: 'Weapon (random)', hint: 'Rolled when the level loads', make: (): LObject => ({ id: newId('wp'), type: 'weapon', pos: [0, 0, 0] }) },
          { key: 'shield', label: 'Shield', hint: 'Rolled shield item', make: (): LObject => ({ id: newId('wp'), type: 'weapon', shield: true, pos: [0, 0, 0] }) },
          { key: 'locker', label: 'Loot locker', hint: 'Opens for random loot', make: (): LObject => ({ id: newId('lk'), type: 'locker', pos: [0, 0, 0], luck: 1 }) },
          { key: 'barrel', label: 'Explosive barrel', hint: 'Shoot it. Boom.', make: (): LObject => ({ id: newId('br'), type: 'barrel', pos: [0, 0, 0] }) },
        ],
      },
    ],
  },
  {
    id: 'vehicles',
    label: 'Vehicles',
    groups: [
      {
        title: 'Drivable',
        entries: [
          { key: 'vehicle:teamster', label: 'Teamster 4x4', hint: 'Union pickup truck', make: (): LObject => ({ id: newId('vh'), type: 'vehicle', kind: 'teamster', pos: [0, 0, 0] }) },
          { key: 'vehicle:vesper', label: 'Vesper scooter', hint: 'Hover scooter', make: (): LObject => ({ id: newId('vh'), type: 'vehicle', kind: 'vesper', pos: [0, 0, 0] }) },
        ],
      },
    ],
  },
  {
    id: 'logic',
    label: 'Logic',
    groups: [
      {
        title: 'Mission logic',
        entries: [
          { key: 'trigger', label: 'Trigger zone', hint: 'Runs actions when the player walks in', make: (): LObject => ({ id: newId('tr'), type: 'trigger', pos: [0, 0, 0], size: [6, 4, 6], once: true, actions: [] }) },
          { key: 'checkpoint', label: 'Checkpoint', hint: 'Saves progress when reached', make: (): LObject => ({ id: newId('cp'), type: 'checkpoint', pos: [0, 0, 0], size: [6, 3, 6] }) },
          { key: 'destructible', label: 'Destructible', hint: 'Breaks, then runs actions', make: (): LObject => ({ id: newId('ds'), type: 'destructible', prop: 'coupling', pos: [0, 0, 0], hp: 60, by: 'any', actions: [] }) },
          { key: 'marker', label: 'Marker', hint: 'A named point (waypoints, scripts)', make: (): LObject => ({ id: newId('mk'), type: 'marker', pos: [0, 0, 0] }) },
          { key: 'nav', label: 'Nav area', hint: 'Where enemies may walk (optional)', make: (): LObject => ({ id: newId('nv'), type: 'nav', pos: [0, 0, 0], size: [20, 6, 20] }) },
        ],
      },
      { title: 'Player', entries: [{ key: 'spawn', label: 'Player start', hint: 'Where the player begins (only one)' }] },
    ],
  },
];

export const PALETTE_ENTRIES: Record<string, PaletteEntry> = {};
for (const t of PALETTE) for (const g of t.groups) for (const e of g.entries) PALETTE_ENTRIES[e.key] = e;

/** Default `color` for an object that has none set (props use their library colour). */
export function effectiveColor(o: LObject): string | undefined {
  if ('color' in o && o.color) return o.color;
  if (o.type === 'prop') return numToHex(PROPS[o.prop]?.color ?? 0xffffff);
  return undefined;
}

/** Walk every action list in a level (including nested `count` lists). */
export function forEachActionList(level: LevelData, fn: (list: import('../world/leveldata').LAction[], owner: string) => void) {
  const walk = (list: import('../world/leveldata').LAction[] | undefined, owner: string) => {
    if (!list) return;
    fn(list, owner);
    for (const a of list) if (a.do === 'count') walk(a.then, owner);
  };
  walk(level.onStart, '__level');
  level.watchers?.forEach((w) => walk(w.actions, '__level'));
  for (const o of level.objects) if (o.type === 'trigger' || o.type === 'destructible') walk(o.actions, o.id);
}

export function allTags(level: LevelData): string[] {
  const s = new Set<string>();
  for (const o of level.objects) if ((o.type === 'enemy' || o.type === 'ally') && o.tag) s.add(o.tag);
  return [...s].sort();
}
export function allSquads(level: LevelData): string[] {
  const s = new Set<string>();
  for (const o of level.objects) if (o.type === 'enemy' && o.squad) s.add(o.squad);
  return [...s].sort();
}
export function allGroups(level: LevelData): string[] {
  const s = new Set<string>();
  for (const o of level.objects) if (o.group) s.add(o.group);
  return [...s].sort();
}
export function allNames(level: LevelData, filter?: (o: LObject) => boolean): string[] {
  const s = new Set<string>();
  for (const o of level.objects) if (o.name && (!filter || filter(o))) s.add(o.name);
  return [...s].sort();
}
export function objectiveIds(level: LevelData): string[] {
  const s = new Set<string>();
  forEachActionList(level, (list) => list.forEach((a) => a.do === 'objective' && a.id && s.add(a.id)));
  return [...s].sort();
}
