// Level editor entry point. Started by src/shell.ts when the address ends in #editor.
import './editor.css';
import { Editor } from './editor';

const root = document.getElementById('editor-ui') as HTMLElement;
const canvas = document.getElementById('view') as HTMLCanvasElement;

try {
  const ed = new Editor(root, canvas);
  (window as any).__editor = ed.api();
  (window as any).__editor.ready = true;
} catch (e) {
  console.error(e);
  root.innerHTML = '<div class="fatal"><h2>The editor could not start</h2><pre></pre><p>Your autosaved work is still in this browser. Try reloading, or a different browser with WebGL 2.</p></div>';
  (root.querySelector('pre') as HTMLElement).textContent = String((e as Error)?.stack ?? e);
}
