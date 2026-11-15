// Generates the first-draft layout of Mission 01 "Receiving" -> public/levels/m01.json
//
//   node tools/levels/gen_m01.mjs
//
// The JSON is the source of truth once you start editing it in the level editor:
// re-running this script OVERWRITES it. Keep it as a record of how the layout was blocked out.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/levels/m01.json');

let seed = 20261;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const rr = (a, b) => a + (b - a) * rnd();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const r2 = (v) => Math.round(v * 100) / 100;
const P = (x, y, z) => [r2(x), r2(y), r2(z)];

const objects = [];
let n = 0;
const add = (o) => {
  o.id = o.id ?? `${o.type[0]}${(++n).toString(36)}`;
  objects.push(o);
  return o;
};

const C = { asphalt: '#4b4852', concrete: '#b9b3a8', concreteDark: '#8d8880', sand: '#d9a066', sandDark: '#b87a4b', rock: '#9a6a55', rockDark: '#6e4a41', steel: '#7d8a99', steelDark: '#4d5663', white: '#e6e0d0', yellow: '#ffd21f', tile: '#d8d2c4' };
const CONT = ['#b5442f', '#2f6f9f', '#2e9b8f', '#e0a82e', '#5a8f4a', '#e6e0d0'];
const CARS = ['#b5442f', '#2f6f9f', '#e6e0d0', '#3a3d46', '#5a8f4a', '#e0a82e'];

const box = (x, y, z, sx, sy, sz, mat, color, extra = {}) => add({ type: 'box', pos: P(x, y, z), size: P(sx, sy, sz), mat, color, ...extra });
/** box given by its floor centre */
const block = (x, z, sx, sy, sz, mat, color, extra = {}) => box(x, sy / 2 + (extra.y ?? 0), z, sx, sy, sz, mat, color, extra);
const prop = (id, x, z, yaw = 0, extra = {}) => add({ type: 'prop', prop: id, pos: P(x, extra.y ?? 0, z), rot: [0, r2(yaw), 0], ...extra, y: undefined });
const enemy = (kind, x, z, extra = {}) => add({ type: 'enemy', kind, pos: P(x, extra.y ?? 0, z), rot: [0, r2(extra.yaw ?? Math.PI), 0], ...extra, y: undefined, yaw: undefined });
const pickup = (kind, x, z, extra = {}) => add({ type: 'pickup', kind, pos: P(x, (extra.y ?? 0) + 0.05, z), ...extra, y: undefined });
const trigger = (name, x, z, sx, sz, actions, extra = {}) => add({ type: 'trigger', name, pos: P(x, 3, z), size: P(sx, 10, sz), once: true, actions, ...extra });
const checkpoint = (x, z, yaw = 0, sx = 24, sz = 6) => add({ type: 'checkpoint', pos: P(x, 0.1, z), rot: [0, yaw, 0], size: P(sx, 6, sz) });
const nav = (x, z, sx, sz, y0 = -1, y1 = 9) => add({ type: 'nav', pos: P(x, (y0 + y1) / 2, z), size: P(sx, y1 - y0, sz) });
const HALF = Math.PI / 2;

// =============================================================== ground + perimeter (zones A-E)
box(0, -0.5, 20, 82, 1, 222, 'asphalt', C.asphalt, { uv: 6 });
box(-40.5, 2.5, 20, 1, 5, 222, 'concrete', C.concrete);
box(40.5, 2.5, 20, 1, 5, 222, 'concrete', C.concrete);
box(0, 2.5, 130.5, 82, 5, 1, 'concrete', C.concrete);
nav(0, 20, 80, 220);

// ---- distant skyline: more MonoMart, forever
for (const [x, z, sx, sy, sz] of [[-120, 60, 70, 26, 90], [130, 0, 80, 34, 120], [-140, -120, 90, 22, 100], [125, -200, 70, 40, 90], [0, 210, 160, 30, 60], [-150, -330, 80, 28, 120], [150, -380, 90, 36, 110]]) {
  block(x, z, sx, sy, sz, 'panel', '#c9c2b4', { uv: 14, collide: false });
  box(x, sy + 1.5, z, sx * 0.5, 3, sz * 0.5, 'panel', '#a8a297', { collide: false, uv: 14 });
  box(x, sy * 0.55, z + sz / 2 + 0.2, sx * 0.9, sy * 0.16, 0.4, 'plain', C.yellow, { collide: false });
}

