// The no-code action list editor (triggers, destructibles, the level's onStart and watchers), plus
// plain-English summaries so a designer can read a trigger at a glance.
import type { LAction, LevelData } from '../world/leveldata';
import { MUSIC_TRACKS, SPEAKERS, VOICE_LINES, allNames, allTags, lineText, objectiveIds } from './defs';
import { h, num, select, text, check, type Widgets } from './ui';

export type ActionType = LAction['do'];

export const ACTION_TYPES: { id: ActionType; label: string; hint: string }[] = [
  { id: 'spawn', label: 'Spawn tagged enemies / allies', hint: 'Brings in everyone with this tag' },
  { id: 'say', label: 'Play a voice line', hint: 'Spoken line with subtitle' },
  { id: 'objective', label: 'Add an objective', hint: 'Shows on the HUD objective list' },
  { id: 'complete', label: 'Complete an objective', hint: 'Ticks an objective off' },
  { id: 'toast', label: 'Flash a message', hint: 'Big yellow text for a moment' },
  { id: 'music', label: 'Change the music', hint: 'Switch track or stop' },
  { id: 'checkpoint', label: 'Save a checkpoint', hint: 'Respawn here if the player dies' },
  { id: 'enable', label: 'Switch a trigger ON', hint: 'Turns on a named trigger' },
  { id: 'disable', label: 'Switch a trigger OFF', hint: 'Turns off a named trigger' },
  { id: 'remove', label: 'Remove an object', hint: 'Removes a named dynamic box/prop (gates!)' },
  { id: 'marker', label: 'Show a waypoint', hint: 'HUD marker over a named object' },
  { id: 'unmark', label: 'Hide a waypoint', hint: 'Removes the HUD marker' },
  { id: 'count', label: 'Count up, then…', hint: 'Runs its own list on the Nth time' },
  { id: 'wait', label: 'Wait', hint: 'Pauses the rest of this list' },
  { id: 'script', label: 'Run a script hook', hint: 'For programmers: calls level code' },
  { id: 'end', label: 'End the mission', hint: 'Mission complete!' },
];

const q = (s: string | undefined | null) => '“' + (s || '?') + '”';

/** One-line plain-English description of an action. */
export function summarize(a: LAction, level?: LevelData): string {
  switch (a.do) {
    case 'spawn': {
      const n = level ? level.objects.filter((o) => (o.type === 'enemy' || o.type === 'ally') && o.tag === a.tag).length : 0;
      return `Spawn everyone tagged ${q(a.tag)}` + (level ? ` (${n} ${n === 1 ? 'character' : 'characters'})` : '');
    }
    case 'say': {
      const l = lineText(a.line);
      return l ? `${SPEAKERS[l.who]?.name ?? l.who} says ${q(trunc(l.text, 60))}` : `Play voice line ${q(a.line)}`;
    }
    case 'objective':
      return `New objective: ${q(a.text)}`;
    case 'complete':
      return `Complete objective ${q(a.id)}`;
    case 'toast':
      return `Flash message ${q(a.text)}`;
    case 'music':
      return a.track ? `Switch music to ${q(a.track)}` : 'Stop the music';
    case 'checkpoint':
      return 'Save a checkpoint where the player stands';
    case 'enable':
      return `Switch ON trigger ${q(a.target)}`;
    case 'disable':
      return `Switch OFF trigger ${q(a.target)}`;
    case 'remove':
      return `Remove ${q(a.target)}` + (a.boom ? ' with an explosion' : '');
    case 'marker':
      return `Show waypoint ${q(a.label)} over ${q(a.target)}`;
    case 'unmark':
      return `Hide the waypoint over ${q(a.target)}`;
    case 'count':
      return `Count ${q(a.id)}: on time #${a.need}, do ${a.then.length} action${a.then.length === 1 ? '' : 's'}`;
    case 'wait':
      return `Wait ${a.seconds} s, then carry on`;
    case 'script':
      return `Run script hook ${q(a.name)}`;
    case 'end':
      return 'End the mission (success)';
  }
}
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function summarizeList(list: LAction[] | undefined, level?: LevelData) {
  if (!list || !list.length) return 'does nothing yet';
  return list.map((a) => summarize(a, level)).join(' → ');
}

