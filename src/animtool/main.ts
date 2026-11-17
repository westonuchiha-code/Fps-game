// Animation editor entry point. Started by src/shell.ts when the address ends in #anim.
import './animtool.css';
import { AnimTool } from './animtool';

const root = document.getElementById('anim-ui') as HTMLElement;
const canvas = document.getElementById('view') as HTMLCanvasElement;

AnimTool.create(root, canvas)
  .then((t) => {
    (window as any).__anim = t.api();
    (window as any).__anim.ready = true;
  })
  .catch((e) => {
    console.error(e);
    root.innerHTML = '<div class="fatal"><h2>The animation editor could not start</h2><pre></pre></div>';
    (root.querySelector('pre') as HTMLElement).textContent = String((e as Error)?.stack ?? e);
  });
