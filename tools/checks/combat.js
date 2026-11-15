// url: ?level=test
// A squad fights back, uses cover, hurts the player, dies and drops loot; allies join in.
game.manual = true;
game.step(30, 1 / 60);
const d = game.debug, pl = game.player, ai = game.ai;
const log = [];
let pass = true;
const expect = (cond, msg) => { log.push((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) pass = false; };
const V = (x, y, z) => pl.pos.clone().set(x, y, z);
const items = await import('/src/weapons/items.ts');
for (const [x, z] of [[-6, -14], [0, -16], [5, -15]]) ai.spawnEnemy('assoc', V(x, 0, z), { yaw: Math.PI, squad: 'A' });
ai.spawnEnemy('super', V(2, 0, -18), { yaw: Math.PI, squad: 'A' });
ai.spawnEnemy('drone', V(10, 0, -10), {});
ai.spawnAlly('rivet', V(-3, 0, 16), {});
ai.spawnAlly('dutch', V(3, 0, 16), {});
game.inv.give(items.rollShield(1, { rarity: 1, seed: 5 }));
d.tp(0, 0.05, 14, 0, 0);
game.inv.active = 1;
game.weapons.equipActive();
game.step(60, 1 / 60);
let usedCover = false;
let r = null;
for (let i = 0; i < 14; i++) {
  r = d.botFight(180, { head: false });
  if (ai.npcs.some((n) => n.faction === 'monomart' && n.brain.tactic === 'inCover')) usedCover = true;
  await new Promise((res) => setTimeout(res, 0));
  if (r.enemies === 0 || !r.alive) break;
}
expect(usedCover, 'enemies took cover at some point');
expect(game.stats.damageTaken > 10, `enemies hurt the player (${Math.round(game.stats.damageTaken)} damage)`);
expect(game.stats.kills >= 3, `robots can be killed (${game.stats.kills} kills, ${r.enemies} left)`);
expect(game.world.updatables.some((u) => u.kind), 'kills drop loot');
expect(game.stats.hits > 0, `shots register (${game.stats.hits}/${game.stats.shots})`);
return { pass, log };
