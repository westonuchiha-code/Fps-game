// Loading and saving levels: the project folder (via the dev server), the browser's own library,
// autosave, file export / import.
import { emptyLevel, newId, type LObject, type LevelData } from '../world/leveldata';

const LIB_INDEX = 'emg-editor-lib';
const LIB_PREFIX = 'emg-editor-lib:';
const AUTOSAVE = 'emg-editor-autosave';
const BACKUP = 'emg-editor-backup';
export const PLAY_KEY = 'emg-editor-level';
export const PLAY_SPAWN_KEY = 'emg-editor-spawn';

export interface LevelInfo {
  id: string;
  title: string;
  number: string;
  savedAt?: number;
  where: 'project' | 'browser';
}

export interface AutosaveMeta {
  level: LevelData;
  dirty: boolean;
  at: number;
  /** where this level was last saved */
  savedTo?: string;
  camera?: { pos: [number, number, number]; yaw: number; pitch: number };
  hidden?: string[];
}

/** The text written to a .json file - same formatting as the dev server uses. */
export const toJson = (l: LevelData) => JSON.stringify(l, null, 1) + '\n';

function lsGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
    return true;
  } catch {
    return false;
  }
}

// ---- project (dev server) ----------------------------------------------------------------------

let serverState: boolean | null = null;
export async function hasServer(): Promise<boolean> {
  if (serverState !== null) return serverState;
  try {
    const r = await fetch('__editor/list', { cache: 'no-store' });
    const j = r.ok ? await r.json() : null;
    serverState = Array.isArray(j);
  } catch {
    serverState = false;
  }
  return serverState;
}

export async function listProject(): Promise<LevelInfo[]> {
  // on the dev server ask for a fresh list; on a static host fall back to the shipped index
  try {
    const live = await hasServer();
    const r = await fetch(live ? '__editor/list' : 'levels/index.json', { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j.map((x: any) => ({ id: String(x.id), title: String(x.title ?? ''), number: String(x.number ?? ''), where: 'project' as const })) : [];
  } catch {
    return [];
  }
}

export async function loadProject(id: string): Promise<LevelData> {
  const r = await fetch('levels/' + encodeURIComponent(id) + '.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('Could not load levels/' + id + '.json (' + r.status + ')');
  return normalizeLevel(JSON.parse(await r.text()));
}

export async function saveProject(level: LevelData): Promise<boolean> {
  if (!(await hasServer())) return false;
  const r = await fetch('__editor/save?id=' + encodeURIComponent(level.id), { method: 'POST', body: JSON.stringify(level), headers: { 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error('The project refused the save: ' + (await r.text()));
  return true;
}

// ---- browser library -----------------------------------------------------------------------------

function libIndex(): Record<string, { title: string; number: string; savedAt: number }> {
  try {
    return JSON.parse(lsGet(LIB_INDEX) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export function listBrowser(): LevelInfo[] {
  const idx = libIndex();
  return Object.entries(idx)
    .map(([id, v]) => ({ id, title: v.title, number: v.number, savedAt: v.savedAt, where: 'browser' as const }))
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

export function saveBrowser(level: LevelData): boolean {
  const ok = lsSet(LIB_PREFIX + level.id, JSON.stringify(level));
  if (!ok) return false;
  const idx = libIndex();
  idx[level.id] = { title: level.title, number: level.number, savedAt: Date.now() };
  return lsSet(LIB_INDEX, JSON.stringify(idx));
}

export function loadBrowser(id: string): LevelData | null {
  const s = lsGet(LIB_PREFIX + id);
  return s ? normalizeLevel(JSON.parse(s)) : null;
}

export function deleteBrowser(id: string) {
  try {
    localStorage.removeItem(LIB_PREFIX + id);
  } catch {
    /* ignore */
  }
  const idx = libIndex();
  delete idx[id];
  lsSet(LIB_INDEX, JSON.stringify(idx));
}

// ---- autosave + backup ---------------------------------------------------------------------------

export function writeAutosave(m: AutosaveMeta) {
  return lsSet(AUTOSAVE, JSON.stringify(m));
}
export function readAutosave(): AutosaveMeta | null {
  try {
    const m = JSON.parse(lsGet(AUTOSAVE) ?? 'null');
    if (!m || !m.level) return null;
    m.level = normalizeLevel(m.level);
    return m;
  } catch {
    return null;
  }
}
/** Keep the last discarded working level so even "Discard" can be undone. */
export function writeBackup(level: LevelData) {
  lsSet(BACKUP, JSON.stringify({ at: Date.now(), level }));
}
export function readBackup(): { at: number; level: LevelData } | null {
  try {
    const b = JSON.parse(lsGet(BACKUP) ?? 'null');
    return b && b.level ? { at: b.at, level: normalizeLevel(b.level) } : null;
  } catch {
    return null;
  }
}

export function writePlaytest(level: LevelData, spawn?: { pos: [number, number, number]; yaw: number }) {
  const ok = lsSet(PLAY_KEY, JSON.stringify(level));
  try {
    if (spawn) localStorage.setItem(PLAY_SPAWN_KEY, JSON.stringify(spawn));
    else localStorage.removeItem(PLAY_SPAWN_KEY);
  } catch {
    /* ignore */
  }
  return ok;
}

// ---- export / import -----------------------------------------------------------------------------

export function download(level: LevelData) {
  const blob = new Blob([toJson(level)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (level.id || 'level') + '.json';
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/**
 * Make sure a parsed file is a usable level. A valid file comes back untouched (so files
 * round-trip exactly); missing required parts are filled in from the defaults.
 */
export function normalizeLevel(raw: any): LevelData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('This file is not a level (expected a JSON object).');
  if (!Array.isArray(raw.objects)) throw new Error('This file is not a level (it has no "objects" list).');
  const d = emptyLevel();
  const l = raw as LevelData;
  if (l.format !== 1) (l as any).format = 1;
  if (typeof l.id !== 'string' || !l.id) l.id = d.id;
  if (typeof l.title !== 'string') l.title = d.title;
  if (typeof l.number !== 'string') l.number = d.number;
  if (!['dawn', 'noon', 'dusk', 'night'].includes(l.sky)) l.sky = d.sky;
  if (typeof l.enemyLevel !== 'number') l.enemyLevel = d.enemyLevel;
  if (l.music === undefined) l.music = d.music;
  if (typeof l.killY !== 'number') l.killY = d.killY;
  if (!l.spawn || !Array.isArray(l.spawn.pos)) l.spawn = d.spawn;
  if (typeof l.spawn.yaw !== 'number') l.spawn.yaw = 0;
  const seen = new Set<string>();
  l.objects = l.objects.filter((o: any) => o && typeof o === 'object' && typeof o.type === 'string');
  for (const o of l.objects as LObject[]) {
    if (typeof o.id !== 'string' || !o.id || seen.has(o.id)) o.id = newId(o.type.slice(0, 2));
    seen.add(o.id);
    if (!Array.isArray(o.pos)) o.pos = [0, 0, 0];
    if (o.type === 'trigger' && !Array.isArray(o.actions)) o.actions = [];
  }
  return l;
}

export async function readFileText(f: File) {
  return await f.text();
}
