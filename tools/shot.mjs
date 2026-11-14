// Headless screenshot / scripted-playtest helper.
//   node tools/shot.mjs [--url <path?query>] [--out shots/x.png] [--w 1280 --h 720] [--wait ms]
//                       [--eval "js run in page before the screenshot"] [--keep] [--scale 1]
// The dev server must be running (npm run dev). Console errors are printed and fail the run.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const base = process.env.GAME_URL || 'http://localhost:5173/';
const url = base + (opt('url', '') || '');
const out = opt('out', 'shots/shot.png');
const w = +opt('w', 1280);
const h = +opt('h', 720);
const wait = +opt('wait', 1500);
const evalJs = opt('eval', '');
const scale = +opt('scale', 1);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') errors.push(t);
  if (!/\[vite\]|Download the React/.test(t)) console.log(`[page:${m.type()}]`, t.slice(0, 600));
});
page.on('pageerror', (e) => {
  errors.push(String(e));
  console.log('[pageerror]', String(e).slice(0, 800));
});
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 60000 }).catch(() => console.log('!! __game.ready not reached'));
if (evalJs) {
  const r = await page.evaluate(async (code) => {
    const fn = new Function('game', 'return (async () => {' + code + '})()');
    return await fn(window.__game);
  }, evalJs);
  if (r !== undefined) console.log('[eval]', typeof r === 'string' ? r : JSON.stringify(r));
}
await page.waitForTimeout(wait);
fs.mkdirSync(path.dirname(out), { recursive: true });
await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
if (errors.length) {
  console.log('ERRORS:', errors.length);
  process.exit(1);
}
