/** Tiny campaign save in localStorage. Every access is guarded: private mode / blocked storage just means "no save". */

export interface SaveData {
  /** id of the mission last started (see MISSIONS in ui/watchMenu.ts) */
  lastMission: string;
  /** ids of completed missions */
  completed: string[];
  /** index into DIFFICULTIES */
  difficulty: number;
}

const KEY = 'emg-save';

function sanitize(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<SaveData>;
  if (typeof r.lastMission !== 'string' || !r.lastMission) return null;
  return {
    lastMission: r.lastMission,
    completed: Array.isArray(r.completed) ? r.completed.filter((x): x is string => typeof x === 'string') : [],
    difficulty: typeof r.difficulty === 'number' && isFinite(r.difficulty) ? Math.max(0, Math.min(2, Math.round(r.difficulty))) : 1,
  };
}

export function loadSave(): SaveData | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? sanitize(JSON.parse(s)) : null;
  } catch {
    return null;
  }
}

/** Merge `patch` into the stored save (creating it if needed) and return the result. */
export function writeSave(patch: Partial<SaveData>): SaveData {
  const prev = loadSave();
  const next: SaveData = {
    lastMission: patch.lastMission ?? prev?.lastMission ?? '',
    completed: patch.completed ?? prev?.completed ?? [],
    difficulty: patch.difficulty ?? prev?.difficulty ?? 1,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

/** Record a finished mission (keeps the list unique). */
export function markCompleted(missionId: string): SaveData {
  const prev = loadSave();
  const done = new Set(prev?.completed ?? []);
  done.add(missionId);
  return writeSave({ lastMission: prev?.lastMission || missionId, completed: [...done] });
}

export function hasSave(): boolean {
  return loadSave() !== null;
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
