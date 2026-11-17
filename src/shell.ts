import { wantsAnim, wantsEditor } from './core/nav';

/**
 * One page, three apps. `#editor` starts the level editor, `#anim` the animation editor; anything else starts the
 * game. Each app is its own code-split bundle with its own styles. They share one page so they
 * share browser storage wherever the build is hosted (that is how a level gets from the editor
 * into a play-test).
 */
const el = (tag: string, id: string) => {
  const e = document.createElement(tag);
  e.id = id;
  document.body.appendChild(e);
  return e;
};

const editor = wantsEditor();
const anim = wantsAnim();
const app = editor ? 'editor' : anim ? 'anim' : 'game';
if (anim) {
  el('canvas', 'view');
  el('div', 'anim-ui');
  document.body.classList.add('animtool');
  document.title = 'EVERYTHING MUST GO — Animation';
  void import('./animtool/main');
} else if (editor) {
  el('canvas', 'view');
  el('div', 'editor-ui');
  document.body.classList.add('editor');
  document.title = 'EVERYTHING MUST GO — Level Editor';
  void import('./editor/main');
} else {
  el('canvas', 'game');
  el('div', 'ui');
  void import('./main');
}

// typing or following a link to the other app's address restarts into it
addEventListener('hashchange', () => {
  if ((wantsEditor() ? 'editor' : wantsAnim() ? 'anim' : 'game') !== app) location.reload();
});