// =============================================================== ZONE A - employee parking (z 60..130)
for (const z of [101, 80]) {
  for (let x = -27; x <= 27; x += 6) {
    if (Math.abs(x) < 4 && z === 101) continue; // keep the lane to the gate clear near the start
    if (rnd() < 0.24) continue;
    prop('car', x + rr(-0.3, 0.3), z + rr(-0.4, 0.4), (rnd() < 0.5 ? 0 : Math.PI) + rr(-0.06, 0.06), { color: pick(CARS) });
  }
}
// painted bays
for (const z of [101, 80]) for (let x = -30; x <= 30; x += 6) box(x, 0.012, z, 0.14, 0.02, 5, 'plain', C.white, { collide: false });
for (const [x, z] of [[-15, 91], [15, 91], [-15, 69], [15, 69]]) prop('lamp', x, z, x < 0 ? HALF : -HALF);
prop('billboard', -27, 66, 0, { variant: 0 });
prop('billboard', 29, 125, Math.PI, { variant: 3 });
// the stolen delivery truck we arrived in, already redecorated
prop('truck', 7.5, 119, 0.35, { color: '#b5442f', variant: 4 });
prop('union_sign', 5.2, 122.6, 0.35 + HALF, {});
prop('crate', -6, 117, 0.3);
prop('boxes', -7.4, 115.6, 0.9, { variant: 1 });
for (const [x, z, r] of [[11, 90, 0.4], [12.2, 91.4, 1.2], [-20, 72, 2.1], [22, 97, 0.2], [-4, 88, 1.0]]) prop('cart', x, z, r);
for (const [x, z] of [[-9, 96], [9.5, 86], [-2, 74]]) prop('cone', x, z);
prop('dumpster', 34, 108, HALF);
prop('dumpster', 34, 104.5, HALF, { color: '#2f6f9f' });
prop('barrier', -10, 63.5, 0.1);
prop('barrier', 9, 64.5, -0.15);
prop('pallet_load', 20, 66, 0.3, { variant: 0 });
prop('pallet_load', 21.6, 67.2, 1.1, { variant: 2 });
add({ type: 'locker', pos: P(-34, 0, 110), rot: [0, HALF, 0], luck: 1, name: 'locker_lot' });
add({ type: 'weapon', pos: P(-3.4, 1, 116.4), shield: true, brand: 'picket', rarity: 1, seed: 404 });
add({ type: 'weapon', pos: P(17, 1, 84), cls: 'rifle', brand: 'valu', rarity: 1, seed: 7 });
pickup('ammo', -5, 118.4, { cls: 'pistol', amount: 36 });
pickup('ammo', 18.4, 84.6, { cls: 'rifle', amount: 60 });
pickup('health', -33, 107.4, { amount: 30 });

add({ type: 'ally', voice: 'rivet', name: 'rivet', essential: true, pos: P(-3.2, 0, 113.6), rot: [0, 0, 0] });
add({ type: 'ally', voice: 'dutch', name: 'dutch', essential: true, pos: P(3.4, 0, 114.4), rot: [0, 0, 0] });
add({ type: 'ally', voice: 'hank', name: 'hank', pos: P(0.4, 0, 117.2), rot: [0, 0, 0] });

enemy('assoc', -12, 92, { squad: 'lot', patrol: [P(-12, 0, 74), P(-22, 0, 86)] });
enemy('assoc', 6, 88, { squad: 'lot', patrol: [P(18, 0, 92), P(8, 0, 74)] });
enemy('assoc', 21, 75, { squad: 'lot' });
enemy('assoc', -6, 66, { squad: 'lot2' });
enemy('assoc', 5, 67, { squad: 'lot2' });
trigger('first_contact', 0, 104, 70, 4, [{ do: 'say', line: 'm01_first_contact' }]);
trigger('locker_hint', -30, 109, 12, 8, [{ do: 'say', line: 'm01_locker_hint' }]);