export function defaultAction(t: ActionType, level: LevelData, prev?: LAction): LAction {
  const p = prev as any;
  const tags = allTags(level);
  const trig = allNames(level, (o) => o.type === 'trigger');
  const dyn = allNames(level, (o) => (o.type === 'box' || o.type === 'prop') && !!o.dynamic);
  const named = allNames(level);
  const objs = objectiveIds(level);
  switch (t) {
    case 'spawn':
      return { do: 'spawn', tag: p?.tag ?? tags[0] ?? 'wave1' };
    case 'say':
      return { do: 'say', line: VOICE_LINES[0]?.id ?? '' };
    case 'objective':
      return { do: 'objective', id: p?.id ?? 'obj' + (objs.length + 1), text: p?.text ?? 'Reach the target' };
    case 'complete':
      return { do: 'complete', id: p?.id ?? objs[objs.length - 1] ?? 'obj1' };
    case 'toast':
      return { do: 'toast', text: p?.text ?? 'SOMETHING HAPPENED' };
    case 'music':
      return { do: 'music', track: MUSIC_TRACKS[0] ?? null };
    case 'checkpoint':
      return { do: 'checkpoint' };
    case 'enable':
    case 'disable':
      return { do: t, target: p?.target ?? trig[0] ?? '' };
    case 'remove':
      return { do: 'remove', target: p?.target ?? dyn[0] ?? '', boom: true };
    case 'marker':
      return { do: 'marker', target: p?.target ?? named[0] ?? '', label: p?.label ?? 'GO HERE' };
    case 'unmark':
      return { do: 'unmark', target: p?.target ?? named[0] ?? '' };
    case 'count':
      return { do: 'count', id: p?.id ?? 'count1', need: 2, then: [] };
    case 'wait':
      return { do: 'wait', seconds: 2 };
    case 'script':
      return { do: 'script', name: p?.name ?? '' };
    case 'end':
      return { do: 'end' };
  }
}

/** Where an action list lives and how to change it (always through an undoable document edit). */
export interface ActionHost {
  root(): LAction[] | undefined;
  mutate(label: string, fn: (root: LAction[]) => void, merge?: string): void;
  level(): LevelData;
  /** something structural changed (row added / removed / retyped) - redraw */
  redraw(): void;
}

function resolve(root: LAction[] | undefined, path: number[]): LAction[] | undefined {
  let l = root;
  for (const i of path) {
    const a = l?.[i];
    if (!a || a.do !== 'count') return undefined;
    l = a.then;
  }
  return l;
}

