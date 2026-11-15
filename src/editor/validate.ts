// Live problem finder. Each problem points at the object (or level settings) to fix.
import type { LAction, LevelData, LObject } from '../world/leveldata';
import { PROPS } from '../world/props';
import { MUSIC_TRACKS, SPAWN_ID, VOICE_LINES, baseY, displayName, forEachActionList, objHeight } from './defs';

export interface Problem {
  sev: 'error' | 'warn' | 'info';
  text: string;
  /** object id, SPAWN_ID, or '__level' */
  id: string;
}

export interface ValidateEnv {
  /** is there something to stand on below this point? */
  groundBelow?: (x: number, y: number, z: number) => boolean;
}

export const ID_PATTERN = /^[a-z0-9_-]{1,40}$/i;

export function validate(level: LevelData, env: ValidateEnv = {}): Problem[] {
  const out: Problem[] = [];
  const add = (sev: Problem['sev'], text: string, id: string) => out.push({ sev, text, id });
  const objs = level.objects;
  const killY = level.killY ?? -40;

  // ---- level ----
  if (!ID_PATTERN.test(level.id ?? '')) add('error', `Level id “${level.id}” must be 1–40 letters, digits, - or _`, '__level');
  if (!level.title?.trim()) add('warn', 'The level has no title', '__level');
  const sp = level.spawn;
  if (!sp || !Array.isArray(sp.pos) || sp.pos.length !== 3 || sp.pos.some((v) => !Number.isFinite(v))) add('error', 'The player start is missing or broken', SPAWN_ID);
  else {
    if (sp.pos[1] < killY) add('error', 'The player start is below the kill height — the player dies instantly', SPAWN_ID);
    else if (env.groundBelow && !env.groundBelow(sp.pos[0], sp.pos[1] + 0.5, sp.pos[2])) add('error', 'Nothing to stand on under the player start', SPAWN_ID);
    if (Math.abs(sp.pos[0]) > 3000 || Math.abs(sp.pos[2]) > 3000) add('warn', 'The player start is very far from the centre of the map', SPAWN_ID);
  }

  // ---- names, tags, references ----
  const names = new Map<string, LObject[]>();
  for (const o of objs) if (o.name) names.set(o.name, [...(names.get(o.name) ?? []), o]);
  for (const [n, list] of names) if (list.length > 1) for (const o of list) add('warn', `Name “${n}” is used by ${list.length} objects — actions will pick just one`, o.id);

  const tagsUsed = new Set<string>();
  const objectives = new Set<string>();
  let hasEnd = false;
  forEachActionList(level, (list) => {
    for (const a of list) {
      if (a.do === 'spawn') tagsUsed.add(a.tag);
      if (a.do === 'objective') objectives.add(a.id);
      if (a.do === 'end') hasEnd = true;
    }
  });
  const tagCounts = new Map<string, number>();
  for (const o of objs) if ((o.type === 'enemy' || o.type === 'ally') && o.tag) tagCounts.set(o.tag, (tagCounts.get(o.tag) ?? 0) + 1);
  for (const o of objs) {
    if ((o.type === 'enemy' || o.type === 'ally') && o.tag && !tagsUsed.has(o.tag)) add('warn', `${displayName(o)} has tag “${o.tag}” but no “Spawn” action uses it — it will never appear`, o.id);
  }

  const checkList = (list: LAction[], owner: string, where: string) => {
    for (const a of list) {
      switch (a.do) {
        case 'spawn':
          if (!a.tag) add('error', `${where}: a Spawn action has no tag`, owner);
          else if (!tagCounts.has(a.tag)) add('warn', `${where}: Spawn “${a.tag}” — no enemy or ally has that tag`, owner);
          break;
        case 'enable':
        case 'disable': {
          const t = names.get(a.target)?.[0];
          if (!a.target) add('error', `${where}: “Switch trigger” has no trigger picked`, owner);
          else if (!t) add('error', `${where}: no object named “${a.target}”`, owner);
          else if (t.type !== 'trigger') add('error', `${where}: “${a.target}” is not a trigger`, owner);
          break;
        }
        case 'remove': {
          const t = names.get(a.target)?.[0];
          if (!a.target) add('error', `${where}: “Remove” has no object picked`, owner);
          else if (!t) add('error', `${where}: no object named “${a.target}”`, owner);
          else if (!((t.type === 'box' || t.type === 'prop') && t.dynamic)) add('error', `${where}: “${a.target}” can only be removed if it is a box or prop with Dynamic ticked`, owner);
          break;
        }
        case 'marker':
        case 'unmark':
          if (!a.target) add('error', `${where}: waypoint action has no object picked`, owner);
          else if (!names.has(a.target)) add('error', `${where}: no object named “${a.target}”`, owner);
          break;
        case 'say':
          if (!VOICE_LINES.some((l) => l.id === a.line)) add('warn', `${where}: unknown voice line “${a.line}”`, owner);
          break;
        case 'music':
          if (a.track && !MUSIC_TRACKS.includes(a.track)) add('warn', `${where}: unknown music track “${a.track}”`, owner);
          break;
        case 'complete':
          if (!objectives.has(a.id) && a.id !== '__clear') add('warn', `${where}: completes objective “${a.id}” which is never added`, owner);
          break;
        case 'objective':
          if (!a.id) add('error', `${where}: objective has no id`, owner);
          break;
        case 'count':
          if (!(a.need >= 1)) add('error', `${where}: count “${a.id}” needs a number of 1 or more`, owner);
          if (!a.then.length) add('warn', `${where}: count “${a.id}” has nothing to do when it reaches ${a.need}`, owner);
          checkList(a.then, owner, where);
          break;
        case 'wait':
          if (!(a.seconds >= 0)) add('error', `${where}: wait needs a number of seconds`, owner);
          break;
      }
    }
  };
  checkList(level.onStart ?? [], '__level', 'Level start');
  (level.watchers ?? []).forEach((w, i) => {
    if (w.allDead !== '__base' && !tagCounts.has(w.allDead)) add('warn', `Watcher ${i + 1}: no enemies are tagged “${w.allDead}”`, '__level');
    if (!w.actions.length) add('warn', `Watcher ${i + 1} has no actions`, '__level');
    checkList(w.actions, '__level', `Watcher ${i + 1}`);
  });

  // ---- objects ----
  let enemies = 0;
  const ids = new Set<string>();
  for (const o of objs) {
    const nm = displayName(o);
    if (ids.has(o.id)) add('error', `Duplicate object id “${o.id}”`, o.id);
    ids.add(o.id);
    if (!Array.isArray(o.pos) || o.pos.length !== 3 || o.pos.some((v) => !Number.isFinite(v))) {
      add('error', `${nm} has a broken position`, o.id);
      continue;
    }
    if (baseY(o) + objHeight(o) < killY) add('error', `${nm} is below the kill height (${killY} m)`, o.id);
    if ('size' in o && (o.size.some((v) => !(v > 0)) || o.size.length !== 3)) add('error', `${nm} has a zero or negative size`, o.id);
    if (o.type === 'cyl' && !(o.r > 0 && o.h > 0)) add('error', `${nm} needs a radius and height above zero`, o.id);
    if ((o.type === 'prop' || o.type === 'destructible') && !PROPS[o.prop]) add('error', `Unknown prop “${o.prop}”`, o.id);
    if (o.type === 'enemy') {
      enemies++;
      o.patrol?.forEach((p, i) => p[1] < killY && add('error', `${nm}: patrol point ${i + 1} is below the kill height`, o.id));
    }
    if (o.type === 'trigger') {
      checkList(o.actions, o.id, `Trigger ${o.name ? '“' + o.name + '”' : ''}`.trim());
      if (!o.actions.length) add('warn', `Trigger ${o.name ? '“' + o.name + '” ' : ''}has no actions`, o.id);
      if (o.disabled && !o.name) add('warn', 'This trigger starts switched off but has no name, so nothing can switch it on', o.id);
    }
    if (o.type === 'destructible') {
      checkList(o.actions ?? [], o.id, 'Destructible');
      if (!o.actions?.length) add('info', 'Destructible has no actions (it just breaks)', o.id);
    }
    if (o.type === 'marker' && !o.name) add('info', 'Marker without a name — nothing can refer to it', o.id);
    if ((o.type === 'box' || o.type === 'prop') && o.dynamic && !o.name) add('warn', `${nm} is Dynamic but has no name, so no action can remove it`, o.id);
  }
  if (enemies > 60) add('warn', `${enemies} enemies — more than about 60 will slow the game down`, '__level');
  const winByClear = level.winOnAllDead !== false && enemies > 0;
  if (!hasEnd && !winByClear) add('warn', 'Nothing ends this level: add an “End the mission” action or tick “Win when all enemies are dead”', '__level');
  return out;
}