// =============================================================== ZONE B - loading docks (z 5..60)
for (let x = -36; x <= 36; x += 4) if (Math.abs(x) > 7) prop('fence', x, 60, 0);
checkpoint(0, 58, 0, 14, 5);
// warehouse wing with the dock along the west side
box(-34.5, 6, 33, 11, 12, 54, 'panel', '#cfc8ba', { uv: 6 });
box(-34.5, 12.2, 33, 11.6, 0.6, 54.6, 'plain', C.steelDark, { collide: false });
box(-28.92, 9.6, 33, 0.2, 1.6, 54, 'plain', C.yellow, { collide: false });
box(-25.5, 0.6, 33, 7, 1.2, 54, 'concrete', C.concrete, { uv: 4 });
box(-22.1, 1.14, 33, 0.24, 0.12, 54, 'hazard', '#ffffff', { collide: false, uv: 1 });
add({ type: 'ramp', pos: P(-25.5, 0, 63), size: P(7, 1.2, 6), rot: [0, Math.PI, 0], mat: 'concrete', color: C.concrete });
add({ type: 'stairs', pos: P(-25.5, 0, 4), size: P(5, 1.2, 4), rot: [0, 0, 0], mat: 'concrete', color: C.concreteDark, steps: 6 });
let door = 0;
for (let z = 12; z <= 54; z += 8.4) prop('dock_door', -28.9, z, HALF, { y: 1.2, variant: door++ });
prop('sign', -28.9, 29, HALF, { y: 7.4, scale: 3.2, variant: 1 });
// trailers backed up to the dock, trucks loose in the court
prop('trailer', -15.6, 20.4, HALF, { variant: 1 });
prop('trailer', -15.6, 45.6, HALF, { variant: 5, color: '#ffd21f' });
prop('truck', 9, 31, 0.35, { variant: 2 });
prop('truck', 21, 49, -0.5, { variant: 6 });
prop('trailer', 30, 22, 0.08, { variant: 7 });
prop('forklift', -2, 21, 2.2);
prop('forklift', -24.6, 37, HALF, { y: 1.2 });
for (const [x, z, id, r] of [[2, 40, 'pallet_load', 0.2], [3.5, 41.4, 'pallet_load', 1.4], [-4.5, 34, 'crate_big', 0.3], [-6.4, 33, 'crate', 0.9], [14, 18, 'pallet_load', 0.6], [15.4, 16.6, 'crate', 0.2], [-9, 10, 'barrier', 0.2], [6, 9, 'barrier', -0.2], [-24, 28, 'pallet_load', 0.1], [-26.4, 50, 'boxes', 0.5], [-24.4, 16, 'crate', 0.4]]) {
  prop(id, x, z, r, { variant: Math.floor(rr(0, 3)), y: x < -22 ? 1.2 : 0 });
}
for (const [x, z] of [[3.2, 26], [4.3, 27.1], [15.6, 39], [-8, 48]]) add({ type: 'barrel', pos: P(x, 0, z) });
add({ type: 'locker', pos: P(-28.3, 1.2, 8.4), rot: [0, HALF, 0], luck: 1, name: 'locker_dock' });
pickup('ammo', -24, 44, { cls: 'rifle', amount: 45, y: 1.2 });
pickup('ammo', 12, 17, { cls: 'pistol', amount: 24 });
pickup('health', 28, 27, { amount: 30 });
pickup('mine', -3, 20, { amount: 1 });

enemy('assoc', -25, 30, { squad: 'dock', y: 1.2, yaw: HALF });
enemy('assoc', -25.4, 46, { squad: 'dock', y: 1.2, yaw: HALF });
enemy('super', 4, 22, { squad: 'dock' });
enemy('assoc', 13, 36, { squad: 'dock' });
enemy('assoc', -8, 16, { squad: 'dock' });
enemy('assoc', -4, 6, { squad: 'dock_r', tag: 'dock_reinf' });
enemy('assoc', 2, 5, { squad: 'dock_r', tag: 'dock_reinf' });
enemy('assoc', 9, 7, { squad: 'dock_r', tag: 'dock_reinf' });
trigger('dock_reinf', 0, 36, 80, 4, [{ do: 'spawn', tag: 'dock_reinf' }]);
trigger('first_loot', -27, 9, 10, 10, [{ do: 'say', line: 'm01_first_loot' }]);

