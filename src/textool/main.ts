// Texture editor entry point. Started by src/shell.ts when the address ends in #tex.
import './textool.css';
import { TexTool } from './textool';

const root = document.getElementById('tex-ui') as HTMLElement;
const canvas = document.getElementById('view') as HTMLCanvasElement;

TexTool.create(root, canvas)
  .then((t) => {
    (window as any).__tex = t.api();
    (window as any).__tex.ready = true;
  })
  .catch((e) => {
    console.error(e);
    root.innerHTML = '<div class="fatal"><h2>The texture editor could not start</h2><pre></pre></div>';
    (root.querySelector('pre') as HTMLElement).textContent = String((e as Error)?.stack ?? e);
  });
