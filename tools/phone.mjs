// Touch smoke test: plays the game on an emulated phone with real taps and drags (no keyboard, no
// mouse), saves screenshots under shots/phone-*.png and fails on any console error.
//
//   npm run build && npx vite preview --port 4173
//   GAME_URL=http://localhost:4173/ node tools/phone.mjs [--device "Pixel 7"]
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';

const base = process.env.GAME_URL || 'http://localhost:5173/';
const args = process.argv.slice(2);
const devName = args.includes('--device') ? args[args.indexOf('--device') + 1] : 'Pixel 7';
fs.mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
let failed = false;
const errors = [];
const note = (ok, label, extra = '') => {
  if (!ok) failed = true;
  console.log(`${ok ? '✓' : '✗'} ${label}`.padEnd(52), extra);
};

async function open(device) {
  const ctx = await browser.newContext({ ...devices[device] });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 90000 });
  return { ctx, page, cdp: await ctx.newCDPSession(page) };
}
const stateOf = (page) => page.evaluate(() => window.__game.state);
const waitState = (page, s, timeout = 120000) => page.waitForFunction((want) => window.__game.state === want, s, { timeout });
const centre = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } : null;
  }, sel);
/** Wait until an element has stopped moving (menus slide in; software rendering makes that slow). */
async function settled(page, sel, timeout = 20000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const c = await centre(page, sel);
    if (c && last && Math.abs(c.x - last.x) < 1 && Math.abs(c.y - last.y) < 1) return c;
    last = c;
    await page.waitForTimeout(350);
  }
  return last;
}
const tap = async (page, sel) => {
  const c = await settled(page, sel);
  if (!c) throw new Error('nothing to tap at ' + sel);
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForTimeout(250);
  return c;
};
/** hold a finger down, optionally dragging it, for `ms` */
async function drag(cdp, page, from, to, ms, id = 1) {
  const pt = (p) => [{ x: p.x, y: p.y, id, radiusX: 8, radiusY: 8, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from) });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }) });
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(120);
}