export function actionListEditor(host: ActionHost, ws: Widgets, path: number[] = [], mergeBase = 'act'): HTMLElement {
  const level = host.level();
  const list = resolve(host.root(), path) ?? [];
  const el = h('div', { class: 'actions' + (path.length ? ' nested' : '') });
  const at = (i: number) => resolve(host.root(), path)?.[i] as any;
  const mut = (label: string, fn: (l: LAction[]) => void, merge?: string) =>
    host.mutate(
      label,
      (root) => {
        const l = resolve(root, path);
        if (l) fn(l);
      },
      merge,
    );

  list.forEach((a, i) => {
    const key = mergeBase + ':' + path.join('.') + ':' + i;
    const typeSel = select(
      () => at(i)?.do,
      (v) => {
        mut('Change action type', (l) => (l[i] = defaultAction(v as ActionType, level, l[i])));
        host.redraw();
      },
      ACTION_TYPES.map((t) => ({ value: t.id, label: t.label })),
      { title: 'What this step does' },
    );
    const summary = h('div', { class: 'act-sum' });
    ws.add({ el: summary, refresh: () => (summary.textContent = at(i) ? summarize(at(i), host.level()) : '') }).refresh();
    const btn = (label: string, tip: string, fn: () => void, disabled = false) => h('button', { class: 'icon-btn', text: label, title: tip, disabled, onclick: fn });
    const tools = h(
      'div',
      { class: 'act-tools' },
      btn('↑', 'Move up', () => {
        mut('Reorder actions', (l) => l.splice(i - 1, 0, ...l.splice(i, 1)));
        host.redraw();
      }, i === 0),
      btn('↓', 'Move down', () => {
        mut('Reorder actions', (l) => l.splice(i + 1, 0, ...l.splice(i, 1)));
        host.redraw();
      }, i === list.length - 1),
      btn('⧉', 'Duplicate this step', () => {
        mut('Duplicate action', (l) => l.splice(i + 1, 0, structuredClone(l[i])));
        host.redraw();
      }),
      btn('✕', 'Delete this step', () => {
        mut('Delete action', (l) => l.splice(i, 1));
        host.redraw();
      }),
    );
    const fields = h('div', { class: 'act-fields' });
    const field = (label: string, w: HTMLElement) => fields.append(h('div', { class: 'act-field' }, h('span', { class: 'act-lbl', text: label }), w));
    const setF = (k: string, label: string) => (v: any) =>
      mut(
        label,
        (l) => {
          const x = l[i] as any;
          if (v === undefined) delete x[k];
          else x[k] = v;
        },
        key + ':' + k,
      );
    const targetPick = (k: string, cands: string[], hint: string, extra?: { label: string; names: string[] }) => {
      const cur = at(i)?.[k] ?? '';
      const opts: { value: string; label: string; group?: string }[] = [{ value: '', label: cands.length || extra?.names.length ? '— choose —' : '— ' + hint + ' —' }];
      for (const c of cands) opts.push({ value: c, label: c });
      if (extra) for (const c of extra.names) if (!cands.includes(c)) opts.push({ value: c, label: c, group: extra.label });
      if (cur && !cands.includes(cur) && !extra?.names.includes(cur)) opts.push({ value: cur, label: cur + ' (missing!)' });
      const w = ws.add(select(() => at(i)?.[k] ?? '', (v) => {
        setF(k, 'Edit action')(v);
        host.redraw();
      }, opts));
      return w.el;
    };

    switch (a.do) {
      case 'spawn': {
        const tags = allTags(level);
        field('Tag', ws.add(text(() => at(i)?.tag, setF('tag', 'Edit action'), { list: tags, placeholder: 'e.g. wave2', title: 'Enemies/allies with this tag arrive' })).el);
        break;
      }
      case 'say': {
        const opts = VOICE_LINES.map((l) => ({ value: l.id, label: l.id + ' — ' + trunc(l.text, 48), group: SPEAKERS[l.who]?.name ?? l.who }));
        field('Line', ws.add(select(() => at(i)?.line, setF('line', 'Edit action'), opts)).el);
        const sub = h('div', { class: 'act-sub' });
        ws.add({ el: sub, refresh: () => (sub.textContent = lineText(at(i)?.line)?.text ? '“' + lineText(at(i)?.line)!.text + '”' : 'Unknown line id') }).refresh();
        fields.append(sub);
        break;
      }
      case 'objective':
        field('Id', ws.add(text(() => at(i)?.id, setF('id', 'Edit action'), { placeholder: 'short id, e.g. reach_dock', title: 'Used by “Complete objective”' })).el);
        field('Text', ws.add(text(() => at(i)?.text, setF('text', 'Edit action'), { placeholder: 'What the HUD says' })).el);
        break;
      case 'complete':
        field('Id', ws.add(text(() => at(i)?.id, setF('id', 'Edit action'), { list: objectiveIds(level), placeholder: 'objective id' })).el);
        break;
      case 'toast':
        field('Text', ws.add(text(() => at(i)?.text, setF('text', 'Edit action'), { placeholder: 'BIG MESSAGE' })).el);
        break;
      case 'music':
        field(
          'Track',
          ws.add(select(() => at(i)?.track ?? null, setF('track', 'Edit action'), [{ value: null, label: '(silence)' }, ...MUSIC_TRACKS.map((t) => ({ value: t, label: t }))])).el,
        );
        break;
      case 'enable':
      case 'disable':
        field('Trigger', targetPick('target', allNames(level, (o) => o.type === 'trigger'), 'name a trigger first'));
        break;
      case 'remove':
        field(
          'Object',
          targetPick('target', allNames(level, (o) => (o.type === 'box' || o.type === 'prop') && !!o.dynamic), 'name a dynamic box/prop first', {
            label: 'Not dynamic (tick Dynamic on them first)',
            names: allNames(level, (o) => !((o.type === 'box' || o.type === 'prop') && !!o.dynamic)),
          }),
        );
        field('', ws.add(check(() => !!at(i)?.boom, (v) => setF('boom', 'Edit action')(v ? true : undefined), 'with an explosion')).el);
        break;
      case 'marker':
        field('Over', targetPick('target', allNames(level), 'name an object first'));
        field('Label', ws.add(text(() => at(i)?.label, setF('label', 'Edit action'), { placeholder: 'e.g. PLANT CHARGE' })).el);
        break;
      case 'unmark':
        field('Over', targetPick('target', allNames(level), 'name an object first'));
        break;
      case 'count':
        field('Id', ws.add(text(() => at(i)?.id, setF('id', 'Edit action'), { placeholder: 'counter id' })).el);
        field('Times', ws.add(num(() => at(i)?.need, setF('need', 'Edit action'), { min: 1, step: 1, integer: true })).el);
        fields.append(h('div', { class: 'act-sub', text: 'Every list with a count of the same id adds 1. On that number, this runs:' }));
        fields.append(actionListEditor(host, ws, [...path, i], mergeBase));
        break;
      case 'wait':
        field('Seconds', ws.add(num(() => at(i)?.seconds, setF('seconds', 'Edit action'), { min: 0, step: 0.5 })).el);
        break;
      case 'script':
        field('Hook', ws.add(text(() => at(i)?.name, setF('name', 'Edit action'), { placeholder: 'hook name in the level script' })).el);
        break;
    }
    el.append(
      h('div', { class: 'act-row', 'data-type': a.do }, h('div', { class: 'act-head' }, h('span', { class: 'act-num', text: String(i + 1) }), typeSel.el, tools), summary, fields.childNodes.length ? fields : null),
    );
    ws.list.push(typeSel);
  });

  const add = select<string>(
    () => '',
    (v) => {
      if (!v) return;
      mut('Add action', (l) => l.push(defaultAction(v as ActionType, level)));
      host.redraw();
    },
    [{ value: '', label: path.length ? '+ add a step to this count…' : '+ add an action…' }, ...ACTION_TYPES.map((t) => ({ value: t.id, label: t.label }))],
    { title: 'Add a step to the end of this list' },
  );
  add.el.classList.add('act-add');
  el.append(add.el);
  if (!list.length && !path.length) el.prepend(h('div', { class: 'act-empty', text: 'No actions yet. Pick one below — they run top to bottom.' }));
  return el;
}