// =============================================================== ZONE C - container yard (z -50..5)
checkpoint(0, 3, 0, 30, 5);
trigger('yard', 0, 1, 80, 4, [{ do: 'say', line: 'm01_yard' }]);
// [x, z, alongX, colour, stack]
const stacks = [
  [-33, -4, 0, 0, 2], [-30.4, -11, 0, 2, 1], [-33, -18, 0, 3, 3], [-33, -29, 0, 1, 2], [-30.4, -38, 0, 4, 1], [-33, -46, 0, 0, 2],
  [33, -5, 0, 1, 3], [30.4, -14, 0, 5, 1], [33, -23, 0, 2, 2], [33, -34, 0, 3, 1], [30.4, -44, 0, 0, 3],
  [-18, -6, 1, 3, 1], [-14, -16, 0, 1, 2], [-20, -27, 1, 5, 1], [-12, -36, 0, 2, 2], [-21, -44, 1, 4, 1],
  [16, -8, 1, 4, 2], [20, -18, 0, 0, 1], [13, -27, 1, 2, 1], [21, -37, 1, 1, 2], [12, -45, 0, 3, 1],
  [-2, -12, 1, 0, 1], [3, -40, 1, 5, 2],
];
for (const [x, z, alongX, ci, lv] of stacks) {
  for (let l = 0; l < lv; l++) {
    prop('container', x + (l ? rr(-0.25, 0.25) : 0), z + (l ? rr(-0.25, 0.25) : 0), (alongX ? HALF : 0) + (l ? rr(-0.05, 0.05) : 0), { y: l * 2.6, color: CONT[(ci + l * 2) % CONT.length] });
  }
}
// a walk-through container and crate steps onto the low stacks
prop('container_open', 2, -26, 0, { color: CONT[1] });
for (const [x, z, id, r] of [[-11.6, -11, 'crate', 0.2], [-10.4, -12.2, 'crate_big', 0.5], [17.6, -22.4, 'crate_big', 0.1], [16.2, -21.2, 'crate', 0.7], [-6, -30, 'pallet_load', 0.3], [8, -15, 'pallet_load', 1.2], [9.6, -16.2, 'crate', 0.4], [-25, -21, 'boxes', 0.2], [26, -29, 'pallet_load', 0.9], [0.6, -5, 'barrier', 0.05], [-7, -44, 'crate_big', 0.2], [7.5, -33.6, 'crate', 0.3]]) prop(id, x, z, r, { variant: Math.floor(rr(0, 3)) });
for (const [x, z] of [[-5, -21], [10, -34.6], [-24, -33], [24, -11]]) add({ type: 'barrel', pos: P(x, 0, z) });
// gantry crane straddling the yard
for (const x of [-26.5, 26.5]) for (const z of [-22, -28]) block(x, z, 0.9, 15, 0.9, 'panel', C.yellow, { uv: 3 });
box(0, 15.4, -25, 56, 1.4, 7, 'panel', C.yellow, { uv: 3, collide: false });
box(6, 13.2, -25, 3, 3, 3, 'panel', C.steelDark, { collide: false });
box(6, 9.4, -25, 0.2, 5, 0.2, 'plain', '#2a2c34', { collide: false });
add({ type: 'weapon', pos: P(2, 1, -27), cls: 'shotgun', rarity: 1, seed: 21 });
pickup('ammo', 3, -25.4, { cls: 'shotgun', amount: 16 });
pickup('ammo', -24, -20, { cls: 'rifle', amount: 45 });
pickup('health', 25.4, -30.4, { amount: 30 });