try {
  // ------------------------------------------------------------------ landscape: play
  const { ctx, page, cdp } = await open(devName + ' landscape');
  const vw = page.viewportSize();
  console.log(`${devName} landscape, ${vw.width}×${vw.height}`);
  await page.screenshot({ path: 'shots/phone-1-start.png' });
  await page.touchscreen.tap(vw.width / 2, vw.height / 2);
  await waitState(page, 'menu');
  await settled(page, '.wm-label.sel');
  await page.screenshot({ path: 'shots/phone-2-menu.png' });
  note(true, 'tap to start → watch menu');

  const selText = () => page.evaluate(() => document.querySelector('.wm-label.sel')?.textContent ?? '');
  note(/NEW GAME/.test(await selText()), 'NEW GAME is selected first', await selText());
  await tap(page, '.wm-label.sel');
  await page.waitForFunction(() => /CONTRACT/.test(document.querySelector('.wm-title')?.textContent ?? ''), null, { timeout: 15000 });
  await settled(page, '.wm-label.sel');
  await page.screenshot({ path: 'shots/phone-3-difficulty.png' });
  // the page swings its labels round the dial: the one passing under the tapped spot must not grab the selection
  note(/ASSOCIATE/.test(await selText()), 'difficulty page keeps its default selection', await selText());
  await tap(page, '.wm-label.sel');
  await waitState(page, 'playing');
  note(true, 'NEW GAME → difficulty → mission loads');

  await page.waitForFunction(() => window.__game.player.frozen, null, { timeout: 20000 });
  await page.waitForTimeout(2500);
  const duringIntro = await page.evaluate(() => ({ tc: document.querySelector('.tc').classList.contains('on'), skip: document.querySelector('.skip').textContent, device: window.__game.input.device }));
  await page.screenshot({ path: 'shots/phone-4-intro.png' });
  note(!duringIntro.tc && /SKIP/.test(duringIntro.skip) && duringIntro.device === 'touch', 'intro: buttons hidden, skip prompt shown', JSON.stringify(duringIntro));
  await tap(page, '.skip');
  await page.waitForFunction(() => !window.__game.player.frozen, null, { timeout: 20000 });
  note(true, 'tap SKIP ends the cutscene');
  await page.waitForTimeout(1200);

  const shown = await page.evaluate(() => {
    const vis = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return false;
      const r = e.getBoundingClientRect();
      return r.width > 4 && r.height > 4 && getComputedStyle(e).visibility !== 'hidden';
    };
    return document.querySelector('.tc').classList.contains('on') && document.getElementById('hud').classList.contains('touch') && vis('#hud .vitals') && vis('#hud .ammo') && vis('.tc-btn.fire');
  });
  await page.screenshot({ path: 'shots/phone-5-play.png' });
  note(shown, 'touch controls and touch HUD are showing');

  // buttons must be on screen and big enough to hit
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('.tc-btn')].map((b) => {
      const r = b.getBoundingClientRect();
      return { act: b.dataset.act, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    }),
  );
  const bad = btns.filter((b) => b.w < 36 || b.h < 36 || b.x < 0 || b.y < 0 || b.x + b.w > vw.width + 1 || b.y + b.h > vw.height + 1);
  note(bad.length === 0, 'all buttons on screen and ≥ 36 px', bad.length ? JSON.stringify(bad) : btns.length + ' buttons');
  const overlap = [];
  for (let i = 0; i < btns.length; i++)
    for (let j = i + 1; j < btns.length; j++) {
      const a = btns[i];
      const b = btns[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 6 && oy > 6) overlap.push(a.act + '/' + b.act);
    }
  note(overlap.length === 0, 'no two buttons overlap', overlap.join(' '));

  const p0 = await page.evaluate(() => ({ z: window.__game.player.pos.z, x: window.__game.player.pos.x, yaw: window.__game.player.yaw }));
  await drag(cdp, page, { x: vw.width * 0.18, y: vw.height * 0.62 }, { x: vw.width * 0.18, y: vw.height * 0.62 - 60 }, 1600);
  const p1 = await page.evaluate(() => ({ z: window.__game.player.pos.z, x: window.__game.player.pos.x, yaw: window.__game.player.yaw }));
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  note(moved > 0.8, 'left stick walks', moved.toFixed(2) + ' m');

  await drag(cdp, page, { x: vw.width * 0.62, y: vw.height * 0.35 }, { x: vw.width * 0.62 + 120, y: vw.height * 0.35 }, 80);
  const p2 = await page.evaluate(() => window.__game.player.yaw);
  note(Math.abs(p2 - p1.yaw) > 0.05, 'right-side drag looks around', (p2 - p1.yaw).toFixed(3) + ' rad');

  const shots0 = await page.evaluate(() => window.__game.stats.shots);
  const fire = await centre(page, '.tc-btn.fire');
  await drag(cdp, page, fire, fire, 250);
  await page.waitForTimeout(300);
  const shots1 = await page.evaluate(() => window.__game.stats.shots);
  note(shots1 > shots0, 'FIRE button shoots', `${shots0} → ${shots1}`);

  await tap(page, '.tc-btn.pause');
  await waitState(page, 'paused', 8000);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'shots/phone-6-pause.png' });
  note(true, 'II opens the watch');
  await tap(page, '.wm-label.sel');
  await waitState(page, 'playing', 8000);
  note(true, 'RESUME returns to play');

  await tap(page, '.tc-btn[data-act="inventory"]');
  await waitState(page, 'inventory', 8000);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'shots/phone-7-backpack.png' });
  await tap(page, '.inv-btn.close');
  await waitState(page, 'playing', 8000);
  note(true, 'BAG opens and ✕ closes the backpack');
  await ctx.close();

  // ------------------------------------------------------------------ portrait: what does it look like?
  const pt = await open(devName);
  await pt.page.screenshot({ path: 'shots/phone-8-portrait-start.png' });
  const pv = pt.page.viewportSize();
  await pt.page.touchscreen.tap(pv.width / 2, pv.height / 2);
  await waitState(pt.page, 'menu');
  await settled(pt.page, '.wm-label.sel');
  await pt.page.screenshot({ path: 'shots/phone-9-portrait-menu.png' });
  note(true, 'portrait boots to the menu', `${pv.width}×${pv.height}`);
  await pt.ctx.close();
} catch (e) {
  failed = true;
  console.log('✗ threw:', String(e?.stack ?? e).slice(0, 900));
}
await browser.close();
if (errors.length) {
  failed = true;
  console.log('console errors:\n  ' + errors.slice(0, 8).join('\n  '));
}
console.log(failed ? '\nPHONE TEST FAILED' : '\nphone test passed');
process.exit(failed ? 1 : 0);
