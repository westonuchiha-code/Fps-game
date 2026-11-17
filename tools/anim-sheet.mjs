// Contact sheet for character animation: every character in every clip, at several moments and
// camera angles, in one image. Needs the dev server (npm run dev).
//
//   node tools/anim-sheet.mjs [--clips reload,idle] [--cast 0,2,6] [--times 0,0.25,0.5,0.75,1]
//                             [--yaws 30,-60] [--aim 0] [--speed 0] [--crouch 0] [--out shots/anim-sheet.png]
//                             [--script file.js]   (runs first in the page, e.g. to author keys)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};
const list = (s) => (s ? s.split(',').filter(Boolean) : undefined);
const base = process.env.GAME_URL ?? 'http://localhost:5173/';
const out = opt('out', 'shots/anim-sheet.png');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text()));
await page.goto(base + '#anim', { waitUntil: 'load' });
await page.waitForFunction(() => window.__anim?.ready, null, { timeout: 60000 });
const script = opt('script');
if (script) await page.evaluate(`(async () => { ${fs.readFileSync(script, 'utf8')} })()`);
const clips = list(opt('clips')) ?? (await page.evaluate(() => window.__anim.clips()));
const o = {
  cast: list(opt('cast'))?.map(Number),
  clips: clips.length ? clips : [''],
  times: list(opt('times', '0,0.25,0.5,0.75,1')).map(Number),
  yaws: list(opt('yaws', '35')).map((d) => (Number(d) * Math.PI) / 180),
  base: { aim: +opt('aim', 0), speed: +opt('speed', 0), crouch: +opt('crouch', 0) },
};
const url = await page.evaluate((o) => window.__anim.sheet(o), o);
fs.mkdirSync('shots', { recursive: true });
fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
console.log('saved', out);
await browser.close();
