// Scripted gameplay checks: each file in tools/checks/ is a snippet that runs INSIDE the game
// (headless Chromium) with `game` in scope and returns { pass: boolean, log: string[] }.
//
//   npm run dev                      (in another terminal)
//   npm run check                    run every check
//   npm run check -- m01-logic       run one
//
// Checks drive time themselves (game.manual = true; game.step(frames, 1/60)), so they are
// deterministic and much faster than real time.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'checks');
const base = process.env.GAME_URL || 'http://localhost:5173/';
const want = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && (want.length === 0 || want.includes(f.replace(/\.js$/, ''))));
if (!files.length) {
  console.log('no checks matched', want);
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const src = fs.readFileSync(path.join(dir, file), 'utf8');
  // first line of a check may pick the URL: // url: ?level=m01&nointro=1
  const m = /^\/\/\s*url:\s*(\S+)/m.exec(src);
  const url = base + (m ? m[1] : '?level=test') + '&auto=1&dev=1';
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text().slice(0, 300));
  });
  let res = { pass: false, log: ['did not run'] };
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__game && window.__game.ready && window.__game.debug, null, { timeout: 120000 });
    res = await page.evaluate(async (code) => {
      const fn = new Function('game', 'return (async () => {' + code + '\n})()');
      return await fn(window.__game);
    }, src);
  } catch (e) {
    res = { pass: false, log: ['threw: ' + String(e).slice(0, 400)] };
  }
  await browser.close();
  const ok = res && res.pass && errors.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${file.replace(/\.js$/, '')}`);
  for (const line of res?.log ?? []) console.log('    ' + line);
  for (const e of errors.slice(0, 6)) console.log('    console error: ' + e);
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
