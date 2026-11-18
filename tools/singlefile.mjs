// Build the whole game (and the level editor) into ONE html file that runs straight from disk:
// download it, double-click it, play. No server, no install, nothing else to copy.
//
//   npm run single        ->  release/everything-must-go.html
//
// How: a normal build supplies the styles, sound packs, music and levels; a second build makes the
// code one chunk. Everything is embedded in the page, and a small fetch() stand-in hands the
// embedded files to the game, because browsers refuse to fetch neighbouring files from disk.
import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const tmp = path.join(root, '.single-build');
const outFile = path.join(root, 'release', 'everything-must-go.html');

await build({ root, logLevel: 'warn' });
await build({
  root,
  configFile: false,
  base: './',
  logLevel: 'warn',
  publicDir: false,
  build: { outDir: tmp, emptyOutDir: true, target: 'es2022', cssCodeSplit: false, chunkSizeWarningLimit: 9000, rollupOptions: { input: path.join(root, 'index.html'), output: { codeSplitting: false } } },
});

const scripts = fs.readdirSync(path.join(tmp, 'assets')).filter((f) => f.endsWith('.js'));
if (scripts.length !== 1) throw new Error('expected one script chunk, got ' + scripts.join(', '));
// an inline script must not contain a closing tag or an HTML comment opener
const js = fs.readFileSync(path.join(tmp, 'assets', scripts[0]), 'utf8').replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

// styles: one sheet per app, fonts embedded (only the Latin files; the others are never requested)
const css = { game: '', editor: '', anim: '', tex: '' };
for (const f of fs.readdirSync(path.join(dist, 'assets')).filter((n) => n.endsWith('.css'))) {
  let text = fs.readFileSync(path.join(dist, 'assets', f), 'utf8');
  text = text.replace(/url\(([^)]+)\)/g, (all, raw) => {
    const name = path.basename(raw.trim().replace(/^["']|["']$/g, ''));
    const file = path.join(dist, 'assets', name);
    if (!name.endsWith('.woff2') || !name.includes('-latin-') || !fs.existsSync(file)) return all;
    return `url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')})`;
  });
  if (text.includes('#hud')) css.game += text;
  else if (text.includes('.insp-')) css.editor += text;
  else if (text.includes('.at-timeline')) css.anim += text;
  else if (text.includes('.tx-layers')) css.tex += text;
  else throw new Error('cannot tell which app owns ' + f);
}
if (!css.game || !css.editor || !css.anim || !css.tex) throw new Error('missing a stylesheet');

// data the game normally fetches
const blocks = [];
const embed = (rel, type, enc) => {
  const buf = fs.readFileSync(path.join(dist, rel));
  const body = enc === 'base64' ? buf.toString('base64') : buf.toString('utf8').replace(/</g, '\\u003c');
  blocks.push(`<script type="${enc === 'base64' ? 'text/plain' : 'application/json'}" data-emg="${rel}" data-type="${type}" data-enc="${enc}">${body}</script>`);
};
for (const f of fs.readdirSync(path.join(dist, 'levels'))) embed('levels/' + f, 'application/json', 'text');
if (fs.existsSync(path.join(dist, 'anims'))) for (const f of fs.readdirSync(path.join(dist, 'anims'))) embed('anims/' + f, 'application/json', 'text');
if (fs.existsSync(path.join(dist, 'textures'))) for (const f of fs.readdirSync(path.join(dist, 'textures'))) embed('textures/' + f, 'application/json', 'text');
for (const f of fs.readdirSync(path.join(dist, 'audio')).filter((n) => n.endsWith('-pack.json'))) embed('audio/' + f, 'application/json', 'text');
for (const f of fs.readdirSync(path.join(dist, 'audio', 'music'))) embed('audio/music/' + f, 'audio/ogg', 'base64');

const boot = `
(() => {
  // only the running app's styles: the game's and the editor's sheets both style <body>
  const app = location.hash === '#editor' ? 'editor' : location.hash === '#anim' ? 'anim' : location.hash === '#tex' ? 'tex' : 'game';
  for (const k of ['game', 'editor', 'anim', 'tex']) if (k !== app) document.getElementById('css-' + k).remove();
  const real = window.fetch ? window.fetch.bind(window) : null;
  const find = (url) => {
    const path = String(url).split('#')[0].split('?')[0];
    for (const el of document.querySelectorAll('script[data-emg]')) if (path === el.dataset.emg || path.endsWith('/' + el.dataset.emg)) return el;
    return null;
  };
  window.fetch = (input, init) => {
    const el = find(typeof input === 'string' ? input : input.url);
    if (!el) return real ? real(input, init) : Promise.reject(new TypeError('no network'));
    let body = el.textContent;
    if (el.dataset.enc === 'base64') {
      const bin = atob(body.trim());
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      body = bytes;
    }
    // sounds are decoded once and kept by the audio engine: free the embedded copy
    if (el.dataset.emg.startsWith('audio/')) el.remove();
    return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': el.dataset.type } }));
  };
})();`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EVERYTHING MUST GO</title>
<style>html,body{background:#07070b;height:100%;margin:0}</style>
<style id="css-game">${css.game}</style>
<style id="css-editor">${css.editor}</style>
<style id="css-anim">${css.anim}</style>
<style id="css-tex">${css.tex}</style>
<script>${boot}</script>
</head>
<body>
${blocks.join('\n')}
<script type="module">${js}</script>
</body>
</html>
`;
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${path.relative(root, outFile)}  ${(html.length / 1e6).toFixed(1)} MB  (${blocks.length} embedded files)`);