enemy('assoc', -8, -8, { squad: 'yard' });
enemy('assoc', 9, -12, { squad: 'yard', patrol: [P(9, 0, -22), P(-4, 0, -18)] });
enemy('super', 0, -20, { squad: 'yard' });
enemy('assoc', -22, -34, { squad: 'yard2' });
enemy('assoc', 24, -30, { squad: 'yard2' });
enemy('assoc', -3, -36, { squad: 'yard2', patrol: [P(8, 0, -38), P(-6, 0, -46)] });
for (const [x, z] of [[-14, -30], [0, -34], [15, -26]]) enemy('drone', x, z, { tag: 'yard_drones' });
trigger('drones', 0, -14, 80, 4, [{ do: 'spawn', tag: 'yard_drones' }, { do: 'say', line: 'm01_drones' }, { do: 'wait', seconds: 2.4 }, { do: 'say', line: 'm01_drones_s' }]);

// =============================================================== ZONE D - the dock gate (z -55)
box(-22.25, 3.2, -55, 35.5, 6.4, 1.6, 'concrete', C.concrete);
box(22.25, 3.2, -55, 35.5, 6.4, 1.6, 'concrete', C.concrete);
box(0, 6.9, -55, 81, 1.0, 2.0, 'hazard', '#ffffff', { uv: 1.2, collide: false });
prop('gate', 0, -55, 0, { dynamic: true, name: 'dockgate' });
add({ type: 'destructible', prop: 'coupling', name: 'coupling_w', pos: P(-7.6, 0, -53.6), rot: [0, 0, 0], hp: 40, by: 'explosion', actions: [{ do: 'unmark', target: 'coupling_w' }, { do: 'count', id: 'couplings', need: 1, then: [{ do: 'say', line: 'm01_gate_one' }] }, { do: 'count', id: 'couplings_all', need: 2, then: [{ do: 'script', name: 'gate_blown' }] }] });
add({ type: 'destructible', prop: 'coupling', name: 'coupling_e', pos: P(7.6, 0, -53.6), rot: [0, 0, 0], hp: 40, by: 'explosion', actions: [{ do: 'unmark', target: 'coupling_e' }, { do: 'count', id: 'couplings', need: 1, then: [{ do: 'say', line: 'm01_gate_one' }] }, { do: 'count', id: 'couplings_all', need: 2, then: [{ do: 'script', name: 'gate_blown' }] }] });
prop('tower', -16, -49.4, 0);
prop('barrier', -4, -47.5, 0.1);
prop('barrier', 4.6, -48, -0.1);
prop('sandbags', 12, -47, 0.2);
prop('kiosk', 18, -53.2, Math.PI);
pickup('mine', -1.4, -41, { amount: 2 });
pickup('mine', 0, -41.6, { amount: 2 });
pickup('mine', 1.4, -41, { amount: 2 });
add({ type: 'marker', name: 'mine_cache', pos: P(0, 0, -41) });
enemy('assoc', -3, -50, { squad: 'gate', hold: true });
enemy('assoc', 5, -50.4, { squad: 'gate', hold: true });
enemy('assoc', 12, -49, { squad: 'gate' });
trigger('gate_brief', 0, -37, 80, 4, [
  { do: 'say', line: 'm01_gate_1' },
  { do: 'wait', seconds: 4.6 },
  { do: 'say', line: 'm01_gate_2' },
  { do: 'objective', id: 'gate', text: 'Blow both power couplings: plant charges, then squeeze the watch' },
  { do: 'marker', target: 'coupling_w', label: 'COUPLING' },
  { do: 'marker', target: 'coupling_e', label: 'COUPLING' },
]);

