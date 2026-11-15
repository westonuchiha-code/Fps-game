// url: ?level=test
// Loot pickup (tap/hold), lockers, charges + watch, melee, death and respawn.
game.manual = true;
game.step(30, 1 / 60);
const d = game.debug, pl = game.player, ai = game.ai, inv = game.inv;
const log = [];
let pass = true;
const expect = (cond, msg) => { log.push((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) pass = false; };
const V = (x, y, z) => pl.pos.clone().set(x, y, z);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const items = await import('/src/weapons/items.ts');

inv.slots = [inv.slots[0], null, null, null];
inv.active = 0;
game.weapons.equipActive();
game.step(40, 1 / 60);
game.loot.dropItem(items.rollWeapon(2, { cls: 'shotgun', rarity: 3, seed: 5 }), V(0, 0, 11), false);
game.step(120, 1 / 60);
d.tp(0, 0.05, 13, 0, 0);
d.lookAt(0, 0.45, 11);
game.step(3, 1 / 60);
expect(document.querySelector('.focuscard').classList.contains('show'), 'item card appears when looking at dropped loot');
d.run(2, { down: ['interact'] });
game.step(10, 1 / 60);
expect(!!inv.slots[1] && inv.slots[1].cls === 'shotgun', 'tap takes the item into the first free slot');

game.loot.dropItem(items.rollWeapon(2, { cls: 'sniper', rarity: 4, seed: 9 }), V(0, 0, 11), false);
game.step(120, 1 / 60);
d.lookAt(0, 0.45, 11);
game.step(3, 1 / 60);
d.run(40, { down: ['interact'] });
game.step(10, 1 / 60);
expect(inv.current && inv.current.cls === 'sniper' && inv.backpack.length === 1, 'hold equips it and moves the old gun to the backpack');

d.tp(-4, 0.05, 11.2, 0, 0);
d.lookAt(-4, 1.0, 9);
game.step(3, 1 / 60);
d.run(2, { down: ['interact'] });
for (let i = 0; i < 8; i++) { game.step(30, 1 / 60); await sleep(250); }
expect(game.stats.lockers === 1 && game.world.updatables.filter((u) => u.kind).length >= 5, 'parcel locker opens and sprays loot');

d.tp(0, 0.05, 6, 0, 0);
d.lookAt(-8, 1.5, -3);
game.step(5, 1 / 60);
const minesBefore = inv.mines;
d.run(2, { down: ['mine'] });
game.step(90, 1 / 60);
const m = game.mines.list[0];
expect(!!m && m.stuck && inv.mines === minesBefore - 1, 'thrown charge sticks');
const e1 = ai.spawnEnemy('assoc', V(m.pos.x, 0, m.pos.z - 0.8), { hold: true });
e1.brain.sense = () => {};
game.step(10, 1 / 60);
d.run(2, { down: ['detonate'] });
game.step(60, 1 / 60);
expect(!e1.alive && game.mines.list.length === 0, 'watch detonates it and kills the robot next to it');

const e2 = ai.spawnEnemy('assoc', V(0, 0, 4.2), { yaw: Math.PI, hold: true });
e2.brain.sense = () => {};
d.tp(0, 0.05, 6, 0, 0);
d.lookAt(0, 1.2, 4.2);
game.step(30, 1 / 60);
const hp0 = e2.health;
d.run(2, { down: ['melee'] });
game.step(40, 1 / 60);
expect(hp0 - e2.health > 20, 'melee lands');

game.setCheckpoint(V(5, 0.05, 12), 1.0, true);
pl.takeDamage({ amount: 9999, element: 'none', crit: false, kind: 'bullet', source: null, point: pl.pos.clone(), dir: V(0, 0, 1) });
expect(!pl.alive, 'player can die');
for (let i = 0; i < 12; i++) { game.step(30, 1 / 60); await sleep(120); }
expect(pl.alive && Math.abs(pl.pos.x - 5) < 0.5, 'and respawns at the checkpoint');
return { pass, log };
