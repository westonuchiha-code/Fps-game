/**
 * The game and the level editor live in ONE page (see src/shell.ts) so they share browser
 * storage wherever the build is hosted. Switching between them is a reload with a note left in
 * sessionStorage saying what to start.
 */

export interface BootNote {
  /** level id to load straight away ('custom' = the level being edited) */
  level?: string;
  /** who sent us: lets the game offer a way back */
  from?: 'editor';
}

const KEY = 'emg-boot';

/** Read (and clear) the note left by the previous page. */
export function takeBootNote(): BootNote | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return raw ? (JSON.parse(raw) as BootNote) : null;
  } catch {
    return null;
  }
}

function go(hash: string, note: BootNote | null) {
  try {
    if (note) sessionStorage.setItem(KEY, JSON.stringify(note));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: we still switch, just without the note */
  }
  if (location.hash !== hash) location.hash = hash;
  location.reload();
}

export function openEditor() {
  go('#editor', null);
}

/** Start the game, optionally jumping straight into a level. */
export function openGame(note: BootNote | null = null) {
  go('', note);
}

export const wantsEditor = () => location.hash === '#editor';
