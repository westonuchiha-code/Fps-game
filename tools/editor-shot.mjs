// Level-editor test + screenshot runner.
//   node tools/editor-shot.mjs [--only name,name] [--w 1366 --h 768] [--keep-storage]
// Opens http://localhost:5173/#editor, drives window.__editor and real mouse/keyboard input,
// asserts results and saves screenshots under shots/editor-*.png. Exit code 1 on any failure.
// The dev server must be running (npx vite --port 5173 --strictPort).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const base = process.env.EDITOR_URL || 'http://localhost:5173/#editor';
const W = +opt('w', 1366);
const H = +opt('h', 768);
const only = (opt('only', '') || '').split(',').filter(Boolean);
fs.mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
let allow404 = false;
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !(allow404 && /404/.test(t))) errors.push(t);
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[page:${m.type()}]`, t.slice(0, 400));
});
page.on('pageerror', (e) => {
  errors.push(String(e));
  console.log('[pageerror]', String(e).slice(0, 800));
});
page.on('dialog', (d) => d.accept());

let failures = 0;
let passes = 0;
const ok = (cond, msg) => {
  if (cond) {
    passes++;
    console.log('  ok  ', msg);
  } else {
    failures++;
    console.log('  FAIL', msg);
  }
};
const E = (fn, arg) => page.evaluate(fn, arg);
const shot = async (name) => {
  await E(() => window.__editor.render());
  await page.waitForTimeout(120);
  const p = path.join('shots', 'editor-' + name + '.png');
  await page.screenshot({ path: p });
  console.log('  shot', p);
};
const shot_game = async (name) => {
  await page.waitForTimeout(600);
  const p = path.join('shots', 'editor-' + name + '.png');
  await page.screenshot({ path: p });
  console.log('  shot', p);
};
const settle = (ms = 250) => page.waitForTimeout(ms);
/** Load the editor page from scratch (a goto that only changes the #hash would not reload). */
async function open() {
  await page.goto('about:blank');
  await page.goto(base, { waitUntil: 'load' });
}
async function boot(clear = true) {
  await open();
  if (clear) {
    await page.waitForFunction(() => window.__editor && window.__editor.ready, null, { timeout: 60000 });
    await E(() => {
      window.__editor.resetStorage();
      localStorage.setItem('emg-editor-welcome-seen', '1');
    });
    await open();
  }
  await page.waitForFunction(() => window.__editor && window.__editor.ready, null, { timeout: 60000 });
  await settle(400);
}
/** centre of the 3D view in page coordinates */
const vpRect = () => E(() => {
  const r = document.querySelector('.vp-host').getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
});

const tests = {};

tests.empty = async () => {
  await boot();
  await page.evaluate(() => localStorage.removeItem('emg-editor-welcome-seen'));
  await boot(false);
  ok(await E(() => !!document.querySelector('.welcome')), 'first-run getting-started card shows');
  await shot('01-empty-welcome');
  await page.click('.welcome .btn.primary');
  const lvl = await E(() => window.__editor.getLevel());
  ok(lvl.objects.length === 1 && lvl.objects[0].id === 'floor', 'empty level has the default floor');
  ok(await E(() => window.__editor.problems().every((p) => p.sev !== 'error')), 'empty level has no errors');
  await shot('02-empty');
};

tests.palette = async () => {
  await boot();
  await E(() => window.__editor.camera([0, 46, 26], 0, -1.05));
  const r = await vpRect();
  const keys = await E(() => window.__editor.palette());
  // place one of every palette entry via real clicks: palette card, then a spot in the world
  let i = 0;
  const cols = 8;
  for (const key of keys) {
    const tab = await E((k) => {
      const card = document.querySelector(`.pal-card[data-key="${k}"]`);
      return card ? null : k;
    }, key);
    // switch to the tab that contains it by searching
    await page.fill('.pal-search', '');
    if (tab) {
      const tabId = await E((k) => {
        for (const t of document.querySelectorAll('.pal-tab')) {
          t.click();
          if (document.querySelector(`.pal-card[data-key="${k}"]`)) return t.dataset.tab;
        }
        return null;
      }, key);
      if (!tabId) {
        ok(false, 'palette entry visible: ' + key);
        continue;
      }
    }
    await page.click(`.pal-card[data-key="${key}"]`);
    const gx = (i % cols) - (cols - 1) / 2;
    const gz = Math.floor(i / cols) - 4;
    const sp = await E(([x, z]) => window.__editor.toScreen([x * 5, 0, z * 5]), [gx, gz]);
    const before = await E(() => window.__editor.level.objects.length);
    await page.mouse.move(sp.x, sp.y);
    await settle(30);
    await page.mouse.click(sp.x, sp.y);
    const after = await E(() => window.__editor.level.objects.length);
    if (key === 'spawn') {
      const s = await E(() => window.__editor.level.spawn.pos);
      ok(Math.abs(s[0] - gx * 5) < 0.6 && Math.abs(s[2] - gz * 5) < 0.6, 'player start moved by palette click');
    } else ok(after === before + 1, 'placed ' + key);
    i++;
  }
  const types = await E(() => [...new Set(window.__editor.level.objects.map((o) => o.type))].sort());
  ok(types.length === 17, 'every object type placed (' + types.join(',') + ')');
  await shot('03-all-types');
  await E(() => window.__editor.topView(true));
  await E(() => window.__editor.frame());
  await shot('04-all-types-top');
  await E(() => window.__editor.topView(false));
  // shift keeps placing, Esc cancels
  await page.click('.pal-tab[data-tab="loot"]');
  await page.click('.pal-card[data-key="barrel"]');
  const n0 = await E(() => window.__editor.level.objects.length);
  await page.keyboard.down('Shift');
  for (const dx of [0, 40, 80]) await page.mouse.click(r.cx - 60 + dx, r.cy + 120);
  await page.keyboard.up('Shift');
  ok((await E(() => window.__editor.level.objects.length)) === n0 + 3, 'shift-click keeps placing');
  ok(await E(() => !!window.__editor.ed.placing), 'still placing after shift-clicks');
  await page.keyboard.press('Escape');
  ok(await E(() => !window.__editor.ed.placing), 'Esc stops placing');
};

tests.transform = async () => {
  await boot();
  await E(() => window.__editor.camera([10, 9, 14], 0.6, -0.45));
  const id = await E(() => window.__editor.place('box', [0, 0, 0]));
  await settle(100);
  let o = await E((id) => window.__editor.get(id), id);
  ok(o.pos[1] === 1 && o.size[1] === 2, 'box placed with its bottom on the floor (centre y = 1)');
  // gizmo X-axis drag with snapping (grid 0.5)
  await E(() => window.__editor.snap(true, 1, 15));
  await E(() => window.__editor.gizmo('translate'));
  await settle(100);
  const g = await E(() => window.__editor.gizmoScreen());
  const px = await E(() => window.__editor.toScreen([1.0, 0, 0]));
  // point along the red arrow, then drag
  const ax = { x: g.x + (px.x - g.x) * 0.75, y: g.y + (px.y - g.y) * 0.75 };
  await page.mouse.move(ax.x, ax.y);
  await settle(60);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(ax.x + k * 14, ax.y + k * 3);
  await page.mouse.up();
  await settle(100);
  o = await E((id) => window.__editor.get(id), id);
  ok(o.pos[0] !== 0 && Number.isInteger(o.pos[0]) && o.pos[2] === 0 && o.pos[1] === 1, 'gizmo X drag moved along X snapped to 1 m (x=' + o.pos[0] + ')');
  const hist = await E(() => window.__editor.history());
  await shot('05-move-gizmo');
  // rotate via key 2 + drag on the yaw ring
  await page.keyboard.press('2');
  await settle(80);
  ok(await E(() => window.__editor.ed.gizmo.mode === 'rotate'), 'key 2 = rotate mode');
  await shot('06-rotate-gizmo');
  await page.keyboard.press('r');
  o = await E((id) => window.__editor.get(id), id);
  ok(Math.abs(o.rot[1] - Math.PI / 2) < 1e-4, 'R turns the selection 90°');
  // scale handle on Y
  await page.keyboard.press('3');
  await settle(80);
  const g2 = await E(() => window.__editor.gizmoScreen());
  const top = await E((id) => {
    const o = window.__editor.get(id);
    return window.__editor.toScreen([o.pos[0], 1.0, o.pos[2]]);
  }, id);
  await page.mouse.move(g2.x, g2.y - (g2.y - top.y) * 0.0 - 70);
  await settle(60);
  const hot = await E(() => window.__editor.ed.gizmo.tc.axis);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(g2.x, g2.y - 70 - k * 10);
  await page.mouse.up();
  o = await E((id) => window.__editor.get(id), id);
  ok(hot && o.size[1] > 2 && Number.isInteger(o.size[1]) && Math.abs(o.pos[1] - o.size[1] / 2) < 1e-6, 'scale handle (' + hot + ') grew the height on the grid, bottom kept (size ' + o.size + ')');
  await shot('07-scale-gizmo');
  // nudge / raise / drop
  await page.keyboard.press('1');
  const p0 = (await E((id) => window.__editor.get(id), id)).pos;
  await page.keyboard.press('PageUp');
  await page.keyboard.press('PageUp');
  let p1 = (await E((id) => window.__editor.get(id), id)).pos;
  ok(Math.abs(p1[1] - p0[1] - 2) < 1e-6, 'PageUp raises by grid step');
  await page.keyboard.press('End');
  p1 = (await E((id) => window.__editor.get(id), id)).pos;
  ok(Math.abs(p1[1] - p0[1]) < 1e-6, 'End drops back onto the floor');
  await page.keyboard.press('ArrowLeft');
  const p2 = (await E((id) => window.__editor.get(id), id)).pos;
  ok(Math.abs(p2[0] - p1[0]) + Math.abs(p2[2] - p1[2]) === 1, 'arrow key nudges 1 grid step');
  // multi-select move: shift-click a second object then drag it
  const b2 = await E(() => window.__editor.place('prop:crate', [-4, 0, 3]));
  await E(() => window.__editor.select([]));
  const s1 = await E((id) => window.__editor.objectScreen(id), id);
  const s2 = await E((id) => window.__editor.objectScreen(id), b2);
  await page.mouse.click(s1.x, s1.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(s2.x, s2.y);
  await page.keyboard.up('Shift');
  ok((await E(() => window.__editor.selection())).length === 2, 'shift-click adds to selection');
  const before = await E(([a, b]) => [window.__editor.get(a).pos, window.__editor.get(b).pos], [id, b2]);
  await page.mouse.move(s2.x, s2.y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(s2.x + k * 8, s2.y + k * 4);
  await page.mouse.up();
  const after = await E(([a, b]) => [window.__editor.get(a).pos, window.__editor.get(b).pos], [id, b2]);
  const d1 = [after[0][0] - before[0][0], after[0][2] - before[0][2]];
  const d2 = [after[1][0] - before[1][0], after[1][2] - before[1][2]];
  ok((d1[0] || d1[1]) && d1[0] === d2[0] && d1[1] === d2[1], 'dragging an object slides the whole selection together (' + d1 + ')');
  await shot('08-multi-select');
  // box select
  await E(() => window.__editor.select([]));
  const r = await vpRect();
  await page.mouse.move(r.x + 20, r.y + 20);
  await page.mouse.down();
  await page.mouse.move(r.x + r.w - 20, r.y + r.h - 20, { steps: 6 });
  await page.mouse.up();
  const sel = await E(() => window.__editor.selection());
  ok(sel.includes(id) && sel.includes(b2), 'box-select picks objects inside the rectangle');
  // click empty sky clears
  await page.mouse.click(r.x + r.w / 2, r.y + 12);
  ok((await E(() => window.__editor.selection())).length === 0, 'clicking empty space clears the selection');
  void hist;
};

tests.inspector = async () => {
  await boot();
  await E(() => window.__editor.camera([8, 7, 12], 0.5, -0.4));
  const results = await E(async () => {
    const api = window.__editor;
    const out = [];
    const setInput = (sel, v) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return true;
    };
    const rowInput = (label, idx = 0, tag = 'input') => {
      for (const r of document.querySelectorAll('.inspector .row')) if (r.querySelector('.lbl')?.textContent === label) return r.querySelectorAll('.val ' + tag)[idx];
      return null;
    };
    const setRow = (label, v, idx = 0, tag = 'input') => {
      const el = rowInput(label, idx, tag);
      if (!el) return false;
      el.focus();
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return true;
    };
    const selRow = (label, text, idx = 0) => {
      const el = rowInput(label, idx, 'select');
      if (!el) return false;
      const op = [...el.options].find((o) => o.textContent === text);
      if (!op) return false;
      el.value = op.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const checkRow = (text, v) => {
      for (const l of document.querySelectorAll('.inspector label.chk')) if (l.textContent.includes(text)) {
        const i = l.querySelector('input');
        if (i.checked !== v) i.click();
        return true;
      }
      return false;
    };
    const wait = () => new Promise((r) => setTimeout(r, 30));
    // box
    const box = api.place('box', [0, 0, 0]);
    await wait();
    out.push(['name', setRow('Name', 'gate_a'), api.get(box).name === 'gate_a']);
    out.push(['pos', setRow('Centre', '3', 0), api.get(box).pos[0] === 3]);
    out.push(['size expr', setRow('Size (m)', '2*3', 0), api.get(box).size[0] === 6]);
    out.push(['size keeps bottom', setRow('Size (m)', '4', 1), api.get(box).size[1] === 4 && api.get(box).pos[1] === 2]);
    out.push(['rot deg', setRow('Rotation (°)', '90', 1), Math.abs(api.get(box).rot[1] - Math.PI / 2) < 1e-4]);
    out.push(['material', selRow('Material', 'Hazard'), api.get(box).mat === 'hazard']);
    out.push(['colour hex', setInput('.inspector .hex', '#ff0000'), api.get(box).color === '#ff0000']);
    document.querySelectorAll('.inspector .sw')[3].click();
    out.push(['swatch', true, api.get(box).color !== '#ff0000']);
    out.push(['uv', setRow('Texture size', '2'), api.get(box).uv === 2]);
    out.push(['collide', checkRow('Solid', false), api.get(box).collide === false]);
    out.push(['dynamic', checkRow('Dynamic', true), api.get(box).dynamic === true]);
    out.push(['group', setRow('Group', 'gates'), api.get(box).group === 'gates']);
    // cylinder
    const cyl = api.place('pillar', [6, 0, 0]);
    await wait();
    out.push(['cyl r', setRow('Radius', '1.5'), api.get(cyl).r === 1.5]);
    out.push(['cyl h', setRow('Height', '6'), api.get(cyl).h === 6]);
    // prop
    const pr = api.place('prop:sign', [-6, 0, 0]);
    await wait();
    out.push(['prop variant', setRow('Variant', '3'), api.get(pr).variant === 3]);
    out.push(['prop text', setRow('Sign text', 'UNION YES'), api.get(pr).text === 'UNION YES']);
    out.push(['prop scale', setRow('Scale', '2'), api.get(pr).scale === 2]);
    out.push(['prop change', selRow('Prop', 'Billboard'), api.get(pr).prop === 'billboard']);
    // enemy
    const en = api.place('enemy:assoc', [0, 0, -6]);
    await wait();
    out.push(['enemy kind', selRow('Kind', 'Supervisor'), api.get(en).kind === 'super']);
    out.push(['enemy squad', setRow('Squad', 'alpha'), api.get(en).squad === 'alpha']);
    out.push(['enemy tag', setRow('Arrives on', 'wave2'), api.get(en).tag === 'wave2']);
    out.push(['enemy hold', checkRow('Hold position', true), api.get(en).hold === true]);
    out.push(['enemy level', setRow('Level', '7'), api.get(en).level === 7]);
    out.push(['enemy level clear', setRow('Level', ''), api.get(en).level === undefined]);
    out.push(['enemy facing', setRow('Facing (°)', '180'), Math.abs(api.get(en).rot[1] - Math.PI) < 1e-4]);
    // ally
    const al = api.place('ally:rivet', [3, 0, -6]);
    await wait();
    out.push(['ally voice', selRow('Who', 'Dutch'), api.get(al).voice === 'dutch']);
    out.push(['ally essential', checkRow('Essential', true), api.get(al).essential === true]);
    out.push(['ally tag', setRow('Arrives on', 'backup'), api.get(al).tag === 'backup']);
    // pickup
    const pk = api.place('pickup:ammo', [6, 0, -6]);
    await wait();
    out.push(['pickup cls', selRow('Ammo for', 'Shotgun'), api.get(pk).cls === 'shotgun']);
    out.push(['pickup amount', setRow('Amount', '60'), api.get(pk).amount === 60]);
    out.push(['pickup kind', selRow('Kind', 'Health'), api.get(pk).kind === 'health']);
    // weapon
    const wp = api.place('weapon', [-3, 0, -6]);
    await wait();
    out.push(['weapon cls', selRow('Class', 'Sniper'), api.get(wp).cls === 'sniper']);
    out.push(['weapon brand', selRow('Brand', 'KRONA') || selRow('Brand', 'Krona'), api.get(wp).brand === 'krona']);
    out.push(['weapon rarity', selRow('Rarity', 'Legendary'), api.get(wp).rarity === 4]);
    out.push(['weapon level', setRow('Level', '12'), api.get(wp).level === 12]);
    out.push(['weapon seed', setRow('Seed', '42'), api.get(wp).seed === 42]);
    out.push(['weapon shield', checkRow('Shield', true), api.get(wp).shield === true]);
    // locker
    const lk = api.place('locker', [-6, 0, -6]);
    await wait();
    out.push(['locker luck', selRow('Luck', 'Great'), api.get(lk).luck === 2]);
    // trigger
    const tr = api.place('trigger', [0, 0, 8]);
    await wait();
    out.push(['trigger once', checkRow('Only fire once', false), api.get(tr).once === false]);
    out.push(['trigger disabled', checkRow('Starts switched OFF', true), api.get(tr).disabled === true]);
    out.push(['trigger size', setRow('Size (m)', '10', 0), api.get(tr).size[0] === 10]);
    // destructible
    const ds = api.place('destructible', [8, 0, 8]);
    await wait();
    out.push(['destr hp', setRow('Health', '120'), api.get(ds).hp === 120]);
    out.push(['destr by', selRow('Hurt by', 'Explosions only'), api.get(ds).by === 'explosion']);
    out.push(['destr prop', selRow('Looks like', 'Uplink dish'), api.get(ds).prop === 'dish']);
    // vehicle
    const vh = api.place('vehicle:teamster', [-8, 0, 8]);
    await wait();
    out.push(['vehicle kind', selRow('Kind', 'Vesper scooter'), api.get(vh).kind === 'vesper']);
    // level settings
    api.select([]);
    await wait();
    out.push(['lvl title', setRow('Title', 'Inspector Test'), api.level.title === 'Inspector Test']);
    out.push(['lvl number', setRow('Mission no.', 'MISSION 09'), api.level.number === 'MISSION 09']);
    out.push(['lvl id', setRow('Level id', 'insp_test'), api.level.id === 'insp_test']);
    out.push(['lvl id bad', setRow('Level id', 'bad id!'), api.level.id === 'insp_test']);
    out.push(['lvl sky', selRow('Sky', 'Dusk'), api.level.sky === 'dusk']);
    out.push(['lvl enemy level', setRow('Enemy level', '5'), api.level.enemyLevel === 5]);
    out.push(['lvl music', selRow('Music', '(silence)'), api.level.music === null]);
    out.push(['lvl killY', setRow('Kill height', '-25'), api.level.killY === -25]);
    out.push(['lvl win', checkRow('Win when every enemy', false), api.level.winOnAllDead === false]);
    // spawn
    api.select('__spawn');
    await wait();
    out.push(['spawn pos', setRow('Position', '4', 0), api.level.spawn.pos[0] === 4]);
    out.push(['spawn yaw', setRow('Facing (°)', '90'), Math.abs(api.level.spawn.yaw - Math.PI / 2) < 1e-4]);
    return out;
  });
  for (const [name, found, good] of results) ok(found && good, 'inspector writes ' + name + (found ? '' : ' (widget not found)'));
  // every change was undoable: undo everything back to the empty level
  const n = await E(() => window.__editor.history());
  await E(() => {
    while (window.__editor.undo());
  });
  const l = await E(() => window.__editor.getLevel());
  ok(l.objects.length === 1 && l.title === 'Untitled' && l.sky === 'dawn' && n > 50, 'undo walks back all ' + n + ' inspector edits');
  await E(() => {
    while (window.__editor.redo());
  });
  ok((await E(() => window.__editor.level.title)) === 'Inspector Test', 'redo replays them');
  await E(() => window.__editor.select(window.__editor.level.objects.find((o) => o.type === 'enemy').id));
  await shot('09-inspector-enemy');
  await E(() => window.__editor.select(window.__editor.level.objects.find((o) => o.type === 'prop').id));
  await shot('10-inspector-prop');
};

tests.actions = async () => {
  await boot();
  await E(() => window.__editor.camera([0, 10, 18], 0, -0.5));
  const tr = await E(() => {
    const api = window.__editor;
    api.add({ type: 'enemy', kind: 'assoc', pos: [6, 0, -6], tag: 'wave2', squad: 'b' });
    api.add({ type: 'box', name: 'gate', dynamic: true, pos: [0, 2, -10], size: [6, 4, 0.5], mat: 'hazard', color: '#e0a82e' });
    return api.place('trigger', [0, 0, 0]);
  });
  await settle(100);
  // build the list with the real "add action" dropdown
  const addAction = async (label) => {
    await page.selectOption('.inspector .act-add >> nth=-1', { label });
    await settle(60);
  };
  await addAction('Spawn tagged enemies / allies');
  await addAction('Play a voice line');
  await addAction('Add an objective');
  await addAction('Remove an object');
  await addAction('Count up, then…');
  // nested add inside the count
  await page.selectOption('.inspector .actions.nested .act-add', { label: 'End the mission' });
  await settle(60);
  await addAction('Wait');
  let acts = await E((id) => window.__editor.get(id).actions, tr);
  ok(acts.length === 6 && acts[0].do === 'spawn' && acts[0].tag === 'wave2', 'spawn action defaults to an existing tag');
  ok(acts[3].do === 'remove' && acts[3].target === 'gate', 'remove action picks the dynamic object');
  ok(acts[4].do === 'count' && acts[4].then.length === 1 && acts[4].then[0].do === 'end', 'nested list inside count');
  // reorder: move "Wait" up
  const ups = await page.$$('.inspector .act-row[data-type="wait"] .act-tools .icon-btn');
  await ups[0].click();
  await settle(60);
  acts = await E((id) => window.__editor.get(id).actions, tr);
  ok(acts[4].do === 'wait', 'reorder moves an action up');
  // edit objective text by typing
  const objText = page.locator('.inspector .act-row[data-type="objective"] .act-field').nth(1).locator('input');
  await objText.click();
  await objText.fill('Blow the gate');
  await page.keyboard.press('Enter');
  acts = await E((id) => window.__editor.get(id).actions, tr);
  ok(acts[2].text === 'Blow the gate', 'typing into an action field writes through');
  const sums = await E(() => [...document.querySelectorAll('.inspector .act-sum')].map((e) => e.textContent));
  console.log('   summaries:', sums);
  ok(sums[0].startsWith('Spawn everyone tagged “wave2” (1 character)') && sums.some((s) => s.includes('Blow the gate')), 'plain-English summaries');
  // delete one
  await page.click('.inspector .act-row[data-type="say"] .act-tools .icon-btn:nth-child(4)');
  acts = await E((id) => window.__editor.get(id).actions, tr);
  ok(acts.length === 5 && !acts.some((a) => a.do === 'say'), 'delete an action');
  await shot('11-actions');
  // onStart + watcher from level settings
  await E(() => window.__editor.select([]));
  await settle(60);
  await page.selectOption('.inspector .act-add >> nth=0', { label: 'Add an objective' });
  await page.click('text=+ Add a watcher');
  await settle(60);
  const l = await E(() => window.__editor.getLevel());
  ok(l.onStart?.length === 1 && l.onStart[0].do === 'objective', 'level onStart action added');
  ok(l.watchers?.length === 1 && l.watchers[0].allDead === 'wave2', 'watcher added for an existing tag');
  await shot('12-level-settings');
};

tests.undo = async () => {
  await boot();
  const r = await E(() => {
    const api = window.__editor;
    const j0 = api.json();
    const a = api.place('box', [0, 0, 0]);
    const b = api.place('enemy:assoc', [3, 0, 0]);
    api.update(a, { size: [4, 4, 4] });
    api.select([a, b]);
    api.nudge([1, 0, 0]);
    api.duplicate();
    api.copy();
    api.paste([10, 0, 10]);
    api.select(a);
    api.deleteSelection();
    api.settings({ title: 'Changed' });
    const j1 = api.json();
    let n = 0;
    while (api.undo()) n++;
    const back = api.json();
    while (api.redo());
    const fwd = api.json();
    return { same0: back === j0, same1: fwd === j1, n, count: api.level.objects.length };
  });
  ok(r.same0, 'undo all returns to the exact starting JSON (' + r.n + ' steps)');
  ok(r.same1, 'redo all returns to the exact final JSON');
  ok(r.count === 6, 'duplicate + paste + delete produced the expected objects (' + r.count + ')');
  // keyboard shortcuts
  await E(() => window.__editor.select(window.__editor.level.objects[1].id));
  const c0 = await E(() => window.__editor.level.objects.length);
  await page.mouse.move(500, 400);
  await page.keyboard.press('Control+d');
  ok((await E(() => window.__editor.level.objects.length)) === c0 + 1, 'Ctrl+D duplicates');
  await page.keyboard.press('Delete');
  ok((await E(() => window.__editor.level.objects.length)) === c0, 'Delete removes');
  await page.keyboard.press('Control+z');
  ok((await E(() => window.__editor.level.objects.length)) === c0 + 1, 'Ctrl+Z undoes');
  await page.keyboard.press('Control+Shift+z');
  ok((await E(() => window.__editor.level.objects.length)) === c0, 'Ctrl+Shift+Z redoes');
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  ok((await E(() => window.__editor.level.objects.length)) === c0, 'Ctrl+Y redoes');
};

tests.files = async () => {
  await boot();
  const res = await E(async () => {
    const api = window.__editor;
    api.place('box', [0, 0, 0]);
    api.place('enemy:super', [3, 0, 1]);
    api.settings({ title: 'Round Trip' });
    const where = await api.saveAs('zz_editor_roundtrip', 'Round Trip');
    return { where, json: api.json(), dirty: api.dirty() };
  });
  ok(/project/.test(res.where) && /browser/.test(res.where), 'save went to project and browser: ' + res.where);
  ok(!res.dirty, 'saved level is clean');
  const disk = fs.readFileSync('public/levels/zz_editor_roundtrip.json', 'utf8');
  ok(disk === res.json, 'file on disk is byte-identical to the editor JSON');
  const idx = JSON.parse(fs.readFileSync('public/levels/index.json', 'utf8'));
  ok(idx.some((x) => x.id === 'zz_editor_roundtrip'), 'index.json lists it');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__editor && window.__editor.ready);
  ok((await E(() => window.__editor.json())) === res.json, 'reload restores the same level (autosave)');
  await E(() => window.__editor.newLevel());
  const opened = await E(async () => {
    await window.__editor.open('zz_editor_roundtrip');
    return window.__editor.json();
  });
  ok(opened === res.json, 'open from project gives identical JSON');
  const fromBrowser = await E(() => {
    window.__editor.openBrowser('zz_editor_roundtrip');
    return window.__editor.json();
  });
  ok(fromBrowser === res.json, 'open from browser storage gives identical JSON');
  // export via the toolbar button (real download)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.tb[data-id="export"]')]);
  const dlPath = path.join('shots', 'editor-export.json');
  await dl.saveAs(dlPath);
  ok(fs.readFileSync(dlPath, 'utf8') === res.json, 'exported file equals the level JSON');
  // import via the file picker
  await E(() => window.__editor.newLevel());
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.tb[data-id="import"]')]);
  await chooser.setFiles(dlPath);
  await settle(300);
  // a dirty new level -> confirm discard dialog may show; new level is clean so no dialog
  ok((await E(() => window.__editor.json())) === res.json, 'import from file restores identical JSON');
  // drag-and-drop import
  await E(() => window.__editor.newLevel());
  const text = fs.readFileSync(dlPath, 'utf8');
  await page.evaluate(async (t) => {
    const dt = new DataTransfer();
    dt.items.add(new File([t], 'dropped.json', { type: 'application/json' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, text);
  await settle(300);
  ok((await E(() => window.__editor.json())) === res.json, 'drag-and-drop import works');
  // discard warning
  await E(() => window.__editor.place('box', [5, 0, 5]));
  await page.click('.tb[data-id="new"]');
  await settle(100);
  ok(await E(() => !!document.querySelector('.modal')), 'New with unsaved changes asks first');
  await shot('13-discard-warning');
  await page.click('.modal .btn[data-id="cancel"]');
  // open dialog
  await page.click('.tb[data-id="open"]');
  await settle(200);
  await shot('14-open-dialog');
  await page.keyboard.press('Escape');
  // autosave restores unsaved work after reload
  await E(() => window.__editor.place('enemy:drone', [1, 0, 9]));
  const j = await E(() => window.__editor.json());
  await settle(1600);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__editor && window.__editor.ready);
  ok((await E(() => window.__editor.json())) === j && (await E(() => window.__editor.dirty())), 'autosave restores unsaved work after reload (still marked unsaved)');
  fs.rmSync('public/levels/zz_editor_roundtrip.json', { force: true });
  await fetch('http://localhost:5173/__editor/list').catch(() => null);
};

tests.validate = async () => {
  await boot();
  const r = await E(() => {
    const api = window.__editor;
    const L = api.getLevel();
    L.spawn.pos = [0, -80, 0];
    L.objects.push(
      { id: 'e1', type: 'enemy', kind: 'assoc', pos: [0, -60, 0] },
      { id: 'e2', type: 'enemy', kind: 'assoc', pos: [2, 0, 0], tag: 'nobody_spawns_me' },
      { id: 't1', type: 'trigger', pos: [0, 2, 0], size: [4, 4, 4], actions: [] },
      { id: 't2', type: 'trigger', pos: [8, 2, 0], size: [4, 4, 4], actions: [{ do: 'remove', target: 'ghost' }, { do: 'spawn', tag: 'void' }, { do: 'enable', target: 'dup' }] },
      { id: 'p1', type: 'prop', prop: 'not_a_prop', pos: [4, 0, 4] },
      { id: 'n1', type: 'box', name: 'dup', pos: [0, 0, 10], size: [1, 1, 1], mat: 'plain', color: '#ffffff' },
      { id: 'n2', type: 'box', name: 'dup', pos: [2, 0, 10], size: [1, 1, 1], mat: 'plain', color: '#ffffff' },
    );
    for (let i = 0; i < 61; i++) L.objects.push({ id: 'm' + i, type: 'enemy', kind: 'drone', pos: [i, 0, 30] });
    api.setLevel(L);
    return api.problems();
  });
  const has = (re, id) => r.some((p) => re.test(p.text) && (!id || p.id === id));
  ok(has(/player start is below/i, '__spawn'), 'spawn below killY');
  ok(has(/below the kill height/i, 'e1'), 'object below killY');
  ok(has(/never appear/i, 'e2'), 'tag never spawned');
  ok(has(/no object named “ghost”/i, 't2'), 'missing remove target');
  ok(has(/Spawn “void”/i, 't2'), 'spawn tag with no characters');
  ok(has(/is not a trigger/i, 't2'), 'enable target is not a trigger');
  ok(has(/no actions/i, 't1'), 'trigger with no actions');
  ok(has(/Unknown prop/i, 'p1'), 'unknown prop id');
  ok(has(/Name “dup” is used by 2/i, 'n1'), 'duplicate names');
  ok(has(/more than about 60/i), 'too many enemies');
  await page.click('.st-chip.prob');
  await settle(100);
  await shot('15-problems');
  // clicking a problem selects the object
  await page.click('.problems .prob:has-text("Unknown prop")');
  ok((await E(() => window.__editor.selection()))[0] === 'p1', 'clicking a problem selects the object');
  // play-test blocked by errors shows a modal; force writes the key
  const play = await E(() => window.__editor.play(true, true));
  const stored = await E(() => [localStorage.getItem('emg-editor-level'), localStorage.getItem('emg-editor-spawn')]);
  ok(play.note.level === 'custom' && play.note.from === 'editor' && JSON.parse(stored[0]).objects.length > 60 && JSON.parse(stored[1]).pos.length === 3, 'play-test writes the level + spawn keys');
};

tests.stress = async () => {
  await boot();
  const t = await E(async () => {
    const api = window.__editor;
    const L = api.getLevel();
    const props = ['container', 'crate', 'crate_big', 'barrier', 'sandbags', 'boxes', 'pallet_load', 'dumpster', 'barrel', 'cone', 'shelf', 'car'];
    let s = 1;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 300; i++) {
      const x = Math.round((rnd() - 0.5) * 110);
      const z = Math.round((rnd() - 0.5) * 110);
      const k = i % 6;
      if (k < 3) L.objects.push({ id: 's' + i, type: 'prop', prop: props[i % props.length], pos: [x, 0, z], rot: [0, rnd() * 6, 0] });
      else if (k === 3) L.objects.push({ id: 's' + i, type: 'box', pos: [x, 1, z], size: [2 + Math.round(rnd() * 6), 2, 2], mat: 'concrete', color: '#b9b3a8' });
      else if (k === 4) L.objects.push({ id: 's' + i, type: 'enemy', kind: ['assoc', 'super', 'drone', 'manager'][i % 4], pos: [x, 0, z] });
      else L.objects.push({ id: 's' + i, type: 'pickup', kind: 'ammo', pos: [x, 0, z] });
    }
    L.objects[0].size = [140, 1, 140];
    const t0 = performance.now();
    api.setLevel(L);
    const tLoad = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 5; i++) api.render();
    const tFrame = (performance.now() - t1) / 5;
    const t2 = performance.now();
    api.select('s10');
    api.nudge([1, 0, 0]);
    api.update('s13', { size: [9, 3, 2] });
    api.render();
    const tEdit = performance.now() - t2;
    const t3 = performance.now();
    api.undo();
    api.undo();
    api.render();
    const tUndo = performance.now() - t3;
    return { tLoad, tFrame, tEdit, tUndo, stats: api.stats() };
  });
  console.log('   stress:', JSON.stringify(t));
  ok(t.stats.objects === 301, 'stress level has 301 objects');
  ok(t.tEdit < 400 && t.tUndo < 400, `edits stay responsive (edit+render ${t.tEdit.toFixed(0)} ms, undo+render ${t.tUndo.toFixed(0)} ms, frame ${t.tFrame.toFixed(0)} ms in software GL)`);
  await E(() => window.__editor.camera([0, 50, 75], 0, -0.6));
  await shot('16-stress');
  await E(() => window.__editor.topView(true));
  await E(() => window.__editor.frame());
  await shot('17-stress-top');
};

tests.gamelook = async () => {
  await boot();
  await E(() => {
    const api = window.__editor;
    api.place('prop:container', [0, 0, 0]);
    api.place('enemy:assoc', [4, 0, 2]);
    api.place('trigger', [-5, 0, 2]);
    api.camera([10, 6, 12], 0.7, -0.3);
    api.gameLook(true);
  });
  await shot('18-game-look');
  await E(() => window.__editor.gameLook(false));
  await page.keyboard.press('h');
  await settle(100);
  await shot('19-help');
  await page.keyboard.press('Escape');
};

tests.sandbox = async () => {
  await boot();
  const res = await E(async () => {
    const api = window.__editor;
    api.newLevel();
    const L = api.getLevel();
    L.id = 'sandbox';
    L.title = 'Sandbox Yard';
    L.number = 'EXAMPLE';
    L.sky = 'dawn';
    L.enemyLevel = 2;
    L.music = 'm01';
    L.killY = -30;
    L.winOnAllDead = false;
    L.spawn = { pos: [0, 0.1, 30], yaw: 0 };
    L.objects = [];
    api.setLevel(L);
    const P = (key, pos, yaw = 0, patch = {}) => {
      const id = api.place(key, pos, yaw);
      if (Object.keys(patch).length) api.update(id, patch);
      return id;
    };
    const D = Math.PI / 2;
    // ground
    api.add({ type: 'box', id: 'floor', name: 'floor', pos: [0, -0.5, 0], size: [80, 1, 80], mat: 'asphalt', color: '#4b4852', uv: 6, group: 'structure', locked: true });
    // perimeter walls
    for (const [x, z, w, d] of [[0, -40, 80, 1], [0, 40, 80, 1], [-40, 0, 1, 80], [40, 0, 1, 80]]) api.add({ type: 'box', pos: [x, 2.5, z], size: [w, 5, d], mat: 'corrugated', color: '#7d8a99', uv: 3, group: 'structure' });
    // raised deck + ramp
    api.add({ type: 'box', pos: [-22, 1.5, -18], size: [16, 3, 12], mat: 'panel', color: '#8d8880', uv: 3, name: 'deck', group: 'structure' });
    api.add({ type: 'ramp', pos: [-22, 0, -8], rot: [0, Math.PI, 0], size: [5, 3, 8], mat: 'concrete', color: '#b9b3a8', uv: 4, group: 'structure' });
    api.add({ type: 'box', pos: [-22, 3.6, -23.7], size: [16, 1.2, 0.4], mat: 'hazard', color: '#e0a82e', uv: 2, group: 'structure' });
    // containers and cover
    const g = { group: 'cover' };
    P('prop:container', [10, 0, -8], D, { ...g, color: '#b5442f' });
    P('prop:container', [10, 2.6, -8], D, { ...g, color: '#2f6f9f' });
    P('prop:container', [18, 0, 6], 0.3, { ...g, color: '#2e9b8f' });
    P('prop:container_open', [-10, 0, 10], 0, { ...g, color: '#e0a82e' });
    P('prop:crate_big', [2, 0, 4], 0.4, g);
    P('prop:crate', [3.4, 0, 5.2], 0, g);
    P('prop:barrier', [-4, 0, 16], 0, g);
    P('prop:barrier', [4, 0, 16], 0, g);
    P('prop:sandbags', [0, 0, -14], 0, g);
    P('prop:pallet_load', [24, 0, -20], 0, g);
    P('prop:boxes', [-30, 0, 20], 0, g);
    P('prop:forklift', [-28, 0, 4], 1.2, g);
    P('prop:lamp', [-36, 0, 36], 0, g);
    P('prop:lamp', [36, 0, 36], 0, g);
    P('prop:billboard', [0, 0, -38], 0, { ...g, text: 'EVERYTHING MUST GO' });
    P('prop:union_sign', [-6, 1.6, 39.45], Math.PI, { text: 'SANDBOX YARD - LOCAL 404' });
    // the gate that blocks the back yard, removed when the first squad dies
    api.add({ type: 'box', name: 'yard_gate', pos: [28, 2, -30], size: [0.5, 4, 8], mat: 'hazard', color: '#e0a82e', uv: 2, dynamic: true, group: 'structure' });
    api.add({ type: 'box', pos: [28, 2.5, -21], size: [0.5, 5, 10], mat: 'corrugated', color: '#7d8a99', uv: 3, group: 'structure' });
    api.add({ type: 'box', pos: [28, 2.5, -37], size: [0.5, 5, 6], mat: 'corrugated', color: '#7d8a99', uv: 3, group: 'structure' });
    api.add({ type: 'box', pos: [34.25, 2.5, -16], size: [12, 5, 0.5], mat: 'corrugated', color: '#7d8a99', uv: 3, group: 'structure' });
    // squad A: on the floor, there from the start
    const sa = { squad: 'A', group: 'squad A' };
    P('enemy:assoc', [8, 0, -14], Math.PI, { ...sa, patrol: [[0, 0, -18], [-8, 0, -12]] });
    P('enemy:assoc', [14, 0, -2], Math.PI, sa);
    P('enemy:super', [12, 0, -12], Math.PI, sa);
    P('enemy:assoc', [-22, 3, -20], Math.PI, { ...sa, hold: true });
    // squad B: arrives from a trigger
    const sb = { squad: 'B', tag: 'wave2', group: 'squad B' };
    P('enemy:assoc', [32, 0, -30], -D, sb);
    P('enemy:assoc', [34, 0, -26], -D, sb);
    P('enemy:drone', [30, 0, -34], -D, sb);
    P('enemy:manager', [36, 0, -32], -D, { ...sb, level: 3 });
    // loot
    P('locker', [-22, 3, -23], Math.PI, { luck: 2, name: 'deck_locker' });
    P('pickup:ammo', [-3, 0, 20]);
    P('pickup:health', [3, 0, 20]);
    P('pickup:ammo', [16, 0, 10], 0, { cls: 'shotgun', amount: 24 });
    P('pickup:mine', [-12, 0, 10]);
    P('pickup:cash', [-20, 3, -14]);
    P('weapon', [0, 0, 22], 0, { cls: 'rifle', rarity: 1 });
    P('barrel', [8, 0, -4]);
    P('barrel', [9, 0, -3]);
    P('barrel', [30, 0, -28]);
    P('vehicle:teamster', [-28, 0, 30], D);
    // logic
    const cp = P('checkpoint', [0, 0, 6]);
    api.update(cp, { name: 'mid_checkpoint' });
    const trig = P('trigger', [-22, 3, -18]);
    api.update(trig, {
      name: 'deck_trigger',
      size: [14, 4, 10],
      pos: [-22, 5, -18],
      actions: [
        { do: 'toast', text: 'THE DECK — GOOD VIEW' },
        { do: 'checkpoint' },
      ],
    });
    const back = P('trigger', [22, 0, -28]);
    api.update(back, {
      name: 'backyard_trigger',
      size: [8, 4, 16],
      disabled: true,
      actions: [
        { do: 'spawn', tag: 'wave2' },
        { do: 'say', line: 'm01_arena_1' },
        { do: 'objective', id: 'wave2', text: 'Scrap the Regional Manager' },
        { do: 'unmark', target: 'backyard' },
      ],
    });
    P('marker', [32, 0, -30], 0, { name: 'backyard' });
    api.settings({
      onStart: [
        { do: 'say', line: 'm01_yard' },
        { do: 'objective', id: 'squadA', text: 'Clear the yard' },
        { do: 'marker', target: 'deck_locker', label: 'LOOT' },
      ],
      watchers: [
        { allDead: '__base', actions: [{ do: 'complete', id: 'squadA' }, { do: 'remove', target: 'yard_gate', boom: true }, { do: 'say', line: 'm01_gate_blown' }, { do: 'enable', target: 'backyard_trigger' }, { do: 'marker', target: 'backyard', label: 'BACK YARD' }, { do: 'toast', text: 'THE GATE IS DOWN' }] },
        { allDead: 'wave2', actions: [{ do: 'complete', id: 'wave2' }, { do: 'say', line: 'm01_manager_dead' }, { do: 'wait', seconds: 3 }, { do: 'end' }] },
      ],
    });
    const problems = api.problems();
    const where = await api.saveAs('sandbox', 'Sandbox Yard');
    return { problems, where, n: api.level.objects.length };
  });
  console.log('   sandbox problems:', JSON.stringify(res.problems));
  ok(res.problems.filter((p) => p.sev !== 'info').length === 0, 'sandbox level has no errors or warnings');
  ok(/project/.test(res.where), 'sandbox saved to the project (' + res.n + ' objects)');
  ok(fs.existsSync('public/levels/sandbox.json'), 'public/levels/sandbox.json written');
  await E(() => window.__editor.camera([30, 32, 52], 0.55, -0.55));
  await shot('20-sandbox');
  await E(() => window.__editor.topView(true));
  await E(() => window.__editor.frame());
  await shot('21-sandbox-top');
  await E(() => window.__editor.topView(false));
  await E(() => window.__editor.select(window.__editor.level.objects.find((o) => o.name === 'backyard_trigger').id));
  await E(() => window.__editor.frame(window.__editor.selection()));
  await shot('22-sandbox-trigger');
};

tests.interact = async () => {
  await boot();
  await E(() => window.__editor.camera([0, 16, 16], 0, -0.8));
  const r = await vpRect();
  // camera: right-drag looks, wheel dollies, T toggles the map
  const c0 = await E(() => window.__editor.cameraState());
  await page.mouse.move(r.cx, r.cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(r.cx + 120, r.cy, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  const c1 = await E(() => window.__editor.cameraState());
  ok(Math.abs(c1.yaw - c0.yaw) > 0.3, 'right-drag turns the camera');
  await page.mouse.wheel(0, -400);
  await settle(100);
  const c2 = await E(() => window.__editor.cameraState());
  ok(c2.pos[1] < c1.pos[1], 'mouse wheel dollies towards the cursor');
  await page.keyboard.down('KeyW');
  await settle(300);
  await page.keyboard.up('KeyW');
  const c3 = await E(() => window.__editor.cameraState());
  ok(Math.hypot(c3.pos[0] - c2.pos[0], c3.pos[2] - c2.pos[2]) > 1, 'W flies forward');
  await page.keyboard.press('t');
  ok((await E(() => window.__editor.cameraState())).top, 'T switches to the top-down map');
  await page.keyboard.press('t');
  await E(() => window.__editor.camera([0, 16, 16], 0, -0.8));
  // patrol editing by clicking in the world, then dragging a point
  const en = await E(() => window.__editor.place('enemy:assoc', [0, 0, 0]));
  await settle(100);
  await page.click('text=Add points by clicking');
  for (const p of [[4, 0, 0], [4, 0, -6], [-4, 0, -6]]) {
    const sp = await E((p) => window.__editor.toScreen(p), p);
    await page.mouse.click(sp.x, sp.y);
  }
  let pat = (await E((id) => window.__editor.get(id), en)).patrol;
  ok(pat?.length === 3 && Math.abs(pat[1][0] - 4) < 0.3 && Math.abs(pat[1][2] + 6) < 0.3, 'clicking adds patrol points (' + JSON.stringify(pat) + ')');
  await shot('23-patrol');
  const h1 = await E(() => window.__editor.toScreen([4, 0.15, -6]));
  const to = await E(() => window.__editor.toScreen([6, 0, -8]));
  await page.mouse.move(h1.x, h1.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  pat = (await E((id) => window.__editor.get(id), en)).patrol;
  ok(Math.abs(pat[1][0] - 6) < 0.4 && Math.abs(pat[1][2] + 8) < 0.4, 'dragging a patrol point moves it');
  await page.click('.inspector .row:has-text("Point 3") .btn');
  pat = (await E((id) => window.__editor.get(id), en)).patrol;
  ok(pat.length === 2, 'patrol point deleted from the inspector');
  await page.keyboard.press('Escape');
  ok(await E(() => window.__editor.ed.patrolEdit === null), 'Esc leaves patrol mode');
  // outliner: click selects, eye hides, lock blocks picking
  const box = await E(() => window.__editor.place('box', [-6, 0, 2]));
  await E(() => window.__editor.select([]));
  await page.click(`.out-row[data-id="${box}"] .out-name`);
  ok((await E(() => window.__editor.selection()))[0] === box, 'outliner click selects');
  await page.click(`.out-row[data-id="${box}"] .out-tog >> nth=1`);
  ok(await E((id) => window.__editor.get(id).locked === true, box), 'outliner lock toggle sets locked');
  await E(() => window.__editor.select([]));
  const bs = await E((id) => window.__editor.objectScreen(id), box);
  await page.mouse.click(bs.x, bs.y);
  ok(!(await E(() => window.__editor.selection())).includes(box), 'locked objects cannot be clicked in the view (the click goes through)');
  await page.click(`.out-row[data-id="${box}"] .out-tog >> nth=0`);
  ok(await E((id) => window.__editor.ed.sync.hidden.has(id), box), 'outliner eye hides it');
  await shot('24-outliner');
  // keyboard copy / paste under the cursor
  await E((id) => window.__editor.select(id), en);
  await page.keyboard.press('Control+c');
  const tgt = await E(() => window.__editor.toScreen([-8, 0, -8]));
  await page.mouse.move(tgt.x, tgt.y);
  await page.keyboard.press('Control+v');
  const pasted = await E(() => window.__editor.get(window.__editor.selection()[0]));
  ok(pasted.type === 'enemy' && Math.abs(pasted.pos[0] + 8) < 0.6 && Math.abs(pasted.pos[2] + 8) < 0.6 && pasted.patrol?.length === 2, 'Ctrl+C / Ctrl+V pastes under the cursor (with its patrol)');
  // F frames
  const before = await E(() => window.__editor.cameraState());
  await page.keyboard.press('f');
  ok(JSON.stringify(before.pos) !== JSON.stringify((await E(() => window.__editor.cameraState())).pos), 'F frames the selection');
  // the real PLAY button: writes the level, restarts the page as the game, and F4 comes back
  await E(() => window.__editor.ed.problems.length);
  const j = await E(() => window.__editor.json());
  const title = JSON.parse(j).title;
  await page.click('.tb[data-id="play"]');
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 60000 });
  const stored = await E(() => localStorage.getItem('emg-editor-level'));
  ok(!/#editor/.test(page.url()) && !!(await page.$('canvas#game')) && stored && JSON.stringify(JSON.parse(stored), null, 1) + '\n' === j, 'PLAY writes emg-editor-level and restarts the page as the game');
  await page.click('.go');
  await page.waitForFunction(() => window.__game.state === 'playing' && window.__game.level, null, { timeout: 60000 });
  const played = await E(() => ({ title: window.__game.level.title, back: /BACK TO EDITOR/.test(document.getElementById('ui').textContent) }));
  ok(played.title === title && played.back, 'the game loads the edited level (“' + played.title + '”) and offers the way back');
  await shot_game('26-playtest');
  await page.keyboard.press('F4');
  await page.waitForFunction(() => window.__editor && window.__editor.ready, null, { timeout: 60000 });
  ok(/#editor$/.test(page.url()) && (await E(() => window.__editor.json())) === j, 'F4 returns to the editor with the level restored');
};

tests.statichost = async () => {
  // pretend the dev endpoints do not exist (a static host): saving must fall back to the browser
  allow404 = true;
  await page.route((u) => u.pathname.includes('__editor/'), (route) => route.fulfill({ status: 404, body: 'not found' }));
  await boot();
  const r = await E(async () => {
    const api = window.__editor;
    api.place('box', [0, 0, 0]);
    const where = await api.saveAs('zz_static_test', 'Static');
    const list = await api.listProject();
    return { where, browser: api.listBrowser().map((l) => l.id), list: list.map((l) => l.id), status: document.querySelector('.st-save').textContent };
  });
  ok(r.where === 'this browser' && r.browser.includes('zz_static_test'), 'without the dev server, Save goes to browser storage (' + r.where + ')');
  ok(r.list.includes('sandbox'), 'Open still lists the shipped levels from levels/index.json');
  ok(/browser/.test(r.status), 'status bar says where it went: ' + r.status);
  ok(!fs.existsSync('public/levels/zz_static_test.json'), 'nothing was written to the project');
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await shot('25-static-host');
  await boot();
  allow404 = false;
};

const order = ['empty', 'palette', 'transform', 'inspector', 'actions', 'undo', 'files', 'validate', 'gamelook', 'interact', 'statichost', 'stress', 'sandbox'];
for (const name of order) {
  if (only.length && !only.includes(name)) continue;
  console.log('== ' + name);
  const t0 = Date.now();
  try {
    await tests[name]();
  } catch (e) {
    failures++;
    console.log('  FAIL', name, 'threw:', String(e?.stack ?? e).slice(0, 1200));
    await page.screenshot({ path: 'shots/editor-fail-' + name + '.png' }).catch(() => {});
  }
  console.log('   (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
}
await browser.close();
console.log(`\n${passes} passed, ${failures} failed, ${errors.length} console errors`);
if (errors.length) console.log(errors.slice(0, 10).join('\n'));
process.exit(failures || errors.length ? 1 : 0);