// =============================================================== ZONE E - motor pool (z -90..-58)
box(-24, 3.2, -90, 32, 6.4, 1.6, 'concrete', C.concrete);
box(24, 3.2, -90, 32, 6.4, 1.6, 'concrete', C.concrete);
add({ type: 'vehicle', kind: 'teamster', name: 'teamster', pos: P(-7, 0.9, -72), rot: [0, 0, 0] });
add({ type: 'vehicle', kind: 'vesper', pos: P(8, 0.7, -68), rot: [0, 0.3, 0] });
add({ type: 'vehicle', kind: 'vesper', pos: P(11.4, 0.7, -70), rot: [0, 0.1, 0] });
prop('container', -30, -66, 0, { color: CONT[4] });
prop('container', -30, -76, 0, { color: CONT[0] });
prop('truck', 29, -70, Math.PI, { variant: 8 });
prop('pallet_load', 20, -63, 0.4, { variant: 1 });
prop('crate_big', -18, -84, 0.3);
prop('barrier', 14, -84, 0.1);
prop('lamp', -20, -62, HALF);
prop('lamp', 20, -62, -HALF);
prop('billboard', -30, -86.5, 0, { variant: 5 });
add({ type: 'locker', pos: P(34, 0, -80), rot: [0, -HALF, 0], luck: 2, name: 'locker_pool' });
pickup('health', 22, -64.5, { amount: 30 });
pickup('ammo', -17, -82.4, { cls: 'rifle', amount: 60 });
pickup('ammo', -16, -83.4, { cls: 'sniper', amount: 10 });
enemy('assoc', -14, -66, { squad: 'pool', tag: 'pool' });
enemy('assoc', 16, -72, { squad: 'pool', tag: 'pool' });
enemy('assoc', 0, -82, { squad: 'pool', tag: 'pool' });
trigger('motorpool', 0, -60, 30, 4, [{ do: 'checkpoint' }, { do: 'say', line: 'm01_motorpool' }, { do: 'wait', seconds: 5 }, { do: 'say', line: 'm01_scooter' }, { do: 'objective', id: 'drive', text: 'Drive the Last Mile to the front door' }]);

