// Handheld test rig: the finished single-file game wrapped in a page with two on-screen
// controllers (see tools/handheld/shell.html). For trying the game on a phone without putting any
// touch-screen code into the game itself: the rig feeds it as an ordinary gamepad.
//
//   npm run handheld      ->  release/handheld.html
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
execFileSync(process.execPath, [path.join(here, 'singlefile.mjs')], { stdio: 'inherit', cwd: root });

const MARK = '@@EMG@@';
const bridge = fs.readFileSync(path.join(here, 'handheld', 'bridge.js'), 'utf8');
let game = fs.readFileSync(path.join(root, 'release', 'everything-must-go.html'), 'utf8');
if (game.includes(MARK) || !game.includes('<head>')) throw new Error('unexpected game page');
game = game.replace('<head>', () => '<head>\n<script>' + bridge + '</script>');
// the game page is stored as text inside a <script> block, so it must not contain anything that ends or confuses one
const safe = game.replace(/<(\/?script|!--)/gi, '<' + MARK + '$1');
const shell = fs.readFileSync(path.join(here, 'handheld', 'shell.html'), 'utf8');
const out = shell.replace('<!--GAME-->', () => `<script type="text/plain" id="game-doc">${safe}</script>`);
const file = path.join(root, 'release', 'handheld.html');
fs.writeFileSync(file, out);
console.log(`${path.relative(root, file)}  ${(out.length / 1e6).toFixed(1)} MB`);

// Hosted variant, for putting the rig on a web host next to the normal build in dist/:
//   dist/game.html              the built game page plus the bridge
//   release/handheld-page.html  the rig alone (styles + markup, no <html> wrapper), framing ./game.html
const index = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
fs.writeFileSync(path.join(root, 'dist', 'game.html'), index.replace('<head>', () => '<head>\n<script>' + bridge + '</script>'));
const style = /<style>[\s\S]*?<\/style>/.exec(shell)[0];
const body = /<body>([\s\S]*)<\/body>/.exec(shell)[1].replace('<!--GAME-->', '');
fs.writeFileSync(path.join(root, 'release', 'handheld-page.html'), `<title>Everything Must Go Handheld</title>\n${style}\n${body}`);
