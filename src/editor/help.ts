// The cheat-sheet overlay (H or ?) and the first-run "getting started" card.
import { h } from './ui';

export const CHEATS: [string, [string, string][]][] = [
  [
    'Look around',
    [
      ['Right mouse drag', 'Look around'],
      ['W A S D', 'Fly forward / left / back / right'],
      ['Q / E', 'Fly down / up'],
      ['Shift (while flying)', 'Fly faster'],
      ['Mouse wheel', 'Zoom towards the cursor'],
      ['Middle drag  or  Space + drag', 'Pan'],
      ['Alt + left drag', 'Orbit around the point under the cursor'],
      ['F', 'Frame the selection (or the whole level)'],
      ['T', 'Top-down map view on / off'],
      ['G / L', 'Ground grid / labels on / off'],
      ['Touch-pad', 'View menu → Touch-pad mode: two-finger scroll pans, pinch zooms'],
    ],
  ],
  [
    'Place things',
    [
      ['Click a palette item', 'Then click in the world to drop it on the surface under the cursor'],
      ['Drag a palette item', 'Into the view to drop it there'],
      ['Shift + click', 'Keep placing more of the same'],
      ['R', 'Turn the thing being placed (or the selection) 90°'],
      ['Shift + R', 'Turn by the angle snap instead'],
      ['Esc', 'Stop placing'],
    ],
  ],
  [
    'Select & change',
    [
      ['Click', 'Select (click empty space to clear)'],
      ['Shift + click', 'Add to / remove from the selection'],
      ['Drag on empty space', 'Box-select'],
      ['Drag an object', 'Slide it along the ground'],
      ['1 / 2 / 3', 'Move / rotate / scale handles'],
      ['X', 'Snapping on / off (grid and angle sizes in the toolbar)'],
      ['Arrow keys', 'Nudge by one grid step (Shift = 4 steps)'],
      ['Page Up / Page Down', 'Raise / lower'],
      ['End', 'Drop onto the surface below'],
      ['Ctrl + A', 'Select everything'],
    ],
  ],
  [
    'Edit',
    [
      ['Ctrl + Z', 'Undo'],
      ['Ctrl + Y  or  Ctrl + Shift + Z', 'Redo'],
      ['Ctrl + D', 'Duplicate'],
      ['Ctrl + C / Ctrl + V', 'Copy / paste (pastes under the cursor)'],
      ['Ctrl + X', 'Cut'],
      ['Delete / Backspace', 'Delete'],
    ],
  ],
  [
    'Files & play',
    [
      ['Ctrl + S', 'Save (to the project when available, always to this browser)'],
      ['Ctrl + Shift + S', 'Save as a new level id'],
      ['Ctrl + O', 'Open a level'],
      ['F5  or  ▶ PLAY', 'Play-test the level'],
      ['Shift + F5', 'Play from the spot under the cursor'],
      ['H  or  ?', 'This help'],
    ],
  ],
];

export function showHelp() {
  if (document.querySelector('.help-back')) return;
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', key, true);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'h' || e.key === 'H' || e.key === '?') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  const cols = h(
    'div',
    { class: 'help-cols' },
    ...CHEATS.map(([title, rows]) =>
      h('div', { class: 'help-block' }, h('h3', { text: title }), h('table', {}, ...rows.map(([k, v]) => h('tr', {}, h('td', { class: 'k' }, ...keyCaps(k)), h('td', { text: v }))))),
    ),
  );
  const back = h(
    'div',
    { class: 'help-back', onmousedown: (e: MouseEvent) => e.target === back && close() },
    h(
      'div',
      { class: 'help' },
      h('div', { class: 'help-top' }, h('h2', { text: 'CONTROLS' }), h('button', { class: 'btn', text: 'Close (Esc)', onclick: close })),
      cols,
      h('p', { class: 'help-foot', text: 'Your work is autosaved in this browser every few seconds, so closing the tab never loses anything. Save puts the level in the project folder (public/levels) when the editor runs from the dev server.' }),
    ),
  );
  document.body.append(back);
  document.addEventListener('keydown', key, true);
}

function keyCaps(s: string) {
  // "Ctrl + Z  or  Ctrl + Y" -> styled caps
  const out: (HTMLElement | string)[] = [];
  s.split(/(\s+or\s+|\s*\+\s*|\s*\/\s*)/).forEach((part) => {
    if (!part) return;
    if (/^\s*\+\s*$/.test(part)) out.push(' + ');
    else if (/^\s*\/\s*$/.test(part)) out.push(' / ');
    else if (/^\s+or\s+$/.test(part)) out.push(' or ');
    else out.push(h('kbd', { text: part.trim() }));
  });
  return out;
}

const SEEN = 'emg-editor-welcome-seen';

export function maybeWelcome(openExample: () => void, force = false) {
  let seen = false;
  try {
    seen = !!localStorage.getItem(SEEN);
  } catch {
    /* ignore */
  }
  if (seen && !force) return;
  const close = () => {
    card.remove();
    try {
      localStorage.setItem(SEEN, '1');
    } catch {
      /* ignore */
    }
  };
  const card = h(
    'div',
    { class: 'welcome' },
    h('h2', { text: 'WELCOME TO THE LEVEL EDITOR' }),
    h(
      'ol',
      {},
      h('li', {}, h('b', { text: 'Look around: ' }), 'hold the right mouse button and use W A S D to fly. Mouse wheel zooms. T toggles the map view.'),
      h('li', {}, h('b', { text: 'Build: ' }), 'pick something in the left panel, then click in the world. Shift-click to place several.'),
      h('li', {}, h('b', { text: 'Change: ' }), 'click an object, drag its handles (1 move · 2 rotate · 3 scale) or edit it on the right.'),
      h('li', {}, h('b', { text: 'Make it play: ' }), 'Trigger zones (Logic tab) run actions — spawn a squad, show an objective, end the mission.'),
      h('li', {}, h('b', { text: 'Try it: ' }), 'press ▶ PLAY (F5). Ctrl+Z undoes anything. Work is autosaved.'),
    ),
    h(
      'div',
      { class: 'welcome-btns' },
      h('button', {
        class: 'btn',
        text: 'Open the example level',
        onclick: () => {
          close();
          openExample();
        },
      }),
      h('button', { class: 'btn', text: 'All controls (H)', onclick: () => showHelp() }),
      h('button', { class: 'btn primary', text: 'Got it', onclick: close }),
    ),
  );
  document.body.append(card);
}