// =============================================================== ZONE F - the Last Mile (z -430..-90)
box(0, -0.5, -262, 96, 1, 344, 'sand', C.sand, { uv: 9 });
box(0, -0.22, -260, 12, 0.5, 340, 'asphalt', C.asphalt, { uv: 6 });
for (let z = -98; z > -428; z -= 9) box(0, 0.035, z, 0.22, 0.02, 3.4, 'plain', C.yellow, { collide: false });
// canyon walls
for (let z = -97; z >= -428; z -= 13) {
  for (const side of [-1, 1]) {
    const inset = 27 + Math.sin(z * 0.045 + side) * 6 + rr(-2, 2);
    const w = rr(16, 22);
    const h = rr(9, 16);
    box(side * (inset + w / 2), h / 2 - 1, z + rr(-2, 2), w, h, rr(15, 19), 'rock', rnd() < 0.5 ? C.rock : C.rockDark, { rot: [rr(-0.06, 0.06), rr(-0.25, 0.25), rr(-0.08, 0.08)], uv: 7 });
    if (rnd() < 0.55) prop('rock', side * (inset - rr(1, 5)), z + rr(-5, 5), rr(0, 6), { variant: Math.floor(rr(0, 5)), scale: r2(rr(0.7, 1.6)), color: rnd() < 0.5 ? C.rock : C.sandDark });
    if (rnd() < 0.3) prop('cactus', side * (inset - rr(3, 9)), z + rr(-5, 5), rr(0, 6), { variant: Math.floor(rr(0, 3)) });
  }
}
checkpoint(0, -93, 0, 14, 5);
// --- first ambush
nav(0, -152, 64, 44);
for (const [x, z, id, r] of [[-12, -146, 'barrier', 0.3], [-14.4, -152, 'sandbags', 0.5], [13, -150, 'barrier', -0.3], [15, -157, 'pallet_load', 0.2], [-18, -160, 'crate_big', 0.4], [19, -144, 'container', 0.5]]) prop(id, x, z, r, { color: id === 'container' ? CONT[3] : undefined });
enemy('assoc', -13, -149, { squad: 'mile1', yaw: 0.2 });
enemy('assoc', -16, -156, { squad: 'mile1', yaw: 0.2 });
enemy('assoc', 14, -153, { squad: 'mile1', yaw: -0.2 });
enemy('assoc', 17, -147, { squad: 'mile1', yaw: -0.2 });
prop('billboard', -23, -128, 0.5, { variant: 2 });
prop('billboard', 22, -182, -0.5, { variant: 9 });
trigger('price', 0, -118, 90, 4, [{ do: 'say', line: 'm01_price_1' }, { do: 'wait', seconds: 6.4 }, { do: 'say', line: 'm01_price_2' }]);
// --- rolling ground
box(0, -0.2, -196, 40, 1.6, 26, 'sand', C.sandDark, { rot: [0.07, 0, 0], uv: 9 });
box(0, -0.2, -208, 40, 1.6, 12, 'sand', C.sandDark, { rot: [-0.1, 0, 0], uv: 9 });
// --- roadblock with a way over and a way round
nav(0, -250, 70, 56);
trigger('roadblock', 0, -214, 90, 4, [{ do: 'say', line: 'm01_roadblock' }]);
add({ type: 'ramp', pos: P(0, 0, -236), size: P(9, 1.9, 9), rot: [0, Math.PI, 0], mat: 'panel', color: C.steel });
for (const x of [-9, -5, -1, 3, 7, 11]) prop('hazard_barrier', x - 1, -246, rr(-0.08, 0.08));
prop('truck', -17, -249, HALF + 0.2, { variant: 3 });
prop('truck', 18, -252, -HALF - 0.15, { variant: 1 });
for (const [x, z, id, r] of [[-8, -254, 'barrier', 0.1], [6, -256, 'barrier', -0.2], [-22, -262, 'crate_big', 0.3], [23, -262, 'pallet_load', 0.5], [0, -262, 'sandbags', 0]]) prop(id, x, z, r);
for (const [x, z] of [[-4, -250], [10, -251.4], [-13, -256]]) add({ type: 'barrel', pos: P(x, 0, z) });
enemy('super', 0, -258, { squad: 'block', yaw: 0 });
enemy('assoc', -9, -256, { squad: 'block', yaw: 0 });
enemy('assoc', 7, -258, { squad: 'block', yaw: 0 });
enemy('assoc', -20, -258, { squad: 'block', yaw: 0 });
enemy('assoc', 21, -259, { squad: 'block', yaw: 0 });
enemy('drone', -6, -244, { tag: 'block_drones' });
enemy('drone', 8, -246, { tag: 'block_drones' });
trigger('block_drones', 0, -205, 90, 4, [{ do: 'spawn', tag: 'block_drones' }]);
checkpoint(0, -278, 0, 60, 6);
pickup('health', 0, -270, { amount: 30 });
pickup('ammo', 2, -271, { cls: 'rifle', amount: 60 });
// --- the crest
box(0, 0.2, -312, 44, 2.4, 30, 'sand', C.sand, { rot: [0.085, 0, 0], uv: 9 });
box(0, 0.2, -330, 44, 2.4, 16, 'sand', C.sand, { rot: [-0.14, 0, 0], uv: 9 });
// --- last stand before the forecourt
nav(0, -372, 70, 56);
for (const [x, z, id, r] of [[-10, -366, 'barrier', 0.2], [11, -370, 'barrier', -0.2], [-16, -378, 'container', HALF], [17, -382, 'container', HALF + 0.2], [0, -384, 'sandbags', 0], [-6, -376, 'pallet_load', 0.4]]) prop(id, x, z, r, { color: id === 'container' ? pick(CONT) : undefined });
prop('tower', 24, -366, 0);
enemy('assoc', -11, -369, { squad: 'mile3', yaw: 0 });
enemy('assoc', 12, -373, { squad: 'mile3', yaw: 0 });
enemy('assoc', 0, -386, { squad: 'mile3', yaw: 0 });
for (const [x, z] of [[-12, -350], [0, -356], [12, -352], [4, -344]]) enemy('drone', x, z, { tag: 'mile_drones' });
trigger('mile_drones', 0, -318, 90, 4, [{ do: 'spawn', tag: 'mile_drones' }]);
checkpoint(0, -418, 0, 60, 6);

