// Real-input smoke test: boots the game the way a player does (no test switches), clicks through
// the start screen and the wristwatch menu with the keyboard, skips the intro, walks, shoots,
// pauses, opens the backpack, and fails on any console error.
//
//   npm run dev        (in another terminal)
//   npm test
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';

const base = process.env.GAME_URL || 'http://localhost:5173/';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

const state = () => page.evaluate(() => window.__game.state);
const step = async (label, fn) => {
  await fn();
  console.log(`✓ ${label}`.padEnd(46), 'state =', await state());
};
const waitState = (s, timeout = 60000) => page.waitForFunction((want) => window.__game && window.__game.state === want, s, { timeout });
const key = async (k, hold = 60) => {
  await page.keyboard.down(k);
  await page.waitForTimeout(hold);
  await page.keyboard.up(k);
  await page.waitForTimeout(120);
};

let failed = false;
try {
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 90000 });
  await step('boot + assets loaded', async () => {});
  await step('click to start -> watch menu', async () => {
    await page.mouse.click(480, 270);
    await waitState('menu');
    await page.waitForTimeout(800);
  });
  await step('NEW GAME -> difficulty -> start', async () => {
    await key('Enter');
    await page.waitForTimeout(500);
    await key('Enter');
    await waitState('playing', 120000);
  });
  await step('intro cutscene is running', async () => {
    await page.waitForFunction(() => window.__game.player.frozen, null, { timeout: 15000 });
  });
  await step('skip the intro', async () => {
    await page.waitForTimeout(1500);
    await key('Enter');
    await page.waitForFunction(() => !window.__game.player.frozen, null, { timeout: 20000 });
  });
  const z0 = await page.evaluate(() => window.__game.player.pos.z);
  await step('walk forward', async () => {
    await key('KeyW', 2600);
  });
  const z1 = await page.evaluate(() => window.__game.player.pos.z);
  // software rendering in CI runs at a few frames per second, so only require *some* movement
  if (!(Math.abs(z1 - z0) > 0.6)) throw new Error(`player did not move (z ${z0} -> ${z1})`);
  await step('fire the starter pistol', async () => {
    const a0 = await page.evaluate(() => window.__game.inv.current.ammo);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(400);
    const a1 = await page.evaluate(() => window.__game.inv.current.ammo);
    if (!(a1 < a0)) throw new Error(`no shot fired (ammo ${a0} -> ${a1})`);
  });
  await step('reload', async () => {
    await key('KeyR');
    await page.waitForTimeout(2200);
  });
  await step('pause opens the watch', async () => {
    await key('KeyP');
    await waitState('paused', 5000);
    await page.waitForTimeout(600);
  });
  fs.mkdirSync('shots', { recursive: true });
  await page.screenshot({ path: 'shots/smoke_pause.png' });
  await step('resume', async () => {
    // the watch animates in; under slow software rendering that can take a few seconds
    for (let i = 0; i < 6 && (await state()) !== 'playing'; i++) {
      await page.waitForTimeout(1500);
      await key('Enter');
      await waitState('playing', 3000).catch(() => {});
    }
    if ((await state()) !== 'playing') throw new Error('could not resume from the pause menu');
  });
  await step('backpack opens and closes', async () => {
    await key('Tab');
    await waitState('inventory', 5000);
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'shots/smoke_backpack.png' });
    for (let i = 0; i < 4 && (await state()) !== 'playing'; i++) {
      await key('Tab');
      await waitState('playing', 3000).catch(() => {});
    }
    if ((await state()) !== 'playing') throw new Error('could not close the backpack');
  });
  await step('ten seconds of live play', async () => {
    await page.waitForTimeout(10000);
  });
  const info = await page.evaluate(() => {
    const g = window.__game;
    return { fps: Math.round(g.fps), pitch: +g.player.pitch.toFixed(2), locked: g.input.locked, device: g.input.device, enemies: g.ai.aliveEnemies(), allies: g.ai.allies.length, navNodes: g.nav.count, draw: g.pipe.renderer.info.render.calls, tris: g.pipe.renderer.info.render.triangles };
  });
  console.log('info', JSON.stringify(info));
  await page.screenshot({ path: 'shots/smoke_play.png' });
} catch (e) {
  failed = true;
  console.log('✗ FAILED:', String(e).slice(0, 400));
  try {
    await page.screenshot({ path: 'shots/smoke_fail.png' });
  } catch {
    /* ignore */
  }
}
await browser.close();
const real = errors.filter((e) => !/favicon|net::ERR_ABORTED/.test(e));
if (real.length) {
  console.log(`console errors (${real.length}):`);
  for (const e of real.slice(0, 12)) console.log('  ', e.slice(0, 300));
}
process.exit(failed || real.length ? 1 : 0);