// =============================================================== ZONE G - FC-7 forecourt (z -520..-430)
box(0, -0.5, -477, 96, 1, 94, 'tile', C.tile, { uv: 5 });
nav(0, -477, 94, 92);
for (const side of [-1, 1]) box(side * 47.5, 5, -477, 1.5, 10, 94, 'concrete', C.concrete);
// the fulfilment centre
box(0, 15, -540, 130, 30, 32, 'panel', '#d2cabb', { uv: 8 });
box(0, 30.6, -540, 132, 1.2, 33, 'plain', C.steelDark, { collide: false });
box(0, 22, -523.8, 130, 3, 0.5, 'plain', C.yellow, { collide: false });
box(0, 4.5, -523.6, 22, 9, 1.2, 'concrete', C.concreteDark);
add({ type: 'box', name: 'fcdoor', dynamic: true, pos: P(0, 3.25, -522.6), size: P(11, 6.5, 0.8), mat: 'hazard', color: '#ffffff', uv: 1.6 });
prop('sign', 0, -523.4, 0, { y: 11.5, scale: 7, variant: 0 });
for (const x of [-30, -18, 18, 30]) prop('dock_door', x, -523.8, 0, { variant: (x + 40) % 9 });
// arena dressing: plenty to hide behind, room for a mech to walk
for (const [x, z, id, r, extra] of [
  [-14, -452, 'barrier', 0.1], [14, -452, 'barrier', -0.1], [-26, -462, 'truck', 0.3, { variant: 5 }], [27, -466, 'truck', -0.4, { variant: 7 }],
  [-8, -470, 'crate_big', 0.2], [9, -474, 'pallet_load', 0.5], [-20, -484, 'container', 0.2, { color: CONT[2] }], [21, -488, 'container', -0.3, { color: CONT[0] }],
  [0, -462, 'kiosk', 0], [-34, -498, 'pallet_load', 0.3], [34, -500, 'crate_big', 0.4], [-10, -500, 'barrier', 0.2], [11, -503, 'barrier', -0.2],
  [-36, -446, 'sandbags', 0.6], [36, -444, 'sandbags', -0.6], [0, -488, 'sandbags', 0],
]) prop(id, x, z, r, extra ?? {});
for (const [x, z] of [[-38, -474], [38, -478], [-12, -512], [12, -512]]) prop('lamp', x, z, x < 0 ? HALF : -HALF);
for (const [x, z] of [[-30, -470], [31, -482], [-4, -476]]) add({ type: 'barrel', pos: P(x, 0, z) });
add({ type: 'locker', pos: P(-45.6, 0, -470), rot: [0, HALF, 0], luck: 2, name: 'locker_arena' });
for (const [x, z, k, c] of [[-40, -450, 'ammo', 'rifle'], [40, -452, 'ammo', 'shotgun'], [-42, -500, 'health'], [42, -498, 'health'], [0, -446, 'ammo', 'pistol'], [-41, -452, 'mine'], [41, -454, 'ammo', 'sniper']]) pickup(k, x, z, { cls: c, amount: k === 'health' ? 40 : k === 'mine' ? 3 : undefined });
enemy('manager', 0, -506, { tag: 'boss', yaw: Math.PI, name: 'manager' });
enemy('assoc', -30, -508, { tag: 'boss_adds', squad: 'adds' });
enemy('assoc', 30, -508, { tag: 'boss_adds', squad: 'adds' });
enemy('assoc', -38, -488, { tag: 'boss_adds', squad: 'adds' });
enemy('assoc', 38, -490, { tag: 'boss_adds', squad: 'adds' });
enemy('super', 0, -516, { tag: 'boss_adds', squad: 'adds' });
trigger('arena', 0, -436, 96, 4, [{ do: 'checkpoint' }, { do: 'complete', id: 'drive' }, { do: 'script', name: 'boss_intro' }]);

const level = {
  format: 1,
  id: 'm01',
  title: 'Receiving',
  number: 'MISSION 01',
  sky: 'dawn',
  enemyLevel: 1,
  music: 'm01',
  killY: -30,
  spawn: { pos: [0, 0.1, 112], yaw: 0 },
  winOnAllDead: false,
  onStart: [{ do: 'objective', id: 'docks', text: 'Fight through the docks to the gate' }],
  watchers: [{ allDead: 'boss', actions: [{ do: 'script', name: 'ending' }] }],
  objects,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(level, null, 1) + '\n');
const count = {};
for (const o of objects) count[o.type] = (count[o.type] ?? 0) + 1;
console.log('wrote', out, objects.length, 'objects', JSON.stringify(count));
